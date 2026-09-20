/**
 * Tests for admin-managed contact numbers (`ContactSettings`):
 *   - Get-or-create default row on first read
 *   - Admin update via PUT, reflected immediately on the public GET
 *   - Clearing a field with `null`
 *   - Auth: GET is public, PUT requires a staff session
 *
 * Runs against the REAL dev database. The live contact settings row is
 * saved/restored around the suite so it leaves the DB exactly as it found
 * it. The staff/customer fixtures are deleted in `finally`.
 *
 * Run:
 *   cd backend && npx ts-node --transpile-only tests/contact/contactSettings.test.ts
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import app from '../../src/app';
import { prisma } from '../../src/lib/prisma';
import { signToken } from '../../src/lib/jwt';
import { getContactSettings, updateContactSettings } from '../../src/modules/contact/contact.service';

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

// ── Fixtures ────────────────────────────────────────────────────────
const createdUserIds = new Set<string>();
let originalContactSettings: Awaited<ReturnType<typeof getContactSettings>> | null = null;

let staffToken = '';
let customerToken = '';

async function setup() {
  // Save the live contact settings row so we can restore it verbatim.
  originalContactSettings = await getContactSettings();

  const staff = await prisma.user.create({
    data: { role: 'SUPER_ADMIN', email: `contact-settings-test-${TAG}@example.com`, name: 'Contact Settings Test Staff' },
  });
  createdUserIds.add(staff.id);
  staffToken = signToken({ userId: staff.id, role: 'SUPER_ADMIN', scope: 'staff' });

  const customer = await prisma.user.create({
    data: { role: 'CUSTOMER', mobile: `+9665${TAG}`.slice(0, 13), name: 'Contact Settings Test Customer', isActive: true },
  });
  createdUserIds.add(customer.id);
  customerToken = signToken({ userId: customer.id, role: 'CUSTOMER', scope: 'customer' });
}

async function cleanup() {
  const ids = Array.from(createdUserIds);
  if (ids.length) {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }

  // Restore the live contact settings row exactly as found.
  if (originalContactSettings) {
    await updateContactSettings({
      phone: originalContactSettings.phone,
      whatsapp: originalContactSettings.whatsapp,
    });
  }
}

// ─────────────────────────────────────────────────────────────────────

test('GET /contact-us is public and returns a concrete row (get-or-create)', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'GET', '/api/contact-us');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok('phone' in (res.body.data as any));
    assert.ok('whatsapp' in (res.body.data as any));
  });
});

test('PUT /contact-us with no token is rejected (401)', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'PUT', '/api/contact-us', { phone: '+966500000000' });
    assert.equal(res.status, 401);
  });
});

test('PUT /contact-us with a customer token is rejected (403)', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'PUT', '/api/contact-us', { phone: '+966500000000' }, customerToken);
    assert.equal(res.status, 403);
  });
});

test('PUT /contact-us as staff saves both numbers, immediately visible on the public GET', async () => {
  await withServer(async (port) => {
    const put = await request(port, 'PUT', '/api/contact-us', {
      phone: '+966500000001',
      whatsapp: '+966500000002',
    }, staffToken);
    assert.equal(put.status, 200, JSON.stringify(put.body));
    assert.equal(put.body.data?.phone, '+966500000001');
    assert.equal(put.body.data?.whatsapp, '+966500000002');

    const get = await request(port, 'GET', '/api/contact-us');
    assert.equal(get.body.data?.phone, '+966500000001');
    assert.equal(get.body.data?.whatsapp, '+966500000002');
  });
});

test('omitting a field leaves it untouched', async () => {
  await withServer(async (port) => {
    await request(port, 'PUT', '/api/contact-us', {
      phone: '+966500000003',
      whatsapp: '+966500000004',
    }, staffToken);

    const partial = await request(port, 'PUT', '/api/contact-us', { phone: '+966500000005' }, staffToken);
    assert.equal(partial.status, 200, JSON.stringify(partial.body));
    assert.equal(partial.body.data?.phone, '+966500000005');
    assert.equal(partial.body.data?.whatsapp, '+966500000004', 'whatsapp must be unchanged when omitted');
  });
});

test('sending null clears a field', async () => {
  await withServer(async (port) => {
    await request(port, 'PUT', '/api/contact-us', {
      phone: '+966500000006',
      whatsapp: '+966500000007',
    }, staffToken);

    const cleared = await request(port, 'PUT', '/api/contact-us', { whatsapp: null }, staffToken);
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal(cleared.body.data?.phone, '+966500000006', 'untouched field must remain');
    assert.equal(cleared.body.data?.whatsapp, null);
  });
});

test('a value longer than 32 characters is rejected', async () => {
  await withServer(async (port) => {
    const res = await request(port, 'PUT', '/api/contact-us', { phone: '+'.repeat(40) }, staffToken);
    assert.equal(res.status, 400);
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
