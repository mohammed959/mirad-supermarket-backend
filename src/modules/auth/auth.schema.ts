import { z } from 'zod';

export const requestOtpSchema = z.object({
  mobile: z
    .string()
    .min(9)
    .max(15)
    .regex(/^[+]?[0-9]+$/, 'Invalid mobile number'),
});

export const verifyOtpSchema = z.object({
  mobile: z.string().min(9).max(15),
  code: z.string().length(6, 'OTP must be 6 digits'),
});

export const staffLoginSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});

export type RequestOtpInput = z.infer<typeof requestOtpSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type StaffLoginInput = z.infer<typeof staffLoginSchema>;
