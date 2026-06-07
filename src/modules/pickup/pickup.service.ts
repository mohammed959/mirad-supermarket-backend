import { prisma } from '../../lib/prisma';
import { logAction } from '../audit/audit.service';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

const minutesOfDay = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// ─── Settings (single row) ───────────────────────────────────────────

export async function getSettings() {
  const existing = await prisma.pickupSettings.findFirst();
  if (existing) return existing;
  // Lazy-create a single default row so the admin UI has something to PATCH.
  return prisma.pickupSettings.create({ data: {} });
}

export async function updateSettings(
  input: {
    futurePickupEnabled?: boolean;
    maxReservationDays?: number;
    cutoffTime?: string | null;
  },
  actorId: string,
) {
  const cur = await getSettings();

  if (input.maxReservationDays !== undefined) {
    if (!Number.isInteger(input.maxReservationDays) || input.maxReservationDays < 0 || input.maxReservationDays > 30) {
      throw new Error('maxReservationDays must be an integer between 0 and 30');
    }
  }
  if (input.cutoffTime !== undefined && input.cutoffTime !== null && !TIME_RE.test(input.cutoffTime)) {
    throw new Error('cutoffTime must be HH:MM (24-hour)');
  }

  const updated = await prisma.pickupSettings.update({
    where: { id: cur.id },
    data: {
      ...(input.futurePickupEnabled !== undefined && { futurePickupEnabled: input.futurePickupEnabled }),
      ...(input.maxReservationDays !== undefined && { maxReservationDays: input.maxReservationDays }),
      ...(input.cutoffTime !== undefined && { cutoffTime: input.cutoffTime }),
    },
  });

  await logAction({
    actorId,
    actorRole: 'SUPER_ADMIN',
    action: 'pickup.settings.update',
    entityType: 'pickup_settings',
    entityId: updated.id,
    changes: input,
  });

  return updated;
}

// ─── Slots CRUD ──────────────────────────────────────────────────────

export async function listSlots(includeInactive = false) {
  return prisma.pickupTimeSlot.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { startTime: 'asc' }],
  });
}

function validateSlotInput(input: {
  label?: string;
  startTime?: string;
  endTime?: string;
  capacity?: number;
  isActive?: boolean;
  sortOrder?: number;
}, requireAll: boolean) {
  if (requireAll || input.startTime !== undefined) {
    if (!input.startTime || !TIME_RE.test(input.startTime)) {
      throw new Error('startTime must be HH:MM');
    }
  }
  if (requireAll || input.endTime !== undefined) {
    if (!input.endTime || !TIME_RE.test(input.endTime)) {
      throw new Error('endTime must be HH:MM');
    }
  }
  if (input.startTime && input.endTime && minutesOfDay(input.endTime) <= minutesOfDay(input.startTime)) {
    throw new Error('endTime must be after startTime');
  }
  if (input.capacity !== undefined && (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 10000)) {
    throw new Error('capacity must be a positive integer');
  }
  if (requireAll && (!input.label || !input.label.trim())) {
    throw new Error('label is required');
  }
}

export async function createSlot(input: {
  label: string;
  startTime: string;
  endTime: string;
  capacity?: number;
  isActive?: boolean;
  sortOrder?: number;
}, actorId: string) {
  validateSlotInput(input, true);
  const slot = await prisma.pickupTimeSlot.create({
    data: {
      label: input.label.trim(),
      startTime: input.startTime,
      endTime: input.endTime,
      capacity: input.capacity ?? 20,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    },
  });
  await logAction({
    actorId, actorRole: 'SUPER_ADMIN',
    action: 'pickup.slot.create', entityType: 'pickup_slot', entityId: slot.id,
    changes: { label: slot.label, startTime: slot.startTime, endTime: slot.endTime, capacity: slot.capacity },
  });
  return slot;
}

export async function updateSlot(id: string, input: {
  label?: string;
  startTime?: string;
  endTime?: string;
  capacity?: number;
  isActive?: boolean;
  sortOrder?: number;
}, actorId: string) {
  const existing = await prisma.pickupTimeSlot.findUnique({ where: { id } });
  if (!existing) throw new Error('Pickup slot not found');

  validateSlotInput({
    ...input,
    startTime: input.startTime ?? existing.startTime,
    endTime: input.endTime ?? existing.endTime,
  }, false);

  const slot = await prisma.pickupTimeSlot.update({
    where: { id },
    data: {
      ...(input.label !== undefined && { label: input.label.trim() }),
      ...(input.startTime !== undefined && { startTime: input.startTime }),
      ...(input.endTime !== undefined && { endTime: input.endTime }),
      ...(input.capacity !== undefined && { capacity: input.capacity }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
    },
  });
  await logAction({
    actorId, actorRole: 'SUPER_ADMIN',
    action: 'pickup.slot.update', entityType: 'pickup_slot', entityId: id,
    changes: input,
  });
  return slot;
}

export async function deleteSlot(id: string, actorId: string) {
  // Don't hard-delete a slot that orders still reference — soft-disable instead.
  const referenced = await prisma.order.findFirst({
    where: { scheduledPickupSlotId: id },
    select: { id: true },
  });

  if (referenced) {
    const slot = await prisma.pickupTimeSlot.update({
      where: { id },
      data: { isActive: false },
    });
    await logAction({
      actorId, actorRole: 'SUPER_ADMIN',
      action: 'pickup.slot.disable', entityType: 'pickup_slot', entityId: id,
      changes: { reason: 'referenced by orders' },
    });
    return { id: slot.id, disabledInsteadOfDeleted: true };
  }

  await prisma.pickupTimeSlot.delete({ where: { id } });
  await logAction({
    actorId, actorRole: 'SUPER_ADMIN',
    action: 'pickup.slot.delete', entityType: 'pickup_slot', entityId: id,
  });
  return { id, disabledInsteadOfDeleted: false };
}

// ─── Availability (used by customer checkout) ────────────────────────

/** Set hours/minutes/seconds/ms to zero. Returns a new Date. */
export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface SlotAvailability {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
  capacity: number;
  bookedCount: number;
  available: boolean;
  /** Set when `available` is false — machine-readable. */
  reason: 'FULL' | 'PAST_TIME' | 'INACTIVE' | 'CUTOFF' | 'DISABLED' | null;
}

export interface AvailabilityResult {
  enabled: boolean;
  date: string;
  /** YYYY-MM-DD range admin currently allows scheduling within (inclusive). */
  range: { firstDate: string; lastDate: string };
  slots: SlotAvailability[];
  reason?: 'DISABLED' | 'OUT_OF_RANGE';
}

/**
 * Compute slot availability for `targetDate`. The caller passes the date in
 * YYYY-MM-DD and we evaluate against the server clock. Used both by the
 * customer-facing endpoint and by the order-creation validator so a forged
 * request cannot bypass capacity/cutoff/range/feature-toggle rules.
 */
export async function computeSlotAvailability(targetDate: Date): Promise<AvailabilityResult> {
  const settings = await getSettings();
  const today = startOfDay(new Date());
  const requestedDay = startOfDay(targetDate);
  const lastAllowedDay = addDays(today, settings.maxReservationDays);

  const range = { firstDate: ymd(today), lastDate: ymd(lastAllowedDay) };

  if (!settings.futurePickupEnabled && requestedDay.getTime() !== today.getTime()) {
    // Feature off → only today is selectable; future dates are out.
    return { enabled: false, date: ymd(requestedDay), range, slots: [], reason: 'DISABLED' };
  }

  if (
    requestedDay.getTime() < today.getTime() ||
    requestedDay.getTime() > lastAllowedDay.getTime()
  ) {
    return {
      enabled: settings.futurePickupEnabled,
      date: ymd(requestedDay),
      range,
      slots: [],
      reason: 'OUT_OF_RANGE',
    };
  }

  // Cutoff applies when the requested day is exactly tomorrow.
  const isTomorrow = requestedDay.getTime() === addDays(today, 1).getTime();
  const now = new Date();
  const cutoffPassed =
    isTomorrow && settings.cutoffTime
      ? minutesOfDay(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`) >=
        minutesOfDay(settings.cutoffTime)
      : false;

  // Customer-facing availability returns ACTIVE slots only. Inactive slots
  // must never be shown to customers — they cannot select them and they
  // shouldn't even know they exist. Admin views use listSlots() directly.
  const slots = await prisma.pickupTimeSlot.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { startTime: 'asc' }],
  });

  // Count bookings per slot for this date. Cancelled / rejected orders don't
  // hold capacity.
  const dayStart = requestedDay;
  const dayEnd = addDays(requestedDay, 1);
  const counts = await prisma.order.groupBy({
    by: ['scheduledPickupSlotId'],
    where: {
      scheduledPickupSlotId: { in: slots.map((s) => s.id) },
      scheduledPickupDate: { gte: dayStart, lt: dayEnd },
      status: { notIn: ['CANCELLED', 'REJECTED'] },
    },
    _count: { _all: true },
  });
  const bookingsBySlot = new Map<string, number>(
    counts
      .filter((c) => c.scheduledPickupSlotId)
      .map((c) => [c.scheduledPickupSlotId as string, c._count._all]),
  );

  const isToday = requestedDay.getTime() === today.getTime();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const out: SlotAvailability[] = slots.map((s) => {
    const bookedCount = bookingsBySlot.get(s.id) ?? 0;
    let available = true;
    let reason: SlotAvailability['reason'] = null;

    // Inactive slots are already filtered out at the query level above.
    if (cutoffPassed) { available = false; reason = 'CUTOFF'; }
    else if (isToday && minutesOfDay(s.startTime) <= nowMinutes) { available = false; reason = 'PAST_TIME'; }
    else if (bookedCount >= s.capacity) { available = false; reason = 'FULL'; }

    return {
      id: s.id,
      label: s.label,
      startTime: s.startTime,
      endTime: s.endTime,
      capacity: s.capacity,
      bookedCount,
      available,
      reason,
    };
  });

  return {
    enabled: settings.futurePickupEnabled || isToday,
    date: ymd(requestedDay),
    range,
    slots: out,
  };
}

/**
 * Throwing validator used by order creation. Loads the slot, re-checks
 * capacity / cutoff / range / active state against the server clock.
 */
export async function assertSlotIsBookable(slotId: string, date: Date) {
  const result = await computeSlotAvailability(date);
  if (result.reason === 'DISABLED') {
    throw new Error('Future pickup reservation is disabled.');
  }
  if (result.reason === 'OUT_OF_RANGE') {
    throw new Error('The selected date is outside the allowed reservation range.');
  }
  const slot = result.slots.find((s) => s.id === slotId);
  if (!slot) {
    // The slot is either inactive (filtered out for customers) or genuinely
    // unknown. A stale client may still hold an inactive slot id from before
    // the admin disabled it — give a clear, non-misleading message.
    const existing = await prisma.pickupTimeSlot.findUnique({
      where: { id: slotId },
      select: { id: true, isActive: true },
    });
    if (existing && !existing.isActive) {
      throw new Error('The selected pickup slot is no longer available.');
    }
    throw new Error('The selected pickup slot does not exist.');
  }
  if (!slot.available) {
    switch (slot.reason) {
      case 'FULL':      throw new Error('The selected pickup slot is fully booked.');
      case 'PAST_TIME': throw new Error('The selected pickup slot has already started.');
      case 'CUTOFF':    throw new Error('The cutoff time for this slot has passed.');
      case 'INACTIVE':  throw new Error('The selected pickup slot is no longer available.');
      default:          throw new Error('The selected pickup slot is not available.');
    }
  }
  return slot;
}
