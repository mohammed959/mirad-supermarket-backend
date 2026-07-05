import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateStaff } from '../../middleware/auth.middleware';
import { optionalAuthenticate } from '../../middleware/optionalAuth.middleware';
import * as ctrl from './delivery.controller';

const router = Router();

// Customer-facing (optionally authenticated for subscription benefits)
router.post('/calculate-fee', optionalAuthenticate, asyncHandler(ctrl.calculateFee));
router.post('/quote',         optionalAuthenticate, asyncHandler(ctrl.quote));
router.post('/check-coverage', asyncHandler(ctrl.checkCoverage));
router.get('/branch',         asyncHandler(ctrl.getBranch));
router.get('/minimum-order',  asyncHandler(ctrl.getMinimumOrder));

// Admin settings (staff only)
router.put('/branch',          authenticateStaff, asyncHandler(ctrl.upsertBranch));
router.get('/settings',        authenticateStaff, asyncHandler(ctrl.getSettings));
router.put('/settings',        authenticateStaff, asyncHandler(ctrl.updateSettings));
router.put('/minimum-order',   authenticateStaff, asyncHandler(ctrl.updateMinimumOrder));
router.get('/distance-rules',  authenticateStaff, asyncHandler(ctrl.getDistanceRules));
router.put('/distance-rules',  authenticateStaff, asyncHandler(ctrl.replaceDistanceRules));

export default router;
