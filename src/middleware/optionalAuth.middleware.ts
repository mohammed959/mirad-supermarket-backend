import { Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import { AuthRequest } from './auth.middleware';

/**
 * Decodes the JWT if present and attaches req.user. Never rejects on
 * missing/invalid tokens — use for endpoints that work for both guests
 * and logged-in users but want to personalise when possible.
 */
export function optionalAuthenticate(req: AuthRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    next();
    return;
  }
  const token = authHeader.slice(7);
  try {
    req.user = verifyToken(token);
  } catch {
    // ignore invalid token — treat as guest
  }
  next();
}
