import { Request, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../middleware/auth.middleware';
import { ok, badRequest } from '../../lib/response';
import {
  parseAndValidateBuffer,
  buildBulkSkuTemplate,
} from './bulkSku.import';
import { applyBulkSkuUpdates } from './bulkSku.service';

export async function downloadTemplate(_req: Request, res: Response): Promise<void> {
  const buffer = await buildBulkSkuTemplate();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="bulk-sku-update-template.xlsx"');
  res.send(buffer);
}

export async function preview(req: AuthRequest, res: Response): Promise<void> {
  const file = (req as unknown as { file?: { buffer: Buffer; originalname: string } }).file;
  if (!file) {
    badRequest(res, 'No file uploaded (field name: file).');
    return;
  }
  try {
    const result = await parseAndValidateBuffer(file.buffer);
    ok(res, result, 'Preview ready');
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}

const applySchema = z.object({
  rows: z
    .array(
      z.object({
        sku: z.string().min(1, 'sku is required'),
        price: z.number().positive().nullable().optional(),
        quantity: z.number().int().min(0).nullable().optional(),
      }),
    )
    .min(1, 'At least one row is required.'),
});

export async function apply(req: AuthRequest, res: Response): Promise<void> {
  try {
    const body = applySchema.parse(req.body);
    const result = await applyBulkSkuUpdates(
      body.rows.map((r) => ({
        sku: r.sku,
        price: r.price ?? null,
        quantity: r.quantity ?? null,
      })),
      req.user!.userId,
    );
    ok(res, result, `Updated ${result.appliedCount} SKU(s).`);
  } catch (err) {
    badRequest(res, (err as Error).message);
  }
}
