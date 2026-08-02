import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import * as ctrl from './storefront.controller';

const router = Router();

// Public storefront-home aggregation. No auth middleware — the payload
// is identical for guests and authenticated customers, and personal
// widgets (buy-again, favorites, etc.) live on their own endpoints.
//
// POST because the request carries a `{ lang }` body (see controller).
router.post('/home', asyncHandler(ctrl.getHome));

export default router;
