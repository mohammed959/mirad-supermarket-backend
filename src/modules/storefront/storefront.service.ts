/**
 * Storefront home aggregation service.
 *
 * Sole entry point: `getStorefrontHome()`. Composes the Step 2 optimised
 * read functions plus the existing banner and home-settings services into
 * the `HomeAggregate` DTO defined in `storefront.types.ts`.
 *
 * Rules honored here:
 *   • Orchestration only — no Prisma calls, no availability logic, no
 *     image logic, no DTO mapping, no pagination math. All of that lives
 *     in the underlying services / mappers.
 *   • Public data only. Buy-again, favorites, addresses, subscriptions,
 *     notifications, delivery/branch, and every other personal or gate
 *     read stays outside this service.
 *   • Fail-fast. Any rejected dependency propagates unchanged — no
 *     section-level catches, no partial payloads, no synthetic empties.
 *
 * Namespace imports (`import * as`) are used deliberately so the
 * aggregator resolves each dependency at call time. This lets the tests
 * monkey-patch the shared module exports without introducing a DI
 * framework.
 */

import * as categorySvc from '../categories/category.service';
import * as bannerSvc from '../banners/banner.service';
import * as productSvc from '../products/product.service';
import * as sectionSvc from '../featured-sections/featuredSection.service';
import * as settingsSvc from '../settings/settings.service';

import { toBanner, type BannerRow } from './productCard.mapper';
import type { HomeAggregate } from './storefront.types';

/**
 * Read the admin-configured all-products page size defensively.
 *
 * Current codebase behavior (verified against
 * `modules/settings/settings.service.ts` + `settings.controller.ts` +
 * `prisma/schema.prisma`):
 *
 *   • `HomeSettings.allProductsLimit` — DB column, `Int @default(20)`.
 *   • `getHomeSettings()` self-heals: it returns an existing row or
 *     creates one with `{}`, which materialises the DB default (20).
 *     So the stored value is never `undefined`/`null` at read time.
 *   • The admin write path in `settings.controller.ts` runs a Zod
 *     schema: `.int().min(ALL_PRODUCTS_LIMIT_MIN=1).max(ALL_PRODUCTS_LIMIT_MAX=100)`.
 *     Values outside that range are rejected before hitting the DB.
 *   • The products controller separately caps `pageSize` at 100 (this is
 *     the hard ceiling the admin bounds mirror).
 *
 * The only way a truly invalid value lands on the read path is a manual
 * SQL insertion outside the app. To harden against that without changing
 * any observable behavior for legitimate values, we clamp defensively:
 *
 *   • non-integer / non-finite / < MIN → `ALL_PRODUCTS_LIMIT_DEFAULT` (20).
 *   • > MAX → clamp to `ALL_PRODUCTS_LIMIT_MAX` (100).
 *   • values already inside [MIN, MAX] pass through untouched.
 */
function resolveAllProductsLimit(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return settingsSvc.ALL_PRODUCTS_LIMIT_DEFAULT;
  }
  if (n < settingsSvc.ALL_PRODUCTS_LIMIT_MIN) {
    return settingsSvc.ALL_PRODUCTS_LIMIT_DEFAULT;
  }
  if (n > settingsSvc.ALL_PRODUCTS_LIMIT_MAX) {
    return settingsSvc.ALL_PRODUCTS_LIMIT_MAX;
  }
  return n;
}

/**
 * Aggregate every public storefront-home read into one `HomeAggregate`.
 *
 * Execution model:
 *   Stage 1 (parallel via `Promise.all`):
 *     - categories, banners, featured products, featured sections, home settings
 *   Stage 2 (after Stage 1 resolves):
 *     - all-products (page 1, limit = resolveAllProductsLimit(settings))
 *
 * Any rejected dependency short-circuits the whole call — Stage 2 never
 * starts on a Stage 1 failure because `Promise.all` rejects immediately.
 */
export async function getStorefrontHome(): Promise<HomeAggregate> {
  // ─── Stage 1 — parallel public reads ────────────────────────────────
  const [categories, bannerRows, featuredProducts, featuredSections, settings] =
    await Promise.all([
      categorySvc.getHomepageCategories(),
      bannerSvc.listBanners(true),
      productSvc.listFeaturedProductCardsForHome(),
      sectionSvc.listSectionsForHome(),
      settingsSvc.getHomeSettings(),
    ]);

  const allProductsLimit = resolveAllProductsLimit(
    (settings as { allProductsLimit?: unknown }).allProductsLimit,
  );

  // ─── Stage 2 — all-products, sized by resolved settings ─────────────
  const allProducts = await productSvc.listProductCardsForHome({
    page: 1,
    limit: allProductsLimit,
    excludeHiddenFromHome: true,
  });

  return {
    categories,
    banners: (bannerRows as unknown as BannerRow[]).map((row) => toBanner(row)),
    featuredProducts,
    featuredSections,
    allProducts: {
      items: allProducts.items,
      hasMore: allProducts.total > allProducts.items.length,
    },
  };
}
