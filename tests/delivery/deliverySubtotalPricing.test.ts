/**
 * Tests for admin-controlled, subtotal-based delivery pricing:
 *   - Pure validation rules (`validateDeliverySubtotalPricing`)
 *   - Admin API atomicity (`GET/PUT /api/delivery/subtotal-pricing`)
 *   - Runtime pricing via `POST /api/checkout/prepare` (boundaries, every
 *     range, free-delivery threshold, decimals, pickup, outside coverage,
 *     subscription benefits, cart-quantity changes)
 *   - `POST /api/orders` re-validation when the admin changes pricing
 *     between prepare and order creation (CHECKOUT_CHANGED)
 *
 * Runs against the REAL dev database. The live subtotal-pricing config is
 * saved/restored around the suite so it leaves the DB exactly as it found
 * it. Every other fixture (users, products, addresses, sessions, orders,
 * subscription plan) is deleted in `finally`.
 *
 * Run:
 *   cd backend && npx ts-node --transpile-only tests/delivery/deliverySubtotalPricing.test.ts
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { signToken } from '../../src/lib/jwt';
import {
  validateDeliverySubtotalPricing,
  replaceDeliverySubtotalPricing,
  getDeliverySubtotalPricing,
  DeliveryPricingValidationError,
  type DeliverySubtotalPricingInput,
} from '../../src/modules/delivery/deliverySubtotalPricing.service';

// ── Tiny in-file test harness (same pattern used across this repo) ────
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

const SUGGESTED_CONFIG: DeliverySubtotalPricingInput = {
  freeDeliveryThreshold: 150,
  ranges: [
    { minSubtotal: 0, maxSubtotal: 50, deliveryFee: 15 },
    { minSubtotal: 50, maxSubtotal: 100, deliveryFee: 10 },
    { minSubtotal: 100, maxSubtotal: 150, deliveryFee: 5 },
  ],
};

// Verified live against the branch's current delivery-area polygons before
// writing these tests (see prior session notes) — re-verified in `setup`.
const INSIDE_COVERAGE = { lat: 26.07454766945827, lng: 43.50992004104519 };
const OUTSIDE_COVERAGE = { lat: 24.7136, lng: 46.6753 };

// ── Fixtures ────────────────────────────────────────────────────────
const createdUserIds = new Set<string>();
const createdOrderIds = new Set<string>();
const createdProductIds = new Set<string>();
let categoryId = '';
let subscriptionPlanId = '';
let originalSubtotalPricing: Awaited<ReturnType<typeof getDeliverySubtotalPricing>> | null = null;

let customerToken = '';
let customerId = '';
let insideAddressId = '';
let outsideAddressId = '';
let productId = '';

let staffToken = '';

async function setPrice(price: number) {
  await prisma.product.update({ where: { id: productId }, data: { price } });
}

async function setup() {
  const { findContainingArea, normalizeAreas } = await import('../../src/lib/geo');
  const branch = await prisma.branch.findFirst({ where: { isActive: true } });
  if (!branch) throw new Error('No active branch configured — cannot run delivery pricing tests');
  const areas = normalizeAreas(branch.deliveryAreas);
  if (!findContainingArea(INSIDE_COVERAGE, areas)) {
    throw new Error('Fixture INSIDE_COVERAGE point is no longer inside the live delivery area — update the test fixture');
  }
  if (findContainingArea(OUTSIDE_COVERAGE, areas)) {
    throw new Error('Fixture OUTSIDE_COVERAGE point is unexpectedly inside a live delivery area — update the test fixture');
  }

  // Save the live subtotal-pricing config so we can restore it verbatim.
  originalSubtotalPricing = await getDeliverySubtotalPricing();

  // Seed a deterministic config for this suite.
  await replaceDeliverySubtotalPricing(SUGGESTED_CONFIG);

  categoryId = (
    await prisma.category.create({
      data: { name: `Subtotal Pricing Test Category ${TAG}`, nameAr: `فئة اختبار ${TAG}`, slug: `subtotal-pricing-test-${TAG}` },
    })
  ).id;

  const product = await prisma.product.create({
    data: { categoryId, name: `Subtotal Pricing Test Product ${TAG}`, nameAr: `منتج اختبار ${TAG}`, sku: `SPT-${TAG}`, price: 1, stock: 1000, isActive: true },
  });
  productId = product.id;
  createdProductIds.add(product.id);

  const customer = await prisma.user.create({
    data: { role: 'CUSTOMER', mobile: `+9665${TAG}`.slice(0, 13), name: 'Subtotal Pricing Test Customer', isActive: true },
  });
  customerId = customer.id;
  createdUserIds.add(customer.id);
  customerToken = signToken({ userId: customer.id, role: 'CUSTOMER', scope: 'customer' });

  const staff = await prisma.user.create({
    data: { role: 'SUPER_ADMIN', email: `subtotal-pricing-test-${TAG}@example.com`, name: 'Subtotal Pricing Test Staff' },
  });
  createdUserIds.add(staff.id);
  staffToken = signToken({ userId: staff.id, role: 'SUPER_ADMIN', scope: 'staff' });

  insideAddressId = (
    await prisma.customerAddress.create({
      data: { customerId, label: 'Inside', latitude: INSIDE_COVERAGE.lat, longitude: INSIDE_COVERAGE.lng },
    })
  ).id;
  outsideAddressId = (
    await prisma.customerAddress.create({
      data: { customerId, label: 'Outside', latitude: OUTSIDE_COVERAGE.lat, longitude: OUTSIDE_COVERAGE.lng },
    })
  ).id;
}

async function cleanup() {
  const ids = Array.from(createdUserIds);
  if (createdOrderIds.size) {
    await prisma.notification.deleteMany({ where: { orderId: { in: Array.from(createdOrderIds) } } });
    await prisma.order.deleteMany({ where: { id: { in: Array.from(createdOrderIds) } } });
  }
  if (ids.length) {
    await prisma.customerSubscription.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.checkoutSession.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.customerAddress.deleteMany({ where: { customerId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  if (subscriptionPlanId) await prisma.subscriptionPlan.delete({ where: { id: subscriptionPlanId } }).catch(() => {});
  if (createdProductIds.size) await prisma.product.deleteMany({ where: { id: { in: Array.from(createdProductIds) } } });
  if (categoryId) await prisma.category.delete({ where: { id: categoryId } }).catch(() => {});

  // Restore the live subtotal-pricing config exactly as found.
  if (originalSubtotalPricing && originalSubtotalPricing.freeDeliveryThreshold != null && originalSubtotalPricing.ranges.length > 0) {
    await replaceDeliverySubtotalPricing({
      freeDeliveryThreshold: originalSubtotalPricing.freeDeliveryThreshold,
      ranges: originalSubtotalPricing.ranges.map((r) => ({
        minSubtotal: r.minSubtotal, maxSubtotal: r.maxSubtotal, deliveryFee: r.deliveryFee,
      })),
    });
  } else {
    await prisma.deliverySubtotalRange.deleteMany({});
    await prisma.deliverySubtotalPricingSettings.deleteMany({});
  }
}

// ─────────────────────────────────────────────────────────────────────
// Pure validation rules
// ─────────────────────────────────────────────────────────────────────

function expectCode(input: DeliverySubtotalPricingInput, code: string) {
  try {
    validateDeliverySubtotalPricing(input);
    assert.fail(`expected ${code} but validation passed`);
  } catch (err) {
    assert.ok(err instanceof DeliveryPricingValidationError, 'expected a DeliveryPricingValidationError');
    assert.equal((err as DeliveryPricingValidationError).code, code);
  }
}

test('valid suggested configuration passes validation', () => {
  validateDeliverySubtotalPricing(SUGGESTED_CONFIG);
  return Promise.resolve();
});

test('negative free-delivery threshold is rejected', async () => {
  expectCode({ freeDeliveryThreshold: -10, ranges: SUGGESTED_CONFIG.ranges }, 'INVALID_FREE_DELIVERY_THRESHOLD');
});

test('negative range fee is rejected', async () => {
  expectCode(
    { freeDeliveryThreshold: 150, ranges: [{ minSubtotal: 0, maxSubtotal: 150, deliveryFee: -5 }] },
    'INVALID_DELIVERY_RANGE',
  );
});

test('maxSubtotal <= minSubtotal is rejected', async () => {
  expectCode(
    { freeDeliveryThreshold: 150, ranges: [{ minSubtotal: 50, maxSubtotal: 50, deliveryFee: 10 }] },
    'INVALID_DELIVERY_RANGE',
  );
});

test('a first range that does not start at 0 is rejected as a gap', async () => {
  expectCode(
    { freeDeliveryThreshold: 150, ranges: [{ minSubtotal: 10, maxSubtotal: 150, deliveryFee: 10 }] },
    'DELIVERY_PRICING_GAP',
  );
});

test('a gap between ranges is rejected', async () => {
  expectCode(
    {
      freeDeliveryThreshold: 150,
      ranges: [
        { minSubtotal: 0, maxSubtotal: 50, deliveryFee: 15 },
        { minSubtotal: 60, maxSubtotal: 150, deliveryFee: 5 },
      ],
    },
    'DELIVERY_PRICING_GAP',
  );
});

test('overlapping ranges are rejected', async () => {
  expectCode(
    {
      freeDeliveryThreshold: 150,
      ranges: [
        { minSubtotal: 0, maxSubtotal: 60, deliveryFee: 15 },
        { minSubtotal: 50, maxSubtotal: 150, deliveryFee: 5 },
      ],
    },
    'DELIVERY_PRICING_OVERLAP',
  );
});

test('duplicate ranges are rejected as an overlap', async () => {
  expectCode(
    {
      freeDeliveryThreshold: 50,
      ranges: [
        { minSubtotal: 0, maxSubtotal: 50, deliveryFee: 15 },
        { minSubtotal: 0, maxSubtotal: 50, deliveryFee: 15 },
      ],
    },
    'DELIVERY_PRICING_OVERLAP',
  );
});

test('a final paid range that does not end at the free-delivery threshold is rejected', async () => {
  expectCode(
    { freeDeliveryThreshold: 200, ranges: [{ minSubtotal: 0, maxSubtotal: 150, deliveryFee: 10 }] },
    'INVALID_FREE_DELIVERY_THRESHOLD',
  );
});

test('an empty ranges array is rejected', async () => {
  expectCode({ freeDeliveryThreshold: 150, ranges: [] }, 'INCOMPLETE_DELIVERY_PRICING');
});

test('a value with more than 2 decimal places is rejected', async () => {
  expectCode(
    { freeDeliveryThreshold: 150, ranges: [{ minSubtotal: 0, maxSubtotal: 150, deliveryFee: 10.999 }] },
    'INVALID_DELIVERY_RANGE',
  );
});

// ─────────────────────────────────────────────────────────────────────
// Admin API — atomicity + auth
// ─────────────────────────────────────────────────────────────────────

test('GET /delivery/subtotal-pricing requires a staff token', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'GET', '/api/delivery/subtotal-pricing');
    assert.equal(res.status, 401);
  });
});

test('PUT /delivery/subtotal-pricing saves the complete configuration atomically', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'PUT', '/api/delivery/subtotal-pricing', SUGGESTED_CONFIG, staffToken);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const get = await request(port, 'GET', '/api/delivery/subtotal-pricing', undefined, staffToken);
    assert.equal(get.body.data.freeDeliveryThreshold, 150);
    assert.equal(get.body.data.ranges.length, 3);
  });
});

test('PUT with an invalid configuration is rejected with a code and does not partially save', async () => {
  await withServer(async (port) => {
    // Establish a known-good baseline first.
    await request(port, 'PUT', '/api/delivery/subtotal-pricing', SUGGESTED_CONFIG, staffToken);

    const invalid = {
      freeDeliveryThreshold: 150,
      ranges: [
        { minSubtotal: 0, maxSubtotal: 50, deliveryFee: 15 },
        // Gap: 60 instead of 50 — and this range is otherwise valid, so a
        // non-atomic writer would have already inserted range #1 above.
        { minSubtotal: 60, maxSubtotal: 150, deliveryFee: 5 },
      ],
    };
    const res = await request(port, 'PUT', '/api/delivery/subtotal-pricing', invalid, staffToken);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'DELIVERY_PRICING_GAP');

    const get = await request(port, 'GET', '/api/delivery/subtotal-pricing', undefined, staffToken);
    assert.equal(get.body.data.ranges.length, 3, 'the old valid configuration must remain untouched');
    assert.equal(get.body.data.ranges[0].deliveryFee, 15);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Runtime pricing via POST /checkout/prepare
// ─────────────────────────────────────────────────────────────────────

async function prepareDelivery(port: number, addressId: string) {
  return request(port, 'POST', '/api/checkout/prepare', {
    lang: 'en', addressId, selectedFulfillmentType: 'DELIVERY',
    items: [{ productId, quantity: 1 }],
  }, customerToken);
}

test('exact lower boundary (minSubtotal inclusive): 50.00 matches the SECOND range, not the first', async () => {
  await setPrice(50.0);
  await withServer(async (port) => {
    const res = await prepareDelivery(port, insideAddressId);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const d = res.body.data;
    assert.equal(d.pricing.subtotal, 50);
    assert.equal(d.pricing.baseDeliveryFee, 10);
    assert.equal(d.pricing.deliveryFee, 10);
    assert.equal(d.delivery.matchedSubtotalRule.minSubtotal, 50);
    assert.equal(d.delivery.pricingRuleApplied, 'SUBTOTAL_RANGE');
  });
});

test('just below the boundary: 49.99 matches the FIRST range', async () => {
  await setPrice(49.99);
  await withServer(async (port) => {
    const res = await prepareDelivery(port, insideAddressId);
    const d = res.body.data;
    assert.equal(d.pricing.subtotal, 49.99);
    assert.equal(d.pricing.deliveryFee, 15);
    assert.equal(d.delivery.matchedSubtotalRule.maxSubtotal, 50);
  });
});

test('every configured range is reachable: 0, 50-99.99, 100-149.99', async () => {
  await withServer(async (port) => {
    const cases: Array<[number, number]> = [
      [0.01, 15],
      [75, 10],
      [99.99, 10],
      [100, 5],
      [149.99, 5],
    ];
    for (const [price, expectedFee] of cases) {
      await setPrice(price);
      const res = await prepareDelivery(port, insideAddressId);
      assert.equal(res.body.data.pricing.deliveryFee, expectedFee, `subtotal ${price} should charge ${expectedFee}`);
    }
  });
});

test('free-delivery threshold: 150.00 exactly is free; 170 is free; matchedSubtotalRule is null', async () => {
  await withServer(async (port) => {
    for (const price of [150, 170]) {
      await setPrice(price);
      const res = await prepareDelivery(port, insideAddressId);
      const d = res.body.data;
      assert.equal(d.pricing.baseDeliveryFee, 0);
      assert.equal(d.pricing.deliveryFee, 0);
      assert.equal(d.delivery.pricingRuleApplied, 'FREE_DELIVERY_THRESHOLD');
      assert.equal(d.delivery.matchedSubtotalRule, null);
      assert.equal(d.delivery.freeDeliveryApplied, true);
      assert.equal(d.delivery.freeDeliveryThreshold, 150);
    }
  });
});

test('decimal subtotal (123.45 from 41.15 x 3) matches the correct range exactly', async () => {
  await setPrice(41.15);
  await withServer(async (port) => {
    const res = await request(port, 'POST', '/api/checkout/prepare', {
      lang: 'en', addressId: insideAddressId, selectedFulfillmentType: 'DELIVERY',
      items: [{ productId, quantity: 3 }],
    }, customerToken);
    const d = res.body.data;
    assert.equal(d.pricing.subtotal, 123.45);
    assert.equal(d.pricing.deliveryFee, 5);
  });
});

test('cart quantity change moves the subtotal into a different range', async () => {
  await setPrice(30);
  await withServer(async (port) => {
    const one = await request(port, 'POST', '/api/checkout/prepare', {
      lang: 'en', addressId: insideAddressId, selectedFulfillmentType: 'DELIVERY',
      items: [{ productId, quantity: 1 }],
    }, customerToken);
    assert.equal(one.body.data.pricing.subtotal, 30);
    assert.equal(one.body.data.pricing.deliveryFee, 15);

    const three = await request(port, 'POST', '/api/checkout/prepare', {
      lang: 'en', addressId: insideAddressId, selectedFulfillmentType: 'DELIVERY',
      items: [{ productId, quantity: 3 }],
    }, customerToken);
    assert.equal(three.body.data.pricing.subtotal, 90);
    assert.equal(three.body.data.pricing.deliveryFee, 10);
  });
});

test('Pickup always has a zero delivery fee, regardless of subtotal', async () => {
  await setPrice(30);
  await withServer(async (port) => {
    const res = await request(port, 'POST', '/api/checkout/prepare', {
      lang: 'en', selectedFulfillmentType: 'PICKUP',
      items: [{ productId, quantity: 1 }],
    }, customerToken);
    const d = res.body.data;
    assert.equal(d.pricing.baseDeliveryFee, 0);
    assert.equal(d.pricing.deliveryFee, 0);
  });
});

test('an outside-coverage address blocks delivery with no fee computed', async () => {
  await setPrice(30);
  await withServer(async (port) => {
    const res = await prepareDelivery(port, outsideAddressId);
    const d = res.body.data;
    assert.equal(d.delivery.withinCoverage, false);
    assert.ok(d.blockers.some((b: any) => b.code === 'OUTSIDE_COVERAGE'));
  });
});

test('no subtotal-pricing configuration at all blocks delivery clearly', async () => {
  await setPrice(30);
  await prisma.deliverySubtotalRange.deleteMany({});
  await prisma.deliverySubtotalPricingSettings.deleteMany({});
  try {
    await withServer(async (port) => {
      const res = await prepareDelivery(port, insideAddressId);
      const d = res.body.data;
      assert.equal(d.delivery.available, false);
      assert.ok(d.blockers.some((b: any) => b.code === 'FULFILLMENT_UNAVAILABLE'));
    });
  } finally {
    await replaceDeliverySubtotalPricing(SUGGESTED_CONFIG);
  }
});

// ─────────────────────────────────────────────────────────────────────
// Subscription delivery benefits — applied AFTER the base fee
// ─────────────────────────────────────────────────────────────────────

async function giveSubscription(benefitType: 'FREE_DELIVERY' | 'DISCOUNTED_DELIVERY' | 'CAPPED_DELIVERY', extra: { discountValue?: number; cappedFee?: number }) {
  const plan = await prisma.subscriptionPlan.create({
    data: {
      name: `Subtotal Pricing Sub Plan ${TAG}`, nameAr: `خطة ${TAG}`, price: 1, durationDays: 30,
      benefitType, discountValue: extra.discountValue ?? null, cappedFee: extra.cappedFee ?? null, isActive: true,
    },
  });
  subscriptionPlanId = plan.id;
  await prisma.customerSubscription.upsert({
    where: { customerId },
    create: {
      customerId, planId: plan.id, startDate: new Date(), expiryDate: new Date(Date.now() + 30 * 86400_000),
      status: 'ACTIVE', paymentMethod: 'CASH_ON_DELIVERY',
    },
    update: { planId: plan.id, status: 'ACTIVE', expiryDate: new Date(Date.now() + 30 * 86400_000) },
  });
}

async function clearSubscription() {
  await prisma.customerSubscription.deleteMany({ where: { customerId } });
  if (subscriptionPlanId) {
    await prisma.subscriptionPlan.delete({ where: { id: subscriptionPlanId } }).catch(() => {});
    subscriptionPlanId = '';
  }
}

test('FREE_DELIVERY subscription zeroes the fee regardless of the matched range', async () => {
  await setPrice(30); // base fee would be 15
  await giveSubscription('FREE_DELIVERY', {});
  try {
    await withServer(async (port) => {
      const res = await prepareDelivery(port, insideAddressId);
      const d = res.body.data;
      assert.equal(d.pricing.baseDeliveryFee, 15);
      assert.equal(d.pricing.deliveryFee, 0);
      assert.equal(d.pricing.subscriptionDiscount, 15);
      assert.equal(d.delivery.pricingRuleApplied, 'SUBSCRIPTION');
    });
  } finally {
    await clearSubscription();
  }
});

test('DISCOUNTED_DELIVERY subtracts the discount from the base fee, floored at 0', async () => {
  await setPrice(30); // base fee 15
  await giveSubscription('DISCOUNTED_DELIVERY', { discountValue: 20 }); // 15 - 20 -> floored at 0
  try {
    await withServer(async (port) => {
      const res = await prepareDelivery(port, insideAddressId);
      const d = res.body.data;
      assert.equal(d.pricing.baseDeliveryFee, 15);
      assert.equal(d.pricing.deliveryFee, 0);
    });
  } finally {
    await clearSubscription();
  }
});

test('CAPPED_DELIVERY caps the fee at the plan value when the base fee is higher', async () => {
  await setPrice(30); // base fee 15
  await giveSubscription('CAPPED_DELIVERY', { cappedFee: 8 });
  try {
    await withServer(async (port) => {
      const res = await prepareDelivery(port, insideAddressId);
      const d = res.body.data;
      assert.equal(d.pricing.baseDeliveryFee, 15);
      assert.equal(d.pricing.deliveryFee, 8);
      assert.equal(d.pricing.subscriptionDiscount, 7);
    });
  } finally {
    await clearSubscription();
  }
});

test('subscription free-delivery threshold still applies before the benefit (base fee already 0)', async () => {
  await setPrice(170); // above threshold -> base fee 0
  await giveSubscription('CAPPED_DELIVERY', { cappedFee: 8 });
  try {
    await withServer(async (port) => {
      const res = await prepareDelivery(port, insideAddressId);
      const d = res.body.data;
      assert.equal(d.pricing.baseDeliveryFee, 0);
      assert.equal(d.pricing.deliveryFee, 0);
      assert.equal(d.delivery.freeDeliveryApplied, true);
    });
  } finally {
    await clearSubscription();
  }
});

// ─────────────────────────────────────────────────────────────────────
// Order creation: admin config changes between prepare and order creation
// ─────────────────────────────────────────────────────────────────────

test('CHECKOUT_CHANGED when the admin edits delivery pricing after prepare — no order is created', async () => {
  await setPrice(30); // fee 15 under the seeded config
  await withServer(async (port) => {
    const prepared = await prepareDelivery(port, insideAddressId);
    assert.equal(prepared.body.data.pricing.deliveryFee, 15);
    const sessionId = prepared.body.data.checkoutSessionId;

    // Admin changes the fee for this exact range.
    await replaceDeliverySubtotalPricing({
      freeDeliveryThreshold: 150,
      ranges: [
        { minSubtotal: 0, maxSubtotal: 50, deliveryFee: 25 },
        { minSubtotal: 50, maxSubtotal: 100, deliveryFee: 10 },
        { minSubtotal: 100, maxSubtotal: 150, deliveryFee: 5 },
      ],
    });

    const countBefore = await prisma.order.count();
    const orderRes = await request(port, 'POST', '/api/orders', {
      checkoutSessionId: sessionId, paymentMethod: 'CASH_ON_DELIVERY',
      notes: '', replacementPreference: '', pickupType: null, scheduledPickupDate: null, scheduledPickupSlotId: null,
    }, customerToken);
    assert.equal(orderRes.status, 409);
    assert.equal(orderRes.body.code, 'CHECKOUT_CHANGED');
    const countAfter = await prisma.order.count();
    assert.equal(countAfter, countBefore, 'no order should be created when pricing drifted');

    // Re-prepare and confirm the new fee, then place successfully — proves
    // the snapshot stored on the resulting order reflects the CURRENT config.
    const reprepared = await prepareDelivery(port, insideAddressId);
    assert.equal(reprepared.body.data.pricing.deliveryFee, 25);
    const finalOrder = await request(port, 'POST', '/api/orders', {
      checkoutSessionId: reprepared.body.data.checkoutSessionId, paymentMethod: 'CASH_ON_DELIVERY',
      notes: '', replacementPreference: '', pickupType: null, scheduledPickupDate: null, scheduledPickupSlotId: null,
    }, customerToken);
    assert.equal(finalOrder.status, 201, JSON.stringify(finalOrder.body));
    createdOrderIds.add(finalOrder.body.data.id);
    assert.equal(Number(finalOrder.body.data.deliveryFee), 25);

    const dbOrder = await prisma.order.findUnique({ where: { id: finalOrder.body.data.id } });
    const snapshot = dbOrder?.deliveryPricingSnapshot as any;
    assert.equal(snapshot.pricingRuleApplied, 'SUBTOTAL_RANGE');
    assert.equal(snapshot.matchedSubtotalRule.deliveryFee, 25);

    // Restore the seeded config for subsequent tests.
    await replaceDeliverySubtotalPricing(SUGGESTED_CONFIG);
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
