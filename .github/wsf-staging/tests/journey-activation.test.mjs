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

function node(script, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(W, script), ...(env.ARGS || [])], { env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('close', (code) => resolve({ code, out }));
  });
}

/**
 * One modeled activation run. `health` is what /health serves; `bugs` seeds
 * product defects; `drivers` overrides the registry; `failDeletes` makes the
 * cleanup API refuse deletions.
 */
async function activation({ health = `Commit ${SERVED.slice(0, 7)}`, bugs = {}, drivers, failDeletes = false } = {}) {
  const root = tmp();
  const evidence = path.join(root, 'wsf-activation-evidence');
  const changed = path.join(evidence, 'changed-journeys');
  const site = http.createServer((req, res) => { res.writeHead(req.url === '/health' ? 200 : 404); res.end(req.url === '/health' ? health : ''); });
  await new Promise((r) => site.listen(0, '127.0.0.1', r));
  const siteUrl = `http://127.0.0.1:${site.address().port}`;
  const outcome = {};
  let h = null;
  let fixturesMade = 0;

  // 1. Read the served marker (plain step: it can stop the job).
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
  return { outcome, verdict, card, fixturesMade, be: h?.be ?? null, evidence, changed, marker };
}

await test('SUCCESS PATH (modeled): marker match, both journeys PASSED, cleanup COMPLETE, scan passes → ACTIVATION=PASSED', async () => {
  const a = await activation();
  assert.equal(a.verdict.code, 0, a.verdict.out);
  assert.match(a.verdict.out, /ACTIVATION_CARD=PASSED\nACTIVATION_CLEANUP=COMPLETE\nACTIVATION=PASSED/);
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

await test('WRONG MARKER: stops before any credential or fixture, nothing seeded, ACTIVATION=FAILED', async () => {
  const a = await activation({ health: 'Commit 74d1928' });
  assert.equal(a.outcome.marker, 'failure');
  assert.equal(a.outcome.journeys, 'skipped', 'the authenticate and run steps are skipped');
  assert.equal(a.fixturesMade, 0, 'no fixture kit, so no fixture and no token use');
  assert.equal(fs.existsSync(path.join(a.changed, 'cleanup-manifest.json')), false);
  assert.equal(a.verdict.code, 1);
  assert.match(a.verdict.out, /served-marker check did not pass/);
  assert.match(a.verdict.out, /ACTIVATION=FAILED/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.evidence, 'served-marker.json'), 'utf8')).status, 'mismatch', 'the refusal is itself evidence');
});

await test('JOURNEY FAILURE: a product defect fails a driver → ACTIVATION=FAILED, card never PASSED, fixtures still cleaned', async () => {
  const a = await activation({ bugs: { chipIgnored: true } });
  assert.equal(a.verdict.code, 1);
  assert.match(a.verdict.out, /journey community is failed/);
  assert.doesNotMatch(a.card, /status: PASSED/);
  assert.equal(a.outcome.cleanup, 'success');
  assert.equal(a.be.accounts.size + a.be.docs.size, 0);
});

await test('BLOCKED / NO DRIVER: a journey without a registered driver → ACTIVATION=FAILED', async () => {
  const a = await activation({ drivers: {} });
  assert.equal(a.verdict.code, 1);
  assert.match(a.verdict.out, /journey community is blocked \(no registered driver\)/);
  assert.match(a.verdict.out, /journey settings is blocked/);
  assert.equal(a.fixturesMade, 0);
});

await test('CLEANUP FAILURE: journeys PASSED but cleanup INCOMPLETE → ACTIVATION=FAILED, recovery manifest preserved in the evidence', async () => {
  const a = await activation({ failDeletes: true });
  assert.equal(a.outcome.cleanup, 'failure', 'the blocking cleanup step fails');
  assert.equal(a.verdict.code, 1);
  assert.match(a.verdict.out, /cleanup is INCOMPLETE, not COMPLETE/);
  assert.match(a.verdict.out, /blocking cleanup step did not succeed/);
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
  assert.match((await node('require-activation.mjs', { ...env, WSF_SCAN_OUTCOME: 'failure' })).out, /evidence scan did not pass[\s\S]*ACTIVATION=FAILED/);
  assert.match((await node('require-activation.mjs', { ...env, WSF_ACTIVATION_JOURNEYS: 'community' })).out, /not exactly community[\s\S]*ACTIVATION=FAILED/);
  assert.match((await node('require-activation.mjs', { ...env, WSF_CLEANUP_OUTCOME: '' })).out, /cleanup step did not succeed \(not run\)[\s\S]*ACTIVATION=FAILED/);
  // A result recorded on another build is NOT VERIFIED: only the card verdict sees it.
  const resultsPath = path.join(a.changed, 'changed-journeys.json');
  const good = fs.readFileSync(resultsPath, 'utf8');
  const other = JSON.parse(good);
  other.results[1].servedMarker = '74d1928145bbc76267498ee63b9423b6f6cdfae8';
  fs.writeFileSync(resultsPath, JSON.stringify(other));
  const unverified = await node('require-activation.mjs', env);
  assert.equal(unverified.code, 1);
  assert.match(unverified.out, /the owner-card verdict is INCOMPLETE[\s\S]*ACTIVATION=FAILED/);
  fs.writeFileSync(resultsPath, good);
  fs.rmSync(path.join(a.changed, 'cleanup-receipt.json'));
  const noReceipt = await node('require-activation.mjs', env);
  assert.equal(noReceipt.code, 1);
  assert.match(noReceipt.out, /cleanup is NOT_RUN, not COMPLETE/);
  fs.writeFileSync(path.join(a.changed, 'cleanup-receipt.json'), '{');
  assert.match((await node('require-activation.mjs', env)).out, /cleanup is UNKNOWN, not COMPLETE[\s\S]*ACTIVATION=FAILED/);
});

await test('the activation manifest is exactly COMMUNITY-SETTINGS-PARITY-1 on the served 938e00d8, journeys community + settings', () => {
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.equal(m.productSha, '938e00d8c985993f69becc8924d3037f18425afc');
  assert.deepEqual(m.journeys.map((j) => j.id), ['community', 'settings']);
});

console.log(`\njourney-activation: ${passed} passed`);
