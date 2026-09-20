/**
 * Integration tests for the "customers never see out-of-stock products"
 * rule, enforced at the database-query level in `product.service.ts`.
 *
 * Runs against the REAL dev database (no Prisma mocking) — every function
 * under test issues its own real query, so this is the only way to prove
 * pagination/counts/search stay correct once zero-availableStock products
 * are excluded. Every fixture created is deleted in `finally`.
 *
 * Run:
 *   cd backend && npx ts-node --transpile-only tests/products/productAvailabilityGate.test.ts
 */

import assert from 'node:assert/strict';
import { prisma } from '../../src/lib/prisma';
import * as svc from '../../src/modules/products/product.service';

const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

const TAG = `avail${Date.now()}`;
const createdProductIds = new Set<string>();
let categoryId = '';

async function makeProduct(opts: { name: string; stock: number; reserved?: number; isActive?: boolean; isFeatured?: boolean }) {
  const p = await prisma.product.create({
    data: {
      categoryId,
      name: opts.name,
      nameAr: `${opts.name} ar`,
      sku: `${TAG}-${opts.name.replace(/\s+/g, '-')}`,
      price: 10,
      stock: opts.stock,
      reserved: opts.reserved ?? 0,
      isActive: opts.isActive ?? true,
      isFeatured: opts.isFeatured ?? false,
    },
  });
  createdProductIds.add(p.id);
  return p;
}

async function setup() {
  const category = await prisma.category.create({
    data: { name: `Availability Test Category ${TAG}`, nameAr: `فئة ${TAG}`, slug: `availability-test-${TAG}` },
  });
  categoryId = category.id;
}

async function cleanup() {
  if (createdProductIds.size) await prisma.product.deleteMany({ where: { id: { in: Array.from(createdProductIds) } } });
  if (categoryId) await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────
// listProducts / listMarketplaceProducts — browsing
// ─────────────────────────────────────────────────────────────────────

test('a zero-stock product is excluded from the marketplace list, and pagination/count reflect only in-stock products', async () => {
  const inStock1 = await makeProduct({ name: `InStock1 ${TAG}`, stock: 5 });
  const inStock2 = await makeProduct({ name: `InStock2 ${TAG}`, stock: 5 });
  const outOfStock = await makeProduct({ name: `OutOfStock ${TAG}`, stock: 0 });

  const result = await svc.listMarketplaceProducts({ categoryId, page: 1, limit: 20 });
  const ids = result.products.map((p) => p.id);
  assert.ok(ids.includes(inStock1.id));
  assert.ok(ids.includes(inStock2.id));
  assert.ok(!ids.includes(outOfStock.id), 'zero-stock product must not appear in the list');
  assert.equal(result.pagination.totalItems, 2, 'count must reflect only in-stock products, not the raw row count');
});

test('a product whose stock is fully reserved (available = stock - reserved <= 0) is excluded even though raw stock > 0', async () => {
  const fullyReserved = await makeProduct({ name: `FullyReserved ${TAG}`, stock: 5, reserved: 5 });
  const partiallyReserved = await makeProduct({ name: `PartiallyReserved ${TAG}`, stock: 5, reserved: 4 });

  const result = await svc.listMarketplaceProducts({ categoryId, page: 1, limit: 20 });
  const ids = result.products.map((p) => p.id);
  assert.ok(!ids.includes(fullyReserved.id), 'fully-reserved stock must be treated as unavailable, matching isProductAvailable');
  assert.ok(ids.includes(partiallyReserved.id), 'partially-reserved stock still has 1 sellable unit and must be visible');
});

test('pagination page size and page count stay correct across multiple pages with out-of-stock rows interspersed', async () => {
  // Scoped via `search` (not just `categoryId`, which every test in this
  // file shares) so this test's counts are isolated from every other
  // fixture already created in the category.
  const marker = `Pagination${TAG}`;
  const inStockIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const p = await makeProduct({ name: `${marker}InStock${i}`, stock: 3 });
    inStockIds.push(p.id);
    await makeProduct({ name: `${marker}OOS${i}`, stock: 0 });
  }

  const page1 = await svc.listMarketplaceProducts({ categoryId, search: marker, page: 1, limit: 2 });
  const page2 = await svc.listMarketplaceProducts({ categoryId, search: marker, page: 2, limit: 2 });
  const page3 = await svc.listMarketplaceProducts({ categoryId, search: marker, page: 3, limit: 2 });

  assert.equal(page1.pagination.totalItems, 5);
  assert.equal(page1.pagination.totalPages, 3);
  assert.equal(page1.products.length, 2);
  assert.equal(page2.products.length, 2);
  assert.equal(page3.products.length, 1);

  const allReturnedIds = [...page1.products, ...page2.products, ...page3.products].map((p) => p.id);
  assert.deepEqual([...allReturnedIds].sort(), [...inStockIds].sort(), 'exactly the 5 in-stock products, no duplicates, no out-of-stock leakage');
});

test('a product automatically reappears once its stock is replenished — never deleted or deactivated', async () => {
  const p = await makeProduct({ name: `Replenish ${TAG}`, stock: 0 });

  const before = await svc.listMarketplaceProducts({ categoryId, page: 1, limit: 20 });
  assert.ok(!before.products.some((x) => x.id === p.id));

  await prisma.product.update({ where: { id: p.id }, data: { stock: 3 } });

  const after = await svc.listMarketplaceProducts({ categoryId, page: 1, limit: 20 });
  assert.ok(after.products.some((x) => x.id === p.id), 'product must become visible again automatically');

  const stillExists = await prisma.product.findUnique({ where: { id: p.id } });
  assert.ok(stillExists, 'the row itself must never be deleted');
  assert.equal(stillExists!.isActive, true, 'the row must never be deactivated by the visibility rule');
});

// ─────────────────────────────────────────────────────────────────────
// Detail
// ─────────────────────────────────────────────────────────────────────

test('getMarketplaceProduct returns null for a zero-stock product (treated as not found)', async () => {
  const p = await makeProduct({ name: `Detail ${TAG}`, stock: 0 });
  const result = await svc.getMarketplaceProduct(p.id, 'en');
  assert.equal(result, null);
});

test('getMarketplaceProduct returns the product once it has available stock', async () => {
  const p = await makeProduct({ name: `DetailAvail ${TAG}`, stock: 2 });
  const result = await svc.getMarketplaceProduct(p.id, 'en');
  assert.ok(result);
  assert.equal(result!.id, p.id);
});

// ─────────────────────────────────────────────────────────────────────
// Search + suggestions
// ─────────────────────────────────────────────────────────────────────

test('search results exclude zero-stock products and report an accurate total', async () => {
  const term = `Searchable${TAG}`;
  const inStock = await makeProduct({ name: `${term} InStock`, stock: 4 });
  const outOfStock = await makeProduct({ name: `${term} OutOfStock`, stock: 0 });

  const result = await svc.searchMarketplaceProducts({ q: term, page: 1, limit: 20 });
  const ids = result.products.map((p) => p.id);
  assert.ok(ids.includes(inStock.id));
  assert.ok(!ids.includes(outOfStock.id));
  assert.equal(result.pagination.totalItems, 1);
});

test('barcode search excludes a zero-stock exact match', async () => {
  const barcode = `BC${TAG}`;
  const p = await prisma.product.create({
    data: { categoryId, name: `Barcode ${TAG}`, nameAr: 'ar', sku: `${TAG}-barcode`, barcode, price: 5, stock: 0, isActive: true },
  });
  createdProductIds.add(p.id);

  const result = await svc.searchMarketplaceProducts({ barcode, page: 1, limit: 1 });
  assert.equal(result.products.length, 0);
  assert.equal(result.matchedProductId, null);
});

test('search suggestions exclude zero-stock products', async () => {
  const term = `Suggest${TAG}`;
  const inStock = await makeProduct({ name: `${term} InStock`, stock: 1 });
  const outOfStock = await makeProduct({ name: `${term} OutOfStock`, stock: 0 });

  const suggestions = await svc.marketplaceSearchSuggestions(term, 'en', 10);
  const ids = suggestions.map((s) => s.id);
  assert.ok(ids.includes(inStock.id));
  assert.ok(!ids.includes(outOfStock.id));
});

// ─────────────────────────────────────────────────────────────────────
// Featured / home cards
// ─────────────────────────────────────────────────────────────────────

test('featured products exclude zero-stock items', async () => {
  const inStock = await makeProduct({ name: `Featured InStock ${TAG}`, stock: 2, isFeatured: true });
  const outOfStock = await makeProduct({ name: `Featured OOS ${TAG}`, stock: 0, isFeatured: true });

  const marketplace = await svc.listMarketplaceFeaturedProducts('en', 50);
  const legacy = await svc.getFeaturedProducts();
  for (const list of [marketplace, legacy]) {
    const ids = list.map((p) => p.id);
    assert.ok(ids.includes(inStock.id));
    assert.ok(!ids.includes(outOfStock.id));
  }
});

test('home product cards and home featured cards exclude zero-stock items', async () => {
  const inStock = await makeProduct({ name: `HomeCard InStock ${TAG}`, stock: 2, isFeatured: true });
  const outOfStock = await makeProduct({ name: `HomeCard OOS ${TAG}`, stock: 0, isFeatured: true });

  const cards = await svc.listProductCardsForHome({ page: 1, limit: 50 });
  const cardIds = cards.items.map((c) => c.id);
  assert.ok(cardIds.includes(inStock.id));
  assert.ok(!cardIds.includes(outOfStock.id));

  const featuredCards = await svc.listFeaturedProductCardsForHome(50);
  const featuredIds = featuredCards.map((c) => c.id);
  assert.ok(featuredIds.includes(inStock.id));
  assert.ok(!featuredIds.includes(outOfStock.id));
});

// ─────────────────────────────────────────────────────────────────────
// Admin/internal bypass must be preserved
// ─────────────────────────────────────────────────────────────────────

test('admin reads (includeOutOfStock, includeInactive, ids, getProductById, listLowStockProducts) still see zero-stock products', async () => {
  const outOfStock = await makeProduct({ name: `AdminVisible ${TAG}`, stock: 0 });

  const viaFlag = await svc.listProducts({ categoryId, includeOutOfStock: true });
  assert.ok(viaFlag.products.some((p) => p.id === outOfStock.id), 'includeOutOfStock must still show it');

  const viaAll = await svc.listProducts({ categoryId, includeInactive: true });
  assert.ok(viaAll.products.some((p) => p.id === outOfStock.id), 'includeInactive (admin "all") must still show it');

  const viaIds = await svc.listProducts({ ids: [outOfStock.id] });
  assert.ok(viaIds.products.some((p) => p.id === outOfStock.id), 'explicit id lookup (cart) must still show it');

  const single = await svc.getProductById(outOfStock.id);
  assert.ok(single, 'admin single-product read must still show it');

  const lowStock = await svc.listLowStockProducts(10);
  assert.ok(lowStock.some((p) => p.id === outOfStock.id), 'admin low-stock report must still show it');
});

// ── Runner ──────────────────────────────────────────────────────────
(async () => {
  let failed = 0;
  try {
    await setup();
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
  } catch (err) {
    failed += 1;
    console.error('✗ setup failed');
    console.error(err);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed` + (failed > 0 ? `, ${failed} failed` : ''));
  process.exit(failed > 0 ? 1 : 0);
})();
