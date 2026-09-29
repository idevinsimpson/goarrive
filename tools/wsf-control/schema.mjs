/**
 * WSF CONTROL STATE, schemas v1 and v2: the closed vocabulary of the decision ledger.
 *
 * The ledger records ORCHESTRATION DECISIONS and the GitHub facts they rest on,
 * as pointers only. GitHub stays the authority for facts (PR state, heads,
 * merges, runs, comment text); the ledger stores typed references to them
 * (comment ids, PR numbers, commit SHAs, run ids) and nothing that copies them.
 * Free text is limited to three short fields, and every string is screened for
 * secret- or PII-shaped content before an event is accepted.
 *
 * Schema v2 (AUTONOMY-STATE-1B; accepted A+ memo §3.1, §7, §10.1) adds, on the
 * same ledger format:
 *  - one writer, the wsf-control-writer GitHub App: every v2 line's actor is
 *    WRITER_APP, and its `authority` block says honestly what the line rests on
 *    (derived / attested / protected-human / manual), under which named rule
 *    (rules.mjs), with typed evidence refs. A machine-derived transition never
 *    wears a human comment as its costume;
 *  - a packet's review policy, set at genesis (queue) and changed only by a
 *    recorded decision (set-review-policy);
 *  - contract-version pins (set-contracts), so every later line names the
 *    contract versions that governed it;
 *  - the DELIVERED-SUCCESSOR blocker milestone and pending findings
 *    (finding pending:true, then apply-finding), the R-PREEMPT recovery;
 *  - a shadow CURRENT surface, kept apart from the human CURRENT comment.
 * An event names its schema in the envelope (`schema`, absent = 1). A ledger
 * never mixes versions except across one schema-upgrade line, and a version
 * this code does not know fails closed.
 *
 * Contract: docs/westayfit/ops/CONTROL_STATE.md.
 */
import crypto from 'node:crypto';
import { authorityProblems } from './rules.mjs';

export const SCHEMA_VERSION = 1;
/** The ledger schemas this code can read. Anything else fails closed: an older reader never guesses at a newer shape. */
export const KNOWN_SCHEMAS = Object.freeze([1, 2]);
export const LATEST_SCHEMA = 2;
/** An event's schema: the envelope's `schema`, or 1 when absent (every 1A line). */
export const schemaOf = (e) => (e && Object.hasOwn(e, 'schema') ? e.schema : 1);
/** The only v2 ledger writer: the GitHub App whose installation token alone may update wsf-control-state* (ruleset 24078545). */
export const WRITER_APP = 'wsf-control-writer';
/** A v2 line's provenance class (memo §3.1). */
export const AUTHORITY_CLASSES = Object.freeze(['derived', 'attested', 'protected-human', 'manual']);
/** Reviewer classes a registered worker may carry and a review policy may require (memo §7). */
export const REVIEW_CLASSES = Object.freeze(['journey-qa', 'ops-source', 'security', 'docs-authority']);
/** Who accepts once the required worker reviews have passed (memo §7). */
export const REVIEW_AFTER = Object.freeze(['director', 'owner', 'auto-advance-technical']);
export const REVIEW_APPLIES = Object.freeze(['subject', 'evidence', 'pin', 'docs']);
/** The fail-closed default for an imported packet with no policy: one ops-source review, then the Director (memo §7). */
export const DEFAULT_REVIEW = Object.freeze({ workerReviews: [{ class: 'ops-source', count: 1 }], appliesTo: 'subject', after: 'director' });
/** The v2-only blocker milestone: the dependency's next delivery after the block (memo §8, R-PREEMPT). */
export const DELIVERED_SUCCESSOR = 'DELIVERED-SUCCESSOR';
export const GENESIS = '0'.repeat(64);

export const PHASES = Object.freeze([
  'QUEUED', 'RELEASED', 'ACKED', 'DELIVERED', 'UNDER_REVIEW', 'CHANGES_REQUESTED',
  'ACCEPTED', 'INTEGRATED', 'VERIFYING', 'VERIFIED', 'STAGED', 'BLOCKED', 'WITHDRAWN',
]);
/** The worker holds the ball. */
export const WORKER_OWNED = Object.freeze(['RELEASED', 'ACKED', 'CHANGES_REQUESTED']);
/** A reviewer holds the ball; the worker is waiting on a near-term review event. */
export const REVIEWER_OWNED = Object.freeze(['DELIVERED', 'UNDER_REVIEW']);
export const KINDS = Object.freeze(['work', 'reference']);
/** The only identities that may write the ledger. Workers own packets and author source comments; they never write. */
export const WRITERS = Object.freeze(['Fable', 'L0']);
export const SOURCE_KINDS = Object.freeze(['comment', 'pull_request', 'commit', 'workflow_run']);
export const PROOF_TYPES = Object.freeze(['journey-activation', 'hosted', 'source-only']);
/**
 * A packet's completion contract: the phase it finishes in, and the proof it needs.
 * A packet is never inferred complete from what it is not (for example "not staged").
 */
export const COMPLETIONS = Object.freeze({
  INTEGRATED: ['source-only'],
  VERIFIED: ['journey-activation', 'hosted'],
  STAGED: ['hosted'],
});

/**
 * The milestones a packet blocker may wait for, by the dependency's completion contract.
 * A terminal STAGED packet has passed its hosted proof, so it also satisfies VERIFIED. A
 * VERIFIED packet is never staged, and an INTEGRATED one is never proved: waiting on either
 * would never clear.
 */
export const REACHABLE_UNTIL = Object.freeze({
  INTEGRATED: ['ACCEPTED', 'INTEGRATED'],
  VERIFIED: ['ACCEPTED', 'INTEGRATED', 'VERIFIED'],
  STAGED: ['ACCEPTED', 'INTEGRATED', 'VERIFIED', 'STAGED'],
});
/** Why a packet blocker can never clear, or null when it can. */
export function unreachableBlocker(s, id, b) {
  const dep = s.packets[b.packet];
  if (!dep) return `blocking packet ${b.packet} does not exist`;
  if (b.packet === id) return `${id} cannot be blocked by itself`;
  if (b.until === DELIVERED_SUCCESSOR) return dep.kind === 'work' ? null : `${b.packet} is a reference packet and is never delivered`;
  if (!REACHABLE_UNTIL[dep.completion.terminal].includes(b.until)) return `${b.packet} completes at ${dep.completion.terminal}, so it never reaches ${b.until}`;
  return null;
}

/** Terminal: withdrawn, or at the phase its own completion contract names. */
export function isTerminal(packet) {
  return packet.phase === 'WITHDRAWN' || packet.phase === packet.completion.terminal;
}

export const RE = Object.freeze({
  sha: /^[0-9a-f]{40}$/,
  hash: /^[0-9a-f]{64}$/,
  packet: /^[A-Z0-9][A-Z0-9-]{1,80}$/,
  worker: /^W[1-9][0-9]?$/,
  branch: /^[A-Za-z0-9._/-]{1,120}$/,
  path: /^(\*|[A-Za-z0-9._\-/]{1,160})$/,
  repo: /^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/,
  instant: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
  rule: /^(?:[RA]-[A-Z0-9][A-Z0-9-]{1,40}|MANUAL)$/,
  contractId: /^[a-z0-9][a-z0-9.-]{1,60}$/,
});
const FREE_TEXT = new Set(['label', 'condition', 'unblockWhen']);
const FREE_TEXT_MAX = 200;

/**
 * Secret- and PII-shaped content. Mirrors the evidence scanner's rules
 * (.github/wsf-staging/scan-evidence.mjs), plus email addresses and URLs: the
 * ledger has no field in which a person's address or an arbitrary link belongs.
 */
export const FORBIDDEN = Object.freeze([
  { name: 'google-api-key', re: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: 'private-key-block', re: /BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY/ },
  { name: 'google-oauth-access-token', re: /\bya29\.[0-9A-Za-z_-]{10,}/ },
  { name: 'google-oauth-refresh-token', re: /\b1\/\/[0-9A-Za-z_-]{20,}/ },
  { name: 'jwt', re: /\beyJ[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}\.[0-9A-Za-z_-]{10,}/ },
  { name: 'bearer', re: /Bearer\s+\S+/i },
  { name: 'secret-query', re: /[?&](?:oobCode|token|idToken|refreshToken|key|code|apiKey|access_token)=/i },
  { name: 'github-token', re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[0-9A-Za-z_]{20,}/ },
  { name: 'email-address', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { name: 'url', re: /\b[a-z][a-z0-9+.-]*:\/\/\S/i },
]);

/** Every string anywhere in a value, with its key path. */
function* strings(value, at = '') {
  if (typeof value === 'string') yield [at, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* strings(v, `${at}[${i}]`);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* strings(v, at ? `${at}.${k}` : k);
}

/** Problems with secret/PII-shaped or over-long free text anywhere in `value`; never echoes the content. */
export function screen(value) {
  const problems = [];
  for (const [at, s] of strings(value)) {
    for (const rule of FORBIDDEN) if (rule.re.test(s)) problems.push(`${at}: ${rule.name}-shaped content is not allowed (value withheld)`);
    const leaf = at.split('.').pop().replace(/\[\d+\]$/, '');
    if (FREE_TEXT.has(leaf) && s.length > FREE_TEXT_MAX) problems.push(`${at}: free text is limited to ${FREE_TEXT_MAX} characters`);
    if (/[\r\n]/.test(s)) problems.push(`${at}: multi-line text is not allowed`);
  }
  return problems;
}

/** Canonical JSON: object keys sorted at every depth, so equal values have equal text. */
export function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}
export const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (v, req, opt = []) => isObj(v) && req.every((k) => Object.hasOwn(v, k)) && Object.keys(v).every((k) => req.includes(k) || opt.includes(k));

/** Field checks. */
const T = {
  int: (v) => Number.isInteger(v) && v > 0,
  hash: (v) => typeof v === 'string' && RE.hash.test(v),
  sha: (v) => typeof v === 'string' && RE.sha.test(v),
  packet: (v) => typeof v === 'string' && RE.packet.test(v),
  worker: (v) => typeof v === 'string' && RE.worker.test(v),
  branch: (v) => typeof v === 'string' && RE.branch.test(v),
  repo: (v) => typeof v === 'string' && RE.repo.test(v),
  instant: (v) => typeof v === 'string' && RE.instant.test(v) && !Number.isNaN(Date.parse(v)),
  text: (v) => typeof v === 'string' && v.trim() !== '',
  kind: (v) => KINDS.includes(v),
  phase: (v) => PHASES.includes(v),
  proofType: (v) => PROOF_TYPES.includes(v),
  paths: (v) => Array.isArray(v) && v.length > 0 && v.every((p) => typeof p === 'string' && RE.path.test(p)),
  reviewers: (v) => Array.isArray(v) && v.every((w) => typeof w === 'string' && (RE.worker.test(w) || WRITERS.includes(w) || w === 'Director' || w === 'Owner')),
  packets: (v) => Array.isArray(v) && v.every((p) => typeof p === 'string' && RE.packet.test(p)),
  completion: (v) => exactKeys(v, ['terminal', 'proofType']) && Object.hasOwn(COMPLETIONS, v.terminal) && COMPLETIONS[v.terminal].includes(v.proofType),
  blockers: (v) => Array.isArray(v) && v.length > 0 && v.every((b) =>
    (exactKeys(b, ['packet', 'until']) && RE.packet.test(b.packet) && ['ACCEPTED', 'INTEGRATED', 'VERIFIED', 'STAGED', DELIVERED_SUCCESSOR].includes(b.until)) ||
    (exactKeys(b, ['external', 'condition', 'owner', 'unblockWhen']) && RE.packet.test(b.external) && [b.condition, b.owner, b.unblockWhen].every((x) => typeof x === 'string' && x.trim() !== ''))),
  evidenceRef: (v) => exactKeys(v, ['kind', 'id']) && ['workflow_run', 'artifact'].includes(v.kind) && Number.isInteger(v.id) && v.id > 0,
  surfaces: (v) => exactKeys(v, ['controlInbox', 'current'], ['shadow']) &&
    exactKeys(v.controlInbox, ['pr']) && T.int(v.controlInbox.pr) &&
    exactKeys(v.current, ['pr', 'commentId']) && T.int(v.current.pr) && T.int(v.current.commentId) &&
    (v.shadow === undefined || (exactKeys(v.shadow, ['pr', 'commentId']) && T.int(v.shadow.pr) && T.int(v.shadow.commentId))),
  /** A recovery bootstrap names the ledger it supersedes: the old ref, its commit and its ledger head (audit, never replayed). */
  supersedes: (v) => exactKeys(v, ['ref', 'commit', 'ledgerHead']) && typeof v.ref === 'string' && /^wsf-control-state(?:-([2-9]|[1-9][0-9]+))?$/.test(v.ref) && T.sha(v.commit) && typeof v.ledgerHead === 'string' && RE.hash.test(v.ledgerHead),
  canonical: (v) => exactKeys(v, ['developmentBranch', 'developmentSha', 'operationalMain']) && T.branch(v.developmentBranch) && T.sha(v.developmentSha) && T.sha(v.operationalMain),
  staging: (v) => exactKeys(v, ['servedSha', 'runId', 'runNumber', 'rollbackSha'], ['pinPr']) && T.sha(v.servedSha) && T.int(v.runId) && T.int(v.runNumber) && T.sha(v.rollbackSha) && (v.pinPr === undefined || T.int(v.pinPr)),
  workersMap: (v) => isObj(v) && Object.entries(v).every(([w, x]) => RE.worker.test(w) && exactKeys(x, ['inbox'], ['classes']) && T.int(x.inbox) && (x.classes === undefined || T.classes(x.classes))),
  classes: (v) => Array.isArray(v) && v.length > 0 && new Set(v).size === v.length && v.every((c) => REVIEW_CLASSES.includes(c)),
  review: (v) => exactKeys(v, ['workerReviews', 'appliesTo', 'after']) && REVIEW_APPLIES.includes(v.appliesTo) && REVIEW_AFTER.includes(v.after) &&
    Array.isArray(v.workerReviews) && new Set(v.workerReviews.map((r) => r?.class)).size === v.workerReviews.length &&
    v.workerReviews.every((r) => exactKeys(r, ['class', 'count']) && REVIEW_CLASSES.includes(r.class) && Number.isInteger(r.count) && r.count >= 1 && r.count <= 3),
  contracts: (v) => Array.isArray(v) && v.length > 0 && new Set(v.map((c) => c?.id)).size === v.length &&
    v.every((c) => exactKeys(c, ['id', 'path', 'commit']) && RE.contractId.test(c.id) && typeof c.path === 'string' && RE.path.test(c.path) && c.path !== '*' && RE.sha.test(c.commit)),
  bool: (v) => v === true,
  queueMap: (v) => isObj(v) && Object.entries(v).every(([w, q]) => RE.worker.test(w) && T.packets(q)),
};

/** A typed reference to the GitHub object that authorizes or proves an event. No URLs: kind, id and repository. */
export function validSource(s) {
  if (!exactKeys(s, ['kind', 'id', 'repo']) || !SOURCE_KINDS.includes(s.kind) || !T.repo(s.repo)) return false;
  return s.kind === 'commit' ? T.sha(s.id) : T.int(s.id);
}

/**
 * An imported packet in a bootstrap: its CURRENT phase and the GitHub refs
 * that support it. There is deliberately no field for a past transition or a
 * timestamp: a bootstrap records what was found, not a history it never saw.
 */
const IMPORT_KEYS = ['owner', 'completion', 'phase', 'refs', 'kind', 'label', 'inbox', 'pr', 'reviewers', 'subjectPaths', 'artifact', 'blockedBy', 'phaseBeforeBlock', 'proof', 'releasedBy', 'acceptedBy', 'review'];
export function importedPacketProblems(id, p) {
  const out = [];
  if (!RE.packet.test(id)) out.push(`bootstrap: packet id ${JSON.stringify(id)} is malformed`);
  if (!isObj(p)) return [...out, `bootstrap: packet ${id} must be an object`];
  for (const k of Object.keys(p)) if (!IMPORT_KEYS.includes(k)) out.push(`bootstrap: packet ${id}: unknown field ${JSON.stringify(k)} (a bootstrap imports current state only, never history or timestamps)`);
  const chk = (k, ok, req = false) => {
    if (!Object.hasOwn(p, k)) { if (req) out.push(`bootstrap: packet ${id}: ${k} is required`); return; }
    if (!ok(p[k])) out.push(`bootstrap: packet ${id}: ${k} is malformed`);
  };
  chk('owner', T.worker, true);
  chk('completion', T.completion, true);
  chk('phase', T.phase, true);
  chk('refs', (v) => Array.isArray(v) && v.every(validSource), true);
  chk('kind', T.kind);
  chk('label', T.text);
  chk('inbox', T.int);
  chk('pr', T.int);
  chk('reviewers', T.reviewers);
  chk('subjectPaths', T.paths);
  chk('artifact', (v) => isObj(v) && Object.entries(v).every(([k, x]) => ['subjectSha', 'prHeadSha', 'evidenceSha', 'mergeSha'].includes(k) && T.sha(x)));
  chk('blockedBy', T.blockers);
  chk('phaseBeforeBlock', T.phase);
  chk('proof', (v) => exactKeys(v, ['type', 'runId', 'result'], ['evidenceRef']) && T.proofType(v.type) && T.int(v.runId) && ['RUNNING', 'PASS', 'FAIL'].includes(v.result) && (v.evidenceRef === undefined || T.evidenceRef(v.evidenceRef)));
  chk('releasedBy', T.int);
  chk('acceptedBy', T.int);
  chk('review', T.review);
  return out;
}

/** [required fields, optional fields] per event type. */
export const EVENT_FIELDS = Object.freeze({
  'bootstrap': [{ repository: T.repo, asOf: T.instant, surfaces: T.surfaces, workers: T.workersMap, queue: T.queueMap, packets: isObj }, { canonical: T.canonical, staging: T.staging, criticalPath: T.packet, contracts: T.contracts, supersedes: T.supersedes }],
  'set-canonical': [{ developmentBranch: T.branch, developmentSha: T.sha, operationalMain: T.sha }, {}],
  'set-staging': [{ servedSha: T.sha, runId: T.int, runNumber: T.int, rollbackSha: T.sha }, { pinPr: T.int }],
  'set-surfaces': [{ surfaces: T.surfaces }, {}],
  'register-worker': [{ worker: T.worker, inbox: T.int }, { classes: T.classes }],
  'queue': [{ packet: T.packet, owner: T.worker, completion: T.completion }, { kind: T.kind, subjectPaths: T.paths, label: T.text, review: T.review }],
  'reorder-queue': [{ owner: T.worker, order: T.packets }, {}],
  'release': [{ packet: T.packet, inbox: T.int }, {}],
  'ack': [{ packet: T.packet, worker: T.worker }, {}],
  'retract-release': [{ packet: T.packet }, {}],
  'transfer-owner': [{ packet: T.packet, owner: T.worker, inbox: T.int }, {}],
  'deliver': [{ packet: T.packet, pr: T.int, subjectSha: T.sha }, { prHeadSha: T.sha, evidenceSha: T.sha }],
  'review': [{ packet: T.packet, reviewers: T.reviewers }, {}],
  'finding': [{ packet: T.packet }, { pending: T.bool }],
  'review-pass': [{ packet: T.packet, reviewer: T.worker }, {}],
  'reassign-review': [{ packet: T.packet, reviewers: T.reviewers }, {}],
  'accept': [{ packet: T.packet, subjectSha: T.sha }, {}],
  'integrate': [{ packet: T.packet, mergeSha: T.sha, acceptance: T.int }, {}],
  'begin-proof': [{ packet: T.packet, runId: T.int, proofType: T.proofType }, {}],
  'proof-pass': [{ packet: T.packet, runId: T.int }, { evidenceRef: T.evidenceRef }],
  'proof-fail': [{ packet: T.packet, runId: T.int }, { evidenceRef: T.evidenceRef }],
  'stage': [{ packet: T.packet, runId: T.int, servedSha: T.sha }, {}],
  'block': [{ packet: T.packet, blockedBy: T.blockers }, {}],
  'unblock': [{ packet: T.packet }, {}],
  'withdraw': [{ packet: T.packet }, {}],
  'reconcile-head': [{ packet: T.packet, prHeadSha: T.sha }, {}],
  'record-evidence': [{ packet: T.packet, evidenceSha: T.sha }, {}],
  'set-critical-path': [{ packet: T.packet }, {}],
  // v2 only (V2_ONLY below):
  'schema-upgrade': [{ to: (v) => v === LATEST_SCHEMA }, {}],
  'set-contracts': [{ contracts: T.contracts }, {}],
  'set-review-policy': [{ packet: T.packet, review: T.review }, {}],
  'apply-finding': [{ packet: T.packet }, {}],
  'set-shadow-surface': [{ pr: T.int, commentId: T.int }, {}],
  // Wakes (Step 6, memo §6.2): request, App comment posted, worker ACK, one retry, timeout. Identity is the wakeId.
  'wake': [{ wakeId: T.hash, packet: T.packet, worker: T.worker, reason: (v) => WAKE_REASONS.includes(v) }, {}],
  'wake-delivered': [{ wakeId: T.hash, packet: T.packet, commentId: T.int }, {}],
  'wake-ack': [{ wakeId: T.hash, packet: T.packet, worker: T.worker }, {}],
  'wake-retry': [{ wakeId: T.hash, packet: T.packet }, {}],
  'wake-timeout': [{ wakeId: T.hash, packet: T.packet }, {}],
});
/**
 * Who holds a work packet's ball: its owner while the phase is worker-owned (RELEASED, ACKED, CHANGES_REQUESTED),
 * each outstanding W# reviewer while it is UNDER_REVIEW (a recorded pending finding is the verdict: nobody then),
 * nobody otherwise (delivered and unrouted, blocked, done).
 */
export function holders(p) {
  if (p.kind !== 'work') return [];
  if (WORKER_OWNED.includes(p.phase)) return [p.owner];
  if (p.phase === 'UNDER_REVIEW' && !p.pendingFinding) return p.reviewers.filter((x) => /^W[1-9][0-9]?$/.test(x) && !(p.reviewedBy ?? []).includes(x)).sort();
  return [];
}

/** Why a worker is woken: its packet was released to it, handed back to it, or it was assigned a review. */
export const WAKE_REASONS = Object.freeze(['release', 'handback', 'review']);
/** The wake event types; they record delivery truth and never move a packet's ball. */
export const WAKE_EVENTS = Object.freeze(['wake', 'wake-delivered', 'wake-ack', 'wake-retry', 'wake-timeout']);
/** Event types, and fields, that exist only in schema v2. A v1 line carrying one is malformed. */
export const V2_ONLY = Object.freeze(['schema-upgrade', 'set-contracts', 'set-review-policy', 'apply-finding', 'set-shadow-surface', 'wake', 'wake-delivered', 'wake-ack', 'wake-retry', 'wake-timeout']);
const V2_FIELDS = Object.freeze({ bootstrap: ['contracts', 'supersedes'], 'register-worker': ['classes'], queue: ['review'], finding: ['pending'] });

/**
 * Which kinds of GitHub object may stand behind each event type.
 * Decisions need a human authority comment. Facts may rest on the object that
 * proves them (a PR, a commit, a workflow run). A run result never grants
 * acceptance or release, and a failure becomes a finding only via a comment.
 */
const C = ['comment'];
export const SOURCE_RULES = Object.freeze({
  'bootstrap': C, 'set-canonical': C, 'set-surfaces': C, 'register-worker': C,
  'queue': C, 'reorder-queue': C, 'release': C, 'retract-release': C, 'ack': C, 'deliver': C, 'review': C, 'review-pass': C, 'reassign-review': C,
  'finding': C, 'accept': C, 'transfer-owner': C,
  'block': C, 'unblock': C, 'withdraw': C, 'set-critical-path': C,
  'schema-upgrade': C, 'set-contracts': C, 'set-review-policy': C, 'set-shadow-surface': C,
  // A wake rests on whatever set the ball (a release or finding comment, a delivery); its receipts rest on comments.
  'wake': ['comment', 'pull_request', 'commit', 'workflow_run'],
  'wake-delivered': C, 'wake-ack': C, 'wake-retry': C, 'wake-timeout': C,
  // A v2 proof-fail may rest on the failed run itself under the packet's pre-approved failure contract (R-PROOF-FAIL);
  // a v1 proof-fail still needs the focused finding comment (checked in validateEvent).
  'proof-fail': ['comment', 'workflow_run'],
  // A pending finding is applied once the owner's other ball is released: on the finding comment, or on the delivery that released it.
  'apply-finding': ['comment', 'commit', 'pull_request'],
  'set-staging': ['workflow_run', 'comment'],
  'integrate': ['pull_request', 'commit'],
  'begin-proof': ['workflow_run', 'comment'],
  'proof-pass': ['workflow_run', 'comment'],
  'stage': ['workflow_run', 'comment'],
  'reconcile-head': ['pull_request', 'commit'],
  'record-evidence': ['commit', 'pull_request', 'comment'],
});

const ENVELOPE = ['seq', 'id', 'type', 'actor', 'source', 'prev'];
/** v2 envelope additions: the schema marker and the provenance block. */
const ENVELOPE_V2 = ['schema', 'authority'];

/**
 * An event's identity: the semantic transition (type and what it applies to)
 * plus its authoritative source. Two events with one identity are the same
 * decision: identical payloads are a retry, different payloads a conflict.
 */
export function eventId(e) {
  // A wake's identity is its wakeId (memo §6.2): the same ball re-derived is the same wake, so it is never posted twice.
  const subject = e.wakeId ?? e.packet ?? e.worker ?? e.owner ?? null;
  const source = { kind: e.source?.kind, id: e.source?.id, repo: e.source?.repo };
  // v1 identities are unchanged byte for byte. A v2 identity also names the derivation rule, so the same facts
  // re-derived under the same rule are one event (a retry is a no-op), and a different rule is a different event.
  if (schemaOf(e) === 1) return sha256(canon({ v: SCHEMA_VERSION, type: e.type, subject, source }));
  return sha256(canon({ v: schemaOf(e), type: e.type, subject, source, rule: e.authority?.rule ?? null }));
}
/** Everything an event says, without its position in the ledger. */
export const payloadOf = (e) => canon(Object.fromEntries(Object.entries(e).filter(([k]) => !['seq', 'id', 'prev'].includes(k))));

/** Problems with one event's shape; semantic legality is transitions.mjs's job. */
export function validateEvent(e) {
  const problems = [];
  if (!isObj(e)) return ['an event must be a JSON object'];
  // Fail closed on a schema this code does not know, before anything else is read: never guess at a newer shape.
  if (Object.hasOwn(e, 'schema') && e.schema !== LATEST_SCHEMA) {
    return [`unknown schema version ${JSON.stringify(e.schema)}: this reader knows ${KNOWN_SCHEMAS.join(' and ')} (a v1 line carries no schema field); fail closed`];
  }
  const v = schemaOf(e);
  if (!Object.hasOwn(EVENT_FIELDS, e.type)) return [`unknown event type ${JSON.stringify(e.type)}`];
  if (v === 1 && V2_ONLY.includes(e.type)) return [`${e.type} is a schema v2 event; a v1 line cannot carry it`];
  if (!Number.isInteger(e.seq) || e.seq < 1) problems.push('seq must be a positive integer');
  if (v === 1) {
    if (!WRITERS.includes(e.actor)) problems.push(`actor ${JSON.stringify(e.actor)} is not a ledger writer (writers: ${WRITERS.join(', ')}); a worker's comment may be the source, never the writer`);
    if (Object.hasOwn(e, 'authority')) problems.push('authority is a schema v2 field; a v1 line cannot carry it');
    for (const k of V2_FIELDS[e.type] ?? []) if (Object.hasOwn(e, k)) problems.push(`${e.type}: ${k} is a schema v2 field; a v1 line cannot carry it`);
    if ((e.blockedBy ?? []).some?.((b) => b?.until === DELIVERED_SUCCESSOR)) problems.push(`${e.type}: ${DELIVERED_SUCCESSOR} is a schema v2 milestone`);
    if (e.surfaces?.shadow !== undefined) problems.push(`${e.type}: a shadow surface is a schema v2 field`);
    if (e.type === 'bootstrap' && isObj(e.packets) && Object.values(e.packets).some((p) => isObj(p) && Object.hasOwn(p, 'review'))) problems.push('bootstrap: a packet review policy is a schema v2 field');
    if (e.type === 'bootstrap' && isObj(e.workers) && Object.values(e.workers).some((w) => isObj(w) && Object.hasOwn(w, 'classes'))) problems.push('bootstrap: worker review classes are a schema v2 field');
  } else {
    // Only the App writes a v2 ledger; the authority block says what the line rests on, under which named rule.
    if (e.actor !== WRITER_APP) problems.push(`actor ${JSON.stringify(e.actor)} is not the v2 ledger writer (${WRITER_APP}); a person's or worker's decision is recorded by the writer with its authority class, never self-written`);
    problems.push(...authorityProblems(e.type, e.authority, { refOk: (r) => exactKeys(r, ['kind', 'id']) && [...SOURCE_KINDS, 'artifact'].includes(r.kind) && (r.kind === 'commit' ? T.sha(r.id) : T.int(r.id)) }));
  }
  if (!validSource(e.source)) problems.push('source must be { kind: comment|pull_request|commit|workflow_run, id, repo }');
  // A v2 MANUAL line is a recorded Director/L0 decision: it rests on the decision comment itself, whatever its type.
  else if (!SOURCE_RULES[e.type].includes(e.source.kind) && !(v === 2 && e.authority?.rule === 'MANUAL' && e.source.kind === 'comment')) problems.push(`${e.type} must rest on a ${SOURCE_RULES[e.type].join(' or ')}, not a ${e.source.kind}`);
  else if (e.type === 'proof-fail' && e.source.kind === 'workflow_run' && v === 1) problems.push('proof-fail must rest on a comment, not a workflow_run');
  else if (e.type === 'proof-fail' && e.source.kind === 'workflow_run' && e.authority?.rule !== 'R-PROOF-FAIL') problems.push('a v2 proof-fail rests on the focused finding comment, or on the failed run only under R-PROOF-FAIL');
  if (typeof e.prev !== 'string' || !RE.hash.test(e.prev)) problems.push('prev must be the sha256 of the previous ledger line');
  if (typeof e.id !== 'string' || !RE.hash.test(e.id)) problems.push('id must be the event identity hash');
  const [required, optional] = EVENT_FIELDS[e.type];
  for (const [k, ok] of Object.entries(required)) if (!Object.hasOwn(e, k) || !ok(e[k])) problems.push(`${e.type}: ${k} is missing or malformed`);
  for (const [k, ok] of Object.entries(optional)) if (Object.hasOwn(e, k) && !ok(e[k])) problems.push(`${e.type}: ${k} is malformed`);
  for (const k of Object.keys(e)) {
    if (!ENVELOPE.includes(k) && !(v === 2 && ENVELOPE_V2.includes(k)) && !Object.hasOwn(required, k) && !Object.hasOwn(optional, k)) problems.push(`${e.type}: unknown field ${JSON.stringify(k)}`);
  }
  if (e.type === 'bootstrap' && isObj(e.packets)) for (const [id, p] of Object.entries(e.packets)) problems.push(...importedPacketProblems(id, p));
  problems.push(...screen(e));
  return problems;
}
