import { z } from 'zod';

/**
 * Body schema for `POST /api/categories/list` and `POST /api/storefront/home`.
 *
 * `lang` is optional; missing / invalid / non-object bodies fall back to `'ar'`
 * per product decision (default is Arabic).
 */
export const langBodySchema = z
  .object({
    lang: z.enum(['ar', 'en']).optional(),
  })
  .partial();

export type Lang = 'ar' | 'en';

export function parseLang(body: unknown): Lang {
  const parsed = langBodySchema.safeParse(body ?? {});
  if (!parsed.success) return 'ar';
  return parsed.data.lang ?? 'ar';
}
