/**
 * Integration tests for the customer checkout refactor:
 *   POST /api/checkout/prepare
 *   POST /api/orders            (checkoutSessionId flow)
 *
 * Runs against the REAL dev database (no Prisma mocking) through the real
 * Express app, real JWT auth, real controllers/services. Coverage geometry,
 * delivery pricing, and minimum-order settings are read from the LIVE
 * branch/config rows (not mutated) — fixtures pick coordinates/prices that
 * are deterministic against whatever is currently configured. Every user,
 * address, product, category, subscription plan, order, and checkout
 * session this file creates is deleted in `finally`.
 *
 * Run:
 *   cd backend && npx ts-node --transpile-only tests/checkout/checkoutPrepareAndOrder.test.ts
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { signToken } from '../../src/lib/jwt';
import { findContainingArea, normalizeAreas } from '../../src/lib/geo';

// ── Tiny in-file test harness (same pattern as tests/cart/cartRoutes.test.ts) ──
const tests: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

interface HttpResult<T = any> {
  status: number;
  body: { success: boolean; message?: string; data?: T; code?: string; blockers?: unknown[] };
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

const TAG = `chk${Date.now()}`;

// ── Fixtures ────────────────────────────────────────────────────────
const productIds = new Set<string>();
const orderIds = new Set<string>();
const checkoutSessionIds = new Set<string>();
let categoryId = '';
let customerA = { id: '', token: '' };
let customerB = { id: '', token: '' };
let addressInsideId = '';
let addressOutsideId = '';
let addressForBId = '';
let subscriptionPlanId = '';

// Verified against the live branch polygon before writing these tests
// (centroid of the "Alkhabra" service area / a point far outside every area).
// Re-verified against the live branch polygons (they were edited by an
// admin after this file was first written — see `assertLiveCoverageAssumptionsHold`
// below, which fails loudly rather than silently testing the wrong thing).
const INSIDE_COVERAGE = { lat: 26.07454766945827, lng: 43.50992004104519 };
const OUTSIDE_COVERAGE = { lat: 24.7136, lng: 46.6753 };

async function assertLiveCoverageAssumptionsHold() {
  const branch = await prisma.branch.findFirst({ where: { isActive: true } });
  if (!branch) throw new Error('No active branch configured — cannot run checkout coverage tests');
  const areas = normalizeAreas(branch.deliveryAreas);
  if (!findContainingArea(INSIDE_COVERAGE, areas)) {
    throw new Error('Fixture INSIDE_COVERAGE point is no longer inside the live delivery area — update the test fixture');
  }
  if (findContainingArea(OUTSIDE_COVERAGE, areas)) {
    throw new Error('Fixture OUTSIDE_COVERAGE point is unexpectedly inside a live delivery area — update the test fixture');
  }
}

async function createProduct(opts: { price: number; stock: number; name?: string }) {
  const sku = `CHK-${TAG}-${productIds.size}`;
  const p = await prisma.product.create({
    data: {
      categoryId,
      name: opts.name ?? `Checkout Test Product ${productIds.size}`,
      nameAr: `منتج اختبار الدفع ${productIds.size}`,
      sku,
      price: opts.price,
      stock: opts.stock,
      isActive: true,
    },
  });
  productIds.add(p.id);
  return p;
}

async function setup() {
  await assertLiveCoverageAssumptionsHold();

  categoryId = (
    await prisma.category.create({
      data: { name: `Checkout Test Category ${TAG}`, nameAr: `فئة اختبار ${TAG}`, slug: `checkout-test-${TAG}` },
    })
  ).id;

  const userA = await prisma.user.create({
    data: { role: 'CUSTOMER', mobile: `05${Date.now()}`.slice(0, 15), name: 'Checkout Test A', isActive: true },
  });
  customerA = { id: userA.id, token: signToken({ userId: userA.id, role: 'CUSTOMER', scope: 'customer' }) };

  const userB = await prisma.user.create({
    data: { role: 'CUSTOMER', mobile: `05${Date.now() + 1}`.slice(0, 15), name: 'Checkout Test B', isActive: true },
  });
  customerB = { id: userB.id, token: signToken({ userId: userB.id, role: 'CUSTOMER', scope: 'customer' }) };

  addressInsideId = (
    await prisma.customerAddress.create({
      data: { customerId: customerA.id, label: 'Home', latitude: INSIDE_COVERAGE.lat, longitude: INSIDE_COVERAGE.lng },
    })
  ).id;
  addressOutsideId = (
    await prisma.customerAddress.create({
      data: { customerId: customerA.id, label: 'Far', latitude: OUTSIDE_COVERAGE.lat, longitude: OUTSIDE_COVERAGE.lng },
    })
  ).id;
  addressForBId = (
    await prisma.customerAddress.create({
      data: { customerId: customerB.id, label: 'Home', latitude: INSIDE_COVERAGE.lat, longitude: INSIDE_COVERAGE.lng },
    })
  ).id;
}

async function cleanup() {
  await prisma.notification.deleteMany({ where: { userId: { in: [customerA.id, customerB.id].filter(Boolean) } } });
  if (orderIds.size) await prisma.order.deleteMany({ where: { id: { in: Array.from(orderIds) } } });
  if (checkoutSessionIds.size) await prisma.checkoutSession.deleteMany({ where: { id: { in: Array.from(checkoutSessionIds) } } });
  if (customerB.id) await prisma.customerSubscription.deleteMany({ where: { customerId: customerB.id } });
  if (subscriptionPlanId) await prisma.subscriptionPlan.delete({ where: { id: subscriptionPlanId } }).catch(() => {});
  await prisma.customerAddress.deleteMany({ where: { customerId: { in: [customerA.id, customerB.id].filter(Boolean) } } });
  if (productIds.size) await prisma.product.deleteMany({ where: { id: { in: Array.from(productIds) } } });
  if (categoryId) await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [customerA.id, customerB.id].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [customerA.id, customerB.id].filter(Boolean) } } });
}

// ─────────────────────────────────────────────────────────────────────
// Auth gate
// ─────────────────────────────────────────────────────────────────────

test('POST /checkout/prepare returns 401 with no token', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'POST', '/api/checkout/prepare', { selectedFulfillmentType: 'DELIVERY', items: [] });
    assert.equal(res.status, 401);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Language handling
// ─────────────────────────────────────────────────────────────────────

test('prepare returns the Arabic product name when lang=ar', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const res = await request(
      port, 'POST', '/api/checkout/prepare',
      { lang: 'ar', addressId: addressInsideId, selectedFulfillmentType: 'DELIVERY', items: [{ productId: product.id, quantity: 1 }] },
      customerA.token,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items[0].name, product.nameAr);
    checkoutSessionIds.add(res.body.data.checkoutSessionId);
  });
});

test('prepare returns the English product name when lang=en', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const res = await request(
      port, 'POST', '/api/checkout/prepare',
      { lang: 'en', addressId: addressInsideId, selectedFulfillmentType: 'DELIVERY', items: [{ productId: product.id, quantity: 1 }] },
      customerA.token,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items[0].name, product.name);
    checkoutSessionIds.add(res.body.data.checkoutSessionId);
  });
});

test('prepare defaults to Arabic when lang is omitted, and rejects an invalid lang value gracefully (falls back to ar)', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const res = await request(
      port, 'POST', '/api/checkout/prepare',
      { addressId: addressInsideId, selectedFulfillmentType: 'DELIVERY', items: [{ productId: product.id, quantity: 1 }] },
      customerA.token,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.data.items[0].name, product.nameAr);
    checkoutSessionIds.add(res.body.data.checkoutSessionId);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Coverage: inside vs. outside
// ─────────────────────────────────────────────────────────────────────

test('prepare with an address inside coverage returns no coverage blocker and a full response shape', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const res = await request(
      port, 'POST', '/api/checkout/prepare',
      { lang: 'en', addressId: addressInsideId, selectedFulfillmentType: 'DELIVERY', items: [{ productId: product.id, quantity: 1 }] },
      customerA.token,
    );
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.ok(data.checkoutSessionId);
    assert.ok(data.expiresAt);
    assert.equal(data.address.id, addressInsideId);
    assert.equal(data.pricing.subtotal, 20);
    assert.equal(data.delivery.withinCoverage, true);
    assert.equal(data.delivery.available, true);
    assert.deepEqual(data.blockers, []);
    checkoutSessionIds.add(data.checkoutSessionId);
  });
});

test('prepare with an address outside coverage returns an OUTSIDE_COVERAGE blocker', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const res = await request(
      port, 'POST', '/api/checkout/prepare',
      { lang: 'en', addressId: addressOutsideId, selectedFulfillmentType: 'DELIVERY', items: [{ productId: product.id, quantity: 1 }] },
      customerA.token,
    );
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.delivery.withinCoverage, false);
    assert.ok(data.blockers.some((b: any) => b.code === 'OUTSIDE_COVERAGE'));
    checkoutSessionIds.add(data.checkoutSessionId);
  });
});

test('prepare rejects an addressId that does not belong to the authenticated customer', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    // customerA tries to use customerB's address.
    const res = await request(
      port, 'POST', '/api/checkout/prepare',
      { lang: 'en', addressId: addressForBId, selectedFulfillmentType: 'DELIVERY', items: [{ productId: product.id, quantity: 1 }] },
      customerA.token,
    );
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.ok(data.blockers.some((b: any) => b.code === 'INVALID_ADDRESS'));
    checkoutSessionIds.add(data.checkoutSessionId);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Products: stock and minimum order
// ─────────────────────────────────────────────────────────────────────

test('prepare returns INSUFFICIENT_STOCK when requested quantity exceeds available stock', async () => {
  const product = await createProduct({ price: 20, stock: 1 });
  await withServer(async (port) => {
    const res = await request(
      port, 'POST', '/api/checkout/prepare',
      { lang: 'en', addressId: addressInsideId, selectedFulfillmentType: 'DELIVERY', items: [{ productId: product.id, quantity: 2 }] },
      customerA.token,
    );
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.ok(data.blockers.some((b: any) => b.code === 'INSUFFICIENT_STOCK' && b.productId === product.id));
    checkoutSessionIds.add(data.checkoutSessionId);
  });
});

test('prepare returns MINIMUM_ORDER_NOT_MET when the subtotal is below the configured minimum', async () => {
  const minSettings = await prisma.minimumOrderSettings.findFirst();
  if (!minSettings?.enabled) {
    console.log('  (skipped: minimum order is disabled in this environment)');
    return;
  }
  const minAmount = Number(minSettings.minimumAmount);
  const cheapPrice = Math.max(0.5, minAmount / 4);
  const product = await createProduct({ price: cheapPrice, stock: 10 });
  await withServer(async (port) => {
    const res = await request(
      port, 'POST', '/api/checkout/prepare',
      { lang: 'en', addressId: addressInsideId, selectedFulfillmentType: 'DELIVERY', items: [{ productId: product.id, quantity: 1 }] },
      customerA.token,
    );
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.minimumOrder.satisfied, false);
    assert.ok(data.blockers.some((b: any) => b.code === 'MINIMUM_ORDER_NOT_MET'));
    checkoutSessionIds.add(data.checkoutSessionId);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Pickup
// ─────────────────────────────────────────────────────────────────────

test('prepare with PICKUP does not require an address and reports pickup settings', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const res = await request(
      port, 'POST', '/api/checkout/prepare',
      { lang: 'en', selectedFulfillmentType: 'PICKUP', items: [{ productId: product.id, quantity: 1 }] },
      customerA.token,
    );
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.address, null);
    assert.equal(data.fulfillment.selected, 'PICKUP');
    assert.ok(!data.blockers.some((b: any) => b.code === 'ADDRESS_REQUIRED'));
    checkoutSessionIds.add(data.checkoutSessionId);
  });
});

test('prepare with DELIVERY and no addressId returns ADDRESS_REQUIRED', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const res = await request(
      port, 'POST', '/api/checkout/prepare',
      { lang: 'en', selectedFulfillmentType: 'DELIVERY', items: [{ productId: product.id, quantity: 1 }] },
      customerA.token,
    );
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.ok(data.blockers.some((b: any) => b.code === 'ADDRESS_REQUIRED'));
    checkoutSessionIds.add(data.checkoutSessionId);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Subscription benefit — active vs inactive (customerB, dedicated so it
// never affects the fee assertions used by the other cases above).
// ─────────────────────────────────────────────────────────────────────

test('prepare applies the subscription delivery benefit for an active subscription', async () => {
  const plan = await prisma.subscriptionPlan.create({
    data: {
      name: `Checkout Test Free Delivery ${TAG}`, nameAr: `توصيل مجاني ${TAG}`,
      price: 1, durationDays: 30, benefitType: 'FREE_DELIVERY', isActive: true,
    },
  });
  subscriptionPlanId = plan.id;
  await prisma.customerSubscription.create({
    data: {
      customerId: customerB.id, planId: plan.id,
      startDate: new Date(), expiryDate: new Date(Date.now() + 30 * 24 * 3600_000),
      status: 'ACTIVE', paymentMethod: 'CASH_ON_DELIVERY',
    },
  });

  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const res = await request(
      port, 'POST', '/api/checkout/prepare',
      { lang: 'en', addressId: addressForBId, selectedFulfillmentType: 'DELIVERY', items: [{ productId: product.id, quantity: 1 }] },
      customerB.token,
    );
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.subscriptionBenefit.applied, true);
    assert.equal(data.subscriptionBenefit.type, 'FREE_DELIVERY');
    assert.equal(data.delivery.pricingRuleApplied, 'SUBSCRIPTION');
    checkoutSessionIds.add(data.checkoutSessionId);
  });
});

test('prepare does not apply a subscription benefit once the subscription is no longer active', async () => {
  await prisma.customerSubscription.updateMany({ where: { customerId: customerB.id }, data: { status: 'EXPIRED' } });

  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const res = await request(
      port, 'POST', '/api/checkout/prepare',
      { lang: 'en', addressId: addressForBId, selectedFulfillmentType: 'DELIVERY', items: [{ productId: product.id, quantity: 1 }] },
      customerB.token,
    );
    assert.equal(res.status, 200);
    const data = res.body.data;
    assert.equal(data.subscriptionBenefit.applied, false);
    assert.notEqual(data.delivery.pricingRuleApplied, 'SUBSCRIPTION');
    checkoutSessionIds.add(data.checkoutSessionId);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Order creation from a checkout session
// ─────────────────────────────────────────────────────────────────────

async function prepare(port: number, token: string, body: unknown) {
  const res = await request(port, 'POST', '/api/checkout/prepare', body, token);
  assert.equal(res.status, 200, `prepare failed: ${JSON.stringify(res.body)}`);
  checkoutSessionIds.add(res.body.data.checkoutSessionId);
  return res.body.data;
}

test('creating an order from a valid checkout session succeeds and matches the prepared totals', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const prepared = await prepare(port, customerA.token, {
      lang: 'en', addressId: addressInsideId, selectedFulfillmentType: 'DELIVERY',
      items: [{ productId: product.id, quantity: 2 }],
    });

    const res = await request(port, 'POST', '/api/orders', {
      checkoutSessionId: prepared.checkoutSessionId,
      paymentMethod: 'CASH_ON_DELIVERY',
      notes: 'Leave at the door',
    }, customerA.token);

    assert.equal(res.status, 201, JSON.stringify(res.body));
    const order = res.body.data;
    orderIds.add(order.id);
    assert.equal(Number(order.subtotal), prepared.pricing.subtotal);
    assert.equal(Number(order.deliveryFee), prepared.pricing.deliveryFee);
    assert.equal(Number(order.total), prepared.pricing.total);
    assert.equal(order.addressId, addressInsideId);

    const session = await prisma.checkoutSession.findUnique({ where: { id: prepared.checkoutSessionId } });
    assert.ok(session?.usedAt, 'session should be marked consumed after order creation');
  });
});

test('reusing an already-consumed checkout session is rejected with CHECKOUT_CHANGED-family error and no duplicate order', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const prepared = await prepare(port, customerA.token, {
      lang: 'en', addressId: addressInsideId, selectedFulfillmentType: 'DELIVERY',
      items: [{ productId: product.id, quantity: 1 }],
    });

    const first = await request(port, 'POST', '/api/orders', {
      checkoutSessionId: prepared.checkoutSessionId, paymentMethod: 'CASH_ON_DELIVERY',
    }, customerA.token);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    orderIds.add(first.body.data.id);

    const countBefore = await prisma.order.count();
    const second = await request(port, 'POST', '/api/orders', {
      checkoutSessionId: prepared.checkoutSessionId, paymentMethod: 'CASH_ON_DELIVERY',
    }, customerA.token);
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'SESSION_CONSUMED');
    const countAfter = await prisma.order.count();
    assert.equal(countAfter, countBefore, 'no order should be created from a consumed session');
  });
});

test('an expired checkout session is rejected and does not create an order', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const prepared = await prepare(port, customerA.token, {
      lang: 'en', addressId: addressInsideId, selectedFulfillmentType: 'DELIVERY',
      items: [{ productId: product.id, quantity: 1 }],
    });
    await prisma.checkoutSession.update({
      where: { id: prepared.checkoutSessionId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await request(port, 'POST', '/api/orders', {
      checkoutSessionId: prepared.checkoutSessionId, paymentMethod: 'CASH_ON_DELIVERY',
    }, customerA.token);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'SESSION_EXPIRED');
  });
});

test('a customer cannot create an order from another customer\'s checkout session', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const prepared = await prepare(port, customerA.token, {
      lang: 'en', addressId: addressInsideId, selectedFulfillmentType: 'DELIVERY',
      items: [{ productId: product.id, quantity: 1 }],
    });

    const res = await request(port, 'POST', '/api/orders', {
      checkoutSessionId: prepared.checkoutSessionId, paymentMethod: 'CASH_ON_DELIVERY',
    }, customerB.token);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'SESSION_NOT_FOUND');
  });
});

test('CHECKOUT_CHANGED when the product price changed after prepare — no order is created', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const prepared = await prepare(port, customerA.token, {
      lang: 'en', addressId: addressInsideId, selectedFulfillmentType: 'DELIVERY',
      items: [{ productId: product.id, quantity: 1 }],
    });

    await prisma.product.update({ where: { id: product.id }, data: { price: 25 } });

    const countBefore = await prisma.order.count();
    const res = await request(port, 'POST', '/api/orders', {
      checkoutSessionId: prepared.checkoutSessionId, paymentMethod: 'CASH_ON_DELIVERY',
    }, customerA.token);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'CHECKOUT_CHANGED');
    const countAfter = await prisma.order.count();
    assert.equal(countAfter, countBefore);

    const session = await prisma.checkoutSession.findUnique({ where: { id: prepared.checkoutSessionId } });
    assert.equal(session?.usedAt, null, 'session must stay unconsumed when the order was not created');
  });
});

test('CHECKOUT_CHANGED when stock dropped below the prepared quantity — no order is created', async () => {
  const product = await createProduct({ price: 20, stock: 5 });
  await withServer(async (port) => {
    const prepared = await prepare(port, customerA.token, {
      lang: 'en', addressId: addressInsideId, selectedFulfillmentType: 'DELIVERY',
      items: [{ productId: product.id, quantity: 5 }],
    });

    await prisma.product.update({ where: { id: product.id }, data: { stock: 2 } });

    const countBefore = await prisma.order.count();
    const res = await request(port, 'POST', '/api/orders', {
      checkoutSessionId: prepared.checkoutSessionId, paymentMethod: 'CASH_ON_DELIVERY',
    }, customerA.token);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'CHECKOUT_CHANGED');
    assert.ok(res.body.blockers?.some((b: any) => b.code === 'INSUFFICIENT_STOCK'));
    const countAfter = await prisma.order.count();
    assert.equal(countAfter, countBefore);
  });
});

test('order creation via PICKUP + scheduled slot fields absent still succeeds (ASAP pickup)', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const prepared = await prepare(port, customerA.token, {
      lang: 'en', selectedFulfillmentType: 'PICKUP',
      items: [{ productId: product.id, quantity: 1 }],
    });

    const res = await request(port, 'POST', '/api/orders', {
      checkoutSessionId: prepared.checkoutSessionId, paymentMethod: 'PAY_AT_BRANCH',
    }, customerA.token);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    orderIds.add(res.body.data.id);
    assert.equal(res.body.data.fulfillmentType, 'PICKUP');
    assert.equal(res.body.data.addressId, null);
  });
});

test('legacy direct-fields order creation (no checkoutSessionId) still works unchanged', async () => {
  const product = await createProduct({ price: 20, stock: 10 });
  await withServer(async (port) => {
    const res = await request(port, 'POST', '/api/orders', {
      fulfillmentType: 'DELIVERY',
      addressId: addressInsideId,
      paymentMethod: 'CASH_ON_DELIVERY',
      items: [{ productId: product.id, quantity: 1 }],
    }, customerA.token);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    orderIds.add(res.body.data.id);
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
