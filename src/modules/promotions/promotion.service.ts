import { Prisma, PromotionType, TargetScope } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logAction } from '../audit/audit.service';

export interface PromotionInput {
  name: string;
  nameAr: string;
  description?: string;
  descriptionAr?: string;
  type: PromotionType;
  isActive?: boolean;
  isStackable?: boolean;
  priority?: number;
  startDate: string | Date;
  endDate?: string | Date | null;
  minimumCartValue?: number | null;
  usageLimit?: number | null;
  usageLimitPerCustomer?: number | null;
  requiresSubscription?: boolean;
  targetScope?: TargetScope;
  config: Record<string, unknown>;
  productIds?: string[];
  variantIds?: string[];
  categoryIds?: string[];
  subcategoryIds?: string[];
}

export async function listPromotions(opts: {
  active?: boolean;
  type?: PromotionType;
  search?: string;
  page?: number;
  limit?: number;
  includeArchived?: boolean;
}) {
  const { active, type, search, page = 1, limit = 20, includeArchived = false } = opts;
  const where: Prisma.PromotionWhereInput = {
    ...(typeof active === 'boolean' && { isActive: active }),
    ...(type && { type }),
    ...(!includeArchived && { archivedAt: null }),
    ...(search && {
      OR: [
        { name: { contains: search } },
        { nameAr: { contains: search } },
      ],
    }),
  };
  const [items, total] = await Promise.all([
    prisma.promotion.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ isActive: 'desc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      include: {
        targetProducts:      { select: { id: true, name: true } },
        targetVariants:      { select: { id: true, sku: true } },
        targetCategories:    { select: { id: true, name: true } },
        targetSubcategories: { select: { id: true, name: true } },
      },
    }),
    prisma.promotion.count({ where }),
  ]);
  return { promotions: items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function getPromotion(id: string) {
  return prisma.promotion.findUnique({
    where: { id },
    include: {
      targetProducts: true,
      targetVariants: true,
      targetCategories: true,
      targetSubcategories: true,
    },
  });
}

function buildTargetRelations(input: PromotionInput) {
  return {
    targetProducts: input.productIds?.length
      ? { set: input.productIds.map((id) => ({ id })) }
      : { set: [] },
    targetVariants: input.variantIds?.length
      ? { set: input.variantIds.map((id) => ({ id })) }
      : { set: [] },
    targetCategories: input.categoryIds?.length
      ? { set: input.categoryIds.map((id) => ({ id })) }
      : { set: [] },
    targetSubcategories: input.subcategoryIds?.length
      ? { set: input.subcategoryIds.map((id) => ({ id })) }
      : { set: [] },
  };
}

export async function createPromotion(input: PromotionInput, actorId: string) {
  const promotion = await prisma.promotion.create({
    data: {
      name: input.name,
      nameAr: input.nameAr,
      description: input.description,
      descriptionAr: input.descriptionAr,
      type: input.type,
      isActive: input.isActive ?? false,
      isStackable: input.isStackable ?? false,
      priority: input.priority ?? 0,
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
      minimumCartValue: input.minimumCartValue ?? null,
      usageLimit: input.usageLimit ?? null,
      usageLimitPerCustomer: input.usageLimitPerCustomer ?? null,
      requiresSubscription: input.requiresSubscription ?? false,
      targetScope: input.targetScope ?? 'ALL',
      config: input.config as Prisma.InputJsonValue,
      ...(input.productIds?.length      && { targetProducts:      { connect: input.productIds.map((id) => ({ id })) } }),
      ...(input.variantIds?.length      && { targetVariants:      { connect: input.variantIds.map((id) => ({ id })) } }),
      ...(input.categoryIds?.length     && { targetCategories:    { connect: input.categoryIds.map((id) => ({ id })) } }),
      ...(input.subcategoryIds?.length  && { targetSubcategories: { connect: input.subcategoryIds.map((id) => ({ id })) } }),
    },
  });
  await logAction({
    actorId, actorRole: 'SUPER_ADMIN',
    action: 'promotion.create', entityType: 'promotion', entityId: promotion.id,
    changes: { type: promotion.type, name: promotion.name },
  });
  await prisma.promotionAuditLog.create({
    data: { promotionId: promotion.id, adminId: actorId, action: 'CREATE', changes: input as unknown as Prisma.InputJsonValue },
  });
  return promotion;
}

export async function updatePromotion(id: string, input: PromotionInput, actorId: string) {
  const promotion = await prisma.promotion.update({
    where: { id },
    data: {
      name: input.name,
      nameAr: input.nameAr,
      description: input.description,
      descriptionAr: input.descriptionAr,
      type: input.type,
      isActive: input.isActive ?? false,
      isStackable: input.isStackable ?? false,
      priority: input.priority ?? 0,
      startDate: new Date(input.startDate),
      endDate: input.endDate ? new Date(input.endDate) : null,
      minimumCartValue: input.minimumCartValue ?? null,
      usageLimit: input.usageLimit ?? null,
      usageLimitPerCustomer: input.usageLimitPerCustomer ?? null,
      requiresSubscription: input.requiresSubscription ?? false,
      targetScope: input.targetScope ?? 'ALL',
      config: input.config as Prisma.InputJsonValue,
      ...buildTargetRelations(input),
    },
  });
  await logAction({
    actorId, actorRole: 'SUPER_ADMIN',
    action: 'promotion.update', entityType: 'promotion', entityId: id,
    changes: input,
  });
  await prisma.promotionAuditLog.create({
    data: { promotionId: id, adminId: actorId, action: 'UPDATE', changes: input as unknown as Prisma.InputJsonValue },
  });
  return promotion;
}

export async function toggleActive(id: string, isActive: boolean, actorId: string) {
  const p = await prisma.promotion.update({ where: { id }, data: { isActive } });
  await logAction({
    actorId, actorRole: 'SUPER_ADMIN',
    action: isActive ? 'promotion.activate' : 'promotion.deactivate',
    entityType: 'promotion', entityId: id,
  });
  return p;
}

export async function archive(id: string, actorId: string) {
  const p = await prisma.promotion.update({
    where: { id },
    data: { archivedAt: new Date(), isActive: false },
  });
  await logAction({
    actorId, actorRole: 'SUPER_ADMIN',
    action: 'promotion.archive', entityType: 'promotion', entityId: id,
  });
  return p;
}

// ─── Evaluator ────────────────────────────────────────────────────

interface CartItemInput {
  variantId: string;
  quantity: number;
  unitPrice: number;
  productId: string;
  categoryId: string;
  subcategoryId: string | null;
}

export interface EvaluatedDiscount {
  promotionId: string;
  promotionName: string;
  discountAmount: number;
  freeItems: { variantId: string; quantity: number }[];
}

/**
 * Evaluates active promotions against the cart. Returns a discount per
 * applicable promotion. Supported config shapes (JSON column):
 *
 * PRODUCT_DISCOUNT  / VARIANT_DISCOUNT  / CATEGORY_DISCOUNT:
 *   { mode: 'percent' | 'fixed', value: number }
 *
 * BUY_X_GET_Y:
 *   { buyQuantity: number, getQuantity: number }
 *   Applied per matching variant (free items added to order).
 */
export async function evaluatePromotionsForCart(opts: {
  customerId: string;
  items: CartItemInput[];
  hasActiveSubscription: boolean;
}) {
  const { items, customerId, hasActiveSubscription } = opts;
  if (items.length === 0) return [];

  const now = new Date();
  const subtotal = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  const promotions = await prisma.promotion.findMany({
    where: {
      isActive: true,
      archivedAt: null,
      startDate: { lte: now },
      OR: [{ endDate: null }, { endDate: { gte: now } }],
    },
    orderBy: { priority: 'desc' },
    include: {
      targetProducts:      { select: { id: true } },
      targetVariants:      { select: { id: true } },
      targetCategories:    { select: { id: true } },
      targetSubcategories: { select: { id: true } },
    },
  });

  const evaluated: EvaluatedDiscount[] = [];

  for (const promo of promotions) {
    if (promo.requiresSubscription && !hasActiveSubscription) continue;
    if (promo.minimumCartValue && subtotal < Number(promo.minimumCartValue)) continue;
    if (promo.usageLimit && promo.usageCount >= promo.usageLimit) continue;
    if (promo.usageLimitPerCustomer) {
      const used = await prisma.promotionUsage.count({
        where: { promotionId: promo.id, customerId },
      });
      if (used >= promo.usageLimitPerCustomer) continue;
    }

    const config = (promo.config as Record<string, unknown>) ?? {};
    let discountAmount = 0;
    const freeItems: EvaluatedDiscount['freeItems'] = [];

    const matchItems = items.filter((i) => promotionMatchesItem(promo, i));
    if (matchItems.length === 0 && promo.type !== 'FREE_DELIVERY_THRESHOLD') continue;

    switch (promo.type) {
      case 'PRODUCT_DISCOUNT':
      case 'VARIANT_DISCOUNT':
      case 'CATEGORY_DISCOUNT': {
        const mode = (config.mode as string) ?? 'percent';
        const value = Number(config.value ?? 0);
        if (value <= 0) continue;
        for (const it of matchItems) {
          const lineTotal = it.unitPrice * it.quantity;
          const delta = mode === 'fixed'
            ? Math.min(value * it.quantity, lineTotal)
            : (lineTotal * value) / 100;
          discountAmount += delta;
        }
        break;
      }
      case 'BUY_X_GET_Y': {
        const buyQty = Number(config.buyQuantity ?? 0);
        const getQty = Number(config.getQuantity ?? 0);
        if (buyQty <= 0 || getQty <= 0) continue;
        for (const it of matchItems) {
          const groups = Math.floor(it.quantity / buyQty);
          if (groups <= 0) continue;
          freeItems.push({ variantId: it.variantId, quantity: groups * getQty });
        }
        if (freeItems.length === 0) continue;
        break;
      }
      case 'SUBSCRIPTION_BASED_DISCOUNT': {
        if (!hasActiveSubscription) continue;
        const value = Number(config.value ?? 0);
        const mode = (config.mode as string) ?? 'percent';
        if (value <= 0) continue;
        for (const it of matchItems) {
          const lineTotal = it.unitPrice * it.quantity;
          const delta = mode === 'fixed'
            ? Math.min(value * it.quantity, lineTotal)
            : (lineTotal * value) / 100;
          discountAmount += delta;
        }
        break;
      }
      case 'FREE_DELIVERY_THRESHOLD':
        // Handled by DeliveryPricingSettings already — skip here.
        continue;
    }

    discountAmount = Math.round(discountAmount * 100) / 100;
    if (discountAmount === 0 && freeItems.length === 0) continue;

    evaluated.push({
      promotionId: promo.id,
      promotionName: promo.name,
      discountAmount,
      freeItems,
    });

    if (!promo.isStackable) break;
  }

  return evaluated;
}

function promotionMatchesItem(
  promo: {
    targetScope: TargetScope;
    targetProducts: { id: string }[];
    targetVariants: { id: string }[];
    targetCategories: { id: string }[];
    targetSubcategories: { id: string }[];
  },
  item: CartItemInput
): boolean {
  switch (promo.targetScope) {
    case 'ALL':         return true;
    case 'PRODUCT':     return promo.targetProducts.some((p) => p.id === item.productId);
    case 'VARIANT':     return promo.targetVariants.some((v) => v.id === item.variantId);
    case 'CATEGORY':    return promo.targetCategories.some((c) => c.id === item.categoryId);
    case 'SUBCATEGORY': return item.subcategoryId
      ? promo.targetSubcategories.some((s) => s.id === item.subcategoryId)
      : false;
    default:            return false;
  }
}

// Customer-facing helper: which active promotions apply to a single product?
export async function getActivePromotionsForProduct(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, categoryId: true, subcategoryId: true, variants: { select: { id: true } } },
  });
  if (!product) return [];

  const now = new Date();
  const variantIds = product.variants.map((v) => v.id);

  return prisma.promotion.findMany({
    where: {
      isActive: true,
      archivedAt: null,
      startDate: { lte: now },
      OR: [{ endDate: null }, { endDate: { gte: now } }],
      AND: {
        OR: [
          { targetScope: 'ALL' },
          { targetScope: 'PRODUCT',     targetProducts:      { some: { id: product.id } } },
          { targetScope: 'CATEGORY',    targetCategories:    { some: { id: product.categoryId } } },
          ...(product.subcategoryId ? [{
            targetScope: 'SUBCATEGORY' as TargetScope,
            targetSubcategories: { some: { id: product.subcategoryId } },
          }] : []),
          { targetScope: 'VARIANT',     targetVariants:      { some: { id: { in: variantIds } } } },
        ],
      },
    },
    select: {
      id: true, name: true, nameAr: true, type: true, config: true,
    },
  });
}
