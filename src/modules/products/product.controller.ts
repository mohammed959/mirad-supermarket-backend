import { Request, Response } from 'express';
import * as svc from './product.service';
import { createProductSchema, updateProductSchema } from './product.schema';
import { ok, created, noContent, notFound } from '../../lib/response';

function qs(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

export async function list(req: Request, res: Response): Promise<void> {
  // Hard cap to protect the server from someone passing limit=100000.
  const rawLimit = parseInt(qs(req.query.pageSize) ?? qs(req.query.limit) ?? '20') || 20;
  const limit = Math.max(1, Math.min(100, rawLimit));
  const result = await svc.listProducts({
    categoryId: qs(req.query.categoryId),
    subcategoryId: qs(req.query.subcategoryId),
    featured: req.query.featured === 'true' ? true : undefined,
    search: qs(req.query.q),
    page: parseInt(qs(req.query.page) ?? '1') || 1,
    limit,
    includeOutOfStock: req.query.includeOutOfStock === 'true',
    includeInactive: req.query.all === 'true',
    excludeHiddenFromHome: req.query.excludeHiddenFromHome === 'true',
  });
  ok(res, result);
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const data = await svc.getProductById(req.params.id);
  if (!data) { notFound(res); return; }
  ok(res, data);
}

export async function create(req: Request, res: Response): Promise<void> {
  const body = createProductSchema.parse(req.body);
  const data = await svc.createProduct(body);
  created(res, data);
}

export async function update(req: Request, res: Response): Promise<void> {
  const body = updateProductSchema.parse(req.body);
  const data = await svc.updateProduct(req.params.id, body);
  ok(res, data);
}

export async function toggleStatus(req: Request, res: Response): Promise<void> {
  const { isActive } = req.body as { isActive: boolean };
  const data = await svc.toggleProductStatus(req.params.id, isActive);
  ok(res, data);
}

export async function remove(req: Request, res: Response): Promise<void> {
  await svc.deleteProduct(req.params.id);
  noContent(res);
}

export async function addVariant(req: Request, res: Response): Promise<void> {
  const data = await svc.createVariant(req.params.id, req.body);
  created(res, data);
}

export async function editVariant(req: Request, res: Response): Promise<void> {
  const data = await svc.updateVariant(req.params.variantId, req.body);
  ok(res, data);
}

export async function adjustStock(req: Request, res: Response): Promise<void> {
  const { delta } = req.body as { delta: number };
  const data = await svc.adjustStock(req.params.variantId, delta);
  ok(res, data);
}

export async function featured(req: Request, res: Response): Promise<void> {
  const data = await svc.getFeaturedProducts();
  ok(res, data);
}

export async function search(req: Request, res: Response): Promise<void> {
  // Accept either `limit` or `pageSize` so the customer FE can use either
  // naming consistently with /products.
  const limit = parseInt(qs(req.query.pageSize) ?? qs(req.query.limit) ?? '20') || 20;
  const data = await svc.searchProducts({
    q: qs(req.query.q),
    barcode: qs(req.query.barcode),
    page: parseInt(qs(req.query.page) ?? '1') || 1,
    limit,
  });
  ok(res, data);
}

export async function suggestions(req: Request, res: Response): Promise<void> {
  const data = await svc.searchSuggestions(qs(req.query.q) ?? '');
  ok(res, data);
}

export async function lowStock(req: Request, res: Response): Promise<void> {
  const threshold = parseInt(qs(req.query.threshold) ?? '5') || 5;
  const data = await svc.listLowStockVariants(threshold);
  ok(res, data);
}

import { importProductsFromExcel, buildSampleTemplate } from './product.import';
import { AuthRequest } from '../../middleware/auth.middleware';

export async function importExcel(req: AuthRequest, res: Response): Promise<void> {
  const file = (req as any).file as { buffer: Buffer; originalname: string } | undefined;
  if (!file) {
    res.status(400).json({ success: false, message: 'No file uploaded (field name: file)' });
    return;
  }
  try {
    const summary = await importProductsFromExcel(file.buffer, req.user!.userId);
    ok(res, summary, `Imported ${summary.productsCreated} product(s) with ${summary.variantsCreated} variant(s)`);
  } catch (err) {
    res.status(400).json({ success: false, message: (err as Error).message });
  }
}

export async function downloadTemplate(_req: Request, res: Response): Promise<void> {
  const buffer = await buildSampleTemplate();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="product-import-template.xlsx"');
  res.send(buffer);
}
