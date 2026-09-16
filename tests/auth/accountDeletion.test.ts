/**
 * Integration tests for customer account deletion, active-only phone
 * uniqueness, and deleted-account token rejection:
 *   POST   /api/auth/request-otp
 *   POST   /api/auth/verify-otp
 *   GET    /api/auth/me
 *   DELETE /api/auth/me
 *
 * Runs against the REAL dev database (no Prisma mocking) through the real
 * Express app, real auth middleware, real OTP flow (dev mode exposes the
 * generated code in the request-otp response — see config.otp.exposeCode).
 * Every user/order/category/product this file creates is deleted in
 * `finally`.
 *
 * Run:
 *   cd backend && npx ts-node --transpile-only tests/auth/accountDeletion.test.ts
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { normalizeMobile } from '../../src/lib/phone';

// ── Tiny in-file test harness (same pattern used across this repo's tests) ──
const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

interface HttpResult<T = any> {
  status: number;
  body: { success: boolean; message?: string; data?: T; code?: string };
}
function request(port: number, method: string, path: string, body?: unknown, token?: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');
    const headers: Record<string, string> = {};
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(payload.length);
    }
    if (token) headers.authorization = `Bearer ${token}`;
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode ?? 0, body: raw ? JSON.parse(raw) : {} });
      });
    });
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

const TAG = Date.now();
let mobileCounter = 0;
/**
 * A fresh, never-used-before mobile for each call — avoids cross-test
 * collisions. The counter is appended at the END and we keep the LAST 9
 * digits, so it is always present in the result (never truncated away),
 * guaranteeing every call in this run returns a distinct number.
 */
function freshMobile(): string {
  mobileCounter += 1;
  const raw = `${TAG}${String(mobileCounter).padStart(4, '0')}`;
  const local = raw.slice(-9);
  return `+966${local}`;
}

const createdUserIds = new Set<string>();
const createdOrderIds = new Set<string>();
let categoryId = '';
const productIds = new Set<string>();

async function signUp(port: number, mobile: string): Promise<{ token: string; userId: string }> {
  const otpRes = await request(port, 'POST', '/api/auth/request-otp', { mobile });
  assert.equal(otpRes.status, 200, JSON.stringify(otpRes.body));
  const code = (otpRes.body.data as any)?.code;
  assert.ok(code, 'dev mode must expose the OTP code for tests to proceed');

  const verifyRes = await request(port, 'POST', '/api/auth/verify-otp', { mobile, code });
  assert.equal(verifyRes.status, 200, JSON.stringify(verifyRes.body));
  const { token, user } = verifyRes.body.data as any;
  createdUserIds.add(user.id);
  return { token, userId: user.id };
}

async function setup() {
  const category = await prisma.category.create({
    data: { name: `Acct Del Test Category ${TAG}`, nameAr: `فئة اختبار حذف الحساب ${TAG}`, slug: `acct-del-test-${TAG}` },
  });
  categoryId = category.id;
  const product = await prisma.product.create({
    data: {
      categoryId, name: `Acct Del Test Product ${TAG}`, nameAr: `منتج اختبار ${TAG}`,
      sku: `ACCTDEL-${TAG}`, price: 15, stock: 10, isActive: true,
    },
  });
  productIds.add(product.id);
}

async function cleanup() {
  if (createdOrderIds.size) {
    await prisma.notification.deleteMany({ where: { orderId: { in: Array.from(createdOrderIds) } } });
    await prisma.order.deleteMany({ where: { id: { in: Array.from(createdOrderIds) } } });
  }
  if (createdUserIds.size) {
    const ids = Array.from(createdUserIds);
    await prisma.customerSubscription.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    // Cascades: otpCodes, favorites, cart(+items), customerAddress, checkoutSessions.
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  if (productIds.size) await prisma.product.deleteMany({ where: { id: { in: Array.from(productIds) } } });
  if (categoryId) await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
}

// ─────────────────────────────────────────────────────────────────────
// 1) Existing active customer signs in normally
// ─────────────────────────────────────────────────────────────────────

test('an active customer can sign in normally via OTP', async () => {
  await withServer(async (port) => {
    const mobile = freshMobile();
    const { token, userId } = await signUp(port, mobile);
    assert.ok(token);
    const me = await request(port, 'GET', '/api/auth/me', undefined, token);
    assert.equal(me.status, 200);
    assert.equal((me.body.data as any).id, userId);
    assert.equal((me.body.data as any).mobile, normalizeMobile(mobile));
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2)-6) Full deletion → old token rejected → history preserved →
//        re-signup gets a new ID → new account starts empty
// ─────────────────────────────────────────────────────────────────────

test('deleting the account: old token is rejected, history stays under the old ID, re-signup gets a brand-new empty account', async () => {
  await withServer(async (port) => {
    const mobile = freshMobile();
    const { token: oldToken, userId: oldUserId } = await signUp(port, mobile);

    // Give the soon-to-be-deleted account some history: an address, a
    // favorite, a cart item, and an order — all of it must survive deletion
    // under the ORIGINAL id and never surface on the next account.
    const addrRes = await request(port, 'POST', '/api/users/me/addresses', {
      label: 'Home', latitude: 26.0679814, longitude: 43.62369897,
    }, oldToken);
    assert.equal(addrRes.status, 201, JSON.stringify(addrRes.body));

    const favRes = await request(port, 'POST', '/api/favorites', { productId: Array.from(productIds)[0] }, oldToken);
    assert.equal(favRes.status, 201, JSON.stringify(favRes.body));

    const cartRes = await request(port, 'POST', '/api/cart/items', {
      productId: Array.from(productIds)[0], quantity: 1, action: 'increment',
    }, oldToken);
    assert.equal(cartRes.status, 200, JSON.stringify(cartRes.body));

    const orderRes = await request(port, 'POST', '/api/orders', {
      fulfillmentType: 'PICKUP',
      paymentMethod: 'PAY_AT_BRANCH',
      items: [{ productId: Array.from(productIds)[0], quantity: 1 }],
    }, oldToken);
    assert.equal(orderRes.status, 201, JSON.stringify(orderRes.body));
    const orderId = orderRes.body.data.id;
    createdOrderIds.add(orderId);

    // 2) Delete the account.
    const delRes = await request(port, 'DELETE', '/api/auth/me', undefined, oldToken);
    assert.equal(delRes.status, 200, JSON.stringify(delRes.body));
    assert.ok((delRes.body.data as any).deletedAt);
    // Confirmation must not echo customer data (mobile/name/etc).
    assert.equal((delRes.body.data as any).mobile, undefined);

    // 3) The old (still cryptographically valid, unexpired) token must now
    //    be rejected by every authenticated endpoint.
    const meAfterDelete = await request(port, 'GET', '/api/auth/me', undefined, oldToken);
    assert.equal(meAfterDelete.status, 401);
    const cartAfterDelete = await request(port, 'GET', '/api/cart', undefined, oldToken);
    assert.equal(cartAfterDelete.status, 401);
    const secondDelete = await request(port, 'DELETE', '/api/auth/me', undefined, oldToken);
    assert.equal(secondDelete.status, 401);

    // 4) The order (and the user row) remain linked to the ORIGINAL id —
    //    nothing was cascade-deleted or reassigned.
    const dbUser = await prisma.user.findUnique({ where: { id: oldUserId } });
    assert.ok(dbUser);
    assert.ok(dbUser!.deletedAt);
    assert.equal(dbUser!.isActive, false);
    const dbOrder = await prisma.order.findUnique({ where: { id: orderId } });
    assert.equal(dbOrder?.customerId, oldUserId);

    // 5) The same phone number signs in again and gets a NEW customer ID.
    const { token: newToken, userId: newUserId } = await signUp(port, mobile);
    assert.notEqual(newUserId, oldUserId);

    // 6) The new account has none of the old account's history.
    const newAddresses = await request(port, 'GET', '/api/users/me/addresses', undefined, newToken);
    assert.deepEqual(newAddresses.body.data, []);
    const newFavorites = await request(port, 'GET', '/api/favorites', undefined, newToken);
    assert.deepEqual(newFavorites.body.data, []);
    const newCart = await request(port, 'GET', '/api/cart', undefined, newToken);
    assert.equal((newCart.body.data as any).items.length, 0);
    const newOrders = await request(port, 'GET', '/api/orders', undefined, newToken);
    assert.equal((newOrders.body.data as any).orders.length, 0);

    // 7) Delete the SECOND account too — two deleted rows must now share
    //    this exact normalized mobile without any DB conflict.
    const delRes2 = await request(port, 'DELETE', '/api/auth/me', undefined, newToken);
    assert.equal(delRes2.status, 200, JSON.stringify(delRes2.body));
    const normalized = normalizeMobile(mobile);
    const deletedCount = await prisma.user.count({ where: { mobile: normalized, deletedAt: { not: null } } });
    assert.equal(deletedCount, 2, 'both retired accounts should share the mobile with no conflict');
  });
});

// ─────────────────────────────────────────────────────────────────────
// 8) Two ACTIVE accounts can never share a phone number
// ─────────────────────────────────────────────────────────────────────

test('two active accounts cannot share the same normalized mobile', async () => {
  const mobile = normalizeMobile(freshMobile());
  const u1 = await prisma.user.create({ data: { mobile, role: 'CUSTOMER' } });
  createdUserIds.add(u1.id);

  await assert.rejects(
    prisma.user.create({ data: { mobile, role: 'CUSTOMER' } }),
    /Unique constraint failed/,
  );

  // Soft-deleting the first frees the number for a second ACTIVE account.
  await prisma.user.update({ where: { id: u1.id }, data: { deletedAt: new Date() } });
  const u2 = await prisma.user.create({ data: { mobile, role: 'CUSTOMER' } });
  createdUserIds.add(u2.id);

  await assert.rejects(
    prisma.user.create({ data: { mobile, role: 'CUSTOMER' } }),
    /Unique constraint failed/,
  );
});

// ─────────────────────────────────────────────────────────────────────
// 9) Concurrent sign-in cannot create duplicate active accounts
// ─────────────────────────────────────────────────────────────────────

test('concurrent OTP requests for a brand-new number create exactly one active account', async () => {
  await withServer(async (port) => {
    const mobile = freshMobile();
    const [r1, r2, r3] = await Promise.all([
      request(port, 'POST', '/api/auth/request-otp', { mobile }),
      request(port, 'POST', '/api/auth/request-otp', { mobile }),
      request(port, 'POST', '/api/auth/request-otp', { mobile }),
    ]);
    for (const r of [r1, r2, r3]) assert.equal(r.status, 200, JSON.stringify(r.body));

    const normalized = normalizeMobile(mobile);
    const activeUsers = await prisma.user.findMany({ where: { mobile: normalized, deletedAt: null } });
    assert.equal(activeUsers.length, 1, 'exactly one active account should exist after concurrent sign-in attempts');
    createdUserIds.add(activeUsers[0].id);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Deleted-account role/idempotency guards on the deletion endpoint itself
// ─────────────────────────────────────────────────────────────────────

test('deleting an already-deleted account a second time (same still-valid token) is rejected before the first request completes is not racy; sequential re-delete after refetch fails cleanly', async () => {
  await withServer(async (port) => {
    const mobile = freshMobile();
    const { token } = await signUp(port, mobile);
    const first = await request(port, 'DELETE', '/api/auth/me', undefined, token);
    assert.equal(first.status, 200);
    // Middleware now rejects the token outright (401) rather than reaching
    // the "already deleted" business-logic branch (400) — both are correct
    // "cannot delete twice" outcomes; assert the stronger guarantee.
    const second = await request(port, 'DELETE', '/api/auth/me', undefined, token);
    assert.equal(second.status, 401);
  });
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
