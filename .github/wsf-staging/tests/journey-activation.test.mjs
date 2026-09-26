#!/usr/bin/env node
/**
 * The journey-activation mode, MODELED end to end (CONTROL-PLANE-ACTIVATION-1).
 *
 * Every step is the real script the workflow runs, in the workflow's order and
 * with GitHub's step semantics (a plain step is skipped after a failure;
 * `always()` steps run): the served-marker CLI against a local /health, the
 * changed-journey runner with the real registry and the example activation
 * manifest, the real cleaner against a fake API, the card CLI, the real
 * evidence scan, and the verdict CLI.
 *
 * Only the browser and the product are modelled (tests/helpers/journey-model.mjs).
 * This is NOT activation: the one hosted run L0 dispatches after acceptance is.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { harness, serve, tmp } from './helpers/journey-model.mjs';
import { runHook } from '../hosted-changed-journeys.mjs';

const W = path.resolve('.github/wsf-staging');
const MANIFEST = path.join(W, 'journeys/examples/community-settings-parity-1.json');
const SERVED = JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).productSha;
const CARD_URL = 'https://westayfit-staging.example.test';
let passed = 0;
const test = async (n, f) => { await f(); passed += 1; console.log(`  ok  ${n}`); };

/**
 * Run one of the workflow's scripts. stdout and stderr are collected SEPARATELY:
 * two pipes give no ordering guarantee between them, so no assertion may depend
 * on how they interleave (W7 Check 61 F1). `out` is for failure messages only.
 */
function node(script, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(W, script), ...(env.ARGS || [])], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr, out: `--- stdout\n${stdout}--- stderr\n${stderr}` }));
  });
}

/** A failed verdict: exit 1, the verdict line on stdout, and the named reason on stderr, each asserted on its own stream. */
function failedWith(r, reason) {
  assert.equal(r.code, 1, r.out);
  assert.match(r.stdout, /^ACTIVATION=FAILED$/m, r.out);
  assert.doesNotMatch(r.stdout, /^ACTIVATION=PASSED$/m, r.out);
  assert.match(r.stderr, reason, r.out);
}

/**
 * One modeled activation run. `health` is what /health serves; `bugs` seeds
 * product defects; `drivers` overrides the registry; `failDeletes` makes the
 * cleanup API refuse deletions.
 */
async function activation({ health = `Commit ${SERVED.slice(0, 7)}`, jobHealth = health, bugs = {}, drivers, failDeletes = false } = {}) {
  const root = tmp();
  const evidence = path.join(root, 'wsf-activation-evidence');
  const changed = path.join(evidence, 'changed-journeys');
  // The gate reads /health first; every later read (the job's drift check, the runner) sees `jobHealth`.
  let healthReads = 0;
  const site = http.createServer((req, res) => {
    if (req.url !== '/health') { res.writeHead(404); res.end(''); return; }
    healthReads += 1;
    res.writeHead(200);
    res.end(healthReads === 1 ? health : jobHealth);
  });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const siteUrl = `http://127.0.0.1:${site.address().port}`;
  const outcome = {};
  let h = null;
  let fixturesMade = 0;

  // 0. gate (credential-free): read the served marker. A failure fails the gate, so
  //    `config` (the first job that can obtain a token) and this job never start.
  const gateMarker = await node('check-served-marker.mjs', { WSF_APPROVED_SHA: SERVED, WSF_STAGING_URL: siteUrl, WSF_RESULT_DIR: path.join(root, 'gate-marker') });
  outcome.gate = gateMarker.code === 0 ? 'success' : 'failure';
  if (outcome.gate !== 'success') {
    site.close();
    return { outcome, verdict: null, card: null, fixturesMade, be: null, evidence, changed, jobsStarted: [] };
  }

  // 1. Read the served marker again in the job (plain step: it can stop the job).
  const marker = await node('check-served-marker.mjs', { WSF_APPROVED_SHA: SERVED, WSF_STAGING_URL: siteUrl, WSF_RESULT_DIR: evidence });
  outcome.marker = marker.code === 0 ? 'success' : 'failure';

  // 2. Authenticate + run the activation (plain steps: skipped after a failed marker).
  if (outcome.marker === 'success') {
    const hs = {};
    const browser = {
      newContext: async () => ({ newPage: async () => new Proxy({}, { get: (_, k) => (k === 'then' ? undefined : (...a) => hs.current.page[k](...a)) }), close: async () => {} }),
      close: async () => {},
    };
    await runHook({
      WSF_JOURNEY_MANIFEST: MANIFEST, WSF_STAGING_URL: siteUrl, WSF_APPROVED_SHA: SERVED, WSF_RESULT_DIR: evidence,
    }, {
      launch: async () => browser,
      ...(drivers ? { loadDrivers: async () => drivers } : {}),
      fixtures: () => {
        fixturesMade += 1;
        h = harness(bugs, { dir: changed });
        hs.current = { get page() { return h.app().page; } };
        return h.fixtures;
      },
    });
    outcome.journeys = 'success';
  } else {
    outcome.journeys = 'skipped';
  }

  // 3. Remove changed-journey fixtures (always(); blocking).
  const cleanupManifest = path.join(changed, 'cleanup-manifest.json');
  if (fs.existsSync(cleanupManifest)) {
    const { server, base } = await serve(h.be, { failDeletes });
    const c = await node('cleanup-synthetic.mjs', {
      WSF_GOOGLE_ACCESS_TOKEN: 'test-token', WSF_CLEANUP_MANIFEST: cleanupManifest,
      WSF_CLEANUP_RECEIPT: path.join(changed, 'cleanup-receipt.json'), WSF_API_BASE: base,
    });
    server.close();
    outcome.cleanup = c.code === 0 ? 'success' : 'failure';
  } else {
    outcome.cleanup = 'success'; // "not needed": nothing was created
  }

  // 4. Render the activation owner card (always(), report-only).
  let card = null;
  if (fs.existsSync(path.join(changed, 'changed-journeys.json'))) {
    await node('owner-test-card.mjs', { ARGS: ['--manifest', MANIFEST, '--results', path.join(changed, 'changed-journeys.json'),
      '--cleanup-manifest', cleanupManifest, '--cleanup-receipt', path.join(changed, 'cleanup-receipt.json'),
      '--staging-url', CARD_URL, '--out', path.join(changed, 'owner-test-card.md')] });
    card = fs.readFileSync(path.join(changed, 'owner-test-card.md'), 'utf8');
  }

  // 5. Scan evidence before upload (always()).
  const scan = await node('scan-evidence.mjs', { ARGS: [evidence] });
  outcome.scan = scan.code === 0 ? 'success' : 'failure';

  // 6. Require the activation to have passed (always()).
  const verdict = await node('require-activation.mjs', {
    WSF_ACTIVATION_MANIFEST: MANIFEST, WSF_ACTIVATION_JOURNEYS: 'community,settings', WSF_CHANGED_DIR: changed,
    WSF_STAGING_URL: CARD_URL, WSF_MARKER_OUTCOME: outcome.marker, WSF_CLEANUP_OUTCOME: outcome.cleanup, WSF_SCAN_OUTCOME: outcome.scan,
  });
  site.close();
  return { outcome, verdict, card, fixturesMade, be: h?.be ?? null, evidence, changed, marker, jobsStarted: ['config', 'journey-activation'] };
}

await test('SUCCESS PATH (modeled): marker match, both journeys PASSED, cleanup COMPLETE, scan passes → ACTIVATION=PASSED', async () => {
  const a = await activation();
  assert.equal(a.verdict.code, 0, a.verdict.out);
  assert.match(a.verdict.stdout, /ACTIVATION_CARD=PASSED\nACTIVATION_CLEANUP=COMPLETE\nACTIVATION=PASSED/);
  assert.equal(a.verdict.stderr, '', 'a passing verdict names no reason');
  assert.equal(a.fixturesMade, 1);
  assert.equal(a.be.accounts.size + a.be.docs.size, 0, 'every fixture removed');
  assert.match(a.card, /Hosted changed-journey status: PASSED \(2 passed/);
  const results = JSON.parse(fs.readFileSync(path.join(a.changed, 'changed-journeys.json'), 'utf8'));
  assert.equal(results.servedSha, SERVED);
  for (const r of results.results) {
    assert.equal(r.servedMarker, SERVED);
    assert.ok(r.actionsPerformed.length >= 4 && r.assertions.length >= 10, `${r.journeyId}: real actions and assertions`);
    assert.ok(fs.existsSync(path.join(a.evidence, r.artifact)), `${r.journeyId}: screenshot in the evidence`);
  }
});

await test('A1 WRONG MARKER: fails the GATE; no credentialed job starts, nothing is seeded', async () => {
  const a = await activation({ health: 'Commit 74d1928' });
  assert.equal(a.outcome.gate, 'failure');
  assert.deepEqual(a.jobsStarted, [], 'config (the first job that can obtain a token) and the activation job never start');
  assert.equal(a.fixturesMade, 0);
  assert.equal(fs.existsSync(a.evidence), false, 'the activation job never ran, so it wrote nothing');
});

await test('A1 UNREACHABLE MARKER: also fails the gate', async () => {
  const a = await activation({ health: 'down' });
  assert.equal(a.outcome.gate, 'failure');
  assert.deepEqual(a.jobsStarted, []);
});

await test('DRIFT: the gate saw the served build but the job re-read does not → stops before any fixture, ACTIVATION=FAILED', async () => {
  const a = await activation({ jobHealth: 'Commit 74d1928' });
  assert.equal(a.outcome.gate, 'success');
  assert.equal(a.outcome.marker, 'failure');
  assert.equal(a.outcome.journeys, 'skipped', 'the job\'s authenticate and run steps are skipped');
  assert.equal(a.fixturesMade, 0);
  assert.equal(fs.existsSync(path.join(a.changed, 'cleanup-manifest.json')), false);
  assert.equal(a.verdict.code, 1);
  failedWith(a.verdict, /served-marker check did not pass/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.evidence, 'served-marker.json'), 'utf8')).status, 'mismatch', 'the refusal is itself evidence');
});

await test('JOURNEY FAILURE: a product defect fails a driver → ACTIVATION=FAILED, card never PASSED, fixtures still cleaned', async () => {
  const a = await activation({ bugs: { chipIgnored: true } });
  assert.equal(a.verdict.code, 1);
  failedWith(a.verdict, /journey community is failed/);
  assert.doesNotMatch(a.card, /status: PASSED/);
  assert.equal(a.outcome.cleanup, 'success');
  assert.equal(a.be.accounts.size + a.be.docs.size, 0);
});

await test('BLOCKED / NO DRIVER: a journey without a registered driver → ACTIVATION=FAILED', async () => {
  const a = await activation({ drivers: {} });
  assert.equal(a.verdict.code, 1);
  failedWith(a.verdict, /journey community is blocked \(no registered driver\)/);
  assert.match(a.verdict.stderr, /journey settings is blocked/);
  assert.equal(a.fixturesMade, 0);
});

await test('CLEANUP FAILURE: journeys PASSED but cleanup INCOMPLETE → ACTIVATION=FAILED, recovery manifest preserved in the evidence', async () => {
  const a = await activation({ failDeletes: true });
  assert.equal(a.outcome.cleanup, 'failure', 'the blocking cleanup step fails');
  assert.equal(a.verdict.code, 1);
  failedWith(a.verdict, /cleanup is INCOMPLETE, not COMPLETE/);
  assert.match(a.verdict.stderr, /blocking cleanup step did not succeed/);
  assert.doesNotMatch(a.card, /status: PASSED/);
  assert.ok(fs.existsSync(path.join(a.changed, 'cleanup-manifest.json')), 'the manifest stays for recovery');
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.changed, 'cleanup-receipt.json'), 'utf8')).status, 'INCOMPLETE');
  assert.equal(a.outcome.scan, 'success', 'the recovery evidence passes the scan, so it is uploaded');
});

await test('the verdict refuses outcomes the evidence cannot support: missing receipt, failed scan, wrong journey set', async () => {
  const a = await activation();
  const env = { WSF_ACTIVATION_MANIFEST: MANIFEST, WSF_CHANGED_DIR: a.changed, WSF_STAGING_URL: CARD_URL,
    WSF_MARKER_OUTCOME: 'success', WSF_CLEANUP_OUTCOME: 'success', WSF_SCAN_OUTCOME: 'success', WSF_ACTIVATION_JOURNEYS: 'community,settings' };
  assert.equal((await node('require-activation.mjs', env)).code, 0, 'the untouched evidence passes');
  failedWith(await node('require-activation.mjs', { ...env, WSF_SCAN_OUTCOME: 'failure' }), /evidence scan did not pass/);
  failedWith(await node('require-activation.mjs', { ...env, WSF_ACTIVATION_JOURNEYS: 'community' }), /not exactly community/);
  failedWith(await node('require-activation.mjs', { ...env, WSF_CLEANUP_OUTCOME: '' }), /cleanup step did not succeed \(not run\)/);
  // A result recorded on another build is NOT VERIFIED: only the card verdict sees it.
  const resultsPath = path.join(a.changed, 'changed-journeys.json');
  const good = fs.readFileSync(resultsPath, 'utf8');
  const other = JSON.parse(good);
  other.results[1].servedMarker = '74d1928145bbc76267498ee63b9423b6f6cdfae8';
  fs.writeFileSync(resultsPath, JSON.stringify(other));
  const unverified = await node('require-activation.mjs', env);
  assert.equal(unverified.code, 1);
  failedWith(unverified, /the owner-card verdict is INCOMPLETE/);
  fs.writeFileSync(resultsPath, good);
  fs.rmSync(path.join(a.changed, 'cleanup-receipt.json'));
  const noReceipt = await node('require-activation.mjs', env);
  assert.equal(noReceipt.code, 1);
  failedWith(noReceipt, /cleanup is NOT_RUN, not COMPLETE/);
  fs.writeFileSync(path.join(a.changed, 'cleanup-receipt.json'), '{');
  failedWith(await node('require-activation.mjs', env), /cleanup is UNKNOWN, not COMPLETE/);
});

await test('the activation manifest is exactly COMMUNITY-SETTINGS-PARITY-1 on the served 938e00d8, journeys community + settings', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.equal(m.productSha, '938e00d8c985993f69becc8924d3037f18425afc');
  assert.deepEqual(m.journeys.map((j) => j.id), ['community', 'settings']);
});

console.log(`\njourney-activation: ${passed} passed`);
