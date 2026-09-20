import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth.middleware';
import { ok, badRequest } from '../../lib/response';
import * as svc from './contact.service';

export async function getContact(_req: Request, res: Response): Promise<void> {
  const data = await svc.getContactSettings();
  ok(res, data);
}

// Nullable + optional: omit a field to leave it untouched, send `null`/`""`
// to clear it, or a string to set it. Free-form — phone/WhatsApp numbers
// are shown to customers as-is (e.g. "+966 50 000 0000"), not parsed.
const updateContactSchema = z.object({
  phone: z.string().trim().max(32).nullable().optional(),
  whatsapp: z.string().trim().max(32).nullable().optional(),
});

export async function updateContact(req: AuthRequest, res: Response): Promise<void> {
  try {
    const parsed = updateContactSchema.parse(req.body);
    const data = await svc.updateContactSettings({
      ...(parsed.phone !== undefined && { phone: parsed.phone || null }),
      ...(parsed.whatsapp !== undefined && { whatsapp: parsed.whatsapp || null }),
    });
    ok(res, data, 'Contact information saved');
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}
