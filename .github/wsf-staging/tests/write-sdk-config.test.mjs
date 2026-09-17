#!/usr/bin/env node
/**
 * The SDK config file the hosted smoke reads: derived only from the staging
 * env artifact, written outside anything that can become an artifact, never
 * echoed, and in the exact shape hosted-package-e-smoke.mjs accepts.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WRITER = path.resolve('.github/wsf-staging/write-sdk-config.mjs');
const SMOKE = fs.readFileSync(path.resolve('.github/wsf-staging/hosted-package-e-smoke.mjs'), 'utf8');
const PROJECT = 'westayfit-staging';
// Deliberately distinctive so any leak into stdout/stderr is unmistakable.
const KEY = 'AIzaSyTESTKEY-do-not-print-0123456789';
let passed = 0;
const test = (n, f) => { f(); passed += 1; console.log(`  ok  ${n}`); };

function run(outPath, envOverrides = {}) {
  const r = spawnSync(process.execPath, [WRITER, outPath, PROJECT], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      EXPO_PUBLIC_WSF_STAGING_PROJECT_ID: PROJECT,
      EXPO_PUBLIC_WSF_STAGING_API_KEY: KEY,
      ...envOverrides,
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-sdk-'));

test('the file is derived from the env artifact values and nothing else', () => {
  const d = tmp();
  const out = path.join(d, 'runner-temp', 'wsf-sdk-config.json');
  const r = run(out);
  assert.equal(r.code, 0, r.err);
  const doc = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(doc, { projectId: PROJECT, apiKey: KEY });
});

test('the writer creates the dedicated directory itself at 0700 and the file at 0600', () => {
  const d = tmp();
  const out = path.join(d, 'wsf-sdk', 'wsf-sdk-config.json');
  assert.equal(fs.existsSync(path.dirname(out)), false, 'precondition: the child does not exist yet');
  assert.equal(run(out).code, 0);
  assert.equal(fs.statSync(out).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(out)).mode & 0o777, 0o700);
});

test('a pre-existing directory is refused: mkdir mode would not have re-chmodded it', () => {
  // This is the shape the first draft of the workflow had: the file directly
  // under RUNNER_TEMP, which already exists with the runner's own mode.
  const d = tmp();
  fs.chmodSync(d, 0o755);
  const out = path.join(d, 'wsf-sdk-config.json');
  const r = run(out);
  assert.equal(r.code, 1);
  assert.equal(fs.existsSync(out), false);
  assert.equal(fs.statSync(d).mode & 0o777, 0o755, 'the existing directory is left as it was');
  assert.equal(r.err.includes(KEY), false);
});

test('the real workflow shape: a dedicated child of RUNNER_TEMP, beside the checkout and evidence dir', () => {
  // Mirror the runner layout: work/<repo> is GITHUB_WORKSPACE, work/_temp is
  // RUNNER_TEMP, and the evidence directory lives inside the workspace.
  const work = tmp();
  const workspace = path.join(work, 'goarrive');
  const runnerTemp = path.join(work, '_temp');
  fs.mkdirSync(workspace); fs.mkdirSync(runnerTemp, { mode: 0o755 });
  const out = path.join(runnerTemp, 'wsf-sdk', 'wsf-sdk-config.json');
  const r = run(out, { GITHUB_WORKSPACE: workspace, WSF_RESULT_DIR: path.join(workspace, 'wsf-evidence') });
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.statSync(path.dirname(out)).mode & 0o777, 0o700, 'the child was created 0700 by the writer');
  assert.equal(fs.statSync(runnerTemp).mode & 0o777, 0o755, 'RUNNER_TEMP itself is untouched');
  assert.equal(fs.statSync(out).mode & 0o777, 0o600);
  assert.equal(path.relative(workspace, out).startsWith('..'), true, 'outside the checkout');
  assert.equal(r.out.includes(KEY) || r.err.includes(KEY), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(out, 'utf8')), { projectId: PROJECT, apiKey: KEY });
});

test('the key is never echoed on stdout or stderr', () => {
  const d = tmp();
  const r = run(path.join(d, 'wsf-sdk', 'wsf-sdk-config.json'));
  assert.equal(r.code, 0);
  assert.equal(r.out.includes(KEY), false, 'stdout leaked the key');
  assert.equal(r.err.includes(KEY), false, 'stderr leaked the key');
  assert.match(r.out, /^SDK_CONFIG_FILE=written for westayfit-staging$/m);
});

test('it refuses to write inside the repository checkout', () => {
  const d = tmp();
  const r = run(path.join(d, 'checkout', 'wsf-sdk', 'wsf-sdk-config.json'), { GITHUB_WORKSPACE: path.join(d, 'checkout') });
  assert.equal(r.code, 1);
  assert.equal(fs.existsSync(path.join(d, 'checkout', 'wsf-sdk')), false);
  assert.equal(r.err.includes(KEY), false);
});

test('it refuses to write inside the evidence directory', () => {
  const d = tmp();
  const r = run(path.join(d, 'wsf-evidence', 'wsf-sdk', 'sdk.json'), { WSF_RESULT_DIR: path.join(d, 'wsf-evidence') });
  assert.equal(r.code, 1);
  assert.equal(fs.existsSync(path.join(d, 'wsf-evidence', 'wsf-sdk')), false);
});

test('a sibling of the checkout is allowed (the runner temp dir is one)', () => {
  const d = tmp();
  const r = run(path.join(d, '_temp', 'wsf-sdk', 'wsf-sdk-config.json'), { GITHUB_WORKSPACE: path.join(d, 'goarrive') });
  assert.equal(r.code, 0, r.err);
});

test('a config naming another project is refused', () => {
  const d = tmp();
  const out = path.join(d, 'wsf-sdk', 'wsf-sdk-config.json');
  const r = run(out, { EXPO_PUBLIC_WSF_STAGING_PROJECT_ID: 'goarrive' });
  assert.equal(r.code, 1);
  assert.equal(fs.existsSync(out), false);
});

test('missing env values are refused rather than written as empty', () => {
  const d = tmp();
  const out = path.join(d, 'wsf-sdk', 'wsf-sdk-config.json');
  const r = run(out, { EXPO_PUBLIC_WSF_STAGING_API_KEY: '' });
  assert.equal(r.code, 1);
  assert.equal(fs.existsSync(out), false);
});

test('the bare {projectId, apiKey} shape is one the smoke accepts', () => {
  // The smoke unwraps the firebase CLI envelope but falls through to the raw
  // object, then checks exactly the two fields this file carries.
  assert.match(SMOKE, /const sdk = sdkRaw\?\.result\?\.sdkConfig \?\? sdkRaw\?\.sdkConfig \?\? sdkRaw\?\.result \?\? sdkRaw;/);
  assert.match(SMOKE, /sdk\?\.projectId !== PROJECT_ID \|\| typeof sdk\?\.apiKey !== 'string'/);
  assert.match(SMOKE, /process\.env\.WSF_SDK_CONFIG_FILE/);
});

console.log(`\nwrite-sdk-config: ${passed} passed`);
