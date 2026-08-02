import { prisma } from '../../lib/prisma';
import {
  toCategoryCard,
  type CategoryRow,
} from '../storefront/productCard.mapper';
import type { HomeCategoryCard } from '../storefront/storefront.types';
import { getCategoryImageUrl } from '../../lib/productImage';
import type { Lang } from './category.schema';

/**
 * Marketplace card returned by `POST /api/categories/list`.
 *
 * Stripped shape — no `nameAr`, `isActive`, `showOnHome`, `subcategories`,
 * `createdAt`, `updatedAt`. `name` is the locale-picked field.
 */
export interface MarketplaceCategoryCard {
  id: string;
  name: string;
  slug: string;
  imageUrl: string;
  sortOrder: number;
}

/**
 * Storefront-home optimised category read.
 *
 * Returns only categories that are active AND flagged to show on the home
 * strip. Each category carries its `subCategories` filtered to `isActive`
 * subs, ordered by `sortOrder asc`, mapped through the shared mapper — so
 * inactive subcategories are dropped in-query (not post-filtered) and
 * the payload arrives already sorted.
 *
 * Query cost: a single `findMany` with a nested-relation `select`. Prisma
 * resolves nested `select` on a relation without an extra round-trip per
 * parent row — cost is bounded and independent of the number of parent
 * categories, so there is no N+1. Callers add no further per-row reads.
 *
 * The category-level `imageUrl` column is intentionally NOT selected. It
 * is dead-code at the wire today: `lib/productImage.decorateProductImages`
 * and `toCategoryCard` both derive it from `slug`. The subcategory-level
 * `imageUrl` IS selected because the mapper preserves a non-empty stored
 * URL and falls back to slug-derived only when it is null/empty — which
 * matches the decorator's subcategory branch.
 */
export async function getHomepageCategories(lang: Lang = 'ar'): Promise<HomeCategoryCard[]> {
  const rows = await prisma.category.findMany({
    where: { isActive: true, showOnHome: true },
    select: {
      id: true,
      name: true,
      nameAr: true,
      slug: true,
      sortOrder: true,
      subcategories: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          nameAr: true,
          slug: true,
          imageUrl: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((row: CategoryRow) => toCategoryCard(row, lang));
}

/**
 * Marketplace `POST /categories/list` read.
 *
 * Returns only active categories, in the stripped marketplace shape. `name`
 * is picked from the row per `lang` (default `'ar'`). Sorted by `sortOrder`.
 * No subcategories, no admin flags, no audit timestamps.
 */
export async function listMarketplaceCategories(
  lang: Lang = 'ar',
): Promise<MarketplaceCategoryCard[]> {
  const rows = await prisma.category.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      nameAr: true,
      slug: true,
      imageUrl: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((row) => {
    const stored = typeof row.imageUrl === 'string' ? row.imageUrl.trim() : '';
    return {
      id: row.id,
      name: lang === 'ar' ? row.nameAr : row.name,
      slug: row.slug,
      imageUrl: stored.length > 0 ? stored : getCategoryImageUrl(row.slug),
      sortOrder: row.sortOrder,
    };
  });
}

export async function getCategories(activeOnly = true, homeOnly = false) {
  return prisma.category.findMany({
    where: {
      ...(activeOnly ? { isActive: true } : {}),
      // Home strip only: active AND flagged to show on home.
      ...(homeOnly ? { showOnHome: true } : {}),
    },
    include: {
      subcategories: {
        where: activeOnly ? { isActive: true } : {},
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { sortOrder: 'asc' },
  });
}

export async function getCategoryById(id: string) {
  return prisma.category.findUnique({
    where: { id },
    include: { subcategories: { orderBy: { sortOrder: 'asc' } } },
  });
}

export async function createCategory(data: {
  name: string;
  nameAr: string;
  slug: string;
  imageUrl?: string;
  sortOrder?: number;
  showOnHome?: boolean;
}) {
  return prisma.category.create({ data });
}

export async function updateCategory(id: string, data: Partial<{
  name: string;
  nameAr: string;
  slug: string;
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
  showOnHome: boolean;
}>) {
  return prisma.category.update({ where: { id }, data });
}

export async function deleteCategory(id: string) {
  return prisma.category.delete({ where: { id } });
}

export async function createSubcategory(data: {
  categoryId: string;
  name: string;
  nameAr: string;
  slug: string;
  imageUrl?: string | null;
  sortOrder?: number;
}) {
  return prisma.subcategory.create({ data });
}

export async function updateSubcategory(id: string, data: Partial<{
  name: string;
  nameAr: string;
  slug: string;
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
}>) {
  return prisma.subcategory.update({ where: { id }, data });
}

export async function deleteSubcategory(id: string) {
  return prisma.subcategory.delete({ where: { id } });
}
