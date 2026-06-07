import { z } from 'zod';

export const createProductSchema = z.object({
  categoryId: z.string().min(1),
  subcategoryId: z.string().optional(),
  name: z.string().min(1).max(200),
  nameAr: z.string().min(1).max(200),
  description: z.string().optional(),
  descriptionAr: z.string().optional(),
  isFeatured: z.boolean().optional().default(false),
  hideFromHome: z.boolean().optional().default(false),
  variants: z
    .array(
      z.object({
        type: z.enum(['PIECE', 'CARTON', 'DOZEN', 'BUNDLE']),
        sku: z.string().min(1),
        barcode: z.string().optional(),
        price: z.number().positive(),
        stock: z.number().int().min(0).default(0),
      })
    )
    .min(1, 'At least one variant required'),
});

export const updateProductSchema = createProductSchema.partial().omit({ variants: true });

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
