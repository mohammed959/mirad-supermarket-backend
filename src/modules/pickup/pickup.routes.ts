import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateStaff } from '../../middleware/auth.middleware';
import * as ctrl from './pickup.controller';

const router = Router();

// Public — read-only feature flag (frontend uses to hide the schedule toggle).
router.get('/public-settings', asyncHandler(async (_req, res) => {
  const { ok } = await import('../../lib/response');
  const { getSettings, listSlots } = await import('./pickup.service');
  const settings = await getSettings();
  const slots = await listSlots();
  ok(res, {
    futurePickupEnabled: settings.futurePickupEnabled,
    maxReservationDays: settings.maxReservationDays,
    cutoffTime: settings.cutoffTime,
    slotCount: slots.length,
  });
}));

// Admin settings + slot CRUD (staff only)
router.get('/settings',    authenticateStaff, asyncHandler(ctrl.getSettings));
router.patch('/settings',  authenticateStaff, asyncHandler(ctrl.updateSettings));
router.get('/slots',       authenticateStaff, asyncHandler(ctrl.listSlots));
router.post('/slots',      authenticateStaff, asyncHandler(ctrl.createSlot));
router.put('/slots/:id',   authenticateStaff, asyncHandler(ctrl.updateSlot));
router.delete('/slots/:id', authenticateStaff, asyncHandler(ctrl.deleteSlot));

export default router;
