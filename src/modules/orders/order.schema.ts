import { z } from 'zod';

export const createOrderSchema = z.object({
  // Localizes `productName` on each returned item (drops `productNameAr`).
  // Missing/invalid falls back to `'ar'`, matching every other endpoint.
  lang: z.enum(['ar', 'en']).optional(),
  fulfillmentType: z.enum(['DELIVERY', 'PICKUP']).default('DELIVERY'),
  addressId: z.string().optional(),
  paymentMethod: z.enum(['CASH_ON_DELIVERY', 'BANK_TRANSFER', 'PAY_AT_BRANCH']),
  notes: z.string().optional(),
  replacementPreference: z.string().optional(),
  deliveryLat: z.number().min(-90).max(90).optional(),
  deliveryLng: z.number().min(-180).max(180).optional(),
  // Up to 3 delivery-location photo URLs (already uploaded to Bunny).
  deliveryImages: z.array(z.string().url()).max(3).optional(),
  // Scheduled pickup. Only meaningful when fulfillmentType=PICKUP. Server
  // re-validates feature toggle, slot capacity, cutoff, range, etc.
  pickupType: z.enum(['ASAP', 'SCHEDULED']).optional(),
  scheduledPickupDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'scheduledPickupDate must be YYYY-MM-DD')
    .optional(),
  scheduledPickupSlotId: z.string().min(1).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
      })
    )
    .min(1, 'Order must have at least one item'),
});

/**
 * Customer order creation via a verified `POST /checkout/prepare` session.
 * Deliberately narrow — fulfillment type, address, items, and pricing all
 * come from the checkout session (re-verified at creation time), never
 * from this body. No `deliveryImages` field exists in this flow.
 */
export const createOrderFromSessionSchema = z.object({
  checkoutSessionId: z.string().min(1),
  // Not part of checkout/prepare's pricing computation — this is the
  // customer's payment choice, still required to create any order (COD /
  // bank transfer / pay at branch), exactly as the legacy schema requires it.
  paymentMethod: z.enum(['CASH_ON_DELIVERY', 'BANK_TRANSFER', 'PAY_AT_BRANCH']),
  notes: z.string().optional(),
  replacementPreference: z.string().optional(),
  pickupType: z.enum(['ASAP', 'SCHEDULED']).nullable().optional(),
  scheduledPickupDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'scheduledPickupDate must be YYYY-MM-DD')
    .nullable()
    .optional(),
  scheduledPickupSlotId: z.string().min(1).nullable().optional(),
});

export type CreateOrderFromSessionInput = z.infer<typeof createOrderFromSessionSchema>;

export const assignPickerSchema = z.object({
  pickerId: z.string().min(1),
});

export const assignDriverSchema = z.object({
  driverId: z.string().min(1),
});

export const rejectOrderSchema = z.object({
  reason: z.string().min(1),
});

export const updateStatusSchema = z.object({
  status: z.enum([
    'NEW',
    'PAYMENT_VERIFIED',
    'ASSIGNED_TO_PICKER',
    'PICKING_IN_PROGRESS',
    'READY_FOR_DELIVERY',
    'READY_FOR_PICKUP',
    'ASSIGNED_TO_DRIVER',
    'OUT_FOR_DELIVERY',
    'DELIVERED',
    'PICKED_UP_BY_CUSTOMER',
    'COMPLETED',
    'CONFIRMED',
    'CANCELLED',
    'REJECTED',
  ]),
  note: z.string().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
