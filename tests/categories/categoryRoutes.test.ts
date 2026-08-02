/**
 * HTTP tests for the /api/categories endpoints reshaped in this change:
 *   - `POST /api/categories/list` — public, `{ lang }` body, stripped shape.
 *   - `GET  /api/categories/admin` — staff-authenticated, full historical shape.
 *   - old `GET /api/categories` — removed; must 404.
 *
 * No supertest dependency; mounts the real Express `app` on an ephemeral
 * port and drives it with `node:http`. The service module is monkey-
 * patched via the CommonJS namespace so the routes exercise the real
 * controllers, `asyncHandler`, `ok()` envelope, and error middleware.
 *
 * Run:
 *   cd backend && npx ts-node --transpile-only tests/categories/categoryRoutes.test.ts
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import app from '../../src/app';
import * as categorySvc from '../../src/modules/categories/category.service';

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
          ? {
              'content-type': 'application/json',
              'content-length': String(payload.length),
            }
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
const marketplaceFixture = () => [
  { id: 'c1', name: 'ألبان', slug: 'dairy', imageUrl: 'https://cdn/dairy.png', sortOrder: 1 },
  { id: 'c2', name: 'وجبات', slug: 'snacks', imageUrl: 'https://cdn/snacks.png', sortOrder: 2 },
];

// ─────────────────────────────────────────────────────────────────────
// POST /api/categories/list
// ─────────────────────────────────────────────────────────────────────

test('POST /api/categories/list returns 200 with envelope + stripped cards', async () => {
  const replaced: Replaced = [];
  const observedLangs: unknown[] = [];
  try {
    replace(replaced, categorySvc, 'listMarketplaceCategories', (lang?: unknown) => {
      observedLangs.push(lang);
      return Promise.resolve(marketplaceFixture());
    });
    await withServer(async (port) => {
      const res = await request(port, 'POST', '/api/categories/list', { lang: 'ar' });
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body) as {
        success: boolean;
        message: string;
        data: Array<Record<string, unknown>>;
      };
      assert.equal(body.success, true);
      assert.ok(Array.isArray(body.data));
      assert.equal(body.data.length, 2);
      for (const card of body.data) {
        assert.deepEqual(Object.keys(card).sort(), [
          'id',
          'imageUrl',
          'name',
          'slug',
          'sortOrder',
        ]);
        assert.equal(card.nameAr, undefined);
        assert.equal(card.subcategories, undefined);
        assert.equal(card.showOnHome, undefined);
        assert.equal(card.isActive, undefined);
        assert.equal(card.createdAt, undefined);
        assert.equal(card.updatedAt, undefined);
      }
    });
    assert.deepEqual(observedLangs, ['ar']);
  } finally {
    restoreAll(replaced);
  }
});

test('POST /api/categories/list with lang="en" forwards "en" to the service', async () => {
  const replaced: Replaced = [];
  const observedLangs: unknown[] = [];
  try {
    replace(replaced, categorySvc, 'listMarketplaceCategories', (lang?: unknown) => {
      observedLangs.push(lang);
      return Promise.resolve([]);
    });
    await withServer(async (port) => {
      const res = await request(port, 'POST', '/api/categories/list', { lang: 'en' });
      assert.equal(res.status, 200);
    });
    assert.deepEqual(observedLangs, ['en']);
  } finally {
    restoreAll(replaced);
  }
});

test('POST /api/categories/list defaults to lang="ar" when body is missing', async () => {
  const replaced: Replaced = [];
  const observedLangs: unknown[] = [];
  try {
    replace(replaced, categorySvc, 'listMarketplaceCategories', (lang?: unknown) => {
      observedLangs.push(lang);
      return Promise.resolve([]);
    });
    await withServer(async (port) => {
      const res = await request(port, 'POST', '/api/categories/list');
      assert.equal(res.status, 200);
    });
    assert.deepEqual(observedLangs, ['ar']);
  } finally {
    restoreAll(replaced);
  }
});

test('POST /api/categories/list with invalid lang falls back to "ar"', async () => {
  const replaced: Replaced = [];
  const observedLangs: unknown[] = [];
  try {
    replace(replaced, categorySvc, 'listMarketplaceCategories', (lang?: unknown) => {
      observedLangs.push(lang);
      return Promise.resolve([]);
    });
    await withServer(async (port) => {
      const res = await request(port, 'POST', '/api/categories/list', { lang: 'fr' });
      assert.equal(res.status, 200);
    });
    assert.deepEqual(observedLangs, ['ar']);
  } finally {
    restoreAll(replaced);
  }
});

test('POST /api/categories/list requires no authentication', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, categorySvc, 'listMarketplaceCategories', () =>
      Promise.resolve(marketplaceFixture()),
    );
    await withServer(async (port) => {
      const res = await request(port, 'POST', '/api/categories/list', { lang: 'ar' });
      assert.equal(res.status, 200);
      assert.equal(JSON.parse(res.body).success, true);
    });
  } finally {
    restoreAll(replaced);
  }
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/categories/admin
// ─────────────────────────────────────────────────────────────────────

test('GET /api/categories/admin without token → 401', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'GET', '/api/categories/admin');
    // authenticateStaff middleware returns 401/403 depending on token state.
    // Accept anything in the 4xx auth range but require the request to be rejected.
    assert.ok(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
    const body = JSON.parse(res.body) as { success: boolean };
    assert.equal(body.success, false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Old public GET /api/categories has been removed.
// Verified via method-level 404: even without auth, the router should
// not respond 200 for GET on /api/categories.
// ─────────────────────────────────────────────────────────────────────

test('GET /api/categories (public list) is removed', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'GET', '/api/categories');
    // The route no longer exists at all — Express falls through to its
    // built-in "Route not found" 404 handler.
    assert.equal(res.status, 404, `expected 404 for removed public list, got ${res.status}`);
  });
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
