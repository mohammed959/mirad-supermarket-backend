import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateCustomer } from '../../middleware/auth.middleware';
import * as ctrl from './favorite.controller';

const router = Router();

router.use(authenticateCustomer);

router.get('/', asyncHandler(ctrl.list));
router.get('/ids', asyncHandler(ctrl.listIds));
router.post('/', asyncHandler(ctrl.add));
router.delete('/:productId', asyncHandler(ctrl.remove));

export default router;
