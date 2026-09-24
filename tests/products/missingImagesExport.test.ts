/**
 * Batched Cloudinary image audit — `GET /api/products/export/missing-images`
 * (+ `/status`). Real DB + real Cloudinary (HEAD probes). Existing products'
 * check flags are snapshotted and restored; fixtures are deleted in `finally`.
 *
 * Run: cd backend && npx ts-node --transpile-only tests/products/missingImagesExport.test.ts
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import ExcelJS from 'exceljs';

import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { signToken } from '../../src/lib/jwt';
import { updateProduct } from '../../src/modules/products/product.service';
import { IMAGE_CHECK_BATCH_SIZE } from '../../src/modules/products/product.missingImages';

const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

function get(port: number, path: string, token?: string): Promise<{ status: number; body: Buffer; type: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (token) headers.authorization = `Bearer ${token}`;
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks), type: String(res.headers['content-type']) }));
    });
    req.on('error', reject);
    req.end();
  });
}
async function withServer(fn: (port: number) => Promise<void>) {
  const server = app.listen(0);
  try {
    await new Promise<void>((r) => server.on('listening', () => r()));
    await fn((server.address() as AddressInfo).port);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}
const json = (r: { body: Buffer }) => JSON.parse(r.body.toString('utf8'));

const TAG = Date.now();
const EXPORT = '/api/products/export/missing-images';
// Known to exist in Cloudinary: mirad/products/8410894005760
const EXISTING_ASSET_ID = '8410894005760';

let categoryId = '';
let staffId = '';
let customerId = '';
let staffToken = '';
let customerToken = '';
let missingId = '';
let presentId = '';
let originals: Array<{ id: string; imageCheckedAt: Date | null; imageFound: boolean | null }> = [];

async function setup() {
  // Park every existing product as "checked" so the batch holds only fixtures.
  originals = await prisma.product.findMany({ select: { id: true, imageCheckedAt: true, imageFound: true } });
  await prisma.product.updateMany({ data: { imageCheckedAt: new Date(0), imageFound: true } });

  categoryId = (await prisma.category.create({ data: { name: `MI ${TAG}`, nameAr: `م ${TAG}`, slug: `mi-${TAG}` } })).id;
  missingId = (await prisma.product.create({
    data: { categoryId, name: 'MI missing', nameAr: `ناقص ${TAG}`, sku: `MISSING-${TAG}`, barcode: `9${TAG}`, price: 1, stock: 1 },
  })).id;
  // No asset under its SKU / SKU_1, but its BARCODE matches a real asset → found on the 3rd tier.
  presentId = (await prisma.product.create({
    data: { categoryId, name: 'MI present', nameAr: `موجود ${TAG}`, sku: `PRESENT-${TAG}`, barcode: EXISTING_ASSET_ID, price: 1, stock: 1 },
  })).id;

  const staff = await prisma.user.create({ data: { role: 'SUPER_ADMIN', email: `mi-${TAG}@example.com`, name: 'MI staff' } });
  staffId = staff.id;
  staffToken = signToken({ userId: staff.id, role: 'SUPER_ADMIN', scope: 'staff' });
  const customer = await prisma.user.create({ data: { role: 'CUSTOMER', mobile: `+9665${TAG}`.slice(0, 13), name: 'MI cust', isActive: true } });
  customerId = customer.id;
  customerToken = signToken({ userId: customer.id, role: 'CUSTOMER', scope: 'customer' });
}

async function cleanup() {
  await prisma.product.deleteMany({ where: { id: { in: [missingId, presentId].filter(Boolean) } } });
  for (const o of originals) {
    await prisma.product.update({ where: { id: o.id }, data: { imageCheckedAt: o.imageCheckedAt, imageFound: o.imageFound } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [staffId, customerId].filter(Boolean) } } });
  if (categoryId) await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
}

test('batch size is 500', async () => {
  assert.equal(IMAGE_CHECK_BATCH_SIZE, 500);
});

test('both endpoints require a staff token (401 without, 403 for a customer)', async () => {
  await withServer(async (port) => {
    for (const path of [EXPORT, `${EXPORT}/status`]) {
      assert.equal((await get(port, path)).status, 401);
      assert.equal((await get(port, path, customerToken)).status, 403);
    }
  });
});

test('status counts unchecked products', async () => {
  await withServer(async (port) => {
    const res = json(await get(port, `${EXPORT}/status`, staffToken));
    assert.equal(res.data.remaining, 2);
    assert.equal(res.data.checked, res.data.total - 2);
  });
});

test('first click: xlsx lists only the product with no image; both fixtures are marked checked with their result', async () => {
  await withServer(async (port) => {
    const res = await get(port, EXPORT, staffToken);
    assert.equal(res.status, 200);
    assert.ok(res.type.includes('spreadsheetml'));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    const sheet = wb.worksheets[0];
    assert.deepEqual([1, 2, 3].map((c) => sheet.getRow(1).getCell(c).value), ['Product (Arabic)', 'SKU', 'Barcode']);
    const rows: string[][] = [];
    sheet.eachRow((row, i) => { if (i > 1) rows.push([1, 2, 3].map((c) => String(row.getCell(c).value ?? ''))); });
    assert.deepEqual(rows, [[`ناقص ${TAG}`, `MISSING-${TAG}`, `9${TAG}`]]);

    const [missing, present] = await Promise.all([
      prisma.product.findUnique({ where: { id: missingId } }),
      prisma.product.findUnique({ where: { id: presentId } }),
    ]);
    assert.ok(missing!.imageCheckedAt && present!.imageCheckedAt);
    assert.equal(missing!.imageFound, false);
    assert.equal(present!.imageFound, true);
  });
});

test('second click: nothing left → JSON "allChecked", no file', async () => {
  await withServer(async (port) => {
    const res = await get(port, EXPORT, staffToken);
    assert.equal(res.status, 200);
    assert.ok(res.type.includes('application/json'));
    const body = json(res);
    assert.equal(body.data.allChecked, true);
    assert.equal(body.data.remaining, 0);
  });
});

test('editing sku/barcode puts the product back into the unchecked pool; unrelated edits do not', async () => {
  await updateProduct(missingId, { nameAr: `ناقص معدل ${TAG}` });
  assert.ok((await prisma.product.findUnique({ where: { id: missingId } }))!.imageCheckedAt, 'name edit must not reset');
  await updateProduct(missingId, { barcode: `8${TAG}` });
  const after = await prisma.product.findUnique({ where: { id: missingId } });
  assert.equal(after!.imageCheckedAt, null);
  assert.equal(after!.imageFound, null);
  await withServer(async (port) => {
    assert.equal(json(await get(port, `${EXPORT}/status`, staffToken)).data.remaining, 1);
  });
});

(async () => {
  let failed = 0;
  try {
    await setup();
    for (const [name, fn] of tests) {
      try { await fn(); console.log(`✓ ${name}`); } catch (err) { failed++; console.error(`✗ ${name}`); console.error(err); }
    }
  } catch (err) { failed++; console.error('✗ setup failed'); console.error(err); }
  finally { await cleanup(); await prisma.$disconnect(); }
  console.log(`\n${tests.length - failed}/${tests.length} passed` + (failed ? `, ${failed} failed` : ''));
  process.exit(failed ? 1 : 0);
})();
