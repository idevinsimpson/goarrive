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
    // A reviewer that has passed holds no ball: its WATCH is off while the packet waits on others or on acceptance.
    reviewing: all.filter((p) => p.phase === 'UNDER_REVIEW' && p.reviewers.includes(worker) && !(p.reviewedBy || []).includes(worker)),
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

/**
 * The phases in which a dependency has reached each blocker milestone. A failed proof sends it
 * back: nothing after CHANGES_REQUESTED counts. VERIFIED is met by VERIFIED or by terminal STAGED,
 * which needs a passed hosted proof (a deployment receipt or VERIFYING alone never meets it);
 * STAGED is met only by STAGED.
 */
const REACHED = {
  ACCEPTED: ['ACCEPTED', 'INTEGRATED', 'VERIFYING', 'VERIFIED', 'STAGED'],
  INTEGRATED: ['INTEGRATED', 'VERIFYING', 'VERIFIED', 'STAGED'],
  VERIFIED: ['VERIFIED', 'STAGED'],
  STAGED: ['STAGED'],
};

/** Is one blocker cleared by the current state (and, for external conditions, the supplied snapshot)? */
export function blockerCleared(s, blocker, snapshot = null) {
  if (blocker.packet) {
    const p = s.packets[blocker.packet];
    if (!p || p.phase === 'WITHDRAWN') return false;
    // Being terminal is not enough: the dependency must have reached the named milestone.
    return REACHED[blocker.until].includes(p.phase);
  }
  return snapshot?.externalConditions?.[blocker.external] === true;
}

/**
 * The transitions the program needs now, from state and (when supplied) the
 * snapshot's run conclusions and external conditions. `reactivates` names the
 * worker whose WATCH the transition turns back on.
 */
/**
 * Who holds the ball once a blocked packet returns to its phase: the owner of worker-owned work,
 * the outstanding W# reviewers of an UNDER_REVIEW packet, and no one for QUEUED or DELIVERED
 * (Fable routes the review).
 */
export function ballAfterUnblock(p) {
  if (WORKER_OWNED.includes(p.phaseBeforeBlock)) return p.owner;
  if (p.phaseBeforeBlock === 'UNDER_REVIEW') {
    const pending = p.reviewers.filter((r) => /^W[1-9][0-9]?$/.test(r) && !(p.reviewedBy || []).includes(r));
    return pending.length ? pending.join(',') : null;
  }
  return null;
}

export function neededTransitions(s, snapshot = null) {
  const out = [];
  const push = (p, event, by, why, reactivates = null) => out.push({ packet: p.id, event, by, why, reactivates });
  for (const p of byId(s)) {
    if (p.kind !== 'work' || isTerminal(p)) continue;
    if (p.phase === 'DELIVERED') push(p, 'review', 'Fable', 'delivered and not yet routed to review');
    if (p.phase === 'ACCEPTED') push(p, 'integrate', 'L0', 'accepted but not integrated');
    if (p.phase === 'INTEGRATED') {
      if (p.completion.terminal === 'VERIFIED') push(p, 'begin-proof', 'L0', `integrated; its completion contract needs a ${p.completion.proofType} proof`);
      if (p.completion.terminal === 'STAGED') push(p, 'begin-proof', 'L0', 'integrated; staging needs a hosted proof with its deployment run');
    }
    if (p.phase === 'VERIFYING') {
      const run = snapshot?.runs?.[String(p.proof.runId)];
      if (run?.status === 'completed' && run.conclusion === 'success') {
        // STAGED: the deployment receipt (stage) is recorded first; hosted verification (proof-pass) then completes it.
        const next = p.completion.terminal === 'STAGED' && p.served?.runId !== p.proof.runId ? 'stage' : 'proof-pass';
        push(p, next, 'L0', `proof run ${p.proof.runId} concluded success`);
      } else if (run?.status === 'completed') {
        push(p, 'proof-fail', 'Fable', `proof run ${p.proof.runId} concluded ${run.conclusion}; a focused finding comment records the failure`, p.owner);
      }
    }
    if (p.phase === 'BLOCKED' && p.blockedBy.length && p.blockedBy.every((b) => blockerCleared(s, b, snapshot))) {
      push(p, 'unblock', 'Fable', 'every blocker has cleared', ballAfterUnblock(p));
    }
  }
  for (const w of Object.keys(s.workers).sort()) {
    const b = workerBuckets(s, w);
    // A worker holding a review holds its one ball: its NEXT waits until the review leaves it.
    if (b.active.length === 0 && b.reviewing.length === 0 && b.next) out.push({ packet: b.next, event: 'release', by: 'Fable', why: `${w} holds no active packet and ${b.next} is next`, reactivates: w });
  }
  return out;
}

export { byId };
