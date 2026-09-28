/**
 * The legal transitions, applied to a state as a pure function.
 *
 *   bootstrap (line 1 only): the current state, imported as found
 *   QUEUED ─release→ RELEASED ─ack→ ACKED ─deliver→ DELIVERED ─review→ UNDER_REVIEW
 *   RELEASED ─retract-release→ QUEUED (before ACK only; back to its queue position)
 *   ACKED|CHANGES_REQUESTED ─transfer-owner→ RELEASED (to the new owner, who must ACK)
 *   UNDER_REVIEW ─review-pass (per W# reviewer)→ UNDER_REVIEW; ─reassign-review→ UNDER_REVIEW
 *   DELIVERED|UNDER_REVIEW ─finding→ CHANGES_REQUESTED ─deliver→ DELIVERED
 *   DELIVERED|UNDER_REVIEW ─accept→ ACCEPTED ─integrate→ INTEGRATED
 *   INTEGRATED ─begin-proof→ VERIFYING ─proof-pass→ VERIFIED
 *                           VERIFYING ─proof-fail→ CHANGES_REQUESTED (a successor deliver follows)
 *   VERIFYING ─stage (hosted, same run)→ VERIFYING with a served receipt ─proof-pass→ STAGED
 *   any non-terminal ─block→ BLOCKED ─unblock→ (the phase before the block)
 *     A QUEUED packet that is blocked leaves its owner's driving queue (so it is
 *     never presented as NEXT); its position is remembered and unblock restores it.
 *   any non-terminal ─withdraw→ WITHDRAWN
 *
 * A packet is terminal only at the phase its completion contract names
 * (INTEGRATED for source-only, VERIFIED, or STAGED), or when withdrawn.
 *
 * Only `deliver` moves artifact.subjectSha (the thing a phase applies to).
 * `reconcile-head` records a reconciled GitHub PR head and `record-evidence` an
 * evidence/doc head; neither moves the subject, so evidence practice on a PR
 * never silently re-points a review or an acceptance.
 *
 * Schema v2 (a ledger whose bootstrap is v2, or after one schema-upgrade line):
 *   packets carry a review policy (queue/bootstrap, default DEFAULT_REVIEW for work),
 *   a delivery count and a pending finding;
 *   accept honours the policy: a required W# review is never skipped by a direct accept;
 *   finding{pending} records a valid finding without moving the ball; apply-finding moves it
 *   once the owner holds no other ball (R-PREEMPT, memo §8);
 *   block may wait on DELIVERED-SUCCESSOR: the dependency's next delivery after the block;
 *   set-contracts pins the contract versions that govern every later line;
 *   set-shadow-surface records the writer's shadow CURRENT comment.
 * A line whose schema is not the ledger's (outside the one upgrade line) is illegal.
 */
import { DEFAULT_REVIEW, DELIVERED_SUCCESSOR, GENESIS, RE, SCHEMA_VERSION, isTerminal, schemaOf, unreachableBlocker } from './schema.mjs';

export class Illegal extends Error {}
const illegal = (m) => { throw new Illegal(m); };

const sortContracts = (cs) => clone(cs).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    repository: null,
    asOf: null,
    ledgerHead: GENESIS,
    eventCount: 0,
    surfaces: null,
    canonical: null,
    staging: null,
    criticalPath: null,
    workers: {},
    queue: {},
    packets: {},
  };
}

const clone = (x) => JSON.parse(JSON.stringify(x));
/** The compact form of a source kept in state: the repository is the state's own. */
export const ref = (source) => ({ kind: source.kind, id: source.id });
const need = (s, id) => s.packets[id] || illegal(`packet ${id} does not exist`);
function from(p, allowed, type) {
  if (!allowed.includes(p.phase)) illegal(`${type} is not legal from ${p.phase} (legal from ${allowed.join(', ')})`);
}
function live(p, type) {
  if (isTerminal(p)) illegal(`${type}: packet is terminal (${p.phase})`);
}

function newPacket({ owner, kind = 'work', completion, label = null, subjectPaths = ['*'], review }, origin, v = 1) {
  const p = {
    owner, kind, completion: clone(completion), label, origin,
    phase: 'QUEUED', phaseBeforeBlock: null, queueIndexBeforeBlock: null, inbox: null, pr: null, reviewers: [],
    artifact: { subjectSha: null, prHeadSha: null, evidenceSha: null, mergeSha: null },
    proof: null, served: null, releasedQueueIndex: null, reviewedBy: [],
    subjectPaths, blockedBy: [], importRefs: [],
    authority: { queued: null, released: null, accepted: null, lastTransition: null },
  };
  // v2: the review policy is genesis metadata (fail-closed default for work), and a delivery count feeds DELIVERED-SUCCESSOR.
  if (v === 2) Object.assign(p, { review: review ? clone(review) : (kind === 'work' ? clone(DEFAULT_REVIEW) : null), deliveries: 0, pendingFinding: null });
  return p;
}
const v2Fields = (p) => Object.assign(p, { review: p.review ?? null, deliveries: p.deliveries ?? 0, pendingFinding: p.pendingFinding ?? null });
/** The W# passes a v2 policy requires before acceptance (0 when there is no policy). */
export const requiredPasses = (p) => (p.review ? p.review.workerReviews.reduce((n, r) => n + r.count, 0) : 0);
/** A DELIVERED-SUCCESSOR blocker as stored: it remembers the dependency's delivery count at the block. */
function storeBlockers(s, blockers) {
  return clone(blockers).map((b) => (b.until === DELIVERED_SUCCESSOR ? { ...b, since: s.packets[b.packet].deliveries ?? 0 } : b));
}

const AFTER_DELIVERY = ['DELIVERED', 'UNDER_REVIEW', 'ACCEPTED', 'INTEGRATED', 'VERIFYING', 'VERIFIED', 'STAGED'];
const AFTER_MERGE = ['INTEGRATED', 'VERIFYING', 'VERIFIED', 'STAGED'];

/** Import one packet's CURRENT phase from a bootstrap, with the refs that support it. */
function importPacket(s, id, x, source) {
  if (!s.workers[x.owner]) illegal(`bootstrap: packet ${id}: owner ${x.owner} is not among the bootstrap workers`);
  const p = newPacket(x, 'bootstrap', s.schemaVersion);
  const phase = x.phase === 'BLOCKED' ? x.phaseBeforeBlock : x.phase;
  if (x.phase === 'BLOCKED') {
    if (!x.phaseBeforeBlock || !x.blockedBy || ['BLOCKED', 'WITHDRAWN'].includes(x.phaseBeforeBlock)) illegal(`bootstrap: packet ${id}: a blocked packet needs blockedBy and the non-terminal phase it interrupted`);
  } else if (x.phaseBeforeBlock || x.blockedBy) illegal(`bootstrap: packet ${id}: only a BLOCKED packet carries blockedBy/phaseBeforeBlock`);
  if (x.phase !== 'QUEUED' && x.refs.length === 0) illegal(`bootstrap: packet ${id}: an imported ${x.phase} packet needs the GitHub refs that support its current phase`);
  if (AFTER_DELIVERY.includes(phase) && (!x.pr || !x.artifact?.subjectSha)) illegal(`bootstrap: packet ${id}: ${phase} needs its pr and artifact.subjectSha`);
  if (phase === 'ACCEPTED' && !x.acceptedBy) illegal(`bootstrap: packet ${id}: ACCEPTED needs acceptedBy (the acceptance comment)`);
  if (AFTER_MERGE.includes(phase) && !x.artifact?.mergeSha) illegal(`bootstrap: packet ${id}: ${phase} needs artifact.mergeSha`);
  if (phase === 'VERIFYING' && x.proof?.result !== 'RUNNING') illegal(`bootstrap: packet ${id}: VERIFYING needs a RUNNING proof`);
  const t = x.completion.terminal;
  if (['VERIFYING', 'VERIFIED'].includes(phase) && t === 'INTEGRATED') illegal(`bootstrap: packet ${id}: a source-only packet is never ${phase}`);
  if (phase === 'VERIFIED' && t !== 'VERIFIED') illegal(`bootstrap: packet ${id}: VERIFIED does not match its completion contract (${t})`);
  if (phase === 'STAGED' && t !== 'STAGED') illegal(`bootstrap: packet ${id}: STAGED does not match its completion contract (${t})`);
  Object.assign(p, {
    phase: x.phase,
    phaseBeforeBlock: x.phaseBeforeBlock ?? null,
    inbox: x.phase === 'QUEUED' ? null : (x.inbox ?? s.workers[x.owner].inbox),
    pr: x.pr ?? null,
    reviewers: x.reviewers ?? [],
    proof: x.proof ? clone(x.proof) : null,
    blockedBy: x.blockedBy ? clone(x.blockedBy) : [],
    importRefs: x.refs.map(ref),
  });
  if (s.schemaVersion === 1 && x.blockedBy?.some((b) => b.until === DELIVERED_SUCCESSOR)) illegal(`bootstrap: packet ${id}: ${DELIVERED_SUCCESSOR} is a schema v2 milestone`);
  Object.assign(p.artifact, x.artifact ?? {});
  if (p.artifact.subjectSha && !p.artifact.prHeadSha) p.artifact.prHeadSha = p.artifact.subjectSha;
  p.authority = {
    queued: null,
    released: x.releasedBy ? { kind: 'comment', id: x.releasedBy } : null,
    accepted: x.acceptedBy ? { kind: 'comment', id: x.acceptedBy } : null,
    lastTransition: ref(source),
  };
  s.packets[id] = p;
}

function bootstrap(s, e) {
  s.repository = e.repository;
  s.asOf = e.asOf;
  s.surfaces = clone(e.surfaces);
  s.canonical = e.canonical ? clone(e.canonical) : null;
  s.staging = e.staging ? { pinPr: null, ...clone(e.staging) } : null;
  // Only a recovery bootstrap carries it, so every other state serializes byte for byte as before.
  if (e.supersedes) s.supersedes = clone(e.supersedes);
  for (const [w, x] of Object.entries(e.workers)) { s.workers[w] = x.classes ? { inbox: x.inbox, classes: [...x.classes] } : { inbox: x.inbox }; s.queue[w] = []; }
  for (const [id, x] of Object.entries(e.packets)) importPacket(s, id, x, e.source);
  for (const [w, q] of Object.entries(e.queue)) {
    if (!s.workers[w]) illegal(`bootstrap: queue for ${w}, which is not among the bootstrap workers`);
    s.queue[w] = [...q];
  }
  for (const [id, p] of Object.entries(s.packets)) {
    for (const b of p.blockedBy.filter((x) => x.packet)) {
      if (!s.packets[b.packet]) illegal(`bootstrap: packet ${id} is blocked by ${b.packet}, which is not imported`);
      const why = unreachableBlocker(s, id, b);
      if (why) illegal(`bootstrap: packet ${id}: ${why}`);
      if (s.packets[b.packet].phase === 'WITHDRAWN') illegal(`bootstrap: packet ${id}: ${b.packet} is withdrawn, so it never reaches ${b.until}`);
    }
    if (s.schemaVersion === 2) p.blockedBy = storeBlockers(s, p.blockedBy);
  }
  if (e.criticalPath) setCriticalPath(s, need(s, e.criticalPath));
}

function setCriticalPath(s, p) {
  live(p, 'set-critical-path');
  if (p.kind !== 'work') illegal('set-critical-path: a reference packet cannot be the critical path');
  s.criticalPath = Object.keys(s.packets).find((k) => s.packets[k] === p);
}

/** Apply one (already schema-valid) event; returns a new state or throws Illegal. */
export function applyEvent(state, e) {
  const s = clone(state);
  const v = schemaOf(e);
  if (e.type === 'bootstrap') {
    if (s.eventCount !== 0) illegal('bootstrap is legal only as the first ledger line');
    if (e.source.repo !== e.repository) illegal('bootstrap: the source must be in the bootstrapped repository');
    // The ledger's schema is its bootstrap's. A v2 ledger starts with a v2 bootstrap; nothing ever downgrades.
    s.schemaVersion = v;
    if (v === 2) s.contracts = e.contracts ? sortContracts(e.contracts) : null;
  } else if (e.type === 'schema-upgrade') {
    if (s.eventCount === 0) illegal('the first ledger line must be the bootstrap');
    if (s.schemaVersion !== 1) illegal(`schema-upgrade: the ledger is already schema ${s.schemaVersion}`);
  } else if (v !== s.schemaVersion) {
    illegal(`a schema ${v} line in a schema ${s.schemaVersion} ledger: versions change only across one schema-upgrade line`);
  }
  if (e.type !== 'bootstrap') {
    if (s.eventCount === 0) illegal('the first ledger line must be the bootstrap');
    if (e.source.repo !== s.repository) illegal(`source repository ${e.source.repo} is not the controlled repository ${s.repository}`);
  }
  const p = e.packet && e.type !== 'queue' ? need(s, e.packet) : null;
  const src = ref(e.source);
  switch (e.type) {
    case 'bootstrap': bootstrap(s, e); break;
    case 'schema-upgrade':
      // Earlier lines stay v1 byte for byte; from here every line is v2 and every packet carries the v2 fields.
      s.schemaVersion = 2;
      s.contracts = null;
      for (const q of Object.values(s.packets)) v2Fields(q);
      break;
    case 'set-contracts': s.contracts = sortContracts(e.contracts); break;
    case 'set-shadow-surface':
      if (!s.surfaces) illegal('set-shadow-surface: the ledger records no surfaces');
      if (e.pr !== s.surfaces.current.pr) illegal(`set-shadow-surface: the shadow CURRENT lives on the control surface #${s.surfaces.current.pr}, not #${e.pr}`);
      if (e.commentId === s.surfaces.current.commentId) illegal('set-shadow-surface: the shadow CURRENT is never the human CURRENT comment');
      s.surfaces.shadow = { pr: e.pr, commentId: e.commentId };
      break;
    case 'set-review-policy':
      live(p, 'set-review-policy');
      if (p.kind !== 'work') illegal('set-review-policy: a reference packet is never reviewed');
      if (['ACCEPTED', 'INTEGRATED', 'VERIFYING'].includes(p.phase)) illegal(`set-review-policy: ${e.packet} is already ${p.phase}; its review policy is spent`);
      p.review = clone(e.review);
      break;
    case 'apply-finding':
      // R-PREEMPT: the recorded pending finding moves the ball once the owner holds no other one (check.mjs one-ball).
      from(p, ['DELIVERED', 'UNDER_REVIEW'], 'apply-finding');
      if (!p.pendingFinding) illegal(`apply-finding: ${e.packet} has no pending finding`);
      p.phase = 'CHANGES_REQUESTED';
      p.reviewedBy = [];
      p.pendingFinding = null;
      break;
    case 'set-canonical':
      s.canonical = { developmentBranch: e.developmentBranch, developmentSha: e.developmentSha, operationalMain: e.operationalMain };
      break;
    case 'set-staging':
      s.staging = { servedSha: e.servedSha, runId: e.runId, runNumber: e.runNumber, rollbackSha: e.rollbackSha, pinPr: e.pinPr ?? null };
      break;
    case 'set-surfaces': s.surfaces = clone(e.surfaces); break;
    case 'register-worker':
      if (s.workers[e.worker]) illegal(`worker ${e.worker} is already registered`);
      s.workers[e.worker] = e.classes ? { inbox: e.inbox, classes: [...e.classes] } : { inbox: e.inbox };
      s.queue[e.worker] = [];
      break;
    case 'queue': {
      if (s.packets[e.packet]) illegal(`packet ${e.packet} already exists (${s.packets[e.packet].phase}); a released or finished packet cannot be queued again`);
      if (!s.workers[e.owner]) illegal(`worker ${e.owner} is not registered`);
      const q = newPacket(e, 'ledger', s.schemaVersion);
      q.authority.queued = src;
      q.authority.lastTransition = src;
      s.packets[e.packet] = q;
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
      p.authority.released = src;
      p.releasedQueueIndex = s.queue[p.owner].indexOf(e.packet); // for a retraction before ACK
      s.queue[p.owner] = s.queue[p.owner].filter((x) => x !== e.packet);
      break;
    }
    case 'retract-release': {
      // A newer authorized hold before the worker ACKs: back to NEXT. The release stays in the ledger as history.
      from(p, ['RELEASED'], 'retract-release');
      if (p.releasedQueueIndex === null) illegal('retract-release applies only to a packet released from its queue (a transferred packet is not)');
      const q = s.queue[p.owner];
      q.splice(Math.min(p.releasedQueueIndex, q.length), 0, e.packet);
      p.phase = 'QUEUED';
      p.inbox = null;
      p.authority.released = null;
      p.releasedQueueIndex = null;
      break;
    }
    case 'ack':
      from(p, ['RELEASED'], 'ack');
      if (e.worker !== p.owner) illegal(`ack names ${e.worker}, but ${e.packet} is owned by ${p.owner}`);
      p.phase = 'ACKED';
      p.releasedQueueIndex = null;
      break;
    case 'transfer-owner': {
      // Worker death after work began: the packet, its artifact and history stay; the new owner must ACK afresh.
      from(p, ['ACKED', 'CHANGES_REQUESTED'], 'transfer-owner');
      if (e.owner === p.owner) illegal(`transfer-owner: ${e.packet} is already owned by ${e.owner}`);
      if (!s.workers[e.owner]) illegal(`transfer-owner: worker ${e.owner} is not registered`);
      if (e.inbox !== s.workers[e.owner].inbox) illegal(`transfer-owner must hand off in ${e.owner}'s canonical inbox #${s.workers[e.owner].inbox}, not #${e.inbox}`);
      p.owner = e.owner;
      p.inbox = e.inbox;
      p.phase = 'RELEASED';
      p.authority.released = src;
      p.releasedQueueIndex = null;
      break;
    }
    case 'deliver': {
      from(p, ['RELEASED', 'ACKED', 'CHANGES_REQUESTED', 'DELIVERED', 'UNDER_REVIEW'], 'deliver');
      // A correction after a failed post-integration proof lands on a new PR: the old one is merged.
      const afterProofFail = p.phase === 'CHANGES_REQUESTED' && p.proof?.result === 'FAIL';
      if (p.pr !== null && p.pr !== e.pr && !afterProofFail) illegal(`deliver names PR #${e.pr}, but this packet is delivered on #${p.pr}`);
      if (afterProofFail && e.pr !== p.pr) p.artifact.mergeSha = null;
      p.phase = 'DELIVERED';
      p.pr = e.pr;
      p.artifact.subjectSha = e.subjectSha;
      p.artifact.prHeadSha = e.prHeadSha ?? e.subjectSha;
      if (e.evidenceSha) p.artifact.evidenceSha = e.evidenceSha;
      if (s.schemaVersion === 2) {
        if (p.pendingFinding) illegal(`deliver: ${e.packet} has a pending finding; apply-finding hands it back first`);
        p.deliveries += 1;
      }
      break;
    }
    case 'review': {
      from(p, ['DELIVERED'], 'review');
      if (p.review) {
        // A W# reviewer that declares classes must hold one the policy requires (memo §7). Undeclared: eligible, as in v1.
        const need = p.review.workerReviews.map((r) => r.class);
        for (const r of e.reviewers.filter((x) => RE.worker.test(x))) {
          const has = s.workers[r]?.classes;
          if (has && !has.some((c) => need.includes(c))) illegal(`review: ${r} holds ${has.join(', ')}, none of the classes ${e.packet}'s policy requires (${need.join(', ') || 'none'})`);
        }
      }
      p.phase = 'UNDER_REVIEW'; p.reviewers = [...e.reviewers]; p.reviewedBy = [];
      break;
    }
    case 'review-pass':
      // An assigned W# reviewer's independent PASS: its ball is released. Not acceptance.
      from(p, ['UNDER_REVIEW'], 'review-pass');
      if (!p.reviewers.includes(e.reviewer)) illegal(`review-pass: ${e.reviewer} is not an assigned reviewer of ${e.packet}`);
      if (p.reviewedBy.includes(e.reviewer)) illegal(`review-pass: ${e.reviewer} has already passed ${e.packet} in this review cycle`);
      p.reviewedBy = [...p.reviewedBy, e.reviewer];
      break;
    case 'reassign-review':
      // A reviewer died, retired or must be replaced: the new set replaces the old; the original review stays history.
      from(p, ['UNDER_REVIEW'], 'reassign-review');
      p.reviewers = [...e.reviewers];
      p.reviewedBy = p.reviewedBy.filter((r) => e.reviewers.includes(r));
      break;
    case 'finding':
      from(p, ['DELIVERED', 'UNDER_REVIEW'], 'finding');
      if (s.schemaVersion === 2 && p.pendingFinding) illegal(`finding: ${e.packet} already has a pending finding; apply-finding hands it back`);
      if (e.pending) { p.pendingFinding = src; break; } // recorded, the ball does not move yet (R-PREEMPT)
      p.phase = 'CHANGES_REQUESTED'; p.reviewedBy = [];
      break;
    case 'accept': {
      from(p, ['DELIVERED', 'UNDER_REVIEW'], 'accept');
      if (e.subjectSha !== p.artifact.subjectSha) illegal(`accept names ${e.subjectSha.slice(0, 8)}, but the subject under review is ${String(p.artifact.subjectSha).slice(0, 8)}`);
      const pending = p.phase === 'UNDER_REVIEW' ? p.reviewers.filter((r) => RE.worker.test(r) && !p.reviewedBy.includes(r)) : [];
      if (pending.length) illegal(`accept: assigned W# review(s) not complete: ${pending.join(', ')}`);
      if (s.schemaVersion === 2) {
        // A required worker review is never skipped by a direct acceptance (memo §7).
        const need = requiredPasses(p);
        const got = p.phase === 'UNDER_REVIEW' ? p.reviewedBy.filter((r) => RE.worker.test(r)).length : 0;
        if (got < need) illegal(`accept: ${e.packet}'s review policy requires ${need} W# pass(es); ${got} recorded`);
        if (p.pendingFinding) illegal(`accept: ${e.packet} has a pending finding`);
      }
      p.phase = 'ACCEPTED';
      p.authority.accepted = src;
      break;
    }
    case 'integrate':
      from(p, ['ACCEPTED'], 'integrate');
      if (p.authority.accepted?.kind !== 'comment' || p.authority.accepted.id !== e.acceptance) {
        illegal(`integrate must carry the acceptance that authorized it (comment ${p.authority.accepted?.id ?? 'none'}), not ${e.acceptance}`);
      }
      p.phase = 'INTEGRATED';
      p.artifact.mergeSha = e.mergeSha;
      break;
    case 'begin-proof':
      from(p, ['INTEGRATED', 'VERIFYING'], 'begin-proof');
      live(p, 'begin-proof');
      if (e.proofType !== p.completion.proofType) illegal(`begin-proof: this packet's completion contract needs a ${p.completion.proofType} proof, not ${e.proofType}`);
      if (e.source.kind === 'workflow_run' && e.source.id !== e.runId) illegal('begin-proof: the source run is not the named run');
      p.phase = 'VERIFYING';
      p.proof = { type: e.proofType, runId: e.runId, result: 'RUNNING' };
      break;
    case 'proof-pass':
      from(p, ['VERIFYING'], 'proof-pass');
      if (e.runId !== p.proof.runId) illegal(`proof-pass names run ${e.runId}, but the proof in progress is run ${p.proof.runId}`);
      if (e.source.kind === 'workflow_run' && e.source.id !== e.runId) illegal('proof-pass: the source run is not the named run');
      // A STAGED packet completes on HOSTED VERIFIED, which needs the DEPLOYMENT RECEIPT of the same run first.
      if (p.completion.terminal === 'STAGED' && p.served?.runId !== e.runId) illegal(`proof-pass: a STAGED packet needs the served receipt of run ${e.runId} (stage) before hosted verification completes it`);
      p.phase = p.completion.terminal;
      p.proof = { ...p.proof, result: 'PASS', ...(e.evidenceRef ? { evidenceRef: e.evidenceRef } : {}) };
      break;
    case 'proof-fail':
      from(p, ['VERIFYING'], 'proof-fail');
      if (e.runId !== p.proof.runId) illegal(`proof-fail names run ${e.runId}, but the proof in progress is run ${p.proof.runId}`);
      p.phase = 'CHANGES_REQUESTED';
      p.reviewedBy = []; // the ball is back with the owner; a correction needs a fresh review cycle
      p.proof = { ...p.proof, result: 'FAIL', ...(e.evidenceRef ? { evidenceRef: e.evidenceRef } : {}) };
      break;
    case 'stage':
      // DEPLOYMENT RECEIPT only: what the run served. It never passes the proof and never completes the packet.
      from(p, ['VERIFYING'], 'stage');
      if (p.completion.terminal !== 'STAGED') illegal(`stage: this packet completes at ${p.completion.terminal}, not STAGED`);
      // Within VERIFYING a STAGED packet's proof is hosted (its only contract proof type) and RUNNING (check.mjs).
      if (e.runId !== p.proof.runId) illegal(`stage names run ${e.runId}, but the hosted proof in progress is run ${p.proof.runId}`);
      if (e.servedSha !== p.artifact.mergeSha) illegal(`stage: served ${e.servedSha.slice(0, 8)} is not this packet's integrated subject ${String(p.artifact.mergeSha).slice(0, 8)}`);
      p.served = { runId: e.runId, servedSha: e.servedSha };
      break;
    case 'block':
      live(p, 'block');
      if (p.phase === 'BLOCKED') illegal('block: the packet is already blocked');
      for (const b of e.blockedBy.filter((x) => x.packet)) {
        const why = unreachableBlocker(s, e.packet, b);
        if (why) illegal(`block: ${why}`);
        if (s.packets[b.packet].phase === 'WITHDRAWN') illegal(`block: ${b.packet} is withdrawn, so it never reaches ${b.until}`);
      }
      if (s.schemaVersion === 1 && e.blockedBy.some((b) => b.until === DELIVERED_SUCCESSOR)) illegal(`block: ${DELIVERED_SUCCESSOR} is a schema v2 milestone`);
      p.phaseBeforeBlock = p.phase;
      if (p.phase === 'QUEUED') {
        // Out of the driving queue while blocked, so it is never presented as NEXT.
        p.queueIndexBeforeBlock = s.queue[p.owner].indexOf(e.packet);
        s.queue[p.owner] = s.queue[p.owner].filter((x) => x !== e.packet);
      }
      p.phase = 'BLOCKED';
      p.blockedBy = s.schemaVersion === 2 ? storeBlockers(s, e.blockedBy) : clone(e.blockedBy);
      break;
    case 'unblock':
      from(p, ['BLOCKED'], 'unblock');
      p.phase = p.phaseBeforeBlock;
      if (p.phase === 'QUEUED') {
        // Back to its original relative position (the end, for an import); the
        // one-NEXT invariant refuses the event if that makes a second NEXT.
        const q = s.queue[p.owner];
        q.splice(Math.min(p.queueIndexBeforeBlock ?? q.length, q.length), 0, e.packet);
      }
      p.phaseBeforeBlock = null;
      p.queueIndexBeforeBlock = null;
      p.blockedBy = [];
      break;
    case 'withdraw':
      live(p, 'withdraw');
      if (p.phase === 'QUEUED') s.queue[p.owner] = s.queue[p.owner].filter((x) => x !== e.packet);
      p.phase = 'WITHDRAWN';
      p.queueIndexBeforeBlock = null;
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
    case 'set-critical-path': setCriticalPath(s, p); break;
    default: illegal(`no transition for ${e.type}`);
  }
  if (p && !['reconcile-head', 'record-evidence', 'set-critical-path', 'set-review-policy'].includes(e.type) && !(e.type === 'finding' && e.pending)) p.authority.lastTransition = src;
  // The critical path completes when its packet does; it is never left pointing at a terminal packet.
  if (s.criticalPath && isTerminal(s.packets[s.criticalPath])) s.criticalPath = null;
  s.eventCount += 1;
  return s;
}
