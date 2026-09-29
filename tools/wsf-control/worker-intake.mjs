/**
 * Worker facts from the workers' canonical inboxes (AUTONOMY-ROUTER-1C; accepted A+ memo §3.2, §5.2, §6.3).
 *
 * A worker reports with exactly one fenced block in ITS OWN registered inbox:
 *
 *   ```wsf-control-worker
 *   {"type":"ack","packet":"ALPHA","wakeId":"<64 hex>"}
 *   {"type":"deliver","packet":"ALPHA","wakeId":"…","pr":12,"subjectSha":"<40 hex>"}
 *   {"type":"pass","packet":"ALPHA","wakeId":"…","subjectSha":"…"}
 *   {"type":"finding","packet":"ALPHA","wakeId":"…","subjectSha":"…"}
 *   ```
 *
 * The block names facts only; the writer chooses the event, its rule, its class (attested) and its source (the
 * comment). Structural binding (§5.2), every check fail-closed and every refusal reported, never recorded:
 *  - author and edit: the repository owner's account, OWNER association, an unedited comment (F1, F1-R2a);
 *  - location: the comment is in the registered inbox of the worker the wake names;
 *  - assignment: the wakeId is a recorded, posted wake for this worker and packet, and it is the CURRENT ball
 *    (a stale session quoting an old assignment is refused; the same comment re-read is a no-op);
 *  - ordering: the comment comes after the wake's first App comment (GitHub comment ids only grow);
 *  - owner exclusion: a pass or finding comes from an assigned W# reviewer that is not the owner;
 *  - subject: a pass or finding names the subject under review; a delivery is re-derived (R-DELIVER-1 check):
 *    the PR is open, its head is the named SHA, and the SHA descends from the PR's base.
 * Every accepted report also ACKs its wake (wake-ack, A-WAKE-ACK).
 */
import { RE } from './schema.mjs';
import { workerBuckets } from './derive.mjs';
import { decisionAuthorProblem, decisionEditProblem } from './shadow.mjs';
import { line } from './router.mjs';

export const WORKER_FENCE = 'wsf-control-worker';
export const WORKER_REPORTS = Object.freeze({
  ack: ['type', 'packet', 'wakeId'],
  deliver: ['type', 'packet', 'wakeId', 'pr', 'subjectSha'],
  pass: ['type', 'packet', 'wakeId', 'subjectSha'],
  finding: ['type', 'packet', 'wakeId', 'subjectSha'],
});

/** The single worker block of a comment: null (none), { error }, or { value }. */
export function workerBlock(body) {
  const re = new RegExp(`^\`\`\`${WORKER_FENCE}[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n\`\`\`[ \\t]*$`, 'gm');
  const blocks = [...String(body).matchAll(re)];
  if (blocks.length === 0) return null;
  if (blocks.length > 1) return { error: `the comment carries ${blocks.length} ${WORKER_FENCE} blocks; one report per comment` };
  let v;
  try { v = JSON.parse(blocks[0][1]); } catch { return { error: `the ${WORKER_FENCE} block is not JSON` }; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'the report must be a JSON object' };
  const keys = WORKER_REPORTS[v.type];
  if (!keys) return { error: `${JSON.stringify(v.type)} is not a worker report (ack, deliver, pass, finding)` };
  const extra = Object.keys(v).filter((k) => !keys.includes(k));
  const missing = keys.filter((k) => !Object.hasOwn(v, k));
  if (extra.length || missing.length) return { error: `a ${v.type} report carries exactly ${keys.join(', ')}${extra.length ? `; refused ${extra.join(', ')}` : ''}${missing.length ? `; missing ${missing.join(', ')}` : ''}` };
  if (!RE.packet.test(v.packet)) return { error: 'packet is malformed' };
  if (!RE.hash.test(v.wakeId)) return { error: 'wakeId must be the 64-hex wake identity' };
  if (Object.hasOwn(v, 'subjectSha') && !RE.sha.test(v.subjectSha)) return { error: 'subjectSha must be a 40-hex commit' };
  if (Object.hasOwn(v, 'pr') && !(Number.isInteger(v.pr) && v.pr > 0)) return { error: 'pr must be a PR number' };
  return { value: v };
}

/**
 * One inbox comment → { lines } to append (possibly empty: nothing new), { refused }, or null (no report).
 * `worker` is the worker whose registered inbox the comment was read from. `current` is the set of wakeIds
 * that are current balls (router.balls). `recorded` is the set of comment ids the ledger already rests on: such a
 * comment was accepted before, so re-reading it is a no-op. `pr` is the writer's own read of the named PR:
 * { state, headSha, descends } or null when it could not be read.
 */
export function workerReport(state, worker, comment, { current, recorded = new Set(), pr = null }) {
  const blk = workerBlock(comment.body);
  if (!blk) return null;
  if (recorded.has(comment.id)) return { lines: [] };
  const who = decisionAuthorProblem(comment) ?? decisionEditProblem(comment);
  if (who) return { refused: who };
  if (blk.error) return { refused: blk.error };
  const r = blk.value;
  const w = state.wakes?.[r.wakeId];
  if (!w) return { refused: `wake ${r.wakeId.slice(0, 12)} is not recorded` };
  if (w.packet !== r.packet) return { refused: `wake ${r.wakeId.slice(0, 12)} is for ${w.packet}, not ${r.packet}` };
  if (w.worker !== worker) return { refused: `wake ${r.wakeId.slice(0, 12)} is ${w.worker}'s; a report counts only in that worker's inbox (this is ${worker}'s)` };
  if (!w.comments.length) return { refused: 'the wake comment has not been posted yet' };
  if (comment.id <= w.comments[0]) return { refused: `the report (comment ${comment.id}) predates its wake comment ${w.comments[0]}` };
  if (!current.has(r.wakeId)) return { refused: `wake ${r.wakeId.slice(0, 12)} is no longer ${worker}'s current ball (stale assignment)` };
  if (w.status === 'acked' && w.ack.id !== comment.id && r.type === 'ack') return { lines: [] }; // a second ACK of the same wake adds nothing
  const p = state.packets[r.packet];
  const repo = state.repository;
  const src = { kind: 'comment', id: comment.id };
  const lines = [];
  const ackWake = () => { if (w.status !== 'acked') lines.push(line(repo, 'wake-ack', { wakeId: r.wakeId, packet: r.packet, worker }, src, 'A-WAKE-ACK', [src])); };
  switch (r.type) {
    case 'ack':
      ackWake();
      if (w.reason === 'release' && p.phase === 'RELEASED') lines.push(line(repo, 'ack', { packet: r.packet, worker }, src, 'A-ACK', [src]));
      return { lines };
    case 'deliver': {
      if (!['release', 'handback'].includes(w.reason) || p.owner !== worker) return { refused: `${worker} does not own ${r.packet}; only its owner delivers` };
      if (!pr) return { refused: `DELIVERY_UNVERIFIED: PR #${r.pr} could not be read` };
      if (pr.state !== 'open') return { refused: `DELIVERY_UNVERIFIED: PR #${r.pr} is ${pr.state}, not open` };
      if (pr.headSha !== r.subjectSha) return { refused: `DELIVERY_UNVERIFIED: PR #${r.pr}'s head is ${String(pr.headSha).slice(0, 8)}, not the named ${r.subjectSha.slice(0, 8)}` };
      if (pr.descends !== true) return { refused: `DELIVERY_UNVERIFIED: ${r.subjectSha.slice(0, 8)} does not descend from PR #${r.pr}'s base` };
      ackWake();
      lines.push(line(repo, 'deliver', { packet: r.packet, pr: r.pr, subjectSha: r.subjectSha }, src, 'A-DELIVER',
        [src, { kind: 'pull_request', id: r.pr }, { kind: 'commit', id: r.subjectSha }]));
      return { lines };
    }
    case 'pass':
    case 'finding': {
      if (w.reason !== 'review') return { refused: `a ${r.type} answers a review wake, not a ${w.reason} wake` };
      if (worker === p.owner) return { refused: `${worker} owns ${r.packet}; the owner never reviews its own packet` };
      if (p.phase !== 'UNDER_REVIEW' || !p.reviewers.includes(worker) || (p.reviewedBy ?? []).includes(worker)) return { refused: `${worker} holds no open review of ${r.packet}` };
      if (r.subjectSha !== p.artifact.subjectSha) return { refused: `the ${r.type} names ${r.subjectSha.slice(0, 8)}, but the subject under review is ${String(p.artifact.subjectSha).slice(0, 8)}` };
      ackWake();
      if (r.type === 'pass') lines.push(line(repo, 'review-pass', { packet: r.packet, reviewer: worker }, src, 'A-PASS', [src]));
      else {
        // The owner holding another ball keeps the finding pending (R-PREEMPT); otherwise the ball returns now.
        const busy = workerBuckets(state, p.owner).active.length > 0;
        lines.push(line(repo, 'finding', busy ? { packet: r.packet, pending: true } : { packet: r.packet }, src, 'A-FINDING', [src]));
      }
      return { lines };
    }
    default: return { refused: 'unreachable' };
  }
}
