import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateCustomer, authenticateStaff } from '../../middleware/auth.middleware';
import { ok, created, badRequest } from '../../lib/response';
import * as svc from './notification.service';
import { NotificationType } from '@prisma/client';

const router = Router();

// Customer
router.get('/', authenticateCustomer, asyncHandler(async (req: any, res) => {
  const data = await svc.getNotifications(req.user.userId, parseInt(req.query.page) || 1);
  ok(res, data);
}));

router.patch('/read-all', authenticateCustomer, asyncHandler(async (req: any, res) => {
  await svc.markAllRead(req.user.userId);
  ok(res, null, 'Marked all as read');
}));

router.patch('/:id/read', authenticateCustomer, asyncHandler(async (req: any, res) => {
  await svc.markRead(req.params.id, req.user.userId);
  ok(res, null, 'Marked as read');
}));

// Admin broadcast (staff only)
router.post('/admin/send', authenticateStaff, asyncHandler(async (req: any, res) => {
  const { title, body, type, target, userId } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim() || typeof body !== 'string' || !body.trim()) {
    badRequest(res, 'title and body are required');
    return;
  }
  if (target !== 'ALL_CUSTOMERS' && target !== 'USER') {
    badRequest(res, "target must be 'ALL_CUSTOMERS' or 'USER'");
    return;
  }
  try {
    const result = await svc.sendBroadcast({
      title: title.trim(),
      body: body.trim(),
      type: typeof type === 'string' ? (type as NotificationType) : undefined,
      target,
      userId: typeof userId === 'string' ? userId : undefined,
    });
    created(res, result, `Sent to ${result.recipients} recipient(s)`);
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}));

router.get('/admin/history', authenticateStaff, asyncHandler(async (req: any, res) => {
  const data = await svc.listAdminHistory({
    type: typeof req.query.type === 'string' ? (req.query.type as NotificationType) : undefined,
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 30,
  });
  ok(res, data);
}));

export default router;
