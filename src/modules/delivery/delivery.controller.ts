import { Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth.middleware';
import * as svc from './delivery.service';
import { ok, badRequest } from '../../lib/response';

async function loadSubscriptionContext(userId?: string) {
  if (!userId) return {};
  const { prisma } = await import('../../lib/prisma');
  const sub = await prisma.customerSubscription.findFirst({
    where: {
      customerId: userId,
      status: 'ACTIVE',
      expiryDate: { gt: new Date() },
    },
    include: { plan: true },
  });
  if (!sub) return {};
  return {
    hasActiveSubscription: true,
    subscriptionBenefitType: sub.plan.benefitType,
    subscriptionDiscountValue: sub.plan.discountValue ? Number(sub.plan.discountValue) : null,
    subscriptionCappedFee: sub.plan.cappedFee ? Number(sub.plan.cappedFee) : null,
  };
}

export async function calculateFee(req: AuthRequest, res: Response): Promise<void> {
  const { customerLat, customerLng, cartSubtotal } = req.body as {
    customerLat?: number;
    customerLng?: number;
    cartSubtotal: number;
  };
  const sub = await loadSubscriptionContext(req.user?.userId);
  const result = await svc.quoteDelivery({
    customerLat,
    customerLng,
    cartSubtotal,
    ...sub,
  });
  ok(res, result);
}

export async function quote(req: AuthRequest, res: Response): Promise<void> {
  const { customerLat, customerLng, cartSubtotal } = req.body as {
    customerLat?: number;
    customerLng?: number;
    cartSubtotal?: number;
  };
  const sub = await loadSubscriptionContext(req.user?.userId);
  const result = await svc.quoteDelivery({
    customerLat,
    customerLng,
    cartSubtotal,
    ...sub,
  });
  ok(res, result);
}

export async function getBranch(_req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.getBranch();
  ok(res, data);
}

const branchSchema = z.object({
  name: z.string().min(1),
  nameAr: z.string().min(1),
  address: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  phone: z.string().nullable().optional(),
});

export async function upsertBranch(req: AuthRequest, res: Response): Promise<void> {
  try {
    const body = branchSchema.parse(req.body);
    const data = await svc.upsertBranch(body);
    ok(res, data, 'Branch saved.');
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

export async function getSettings(_req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.getDeliverySettings();
  ok(res, data);
}

export async function updateSettings(req: AuthRequest, res: Response): Promise<void> {
  try {
    const data = await svc.updateDeliverySettings(req.body);
    ok(res, data);
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

export async function getMinimumOrder(_req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.getMinimumOrderSettings();
  ok(res, data);
}

export async function updateMinimumOrder(req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.updateMinimumOrderSettings(req.body);
  ok(res, data);
}

const rulesSchema = z.object({
  rules: z.array(
    z.object({
      minKm: z.number().min(0),
      maxKm: z.number().min(0).nullable(),
      fee: z.number().min(0),
      outOfService: z.boolean(),
      discountPercent: z.number().min(0).max(100).nullable().optional(),
      discountStartDate: z.string().nullable().optional(),
      discountEndDate: z.string().nullable().optional(),
      basketThreshold: z.number().min(0).nullable().optional(),
      feeAboveThreshold: z.number().min(0).nullable().optional(),
    }),
  ),
});

export async function getDistanceRules(_req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.listDistanceRules();
  ok(res, data);
}

export async function replaceDistanceRules(req: AuthRequest, res: Response): Promise<void> {
  try {
    const body = rulesSchema.parse(req.body);
    const data = await svc.replaceDistanceRules(body.rules);
    ok(res, data, `Saved ${data.length} rule(s).`);
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}
