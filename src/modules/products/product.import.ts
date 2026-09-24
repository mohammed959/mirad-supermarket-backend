import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma';
import { logAction } from '../audit/audit.service';

/**
 * Flat product importer — one row per product. No variant fields are
 * accepted; price, quantity, SKU and barcode are product-level columns.
 *
 * Spec columns (case-insensitive, whitespace/underscore tolerant):
 *   Required: name, nameAr, category (slug or name), sku, price, quantity
 *   Optional: brand (slug), description, descriptionAr, subcategory (slug or name), barcode, featured
 *
 * Header aliases below let operators paste from a variety of
 * spreadsheets while still mapping to a single canonical field.
 *
 * Create vs. update: the SKU (normalized the same way for both paths —
 * trimmed) is looked up against the catalog. No match creates a new
 * product exactly as before. A match UPDATES that product instead —
 * `name`, `nameAr`, `brandSlug`, `categorySlug`, `subcategorySlug`,
 * `description`, `descriptionAr`, `price`, `quantity` (replaces the stock
 * value, never additive), `barcode`, and `featured` are all taken from the
 * row, exactly as a fresh create would. The SKU itself is only ever used to
 * find the product — it's never written to on update. Both paths share the
 * same field validation, run before any database write, so an invalid row
 * neither creates nor partially updates anything.
 */
// IMPORTANT: every key here MUST be already normalized (lowercase, no
// spaces or underscores). `normalizeHeader` strips those before the
// lookup, so a key like 'arabic name' would be unreachable.
const HEADER_ALIASES: Record<string, string> = {
  // English name
  name: 'name',
  productname: 'name',
  englishname: 'name',
  // Arabic name
  namear: 'nameAr',
  arabicname: 'nameAr',
  productnamear: 'nameAr',
  // Descriptions
  description: 'description',
  englishdescription: 'description',
  descriptionar: 'descriptionAr',
  arabicdescription: 'descriptionAr',
  // Category / subcategory
  categoryslug: 'categorySlug',
  category: 'categorySlug',
  subcategoryslug: 'subcategorySlug',
  subcategory: 'subcategorySlug',
  // Brand
  brandslug: 'brandSlug',
  brand: 'brandSlug',
  // Inventory & pricing
  sku: 'sku',
  barcode: 'barcode',
  price: 'price',
  quantity: 'quantity',
  stock: 'quantity',
  // Admin flags
  featured: 'featured',
};

interface ParsedRow {
  rowNumber: number;
  name?: string;
  nameAr?: string;
  description?: string;
  descriptionAr?: string;
  categorySlug?: string;
  subcategorySlug?: string;
  brandSlug?: string;
  featured?: boolean;
  sku?: string;
  barcode?: string;
  price?: number;
  quantity?: number;
}

export interface ImportRowError {
  rowNumber: number;
  field?: string;
  message: string;
}

export interface ImportSummary {
  totalRows: number;
  productsCreated: number;
  productsUpdated: number;
  failedRows: number;
  errors: ImportRowError[];
}

function normalizeHeader(raw: string): string | undefined {
  const key = raw.trim().toLowerCase().replace(/[_\s]+/g, '');
  return HEADER_ALIASES[key];
}

function coerceBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return s === 'true' || s === '1' || s === 'yes' || s === 'y';
  }
  return false;
}

function coerceNum(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function coerceStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') {
    const s = v.trim();
    return s.length === 0 ? undefined : s;
  }
  return String(v).trim() || undefined;
}

async function parseSheet(buffer: Buffer): Promise<ParsedRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Workbook has no sheets');

  const headerMap = new Map<number, string>();
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell, col) => {
    const mapped = normalizeHeader(String(cell.value ?? ''));
    if (mapped) headerMap.set(col, mapped);
  });
  if (headerMap.size === 0) throw new Error('First row must contain headers');

  const rows: ParsedRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const obj: ParsedRow = { rowNumber };
    let anyValue = false;
    row.eachCell((cell, col) => {
      const key = headerMap.get(col);
      if (!key) return;
      const raw: unknown = (cell.value && typeof cell.value === 'object' && 'result' in (cell.value as any))
        ? (cell.value as any).result
        : cell.value;
      if (raw == null || raw === '') return;
      anyValue = true;

      switch (key) {
        case 'price':
        case 'quantity':
          (obj as unknown as Record<string, unknown>)[key] = coerceNum(raw);
          break;
        case 'featured':
          obj.featured = coerceBool(raw);
          break;
        default:
          (obj as unknown as Record<string, unknown>)[key] = coerceStr(raw);
      }
    });
    if (anyValue) rows.push(obj);
  });

  return rows;
}

export async function importProductsFromExcel(buffer: Buffer, actorId: string): Promise<ImportSummary> {
  const rows = await parseSheet(buffer);
  const errors: ImportRowError[] = [];

  // Brands are resolved by slug in bulk.
  const brandSlugs = new Set<string>();
  for (const row of rows) {
    if (row.brandSlug) brandSlugs.add(row.brandSlug.toLowerCase());
  }
  const foundBrands = await prisma.brand.findMany({ where: { slug: { in: Array.from(brandSlugs) } } });
  const brandBySlug = new Map(foundBrands.map((b) => [b.slug.toLowerCase(), b]));

  // Categories are matched by slug, English name, or Arabic name
  // (case-insensitive, trimmed) so operators can reference an existing
  // category by its human name, not only its slug. The categories table is
  // small, so load it once and build a reference map. First writer wins per
  // key, with slug taking precedence over names.
  const allCategories = await prisma.category.findMany();
  const catByRef = new Map<string, (typeof allCategories)[number]>();
  for (const c of allCategories) {
    for (const key of [c.slug, c.name, c.nameAr]) {
      const k = key.trim().toLowerCase();
      if (k && !catByRef.has(k)) catByRef.set(k, c);
    }
  }

  // Subcategories are matched WITHIN their parent category by slug, English
  // name, or Arabic name (case-insensitive). Load only the subcategories of
  // the categories actually referenced in the file.
  const referencedCatIds = new Set<string>();
  for (const row of rows) {
    if (!row.categorySlug) continue;
    const c = catByRef.get(row.categorySlug.trim().toLowerCase());
    if (c) referencedCatIds.add(c.id);
  }
  const foundSubcategories = await prisma.subcategory.findMany({
    where: { categoryId: { in: Array.from(referencedCatIds) } },
  });
  const subsByCategory = new Map<string, typeof foundSubcategories>();
  for (const s of foundSubcategories) {
    const list = subsByCategory.get(s.categoryId);
    if (list) list.push(s);
    else subsByCategory.set(s.categoryId, [s]);
  }

  // SKU lookup across the file + DB. A SKU already in the catalog switches
  // that row from create to update — `existingProductBySku` maps the
  // normalized SKU to the product id to update.
  const fileSkus = rows.map((r) => r.sku?.trim()).filter((s): s is string => Boolean(s));
  const existingSkuRows = await prisma.product.findMany({
    where: { sku: { in: fileSkus } },
    select: { id: true, sku: true },
  });
  const existingProductBySku = new Map(
    existingSkuRows.filter((r) => r.sku).map((r) => [r.sku as string, r.id]),
  );

  // Detect SKUs that appear more than once within the uploaded file so
  // operators see a clear "duplicated in the file" error instead of a
  // generic DB-error reported on the second row.
  const skuCountInFile = new Map<string, number>();
  for (const sku of fileSkus) {
    skuCountInFile.set(sku, (skuCountInFile.get(sku) ?? 0) + 1);
  }

  // Barcode ownership — bulk-loaded so a row can be rejected when its
  // barcode already belongs to a DIFFERENT product than the one this row
  // would create/update. Updated as rows are processed so two rows in the
  // same file introducing the same brand-new barcode are also caught.
  const fileBarcodes = rows.map((r) => r.barcode?.trim()).filter((b): b is string => Boolean(b));
  const existingBarcodeRows = fileBarcodes.length
    ? await prisma.product.findMany({ where: { barcode: { in: fileBarcodes } }, select: { id: true, barcode: true } })
    : [];
  const productIdByBarcode = new Map<string, string>(
    existingBarcodeRows.filter((r) => r.barcode).map((r) => [r.barcode as string, r.id]),
  );

  let productsCreated = 0;
  let productsUpdated = 0;

  for (const row of rows) {
    // Names — both required
    if (!row.name) {
      errors.push({ rowNumber: row.rowNumber, field: 'name', message: 'English name is required' });
      continue;
    }
    if (!row.nameAr) {
      errors.push({ rowNumber: row.rowNumber, field: 'nameAr', message: 'Arabic name is required' });
      continue;
    }

    // Category — required, must exist
    if (!row.categorySlug) {
      errors.push({ rowNumber: row.rowNumber, field: 'category', message: 'Category is required' });
      continue;
    }
    const cat = catByRef.get(row.categorySlug.trim().toLowerCase());
    if (!cat) {
      errors.push({ rowNumber: row.rowNumber, field: 'category', message: `Category "${row.categorySlug}" not found — create it before importing.` });
      continue;
    }

    // Brand — OPTIONAL. Empty ⇒ product has no brand. When provided it must
    // exist and be active.
    let brandId: string | null = null;
    if (row.brandSlug) {
      const brand = brandBySlug.get(row.brandSlug.toLowerCase());
      if (!brand) {
        errors.push({ rowNumber: row.rowNumber, field: 'brand', message: `Brand "${row.brandSlug}" not found — create it before importing.` });
        continue;
      }
      if (!brand.isActive) {
        errors.push({ rowNumber: row.rowNumber, field: 'brand', message: `Brand "${row.brandSlug}" is inactive — re-activate it before importing.` });
        continue;
      }
      brandId = brand.id;
    }

    // Subcategory — optional. When provided, match it against the chosen
    // category's subcategories by slug, English name, or Arabic name. Scoping
    // the match to the category guarantees a valid (category, subcategory)
    // pair and lets operators reference a subcategory by its display name.
    let subId: string | null = null;
    if (row.subcategorySlug) {
      const ref = row.subcategorySlug.trim().toLowerCase();
      const candidates = subsByCategory.get(cat.id) ?? [];
      const sub = candidates.find(
        (s) =>
          s.slug.toLowerCase() === ref ||
          s.name.trim().toLowerCase() === ref ||
          s.nameAr.trim().toLowerCase() === ref,
      );
      if (!sub) {
        errors.push({
          rowNumber: row.rowNumber,
          field: 'subcategory',
          message: `Subcategory "${row.subcategorySlug}" was not found in category "${row.categorySlug}".`,
        });
        continue;
      }
      subId = sub.id;
    }

    // SKU — required, and must be unique WITHIN the file (an existing SKU
    // in the database is not an error — see below, it means "update").
    if (!row.sku) {
      errors.push({ rowNumber: row.rowNumber, field: 'sku', message: 'SKU is required' });
      continue;
    }
    const sku = row.sku.trim();
    if ((skuCountInFile.get(sku) ?? 0) > 1) {
      errors.push({
        rowNumber: row.rowNumber,
        field: 'sku',
        message: `SKU "${sku}" appears more than once in this file.`,
      });
      continue;
    }
    // Existing SKU ⇒ this row updates that product instead of creating a
    // new one. The SKU itself is only ever used to find it — never changed.
    const existingProductId = existingProductBySku.get(sku);

    // Barcode — optional, but when provided it must not already belong to
    // a DIFFERENT product (the product this row is about to create, or the
    // one it's about to update, doesn't count as "another product").
    const barcode = row.barcode?.trim() || null;
    if (barcode) {
      const ownerId = productIdByBarcode.get(barcode);
      if (ownerId && ownerId !== existingProductId) {
        errors.push({
          rowNumber: row.rowNumber,
          field: 'barcode',
          message: `Barcode "${barcode}" already belongs to another product.`,
        });
        continue;
      }
    }

    // Price — required, > 0
    if (row.price == null || row.price <= 0) {
      errors.push({ rowNumber: row.rowNumber, field: 'price', message: 'Price must be greater than 0' });
      continue;
    }

    // Quantity — required, integer >= 0. On update this REPLACES the
    // current stock value; it is never added to it.
    if (row.quantity == null || row.quantity < 0) {
      errors.push({ rowNumber: row.rowNumber, field: 'quantity', message: 'Quantity must be 0 or greater' });
      continue;
    }

    // Flat product: no variants array is passed. Description/subcategory/
    // brand/barcode are explicitly nulled when the cell is blank so an
    // update fully replaces them from the row, matching how a create
    // treats the same blank columns.
    const data = {
      name: row.name.trim(),
      nameAr: row.nameAr.trim(),
      description: row.description?.trim() ?? null,
      descriptionAr: row.descriptionAr?.trim() ?? null,
      isFeatured: Boolean(row.featured),
      categoryId: cat.id,
      subcategoryId: subId,
      brandId,
      barcode,
      price: row.price,
      stock: Math.floor(row.quantity),
    };

    try {
      let productId = existingProductId;
      if (productId) {
        // SKU is deliberately omitted — it's the lookup key, never updated.
        // A changed barcode invalidates the Cloudinary image audit result.
        const current = await prisma.product.findUnique({ where: { id: productId }, select: { barcode: true } });
        const barcodeChanged = (current?.barcode ?? null) !== (barcode ?? null);
        await prisma.product.update({
          where: { id: productId },
          data: { ...data, ...(barcodeChanged && { imageCheckedAt: null, imageFound: null }) },
        });
        productsUpdated += 1;
      } else {
        const createdProduct = await prisma.product.create({ data: { ...data, sku } });
        productId = createdProduct.id;
        existingProductBySku.set(sku, productId);
        productsCreated += 1;
      }
      if (barcode) productIdByBarcode.set(barcode, productId);
    } catch (err) {
      errors.push({ rowNumber: row.rowNumber, message: `Database error: ${(err as Error).message}` });
    }
  }

  const failedRows = errors.length;

  await logAction({
    actorId, actorRole: 'SUPER_ADMIN',
    action: 'product.import',
    entityType: 'product_import',
    changes: { totalRows: rows.length, productsCreated, productsUpdated, failedRows },
  });

  return { totalRows: rows.length, productsCreated, productsUpdated, failedRows, errors };
}

export async function buildSampleTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  sheet.columns = [
    // Required core
    { header: 'name',            key: 'name',            width: 28 },
    { header: 'nameAr',          key: 'nameAr',          width: 28 },
    // Required classification
    { header: 'brandSlug',       key: 'brandSlug',       width: 18 },
    { header: 'category',        key: 'categorySlug',    width: 18 },
    // Optional classification
    { header: 'subcategory',     key: 'subcategorySlug', width: 18 },
    // Optional descriptions
    { header: 'description',     key: 'description',     width: 30 },
    { header: 'descriptionAr',   key: 'descriptionAr',   width: 30 },
    // Required inventory & pricing
    { header: 'sku',             key: 'sku',             width: 18 },
    { header: 'price',           key: 'price',           width: 10 },
    { header: 'quantity',        key: 'quantity',        width: 10 },
    // Optional inventory & flags
    { header: 'barcode',         key: 'barcode',         width: 18 },
    { header: 'featured',        key: 'featured',        width: 10 },
  ];

  // Row 1 — every field populated.
  sheet.addRow({
    name: 'Almarai Milk 1L',
    nameAr: 'حليب المراعي 1 لتر',
    brandSlug: 'almarai',
    categorySlug: 'Dairy',
    subcategorySlug: 'Milk',
    description: 'Long life full-fat milk',
    descriptionAr: 'حليب طويل العمر كامل الدسم',
    sku: 'MLK-1L',
    price: 6.5,
    quantity: 100,
    barcode: '6281234567890',
    featured: true,
  });

  // Row 2 — optional fields left blank to show the minimum viable shape.
  sheet.addRow({
    name: 'Basic Soap Bar',
    nameAr: 'صابون أساسي',
    brandSlug: 'generic',
    categorySlug: 'Household',
    sku: 'SOAP-BAR',
    price: 3,
    quantity: 50,
  });

  const arr = await workbook.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}
