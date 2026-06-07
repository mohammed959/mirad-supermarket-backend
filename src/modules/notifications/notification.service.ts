import { NotificationType, OrderStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

export async function createNotification(
  data: {
    userId: string;
    orderId?: string;
    type: NotificationType;
    title: string;
    body: string;
  },
  tx?: Prisma.TransactionClient
) {
  return (tx ?? prisma).notification.create({ data });
}

const STATUS_COPY: Record<OrderStatus, { title: string; body: (n: string) => string }> = {
  NEW:                    { title: 'Order received',     body: (n) => `We received order #${n}. We'll start preparing it shortly.` },
  PAYMENT_VERIFIED:       { title: 'Payment verified',   body: (n) => `Payment for order #${n} is verified. We're preparing it now.` },
  ASSIGNED_TO_PICKER:     { title: 'Preparing order',    body: (n) => `Order #${n} is being prepared.` },
  PICKING_IN_PROGRESS:    { title: 'Preparing order',    body: (n) => `Order #${n} is being picked.` },
  READY_FOR_DELIVERY:     { title: 'Ready for delivery', body: (n) => `Order #${n} is ready and waiting for a driver.` },
  READY_FOR_PICKUP:       { title: 'Ready for pickup',   body: (n) => `Order #${n} is ready. Bring this order number when you arrive at the branch.` },
  ASSIGNED_TO_DRIVER:     { title: 'Driver assigned',    body: (n) => `A driver was assigned to order #${n}.` },
  OUT_FOR_DELIVERY:       { title: 'Out for delivery',   body: (n) => `Order #${n} is on its way to you.` },
  DELIVERED:              { title: 'Delivered',          body: (n) => `Order #${n} was delivered.` },
  PICKED_UP_BY_CUSTOMER:  { title: 'Picked up',          body: (n) => `Order #${n} was picked up from the branch.` },
  COMPLETED:              { title: 'Order completed',    body: (n) => `Order #${n} is complete. Thank you for shopping with us.` },
  CONFIRMED:              { title: 'Order confirmed',    body: (n) => `Order #${n} has been confirmed. Thank you!` },
  CANCELLED:              { title: 'Order cancelled',    body: (n) => `Order #${n} was cancelled.` },
  REJECTED:               { title: 'Order rejected',     body: (n) => `Order #${n} was rejected.` },
};

export async function notifyOrderStatus(
  userId: string,
  orderId: string,
  orderNumber: string,
  status: OrderStatus,
  tx?: Prisma.TransactionClient
) {
  const copy = STATUS_COPY[status];
  return createNotification(
    { userId, orderId, type: 'ORDER_STATUS_CHANGED', title: copy.title, body: copy.body(orderNumber) },
    tx
  );
}

export async function notifyPaymentUnderReview(
  userId: string,
  orderId: string,
  orderNumber: string,
  tx?: Prisma.TransactionClient
) {
  return createNotification(
    {
      userId,
      orderId,
      type: 'ORDER_STATUS_CHANGED',
      title: 'Payment under review',
      body: `We received your transfer proof for order #${orderNumber}. We'll verify it shortly.`,
    },
    tx
  );
}

export async function notifyPaymentApproved(
  userId: string,
  orderId: string,
  orderNumber: string,
  tx?: Prisma.TransactionClient
) {
  return createNotification(
    {
      userId,
      orderId,
      type: 'ORDER_STATUS_CHANGED',
      title: 'Payment confirmed',
      body: `Payment for order #${orderNumber} was confirmed. Preparing your order now.`,
    },
    tx
  );
}

export async function notifyPaymentRejected(
  userId: string,
  orderId: string,
  orderNumber: string,
  note?: string,
  tx?: Prisma.TransactionClient
) {
  const tail = note ? ` Reason: ${note}` : '';
  return createNotification(
    {
      userId,
      orderId,
      type: 'ORDER_STATUS_CHANGED',
      title: 'Payment rejected',
      body: `Payment for order #${orderNumber} could not be verified.${tail}`,
    },
    tx
  );
}

// ─── Admin broadcast ──────────────────────────────────────────────

export async function sendBroadcast(opts: {
  title: string;
  body: string;
  type?: NotificationType;
  target: 'ALL_CUSTOMERS' | 'USER';
  userId?: string;
}) {
  const type = opts.type ?? 'PROMOTION_ACTIVATED';

  if (opts.target === 'USER') {
    if (!opts.userId) throw new Error('userId is required for USER target');
    const user = await prisma.user.findUnique({ where: { id: opts.userId } });
    if (!user) throw new Error('User not found');
    await prisma.notification.create({
      data: { userId: user.id, type, title: opts.title, body: opts.body },
    });
    return { recipients: 1 };
  }

  // ALL_CUSTOMERS
  const customers = await prisma.user.findMany({
    where: { role: 'CUSTOMER', isActive: true },
    select: { id: true },
  });
  if (customers.length === 0) return { recipients: 0 };

  await prisma.notification.createMany({
    data: customers.map((c) => ({
      userId: c.id,
      type,
      title: opts.title,
      body: opts.body,
    })),
  });
  return { recipients: customers.length };
}

export async function listAdminHistory(opts: {
  type?: NotificationType;
  page?: number;
  limit?: number;
}) {
  const { type = 'PROMOTION_ACTIVATED', page = 1, limit = 30 } = opts;
  // De-duplicate broadcasts by (title, body, createdAt-truncated-to-minute).
  const rows = await prisma.notification.findMany({
    where: { type },
    orderBy: { createdAt: 'desc' },
    take: 500,
    select: {
      id: true, title: true, body: true, createdAt: true, userId: true,
    },
  });

  const buckets = new Map<string, {
    key: string;
    title: string;
    body: string;
    firstSentAt: string;
    recipients: number;
  }>();
  for (const r of rows) {
    const bucket = r.createdAt.toISOString().slice(0, 16); // minute precision
    const key = `${bucket}|${r.title}|${r.body}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.recipients += 1;
    } else {
      buckets.set(key, {
        key,
        title: r.title,
        body: r.body,
        firstSentAt: r.createdAt.toISOString(),
        recipients: 1,
      });
    }
  }
  const items = Array.from(buckets.values())
    .sort((a, b) => (a.firstSentAt < b.firstSentAt ? 1 : -1));

  const total = items.length;
  const start = (page - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export async function getNotifications(userId: string, page = 1, limit = 20) {
  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId },
      skip: (page - 1) * limit,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.notification.count({ where: { userId } }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);
  return {
    notifications,
    unreadCount,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

export async function markAllRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
}

export async function markRead(id: string, userId: string) {
  return prisma.notification.updateMany({
    where: { id, userId },
    data: { isRead: true },
  });
}
