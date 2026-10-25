import type { Request, Response } from 'express';
import { GuestWorkoutDelivery } from './guestWorkoutDelivery';
import { createHash } from 'crypto';

/** Instance-scoped abuse bounds, combined with maxInstances:2/concurrency:2.
 * No raw capability/IP storage or logging; fixed-size window state. */
export class GuestRequestBudget {
  private window = -1; private count = 0; private active = 0;
  private counts = new Map<string, number>();
  constructor(private now = Date.now, private limits = { concurrent: 2, total: 120, perKey: 60 }) {}
  enter(token: string) {
    const current = Math.floor(this.now() / 60000);
    if (current !== this.window) { this.window = current; this.count = 0; this.counts.clear(); }
    const key = createHash('sha256').update(token).digest('hex'), count = this.counts.get(key) || 0;
    if (this.active >= this.limits.concurrent || this.count >= this.limits.total || count >= this.limits.perKey) return undefined;
    this.active++; this.count++; this.counts.set(key, count + 1);
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
}

/** Injectable boundary used by the hard-disabled Cloud Function and local fixtures.
 * No cookies, logging, redirect, public object URL or CORS grant. */
export function guestDeliveryHttp(delivery: GuestWorkoutDelivery, origin: string, enabled = false, budget = new GuestRequestBudget()) {
  return async (req: Request, res: Response) => {
    let release: (() => void) | undefined;
    res.set({ 'Cache-Control': 'private, no-store, max-age=0', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin', 'X-Frame-Options': 'DENY', 'X-Robots-Tag': 'noindex, nofollow, noarchive' });
    try {
      if (!enabled || req.method !== 'POST' || req.get('origin') !== origin || Object.keys(req.query || {}).length ||
        !req.is('application/json') || !req.body || typeof req.body !== 'object' || Array.isArray(req.body) ||
        Buffer.byteLength(JSON.stringify(req.body)) > 1024 || Number(req.get('content-length') || 0) > 1024) throw new Error();
      const auth = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.get('authorization') || '');
      if (!auth) throw new Error();
      release = budget.enter(auth[1]); if (!release) throw new Error();
      if (req.path === '/guest-workout-api/manifest' && Object.keys(req.body).length === 0) {
        res.status(200).json(await delivery.manifest(auth[1])); return;
      }
      if (req.path !== '/guest-workout-api/chunk' || Object.keys(req.body).sort().join(',') !== 'assetId,revision' ||
        !/^asset-\d{1,4}$/.test(req.body.assetId) || !/^[a-f0-9]{64}$/.test(req.body.revision)) throw new Error();
      const chunk = await delivery.chunk(auth[1], req.body.assetId, req.body.revision, req.get('range'));
      res.set({ ...chunk.headers, 'Content-Type': chunk.contentType, 'Content-Range': `bytes ${chunk.start}-${chunk.end}/${chunk.size}`, 'Content-Length': String(chunk.bytes.length) });
      res.status(206).send(chunk.bytes);
    } catch { res.status(404).json({ error: 'Workout unavailable.' }); }
    finally { release?.(); }
  };
}
