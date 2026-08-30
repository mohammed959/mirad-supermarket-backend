import { z } from 'zod';
import { langBodySchema, parseLang, type Lang } from '../categories/category.schema';

/**
 * Body schema for `POST /api/cart/items`.
 *
 * `action` decides direction: `increment` adds `quantity` to whatever is
 * already in the cart (creating the item if it's not there yet); `decrement`
 * subtracts it, removing the item once its quantity reaches zero.
 */
export const addOrAdjustCartItemBodySchema = langBodySchema.extend({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  action: z.enum(['increment', 'decrement']),
});

export type AddOrAdjustCartItemInput = z.infer<typeof addOrAdjustCartItemBodySchema>;

export { parseLang };
export type { Lang };
