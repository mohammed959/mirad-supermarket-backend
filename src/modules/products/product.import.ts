import ExcelJS from 'exceljs';
import { Prisma, VariantType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logAction } from '../audit/audit.service';

const VARIANT_TYPES: VariantType[] = ['PIECE', 'CARTON', 'DOZEN', 'BUNDLE'];

const HEADER_ALIASES: Record<string, string> = {
  name: 'name',
  productname: 'name',
  'product name': 'name',
  namear: 'nameAr',
  'arabic name': 'nameAr',
  description: 'description',
  descriptionar: 'descriptionAr',
  categoryslug: 'categorySlug',
  category: 'categorySlug',
  subcategoryslug: 'subcategorySlug',
  subcategory: 'subcategorySlug',
  featured: 'featured',
  variant: 'variantType',
  varianttype: 'variantType',
  type: 'variantType',
  sku: 'sku',
  barcode: 'barcode',
  price: 'price',
  stock: 'stock',
};

interface ParsedRow {
  rowNumber: number;
  name?: string;
  nameAr?: string;
  description?: string;
  descriptionAr?: string;
  categorySlug?: string;
  subcategorySlug?: string;
  featured?: boolean;
  variantType?: string;
  sku?: string;
  barcode?: string;
  price?: number;
  stock?: number;
}

export interface ImportRowError {
  rowNumber: number;
  field?: string;
  message: string;
}

export interface ImportSummary {
  totalRows: number;
  productsCreated: number;
  variantsCreated: number;
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

function parseSheet(buffer: Buffer): Promise<ParsedRow[]> {
  return (async () => {
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
          ? (cell.value as any).result // formula cell
          : cell.value;
        if (raw == null || raw === '') return;
        anyValue = true;

        switch (key) {
          case 'price':
          case 'stock':
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
  })();
}

export async function importProductsFromExcel(buffer: Buffer, actorId: string): Promise<ImportSummary> {
  const rows = await parseSheet(buffer);
  const errors: ImportRowError[] = [];

  // Group rows by (name, nameAr) — one product, multiple variants
  const groups = new Map<string, ParsedRow[]>();
  for (const row of rows) {
    if (!row.name || !row.nameAr) {
      errors.push({ rowNumber: row.rowNumber, field: 'name', message: 'name and nameAr are required' });
      continue;
    }
    const key = `${row.name.trim().toLowerCase()}|${row.nameAr.trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  // Validate categories up-front
  const categorySlugs = new Set<string>();
  const subcategorySlugs = new Set<string>();
  for (const row of rows) {
    if (row.categorySlug) categorySlugs.add(row.categorySlug.toLowerCase());
    if (row.subcategorySlug) subcategorySlugs.add(row.subcategorySlug.toLowerCase());
  }
  const [foundCategories, foundSubcategories] = await Promise.all([
    prisma.category.findMany({ where: { slug: { in: Array.from(categorySlugs) } } }),
    prisma.subcategory.findMany({ where: { slug: { in: Array.from(subcategorySlugs) } } }),
  ]);
  const catBySlug = new Map(foundCategories.map((c) => [c.slug.toLowerCase(), c]));
  const subBySlug = new Map(foundSubcategories.map((s) => [s.slug.toLowerCase(), s]));

  let productsCreated = 0;
  let variantsCreated = 0;

  for (const [, groupRows] of groups) {
    const first = groupRows[0];
    const categorySlug = (groupRows.find((r) => r.categorySlug)?.categorySlug ?? '').toLowerCase();
    if (!categorySlug) {
      errors.push({ rowNumber: first.rowNumber, field: 'categorySlug', message: 'categorySlug is required (on at least one row of the product)' });
      continue;
    }
    const cat = catBySlug.get(categorySlug);
    if (!cat) {
      errors.push({ rowNumber: first.rowNumber, field: 'categorySlug', message: `Category slug "${categorySlug}" not found` });
      continue;
    }
    let subId: string | null = null;
    const subSlug = (groupRows.find((r) => r.subcategorySlug)?.subcategorySlug ?? '').toLowerCase();
    if (subSlug) {
      const sub = subBySlug.get(subSlug);
      if (!sub) {
        errors.push({ rowNumber: first.rowNumber, field: 'subcategorySlug', message: `Subcategory slug "${subSlug}" not found` });
        continue;
      }
      subId = sub.id;
    }

    // Validate every variant row
    const variants: Prisma.ProductVariantCreateManyProductInput[] = [];
    let groupValid = true;
    for (const row of groupRows) {
      if (!row.variantType) {
        errors.push({ rowNumber: row.rowNumber, field: 'variantType', message: 'variantType is required (PIECE/CARTON/DOZEN/BUNDLE)' });
        groupValid = false;
        continue;
      }
      const type = row.variantType.toUpperCase() as VariantType;
      if (!VARIANT_TYPES.includes(type)) {
        errors.push({ rowNumber: row.rowNumber, field: 'variantType', message: `Unknown variant type "${row.variantType}"` });
        groupValid = false;
        continue;
      }
      if (!row.sku) {
        errors.push({ rowNumber: row.rowNumber, field: 'sku', message: 'sku is required' });
        groupValid = false;
        continue;
      }
      if (row.price == null || row.price <= 0) {
        errors.push({ rowNumber: row.rowNumber, field: 'price', message: 'price must be > 0' });
        groupValid = false;
        continue;
      }
      const stock = row.stock != null && row.stock >= 0 ? row.stock : 0;
      variants.push({
        type,
        sku: row.sku.trim(),
        barcode: row.barcode?.trim(),
        price: row.price,
        stock: Math.floor(stock),
      });
    }
    if (!groupValid || variants.length === 0) continue;

    // Conflict check: SKU must be unique
    const skus = variants.map((v) => v.sku);
    const existingSkus = await prisma.productVariant.findMany({
      where: { sku: { in: skus } },
      select: { sku: true },
    });
    if (existingSkus.length > 0) {
      for (const e of existingSkus) {
        const conflictRow = groupRows.find((r) => r.sku?.trim() === e.sku);
        errors.push({
          rowNumber: conflictRow?.rowNumber ?? first.rowNumber,
          field: 'sku',
          message: `SKU "${e.sku}" already exists`,
        });
      }
      continue;
    }

    try {
      await prisma.product.create({
        data: {
          name: first.name!.trim(),
          nameAr: first.nameAr!.trim(),
          description: first.description?.trim(),
          descriptionAr: first.descriptionAr?.trim(),
          isFeatured: Boolean(first.featured),
          categoryId: cat.id,
          subcategoryId: subId,
          variants: { createMany: { data: variants } },
        },
      });
      productsCreated += 1;
      variantsCreated += variants.length;
    } catch (err) {
      errors.push({ rowNumber: first.rowNumber, message: `DB error: ${(err as Error).message}` });
    }
  }

  await logAction({
    actorId, actorRole: 'SUPER_ADMIN',
    action: 'product.import',
    entityType: 'product_import',
    changes: { totalRows: rows.length, productsCreated, variantsCreated, errorCount: errors.length },
  });

  return { totalRows: rows.length, productsCreated, variantsCreated, errors };
}

export async function buildSampleTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  sheet.columns = [
    { header: 'name',            key: 'name',            width: 28 },
    { header: 'nameAr',          key: 'nameAr',          width: 28 },
    { header: 'description',     key: 'description',     width: 30 },
    { header: 'descriptionAr',   key: 'descriptionAr',   width: 30 },
    { header: 'categorySlug',    key: 'categorySlug',    width: 18 },
    { header: 'subcategorySlug', key: 'subcategorySlug', width: 18 },
    { header: 'featured',        key: 'featured',        width: 12 },
    { header: 'variantType',     key: 'variantType',     width: 14 },
    { header: 'sku',             key: 'sku',             width: 18 },
    { header: 'barcode',         key: 'barcode',         width: 18 },
    { header: 'price',           key: 'price',           width: 10 },
    { header: 'stock',           key: 'stock',           width: 10 },
  ];
  sheet.addRow({
    name: 'Almarai Milk 1L', nameAr: 'حليب المراعي 1 لتر',
    description: 'Long life full-fat milk', descriptionAr: 'حليب طويل العمر كامل الدسم',
    categorySlug: 'dairy', subcategorySlug: 'milk',
    featured: true, variantType: 'PIECE', sku: 'MLK-1L-PC', barcode: '6281234567890',
    price: 6.5, stock: 100,
  });
  sheet.addRow({
    name: 'Almarai Milk 1L', nameAr: 'حليب المراعي 1 لتر',
    variantType: 'CARTON', sku: 'MLK-1L-CT', price: 72.0, stock: 12,
  });

  const arr = await workbook.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}
