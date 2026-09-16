import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { generateOtpCode, getOtpExpiry, sendOtp } from '../../lib/otp';
import { signToken } from '../../lib/jwt';
import { config } from '../../config';
import { normalizeMobile } from '../../lib/phone';
import { logAction } from '../audit/audit.service';

const STAFF_ROLES = ['SUPER_ADMIN', 'PICKER', 'DRIVER'] as const;

/**
 * Create a fresh customer account for a normalized mobile, tolerating the
 * concurrency race where two simultaneous sign-in attempts both find no
 * active account and both try to create one. The database's partial-unique
 * `mobileActive` index (active accounts only) is the actual guard — this
 * just turns the loser's constraint violation into "use the winner's row"
 * instead of a raw 500.
 */
async function createActiveCustomer(mobile: string) {
  try {
    return await prisma.user.create({ data: { mobile } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const winner = await prisma.user.findFirst({ where: { mobile, deletedAt: null } });
      if (winner) return winner;
    }
    throw err;
  }
}

export async function requestOtp(mobileRaw: string): Promise<{ code?: string }> {
  const mobile = normalizeMobile(mobileRaw);

  // Only an ACTIVE account may ever be found here — a soft-deleted account
  // with the same number is invisible to sign-in and is never reactivated.
  let user = await prisma.user.findFirst({ where: { mobile, deletedAt: null } });

  if (!user) {
    user = await createActiveCustomer(mobile);
  }

  if (user.role !== 'CUSTOMER') {
    // Staff accounts must use the staff login (email + password), not OTP.
    throw new Error('This number is registered as a staff account. Use staff login.');
  }

  if (!user.isActive) throw new Error('Account is deactivated');

  // Invalidate previous unused OTPs
  await prisma.otpCode.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const code = generateOtpCode();
  const expiresAt = getOtpExpiry();

  await prisma.otpCode.create({
    data: { userId: user.id, code, expiresAt },
  });

  await sendOtp(mobile, code);

  // Return the code so the marketplace can show the MVP login badge. Gated by
  // `otp.exposeCode` (default ON) — also always on in dev. Turn off via
  // OTP_EXPOSE_CODE=false once a real SMS gateway is in place.
  return config.isDev || config.otp.exposeCode ? { code } : {};
}

export async function verifyOtp(
  mobileRaw: string,
  code: string
): Promise<{ token: string; user: object }> {
  const mobile = normalizeMobile(mobileRaw);
  // Active-only lookup — a stale OTP tied to a since-deleted account's ID
  // will simply fail the code check below, since it's scoped to whatever
  // (if any) currently-active row this number resolves to.
  const user = await prisma.user.findFirst({ where: { mobile, deletedAt: null } });
  if (!user) throw new Error('User not found');
  if (user.role !== 'CUSTOMER') {
    throw new Error('Staff accounts must use the staff login.');
  }
  if (!user.isActive) throw new Error('Account is deactivated');

  const otp = await prisma.otpCode.findFirst({
    where: {
      userId: user.id,
      code,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!otp) throw new Error('Invalid or expired OTP');

  await prisma.otpCode.update({
    where: { id: otp.id },
    data: { usedAt: new Date() },
  });

  const token = signToken({ userId: user.id, role: user.role, scope: 'customer' });

  return {
    token,
    user: {
      id: user.id,
      mobile: user.mobile,
      name: user.name,
      role: user.role,
    },
  };
}

export async function staffLogin(
  email: string,
  password: string
): Promise<{ token: string; user: object }> {
  const normalisedEmail = email.toLowerCase().trim();
  const user = await prisma.user.findUnique({ where: { email: normalisedEmail } });

  // Generic error so we do not leak whether the email exists.
  const invalid = new Error('Invalid email or password');

  if (!user || !user.passwordHash) throw invalid;
  if (!STAFF_ROLES.includes(user.role as (typeof STAFF_ROLES)[number])) {
    // Customers must use the OTP flow.
    throw invalid;
  }
  if (!user.isActive) throw new Error('Account is deactivated');

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) throw invalid;

  const token = signToken({ userId: user.id, role: user.role, scope: 'staff' });

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role,
    },
  };
}

export async function getMe(userId: string, lang: 'ar' | 'en' = 'ar') {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      mobile: true,
      email: true,
      username: true,
      name: true,
      nameAr: true,
      role: true,
      isActive: true,
      createdAt: true,
      subscription: {
        select: {
          id: true,
          status: true,
          expiryDate: true,
          plan: { select: { name: true, benefitType: true } },
        },
      },
    },
  });
  if (!user) throw new Error('User not found');
  const { nameAr, ...rest } = user;
  return { ...rest, name: lang === 'ar' ? (nameAr || user.name) : (user.name || nameAr) };
}

/**
 * Customer self-deletion (`DELETE /auth/me`). Soft-deletes the CURRENTLY
 * AUTHENTICATED account only — sets `deletedAt`, which:
 *   - makes `mobile` free for a brand-new account to claim (see the
 *     `mobileActive` generated column / partial-unique index), while this
 *     row keeps its original `mobile` value for legitimate historical
 *     context (e.g. an order placed under this ID still shows a contact
 *     number to staff) — it is never reassigned or exposed to another
 *     account;
 *   - is checked by `authenticate*` middleware on every request, so the
 *     bearer token this account is currently using stops working
 *     immediately, with no separate session/refresh-token store to revoke
 *     (this API has none — see `docs/paths/auth.ts`);
 *   - invalidates any outstanding (unused) OTP codes, the only other
 *     standing "authentication credential" a customer has in this
 *     password-less flow.
 *
 * Deliberately does NOT touch orders, addresses, favorites, cart, or
 * subscription rows — those are business records preserved under this same
 * immutable ID (never cascade-deleted, never transferred). Deeper PII
 * anonymization/hard-deletion beyond this is a separate policy decision the
 * project has not defined yet; this function implements soft-delete +
 * credential revocation only, not a full data-erasure guarantee.
 */
export async function deleteAccount(userId: string): Promise<{ deletedAt: Date }> {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!user) throw new Error('Account not found');
    if (user.role !== 'CUSTOMER') {
      throw new Error('Only customer accounts can be deleted through this endpoint');
    }
    if (user.deletedAt) throw new Error('Account already deleted');

    const deletedAt = new Date();
    await tx.user.update({ where: { id: userId }, data: { deletedAt, isActive: false } });
    await tx.otpCode.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: deletedAt },
    });

    await logAction(
      {
        actorId: userId,
        actorRole: 'CUSTOMER',
        action: 'account.delete',
        entityType: 'user',
        entityId: userId,
        changes: { deletedAt: deletedAt.toISOString() },
      },
      tx,
    );

    return { deletedAt };
  });
}
