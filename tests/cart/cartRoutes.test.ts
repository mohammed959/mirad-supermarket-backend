/**
 * HTTP smoke tests for the customer cart endpoints:
 *   - GET    /api/cart
 *   - POST   /api/cart/items
 *   - DELETE /api/cart/items/:productId
 *   - DELETE /api/cart
 *
 * Mounts the real Express `app`, monkey-patches the cart service so we
 * exercise real controllers, real `authenticateCustomer` middleware, real
 * `asyncHandler`, real `ok()` envelope, and the real error middleware.
 *
 * Run:
 *   cd backend && npx ts-node --transpile-only tests/cart/cartRoutes.test.ts
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import app from '../../src/app';
import { signToken } from '../../src/lib/jwt';
import { prisma } from '../../src/lib/prisma';
import * as cartSvc from '../../src/modules/cart/cart.service';

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
  token?: string,
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
    const headers: Record<string, string> = {};
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(payload.length);
    }
    if (token) headers.authorization = `Bearer ${token}`;
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers },
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

// `authenticateCustomer`/`authenticateStaff` now confirm the token's userId
// resolves to a real, non-deleted account (see auth.middleware.ts) — a
// forged id for a user that doesn't exist is rejected before any
// scope/role check runs. So these tokens must point at real DB rows.
const TAG = `cartroutes${Date.now()}`;
let customerToken = '';
let staffToken = '';
let customerId = '';
const testUserIds: string[] = [];

async function setup() {
  const customer = await prisma.user.create({
    data: { role: 'CUSTOMER', mobile: `+9665${Date.now()}`.slice(0, 13), name: 'Cart Test Customer' },
  });
  const staff = await prisma.user.create({
    data: { role: 'SUPER_ADMIN', email: `${TAG}@example.com`, name: 'Cart Test Staff' },
  });
  testUserIds.push(customer.id, staff.id);
  customerId = customer.id;
  customerToken = signToken({ userId: customer.id, role: 'CUSTOMER', scope: 'customer' });
  staffToken = signToken({ userId: staff.id, role: 'SUPER_ADMIN', scope: 'staff' });
}

async function cleanup() {
  if (testUserIds.length) await prisma.user.deleteMany({ where: { id: { in: testUserIds } } });
}

const cartItemFixture = (): cartSvc.CartItemView => ({
  itemId: 'p1',
  productId: 'p1',
  name: 'حليب المراعي',
  sku: 'ALM-1L',
  imageUrl: null,
  price: 6.5,
  quantity: 2,
  subtotal: 13,
  available: true,
});

// ─────────────────────────────────────────────────────────────────────
// Auth gate — every route requires a customer session
// ─────────────────────────────────────────────────────────────────────

test('GET /api/cart returns 401 with no token', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'GET', '/api/cart');
    assert.equal(res.status, 401);
  });
});

test('GET /api/cart returns 403 with a staff token', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'GET', '/api/cart', undefined, staffToken);
    assert.equal(res.status, 403);
  });
});

// ─────────────────────────────────────────────────────────────────────
// GET /api/cart
// ─────────────────────────────────────────────────────────────────────

test('GET /api/cart returns userId, activeItemsCount and items', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, cartSvc, 'getCart', (userId: string) =>
      Promise.resolve({ userId, activeItemsCount: 1, items: [cartItemFixture()] }),
    );
    await withServer(async (port) => {
      const res = await request(port, 'GET', '/api/cart', undefined, customerToken);
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body) as {
        data: { userId: string; activeItemsCount: number; items: unknown[] };
      };
      assert.equal(body.data.userId, customerId);
      assert.equal(body.data.activeItemsCount, 1);
      assert.equal(body.data.items.length, 1);
    });
  } finally {
    restoreAll(replaced);
  }
});

// ─────────────────────────────────────────────────────────────────────
// POST /api/cart/items
// ─────────────────────────────────────────────────────────────────────

test('POST /api/cart/items 400 when body is missing required fields', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'POST', '/api/cart/items', { productId: 'p1' }, customerToken);
    assert.equal(res.status, 400);
  });
});

test('POST /api/cart/items increment forwards userId from token (not body)', async () => {
  const replaced: Replaced = [];
  const calls: unknown[] = [];
  try {
    replace(replaced, cartSvc, 'addOrAdjustItem', (userId: string, input: unknown) => {
      calls.push({ userId, input });
      return Promise.resolve(cartItemFixture());
    });
    await withServer(async (port) => {
      const res = await request(
        port,
        'POST',
        '/api/cart/items',
        { productId: 'p1', quantity: 2, action: 'increment' },
        customerToken,
      );
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body) as { data: { quantity: number } };
      assert.equal(body.data.quantity, 2);
    });
    assert.equal(calls.length, 1);
    assert.equal((calls[0] as { userId: string }).userId, customerId);
  } finally {
    restoreAll(replaced);
  }
});

test('POST /api/cart/items surfaces service errors (e.g. stock) as 400', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, cartSvc, 'addOrAdjustItem', () =>
      Promise.reject(new Error('Only 1 unit(s) of this product are available')),
    );
    await withServer(async (port) => {
      const res = await request(
        port,
        'POST',
        '/api/cart/items',
        { productId: 'p1', quantity: 5, action: 'increment' },
        customerToken,
      );
      assert.equal(res.status, 400);
      const body = JSON.parse(res.body) as { message: string };
      assert.match(body.message, /available/);
    });
  } finally {
    restoreAll(replaced);
  }
});

test('POST /api/cart/items decrement to zero returns removed:true', async () => {
  const replaced: Replaced = [];
  try {
    replace(replaced, cartSvc, 'addOrAdjustItem', () =>
      Promise.resolve({ itemId: 'p1', productId: 'p1', removed: true as const }),
    );
    await withServer(async (port) => {
      const res = await request(
        port,
        'POST',
        '/api/cart/items',
        { productId: 'p1', quantity: 2, action: 'decrement' },
        customerToken,
      );
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body) as { data: { removed: boolean } };
      assert.equal(body.data.removed, true);
    });
  } finally {
    restoreAll(replaced);
  }
});

// ─────────────────────────────────────────────────────────────────────
// DELETE /api/cart/items/:productId and DELETE /api/cart
// ─────────────────────────────────────────────────────────────────────

test('DELETE /api/cart/items/:productId returns 204 and scopes to the token userId', async () => {
  const replaced: Replaced = [];
  const calls: unknown[] = [];
  try {
    replace(replaced, cartSvc, 'removeItem', (userId: string, productId: string) => {
      calls.push({ userId, productId });
      return Promise.resolve();
    });
    await withServer(async (port) => {
      const res = await request(port, 'DELETE', '/api/cart/items/p1', undefined, customerToken);
      assert.equal(res.status, 204);
    });
    assert.deepEqual(calls[0], { userId: customerId, productId: 'p1' });
  } finally {
    restoreAll(replaced);
  }
});

test('DELETE /api/cart clears the whole cart and returns 204', async () => {
  const replaced: Replaced = [];
  const calls: unknown[] = [];
  try {
    replace(replaced, cartSvc, 'clearCart', (userId: string) => {
      calls.push(userId);
      return Promise.resolve();
    });
    await withServer(async (port) => {
      const res = await request(port, 'DELETE', '/api/cart', undefined, customerToken);
      assert.equal(res.status, 204);
    });
    assert.deepEqual(calls, [customerId]);
  } finally {
    restoreAll(replaced);
  }
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
  console.log(
    `\n${tests.length - failed}/${tests.length} passed` +
      (failed > 0 ? `, ${failed} failed` : ''),
  );
  process.exit(failed > 0 ? 1 : 0);
})();
