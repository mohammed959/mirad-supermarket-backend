import { prisma } from '../../lib/prisma';
import type { Lang } from '../categories/category.schema';

const pickName = (lang: Lang, en: string, ar: string) =>
  lang === 'ar' ? (ar || en) : (en || ar);

/** Localizes `name` on a `{name, nameAr, ...}` object, dropping `nameAr`. */
function localizeNamed<T extends { name: string; nameAr: string }>(
  obj: T,
  lang: Lang,
): Omit<T, 'nameAr'> & { name: string } {
  const { nameAr, ...rest } = obj;
  return { ...rest, name: pickName(lang, obj.name, nameAr) };
}

/**
 * Localizes `name` (dropping `nameAr`) on the product and its
 * category/subcategory, per `lang` (default `'ar'`). Every other field
 * (description, descriptionAr, variants, sku, price, stock, ...) is left
 * untouched.
 */
function localizeFavoriteProduct<
  T extends {
    name: string;
    nameAr: string;
    category: { name: string; nameAr: string } | null;
    subcategory: { name: string; nameAr: string } | null;
  },
>(product: T, lang: Lang) {
  return {
    ...localizeNamed(product, lang),
    category: product.category ? localizeNamed(product.category, lang) : null,
    subcategory: product.subcategory ? localizeNamed(product.subcategory, lang) : null,
  };
}

export async function listFavorites(customerId: string, lang: Lang = 'ar') {
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
    product: localizeFavoriteProduct(f.product, lang),
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
