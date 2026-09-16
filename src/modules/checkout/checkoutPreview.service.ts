import { FulfillmentType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { quoteDelivery, loadSubscriptionContext } from '../delivery/delivery.service';
import type { SubtotalRange } from '../delivery/deliverySubtotalPricing.service';
import { getPublicPickupSettings } from '../pickup/pickup.service';
import { getProductImageUrl } from '../../lib/productImage';
import type { Lang } from '../categories/category.schema';

const pickName = (lang: Lang, en: string, ar: string) => (lang === 'ar' ? (ar || en) : (en || ar));
const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CheckoutPreviewItemInput {
  productId: string;
  quantity: number;
}

export interface CheckoutPreviewInput {
  customerId: string;
  addressId?: string;
  fulfillmentType: FulfillmentType;
  items: CheckoutPreviewItemInput[];
  lang: Lang;
}

export interface CheckoutBlocker {
  code:
    | 'EMPTY_CART'
    | 'ADDRESS_REQUIRED'
    | 'INVALID_ADDRESS'
    | 'OUTSIDE_COVERAGE'
    | 'PRODUCT_UNAVAILABLE'
    | 'INSUFFICIENT_STOCK'
    | 'MINIMUM_ORDER_NOT_MET'
    | 'FULFILLMENT_UNAVAILABLE';
  message: string;
  productId?: string;
}

export interface CheckoutPreviewItem {
  productId: string;
  name: string;
  sku: string | null;
  imageUrl: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  available: boolean;
}

export interface CheckoutAddress {
  id: string;
  label: string;
  addressLine: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
  deliveryNotes: string | null;
}

export interface CheckoutPreview {
  address: CheckoutAddress | null;
  items: CheckoutPreviewItem[];
  subtotal: number;
  /** Delivery fee before any subscription benefit. Equals `deliveryFee`
   *  whenever there's no active subscription. */
  baseDeliveryFee: number;
  deliveryFee: number;
  subscriptionDiscount: number;
  total: number;
  minimumOrder: { enabled: boolean; minimumAmount: number; satisfied: boolean };
  delivery: {
    distanceKm: number | null;
    withinCoverage: boolean;
    available: boolean;
    pricingRuleApplied: string;
    matchedSubtotalRule: SubtotalRange | null;
    freeDeliveryThreshold: number | null;
    freeDeliveryApplied: boolean;
  };
  fulfillment: {
    selected: FulfillmentType;
    availableTypes: Array<'DELIVERY' | 'PICKUP'>;
    pickupSettings: Awaited<ReturnType<typeof getPublicPickupSettings>> | null;
  };
  subscriptionBenefit: { applied: boolean; type: string | null };
  blockers: CheckoutBlocker[];
}

/**
 * Single authoritative checkout computation, shared verbatim by
 * `POST /checkout/prepare` and by order creation's pre-flight revalidation
 * (`createOrderFromCheckoutSession`) — the two callers MUST see the exact
 * same numbers for "did anything material change?" to mean anything.
 *
 * Reuses, rather than re-implements:
 *   - `quoteDelivery` / `loadSubscriptionContext` (delivery.service) for
 *     coverage, distance, fee, and subscription-benefit pricing.
 *   - `getPublicPickupSettings` (pickup.service) for the pickup feature flag.
 *   - The address-ownership pattern already used by `address.service.getAddress`.
 * Product price/stock resolution mirrors — intentionally, not by import —
 * the same simple per-item rule `createOrder` already applies, so this
 * module never has to reach into (or refactor) that function to work.
 */
export async function buildCheckoutPreview(input: CheckoutPreviewInput): Promise<CheckoutPreview> {
  const blockers: CheckoutBlocker[] = [];
  const isPickup = input.fulfillmentType === 'PICKUP';

  // ── Address — required + coverage-checked for delivery; optional,
  //    non-blocking for pickup (mirrors createOrder's own rule that
  //    pickup orders carry no delivery address). ───────────────────────
  let address: CheckoutAddress | null = null;
  let lat: number | undefined;
  let lng: number | undefined;

  if (!isPickup && !input.addressId) {
    blockers.push({ code: 'ADDRESS_REQUIRED', message: 'Choose a delivery address to continue.' });
  } else if (input.addressId) {
    const addr = await prisma.customerAddress.findFirst({
      where: { id: input.addressId, customerId: input.customerId },
    });
    if (!addr) {
      if (!isPickup) {
        blockers.push({
          code: 'INVALID_ADDRESS',
          message: 'This address does not belong to your account or no longer exists.',
        });
      }
    } else {
      lat = Number(addr.latitude);
      lng = Number(addr.longitude);
      address = {
        id: addr.id,
        label: addr.label,
        addressLine: addr.addressLine,
        city: addr.city,
        latitude: lat,
        longitude: lng,
        deliveryNotes: addr.deliveryNotes,
      };
    }
  }

  // ── Products — current price/stock/availability, straight from the DB. ─
  if (input.items.length === 0) {
    blockers.push({ code: 'EMPTY_CART', message: 'Your cart is empty.' });
  }
  const productIds = input.items.map((i) => i.productId);
  const products = productIds.length
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, nameAr: true, sku: true, price: true, stock: true, reserved: true, isActive: true },
      })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const items: CheckoutPreviewItem[] = [];
  let subtotal = 0;
  for (const { productId, quantity } of input.items) {
    const product = productById.get(productId);
    if (!product || !product.isActive) {
      blockers.push({ code: 'PRODUCT_UNAVAILABLE', productId, message: `A product in your cart is no longer available.` });
      continue;
    }
    const name = pickName(input.lang, product.name, product.nameAr);
    if (product.price == null) {
      blockers.push({ code: 'PRODUCT_UNAVAILABLE', productId, message: `"${name}" has no price set.` });
      continue;
    }
    const availableStock = product.stock - product.reserved;
    const available = availableStock > 0;
    if (availableStock < quantity) {
      blockers.push({
        code: 'INSUFFICIENT_STOCK',
        productId,
        message: `Only ${Math.max(availableStock, 0)} unit(s) of "${name}" are available.`,
      });
    }
    const unitPrice = Number(product.price);
    const lineTotal = round2(unitPrice * quantity);
    subtotal += lineTotal;
    items.push({
      productId: product.id,
      name,
      sku: product.sku,
      imageUrl: getProductImageUrl(product.sku),
      unitPrice,
      quantity,
      lineTotal,
      available,
    });
  }
  subtotal = round2(subtotal);

  // ── Minimum order — loaded internally, never trusted from the client. ──
  const minimumSettings = await prisma.minimumOrderSettings.findFirst();
  const minimumEnabled = Boolean(minimumSettings?.enabled);
  const minimumAmount = minimumSettings ? Number(minimumSettings.minimumAmount) : 0;
  const minimumSatisfied = !minimumEnabled || subtotal >= minimumAmount;
  if (!minimumSatisfied) {
    blockers.push({
      code: 'MINIMUM_ORDER_NOT_MET',
      message: `Minimum order is ${minimumAmount.toFixed(2)}. Add ${round2(minimumAmount - subtotal).toFixed(2)} more to check out.`,
    });
  }

  // ── Subscription + delivery quote — the existing, single source of
  //    truth for coverage/distance/fee/subscription-benefit pricing. ─────
  const subscriptionContext = await loadSubscriptionContext(input.customerId);
  const quote = await quoteDelivery({
    customerLat: lat,
    customerLng: lng,
    cartSubtotal: subtotal,
    fulfillmentType: input.fulfillmentType,
    lang: input.lang,
    ...subscriptionContext,
  });

  // `quote.baseFee` is the subtotal-range fee BEFORE any subscription
  // benefit; `quote.fee` is what's actually charged. Their difference is
  // exactly the subscription discount, with no separate settings lookup
  // needed — this stays correct regardless of which subtotal range matched.
  const subscriptionDiscount = round2(Math.max(0, quote.baseFee - quote.fee));

  const baseDeliveryFee = quote.baseFee;
  const deliveryFee = quote.fee;
  const total = round2(subtotal + deliveryFee);

  const withinCoverage = isPickup || (quote.reason !== 'OUT_OF_AREA' && quote.reason !== 'IN_EXCLUDED_AREA');
  if (!isPickup) {
    if (!withinCoverage) {
      blockers.push({
        code: 'OUTSIDE_COVERAGE',
        message: quote.message ?? 'This address is outside the delivery coverage area.',
      });
    } else if (!quote.deliveryAvailable) {
      blockers.push({
        code: 'FULFILLMENT_UNAVAILABLE',
        message: quote.message ?? 'Delivery is not available right now.',
      });
    }
  } else if (!quote.pickupAvailable) {
    blockers.push({ code: 'FULFILLMENT_UNAVAILABLE', message: 'Pickup from branch is not available right now.' });
  }

  // ── Pickup public settings — only meaningful (and only loaded) when
  //    pickup is actually one of the customer's available options. ───────
  const pickupSettings = quote.pickupAvailable ? await getPublicPickupSettings() : null;

  return {
    address,
    items,
    subtotal,
    baseDeliveryFee,
    deliveryFee,
    subscriptionDiscount,
    total,
    minimumOrder: { enabled: minimumEnabled, minimumAmount, satisfied: minimumSatisfied },
    delivery: {
      distanceKm: quote.distanceKm,
      withinCoverage,
      available: quote.deliveryAvailable,
      pricingRuleApplied: quote.pricingRuleApplied,
      matchedSubtotalRule: quote.matchedSubtotalRule,
      freeDeliveryThreshold: quote.freeDeliveryThreshold,
      freeDeliveryApplied: quote.freeDeliveryApplied,
    },
    fulfillment: {
      selected: input.fulfillmentType,
      availableTypes: quote.availableFulfillmentTypes,
      pickupSettings,
    },
    subscriptionBenefit: {
      applied: quote.pricingRuleApplied === 'SUBSCRIPTION',
      type: subscriptionContext.hasActiveSubscription ? subscriptionContext.subscriptionBenefitType : null,
    },
    blockers,
  };
}
