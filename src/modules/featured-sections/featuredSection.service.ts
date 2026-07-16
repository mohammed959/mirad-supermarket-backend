import { prisma } from '../../lib/prisma';
import {
  toProductCard,
  type ProductRow,
} from '../storefront/productCard.mapper';
import {
  isProductAvailableConsideringVariants,
  type ProductWithVariants,
} from '../products/productAvailability';
import type {
  HomeFeaturedSection,
  ProductCard,
} from '../storefront/storefront.types';

/**
 * Storefront-home optimised featured-section read.
 *
 * Preserves the current `listSections(true)` availability contract
 * exactly (Approach B — see Step 2 hardening report):
 *
 *   - Item inclusion filter: `isProductAvailableConsideringVariants` —
 *     product-level unreserved stock OR at least one active variant with
 *     unreserved stock. This mirrors today's legacy variant fallback.
 *   - Card `available` field: same OR rule (so a card that made it into
 *     a section is never shown as unavailable).
 *   - Sections with zero eligible items are still hidden.
 *   - Ordering matches: sections `[{ sortOrder: 'asc' }, { createdAt: 'desc' }]`,
 *     items `{ sortOrder: 'asc' }`.
 *
 * Query shape:
 *   - No `category` / `subcategory` / `brand` include.
 *   - `variants` are selected with a minimal `{ isActive, stock, reserved }`
 *     shape ONLY for the availability computation; they never appear in
 *     the DTO because `toProductCard` whitelists its output fields.
 *   - A cheap SQL pre-filter (`product.isActive && product.stock > 0`)
 *     narrows the row set before the JS-side OR rule kicks in. Products
 *     with `stock === 0` still pass the pre-filter and go through the
 *     variant check.
 */
export async function listSectionsForHome(): Promise<HomeFeaturedSection[]> {
  const sections = await prisma.featuredSection.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      name: true,
      nameAr: true,
      sortOrder: true,
      items: {
        where: {
          product: { isActive: true },
        },
        orderBy: { sortOrder: 'asc' },
        select: {
          product: {
            select: {
              id: true,
              name: true,
              nameAr: true,
              sku: true,
              price: true,
              stock: true,
              reserved: true,
              isActive: true,
              // Minimal variant slice for the OR availability rule.
              // Variants NEVER appear in the DTO — `toProductCard`
              // whitelists its output.
              variants: {
                where: { isActive: true },
                select: { isActive: true, stock: true, reserved: true },
              },
            },
          },
        },
      },
    },
  });

  const dto: HomeFeaturedSection[] = [];
  for (const section of sections) {
    const products: ProductCard[] = [];
    for (const item of section.items) {
      const raw = item.product as unknown as ProductWithVariants & ProductRow;
      const available = isProductAvailableConsideringVariants(raw);
      if (!available) continue;
      products.push(toProductCard(raw, available));
    }
    if (products.length === 0) continue;
    dto.push({
      id: section.id,
      name: section.name,
      nameAr: section.nameAr,
      sortOrder: section.sortOrder,
      products,
    });
  }
  return dto;
}

export async function listSections(activeOnly = true) {
  const sections = await prisma.featuredSection.findMany({
    where: activeOnly ? { isActive: true } : {},
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
        include: {
          product: {
            include: {
              category: { select: { id: true, name: true, nameAr: true } },
              subcategory: { select: { id: true, name: true, nameAr: true } },
              variants: { where: { isActive: true }, orderBy: { price: 'asc' } },
            },
          },
        },
      },
    },
  });

  // When activeOnly, drop products that are inactive / out of stock so the
  // section quietly hides them on the customer home. Phase 5+ flat products
  // carry stock at the product level; legacy rows still resolve through
  // their variants until the backfill completes.
  if (activeOnly) {
    const inStock = (product: {
      isActive: boolean;
      stock: number;
      reserved: number;
      variants: { isActive: boolean; stock: number; reserved: number }[];
    }) => {
      if (!product.isActive) return false;
      if (product.stock - product.reserved > 0) return true;
      return product.variants.some((v) => v.isActive && v.stock - v.reserved > 0);
    };
    return sections
      .map((s) => ({
        ...s,
        items: s.items.filter((it) => inStock(it.product)),
      }))
      .filter((s) => s.items.length > 0);
  }

  return sections;
}

export async function getSection(id: string) {
  return prisma.featuredSection.findUnique({
    where: { id },
    include: {
      items: {
        orderBy: { sortOrder: 'asc' },
        include: {
          product: {
            select: { id: true, name: true, nameAr: true, imageUrl: true, isActive: true },
          },
        },
      },
    },
  });
}

export async function createSection(data: {
  name: string;
  nameAr: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  return prisma.featuredSection.create({ data });
}

export async function updateSection(
  id: string,
  data: Partial<{ name: string; nameAr: string; sortOrder: number; isActive: boolean }>
) {
  return prisma.featuredSection.update({ where: { id }, data });
}

export async function deleteSection(id: string) {
  return prisma.featuredSection.delete({ where: { id } });
}

export async function addProducts(sectionId: string, productIds: string[]) {
  if (productIds.length === 0) return [];
  // Determine current max sortOrder
  const existing = await prisma.featuredSectionItem.findMany({
    where: { sectionId },
    select: { sortOrder: true, productId: true },
  });
  const taken = new Set(existing.map((e) => e.productId));
  const toCreate = productIds.filter((id) => !taken.has(id));
  if (toCreate.length === 0) return [];
  let base = existing.reduce((max, e) => Math.max(max, e.sortOrder), -1);
  return prisma.$transaction(
    toCreate.map((productId) =>
      prisma.featuredSectionItem.create({
        data: { sectionId, productId, sortOrder: ++base },
      })
    )
  );
}

export async function removeProduct(sectionId: string, productId: string) {
  return prisma.featuredSectionItem.deleteMany({ where: { sectionId, productId } });
}

export async function reorderProduct(itemId: string, delta: number) {
  const item = await prisma.featuredSectionItem.findUnique({ where: { id: itemId } });
  if (!item) return null;
  return prisma.featuredSectionItem.update({
    where: { id: itemId },
    data: { sortOrder: item.sortOrder + delta },
  });
}
