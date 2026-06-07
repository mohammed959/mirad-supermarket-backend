import { Request, Response } from 'express';
import * as svc from './category.service';
import { ok, created, noContent, notFound } from '../../lib/response';

export async function list(req: Request, res: Response): Promise<void> {
  const activeOnly = req.query.all !== 'true';
  const data = await svc.getCategories(activeOnly);
  ok(res, data);
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const data = await svc.getCategoryById(req.params.id);
  if (!data) { notFound(res); return; }
  ok(res, data);
}

export async function create(req: Request, res: Response): Promise<void> {
  const data = await svc.createCategory(req.body);
  created(res, data);
}

export async function update(req: Request, res: Response): Promise<void> {
  const data = await svc.updateCategory(req.params.id, req.body);
  ok(res, data);
}

export async function remove(req: Request, res: Response): Promise<void> {
  await svc.deleteCategory(req.params.id);
  noContent(res);
}

export async function createSub(req: Request, res: Response): Promise<void> {
  const data = await svc.createSubcategory({ ...req.body, categoryId: req.params.id });
  created(res, data);
}

export async function updateSub(req: Request, res: Response): Promise<void> {
  const data = await svc.updateSubcategory(req.params.subId, req.body);
  ok(res, data);
}

export async function removeSub(req: Request, res: Response): Promise<void> {
  await svc.deleteSubcategory(req.params.subId);
  noContent(res);
}
