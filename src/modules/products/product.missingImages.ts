import ExcelJS from 'exceljs';
import { prisma } from '../../lib/prisma';
import { getCloudinaryProductProbeUrl } from '../../lib/productImage';

export const IMAGE_CHECK_BATCH_SIZE = 500;
const CONCURRENCY = 40;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 3;

/**
 * HEAD-probes one Cloudinary public id. `true` = asset exists (2xx),
 * `false` = Cloudinary answered 404. Anything else (timeout, 5xx, 429) is
 * retried and finally thrown — a transient error must never be reported as
 * "missing image".
 */
async function assetExists(identifier: string): Promise<boolean> {
  const url = getCloudinaryProductProbeUrl(identifier);
  if (!url) throw new Error('Cloudinary is not configured (CLOUDINARY_CLOUD_NAME is empty)');

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (res.ok) return true;
      if (res.status === 404) return false;
      lastError = new Error(`Cloudinary responded ${res.status} for ${identifier}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Could not verify image "${identifier}" with Cloudinary: ${(lastError as Error).message}`);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface ProductMissingImageRow {
  nameAr: string;
  sku: string;
  barcode: string;
}

export interface ImageCheckStatus {
  total: number;
  checked: number;
  remaining: number;
}

export interface ImageCheckBatchResult {
  /** Products in this batch with no Cloudinary image under SKU, SKU_1 or barcode. */
  missing: ProductMissingImageRow[];
  /** Products in this batch that got a definitive answer and were marked checked. */
  checked: number;
  /** Products in this batch Cloudinary couldn't answer for — left unchecked, retried next time. */
  unverified: number;
  remaining: number;
}

export async function getImageCheckStatus(): Promise<ImageCheckStatus> {
  const [total, remaining] = await Promise.all([
    prisma.product.count(),
    prisma.product.count({ where: { imageCheckedAt: null } }),
  ]);
  return { total, checked: total - remaining, remaining };
}

// One batch at a time per process, so a double click can't check (and return)
// the same products twice.
let batchRunning = false;

type Outcome = 'found' | 'missing' | 'unknown';

/**
 * Checks the next `IMAGE_CHECK_BATCH_SIZE` never-checked products against
 * Cloudinary in the same order the storefront tries: `{sku}`, `{sku}_1`,
 * `{barcode}`. Every product with a definitive answer is marked checked
 * (`imageCheckedAt` / `imageFound`) so it is never read again.
 */
export async function runImageCheckBatch(): Promise<ImageCheckBatchResult> {
  if (!getCloudinaryProductProbeUrl('probe')) {
    throw new Error('Cloudinary is not configured (CLOUDINARY_CLOUD_NAME is empty)');
  }
  if (batchRunning) {
    throw new Error('An image check is already running — please wait for it to finish.');
  }
  batchRunning = true;
  try {
    const products = await prisma.product.findMany({
      where: { imageCheckedAt: null },
      select: { id: true, nameAr: true, sku: true, barcode: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: IMAGE_CHECK_BATCH_SIZE,
    });

    const cache = new Map<string, Promise<boolean>>();
    const exists = (identifier: string) => {
      let hit = cache.get(identifier);
      if (!hit) {
        hit = assetExists(identifier);
        cache.set(identifier, hit);
      }
      return hit;
    };

    const outcomes = await mapWithConcurrency<(typeof products)[number], Outcome>(
      products,
      CONCURRENCY,
      async (p) => {
        const sku = p.sku?.trim() || '';
        const barcode = p.barcode?.trim() || '';
        const candidates = [sku, sku ? `${sku}_1` : '', barcode].filter(Boolean);
        try {
          for (const candidate of candidates) {
            if (await exists(candidate)) return 'found';
          }
          return 'missing';
        } catch {
          return 'unknown';
        }
      },
    );

    const unverified = outcomes.filter((o) => o === 'unknown').length;
    if (products.length > 0 && unverified === products.length) {
      throw new Error('Could not reach Cloudinary to verify any image — nothing was marked as checked. Please try again.');
    }

    const now = new Date();
    const idsFor = (wanted: Outcome) => products.filter((_, i) => outcomes[i] === wanted).map((p) => p.id);
    const foundIds = idsFor('found');
    const missingIds = idsFor('missing');
    if (foundIds.length) {
      await prisma.product.updateMany({ where: { id: { in: foundIds } }, data: { imageCheckedAt: now, imageFound: true } });
    }
    if (missingIds.length) {
      await prisma.product.updateMany({ where: { id: { in: missingIds } }, data: { imageCheckedAt: now, imageFound: false } });
    }

    const missing = products
      .filter((_, i) => outcomes[i] === 'missing')
      .map((p) => ({ nameAr: p.nameAr, sku: p.sku?.trim() ?? '', barcode: p.barcode?.trim() ?? '' }));

    const { remaining } = await getImageCheckStatus();
    return { missing, checked: foundIds.length + missingIds.length, unverified, remaining };
  } finally {
    batchRunning = false;
  }
}

export async function buildMissingImagesWorkbook(rows: ProductMissingImageRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Missing images');
  sheet.columns = [
    { header: 'Product (Arabic)', key: 'nameAr', width: 45 },
    { header: 'SKU', key: 'sku', width: 22 },
    { header: 'Barcode', key: 'barcode', width: 22 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const row of rows) sheet.addRow(row);
  // Text format so long numeric SKUs/barcodes never turn into 1.23E+12.
  sheet.getColumn('sku').numFmt = '@';
  sheet.getColumn('barcode').numFmt = '@';
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
