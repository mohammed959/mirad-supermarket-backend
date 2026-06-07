import bcrypt from 'bcryptjs';
import { Prisma, Role } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logAction } from '../audit/audit.service';

const BCRYPT_ROUNDS = 10;

export async function createUser(input: {
  mobile: string;
  name?: string;
  nameAr?: string;
  role: Role;
  isActive?: boolean;
}, actorId: string) {
  const mobile = input.mobile.trim();
  if (!mobile) throw new Error('Mobile is required');

  const existing = await prisma.user.findUnique({ where: { mobile } });
  if (existing) throw new Error('A user with this mobile already exists');

  const user = await prisma.user.create({
    data: {
      mobile,
      name: input.name?.trim() || null,
      nameAr: input.nameAr?.trim() || null,
      role: input.role,
      isActive: input.isActive ?? true,
    },
    select: {
      id: true, mobile: true, name: true, nameAr: true,
      role: true, isActive: true, createdAt: true,
    },
  });

  await logAction({
    actorId, actorRole: 'SUPER_ADMIN',
    action: 'user.create',
    entityType: 'user', entityId: user.id,
    changes: { mobile: user.mobile, role: user.role },
  });

  return user;
}

const STAFF_ROLES: Role[] = ['PICKER', 'DRIVER'];

export async function createStaffUser(input: {
  username: string;
  email: string;
  password: string;
  role: Role;
  nameAr?: string;
  isActive?: boolean;
}, actorId: string) {
  const username = input.username.trim();
  const email = input.email.toLowerCase().trim();
  const password = input.password;

  if (!username) throw new Error('Username is required');
  if (!email) throw new Error('Email is required');
  if (!password) throw new Error('Password is required');
  if (!STAFF_ROLES.includes(input.role)) {
    throw new Error('Role must be PICKER or DRIVER');
  }

  const [emailExists, usernameExists] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    prisma.user.findUnique({ where: { username } }),
  ]);
  if (emailExists) throw new Error('Email is already in use');
  if (usernameExists) throw new Error('Username is already in use');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const user = await prisma.user.create({
    data: {
      username,
      email,
      passwordHash,
      name: username,
      nameAr: input.nameAr?.trim() || null,
      role: input.role,
      isActive: input.isActive ?? true,
    },
    select: {
      id: true, username: true, email: true, name: true, nameAr: true,
      role: true, isActive: true, createdAt: true,
    },
  });

  await logAction({
    actorId, actorRole: 'SUPER_ADMIN',
    action: 'staff.create',
    entityType: 'user', entityId: user.id,
    changes: { email: user.email, username: user.username, role: user.role },
  });

  return user;
}

export async function resetStaffPassword(
  id: string,
  newPassword: string,
  actorId: string,
) {
  if (!newPassword || newPassword.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw new Error('User not found');
  if (!STAFF_ROLES.includes(target.role)) {
    throw new Error('Only picker or driver passwords can be reset here');
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await prisma.user.update({ where: { id }, data: { passwordHash } });

  await logAction({
    actorId, actorRole: 'SUPER_ADMIN',
    action: 'staff.passwordReset',
    entityType: 'user', entityId: id,
  });
}

export async function listUsers(opts: {
  role?: Role;
  q?: string;
  page?: number;
  limit?: number;
}) {
  const { role, q, page = 1, limit = 20 } = opts;
  const where: Prisma.UserWhereInput = {
    ...(role && { role }),
    ...(q && {
      OR: [
        { mobile: { contains: q } },
        { email: { contains: q } },
        { username: { contains: q } },
        { name: { contains: q } },
        { nameAr: { contains: q } },
      ],
    }),
  };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        mobile: true,
        email: true,
        username: true,
        name: true,
        nameAr: true,
        role: true,
        isActive: true,
        createdAt: true,
        _count: {
          select: {
            orders: true,
            pickedOrders: true,
            drivenOrders: true,
            addresses: true,
            favorites: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.user.count({ where }),
  ]);
  return { users, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true, mobile: true, email: true, username: true,
      name: true, nameAr: true,
      role: true, isActive: true, createdAt: true,
      addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] },
      subscription: { include: { plan: true } },
      _count: {
        select: {
          orders: true,
          pickedOrders: true,
          drivenOrders: true,
          favorites: true,
          addresses: true,
        },
      },
      orders: {
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          total: true,
          createdAt: true,
          paymentMethod: true,
          paymentStatus: true,
          picker: { select: { id: true, name: true, mobile: true } },
          driver: { select: { id: true, name: true, mobile: true } },
        },
      },
    },
  });
}

export async function updateUser(id: string, data: { name?: string; nameAr?: string }) {
  return prisma.user.update({ where: { id }, data });
}

export async function setUserRole(id: string, role: Role) {
  return prisma.user.update({ where: { id }, data: { role } });
}

export async function toggleUserStatus(id: string, isActive: boolean) {
  return prisma.user.update({ where: { id }, data: { isActive } });
}

// Address management
export async function addAddress(customerId: string, data: {
  label?: string;
  addressLine?: string;
  city?: string;
  deliveryNotes?: string;
  latitude: number;
  longitude: number;
  isDefault?: boolean;
}) {
  if (data.isDefault) {
    await prisma.customerAddress.updateMany({
      where: { customerId },
      data: { isDefault: false },
    });
  }
  return prisma.customerAddress.create({ data: { ...data, customerId } });
}

export async function getAddresses(customerId: string) {
  return prisma.customerAddress.findMany({
    where: { customerId },
    orderBy: { isDefault: 'desc' },
  });
}

export async function deleteAddress(id: string, customerId: string) {
  return prisma.customerAddress.deleteMany({ where: { id, customerId } });
}
