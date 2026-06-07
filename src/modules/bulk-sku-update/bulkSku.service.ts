import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logAction } from '../audit/audit.service';

export interface ConfirmInputRow {
  sku: string;
  price?: number | null;
  quantity?: number | null;
}

export interface AppliedRow {
  sku: string;
  variantId: string;
  productName: string | null;
  oldPrice: number;
  newPrice: number;
  oldQuantity: number;
  newQuantity: number;
  priceChanged: boolean;
  quantityChanged: boolean;
}

export interface SkippedRow {
  sku: string;
  reason: string;
}

export interface ApplyResult {
  batchId: string;
  appliedCount: number;
  skipped: SkippedRow[];
  rows: AppliedRow[];
}

/**
 * Apply a batch of validated price/quantity updates. Re-validates every row
 * against the current DB state and skips anything that no longer qualifies —
 * the preview is advisory, the apply call is authoritative.
 *
 * Each successful update is written inside the same transaction as the audit
 * log, so a partial failure rolls back both the data and the trail.
 */
export async function applyBulkSkuUpdates(
  rows: ConfirmInputRow[],
  actorId: string,
): Promise<ApplyResult> {
  const batchId = randomUUID();
  const skus = Array.from(new Set(rows.map((r) => r.sku.trim()).filter(Boolean)));
  if (skus.length === 0) {
    return { batchId, appliedCount: 0, skipped: [], rows: [] };
  }

  const variants = await prisma.productVariant.findMany({
    where: { sku: { in: skus } },
    select: {
      id: true, sku: true, price: true, stock: true,
      product: { select: { name: true } },
    },
  });
  const bySku = new Map(variants.map((v) => [v.sku, v]));

  const skipped: SkippedRow[] = [];
  const planned: Array<{
    row: ConfirmInputRow;
    variant: typeof variants[number];
    newPrice: number;
    newQuantity: number;
  }> = [];

  for (const row of rows) {
    const sku = row.sku?.trim();
    if (!sku) {
      skipped.push({ sku: row.sku ?? '', reason: 'Missing SKU.' });
      continue;
    }
    const variant = bySku.get(sku);
    if (!variant) {
      skipped.push({ sku, reason: 'SKU not found.' });
      continue;
    }

    const wantsPrice = row.price != null;
    const wantsQuantity = row.quantity != null;
    if (!wantsPrice && !wantsQuantity) {
      skipped.push({ sku, reason: 'Both price and quantity are empty.' });
      continue;
    }

    if (wantsPrice) {
      const p = Number(row.price);
      if (!Number.isFinite(p) || p <= 0) {
        skipped.push({ sku, reason: 'Price must be greater than zero.' });
        continue;
      }
    }
    if (wantsQuantity) {
      const q = Number(row.quantity);
      if (!Number.isInteger(q) || q < 0) {
        skipped.push({ sku, reason: 'Quantity must be a non-negative integer.' });
        continue;
      }
    }

    planned.push({
      row,
      variant,
      newPrice: wantsPrice ? Math.round(Number(row.price) * 100) / 100 : Number(variant.price),
      newQuantity: wantsQuantity ? Math.floor(Number(row.quantity)) : variant.stock,
    });
  }

  const applied: AppliedRow[] = [];

  if (planned.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const plan of planned) {
        const oldPrice = Number(plan.variant.price);
        const oldQuantity = plan.variant.stock;
        const data: Prisma.ProductVariantUpdateInput = {};
        if (plan.row.price != null && plan.newPrice !== oldPrice) data.price = plan.newPrice;
        if (plan.row.quantity != null && plan.newQuantity !== oldQuantity) data.stock = plan.newQuantity;

        if (Object.keys(data).length === 0) {
          // Values match what's already in the DB — nothing to write, but it's
          // not an error either. Skip silently from the applied list.
          continue;
        }

        await tx.productVariant.update({
          where: { id: plan.variant.id },
          data,
        });

        await logAction(
          {
            actorId,
            actorRole: 'SUPER_ADMIN',
            action: 'inventory.bulk_sku_update',
            entityType: 'product_variant',
            entityId: plan.variant.id,
            changes: {
              batchId,
              sku: plan.variant.sku,
              oldPrice,
              newPrice: data.price !== undefined ? plan.newPrice : oldPrice,
              oldQuantity,
              newQuantity: data.stock !== undefined ? plan.newQuantity : oldQuantity,
            },
          },
          tx,
        );

        applied.push({
          sku: plan.variant.sku,
          variantId: plan.variant.id,
          productName: plan.variant.product?.name ?? null,
          oldPrice,
          newPrice: plan.newPrice,
          oldQuantity,
          newQuantity: plan.newQuantity,
          priceChanged: data.price !== undefined,
          quantityChanged: data.stock !== undefined,
        });
      }
    });
  }

  // Batch-level audit row so the import shows up as a single entry in the
  // audit log feed too, on top of the per-SKU rows.
  await logAction({
    actorId,
    actorRole: 'SUPER_ADMIN',
    action: 'inventory.bulk_sku_update.batch',
    entityType: 'inventory_bulk_import',
    entityId: batchId,
    changes: {
      batchId,
      submitted: rows.length,
      applied: applied.length,
      skipped: skipped.length,
    },
  });

  return { batchId, appliedCount: applied.length, skipped, rows: applied };
}
