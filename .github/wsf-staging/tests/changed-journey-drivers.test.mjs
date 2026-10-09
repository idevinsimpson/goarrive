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
  assert.equal(m.productSha, 'ec162d17a0540e936741027f9b8f90dd372cfaf4');
  assert.equal(m.productSha, APPROVED, 'the manifest names exactly the build staging is approved to serve');
  assert.equal(m.previousKnownGoodSha, 'ab77fbfce97e60c1c22492397b2ab6b491f9e0db');
  assert.deepEqual(m.journeys.map((j) => j.id), [...EXPO_IDS, 'unverified-participant']);
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
  assert.match(byId['station-lost-answer'].knownExclusions.join(' '), /describeCallableError.*never internal.*J2b/);
  // EXPO-FULL-STAGING-RECOVERY-3: at ec162d17 a lost Record prints #596's sentence; the exclusion says so.
  assert.match(byId['station-lost-answer'].knownExclusions.join(' '), /a lost Record .* prints No answer yet for \{code\}\. “Try again” sends the result \(\{n\}\) again for that turn — it can’t count twice\., with a Try again control/);
  assert.match(byId['two-station-turns'].knownExclusions.join(' '), /expectedTurn.*a request fact the hosted screens do not show/);
  // Each change this build makes without a hosted driver is named UNPROVEN, never asserted.
  assert.match(byId['event-use-my-phone'].knownExclusions.join(' '), /MOVE-CAMERA-NATIVE-PORT-1, #577.*EXPO-MOVEMENT-VIDEO-1, #575.*UNPROVEN here/);
  assert.match(byId['unverified-participant'].knownExclusions.join(' '), /MEMBER-PREVIEW-LABEL-1.*PROFILE-PHOTOS-FIREBASE-1, #593.*UNPROVEN here/);
  assert.match(byId['unverified-participant'].knownExclusions.join(' '), /expected to FAIL on its eight visitor rows/);
  assert.match(byId['unverified-participant'].knownExclusions.join(' '), /\(wsfResolveMarker, wsfJoinViaMarker\) are expected to arrive SHUT \(invoker_iam_check_enabled\).*the verified control's included, fails on the marker's own error card, named/);
  assert.match(byId['event-use-my-phone'].knownExclusions.join(' '), /its approved catalog is empty at this build, so no clip shows/);
  // GAP-2 is fixed at the approved build (#571): its exclusion is gone, and the store-only half of the gate stays named.
  assert.doesNotMatch(JSON.stringify(m), /GAP-2/);
  assert.match(byId['closed-goal-turn'].knownExclusions.join(' '), /creates or advances no entry, place, assignment, lease or attempt document: stored facts the hosted screens do not show; proved on emulators by EXPO-CLOSED-GOAL-QUEUE-GATE-1/);
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
  ['station-lost-answer', 'retryLocalOnly', ['same']],
  ['station-lost-answer', 'offlinePhoneClaims', ['phone']],
  ['line-place-ends', 'switchKeepsPlace', ['switched', 'noShow', 'letGo']],
  ['line-place-ends', 'noShowNotEnded', ['noShow', 'letGo']],
  ['line-place-ends', 'noShowWording', ['noShow']],
  // Run 37912780869: the lapse is watched, not slept through, so the row reads the
  // 45 seconds off the phone's own countdown. A call that lapses under a countdown
  // still running (its notice left on screen), and a call offered for less or for
  // more than its 45 seconds with the real one-poll notice, each fail the row.
  ['line-place-ends', 'noShowEarly', ['noShow']],
  ['line-place-ends', 'noShowShortLease', ['noShow']],
  ['line-place-ends', 'noShowLongLease', ['noShow']],
  // The heading and the reason are each required: either one wrong fails the row.
  ['line-place-ends', 'noShowHeading', ['noShow']],
  ['line-place-ends', 'noShowReason', ['noShow']],
  ['line-place-ends', 'letGoReceipt', ['letGo', 'onlyTen']],
  ['closed-goal-turn', 'closedRecords', ['refused', 'nothing', 'noReceipt']],
  // EXPO-CLOSED-GOAL-QUEUE-GATE-1 (#571): each gate skipped, or saying the sentence after it advanced.
  ['closed-goal-turn', 'closedStart', ['start']],
  ['closed-goal-turn', 'closedStartMints', ['start']],
  ['closed-goal-turn', 'closedReady', ['ready']],
  ['closed-goal-turn', 'closedReadyAdvances', ['ready']],
  ['closed-goal-turn', 'closedReadyEndsPlace', ['ready']],
  ['closed-goal-turn', 'closedCall', ['call']],
  ['closed-goal-turn', 'closedCallAdvances', ['call']],
  ['closed-goal-turn', 'closedJoin', ['join']],
  ['closed-goal-turn', 'closedJoinCreates', ['join']],
  ['closed-goal-turn', 'closedJoinNavigates', ['join']],
  ['closed-goal-turn', 'closedCallEndsWaiting', ['call']],
  ['closed-goal-turn', 'closedCallShowsServing', ['call']],
  // W4 finding (#394 5970985781): each gate refusing in other words, and a start refusal that ends the turn.
  ['closed-goal-turn', 'closedWordsStart', ['start']],
  ['closed-goal-turn', 'closedWordsReady', ['ready']],
  ['closed-goal-turn', 'closedWordsCall', ['call']],
  ['closed-goal-turn', 'closedWordsJoin', ['join']],
  ['closed-goal-turn', 'closedStartEndsPlace', ['start']],
  ['shared-screen-finish', 'finishKeepsCredit', ['finish']],
  ['shared-screen-finish', 'finishKeepsSession', ['finish', 'next']],
  ['shared-screen-finish', 'nextSeesPrevious', ['next']],
  ['shared-screen-finish', 'countdownNoFinish', ['countdown']],
  ['shared-screen-finish', 'stayIgnored', ['countdown']],
  // The previous person's name left in a capitalised label: the leftover check reads words, not case.
  ['shared-screen-finish', 'finishKeepsNameCaps', ['finish']],
];
for (const [id, bug, rows] of EXPO_DEFECTS) {
  await test(`EXPO ${id} fails on a seeded defect (${bug}), exactly on the row(s) ${rows.join(', ')}, without throwing`, async () => {
    const d = await driveExpo(id, { [bug]: true });
    assert.deepEqual([...new Set(d.failed)].sort(), [...rows].sort());
    assert.ok(d.opened.every((c) => c.__ctx.closed), 'a failing journey still closes every device');
  });
}

// ---- what run 37912780869 met on the served build, pinned in the model --------------
/*
 * Main's drivers at df8d4d69 failed on hosted staging because the served build
 * (ec162d17) behaves as below. The model must keep behaving so, or the fixed
 * drivers would be proved against a kinder product than the one they meet.
 */
const BASE = 'https://staging.example.test';
async function modelPage(h, viewport = { width: 390, height: 844 }) {
  return (await h.page.context().browser().newContext({ viewport })).newPage();
}
async function modelStation(h, ev, slot) {
  const p = await modelPage(h, { width: 1280, height: 720 });
  await p.goto(`${BASE}/station/${ev.goalId}`);
  await h.kit.approveStation(ev, (await p.getByTestId('wsf-station-pairing-code').innerText()).replace(/\s+/g, ''), slot);
  return p;
}
async function modelPhoneInLine(h, ev, member, name) {
  const p = await modelPage(h);
  await h.kit.signIn(p, BASE, member);
  h.server.join(ev.goalId, member.uid, name);
  await p.goto(`${BASE}/queue/${ev.goalId}`);
  return p;
}
const shows = async (p, id) => (await p.getByTestId(id).count()) === 1;

await test('EXPO MODEL (run 37912780869): station enrolment admits slot 1 or 2 only, as normalizeStationSlot does', async () => {
  const h = expoHarness();
  const ev = await h.kit.expoEvent('slots', { attendees: 1, target: 100, seeded: 0 });
  await modelStation(h, ev, 1);
  await modelStation(h, ev, 2);
  await assert.rejects(() => modelStation(h, ev, 3), /wsfApproveStation refused: INVALID_ARGUMENT/);
});

await test('EXPO MODEL (run 37912780869): a phone shows its call on its next poll, and a station sees I\'m ready on its next poll', async () => {
  const h = expoHarness();
  const ev = await h.kit.expoEvent('polls', { attendees: 1, target: 100, seeded: 0 });
  const [m] = ev.attendees;
  const station = await modelStation(h, ev, 1);
  const phone = await modelPhoneInLine(h, ev, m, 'Fixture P');
  await station.getByTestId('wsf-station-call-next').click();
  assert.equal(await shows(phone, 'wsf-queue-ready'), false, 'the phone showed the call before its next poll');
  await phone.waitForTimeout(3_000);
  assert.equal(await shows(phone, 'wsf-queue-ready'), true, 'the phone never showed the call');
  await phone.getByTestId('wsf-queue-ready').click();
  assert.equal(await station.getByTestId('wsf-station-turn-action').isDisabled(), true, 'the station opened Start before its next poll');
  await station.waitForTimeout(2_000);
  assert.equal(await station.getByTestId('wsf-station-turn-action').isDisabled(), false, 'the station never opened Start');
});

await test('EXPO MODEL (run 37912780869): the no-show notice shows once the 45 seconds run out and is gone one poll later', async () => {
  const h = expoHarness();
  const ev = await h.kit.expoEvent('notice', { attendees: 1, target: 100, seeded: 0 });
  const [m] = ev.attendees;
  const station = await modelStation(h, ev, 1);
  const phone = await modelPhoneInLine(h, ev, m, 'Fixture N');
  await station.getByTestId('wsf-station-call-next').click();
  await phone.waitForTimeout(3_000);
  assert.equal(await phone.getByTestId('wsf-queue-lease').innerText(), '42s to say you’re coming', 'the phone does not count the call down from its 45 seconds');
  await phone.waitForTimeout(41_000);
  assert.equal(await shows(phone, 'wsf-queue-called'), true, 'the call ended before its 45 seconds');
  assert.equal(await phone.getByTestId('wsf-queue-lease').innerText(), '1s to say you’re coming');
  await phone.waitForTimeout(1_000);
  assert.match(await phone.getByTestId('wsf-queue-standing').innerText(), /^Your turn timed out/);
  await phone.waitForTimeout(3_000);
  assert.match(await phone.getByTestId('wsf-queue-standing').innerText(), /^You’re not in the line/, 'the notice outlived its one poll');
});

await test('EXPO MODEL: a venue-width station hides its total while a turn runs there, and shows it again once the turn ends', async () => {
  const h = expoHarness();
  const ev = await h.kit.expoEvent('hero', { attendees: 1, target: 100, seeded: 0 });
  const [m] = ev.attendees;
  const station = await modelStation(h, ev, 1);
  const phone = await modelPhoneInLine(h, ev, m, 'Fixture H');
  assert.equal(await shows(station, 'wsf-station-total-line'), true);
  await station.getByTestId('wsf-station-call-next').click();
  await phone.waitForTimeout(3_000);
  await phone.getByTestId('wsf-queue-ready').click();
  await station.waitForTimeout(2_000);
  assert.equal(await shows(station, 'wsf-station-total-line'), true, 'a ready member hides nothing');
  await station.getByTestId('wsf-station-turn-action').click();
  assert.equal(await shows(station, 'wsf-station-total-line'), false, 'the total stayed on a running venue screen');
  await station.getByTestId('wsf-station-turn-count').fill('7');
  await station.getByTestId('wsf-station-turn-action').click();
  assert.equal(await station.getByTestId('wsf-station-total-line').innerText(), '7 of 100 squats');
});

await test('EXPO MODEL: an installed kiosk clock keeps flowing during waits, and runFor adds on top', async () => {
  const h = expoHarness();
  const ev = await h.kit.expoEvent('clock', { attendees: 1, target: 100, seeded: 0 });
  const [k] = ev.attendees;
  const page = await modelPage(h, { width: 800, height: 1280 });
  await page.clock.install();
  await h.kit.signIn(page, BASE, k);
  await page.goto(`${BASE}/contribute/${ev.goalId}?kiosk=1`);
  await page.getByTestId('wsf-contribute-entry').fill('20');
  await page.getByTestId('wsf-contribute-review').click();
  await page.getByTestId('wsf-contribute-submit').click();
  assert.equal(await page.getByTestId('wsf-kiosk-countdown').innerText(), 'Finishing in 90 seconds');
  await page.waitForTimeout(20_000);
  assert.equal(await page.getByTestId('wsf-kiosk-countdown').innerText(), 'Finishing in 70 seconds', 'the installed clock stood still during a wait');
  await page.clock.runFor(70_000);
  assert.equal(await page.getByTestId('wsf-kiosk-start').count(), 1, 'the kiosk did not finish once waited and run-for time together passed 90 s');
});

await test('EXPO MODEL (run 37912780869): the kiosk receipt reads its own-credit label in capitals through innerText; the entry line and a phone receipt do not', async () => {
  const h = expoHarness();
  const ev = await h.kit.expoEvent('caps', { attendees: 2, target: 100, seeded: 0 });
  const [k, p] = ev.attendees;
  for (const [member, search, label] of [[k, '?kiosk=1', 'YOUR TOTAL ON THIS GOAL:'], [p, '', 'Your total on this goal:']]) {
    const page = await modelPage(h, { width: 800, height: 1280 });
    await h.kit.signIn(page, BASE, member);
    await page.goto(`${BASE}/contribute/${ev.goalId}${search}`);
    assert.equal(await page.getByTestId('wsf-contribute-own-credit').innerText(), 'Your total on this goal: 0 squats');
    await page.getByTestId('wsf-contribute-entry').fill('20');
    await page.getByTestId('wsf-contribute-review').click();
    await page.getByTestId('wsf-contribute-submit').click();
    assert.equal(await page.getByTestId('wsf-contribute-own-credit').innerText(), `${label} 20 squats`);
  }
});

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

await test('EXPO: through the runner (the live manifest\'s eight attendee journeys, real registry), the REAL cleaner and the card CLI: all eight PASSED and cleanup COMPLETE', async () => {
  const d = tmp();
  const m = { ...live(), journeys: live().journeys.filter((j) => EXPO_IDS.includes(j.id)) };
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
  assert.match(text, /describeCallableError/);
  assert.match(text, /EXPO-CLOSED-GOAL-QUEUE-GATE-1/);
  assert.doesNotMatch(text, /GAP-2/);
  assert.match(text, /Device review: NOT RUN/);
});

await test('EXPO: a seeded defect through the runner is a FAILED journey and a FAILED card naming the row, never PASSED', async () => {
  const d = tmp();
  const m = { ...live(), journeys: live().journeys.filter((j) => EXPO_IDS.includes(j.id)) };
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
  assert.ok(closed.assertions.some((a) => !a.ok && a.expected.startsWith('[refused] recording the turn started before the closure: Station 1 prints This goal is closed.')));
  const receipt = path.join(changed, 'cleanup-receipt.json');
  const { server, base } = await serve(h.be);
  await runCleanup(base, h.kit.manifestPath, receipt);
  server.close();
  const card = spawnSync(process.execPath, [CARD, '--manifest', mf, '--results', path.join(changed, 'changed-journeys.json'),
    '--cleanup-manifest', h.kit.manifestPath, '--cleanup-receipt', receipt, '--staging-url', 'https://staging.example.test', '--out', path.join(changed, 'card.md')], { encoding: 'utf8' });
  assert.match(card.stdout, /OWNER_CARD_SUMMARY=FAILED/);
});

// ═════════════════════════════════════════════════════════════════════════════
// KIOSK-UNVERIFIED-STAGING-RECOVERY-1: the unverified participant's fixtures.
// ═════════════════════════════════════════════════════════════════════════════
const okBody = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
/**
 * The model backend, taught the two admin reads the unverified kit makes (an
 * account lookup by uid or email, and the membership query by uid) and what
 * each account was STORED as. `storeVerified` overrides what sign-up asked for;
 * `loseSignUpAnswer` makes the account and then loses the answer; `failSignUp`
 * fails before anything is made.
 */
function unverifiedBackend({ storeVerified = null, loseSignUpAnswer = false, failSignUp = false } = {}) {
  const be = backend();
  const inner = be.fetchImpl;
  be.verified = new Map();
  be.fetchImpl = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    const admin = opts.headers?.authorization === 'Bearer admin-token';
    if (url.includes('accounts:signUp')) {
      if (failSignUp) { be.requests.push({ url, method: opts.method, admin, body }); throw new TypeError('fetch failed'); }
      const answer = await inner(url, opts);
      const uid = [...be.accounts].find(([, e]) => e === body.email)?.[0];
      be.verified.set(uid, storeVerified ?? body.emailVerified === true);
      if (loseSignUpAnswer) throw new TypeError('fetch failed');
      return answer;
    }
    if (url.includes('/accounts:lookup')) {
      be.requests.push({ url, method: opts.method, admin, body });
      const ids = body.localId || [...be.accounts].filter(([, e]) => (body.email || []).includes(e)).map(([u]) => u);
      const users = ids.filter((u) => be.accounts.has(u)).map((u) => ({ localId: u, email: be.accounts.get(u), emailVerified: be.verified.get(u) === true }));
      return okBody(users.length ? { users } : {});
    }
    if (url.endsWith('/documents:runQuery')) {
      be.requests.push({ url, method: opts.method, admin, body });
      const uid = body.structuredQuery.where.fieldFilter.value.stringValue;
      const rows = [...be.docs].filter(([p, f]) => /^wsfMemberships\/[^/]+$/.test(p) && f.userId?.stringValue === uid)
        .map(([p, f]) => ({ document: { name: `projects/westayfit-staging/databases/(default)/documents/${p}`, fields: f } }));
      return okBody(rows.length ? rows : [{ readTime: '2026-10-08T12:00:00Z' }]);
    }
    return inner(url, opts);
  };
  return be;
}
const manifestOf = (kit) => JSON.parse(fs.readFileSync(kit.manifestPath, 'utf8'));
const signUps = (be) => be.requests.filter((q) => q.url.includes('accounts:signUp')).map((q) => q.body);
/** What the product's own callables write for a visitor who saves a profile and joins (wsfSaveProfile, admitByLinkTx). */
function productAdmits(be, groupId, uid) {
  be.docs.set(`wsfMemberProfiles/${uid}`, { displayName: { stringValue: 'Fixture Visitor' } });
  be.docs.set(`wsfMemberships/${groupId}_${uid}`, { groupId: { stringValue: groupId }, userId: { stringValue: uid }, role: { stringValue: 'member' }, membershipStatus: { stringValue: 'active' } });
}

await test('UNVERIFIED KIT: the account is created through the same admin path with emailVerified:false, tracked at once, and read back as unverified', async () => {
  const dir = tmp();
  const be = unverifiedBackend();
  const kit = kitFor(dir, be);
  const who = await kit.createUnverifiedUser('visitor', 'Fixture Visitor');
  const [body] = signUps(be);
  assert.equal(body.emailVerified, false);
  assert.deepEqual(Object.keys(body), ['targetProjectId', 'email', 'password', 'displayName', 'emailVerified', 'disabled', 'returnSecureToken']);
  assert.match(who.email, new RegExp(`^wsf-${RUN_TAG}-visitor-[0-9a-f]{4}@example\\.com$`));
  assert.deepEqual(manifestOf(kit).users, [who.uid]);
  assert.equal(be.verified.get(who.uid), false, 'stored unverified');
  assert.ok(be.requests.every((q) => q.admin), 'every kit request is admin-scoped');
  const text = fs.readFileSync(kit.manifestPath, 'utf8');
  assert.equal(text.includes(who.email) || text.includes(who.password), false, 'no email or password in the manifest');
});

await test('UNVERIFIED KIT: an account stored as verified is refused, and is still tracked so cleanup removes it', async () => {
  const dir = tmp();
  const be = unverifiedBackend({ storeVerified: true });
  const kit = kitFor(dir, be);
  await assert.rejects(() => kit.createUnverifiedUser('visitor'), /was not stored as unverified/);
  assert.equal(manifestOf(kit).users.length, 1);
  const { server, base } = await serve(be);
  const c = await runCleanup(base, kit.manifestPath, path.join(dir, 'receipt.json'));
  server.close();
  assert.equal(c.receipt.status, 'COMPLETE', c.out);
  assert.equal(be.accounts.size, 0);
});

await test('UNVERIFIED KIT: a sign-up whose answer is lost is found by its synthetic email and tracked; one that made nothing tracks nothing', async () => {
  const dir = tmp();
  const be = unverifiedBackend({ loseSignUpAnswer: true });
  const kit = kitFor(dir, be);
  await assert.rejects(() => kit.createUnverifiedUser('visitor'), /created anyway and is tracked for cleanup/);
  assert.equal(be.accounts.size, 1);
  assert.deepEqual(manifestOf(kit).users, [...be.accounts.keys()], 'the account the lost answer made is in the manifest');
  const { server, base } = await serve(be);
  const c = await runCleanup(base, kit.manifestPath, path.join(dir, 'receipt.json'));
  server.close();
  assert.equal(c.receipt.status, 'COMPLETE', c.out);
  assert.equal(be.accounts.size, 0, 'the unknown-outcome account does not leak');

  const dir2 = tmp();
  const be2 = unverifiedBackend({ failSignUp: true });
  const kit2 = kitFor(dir2, be2);
  await assert.rejects(() => kit2.createUnverifiedUser('visitor'), /no account was created/);
  assert.deepEqual(manifestOf(kit2).users, []);
});

await test('UNVERIFIED KIT: createVerifiedUser and signIn are unchanged (the verified request body is exactly as before)', async () => {
  const dir = tmp();
  const be = unverifiedBackend();
  const kit = kitFor(dir, be);
  const v = await kit.createVerifiedUser('control', 'Fixture Control');
  const [body] = signUps(be);
  assert.deepEqual(body, { targetProjectId: 'westayfit-staging', email: v.email, password: v.password, displayName: 'Fixture Control', emailVerified: true, disabled: false, returnSecureToken: false });
  assert.equal(be.requests.some((q) => q.url.includes('accounts:lookup')), false, 'the verified maker makes no read-back');
  const src = fs.readFileSync(path.resolve('.github/wsf-staging/journeys/fixture-kit.mjs'), 'utf8');
  assert.match(src, /await page\.waitForURL\(\(u\) => !\/\^\\\/\(signin\|verify-email\|profile-setup\)\\b\/\.test\(new URL\(u\)\.pathname\), \{ timeout: 60_000 \}\);/, 'signIn still refuses /verify-email and /profile-setup');
});

await test('UNVERIFIED KIT: the joinable event is public with a join link and an approved marker, its goal allows more rounds, and no visitor is made a member', async () => {
  const dir = tmp();
  const be = unverifiedBackend();
  const kit = kitFor(dir, be);
  const ev = await kit.joinableEvent('open', { target: 1000, seeded: 100 });
  const f = (p) => be.docs.get(p);
  const group = f(`wsfCommunityGroups/${ev.groupId}`);
  assert.equal(group.joinPolicy.stringValue, 'public');
  assert.equal(group.lifecycleStatus.stringValue, 'active');
  assert.match(group.joinCode.stringValue, /^[A-Za-z0-9_-]{16,128}$/);
  assert.equal(group.joinCode.stringValue, ev.joinCode);
  const marker = f(`wsfMarkers/${ev.markerSlug}`);
  assert.match(ev.markerSlug, /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/);
  assert.ok(ev.markerSlug.includes(RUN_TAG));
  assert.deepEqual(Object.fromEntries(Object.entries(marker).map(([k, v]) => [k, Object.values(v)[0]])),
    { label: 'Fixture Flag', active: true, communityGroupId: ev.groupId, goalId: ev.goalId, kioskMode: 'off' });
  const goal = f(`wsfGoals/${ev.goalId}`);
  assert.equal(goal.repeatPolicy.stringValue, 'multiple');
  assert.equal(goal.communityGroupId.stringValue, ev.groupId);
  const members = [...be.docs.keys()].filter((p) => p.startsWith('wsfMemberships/'));
  assert.deepEqual(members, [`wsfMemberships/${ev.groupId}_e5cchamp-${RUN_TAG}-open`], 'only the placeholder Champion');
  assert.equal(be.accounts.size, 0, 'the event itself makes no account');
  const m = manifestOf(kit);
  assert.deepEqual([...m.docs].sort(), [...be.docs.keys()].sort(), 'every document is tracked');
  assert.ok(m.docs.every((p) => p.includes(RUN_TAG)));
  const text = fs.readFileSync(kit.manifestPath, 'utf8');
  assert.equal(text.includes(ev.joinCode), false, 'the join code is not written to the manifest');
  assert.equal(ev.setupId.includes(ev.joinCode), false);
});

await test('UNVERIFIED KIT: what the product writes for the visitor, and a join that landed in ANOTHER community, are claimed; the REAL cleaner removes exactly those', async () => {
  const dir = tmp();
  const be = unverifiedBackend();
  const kit = kitFor(dir, be);
  const ev = await kit.joinableEvent('open', { target: 1000, seeded: 0 });
  const who = await kit.createUnverifiedUser('visitor');
  kit.expectVisitor(ev, who);
  productAdmits(be, ev.groupId, who.uid);
  // A wrong community: a real one this run never made, where the product also admitted the visitor.
  be.docs.set('wsfCommunityGroups/someone-elses', { displayName: { stringValue: 'Not ours' } });
  be.docs.set('wsfMemberships/someone-elses_realperson', { groupId: { stringValue: 'someone-elses' }, userId: { stringValue: 'realperson' } });
  be.docs.set(`wsfMemberships/someone-elses_${who.uid}`, { groupId: { stringValue: 'someone-elses' }, userId: { stringValue: who.uid } });
  assert.equal(await kit.claimMemberships(who), 2);
  const m = manifestOf(kit);
  assert.ok(m.docs.includes(`wsfMemberships/${ev.groupId}_${who.uid}`) && m.docs.includes(`wsfMemberProfiles/${who.uid}`));
  assert.deepEqual(m.linkedDocs, [{ path: `wsfMemberships/someone-elses_${who.uid}`, via: who.uid }]);
  const { server, base } = await serve(be);
  const c = await runCleanup(base, kit.manifestPath, path.join(dir, 'receipt.json'));
  server.close();
  assert.equal(c.receipt.status, 'COMPLETE', c.out);
  assert.equal(be.accounts.size, 0);
  assert.deepEqual([...be.docs.keys()].sort(), ['wsfCommunityGroups/someone-elses', 'wsfMemberships/someone-elses_realperson'], 'only what is not this run\'s is left');
});

await test('UNVERIFIED KIT: a journey that fails after the product wrote leaves nothing behind; one that never reached the join leaves nothing either', async () => {
  for (const reached of [true, false]) {
    const dir = tmp();
    const be = unverifiedBackend();
    const kit = kitFor(dir, be);
    const ev = await kit.joinableEvent('open', { target: 1000, seeded: 0 });
    const who = await kit.createUnverifiedUser('visitor');
    kit.expectVisitor(ev, who);
    if (reached) {
      productAdmits(be, ev.groupId, who.uid);
      kit.trackContribution(ev, who, 'att-1');
      be.docs.set(`wsfContributions/${ev.goalId}_${who.uid}_att-1`, { count: { integerValue: '15' } });
      be.docs.set(`wsfGoalMemberTotals/${ev.goalId}_${who.uid}`, { total: { integerValue: '15' } });
    }
    // ...and the driver dies here, before anything else; the workflow's cleanup still runs.
    const { server, base } = await serve(be);
    const c = await runCleanup(base, kit.manifestPath, path.join(dir, 'receipt.json'));
    server.close();
    assert.equal(c.receipt.status, 'COMPLETE', `${reached}: ${c.out}`);
    assert.equal(be.accounts.size + be.docs.size, 0, `${reached}: left ${[...be.docs.keys()].join(', ')}`);
  }
});

// ---- the unverified participant's screens, modelled ------------------------------------
/**
 * A scripted model of the native app's hosted web build along the unverified
 * journey, at 819c26f0 as served (sign-in, profile and marker hold an
 * unverified account, as signin.tsx:121, profile-setup.tsx:113 and
 * MarkerEntryScreen.tsx:269 do) or with those screens REPAIRED (an unverified
 * account routed like a verified one). `holdAtSignin` repairs only the profile
 * and marker screens. The service writes what the product's callables write
 * (wsfSaveProfile; admitByLinkTx through wsfJoinViaMarker and wsfJoinCommunity;
 * wsfContribute), so the REAL cleaner shows whether the driver claimed it all.
 */
function unverifiedHarness({ repaired = false, holdAtSignin = false, markerShut = false, bugs = {} } = {}) {
  const dir = tmp();
  const be = unverifiedBackend();
  const kit = kitFor(dir, be);
  const str = (f) => (f ? Object.values(f)[0] : undefined);
  const doc = (p) => be.docs.get(p);
  const S = { contributions: [], mailSent: 0, verifyChecked: 0, ctxSeq: 0, firstCtx: new Map() };
  const refuse = (message) => Object.assign(new Error(message), { status: 'FAILED_PRECONDITION' });
  const svc = {
    verified: (uid) => be.verified.get(uid) === true,
    hasProfile: (uid) => be.docs.has(`wsfMemberProfiles/${uid}`),
    member: (g, uid) => str(doc(`wsfMemberships/${g}_${uid}`)?.membershipStatus) === 'active',
    groupName: (g) => str(doc(`wsfCommunityGroups/${g}`)?.displayName),
    marker: (slug) => { const m = doc(`wsfMarkers/${slug}`); return m ? { groupId: str(m.communityGroupId), goalId: str(m.goalId) } : null; },
    goalGroup: (goalId) => str(doc(`wsfGoals/${goalId}`)?.communityGroupId),
    saveProfile(uid, name) { if (!bugs.profileNotSaved) be.docs.set(`wsfMemberProfiles/${uid}`, { displayName: { stringValue: name } }); },
    admit(g, uid) {
      if (!svc.hasProfile(uid)) throw refuse('Complete your profile before joining a community.');
      if (svc.member(g, uid)) return { groupId: g, alreadyMember: true };
      be.docs.set(`wsfMemberships/${g}_${uid}`, { groupId: { stringValue: g }, userId: { stringValue: uid }, role: { stringValue: 'member' }, membershipStatus: { stringValue: 'active' } });
      return { groupId: g, alreadyMember: false };
    },
    joinViaMarker(slug, uid) {
      const m = svc.marker(slug);
      if (bugs.markerJoinsNothing) { if (!svc.hasProfile(uid)) throw refuse('Complete your profile before joining a community.'); return { groupId: m.groupId, alreadyMember: false }; }
      return svc.admit(m.groupId, uid);
    },
    joinByCode(code, uid) {
      const hit = [...be.docs].find(([p, f]) => /^wsfCommunityGroups\/[^/]+$/.test(p) && str(f.joinCode) === code);
      if (!hit) throw refuse('This link is not valid.');
      // Defect: the link admits the account to some other, real community.
      if (bugs.linkAdmitsElsewhere) { be.docs.set(`wsfMemberships/realgroup-elsewhere_${uid}`, { groupId: { stringValue: 'realgroup-elsewhere' }, userId: { stringValue: uid }, membershipStatus: { stringValue: 'active' } }); return { groupId: 'realgroup-elsewhere', alreadyMember: false }; }
      return svc.admit(hit[0].split('/')[1], uid);
    },
    seeded: (goalId) => [...be.docs].filter(([p]) => p.startsWith(`wsfGoalCounters/${goalId}/shards/`)).reduce((a, [, f]) => a + Number(f.count.integerValue), 0),
    shared: (goalId) => svc.seeded(goalId) + (bugs.sharedMissesOwn ? 0 : S.contributions.filter((c) => c.goalId === goalId).reduce((a, c) => a + c.count, 0)),
    own: (goalId, uid, ctx) => S.contributions.filter((c) => c.goalId === goalId && c.uid === uid
      && (!bugs.creditLostOnFresh || S.firstCtx.get(uid) === ctx.id || c.ctx === ctx.id)).reduce((a, c) => a + c.count, 0),
    contribute(goalId, uid, attemptId, count, ctx) {
      if (!svc.member(svc.goalGroup(goalId), uid)) throw refuse('This goal doesn’t exist or isn’t available to this account.');
      if (bugs.roundRefused && S.contributions.some((c) => c.goalId === goalId && c.uid === uid)) throw refuse('You’ve already recorded your part for this goal.');
      for (let i = 0; i < (bugs.doubleCount ? 2 : 1); i += 1) S.contributions.push({ goalId, uid, count, ctx: ctx.id });
      be.docs.set(`wsfContributions/${goalId}_${uid}_${attemptId}`, { goalId: { stringValue: goalId }, userId: { stringValue: uid }, count: { integerValue: String(count) } });
      be.docs.set(`wsfGoalMemberTotals/${goalId}_${uid}`, { total: { integerValue: String(svc.own(goalId, uid, ctx)) } });
      be.docs.set(`wsfGoals/${goalId}/recentAdditions/${attemptId}`, { count: { integerValue: String(count) } });
    },
  };
  // The three native screens that hold an unverified account at 819c26f0.
  const holds = (uid, where) => !svc.verified(uid) && (!repaired || (holdAtSignin && where === 'signin'));
  const fmtN = (n) => n.toLocaleString('en-US');

  function device(browser) {
    const ctx = { id: (S.ctxSeq += 1), uid: null, closed: false, pages: [] };
    const context = {
      __ctx: ctx, browser: () => browser,
      newPage: async () => { const p = pageFor(ctx, context); ctx.pages.push(p); return p; },
      close: async () => { ctx.closed = true; },
    };
    return context;
  }
  function pageFor(ctx, context) {
    const st = { path: '/', typed: {}, terms: false, step: 'entry', error: null, joinError: null, markerError: null, listeners: [], seq: 0 };
    const go = (p) => { st.path = p; st.step = 'entry'; st.error = null; st.joinError = null; st.markerError = null; st.typed = {}; };
    const landAfterAuth = () => go(holds(ctx.uid, 'signin') ? '/verify-email' : (svc.hasProfile(ctx.uid) ? '/' : '/profile-setup'));
    function render() {
      const N = new Map();
      const add = (id, n = {}) => N.set(id, n);
      const p = st.path;
      if (p === '/signin') {
        add('wsf-signin-email', { fill: (v) => { st.typed.email = v; } });
        add('wsf-signin-password', { fill: (v) => { st.typed.password = v; } });
        add('wsf-signin-submit', { click: () => {
          const uid = [...be.accounts].find(([, e]) => e === st.typed.email)?.[0];
          if (!uid || be.passwords.get(st.typed.email) !== st.typed.password) return;
          ctx.uid = uid;
          if (!S.firstCtx.has(uid)) S.firstCtx.set(uid, ctx.id);
          landAfterAuth();
        } });
        return N;
      }
      if (!ctx.uid) return N;
      const email = be.accounts.get(ctx.uid);
      if (p === '/verify-email') {
        add('wsf-verify', { text: `Step 2 of 3\nCheck your email.\nConfirm your email address at ${email}, then tap I have verified.\nSigned in as ${email}` });
        add('wsf-verify-check', { click: () => { S.verifyChecked += 1; } });
        add('wsf-verify-resend', { click: () => { S.mailSent += 1; } });
        add('wsf-verify-signout', { click: () => { ctx.uid = null; go('/'); } });
      } else if (p === '/profile-setup') {
        if (holds(ctx.uid, 'profile')) {
          add('wsf-profile-unverified', { text: 'Complete your profile\nVerify your email before completing your profile.\nVerify email' });
        } else {
          add('wsf-profile');
          add('wsf-profile-displayName', { fill: (v) => { st.typed.name = v; } });
          add('wsf-profile-termsCheckbox', { click: () => { st.terms = !st.terms; } });
          add('wsf-profile-submit', { click: () => { if (st.terms && (st.typed.name || '').length >= 2) { svc.saveProfile(ctx.uid, st.typed.name); go('/'); } } });
        }
      } else if (p === '/') {
        add('wsf-home-signed-in');
      } else if (p.startsWith('/go/')) {
        const m = svc.marker(p.slice(4));
        if (markerShut) {
          // wsfResolveMarker deployed but SHUT (invoker_iam_check_enabled): the screen's own error card.
          add('wsf-marker-error', { text: 'We couldn’t open this code. Try again.\nTry again\nBack to home' });
          add('wsf-marker-retry');
        } else if (m && svc.member(m.groupId, ctx.uid)) {
          add('wsf-marker-choose', { text: 'How will you take part?' });
          add('wsf-marker-phone', { text: 'Move on my phone', click: () => go(`/contribute/${m.goalId}`) });
        } else if (m) {
          add('wsf-marker-join');
          add('wsf-marker-join-card', { text: `Join ${svc.groupName(m.groupId)}` });
          if (holds(ctx.uid, 'marker')) add('wsf-marker-verify', { text: 'Confirm your email to join' });
          else add('wsf-marker-join-button', { text: `Join ${svc.groupName(m.groupId)}`, click: () => { try { svc.joinViaMarker(p.slice(4), ctx.uid); } catch (e) { st.markerError = e.message; } } });
          if (st.markerError) add('wsf-marker-join-error', { text: st.markerError });
        }
      } else if (p.startsWith('/join/')) {
        const code = p.slice(6);
        add('wsf-join-signed-in');
        add('wsf-join-submit', { text: 'Join', click: () => {
          try { const j = svc.joinByCode(code, ctx.uid); go(`/community/${bugs.linkWrongCommunity ? 'e5cgrp-somewhere-else' : j.groupId}`); } catch (e) { st.joinError = e.message; }
        } });
        if (st.joinError) {
          add('wsf-join-submit-error', { text: `We couldn’t join this community.\n${st.joinError}` });
          add('wsf-join-submit-error-title', { text: 'We couldn’t join this community.' });
        }
      } else if (p.startsWith('/community/')) {
        const g = p.slice(11);
        if (svc.member(g, ctx.uid)) add('wsf-community-name', { text: svc.groupName(g) });
      } else if (p.startsWith('/contribute/')) {
        const g = p.slice(12);
        if (!svc.member(svc.goalGroup(g), ctx.uid)) {
          add('wsf-contribute-not-found', { text: 'Goal not found\nThis goal doesn’t exist or isn’t available to this account.' });
          return N;
        }
        add('wsf-contribute-screen');
        add('wsf-contribute-shared-total', { text: `${fmtN(svc.shared(g))} of 1,000 squats` });
        add('wsf-contribute-own-credit', { text: `Your total on this goal: ${svc.own(g, ctx.uid, ctx)} squats` });
        if (st.step === 'receipt') add('wsf-contribute-receipt');
        else if (st.step === 'review') {
          add('wsf-contribute-review-screen');
          add('wsf-contribute-submit', { click: () => {
            const attemptId = `att-${ctx.id}-${(st.seq += 1)}`;
            const count = Number(st.typed.count);
            const req = { url: () => 'https://us-central1-westayfit-staging.cloudfunctions.net/wsfContribute', postData: () => JSON.stringify({ data: { goalId: g, attemptId, count } }) };
            for (const l of st.listeners) l(req);
            try { svc.contribute(g, ctx.uid, attemptId, count, ctx); st.step = 'receipt'; } catch (e) { st.error = e.message; }
          } });
          if (st.error) add('wsf-contribute-error', { text: st.error });
        } else {
          add('wsf-contribute-entry-screen');
          add('wsf-contribute-entry', { fill: (v) => { st.typed.count = v; } });
          add('wsf-contribute-review', { click: () => { st.step = 'review'; } });
        }
      } else if (p === '/activity') {
        add('wsf-activity');
        if (!bugs.historyMissing) {
          for (const g of new Set(S.contributions.map((c) => c.goalId))) {
            const own = svc.own(g, ctx.uid, ctx);
            if (own > 0) add(`wsf-activity-goal-${g}-yours`, { text: `YOURS\n${own} squats` });
          }
        }
      }
      return N;
    }
    function locator(selector) {
      const id = /data-testid="([^"]+)"/.exec(selector)?.[1];
      const find = () => (ctx.closed ? null : render().get(id) || null);
      const must = () => { const n = find(); if (!n) throw new Error(`locator: no ${selector}`); return n; };
      const loc = {
        first: () => loc,
        count: async () => (find() ? 1 : 0),
        innerText: async () => must().text || '',
        isDisabled: async () => false,
        click: async () => { const n = must(); if (!n.click) throw new Error(`${selector} is not clickable`); n.click(); },
        fill: async (v) => must().fill(v),
        waitFor: async () => { must(); },
      };
      return loc;
    }
    const page = {
      goto: async (url) => go(new URL(url).pathname),
      url: () => `https://staging.example.test${st.path}`,
      waitForTimeout: async () => {},
      waitForURL: async (pred) => { if (!pred(new URL(page.url()))) throw new Error('page.waitForURL: Timeout exceeded'); },
      locator,
      getByTestId: (id) => locator(`[data-testid="${id}"]`),
      on: (ev, fn) => { if (ev === 'request') st.listeners.push(fn); },
      off: (ev, fn) => { st.listeners = st.listeners.filter((l) => l !== fn); },
      context: () => context,
      screenshot: async ({ path: out }) => { fs.writeFileSync(out, 'png'); },
    };
    return page;
  }
  const opened = [];
  const browser = { newContext: async () => { const c = device(browser); opened.push(c); return c; } };
  const root = device(browser);
  const rootPage = pageFor(root.__ctx, root);
  return { dir, be, kit, S, svc, fixtures: kit, page: rootPage, opened };
}

const UNVERIFIED_ROWS = ['signin', 'profile', 'marker', 'link', 'contribute', 'history', 'fresh', 'round', 'control'];
async function driveUnverified(opts = {}) {
  const h = unverifiedHarness(opts);
  const used = new Set();
  const fixtures = new Proxy(h.fixtures, { get: (k, name) => { used.add(name); return k[name]; } });
  const r = await drivers['unverified-participant']({ page: h.page, baseUrl: 'https://staging.example.test', journey: { id: 'unverified-participant' }, fixtures });
  const byRow = Object.fromEntries(r.assertions.map((a) => [tagOf(a.expected), a]));
  return { ...h, r, used, byRow, failed: r.assertions.filter((a) => !a.ok).map((a) => tagOf(a.expected)) };
}
const cleanAll = async (h) => {
  const { server, base } = await serve(h.be);
  const c = await runCleanup(base, h.kit.manifestPath, path.join(h.dir, 'cleanup-receipt.json'));
  server.close();
  return c;
};

await test('UNVERIFIED: the driver is registered beside the expo drivers, asserts nine rows, and the live manifest names it word for word', () => {
  assert.equal(drivers['unverified-participant'], expoDrivers['unverified-participant']);
  assert.equal(typeof drivers['unverified-participant'], 'function');
  assert.deepEqual(Object.keys(EXPO_ROWS['unverified-participant']), UNVERIFIED_ROWS);
  const j = live().journeys.find((x) => x.id === 'unverified-participant');
  assert.ok(j, 'the live manifest names the journey');
  assert.deepEqual(j.expected, Object.values(EXPO_ROWS['unverified-participant']));
  assert.equal(j.entry, '/go/{markerSlug}');
});

await test('UNVERIFIED at 819c26f0 as served: every visitor row fails on the screen that holds the account, the verified control passes, nothing is verified or mailed', async () => {
  const d = await driveUnverified();
  assert.deepEqual(d.failed, ['signin', 'profile', 'marker', 'link', 'contribute', 'history', 'fresh', 'round']);
  assert.equal(d.byRow.control.ok, true, d.byRow.control.expected);
  assert.match(d.byRow.signin.expected, /\/verify-email: held at the verification page \(Check your email\.\)/);
  assert.match(d.byRow.profile.expected, /\/profile-setup: the profile page shows only Verify your email before completing your profile\./);
  assert.match(d.byRow.marker.expected, /the marker shows Confirm your email to join in place of its Join button/);
  assert.match(d.byRow.link.expected, /\/join\/\[link\]: We couldn’t join this community\. Complete your profile before joining a community\./);
  assert.match(d.byRow.round.expected, /Goal not found/);
  assert.match(d.byRow.fresh.expected, /\/verify-email: held at the verification page/);
  const everything = JSON.stringify(d.r);
  for (const [, email] of d.be.accounts) assert.equal(everything.includes(email), false, 'no synthetic address reaches the results');
  const ev = d.be.docs.get([...d.be.docs.keys()].find((p) => /^wsfCommunityGroups\/e5cgrp-/.test(p)));
  assert.equal(everything.includes(ev.joinCode.stringValue), false, 'no join code reaches the results');
  assert.equal(d.S.mailSent + d.S.verifyChecked, 0, 'Resend and I have verified are never pressed');
  const [visitor] = [...d.be.verified].find(([, v]) => v === false);
  assert.equal([...d.be.docs.keys()].some((p) => p.endsWith(visitor) || p.includes(`_${visitor}`)), false, 'the held visitor was admitted to nothing');
  assert.ok(d.opened.every((c) => c.__ctx.closed), 'every device closed');
  const c = await cleanAll(d);
  assert.equal(c.receipt.status, 'COMPLETE', c.out);
  assert.equal(d.be.docs.size + d.be.accounts.size, 0);
});

await test('UNVERIFIED with the marker services SHUT, as this pin\'s deploy is expected to leave them: the marker rows and the control fail on the marker\'s own error card, named; nothing is admitted by marker; the REAL cleaner empties the store', async () => {
  const served = await driveUnverified({ markerShut: true });
  assert.deepEqual(served.failed, ['signin', 'profile', 'marker', 'link', 'contribute', 'history', 'fresh', 'round', 'control']);
  assert.match(served.byRow.marker.expected, /\/go\/[^:]+: We couldn’t open this code\. Try again\./);
  assert.match(served.byRow.control.expected, /joined false; .*We couldn’t open this code\. Try again\./);
  assert.equal((await cleanAll(served)).receipt.status, 'COMPLETE');
  assert.equal(served.be.docs.size + served.be.accounts.size, 0);
  // Even with the native screens repaired, every row that goes through the marker fails until its transport is opened.
  const repaired = await driveUnverified({ markerShut: true, repaired: true });
  assert.deepEqual(repaired.failed, ['marker', 'contribute', 'history', 'fresh', 'round', 'control']);
  assert.equal(repaired.byRow.link.ok, true, 'the join link does not use the marker services');
  assert.equal((await cleanAll(repaired)).receipt.status, 'COMPLETE');
  assert.equal(repaired.be.docs.size + repaired.be.accounts.size, 0);
});

await test('UNVERIFIED with the screens repaired: every row holds; the visitor is admitted by the product and credited 15 then 25; the REAL cleaner empties the store', async () => {
  const d = await driveUnverified({ repaired: true });
  assert.deepEqual(d.failed, [], d.r.assertions.filter((a) => !a.ok).map((a) => a.expected).join(' | '));
  assert.deepEqual(d.r.assertions.map((a) => tagOf(a.expected)), UNVERIFIED_ROWS);
  const [visitor] = [...d.be.verified].find(([, v]) => v === false);
  const group = [...d.be.docs.keys()].find((p) => /^wsfCommunityGroups\/e5cgrp-/.test(p)).split('/')[1];
  assert.ok(d.be.docs.has(`wsfMemberships/${group}_${visitor}`) && d.be.docs.has(`wsfMemberProfiles/${visitor}`));
  assert.equal(d.S.contributions.filter((x) => x.uid === visitor).map((x) => x.count).join('+'), '15+10');
  assert.equal(d.S.mailSent + d.S.verifyChecked, 0);
  assert.ok(d.opened.every((c) => c.__ctx.closed));
  const c = await cleanAll(d);
  assert.equal(c.receipt.status, 'COMPLETE', c.out);
  assert.equal(d.be.docs.size + d.be.accounts.size, 0, `left ${[...d.be.docs.keys()].join(', ')}`);
});

const UNVERIFIED_DEFECTS = [
  [{ holdAtSignin: true }, ['signin', 'fresh']],
  // The control joins only by the marker, so a marker join that writes nothing fails it too.
  [{ bugs: { markerJoinsNothing: true } }, ['marker', 'control']],
  [{ bugs: { linkWrongCommunity: true } }, ['link']],
  // ...and its membership there is claimed by the sweep after the link, so cleanup still leaves nothing.
  [{ bugs: { linkAdmitsElsewhere: true } }, ['link']],
  [{ bugs: { profileNotSaved: true } }, ['marker', 'link', 'contribute', 'history', 'fresh', 'round', 'control']],
  [{ bugs: { doubleCount: true } }, ['contribute', 'history', 'fresh', 'round', 'control']],
  [{ bugs: { creditLostOnFresh: true } }, ['fresh', 'round']],
  [{ bugs: { roundRefused: true } }, ['round']],
  [{ bugs: { historyMissing: true } }, ['history', 'fresh']],
  [{ bugs: { sharedMissesOwn: true } }, ['contribute', 'round']],
];
for (const [defect, rows] of UNVERIFIED_DEFECTS) {
  await test(`UNVERIFIED (repaired) fails on a seeded defect ${JSON.stringify(defect)} exactly on ${rows.join(', ')}, and still leaves nothing behind`, async () => {
    const d = await driveUnverified({ repaired: true, ...defect });
    assert.deepEqual(d.failed, rows);
    const c = await cleanAll(d);
    assert.equal(c.receipt.status, 'COMPLETE', c.out);
    assert.equal(d.be.docs.size + d.be.accounts.size, 0);
  });
}

await test('UNVERIFIED: the driver reaches the store only through these kit calls, never presses the verification controls, and the kit never verifies an address', async () => {
  const d = await driveUnverified();
  const allowed = new Set(['joinableEvent', 'createUnverifiedUser', 'createVerifiedUser', 'expectVisitor', 'claimMemberships', 'signInLanding', 'trackContribution']);
  for (const name of d.used) if (typeof name === 'string') assert.ok(allowed.has(name), `used fixtures.${name}`);
  const driver = fs.readFileSync(path.resolve('.github/wsf-staging/journeys/expo-attendee.mjs'), 'utf8');
  assert.doesNotMatch(driver, /wsf-verify-(resend|check|signout)/);
  const kitSrc = fs.readFileSync(path.resolve('.github/wsf-staging/journeys/fixture-kit.mjs'), 'utf8');
  assert.equal(kitSrc.match(/emailVerified: true/g).length, 1, 'only createVerifiedUser makes a verified account');
  assert.doesNotMatch(kitSrc, /accounts:update|setAccountInfo|oobCode|sendOobCode/, 'nothing in the kit changes or verifies an account');
});

async function unverifiedThroughRunner(opts) {
  const d = tmp();
  const m = { ...live(), journeys: live().journeys.filter((j) => j.id === 'unverified-participant') };
  const mf = path.join(d, 'manifest.json');
  fs.writeFileSync(mf, JSON.stringify(m));
  const changed = path.join(d, 'evidence', 'changed-journeys');
  const h = unverifiedHarness(opts);
  const browser = { newContext: (o) => h.page.context().browser().newContext(o), close: async () => {} };
  const hook = await runHook({ WSF_JOURNEY_MANIFEST: mf, WSF_STAGING_URL: 'https://staging.example.test', WSF_APPROVED_SHA: APPROVED, WSF_RESULT_DIR: path.join(d, 'evidence') }, {
    fetch: async () => ({ ok: true, text: async () => `commit ${APPROVED.slice(0, 7)}` }), launch: async () => browser, fixtures: () => h.fixtures,
  });
  const receipt = path.join(changed, 'cleanup-receipt.json');
  const { server, base } = await serve(h.be);
  const cleanup = await runCleanup(base, h.kit.manifestPath, receipt);
  server.close();
  const card = spawnSync(process.execPath, [CARD, '--manifest', mf, '--results', path.join(changed, 'changed-journeys.json'),
    '--cleanup-manifest', h.kit.manifestPath, '--cleanup-receipt', receipt, '--staging-url', 'https://staging.example.test', '--out', path.join(changed, 'card.md')], { encoding: 'utf8' });
  return { hook, cleanup, card, h };
}

await test('UNVERIFIED through the runner and the card, at the build as served: FAILED, the eight visitor rows named, cleanup COMPLETE', async () => {
  const t = await unverifiedThroughRunner();
  const [x] = t.hook.results.results;
  assert.equal(x.journeyId, 'unverified-participant');
  assert.equal(x.status, 'failed');
  assert.deepEqual(x.assertions.filter((a) => !a.ok).map((a) => tagOf(a.expected)), ['signin', 'profile', 'marker', 'link', 'contribute', 'history', 'fresh', 'round']);
  assert.equal(t.cleanup.receipt.status, 'COMPLETE');
  assert.equal(t.h.be.docs.size + t.h.be.accounts.size, 0);
  assert.match(t.card.stdout, /OWNER_CARD_SUMMARY=FAILED/);
});

await test('UNVERIFIED through the runner and the card, once the native screens are repaired: PASSED, cleanup COMPLETE', async () => {
  const t = await unverifiedThroughRunner({ repaired: true });
  const [x] = t.hook.results.results;
  assert.equal(x.status, 'passed', x.reason);
  assert.equal(t.cleanup.receipt.status, 'COMPLETE');
  assert.match(t.card.stdout, /OWNER_CARD_CLEANUP=COMPLETE\nOWNER_CARD_SUMMARY=PASSED/);
});

console.log(`\nchanged-journey-drivers: ${passed} passed`);
