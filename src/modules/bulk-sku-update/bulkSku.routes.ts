import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateStaff } from '../../middleware/auth.middleware';
import * as ctrl from './bulkSku.controller';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

router.get('/template', authenticateStaff, asyncHandler(ctrl.downloadTemplate));
router.post('/preview', authenticateStaff, upload.single('file'), asyncHandler(ctrl.preview));
router.post('/apply', authenticateStaff, asyncHandler(ctrl.apply));

export default router;
