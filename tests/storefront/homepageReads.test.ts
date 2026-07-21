/**
 * Unit tests for the Step 2 optimised homepage read functions.
 *
 *   - getHomepageCategories()               in category.service.ts
 *   - listProductCardsForHome()             in product.service.ts
 *   - listFeaturedProductCardsForHome()     in product.service.ts
 *   - listSectionsForHome()                 in featuredSection.service.ts
 *
 * Monkey-patches the singleton `prisma` client so no DB connection is
 * opened. Assertions cover both the Prisma call shape AND the returned
 * DTO — the availability behavior is the important guarantee.
 *
 * Run:
 *   cd backend && npx ts-node --transpile-only tests/storefront/homepageReads.test.ts
 */

import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { prisma } from '../../src/lib/prisma';
import { config } from '../../src/config';
import {
  getProductImageUrl,
  getCategoryImageUrl,
} from '../../src/lib/productImage';
import { getHomepageCategories } from '../../src/modules/categories/category.service';
import {
  listProductCardsForHome,
  listFeaturedProductCardsForHome,
} from '../../src/modules/products/product.service';
import { listSectionsForHome } from '../../src/modules/featured-sections/featuredSection.service';

// ── Tiny in-file test harness ────────────────────────────────────────
const tests: Array<[string, () => void | Promise<void>]> = [];
const test = (name: string, fn: () => void | Promise<void>) => tests.push([name, fn]);

type Call = { model: string; method: string; args: unknown };

function stub<M extends keyof typeof prisma, K extends keyof (typeof prisma)[M]>(
  calls: Call[],
  model: M,
  method: K,
  impl: (args: unknown) => unknown,
) {
  const target = prisma[model] as Record<string, unknown>;
  const original = target[method as string];
  target[method as string] = ((args: unknown) => {
    calls.push({ model: String(model), method: String(method), args });
    return Promise.resolve(impl(args));
  }) as unknown as typeof original;
  return () => {
    target[method as string] = original as unknown;
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────
const productRow = (over: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Almarai Milk 1L',
  nameAr: 'حليب المراعي 1 لتر',
  sku: 'ALM-MLK-1L',
  price: new Prisma.Decimal('6.50'),
  stock: 10,
  reserved: 2,
  isActive: true,
  variants: [],
  ...over,
});

// ── Categories ────────────────────────────────────────────────────────
test('getHomepageCategories: applies isActive + showOnHome filters and nests active subcategories via select', async () => {
  const calls: Call[] = [];
  const restore = stub(calls, 'category', 'findMany', () => []);
  try {
    await getHomepageCategories();
  } finally {
    restore();
  }
  const args = calls[0].args as {
    where: Record<string, unknown>;
    select: Record<string, unknown>;
    orderBy: Record<string, unknown>;
    include?: unknown;
  };
  assert.equal(calls.length, 1, 'single Prisma query — no N+1');
  assert.equal(args.where.isActive, true);
  assert.equal(args.where.showOnHome, true);
  assert.equal(args.include, undefined, 'must not use include');
  assert.deepEqual(Object.keys(args.select).sort(), [
    'id',
    'name',
    'nameAr',
    'slug',
    'sortOrder',
    'subcategories',
  ]);
  // Category-level `imageUrl` intentionally NOT selected — slug-derived
  // in the mapper, matching legacy category behavior.
  assert.equal(
    (args.select as Record<string, unknown>).imageUrl,
    undefined,
    'category imageUrl must not be selected (still slug-derived)',
  );
  assert.deepEqual(args.orderBy, { sortOrder: 'asc' });

  const subs = args.select.subcategories as {
    where: Record<string, unknown>;
    select: Record<string, unknown>;
    orderBy: Record<string, unknown>;
  };
  assert.equal(subs.where.isActive, true, 'only active subcategories');
  assert.deepEqual(Object.keys(subs.select).sort(), [
    'id',
    'imageUrl',
    'name',
    'nameAr',
    'slug',
    'sortOrder',
  ]);
  assert.deepEqual(subs.orderBy, { sortOrder: 'asc' });
});

test('getHomepageCategories: preserves DB ordering and maps subcategories through toCategoryCard', async () => {
  const rows = [
    {
      id: 'c1', name: 'Dairy', nameAr: 'ألبان', slug: 'dairy', sortOrder: 1,
      subcategories: [
        { id: 'sub_1', name: 'Milk',  nameAr: 'حليب',  slug: 'milk',  imageUrl: null, sortOrder: 1 },
        { id: 'sub_2', name: 'Cheese', nameAr: 'جبن',  slug: 'cheese', imageUrl: 'https://cdn.example.net/Subcategories/cheese.webp', sortOrder: 2 },
      ],
    },
    {
      id: 'c2', name: 'Snacks', nameAr: 'وجبات', slug: 'snacks', sortOrder: 2,
      subcategories: [],
    },
  ];
  const restore = stub([], 'category', 'findMany', () => rows);
  let result;
  try {
    result = await getHomepageCategories();
  } finally {
    restore();
  }
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'c1');
  assert.equal(result[1].id, 'c2');
  for (const card of result) {
    assert.deepEqual(Object.keys(card).sort(), [
      'id',
      'imageUrl',
      'name',
      'nameAr',
      'slug',
      'sortOrder',
      'subCategories',
    ]);
    // Lowercase Prisma back-relation is not on the wire.
    assert.equal(
      (card as unknown as Record<string, unknown>).subcategories,
      undefined,
    );
    assert.ok(Array.isArray(card.subCategories));
  }
  assert.equal(result[0].imageUrl, getCategoryImageUrl('dairy'));

  // Subcategory contents + image resolution.
  assert.equal(result[0].subCategories.length, 2);
  assert.equal(result[0].subCategories[0].id, 'sub_1');
  assert.equal(result[0].subCategories[0].imageUrl, getCategoryImageUrl('milk'));
  assert.equal(
    result[0].subCategories[1].imageUrl,
    'https://cdn.example.net/Subcategories/cheese.webp',
  );

  // Empty case → `[]`, category still returned.
  assert.deepEqual(result[1].subCategories, []);
});

// ── Product cards (all-products path) ────────────────────────────────
test('listProductCardsForHome: correct where/orderBy/select/pagination + card-only DTO', async () => {
  const calls: Call[] = [];
  const restoreFind = stub(calls, 'product', 'findMany', () => [
    productRow(),
    productRow({ id: 'p2', sku: 'SKU-2', stock: 5, reserved: 5 }),
  ]);
  const restoreCount = stub(calls, 'product', 'count', () => 42);
  let result;
  try {
    result = await listProductCardsForHome({
      page: 1,
      limit: 20,
      excludeHiddenFromHome: true,
    });
  } finally {
    restoreFind();
    restoreCount();
  }
  const findArgs = calls.find((c) => c.method === 'findMany')!.args as {
    where: Record<string, unknown>;
    select: Record<string, unknown>;
    skip: number;
    take: number;
    orderBy: Record<string, unknown>;
    include?: unknown;
  };
  assert.equal(findArgs.where.isActive, true);
  assert.deepEqual(findArgs.where.stock, { gt: 0 });
  assert.equal(findArgs.where.hideFromHome, false);
  assert.equal((findArgs.where as Record<string, unknown>).isFeatured, undefined);
  assert.equal(findArgs.skip, 0);
  assert.equal(findArgs.take, 20);
  assert.deepEqual(findArgs.orderBy, { createdAt: 'desc' });
  assert.equal(findArgs.include, undefined, 'must not use include');
  assert.deepEqual(Object.keys(findArgs.select).sort(), [
    'id',
    'isActive',
    'name',
    'nameAr',
    'price',
    'reserved',
    'sku',
    'stock',
  ]);
  const forbiddenSelect = [
    'category',
    'subcategory',
    'brand',
    'variants',
    'description',
    'descriptionAr',
    'createdAt',
    'updatedAt',
    'hideFromHome',
    'isFeatured',
    'barcode',
  ];
  for (const key of forbiddenSelect) {
    assert.equal(
      (findArgs.select as Record<string, unknown>)[key],
      undefined,
      `product select leaked forbidden key: ${key}`,
    );
  }
  assert.equal(result.total, 42);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].available, true);
  // Fully reserved product → available: false.
  assert.equal(result.items[1].available, false);
  for (const card of result.items) {
    assert.deepEqual(Object.keys(card).sort(), [
      'available',
      'id',
      'imageUrl',
      'name',
      'nameAr',
      'price',
      'sku',
    ]);
  }
  assert.equal(result.items[0].price, new Prisma.Decimal('6.50').toString());
  assert.equal(result.items[0].imageUrl, getProductImageUrl('ALM-MLK-1L'));
});

test('listProductCardsForHome: pagination math skips (page-1)*limit rows', async () => {
  const calls: Call[] = [];
  const restoreFind = stub(calls, 'product', 'findMany', () => []);
  const restoreCount = stub(calls, 'product', 'count', () => 0);
  try {
    await listProductCardsForHome({ page: 3, limit: 15 });
  } finally {
    restoreFind();
    restoreCount();
  }
  const findArgs = calls.find((c) => c.method === 'findMany')!.args as {
    skip: number;
    take: number;
  };
  assert.equal(findArgs.skip, 30);
  assert.equal(findArgs.take, 15);
});

// ── Product cards (featured path) — no count query ────────────────────
test('listFeaturedProductCardsForHome: matches getFeaturedProducts filters, NO orderBy, NO count', async () => {
  const calls: Call[] = [];
  const restoreFind = stub(calls, 'product', 'findMany', () => [productRow()]);
  const restoreCount = stub(calls, 'product', 'count', () => 999);
  let result;
  try {
    result = await listFeaturedProductCardsForHome(20);
  } finally {
    restoreFind();
    restoreCount();
  }
  const findManyCalls = calls.filter((c) => c.method === 'findMany');
  const countCalls = calls.filter((c) => c.method === 'count');
  assert.equal(findManyCalls.length, 1);
  assert.equal(countCalls.length, 0, 'featured path must not run a count query');
  const findArgs = findManyCalls[0].args as {
    where: Record<string, unknown>;
    take: number;
    orderBy?: unknown;
    include?: unknown;
  };
  assert.equal(findArgs.where.isActive, true);
  assert.equal(findArgs.where.isFeatured, true);
  assert.deepEqual(findArgs.where.stock, { gt: 0 });
  assert.equal(findArgs.take, 20);
  assert.equal(findArgs.orderBy, undefined);
  assert.equal(findArgs.include, undefined);
  // Returns a plain array of cards.
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 1);
  assert.deepEqual(Object.keys(result[0]).sort(), [
    'available',
    'id',
    'imageUrl',
    'name',
    'nameAr',
    'price',
    'sku',
  ]);
});

// ── Featured sections (Approach B — variant-aware availability) ──────
test('listSectionsForHome: SQL pre-filter uses isActive only, JS applies the OR rule', async () => {
  const calls: Call[] = [];
  const restore = stub(calls, 'featuredSection', 'findMany', () => []);
  try {
    await listSectionsForHome();
  } finally {
    restore();
  }
  const args = calls[0].args as {
    where: Record<string, unknown>;
    orderBy: unknown;
    select: {
      items: {
        where: { product: Record<string, unknown> };
        orderBy: unknown;
        select: {
          product: { select: Record<string, unknown> };
        };
      };
    };
    include?: unknown;
  };
  assert.equal(args.where.isActive, true);
  assert.deepEqual(args.orderBy, [{ sortOrder: 'asc' }, { createdAt: 'desc' }]);
  assert.equal(args.include, undefined, 'must use select, not include');
  // Item SQL pre-filter: product.isActive only. Availability finished in JS.
  const itemsWhereProduct = args.select.items.where.product;
  assert.equal(itemsWhereProduct.isActive, true);
  assert.equal(
    (itemsWhereProduct as Record<string, unknown>).stock,
    undefined,
    'the SQL stock filter cannot express the OR-with-variants rule; JS handles it',
  );
  assert.deepEqual(args.select.items.orderBy, { sortOrder: 'asc' });
  // Product select on the item: minimal availability slice + variants (isActive/stock/reserved only).
  const productSelect = args.select.items.select.product.select;
  assert.deepEqual(Object.keys(productSelect).sort(), [
    'id',
    'isActive',
    'name',
    'nameAr',
    'price',
    'reserved',
    'sku',
    'stock',
    'variants',
  ]);
  // Variant sub-select carries only the three availability fields.
  const variantSelect = (productSelect.variants as { select: Record<string, unknown>; where: Record<string, unknown> });
  assert.deepEqual(variantSelect.where, { isActive: true });
  assert.deepEqual(Object.keys(variantSelect.select).sort(), [
    'isActive',
    'reserved',
    'stock',
  ]);
  // Explicitly no relations that would leak into the DTO.
  for (const key of ['category', 'subcategory', 'brand', 'description']) {
    assert.equal(
      (productSelect as Record<string, unknown>)[key],
      undefined,
      `featured-section product select leaked forbidden key: ${key}`,
    );
  }
});

test('listSectionsForHome: product with stock=10, reserved=10 is EXCLUDED (no variant fallback)', async () => {
  const sections = [{
    id: 's1', name: 'S1', nameAr: 'س١', sortOrder: 1,
    items: [{ product: productRow({ stock: 10, reserved: 10, variants: [] }) }],
  }];
  const restore = stub([], 'featuredSection', 'findMany', () => sections);
  let result;
  try {
    result = await listSectionsForHome();
  } finally {
    restore();
  }
  assert.equal(result.length, 0, 'fully-reserved product must exclude the item AND the section');
});

test('listSectionsForHome: product with stock=10, reserved=9 is INCLUDED', async () => {
  const sections = [{
    id: 's1', name: 'S1', nameAr: 'س١', sortOrder: 1,
    items: [{ product: productRow({ stock: 10, reserved: 9, variants: [] }) }],
  }];
  const restore = stub([], 'featuredSection', 'findMany', () => sections);
  let result;
  try {
    result = await listSectionsForHome();
  } finally {
    restore();
  }
  assert.equal(result.length, 1);
  assert.equal(result[0].products.length, 1);
  assert.equal(result[0].products[0].available, true);
});

test('listSectionsForHome: inactive product is EXCLUDED even with active variants', async () => {
  const sections = [{
    id: 's1', name: 'S1', nameAr: 'س١', sortOrder: 1,
    items: [{
      product: productRow({
        isActive: false,
        variants: [{ isActive: true, stock: 100, reserved: 0 }],
      }),
    }],
  }];
  const restore = stub([], 'featuredSection', 'findMany', () => sections);
  let result;
  try {
    result = await listSectionsForHome();
  } finally {
    restore();
  }
  assert.equal(result.length, 0, 'inactive product must be excluded regardless of variant stock');
});

test('listSectionsForHome (Approach B): variant-only stock product is INCLUDED (legacy fallback preserved)', async () => {
  const sections = [{
    id: 's1', name: 'Legacy', nameAr: 'قديم', sortOrder: 1,
    items: [{
      product: productRow({
        stock: 0,
        reserved: 0,
        variants: [{ isActive: true, stock: 5, reserved: 1 }],
      }),
    }],
  }];
  const restore = stub([], 'featuredSection', 'findMany', () => sections);
  let result;
  try {
    result = await listSectionsForHome();
  } finally {
    restore();
  }
  assert.equal(result.length, 1);
  assert.equal(result[0].products.length, 1);
  assert.equal(
    result[0].products[0].available,
    true,
    'variant-only product must be marked available on the card',
  );
});

test('listSectionsForHome: variant-only product with fully-reserved variants is EXCLUDED', async () => {
  const sections = [{
    id: 's1', name: 'S1', nameAr: 'س١', sortOrder: 1,
    items: [{
      product: productRow({
        stock: 0,
        reserved: 0,
        variants: [{ isActive: true, stock: 5, reserved: 5 }],
      }),
    }],
  }];
  const restore = stub([], 'featuredSection', 'findMany', () => sections);
  let result;
  try {
    result = await listSectionsForHome();
  } finally {
    restore();
  }
  assert.equal(result.length, 0);
});

test('listSectionsForHome: section becomes empty after availability filtering and is REMOVED', async () => {
  const sections = [
    {
      id: 's1', name: 'Keep', nameAr: 'ابقاء', sortOrder: 1,
      items: [{ product: productRow() }],
    },
    {
      id: 's2', name: 'Drop', nameAr: 'حذف', sortOrder: 2,
      items: [{ product: productRow({ stock: 0, reserved: 0, variants: [] }) }],
    },
    {
      id: 's3', name: 'Keep2', nameAr: 'ابقاء2', sortOrder: 3,
      items: [{ product: productRow({ id: 'p3', sku: 'S3' }) }],
    },
  ];
  const restore = stub([], 'featuredSection', 'findMany', () => sections);
  let result;
  try {
    result = await listSectionsForHome();
  } finally {
    restore();
  }
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 's1');
  assert.equal(result[1].id, 's3');
});

test('listSectionsForHome: returned DTO contains NO stock, reserved, variants, or relations', async () => {
  const sections = [{
    id: 's1', name: 'S1', nameAr: 'س١', sortOrder: 1,
    items: [
      { product: productRow() },
      { product: productRow({ id: 'p2', sku: 'S2', stock: 0, reserved: 0, variants: [{ isActive: true, stock: 3, reserved: 0 }] }) },
    ],
  }];
  const restore = stub([], 'featuredSection', 'findMany', () => sections);
  let result;
  try {
    result = await listSectionsForHome();
  } finally {
    restore();
  }
  assert.equal(result[0].products.length, 2);
  for (const card of result[0].products) {
    assert.deepEqual(Object.keys(card).sort(), [
      'available',
      'id',
      'imageUrl',
      'name',
      'nameAr',
      'price',
      'sku',
    ]);
    for (const forbidden of ['stock', 'reserved', 'variants', 'category', 'subcategory', 'brand', 'description', 'isActive']) {
      assert.equal(
        (card as unknown as Record<string, unknown>)[forbidden],
        undefined,
        `card leaked forbidden key: ${forbidden}`,
      );
    }
  }
  assert.deepEqual(Object.keys(result[0]).sort(), [
    'id',
    'name',
    'nameAr',
    'products',
    'sortOrder',
  ]);
});

test('listSectionsForHome: preserves DB item ordering (sortOrder asc from Prisma) verbatim', async () => {
  // Prisma applies the SQL ORDER BY; the JS filter must preserve that order.
  const sections = [{
    id: 's1', name: 'S1', nameAr: 'س١', sortOrder: 1,
    items: [
      { product: productRow({ id: 'p10', sku: 'SKU-10' }) },       // returned in sortOrder position 1
      { product: productRow({ id: 'p20', sku: 'SKU-20' }) },       // position 2
      { product: productRow({ id: 'p30', sku: 'SKU-30', stock: 0, reserved: 0, variants: [] }) }, // position 3 → filtered out
      { product: productRow({ id: 'p40', sku: 'SKU-40' }) },       // position 4
    ],
  }];
  const restore = stub([], 'featuredSection', 'findMany', () => sections);
  let result;
  try {
    result = await listSectionsForHome();
  } finally {
    restore();
  }
  assert.deepEqual(result[0].products.map((p) => p.id), ['p10', 'p20', 'p40']);
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
