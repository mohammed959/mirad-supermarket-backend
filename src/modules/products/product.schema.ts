import { z } from 'zod';
import { langBodySchema, parseLang, type Lang } from '../categories/category.schema';

/**
 * Public marketplace body schemas for `POST /api/products/*`.
 *
 * All fields are optional except `id` on `/detail` and `q` on `/search` +
 * `/search/suggestions`. Missing / invalid `lang` falls back to `'ar'` per
 * the shared category schema.
 */
export const listProductsBodySchema = langBodySchema.extend({
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  categoryId: z.string().min(1).optional(),
  subcategoryId: z.string().min(1).optional(),
  brandId: z.string().min(1).optional(),
  ids: z.array(z.string().min(1)).optional(),
  featured: z.boolean().optional(),
  includeOutOfStock: z.boolean().optional(),
  excludeHiddenFromHome: z.boolean().optional(),
});

export const productDetailBodySchema = langBodySchema.extend({
  id: z.string().min(1),
});

export const featuredProductsBodySchema = langBodySchema.extend({
  limit: z.number().int().min(1).max(100).optional(),
});

export const searchProductsBodySchema = langBodySchema.extend({
  q: z.string().min(1),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  barcode: z.string().optional(),
});

export const searchSuggestionsBodySchema = langBodySchema.extend({
  q: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
});

export { parseLang };
export type { Lang };


/**
 * Phase 1 product schema — flat: no variants array.
 *
 * Required: category, price, quantity, sku, names (en+ar).
 * Optional: brand, subcategory, descriptions, barcode, isFeatured, hideFromHome.
 *
 * SKU and barcode are validated at the product level. SKU is unique
 * across products; the DB enforces this via a UNIQUE constraint.
 */
export const createProductSchema = z.object({
  categoryId: z.string().min(1),
  subcategoryId: z.string().optional(),
  // Brand is optional. Empty string is treated as "no brand".
  brandId: z.string().trim().optional(),
  name: z.string().min(1).max(200),
  nameAr: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  descriptionAr: z.string().max(2000).optional(),
  sku: z.string().min(1).max(64).trim(),
  barcode: z.string().min(1).max(64).trim().optional(),
  price: z.number().positive('price must be > 0'),
  quantity: z.number().int().min(0, 'quantity must be >= 0'),
  isFeatured: z.boolean().optional().default(false),
  hideFromHome: z.boolean().optional().default(false),
});

export const updateProductSchema = createProductSchema.partial();

/**
 * Schema for the dedicated stock-adjust endpoint.
 * `delta` shifts current stock by a signed integer (positive to restock,
 * negative to decrement). Use `set` to overwrite stock to an absolute
 * value. Exactly one must be provided.
 */
export const adjustStockSchema = z
  .object({
    delta: z.number().int().optional(),
    set: z.number().int().min(0).optional(),
  })
  .refine((v) => v.delta !== undefined || v.set !== undefined, {
    message: 'Either `delta` or `set` must be provided',
  });

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
