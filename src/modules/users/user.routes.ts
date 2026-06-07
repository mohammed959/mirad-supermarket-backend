import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateCustomer, authenticateStaff } from '../../middleware/auth.middleware';
import * as ctrl from './user.controller';

const router = Router();

// Customer self-service
router.patch('/me', authenticateCustomer, asyncHandler(ctrl.updateMe));
router.get('/me/addresses', authenticateCustomer, asyncHandler(ctrl.listAddresses));
router.post('/me/addresses', authenticateCustomer, asyncHandler(ctrl.addAddress));
router.delete('/me/addresses/:addressId', authenticateCustomer, asyncHandler(ctrl.removeAddress));

// Admin user management (staff only)
router.get('/', authenticateStaff, asyncHandler(ctrl.list));
router.post('/', authenticateStaff, asyncHandler(ctrl.create));
router.post('/staff', authenticateStaff, asyncHandler(ctrl.createStaff));
router.get('/:id', authenticateStaff, asyncHandler(ctrl.getOne));
router.patch('/:id/role', authenticateStaff, asyncHandler(ctrl.setRole));
router.patch('/:id/status', authenticateStaff, asyncHandler(ctrl.toggleStatus));
router.patch('/:id/password', authenticateStaff, asyncHandler(ctrl.resetStaffPassword));

export default router;
