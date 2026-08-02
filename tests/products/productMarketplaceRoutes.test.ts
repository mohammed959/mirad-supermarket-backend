/**
 * HTTP smoke tests for the new marketplace POST endpoints:
 *   - POST /api/products/list
 *   - POST /api/products/detail
 *   - POST /api/products/featured
 *   - POST /api/products/search
 *   - POST /api/products/search/suggestions
 *
 * Mounts the real Express `app`, monkey-patches the product service so we
 * exercise real controllers, real `asyncHandler`, real `ok()` envelope,
 * and the real error middleware.
 *
 * Run:
 *   cd backend && npx ts-node --transpile-only tests/products/productMarketplaceRoutes.test.ts
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import app from '../../src/app';
import * as productSvc from '../../src/modules/products/product.service';

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

interface HttpResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}
function request(
  port: number,
  method: string,
  path: string,
  body?: unknown,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path,
        headers: payload
          ? { 'content-type': 'application/json', 'content-length': String(payload.length) }
          : undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
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

// ── Fixtures ─────────────────────────────────────────────────────────
const productFixture = () => ({
  id: 'p1',
  name: 'حليب المراعي', // localized already
  description: null,
  sku: 'ALM-1L',
  barcode: null,
  price: '6.5',
  stock: 10,
  reserved: 0,
  isActive: true,
  isFeatured: false,
  hideFromHome: false,
  imageUrl: null,
  categoryId: 'c1',
  subcategoryId: null,
  brandId: null,
  category: { id: 'c1', name: 'ألبان', slug: 'dairy' },
  subcategory: null,
  brand: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  available: true,
  offer: 0,
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/products/list
// ─────────────────────────────────────────────────────────────────────

test('POST /api/products/list forwards lang to service and returns products+pagination envelope', async () => {
  const replaced: Replaced = [];
  const calls: unknown[] = [];
  try {
    replace(replaced, productSvc, 'listMarketplaceProducts', (opts: unknown) => {
      calls.push(opts);
      return Promise.resolve({
        products: [productFixture()],
        pagination: {
          page: 1, pageSize: 20, totalItems: 1, totalPages: 1,
          hasNextPage: false, hasPreviousPage: false,
          limit: 20, total: 1, pages: 1,
        },
      });
    });
    await withServer(async (port) => {
      const res = await request(port, 'POST', '/api/products/list', {
        lang: 'en',
        page: 1,
        pageSize: 20,
        categoryId: 'c1',
      });
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body) as { success: boolean; data: { products: unknown[]; pagination: unknown } };
      assert.equal(body.success, true);
      assert.equal(body.data.products.length, 1);
      assert.ok(body.data.pagination);
    });
    assert.equal(calls.length, 1);
    const opts = calls[0] as { lang: string; categoryId: string; page: number; limit: number };
    assert.equal(opts.lang, 'en');
    assert.equal(opts.categoryId, 'c1');
    assert.equal(opts.page, 1);
    assert.equal(opts.limit, 20);
  } finally {
    restoreAll(replaced);
  }
});

test('POST /api/products/list defaults lang to "ar" when body missing', async () => {
  const replaced: Replaced = [];
  const calls: unknown[] = [];
  try {
    replace(replaced, productSvc, 'listMarketplaceProducts', (opts: unknown) => {
      calls.push(opts);
      return Promise.resolve({ products: [], pagination: {} });
    });
    await withServer(async (port) => {
      const res = await request(port, 'POST', '/api/products/list');
      assert.equal(res.status, 200);
    });
    assert.equal((calls[0] as { lang: string }).lang, 'ar');
  } finally {
    restoreAll(replaced);
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/products/detail
// ─────────────────────────────────────────────────────────────────────

test('POST /api/products/detail returns 200 with envelope when found', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, productSvc, 'getMarketplaceProduct', () =>
      Promise.resolve(productFixture()),
    );
    await withServer(async (port) => {
      const res = await request(port, 'POST', '/api/products/detail', { id: 'p1', lang: 'ar' });
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body) as { success: boolean; data: { id: string; name: string } };
      assert.equal(body.data.id, 'p1');
      assert.equal(typeof body.data.name, 'string');
    });
  } finally {
    restoreAll(replaced);
  }
});

test('POST /api/products/detail 400 when body has no id', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'POST', '/api/products/detail', {});
    assert.equal(res.status, 400);
  });
});

test('POST /api/products/detail 404 when service returns null', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, productSvc, 'getMarketplaceProduct', () => Promise.resolve(null));
    await withServer(async (port) => {
      const res = await request(port, 'POST', '/api/products/detail', { id: 'nope' });
      assert.equal(res.status, 404);
    });
  } finally {
    restoreAll(replaced);
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/products/featured
// ─────────────────────────────────────────────────────────────────────

test('POST /api/products/featured returns array of MarketplaceProduct', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, productSvc, 'listMarketplaceFeaturedProducts', () =>
      Promise.resolve([productFixture(), productFixture()]),
    );
    await withServer(async (port) => {
      const res = await request(port, 'POST', '/api/products/featured', { lang: 'ar', limit: 5 });
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body) as { data: unknown[] };
      assert.equal(body.data.length, 2);
    });
  } finally {
    restoreAll(replaced);
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/products/search
// ─────────────────────────────────────────────────────────────────────

test('POST /api/products/search returns 400 when q missing', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'POST', '/api/products/search', { lang: 'ar' });
    assert.equal(res.status, 400);
  });
});

test('POST /api/products/search returns products+matchedProductId+pagination', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, productSvc, 'searchMarketplaceProducts', () =>
      Promise.resolve({
        products: [productFixture()],
        matchedProductId: 'p1',
        pagination: {
          page: 1, pageSize: 20, totalItems: 1, totalPages: 1,
          hasNextPage: false, hasPreviousPage: false,
          limit: 20, total: 1, pages: 1,
        },
      }),
    );
    await withServer(async (port) => {
      const res = await request(port, 'POST', '/api/products/search', { q: 'milk', lang: 'en' });
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body) as { data: { products: unknown[]; matchedProductId: string | null } };
      assert.equal(body.data.products.length, 1);
      assert.equal(body.data.matchedProductId, 'p1');
    });
  } finally {
    restoreAll(replaced);
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/products/search/suggestions
// ─────────────────────────────────────────────────────────────────────

test('POST /api/products/search/suggestions returns 400 when q missing', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'POST', '/api/products/search/suggestions', {});
    assert.equal(res.status, 400);
  });
});

test('POST /api/products/search/suggestions returns [{id,name,sku,imageUrl}]', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, productSvc, 'marketplaceSearchSuggestions', () =>
      Promise.resolve([
        { id: 's1', name: 'حليب', sku: null, imageUrl: null, offer: 0 },
      ]),
    );
    await withServer(async (port) => {
      const res = await request(port, 'POST', '/api/products/search/suggestions', { q: 'حل', lang: 'ar' });
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body) as { data: Array<Record<string, unknown>> };
      assert.deepEqual(Object.keys(body.data[0]).sort(), ['id', 'imageUrl', 'name', 'offer', 'sku']);
      // No nameAr on the wire.
      assert.equal(body.data[0].nameAr, undefined);
      assert.equal(body.data[0].offer, 0);
    });
  } finally {
    restoreAll(replaced);
  }
});

// ─────────────────────────────────────────────────────────────────────
// Legacy GET endpoints remain reachable (admin backward compat)
// ─────────────────────────────────────────────────────────────────────

test('GET /api/products still works (kept for admin backward compat)', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, productSvc, 'listProducts', () =>
      Promise.resolve({ products: [], pagination: {} }),
    );
    await withServer(async (port) => {
      const res = await request(port, 'GET', '/api/products');
      assert.equal(res.status, 200);
    });
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
