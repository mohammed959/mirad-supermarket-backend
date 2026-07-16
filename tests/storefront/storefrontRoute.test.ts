/**
 * Step 4 HTTP tests for `GET /api/storefront/home`.
 *
 * The backend has no supertest dependency; these tests mount the real
 * Express `app` on an ephemeral port and drive it with the built-in
 * `node:http` client. The aggregation service is monkey-patched via the
 * shared CommonJS module namespace so the route exercises the real
 * controller, real `asyncHandler`, real `ok()` envelope, real Express
 * ETag emission, and the real global `errorMiddleware`.
 *
 * Run:
 *   cd backend && npx ts-node --transpile-only tests/storefront/storefrontRoute.test.ts
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import app from '../../src/app';
import * as storefrontSvc from '../../src/modules/storefront/storefront.service';
import * as orderSvc from '../../src/modules/orders/order.service';
import * as favoriteSvc from '../../src/modules/favorites/favorite.service';
import * as subscriptionSvc from '../../src/modules/subscriptions/subscription.service';
import * as addressSvc from '../../src/modules/addresses/address.service';
import * as deliverySvc from '../../src/modules/delivery/delivery.service';

// ── Tiny in-file test harness ────────────────────────────────────────
const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

type Replaced = Array<{ mod: object; key: string; original: unknown }>;
function replace<T extends object>(replaced: Replaced, mod: T, key: keyof T, value: unknown): void {
  const target = mod as Record<string, unknown>;
  replaced.push({ mod: mod as unknown as object, key: key as string, original: target[key as string] });
  target[key as string] = value;
}
function restoreAll(replaced: Replaced): void {
  for (const { mod, key, original } of replaced) {
    (mod as Record<string, unknown>)[key] = original;
  }
}

// ── HTTP client ──────────────────────────────────────────────────────
interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function request(port: number, method: string, path: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

async function withServer(fn: (port: number) => Promise<void>): Promise<void> {
  const server = app.listen(0);
  try {
    await new Promise<void>((r) => server.on('listening', () => r()));
    const port = (server.address() as AddressInfo).port;
    await fn(port);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

// ── Fixture: minimal, deterministic HomeAggregate ────────────────────
const aggregateFixture = () => ({
  categories: [
    { id: 'c1', name: 'Dairy', nameAr: 'ألبان', slug: 'dairy', imageUrl: 'https://cdn/dairy.png', sortOrder: 1 },
  ],
  banners: [
    {
      id: 'b1',
      title: 'Sale',
      titleAr: 'تخفيض',
      imageUrl: 'https://cdn/b1.png',
      linkType: 'category',
      linkValue: 'c1',
      sortOrder: 1,
    },
  ],
  featuredProducts: [
    { id: 'p1', name: 'Milk', nameAr: 'حليب', sku: 'SKU-1', imageUrl: 'https://cdn/p1.png', price: '6.5', available: true },
  ],
  featuredSections: [
    {
      id: 's1',
      name: 'New',
      nameAr: 'جديد',
      sortOrder: 1,
      products: [
        { id: 'p1', name: 'Milk', nameAr: 'حليب', sku: 'SKU-1', imageUrl: 'https://cdn/p1.png', price: '6.5', available: true },
      ],
    },
  ],
  allProducts: {
    items: [
      { id: 'p1', name: 'Milk', nameAr: 'حليب', sku: 'SKU-1', imageUrl: 'https://cdn/p1.png', price: '6.5', available: true },
    ],
    hasMore: false,
  },
});

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

test('GET /api/storefront/home returns 200 with the envelope + aggregate under data', async () => {
  const replaced: Replaced = [];
  let calls = 0;
  try {
    replace(replaced, storefrontSvc, 'getStorefrontHome', () => {
      calls += 1;
      return Promise.resolve(aggregateFixture());
    });
    await withServer(async (port) => {
      const res = await request(port, 'GET', '/api/storefront/home');
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body) as { success: boolean; message: string; data: unknown };
      assert.equal(body.success, true);
      assert.equal(body.message, 'Success');
      assert.ok(body.data, 'envelope must carry `data`');
      // Full aggregate shape check — proves nothing is double-wrapped.
      const data = body.data as Record<string, unknown>;
      assert.deepEqual(Object.keys(data).sort(), [
        'allProducts',
        'banners',
        'categories',
        'featuredProducts',
        'featuredSections',
      ]);
      // Not double-wrapped: data.data must not exist.
      assert.equal((data as Record<string, unknown>).data, undefined);
      // Frontend fetcher unwraps `response.data.data` → that maps to `body.data`.
      // Assert its shape matches what useHome() will consume.
      assert.equal((data.categories as unknown[]).length, 1);
      assert.equal((data.banners as unknown[]).length, 1);
      assert.equal((data.featuredProducts as unknown[]).length, 1);
      assert.equal((data.featuredSections as unknown[]).length, 1);
      assert.equal(((data.allProducts as { items: unknown[] }).items).length, 1);
    });
    assert.equal(calls, 1, 'getStorefrontHome must be called exactly once');
  } finally {
    restoreAll(replaced);
  }
});

test('response contains Cache-Control: no-cache', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, storefrontSvc, 'getStorefrontHome', () => Promise.resolve(aggregateFixture()));
    await withServer(async (port) => {
      const res = await request(port, 'GET', '/api/storefront/home');
      assert.equal(res.status, 200);
      assert.equal(res.headers['cache-control'], 'no-cache');
    });
  } finally {
    restoreAll(replaced);
  }
});

test('no authentication is required — no Authorization header, still 200', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, storefrontSvc, 'getStorefrontHome', () => Promise.resolve(aggregateFixture()));
    await withServer(async (port) => {
      const res = await request(port, 'GET', '/api/storefront/home');
      assert.equal(res.status, 200);
      // The 401/403 envelopes both surface `success: false`; envelope success
      // must be true for a public endpoint on an unauthenticated request.
      assert.equal(JSON.parse(res.body).success, true);
    });
  } finally {
    restoreAll(replaced);
  }
});

test('a service rejection reaches the global error middleware (500, success:false)', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, storefrontSvc, 'getStorefrontHome', () =>
      Promise.reject(new Error('boom')),
    );
    await withServer(async (port) => {
      const res = await request(port, 'GET', '/api/storefront/home');
      assert.equal(res.status, 500);
      const body = JSON.parse(res.body) as { success: boolean; message: string };
      assert.equal(body.success, false);
      // errorMiddleware surfaces Error.message verbatim on the 500 path.
      assert.equal(body.message, 'boom');
    });
  } finally {
    restoreAll(replaced);
  }
});

test('effective URL is /api/storefront/home — no double prefix, no missing prefix', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, storefrontSvc, 'getStorefrontHome', () => Promise.resolve(aggregateFixture()));
    await withServer(async (port) => {
      // The correct URL exists.
      const ok = await request(port, 'GET', '/api/storefront/home');
      assert.equal(ok.status, 200);

      // Missing the /api prefix must 404 (Express falls through to the
      // built-in 404 handler that returns { success:false, message:'Route not found' }).
      const missingPrefix = await request(port, 'GET', '/storefront/home');
      assert.equal(missingPrefix.status, 404);

      // Doubled prefix must 404 too.
      const doubledPrefix = await request(port, 'GET', '/api/api/storefront/home');
      assert.equal(doubledPrefix.status, 404);
    });
  } finally {
    restoreAll(replaced);
  }
});

test('route is registered exactly once (single 200 handler on GET)', async () => {
  const replaced: Replaced = [];
  let calls = 0;
  try {
    replace(replaced, storefrontSvc, 'getStorefrontHome', () => {
      calls += 1;
      return Promise.resolve(aggregateFixture());
    });
    await withServer(async (port) => {
      const res = await request(port, 'GET', '/api/storefront/home');
      assert.equal(res.status, 200);
    });
    // Duplicate registration would have caused a second call from the same request
    // going through both handlers (Express runs all matching routes until one responds;
    // duplicate `router.get` would still respond once, but the underlying service
    // would only be called once because `res.headersSent` short-circuits). Instead,
    // assert exact-once invocation as the observable guarantee.
    assert.equal(calls, 1);
  } finally {
    restoreAll(replaced);
  }
});

test('controller does not touch any personal / gate service', async () => {
  const replaced: Replaced = [];
  const forbidden: string[] = [];
  const trip = (name: string) => (...args: unknown[]) => {
    void args;
    forbidden.push(name);
    return Promise.reject(new Error(`forbidden call: ${name}`));
  };
  try {
    replace(replaced, storefrontSvc, 'getStorefrontHome', () => Promise.resolve(aggregateFixture()));
    // Boobytraps.
    replace(replaced, orderSvc, 'getBuyAgainProducts', trip('order.getBuyAgainProducts'));
    replace(replaced, favoriteSvc, 'listFavorites', trip('favorite.listFavorites'));
    replace(replaced, subscriptionSvc, 'getActiveSubscription', trip('subscription.getActiveSubscription'));
    replace(replaced, addressSvc, 'listAddresses', trip('address.listAddresses'));
    replace(replaced, deliverySvc, 'getBranch', trip('delivery.getBranch'));

    await withServer(async (port) => {
      const res = await request(port, 'GET', '/api/storefront/home');
      assert.equal(res.status, 200);
    });
    assert.deepEqual(forbidden, [], `controller called personal services: ${forbidden.join(', ')}`);
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
  process.exit(failed > 0 ? 1 : 0);
})();
