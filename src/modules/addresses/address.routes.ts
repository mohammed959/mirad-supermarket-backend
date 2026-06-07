import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateCustomer } from '../../middleware/auth.middleware';
import * as ctrl from './address.controller';

const router = Router();

router.use(authenticateCustomer);

router.get('/', asyncHandler(ctrl.list));
router.get('/:id', asyncHandler(ctrl.getOne));
router.post('/', asyncHandler(ctrl.create));
router.put('/:id', asyncHandler(ctrl.update));
router.patch('/:id/default', asyncHandler(ctrl.setDefault));
router.delete('/:id', asyncHandler(ctrl.remove));

export default router;
