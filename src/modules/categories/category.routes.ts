import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateStaff } from '../../middleware/auth.middleware';
import * as ctrl from './category.controller';

const router = Router();

// Public
router.get('/', asyncHandler(ctrl.list));
router.get('/:id', asyncHandler(ctrl.getOne));

// Admin only (staff)
router.post('/', authenticateStaff, asyncHandler(ctrl.create));
router.put('/:id', authenticateStaff, asyncHandler(ctrl.update));
router.delete('/:id', authenticateStaff, asyncHandler(ctrl.remove));

// Subcategories
router.post('/:id/subcategories', authenticateStaff, asyncHandler(ctrl.createSub));
router.put('/:id/subcategories/:subId', authenticateStaff, asyncHandler(ctrl.updateSub));
router.delete('/:id/subcategories/:subId', authenticateStaff, asyncHandler(ctrl.removeSub));

export default router;
