import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateStaff } from '../../middleware/auth.middleware';
import * as ctrl from './contact.controller';

const router = Router();

// Public — the marketplace "Contact us" surface reads this without auth.
router.get('/', asyncHandler(ctrl.getContact));

// Admin write (staff only) — managed from /admin/settings.
router.put('/', authenticateStaff, asyncHandler(ctrl.updateContact));

export default router;
