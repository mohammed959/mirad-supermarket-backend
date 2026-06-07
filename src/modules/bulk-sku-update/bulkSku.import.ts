import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma';

export type RowStatus = 'VALID' | 'INVALID' | 'SKIPPED';

export interface PreviewRow {
  rowNumber: number;
  sku: string | null;
  rawPrice: string | null;
  rawQuantity: string | null;
  price: number | null;
  quantity: number | null;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  variantId?: string | null;
  productName?: string | null;
  oldPrice?: number | null;
  oldQuantity?: number | null;
}

export interface PreviewSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  skippedRows: number;
}

export interface PreviewResult {
  rows: PreviewRow[];
  summary: PreviewSummary;
}

const HEADER_ALIASES: Record<string, string> = {
  sku: 'sku',
  price: 'price',
  unitprice: 'price',
  quantity: 'quantity',
  qty: 'quantity',
  stock: 'quantity',
};

function normalizeHeader(raw: string): string | undefined {
  const key = raw.trim().toLowerCase().replace(/[_\s]+/g, '');
  return HEADER_ALIASES[key];
}

function rawString(cellValue: ExcelJS.CellValue): string | null {
  if (cellValue == null) return null;
  if (typeof cellValue === 'object') {
    const obj = cellValue as { result?: unknown; text?: unknown; richText?: Array<{ text?: string }> };
    if ('result' in obj && obj.result != null) return String(obj.result).trim() || null;
    if (Array.isArray(obj.richText)) {
      return obj.richText.map((r) => r.text ?? '').join('').trim() || null;
    }
    if ('text' in obj && obj.text != null) return String(obj.text).trim() || null;
    return null;
  }
  const s = String(cellValue).trim();
  return s.length === 0 ? null : s;
}

function parseQuantity(raw: string | null): { value: number | null; error?: string } {
  if (raw == null) return { value: null };
  // Reject anything that isn't a clean integer (allow leading + and surrounding spaces).
  if (!/^[+-]?\d+$/.test(raw)) {
    return { value: null, error: 'Quantity must be whole digits only.' };
  }
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return { value: null, error: 'Quantity is not a valid number.' };
  if (n < 0) return { value: null, error: 'Quantity cannot be negative.' };
  return { value: n };
}

function parsePrice(raw: string | null): { value: number | null; error?: string } {
  if (raw == null) return { value: null };
  // Allow decimals; reject anything that isn't a number.
  if (!/^[+-]?\d+(\.\d+)?$/.test(raw)) {
    return { value: null, error: 'Price must be a numeric value.' };
  }
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return { value: null, error: 'Price is not a valid number.' };
  if (n < 0) return { value: null, error: 'Price cannot be negative.' };
  if (n === 0) return { value: null, error: 'Price cannot be zero.' };
  // Round to 2 decimals to match the schema.
  return { value: Math.round(n * 100) / 100 };
}

/**
 * Parse the workbook and validate every row. Returns a preview structure the
 * admin can review before confirming the import — no DB writes here.
 */
export async function parseAndValidateBuffer(buffer: Buffer): Promise<PreviewResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Workbook has no sheets.');

  const headerMap = new Map<number, string>();
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell, col) => {
    const mapped = normalizeHeader(String(cell.value ?? ''));
    if (mapped) headerMap.set(col, mapped);
  });
  if (!Array.from(headerMap.values()).includes('sku')) {
    throw new Error('Template must include the "sku" column.');
  }

  const rawRows: Array<{ rowNumber: number; sku: string | null; rawPrice: string | null; rawQuantity: string | null }> = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    let sku: string | null = null;
    let rawPrice: string | null = null;
    let rawQuantity: string | null = null;
    let anyValue = false;
    row.eachCell((cell, col) => {
      const key = headerMap.get(col);
      if (!key) return;
      const raw = rawString(cell.value);
      if (raw != null) anyValue = true;
      if (key === 'sku')      sku = raw;
      if (key === 'price')    rawPrice = raw;
      if (key === 'quantity') rawQuantity = raw;
    });
    if (anyValue) rawRows.push({ rowNumber, sku, rawPrice, rawQuantity });
  });

  // Look up all referenced SKUs up-front.
  const distinctSkus = Array.from(
    new Set(rawRows.map((r) => r.sku?.trim()).filter((s): s is string => !!s))
  );
  const existing = distinctSkus.length
    ? await prisma.productVariant.findMany({
        where: { sku: { in: distinctSkus } },
        select: {
          id: true,
          sku: true,
          price: true,
          stock: true,
          product: { select: { name: true, nameAr: true } },
        },
      })
    : [];
  const bySku = new Map(existing.map((v) => [v.sku, v]));

  const rows: PreviewRow[] = rawRows.map((r) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const sku = r.sku?.trim() ?? null;

    if (!sku) errors.push('SKU is required.');

    const priceResult = parsePrice(r.rawPrice);
    if (priceResult.error) errors.push(priceResult.error);
    const quantityResult = parseQuantity(r.rawQuantity);
    if (quantityResult.error) errors.push(quantityResult.error);

    const hasPrice = priceResult.value != null;
    const hasQuantity = quantityResult.value != null;

    let variant = sku ? bySku.get(sku) : undefined;
    if (sku && !variant) errors.push(`SKU "${sku}" was not found in the catalog.`);

    let status: RowStatus;
    if (errors.length > 0) {
      status = 'INVALID';
    } else if (!hasPrice && !hasQuantity) {
      warnings.push('Both price and quantity are empty — row will be skipped.');
      status = 'SKIPPED';
    } else {
      status = 'VALID';
    }

    return {
      rowNumber: r.rowNumber,
      sku,
      rawPrice: r.rawPrice,
      rawQuantity: r.rawQuantity,
      price: priceResult.value,
      quantity: quantityResult.value,
      status,
      errors,
      warnings,
      variantId: variant?.id ?? null,
      productName: variant?.product?.name ?? null,
      oldPrice: variant ? Number(variant.price) : null,
      oldQuantity: variant ? variant.stock : null,
    };
  });

  const summary: PreviewSummary = {
    totalRows: rows.length,
    validRows: rows.filter((r) => r.status === 'VALID').length,
    invalidRows: rows.filter((r) => r.status === 'INVALID').length,
    skippedRows: rows.filter((r) => r.status === 'SKIPPED').length,
  };

  return { rows, summary };
}

/** Build the 3-column Excel template admins fill in. */
export async function buildBulkSkuTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Bulk SKU Update');

  sheet.columns = [
    { header: 'sku',      key: 'sku',      width: 24 },
    { header: 'price',    key: 'price',    width: 14 },
    { header: 'quantity', key: 'quantity', width: 14 },
  ];

  // Style the header row.
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: 'middle' };

  // Two illustrative sample rows so admins can see the expected shape.
  sheet.addRow({ sku: 'MLK-1L-PC', price: 7.5, quantity: 120 });
  sheet.addRow({ sku: 'MLK-1L-CT', price: '',  quantity: 0   });

  const arr = await workbook.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}
