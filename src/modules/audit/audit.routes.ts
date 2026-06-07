import { Router } from 'express';
import { asyncHandler } from '../../middleware/asyncHandler';
import { authenticateStaff } from '../../middleware/auth.middleware';
import { ok } from '../../lib/response';
import * as svc from './audit.service';

const router = Router();

router.get('/', authenticateStaff, asyncHandler(async (req, res) => {
  const qs = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const data = await svc.listLogs({
    actorId: qs(req.query.actorId),
    entityType: qs(req.query.entityType),
    entityId: qs(req.query.entityId),
    action: qs(req.query.action),
    page: parseInt(qs(req.query.page) ?? '1') || 1,
    limit: parseInt(qs(req.query.limit) ?? '40') || 40,
  });
  ok(res, data);
}));

export default router;
