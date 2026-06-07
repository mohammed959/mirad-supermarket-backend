import { Request, Response } from 'express';
import * as svc from './banner.service';
import { createBannerSchema, updateBannerSchema } from './banner.schema';
import { ok, created, notFound, noContent } from '../../lib/response';

export async function list(req: Request, res: Response): Promise<void> {
  const activeOnly = req.query.all !== 'true';
  const data = await svc.listBanners(activeOnly);
  ok(res, data);
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const data = await svc.getBanner(req.params.id);
  if (!data) { notFound(res, 'Banner not found'); return; }
  ok(res, data);
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = createBannerSchema.parse(req.body);
  const data = await svc.createBanner(body);
  created(res, data);
}

export async function update(req: Request, res: Response): Promise<void> {
  const body = updateBannerSchema.parse(req.body);
  const data = await svc.updateBanner(req.params.id, body);
  ok(res, data);
}

export async function toggle(req: Request, res: Response): Promise<void> {
  const { isActive } = req.body as { isActive: boolean };
  const data = await svc.toggleBanner(req.params.id, isActive);
  ok(res, data);
}

export async function remove(req: Request, res: Response): Promise<void> {
  await svc.deleteBanner(req.params.id);
  noContent(res);
}
