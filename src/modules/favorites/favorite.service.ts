import { prisma } from '../../lib/prisma';

export async function listFavorites(customerId: string) {
  const favs = await prisma.favorite.findMany({
    where: { customerId },
    include: {
      product: {
        include: {
          category: { select: { id: true, name: true, nameAr: true } },
          subcategory: { select: { id: true, name: true, nameAr: true } },
          variants: { where: { isActive: true }, orderBy: { price: 'asc' } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
  return favs.map((f) => ({
    favoriteId: f.id,
    createdAt: f.createdAt,
    product: f.product,
  }));
}

export async function listFavoriteIds(customerId: string) {
  const favs = await prisma.favorite.findMany({
    where: { customerId },
    select: { productId: true },
  });
  return favs.map((f) => f.productId);
}

export async function addFavorite(customerId: string, productId: string) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('Product not found');
  return prisma.favorite.upsert({
    where: { customerId_productId: { customerId, productId } },
    create: { customerId, productId },
    update: {},
  });
}

export async function removeFavorite(customerId: string, productId: string) {
  return prisma.favorite.deleteMany({ where: { customerId, productId } });
}

export async function isFavorited(customerId: string, productId: string) {
  const fav = await prisma.favorite.findUnique({
    where: { customerId_productId: { customerId, productId } },
  });
  return Boolean(fav);
}
