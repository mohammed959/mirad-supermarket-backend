/**
 * Integration tests for the product bulk importer's create + update
 * behavior (`importProductsFromExcel`). Runs against the REAL dev database
 * (no Prisma mocking — the create/update branching spans multiple
 * sequential queries that aren't worth stubbing). Every row/fixture it
 * creates is deleted at the end.
 *
 * Run:
 *   cd backend && npx ts-node --transpile-only tests/products/productImport.test.ts
 */

import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { prisma } from '../../src/lib/prisma';
import { importProductsFromExcel } from '../../src/modules/products/product.import';

const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

const TAG = `pimport${Date.now()}`;

interface Row {
  name?: string; nameAr?: string; brandSlug?: string; categorySlug?: string; subcategorySlug?: string;
  description?: string; descriptionAr?: string; sku?: string; price?: number; quantity?: number;
  barcode?: string; featured?: boolean | string;
}

async function buildWorkbook(rows: Row[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Sheet1');
  sheet.columns = [
    { header: 'name', key: 'name' }, { header: 'nameAr', key: 'nameAr' },
    { header: 'brandSlug', key: 'brandSlug' }, { header: 'categorySlug', key: 'categorySlug' },
    { header: 'subcategorySlug', key: 'subcategorySlug' },
    { header: 'description', key: 'description' }, { header: 'descriptionAr', key: 'descriptionAr' },
    { header: 'sku', key: 'sku' }, { header: 'price', key: 'price' }, { header: 'quantity', key: 'quantity' },
    { header: 'barcode', key: 'barcode' }, { header: 'featured', key: 'featured' },
  ];
  for (const row of rows) sheet.addRow(row);
  const arr = await wb.xlsx.writeBuffer();
  return Buffer.from(arr as ArrayBuffer);
}

async function findAdminId(): Promise<string> {
  const u = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (!u) throw new Error('No SUPER_ADMIN user found — cannot run audit-logged import in this DB');
  return u.id;
}

const createdProductIds = new Set<string>();
const createdCategoryIds = new Set<string>();
const createdSubcategoryIds = new Set<string>();
const createdBrandIds = new Set<string>();

async function cleanup() {
  if (createdProductIds.size) await prisma.product.deleteMany({ where: { id: { in: Array.from(createdProductIds) } } });
  if (createdSubcategoryIds.size) await prisma.subcategory.deleteMany({ where: { id: { in: Array.from(createdSubcategoryIds) } } });
  if (createdCategoryIds.size) await prisma.category.deleteMany({ where: { id: { in: Array.from(createdCategoryIds) } } });
  if (createdBrandIds.size) await prisma.brand.deleteMany({ where: { id: { in: Array.from(createdBrandIds) } } });
}

// ── Shared fixtures: two categories (each with a subcategory) and two brands. ─
interface Fixtures {
  catA: { id: string; slug: string }; subA: { id: string; slug: string };
  catB: { id: string; slug: string }; subB: { id: string; slug: string };
  brandA: { id: string; slug: string }; brandB: { id: string; slug: string };
}
let fx: Fixtures;

async function setupFixtures(): Promise<Fixtures> {
  const catA = await prisma.category.create({ data: { name: `PI Cat A ${TAG}`, nameAr: `فئة أ ${TAG}`, slug: `pi-cat-a-${TAG}`.toLowerCase() } });
  const catB = await prisma.category.create({ data: { name: `PI Cat B ${TAG}`, nameAr: `فئة ب ${TAG}`, slug: `pi-cat-b-${TAG}`.toLowerCase() } });
  createdCategoryIds.add(catA.id); createdCategoryIds.add(catB.id);
  const subA = await prisma.subcategory.create({ data: { categoryId: catA.id, name: `PI Sub A ${TAG}`, nameAr: `فرعي أ ${TAG}`, slug: `pi-sub-a-${TAG}`.toLowerCase() } });
  const subB = await prisma.subcategory.create({ data: { categoryId: catB.id, name: `PI Sub B ${TAG}`, nameAr: `فرعي ب ${TAG}`, slug: `pi-sub-b-${TAG}`.toLowerCase() } });
  createdSubcategoryIds.add(subA.id); createdSubcategoryIds.add(subB.id);
  const brandA = await prisma.brand.create({ data: { name: `PI Brand A ${TAG}`, nameAr: `علامة أ ${TAG}`, slug: `pi-brand-a-${TAG}`.toLowerCase(), isActive: true } });
  const brandB = await prisma.brand.create({ data: { name: `PI Brand B ${TAG}`, nameAr: `علامة ب ${TAG}`, slug: `pi-brand-b-${TAG}`.toLowerCase(), isActive: true } });
  createdBrandIds.add(brandA.id); createdBrandIds.add(brandB.id);
  return { catA, catB, subA, subB, brandA, brandB };
}

// ── Case: a new SKU creates a product ────────────────────────────────
test('a new SKU creates a product', async () => {
  const actorId = await findAdminId();
  const sku = `NEW-${TAG}`;
  const buf = await buildWorkbook([{
    name: 'New Product', nameAr: 'منتج جديد', categorySlug: fx.catA.slug, brandSlug: fx.brandA.slug,
    sku, price: 10, quantity: 5,
  }]);

  const summary = await importProductsFromExcel(buf, actorId);

  assert.equal(summary.errors.length, 0, JSON.stringify(summary.errors));
  assert.equal(summary.productsCreated, 1);
  assert.equal(summary.productsUpdated, 0);

  const products = await prisma.product.findMany({ where: { sku } });
  assert.equal(products.length, 1);
  createdProductIds.add(products[0].id);
  assert.equal(products[0].name, 'New Product');
  assert.equal(Number(products[0].price), 10);
  assert.equal(products[0].stock, 5);
  assert.equal(products[0].categoryId, fx.catA.id);
  assert.equal(products[0].brandId, fx.brandA.id);
});

// ── Case: an existing SKU updates the same product, no duplicate ────
test('an existing SKU updates the same product without creating a duplicate', async () => {
  const actorId = await findAdminId();
  const sku = `UPD-${TAG}`;
  const original = await prisma.product.create({
    data: {
      name: 'Original Name', nameAr: 'اسم أصلي', categoryId: fx.catA.id, brandId: fx.brandA.id,
      sku, price: 20, stock: 50, isActive: true,
    },
  });
  createdProductIds.add(original.id);

  const buf = await buildWorkbook([{
    name: 'Updated Name', nameAr: 'اسم محدث', categorySlug: fx.catA.slug, brandSlug: fx.brandA.slug,
    sku, price: 25, quantity: 5,
  }]);

  const summary = await importProductsFromExcel(buf, actorId);

  assert.equal(summary.errors.length, 0, JSON.stringify(summary.errors));
  assert.equal(summary.productsCreated, 0, 'must not create a new product for an existing SKU');
  assert.equal(summary.productsUpdated, 1);

  const products = await prisma.product.findMany({ where: { sku } });
  assert.equal(products.length, 1, 'exactly one product row must exist for this SKU — no duplicate');
  assert.equal(products[0].id, original.id, 'the SAME product row must have been updated');
  assert.equal(products[0].name, 'Updated Name');
  assert.equal(Number(products[0].price), 25);
  assert.equal(products[0].sku, sku, 'SKU itself must be unchanged');
});

// ── Case: quantity replaces stock, it is never additive ──────────────
test('quantity is replaced, not added to the current stock', async () => {
  const actorId = await findAdminId();
  const sku = `QTY-${TAG}`;
  const original = await prisma.product.create({
    data: { name: 'Qty Test', nameAr: 'اختبار الكمية', categoryId: fx.catA.id, sku, price: 10, stock: 100 },
  });
  createdProductIds.add(original.id);

  const buf = await buildWorkbook([{
    name: 'Qty Test', nameAr: 'اختبار الكمية', categorySlug: fx.catA.slug, sku, price: 10, quantity: 30,
  }]);

  const summary = await importProductsFromExcel(buf, actorId);
  assert.equal(summary.errors.length, 0, JSON.stringify(summary.errors));
  assert.equal(summary.productsUpdated, 1);

  const reloaded = await prisma.product.findUnique({ where: { id: original.id } });
  assert.equal(reloaded!.stock, 30, 'stock must be REPLACED by the row quantity, not 100 + 30');
});

// ── Case: brand/category/subcategory relationships are updated ──────
test('brand, category, and subcategory relationships are updated correctly', async () => {
  const actorId = await findAdminId();
  const sku = `REL-${TAG}`;
  const original = await prisma.product.create({
    data: {
      name: 'Rel Test', nameAr: 'اختبار العلاقة', categoryId: fx.catA.id, subcategoryId: fx.subA.id,
      brandId: fx.brandA.id, sku, price: 10, stock: 1,
    },
  });
  createdProductIds.add(original.id);

  const buf = await buildWorkbook([{
    name: 'Rel Test', nameAr: 'اختبار العلاقة', categorySlug: fx.catB.slug, subcategorySlug: fx.subB.slug,
    brandSlug: fx.brandB.slug, sku, price: 10, quantity: 1,
  }]);

  const summary = await importProductsFromExcel(buf, actorId);
  assert.equal(summary.errors.length, 0, JSON.stringify(summary.errors));
  assert.equal(summary.productsUpdated, 1);

  const reloaded = await prisma.product.findUnique({ where: { id: original.id } });
  assert.equal(reloaded!.categoryId, fx.catB.id);
  assert.equal(reloaded!.subcategoryId, fx.subB.id);
  assert.equal(reloaded!.brandId, fx.brandB.id);
});

// ── Case: an invalid row does not partially update a product ────────
test('an invalid row does not partially update a product', async () => {
  const actorId = await findAdminId();
  const sku = `INV-${TAG}`;
  const original = await prisma.product.create({
    data: {
      name: 'Untouched Name', nameAr: 'اسم غير ممس', categoryId: fx.catA.id, brandId: fx.brandA.id,
      sku, price: 15, stock: 40, barcode: `INVBAR-${TAG}`,
    },
  });
  createdProductIds.add(original.id);

  // Same SKU (would update), but price is invalid (0) — the whole row must
  // be rejected before touching the product.
  const buf = await buildWorkbook([{
    name: 'Should Not Apply', nameAr: 'يجب ألا يطبق', categorySlug: fx.catA.slug, brandSlug: fx.brandA.slug,
    sku, price: 0, quantity: 999,
  }]);

  const summary = await importProductsFromExcel(buf, actorId);
  assert.equal(summary.productsUpdated, 0);
  assert.equal(summary.failedRows, 1);
  assert.equal(summary.errors[0].field, 'price');

  const reloaded = await prisma.product.findUnique({ where: { id: original.id } });
  assert.equal(reloaded!.name, 'Untouched Name');
  assert.equal(Number(reloaded!.price), 15);
  assert.equal(reloaded!.stock, 40, 'stock must NOT have been changed to 999');
  assert.equal(reloaded!.barcode, `INVBAR-${TAG}`);
});

// ── Case: a barcode conflict produces a row-level error ──────────────
test('a barcode belonging to another product produces a row-level error', async () => {
  const actorId = await findAdminId();
  const takenBarcode = `BC-${TAG}`;
  const other = await prisma.product.create({
    data: { name: 'Barcode Owner', nameAr: 'مالك الباركود', categoryId: fx.catA.id, sku: `OWNER-${TAG}`, price: 5, stock: 1, barcode: takenBarcode },
  });
  createdProductIds.add(other.id);

  const conflictingSku = `CONFLICT-${TAG}`;
  const buf = await buildWorkbook([{
    name: 'New Product Bad Barcode', nameAr: 'منتج بباركود سيء', categorySlug: fx.catA.slug,
    sku: conflictingSku, price: 10, quantity: 1, barcode: takenBarcode,
  }]);

  const summary = await importProductsFromExcel(buf, actorId);
  assert.equal(summary.productsCreated, 0, 'must not create a product with a barcode owned by another product');
  assert.equal(summary.failedRows, 1);
  assert.equal(summary.errors[0].field, 'barcode');
  assert.match(summary.errors[0].message, /already belongs to another product/);

  const shouldNotExist = await prisma.product.findFirst({ where: { sku: conflictingSku } });
  assert.equal(shouldNotExist, null);

  // Sanity: updating the barcode owner ITSELF with its OWN existing barcode
  // must NOT be flagged as a conflict against itself.
  const selfBuf = await buildWorkbook([{
    name: 'Barcode Owner', nameAr: 'مالك الباركود', categorySlug: fx.catA.slug,
    sku: `OWNER-${TAG}`, price: 6, quantity: 2, barcode: takenBarcode,
  }]);
  const selfSummary = await importProductsFromExcel(selfBuf, actorId);
  assert.equal(selfSummary.errors.length, 0, JSON.stringify(selfSummary.errors));
  assert.equal(selfSummary.productsUpdated, 1);
});

// ── Runner ──────────────────────────────────────────────────────────
(async () => {
  let failed = 0;
  try {
    fx = await setupFixtures();
    for (const [name, fn] of tests) {
      try {
        await fn();
        console.log(`✓ ${name}`);
      } catch (err) {
        failed += 1;
        console.error(`✗ ${name}`);
        console.error(err);
      }
    }
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed` + (failed > 0 ? `, ${failed} failed` : ''));
  process.exit(failed > 0 ? 1 : 0);
})();
