import { Request, Response } from 'express';
import * as svc from './category.service';
import { ok, created, noContent, notFound } from '../../lib/response';
import { importCategoriesFromExcel, buildCategoryTemplate } from './category.import';
import { AuthRequest } from '../../middleware/auth.middleware';
import { parseLang, parseLangQuery } from './category.schema';

/**
 * Admin list: `GET /api/categories/admin` (staff only).
 *
 * Returns the full historical shape (id, name, nameAr, slug, imageUrl,
 * sortOrder, isActive, showOnHome, createdAt, updatedAt, subcategories[])
 * so admin UIs — the category tree, promotion pickers, imports — keep
 * working unchanged.
 *
 * Query params (preserved from the previous public GET):
 *   • `?all=true`  — include inactive categories/subcategories.
 *   • `?home=true` — only categories flagged to show on the marketplace home.
 */
export async function listAdmin(req: Request, res: Response): Promise<void> {
  const activeOnly = req.query.all !== 'true';
  const homeOnly = req.query.home === 'true';
  const data = await svc.getCategories(activeOnly, homeOnly);
  ok(res, data);
}

/**
 * Marketplace list: `POST /api/categories/list` (public).
 *
 * Body: `{ lang?: 'ar' | 'en' }` — default `'ar'`. Returns only active
 * categories in the stripped shape defined by `MarketplaceCategoryCard`
 * (no `nameAr`, no subcategories, no admin flags, no audit timestamps).
 */
export async function listMarketplace(req: Request, res: Response): Promise<void> {
  const lang = parseLang(req.body);
  const data = await svc.listMarketplaceCategories(lang);
  ok(res, data);
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const lang = parseLangQuery(req.query.lang);
  const data = await svc.getCategoryById(req.params.id, lang);
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

export async function importExcel(req: AuthRequest, res: Response): Promise<void> {
  const file = (req as { file?: { buffer: Buffer } }).file;
  if (!file) {
    res.status(400).json({ success: false, message: 'No file uploaded (field name: file)' });
    return;
  }
  try {
    const summary = await importCategoriesFromExcel(file.buffer, req.user!.userId);
    ok(
      res,
      summary,
      `Imported ${summary.categoriesCreated + summary.categoriesUpdated} category(ies) and ${summary.subcategoriesCreated + summary.subcategoriesUpdated} subcategory(ies).`,
    );
  } catch (err) {
    res.status(400).json({ success: false, message: (err as Error).message });
  }
}

export async function downloadTemplate(_req: Request, res: Response): Promise<void> {
  const buffer = await buildCategoryTemplate();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="category-import-template.xlsx"');
  res.send(buffer);
}
