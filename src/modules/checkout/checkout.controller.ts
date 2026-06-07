import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth.middleware';
import { ok, badRequest } from '../../lib/response';
import { quoteDelivery } from '../delivery/delivery.service';
import { prisma } from '../../lib/prisma';

const calculateSchema = z.object({
  customerLatitude: z.number().min(-90).max(90).nullable().optional(),
  customerLongitude: z.number().min(-180).max(180).nullable().optional(),
  customerSubscriptionStatus: z
    .enum(['ACTIVE', 'NONE', 'EXPIRED', 'PENDING_PAYMENT', 'CANCELLED'])
    .nullable()
    .optional(),
  selectedFulfillmentType: z.enum(['DELIVERY', 'PICKUP']).nullable().optional(),
  cartSubtotal: z.number().nonnegative().nullable().optional(),
});

/**
 * Single source of truth for the customer-facing checkout. Returns whatever
 * fulfillment options are actually allowed RIGHT NOW (`availableFulfillmentTypes`),
 * the calculated distance, the matched pricing range, and the fee.
 *
 * Subscription status is reported by the client but cross-checked server-side
 * against the customer's actual ACTIVE subscription so a forged client value
 * can't unlock free delivery.
 */
export async function calculateDelivery(req: AuthRequest, res: Response): Promise<void> {
  try {
    const body = calculateSchema.parse(req.body);

    // Resolve the real subscription status server-side. If the authenticated
    // user has an ACTIVE subscription, use that — we ignore the client claim.
    let hasActiveSubscription = false;
    let subscriptionBenefitType: string | null = null;
    let subscriptionDiscountValue: number | null = null;
    let subscriptionCappedFee: number | null = null;

    if (req.user) {
      const sub = await prisma.customerSubscription.findFirst({
        where: {
          customerId: req.user.userId,
          status: 'ACTIVE',
          expiryDate: { gt: new Date() },
        },
        include: { plan: true },
      });
      if (sub) {
        hasActiveSubscription = true;
        subscriptionBenefitType = sub.plan.benefitType;
        subscriptionDiscountValue = sub.plan.discountValue ? Number(sub.plan.discountValue) : null;
        subscriptionCappedFee = sub.plan.cappedFee ? Number(sub.plan.cappedFee) : null;
      }
    } else if (body.customerSubscriptionStatus === 'ACTIVE') {
      // Anonymous claim of ACTIVE subscription — we honour the flag but can't
      // load benefits, so treat as FREE_DELIVERY at most. In practice the
      // frontend only sends 'NONE' for anonymous users.
      hasActiveSubscription = true;
    }

    const quote = await quoteDelivery({
      customerLat: body.customerLatitude ?? undefined,
      customerLng: body.customerLongitude ?? undefined,
      cartSubtotal: body.cartSubtotal ?? undefined,
      hasActiveSubscription,
      subscriptionBenefitType,
      subscriptionDiscountValue,
      subscriptionCappedFee,
    });

    // Honour the customer's selected fulfillment by reporting the right fee:
    // a pickup checkout always pays 0 for delivery, even when delivery would
    // otherwise be available.
    const selected = body.selectedFulfillmentType ?? null;
    const effectiveFee = selected === 'PICKUP' ? 0 : quote.fee;

    ok(res, {
      distanceKm: quote.distanceKm,
      isWithinDeliveryRange: quote.withinRange,
      deliveryAvailable: quote.deliveryAvailable,
      pickupAvailable: quote.pickupAvailable,
      deliveryFee: effectiveFee,
      matchedDistanceRule: quote.matchedRule,
      availableFulfillmentTypes: quote.availableFulfillmentTypes,
      selectedFulfillmentType: selected,
      hasActiveSubscription: quote.hasActiveSubscription,
      pricingRuleApplied: quote.pricingRuleApplied,
      branchConfigured: quote.branchConfigured,
      maxDeliveryKm: quote.maxDeliveryKm,
      reason: quote.reason,
      message: quote.message,
    });
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}
