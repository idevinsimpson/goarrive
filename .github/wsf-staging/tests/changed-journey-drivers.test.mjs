#!/usr/bin/env node
/**
 * The Community and Settings drivers and their fixture kit, hermetically.
 *
 * - The kit runs for real against an in-memory Identity Toolkit / Firestore,
 *   and its cleanup manifest is then handed to the REAL cleanup-synthetic.mjs
 *   over a local fake API: it must come back COMPLETE, with every account and
 *   document it created removed and read back.
 * - The drivers run for real against a scripted page that models the
 *   product's rendered contract at 938e00d8 (test IDs, role="switch",
 *   aria-checked, aria-pressed, the copy the drivers read). A faithful model
 *   passes; each seeded product defect fails the assertion that names it.
 *
 * What this cannot prove is that staging renders that contract: that is what
 * the hosted run is for, and the report says so.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { RUN_TAG, backend, expoHarness, harness, kitFor, runCleanup, serve, tmp } from './helpers/journey-model.mjs';
import { drivers } from '../journeys/index.mjs';
import { EXPO_ROWS, expoDrivers } from '../journeys/expo-attendee.mjs';
import { validateManifest } from '../milestone-manifest.mjs';
import { checkManifestObject } from '../check-milestone-manifest.mjs';
import { runHook } from '../hosted-changed-journeys.mjs';
import { isOwnedRunTag } from '../run-tag.mjs';

const CLEANUP = path.resolve('.github/wsf-staging/cleanup-synthetic.mjs');
const CARD = path.resolve('.github/wsf-staging/owner-test-card.mjs');
const EXAMPLE = path.resolve('.github/wsf-staging/journeys/examples/community-settings-parity-1.json');
let passed = 0;
const test = async (n, f) => { await f(); passed += 1; console.log(`  ok  ${n}`); };

async function drive(name, bugs = {}) {
  const h = harness(bugs);
  const r = await drivers[name]({ page: h.page, baseUrl: 'https://staging.example.test', journey: { id: name }, fixtures: h.fixtures });
  return { ...h, r, failed: r.assertions.filter((a) => !a.ok).map((a) => a.expected) };
}

// ---- the fixture kit ------------------------------------------------------------------
await test('the kit tracks every DOCUMENT before its write, and every ACCOUNT as soon as sign-up returns its uid, before any dependent write', async () => {
  const dir = tmp();
  const be = backend();
  const manifestPath = path.join(dir, 'cleanup-manifest.json');
  const inner = be.fetchImpl;
  be.fetchImpl = async (url, opts) => {
    const m = /\/documents\/(.+)$/.exec(url);
    if (m && opts.method === 'PATCH') {
      const tracked = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      assert.ok(tracked.docs.includes(decodeURIComponent(m[1])), `${m[1]} was written before it was tracked`);
      // An account's uid exists only once signUp returns; by the next write it must be tracked.
      for (const uid of be.accounts.keys()) assert.ok(tracked.users.includes(uid), `account ${uid} was not tracked before a dependent write`);
    }
    return inner(url, opts);
  };
  const kit = kitFor(dir, be);
  assert.deepEqual(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).docs, [], 'an empty manifest exists before anything is created');
  await kit.memberInTwoCommunities('community');
  assert.equal(be.docs.size, JSON.parse(fs.readFileSync(manifestPath, 'utf8')).docs.length);
});

await test('every fixture request is admin-scoped and the manifest never holds the email or password', async () => {
  const dir = tmp();
  const be = backend();
  const fx = await kitFor(dir, be).memberInTwoCommunities('settings');
  assert.ok(be.requests.every((q) => q.admin), 'a fixture write without the admin token would be a product call, not a fixture');
  const text = fs.readFileSync(path.join(dir, 'cleanup-manifest.json'), 'utf8');
  assert.equal(text.includes(fx.member.password), false);
  assert.equal(text.includes('@example.com'), false);
  assert.equal((fs.statSync(path.join(dir, 'cleanup-manifest.json')).mode & 0o777).toString(8), '600');
  assert.match(fx.member.email, new RegExp(`^wsf-${RUN_TAG}-settings-[0-9a-f]{4}@example\\.com$`));
  assert.equal(fx.setupId.includes('@'), false);
});

await test('the kit seeds the facts the drivers assert: roles, visibilities, goals in their window', async () => {
  const dir = tmp();
  const be = backend();
  const fx = await kitFor(dir, be).memberInTwoCommunities('community');
  const f = (p) => be.docs.get(p);
  assert.equal(f(`wsfMemberships/${fx.a.id}_${fx.member.uid}`).role.stringValue, 'member');
  assert.equal(f(`wsfMemberships/${fx.a.id}_${fx.member.uid}`).communityNameVisibility.stringValue, 'private');
  assert.equal(f(`wsfMemberships/${fx.b.id}_${fx.member.uid}`).role.stringValue, 'foundingChampion');
  assert.equal(f(`wsfMemberships/${fx.b.id}_${fx.member.uid}`).communityActivityVisibility.stringValue, 'private');
  assert.equal([...be.docs.keys()].filter((p) => p.startsWith(`wsfMemberships/${fx.a.id}_`)).length, fx.a.members);
  assert.equal([...be.docs.keys()].filter((p) => p.startsWith(`wsfMemberships/${fx.b.id}_`)).length, fx.b.members);
  for (const c of [fx.a, fx.b]) {
    const g = f(`wsfGoals/${c.goalId}`);
    assert.equal(g.title.stringValue, c.goalTitle);
    assert.equal(g.communityGroupId.stringValue, c.id);
    assert.ok(new Date(g.startsAt.timestampValue) < new Date('2026-09-26T12:00:00Z') && new Date(g.endsAt.timestampValue) > new Date('2026-09-26T12:00:00Z'));
  }
});

await test('the REAL cleaner accepts the kit\'s manifest and removes everything it created, read back', async () => {
  const dir = tmp();
  const be = backend();
  const kit = kitFor(dir, be);
  await kit.memberInTwoCommunities('community');
  await kit.memberInTwoCommunities('settings');
  const created = { users: be.accounts.size, docs: be.docs.size };
  assert.ok(isOwnedRunTag(RUN_TAG));
  const { server, base } = await serve(be);
  const r = await runCleanup(base, kit.manifestPath, path.join(dir, 'receipt.json'));
  server.close();
  assert.equal(r.receipt.status, 'COMPLETE', r.out);
  assert.equal(r.receipt.usersDeleted, created.users);
  assert.equal(r.receipt.documentsDeleted, created.docs);
  assert.equal(be.accounts.size + be.docs.size, 0, 'nothing the kit created is left behind');
});

await test('C4a: the cleaner writes its COMPLETE receipt BEFORE removing the manifest; an unwritable receipt leaves the manifest', async () => {
  const dir = tmp();
  const be = backend();
  const kit = kitFor(dir, be);
  await kit.memberInTwoCommunities('community');
  const blocker = path.join(dir, 'not-a-directory');
  fs.writeFileSync(blocker, 'x'); // the receipt's parent is a file, so the receipt cannot be written
  const { server, base } = await serve(be);
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, [CLEANUP], {
      env: { ...process.env, WSF_GOOGLE_ACCESS_TOKEN: 'test-token', WSF_CLEANUP_MANIFEST: kit.manifestPath,
        WSF_CLEANUP_RECEIPT: path.join(blocker, 'cleanup-receipt.json'), WSF_API_BASE: base },
    });
    child.on('close', (code) => resolve({ code }));
  });
  server.close();
  assert.equal(be.accounts.size + be.docs.size, 0, 'the fixtures themselves were removed');
  assert.notEqual(r.code, 0, 'an unwritable receipt fails the cleaner, and so the blocking step');
  assert.ok(fs.existsSync(kit.manifestPath), 'with no receipt, the manifest must survive as the record that fixtures existed');
});

// ---- the drivers against a faithful model -----------------------------------------------
await test('COMMUNITY on a faithful model: real actions, every assertion holds', async () => {
  const { r, failed } = await drive('community');
  assert.deepEqual(failed, []);
  assert.ok(r.assertions.length >= 10, `${r.assertions.length} assertions`);
  assert.deepEqual(r.actionsPerformed.map((a) => a.split(' ')[0]), ['signed', 'opened', 'pressed', 'reloaded']);
  assert.match(r.setupId, /member of A, founding Champion of B/);
});

await test('SETTINGS on a faithful model: real actions, every assertion holds', async () => {
  const { r, failed, app } = await drive('settings');
  assert.deepEqual(failed, []);
  assert.ok(r.assertions.length >= 10, `${r.assertions.length} assertions`);
  assert.ok(r.actionsPerformed.includes('pressed × Close'));
  assert.equal(app().st.panel, false);
});

await test('SETTINGS selects the community it needs through the product, not by writing storage', async () => {
  const { r, app } = await drive('settings');
  assert.deepEqual(app().st.pressed.length, 1, 'the chip was pressed once');
  assert.ok(r.actionsPerformed.some((a) => a.startsWith('pressed the Summit Journey Club chip')));
});

// ---- each seeded product defect fails the assertion that names it -------------------------
const DEFECTS = [
  ['community', { chipIgnored: true }, /after switching, the banner names/],
  ['community', { foundingLabel: true }, /Your role fact reads Champion/],
  // C5: switch, then a reload that returns to the original community.
  ['community', { reloadLosesSelection: true }, /on return, the selected community is still Summit Journey Club/],
  ['settings', { settingsIgnoresSelection: true, serverOrderBFirst: false }, /privacy sections list Summit Journey Club first/],
  ['settings', { nameAlwaysOn: true }, /Harbor Journey Crew: the name switch shows the stored value \(off\)/],
  ['settings', { noAnonymousHint: true }, /a private name is explained as "Anonymous member"/],
  ['settings', { closeBroken: true }, /Close dismisses the panel/],
];
for (const [name, bugs, re] of DEFECTS) {
  await test(`${name.toUpperCase()} fails on a seeded defect: ${Object.keys(bugs).filter((k) => bugs[k]).join(', ')}`, async () => {
    const { failed } = await drive(name, bugs);
    assert.ok(failed.some((f) => re.test(f)), `expected a failed assertion matching ${re}; failed: ${failed.join(' | ') || 'none'}`);
  });
}

await test('a sign-in that does not leave /signin throws; the driver does not continue signed out', async () => {
  const h = harness({});
  h.fixtures.signIn = (page, baseUrl, member) => h.kit.signIn(h.app().page, baseUrl, { ...member, password: 'wrong' });
  await assert.rejects(
    drivers.community({ page: h.page, baseUrl: 'https://staging.example.test', journey: { id: 'community' }, fixtures: h.fixtures }),
    /waitForURL/,
  );
});

// ---- through the hook, the cleaner and the card, as the workflow orders them ----------
/**
 * The hosted-verify sequence end to end: the runner (real registry, example
 * manifest), then the REAL cleaner over the kit's own manifest, then the card
 * CLI reading the results and the cleaner's receipt. `failDeletes` makes the
 * fake API refuse deletions, which is a cleanup that cannot complete.
 */
async function sequence({ failDeletes = false } = {}) {
  const d = tmp();
  const manifest = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  const mf = path.join(d, 'manifest.json');
  fs.writeFileSync(mf, JSON.stringify(manifest));
  const changed = path.join(d, 'evidence', 'changed-journeys');
  const env = {
    WSF_JOURNEY_MANIFEST: mf, WSF_STAGING_URL: 'https://staging.example.test',
    WSF_APPROVED_SHA: manifest.productSha, WSF_RESULT_DIR: path.join(d, 'evidence'),
  };
  const hs = {};
  const browser = {
    newContext: async () => ({ newPage: async () => new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : (...a) => hs.current.page[k](...a)) }), close: async () => {} }),
    close: async () => {},
  };
  let h = null;
  let fixturesMade = 0;
  const hook = await runHook(env, {
    fetch: async () => ({ ok: true, text: async () => `commit ${manifest.productSha.slice(0, 7)}` }),
    launch: async () => browser,
    fixtures: () => {
      fixturesMade += 1;
      h = harness({});
      hs.current = { get page() { return h.app().page; } };
      return h.fixtures;
    },
  });
  const receipt = path.join(changed, 'cleanup-receipt.json');
  const { server, base } = await serve(h.be, { failDeletes });
  const cleanup = await runCleanup(base, h.kit.manifestPath, receipt);
  server.close();
  const cardPath = path.join(changed, 'owner-test-card.md');
  const card = spawnSync(process.execPath, [CARD, '--manifest', mf, '--results', path.join(changed, 'changed-journeys.json'),
    '--cleanup-manifest', h.kit.manifestPath, '--cleanup-receipt', receipt,
    '--staging-url', 'https://staging.example.test', '--out', cardPath], { encoding: 'utf8' });
  return { hook, fixturesMade, cleanup, card, cardText: fs.existsSync(cardPath) ? fs.readFileSync(cardPath, 'utf8') : null, be: h.be };
}

await test('the runner drives both registered drivers from the example manifest, writes results only, and cleanup + card make it PASSED', async () => {
  const s = await sequence();
  assert.equal(s.fixturesMade, 1, 'one fixture kit per run');
  for (const x of s.hook.results.results) {
    assert.equal(x.status, 'passed', `${x.journeyId}: ${x.reason}`);
    assert.ok(x.actionsPerformed.length >= 4 && x.assertions.length >= 10);
    assert.equal(x.artifact, `changed-journeys/${x.journeyId}.png`);
  }
  assert.equal(s.cleanup.code, 0, s.cleanup.out);
  assert.equal(s.cleanup.receipt.status, 'COMPLETE');
  assert.equal(s.be.accounts.size + s.be.docs.size, 0);
  assert.equal(s.card.status, 0, s.card.stderr);
  assert.match(s.card.stdout, /OWNER_CARD_CLEANUP=COMPLETE\nOWNER_CARD_SUMMARY=PASSED/);
  assert.match(s.cardText, /Hosted changed-journey status: PASSED \(2 passed/);
  assert.match(s.cardText, /Changed-journey cleanup: COMPLETE — every recorded fixture removed and read back/);
  assert.match(s.cardText, /Device review: NOT RUN — Devin's verdict/);
});

await test('C4: a cleanup that cannot complete fails its step AND leaves no PASSED card, though every journey passed', async () => {
  const s = await sequence({ failDeletes: true });
  assert.ok(s.hook.results.results.every((x) => x.status === 'passed'), 'the journeys themselves passed');
  assert.notEqual(s.cleanup.code, 0, 'the cleaner exits non-zero, which fails the blocking workflow step');
  assert.equal(s.cleanup.receipt.status, 'INCOMPLETE');
  assert.ok(s.be.accounts.size + s.be.docs.size > 0, 'fixtures really remain');
  assert.equal(s.card.status, 0, s.card.stderr);
  assert.match(s.card.stdout, /OWNER_CARD_CLEANUP=INCOMPLETE\nOWNER_CARD_SUMMARY=INCOMPLETE/);
  assert.doesNotMatch(s.cardText, /status: PASSED/);
  assert.match(s.cardText, /every journey passed, but fixture cleanup is not complete/);
});

// ═════════════════════════════════════════════════════════════════════════════
// EXPO-ATTENDEE-HOSTED-DRIVERS-1: the eight attendee journeys.
// ═════════════════════════════════════════════════════════════════════════════
const LIVE = path.resolve('.github/wsf-staging/journeys/manifest.json');
const APPROVED = JSON.parse(fs.readFileSync(path.resolve('.github/wsf-staging/approved-candidate.json'), 'utf8')).approvedAppSha;
const EXPO_IDS = ['event-use-my-phone', 'event-join-line', 'two-station-turns', 'phone-and-stations-converge',
  'station-lost-answer', 'line-place-ends', 'closed-goal-turn', 'shared-screen-finish'];
const live = () => JSON.parse(fs.readFileSync(LIVE, 'utf8'));
const tagOf = (expected) => /^\[(\w+)\]/.exec(expected)?.[1];

async function driveExpo(id, bugs = {}, h = expoHarness(bugs)) {
  const used = new Set();
  const fixtures = new Proxy(h.fixtures, { get: (k, name) => { used.add(name); return k[name]; } });
  const r = await drivers[id]({ page: h.page, baseUrl: 'https://staging.example.test', journey: live().journeys.find((j) => j.id === id), fixtures });
  return { ...h, r, used, failed: r.assertions.filter((a) => !a.ok).map((a) => tagOf(a.expected)) };
}

await test('EXPO: the live manifest is the exact milestone for the approved build, rolling back to the served ab77fbfc, every journey registered', () => {
  const m = live();
  assert.deepEqual(validateManifest(m), []);
  assert.equal(m.milestone, 'EXPO-ATTENDEE-JOURNEY-PROOF-1');
  assert.equal(m.productSha, '5705dc3bf198a9490600c7e32b8bb55356defd9d');
  assert.equal(m.productSha, APPROVED, 'the manifest names exactly the build staging is approved to serve');
  assert.equal(m.previousKnownGoodSha, 'ab77fbfce97e60c1c22492397b2ab6b491f9e0db');
  assert.deepEqual(m.journeys.map((j) => j.id), EXPO_IDS);
  assert.equal(checkManifestObject(m, { approvedSha: APPROVED, drivers }).status, 'valid');
  for (const id of EXPO_IDS) assert.equal(drivers[id], expoDrivers[id], `${id} is registered in journeys/index.mjs`);
  const { [EXPO_IDS[0]]: _gone, ...without } = drivers;
  assert.equal(checkManifestObject(m, { approvedSha: APPROVED, drivers: without }).status, 'refused', 'an unregistered journey is refused before deploy');
});

await test('EXPO: every expected row of every journey is a row its driver asserts, word for word and in order', () => {
  for (const j of live().journeys) assert.deepEqual(Object.values(EXPO_ROWS[j.id]), j.expected, `${j.id}: the driver's rows are the manifest's`);
});

await test('EXPO: the store-only claims are named as exclusions and asserted by no driver; the honest boundaries are kept', () => {
  const m = live();
  const byId = Object.fromEntries(m.journeys.map((j) => [j.id, j]));
  assert.match(byId['phone-and-stations-converge'].knownExclusions.join(' '), /recorded as the attempt that station started, and that the target crossing is recorded once for the goal and credited to no single member: stored facts the hosted screens do not show/);
  assert.match(byId['station-lost-answer'].knownExclusions.join(' '), /GAP-1/);
  assert.match(byId['closed-goal-turn'].knownExclusions.join(' '), /GAP-2/);
  const all = JSON.stringify(EXPO_ROWS);
  assert.doesNotMatch(all, /attempt that station started|credited to no single member|crossing is recorded/);
});

for (const id of EXPO_IDS) {
  await test(`EXPO ${id} on a faithful model: real actions, every row asserted and held, every device closed`, async () => {
    const d = await driveExpo(id);
    assert.deepEqual(d.failed, [], d.r.assertions.filter((a) => !a.ok).map((a) => a.expected).join(' | '));
    assert.deepEqual([...new Set(d.r.assertions.map((a) => tagOf(a.expected)))].sort(), Object.keys(EXPO_ROWS[id]).sort());
    assert.ok(d.r.actionsPerformed.length >= 1 && typeof d.r.setupId === 'string');
    assert.ok(d.opened.length >= 1 && d.opened.every((c) => c.__ctx.closed), 'every device context the driver opened is closed');
    // The driver touches the store only through the kit, and only through these.
    const allowed = new Set(['expoEvent', 'approveStation', 'trackPlace', 'trackContribution', 'trackStationTurn', 'closeGoal', 'signIn']);
    for (const name of d.used) if (typeof name === 'string') assert.ok(allowed.has(name), `${id} used fixtures.${name}`);
  });
}

await test('EXPO: the drivers read the page, never the store: no Firestore, Identity or document access in the driver source', () => {
  const src = fs.readFileSync(path.resolve('.github/wsf-staging/journeys/expo-attendee.mjs'), 'utf8');
  for (const forbidden of [/firestore\.googleapis/, /identitytoolkit/, /\/documents\//, /getDoc\b/, /(^|[^.\w])fetch\(/, /WSF_GOOGLE_ACCESS_TOKEN/]) assert.doesNotMatch(src, forbidden);
});

const EXPO_DEFECTS = [
  ['event-use-my-phone', 'activityNotSaid', ['activity']],
  ['event-use-my-phone', 'finishOnPhone', ['phone']],
  ['event-use-my-phone', 'phoneJoinsLine', ['noPlace']],
  ['event-use-my-phone', 'doubleCount', ['receipt']],
  ['event-join-line', 'joinOnOpen', ['deliberate']],
  ['event-join-line', 'noQueuePage', ['joined']],
  ['event-join-line', 'hallShowsName', ['private']],
  ['two-station-turns', 'sameCode', ['calls']],
  ['two-station-turns', 'wrongStationLabel', ['phones']],
  ['two-station-turns', 'readyOpensOther', ['ready']],
  ['two-station-turns', 'receiptHidden', ['results']],
  ['two-station-turns', 'hallKeepsName', ['cleared']],
  ['phone-and-stations-converge', 'stationTotalStale', ['stations', 'once']],
  ['phone-and-stations-converge', 'phoneStale', ['phone', 'once']],
  ['phone-and-stations-converge', 'doubleCount', ['stations', 'phone', 'once']],
  ['station-lost-answer', 'turnLostOnError', ['kept']],
  ['station-lost-answer', 'retryDoubleCounts', ['same', 'once']],
  ['station-lost-answer', 'offlinePhoneClaims', ['phone']],
  ['line-place-ends', 'switchKeepsPlace', ['switched', 'noShow', 'letGo']],
  ['line-place-ends', 'noShowNotEnded', ['noShow', 'letGo']],
  ['line-place-ends', 'noShowWording', ['noShow']],
  ['line-place-ends', 'letGoReceipt', ['letGo', 'onlyTen']],
  ['closed-goal-turn', 'closedRecords', ['refused', 'nothing', 'noReceipt']],
  ['shared-screen-finish', 'finishKeepsCredit', ['finish']],
  ['shared-screen-finish', 'finishKeepsSession', ['finish', 'next']],
  ['shared-screen-finish', 'nextSeesPrevious', ['next']],
  ['shared-screen-finish', 'countdownNoFinish', ['countdown']],
  ['shared-screen-finish', 'stayIgnored', ['countdown']],
];
for (const [id, bug, rows] of EXPO_DEFECTS) {
  await test(`EXPO ${id} fails on a seeded defect (${bug}), exactly on the row(s) ${rows.join(', ')}, without throwing`, async () => {
    const d = await driveExpo(id, { [bug]: true });
    assert.deepEqual([...new Set(d.failed)].sort(), [...rows].sort());
    assert.ok(d.opened.every((c) => c.__ctx.closed), 'a failing journey still closes every device');
  });
}

await test('EXPO: everything a journey makes the PRODUCT write is tracked; the REAL cleaner then leaves the store empty, read back', async () => {
  for (const id of EXPO_IDS) {
    const d = await driveExpo(id);
    const before = d.be.docs.size;
    assert.ok(before > 0);
    const receipt = path.join(d.dir, 'cleanup-receipt.json');
    const { server, base } = await serve(d.be);
    const c = await runCleanup(base, d.kit.manifestPath, receipt);
    server.close();
    assert.equal(c.code, 0, `${id}: ${c.out}`);
    assert.equal(c.receipt.status, 'COMPLETE', id);
    assert.equal(d.be.docs.size, 0, `${id}: left ${[...d.be.docs.keys()].join(', ')}`);
    assert.equal(d.be.accounts.size, 0, `${id}: left accounts`);
  }
});

await test('EXPO: product documents with server-minted ids are claimed as LINKED to this run\'s tagged goal; nothing secret is written', async () => {
  const d = await driveExpo('two-station-turns');
  const text = fs.readFileSync(d.kit.manifestPath, 'utf8');
  const m = JSON.parse(text);
  assert.ok(m.linkedDocs.length >= 6);
  for (const l of m.linkedDocs) {
    assert.match(l.path, /^wsf(TurnEntries|KioskStations|KioskPairings)\//);
    assert.ok(l.via.includes(RUN_TAG), `${l.path} is claimed through the run-tagged goal`);
  }
  for (const p of m.docs) assert.ok(p.includes(RUN_TAG) || /^wsfMemberProfiles\//.test(p), `${p} carries the run tag`);
  for (const email of d.be.passwords.keys()) {
    assert.ok(!text.includes(email), 'no email in the manifest');
    assert.ok(!text.includes(d.be.passwords.get(email)), 'no password in the manifest');
  }
  assert.doesNotMatch(text, /tok:|idToken|PX\d{4}/, 'no ID token or pairing code in the manifest');
});

await test('EXPO: the kit refuses to patch a document this run did not create, and refuses a turn entry that names another goal', async () => {
  const h = expoHarness();
  const ev = await h.kit.expoEvent('kit', { attendees: 1, target: 10, seeded: 0 });
  await assert.rejects(() => h.kit.closeGoal({ ...ev, goalId: 'someone-elses-goal' }), /this run did not create it/);
  h.be.docs.set('wsfTurnEntries/foreign', { goalId: { stringValue: 'other-goal' }, attemptId: { stringValue: 'turn_x' } });
  await assert.rejects(() => h.kit.trackStationTurn(ev, ev.attendees[0], 'foreign'), /names a different goal/);
  await h.kit.closeGoal(ev);
  const g = h.be.docs.get(`wsfGoals/${ev.goalId}`);
  assert.equal(g.status.stringValue, 'closed');
  assert.equal(g.title.stringValue, 'Fixture Expo Squats', 'a field-masked patch leaves the rest of the goal');
});

await test('EXPO: a failed cleanup is INCOMPLETE and keeps the manifest, though the journey passed', async () => {
  const d = await driveExpo('event-use-my-phone');
  assert.deepEqual(d.failed, []);
  const { server, base } = await serve(d.be, { failDeletes: true });
  const c = await runCleanup(base, d.kit.manifestPath, path.join(d.dir, 'cleanup-receipt.json'));
  server.close();
  assert.notEqual(c.code, 0);
  assert.equal(c.receipt.status, 'INCOMPLETE');
  assert.ok(fs.existsSync(d.kit.manifestPath), 'the manifest stays for recovery');
});

await test('EXPO: through the runner (live manifest, real registry), the REAL cleaner and the card CLI: all eight PASSED and cleanup COMPLETE', async () => {
  const d = tmp();
  const m = live();
  const mf = path.join(d, 'manifest.json');
  fs.writeFileSync(mf, JSON.stringify(m));
  const changed = path.join(d, 'evidence', 'changed-journeys');
  const h = expoHarness();
  const browser = { newContext: async (o) => { const c = await h.page.context().browser().newContext(o); return c; }, close: async () => {} };
  const hook = await runHook({ WSF_JOURNEY_MANIFEST: mf, WSF_STAGING_URL: 'https://staging.example.test', WSF_APPROVED_SHA: APPROVED, WSF_RESULT_DIR: path.join(d, 'evidence') }, {
    fetch: async () => ({ ok: true, text: async () => `commit ${APPROVED.slice(0, 7)}` }),
    launch: async () => browser,
    fixtures: () => h.fixtures,
  });
  assert.deepEqual(hook.results.results.map((x) => [x.journeyId, x.status, x.reason]), EXPO_IDS.map((id) => [id, 'passed', null]));
  const receipt = path.join(changed, 'cleanup-receipt.json');
  const { server, base } = await serve(h.be);
  const cleanup = await runCleanup(base, h.kit.manifestPath, receipt);
  server.close();
  assert.equal(cleanup.receipt.status, 'COMPLETE');
  assert.equal(h.be.docs.size + h.be.accounts.size, 0);
  const cardPath = path.join(changed, 'owner-test-card.md');
  const card = spawnSync(process.execPath, [CARD, '--manifest', mf, '--results', path.join(changed, 'changed-journeys.json'),
    '--cleanup-manifest', h.kit.manifestPath, '--cleanup-receipt', receipt, '--staging-url', 'https://staging.example.test', '--out', cardPath], { encoding: 'utf8' });
  assert.equal(card.status, 0, card.stderr);
  assert.match(card.stdout, /OWNER_CARD_CLEANUP=COMPLETE\nOWNER_CARD_SUMMARY=PASSED/);
  const text = fs.readFileSync(cardPath, 'utf8');
  assert.match(text, /Hosted changed-journey status: PASSED \(8 passed/);
  assert.match(text, /GAP-1/);
  assert.match(text, /GAP-2/);
  assert.match(text, /Device review: NOT RUN/);
});

await test('EXPO: a seeded defect through the runner is a FAILED journey and a FAILED card naming the row, never PASSED', async () => {
  const d = tmp();
  const m = live();
  const mf = path.join(d, 'manifest.json');
  fs.writeFileSync(mf, JSON.stringify(m));
  const changed = path.join(d, 'evidence', 'changed-journeys');
  const h = expoHarness({ closedRecords: true });
  const browser = { newContext: (o) => h.page.context().browser().newContext(o), close: async () => {} };
  const hook = await runHook({ WSF_JOURNEY_MANIFEST: mf, WSF_STAGING_URL: 'https://staging.example.test', WSF_APPROVED_SHA: APPROVED, WSF_RESULT_DIR: path.join(d, 'evidence') }, {
    fetch: async () => ({ ok: true, text: async () => `commit ${APPROVED.slice(0, 7)}` }), launch: async () => browser, fixtures: () => h.fixtures,
  });
  const closed = hook.results.results.find((x) => x.journeyId === 'closed-goal-turn');
  assert.equal(closed.status, 'failed');
  assert.ok(closed.assertions.some((a) => !a.ok && a.expected.startsWith('[refused] the station prints This goal is closed.')));
  const receipt = path.join(changed, 'cleanup-receipt.json');
  const { server, base } = await serve(h.be);
  await runCleanup(base, h.kit.manifestPath, receipt);
  server.close();
  const card = spawnSync(process.execPath, [CARD, '--manifest', mf, '--results', path.join(changed, 'changed-journeys.json'),
    '--cleanup-manifest', h.kit.manifestPath, '--cleanup-receipt', receipt, '--staging-url', 'https://staging.example.test', '--out', path.join(changed, 'card.md')], { encoding: 'utf8' });
  assert.match(card.stdout, /OWNER_CARD_SUMMARY=FAILED/);
});

console.log(`\nchanged-journey-drivers: ${passed} passed`);
