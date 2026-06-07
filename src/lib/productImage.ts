import { config } from '../config';

const SAFE_PATH_RE = /[^A-Za-z0-9._-]/g;

/**
 * Resolve a product image URL from its SKU.
 * Convention: `${BUNNY_CDN_BASE_URL}/{sku}.{ext}` (default ext: `png`).
 *
 * We do NOT verify the file exists at the CDN — the frontend swaps to the
 * default image on `onError`, which is both cheaper and avoids HEAD storms.
 */
export function getProductImageUrl(sku?: string | null): string {
  if (!sku) return config.bunny.defaultProductImageUrl;
  const trimmed = sku.trim();
  if (!trimmed) return config.bunny.defaultProductImageUrl;
  const safe = trimmed.replace(SAFE_PATH_RE, '_');
  return `${config.bunny.productBaseUrl}/${safe}.${config.bunny.productExtension}`;
}

/**
 * Resolve a category (or subcategory) image URL from its English slug.
 * Convention: `${BUNNY_CATEGORY_BASE_URL}/{slug}.{ext}` (default ext: `png`).
 *
 * The English slug is the URL-safe lowercase identifier we already store on
 * categories (e.g. `dairy`, `beverages`, `snacks`). If the slug is blank,
 * fall back to the default category image.
 */
export function getCategoryImageUrl(slug?: string | null): string {
  if (!slug) return config.bunny.defaultCategoryImageUrl;
  const trimmed = slug.trim();
  if (!trimmed) return config.bunny.defaultCategoryImageUrl;
  // Slugs are already URL-safe but normalize anyway for robustness.
  const safe = trimmed.toLowerCase().replace(SAFE_PATH_RE, '_');
  return `${config.bunny.categoryBaseUrl}/${safe}.${config.bunny.categoryExtension}`;
}

export const defaultProductImageUrl = (): string => config.bunny.defaultProductImageUrl;
export const defaultCategoryImageUrl = (): string => config.bunny.defaultCategoryImageUrl;

/**
 * Recursively walk a payload and rewrite every CDN-image-bearing object's
 * `imageUrl` from its identifier (SKU for products, slug for categories).
 *
 * Covers:
 *   - bare products with `variants[]`             → use variants[0].sku
 *   - order/cart items: `{ variant: { sku, product: {...} } }`
 *                                                 → use variant.sku for product.imageUrl
 *   - low-stock rows: `{ sku, product: {...} }`   → use this row's sku
 *   - categories / subcategories with `slug`+`name` → use slug
 *
 * Pure with respect to non-matching objects: they're walked into but
 * not modified at the top level.
 */
const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  if (v instanceof Date) return false;
  const ctorName = (v as { constructor?: { name?: string } }).constructor?.name;
  if (ctorName === 'Decimal') return false;
  if (ctorName === 'Buffer') return false;
  return true;
};

// Products carry `variants` (an array). Without variants present we let the
// variant-row handler (or the parent product) set the image, to avoid mistakenly
// treating a category as a product.
const looksLikeProduct = (obj: Record<string, unknown>) =>
  'name' in obj && Array.isArray(obj.variants);

// Categories carry a `slug` plus a `name`. Subcategories share that shape and
// resolve through the same `/category/{slug}.png` namespace.
const looksLikeCategory = (obj: Record<string, unknown>) =>
  typeof obj.slug === 'string' && typeof obj.name === 'string' && !Array.isArray(obj.variants);

const looksLikeVariantRow = (obj: Record<string, unknown>) =>
  typeof obj.sku === 'string' && isPlainObject(obj.product);

function decorate(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map((p) => decorate(p));
  }
  if (!isPlainObject(payload)) return payload;

  const obj = payload as Record<string, unknown>;

  // Variant row: this row's sku determines its product's image.
  if (looksLikeVariantRow(obj)) {
    const sku = obj.sku as string;
    const product = obj.product as Record<string, unknown>;
    obj.product = { ...product, imageUrl: getProductImageUrl(sku) };
  }

  // Product: derive from this product's own variants[0].sku.
  if (looksLikeProduct(obj)) {
    const variants = obj.variants as Array<{ sku?: string }>;
    obj.imageUrl = getProductImageUrl(variants[0]?.sku);
  } else if (looksLikeCategory(obj)) {
    // Category / subcategory: derive from this row's slug.
    obj.imageUrl = getCategoryImageUrl(obj.slug as string);
  }

  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object') {
      obj[key] = decorate(v);
    }
  }
  return obj;
}

export function decorateProductImages<T>(payload: T): T {
  return decorate(payload) as T;
}
