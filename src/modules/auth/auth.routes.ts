import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateAny, authenticateCustomer } from '../../middleware/auth.middleware';
import * as ctrl from './auth.controller';

const router = Router();

router.post('/request-otp', asyncHandler(ctrl.requestOtp));
router.post('/verify-otp', asyncHandler(ctrl.verifyOtp));
router.post('/staff/login', asyncHandler(ctrl.staffLogin));
// /auth/me must work for both customer and staff sessions — the response
// is shaped from req.user, so the scope doesn't matter here.
router.get('/me', authenticateAny, asyncHandler(ctrl.getMe));
// Account deletion is customer-only self-service. There is no server-side
// session/refresh-token store in this stateless-JWT design, so there is no
// corresponding POST /auth/logout — see auth.middleware.ts for how a
// deleted account's existing token is rejected instead.
router.delete('/me', authenticateCustomer, asyncHandler(ctrl.deleteMe));

export default router;
