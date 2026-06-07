import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { forbidden } from '../lib/response';

export function authorize(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      forbidden(res, 'You do not have permission to access this resource');
      return;
    }
    next();
  };
}
