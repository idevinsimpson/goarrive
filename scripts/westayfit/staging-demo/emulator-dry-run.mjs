#!/usr/bin/env node
/**
 * The emulator dry run for SOCIAL-STAGING-DEMO-1. Local Firestore + Auth
 * emulators only; it refuses to start without both emulator hosts and a
 * demo-* project. It drives the real seed-social-demo.mjs as a child process
 * through every mode and guard, and checks the results by reading the
 * emulator directly.
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *     node <repo>/scripts/westayfit/staging-demo/emulator-dry-run.mjs --project demo-wsf-local
 *   (run from a directory where firebase-admin is installed)
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
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
let passed = 0;
const ok = (name) => { passed += 1; console.log(`  ok  ${name}`); };

function seed(args, env = {}) {
  const r = spawnSync(process.execPath, [SEED, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
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

await wipe();
const OWNER = 'emu-owner-0001';
await auth.createUser({ uid: OWNER, emailVerified: true, displayName: 'Emulator Owner' });
// the owner's EXISTING data, which the fixture must leave exactly as it is
await db.doc(`wsfMemberProfiles/${OWNER}`).set({ displayName: 'Emulator Owner', createdAt: new Date(0) });
await db.doc('wsfCommunityGroups/emu-owner-home').set({ displayName: 'Owner Home', groupType: 'custom', joinPolicy: 'private', joinCode: 'x'.repeat(22), lifecycleStatus: 'active', isSample: false });
await db.doc(`wsfMemberships/emu-owner-home_${OWNER}`).set({ groupId: 'emu-owner-home', userId: OWNER, role: 'foundingChampion', membershipStatus: 'active', communityNameVisibility: 'private' });
const base = ['--project', PROJECT, '--owner-uid', OWNER];

// ---- guards ----
assert.match(seed(['--plan', '--project', 'westayfit-staging', '--owner-uid', OWNER]).out, /emulator run must use a demo-\* project/);
ok('an emulator run naming westayfit-staging is refused');
assert.match(seed(['--plan', '--project', 'goarrive', '--owner-uid', OWNER], { FIRESTORE_EMULATOR_HOST: '' }).out, /goarrive is not an allowed project/);
ok('a non-emulator run against any project but westayfit-staging is refused (goarrive)');
assert.match(seed(['--plan', '--project', PROJECT]).out, /--owner-uid is required/);
ok('no owner uid: refused, and no name lookup is attempted');
await auth.createUser({ uid: 'emu-unverified', emailVerified: false });
await db.doc('wsfMemberProfiles/emu-unverified').set({ displayName: 'Unverified' });
assert.match(seed(['--plan', '--project', PROJECT, '--owner-uid', 'emu-unverified']).out, /disabled or not email-verified/);
ok('an unverified owner account is refused');
assert.match(seed(['--plan', '--project', PROJECT, '--owner-uid', 'emu-no-such']).out, /no Auth record/);
ok('an owner uid with no Auth record is refused');
await auth.createUser({ uid: 'wsfdemo-m05', emailVerified: true });
assert.match(seed(['--plan', ...base]).out, /wsfdemo-m05 is a real Auth account/);
await auth.deleteUser('wsfdemo-m05');
ok('a synthetic uid that is a real Auth account is refused');
await db.doc('wsfCommunityGroups/wsfdemo-sample-movers').set({ displayName: 'somebody else' });
assert.match(seed(['--plan', ...base]).out, /is not this fixture's; refusing to overwrite/);
await db.doc('wsfCommunityGroups/wsfdemo-sample-movers').delete();
ok("a pre-existing group at a fixture path that is not the fixture's is refused");
assert.match(seed(['--cleanup', ...base]).out, /cleanup requires --confirm-cleanup SOCIAL-STAGING-DEMO-1/);
ok('cleanup without the confirmation token is refused');

// ---- plan writes nothing ----
const n0 = (await allDocs()).length;
const plan = seed(['--plan', ...base]);
assert.equal(plan.code, 0, plan.out);
assert.equal((await allDocs()).length, n0, 'plan must write nothing');
const planned = Number(line(plan.out, 'CREATE'));
assert.ok(planned > 0);
ok(`plan is read-only and reports CREATE=${planned}`);

// ---- apply, then apply again ----
const a1 = seed(['--apply', ...base]);
assert.equal(a1.code, 0, a1.out);
assert.equal(line(a1.out, 'APPLIED'), String(planned));
assert.equal(line(a1.out, 'OWNER_DATA_OUTSIDE_FIXTURE_UNCHANGED'), 'true');
ok(`first apply writes exactly the planned ${planned} documents and leaves the owner's own data unchanged`);
const a2 = seed(['--apply', ...base]);
assert.equal(a2.code, 0, a2.out);
assert.equal(line(a2.out, 'APPLIED'), '0');
assert.equal(line(a2.out, 'CREATE'), '0');
assert.equal(line(a2.out, 'UPDATE'), '0');
ok('second apply is a no-op: CREATE=0 UPDATE=0 APPLIED=0 (idempotent)');
const v1 = seed(['--verify', ...base]);
assert.equal(line(v1.out, 'VERIFY'), 'pass', v1.out);
ok('verify passes on the seeded state');

// ---- the state itself, read from the emulator ----
const vis = (d, k) => (d.get(k) === 'private' ? 'private' : 'visible'); // absent resolves to visible
for (const c of f.communities) {
  const g = await db.doc(`wsfCommunityGroups/${c.groupId}`).get();
  assert.equal(g.get('isSample'), true);
  assert.match(g.get('displayName'), /^Sample Community: /);
  assert.equal(g.get('joinPolicy'), 'private');
  const ms = await db.collection('wsfMemberships').where('groupId', '==', c.groupId).where('membershipStatus', '==', 'active').get();
  assert.equal(ms.size, c.members.length + 1, `${c.groupId}: synthetic members plus the owner`);
  const own = ms.docs.find((d) => d.get('userId') === OWNER);
  assert.equal(own.get('role'), 'foundingChampion');
  const syn = ms.docs.filter((d) => d.get('userId') !== OWNER);
  const mix = { named: 0, nameOffActivityOn: 0, activityOff: 0 };
  for (const d of syn) {
    if (vis(d, 'communityActivityVisibility') === 'private') mix.activityOff += 1;
    else if (vis(d, 'communityNameVisibility') === 'private') mix.nameOffActivityOn += 1;
    else mix.named += 1;
  }
  assert.ok(mix.named > 0 && mix.nameOffActivityOn > 0 && mix.activityOff > 0, JSON.stringify(mix));
  for (const goal of c.goals) {
    const led = await db.collection('wsfContributions').where('goalId', '==', goal.goalId).get();
    const ledger = led.docs.reduce((a, d) => a + d.get('count'), 0);
    let shards = 0;
    for (let i = 0; i < 10; i += 1) { const s = await db.doc(`wsfGoalCounters/${goal.goalId}/shards/${i}`).get(); shards += s.exists ? s.get('count') : 0; }
    const mts = await db.collection('wsfGoalMemberTotals').where('goalId', '==', goal.goalId).get();
    const perMember = mts.docs.reduce((a, d) => a + d.get('total'), 0);
    const ra = await db.collection(`wsfGoals/${goal.goalId}/recentAdditions`).get();
    assert.equal(ledger, goal.contributions.reduce((a, x) => a + x.count, 0));
    assert.equal(shards, ledger);
    assert.equal(perMember, ledger);
    assert.equal(ra.size, led.size);
    assert.ok(led.docs.every((d) => d.get('communityGroupId') === c.groupId && d.get('unit') === goal.unit && d.get('userId') !== OWNER));
    ok(`${c.groupId}: ${syn.length} synthetic + owner as Champion; mix ${JSON.stringify(mix)}; ${goal.goalId} ledger ${ledger} = shards ${shards} = member totals ${perMember}; ${ra.size} recent additions; no owner contribution invented`);
  }
}
const users = (await auth.listUsers()).users.map((u) => u.uid);
assert.ok(!users.some((u) => u.startsWith('wsfdemo-')));
const every = await allDocs();
const fixtureDocs = every.filter((d) => d.ref.path.includes('wsfdemo-'));
const bad = fixtureDocs.filter((d) => /email|phone|photo|avatar|invite/i.test(JSON.stringify(Object.keys(d.data()))));
assert.deepEqual(bad.map((d) => d.ref.path), []);
ok(`no Auth account for any synthetic member; ${fixtureDocs.length} fixture documents carry no email, phone, photo, avatar or invite field`);

// ---- the owner reviews: changes a preference, contributes once ----
await db.doc(`wsfMemberships/wsfdemo-sample-movers_${OWNER}`).update({ communityNameVisibility: 'private' });
const goalA = 'wsfdemo-goal-movers-squats';
await db.doc(`wsfContributions/${goalA}_${OWNER}_owner-real-1`).set({ goalId: goalA, attemptId: 'owner-real-1', userId: OWNER, count: 10, shardIndex: 3, unit: 'squats', communityGroupId: 'wsfdemo-sample-movers', crossedTarget: false, createdAt: new Date() });
await db.doc(`wsfGoalCounters/${goalA}/shards/3`).set({ count: FieldValue.increment(10) }, { merge: true });
const a3 = seed(['--apply', ...base]);
assert.equal(a3.code, 0, a3.out);
assert.equal((await db.doc(`wsfMemberships/wsfdemo-sample-movers_${OWNER}`).get()).get('communityNameVisibility'), 'private');
assert.match(a3.out, new RegExp(`goal ${goalA}: ledger 455 = shards 455`));
ok("a re-run keeps the owner's own preference change and counts his real contribution (ledger 455 = shards 455), never clobbering it");

// ---- reanchor keeps totals ----
const r1 = seed(['--apply', '--reanchor', ...base]);
assert.equal(r1.code, 0, r1.out);
assert.ok(Number(line(r1.out, 'APPLIED')) > 0);
assert.match(r1.out, new RegExp(`goal ${goalA}: ledger 455 = shards 455`));
assert.equal(line(seed(['--verify', ...base]).out, 'VERIFY'), 'pass');
ok('--reanchor moves the timestamps to today, totals unchanged, and verify passes afterwards');

// ---- cleanup ----
const c1 = seed(['--cleanup', ...base, '--confirm-cleanup', f.fixtureId]);
assert.equal(c1.code, 0, c1.out);
assert.equal(line(c1.out, 'OWNER_DATA_OUTSIDE_FIXTURE_UNCHANGED'), 'true');
const left = (await allDocs()).map((d) => d.ref.path).filter((p) => p.includes('wsfdemo-'));
assert.deepEqual(left, []);
assert.ok((await db.doc('wsfCommunityGroups/emu-owner-home').get()).exists);
assert.equal((await db.doc(`wsfMemberships/emu-owner-home_${OWNER}`).get()).get('communityNameVisibility'), 'private');
assert.ok((await db.doc(`wsfMemberProfiles/${OWNER}`).get()).exists);
ok(`cleanup deletes every fixture document (${line(c1.out, 'CLEANUP_DELETED')}), including the owner's own row on the sample goal, and nothing else: his home community, membership and profile remain`);

console.log(`\nemulator dry run: ${passed} passed`);
