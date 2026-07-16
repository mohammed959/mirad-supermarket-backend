/**
 * Pure domain utility for the product availability rule.
 *
 * Kept as a stand-alone module (no Prisma, no other service imports) so
 * downstream mappers (e.g. the storefront home aggregator) can reuse it
 * without pulling in a service module — which would transitively
 * initialise Prisma just to import a two-line predicate.
 *
 * `product.service.ts` and the storefront mapper both import from here.
 */

/** Minimal shape needed to answer "is this product available?". */
export type ProductWithStock = {
  stock: number;
  reserved: number;
  isActive: boolean;
};

/**
 * A product is available when it is active AND has at least one unit of
 * unreserved stock. This is the single source of truth for card
 * availability across the app.
 */
export const isProductAvailable = (product: ProductWithStock): boolean =>
  product.isActive && product.stock - product.reserved > 0;

/** Variant availability shape — only the fields the OR rule needs. */
export type VariantForAvailability = {
  isActive: boolean;
  stock: number;
  reserved: number;
};

export type ProductWithVariants = ProductWithStock & {
  variants: VariantForAvailability[];
};

/**
 * Variant-aware availability. Preserves the legacy `listSections(true)`
 * rule: a product is "available" if either the flat product row has
 * unreserved stock OR any of its active variants does.
 *
 * Used only by paths that need to keep legacy variant-only products
 * visible (currently: the storefront featured-sections read). Every
 * other surface should keep using `isProductAvailable` — the product-
 * level rule is the app-wide convention.
 */
export const isProductAvailableConsideringVariants = (
  product: ProductWithVariants,
): boolean => {
  if (!product.isActive) return false;
  if (product.stock - product.reserved > 0) return true;
  return product.variants.some(
    (v) => v.isActive && v.stock - v.reserved > 0,
  );
};
