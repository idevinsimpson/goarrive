/**
 * The legal transitions, applied to a state as a pure function.
 *
 *   QUEUED ─release→ RELEASED ─ack→ ACKED ─deliver→ DELIVERED ─review→ UNDER_REVIEW
 *   UNDER_REVIEW|DELIVERED ─finding→ CHANGES_REQUESTED ─deliver→ DELIVERED
 *   UNDER_REVIEW|DELIVERED ─accept→ ACCEPTED ─integrate→ INTEGRATED ─stage→ STAGED
 *   any non-terminal ─block→ BLOCKED ─unblock→ (the phase before the block)
 *   any non-terminal ─withdraw→ WITHDRAWN
 *
 * Only `deliver` moves artifact.subjectSha (the thing a phase applies to).
 * `reconcile-head` records a reconciled GitHub PR head and `record-evidence` an
 * evidence/doc head; neither moves the subject, so evidence practice on a PR
 * never silently re-points a review or an acceptance.
 */
import { GENESIS, SCHEMA_VERSION, isTerminal } from './schema.mjs';

export class Illegal extends Error {}
const illegal = (m) => { throw new Illegal(m); };

export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    ledgerHead: GENESIS,
    eventCount: 0,
    canonical: null,
    staging: null,
    criticalPath: null,
    workers: {},
    queue: {},
    packets: {},
  };
}

const clone = (x) => JSON.parse(JSON.stringify(x));
const need = (s, id) => s.packets[id] || illegal(`packet ${id} does not exist`);
function from(p, allowed, type) {
  if (!allowed.includes(p.phase)) illegal(`${type} is not legal from ${p.phase} (legal from ${allowed.join(', ')})`);
}
function live(p, type) {
  if (isTerminal(p)) illegal(`${type}: packet is terminal (${p.phase})`);
}

/** Apply one (already schema-valid) event; returns a new state or throws Illegal. */
export function applyEvent(state, e) {
  const s = clone(state);
  if (e.type === 'init') {
    if (s.eventCount !== 0) illegal('init is legal only as the first event');
  } else if (s.eventCount === 0) {
    illegal('the first event must be init');
  }
  const p = e.packet && e.type !== 'queue' ? need(s, e.packet) : null;
  switch (e.type) {
    case 'init': break;
    case 'set-canonical':
      s.canonical = { developmentBranch: e.developmentBranch, developmentSha: e.developmentSha, operationalMain: e.operationalMain };
      break;
    case 'set-staging':
      s.staging = { servedSha: e.servedSha, runId: e.runId, runNumber: e.runNumber, rollbackSha: e.rollbackSha, pinPr: e.pinPr ?? null };
      break;
    case 'register-worker':
      if (s.workers[e.worker]) illegal(`worker ${e.worker} is already registered`);
      s.workers[e.worker] = { inbox: e.inbox };
      s.queue[e.worker] = [];
      break;
    case 'queue': {
      if (s.packets[e.packet]) illegal(`packet ${e.packet} already exists (${s.packets[e.packet].phase}); a released or finished packet cannot be queued again`);
      if (!s.workers[e.owner]) illegal(`worker ${e.owner} is not registered`);
      s.packets[e.packet] = {
        owner: e.owner, kind: e.kind ?? 'work', track: e.track ?? 'product', label: e.label ?? null,
        phase: 'QUEUED', phaseBeforeBlock: null, inbox: null, pr: null, reviewers: [],
        artifact: { subjectSha: null, prHeadSha: null, evidenceSha: null },
        subjectPaths: e.subjectPaths ?? ['*'], blockedBy: [],
        authority: { queued: e.authority, released: null, lastTransition: e.authority },
      };
      s.queue[e.owner].push(e.packet);
      break;
    }
    case 'reorder-queue': {
      const current = s.queue[e.owner] || illegal(`worker ${e.owner} is not registered`);
      if ([...e.order].sort().join() !== [...current].sort().join() || new Set(e.order).size !== e.order.length) {
        illegal(`reorder-queue must be a permutation of ${e.owner}'s queue (${current.join(', ') || 'empty'})`);
      }
      s.queue[e.owner] = [...e.order];
      break;
    }
    case 'release': {
      from(p, ['QUEUED'], 'release');
      const worker = s.workers[p.owner];
      if (e.inbox !== worker.inbox) illegal(`release must be handed off in ${p.owner}'s canonical inbox #${worker.inbox}, not #${e.inbox}`);
      p.phase = 'RELEASED';
      p.inbox = e.inbox;
      p.authority.released = e.authority;
      s.queue[p.owner] = s.queue[p.owner].filter((x) => x !== e.packet);
      break;
    }
    case 'ack': from(p, ['RELEASED'], 'ack'); p.phase = 'ACKED'; break;
    case 'deliver':
      from(p, ['RELEASED', 'ACKED', 'CHANGES_REQUESTED', 'DELIVERED', 'UNDER_REVIEW'], 'deliver');
      if (p.pr !== null && p.pr !== e.pr) illegal(`deliver names PR #${e.pr}, but this packet is delivered on #${p.pr}`);
      p.phase = 'DELIVERED';
      p.pr = e.pr;
      p.artifact.subjectSha = e.subjectSha;
      p.artifact.prHeadSha = e.prHeadSha ?? e.subjectSha;
      if (e.evidenceSha) p.artifact.evidenceSha = e.evidenceSha;
      break;
    case 'review': from(p, ['DELIVERED'], 'review'); p.phase = 'UNDER_REVIEW'; p.reviewers = [...e.reviewers]; break;
    case 'finding': from(p, ['DELIVERED', 'UNDER_REVIEW'], 'finding'); p.phase = 'CHANGES_REQUESTED'; break;
    case 'accept':
      from(p, ['DELIVERED', 'UNDER_REVIEW'], 'accept');
      if (e.subjectSha !== p.artifact.subjectSha) illegal(`accept names ${e.subjectSha.slice(0, 8)}, but the subject under review is ${String(p.artifact.subjectSha).slice(0, 8)}`);
      p.phase = 'ACCEPTED';
      break;
    case 'integrate': from(p, ['ACCEPTED'], 'integrate'); p.phase = 'INTEGRATED'; p.artifact.mergeSha = e.mergeSha; break;
    case 'stage':
      from(p, ['INTEGRATED'], 'stage');
      if (p.track !== 'product') illegal('stage applies to product-track packets only');
      p.phase = 'STAGED';
      p.artifact.stagedRunId = e.runId;
      p.artifact.servedSha = e.servedSha;
      break;
    case 'block':
      live(p, 'block');
      if (p.phase === 'BLOCKED') illegal('block: the packet is already blocked');
      for (const b of e.blockedBy) if (b.packet && !s.packets[b.packet]) illegal(`block: blocking packet ${b.packet} does not exist`);
      p.phaseBeforeBlock = p.phase;
      p.phase = 'BLOCKED';
      p.blockedBy = clone(e.blockedBy);
      break;
    case 'unblock':
      from(p, ['BLOCKED'], 'unblock');
      p.phase = p.phaseBeforeBlock;
      p.phaseBeforeBlock = null;
      p.blockedBy = [];
      break;
    case 'withdraw':
      live(p, 'withdraw');
      if (p.phase === 'QUEUED') s.queue[p.owner] = s.queue[p.owner].filter((x) => x !== e.packet);
      p.phase = 'WITHDRAWN';
      break;
    case 'reconcile-head':
      live(p, 'reconcile-head');
      if (p.pr === null) illegal('reconcile-head: the packet has no PR yet');
      p.artifact.prHeadSha = e.prHeadSha; // a GitHub fact; the subject does not move
      break;
    case 'record-evidence':
      live(p, 'record-evidence');
      p.artifact.evidenceSha = e.evidenceSha; // never a substitute for the subject
      break;
    case 'set-critical-path':
      live(p, 'set-critical-path');
      if (p.kind !== 'work') illegal('set-critical-path: a reference packet cannot be the critical path');
      s.criticalPath = e.packet;
      break;
    default: illegal(`no transition for ${e.type}`);
  }
  if (p && !['reconcile-head', 'record-evidence', 'set-critical-path'].includes(e.type)) p.authority.lastTransition = e.authority;
  // The critical path completes when its packet does; it is never left pointing at a terminal packet.
  if (s.criticalPath && isTerminal(s.packets[s.criticalPath])) s.criticalPath = null;
  s.eventCount += 1;
  return s;
}
