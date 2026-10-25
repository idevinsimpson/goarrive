import type { Request, Response } from 'express';
import { GuestWorkoutDelivery } from './guestWorkoutDelivery';

/** Injectable draft boundary, deliberately not exported as a Cloud Function.
 * No issue endpoint, cookies, logging, redirect, public object URL or CORS grant. */
export function guestDeliveryHttp(delivery: GuestWorkoutDelivery, origin: string, enabled = false) {
  return async (req: Request, res: Response) => {
    res.set({ 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin' });
    try {
      if (!enabled || req.method !== 'POST' || req.get('origin') !== origin || Object.keys(req.query || {}).length ||
        !req.is('application/json') || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw new Error();
      const auth = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization') || '');
      if (!auth) throw new Error();
      if (req.path === '/guest-workout-api/manifest' && Object.keys(req.body).length === 0) {
        res.status(200).json(await delivery.manifest(auth[1])); return;
      }
      if (req.path !== '/guest-workout-api/chunk' || Object.keys(req.body).sort().join(',') !== 'assetId,revision' ||
        !/^asset-\d{1,4}$/.test(req.body.assetId) || !/^[a-f0-9]{64}$/.test(req.body.revision)) throw new Error();
      const chunk = await delivery.chunk(auth[1], req.body.assetId, req.body.revision, req.get('range'));
      res.set({ ...chunk.headers, 'Content-Type': chunk.contentType, 'Content-Range': `bytes ${chunk.start}-${chunk.end}/${chunk.size}`, 'Content-Length': String(chunk.bytes.length) });
      res.status(206).send(chunk.bytes);
    } catch { res.status(404).json({ error: 'Workout unavailable.' }); }
  };
}
