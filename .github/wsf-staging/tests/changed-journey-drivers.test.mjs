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
import { RUN_TAG, backend, harness, kitFor, runCleanup, serve, tmp } from './helpers/journey-model.mjs';
import { drivers } from '../journeys/index.mjs';
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

console.log(`\nchanged-journey-drivers: ${passed} passed`);
