import jwt from 'jsonwebtoken';
import { config } from '../config';

export type TokenScope = 'customer' | 'staff';

export interface JwtPayload {
  userId: string;
  role: string;
  // Token scope. A customer-scope token is ONLY valid for customer-facing
  // endpoints; a staff-scope token is ONLY valid for staff endpoints. The
  // role alone is not enough — we never want a stolen / re-purposed token
  // to satisfy the wrong middleware.
  scope: TokenScope;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwt.secret, {
    expiresIn: config.jwt.expiresIn as jwt.SignOptions['expiresIn'],
  });
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, config.jwt.secret) as Partial<JwtPayload>;
  // Tokens issued before scope existed have no `scope` field. Treat them
  // as invalid so every signed-in session is forced to re-authenticate
  // exactly once.
  if (!decoded || typeof decoded.userId !== 'string' || typeof decoded.role !== 'string') {
    throw new Error('Invalid token payload');
  }
  if (decoded.scope !== 'customer' && decoded.scope !== 'staff') {
    throw new Error('Token missing scope — please sign in again');
  }
  return { userId: decoded.userId, role: decoded.role, scope: decoded.scope };
}
