/**
 * Derivations shared by the views, the checker and the renderer. Pure; no
 * judgment. WATCH is derived here and nowhere else: it is never stored or set.
 */
import { REVIEWER_OWNED, WORKER_OWNED, isTerminal } from './schema.mjs';

const byId = (s) => Object.keys(s.packets).sort().map((id) => ({ id, ...s.packets[id] }));

/** A worker's packets, by who holds the ball. Reference and blocked packets never count as work. */
export function workerBuckets(s, worker) {
  const mine = byId(s).filter((p) => p.owner === worker && p.kind === 'work');
  return {
    active: mine.filter((p) => WORKER_OWNED.includes(p.phase)),
    awaitingReview: mine.filter((p) => REVIEWER_OWNED.includes(p.phase)),
    blocked: mine.filter((p) => p.phase === 'BLOCKED'),
    // NEXT is the first WORK packet in queue order; a queued reference is released at will and never drives the loop.
    next: (s.queue[worker] || []).find((id) => s.packets[id]?.kind === 'work') ?? null,
  };
}

/** WATCH=on only while the worker holds work or waits on a near-term review of its delivered work. */
export function workerWatch(s, worker) {
  const b = workerBuckets(s, worker);
  return b.active.length > 0 || b.awaitingReview.length > 0;
}

/** Is one blocker cleared by the current state (and, for external conditions, the supplied snapshot)? */
export function blockerCleared(s, blocker, snapshot = null) {
  if (blocker.packet) {
    const p = s.packets[blocker.packet];
    if (!p) return false;
    const order = ['ACCEPTED', 'INTEGRATED', 'STAGED'];
    if (p.phase === 'WITHDRAWN') return false;
    if (p.phase === 'INTEGRATED' && p.track === 'ops' && blocker.until === 'STAGED') return true;
    return order.indexOf(p.phase) >= order.indexOf(blocker.until) && order.includes(p.phase);
  }
  return snapshot?.externalConditions?.[blocker.external] === true;
}

/** The transitions the program needs from Fable/L0 now, derived from state alone (reconcile adds GitHub facts). */
export function neededTransitions(s, snapshot = null) {
  const out = [];
  for (const p of byId(s)) {
    if (p.kind !== 'work' || isTerminal(p)) continue;
    if (p.phase === 'DELIVERED') out.push({ packet: p.id, event: 'review', by: 'Fable', why: 'delivered and not yet routed to review' });
    if (p.phase === 'ACCEPTED') out.push({ packet: p.id, event: 'integrate', by: 'L0', why: 'accepted but not integrated' });
    if (p.phase === 'INTEGRATED' && p.track === 'product') out.push({ packet: p.id, event: 'stage', by: 'L0', why: 'integrated but not staged' });
    if (p.phase === 'BLOCKED' && p.blockedBy.length && p.blockedBy.every((b) => blockerCleared(s, b, snapshot))) {
      out.push({ packet: p.id, event: 'unblock', by: 'Fable', why: 'every blocker has cleared' });
    }
  }
  for (const w of Object.keys(s.workers).sort()) {
    const b = workerBuckets(s, w);
    if (b.active.length === 0 && b.next) out.push({ packet: b.next, event: 'release', by: 'Fable', why: `${w} holds no active packet and ${b.next} is next` });
  }
  return out;
}

export { byId };
