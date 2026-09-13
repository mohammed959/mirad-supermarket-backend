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

/**
 * `?lang=` query-string counterpart to `parseLang`, for GET endpoints.
 * Same fallback rule: missing / invalid value falls back to `'ar'`.
 */
export function parseLangQuery(value: unknown): Lang {
  return value === 'ar' || value === 'en' ? value : 'ar';
}

/**
 * Same as `parseLangQuery`, but returns `undefined` instead of defaulting
 * to `'ar'` when absent/invalid. For endpoints shared with a non-marketplace
 * caller (e.g. admin) that never sends `lang` and must keep receiving
 * today's unmodified bilingual shape — only an explicit, valid `lang`
 * opts a request into the localized response.
 */
export function parseOptionalLangQuery(value: unknown): Lang | undefined {
  return value === 'ar' || value === 'en' ? value : undefined;
}
