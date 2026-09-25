#!/usr/bin/env node
/**
 * SOCIAL-STAGING-DEMO-1: a retained, staging-only, synthetic social review fixture.
 *
 * Director #365 5834082617 section C; L0 #396 5834099352; corrections per
 * Director #396 5834407330. It seeds two clearly named SAMPLE communities for
 * the owner's EXISTING staging account: twelve synthetic members in one, four
 * of them in a second for switching, a goal in each, and a consistent
 * contribution ledger. The declarative content is social-demo.fixture.json.
 *
 * MODES (exactly one; plan is the default and writes nothing):
 *   --plan      read-only: verify the owner, classify every fixture path, and
 *               report what apply would create / update / keep
 *   --apply     converge; never overwrites anything it did not write itself
 *   --verify    read-only: presence, ownership, drift and ledger consistency
 *   --cleanup   delete exactly this fixture's documents; requires
 *               --confirm-cleanup SOCIAL-STAGING-DEMO-1
 *
 * REQUIRED: --project <id> and --owner-uid <uid>. The project must be
 * westayfit-staging, or a demo-* project with FIRESTORE_EMULATOR_HOST set.
 * The owner is verified from his existing Auth record by uid (present,
 * enabled, email-verified, with a wsfMemberProfiles document). No display name
 * is used to find him and no email is read, printed or written.
 *
 * SAFETY PROPERTIES (each has a case in emulator-dry-run.mjs):
 *  - AUTH ERRORS FAIL CLOSED. Only auth/user-not-found proves an account is
 *    absent. Any other Auth error (permission, transport, quota, ...) aborts
 *    before any write, naming the error code.
 *  - NO ABSOLUTE COUNTER WRITES. A seeded contribution is created the way
 *    wsfContribute creates one: in one transaction that confirms the row is
 *    absent, creates it, and INCREMENTS its shard and the member's total. A
 *    contribution anyone records while this runs is therefore never lost from
 *    the confirmed totals, on apply or on --reanchor, which moves timestamps
 *    only.
 *  - FOREIGN DOCUMENTS FAIL CLOSED. Before any write or delete, every existing
 *    document at a fixture path is classified: ours (unchanged), ours (drifted,
 *    e.g. a review-time goal edit, which is KEPT and reported, never reset), or
 *    foreign, which aborts the run.
 *  - The owner's profile, his other memberships, his membership rows in the
 *    sample groups once they exist, and his preferences are never written.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// firebase-admin is resolved from the WORKING DIRECTORY (an installed
// functions-westayfit, see README.md); the repository root has none.
const requireFromCwd = createRequire(join(process.cwd(), 'noop.js'));
const { initializeApp } = requireFromCwd('firebase-admin/app');
const { getAuth } = requireFromCwd('firebase-admin/auth');
const { getFirestore, Timestamp, FieldValue } = requireFromCwd('firebase-admin/firestore');

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = resolve(HERE, 'social-demo.fixture.json');
const SHARD_COUNT = 10; // GOAL_SHARD_COUNT in functions-westayfit/src/index.ts
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

// ---------- Auth lookups: only "not found" is absence -----------------------

export class AuthLookupError extends Error {
  constructor(uid, cause) {
    super(`Auth lookup for ${uid} failed with ${cause?.code ?? cause?.errorInfo?.code ?? cause?.name ?? 'an unknown error'}; refusing to treat it as absence`);
    this.code = cause?.code ?? cause?.errorInfo?.code ?? 'unknown';
  }
}
/** The Auth record, or null ONLY for auth/user-not-found. Anything else throws. */
export async function lookupUser(auth, uid) {
  try {
    return await auth.getUser(uid);
  } catch (e) {
    const code = e?.code ?? e?.errorInfo?.code;
    if (code === 'auth/user-not-found') return null;
    throw new AuthLookupError(uid, e);
  }
}

// ---------- pure planning ----------------------------------------------------

export function zonedDayStartMs(timeZone, nowMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(nowMs));
  const get = (t) => Number(parts.find((x) => x.type === t).value);
  const hour = get('hour') === 24 ? 0 : get('hour');
  const offset = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second')) - nowMs;
  const wall = new Date(nowMs + offset);
  return Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) - offset;
}
const isoMinute = (ms) => new Date(Math.floor(ms / MIN) * MIN).toISOString();

export function validateFixture(f) {
  const errs = [];
  const uids = new Set();
  for (const m of f.members) {
    if (!m.uid.startsWith(f.syntheticUidPrefix)) errs.push(`member ${m.uid} lacks the synthetic prefix`);
    if (uids.has(m.uid)) errs.push(`member ${m.uid} listed twice`);
    uids.add(m.uid);
    if (typeof m.displayName !== 'string' || m.displayName.trim().length < 2) errs.push(`member ${m.uid} has no display name`);
  }
  for (const c of f.communities) {
    if (!c.groupId.startsWith(f.syntheticUidPrefix)) errs.push(`community ${c.groupId} lacks the synthetic prefix`);
    if (!/^sample\b/i.test(c.displayName)) errs.push(`community ${c.groupId} is not clearly named as a sample`);
    for (const m of c.members) {
      if (!uids.has(m.uid)) errs.push(`community ${c.groupId} names unknown member ${m.uid}`);
      for (const k of ['name', 'activity']) if (m[k] !== undefined && m[k] !== 'visible' && m[k] !== 'private') errs.push(`${c.groupId}/${m.uid} ${k} must be visible|private`);
    }
    const inGroup = new Set(c.members.map((m) => m.uid));
    for (const g of c.goals) {
      if (!g.goalId.startsWith(f.syntheticUidPrefix)) errs.push(`goal ${g.goalId} lacks the synthetic prefix`);
      for (const x of g.contributions) {
        if (!inGroup.has(x.uid)) errs.push(`goal ${g.goalId}: ${x.uid} is not a member of ${c.groupId}`);
        if (!Number.isInteger(x.count) || x.count <= 0) errs.push(`goal ${g.goalId}: bad count for ${x.uid}`);
      }
    }
  }
  return errs;
}

/**
 * The fixture's documents for an anchor. `entity` documents (profiles, groups,
 * synthetic memberships, goals) carry a demoFixture marker and are written
 * whole. `contribution` entries are applied transactionally (see applyLedger).
 * `ownerMembership` is created only where absent and never rewritten.
 */
export function planDocuments(f, { ownerUid, anchorMs, joinCodes = {} }) {
  const entities = [];
  const contributions = [];
  const ownerMemberships = [];
  const ts = (ms) => Timestamp.fromMillis(ms);
  const created = ts(anchorMs - 14 * DAY);
  const dayStart = zonedDayStartMs(f.timezone, anchorMs);
  const mark = f.fixtureId;

  for (const m of f.members) {
    entities.push({ path: `wsfMemberProfiles/${m.uid}`, kind: 'profile', data: { displayName: m.displayName, demoFixture: mark, createdAt: created, updatedAt: created } });
  }
  for (const c of f.communities) {
    entities.push({ path: `wsfCommunityGroups/${c.groupId}`, kind: 'group', data: {
      displayName: c.displayName, groupType: c.groupType, joinPolicy: c.joinPolicy,
      joinCode: joinCodes[c.groupId] ?? randomBytes(16).toString('base64url'),
      createdByUserId: `seed-${mark}`, lifecycleStatus: 'active', isSample: true,
      demoFixture: { id: mark, version: f.version, anchorMs }, createdAt: created, updatedAt: created,
    } });
    ownerMemberships.push({ path: `wsfMemberships/${c.groupId}_${ownerUid}`, data: { groupId: c.groupId, userId: ownerUid, role: 'foundingChampion', membershipStatus: 'active', createdAt: created, updatedAt: created } });
    for (const m of c.members) {
      const row = { groupId: c.groupId, userId: m.uid, role: 'member', membershipStatus: 'active', demoFixture: mark, createdAt: created, updatedAt: created };
      if (m.name) row.communityNameVisibility = m.name;
      if (m.activity) row.communityActivityVisibility = m.activity;
      entities.push({ path: `wsfMemberships/${c.groupId}_${m.uid}`, kind: 'membership', data: row });
    }
    for (const g of c.goals) {
      entities.push({ path: `wsfGoals/${g.goalId}`, kind: 'goal', data: {
        ownerUid, communityGroupId: c.groupId, title: g.title, target: g.target, unit: g.unit, status: 'active',
        startsAt: ts(anchorMs - g.startDaysBeforeAnchor * DAY), endsAt: ts(anchorMs + g.endDaysAfterAnchor * DAY),
        timezone: f.timezone, repeatPolicy: g.repeatPolicy, demoFixture: mark, createdAt: ts(anchorMs - g.startDaysBeforeAnchor * DAY),
      } });
      g.contributions.forEach((x, i) => {
        const attemptId = `${mark.toLowerCase()}-${g.goalId}-${String(i + 1).padStart(2, '0')}`;
        let at = anchorMs - x.minutesBeforeAnchor * MIN;
        if (x.minutesBeforeAnchor < 24 * 60 && at < dayStart) at = Math.min(anchorMs, dayStart + MIN * (i + 1));
        contributions.push({
          path: `wsfContributions/${g.goalId}_${x.uid}_${attemptId}`,
          shardPath: `wsfGoalCounters/${g.goalId}/shards/${i % SHARD_COUNT}`,
          totalPath: `wsfGoalMemberTotals/${g.goalId}_${x.uid}`,
          additionPath: `wsfGoals/${g.goalId}/recentAdditions/${attemptId}`,
          identity: { goalId: g.goalId, attemptId, userId: x.uid, count: x.count, shardIndex: i % SHARD_COUNT, unit: g.unit, communityGroupId: c.groupId, crossedTarget: false },
          atMs: at,
        });
      });
    }
  }
  return { entities, contributions, ownerMemberships };
}

// ---------- comparison ------------------------------------------------------

function norm(v) {
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (v instanceof Date) return { __ts: v.getTime() };
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
  return v;
}
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const markerOf = (data, kind) => (kind === 'group' ? data?.demoFixture?.id : data?.demoFixture);

/**
 * Classify one existing entity document against the fixture.
 *   absent | unchanged | reanchor (still exactly as last seeded; only the
 *   anchor moves it) | drift (ours, changed since seeding: KEEP) | foreign
 */
export function classifyEntity(actual, wantNow, wantPrior, kind, fixtureId) {
  if (actual === undefined) return 'absent';
  if (markerOf(actual, kind) !== fixtureId) return 'foreign';
  if (same(actual, wantNow)) return 'unchanged';
  if (wantPrior && same(actual, wantPrior)) return 'reanchor';
  return 'drift';
}
/** Same idea for a ledger row: identity decides ownership; time decides freshness. */
export function classifyContribution(actual, want, priorAtMs) {
  if (actual === undefined) return 'absent';
  const { createdAt, ...rest } = actual;
  if (!same(rest, want.identity)) return 'foreign';
  const at = createdAt instanceof Timestamp ? createdAt.toMillis() : createdAt?.getTime?.();
  if (at === want.atMs) return 'unchanged';
  if (priorAtMs !== undefined && at === priorAtMs) return 'reanchor';
  return 'drift';
}

// ---------- runtime ---------------------------------------------------------

function parseArgs(argv) {
  const a = { mode: 'plan' };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (['--plan', '--apply', '--verify', '--cleanup'].includes(k)) a.mode = k.slice(2);
    else if (k === '--reanchor') a.reanchor = true;
    else if (['--project', '--owner-uid', '--confirm-cleanup', '--receipt', '--fixture'].includes(k)) a[k.slice(2)] = argv[++i];
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

export function guardProject(f, project, emulatorHost) {
  if (!project) return 'refused: --project is required';
  if (emulatorHost) return project.startsWith(f.emulatorProjectPrefix) ? null : `refused: an emulator run must use a ${f.emulatorProjectPrefix}* project, not ${project}`;
  return f.allowedProjects.includes(project) ? null : `refused: ${project} is not an allowed project (${f.allowedProjects.join(', ')})`;
}

const fail = (code, msg) => { console.error(`::error::${msg}`); process.exit(code); };

async function testInterleave(db) {
  // Emulator-only seam used by emulator-dry-run.mjs to land a real contribution
  // between this script's reads and its commit. Ignored outside the emulator.
  if (process.env.FIRESTORE_EMULATOR_HOST && process.env.WSF_DEMO_TEST_INTERLEAVE) {
    await (await import(process.env.WSF_DEMO_TEST_INTERLEAVE)).default(db);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const f = JSON.parse(readFileSync(args.fixture ? resolve(args.fixture) : FIXTURE_PATH, 'utf8'));
  const problems = validateFixture(f);
  if (problems.length) { for (const p of problems) console.error(`::error::${p}`); process.exit(2); }
  const refused = guardProject(f, args.project, process.env.FIRESTORE_EMULATOR_HOST);
  if (refused) fail(2, refused);
  if (!args['owner-uid']) fail(2, '--owner-uid is required (the owner is verified by his Auth record, never by name)');
  if (args.mode === 'cleanup' && args['confirm-cleanup'] !== f.fixtureId) fail(2, `cleanup requires --confirm-cleanup ${f.fixtureId}`);
  initializeApp({ projectId: args.project });
  const db = getFirestore();
  const auth = getAuth();
  const ownerUid = args['owner-uid'];
  if (ownerUid.startsWith(f.syntheticUidPrefix)) fail(3, 'the owner uid carries the synthetic prefix');

  // ---- Auth: the owner, then the synthetic uids; every non-not-found error aborts ----
  try {
    const owner = await lookupUser(auth, ownerUid);
    if (!owner) fail(3, 'no Auth record for --owner-uid (auth/user-not-found)');
    if (owner.disabled || owner.emailVerified !== true) fail(3, 'the owner Auth record is disabled or not email-verified');
    for (const m of f.members) {
      if (await lookupUser(auth, m.uid)) fail(3, `${m.uid} is a real Auth account; refusing to treat it as synthetic`);
    }
  } catch (e) {
    if (e instanceof AuthLookupError) fail(3, `${e.message} [AUTH_ERROR=${e.code}]`);
    throw e;
  }
  if (!(await db.doc(`wsfMemberProfiles/${ownerUid}`).get()).exists) fail(3, 'the owner has no wsfMemberProfiles document');

  // ---- anchor and plans ----
  const groupSnaps = await Promise.all(f.communities.map((c) => db.doc(`wsfCommunityGroups/${c.groupId}`).get()));
  const priorAnchor = groupSnaps.map((s) => (s.exists && s.get('demoFixture.id') === f.fixtureId ? s.get('demoFixture.anchorMs') : null)).find((v) => Number.isFinite(v));
  const anchorMs = args.reanchor || !Number.isFinite(priorAnchor) ? Date.now() : priorAnchor;
  const joinCodes = Object.fromEntries(groupSnaps.filter((s) => s.exists).map((s) => [s.id, s.get('joinCode')]));
  const now = planDocuments(f, { ownerUid, anchorMs, joinCodes });
  const prior = Number.isFinite(priorAnchor) && priorAnchor !== anchorMs ? planDocuments(f, { ownerUid, anchorMs: priorAnchor, joinCodes }) : null;
  const priorByPath = new Map((prior ? [...prior.entities, ...prior.contributions] : []).map((d) => [d.path, d]));
  const goalIds = f.communities.flatMap((c) => c.goals.map((g) => g.goalId));

  // ---- classify every fixture path BEFORE any write or delete ----
  const cls = { absent: [], unchanged: [], reanchor: [], drift: [], foreign: [] };
  for (const d of now.entities) {
    const s = await db.doc(d.path).get();
    const k = classifyEntity(s.exists ? s.data() : undefined, d.data, priorByPath.get(d.path)?.data, d.kind, f.fixtureId);
    cls[k].push({ ...d, kindOf: d.kind });
  }
  for (const d of now.contributions) {
    const s = await db.doc(d.path).get();
    const k = classifyContribution(s.exists ? s.data() : undefined, d, priorByPath.get(d.path)?.atMs);
    cls[k].push({ ...d, kindOf: 'contribution' });
  }
  // a foreign owner of the counters: shard or member-total docs that exist under a fixture goal whose goal doc is foreign are covered by the goal; a
  // member-total row for a synthetic uid that no fixture contribution explains is foreign
  for (const g of goalIds) {
    const mts = await db.collection('wsfGoalMemberTotals').where('goalId', '==', g).get();
    for (const d of mts.docs) {
      const uid = d.get('userId');
      if (uid?.startsWith(f.syntheticUidPrefix) && !now.contributions.some((c) => c.totalPath === d.ref.path)) cls.foreign.push({ path: d.ref.path, kindOf: 'memberTotal' });
    }
  }
  const ownerFingerprint = async () => {
    const mine = await db.collection('wsfMemberships').where('userId', '==', ownerUid).get();
    const outside = mine.docs.filter((d) => !f.communities.some((c) => d.id === `${c.groupId}_${ownerUid}`));
    const prof = await db.doc(`wsfMemberProfiles/${ownerUid}`).get();
    return JSON.stringify(norm({ profile: prof.data(), memberships: outside.map((d) => [d.id, d.data()]).sort() }));
  };
  const before = await ownerFingerprint();
  const kinds = (arr) => Object.entries(arr.reduce((m, d) => ({ ...m, [d.kindOf]: (m[d.kindOf] ?? 0) + 1 }), {})).map(([k, v]) => `${k}:${v}`).join(' ') || 'none';

  console.log(`fixture: ${f.fixtureId} v${f.version} · project: ${args.project}${process.env.FIRESTORE_EMULATOR_HOST ? ' (emulator)' : ''} · mode: ${args.mode}`);
  console.log(`owner: ${ownerUid} (Auth record present, enabled, email-verified; profile present)`);
  console.log(`anchor: ${new Date(anchorMs).toISOString()}${args.reanchor ? ' (reanchored)' : Number.isFinite(priorAnchor) ? ' (kept)' : ' (new)'}`);
  console.log(`CREATE=${cls.absent.length} [${kinds(cls.absent)}]`);
  console.log(`REANCHOR=${cls.reanchor.length} [${kinds(cls.reanchor)}]`);
  console.log(`UNCHANGED=${cls.unchanged.length}`);
  console.log(`DRIFT=${cls.drift.length} [${kinds(cls.drift)}]${cls.drift.length ? ' kept, not reset: ' + cls.drift.map((d) => d.path).join(', ') : ''}`);
  console.log(`FOREIGN=${cls.foreign.length}${cls.foreign.length ? ': ' + cls.foreign.map((d) => d.path).join(', ') : ''}`);
  const receipt = { fixtureId: f.fixtureId, project: args.project, mode: args.mode, ownerUid, anchor: new Date(anchorMs).toISOString(), classes: Object.fromEntries(Object.entries(cls).map(([k, v]) => [k, v.map((d) => d.path)])) };
  const writeReceipt = () => { if (args.receipt) writeFileSync(args.receipt, JSON.stringify(receipt, null, 2)); };
  if (cls.foreign.length) { writeReceipt(); fail(3, `foreign documents at fixture paths; nothing written or deleted`); }

  const ledgerCheck = async () => {
    let ok = true;
    for (const g of goalIds) {
      const led = await db.collection('wsfContributions').where('goalId', '==', g).get();
      const ledger = led.docs.reduce((a, d) => a + d.get('count'), 0);
      let shards = 0;
      for (let i = 0; i < SHARD_COUNT; i += 1) { const s = await db.doc(`wsfGoalCounters/${g}/shards/${i}`).get(); shards += s.exists ? s.get('count') : 0; }
      const mts = await db.collection('wsfGoalMemberTotals').where('goalId', '==', g).get();
      const totals = mts.docs.reduce((a, d) => a + (d.get('total') ?? 0), 0);
      console.log(`goal ${g}: ledger ${ledger} = shards ${shards} = member totals ${totals}${ledger === shards && shards === totals ? '' : '  MISMATCH'}`);
      ok = ok && ledger === shards && shards === totals;
    }
    return ok;
  };

  if (args.mode === 'plan') { console.log('PLAN ONLY: nothing written'); writeReceipt(); return; }

  if (args.mode === 'verify') {
    const consistent = await ledgerCheck();
    const missing = cls.absent.length + cls.reanchor.length;
    const verdict = !consistent ? 'inconsistent' : missing ? 'incomplete' : cls.drift.length ? 'drift' : 'pass';
    console.log(`VERIFY=${verdict}`);
    writeReceipt();
    process.exit(verdict === 'pass' ? 0 : 5);
  }

  if (args.mode === 'cleanup') {
    const paths = new Set([...now.entities.map((d) => d.path), ...now.ownerMemberships.map((d) => d.path)]);
    let ownerRows = 0;
    for (const g of goalIds) {
      for (let i = 0; i < SHARD_COUNT; i += 1) paths.add(`wsfGoalCounters/${g}/shards/${i}`);
      // everything recorded against a sample goal goes with the goal: seeded rows and any the owner added while reviewing
      for (const d of (await db.collection('wsfContributions').where('goalId', '==', g).get()).docs) { if (!d.get('userId')?.startsWith(f.syntheticUidPrefix)) ownerRows += 1; paths.add(d.ref.path); }
      for (const d of (await db.collection(`wsfGoals/${g}/recentAdditions`).get()).docs) paths.add(d.ref.path);
      for (const d of (await db.collection('wsfGoalMemberTotals').where('goalId', '==', g).get()).docs) paths.add(d.ref.path);
    }
    let deleted = 0;
    for (const p of [...paths].sort()) { const r = db.doc(p); if ((await r.get()).exists) { await r.delete(); deleted += 1; } }
    const after = await ownerFingerprint();
    console.log(`CLEANUP_DELETED=${deleted} (fixture paths: ${paths.size}; rows the owner recorded on the sample goals: ${ownerRows})`);
    console.log(`OWNER_DATA_OUTSIDE_FIXTURE_UNCHANGED=${before === after}`);
    receipt.deleted = [...paths].sort();
    writeReceipt();
    process.exit(before === after ? 0 : 4);
  }

  // ---- apply ----
  let written = 0;
  // 1. entities: create absent, move reanchor-only ones; drift is kept
  const entityWrites = [...cls.absent, ...cls.reanchor].filter((d) => d.kindOf !== 'contribution');
  for (const d of entityWrites) {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(db.doc(d.path));
      const k = classifyEntity(s.exists ? s.data() : undefined, d.data, priorByPath.get(d.path)?.data, d.kind, f.fixtureId);
      if (k === 'absent') { tx.create(db.doc(d.path), d.data); written += 1; }
      else if (k === 'reanchor') { tx.set(db.doc(d.path), d.data); written += 1; }
      else if (k === 'foreign') throw new Error(`${d.path} became foreign during the run`);
    });
  }
  // 2. the owner's membership rows: created where absent, never rewritten
  for (const d of now.ownerMemberships) {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(db.doc(d.path));
      if (!s.exists) { tx.create(db.doc(d.path), d.data); written += 1; }
    });
  }
  // 3. the ledger: one transaction per row, exactly as wsfContribute records one
  for (const d of [...cls.absent, ...cls.reanchor].filter((x) => x.kindOf === 'contribution')) {
    await db.runTransaction(async (tx) => {
      const ref = db.doc(d.path);
      const s = await tx.get(ref);
      const k = classifyContribution(s.exists ? s.data() : undefined, d, priorByPath.get(d.path)?.atMs);
      await testInterleave(db);
      const at = Timestamp.fromMillis(d.atMs);
      if (k === 'absent') {
        tx.create(ref, { ...d.identity, createdAt: at });
        tx.set(db.doc(d.shardPath), { count: FieldValue.increment(d.identity.count) }, { merge: true });
        tx.set(db.doc(d.totalPath), { goalId: d.identity.goalId, userId: d.identity.userId, total: FieldValue.increment(d.identity.count), contributionCount: FieldValue.increment(1), updatedAt: at }, { merge: true });
        tx.set(db.doc(d.additionPath), { amount: d.identity.count, at: isoMinute(d.atMs) });
        written += 1;
      } else if (k === 'reanchor') {
        // timestamps only; counts, shards and totals are untouched
        tx.update(ref, { createdAt: at });
        tx.set(db.doc(d.additionPath), { amount: d.identity.count, at: isoMinute(d.atMs) });
        written += 1;
      } else if (k === 'foreign') {
        throw new Error(`${d.path} became foreign during the run`);
      }
    });
  }
  // 4. a reanchor on a sample group the owner has edited: move only the
  //    fixture's own bookkeeping field, never his edit
  if (args.reanchor) {
    for (const c of f.communities) {
      await db.runTransaction(async (tx) => {
        const ref = db.doc(`wsfCommunityGroups/${c.groupId}`);
        const s = await tx.get(ref);
        if (s.exists && s.get('demoFixture.id') === f.fixtureId && s.get('demoFixture.anchorMs') !== anchorMs) {
          tx.update(ref, { 'demoFixture.anchorMs': anchorMs });
          written += 1;
        }
      });
    }
  }
  const after = await ownerFingerprint();
  const consistent = await ledgerCheck();
  console.log(`APPLIED=${written}`);
  console.log(`OWNER_DATA_OUTSIDE_FIXTURE_UNCHANGED=${before === after}`);
  writeReceipt();
  process.exit(before === after && consistent ? 0 : 4);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
}
