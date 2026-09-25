#!/usr/bin/env node
/**
 * SOCIAL-STAGING-DEMO-1: a retained, staging-only, synthetic social review fixture.
 *
 * Director #365 5834082617 section C; L0 #396 5834099352. It seeds two clearly
 * named SAMPLE communities for the owner's EXISTING staging account: twelve
 * synthetic members in one, four of them in a second for switching, a goal in
 * each, and a consistent contribution ledger. The declarative content lives in
 * social-demo.fixture.json beside this file.
 *
 * MODES (exactly one; plan is the default and writes nothing):
 *   --plan      read-only: resolve the owner, compute every document, report
 *               what apply would create / update / leave unchanged
 *   --apply     converge: write only documents whose content differs
 *   --verify    read-only: re-derive the expected state and compare
 *   --cleanup   delete exactly this fixture's documents; requires
 *               --confirm-cleanup SOCIAL-STAGING-DEMO-1
 *
 * REQUIRED: --project <id> and --owner-uid <uid>.
 *   The project must be westayfit-staging, or a demo-* project with
 *   FIRESTORE_EMULATOR_HOST set (the emulator dry run). Anything else refuses.
 *   The owner is verified from his existing Auth record by uid: the record must
 *   exist, be enabled and email-verified, and have a wsfMemberProfiles
 *   document. No display name is ever used to find him, and no email is read,
 *   printed or written by this script.
 *
 * OPTIONAL: --reanchor moves the fixture's time anchor to now, so "moved today"
 *   reflects today again on a retained fixture; totals do not change.
 *   --receipt <path> writes a JSON receipt of every path touched.
 *
 * WHAT IT NEVER DOES: create an Auth account, write an email or contact,
 * invite anyone, print a join code, touch a document outside the fixture's own
 * paths, change the owner's profile, his other memberships or his visibility
 * preferences, or contribute on his behalf. Seeded rows are not evidence that
 * the social features work; that needs the served member / non-member /
 * privacy calls, which are blocked while the three social services are SHUT.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// firebase-admin is resolved from the WORKING DIRECTORY, not from this file:
// the operator runs this from an installed functions-westayfit checkout (see
// README.md), and the repository root has no firebase-admin of its own.
const requireFromCwd = createRequire(join(process.cwd(), 'noop.js'));
const { initializeApp } = requireFromCwd('firebase-admin/app');
const { getAuth } = requireFromCwd('firebase-admin/auth');
const { getFirestore, Timestamp } = requireFromCwd('firebase-admin/firestore');

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_PATH = resolve(HERE, 'social-demo.fixture.json');
const SHARD_COUNT = 10; // GOAL_SHARD_COUNT in functions-westayfit/src/index.ts
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

// ---------- pure planning (no I/O; unit-testable) ----------------------------

/** The instant the local day began in a zone (same rule as the e2e social fixture). */
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
 * Every document this fixture owns, as { path, data }, for a given owner and
 * anchor. `existing` supplies values that must survive a re-run: the join code
 * each sample group was first given, and whether the owner already has a
 * membership row there (which is then left exactly as it is).
 */
export function planDocuments(f, { ownerUid, anchorMs, existing = {} }) {
  const docs = [];
  const put = (path, data, kind) => docs.push({ path, data, kind });
  const ts = (ms) => Timestamp.fromMillis(ms);
  const created = ts(anchorMs - 14 * DAY);
  const dayStart = zonedDayStartMs(f.timezone, anchorMs);

  for (const m of f.members) {
    put(`wsfMemberProfiles/${m.uid}`, { displayName: m.displayName, demoFixture: f.fixtureId, createdAt: created, updatedAt: created }, 'profile');
  }
  for (const c of f.communities) {
    put(`wsfCommunityGroups/${c.groupId}`, {
      displayName: c.displayName,
      groupType: c.groupType,
      joinPolicy: c.joinPolicy,
      joinCode: existing.joinCodes?.[c.groupId] ?? randomBytes(16).toString('base64url'),
      createdByUserId: `seed-${f.fixtureId}`,
      lifecycleStatus: 'active',
      isSample: true,
      demoFixture: { id: f.fixtureId, version: f.version, anchorMs },
      createdAt: created,
      updatedAt: created,
    }, 'group');
    if (!existing.ownerMemberships?.has(c.groupId)) {
      put(`wsfMemberships/${c.groupId}_${ownerUid}`, {
        groupId: c.groupId, userId: ownerUid, role: 'foundingChampion', membershipStatus: 'active', createdAt: created, updatedAt: created,
      }, 'ownerMembership');
    }
    for (const m of c.members) {
      const row = { groupId: c.groupId, userId: m.uid, role: 'member', membershipStatus: 'active', createdAt: created, updatedAt: created };
      if (m.name) row.communityNameVisibility = m.name;
      if (m.activity) row.communityActivityVisibility = m.activity;
      put(`wsfMemberships/${c.groupId}_${m.uid}`, row, 'membership');
    }
    for (const g of c.goals) {
      put(`wsfGoals/${g.goalId}`, {
        ownerUid, communityGroupId: c.groupId, title: g.title, target: g.target, unit: g.unit,
        status: 'active', startsAt: ts(anchorMs - g.startDaysBeforeAnchor * DAY), endsAt: ts(anchorMs + g.endDaysAfterAnchor * DAY),
        timezone: f.timezone, repeatPolicy: g.repeatPolicy, createdAt: ts(anchorMs - g.startDaysBeforeAnchor * DAY),
      }, 'goal');
      const perMember = new Map();
      g.contributions.forEach((x, i) => {
        const attemptId = `${f.fixtureId.toLowerCase()}-${g.goalId}-${String(i + 1).padStart(2, '0')}`;
        let at = anchorMs - x.minutesBeforeAnchor * MIN;
        // "today" rows stay inside the goal's own local day, whatever hour the anchor falls on
        if (x.minutesBeforeAnchor < 24 * 60 && at < dayStart) at = Math.min(anchorMs, dayStart + MIN * (i + 1));
        put(`wsfContributions/${g.goalId}_${x.uid}_${attemptId}`, {
          goalId: g.goalId, attemptId, userId: x.uid, count: x.count, shardIndex: i % SHARD_COUNT,
          unit: g.unit, communityGroupId: c.groupId, crossedTarget: false, createdAt: ts(at),
        }, 'contribution');
        put(`wsfGoals/${g.goalId}/recentAdditions/${attemptId}`, { amount: x.count, at: isoMinute(at) }, 'recentAddition');
        const t = perMember.get(x.uid) ?? { total: 0, n: 0, last: 0 };
        perMember.set(x.uid, { total: t.total + x.count, n: t.n + 1, last: Math.max(t.last, at) });
      });
      for (const [uid, t] of perMember) {
        put(`wsfGoalMemberTotals/${g.goalId}_${uid}`, { goalId: g.goalId, userId: uid, total: t.total, contributionCount: t.n, updatedAt: ts(t.last) }, 'memberTotal');
      }
    }
  }
  return docs;
}

/** Shard counts from a contribution ledger: [{shardIndex, count}] -> ten totals. */
export function shardsFromLedger(rows) {
  const s = Array(SHARD_COUNT).fill(0);
  for (const r of rows) s[((r.shardIndex % SHARD_COUNT) + SHARD_COUNT) % SHARD_COUNT] += r.count;
  return s;
}

// ---------- comparison ------------------------------------------------------

function norm(v) {
  if (v instanceof Timestamp) return { __ts: v.toMillis() };
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
  return v;
}
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

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
  if (emulatorHost) {
    return project.startsWith(f.emulatorProjectPrefix) ? null : `refused: an emulator run must use a ${f.emulatorProjectPrefix}* project, not ${project}`;
  }
  return f.allowedProjects.includes(project) ? null : `refused: ${project} is not an allowed project (${f.allowedProjects.join(', ')})`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const f = JSON.parse(readFileSync(args.fixture ? resolve(args.fixture) : FIXTURE_PATH, 'utf8'));
  const problems = validateFixture(f);
  if (problems.length) { for (const p of problems) console.error(`::error::${p}`); process.exit(2); }
  const refused = guardProject(f, args.project, process.env.FIRESTORE_EMULATOR_HOST);
  if (refused) { console.error(`::error::${refused}`); process.exit(2); }
  if (!args['owner-uid']) { console.error('::error::--owner-uid is required (the owner is verified by his Auth record, never by name)'); process.exit(2); }
  if (args.mode === 'cleanup' && args['confirm-cleanup'] !== f.fixtureId) {
    console.error(`::error::cleanup requires --confirm-cleanup ${f.fixtureId}`); process.exit(2);
  }
  initializeApp({ projectId: args.project });
  const db = getFirestore();
  const auth = getAuth();
  const ownerUid = args['owner-uid'];

  // ---- the owner, from his existing records ----
  let owner;
  try { owner = await auth.getUser(ownerUid); } catch { owner = null; }
  if (!owner) { console.error('::error::no Auth record for --owner-uid'); process.exit(3); }
  if (owner.disabled || owner.emailVerified !== true) { console.error('::error::the owner Auth record is disabled or not email-verified'); process.exit(3); }
  const ownerProfile = await db.doc(`wsfMemberProfiles/${ownerUid}`).get();
  if (!ownerProfile.exists) { console.error('::error::the owner has no wsfMemberProfiles document'); process.exit(3); }
  if (ownerUid.startsWith(f.syntheticUidPrefix)) { console.error('::error::the owner uid carries the synthetic prefix'); process.exit(3); }

  // ---- synthetic uids must not be real accounts ----
  for (const m of f.members) {
    let real = null;
    try { real = await auth.getUser(m.uid); } catch { real = null; }
    if (real) { console.error(`::error::${m.uid} is a real Auth account; refusing to treat it as synthetic`); process.exit(3); }
  }

  // ---- what already exists ----
  const groupSnaps = await Promise.all(f.communities.map((c) => db.doc(`wsfCommunityGroups/${c.groupId}`).get()));
  for (const s of groupSnaps) {
    if (s.exists && s.get('demoFixture.id') !== f.fixtureId) {
      console.error(`::error::${s.ref.path} exists and is not this fixture's; refusing to overwrite`); process.exit(3);
    }
  }
  const priorAnchor = groupSnaps.map((s) => (s.exists ? s.get('demoFixture.anchorMs') : null)).find((v) => Number.isFinite(v));
  const anchorMs = args.reanchor || !Number.isFinite(priorAnchor) ? Date.now() : priorAnchor;
  const joinCodes = Object.fromEntries(groupSnaps.filter((s) => s.exists).map((s) => [s.id, s.get('joinCode')]));
  const ownerMemberships = new Set();
  for (const c of f.communities) {
    const s = await db.doc(`wsfMemberships/${c.groupId}_${ownerUid}`).get();
    if (s.exists) ownerMemberships.add(c.groupId);
  }
  const docs = planDocuments(f, { ownerUid, anchorMs, existing: { joinCodes, ownerMemberships } });
  const goalIds = f.communities.flatMap((c) => c.goals.map((g) => g.goalId));

  // the owner's own data outside the fixture, fingerprinted before any write
  const ownerFingerprint = async () => {
    const mine = await db.collection('wsfMemberships').where('userId', '==', ownerUid).get();
    const outside = mine.docs.filter((d) => !f.communities.some((c) => d.id === `${c.groupId}_${ownerUid}`));
    const prof = await db.doc(`wsfMemberProfiles/${ownerUid}`).get();
    return JSON.stringify(norm({ profile: prof.data(), memberships: outside.map((d) => [d.id, d.data()]).sort() }));
  };
  const before = await ownerFingerprint();

  const receipt = { fixtureId: f.fixtureId, project: args.project, mode: args.mode, ownerUid, anchor: new Date(anchorMs).toISOString(), paths: {} };
  console.log(`fixture: ${f.fixtureId} v${f.version} · project: ${args.project}${process.env.FIRESTORE_EMULATOR_HOST ? ' (emulator)' : ''} · mode: ${args.mode}`);
  console.log(`owner: ${ownerUid} (Auth record verified, email-verified, profile present; owner memberships already in the sample groups: ${ownerMemberships.size})`);
  console.log(`anchor: ${new Date(anchorMs).toISOString()}${args.reanchor ? ' (reanchored)' : priorAnchor ? ' (kept from the existing fixture)' : ' (new)'}`);

  if (args.mode === 'cleanup') {
    const paths = new Set(docs.map((d) => d.path));
    for (const c of f.communities) paths.add(`wsfMemberships/${c.groupId}_${ownerUid}`);
    const extra = { ownerRows: [] };
    for (const g of goalIds) {
      for (let i = 0; i < SHARD_COUNT; i += 1) paths.add(`wsfGoalCounters/${g}/shards/${i}`);
      // anything recorded against a sample goal goes with the goal: seeded rows and any the owner added while reviewing
      const led = await db.collection('wsfContributions').where('goalId', '==', g).get();
      for (const d of led.docs) { if (!paths.has(d.ref.path)) extra.ownerRows.push(d.ref.path); paths.add(d.ref.path); }
      const ra = await db.collection(`wsfGoals/${g}/recentAdditions`).get();
      for (const d of ra.docs) paths.add(d.ref.path);
      const mt = await db.collection('wsfGoalMemberTotals').where('goalId', '==', g).get();
      for (const d of mt.docs) paths.add(d.ref.path);
    }
    let deleted = 0;
    for (const p of [...paths].sort()) { const r = db.doc(p); if ((await r.get()).exists) { await r.delete(); deleted += 1; } }
    const after = await ownerFingerprint();
    console.log(`CLEANUP_DELETED=${deleted} (of ${paths.size} fixture paths; rows the owner added on sample goals: ${extra.ownerRows.length})`);
    console.log(`OWNER_DATA_OUTSIDE_FIXTURE_UNCHANGED=${before === after}`);
    receipt.paths.deleted = [...paths].sort();
    if (args.receipt) writeFileSync(args.receipt, JSON.stringify(receipt, null, 2));
    process.exit(before === after ? 0 : 4);
  }

  // ---- compare desired with actual ----
  const diff = { create: [], update: [], unchanged: [] };
  for (const d of docs) {
    const s = await db.doc(d.path).get();
    if (!s.exists) diff.create.push(d);
    else if (same(s.data(), d.data)) diff.unchanged.push(d);
    else diff.update.push(d);
  }
  // shards are reconciled from the WHOLE ledger of each sample goal, so a
  // contribution the owner makes while reviewing is counted, never clobbered
  const shardDocs = [];
  for (const g of goalIds) {
    const seeded = docs.filter((d) => d.kind === 'contribution' && d.data.goalId === g).map((d) => ({ path: d.path, ...d.data }));
    const led = await db.collection('wsfContributions').where('goalId', '==', g).get();
    const byPath = new Map(led.docs.map((x) => [x.ref.path, x.data()]));
    for (const r of seeded) byPath.set(r.path, r);
    const s = shardsFromLedger([...byPath.values()]);
    for (let i = 0; i < SHARD_COUNT; i += 1) {
      const path = `wsfGoalCounters/${g}/shards/${i}`;
      const cur = await db.doc(path).get();
      const want = { count: s[i] };
      const d = { path, data: want, kind: 'shard' };
      if (!cur.exists) (s[i] === 0 ? diff.unchanged : diff.create).push(d);
      else if (same(cur.data(), want)) diff.unchanged.push(d);
      else diff.update.push(d);
    }
    console.log(`goal ${g}: ledger ${[...byPath.values()].reduce((a, r) => a + r.count, 0)} = shards ${s.reduce((a, b) => a + b, 0)}`);
  }
  const count = (arr) => Object.entries(arr.reduce((m, d) => ({ ...m, [d.kind]: (m[d.kind] ?? 0) + 1 }), {})).map(([k, v]) => `${k}:${v}`).join(' ') || 'none';
  console.log(`CREATE=${diff.create.length} [${count(diff.create)}]`);
  console.log(`UPDATE=${diff.update.length} [${count(diff.update)}]`);
  console.log(`UNCHANGED=${diff.unchanged.length}`);
  receipt.paths = { create: diff.create.map((d) => d.path), update: diff.update.map((d) => d.path) };

  if (args.mode === 'verify') {
    const ok = diff.create.length === 0 && diff.update.length === 0;
    console.log(`VERIFY=${ok ? 'pass' : 'drift'}`);
    if (args.receipt) writeFileSync(args.receipt, JSON.stringify(receipt, null, 2));
    process.exit(ok ? 0 : 5);
  }
  if (args.mode === 'plan') {
    console.log('PLAN ONLY: nothing written (pass --apply to converge)');
    if (args.receipt) writeFileSync(args.receipt, JSON.stringify(receipt, null, 2));
    return;
  }
  // ---- apply ----
  const writes = [...diff.create, ...diff.update];
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    for (const d of writes.slice(i, i + 400)) batch.set(db.doc(d.path), d.data);
    await batch.commit();
  }
  const after = await ownerFingerprint();
  console.log(`APPLIED=${writes.length}`);
  console.log(`OWNER_DATA_OUTSIDE_FIXTURE_UNCHANGED=${before === after}`);
  if (args.receipt) writeFileSync(args.receipt, JSON.stringify(receipt, null, 2));
  process.exit(before === after ? 0 : 4);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`::error::${e.message}`); process.exit(1); });
}
