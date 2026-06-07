import { prisma } from '../../lib/prisma';
import { quoteDelivery } from '../delivery/delivery.service';

export interface SubscriptionEligibility {
  eligible: boolean;
  hasLocation: boolean;
  distanceKm: number | null;
  maxDeliveryKm: number | null;
  branchConfigured: boolean;
  message?: string;
}

/**
 * Subscription plans are only offered when the customer's location is within
 * the admin-configured max delivery distance. Pickup is always available, but
 * subscriptions are a delivery benefit so they don't make sense out of range.
 *
 * Passing only one of lat/lng (or neither) reports `hasLocation: false` — the
 * frontend prompts the customer to choose a location first.
 */
export async function getSubscriptionEligibility(
  customerLat?: number,
  customerLng?: number,
): Promise<SubscriptionEligibility> {
  const quote = await quoteDelivery({ customerLat, customerLng });
  const hasLocation = customerLat != null && customerLng != null;
  if (!quote.branchConfigured) {
    return {
      eligible: false,
      hasLocation,
      distanceKm: null,
      maxDeliveryKm: quote.maxDeliveryKm,
      branchConfigured: false,
      message: 'Subscription plans are not available — the marketplace is still being set up.',
    };
  }
  if (!hasLocation) {
    return {
      eligible: false,
      hasLocation: false,
      distanceKm: null,
      maxDeliveryKm: quote.maxDeliveryKm,
      branchConfigured: true,
      message: 'Choose your location first to check subscription availability.',
    };
  }
  if (!quote.withinRange) {
    return {
      eligible: false,
      hasLocation: true,
      distanceKm: quote.distanceKm,
      maxDeliveryKm: quote.maxDeliveryKm,
      branchConfigured: true,
      message: 'Subscription is not available because your location is outside our delivery coverage.',
    };
  }
  return {
    eligible: true,
    hasLocation: true,
    distanceKm: quote.distanceKm,
    maxDeliveryKm: quote.maxDeliveryKm,
    branchConfigured: true,
  };
}

export async function getPlans(activeOnly = true) {
  return prisma.subscriptionPlan.findMany({
    where: activeOnly ? { isActive: true } : {},
    orderBy: { price: 'asc' },
  });
}

export async function getPlanById(id: string) {
  return prisma.subscriptionPlan.findUnique({ where: { id } });
}

export async function createPlan(data: {
  name: string;
  nameAr: string;
  price: number;
  durationDays: number;
  benefitType: 'FREE_DELIVERY' | 'DISCOUNTED_DELIVERY' | 'CAPPED_DELIVERY';
  discountValue?: number;
  cappedFee?: number;
  maxFreeDeliveries?: number;
}) {
  return prisma.subscriptionPlan.create({ data });
}

export async function updatePlan(id: string, data: object) {
  return prisma.subscriptionPlan.update({ where: { id }, data });
}

export async function togglePlan(id: string, isActive: boolean) {
  return prisma.subscriptionPlan.update({ where: { id }, data: { isActive } });
}

export async function subscribeToPlan(
  customerId: string,
  planId: string,
  paymentMethod: string,
  location?: { customerLat?: number; customerLng?: number },
) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) throw new Error('Plan not available');

  // Distance gate — both for explicit lat/lng and the customer's default
  // saved address. If neither resolves to coords inside coverage, refuse.
  let lat = location?.customerLat;
  let lng = location?.customerLng;
  if (lat == null || lng == null) {
    const defaultAddr = await prisma.customerAddress.findFirst({
      where: { customerId, isDefault: true },
      select: { latitude: true, longitude: true },
    });
    if (defaultAddr) {
      lat = Number(defaultAddr.latitude);
      lng = Number(defaultAddr.longitude);
    }
  }
  const eligibility = await getSubscriptionEligibility(lat, lng);
  if (!eligibility.eligible) {
    throw new Error(
      eligibility.message ?? 'Subscription is not available for your location.',
    );
  }

  const existing = await prisma.customerSubscription.findUnique({ where: { customerId } });
  if (existing && existing.status === 'ACTIVE') {
    throw new Error('You already have an active subscription');
  }

  const startDate = new Date();
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + plan.durationDays);

  const data = {
    planId,
    startDate,
    expiryDate,
    status: 'PENDING_PAYMENT' as const,
    paymentMethod,
  };

  if (existing) {
    return prisma.customerSubscription.update({ where: { customerId }, data });
  }
  return prisma.customerSubscription.create({ data: { ...data, customerId } });
}

export async function getActiveSubscription(customerId: string) {
  return prisma.customerSubscription.findFirst({
    where: {
      customerId,
      status: 'ACTIVE',
      expiryDate: { gt: new Date() },
    },
    include: { plan: true },
  });
}

export async function confirmSubscription(subscriptionId: string, adminId: string) {
  return prisma.customerSubscription.update({
    where: { id: subscriptionId },
    data: {
      status: 'ACTIVE',
      adminConfirmedAt: new Date(),
      adminConfirmedBy: adminId,
    },
  });
}

export async function cancelSubscription(customerId: string) {
  return prisma.customerSubscription.updateMany({
    where: { customerId, status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
    data: { status: 'CANCELLED' },
  });
}

export async function listSubscribers(opts: {
  status?: 'PENDING_PAYMENT' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  page?: number;
  limit?: number;
} = {}) {
  const { status, page = 1, limit = 20 } = opts;
  const where = status ? { status } : {};
  const [subs, total] = await Promise.all([
    prisma.customerSubscription.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        customer: { select: { id: true, name: true, mobile: true } },
        plan: { select: { id: true, name: true, benefitType: true, durationDays: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.customerSubscription.count({ where }),
  ]);
  return { subscriptions: subs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}
