import { z } from 'zod';

export const createAddressSchema = z.object({
  label: z.string().min(1).max(50).optional(),
  addressLine: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  deliveryNotes: z.string().max(500).nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  isDefault: z.boolean().optional(),
});

export const updateAddressSchema = createAddressSchema.partial();

export type CreateAddressInput = z.infer<typeof createAddressSchema>;
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
