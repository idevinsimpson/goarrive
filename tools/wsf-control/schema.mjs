/**
 * WSF CONTROL STATE, schema v1: the closed vocabulary of the decision ledger.
 *
 * The ledger records ORCHESTRATION DECISIONS and the GitHub facts they rest on,
 * as pointers only. GitHub stays the authority for facts (PR state, heads,
 * merges, runs, comment text); the ledger stores typed references to them
 * (comment ids, PR numbers, commit SHAs, run ids) and nothing that copies them.
 * Free text is limited to three short fields, and every string is screened for
 * secret- or PII-shaped content before an event is accepted.
 *
 * Contract: docs/westayfit/ops/CONTROL_STATE.md.
 */
import crypto from 'node:crypto';

export const SCHEMA_VERSION = 1;
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
    (exactKeys(b, ['packet', 'until']) && RE.packet.test(b.packet) && ['ACCEPTED', 'INTEGRATED', 'VERIFIED', 'STAGED'].includes(b.until)) ||
    (exactKeys(b, ['external', 'condition', 'owner', 'unblockWhen']) && RE.packet.test(b.external) && [b.condition, b.owner, b.unblockWhen].every((x) => typeof x === 'string' && x.trim() !== ''))),
  evidenceRef: (v) => exactKeys(v, ['kind', 'id']) && ['workflow_run', 'artifact'].includes(v.kind) && Number.isInteger(v.id) && v.id > 0,
  surfaces: (v) => exactKeys(v, ['controlInbox', 'current']) &&
    exactKeys(v.controlInbox, ['pr']) && T.int(v.controlInbox.pr) &&
    exactKeys(v.current, ['pr', 'commentId']) && T.int(v.current.pr) && T.int(v.current.commentId),
  canonical: (v) => exactKeys(v, ['developmentBranch', 'developmentSha', 'operationalMain']) && T.branch(v.developmentBranch) && T.sha(v.developmentSha) && T.sha(v.operationalMain),
  staging: (v) => exactKeys(v, ['servedSha', 'runId', 'runNumber', 'rollbackSha'], ['pinPr']) && T.sha(v.servedSha) && T.int(v.runId) && T.int(v.runNumber) && T.sha(v.rollbackSha) && (v.pinPr === undefined || T.int(v.pinPr)),
  workersMap: (v) => isObj(v) && Object.entries(v).every(([w, x]) => RE.worker.test(w) && exactKeys(x, ['inbox']) && T.int(x.inbox)),
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
const IMPORT_KEYS = ['owner', 'completion', 'phase', 'refs', 'kind', 'label', 'inbox', 'pr', 'reviewers', 'subjectPaths', 'artifact', 'blockedBy', 'phaseBeforeBlock', 'proof', 'releasedBy', 'acceptedBy'];
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
  return out;
}

/** [required fields, optional fields] per event type. */
export const EVENT_FIELDS = Object.freeze({
  'bootstrap': [{ repository: T.repo, asOf: T.instant, surfaces: T.surfaces, workers: T.workersMap, queue: T.queueMap, packets: isObj }, { canonical: T.canonical, staging: T.staging, criticalPath: T.packet }],
  'set-canonical': [{ developmentBranch: T.branch, developmentSha: T.sha, operationalMain: T.sha }, {}],
  'set-staging': [{ servedSha: T.sha, runId: T.int, runNumber: T.int, rollbackSha: T.sha }, { pinPr: T.int }],
  'set-surfaces': [{ surfaces: T.surfaces }, {}],
  'register-worker': [{ worker: T.worker, inbox: T.int }, {}],
  'queue': [{ packet: T.packet, owner: T.worker, completion: T.completion }, { kind: T.kind, subjectPaths: T.paths, label: T.text }],
  'reorder-queue': [{ owner: T.worker, order: T.packets }, {}],
  'release': [{ packet: T.packet, inbox: T.int }, {}],
  'ack': [{ packet: T.packet }, {}],
  'deliver': [{ packet: T.packet, pr: T.int, subjectSha: T.sha }, { prHeadSha: T.sha, evidenceSha: T.sha }],
  'review': [{ packet: T.packet, reviewers: T.reviewers }, {}],
  'finding': [{ packet: T.packet }, {}],
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
});

/**
 * Which kinds of GitHub object may stand behind each event type.
 * Decisions need a human authority comment. Facts may rest on the object that
 * proves them (a PR, a commit, a workflow run). A run result never grants
 * acceptance or release, and a failure becomes a finding only via a comment.
 */
const C = ['comment'];
export const SOURCE_RULES = Object.freeze({
  'bootstrap': C, 'set-canonical': C, 'set-surfaces': C, 'register-worker': C,
  'queue': C, 'reorder-queue': C, 'release': C, 'ack': C, 'deliver': C, 'review': C, 'finding': C, 'accept': C,
  'block': C, 'unblock': C, 'withdraw': C, 'set-critical-path': C, 'proof-fail': C,
  'set-staging': ['workflow_run', 'comment'],
  'integrate': ['pull_request', 'commit'],
  'begin-proof': ['workflow_run', 'comment'],
  'proof-pass': ['workflow_run', 'comment'],
  'stage': ['workflow_run', 'comment'],
  'reconcile-head': ['pull_request', 'commit'],
  'record-evidence': ['commit', 'pull_request', 'comment'],
});

const ENVELOPE = ['seq', 'id', 'type', 'actor', 'source', 'prev'];

/**
 * An event's identity: the semantic transition (type and what it applies to)
 * plus its authoritative source. Two events with one identity are the same
 * decision: identical payloads are a retry, different payloads a conflict.
 */
export function eventId(e) {
  const subject = e.packet ?? e.worker ?? e.owner ?? null;
  return sha256(canon({ v: SCHEMA_VERSION, type: e.type, subject, source: { kind: e.source?.kind, id: e.source?.id, repo: e.source?.repo } }));
}
/** Everything an event says, without its position in the ledger. */
export const payloadOf = (e) => canon(Object.fromEntries(Object.entries(e).filter(([k]) => !['seq', 'id', 'prev'].includes(k))));

/** Problems with one event's shape; semantic legality is transitions.mjs's job. */
export function validateEvent(e) {
  const problems = [];
  if (!isObj(e)) return ['an event must be a JSON object'];
  if (!Object.hasOwn(EVENT_FIELDS, e.type)) return [`unknown event type ${JSON.stringify(e.type)}`];
  if (!Number.isInteger(e.seq) || e.seq < 1) problems.push('seq must be a positive integer');
  if (!WRITERS.includes(e.actor)) problems.push(`actor ${JSON.stringify(e.actor)} is not a ledger writer (writers: ${WRITERS.join(', ')}); a worker's comment may be the source, never the writer`);
  if (!validSource(e.source)) problems.push('source must be { kind: comment|pull_request|commit|workflow_run, id, repo }');
  else if (!SOURCE_RULES[e.type].includes(e.source.kind)) problems.push(`${e.type} must rest on a ${SOURCE_RULES[e.type].join(' or ')}, not a ${e.source.kind}`);
  if (typeof e.prev !== 'string' || !RE.hash.test(e.prev)) problems.push('prev must be the sha256 of the previous ledger line');
  if (typeof e.id !== 'string' || !RE.hash.test(e.id)) problems.push('id must be the event identity hash');
  const [required, optional] = EVENT_FIELDS[e.type];
  for (const [k, ok] of Object.entries(required)) if (!Object.hasOwn(e, k) || !ok(e[k])) problems.push(`${e.type}: ${k} is missing or malformed`);
  for (const [k, ok] of Object.entries(optional)) if (Object.hasOwn(e, k) && !ok(e[k])) problems.push(`${e.type}: ${k} is malformed`);
  for (const k of Object.keys(e)) {
    if (!ENVELOPE.includes(k) && !Object.hasOwn(required, k) && !Object.hasOwn(optional, k)) problems.push(`${e.type}: unknown field ${JSON.stringify(k)}`);
  }
  if (e.type === 'bootstrap' && isObj(e.packets)) for (const [id, p] of Object.entries(e.packets)) problems.push(...importedPacketProblems(id, p));
  problems.push(...screen(e));
  return problems;
}
