import { Request, Response } from 'express';
import { ok } from '../../lib/response';
import * as svc from './storefront.service';
import { parseLang } from '../categories/category.schema';

/**
 * Storefront home aggregation endpoint controller.
 *
 * Contract:
 *   • Method: POST.
 *   • Body: `{ lang?: 'ar' | 'en' }`. Missing / invalid falls back to `'ar'`.
 *   • Sets `Cache-Control: no-cache`. Express's default weak ETag stays on so
 *     conditional GET (via a client using cached body + `If-None-Match`) can
 *     still 304 for identical POST bodies within a session.
 *   • Calls the service exactly once, wraps in the shared `ok()` envelope.
 *
 * Errors propagate to `asyncHandler` and land in the global `errorMiddleware`.
 * The service module is imported as a namespace so tests can monkey-patch it.
 */
export async function getHome(req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-cache');
  const lang = parseLang(req.body);
  const data = await svc.getStorefrontHome(lang);
  ok(res, data);
}
