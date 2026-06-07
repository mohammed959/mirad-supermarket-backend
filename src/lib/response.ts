import { Response } from 'express';
import { decorateProductImages } from './productImage';

export function ok<T>(res: Response, data: T, message = 'Success') {
  return res.status(200).json({ success: true, message, data: decorateProductImages(data) });
}

export function created<T>(res: Response, data: T, message = 'Created') {
  return res.status(201).json({ success: true, message, data: decorateProductImages(data) });
}

export function noContent(res: Response) {
  return res.status(204).send();
}

export function badRequest(res: Response, message: string, errors?: unknown) {
  return res.status(400).json({ success: false, message, errors });
}

export function unauthorized(res: Response, message = 'Unauthorized') {
  return res.status(401).json({ success: false, message });
}

export function forbidden(res: Response, message = 'Forbidden') {
  return res.status(403).json({ success: false, message });
}

export function notFound(res: Response, message = 'Not found') {
  return res.status(404).json({ success: false, message });
}

export function serverError(res: Response, message = 'Internal server error') {
  return res.status(500).json({ success: false, message });
}
