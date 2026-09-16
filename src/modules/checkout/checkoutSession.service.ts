import { FulfillmentType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import type { CheckoutPreview, CheckoutPreviewItemInput } from './checkoutPreview.service';

/**
 * Mirrors the existing `OtpCode` expire/consume pattern (`expiresAt` +
 * `usedAt`) rather than inventing a new one — see `auth.service.verifyOtp`.
 */
const SESSION_TTL_MINUTES = 15;

export class CheckoutSessionError extends Error {
  code: 'SESSION_NOT_FOUND' | 'SESSION_EXPIRED' | 'SESSION_CONSUMED';
  constructor(code: CheckoutSessionError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export async function createCheckoutSession(params: {
  customerId: string;
  addressId?: string;
  fulfillmentType: FulfillmentType;
  lang: string;
  items: CheckoutPreviewItemInput[];
  preview: CheckoutPreview;
}) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_MINUTES * 60_000);
  return prisma.checkoutSession.create({
    data: {
      customerId: params.customerId,
      addressId: params.addressId ?? null,
      fulfillmentType: params.fulfillmentType,
      lang: params.lang,
      itemsSnapshot: params.items as unknown as Prisma.InputJsonValue,
      subtotal: params.preview.subtotal,
      baseDeliveryFee: params.preview.baseDeliveryFee,
      deliveryFee: params.preview.deliveryFee,
      subscriptionDiscount: params.preview.subscriptionDiscount,
      total: params.preview.total,
      deliveryAvailable: params.preview.delivery.available,
      availableTypesSnapshot: params.preview.fulfillment.availableTypes,
      minimumOrderSatisfied: params.preview.minimumOrder.satisfied,
      hasBlockers: params.preview.blockers.length > 0,
      expiresAt,
    },
  });
}

/** Ownership + expiration + consumption check — a session may only ever be used once. */
export async function getValidCheckoutSession(customerId: string, sessionId: string) {
  const session = await prisma.checkoutSession.findFirst({ where: { id: sessionId, customerId } });
  if (!session) {
    throw new CheckoutSessionError('SESSION_NOT_FOUND', 'Checkout session not found.');
  }
  if (session.usedAt) {
    throw new CheckoutSessionError('SESSION_CONSUMED', 'This checkout session has already been used.');
  }
  if (session.expiresAt.getTime() < Date.now()) {
    throw new CheckoutSessionError('SESSION_EXPIRED', 'This checkout session has expired — please prepare checkout again.');
  }
  return session;
}

export async function consumeCheckoutSession(sessionId: string) {
  await prisma.checkoutSession.update({ where: { id: sessionId }, data: { usedAt: new Date() } });
}
