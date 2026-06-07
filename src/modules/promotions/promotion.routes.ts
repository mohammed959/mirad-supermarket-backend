import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateStaff } from '../../middleware/auth.middleware';
import * as ctrl from './promotion.controller';

const router = Router();

// Public — customer needs to know which promos apply to a product card
router.get('/for-product/:productId', asyncHandler(ctrl.forProduct));

router.get('/', authenticateStaff, asyncHandler(ctrl.list));
router.get('/:id', authenticateStaff, asyncHandler(ctrl.getOne));
router.post('/', authenticateStaff, asyncHandler(ctrl.create));
router.put('/:id', authenticateStaff, asyncHandler(ctrl.update));
router.patch('/:id/status', authenticateStaff, asyncHandler(ctrl.toggleStatus));
router.patch('/:id/archive', authenticateStaff, asyncHandler(ctrl.archive));

export default router;
