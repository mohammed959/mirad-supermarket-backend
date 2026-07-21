import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateCustomer, authenticateStaff } from '../../middleware/auth.middleware';
import * as ctrl from './upload.controller';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB per image
});

// Customer uploads a delivery-location image → returns { url }.
router.post(
  '/delivery-image',
  authenticateCustomer,
  upload.single('file'),
  asyncHandler(ctrl.uploadDeliveryImage),
);

// Staff uploads a subcategory image → returns { url }.
router.post(
  '/subcategory-image',
  authenticateStaff,
  upload.single('file'),
  asyncHandler(ctrl.uploadSubcategoryImage),
);

export default router;
