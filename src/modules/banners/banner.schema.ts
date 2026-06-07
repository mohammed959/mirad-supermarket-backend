import { z } from 'zod';

export const createBannerSchema = z.object({
  title: z.string().min(1).max(200),
  titleAr: z.string().min(1).max(200),
  imageUrl: z.string().url(),
  linkType: z.string().max(50).optional(),
  linkValue: z.string().max(500).optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

export const updateBannerSchema = createBannerSchema.partial();

export type CreateBannerInput = z.infer<typeof createBannerSchema>;
export type UpdateBannerInput = z.infer<typeof updateBannerSchema>;
