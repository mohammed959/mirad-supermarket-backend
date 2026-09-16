import { prisma } from '../../lib/prisma';
import { toCents, isValidMoney } from '../../lib/money';

/**
 * Admin-configured, product-subtotal-based delivery pricing. Replaces
 * distance as the source of the delivery FEE — `DeliveryDistanceRule` (see
 * `delivery.service.ts`) still decides zone/distance ELIGIBILITY only.
 */

export type DeliveryPricingErrorCode =
  | 'DELIVERY_PRICING_GAP'
  | 'DELIVERY_PRICING_OVERLAP'
  | 'INVALID_DELIVERY_RANGE'
  | 'INVALID_FREE_DELIVERY_THRESHOLD'
  | 'INCOMPLETE_DELIVERY_PRICING';

export class DeliveryPricingValidationError extends Error {
  code: DeliveryPricingErrorCode;
  constructor(code: DeliveryPricingErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SubtotalRangeInput {
  minSubtotal: number;
  maxSubtotal: number;
  deliveryFee: number;
}

export interface DeliverySubtotalPricingInput {
  freeDeliveryThreshold: number;
  ranges: SubtotalRangeInput[];
}

export interface SubtotalRange {
  id: string;
  minSubtotal: number;
  maxSubtotal: number;
  deliveryFee: number;
}

export interface DeliverySubtotalPricingConfig {
  freeDeliveryThreshold: number | null;
  ranges: SubtotalRange[];
}

/**
 * Validates the COMPLETE configuration as a single unit. Ranges are checked
 * in the order given (not re-sorted) — a valid configuration is by
 * definition already ascending and gapless, so this single boundary-chain
 * walk catches gaps, overlaps, duplicates, and out-of-order ranges alike.
 * All comparisons use integer cents (see `lib/money.ts`) so binary
 * floating-point drift can never produce a false gap/overlap.
 */
export function validateDeliverySubtotalPricing(input: DeliverySubtotalPricingInput): void {
  if (!isValidMoney(input.freeDeliveryThreshold)) {
    throw new DeliveryPricingValidationError(
      'INVALID_FREE_DELIVERY_THRESHOLD',
      'Free delivery threshold must be a non-negative amount with at most 2 decimal places.',
    );
  }

  if (!Array.isArray(input.ranges) || input.ranges.length === 0) {
    throw new DeliveryPricingValidationError(
      'INCOMPLETE_DELIVERY_PRICING',
      'At least one delivery-price range is required.',
    );
  }

  input.ranges.forEach((r, i) => {
    if (!isValidMoney(r.minSubtotal)) {
      throw new DeliveryPricingValidationError(
        'INVALID_DELIVERY_RANGE',
        `Range ${i + 1}: minSubtotal must be a non-negative amount with at most 2 decimal places.`,
      );
    }
    if (!isValidMoney(r.maxSubtotal)) {
      throw new DeliveryPricingValidationError(
        'INVALID_DELIVERY_RANGE',
        `Range ${i + 1}: maxSubtotal must be a non-negative amount with at most 2 decimal places.`,
      );
    }
    if (!isValidMoney(r.deliveryFee)) {
      throw new DeliveryPricingValidationError(
        'INVALID_DELIVERY_RANGE',
        `Range ${i + 1}: deliveryFee must be a non-negative amount with at most 2 decimal places.`,
      );
    }
    if (toCents(r.maxSubtotal) <= toCents(r.minSubtotal)) {
      throw new DeliveryPricingValidationError(
        'INVALID_DELIVERY_RANGE',
        `Range ${i + 1}: maxSubtotal must be greater than minSubtotal.`,
      );
    }
  });

  if (toCents(input.ranges[0].minSubtotal) !== 0) {
    throw new DeliveryPricingValidationError(
      'DELIVERY_PRICING_GAP',
      'The first range must start at 0.',
    );
  }

  for (let i = 1; i < input.ranges.length; i++) {
    const prev = input.ranges[i - 1];
    const cur = input.ranges[i];
    const prevMaxCents = toCents(prev.maxSubtotal);
    const curMinCents = toCents(cur.minSubtotal);
    if (curMinCents > prevMaxCents) {
      throw new DeliveryPricingValidationError(
        'DELIVERY_PRICING_GAP',
        `Range ${i + 1} leaves a gap after range ${i} (${prev.maxSubtotal} → ${cur.minSubtotal}).`,
      );
    }
    if (curMinCents < prevMaxCents) {
      throw new DeliveryPricingValidationError(
        'DELIVERY_PRICING_OVERLAP',
        `Range ${i + 1} overlaps range ${i}.`,
      );
    }
  }

  const last = input.ranges[input.ranges.length - 1];
  if (toCents(last.maxSubtotal) !== toCents(input.freeDeliveryThreshold)) {
    throw new DeliveryPricingValidationError(
      'INVALID_FREE_DELIVERY_THRESHOLD',
      'The final range must end exactly at the free-delivery threshold.',
    );
  }
}

export async function getDeliverySubtotalPricing(): Promise<DeliverySubtotalPricingConfig> {
  const [settings, ranges] = await Promise.all([
    prisma.deliverySubtotalPricingSettings.findFirst(),
    prisma.deliverySubtotalRange.findMany({ orderBy: { sortOrder: 'asc' } }),
  ]);
  return {
    freeDeliveryThreshold: settings ? Number(settings.freeDeliveryThreshold) : null,
    ranges: ranges.map((r) => ({
      id: r.id,
      minSubtotal: Number(r.minSubtotal),
      maxSubtotal: Number(r.maxSubtotal),
      deliveryFee: Number(r.deliveryFee),
    })),
  };
}

/**
 * Atomically replaces the ENTIRE configuration (threshold + all ranges).
 * Validated as a whole before any write — an invalid payload never
 * partially overwrites the existing configuration.
 */
export async function replaceDeliverySubtotalPricing(
  input: DeliverySubtotalPricingInput,
): Promise<DeliverySubtotalPricingConfig> {
  validateDeliverySubtotalPricing(input);

  await prisma.$transaction(async (tx) => {
    await tx.deliverySubtotalRange.deleteMany({});
    await tx.deliverySubtotalRange.createMany({
      data: input.ranges.map((r, idx) => ({
        minSubtotal: r.minSubtotal,
        maxSubtotal: r.maxSubtotal,
        deliveryFee: r.deliveryFee,
        sortOrder: idx,
      })),
    });

    const existing = await tx.deliverySubtotalPricingSettings.findFirst();
    if (existing) {
      await tx.deliverySubtotalPricingSettings.update({
        where: { id: existing.id },
        data: { freeDeliveryThreshold: input.freeDeliveryThreshold },
      });
    } else {
      await tx.deliverySubtotalPricingSettings.create({
        data: { freeDeliveryThreshold: input.freeDeliveryThreshold },
      });
    }
  });

  return getDeliverySubtotalPricing();
}
