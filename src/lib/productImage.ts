import { config } from '../config';

const SAFE_PATH_RE = /[^A-Za-z0-9._-]/g;

/**
 * Resolve a product image URL from its SKU.
 *
 * Cloudinary Public ID === Product SKU (never `barcode`) — assets are
 * uploaded externally to `mirad/products/{sku}`, so importing/editing a
 * product's SKU is the only thing that ever needs to happen; no separate
 * image mapping or stored URL is required.
 *
 * Convention: `https://res.cloudinary.com/{cloudName}/image/upload/{transformations}/{productFolder}/{sku}`
 * (no forced file extension — `f_auto` lets Cloudinary negotiate format).
 *
 * We do NOT verify the asset exists at Cloudinary — the frontend swaps to
 * the default image on `onError`, which is both cheaper and avoids HEAD
 * storms. A missing image must never prevent the product from displaying.
 */
function buildCloudinaryProductUrl(identifier: string): string {
  const safe = identifier.replace(SAFE_PATH_RE, '_');
  const { cloudName, productFolder, productTransformations } = config.cloudinary;
  if (!cloudName) return config.bunny.defaultProductImageUrl;
  const transformSegment = productTransformations ? `${productTransformations}/` : '';
  return `https://res.cloudinary.com/${cloudName}/image/upload/${transformSegment}${productFolder}/${safe}`;
}

/**
 * Untransformed delivery URL for `{productFolder}/{identifier}`, used only to
 * probe whether an asset exists (no `f_auto,q_auto` so Cloudinary doesn't
 * generate a derived image for a HEAD check). `null` when Cloudinary isn't
 * configured.
 */
export function getCloudinaryProductProbeUrl(identifier: string): string | null {
  const { cloudName, productFolder } = config.cloudinary;
  if (!cloudName) return null;
  const safe = identifier.trim().replace(SAFE_PATH_RE, '_');
  return `https://res.cloudinary.com/${cloudName}/image/upload/${productFolder}/${safe}`;
}

export function getProductImageUrl(sku?: string | null): string {
  if (!sku) return config.bunny.defaultProductImageUrl;
  const trimmed = sku.trim();
  if (!trimmed) return config.bunny.defaultProductImageUrl;
  return buildCloudinaryProductUrl(trimmed);
}

/**
 * Second-choice SKU variant: some products have their photo uploaded under
 * `{sku}_1` instead of the bare SKU (e.g. a re-shoot or a batch upload
 * convention). Tried after `imageUrl` and before the barcode fallback.
 */
export function getProductImageAltUrl(sku?: string | null): string {
  if (!sku) return config.bunny.defaultProductImageUrl;
  const trimmed = sku.trim();
  if (!trimmed) return config.bunny.defaultProductImageUrl;
  return buildCloudinaryProductUrl(`${trimmed}_1`);
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
  const safe = trimmed.toLowerCase().replace(SAFE_PATH_RE, '_');
  return `${config.bunny.categoryBaseUrl}/${safe}.${config.bunny.categoryExtension}`;
}

/**
 * Resolve a brand image URL from its English slug.
 * Convention: `${BUNNY_BRAND_BASE_URL}/{slug}.{ext}` (default ext: `png`).
 *
 * Same strategy as products and categories — the URL is computed, not
 * checked. The frontend's `<img onError>` swaps to the default brand
 * image if the CDN file is missing.
 */
export function getBrandImageUrl(slug?: string | null): string {
  if (!slug) return config.bunny.defaultBrandImageUrl;
  const trimmed = slug.trim();
  if (!trimmed) return config.bunny.defaultBrandImageUrl;
  const safe = trimmed.toLowerCase().replace(SAFE_PATH_RE, '_');
  return `${config.bunny.brandBaseUrl}/${safe}.${config.bunny.brandExtension}`;
}

export const defaultProductImageUrl = (): string => config.bunny.defaultProductImageUrl;
export const defaultCategoryImageUrl = (): string => config.bunny.defaultCategoryImageUrl;
export const defaultBrandImageUrl = (): string => config.bunny.defaultBrandImageUrl;

/**
 * Recursively walk a payload and rewrite every CDN-image-bearing object's
 * `imageUrl` from its identifier:
 *   - product → product.sku (or first variant SKU for legacy rows)
 *   - category / subcategory → slug
 *   - brand → slug (brand namespace, not category)
 *
 * Product-shaped objects also get `imageUrlAlt` (from `{sku}_1`, for photos
 * uploaded under a SKU variant) and `imageUrlFallback` (from `barcode`, for
 * photos uploaded keyed by barcode instead of SKU). The frontend tries
 * `imageUrl`, then `imageUrlAlt`, then `imageUrlFallback`, then its own
 * default before giving up. SKU stays the primary identifier throughout.
 *
 * Embedded objects are dispatched via the parent key (`brand`,
 * `category`, `subcategory`) so brands and categories — which share
 * `{slug, name, nameAr}` shape after a `select` — go to the right
 * namespace. Top-level brand list responses are decorated by the brand
 * service itself; the structural `looksLikeCategory` detector is
 * tightened so it no longer false-positives on a brand row.
 */
const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  if (v instanceof Date) return false;
  const ctorName = (v as { constructor?: { name?: string } }).constructor?.name;
  if (ctorName === 'Decimal') return false;
  if (ctorName === 'Buffer') return false;
  return true;
};

const looksLikeProduct = (obj: Record<string, unknown>) =>
  'name' in obj && (typeof obj.sku === 'string' || Array.isArray(obj.variants));

// Categories carry either a `subcategories` array (parent rows) or a
// `categoryId` string (subcategory rows). Brands have neither.
const looksLikeCategory = (obj: Record<string, unknown>) =>
  typeof obj.slug === 'string' &&
  typeof obj.name === 'string' &&
  !Array.isArray(obj.variants) &&
  (Array.isArray(obj.subcategories) || typeof obj.categoryId === 'string');

const looksLikeVariantRow = (obj: Record<string, unknown>) =>
  typeof obj.sku === 'string' && isPlainObject(obj.product);

const hasNonEmptyString = (obj: Record<string, unknown>, key: string) =>
  typeof obj[key] === 'string' && (obj[key] as string).trim().length > 0;

function decorate(payload: unknown, parentKey?: string): unknown {
  if (Array.isArray(payload)) {
    return payload.map((p) => decorate(p, parentKey));
  }
  if (!isPlainObject(payload)) return payload;

  const obj = payload as Record<string, unknown>;

  // A subcategory row is any object with a `categoryId` string — parent-key
  // dispatch (`subcategory`) may be absent when the row is a top-level list
  // item. When present, prefer an admin-supplied stored URL; fall back to
  // slug-derived. Categories keep the current slug-always behavior.
  const isSubcategoryRow =
    parentKey === 'subcategory' ||
    (typeof obj.slug === 'string' &&
      typeof obj.name === 'string' &&
      typeof obj.categoryId === 'string');
  const storedImageUrl =
    typeof obj.imageUrl === 'string' && obj.imageUrl.trim().length > 0
      ? obj.imageUrl
      : null;

  // Parent-key dispatch — disambiguates brand from category/subcategory
  // when a `select` strips the structural cues.
  if (parentKey === 'brand' && typeof obj.slug === 'string') {
    obj.imageUrl = getBrandImageUrl(obj.slug);
  } else if (isSubcategoryRow && typeof obj.slug === 'string') {
    obj.imageUrl = storedImageUrl ?? getCategoryImageUrl(obj.slug);
  } else if (parentKey === 'category' && typeof obj.slug === 'string') {
    obj.imageUrl = getCategoryImageUrl(obj.slug);
  } else if (looksLikeVariantRow(obj)) {
    const sku = obj.sku as string;
    const product = obj.product as Record<string, unknown>;
    const barcode = typeof product.barcode === 'string' ? product.barcode : undefined;
    const precomputedAlt = hasNonEmptyString(product, 'imageUrlAlt')
      ? (product.imageUrlAlt as string)
      : getProductImageAltUrl(sku);
    const precomputedFallback = hasNonEmptyString(product, 'imageUrlFallback')
      ? (product.imageUrlFallback as string)
      : getProductImageUrl(barcode);
    obj.product = {
      ...product,
      imageUrl: getProductImageUrl(sku),
      imageUrlAlt: precomputedAlt,
      imageUrlFallback: precomputedFallback,
    };
  } else if (looksLikeProduct(obj)) {
    const flatSku = typeof obj.sku === 'string' ? obj.sku : undefined;
    const variants = Array.isArray(obj.variants) ? (obj.variants as Array<{ sku?: string }>) : [];
    const resolvedSku = flatSku ?? variants[0]?.sku;
    obj.imageUrl = getProductImageUrl(resolvedSku);
    // A mapper may have already computed these from fields the final DTO
    // deliberately doesn't expose (e.g. slim storefront/cart/checkout
    // cards) — respect them instead of recomputing from an absent field,
    // same precedence rule as `storedImageUrl` below for subcategories.
    if (!hasNonEmptyString(obj, 'imageUrlAlt')) {
      obj.imageUrlAlt = getProductImageAltUrl(resolvedSku);
    }
    if (!hasNonEmptyString(obj, 'imageUrlFallback')) {
      const flatBarcode = typeof obj.barcode === 'string' ? obj.barcode : undefined;
      obj.imageUrlFallback = getProductImageUrl(flatBarcode);
    }
  } else if (looksLikeCategory(obj)) {
    obj.imageUrl = getCategoryImageUrl(obj.slug as string);
  }

  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === 'object') {
      obj[key] = decorate(v, key);
    }
  }
  return obj;
}

export function decorateProductImages<T>(payload: T): T {
  return decorate(payload) as T;
}
