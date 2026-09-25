#!/usr/bin/env node
/**
 * The emulator dry run for SOCIAL-STAGING-DEMO-1. Local Firestore + Auth
 * emulators only; it refuses to start without both emulator hosts and a
 * demo-* project. It drives the real seed-social-demo.mjs as a child process
 * through every mode and guard and checks the results by reading the emulator.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     node <repo>/scripts/westayfit/staging-demo/emulator-dry-run.mjs --project demo-wsf-local
 *   (run from a directory where firebase-admin is installed)
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SEED = resolve(HERE, 'seed-social-demo.mjs');
const f = (await import(resolve(HERE, 'social-demo.fixture.json'), { with: { type: 'json' } })).default;
const req = createRequire(join(process.cwd(), 'noop.js'));
const { initializeApp } = req('firebase-admin/app');
const { getAuth } = req('firebase-admin/auth');
const { getFirestore, FieldValue } = req('firebase-admin/firestore');

const pi = process.argv.indexOf('--project');
const PROJECT = pi >= 0 ? process.argv[pi + 1] : '';
const FS = process.env.FIRESTORE_EMULATOR_HOST;
const AU = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!FS || !AU || !PROJECT.startsWith('demo-')) {
  console.error('refused: needs FIRESTORE_EMULATOR_HOST, FIREBASE_AUTH_EMULATOR_HOST and a demo-* --project');
  process.exit(2);
}
initializeApp({ projectId: PROJECT });
const db = getFirestore();
const auth = getAuth();
const { lookupUser, AuthLookupError } = await import(SEED);
let passed = 0;
const ok = (name) => { passed += 1; console.log(`  ok  ${name}`); };

function seed(args, env = {}) {
  return new Promise((res) => {
    const c = spawn(process.execPath, [SEED, ...args], { env: { ...process.env, ...env } });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => res({ code, out }));
  });
}
const line = (out, key) => (out.match(new RegExp(`^${key}=(\\S+)`, 'm')) || [])[1];
async function wipe() {
  await fetch(`http://${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://${AU}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}
async function allDocs() {
  const out = [];
  const walk = async (ref) => {
    const cols = ref ? await ref.listCollections() : await db.listCollections();
    for (const c of cols) {
      const snap = await c.get();
      for (const d of snap.docs) { out.push(d); await walk(d.ref); }
      for (const d of await c.listDocuments()) if (!snap.docs.some((x) => x.id === d.id)) await walk(d);
    }
  };
  await walk(null);
  return out;
}
const snapshot = async () => JSON.stringify((await allDocs()).map((d) => [d.ref.path, d.data()]).sort());
async function totals(goalId) {
  const led = await db.collection('wsfContributions').where('goalId', '==', goalId).get();
  const ledger = led.docs.reduce((a, d) => a + d.get('count'), 0);
  let shards = 0;
  for (let i = 0; i < 10; i += 1) { const s = await db.doc(`wsfGoalCounters/${goalId}/shards/${i}`).get(); shards += s.exists ? s.get('count') : 0; }
  const mts = await db.collection('wsfGoalMemberTotals').where('goalId', '==', goalId).get();
  const memberTotals = mts.docs.reduce((a, d) => a + (d.get('total') ?? 0), 0);
  return { ledger, shards, memberTotals, rows: led.docs };
}

// An owner contribution recorded the way wsfContribute records one: the row,
// its shard and his member total in one transaction. Written as a module so
// the seed can await it BETWEEN its own reads and its commit (emulator seam).
const hookDir = mkdtempSync(join(tmpdir(), 'wsf-demo-hook-'));
const HOOK = join(hookDir, 'hook.mjs');
writeFileSync(HOOK, `
import { createRequire } from 'node:module';
import { join } from 'node:path';
const { FieldValue } = createRequire(join(process.cwd(), 'noop.js'))('firebase-admin/firestore');
let n = 0;
export default async function (db) {
  n += 1;
  const action = process.env.HOOK_ACTION || 'contribute';
  if (action !== 'contribute') {
    if (n !== 1) return; // each collision is injected once
    const uid = process.env.HOOK_OWNER;
    if (action === 'rejoin') await db.doc('wsfMemberships/wsfdemo-sample-movers_' + uid).set({ groupId: 'wsfdemo-sample-movers', userId: uid, role: 'member', membershipStatus: 'active', communityActivityVisibility: 'private' });
    if (action === 'replaceProfile') await db.doc('wsfMemberProfiles/wsfdemo-m07').set({ displayName: 'Somebody else now' });
    if (action === 'plantAddition') await db.doc('wsfGoals/wsfdemo-goal-movers-squats/recentAdditions/social-staging-demo-1-wsfdemo-goal-movers-squats-01').set({ amount: 999, at: 'not the fixture' });
    if (action === 'replaceShard') await db.doc('wsfGoalCounters/wsfdemo-goal-movers-squats/shards/0').set({ count: 50 });
    if (action === 'replaceAddition') await db.doc(process.env.HOOK_PATH).set({ amount: 999, at: 'someone else' });
    if (action === 'replaceLedgerRow') await db.doc(process.env.HOOK_PATH).set({ goalId: 'wsfdemo-goal-movers-squats', userId: 'someone-else', count: 5 });
    if (action === 'plantLaterTotal') await db.doc('wsfGoalMemberTotals/wsfdemo-goal-movers-squats_wsfdemo-m12').set({ goalId: 'wsfdemo-goal-movers-squats', userId: 'wsfdemo-m12', total: 999 });
    return;
  }
  const g = 'wsfdemo-goal-movers-squats', uid = process.env.HOOK_OWNER, a = 'owner-hook-' + process.env.HOOK_TAG + '-' + n;
  // like the product: the addition carries the minute of 'now', the row is stamped at commit
  const at = new Date(Math.floor(Date.now() / 60000) * 60000).toISOString();
  await db.runTransaction(async (tx) => {
    tx.create(db.doc('wsfContributions/' + g + '_' + uid + '_' + a), { goalId: g, attemptId: a, userId: uid, count: 7, shardIndex: n % 10, unit: 'squats', communityGroupId: 'wsfdemo-sample-movers', crossedTarget: false, createdAt: FieldValue.serverTimestamp() });
    tx.create(db.doc('wsfGoals/' + g + '/recentAdditions/' + a), { amount: 7, at });
    tx.set(db.doc('wsfGoalCounters/' + g + '/shards/' + (n % 10)), { count: FieldValue.increment(7) }, { merge: true });
    tx.set(db.doc('wsfGoalMemberTotals/' + g + '_' + uid), { goalId: g, userId: uid, total: FieldValue.increment(7), contributionCount: FieldValue.increment(1) }, { merge: true });
  });
}
`);

await wipe();
const OWNER = 'emu-owner-0001';
await auth.createUser({ uid: OWNER, emailVerified: true, displayName: 'Emulator Owner' });
await db.doc(`wsfMemberProfiles/${OWNER}`).set({ displayName: 'Emulator Owner', createdAt: new Date(0) });
await db.doc('wsfCommunityGroups/emu-owner-home').set({ displayName: 'Owner Home', groupType: 'custom', joinPolicy: 'private', joinCode: 'x'.repeat(22), lifecycleStatus: 'active', isSample: false });
await db.doc(`wsfMemberships/emu-owner-home_${OWNER}`).set({ groupId: 'emu-owner-home', userId: OWNER, role: 'foundingChampion', membershipStatus: 'active', communityNameVisibility: 'private' });
const base = ['--project', PROJECT, '--owner-uid', OWNER];
const GOAL_A = 'wsfdemo-goal-movers-squats';

// ---- project and argument guards ----
assert.match((await seed(['--plan', '--project', 'westayfit-staging', '--owner-uid', OWNER])).out, /emulator run must use a demo-\* project/);
ok('an emulator run naming westayfit-staging is refused');
assert.match((await seed(['--plan', '--project', 'goarrive', '--owner-uid', OWNER], { FIRESTORE_EMULATOR_HOST: '' })).out, /goarrive is not an allowed project/);
ok('a non-emulator run against any project but westayfit-staging is refused (goarrive)');
assert.match((await seed(['--plan', '--project', PROJECT])).out, /--owner-uid is required/);
ok('no owner uid: refused, and no name lookup is attempted');
assert.match((await seed(['--cleanup', ...base])).out, /cleanup requires --confirm-cleanup SOCIAL-STAGING-DEMO-1/);
ok('cleanup without the confirmation token is refused');

// ---- Auth: only user-not-found is absence ----
const stub = (err) => ({ getUser: async () => { throw err; } });
assert.equal(await lookupUser(stub({ code: 'auth/user-not-found' }), 'x'), null);
for (const code of ['auth/insufficient-permission', 'auth/internal-error', 'app/network-error']) {
  await assert.rejects(lookupUser(stub({ code }), 'wsfdemo-m01'), (e) => e instanceof AuthLookupError && e.code === code);
}
await assert.rejects(lookupUser(stub(new Error('socket hang up')), 'wsfdemo-m01'), AuthLookupError);
ok('lookupUser: auth/user-not-found is absence; insufficient-permission, internal-error, network-error and an uncoded error all throw');
await auth.createUser({ uid: 'emu-unverified', emailVerified: false });
await db.doc('wsfMemberProfiles/emu-unverified').set({ displayName: 'Unverified' });
assert.match((await seed(['--plan', '--project', PROJECT, '--owner-uid', 'emu-unverified'])).out, /disabled or not email-verified/);
ok('an unverified owner account is refused');
assert.match((await seed(['--plan', '--project', PROJECT, '--owner-uid', 'emu-no-such'])).out, /no Auth record for --owner-uid \(auth\/user-not-found\)/);
ok('an owner uid with no Auth record is refused');
await auth.createUser({ uid: 'wsfdemo-m05', emailVerified: true });
assert.match((await seed(['--plan', ...base])).out, /wsfdemo-m05 is a real Auth account/);
await auth.deleteUser('wsfdemo-m05');
ok('a synthetic uid that is a real Auth account is refused');
// A proxy in front of the Auth emulator answers every SYNTHETIC-uid lookup
// with a permission error. bcfef524 read that as "absent" and wrote 100
// documents; the corrected script must abort and write nothing.
const [ah, ap] = AU.split(':');
const proxy = http.createServer((rq, rs) => {
  let body = '';
  rq.on('data', (d) => { body += d; });
  rq.on('end', () => {
    if (rq.url.includes('accounts:lookup') && body.includes('wsfdemo-')) {
      rs.writeHead(403, { 'content-type': 'application/json' });
      return rs.end(JSON.stringify({ error: { code: 403, message: 'PERMISSION_DENIED', status: 'PERMISSION_DENIED' } }));
    }
    const up = http.request({ host: ah, port: Number(ap), path: rq.url, method: rq.method, headers: rq.headers }, (r) => { rs.writeHead(r.statusCode, r.headers); r.pipe(rs); });
    up.end(body);
  });
});
await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
const proxied = { FIREBASE_AUTH_EMULATOR_HOST: `127.0.0.1:${proxy.address().port}` };
for (const mode of ['--plan', '--apply']) {
  const s0 = await snapshot();
  const r = await seed([mode, ...base], proxied);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /Auth lookup for wsfdemo-m01 failed with \S+; refusing to treat it as absence \[AUTH_ERROR=\S+\]/);
  assert.equal(await snapshot(), s0, `${mode}: nothing may be written`);
}
const deadAuth = await seed(['--apply', ...base], { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9' });
assert.equal(deadAuth.code, 3, deadAuth.out);
assert.match(deadAuth.out, /Auth lookup for emu-owner-0001 failed with \S+; refusing to treat it as absence/);
proxy.close();
ok('a permission error on the synthetic-uid lookups aborts plan and apply with AUTH_ERROR named and zero writes; an unreachable Auth endpoint on the owner lookup is reported as a lookup failure, not as a missing account');

// ---- foreign documents at fixture paths fail closed, before any write ----
const foreignCases = [
  ['wsfCommunityGroups/wsfdemo-sample-movers', { displayName: 'somebody else' }],
  ['wsfMemberProfiles/wsfdemo-m03', { displayName: 'A real person' }],
  ['wsfGoals/wsfdemo-goal-movers-squats', { title: 'someone else’s goal', communityGroupId: 'elsewhere' }],
  ['wsfMemberships/wsfdemo-sample-walkers_wsfdemo-m04', { groupId: 'wsfdemo-sample-walkers', userId: 'wsfdemo-m04', role: 'member', membershipStatus: 'active' }],
  // the OWNER's row in a sample group that this fixture did not write, carrying his explicit preference
  [`wsfMemberships/wsfdemo-sample-movers_${OWNER}`, { groupId: 'wsfdemo-sample-movers', userId: OWNER, role: 'member', membershipStatus: 'active', communityActivityVisibility: 'private' }],
  // an unrelated document at a deterministic recent-addition path
  [`wsfGoals/${'wsfdemo-goal-movers-squats'}/recentAdditions/social-staging-demo-1-wsfdemo-goal-movers-squats-01`, { amount: 999, at: 'not the fixture' }],
  // W7's G2 reproducers: a pre-existing shard and a pre-existing synthetic member total
  ['wsfGoalCounters/wsfdemo-goal-movers-squats/shards/0', { count: 50 }],
  ['wsfGoalMemberTotals/wsfdemo-goal-movers-squats_wsfdemo-m01', { goalId: 'wsfdemo-goal-movers-squats', userId: 'wsfdemo-m01', total: 999 }],
];
for (const [p, data] of foreignCases) {
  await db.doc(p).set(data);
  const s0 = await snapshot();
  const r = await seed(['--apply', ...base]);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, new RegExp(`FOREIGN=1: ${p.replace(/[/]/g, '\\/')}`));
  assert.equal(await snapshot(), s0, `${p}: nothing may be written`);
  await db.doc(p).delete();
}
ok(`a foreign document at any of ${foreignCases.length} kinds of fixture path (group, profile, goal, membership, the owner's sample membership, a recent-addition path, a counter shard, a synthetic member total) makes apply refuse with FOREIGN named and zero writes: nothing merged into shard 50 or total 999`);

// ---- plan writes nothing ----
const s0 = await snapshot();
const plan = await seed(['--plan', ...base]);
assert.equal(plan.code, 0, plan.out);
assert.equal(await snapshot(), s0, 'plan must write nothing');
const planned = Number(line(plan.out, 'CREATE'));
assert.ok(planned > 0);
ok(`plan is read-only and reports CREATE=${planned}`);

// ---- G2a: a shard replaced after preflight is re-proven inside the ledger transaction ----
const goalAFixture = f.communities.flatMap((c) => c.goals).find((g) => g.goalId === GOAL_A);
const ROW_A01 = `wsfContributions/${GOAL_A}_${goalAFixture.contributions[0].uid}_social-staging-demo-1-${GOAL_A}-01`;
const ADD_A01 = `wsfGoals/${GOAL_A}/recentAdditions/social-staging-demo-1-${GOAL_A}-01`;
{
  const shard = `wsfGoalCounters/${GOAL_A}/shards/0`;
  const r = await seed(['--apply', ...base], { WSF_DEMO_TEST_INTERLEAVE: HOOK, HOOK_OWNER: OWNER, HOOK_ACTION: 'replaceShard' });
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, new RegExp(`APPLY_INCOMPLETE: ${shard.replace(/[/]/g, '\\/')} is not this fixture's \\(missing, unmarked or foreign\\); refusing to increment it`));
  assert.deepEqual((await db.doc(shard).get()).data(), { count: 50 }, 'the replacement shard is not incremented');
  assert.equal((await db.doc(ROW_A01).get()).exists, false, "that row's ledger write did not happen");
  assert.equal((await db.doc(ADD_A01).get()).exists, false, "nor its addition");
  await db.doc(shard).set({ count: 0, demoFixture: f.fixtureId });
  ok(`G2a: a shard replaced without the marker inside the first ledger transaction is refused before that row's writes (APPLY_INCOMPLETE names it, exit 3), and stays { count: 50 }`);
}

// ---- P2: a collision that appears AFTER classification stops the run explicitly ----
{
  const planted = 'wsfGoalMemberTotals/wsfdemo-goal-movers-squats_wsfdemo-m12';
  const p2 = await seed(['--apply', ...base], { WSF_DEMO_TEST_INTERLEAVE: HOOK, HOOK_OWNER: OWNER, HOOK_ACTION: 'plantLaterTotal' });
  assert.equal(p2.code, 3, p2.out);
  assert.match(p2.out, new RegExp(`APPLY_INCOMPLETE: ${planted.replace(/[/]/g, '\\/')} is not this fixture's; refusing to merge into it`));
  const partial = Number(line(p2.out, 'PARTIAL_WRITES'));
  assert.ok(partial > 0, 'earlier rows committed before the collision');
  assert.equal(/^APPLIED=/m.test(p2.out), false, 'a stopped run never reports itself as applied');
  assert.equal((await db.doc(planted).get()).get('total'), 999, 'nothing merged into the planted total');
  const again = await seed(['--plan', ...base]);
  assert.match(again.out, new RegExp(`FOREIGN=1: ${planted.replace(/[/]/g, '\\/')}`));
  await db.doc(planted).delete();
  ok(`a member total planted mid-run stops apply at that row: APPLY_INCOMPLETE names it, PARTIAL_WRITES=${partial} are declared (not "0 writes"), nothing merges into it, and the next plan still reports it`);
}

// ---- apply WITH an owner contribution landing inside every ledger transaction ----
const a1 = await seed(['--apply', ...base], { WSF_DEMO_TEST_INTERLEAVE: HOOK, HOOK_OWNER: OWNER, HOOK_TAG: 'apply' });
assert.equal(a1.code, 0, a1.out);
assert.equal(line(a1.out, 'OWNER_DATA_OUTSIDE_FIXTURE_UNCHANGED'), 'true');
let tA = await totals(GOAL_A);
const hookRows1 = tA.rows.filter((d) => d.get('userId') === OWNER);
assert.ok(hookRows1.length > 0, 'the interleaved owner contributions happened');
assert.equal(tA.ledger, 445 + 7 * hookRows1.length);
assert.equal(tA.shards, tA.ledger);
assert.equal(tA.memberTotals, tA.ledger);
ok(`the re-run after that partial apply reconciles it, with ${hookRows1.length} owner contributions interleaved between its reads and its commits: none lost (ledger ${tA.ledger} = shards ${tA.shards} = member totals ${tA.memberTotals} = 445 seeded + ${7 * hookRows1.length} owner)`);

// ---- idempotence ----
const a2 = await seed(['--apply', ...base]);
assert.equal(a2.code, 0, a2.out);
assert.equal(line(a2.out, 'APPLIED'), '0');
assert.equal(line(a2.out, 'CREATE'), '0');
assert.equal(line(a2.out, 'REANCHOR'), '0');
ok('second apply is a no-op: CREATE=0 REANCHOR=0 APPLIED=0');
const v1 = await seed(['--verify', ...base]);
assert.equal(line(v1.out, 'VERIFY'), 'pass', v1.out);
ok('verify passes on the seeded state');

// ---- the state itself ----
const vis = (d, k) => (d.get(k) === 'private' ? 'private' : 'visible');
for (const c of f.communities) {
  const g = await db.doc(`wsfCommunityGroups/${c.groupId}`).get();
  assert.equal(g.get('isSample'), true);
  assert.match(g.get('displayName'), /^Sample Community: /);
  assert.equal(g.get('joinPolicy'), 'private');
  const ms = await db.collection('wsfMemberships').where('groupId', '==', c.groupId).where('membershipStatus', '==', 'active').get();
  assert.equal(ms.size, c.members.length + 1);
  assert.equal(ms.docs.find((d) => d.get('userId') === OWNER).get('role'), 'foundingChampion');
  const syn = ms.docs.filter((d) => d.get('userId') !== OWNER);
  const mix = { named: 0, nameOffActivityOn: 0, activityOff: 0 };
  for (const d of syn) {
    if (vis(d, 'communityActivityVisibility') === 'private') mix.activityOff += 1;
    else if (vis(d, 'communityNameVisibility') === 'private') mix.nameOffActivityOn += 1;
    else mix.named += 1;
  }
  assert.ok(mix.named > 0 && mix.nameOffActivityOn > 0 && mix.activityOff > 0, JSON.stringify(mix));
  for (const goal of c.goals) {
    const t = await totals(goal.goalId);
    const seeded = t.rows.filter((d) => d.get('userId').startsWith('wsfdemo-'));
    assert.equal(seeded.reduce((a, d) => a + d.get('count'), 0), goal.contributions.reduce((a, x) => a + x.count, 0));
    assert.equal(t.shards, t.ledger);
    assert.equal(t.memberTotals, t.ledger);
    ok(`${c.groupId}: ${syn.length} synthetic + owner as Champion; mix ${JSON.stringify(mix)}; ${goal.goalId} seeded ${seeded.length} rows; ledger ${t.ledger} = shards = member totals`);
  }
}
assert.ok(!(await auth.listUsers()).users.some((u) => u.uid.startsWith('wsfdemo-')));
const fixtureDocs = (await allDocs()).filter((d) => d.ref.path.includes('wsfdemo-'));
assert.deepEqual(fixtureDocs.filter((d) => /email|phone|photo|avatar|invite/i.test(JSON.stringify(Object.keys(d.data())))).map((d) => d.ref.path), []);
ok(`no Auth account for any synthetic member; ${fixtureDocs.length} fixture documents carry no email, phone, photo, avatar or invite field`);

// ---- G2 under an existing goal: a shard that lost its marker, or went missing, is foreign ----
{
  const shard = `wsfGoalCounters/${GOAL_A}/shards/3`;
  const keptShard = (await db.doc(shard).get()).data();
  await db.doc(shard).set({ count: keptShard.count });
  const s0 = await snapshot();
  const r = await seed(['--apply', ...base]);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, new RegExp(`FOREIGN=1: ${shard.replace(/[/]/g, '\\/')}`));
  assert.equal(await snapshot(), s0, 'nothing written');
  await db.doc(shard).delete();
  const r2 = await seed(['--plan', ...base]);
  assert.match(r2.out, new RegExp(`FOREIGN=1: ${shard.replace(/[/]/g, '\\/')}`), 'a missing shard under a fixture goal cannot be proven either');
  await db.doc(shard).set(keptShard);
  assert.equal(line((await seed(['--verify', ...base])).out, 'VERIFY'), 'pass');
  ok('under an existing fixture goal, a shard without the marker, or missing, is FOREIGN: apply refuses with zero writes');
}

// ---- P1: restoring a missing addition that meets a foreign document fails NOW ----
{
  const addPath = `wsfGoals/${GOAL_A}/recentAdditions/social-staging-demo-1-wsfdemo-goal-movers-squats-01`;
  const kept = (await db.doc(addPath).get()).data();
  await db.doc(addPath).delete();
  const p1 = await seed(['--apply', ...base], { WSF_DEMO_TEST_INTERLEAVE: HOOK, HOOK_OWNER: OWNER, HOOK_ACTION: 'plantAddition' });
  assert.equal(p1.code, 3, p1.out);
  assert.match(p1.out, new RegExp(`APPLY_INCOMPLETE: ${addPath.replace(/[/]/g, '\\/')} is not this fixture's \\(it appeared while restoring a missing addition\\)`));
  assert.equal((await db.doc(addPath).get()).get('amount'), 999, 'the foreign document is preserved');
  await db.doc(addPath).set(kept);
  assert.equal(line((await seed(['--verify', ...base])).out, 'VERIFY'), 'pass');
  ok('restoring a missing recent addition that meets a foreign document preserves it and fails the run at once (exit 3, path named), instead of exiting 0');
}

// ---- review-time changes are kept, never reset ----
await db.doc(`wsfMemberships/wsfdemo-sample-movers_${OWNER}`).update({ communityNameVisibility: 'private' });
await db.doc(`wsfGoals/${GOAL_A}`).update({ title: 'Owner renamed this goal during review', target: 2500 });
const a3 = await seed(['--apply', ...base]);
assert.equal(a3.code, 0, a3.out);
assert.match(a3.out, new RegExp(`DRIFT=1 \\[goal:1\\] kept, not reset: wsfGoals\\/${GOAL_A}`));
assert.equal((await db.doc(`wsfGoals/${GOAL_A}`).get()).get('title'), 'Owner renamed this goal during review');
assert.equal((await db.doc(`wsfMemberships/wsfdemo-sample-movers_${OWNER}`).get()).get('communityNameVisibility'), 'private');
const v2 = await seed(['--verify', ...base]);
assert.equal(v2.code, 5);
assert.equal(line(v2.out, 'VERIFY'), 'drift');
ok("the owner's review-time goal edit and privacy choice survive a re-run; the goal is reported as DRIFT, and verify says VERIFY=drift rather than pass");

// ---- reanchor, again with owner contributions interleaved ----
const before = (await totals(GOAL_A)).ledger;
const r1 = await seed(['--apply', '--reanchor', ...base], { WSF_DEMO_TEST_INTERLEAVE: HOOK, HOOK_OWNER: OWNER, HOOK_TAG: 'reanchor' });
assert.equal(r1.code, 0, r1.out);
assert.ok(Number(line(r1.out, 'REANCHOR')) > 0);
tA = await totals(GOAL_A);
const hookRows2 = tA.rows.filter((d) => d.get('attemptId').startsWith('owner-hook-reanchor-'));
assert.ok(hookRows2.length > 0);
assert.equal(tA.ledger, before + 7 * hookRows2.length);
assert.equal(tA.shards, tA.ledger);
assert.equal(tA.memberTotals, tA.ledger);
assert.equal((await db.doc(`wsfGoals/${GOAL_A}`).get()).get('title'), 'Owner renamed this goal during review');
const v3 = await seed(['--verify', ...base]);
assert.equal(line(v3.out, 'VERIFY'), 'drift', v3.out);
assert.match(v3.out, /REANCHOR=0/);
ok(`--reanchor with ${hookRows2.length} owner contributions interleaved: timestamps move, none lost (ledger ${tA.ledger} = shards = member totals), the owner's goal edit is still kept`);

// ---- cleanup fails closed on an unowned owner membership and on a recent-addition collision ----
{
  const ownerRow = `wsfMemberships/wsfdemo-sample-movers_${OWNER}`;
  const kept = (await db.doc(ownerRow).get()).data();
  await db.doc(ownerRow).set({ groupId: 'wsfdemo-sample-movers', userId: OWNER, role: 'member', membershipStatus: 'active', communityActivityVisibility: 'private' });
  const sA = await snapshot();
  const cA = await seed(['--cleanup', ...base, '--confirm-cleanup', f.fixtureId]);
  assert.equal(cA.code, 3, cA.out);
  assert.match(cA.out, new RegExp(`FOREIGN=1: ${ownerRow.replace(/[/]/g, '\\/')}`));
  assert.equal(await snapshot(), sA, 'nothing deleted');
  assert.equal((await db.doc(ownerRow).get()).get('communityActivityVisibility'), 'private', 'his preference survives');
  await db.doc(ownerRow).set(kept);
  const addPath = `wsfGoals/${GOAL_A}/recentAdditions/social-staging-demo-1-wsfdemo-goal-movers-squats-01`;
  const keptAdd = (await db.doc(addPath).get()).data();
  await db.doc(addPath).set({ amount: 999, at: 'not the fixture' });
  const sB = await snapshot();
  const cB = await seed(['--cleanup', ...base, '--confirm-cleanup', f.fixtureId]);
  assert.equal(cB.code, 3, cB.out);
  assert.match(cB.out, new RegExp(`FOREIGN=1: ${addPath.replace(/[/]/g, '\\/')}`));
  assert.equal(await snapshot(), sB, 'nothing deleted');
  await db.doc(addPath).set(keptAdd);
  ok("cleanup refuses, deleting nothing, over an owner sample-membership this fixture did not write (his preference kept) and over a recent-addition collision");
}

// ---- cleanup fails closed on a foreign document, then deletes only the fixture ----
await db.doc('wsfMemberProfiles/wsfdemo-m07').set({ displayName: 'Now somebody else' });
const s1 = await snapshot();
const c0 = await seed(['--cleanup', ...base, '--confirm-cleanup', f.fixtureId]);
assert.equal(c0.code, 3, c0.out);
assert.match(c0.out, /FOREIGN=1: wsfMemberProfiles\/wsfdemo-m07/);
assert.equal(await snapshot(), s1, 'a refused cleanup deletes nothing');
await db.doc('wsfMemberProfiles/wsfdemo-m07').set({ displayName: 'Gus Sample', demoFixture: f.fixtureId });
ok('cleanup with a foreign document at a fixture path refuses and deletes nothing');

// ---- G1: ownership that changes DURING cleanup is re-checked at delete time ----
{
  const ownerRow = `wsfMemberships/wsfdemo-sample-movers_${OWNER}`;
  const g1a = await seed(['--cleanup', ...base, '--confirm-cleanup', f.fixtureId], { WSF_DEMO_TEST_INTERLEAVE: HOOK, HOOK_OWNER: OWNER, HOOK_ACTION: 'rejoin' });
  assert.equal(g1a.code, 3, g1a.out);
  assert.match(g1a.out, new RegExp(`CLEANUP_PRESERVED=1: ${ownerRow.replace(/[/]/g, '\\/')} \\(preserved: no longer provably this fixture's\\)`));
  assert.equal((await db.doc(ownerRow).get()).get('communityActivityVisibility'), 'private', 'his rejoined row and its preference survive');
  assert.deepEqual((await allDocs()).map((d) => d.ref.path).filter((p) => p.includes('wsfdemo-')), [ownerRow], 'everything else of the fixture is gone');
  ok('a leave-and-rejoin that rewrites the owner row without the marker DURING cleanup: that row is preserved with his preference, cleanup exits 3 naming it');
  await db.doc(ownerRow).delete();
  assert.equal((await seed(['--apply', ...base])).code, 0);
  const g1b = await seed(['--cleanup', ...base, '--confirm-cleanup', f.fixtureId], { WSF_DEMO_TEST_INTERLEAVE: HOOK, HOOK_OWNER: OWNER, HOOK_ACTION: 'replaceProfile' });
  assert.equal(g1b.code, 3, g1b.out);
  assert.match(g1b.out, /CLEANUP_PRESERVED=1: wsfMemberProfiles\/wsfdemo-m07 \(preserved: no longer provably this fixture's\)/);
  assert.equal((await db.doc('wsfMemberProfiles/wsfdemo-m07').get()).get('displayName'), 'Somebody else now');
  ok('a synthetic profile replaced DURING cleanup is preserved and named; cleanup exits 3');
  await db.doc('wsfMemberProfiles/wsfdemo-m07').delete();
}

// ---- G1b: an attached ledger row or recent addition replaced DURING cleanup is preserved ----
{
  assert.equal((await seed(['--apply', ...base])).code, 0);
  const cA = await seed(['--cleanup', ...base, '--confirm-cleanup', f.fixtureId], { WSF_DEMO_TEST_INTERLEAVE: HOOK, HOOK_OWNER: OWNER, HOOK_ACTION: 'replaceAddition', HOOK_PATH: ADD_A01 });
  assert.equal(cA.code, 3, cA.out);
  assert.match(cA.out, new RegExp(`CLEANUP_PRESERVED=1: ${ADD_A01.replace(/[/]/g, '\\/')} \\(preserved: not the recent addition linked to this fixture's row\\)`));
  assert.deepEqual((await db.doc(ADD_A01).get()).data(), { amount: 999, at: 'someone else' });
  assert.deepEqual((await allDocs()).map((d) => d.ref.path).filter((p) => p.includes('wsfdemo-')), [ADD_A01], 'everything else of the fixture is gone');
  await db.doc(ADD_A01).delete();
  ok('G1b: a recent addition replaced by { amount: 999, at: "someone else" } DURING cleanup is preserved and named; cleanup exits 3');
  assert.equal((await seed(['--apply', ...base])).code, 0);
  const cB = await seed(['--cleanup', ...base, '--confirm-cleanup', f.fixtureId], { WSF_DEMO_TEST_INTERLEAVE: HOOK, HOOK_OWNER: OWNER, HOOK_ACTION: 'replaceLedgerRow', HOOK_PATH: ROW_A01 });
  assert.equal(cB.code, 3, cB.out);
  assert.match(cB.out, new RegExp(`CLEANUP_PRESERVED=2: ${ROW_A01.replace(/[/]/g, '\\/')} \\(preserved: no longer provably this fixture's\\), ${ADD_A01.replace(/[/]/g, '\\/')} \\(preserved: its ledger row is not provably this fixture's\\)`));
  assert.deepEqual((await db.doc(ROW_A01).get()).data(), { goalId: GOAL_A, userId: 'someone-else', count: 5 });
  assert.deepEqual((await allDocs()).map((d) => d.ref.path).filter((p) => p.includes('wsfdemo-')).sort(), [ROW_A01, ADD_A01].sort());
  await db.doc(ROW_A01).delete();
  await db.doc(ADD_A01).delete();
  ok('G1b: a ledger row replaced by { same goal, userId: someone-else, count: 5 } DURING cleanup is preserved and named, with the addition it can no longer vouch for; cleanup exits 3');
}

// ---- a clean seed, then a clean cleanup ----
assert.equal((await seed(['--apply', ...base])).code, 0);
assert.equal(line((await seed(['--verify', ...base])).out, 'VERIFY'), 'pass');
const c1 = await seed(['--cleanup', ...base, '--confirm-cleanup', f.fixtureId]);
assert.equal(c1.code, 0, c1.out);
assert.equal(line(c1.out, 'CLEANUP_PRESERVED'), '0');
assert.equal(line(c1.out, 'OWNER_DATA_OUTSIDE_FIXTURE_UNCHANGED'), 'true');
assert.deepEqual((await allDocs()).map((d) => d.ref.path).filter((p) => p.includes('wsfdemo-')), []);
assert.ok((await db.doc('wsfCommunityGroups/emu-owner-home').get()).exists);
assert.equal((await db.doc(`wsfMemberships/emu-owner-home_${OWNER}`).get()).get('communityNameVisibility'), 'private');
assert.ok((await db.doc(`wsfMemberProfiles/${OWNER}`).get()).exists);
ok(`a clean re-seed then cleanup deletes every fixture document (${line(c1.out, 'CLEANUP_DELETED')}), preserves nothing, and leaves the owner's own data intact`);

console.log(`\nemulator dry run: ${passed} passed`);
