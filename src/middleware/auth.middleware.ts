import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenScope, JwtPayload } from '../lib/jwt';
import { unauthorized, forbidden, serverError } from '../lib/response';
import { prisma } from '../lib/prisma';

export interface AuthRequest extends Request {
  user?: { userId: string; role: string; scope: TokenScope };
}

const STAFF_ROLES = ['SUPER_ADMIN', 'PICKER', 'DRIVER'];

/**
 * Verifies the JWT signature, then confirms the account it names is still
 * active — a soft-deleted account (`deletedAt` set, e.g. via `DELETE
 * /auth/me`) must lose access immediately even though its previously-issued
 * token has not expired. There is no session/refresh-token store to revoke
 * in this stateless-JWT design, so this per-request DB check IS the
 * revocation mechanism.
 */
async function extractAndVerify(req: AuthRequest, res: Response): Promise<boolean> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    unauthorized(res);
    return false;
  }
  const token = authHeader.slice(7);
  let payload: JwtPayload;
  try {
    payload = verifyToken(token);
  } catch {
    unauthorized(res, 'Invalid or expired token');
    return false;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { deletedAt: true },
    });
    if (!user || user.deletedAt) {
      unauthorized(res, 'Invalid or expired token');
      return false;
    }
  } catch {
    serverError(res, 'Authentication check failed');
    return false;
  }

  req.user = payload;
  return true;
}

/**
 * Customer-scope authentication. Accepts ONLY tokens issued by the customer
 * OTP flow (scope='customer'). Staff tokens are rejected with 403 even if
 * the bearer somehow holds CUSTOMER role on the user record.
 */
export async function authenticateCustomer(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!(await extractAndVerify(req, res))) return;
  if (req.user!.scope !== 'customer') {
    forbidden(res, 'Customer session required');
    return;
  }
  if (req.user!.role !== 'CUSTOMER') {
    forbidden(res, 'Customer session required');
    return;
  }
  next();
}

/**
 * Staff-scope authentication. Accepts ONLY tokens issued by the staff
 * email/password login (scope='staff') with a known staff role. Customer
 * tokens are rejected.
 */
export async function authenticateStaff(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!(await extractAndVerify(req, res))) return;
  if (req.user!.scope !== 'staff' || !STAFF_ROLES.includes(req.user!.role)) {
    forbidden(res, 'Staff session required');
    return;
  }
  next();
}

/**
 * Either-scope authentication. Use for endpoints whose payload is shaped
 * by req.user.role at the controller layer (e.g. GET /orders, GET
 * /auth/me). The scope is still attached, so downstream code can still
 * tell which kind of session it is talking to.
 */
export async function authenticateAny(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!(await extractAndVerify(req, res))) return;
  next();
}

/**
 * Legacy alias. Equivalent to authenticateAny. New code should use the
 * scoped middleware above so each endpoint declares which sessions it
 * accepts.
 */
export const authenticate = authenticateAny;
