#!/usr/bin/env node
/**
 * hosted-changed-journeys.mjs: report-only, lazy, and never a false pass.
 * The registry, fetch and browser are substituted; nothing here reaches a network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runHook } from '../hosted-changed-journeys.mjs';
import { drivers as registered } from '../journeys/index.mjs';

const CLI = path.resolve('.github/wsf-staging/hosted-changed-journeys.mjs');
let passed = 0;
const test = async (n, f) => { await f(); passed += 1; console.log(`  ok  ${n}`); };

const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const journey = (id) => ({ id, entry: `/${id}`, setup: 's', actions: ['open'], expected: [`${id} ok`], knownExclusions: [] });
const manifestFor = (productSha, ids = ['community', 'you']) => ({
  schemaVersion: 1, milestone: 'TEST-MILESTONE-1', productSha, previousKnownGoodSha: B, journeys: ids.map(journey),
});

function setup(manifest) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-cj-'));
  const mf = path.join(d, 'manifest.json');
  if (manifest !== undefined) fs.writeFileSync(mf, typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  const env = { WSF_JOURNEY_MANIFEST: mf, WSF_STAGING_URL: 'https://staging.example.test/', WSF_APPROVED_SHA: A, WSF_RESULT_DIR: path.join(d, 'evidence') };
  return { d, env, out: path.join(d, 'evidence', 'changed-journeys') };
}
function spy({ health = `ok ${A.slice(0, 7)}`, healthOk = true, fetchThrows = false } = {}) {
  const calls = { fetch: [], launch: 0, closed: 0, contexts: 0, shots: [] };
  const browser = {
    newContext: async () => { calls.contexts += 1; return { newPage: async () => ({ screenshot: async ({ path: p }) => { calls.shots.push(p); fs.writeFileSync(p, 'png'); } }), close: async () => {} }; },
    close: async () => { calls.closed += 1; },
  };
  return {
    calls,
    fetch: async (url) => { calls.fetch.push(url); if (fetchThrows) throw new Error('unreachable'); return { ok: healthOk, text: async () => health }; },
    launch: async () => { calls.launch += 1; return browser; },
    fixtures: () => { calls.fixtures = (calls.fixtures || 0) + 1; return { kit: 'fake' }; },
  };
}
const byId = (r) => Object.fromEntries(r.results.results.map((x) => [x.journeyId, x]));

await test('the shipped registry holds exactly the reviewed Community and Settings drivers, frozen', () => {
  assert.deepEqual(Object.keys(registered).sort(), ['community', 'settings']);
  assert.ok(Object.isFrozen(registered));
  for (const d of Object.values(registered)) assert.equal(typeof d, 'function');
});

await test('no manifest configured: skipped, no browser, no network, no files', async () => {
  const s = spy();
  const r = await runHook({}, { ...s, loadDrivers: async () => ({}) });
  assert.deepEqual(r.lines, ['CHANGED_JOURNEY_SMOKE=skipped (no milestone manifest for this run)']);
  assert.equal(s.calls.launch + s.calls.fetch.length, 0);
});

await test('a configured path with no file there: skipped', async () => {
  const { env, out } = setup(undefined);
  const s = spy();
  const r = await runHook(env, { ...s, loadDrivers: async () => ({}) });
  assert.match(r.lines[0], /CHANGED_JOURNEY_SMOKE=skipped/);
  assert.equal(fs.existsSync(out), false);
});

await test('no registered driver: every journey BLOCKED, the browser is never launched, and the card is INCOMPLETE', async () => {
  const { env, out } = setup(manifestFor(A));
  const s = spy();
  const r = await runHook(env, { ...s, loadDrivers: async () => ({}) });
  assert.equal(s.calls.launch, 0, 'nothing to drive must not start a browser');
  assert.equal(s.calls.fixtures || 0, 0, 'nothing to drive must not mint fixtures');
  assert.equal(s.calls.fetch.length, 0, 'nothing to drive must not touch the network');
  for (const x of r.results.results) {
    assert.equal(x.status, 'blocked');
    assert.equal(x.reason, 'no registered driver');
  }
  assert.ok(r.lines.includes('CHANGED_JOURNEY_SMOKE=INCOMPLETE'));
  const card = fs.readFileSync(path.join(out, 'owner-test-card.md'), 'utf8');
  assert.match(card, /\*\*BLOCKED\*\* — no registered driver/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(out, 'changed-journeys.json'), 'utf8')), r.results);
});

await test('a manifest for another product SHA: every journey BLOCKED, no driver or network call', async () => {
  const { env } = setup(manifestFor(B.replace(/b/g, 'c')));
  const s = spy();
  let driven = 0;
  const r = await runHook(env, { ...s, loadDrivers: async () => ({ community: async () => { driven += 1; } }) });
  assert.equal(driven + s.calls.fetch.length + s.calls.launch, 0);
  for (const x of r.results.results) assert.match(x.reason, /the manifest is for cccccccc, this run deploys aaaaaaaa/);
});

await test('a driver whose assertions hold: passed on the observed build, one browser, closed', async () => {
  const { env } = setup(manifestFor(A, ['community']));
  const s = spy();
  const r = await runHook(env, { ...s, loadDrivers: async () => ({
    community: async ({ baseUrl, journey: j }) => {
      assert.equal(baseUrl, 'https://staging.example.test');
      return { setupId: 'member-1', actionsPerformed: ['open community'], assertions: [{ expected: j.expected[0], ok: true }] };
    },
  }) });
  assert.deepEqual(s.calls.fetch, ['https://staging.example.test/health']);
  assert.equal(s.calls.launch, 1);
  assert.equal(s.calls.closed, 1);
  assert.equal(r.results.servedSha, A);
  assert.equal(byId(r).community.status, 'passed');
  assert.ok(r.lines.includes('CHANGED_JOURNEY_SMOKE=PASSED'));
});

await test('the health marker does not name the deployed SHA: BLOCKED, driver never called, no browser', async () => {
  const { env } = setup(manifestFor(A, ['community']));
  const s = spy({ health: 'ok 1234567' });
  let driven = 0;
  const r = await runHook(env, { ...s, loadDrivers: async () => ({ community: async () => { driven += 1; } }) });
  assert.equal(driven + s.calls.launch + (s.calls.fixtures || 0), 0, 'a wrong build gets no browser and no fixtures');
  assert.equal(r.results.servedSha, null);
  assert.match(byId(r).community.reason, /health marker does not name aaaaaaa/);
});

await test('health unreachable: BLOCKED, not an error and not a pass', async () => {
  const { env } = setup(manifestFor(A, ['community']));
  const s = spy({ fetchThrows: true });
  const r = await runHook(env, { ...s, loadDrivers: async () => ({ community: async () => ({}) }) });
  assert.equal(byId(r).community.status, 'blocked');
});

await test('a failing assertion, an empty driver result and a throwing driver are all FAILED', async () => {
  const { env, out } = setup(manifestFor(A, ['community', 'you', 'progress']));
  const s = spy();
  const r = await runHook(env, { ...s, loadDrivers: async () => ({
    community: async () => ({ assertions: [{ expected: 'community ok', ok: false }] }),
    you: async () => ({}),
    progress: async () => { throw new Error('button not found at https://x.test/?oobCode=SECRET\nstack'); },
  }) });
  const x = byId(r);
  assert.equal(x.community.status, 'failed');
  assert.equal(x.you.status, 'failed');
  assert.equal(x.you.reason, 'the driver checked no assertion');
  assert.equal(x.progress.status, 'failed');
  assert.doesNotMatch(x.progress.reason, /SECRET|stack/, 'a thrown message is reduced to one line with query values removed');
  assert.equal(x.progress.artifact, 'changed-journeys/progress.png');
  assert.ok(fs.existsSync(path.join(out, 'progress.png')));
  assert.equal(s.calls.launch, 1, 'one browser for the whole run');
  assert.equal(s.calls.closed, 1);
  assert.ok(r.lines.includes('CHANGED_JOURNEY_SMOKE=FAILED'));
});

await test('a driver to run without the fixture credentials is reported as an error, with the browser closed', async () => {
  const { env } = setup(manifestFor(A, ['community']));
  const s = spy();
  delete s.fixtures;
  const r = await runHook(env, { ...s, loadDrivers: async () => ({ community: async () => ({}) }) });
  assert.match(r.lines[0], /CHANGED_JOURNEY_SMOKE=error \(WSF_GOOGLE_ACCESS_TOKEN is required\)/);
  assert.equal(s.calls.launch, 0, 'no browser before the fixtures exist');
});

await test('the fixture kit is made once per run and passed to every driver', async () => {
  const { env } = setup(manifestFor(A, ['community', 'you']));
  const s = spy();
  const seen = [];
  await runHook(env, { ...s, loadDrivers: async () => ({
    community: async ({ fixtures }) => { seen.push(fixtures); return { assertions: [{ expected: 'x', ok: true }] }; },
    you: async ({ fixtures }) => { seen.push(fixtures); return { assertions: [{ expected: 'x', ok: true }] }; },
  }) });
  assert.equal(s.calls.fixtures, 1);
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);
});

await test('an invalid manifest or missing environment is reported, not thrown', async () => {
  const bad = setup({ ...manifestFor(A), extra: true });
  const r1 = await runHook(bad.env, { ...spy(), loadDrivers: async () => ({}) });
  assert.match(r1.lines[0], /^CHANGED_JOURNEY_SMOKE=error \(the milestone manifest is invalid: manifest: unknown key "extra"\)$/);
  const { env } = setup(manifestFor(A));
  const r2 = await runHook({ ...env, WSF_RESULT_DIR: '' }, { ...spy(), loadDrivers: async () => ({}) });
  assert.match(r2.lines[0], /CHANGED_JOURNEY_SMOKE=error \(WSF_RESULT_DIR is required\)/);
  const notJson = setup('{');
  const r3 = await runHook(notJson.env, { ...spy(), loadDrivers: async () => ({}) });
  assert.match(r3.lines[0], /not JSON/);
});

await test('the CLI always exits 0 and says it gates nothing, with the real registry', () => {
  const cases = [
    [{}, /CHANGED_JOURNEY_SMOKE=skipped/],
    // Journey ids with no driver: nothing to drive, so no network, browser or credential.
    [setup(manifestFor(A, ['kiosk', 'home'])).env, /CHANGED_JOURNEY_SMOKE=INCOMPLETE/],
    [setup('{').env, /CHANGED_JOURNEY_SMOKE=error/],
  ];
  for (const [env, re] of cases) {
    const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('WSF_')));
    const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8', env: { ...clean, ...env } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, re);
    assert.match(r.stdout, /CHANGED_JOURNEY_SMOKE_GATES=nothing \(report-only\)/);
  }
});

console.log(`\nhosted-changed-journeys: ${passed} passed`);
