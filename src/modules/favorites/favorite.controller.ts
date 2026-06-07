import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import * as svc from './favorite.service';
import { ok, created, noContent, badRequest } from '../../lib/response';

export async function list(req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.listFavorites(req.user!.userId);
  ok(res, data);
}

export async function listIds(req: AuthRequest, res: Response): Promise<void> {
  const ids = await svc.listFavoriteIds(req.user!.userId);
  ok(res, ids);
}

export async function add(req: AuthRequest, res: Response): Promise<void> {
  const productId = req.body?.productId;
  if (typeof productId !== 'string' || !productId) {
    badRequest(res, 'productId is required');
    return;
  }
  try {
    const data = await svc.addFavorite(req.user!.userId, productId);
    created(res, data);
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

export async function remove(req: AuthRequest, res: Response): Promise<void> {
  await svc.removeFavorite(req.user!.userId, req.params.productId);
  noContent(res);
}
