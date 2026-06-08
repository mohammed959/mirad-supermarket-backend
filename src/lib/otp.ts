import { config } from '../config';

export function generateOtpCode(): string {
  if (config.otp.override) return config.otp.override;
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function getOtpExpiry(): Date {
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + config.otp.expiresMinutes);
  return expiry;
}

// In production, integrate an SMS provider (Unifonic, Twilio, etc.)
// In development, the OTP is logged to the console and returned in the response.
export async function sendOtp(mobile: string, code: string): Promise<void> {
  console.log(`[OTP] Mobile: ${mobile} → Code: ${code}`);
}
