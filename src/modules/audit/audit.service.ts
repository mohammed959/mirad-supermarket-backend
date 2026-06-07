import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

export interface AuditPayload {
  actorId?: string | null;
  actorRole?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: unknown;
  ipAddress?: string | null;
}

/**
 * Fire-and-forget audit log writer. Never throws — auditing must not
 * break the original operation. Pass an optional Prisma tx client when
 * called from inside a transaction.
 */
export async function logAction(payload: AuditPayload, tx?: Prisma.TransactionClient) {
  try {
    await (tx ?? prisma).auditLog.create({
      data: {
        actorId: payload.actorId ?? null,
        actorRole: payload.actorRole ?? null,
        action: payload.action,
        entityType: payload.entityType,
        entityId: payload.entityId ?? null,
        changes: (payload.changes ?? null) as Prisma.InputJsonValue,
        ipAddress: payload.ipAddress ?? null,
      },
    });
  } catch (err) {
    // Swallow — don't let audit failures cascade
    console.warn('[audit] failed to write log:', (err as Error).message);
  }
}

export interface ListLogsOptions {
  actorId?: string;
  entityType?: string;
  entityId?: string;
  action?: string;
  page?: number;
  limit?: number;
}

export async function listLogs(opts: ListLogsOptions = {}) {
  const { page = 1, limit = 40, ...filters } = opts;
  const where: Prisma.AuditLogWhereInput = {
    ...(filters.actorId && { actorId: filters.actorId }),
    ...(filters.entityType && { entityType: filters.entityType }),
    ...(filters.entityId && { entityId: filters.entityId }),
    ...(filters.action && { action: { contains: filters.action } }),
  };
  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        actor: { select: { id: true, name: true, mobile: true, role: true } },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return { logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}
