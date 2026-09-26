/**
 * WSF CONTROL STATE, schema v1: the closed vocabulary of the decision ledger.
 *
 * The ledger records ORCHESTRATION DECISIONS ONLY. GitHub stays the authority
 * for facts (PR state, heads, merges, CI, comment text); the ledger stores
 * pointers to them (numbers, SHAs, comment ids) and nothing that copies them.
 * Free text is limited to three short fields, and every string is screened for
 * secret- or PII-shaped content before an event is accepted.
 *
 * Contract: docs/westayfit/ops/CONTROL_STATE.md.
 */

export const SCHEMA_VERSION = 1;
export const GENESIS = '0'.repeat(64);

export const PHASES = Object.freeze([
  'QUEUED', 'RELEASED', 'ACKED', 'DELIVERED', 'UNDER_REVIEW', 'CHANGES_REQUESTED',
  'ACCEPTED', 'INTEGRATED', 'STAGED', 'BLOCKED', 'WITHDRAWN',
]);
/** The worker holds the ball. */
export const WORKER_OWNED = Object.freeze(['RELEASED', 'ACKED', 'CHANGES_REQUESTED']);
/** A reviewer holds the ball; the worker is waiting on a near-term review event. */
export const REVIEWER_OWNED = Object.freeze(['DELIVERED', 'UNDER_REVIEW']);
export const TRACKS = Object.freeze(['product', 'ops']);
export const KINDS = Object.freeze(['work', 'reference']);
export const ACTORS = Object.freeze(['Director', 'L0', 'Fable', 'Owner']);

/** Terminal phases. INTEGRATED is terminal for an ops-track packet (nothing is staged for it). */
export function isTerminal(packet) {
  return packet.phase === 'STAGED' || packet.phase === 'WITHDRAWN' || (packet.phase === 'INTEGRATED' && packet.track === 'ops');
}

export const RE = Object.freeze({
  sha: /^[0-9a-f]{40}$/,
  hash: /^[0-9a-f]{64}$/,
  packet: /^[A-Z0-9][A-Z0-9-]{1,80}$/,
  worker: /^W[1-9][0-9]?$/,
  branch: /^[A-Za-z0-9._/-]{1,120}$/,
  path: /^(\*|[A-Za-z0-9._\-/]{1,160})$/,
});
const FREE_TEXT = new Set(['label', 'condition', 'unblockWhen']);
const FREE_TEXT_MAX = 200;

/**
 * Secret- and PII-shaped content. Mirrors the evidence scanner's rules
 * (.github/wsf-staging/scan-evidence.mjs), plus email addresses: the ledger has
 * no field in which a person's address belongs.
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

/** The fields each event type may carry beyond the envelope, and how each is checked. */
const T = {
  int: (v) => Number.isInteger(v) && v > 0,
  sha: (v) => typeof v === 'string' && RE.sha.test(v),
  packet: (v) => typeof v === 'string' && RE.packet.test(v),
  worker: (v) => typeof v === 'string' && RE.worker.test(v),
  branch: (v) => typeof v === 'string' && RE.branch.test(v),
  text: (v) => typeof v === 'string' && v.trim() !== '',
  track: (v) => TRACKS.includes(v),
  kind: (v) => KINDS.includes(v),
  paths: (v) => Array.isArray(v) && v.length > 0 && v.every((p) => typeof p === 'string' && RE.path.test(p)),
  workers: (v) => Array.isArray(v) && v.every((w) => typeof w === 'string' && (RE.worker.test(w) || ACTORS.includes(w))),
  packets: (v) => Array.isArray(v) && v.every((p) => typeof p === 'string' && RE.packet.test(p)),
  blockers: (v) => Array.isArray(v) && v.length > 0 && v.every((b) =>
    b && typeof b === 'object' && (
      (Object.keys(b).sort().join() === 'packet,until' && RE.packet.test(b.packet) && ['ACCEPTED', 'INTEGRATED', 'STAGED'].includes(b.until)) ||
      (Object.keys(b).sort().join() === 'condition,external,owner,unblockWhen' && RE.packet.test(b.external) && typeof b.condition === 'string' && typeof b.owner === 'string' && typeof b.unblockWhen === 'string'))),
};
/** [required fields, optional fields] per event type. */
export const EVENT_FIELDS = Object.freeze({
  'init': [{}, {}],
  'set-canonical': [{ developmentBranch: T.branch, developmentSha: T.sha, operationalMain: T.sha }, {}],
  'set-staging': [{ servedSha: T.sha, runId: T.int, runNumber: T.int, rollbackSha: T.sha }, { pinPr: T.int }],
  'register-worker': [{ worker: T.worker, inbox: T.int }, {}],
  'queue': [{ packet: T.packet, owner: T.worker }, { track: T.track, kind: T.kind, subjectPaths: T.paths, label: T.text }],
  'reorder-queue': [{ owner: T.worker, order: T.packets }, {}],
  'release': [{ packet: T.packet, inbox: T.int }, {}],
  'ack': [{ packet: T.packet }, {}],
  'deliver': [{ packet: T.packet, pr: T.int, subjectSha: T.sha }, { prHeadSha: T.sha, evidenceSha: T.sha }],
  'review': [{ packet: T.packet, reviewers: T.workers }, {}],
  'finding': [{ packet: T.packet }, {}],
  'accept': [{ packet: T.packet, subjectSha: T.sha }, {}],
  'integrate': [{ packet: T.packet, mergeSha: T.sha }, {}],
  'stage': [{ packet: T.packet, runId: T.int, servedSha: T.sha }, {}],
  'block': [{ packet: T.packet, blockedBy: T.blockers }, {}],
  'unblock': [{ packet: T.packet }, {}],
  'withdraw': [{ packet: T.packet }, {}],
  'reconcile-head': [{ packet: T.packet, prHeadSha: T.sha }, {}],
  'record-evidence': [{ packet: T.packet, evidenceSha: T.sha }, {}],
  'set-critical-path': [{ packet: T.packet }, {}],
});
const ENVELOPE = ['seq', 'type', 'actor', 'authority', 'prev'];

/** Problems with one event's shape; semantic legality is transitions.mjs's job. */
export function validateEvent(e) {
  const problems = [];
  if (!e || typeof e !== 'object' || Array.isArray(e)) return ['an event must be a JSON object'];
  if (!Object.hasOwn(EVENT_FIELDS, e.type)) return [`unknown event type ${JSON.stringify(e.type)}`];
  if (!Number.isInteger(e.seq) || e.seq < 1) problems.push('seq must be a positive integer');
  if (!ACTORS.includes(e.actor)) problems.push(`actor must be one of ${ACTORS.join(', ')}`);
  if (!T.int(e.authority)) problems.push('authority must be the GitHub comment id that authorized this decision');
  if (typeof e.prev !== 'string' || !RE.hash.test(e.prev)) problems.push('prev must be the sha256 of the previous ledger line');
  const [required, optional] = EVENT_FIELDS[e.type];
  for (const [k, ok] of Object.entries(required)) if (!Object.hasOwn(e, k) || !ok(e[k])) problems.push(`${e.type}: ${k} is missing or malformed`);
  for (const [k, ok] of Object.entries(optional)) if (Object.hasOwn(e, k) && !ok(e[k])) problems.push(`${e.type}: ${k} is malformed`);
  for (const k of Object.keys(e)) {
    if (!ENVELOPE.includes(k) && !Object.hasOwn(required, k) && !Object.hasOwn(optional, k)) problems.push(`${e.type}: unknown field ${JSON.stringify(k)}`);
  }
  problems.push(...screen(e));
  return problems;
}
