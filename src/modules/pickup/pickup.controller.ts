import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import { ok, created, noContent, badRequest } from '../../lib/response';
import * as svc from './pickup.service';

function qs(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

// ─── Settings ────────────────────────────────────────────────────────

export async function getSettings(_req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.getSettings();
  ok(res, data);
}

export async function updateSettings(req: AuthRequest, res: Response): Promise<void> {
  const { futurePickupEnabled, maxReservationDays, cutoffTime } = (req.body ?? {}) as {
    futurePickupEnabled?: boolean;
    maxReservationDays?: number;
    cutoffTime?: string | null;
  };
  try {
    const data = await svc.updateSettings({
      futurePickupEnabled,
      maxReservationDays,
      cutoffTime: cutoffTime === undefined ? undefined : (cutoffTime || null),
    }, req.user!.userId);
    ok(res, data, 'Pickup settings updated');
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

// ─── Slots ───────────────────────────────────────────────────────────

export async function listSlots(req: AuthRequest, res: Response): Promise<void> {
  const includeInactive = qs(req.query.all) === 'true';
  const data = await svc.listSlots(includeInactive);
  ok(res, data);
}

export async function createSlot(req: AuthRequest, res: Response): Promise<void> {
  const { label, startTime, endTime, capacity, isActive, sortOrder } = (req.body ?? {}) as {
    label?: string;
    startTime?: string;
    endTime?: string;
    capacity?: number;
    isActive?: boolean;
    sortOrder?: number;
  };
  if (typeof label !== 'string' || typeof startTime !== 'string' || typeof endTime !== 'string') {
    badRequest(res, 'label, startTime, endTime are required'); return;
  }
  try {
    const data = await svc.createSlot(
      { label, startTime, endTime, capacity, isActive, sortOrder },
      req.user!.userId,
    );
    created(res, data, 'Pickup slot created');
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

export async function updateSlot(req: AuthRequest, res: Response): Promise<void> {
  try {
    const data = await svc.updateSlot(req.params.id, req.body ?? {}, req.user!.userId);
    ok(res, data, 'Pickup slot updated');
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

export async function deleteSlot(req: AuthRequest, res: Response): Promise<void> {
  try {
    const result = await svc.deleteSlot(req.params.id, req.user!.userId);
    ok(res, result, result.disabledInsteadOfDeleted
      ? 'Slot disabled (it is referenced by existing orders).'
      : 'Pickup slot deleted');
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

// ─── Customer-facing slot availability ───────────────────────────────

/**
 * Returns slot availability for a given date.
 * GET /api/checkout/pickup-slots?date=YYYY-MM-DD
 *
 * Defaults to today when no date is supplied. The endpoint is public so the
 * checkout page can render before the user authenticates.
 */
export async function checkoutSlots(req: AuthRequest, res: Response): Promise<void> {
  const raw = qs(req.query.date);
  let target: Date;
  if (raw) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!m) { badRequest(res, 'date must be YYYY-MM-DD'); return; }
    target = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    target.setHours(0, 0, 0, 0);
    if (Number.isNaN(target.getTime())) { badRequest(res, 'invalid date'); return; }
  } else {
    target = new Date();
    target.setHours(0, 0, 0, 0);
  }
  const data = await svc.computeSlotAvailability(target);
  ok(res, data);
}
