import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import * as svc from './promotion.service';
import { ok, created, notFound, badRequest } from '../../lib/response';
import { PromotionType } from '@prisma/client';

function qs(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

export async function list(req: AuthRequest, res: Response): Promise<void> {
  const activeRaw = qs(req.query.active);
  const data = await svc.listPromotions({
    active: activeRaw === 'true' ? true : activeRaw === 'false' ? false : undefined,
    type: qs(req.query.type) as PromotionType | undefined,
    search: qs(req.query.q),
    page: parseInt(qs(req.query.page) ?? '1') || 1,
    limit: parseInt(qs(req.query.limit) ?? '20') || 20,
    includeArchived: qs(req.query.includeArchived) === 'true',
  });
  ok(res, data);
}

export async function getOne(req: AuthRequest, res: Response): Promise<void> {
  const promo = await svc.getPromotion(req.params.id);
  if (!promo) { notFound(res, 'Promotion not found'); return; }
  ok(res, promo);
}

export async function create(req: AuthRequest, res: Response): Promise<void> {
  try {
    const data = await svc.createPromotion(req.body, req.user!.userId);
    created(res, data);
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

export async function update(req: AuthRequest, res: Response): Promise<void> {
  try {
    const data = await svc.updatePromotion(req.params.id, req.body, req.user!.userId);
    ok(res, data);
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

export async function toggleStatus(req: AuthRequest, res: Response): Promise<void> {
  const isActive = Boolean(req.body?.isActive);
  const data = await svc.toggleActive(req.params.id, isActive, req.user!.userId);
  ok(res, data);
}

export async function archive(req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.archive(req.params.id, req.user!.userId);
  ok(res, data);
}

export async function forProduct(req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.getActivePromotionsForProduct(req.params.productId);
  ok(res, data);
}
