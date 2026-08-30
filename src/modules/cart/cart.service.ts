import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { isProductAvailable } from '../products/productAvailability';
import type { AddOrAdjustCartItemInput, Lang } from './cart.schema';

type CartItemWithProduct = Prisma.CartItemGetPayload<{ include: { product: true } }>;

export interface CartItemView {
  itemId: string;
  productId: string;
  name: string;
  sku: string | null;
  imageUrl: string | null;
  price: number;
  quantity: number;
  subtotal: number;
  available: boolean;
}

const pickName = (lang: Lang, en: string, ar: string) => (lang === 'ar' ? ar : en);

function toCartItemView(item: CartItemWithProduct, lang: Lang): CartItemView {
  const price = item.product.price === null ? 0 : Number(item.product.price);
  return {
    itemId: item.productId,
    productId: item.productId,
    name: pickName(lang, item.product.name, item.product.nameAr),
    sku: item.product.sku,
    imageUrl: item.product.imageUrl,
    price,
    quantity: item.quantity,
    subtotal: Math.round(price * item.quantity * 100) / 100,
    available: isProductAvailable(item.product),
  };
}

async function getOrCreateCart(userId: string) {
  return prisma.cart.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
}

export async function getCart(userId: string, lang: Lang) {
  const cart = await prisma.cart.findUnique({
    where: { userId },
    include: { items: { include: { product: true }, orderBy: { createdAt: 'asc' } } },
  });
  const items = cart?.items ?? [];
  return {
    userId,
    activeItemsCount: items.length,
    items: items.map((item) => toCartItemView(item, lang)),
  };
}

export async function addOrAdjustItem(
  userId: string,
  input: AddOrAdjustCartItemInput,
  lang: Lang,
): Promise<CartItemView | { itemId: string; productId: string; removed: true }> {
  const product = await prisma.product.findUnique({ where: { id: input.productId } });
  if (!product) throw new Error('Product not found');

  const cart = await getOrCreateCart(userId);
  const existing = await prisma.cartItem.findUnique({
    where: { cartId_productId: { cartId: cart.id, productId: input.productId } },
  });

  if (input.action === 'increment') {
    if (!product.isActive) throw new Error('Product is not available');
    const nextQuantity = (existing?.quantity ?? 0) + input.quantity;
    const availableStock = product.stock - product.reserved;
    if (nextQuantity > availableStock) {
      throw new Error(
        availableStock > 0
          ? `Only ${availableStock} unit(s) of this product are available`
          : 'This product is out of stock',
      );
    }
    const saved = await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId: input.productId } },
      create: { cartId: cart.id, productId: input.productId, quantity: nextQuantity },
      update: { quantity: nextQuantity },
      include: { product: true },
    });
    return toCartItemView(saved, lang);
  }

  // decrement
  if (!existing) throw new Error('Item is not in the cart');
  const nextQuantity = existing.quantity - input.quantity;
  if (nextQuantity <= 0) {
    await prisma.cartItem.delete({ where: { id: existing.id } });
    return { itemId: input.productId, productId: input.productId, removed: true };
  }
  const saved = await prisma.cartItem.update({
    where: { id: existing.id },
    data: { quantity: nextQuantity },
    include: { product: true },
  });
  return toCartItemView(saved, lang);
}

export async function removeItem(userId: string, productId: string): Promise<void> {
  const cart = await prisma.cart.findUnique({ where: { userId } });
  if (!cart) return;
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
}

export async function clearCart(userId: string): Promise<void> {
  const cart = await prisma.cart.findUnique({ where: { userId } });
  if (!cart) return;
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
}
