import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { CreateProductInput, UpdateProductInput } from './product.schema';

/**
 * Standard paginated payload. Returns the new ninja-style fields
 * (pageSize/totalItems/totalPages/hasNextPage/hasPreviousPage) plus the legacy
 * shape (page/limit/total/pages) so we don't break clients still reading
 * those.
 */
export function buildPagination(page: number, limit: number, total: number) {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    page,
    pageSize: limit,
    totalItems: total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1,
    // Legacy keys retained for backwards-compatible callers.
    limit,
    total,
    pages: totalPages,
  };
}

export interface ProductListOptions {
  categoryId?: string;
  subcategoryId?: string;
  featured?: boolean;
  search?: string;
  page?: number;
  limit?: number;
  includeOutOfStock?: boolean;
  includeInactive?: boolean;
  excludeHiddenFromHome?: boolean;
}

export async function listProducts(opts: ProductListOptions = {}) {
  const {
    categoryId,
    subcategoryId,
    featured,
    search,
    page = 1,
    limit = 20,
    includeOutOfStock = false,
    includeInactive = false,
    excludeHiddenFromHome = false,
  } = opts;

  const where: Prisma.ProductWhereInput = {
    ...(!includeInactive && { isActive: true }),
    ...(excludeHiddenFromHome && { hideFromHome: false }),
    ...(categoryId && { categoryId }),
    ...(subcategoryId && { subcategoryId }),
    ...(featured !== undefined && { isFeatured: featured }),
    ...(search && {
      OR: [
        { name: { contains: search } },
        { nameAr: { contains: search } },
        { variants: { some: { sku: { contains: search } } } },
        { variants: { some: { barcode: { contains: search } } } },
      ],
    }),
    // Browsing hides products with zero available stock; admin / search bypasses this.
    ...(!includeInactive && !includeOutOfStock && {
      variants: { some: { isActive: true, stock: { gt: 0 } } },
    }),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        category: { select: { id: true, name: true, nameAr: true } },
        subcategory: { select: { id: true, name: true, nameAr: true } },
        variants: {
          where: includeInactive ? {} : { isActive: true },
          orderBy: { price: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    products,
    pagination: buildPagination(page, limit, total),
  };
}

export async function getProductById(id: string) {
  return prisma.product.findUnique({
    where: { id },
    include: {
      category: true,
      subcategory: true,
      variants: { where: { isActive: true }, orderBy: { price: 'asc' } },
    },
  });
}

export async function createProduct(data: CreateProductInput) {
  const { variants, ...productData } = data;
  return prisma.product.create({
    data: {
      ...productData,
      variants: {
        create: variants.map((v) => ({
          type: v.type,
          sku: v.sku,
          barcode: v.barcode,
          price: v.price,
          stock: v.stock,
        })),
      },
    },
    include: { variants: true },
  });
}

export async function updateProduct(id: string, data: UpdateProductInput) {
  return prisma.product.update({ where: { id }, data });
}

export async function toggleProductStatus(id: string, isActive: boolean) {
  return prisma.product.update({ where: { id }, data: { isActive } });
}

export async function deleteProduct(id: string) {
  return prisma.product.delete({ where: { id } });
}

export async function createVariant(productId: string, data: {
  type: 'PIECE' | 'CARTON' | 'DOZEN' | 'BUNDLE';
  sku: string;
  barcode?: string;
  price: number;
  stock: number;
}) {
  return prisma.productVariant.create({ data: { ...data, productId } });
}

export async function updateVariant(id: string, data: Partial<{
  price: number;
  stock: number;
  barcode: string;
  isActive: boolean;
}>) {
  return prisma.productVariant.update({ where: { id }, data });
}

export async function adjustStock(variantId: string, delta: number) {
  return prisma.productVariant.update({
    where: { id: variantId },
    data: { stock: { increment: delta } },
  });
}

export async function getFeaturedProducts() {
  return prisma.product.findMany({
    where: {
      isActive: true,
      isFeatured: true,
      variants: { some: { isActive: true, stock: { gt: 0 } } },
    },
    include: {
      category: { select: { id: true, name: true, nameAr: true } },
      subcategory: { select: { id: true, name: true, nameAr: true } },
      variants: { where: { isActive: true }, orderBy: { price: 'asc' } },
    },
    take: 20,
  });
}

// ─── Smart search ──────────────────────────────────────────────────

const annotateAvailability = <P extends { variants: { stock: number; reserved: number; isActive: boolean }[] }>(
  product: P
) => {
  const variantsWithAvail = product.variants.map((v) => ({
    ...v,
    available: v.isActive && v.stock - v.reserved > 0,
  }));
  const anyAvailable = variantsWithAvail.some((v) => v.available);
  return { ...product, variants: variantsWithAvail, available: anyAvailable };
};

export async function searchProducts(opts: {
  q?: string;
  barcode?: string;
  page?: number;
  limit?: number;
}) {
  const { q, barcode } = opts;
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.max(1, Math.min(100, opts.limit ?? 20));

  // Barcode lookup: exact match on any variant. Single result by design.
  if (barcode && barcode.trim()) {
    const variant = await prisma.productVariant.findFirst({
      where: { barcode: barcode.trim(), isActive: true, product: { isActive: true } },
      include: {
        product: {
          include: {
            category: { select: { id: true, name: true, nameAr: true } },
            subcategory: { select: { id: true, name: true, nameAr: true } },
            variants: { where: { isActive: true }, orderBy: { price: 'asc' } },
          },
        },
      },
    });
    if (!variant) {
      return {
        products: [],
        matchedVariantId: null,
        pagination: buildPagination(1, limit, 0),
      };
    }
    return {
      products: [annotateAvailability(variant.product)],
      matchedVariantId: variant.id,
      pagination: buildPagination(1, limit, 1),
    };
  }

  const term = (q ?? '').trim();
  if (!term) {
    return {
      products: [],
      matchedVariantId: null,
      pagination: buildPagination(page, limit, 0),
    };
  }

  const where: Prisma.ProductWhereInput = {
    isActive: true,
    OR: [
      { name: { contains: term } },
      { nameAr: { contains: term } },
      { variants: { some: { sku: { contains: term } } } },
      { variants: { some: { barcode: { contains: term } } } },
    ],
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        category: { select: { id: true, name: true, nameAr: true } },
        subcategory: { select: { id: true, name: true, nameAr: true } },
        variants: { where: { isActive: true }, orderBy: { price: 'asc' } },
      },
      // Featured first, then deterministic id order so paging is stable.
      orderBy: [{ isFeatured: 'desc' }, { id: 'asc' }],
    }),
    prisma.product.count({ where }),
  ]);

  // Sort: in-stock first, then OOS — matches "show product, disabled add for OOS"
  const annotated = products.map(annotateAvailability);
  annotated.sort((a, b) => Number(b.available) - Number(a.available));

  return {
    products: annotated,
    matchedVariantId: null,
    pagination: buildPagination(page, limit, total),
  };
}

export async function listLowStockVariants(threshold = 5) {
  return prisma.productVariant.findMany({
    where: {
      isActive: true,
      stock: { lte: threshold },
      product: { isActive: true },
    },
    include: {
      product: { select: { id: true, name: true, nameAr: true, imageUrl: true } },
    },
    orderBy: { stock: 'asc' },
    take: 100,
  });
}

export async function searchSuggestions(q: string, limit = 8) {
  const term = q.trim();
  if (!term) return [];
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: term } },
        { nameAr: { contains: term } },
      ],
    },
    select: { id: true, name: true, nameAr: true, imageUrl: true },
    take: limit,
    orderBy: { isFeatured: 'desc' },
  });
  return products;
}
