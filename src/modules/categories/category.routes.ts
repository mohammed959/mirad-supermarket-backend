import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateStaff } from '../../middleware/auth.middleware';
import * as ctrl from './category.controller';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// Bulk import (admin) — must come before '/:id' so it isn't treated as an id.
router.get('/import/template', authenticateStaff, asyncHandler(ctrl.downloadTemplate));
router.post('/import/excel', authenticateStaff, upload.single('file'), asyncHandler(ctrl.importExcel));

// Admin full list (staff only) — full historical shape, supports ?all=true & ?home=true.
// Must come before '/:id' so 'admin' isn't matched as an id.
router.get('/admin', authenticateStaff, asyncHandler(ctrl.listAdmin));

// Public marketplace list — POST with { lang } body, stripped shape.
router.post('/list', asyncHandler(ctrl.listMarketplace));

// Public per-category read (used by product-list page to fetch subcategories).
router.get('/:id', asyncHandler(ctrl.getOne));

// Admin only (staff)
router.post('/', authenticateStaff, asyncHandler(ctrl.create));
router.put('/:id', authenticateStaff, asyncHandler(ctrl.update));
router.delete('/:id', authenticateStaff, asyncHandler(ctrl.remove));

// Subcategories
router.post('/:id/subcategories', authenticateStaff, asyncHandler(ctrl.createSub));
router.put('/:id/subcategories/:subId', authenticateStaff, asyncHandler(ctrl.updateSub));
router.delete('/:id/subcategories/:subId', authenticateStaff, asyncHandler(ctrl.removeSub));

export default router;
