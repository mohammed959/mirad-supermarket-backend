import { Response } from 'express';
import { AuthRequest } from '../../middleware/auth.middleware';
import * as svc from './address.service';
import { createAddressSchema, updateAddressSchema } from './address.schema';
import { ok, created, notFound, noContent } from '../../lib/response';

export async function list(req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.listAddresses(req.user!.userId);
  ok(res, data);
}

export async function getOne(req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.getAddress(req.user!.userId, req.params.id);
  if (!data) { notFound(res, 'Address not found'); return; }
  ok(res, data);
}

export async function create(req: AuthRequest, res: Response): Promise<void> {
  const body = createAddressSchema.parse(req.body);
  const data = await svc.createAddress(req.user!.userId, body);
  created(res, data);
}

export async function update(req: AuthRequest, res: Response): Promise<void> {
  const owned = await svc.getAddress(req.user!.userId, req.params.id);
  if (!owned) { notFound(res, 'Address not found'); return; }
  const body = updateAddressSchema.parse(req.body);
  const data = await svc.updateAddress(req.user!.userId, req.params.id, body);
  ok(res, data);
}

export async function setDefault(req: AuthRequest, res: Response): Promise<void> {
  const owned = await svc.getAddress(req.user!.userId, req.params.id);
  if (!owned) { notFound(res, 'Address not found'); return; }
  const data = await svc.setDefault(req.user!.userId, req.params.id);
  ok(res, data);
}

export async function remove(req: AuthRequest, res: Response): Promise<void> {
  const data = await svc.deleteAddress(req.user!.userId, req.params.id);
  if (!data) { notFound(res, 'Address not found'); return; }
  noContent(res);
}
