/**
 * Unit tests for the storefront homepage mappers.
 *
 * Lives OUTSIDE `src/` — `tsconfig.json` only includes `src/**` so this
 * file is never emitted into `dist/` or shipped to production.
 *
 * The backend has no test runner configured yet, so this uses Node's
 * built-in `node:assert/strict` and a tiny inline `test()` harness. Run
 * with the existing dev dependency `ts-node`:
 *
 *   cd backend && npx ts-node --transpile-only tests/storefront/productCard.mapper.test.ts
 *
 * A non-zero exit code means at least one assertion failed.
 */

import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { config } from '../../src/config';
import {
  getCategoryImageUrl,
  getProductImageUrl,
} from '../../src/lib/productImage';
import {
  toBanner,
  toCategoryCard,
  toFeaturedSection,
  toProductCard,
  toSubcategoryCard,
  type BannerRow,
  type CategoryRow,
  type FeaturedSectionRow,
  type ProductRow,
  type SubcategoryRow,
} from '../../src/modules/storefront/productCard.mapper';

// ── Tiny in-file test harness ────────────────────────────────────────
const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

// ── Fixtures ─────────────────────────────────────────────────────────
const availableProductRow = (): ProductRow => ({
  id: 'prod_1',
  name: 'Almarai Full Cream Milk 1L',
  nameAr: 'حليب المراعي كامل الدسم 1 لتر',
  sku: 'ALM-MLK-1L',
  price: 6.5,
  stock: 10,
  reserved: 2,
  isActive: true,
});

const bannerRow = (): BannerRow => ({
  id: 'ban_1',
  title: 'Weekend Sale',
  titleAr: 'تخفيضات نهاية الأسبوع',
  imageUrl: 'https://cdn.example.com/banners/weekend.png',
  linkType: 'category',
  linkValue: 'cat_dairy',
  sortOrder: 3,
});

const categoryRow = (): CategoryRow => ({
  id: 'cat_1',
  name: 'Dairy & Eggs',
  nameAr: 'الألبان والبيض',
  slug: 'dairy-eggs',
  sortOrder: 2,
});

// ── Product availability ─────────────────────────────────────────────
test('available product (stock > reserved, isActive) → available: true', () => {
  const row = availableProductRow();
  const card = toProductCard(row);
  assert.equal(card.available, true);
});

test('out-of-stock product (stock === 0) → available: false', () => {
  const row: ProductRow = { ...availableProductRow(), stock: 0, reserved: 0 };
  const card = toProductCard(row);
  assert.equal(card.available, false);
});

test('fully reserved product (stock === reserved) → available: false', () => {
  const row: ProductRow = { ...availableProductRow(), stock: 5, reserved: 5 };
  const card = toProductCard(row);
  assert.equal(card.available, false);
});

test('inactive product → available: false even with plenty of stock', () => {
  const row: ProductRow = { ...availableProductRow(), isActive: false };
  const card = toProductCard(row);
  assert.equal(card.available, false);
});

test('over-reserved product (reserved > stock, negative net) → available: false', () => {
  const row: ProductRow = { ...availableProductRow(), stock: 1, reserved: 5 };
  const card = toProductCard(row);
  assert.equal(card.available, false);
});

// ── SKU / image URL behavior — matches decorateProductImages() ────────
test('null SKU → default product image URL', () => {
  const row: ProductRow = { ...availableProductRow(), sku: null };
  const card = toProductCard(row);
  assert.equal(card.sku, null);
  assert.equal(card.imageUrl, config.bunny.defaultProductImageUrl);
});

test('blank/whitespace SKU → default product image URL', () => {
  const row: ProductRow = { ...availableProductRow(), sku: '   ' };
  const card = toProductCard(row);
  assert.equal(card.sku, '   ');
  assert.equal(card.imageUrl, config.bunny.defaultProductImageUrl);
});

test('valid SKU → CDN image URL via getProductImageUrl (identical to today)', () => {
  const row = availableProductRow();
  const card = toProductCard(row);
  assert.equal(card.imageUrl, getProductImageUrl(row.sku));
  assert.ok(card.imageUrl.startsWith(config.bunny.productBaseUrl + '/'));
});

// The current `decorateProductImages` OVERWRITES any stored `imageUrl`
// on product-shaped payloads with the SKU-derived URL. Verify the mapper
// mirrors that — a stored value must never leak through.
test('stored product imageUrl is ignored — mapper derives from SKU only', () => {
  const rowWithStoredUrl = {
    ...availableProductRow(),
    imageUrl: 'https://legacy-cdn.example.com/manual-override.png',
  } as ProductRow & { imageUrl: string };
  const card = toProductCard(rowWithStoredUrl);
  assert.equal(card.imageUrl, getProductImageUrl(availableProductRow().sku));
  assert.notEqual(card.imageUrl, 'https://legacy-cdn.example.com/manual-override.png');
});

test('stored relative image path on the row is also ignored — SKU wins', () => {
  const row = {
    ...availableProductRow(),
    imageUrl: '/uploads/products/legacy.png',
  } as ProductRow & { imageUrl: string };
  const card = toProductCard(row);
  assert.equal(card.imageUrl, getProductImageUrl(availableProductRow().sku));
});

test('SKU with unsafe characters → sanitized before CDN URL is built', () => {
  const row: ProductRow = { ...availableProductRow(), sku: 'AB C/1$2' };
  const card = toProductCard(row);
  // getProductImageUrl replaces every non-[A-Za-z0-9._-] char with "_"
  assert.equal(card.imageUrl, `${config.bunny.productBaseUrl}/AB_C_1_2.${config.bunny.productExtension}`);
});

// ── Decimal price conversion ─────────────────────────────────────────
test('number price → decimal string (no precision change)', () => {
  const row: ProductRow = { ...availableProductRow(), price: 6.5 };
  const card = toProductCard(row);
  assert.equal(card.price, '6.5');
});

test('string price → passes through unchanged', () => {
  const row: ProductRow = { ...availableProductRow(), price: '12.75' };
  const card = toProductCard(row);
  assert.equal(card.price, '12.75');
});

test('real Prisma Decimal price → stringified via toString() (same as Decimal.toJSON today)', () => {
  const decimal = new Prisma.Decimal('99.99');
  // Reference: whatever Decimal.toString() produces is what Prisma-backed
  // endpoints currently emit via JSON.stringify → Decimal.toJSON.
  const expected = decimal.toString();
  const row = { ...availableProductRow(), price: decimal } as unknown as ProductRow;
  const card = toProductCard(row);
  assert.equal(card.price, expected);
});

test('Prisma Decimal with trailing zeros → same wire representation as today', () => {
  // Decimal.js strips trailing zeros: new Decimal("6.50").toString() → "6.5"
  const decimal = new Prisma.Decimal('6.50');
  const expected = decimal.toString();
  const row = { ...availableProductRow(), price: decimal } as unknown as ProductRow;
  const card = toProductCard(row);
  assert.equal(card.price, expected);
});

test('null price → null (legacy products, do not fabricate a zero)', () => {
  const row: ProductRow = { ...availableProductRow(), price: null };
  const card = toProductCard(row);
  assert.equal(card.price, null);
});

// ── ProductCard exact keys ───────────────────────────────────────────
test('ProductCard exposes only the whitelisted keys — no relations or internals', () => {
  const row = availableProductRow();
  const card = toProductCard(row);
  assert.deepEqual(Object.keys(card).sort(), [
    'available',
    'id',
    'imageUrl',
    'name',
    'nameAr',
    'price',
    'sku',
  ]);
  const forbidden = [
    'category',
    'subcategory',
    'brand',
    'variants',
    'description',
    'descriptionAr',
    'stock',
    'reserved',
    'isActive',
    'createdAt',
    'updatedAt',
    'categoryId',
    'subcategoryId',
    'brandId',
    'barcode',
    'hideFromHome',
    'isFeatured',
  ];
  for (const key of forbidden) {
    assert.equal(
      (card as unknown as Record<string, unknown>)[key],
      undefined,
      `ProductCard leaked forbidden key: ${key}`,
    );
  }
});

// ── Immutability ─────────────────────────────────────────────────────
test('toProductCard does not mutate its input row', () => {
  const row = availableProductRow();
  const snapshot = JSON.stringify(row);
  toProductCard(row);
  assert.equal(JSON.stringify(row), snapshot);
});

test('toProductCard tolerates a frozen input row', () => {
  const row = Object.freeze(availableProductRow());
  const card = toProductCard(row);
  assert.equal(card.id, row.id);
});

// ── HomeCategoryCard ────────────────────────────────────────────────
test('toCategoryCard returns the seven DTO fields and drops the lowercase back-relation', () => {
  const row = {
    ...categoryRow(),
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    imageUrl: 'https://legacy-value-should-be-ignored/x.png',
    subcategories: [
      { id: 'sub_1', name: 'Milk', nameAr: 'حليب', slug: 'milk', imageUrl: null, sortOrder: 1 },
    ],
  } as CategoryRow;
  const card = toCategoryCard(row);
  assert.deepEqual(Object.keys(card).sort(), [
    'id',
    'imageUrl',
    'name',
    'nameAr',
    'slug',
    'sortOrder',
    'subCategories',
  ]);
  // The lowercase Prisma back-relation is not on the wire — only camelCase `subCategories` is.
  assert.equal((card as unknown as Record<string, unknown>).subcategories, undefined);
  assert.ok(Array.isArray(card.subCategories));
});

test('HomeCategoryCard.imageUrl derives from slug via getCategoryImageUrl', () => {
  const row = categoryRow();
  const card = toCategoryCard(row);
  assert.equal(card.imageUrl, getCategoryImageUrl(row.slug));
  assert.ok(card.imageUrl.startsWith(config.bunny.categoryBaseUrl + '/'));
});

test('toCategoryCard returns subCategories: [] when the input has no subcategories', () => {
  const card = toCategoryCard(categoryRow());
  assert.deepEqual(card.subCategories, []);
});

test('toCategoryCard maps each subcategory through toSubcategoryCard', () => {
  const row: CategoryRow = {
    ...categoryRow(),
    subcategories: [
      { id: 'sub_1', name: 'Milk',  nameAr: 'حليب',  slug: 'milk',  imageUrl: null, sortOrder: 1 },
      { id: 'sub_2', name: 'Cream', nameAr: 'كريمة', slug: 'cream', imageUrl: 'https://cdn.example.net/Subcategories/cream.webp', sortOrder: 2 },
    ],
  };
  const card = toCategoryCard(row);
  assert.equal(card.subCategories.length, 2);
  assert.deepEqual(card.subCategories[0], toSubcategoryCard(row.subcategories![0]));
  assert.deepEqual(card.subCategories[1], toSubcategoryCard(row.subcategories![1]));
});

test('toCategoryCard does not mutate its input row', () => {
  const row: CategoryRow = {
    ...categoryRow(),
    subcategories: [
      { id: 'sub_1', name: 'Milk', nameAr: 'حليب', slug: 'milk', imageUrl: null, sortOrder: 1 },
    ],
  };
  const snapshot = JSON.stringify(row);
  toCategoryCard(row);
  assert.equal(JSON.stringify(row), snapshot);
});

// ── HomeSubcategoryCard ─────────────────────────────────────────────
const subRow = (over: Partial<SubcategoryRow> = {}): SubcategoryRow => ({
  id: 'sub_1',
  name: 'Milk',
  nameAr: 'حليب',
  slug: 'milk',
  imageUrl: null,
  sortOrder: 1,
  ...over,
});

test('toSubcategoryCard preserves a non-empty stored imageUrl verbatim', () => {
  const stored = 'https://apprafed.b-cdn.net/Subcategories/6f1e.webp';
  const card = toSubcategoryCard(subRow({ imageUrl: stored }));
  assert.equal(card.imageUrl, stored);
});

test('toSubcategoryCard falls back to slug-derived URL when stored is null', () => {
  const card = toSubcategoryCard(subRow({ imageUrl: null, slug: 'milk' }));
  assert.equal(card.imageUrl, getCategoryImageUrl('milk'));
});

test('toSubcategoryCard falls back to slug-derived URL when stored is empty or whitespace', () => {
  for (const empty of ['', '   ', '\t\n']) {
    const card = toSubcategoryCard(subRow({ imageUrl: empty, slug: 'milk' }));
    assert.equal(card.imageUrl, getCategoryImageUrl('milk'));
  }
});

test('toSubcategoryCard returns exactly the six DTO fields', () => {
  const card = toSubcategoryCard(subRow());
  assert.deepEqual(Object.keys(card).sort(), [
    'id',
    'imageUrl',
    'name',
    'nameAr',
    'slug',
    'sortOrder',
  ]);
});

test('toSubcategoryCard does not mutate its input row', () => {
  const row = subRow({ imageUrl: 'https://x/y.png' });
  const snapshot = JSON.stringify(row);
  toSubcategoryCard(row);
  assert.equal(JSON.stringify(row), snapshot);
});

// ── HomeBanner ──────────────────────────────────────────────────────
test('HomeBanner preserves admin-provided imageUrl verbatim (not slug-derived)', () => {
  const row = bannerRow();
  const banner = toBanner(row);
  assert.equal(banner.imageUrl, row.imageUrl);
});

test('HomeBanner nullable link fields pass through as null', () => {
  const row: BannerRow = { ...bannerRow(), linkType: null, linkValue: null };
  const banner = toBanner(row);
  assert.equal(banner.linkType, null);
  assert.equal(banner.linkValue, null);
});

test('HomeBanner exposes only the seven DTO fields', () => {
  const row = bannerRow();
  const banner = toBanner(row);
  assert.deepEqual(Object.keys(banner).sort(), [
    'id',
    'imageUrl',
    'linkType',
    'linkValue',
    'sortOrder',
    'title',
    'titleAr',
  ]);
});

test('toBanner does not mutate its input row', () => {
  const row = bannerRow();
  const snapshot = JSON.stringify(row);
  toBanner(row);
  assert.equal(JSON.stringify(row), snapshot);
});

// ── HomeFeaturedSection ─────────────────────────────────────────────
test('toFeaturedSection maps each item.product through toProductCard', () => {
  const section: FeaturedSectionRow = {
    id: 'sec_1',
    name: 'New Arrivals',
    nameAr: 'وصل حديثاً',
    sortOrder: 1,
    items: [
      { product: availableProductRow() },
      {
        product: {
          ...availableProductRow(),
          id: 'prod_2',
          sku: 'ABC-2',
          isActive: false,
        },
      },
    ],
  };
  const dto = toFeaturedSection(section);
  assert.equal(dto.products.length, 2);
  assert.equal(dto.products[0].available, true);
  assert.equal(dto.products[1].available, false);
  for (const p of dto.products) {
    assert.deepEqual(Object.keys(p).sort(), [
      'available',
      'id',
      'imageUrl',
      'name',
      'nameAr',
      'price',
      'sku',
    ]);
  }
});

test('HomeFeaturedSection exposes only the five DTO fields', () => {
  const section: FeaturedSectionRow = {
    id: 'sec_1',
    name: 'New Arrivals',
    nameAr: 'وصل حديثاً',
    sortOrder: 1,
    items: [{ product: availableProductRow() }],
  };
  const dto = toFeaturedSection(section);
  assert.deepEqual(Object.keys(dto).sort(), [
    'id',
    'name',
    'nameAr',
    'products',
    'sortOrder',
  ]);
});

test('toFeaturedSection does not mutate its input section or its items', () => {
  const section: FeaturedSectionRow = {
    id: 'sec_1',
    name: 'New Arrivals',
    nameAr: 'وصل حديثاً',
    sortOrder: 1,
    items: [{ product: availableProductRow() }],
  };
  const snapshot = JSON.stringify(section);
  toFeaturedSection(section);
  assert.equal(JSON.stringify(section), snapshot);
});

// ── Import side-effect smoke test ────────────────────────────────────
// Guards the "pure mapper" contract: importing the mapper must NOT
// initialise Prisma, load the product service, connect to the DB, or read
// runtime env. We assert this by importing the mapper in a fresh Node
// process and inspecting `require.cache` for forbidden modules.
test('importing productCard.mapper does not pull in Prisma or product.service', () => {
  const script = `
    const path = require('path');
    require('ts-node/register/transpile-only');
    require(path.resolve('src/modules/storefront/productCard.mapper.ts'));
    const loaded = Object.keys(require.cache).map((p) => p.replace(process.cwd() + path.sep, ''));
    const forbidden = loaded.filter((p) =>
      p.includes('@prisma/client') ||
      p.endsWith('src/lib/prisma.ts') ||
      p.endsWith('src/modules/products/product.service.ts')
    );
    if (forbidden.length > 0) {
      console.error('FORBIDDEN_LOADED:' + JSON.stringify(forbidden));
      process.exit(2);
    }
    process.exit(0);
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
  });
  assert.equal(result.status, 0, `smoke test failed:\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
});

// ── Runner ──────────────────────────────────────────────────────────
(async () => {
  let failed = 0;
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
  console.log(
    `\n${tests.length - failed}/${tests.length} passed` +
      (failed > 0 ? `, ${failed} failed` : ''),
  );
  process.exit(failed > 0 ? 1 : 0);
})();
