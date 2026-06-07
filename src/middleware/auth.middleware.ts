import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenScope } from '../lib/jwt';
import { unauthorized, forbidden } from '../lib/response';

export interface AuthRequest extends Request {
  user?: { userId: string; role: string; scope: TokenScope };
}

const STAFF_ROLES = ['SUPER_ADMIN', 'PICKER', 'DRIVER'];

function extractAndVerify(req: AuthRequest, res: Response): boolean {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    unauthorized(res);
    return false;
  }
  const token = authHeader.slice(7);
  try {
    req.user = verifyToken(token);
    return true;
  } catch {
    unauthorized(res, 'Invalid or expired token');
    return false;
  }
}

/**
 * Customer-scope authentication. Accepts ONLY tokens issued by the customer
 * OTP flow (scope='customer'). Staff tokens are rejected with 403 even if
 * the bearer somehow holds CUSTOMER role on the user record.
 */
export function authenticateCustomer(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!extractAndVerify(req, res)) return;
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
export function authenticateStaff(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!extractAndVerify(req, res)) return;
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
export function authenticateAny(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!extractAndVerify(req, res)) return;
  next();
}

/**
 * Legacy alias. Equivalent to authenticateAny. New code should use the
 * scoped middleware above so each endpoint declares which sessions it
 * accepts.
 */
export const authenticate = authenticateAny;
