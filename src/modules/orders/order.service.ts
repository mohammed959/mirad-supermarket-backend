import { OrderStatus, Prisma, FulfillmentType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { generateOrderNumber } from '../../lib/orderNumber';
import { CreateOrderInput } from './order.schema';
import {
  notifyOrderStatus,
  notifyPaymentUnderReview,
  notifyPaymentApproved,
  notifyPaymentRejected,
} from '../notifications/notification.service';
import { evaluatePromotionsForCart } from '../promotions/promotion.service';
import { quoteDelivery } from '../delivery/delivery.service';
import { logAction } from '../audit/audit.service';
import { getProductImageUrl } from '../../lib/productImage';
import { assertSlotIsBookable } from '../pickup/pickup.service';

export async function createOrder(customerId: string, input: CreateOrderInput) {
  const fulfillmentType: FulfillmentType = input.fulfillmentType ?? 'DELIVERY';
  const isPickup = fulfillmentType === 'PICKUP';

  if (isPickup && input.paymentMethod !== 'PAY_AT_BRANCH') {
    throw new Error('Pickup orders must use Pay at Branch.');
  }
  if (!isPickup && input.paymentMethod === 'PAY_AT_BRANCH') {
    throw new Error('Pay at Branch is only available for pickup orders.');
  }

  // ── Scheduled pickup validation ────────────────────────────────────
  // Resolved fields written to the Order at the bottom of this function.
  let scheduledFields: {
    pickupType: 'ASAP' | 'SCHEDULED';
    scheduledPickupDate?: Date;
    scheduledPickupStartTime?: string;
    scheduledPickupEndTime?: string;
    scheduledPickupSlotId?: string;
  } = { pickupType: 'ASAP' };

  if (input.pickupType === 'SCHEDULED') {
    if (!isPickup) {
      throw new Error('Scheduled pickup is only available for Pickup from Branch orders.');
    }
    if (!input.scheduledPickupDate || !input.scheduledPickupSlotId) {
      throw new Error('Pickup date and time slot are required for scheduled pickup.');
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.scheduledPickupDate);
    if (!m) throw new Error('Invalid pickup date.');
    const targetDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    targetDate.setHours(0, 0, 0, 0);

    // assertSlotIsBookable re-checks feature toggle, range, cutoff, today's
    // clock, and slot capacity against the database — the client value alone
    // is never trusted.
    const slot = await assertSlotIsBookable(input.scheduledPickupSlotId, targetDate);

    scheduledFields = {
      pickupType: 'SCHEDULED',
      scheduledPickupDate: targetDate,
      scheduledPickupStartTime: slot.startTime,
      scheduledPickupEndTime: slot.endTime,
      scheduledPickupSlotId: slot.id,
    };
  } else if (input.scheduledPickupDate || input.scheduledPickupSlotId) {
    throw new Error('scheduledPickupDate/slot is only valid when pickupType=SCHEDULED.');
  }

  // Validate addressId belongs to this customer. If the stored id is stale
  // (deleted address, different customer's id leftover in client storage),
  // drop it silently and fall back to deliveryLat/Lng — the order still goes
  // through instead of failing with a foreign-key violation.
  let addressId: string | undefined = input.addressId;
  if (addressId) {
    const owned = await prisma.customerAddress.findFirst({
      where: { id: addressId, customerId },
      select: { id: true },
    });
    if (!owned) addressId = undefined;
  }

  // Pickup orders have no delivery address; drop any stray address fields.
  if (isPickup) {
    addressId = undefined;
  } else if (!addressId && (input.deliveryLat === undefined || input.deliveryLng === undefined)) {
    throw new Error('Delivery location is required. Please choose a location on the map.');
  }

  // Resolve the actual delivery coordinates we'll use for distance + eligibility.
  let resolvedLat: number | undefined = isPickup ? undefined : input.deliveryLat;
  let resolvedLng: number | undefined = isPickup ? undefined : input.deliveryLng;
  if (!isPickup && addressId && (resolvedLat == null || resolvedLng == null)) {
    const addr = await prisma.customerAddress.findUnique({
      where: { id: addressId },
      select: { latitude: true, longitude: true },
    });
    if (addr) {
      resolvedLat = Number(addr.latitude);
      resolvedLng = Number(addr.longitude);
    }
  }

  // Load variants and validate stock
  const variantIds = input.items.map((i) => i.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, isActive: true },
    include: {
      product: { select: { id: true, categoryId: true, subcategoryId: true } },
    },
  });

  if (variants.length !== variantIds.length) {
    throw new Error('One or more products are unavailable');
  }

  // Build item data with prices
  const itemMap = new Map(input.items.map((i) => [i.variantId, i.quantity]));
  let subtotal = 0;
  const orderItems: Prisma.OrderItemCreateManyOrderInput[] = [];
  const evaluatorItems = [];

  for (const variant of variants) {
    const qty = itemMap.get(variant.id)!;
    const available = variant.stock - variant.reserved;
    if (available < qty) {
      throw new Error(`Insufficient stock for variant ${variant.sku}`);
    }
    const lineTotal = Number(variant.price) * qty;
    subtotal += lineTotal;
    orderItems.push({
      variantId: variant.id,
      quantity: qty,
      unitPrice: variant.price,
      total: lineTotal,
    });
    evaluatorItems.push({
      variantId: variant.id,
      quantity: qty,
      unitPrice: Number(variant.price),
      productId: variant.product.id,
      categoryId: variant.product.categoryId,
      subcategoryId: variant.product.subcategoryId,
    });
  }

  // Load delivery & minimum order settings
  const [_deliverySettings, minimumSettings, activeSubscription] = await Promise.all([
    prisma.deliveryPricingSettings.findFirst(),
    prisma.minimumOrderSettings.findFirst(),
    prisma.customerSubscription.findFirst({
      where: { customerId, status: 'ACTIVE', expiryDate: { gt: new Date() } },
      include: { plan: true },
    }),
  ]);

  if (minimumSettings?.enabled && subtotal < Number(minimumSettings.minimumAmount)) {
    throw new Error(
      `Minimum order is ${minimumSettings.minimumAmount} SAR. Current total: ${subtotal} SAR`
    );
  }

  // Evaluate promotions
  const promoResults = await evaluatePromotionsForCart({
    customerId,
    items: evaluatorItems,
    hasActiveSubscription: Boolean(activeSubscription),
  });

  const discountTotal = promoResults.reduce((sum, r) => sum + r.discountAmount, 0);

  // Compute distance + delivery eligibility. For pickup, distance is informational only.
  const quote = await quoteDelivery({
    customerLat: resolvedLat,
    customerLng: resolvedLng,
    cartSubtotal: subtotal,
    hasActiveSubscription: Boolean(activeSubscription),
    subscriptionBenefitType: activeSubscription?.plan.benefitType ?? null,
    subscriptionDiscountValue: activeSubscription?.plan.discountValue
      ? Number(activeSubscription.plan.discountValue)
      : null,
    subscriptionCappedFee: activeSubscription?.plan.cappedFee
      ? Number(activeSubscription.plan.cappedFee)
      : null,
  });

  if (!isPickup) {
    if (!quote.branchConfigured) {
      throw new Error('Delivery is not available yet — the branch location has not been set.');
    }
    if (!quote.deliveryEnabled) {
      throw new Error('Delivery is currently disabled. Please choose pickup from branch.');
    }
    if (!quote.deliveryAvailable) {
      throw new Error(
        quote.message ?? 'Home delivery is not available for your location. Please choose Pickup from Branch.',
      );
    }
    if (input.paymentMethod === 'CASH_ON_DELIVERY' && !quote.deliveryAvailable) {
      throw new Error('Cash on delivery is not available for your location.');
    }
  }

  // Pickup orders skip delivery — no fee is charged, regardless of settings.
  const deliveryFee = isPickup ? 0 : quote.fee;
  const total = Math.max(0, subtotal - discountTotal + deliveryFee);

  const order = await prisma.$transaction(async (tx) => {
    const newOrder = await tx.order.create({
      data: {
        orderNumber: generateOrderNumber(),
        customerId,
        fulfillmentType,
        addressId,
        paymentMethod: input.paymentMethod,
        paymentStatus:
          input.paymentMethod === 'BANK_TRANSFER' ? 'UNDER_REVIEW' : 'PENDING',
        notes: input.notes,
        replacementPreference: input.replacementPreference,
        deliveryLat: isPickup ? undefined : resolvedLat,
        deliveryLng: isPickup ? undefined : resolvedLng,
        distanceKm: isPickup ? undefined : quote.distanceKm ?? undefined,
        subscriptionApplied:
          !isPickup && Boolean(activeSubscription) && quote.pricingRuleApplied === 'SUBSCRIPTION',
        pickupType: scheduledFields.pickupType,
        scheduledPickupDate: scheduledFields.scheduledPickupDate,
        scheduledPickupStartTime: scheduledFields.scheduledPickupStartTime,
        scheduledPickupEndTime: scheduledFields.scheduledPickupEndTime,
        scheduledPickupSlotId: scheduledFields.scheduledPickupSlotId,
        subtotal,
        discountTotal,
        deliveryFee,
        total,
        items: { createMany: { data: orderItems } },
        statusHistory: {
          create: { status: 'NEW', createdBy: customerId },
        },
      },
      include: { items: true, statusHistory: true },
    });

    // Reserve stock for paid items
    for (const item of orderItems) {
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { reserved: { increment: item.quantity } },
      });
    }

    // Persist promotion usages + add free items
    for (const promo of promoResults) {
      await tx.orderPromotion.create({
        data: {
          orderId: newOrder.id,
          promotionId: promo.promotionId,
          promotionName: promo.promotionName,
          discountValue: promo.discountAmount,
          freeItems: promo.freeItems.length ? (promo.freeItems as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });

      if (promo.discountAmount > 0) {
        await tx.promotionUsage.create({
          data: {
            promotionId: promo.promotionId,
            customerId,
            orderId: newOrder.id,
            discountValue: promo.discountAmount,
          },
        });
      }

      await tx.promotion.update({
        where: { id: promo.promotionId },
        data: { usageCount: { increment: 1 } },
      });

      // Free items as OrderItem rows with isFreeItem=true
      for (const free of promo.freeItems) {
        const freeVariant = await tx.productVariant.findUnique({ where: { id: free.variantId } });
        if (!freeVariant) continue;
        const freeAvail = freeVariant.stock - freeVariant.reserved;
        const qty = Math.min(free.quantity, freeAvail);
        if (qty <= 0) continue;
        await tx.orderItem.create({
          data: {
            orderId: newOrder.id,
            variantId: free.variantId,
            quantity: qty,
            unitPrice: freeVariant.price,
            total: 0,
            isFreeItem: true,
          },
        });
        await tx.productVariant.update({
          where: { id: free.variantId },
          data: { reserved: { increment: qty } },
        });
      }
    }

    await notifyOrderStatus(customerId, newOrder.id, newOrder.orderNumber, 'NEW', tx);

    if (input.paymentMethod === 'BANK_TRANSFER') {
      await notifyPaymentUnderReview(customerId, newOrder.id, newOrder.orderNumber, tx);
    }

    return newOrder;
  });

  await logAction({
    actorId: customerId, actorRole: 'CUSTOMER',
    action: scheduledFields.pickupType === 'SCHEDULED' ? 'order.create.scheduled' : 'order.create',
    entityType: 'order', entityId: order.id,
    changes: {
      subtotal, discountTotal, deliveryFee, total,
      promotionsApplied: promoResults.length,
      fulfillmentType,
      pickupType: scheduledFields.pickupType,
      ...(scheduledFields.scheduledPickupDate && {
        scheduledPickupDate: scheduledFields.scheduledPickupDate.toISOString().slice(0, 10),
        scheduledPickupSlotId: scheduledFields.scheduledPickupSlotId,
        scheduledPickupWindow: `${scheduledFields.scheduledPickupStartTime}-${scheduledFields.scheduledPickupEndTime}`,
      }),
    },
  });

  return order;
}

// ─── Car pickup details (curbside) ───────────────────────────────────
// Optional vehicle info the customer can fill in AFTER placing a pickup
// order. Locked once the order is COMPLETED or CANCELLED. No field is
// required; partial updates are supported.

const LOCKED_STATUSES_FOR_CAR_DETAILS: OrderStatus[] = ['COMPLETED', 'CANCELLED', 'REJECTED'];

export interface CarPickupInput {
  carPlateNumber?: string | null;
  carBrand?: string | null;
  carColor?: string | null;
  pickupCustomerNote?: string | null;
}

function cleanField(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined; // not provided → don't touch column
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

async function loadCustomerPickupOrder(customerId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId },
    select: {
      id: true, orderNumber: true, fulfillmentType: true, status: true,
      carPlateNumber: true, carBrand: true, carColor: true, pickupCustomerNote: true,
    },
  });
  if (!order) throw new Error('Order not found');
  if (order.fulfillmentType !== 'PICKUP') {
    throw new Error('Car pickup details are only available for Pickup from Branch orders.');
  }
  if (LOCKED_STATUSES_FOR_CAR_DETAILS.includes(order.status)) {
    throw new Error('This order can no longer be updated.');
  }
  return order;
}

export async function updateCarPickupDetails(
  customerId: string,
  orderId: string,
  input: CarPickupInput,
) {
  const order = await loadCustomerPickupOrder(customerId, orderId);

  const data: Record<string, string | null> = {};
  // Only include keys the client explicitly sent — anything left undefined
  // stays at its current DB value.
  const plate = cleanField(input.carPlateNumber);
  const brand = cleanField(input.carBrand);
  const color = cleanField(input.carColor);
  const note  = cleanField(input.pickupCustomerNote);
  if (plate !== undefined) data.carPlateNumber = plate;
  if (brand !== undefined) data.carBrand = brand;
  if (color !== undefined) data.carColor = color;
  if (note  !== undefined) data.pickupCustomerNote = note;

  if (Object.keys(data).length === 0) {
    // Nothing to do — return current state without logging.
    return order;
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data,
    select: {
      id: true, orderNumber: true, fulfillmentType: true, status: true,
      carPlateNumber: true, carBrand: true, carColor: true, pickupCustomerNote: true,
    },
  });

  // Audit records WHICH fields changed, not their values — values are PII.
  await logAction({
    actorId: customerId,
    actorRole: 'CUSTOMER',
    action: 'order.carPickup.update',
    entityType: 'ORDER',
    entityId: order.id,
    changes: { fieldsUpdated: Object.keys(data) },
  });

  return updated;
}

export async function clearCarPickupDetails(customerId: string, orderId: string) {
  const order = await loadCustomerPickupOrder(customerId, orderId);

  // Skip the write and the audit log if nothing is currently set.
  if (!order.carPlateNumber && !order.carBrand && !order.carColor && !order.pickupCustomerNote) {
    return order;
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { carPlateNumber: null, carBrand: null, carColor: null, pickupCustomerNote: null },
    select: {
      id: true, orderNumber: true, fulfillmentType: true, status: true,
      carPlateNumber: true, carBrand: true, carColor: true, pickupCustomerNote: true,
    },
  });

  await logAction({
    actorId: customerId,
    actorRole: 'CUSTOMER',
    action: 'order.carPickup.clear',
    entityType: 'ORDER',
    entityId: order.id,
  });

  return updated;
}

export async function verifyPayment(orderId: string, approved: boolean, note: string | undefined, actorId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error('Order not found');
  if (order.paymentMethod !== 'BANK_TRANSFER') {
    throw new Error('Only bank-transfer orders need payment verification');
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        paymentStatus: approved ? 'APPROVED' : 'REJECTED',
        statusHistory: {
          create: {
            status: order.status,
            note: approved ? `Payment approved by admin${note ? `: ${note}` : ''}` : `Payment rejected${note ? `: ${note}` : ''}`,
            createdBy: actorId,
          },
        },
      },
    });

    if (approved) {
      await notifyPaymentApproved(order.customerId, order.id, order.orderNumber, tx);
    } else {
      await notifyPaymentRejected(order.customerId, order.id, order.orderNumber, note, tx);
    }

    await logAction({
      actorId, action: approved ? 'order.payment.approve' : 'order.payment.reject',
      entityType: 'order', entityId: order.id,
      changes: { approved, note: note ?? null },
    }, tx);
    return updated;
  });
}

export async function attachPaymentProof(customerId: string, orderId: string, proofUrl: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, customerId } });
  if (!order) throw new Error('Order not found');
  if (order.paymentMethod !== 'BANK_TRANSFER') {
    throw new Error('Payment proof only applies to bank-transfer orders');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.order.update({
      where: { id: orderId },
      data: { paymentProofUrl: proofUrl, paymentStatus: 'UNDER_REVIEW' },
    });
    await notifyPaymentUnderReview(customerId, u.id, u.orderNumber, tx);
    return u;
  });
  return updated;
}

export async function getOrderById(id: string) {
  return prisma.order.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, mobile: true } },
      picker: { select: { id: true, name: true } },
      driver: { select: { id: true, name: true } },
      address: true,
      pickupSlot: { select: { id: true, label: true, startTime: true, endTime: true } },
      items: {
        include: {
          variant: {
            include: { product: { select: { id: true, name: true, nameAr: true, imageUrl: true } } },
          },
        },
      },
      orderPromotions: true,
      statusHistory: { orderBy: { createdAt: 'asc' } },
    },
  });
}

export async function listOrders(opts: {
  customerId?: string;
  pickerId?: string;
  driverId?: string;
  status?: OrderStatus;
  paymentStatus?: 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED';
  fulfillmentType?: FulfillmentType;
  // Half-open interval on createdAt: [createdFrom, createdTo). Both optional.
  createdFrom?: Date;
  createdTo?: Date;
  // Half-open interval on COALESCE(scheduledPickupDate, createdAt) — used by
  // the Today/Other admin panels so a scheduled-for-today order created
  // yesterday lands in Today and a today-but-scheduled-for-tomorrow order
  // doesn't pollute Today.
  effectiveFrom?: Date;
  effectiveTo?: Date;
  // Scheduled-pickup helpers used by the Future panel.
  scheduledFrom?: Date;
  scheduledTo?: Date;
  scheduledPickupSlotId?: string;
  // Partial match against orderNumber or customer.mobile.
  search?: string;
  // Override default `createdAt desc` ordering (Future panel sorts nearest
  // scheduled date first).
  orderBy?: 'createdAt:desc' | 'scheduledPickupAsc';
  page?: number;
  limit?: number;
}) {
  const {
    page = 1, limit = 20, search,
    createdFrom, createdTo,
    effectiveFrom, effectiveTo,
    scheduledFrom, scheduledTo, scheduledPickupSlotId,
    orderBy: orderByOpt,
    ...filters
  } = opts;

  const where: Prisma.OrderWhereInput = {};
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.pickerId) where.pickerId = filters.pickerId;
  if (filters.driverId) where.driverId = filters.driverId;
  if (filters.status) where.status = filters.status;
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.fulfillmentType) where.fulfillmentType = filters.fulfillmentType;
  if (scheduledPickupSlotId) where.scheduledPickupSlotId = scheduledPickupSlotId;

  if (createdFrom || createdTo) {
    where.createdAt = {
      ...(createdFrom && { gte: createdFrom }),
      ...(createdTo && { lt: createdTo }),
    };
  }

  if (scheduledFrom || scheduledTo) {
    where.scheduledPickupDate = {
      ...(scheduledFrom && { gte: scheduledFrom }),
      ...(scheduledTo && { lt: scheduledTo }),
    };
  }

  // Effective-date filter: bucket by scheduledPickupDate when present, else
  // by createdAt. Prisma doesn't expose COALESCE in `where`, so we encode it
  // as an OR group inside AND so it can compose with other filters.
  const ANDs: Prisma.OrderWhereInput[] = [];
  if (effectiveFrom || effectiveTo) {
    ANDs.push({
      OR: [
        {
          scheduledPickupDate: {
            ...(effectiveFrom && { gte: effectiveFrom }),
            ...(effectiveTo && { lt: effectiveTo }),
          },
        },
        {
          scheduledPickupDate: null,
          createdAt: {
            ...(effectiveFrom && { gte: effectiveFrom }),
            ...(effectiveTo && { lt: effectiveTo }),
          },
        },
      ],
    });
  }

  const term = search?.trim();
  if (term) {
    // Order number, customer mobile, and (admin-curbside use case) car plate.
    // Plate match is partial too so a partial scan or typo still finds the
    // order. RBAC filtering at the route layer keeps non-admins from using
    // this to enumerate plates.
    ANDs.push({
      OR: [
        { orderNumber: { contains: term } },
        { customer: { mobile: { contains: term } } },
        { carPlateNumber: { contains: term } },
      ],
    });
  }
  if (ANDs.length) where.AND = ANDs;

  const orderBy: Prisma.OrderOrderByWithRelationInput[] =
    orderByOpt === 'scheduledPickupAsc'
      ? [{ scheduledPickupDate: 'asc' }, { scheduledPickupStartTime: 'asc' }, { createdAt: 'asc' }]
      : [{ createdAt: 'desc' }];

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        customer: { select: { id: true, name: true, mobile: true } },
        picker: { select: { id: true, name: true, mobile: true } },
        driver: { select: { id: true, name: true, mobile: true } },
        items: { select: { id: true, quantity: true, total: true } },
        pickupSlot: { select: { id: true, label: true, startTime: true, endTime: true } },
      },
      orderBy,
    }),
    prisma.order.count({ where }),
  ]);

  return { orders, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

/** Statuses that don't apply to pickup orders (they belong to the delivery flow). */
const DELIVERY_ONLY_STATUSES: OrderStatus[] = [
  'READY_FOR_DELIVERY',
  'ASSIGNED_TO_DRIVER',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

/** Statuses that don't apply to delivery orders (they belong to the pickup flow). */
const PICKUP_ONLY_STATUSES: OrderStatus[] = [
  'READY_FOR_PICKUP',
  'PICKED_UP_BY_CUSTOMER',
];

export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  actorId: string,
  note?: string
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({
      where: { id: orderId },
      select: { fulfillmentType: true },
    });
    if (!existing) throw new Error('Order not found');

    if (existing.fulfillmentType === 'PICKUP' && DELIVERY_ONLY_STATUSES.includes(status)) {
      throw new Error(`Pickup orders cannot move to ${status}.`);
    }
    if (existing.fulfillmentType === 'DELIVERY' && PICKUP_ONLY_STATUSES.includes(status)) {
      throw new Error(`Delivery orders cannot move to ${status}.`);
    }

    const order = await tx.order.update({
      where: { id: orderId },
      data: {
        status,
        ...(status === 'DELIVERED' && { deliveredAt: new Date() }),
        ...(status === 'PICKED_UP_BY_CUSTOMER' && { pickedUpAt: new Date() }),
        ...(status === 'COMPLETED' && { completedAt: new Date() }),
        ...(status === 'CONFIRMED' && { confirmedAt: new Date() }),
        statusHistory: {
          create: { status, note, createdBy: actorId },
        },
      },
    });

    // Release reserved stock on cancel/reject
    if (status === 'CANCELLED' || status === 'REJECTED') {
      const items = await tx.orderItem.findMany({ where: { orderId } });
      for (const item of items) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: { reserved: { decrement: item.quantity } },
        });
      }
    }

    // Deduct actual stock when the customer takes possession.
    if (status === 'CONFIRMED' || status === 'PICKED_UP_BY_CUSTOMER') {
      const items = await tx.orderItem.findMany({ where: { orderId } });
      for (const item of items) {
        await tx.productVariant.update({
          where: { id: item.variantId },
          data: {
            stock: { decrement: item.quantity },
            reserved: { decrement: item.quantity },
          },
        });
      }
    }

    await notifyOrderStatus(order.customerId, order.id, order.orderNumber, status, tx);

    await logAction({
      actorId, action: 'order.status.change',
      entityType: 'order', entityId: order.id,
      changes: { to: status, note: note ?? null },
    }, tx);

    return order;
  });
}

export async function assignPicker(orderId: string, pickerId: string, actorId: string) {
  return updateOrderStatus(orderId, 'ASSIGNED_TO_PICKER', actorId, `Assigned to picker ${pickerId}`)
    .then(() =>
      prisma.order.update({
        where: { id: orderId },
        data: { pickerId },
      })
    );
}

export async function assignDriver(orderId: string, driverId: string, actorId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { fulfillmentType: true },
  });
  if (!order) throw new Error('Order not found');
  if (order.fulfillmentType === 'PICKUP') {
    throw new Error('Pickup orders cannot be assigned to a driver. Switch the order to delivery first.');
  }
  return updateOrderStatus(orderId, 'ASSIGNED_TO_DRIVER', actorId, `Assigned to driver ${driverId}`)
    .then(() =>
      prisma.order.update({
        where: { id: orderId },
        data: { driverId },
      })
    );
}

/** Statuses where a customer can still cancel the order themselves. */
const CUSTOMER_CANCELLABLE: OrderStatus[] = [
  'NEW',
  'PAYMENT_VERIFIED',
  'ASSIGNED_TO_PICKER',
  'PICKING_IN_PROGRESS',
  'READY_FOR_DELIVERY',
  'READY_FOR_PICKUP',
];

export async function cancelOwnOrder(customerId: string, orderId: string, reason?: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, customerId } });
  if (!order) throw new Error('Order not found');
  if (!CUSTOMER_CANCELLABLE.includes(order.status)) {
    throw new Error(
      'This order can no longer be cancelled. Please contact support if you need help.'
    );
  }
  // Optional cancellation reason gets persisted alongside the rejection note.
  await prisma.order.update({
    where: { id: orderId },
    data: { rejectionReason: reason?.trim() || 'Cancelled by customer' },
  });
  return updateOrderStatus(orderId, 'CANCELLED', customerId, reason?.trim() || 'Cancelled by customer');
}

export async function rejectOrder(orderId: string, reason: string, actorId: string) {
  await prisma.order.update({
    where: { id: orderId },
    data: { rejectionReason: reason },
  });
  return updateOrderStatus(orderId, 'REJECTED', actorId, reason);
}

// ─── Picker workflow ──────────────────────────────────────────────

const ACTIVE_ITEM_STATUSES = ['PENDING', 'PICKED'] as const;

async function recomputeOrderTotals(tx: Prisma.TransactionClient, orderId: string) {
  const items = await tx.orderItem.findMany({
    where: { orderId, status: { in: ['PENDING', 'PICKED'] } },
  });
  const subtotal = items.reduce((sum, i) => sum + Number(i.total), 0);
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) return;
  const total = subtotal + Number(order.deliveryFee) - Number(order.discountTotal);
  await tx.order.update({
    where: { id: orderId },
    data: { subtotal, total },
  });
}

async function assertCanPick(
  tx: Prisma.TransactionClient,
  orderId: string,
  actor: { userId: string; role: string }
) {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (!order) throw new Error('Order not found');
  if (actor.role === 'PICKER' && order.pickerId !== actor.userId) {
    throw new Error('Not assigned to you');
  }
  return order;
}

export async function setOrderItemStatus(
  orderId: string,
  itemId: string,
  status: 'PICKED' | 'UNAVAILABLE' | 'REMOVED',
  actor: { userId: string; role: string }
) {
  return prisma.$transaction(async (tx) => {
    await assertCanPick(tx, orderId, actor);
    const item = await tx.orderItem.findFirst({ where: { id: itemId, orderId } });
    if (!item) throw new Error('Order item not found');
    if (item.status === 'REPLACED') throw new Error('Item already replaced');

    // Release reservation if going inactive from active
    const wasActive = item.status === 'PENDING' || item.status === 'PICKED';
    const willBeActive = status === 'PICKED';
    if (wasActive && !willBeActive) {
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { reserved: { decrement: item.quantity } },
      });
    } else if (!wasActive && willBeActive) {
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { reserved: { increment: item.quantity } },
      });
    }

    const updated = await tx.orderItem.update({
      where: { id: itemId },
      data: { status },
    });
    if (status !== 'PICKED') {
      await recomputeOrderTotals(tx, orderId);
    }
    await logAction({
      actorId: actor.userId, actorRole: actor.role,
      action: `order.item.${status.toLowerCase()}`,
      entityType: 'order_item', entityId: itemId,
      changes: { orderId, status },
    }, tx);
    return updated;
  });
}

export async function replaceOrderItem(
  orderId: string,
  itemId: string,
  newVariantId: string,
  quantity: number | undefined,
  actor: { userId: string; role: string }
) {
  return prisma.$transaction(async (tx) => {
    await assertCanPick(tx, orderId, actor);
    const original = await tx.orderItem.findFirst({ where: { id: itemId, orderId } });
    if (!original) throw new Error('Original item not found');
    if (original.status === 'REPLACED' || original.status === 'REMOVED') {
      throw new Error('Item cannot be replaced (already handled)');
    }

    const newVariant = await tx.productVariant.findFirst({
      where: { id: newVariantId, isActive: true, product: { isActive: true } },
    });
    if (!newVariant) throw new Error('Replacement variant not available');

    const qty = quantity && quantity > 0 ? quantity : original.quantity;
    const available = newVariant.stock - newVariant.reserved;
    if (available < qty) throw new Error(`Only ${available} of replacement variant available`);

    const unitPrice = newVariant.price;
    const total = Number(unitPrice) * qty;

    // Release reservation on the original variant
    if (original.status === 'PENDING' || original.status === 'PICKED') {
      await tx.productVariant.update({
        where: { id: original.variantId },
        data: { reserved: { decrement: original.quantity } },
      });
    }

    // Reserve on the replacement variant
    await tx.productVariant.update({
      where: { id: newVariant.id },
      data: { reserved: { increment: qty } },
    });

    const replacement = await tx.orderItem.create({
      data: {
        orderId,
        variantId: newVariant.id,
        quantity: qty,
        unitPrice,
        total,
        status: 'PICKED',
        notes: `Replacement for item ${original.id}`,
      },
    });

    await tx.orderItem.update({
      where: { id: original.id },
      data: { status: 'REPLACED', replacedByItemId: replacement.id },
    });

    await recomputeOrderTotals(tx, orderId);

    await logAction({
      actorId: actor.userId, actorRole: actor.role,
      action: 'order.item.replace',
      entityType: 'order_item', entityId: original.id,
      changes: { orderId, replacedWithVariantId: newVariant.id, qty },
    }, tx);

    return { replacement, replaced: original.id };
  });
}

export async function getBuyAgainProducts(customerId: string, limit = 20) {
  // Aggregate variants this customer has ordered
  const variantUsage = await prisma.orderItem.groupBy({
    by: ['variantId'],
    where: { order: { customerId } },
    _sum: { quantity: true },
    _count: { variantId: true },
    _max: { createdAt: true },
    orderBy: [{ _count: { variantId: 'desc' } }, { _max: { createdAt: 'desc' } }],
    take: limit * 3, // overfetch to allow filtering
  });

  if (variantUsage.length === 0) return [];

  const variantIds = variantUsage.map((v) => v.variantId);
  const variants = await prisma.productVariant.findMany({
    where: { id: { in: variantIds }, isActive: true },
    include: {
      product: {
        include: {
          category: { select: { id: true, name: true, nameAr: true } },
          subcategory: { select: { id: true, name: true, nameAr: true } },
          variants: { where: { isActive: true }, orderBy: { price: 'asc' } },
        },
      },
    },
  });

  // Group by product so we don't repeat the same product per variant
  const byProduct = new Map<string, { product: typeof variants[number]['product']; bestVariantId: string; orderCount: number }>();
  for (const usage of variantUsage) {
    const variant = variants.find((v) => v.id === usage.variantId);
    if (!variant || !variant.product.isActive) continue;
    if (variant.stock - variant.reserved <= 0) continue;
    const existing = byProduct.get(variant.product.id);
    if (!existing) {
      byProduct.set(variant.product.id, {
        product: variant.product,
        bestVariantId: variant.id,
        orderCount: usage._count.variantId,
      });
    }
  }

  return Array.from(byProduct.values()).slice(0, limit).map((entry) => ({
    product: entry.product,
    suggestedVariantId: entry.bestVariantId,
    orderCount: entry.orderCount,
  }));
}

export async function buildReorderCart(customerId: string, orderId: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, customerId },
    include: {
      items: {
        include: {
          variant: {
            include: {
              product: { select: { id: true, name: true, nameAr: true, imageUrl: true, isActive: true } },
            },
          },
        },
      },
    },
  });
  if (!order) throw new Error('Order not found');

  const items: Array<{
    variantId: string;
    productId: string;
    productName: string;
    productImage: string | null;
    variantType: string;
    price: number;
    quantity: number;
    priceChanged: boolean;
    originalPrice: number;
  }> = [];

  const skipped: Array<{
    productName: string;
    variantType: string;
    quantity: number;
    reason: string;
  }> = [];

  for (const item of order.items) {
    const v = item.variant;
    const product = v.product;
    const available = v.isActive && product.isActive && v.stock - v.reserved >= item.quantity;
    if (!available) {
      skipped.push({
        productName: product.name,
        variantType: v.type,
        quantity: item.quantity,
        reason: !product.isActive
          ? 'Product no longer available'
          : !v.isActive
            ? 'Variant no longer available'
            : 'Out of stock',
      });
      continue;
    }
    const currentPrice = Number(v.price);
    const originalPrice = Number(item.unitPrice);
    items.push({
      variantId: v.id,
      productId: product.id,
      productName: product.name,
      productImage: getProductImageUrl(v.sku),
      variantType: v.type,
      price: currentPrice,
      quantity: item.quantity,
      priceChanged: currentPrice !== originalPrice,
      originalPrice,
    });
  }

  return { items, skipped };
}

const LOW_STOCK_THRESHOLD = 5;

export async function getDashboardStats() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    newOrders,
    inPreparation,
    withDrivers,
    todayTotal,
    cancelledToday,
    deliveredToday,
    pendingPaymentReview,
    lowStockCount,
    activeDrivers,
    activePickers,
    pickupOrdersOpen,
    deliveryOrdersOpen,
    completedPickupToday,
    completedDeliveryToday,
    readyForPickup,
  ] = await Promise.all([
    prisma.order.count({ where: { status: 'NEW' } }),
    prisma.order.count({ where: { status: { in: ['ASSIGNED_TO_PICKER', 'PICKING_IN_PROGRESS'] } } }),
    prisma.order.count({ where: { status: { in: ['ASSIGNED_TO_DRIVER', 'OUT_FOR_DELIVERY'] } } }),
    prisma.order.count({ where: { createdAt: { gte: today } } }),
    prisma.order.count({ where: { status: 'CANCELLED', createdAt: { gte: today } } }),
    prisma.order.count({ where: { status: 'DELIVERED', deliveredAt: { gte: today } } }),
    prisma.order.count({ where: { paymentMethod: 'BANK_TRANSFER', paymentStatus: 'UNDER_REVIEW' } }),
    prisma.productVariant.count({
      where: { isActive: true, stock: { lte: LOW_STOCK_THRESHOLD }, product: { isActive: true } },
    }),
    prisma.user.count({ where: { role: 'DRIVER', isActive: true } }),
    prisma.user.count({ where: { role: 'PICKER', isActive: true } }),
    prisma.order.count({
      where: {
        fulfillmentType: 'PICKUP',
        status: { notIn: ['COMPLETED', 'PICKED_UP_BY_CUSTOMER', 'CANCELLED', 'REJECTED'] },
      },
    }),
    prisma.order.count({
      where: {
        fulfillmentType: 'DELIVERY',
        status: { notIn: ['DELIVERED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'REJECTED'] },
      },
    }),
    prisma.order.count({
      where: {
        fulfillmentType: 'PICKUP',
        status: { in: ['PICKED_UP_BY_CUSTOMER', 'COMPLETED'] },
        OR: [{ pickedUpAt: { gte: today } }, { completedAt: { gte: today } }],
      },
    }),
    prisma.order.count({
      where: {
        fulfillmentType: 'DELIVERY',
        status: { in: ['DELIVERED', 'CONFIRMED', 'COMPLETED'] },
        OR: [{ deliveredAt: { gte: today } }, { confirmedAt: { gte: today } }, { completedAt: { gte: today } }],
      },
    }),
    prisma.order.count({ where: { fulfillmentType: 'PICKUP', status: 'READY_FOR_PICKUP' } }),
  ]);

  const mostOrderedRaw = await prisma.orderItem.groupBy({
    by: ['variantId'],
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: 'desc' } },
    take: 5,
  });

  const mostOrderedVariants = await prisma.productVariant.findMany({
    where: { id: { in: mostOrderedRaw.map((r) => r.variantId) } },
    include: { product: { select: { id: true, name: true, nameAr: true, imageUrl: true } } },
  });

  const mostOrdered = mostOrderedRaw.map((r) => {
    const v = mostOrderedVariants.find((x) => x.id === r.variantId);
    return {
      variantId: r.variantId,
      quantitySold: r._sum.quantity ?? 0,
      variantType: v?.type ?? null,
      product: v?.product ?? null,
    };
  });

  return {
    newOrders,
    inPreparation,
    withDrivers,
    todayTotal,
    cancelledToday,
    deliveredToday,
    pendingPaymentReview,
    lowStockCount,
    activeDrivers,
    activePickers,
    pickupOrdersOpen,
    deliveryOrdersOpen,
    completedPickupToday,
    completedDeliveryToday,
    readyForPickup,
    mostOrdered,
  };
}
