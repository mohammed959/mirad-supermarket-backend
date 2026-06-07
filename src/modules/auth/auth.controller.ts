import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import * as authService from './auth.service';
import { ok, created, badRequest, unauthorized } from '../../lib/response';
import { requestOtpSchema, verifyOtpSchema, staffLoginSchema } from './auth.schema';

export async function requestOtp(req: AuthRequest, res: Response): Promise<void> {
  const { mobile } = requestOtpSchema.parse(req.body);
  const result = await authService.requestOtp(mobile);
  ok(res, result, 'OTP sent');
}

export async function verifyOtp(req: AuthRequest, res: Response): Promise<void> {
  const { mobile, code } = verifyOtpSchema.parse(req.body);
  try {
    const result = await authService.verifyOtp(mobile, code);
    ok(res, result, 'Login successful');
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

export async function staffLogin(req: AuthRequest, res: Response): Promise<void> {
  const { email, password } = staffLoginSchema.parse(req.body);
  try {
    const result = await authService.staffLogin(email, password);
    ok(res, result, 'Login successful');
  } catch (err) {
    unauthorized(res, (err as Error).message);
  }
}

export async function getMe(req: AuthRequest, res: Response): Promise<void> {
  const user = await authService.getMe(req.user!.userId);
  ok(res, user);
}
