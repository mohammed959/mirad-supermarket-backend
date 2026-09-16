import { z } from 'zod';

/**
 * `POST /checkout/prepare` request. Deliberately narrow — the client
 * supplies only what it actually knows (which address, which fulfillment
 * type, which products/quantities). Subscription status, subtotal, prices,
 * delivery fee, coverage result, and raw coordinates are never accepted
 * here; they're all resolved server-side in `checkoutPreview.service`.
 */
export const prepareCheckoutSchema = z.object({
  lang: z.enum(['ar', 'en']).optional(),
  addressId: z.string().min(1).optional(),
  selectedFulfillmentType: z.enum(['DELIVERY', 'PICKUP']).default('DELIVERY'),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1, 'items must contain at least one product'),
});

export type PrepareCheckoutInput = z.infer<typeof prepareCheckoutSchema>;
