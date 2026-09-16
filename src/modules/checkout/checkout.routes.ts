import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { optionalAuthenticate } from '../../middleware/optionalAuth.middleware';
import { authenticateCustomer } from '../../middleware/auth.middleware';
import * as ctrl from './checkout.controller';
import * as pickupCtrl from '../pickup/pickup.controller';

const router = Router();

router.post('/calculate-delivery', optionalAuthenticate, asyncHandler(ctrl.calculateDelivery));
router.get('/pickup-slots', optionalAuthenticate, asyncHandler(pickupCtrl.checkoutSlots));
router.post('/prepare', authenticateCustomer, asyncHandler(ctrl.prepareCheckout));

export default router;
