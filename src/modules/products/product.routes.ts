import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateStaff } from '../../middleware/auth.middleware';
import * as ctrl from './product.controller';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ── Marketplace localized reads (public, POST with { lang } body) ───
// Registered BEFORE the legacy GET routes so `POST /` (create, staff)
// and `POST /list` (public read) live side-by-side without conflict.
router.post('/list', asyncHandler(ctrl.marketplaceList));
router.post('/detail', asyncHandler(ctrl.marketplaceDetail));
router.post('/featured', asyncHandler(ctrl.marketplaceFeatured));
router.post('/search', asyncHandler(ctrl.marketplaceSearch));
router.post('/search/suggestions', asyncHandler(ctrl.marketplaceSuggestions));

// ── Legacy GET reads (kept for admin backward compatibility) ────────
router.get('/', asyncHandler(ctrl.list));
router.get('/featured', asyncHandler(ctrl.featured));
router.get('/search', asyncHandler(ctrl.search));
router.get('/search/suggestions', asyncHandler(ctrl.suggestions));
router.get('/:id', asyncHandler(ctrl.getOne));

// ── Admin only (staff) ─────────────────────────────────────────────
router.get('/low-stock', authenticateStaff, asyncHandler(ctrl.lowStock));
router.get('/import/template', authenticateStaff, asyncHandler(ctrl.downloadTemplate));
router.get('/export/missing-images', authenticateStaff, asyncHandler(ctrl.exportMissingImages));
router.get('/export/missing-images/status', authenticateStaff, asyncHandler(ctrl.imageCheckStatus));
router.post('/import/excel', authenticateStaff, upload.single('file'), asyncHandler(ctrl.importExcel));
router.post('/', authenticateStaff, asyncHandler(ctrl.create));
router.put('/:id', authenticateStaff, asyncHandler(ctrl.update));
router.patch('/:id/status', authenticateStaff, asyncHandler(ctrl.toggleStatus));
router.patch('/:id/stock', authenticateStaff, asyncHandler(ctrl.adjustStock));
router.delete('/:id', authenticateStaff, asyncHandler(ctrl.remove));

export default router;
