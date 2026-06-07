import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateStaff } from '../../middleware/auth.middleware';
import * as ctrl from './featuredSection.controller';

const router = Router();

// Public
router.get('/', asyncHandler(ctrl.list));
router.get('/:id', asyncHandler(ctrl.getOne));

// Admin (staff)
router.post('/', authenticateStaff, asyncHandler(ctrl.create));
router.put('/:id', authenticateStaff, asyncHandler(ctrl.update));
router.patch('/:id/status', authenticateStaff, asyncHandler(ctrl.toggle));
router.delete('/:id', authenticateStaff, asyncHandler(ctrl.remove));
router.post('/:id/products', authenticateStaff, asyncHandler(ctrl.addProducts));
router.delete('/:id/products/:productId', authenticateStaff, asyncHandler(ctrl.removeProduct));
router.patch('/:id/items/:itemId/reorder', authenticateStaff, asyncHandler(ctrl.reorderItem));

export default router;
