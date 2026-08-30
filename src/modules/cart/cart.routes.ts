import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateCustomer } from '../../middleware/auth.middleware';
import * as ctrl from './cart.controller';

const router = Router();

// The cart is customer-only: every route requires a logged-in customer
// session. Guests keep using the client-side cart and never reach these.
router.use(authenticateCustomer);

router.get('/', asyncHandler(ctrl.getCart));
router.post('/items', asyncHandler(ctrl.addOrAdjustItem));
router.delete('/items/:productId', asyncHandler(ctrl.removeItem));
router.delete('/', asyncHandler(ctrl.clearCart));

export default router;
