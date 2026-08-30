import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import * as svc from './cart.service';
import { addOrAdjustCartItemBodySchema, parseLang, type Lang } from './cart.schema';
import { ok, badRequest, noContent } from '../../lib/response';

function langFromQuery(value: unknown): Lang {
  return value === 'en' ? 'en' : 'ar';
}

export async function getCart(req: AuthRequest, res: Response): Promise<void> {
  const lang = langFromQuery(req.query.lang);
  const data = await svc.getCart(req.user!.userId, lang);
  ok(res, data);
}

export async function addOrAdjustItem(req: AuthRequest, res: Response): Promise<void> {
  const parsed = addOrAdjustCartItemBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    badRequest(res, 'productId, quantity, and action are required');
    return;
  }
  const lang = parseLang(req.body);
  try {
    const data = await svc.addOrAdjustItem(req.user!.userId, parsed.data, lang);
    ok(res, data);
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

export async function removeItem(req: AuthRequest, res: Response): Promise<void> {
  await svc.removeItem(req.user!.userId, req.params.productId);
  noContent(res);
}

export async function clearCart(req: AuthRequest, res: Response): Promise<void> {
  await svc.clearCart(req.user!.userId);
  noContent(res);
}
