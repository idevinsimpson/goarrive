/**
 * The North Star mirror RECEIVER (NORTHSTAR-MIRROR-INTAKE-1; Director queue #365 6035531184, release 6035534615;
 * W3 proposal #396 6020672765; journey-qa clarification #365 6020722485). Pure: no network, no clock, no git.
 *
 * The Lovable bridge already posts every completed North Star revision to the #578 feed as one NORTHSTAR_DELTA
 * comment (the sender; untouched here). This is the receiving half:
 *
 *  - parseDelta    one feed comment → an eligible delta, or why not. Fail-closed on the producer's existing closed v1
 *                  shape: owner-authored and unedited; the header line; exactly the thirteen v1 keys in order, each
 *                  once; scalar values and list items checked; exact 40-hex SHAs; lab routes only. `mirror: false`,
 *                  `native_relevant: false` (tooling-only) and an explicit hold note make a valid delta that never
 *                  wakes a product worker. Every text field is data: nothing in a delta is ever executed, recorded as
 *                  a decision, or read as permission. #578 never reaches decisionIntake.
 *  - applyDesired  the reducer for the `northstar-desired` line: it keeps only the NEWEST desired revision (one
 *                  pending target), so newer revisions coalesce instead of queueing every autosave.
 *  - afterEvent    the reducer hooks on existing transitions: a queue line may carry the frozen `northstar` target,
 *                  copied once and never changed (an ACTIVE mirror never moves); the derived queue and release are
 *                  re-checked here; `mirroredThrough` advances ONLY when a mirror packet is INTEGRATED, which already
 *                  needs its recorded exact-head acceptance (R-INTEGRATE), and only to that packet's frozen SHA.
 *  - mirrorPlan    whether the one derived mirror packet is queued and released now (R-NORTHSTAR-QUEUE,
 *                  R-NORTHSTAR-RELEASE), or why it waits.
 *
 * `mirroredThrough` starts unknown (null): nothing here labels any earlier port as parity. A derived mirror packet is
 * member-visible native work: one independent journey-qa review, then the Director's exact-head acceptance.
 */
import { MAX_ROUTES, RE, canon, isTerminal, schemaOf } from './schema.mjs';
import { Illegal } from './transitions.mjs';
import { workerBuckets } from './derive.mjs';

/** The feed issue in the controlled repository. */
export const FEED_ISSUE = 578;
/** The bridge posts as the owner's account (its fine-grained token); the author check proves that account only. */
export const FEED_AUTHOR = 'idevinsimpson';
/** The private North Star repository, read only to prove an exact SHA is on its main, with a read-only token. */
export const NORTHSTAR_REPO = 'idevinsimpson/we-stay-fit-foundation-trial';
export const NORTHSTAR_BRANCH = 'main';
export const ROUTE_ROOT = '/review/north-star';
/** The native mirror owner. */
export const MIRROR_OWNER = 'W9';
/** Native mirror work is member-visible: one independent journey-qa review, then the Director (#365 6020722485). */
export const MIRROR_REVIEW = Object.freeze({ workerReviews: Object.freeze([Object.freeze({ class: 'journey-qa', count: 1 })]), appliesTo: 'subject', after: 'director' });
export const MIRROR_COMPLETION = Object.freeze({ terminal: 'INTEGRATED', proofType: 'source-only' });
export const MIRROR_PATHS = Object.freeze(['apps/westayfit', 'docs/westayfit/qa']);
/** One packet id per frozen SHA. */
export const mirrorPacketId = (sha) => `NORTHSTAR-MIRROR-${sha.slice(0, 8).toUpperCase()}`;

/** The producer's closed v1 keys, in the order it writes them. */
export const V1_KEYS = Object.freeze(['northstar_from', 'northstar_to', 'mirror', 'native_relevant', 'changed_journeys', 'reference_routes', 'viewports', 'summary', 'behavior_contract', 'truth_invariants', 'native_scope_hint', 'acceptance', 'notes']);
const SCALAR = new Set(['northstar_from', 'northstar_to', 'mirror', 'native_relevant']);
const ACCEPTANCE = new Set(['functional', 'truth', 'visual', 'reduced-motion']);
const VIEWPORT = /^[1-9][0-9]{2,3}x[1-9][0-9]{2,3}$/;
const JOURNEY = /^[a-z0-9][a-z0-9-]{0,60}$/;
/** An explicit owner hold (#578 "Core rule"). It can only withhold a wake, never grant anything. */
const HOLD = /\b(?:experiment only|do not mirror|hold native|prototype only)\b/i;
export const MAX_BODY = 32768;
const MAX_ITEMS = 60;
const MAX_ITEM = 2000;

/**
 * One #578 comment → { ok: true, delta: { commentId, sha, from, routes } } or { ok: false, kind, reason }.
 * kind: 'not-a-delta' (no header: ignored), 'refused' (not from the owner, edited, or malformed), or 'skipped'
 * (a valid v1 delta that wakes no one: not mirrored, tooling-only, or held).
 */
export function parseDelta(c) {
  const no = (kind, reason) => ({ ok: false, kind, reason });
  if (!c || !Number.isInteger(c.id) || c.id <= 0) return no('refused', 'the comment has no id');
  const body = typeof c.body === 'string' ? c.body : '';
  if (!body.startsWith('NORTHSTAR_DELTA\n') && body.trimEnd() !== 'NORTHSTAR_DELTA') return no('not-a-delta', 'no NORTHSTAR_DELTA header');
  if (c.author !== FEED_AUTHOR || c.association !== 'OWNER') return no('refused', 'not posted by the owner account');
  if (typeof c.createdAt !== 'string' || c.createdAt === '' || c.createdAt !== c.updatedAt) return no('refused', 'edited, or its timestamps are missing');
  if (body.length > MAX_BODY) return no('refused', `longer than ${MAX_BODY} characters`);
  if (body.includes('\r')) return no('refused', 'carries a carriage return');
  const lines = body.replace(/\n+$/, '').split('\n');
  const fields = new Map();
  let list = null;
  for (const [i, l] of lines.slice(1).entries()) {
    const at = `line ${i + 2}`;
    let m = /^([a-z_]+):(?: (.*))?$/.exec(l);
    if (m) {
      const [, k, v] = m;
      if (!V1_KEYS.includes(k)) return no('refused', `${at}: unknown key ${k}`);
      if (fields.has(k)) return no('refused', `${at}: duplicate key ${k}`);
      if (SCALAR.has(k)) {
        if (v === undefined || v === '' || v !== v.trim()) return no('refused', `${at}: ${k} needs one inline value`);
        fields.set(k, v);
        list = null;
      } else {
        if (v !== undefined) return no('refused', `${at}: ${k} is a list, not an inline value`);
        fields.set(k, []);
        list = k;
      }
      continue;
    }
    m = /^ {2}- (.+)$/.exec(l);
    if (!m) return no('refused', `${at} is not a v1 key or list item`);
    if (!list) return no('refused', `${at}: a list item outside a list`);
    if (m[1] !== m[1].trim()) return no('refused', `${at}: a list item with surrounding whitespace`);
    if (m[1].length > MAX_ITEM) return no('refused', `${at}: a list item longer than ${MAX_ITEM} characters`);
    fields.get(list).push(m[1]);
  }
  const keys = [...fields.keys()];
  if (keys.join() !== V1_KEYS.join()) {
    const missing = V1_KEYS.filter((k) => !fields.has(k));
    return no('refused', missing.length ? `not the v1 key set (missing ${missing.join(', ')})` : 'the v1 keys are out of order');
  }
  for (const k of V1_KEYS.filter((x) => !SCALAR.has(x))) {
    const items = fields.get(k);
    if (items.length === 0) return no('refused', `${k} has no items`);
    if (items.length > MAX_ITEMS) return no('refused', `${k} has more than ${MAX_ITEMS} items`);
    if (items.includes('none') && items.length > 1) return no('refused', `${k} mixes none with items`);
  }
  const to = fields.get('northstar_to');
  const from = fields.get('northstar_from');
  if (!RE.sha.test(to)) return no('refused', 'northstar_to is not an exact 40-character lowercase SHA');
  if (from !== 'none' && !RE.sha.test(from)) return no('refused', 'northstar_from is neither none nor an exact SHA');
  if (from === to) return no('refused', 'northstar_from equals northstar_to');
  const flag = (k) => ({ true: true, false: false })[fields.get(k)];
  const mirror = flag('mirror');
  const native = flag('native_relevant');
  if (mirror === undefined) return no('refused', 'mirror is neither true nor false');
  if (native === undefined) return no('refused', 'native_relevant is neither true nor false');
  const distinct = (k, ok) => {
    const items = fields.get(k).filter((x) => x !== 'none');
    if (new Set(items).size !== items.length) return `${k} names an item twice`;
    const bad = items.find((x) => !ok(x));
    return bad === undefined ? null : `${k} has a value outside v1`;
  };
  for (const [k, ok] of [['viewports', (x) => VIEWPORT.test(x)], ['acceptance', (x) => ACCEPTANCE.has(x)], ['changed_journeys', (x) => JOURNEY.test(x)], ['reference_routes', (x) => x.length <= 120 && RE.route.test(x)]]) {
    const why = distinct(k, ok);
    if (why) return no('refused', why);
  }
  if (fields.get('viewports').includes('none') || fields.get('acceptance').includes('none')) return no('refused', 'viewports and acceptance are never none');
  const routes = fields.get('reference_routes').filter((x) => x !== 'none');
  if (routes.length > MAX_ROUTES) return no('refused', `more than ${MAX_ROUTES} reference routes`);
  if (!mirror) return no('skipped', 'mirror: false');
  if (!native) return no('skipped', 'tooling-only (native_relevant: false)');
  if (fields.get('notes').some((x) => HOLD.test(x))) return no('skipped', 'an explicit owner hold in notes');
  if (routes.length === 0) return no('refused', 'a native-relevant delta names no reference route');
  return { ok: true, delta: { commentId: c.id, sha: to, from: from === 'none' ? null : from, routes } };
}

const illegal = (m) => { throw new Illegal(m); };
const clone = (x) => JSON.parse(JSON.stringify(x));
const sameRoutes = (a, b) => a.length === b.length && a.every((r, i) => r === b[i]);

/** The live (non-terminal) packets that carry a North Star target, other than `except`. */
export const liveMirrors = (s, except = null) => Object.keys(s.packets).sort().filter((id) => id !== except && s.packets[id].northstar && !isTerminal(s.packets[id]));

/** Reducer: one `northstar-desired` line. Only a newer comment with a different SHA replaces the desired revision. */
export function applyDesired(state, e) {
  const s = clone(state);
  if (s.eventCount === 0) illegal('the first ledger line must be the bootstrap');
  if (schemaOf(e) !== s.schemaVersion) illegal(`a schema ${schemaOf(e)} line in a schema ${s.schemaVersion} ledger: versions change only across one schema-upgrade line`);
  if (e.source.repo !== s.repository) illegal(`source repository ${e.source.repo} is not the controlled repository ${s.repository}`);
  const was = s.northstar?.desired ?? null;
  if (was && e.source.id <= was.commentId) illegal(`northstar-desired: comment ${e.source.id} is not newer than the desired revision's comment ${was.commentId}`);
  if (was && was.sha === e.sha) illegal(`northstar-desired: ${e.sha.slice(0, 8)} is already the desired revision`);
  s.northstar = { desired: { sha: e.sha, routes: [...e.routes], commentId: e.source.id }, mirroredThrough: s.northstar?.mirroredThrough ?? null };
  s.eventCount += 1;
  return s;
}

/** Reducer hooks after an existing transition `e` produced `s`. A ledger without North Star lines is untouched. */
export function afterEvent(s, e) {
  const rule = e.authority?.rule;
  if (e.type === 'queue') {
    if (e.northstar) s.packets[e.packet].northstar = { sha: e.northstar.sha, routes: [...e.northstar.routes] };
    if (rule === 'R-NORTHSTAR-QUEUE') {
      const d = s.northstar?.desired;
      if (!e.northstar || !d) illegal('R-NORTHSTAR-QUEUE queues only the desired North Star revision');
      if (e.northstar.sha !== d.sha || !sameRoutes(e.northstar.routes, d.routes)) illegal(`R-NORTHSTAR-QUEUE: the target is not the desired revision ${d.sha.slice(0, 8)} and its routes`);
      if (e.source.kind !== 'comment' || e.source.id !== d.commentId) illegal('R-NORTHSTAR-QUEUE rests on the desired revision\'s feed comment');
      if (d.sha === s.northstar.mirroredThrough) illegal(`R-NORTHSTAR-QUEUE: ${d.sha.slice(0, 8)} is already mirrored`);
      if (e.packet !== mirrorPacketId(d.sha) || e.owner !== MIRROR_OWNER) illegal(`R-NORTHSTAR-QUEUE derives only ${mirrorPacketId(d.sha)} for ${MIRROR_OWNER}`);
      const p = s.packets[e.packet];
      if (p.kind !== 'work' || canon(p.completion) !== canon(MIRROR_COMPLETION) || canon(p.review) !== canon(MIRROR_REVIEW)) illegal('R-NORTHSTAR-QUEUE: a mirror packet is source-only work under one journey-qa review, then the Director');
      const other = liveMirrors(s, e.packet);
      if (other.length) illegal(`R-NORTHSTAR-QUEUE: ${other[0]} is a live mirror packet; its target never moves and newer revisions wait`);
      const b = workerBuckets(s, MIRROR_OWNER);
      if (b.active.length || b.reviewing.length || b.next !== e.packet) illegal(`R-NORTHSTAR-QUEUE: ${MIRROR_OWNER} must hold no ball and no other NEXT`);
    }
  } else if (e.type === 'release' && rule === 'R-NORTHSTAR-RELEASE') {
    const p = s.packets[e.packet];
    if (!p.northstar) illegal('R-NORTHSTAR-RELEASE releases only a mirror packet');
    if (p.authority.queued?.kind !== 'comment' || p.authority.queued.id !== e.source.id) illegal('R-NORTHSTAR-RELEASE rests on the same feed comment as its queue');
    const b = workerBuckets(s, p.owner);
    if (b.active.length !== 1 || b.reviewing.length) illegal(`R-NORTHSTAR-RELEASE: ${p.owner} must hold no other ball`);
  } else if (e.type === 'integrate' && s.packets[e.packet].northstar) {
    // The exact-head acceptance is already required by integrate (its recorded acceptance comment); only then, and
    // only to this packet's frozen SHA, does mirroredThrough move.
    s.northstar = { desired: s.northstar?.desired ?? null, mirroredThrough: s.packets[e.packet].northstar.sha };
  }
  return s;
}

/**
 * Whether the one mirror packet is derived now: { queue, release, source } with the line fields, or { wait } / { none }
 * with the reason. `behind` is set when a live mirror is frozen on an older SHA than the desired one.
 */
export function mirrorPlan(s) {
  const ns = s.northstar;
  const d = ns?.desired ?? null;
  if (!d) return { none: 'no desired North Star revision is recorded' };
  if (d.sha === ns.mirroredThrough) return { none: `the desired revision ${d.sha.slice(0, 8)} is mirrored` };
  const live = liveMirrors(s);
  if (live.length) {
    const p = s.packets[live[0]];
    return p.northstar.sha === d.sha ? { wait: `${live[0]} is ${p.phase} on the desired revision` } : { wait: `${live[0]} is ${p.phase} on ${p.northstar.sha.slice(0, 8)}; it finishes that frozen target first`, behind: live[0] };
  }
  const id = mirrorPacketId(d.sha);
  if (s.packets[id]) return { wait: `${id} already exists (${s.packets[id].phase}); a packet for this SHA is never re-queued` };
  if (!s.workers[MIRROR_OWNER]) return { wait: `${MIRROR_OWNER} is not registered` };
  const b = workerBuckets(s, MIRROR_OWNER);
  if (b.active.length || b.reviewing.length) return { wait: `${MIRROR_OWNER} holds a ball (${[...b.active, ...b.reviewing].map((p) => p.id).join(', ')})` };
  if (b.next) return { wait: `${MIRROR_OWNER}'s NEXT is ${b.next}` };
  const label = `Mirror North Star ${d.sha} (#${FEED_ISSUE} comment ${d.commentId}) to native: net delta only, journey-qa review, then Director exact-head acceptance`;
  return {
    source: { kind: 'comment', id: d.commentId },
    queue: { packet: id, owner: MIRROR_OWNER, completion: clone(MIRROR_COMPLETION), kind: 'work', subjectPaths: [...MIRROR_PATHS], label, review: clone(MIRROR_REVIEW), northstar: { sha: d.sha, routes: [...d.routes] } },
    release: { packet: id, inbox: s.workers[MIRROR_OWNER].inbox },
  };
}

/** The one-line North Star status a writer run reports. */
export function northstarStatus(s) {
  const ns = s.northstar;
  if (!ns?.desired) return 'NORTHSTAR desired=none';
  const plan = mirrorPlan(s);
  const head = `NORTHSTAR desired=${ns.desired.sha.slice(0, 8)} comment=${ns.desired.commentId} mirrored=${ns.mirroredThrough ? ns.mirroredThrough.slice(0, 8) : 'unknown'}`;
  if (plan.behind) {
    const p = s.packets[plan.behind];
    return `${head} desired-behind active=${plan.behind}@${p.northstar.sha.slice(0, 8)}`;
  }
  return `${head} ${plan.none ?? plan.wait ?? `eligible ${plan.queue.packet}`}`;
}
