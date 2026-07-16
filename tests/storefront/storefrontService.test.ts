/**
 * Step 3 behavioural tests for the storefront home aggregation service.
 *
 * The aggregator uses namespace imports (`import * as x from 'y'`) so
 * mutations to the shared CommonJS module exports are visible at call
 * time. That lets these tests replace individual read functions with
 * spies / deferred promises without introducing a DI framework.
 *
 * Run:
 *   cd backend && npx ts-node --transpile-only tests/storefront/storefrontService.test.ts
 */

import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';

import { prisma } from '../../src/lib/prisma';

import * as categorySvc from '../../src/modules/categories/category.service';
import * as bannerSvc from '../../src/modules/banners/banner.service';
import * as productSvc from '../../src/modules/products/product.service';
import * as sectionSvc from '../../src/modules/featured-sections/featuredSection.service';
import * as settingsSvc from '../../src/modules/settings/settings.service';

// Personal modules that MUST NOT be touched by the aggregator.
import * as orderSvc from '../../src/modules/orders/order.service';
import * as favoriteSvc from '../../src/modules/favorites/favorite.service';
import * as subscriptionSvc from '../../src/modules/subscriptions/subscription.service';
import * as addressSvc from '../../src/modules/addresses/address.service';
import * as deliverySvc from '../../src/modules/delivery/delivery.service';

import { getStorefrontHome } from '../../src/modules/storefront/storefront.service';

// ── Tiny in-file test harness ────────────────────────────────────────
const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

// ── Restore book-keeping ─────────────────────────────────────────────
// Each test snapshots which functions it replaced and restores them
// in `finally`, so tests are order-independent.
type Replaced = Array<{ mod: object; key: string; original: unknown }>;
function replace<T extends object>(
  replaced: Replaced,
  mod: T,
  key: keyof T,
  value: unknown,
): void {
  const target = mod as Record<string, unknown>;
  replaced.push({ mod: mod as unknown as object, key: key as string, original: target[key as string] });
  target[key as string] = value;
}
function restoreAll(replaced: Replaced): void {
  for (const { mod, key, original } of replaced) {
    (mod as Record<string, unknown>)[key] = original;
  }
}

// ── Deferred promise helper ──────────────────────────────────────────
function defer<T = unknown>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// A short synchronous yield — schedules a microtask so `Promise.all`
// registrations run before we inspect spy state.
const flushMicrotasks = async () => {
  for (let i = 0; i < 3; i += 1) await Promise.resolve();
};

// ── Fixtures ─────────────────────────────────────────────────────────
const card = (id: string) => ({
  id,
  name: `p-${id}`,
  nameAr: `س-${id}`,
  sku: `SKU-${id}`,
  imageUrl: `https://cdn.example/products/${id}.png`,
  price: '1.0',
  available: true,
});

const cats = () => [
  { id: 'c1', name: 'Dairy', nameAr: 'ألبان', slug: 'dairy', imageUrl: 'x', sortOrder: 1 },
];

const bannerRows = () => [
  {
    id: 'b1',
    title: 'Sale',
    titleAr: 'تخفيض',
    imageUrl: 'https://cdn.example/banners/b1.png',
    linkType: 'category',
    linkValue: 'c1',
    sortOrder: 1,
  },
];

const sections = () => [
  { id: 's1', name: 'New', nameAr: 'جديد', sortOrder: 1, products: [card('p1')] },
];

// ── 1. Stage 1 concurrency ───────────────────────────────────────────
test('all five Stage 1 reads begin before any of them resolves', async () => {
  const replaced: Replaced = [];
  const called: Record<string, boolean> = {};
  const deferreds: Record<string, ReturnType<typeof defer>> = {
    categories: defer(),
    banners: defer(),
    featured: defer(),
    sections: defer(),
    settings: defer(),
  };
  try {
    replace(replaced, categorySvc, 'getHomepageCategories', () => {
      called.categories = true;
      return deferreds.categories.promise;
    });
    replace(replaced, bannerSvc, 'listBanners', () => {
      called.banners = true;
      return deferreds.banners.promise;
    });
    replace(replaced, productSvc, 'listFeaturedProductCardsForHome', () => {
      called.featured = true;
      return deferreds.featured.promise;
    });
    replace(replaced, sectionSvc, 'listSectionsForHome', () => {
      called.sections = true;
      return deferreds.sections.promise;
    });
    replace(replaced, settingsSvc, 'getHomeSettings', () => {
      called.settings = true;
      return deferreds.settings.promise;
    });
    // Stage 2 stub — must not be invoked before Stage 1 completes.
    let allProductsCalled = false;
    replace(replaced, productSvc, 'listProductCardsForHome', () => {
      allProductsCalled = true;
      return Promise.resolve({ items: [], total: 0 });
    });

    const p = getStorefrontHome();
    await flushMicrotasks();

    // All five Stage 1 stubs were invoked while none has resolved.
    assert.deepEqual(
      { ...called },
      { categories: true, banners: true, featured: true, sections: true, settings: true },
      'every Stage 1 read must start before any resolves',
    );
    // Stage 2 must not have started yet.
    assert.equal(allProductsCalled, false, 'Stage 2 must not begin during Stage 1');

    // Resolve Stage 1 with fixtures.
    deferreds.categories.resolve(cats());
    deferreds.banners.resolve(bannerRows());
    deferreds.featured.resolve([card('f1')]);
    deferreds.sections.resolve(sections());
    deferreds.settings.resolve({ allProductsLimit: 20 });

    const aggregate = await p;
    assert.ok(aggregate);
    assert.equal(allProductsCalled, true, 'Stage 2 must have run after Stage 1 resolved');
  } finally {
    restoreAll(replaced);
  }
});

// ── 2. Stage 2 depends on Home Settings ──────────────────────────────
test('all-products query does not begin until Home Settings resolves', async () => {
  const replaced: Replaced = [];
  const settingsDeferred = defer<{ allProductsLimit: number }>();
  let allProductsCalledAt: 'before' | 'after' | 'never' = 'never';
  try {
    replace(replaced, categorySvc, 'getHomepageCategories', () => Promise.resolve(cats()));
    replace(replaced, bannerSvc, 'listBanners', () => Promise.resolve(bannerRows()));
    replace(replaced, productSvc, 'listFeaturedProductCardsForHome', () => Promise.resolve([]));
    replace(replaced, sectionSvc, 'listSectionsForHome', () => Promise.resolve([]));
    replace(replaced, settingsSvc, 'getHomeSettings', () => settingsDeferred.promise);

    let settingsResolved = false;
    replace(replaced, productSvc, 'listProductCardsForHome', () => {
      allProductsCalledAt = settingsResolved ? 'after' : 'before';
      return Promise.resolve({ items: [], total: 0 });
    });

    const p = getStorefrontHome();
    await flushMicrotasks();
    assert.equal(allProductsCalledAt, 'never', 'all-products must not start before settings resolves');

    settingsResolved = true;
    settingsDeferred.resolve({ allProductsLimit: 20 });

    await p;
    assert.equal(allProductsCalledAt, 'after', 'all-products must start AFTER Home Settings resolves');
  } finally {
    restoreAll(replaced);
  }
});

// ── 3. Page size derived from Home Settings ──────────────────────────
test('all-products read uses page size derived from Home Settings.allProductsLimit', async () => {
  const replaced: Replaced = [];
  let allProductsArgs: unknown;
  try {
    replace(replaced, categorySvc, 'getHomepageCategories', () => Promise.resolve(cats()));
    replace(replaced, bannerSvc, 'listBanners', () => Promise.resolve(bannerRows()));
    replace(replaced, productSvc, 'listFeaturedProductCardsForHome', () => Promise.resolve([]));
    replace(replaced, sectionSvc, 'listSectionsForHome', () => Promise.resolve([]));
    replace(replaced, settingsSvc, 'getHomeSettings', () => Promise.resolve({ allProductsLimit: 33 }));
    replace(replaced, productSvc, 'listProductCardsForHome', (args: unknown) => {
      allProductsArgs = args;
      return Promise.resolve({ items: [], total: 0 });
    });

    await getStorefrontHome();
    assert.deepEqual(allProductsArgs, {
      page: 1,
      limit: 33,
      excludeHiddenFromHome: true,
    });
  } finally {
    restoreAll(replaced);
  }
});

test('resolveAllProductsLimit: invalid stored values fall back to default (20) without silently changing valid values', async () => {
  const cases: Array<[unknown, number]> = [
    [20, 20],
    [1, 1],
    [100, 100],
    [50, 50],
    [0, 20],
    [-5, 20],
    [Number.NaN, 20],
    [Number.POSITIVE_INFINITY, 20],
    [1.5, 20],
    [null, 20],
    [undefined, 20],
    ['20' as unknown as number, 20],
    [200, 100], // over-max clamps to max — matches ALL_PRODUCTS_LIMIT_MAX = 100
  ];
  for (const [stored, expectedLimit] of cases) {
    const replaced: Replaced = [];
    let observedLimit = -1;
    try {
      replace(replaced, categorySvc, 'getHomepageCategories', () => Promise.resolve(cats()));
      replace(replaced, bannerSvc, 'listBanners', () => Promise.resolve(bannerRows()));
      replace(replaced, productSvc, 'listFeaturedProductCardsForHome', () => Promise.resolve([]));
      replace(replaced, sectionSvc, 'listSectionsForHome', () => Promise.resolve([]));
      replace(replaced, settingsSvc, 'getHomeSettings', () =>
        Promise.resolve({ allProductsLimit: stored }),
      );
      replace(replaced, productSvc, 'listProductCardsForHome', (args: { limit: number }) => {
        observedLimit = args.limit;
        return Promise.resolve({ items: [], total: 0 });
      });
      await getStorefrontHome();
      assert.equal(observedLimit, expectedLimit, `stored ${String(stored)} → limit ${expectedLimit}`);
    } finally {
      restoreAll(replaced);
    }
  }
});

// ── 4. Aggregate shape and values ────────────────────────────────────
test('final aggregate contains correct fields and values sourced from the underlying services', async () => {
  const replaced: Replaced = [];
  try {
    const catFixture = cats();
    const bannerFixture = bannerRows();
    const featuredFixture = [card('f1'), card('f2')];
    const sectionsFixture = sections();
    replace(replaced, categorySvc, 'getHomepageCategories', () => Promise.resolve(catFixture));
    replace(replaced, bannerSvc, 'listBanners', () => Promise.resolve(bannerFixture));
    replace(replaced, productSvc, 'listFeaturedProductCardsForHome', () => Promise.resolve(featuredFixture));
    replace(replaced, sectionSvc, 'listSectionsForHome', () => Promise.resolve(sectionsFixture));
    replace(replaced, settingsSvc, 'getHomeSettings', () => Promise.resolve({ allProductsLimit: 3 }));
    replace(replaced, productSvc, 'listProductCardsForHome', () =>
      Promise.resolve({ items: [card('a1'), card('a2'), card('a3')], total: 7 }),
    );

    const agg = await getStorefrontHome();
    assert.deepEqual(Object.keys(agg).sort(), [
      'allProducts',
      'banners',
      'categories',
      'featuredProducts',
      'featuredSections',
    ]);
    assert.equal(agg.categories, catFixture);
    assert.equal(agg.featuredProducts, featuredFixture);
    assert.equal(agg.featuredSections, sectionsFixture);
    assert.equal(agg.banners.length, bannerFixture.length);
    assert.deepEqual(Object.keys(agg.banners[0]).sort(), [
      'id',
      'imageUrl',
      'linkType',
      'linkValue',
      'sortOrder',
      'title',
      'titleAr',
    ]);
    assert.equal(agg.allProducts.items.length, 3);
    // 7 total, 3 returned → hasMore true.
    assert.equal(agg.allProducts.hasMore, true);
  } finally {
    restoreAll(replaced);
  }
});

test('hasMore is false when all-products total equals items length', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, categorySvc, 'getHomepageCategories', () => Promise.resolve([]));
    replace(replaced, bannerSvc, 'listBanners', () => Promise.resolve([]));
    replace(replaced, productSvc, 'listFeaturedProductCardsForHome', () => Promise.resolve([]));
    replace(replaced, sectionSvc, 'listSectionsForHome', () => Promise.resolve([]));
    replace(replaced, settingsSvc, 'getHomeSettings', () => Promise.resolve({ allProductsLimit: 20 }));
    replace(replaced, productSvc, 'listProductCardsForHome', () =>
      Promise.resolve({ items: [card('a1'), card('a2')], total: 2 }),
    );
    const agg = await getStorefrontHome();
    assert.equal(agg.allProducts.hasMore, false);
  } finally {
    restoreAll(replaced);
  }
});

// ── 5. Personal / gate reads are NOT called ──────────────────────────
test('aggregator never invokes personal or gate services', async () => {
  const replaced: Replaced = [];
  const forbidden: string[] = [];
  const trip = (name: string) => (...args: unknown[]) => {
    void args;
    forbidden.push(name);
    return Promise.reject(new Error(`forbidden call: ${name}`));
  };
  try {
    // Boobytrap every likely personal / gate export.
    replace(replaced, orderSvc, 'getBuyAgainProducts', trip('order.getBuyAgainProducts'));
    replace(replaced, favoriteSvc, 'listFavorites', trip('favorite.listFavorites'));
    if ((favoriteSvc as Record<string, unknown>).listFavoriteIds !== undefined) {
      replace(replaced, favoriteSvc, 'listFavoriteIds', trip('favorite.listFavoriteIds'));
    }
    replace(replaced, subscriptionSvc, 'getActiveSubscription', trip('subscription.getActiveSubscription'));
    replace(replaced, addressSvc, 'listAddresses', trip('address.listAddresses'));
    replace(replaced, deliverySvc, 'getBranch', trip('delivery.getBranch'));
    replace(replaced, deliverySvc, 'quoteDelivery', trip('delivery.quoteDelivery'));

    // Stub Stage 1 + Stage 2 with benign fixtures.
    replace(replaced, categorySvc, 'getHomepageCategories', () => Promise.resolve(cats()));
    replace(replaced, bannerSvc, 'listBanners', () => Promise.resolve(bannerRows()));
    replace(replaced, productSvc, 'listFeaturedProductCardsForHome', () => Promise.resolve([]));
    replace(replaced, sectionSvc, 'listSectionsForHome', () => Promise.resolve([]));
    replace(replaced, settingsSvc, 'getHomeSettings', () => Promise.resolve({ allProductsLimit: 20 }));
    replace(replaced, productSvc, 'listProductCardsForHome', () =>
      Promise.resolve({ items: [], total: 0 }),
    );

    await getStorefrontHome();
    assert.deepEqual(forbidden, [], `aggregator called personal endpoints: ${forbidden.join(', ')}`);
  } finally {
    restoreAll(replaced);
  }
});

// ── 6. Stage 1 rejection prevents Stage 2 ────────────────────────────
test('a Stage 1 rejection prevents Stage 2 (all-products) from running', async () => {
  const replaced: Replaced = [];
  let allProductsCalled = false;
  try {
    replace(replaced, categorySvc, 'getHomepageCategories', () =>
      Promise.reject(new Error('categories exploded')),
    );
    replace(replaced, bannerSvc, 'listBanners', () => Promise.resolve(bannerRows()));
    replace(replaced, productSvc, 'listFeaturedProductCardsForHome', () => Promise.resolve([]));
    replace(replaced, sectionSvc, 'listSectionsForHome', () => Promise.resolve([]));
    replace(replaced, settingsSvc, 'getHomeSettings', () =>
      Promise.resolve({ allProductsLimit: 20 }),
    );
    replace(replaced, productSvc, 'listProductCardsForHome', () => {
      allProductsCalled = true;
      return Promise.resolve({ items: [], total: 0 });
    });

    let thrown: Error | undefined;
    try {
      await getStorefrontHome();
    } catch (e) {
      thrown = e as Error;
    }
    assert.ok(thrown, 'aggregator must reject when a Stage 1 read rejects');
    assert.equal(thrown!.message, 'categories exploded');
    assert.equal(allProductsCalled, false, 'Stage 2 must not run after a Stage 1 rejection');
  } finally {
    restoreAll(replaced);
  }
});

// ── 7. All-products rejection propagates ─────────────────────────────
test('an all-products rejection propagates unchanged', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, categorySvc, 'getHomepageCategories', () => Promise.resolve(cats()));
    replace(replaced, bannerSvc, 'listBanners', () => Promise.resolve(bannerRows()));
    replace(replaced, productSvc, 'listFeaturedProductCardsForHome', () => Promise.resolve([]));
    replace(replaced, sectionSvc, 'listSectionsForHome', () => Promise.resolve([]));
    replace(replaced, settingsSvc, 'getHomeSettings', () =>
      Promise.resolve({ allProductsLimit: 20 }),
    );
    replace(replaced, productSvc, 'listProductCardsForHome', () =>
      Promise.reject(new Error('all-products exploded')),
    );

    let thrown: Error | undefined;
    try {
      await getStorefrontHome();
    } catch (e) {
      thrown = e as Error;
    }
    assert.ok(thrown);
    assert.equal(thrown!.message, 'all-products exploded');
  } finally {
    restoreAll(replaced);
  }
});

// ── 8. No direct Prisma calls from the aggregator ────────────────────
test('aggregator never touches Prisma directly — every DB access is proxied through a service', async () => {
  const replaced: Replaced = [];
  const trippedPrisma: string[] = [];
  const boomFactory = (name: string) => (() => {
    trippedPrisma.push(name);
    return Promise.reject(new Error(`aggregator called Prisma.${name} directly`));
  });
  try {
    // Boobytrap every Prisma delegate the storefront reads could touch.
    // If the aggregator has an inline Prisma query, one of these fires.
    replace(replaced, prisma.category, 'findMany', boomFactory('category.findMany'));
    replace(replaced, prisma.banner, 'findMany', boomFactory('banner.findMany'));
    replace(replaced, prisma.product, 'findMany', boomFactory('product.findMany'));
    replace(replaced, prisma.product, 'count', boomFactory('product.count'));
    replace(replaced, prisma.featuredSection, 'findMany', boomFactory('featuredSection.findMany'));
    replace(replaced, prisma.homeSettings, 'findFirst', boomFactory('homeSettings.findFirst'));
    replace(replaced, prisma.homeSettings, 'create', boomFactory('homeSettings.create'));

    // Stub every service — the aggregator should never fall through to Prisma.
    replace(replaced, categorySvc, 'getHomepageCategories', () => Promise.resolve(cats()));
    replace(replaced, bannerSvc, 'listBanners', () => Promise.resolve(bannerRows()));
    replace(replaced, productSvc, 'listFeaturedProductCardsForHome', () => Promise.resolve([]));
    replace(replaced, sectionSvc, 'listSectionsForHome', () => Promise.resolve([]));
    replace(replaced, settingsSvc, 'getHomeSettings', () =>
      Promise.resolve({ allProductsLimit: 20 }),
    );
    replace(replaced, productSvc, 'listProductCardsForHome', () =>
      Promise.resolve({ items: [], total: 0 }),
    );

    await getStorefrontHome();
    assert.deepEqual(trippedPrisma, [], `aggregator issued direct Prisma calls: ${trippedPrisma.join(', ')}`);
  } finally {
    restoreAll(replaced);
  }
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
  // Sanity: `Prisma` is imported to guarantee the runtime binding is
  // loaded even if unused in assertions, so the smoke test above works
  // in isolation.
  void Prisma;
  process.exit(failed > 0 ? 1 : 0);
})();
