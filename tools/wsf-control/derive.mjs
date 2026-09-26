/**
 * Derivations shared by the views, the checker and the renderer. Pure; no
 * judgment. WATCH is derived here and nowhere else: it is never stored or set.
 */
import { REVIEWER_OWNED, WORKER_OWNED, isTerminal } from './schema.mjs';

const byId = (s) => Object.keys(s.packets).sort().map((id) => ({ id, ...s.packets[id] }));
export const fmtRef = (r) => (r ? `${r.kind}:${r.id}` : 'none');

/**
 * A worker's packets, by who holds the ball. Reference and blocked packets never count as work.
 *   active    it owns the packet and the phase is worker-owned (RELEASED, ACKED, CHANGES_REQUESTED);
 *   reviewing it is an assigned reviewer of an UNDER_REVIEW work packet (it holds the ball);
 *   waiting   it owns a delivered packet that someone else holds (DELIVERED, UNDER_REVIEW).
 */
export function workerBuckets(s, worker) {
  const all = byId(s).filter((p) => p.kind === 'work');
  const mine = all.filter((p) => p.owner === worker);
  return {
    active: mine.filter((p) => WORKER_OWNED.includes(p.phase)),
    reviewing: all.filter((p) => p.phase === 'UNDER_REVIEW' && p.reviewers.includes(worker)),
    waiting: mine.filter((p) => REVIEWER_OWNED.includes(p.phase)),
    blocked: mine.filter((p) => p.phase === 'BLOCKED'),
    // NEXT is the first WORK packet in queue order; a queued reference is released at will and never drives the loop.
    next: (s.queue[worker] || []).find((id) => s.packets[id]?.kind === 'work') ?? null,
  };
}

/**
 * WATCH=on only while the worker holds the ball: an active packet it owns, or a
 * review it is assigned. An implementer waiting on someone else's review is off;
 * a Director/Owner/Fable/L0 reviewer is not a worker and wakes no one.
 */
export function workerWatch(s, worker) {
  const b = workerBuckets(s, worker);
  return b.active.length > 0 || b.reviewing.length > 0;
}

/** How far a packet has come, for blockers. A failed proof sends it back: nothing after CHANGES_REQUESTED counts. */
const RANK = { ACCEPTED: 1, INTEGRATED: 2, VERIFYING: 2, VERIFIED: 3, STAGED: 3 };

/** Is one blocker cleared by the current state (and, for external conditions, the supplied snapshot)? */
export function blockerCleared(s, blocker, snapshot = null) {
  if (blocker.packet) {
    const p = s.packets[blocker.packet];
    if (!p || p.phase === 'WITHDRAWN') return false;
    if (isTerminal(p)) return true; // done by its own contract: nothing further will happen to it
    return (RANK[p.phase] ?? 0) >= RANK[blocker.until];
  }
  return snapshot?.externalConditions?.[blocker.external] === true;
}

/**
 * The transitions the program needs now, from state and (when supplied) the
 * snapshot's run conclusions and external conditions. `reactivates` names the
 * worker whose WATCH the transition turns back on.
 */
export function neededTransitions(s, snapshot = null) {
  const out = [];
  const push = (p, event, by, why, reactivates = null) => out.push({ packet: p.id, event, by, why, reactivates });
  for (const p of byId(s)) {
    if (p.kind !== 'work' || isTerminal(p)) continue;
    if (p.phase === 'DELIVERED') push(p, 'review', 'Fable', 'delivered and not yet routed to review');
    if (p.phase === 'ACCEPTED') push(p, 'integrate', 'L0', 'accepted but not integrated');
    if (p.phase === 'INTEGRATED') {
      if (p.completion.terminal === 'VERIFIED') push(p, 'begin-proof', 'L0', `integrated; its completion contract needs a ${p.completion.proofType} proof`);
      if (p.completion.terminal === 'STAGED') push(p, 'stage', 'L0', 'integrated but not staged');
    }
    if (p.phase === 'VERIFYING') {
      const run = snapshot?.runs?.[String(p.proof.runId)];
      if (run?.status === 'completed' && run.conclusion === 'success') {
        push(p, p.completion.terminal === 'VERIFIED' ? 'proof-pass' : 'stage', 'L0', `proof run ${p.proof.runId} concluded success`);
      } else if (run?.status === 'completed') {
        push(p, 'proof-fail', 'Fable', `proof run ${p.proof.runId} concluded ${run.conclusion}; a focused finding comment records the failure`, p.owner);
      }
    }
    if (p.phase === 'BLOCKED' && p.blockedBy.length && p.blockedBy.every((b) => blockerCleared(s, b, snapshot))) {
      const back = WORKER_OWNED.includes(p.phaseBeforeBlock) || REVIEWER_OWNED.includes(p.phaseBeforeBlock);
      push(p, 'unblock', 'Fable', 'every blocker has cleared', back ? p.owner : null);
    }
  }
  for (const w of Object.keys(s.workers).sort()) {
    const b = workerBuckets(s, w);
    if (b.active.length === 0 && b.next) out.push({ packet: b.next, event: 'release', by: 'Fable', why: `${w} holds no active packet and ${b.next} is next`, reactivates: w });
  }
  return out;
}

export { byId };
