import { Request, Response } from 'express';
import * as svc from './featuredSection.service';
import { ok, created, noContent, notFound, badRequest } from '../../lib/response';

export async function list(req: Request, res: Response): Promise<void> {
  const activeOnly = req.query.all !== 'true';
  const data = await svc.listSections(activeOnly);
  ok(res, data);
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const data = await svc.getSection(req.params.id);
  if (!data) { notFound(res, 'Section not found'); return; }
  ok(res, data);
}

export async function create(req: Request, res: Response): Promise<void> {
  const { name, nameAr, sortOrder, isActive } = req.body as Record<string, unknown>;
  if (typeof name !== 'string' || typeof nameAr !== 'string') {
    badRequest(res, 'name and nameAr are required');
    return;
  }
  const data = await svc.createSection({
    name: name.trim(),
    nameAr: nameAr.trim(),
    sortOrder: typeof sortOrder === 'number' ? sortOrder : undefined,
    isActive: typeof isActive === 'boolean' ? isActive : undefined,
  });
  created(res, data);
}

export async function update(req: Request, res: Response): Promise<void> {
  const data = await svc.updateSection(req.params.id, req.body);
  ok(res, data);
}

export async function toggle(req: Request, res: Response): Promise<void> {
  const { isActive } = req.body as { isActive: boolean };
  const data = await svc.updateSection(req.params.id, { isActive });
  ok(res, data);
}

export async function remove(req: Request, res: Response): Promise<void> {
  await svc.deleteSection(req.params.id);
  noContent(res);
}

export async function addProducts(req: Request, res: Response): Promise<void> {
  const { productIds } = req.body as { productIds?: string[] };
  if (!Array.isArray(productIds) || productIds.length === 0) {
    badRequest(res, 'productIds (non-empty array) is required');
    return;
  }
  const data = await svc.addProducts(req.params.id, productIds.filter((p) => typeof p === 'string'));
  created(res, data);
}

export async function removeProduct(req: Request, res: Response): Promise<void> {
  await svc.removeProduct(req.params.id, req.params.productId);
  noContent(res);
}

export async function reorderItem(req: Request, res: Response): Promise<void> {
  const { delta } = req.body as { delta?: number };
  if (typeof delta !== 'number' || (delta !== -1 && delta !== 1)) {
    badRequest(res, 'delta must be -1 or 1');
    return;
  }
  const data = await svc.reorderProduct(req.params.itemId, delta);
  if (!data) { notFound(res, 'Item not found'); return; }
  ok(res, data);
}
