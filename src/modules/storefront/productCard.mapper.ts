/**
 * Pure mapping functions from raw Prisma rows to the homepage DTOs.
 *
 * Design rules enforced here:
 *   • No mutation of the input row.
 *   • Only DTO fields are produced — internal fields (`stock`, `reserved`,
 *     `isActive`, joined relations, audit timestamps) are dropped.
 *   • The availability rule is reused from `product.service.ts` — the
 *     single source of truth across the app.
 *   • Image URLs come from the existing helpers in `lib/productImage.ts`
 *     so the CDN convention (and the frontend `<img onError>` fallback)
 *     stays byte-identical to today's decorated responses.
 *   • Prisma Decimal → string via `.toString()` (matches `Decimal.toJSON`
 *     behavior, which is what Express currently serializes today).
 */

import {
  getProductImageUrl,
  getCategoryImageUrl,
} from '../../lib/productImage';
import {
  isProductAvailable,
  type ProductWithStock,
} from '../products/productAvailability';

import type {
  HomeBanner,
  HomeCategoryCard,
  HomeFeaturedSection,
  ProductCard,
} from './storefront.types';

// ── Loose row shapes ─────────────────────────────────────────────────
// Kept intentionally narrow so mapper callers can pass any Prisma
// `select`/`include` result whose fields are a superset of these.

/** Anything with a `.toString()` — matches Prisma Decimal. */
type Stringifiable = { toString(): string };

export interface ProductRow extends ProductWithStock {
  id: string;
  name: string;
  nameAr: string;
  sku: string | null;
  price: number | string | Stringifiable | null;
}

export interface CategoryRow {
  id: string;
  name: string;
  nameAr: string;
  slug: string;
  sortOrder: number;
}

export interface BannerRow {
  id: string;
  title: string;
  titleAr: string;
  imageUrl: string;
  linkType: string | null;
  linkValue: string | null;
  sortOrder: number;
}

export interface FeaturedSectionItemRow {
  product: ProductRow;
}

export interface FeaturedSectionRow {
  id: string;
  name: string;
  nameAr: string;
  sortOrder: number;
  items: FeaturedSectionItemRow[];
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Normalize a Prisma Decimal / number / string / null into the wire-format
 * used by the current homepage endpoints. Prisma Decimal implements
 * `.toString()`, and `Decimal.toJSON()` calls the same method — so this
 * matches today's serialized output exactly.
 */
function normalizePrice(
  value: number | string | Stringifiable | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return value.toString();
}

// ── Mappers ──────────────────────────────────────────────────────────

/**
 * Convert a Prisma product row into a `ProductCard`.
 *
 * By default `available` is computed by the app-wide `isProductAvailable`
 * predicate. Callers that need a different rule (e.g. the storefront
 * featured-sections read, which must keep legacy variant-only products
 * visible) may pass an already-computed `available` — it takes precedence
 * over the row-based default. This lets the mapper stay pure and single-
 * purpose while allowing pathway-specific availability semantics.
 */
export function toProductCard(row: ProductRow, available?: boolean): ProductCard {
  return {
    id: row.id,
    name: row.name,
    nameAr: row.nameAr,
    sku: row.sku,
    imageUrl: getProductImageUrl(row.sku),
    price: normalizePrice(row.price),
    available: typeof available === 'boolean' ? available : isProductAvailable(row),
  };
}

export function toCategoryCard(row: CategoryRow): HomeCategoryCard {
  return {
    id: row.id,
    name: row.name,
    nameAr: row.nameAr,
    slug: row.slug,
    imageUrl: getCategoryImageUrl(row.slug),
    sortOrder: row.sortOrder,
  };
}

export function toBanner(row: BannerRow): HomeBanner {
  return {
    id: row.id,
    title: row.title,
    titleAr: row.titleAr,
    imageUrl: row.imageUrl,
    linkType: row.linkType,
    linkValue: row.linkValue,
    sortOrder: row.sortOrder,
  };
}

export function toFeaturedSection(row: FeaturedSectionRow): HomeFeaturedSection {
  return {
    id: row.id,
    name: row.name,
    nameAr: row.nameAr,
    sortOrder: row.sortOrder,
    products: row.items.map((item) => toProductCard(item.product)),
  };
}
