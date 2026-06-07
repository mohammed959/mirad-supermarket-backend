import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import * as svc from './user.service';
import { ok, created, noContent, notFound, badRequest } from '../../lib/response';
import { Role } from '@prisma/client';

const VALID_ROLES: Role[] = ['CUSTOMER', 'PICKER', 'DRIVER', 'SUPER_ADMIN'];

function qs(val: unknown): string | undefined {
  return typeof val === 'string' ? val : undefined;
}

export async function list(req: AuthRequest, res: Response): Promise<void> {
  const result = await svc.listUsers({
    role: qs(req.query.role) as Role | undefined,
    q: qs(req.query.q),
    page: parseInt(qs(req.query.page) ?? '1') || 1,
    limit: parseInt(qs(req.query.limit) ?? '20') || 20,
  });
  ok(res, result);
}

export async function create(req: AuthRequest, res: Response): Promise<void> {
  const { mobile, name, nameAr, role, isActive } = (req.body ?? {}) as {
    mobile?: string;
    name?: string;
    nameAr?: string;
    role?: string;
    isActive?: boolean;
  };
  if (typeof mobile !== 'string' || !mobile.trim()) {
    badRequest(res, 'mobile is required');
    return;
  }
  if (!role || !VALID_ROLES.includes(role as Role)) {
    badRequest(res, `role must be one of ${VALID_ROLES.join(', ')}`);
    return;
  }
  try {
    const data = await svc.createUser({
      mobile: mobile.trim(),
      name: typeof name === 'string' ? name : undefined,
      nameAr: typeof nameAr === 'string' ? nameAr : undefined,
      role: role as Role,
      isActive,
    }, req.user!.userId);
    created(res, data, 'User created');
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

export async function createStaff(req: AuthRequest, res: Response): Promise<void> {
  const { username, email, password, role, nameAr, isActive } = (req.body ?? {}) as {
    username?: string;
    email?: string;
    password?: string;
    role?: string;
    nameAr?: string;
    isActive?: boolean;
  };

  if (typeof username !== 'string' || !username.trim()) {
    badRequest(res, 'username is required'); return;
  }
  if (typeof email !== 'string' || !email.trim()) {
    badRequest(res, 'email is required'); return;
  }
  if (typeof password !== 'string' || password.length < 8) {
    badRequest(res, 'password must be at least 8 characters'); return;
  }
  if (role !== 'PICKER' && role !== 'DRIVER') {
    badRequest(res, 'role must be PICKER or DRIVER'); return;
  }

  try {
    const data = await svc.createStaffUser({
      username: username.trim(),
      email,
      password,
      role: role as Role,
      nameAr: typeof nameAr === 'string' ? nameAr : undefined,
      isActive,
    }, req.user!.userId);
    created(res, data, 'Staff account created');
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

export async function resetStaffPassword(req: AuthRequest, res: Response): Promise<void> {
  const { password } = (req.body ?? {}) as { password?: string };
  if (typeof password !== 'string' || password.length < 8) {
    badRequest(res, 'password must be at least 8 characters'); return;
  }
  try {
    await svc.resetStaffPassword(req.params.id, password, req.user!.userId);
    ok(res, { id: req.params.id }, 'Password updated');
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

export async function getOne(req: AuthRequest, res: Response): Promise<void> {
  const user = await svc.getUserById(req.params.id);
  if (!user) { notFound(res); return; }
  ok(res, user);
}

export async function updateMe(req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.updateUser(req.user!.userId, req.body);
  ok(res, data);
}

export async function setRole(req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.setUserRole(req.params.id, req.body.role as Role);
  ok(res, data);
}

export async function toggleStatus(req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.toggleUserStatus(req.params.id, req.body.isActive as boolean);
  ok(res, data);
}

export async function addAddress(req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.addAddress(req.user!.userId, req.body);
  created(res, data);
}

export async function listAddresses(req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.getAddresses(req.user!.userId);
  ok(res, data);
}

export async function removeAddress(req: AuthRequest, res: Response): Promise<void> {
  await svc.deleteAddress(req.params.addressId, req.user!.userId);
  noContent(res);
}
