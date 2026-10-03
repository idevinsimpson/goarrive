#!/usr/bin/env node
/**
 * HOME-HOSTED-JOURNEY-1 (Director #396 5849944214): the hosted Home
 * changed-journey driver and the exact HOME-NORTHSTAR-PARITY-1 manifest for
 * the approved build f84346d3 (rolling back to the served ab77fbfc), hermetically.
 *
 * - The manifest is exact: the served/approved product SHA, the previous
 *   known-good, a registered driver, and only rows the driver measures.
 * - The driver runs for real against the scripted page model of the served
 *   Home contract (tests/helpers/journey-model.mjs) seeded by the REAL fixture
 *   kit; each seeded product defect fails the row that names it.
 * - Through the hook, the REAL cleaner and the owner card, as the workflow
 *   orders them: PASSED only with every row held and cleanup complete.
 *
 * What this cannot prove is that staging renders that contract: that is what
 * the hosted activation run is for.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { backend, harness, kitFor, runCleanup, serve, tmp } from './helpers/journey-model.mjs';
import { drivers } from '../journeys/index.mjs';
import { checkManifestObject } from '../check-milestone-manifest.mjs';
import { validateManifest } from '../milestone-manifest.mjs';
import { runHook } from '../hosted-changed-journeys.mjs';

const W = path.resolve('.github/wsf-staging');
const MANIFEST = path.join(W, 'journeys/examples/home-northstar-parity-1.json');
const CARD = path.join(W, 'owner-test-card.mjs');
const SERVED = 'f84346d3b902432a7152719780f0afb94ec9cc3c';
const PREVIOUS = 'ab77fbfce97e60c1c22492397b2ab6b491f9e0db';
const manifest = () => JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const home = () => manifest().journeys.find((j) => j.id === 'home');
let passed = 0;
const test = async (n, f) => { await f(); passed += 1; console.log(`  ok  ${n}`); };

async function drive(bugs = {}) {
  const h = harness(bugs);
  const r = await drivers.home({ page: h.page, baseUrl: 'https://staging.example.test', journey: home(), fixtures: h.fixtures });
  return { ...h, r, failed: r.assertions.filter((a) => !a.ok).map((a) => a.expected) };
}
const { HOME_ROWS, HOME_SEEDED } = await import('../journeys/home.mjs').catch(() => ({ HOME_ROWS: null, HOME_SEEDED: null }));

// ---- the manifest ----------------------------------------------------------------------
await test('the Home manifest is exact: product f84346d3 (the approved candidate), previous known-good ab77fbfc, schema-valid', () => {
  const m = manifest();
  assert.deepEqual(validateManifest(m), []);
  assert.equal(m.milestone, 'HOME-NORTHSTAR-PARITY-1');
  assert.equal(m.productSha, SERVED);
  assert.equal(m.previousKnownGoodSha, PREVIOUS);
  const approved = JSON.parse(fs.readFileSync(path.join(W, 'approved-candidate.json'), 'utf8'));
  assert.equal(approved.approvedAppSha, m.productSha, 'the manifest names exactly the build staging is approved to serve');
  assert.deepEqual(m.journeys.map((j) => j.id), ['home']);
});

await test('an unregistered Home id is refused; once registered, the exact manifest validates against the approved build', () => {
  const m = manifest();
  const { home: _registered, ...without } = drivers;
  const refused = checkManifestObject(m, { approvedSha: SERVED, drivers: without });
  assert.equal(refused.status, 'refused');
  assert.match(refused.lines.join('\n'), /no registered driver for journey home \(journeys\/index\.mjs\)/);
  assert.equal(typeof drivers.home, 'function', 'home is registered in journeys/index.mjs');
  const ok = checkManifestObject(m, { approvedSha: SERVED, drivers });
  assert.equal(ok.status, 'valid', ok.lines.join('\n'));
});

await test('the CLI gate check accepts the Home manifest only for the served build', () => {
  const run = (sha) => spawnSync(process.execPath, [path.join(W, 'check-milestone-manifest.mjs'), '--require', MANIFEST],
    { encoding: 'utf8', env: { ...process.env, WSF_APPROVED_SHA: sha } });
  const good = run(SERVED);
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /MILESTONE_MANIFEST=valid/);
  const stale = run(PREVIOUS);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /the manifest is for f84346d3/);
});

await test('a wrong product SHA is refused rather than driven', () => {
  const m = { ...manifest(), productSha: PREVIOUS, previousKnownGoodSha: '74d1928145bbc76267498ee63b9423b6f6cdfae8' };
  assert.deepEqual(validateManifest(m), []);
  assert.equal(checkManifestObject(m, { approvedSha: SERVED, drivers }).status, 'refused');
});

// ---- the card claims only what the driver measures ---------------------------------------
await test('the manifest\'s expected rows are exactly the rows the driver measures, and each row carries a real assertion', async () => {
  assert.ok(HOME_ROWS, 'journeys/home.mjs exports HOME_ROWS');
  assert.deepEqual(home().expected, Object.values(HOME_ROWS), 'the card prints these rows; each must be a row the driver asserts');
  const { r } = await drive();
  for (const key of Object.keys(HOME_ROWS)) {
    assert.ok(r.assertions.some((a) => a.expected.startsWith(`[${key}] `)), `row ${key} has no assertion behind it`);
  }
  for (const a of r.assertions) assert.match(a.expected, new RegExp(`^\\[(${Object.keys(HOME_ROWS).join('|')})\\] `), `an assertion outside the manifest's rows: ${a.expected}`);
});

await test('unavailable services are exclusions, never rows: presence, moved-today and Members are not claimed', () => {
  const j = home();
  assert.ok(j.knownExclusions.some((e) => /wsfCommunityMembers/.test(e) && /wsfCommunityActivity/.test(e) && /transport-shut/.test(e)));
  assert.ok(j.knownExclusions.some((e) => /never submits/.test(e)));
  for (const e of j.expected) assert.doesNotMatch(e, /moved today|presence|faces|Members|roster/i, `an unmeasurable row is claimed: ${e}`);
});

await test('the figures the driver asserts are the ones the REAL fixture kit seeds', async () => {
  assert.ok(HOME_SEEDED);
  const be = backend();
  const fx = await kitFor(tmp(), be).memberInTwoCommunities('home');
  const goal = be.docs.get(`wsfGoals/${fx.a.goalId}`);
  assert.equal(Number(goal.target.integerValue), HOME_SEEDED.target);
  assert.equal(goal.unit.stringValue, HOME_SEEDED.unit);
  const shards = [...be.docs.entries()].filter(([p]) => p.startsWith(`wsfGoalCounters/${fx.a.goalId}/shards/`));
  assert.equal(shards.reduce((n, [, f]) => n + Number(f.count.integerValue), 0), HOME_SEEDED.shared);
  assert.equal([...be.docs.keys()].some((p) => p.startsWith('wsfGoalMemberTotals/')), false, 'no own total is seeded: the own part is its true zero');
  assert.equal(be.docs.get(`wsfMemberships/${fx.a.id}_${fx.member.uid}`).role.stringValue, 'member');
});

// ---- the driver against the served contract --------------------------------------------
await test('HOME on a faithful model of a3127651: real actions, every row holds, nothing is submitted', async () => {
  const { r, failed, be } = await drive();
  assert.deepEqual(failed, []);
  assert.ok(r.assertions.length >= 14, `${r.assertions.length} assertions`);
  assert.deepEqual(r.actionsPerformed.map((a) => a.split(' ').slice(0, 2).join(' ')), [
    'signed in', 'opened Home', 'pressed Start', 'pressed Close', 'pressed Already', 'pressed Back', 'opened the', 'opened the',
  ]);
  assert.match(r.setupId, /member of A, founding Champion of B/);
  assert.ok(be.requests.every((q) => q.admin), 'the only writes are the kit\'s admin-scoped fixtures');
  assert.equal(r.actionsPerformed.some((a) => /submit|record(ed)? \d/i.test(a)), false);
});

const DEFECTS = [
  [{ homeShowsOther: true }, 'identity'],
  [{ otherGoalLeaks: true }, 'goal'],
  [{ windowClosed: true }, 'goal'],
  [{ totalOff: true }, 'figures'],
  [{ fabricatedOwn: true }, 'own'],
  [{ sharedBlended: true }, 'own'],
  [{ ownFigureBesideZero: true }, 'own'],
  [{ noStart: true }, 'actions'],
  [{ startGoesNowhere: true }, 'actions'],
  [{ recordUnlabelled: true }, 'actions'],
  [{ recordOpensMove: true }, 'actions'],
  [{ backLost: true }, 'returns'],
  [{ homeTabLosesCommunity: true }, 'returns'],
  // Run 56 (served a3127651): Start moving is MOVE's sheet, left by Close; Already moved is the page, left by Back.
  [{ closeBroken: true }, 'returns'],
  [{ moveAsPage: true }, 'actions'],
  [{ recordLosesBack: true }, 'returns'],
];
for (const [bugs, row] of DEFECTS) {
  await test(`HOME fails its ${row} row on a seeded defect: ${Object.keys(bugs)[0]}`, async () => {
    const { failed } = await drive(bugs);
    assert.ok(failed.some((f) => f.startsWith(`[${row}] `)), `expected a failed [${row}] assertion; failed: ${failed.join(' | ') || 'none'}`);
  });
}

// ---- run 56: the served exits (Director #396 5851190413) ---------------------------------
await test('run 56: Start moving opens MOVE as a sheet over Home that draws Close and no Back; the driver leaves it by Close and requires the sheet gone', async () => {
  const { r, failed, app } = await drive();
  assert.deepEqual(failed, []);
  assert.ok(r.actionsPerformed.includes('pressed Close from Start moving'), r.actionsPerformed.join(' | '));
  assert.equal(r.actionsPerformed.some((a) => a === 'pressed Back from Start moving'), false, 'the sheet has no Back to press');
  assert.ok(r.assertions.some((a) => /^\[actions\] Start moving opens MOVE as the sheet over Home/.test(a.expected) && a.ok));
  assert.ok(r.assertions.some((a) => /^\[returns\] Close from Start moving returns to .*, the sheet closed/.test(a.expected) && a.ok));
  assert.equal(app().st.sheet, null, 'the sheet is closed at the end');
});
await test('run 56: Already moved is the page flow, left by its Back (it draws no Close)', async () => {
  const { r } = await drive();
  assert.ok(r.actionsPerformed.includes('pressed Back from Already moved'));
  assert.equal(r.actionsPerformed.includes('pressed Close from Already moved'), false);
});
await test('run 56: a Close that leaves the sheet open fails [returns] even though Home is still painted beneath it, and the journey continues', async () => {
  const { r, failed } = await drive({ closeBroken: true });
  assert.ok(failed.some((f) => /^\[returns\] Close from Start moving returns to .*\(saw: sheet still open/.test(f)), failed.join(' | '));
  assert.ok(r.actionsPerformed.some((a) => a.startsWith('reopened Home to recover')), r.actionsPerformed.join(' | '));
  assert.ok(r.actionsPerformed.includes('pressed Back from Already moved'), 'one defect does not strand the rest of the journey');
});

// ---- run 57: the window pill is CSS-uppercased (Director #396 5851553145) --------------------
await test('run 57: the served window pill reads "OPEN · ENDS THU, OCT 1" (CSS uppercase) and the [goal] row holds on its words, not its case', async () => {
  const { r, failed } = await drive();
  assert.deepEqual(failed, []);
  const row = r.assertions.find((a) => a.expected.startsWith("[goal] the goal's window reads Open · Ends"));
  assert.ok(row && row.ok, JSON.stringify(row));
  assert.match(row.expected, /\(saw: OPEN · ENDS THU, OCT 1\)$/, 'the model reads the pill the way the served page does');
});
await test('run 57: an ended window still fails the [goal] row, in any case', async () => {
  const { failed } = await drive({ windowClosed: true });
  assert.ok(failed.some((f) => /^\[goal\] the goal's window reads Open · Ends … \(saw: ENDED SEP 20\)$/.test(f)), failed.join(' | '));
});

// ---- through the hook, the cleaner and the card ------------------------------------------
async function sequence({ failDeletes = false, skipCleanup = false, registry = null } = {}) {
  const d = tmp();
  const m = manifest();
  const mf = path.join(d, 'manifest.json');
  fs.writeFileSync(mf, JSON.stringify(m));
  const changed = path.join(d, 'evidence', 'changed-journeys');
  const env = { WSF_JOURNEY_MANIFEST: mf, WSF_STAGING_URL: 'https://staging.example.test', WSF_APPROVED_SHA: m.productSha, WSF_RESULT_DIR: path.join(d, 'evidence') };
  const hs = {};
  const browser = {
    newContext: async () => ({ newPage: async () => new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : (...a) => hs.current.page[k](...a)) }), close: async () => {} }),
    close: async () => {},
  };
  let h = null;
  const hook = await runHook(env, {
    fetch: async () => ({ ok: true, text: async () => `commit ${m.productSha.slice(0, 7)}` }),
    launch: async () => browser,
    loadDrivers: registry ? async () => registry : undefined,
    fixtures: () => { h = harness({}); hs.current = { get page() { return h.app().page; } }; return h.fixtures; },
  });
  const receipt = path.join(changed, 'cleanup-receipt.json');
  let cleanup = null;
  if (h && !skipCleanup) {
    const { server, base } = await serve(h.be, { failDeletes });
    cleanup = await runCleanup(base, h.kit.manifestPath, receipt);
    server.close();
  }
  const cardPath = path.join(changed, 'owner-test-card.md');
  const card = spawnSync(process.execPath, [CARD, '--manifest', mf, '--results', path.join(changed, 'changed-journeys.json'),
    '--cleanup-manifest', h ? h.kit.manifestPath : path.join(d, 'none.json'), '--cleanup-receipt', receipt,
    '--staging-url', 'https://staging.example.test', '--out', cardPath], { encoding: 'utf8' });
  return { hook, cleanup, card, cardText: fs.existsSync(cardPath) ? fs.readFileSync(cardPath, 'utf8') : null, be: h?.be };
}

await test('the runner drives Home from the exact manifest; the REAL cleaner removes every fixture; the card is PASSED and lists the exclusions', async () => {
  const s = await sequence();
  const [x] = s.hook.results.results;
  assert.equal(x.status, 'passed', x.reason);
  assert.equal(x.servedMarker, SERVED);
  assert.equal(s.cleanup.code, 0, s.cleanup.out);
  assert.equal(s.cleanup.receipt.status, 'COMPLETE');
  assert.equal(s.be.accounts.size + s.be.docs.size, 0, 'nothing the Home run created is left behind');
  assert.equal(s.card.status, 0, s.card.stderr);
  assert.match(s.card.stdout, /OWNER_CARD_CLEANUP=COMPLETE\nOWNER_CARD_SUMMARY=PASSED/);
  assert.match(s.cardText, /# Owner test card: HOME-NORTHSTAR-PARITY-1/);
  assert.match(s.cardText, /Previous known-good \/ rollback SHA: ab77fbfce97e60c1c22492397b2ab6b491f9e0db/);
  assert.match(s.cardText, /Hosted smoke: \*\*PASSED\*\* — \d+ assertions held/);
  assert.match(s.cardText, /transport-shut on staging/);
  assert.match(s.cardText, /Device review: NOT RUN — Devin's verdict/);
});

await test('skipped cleanup: with no cleaner receipt the card is never PASSED, though Home passed', async () => {
  const s = await sequence({ skipCleanup: true });
  assert.equal(s.hook.results.results[0].status, 'passed');
  assert.match(s.card.stdout, /OWNER_CARD_CLEANUP=NOT_RUN\nOWNER_CARD_SUMMARY=INCOMPLETE/);
  assert.doesNotMatch(s.cardText, /status: PASSED/);
});

await test('a cleanup that cannot complete leaves the Home card INCOMPLETE', async () => {
  const s = await sequence({ failDeletes: true });
  assert.notEqual(s.cleanup.code, 0);
  assert.match(s.card.stdout, /OWNER_CARD_CLEANUP=INCOMPLETE\nOWNER_CARD_SUMMARY=INCOMPLETE/);
});

await test('a fabricated PASS is not a pass: a Home driver that asserts nothing, or asserts a failure, is FAILED', async () => {
  for (const [driver, reason] of [
    [async () => ({ setupId: 'x', actionsPerformed: ['nothing'], assertions: [] }), /checked no assertion/],
    [async () => ({ setupId: 'x', actionsPerformed: ['x'], assertions: [{ expected: '[figures] 120 of 500', ok: false }, { expected: '[identity] x', ok: true }] }), /did not hold/],
  ]) {
    const s = await sequence({ registry: { home: driver } });
    assert.equal(s.hook.results.results[0].status, 'failed');
    assert.match(s.hook.results.results[0].reason, reason);
    assert.doesNotMatch(s.card.stdout, /OWNER_CARD_SUMMARY=PASSED/);
  }
});

console.log(`\nhome-journey: ${passed} passed`);
