import { Request, Response } from 'express';
import { ok } from '../../lib/response';
import * as svc from './storefront.service';

/**
 * Storefront home aggregation endpoint controller.
 *
 * Orchestration lives inside `getStorefrontHome()` — this handler only:
 *   • sets `Cache-Control: no-cache` (V1 policy — always revalidate;
 *     Express's default weak ETag remains unchanged so 304 revalidation
 *     still works),
 *   • calls the service exactly once,
 *   • hands the aggregate to the shared `ok()` envelope helper.
 *
 * Any rejection surfaces through `asyncHandler` (Step 4 route wiring) and
 * lands in the global `errorMiddleware`. Nothing is caught, wrapped, or
 * partially reported here.
 *
 * The service module is imported as a namespace so tests can monkey-patch
 * `svc.getStorefrontHome` at call time without introducing a DI layer.
 */
export async function getHome(_req: Request, res: Response): Promise<void> {
  res.set('Cache-Control', 'no-cache');
  const data = await svc.getStorefrontHome();
  ok(res, data);
}
