import { prisma } from '../../lib/prisma';
import {
  toCategoryCard,
  type CategoryRow,
} from '../storefront/productCard.mapper';
import type { HomeCategoryCard } from '../storefront/storefront.types';

/**
 * Storefront-home optimised category read.
 *
 * Returns only categories that are active AND flagged to show on the home
 * strip. Skips the `subcategories` include entirely — the home row does
 * not render subcategories, and dropping the join keeps the payload +
 * query cost minimal.
 *
 * The DB `imageUrl` column is intentionally NOT selected. It is dead-code
 * at the wire today: `lib/productImage.decorateProductImages` runs on
 * every `ok()` response and unconditionally overwrites any category
 * `imageUrl` with `getCategoryImageUrl(slug)` (both the `looksLikeCategory`
 * branch and the `parentKey === 'category'` branch). Selecting the column
 * would ship bytes the wire never uses. The Step 1 `toCategoryCard`
 * mapper derives `imageUrl` from `slug` the same way, so behavior is
 * byte-identical to every existing category-returning endpoint today.
 *
 * Ordering matches `getCategories(true, true)` (sortOrder asc). Mapped
 * through the Step 1 `toCategoryCard` so the DTO stays authoritative.
 */
export async function getHomepageCategories(): Promise<HomeCategoryCard[]> {
  const rows = await prisma.category.findMany({
    where: { isActive: true, showOnHome: true },
    select: {
      id: true,
      name: true,
      nameAr: true,
      slug: true,
      sortOrder: true,
    },
    orderBy: { sortOrder: 'asc' },
  });
  return rows.map((row: CategoryRow) => toCategoryCard(row));
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
  imageUrl?: string;
  sortOrder?: number;
}) {
  return prisma.subcategory.create({ data });
}

export async function updateSubcategory(id: string, data: Partial<{
  name: string;
  nameAr: string;
  slug: string;
  imageUrl: string;
  sortOrder: number;
  isActive: boolean;
}>) {
  return prisma.subcategory.update({ where: { id }, data });
}

export async function deleteSubcategory(id: string) {
  return prisma.subcategory.delete({ where: { id } });
}
