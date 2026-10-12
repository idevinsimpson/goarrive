#!/usr/bin/env node
/**
 * KIOSK-LIVE-POSE-2 — the staging side of the Realtime Database rules.
 *
 *   - The staging config names the candidate's database.westayfit.rules.json.
 *   - GoArrive's firebase.json declares no database, so a GoArrive deploy can
 *     never carry WSF's rules or collide with them. Production ships dark:
 *     its WSF config declares none either (L0, #497 6105996490, Q1 = b).
 *   - The deploy job publishes the rules in one step, after the build job's
 *     GoArrive regression and before the functions deploy, and fails with one
 *     plain line when the project has no default instance.
 *
 * The instance check is inline in the workflow, so this suite runs the very
 * text the workflow runs, against fixtures. No network, no credential.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const WORKFLOW = fs.readFileSync('.github/workflows/wsf-staging-deploy.yml', 'utf8');
const json = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const MISSING_LINE = '::error::Create the Realtime Database default instance in westayfit-staging (us-central1, locked mode)';

/** One top-level job's text, the same split workflow-contract.test.mjs uses. */
function job(name) {
  const lines = WORKFLOW.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `no ${name} job`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^  [a-z][a-z0-9-]*:\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** A step's text, from its `- name:` line to the next step. */
function step(jobText, name) {
  const at = jobText.indexOf(`      - name: ${name}\n`);
  assert.notEqual(at, -1, `no step "${name}"`);
  const next = jobText.indexOf('\n      - ', at + 1);
  return jobText.slice(at, next === -1 ? undefined : next);
}

const deploy = job('deploy');
const databaseStep = step(deploy, 'Deploy the Realtime Database rules');

/** The inline checker, exactly as the step runs it. */
function instanceCheck() {
  const m = /node -e '\n([\s\S]*?)\n\s*' \/tmp\/projects\.json "\$STAGING_PROJECT"/.exec(databaseStep);
  assert.ok(m, 'the instance check is not where the step runs it');
  return m[1];
}

function runCheck(listing) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-rtdb-'));
  const file = path.join(dir, 'projects.json');
  fs.writeFileSync(file, typeof listing === 'string' ? listing : JSON.stringify(listing));
  const r = spawnSync(process.execPath, ['-e', instanceCheck(), file, 'westayfit-staging'], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

const project = (resources) => ({ projectId: 'westayfit-staging', projectNumber: '1', displayName: 'x', resources });

test('the staging config names exactly the candidate rules file', () => {
  const c = json('firebase.westayfit.staging.json');
  assert.deepEqual(c.database, { rules: 'database.westayfit.rules.json' });
});

test("GoArrive's firebase.json declares no database", () => {
  assert.equal(Object.hasOwn(json('firebase.json'), 'database'), false);
});

test('production ships dark: the WSF production config declares no database', () => {
  assert.equal(Object.hasOwn(json('firebase.westayfit.production.json'), 'database'), false);
});

test('the deploy job needs the build job, whose GoArrive regression therefore runs first', () => {
  assert.match(deploy, /needs: \[gate, config, build\]/);
  assert.match(job('build'), /- name: Run the shared GoArrive regression/);
});

test('the rules step comes after the preflight and before the functions deploy', () => {
  const preflight = deploy.indexOf('      - name: Read-only preflight before any change');
  const rules = deploy.indexOf('      - name: Deploy the Realtime Database rules');
  const functions = deploy.indexOf('      - name: Deploy WSF functions');
  assert.ok(preflight !== -1 && rules !== -1 && functions !== -1);
  assert.ok(preflight < rules, 'the staging config is copied in by the preflight');
  assert.ok(rules < functions, 'the rules must land before the functions that use them');
});

test('the step deploys only the database, to staging, with the staging config, and stops the job on failure', () => {
  assert.match(databaseStep, /--only database \\\n/);
  assert.match(databaseStep, /--project "\$STAGING_PROJECT"/);
  assert.match(databaseStep, /--config firebase\.westayfit\.staging\.json/);
  assert.match(databaseStep, /--non-interactive/);
  assert.match(databaseStep, /working-directory: app/);
  assert.equal(/continue-on-error/.test(databaseStep), false);
  assert.equal(/--force/.test(databaseStep), false);
  // It creates nothing: no instance, no IAM, no gcloud.
  assert.equal(/database:instances:create|gcloud|add-iam-policy-binding/.test(databaseStep), false);
});

test('no other step or job deploys the database', () => {
  const all = [...WORKFLOW.matchAll(/--only database/g)];
  assert.equal(all.length, 1);
});

const PRE_LIVE_POSE = ['ec162d17a0540e936741027f9b8f90dd372cfaf4', 'ab77fbfce97e60c1c22492397b2ab6b491f9e0db'];
const ABSENT_LINE = '::error::The candidate has no database.westayfit.rules.json, which firebase.westayfit.staging.json deploys. Pin a candidate that carries KIOSK-LIVE-POSE-2.';

/** The step's own `run:` script, dedented, exactly as the runner executes it. */
function stepScript() {
  const lines = databaseStep.split('\n');
  const at = lines.findIndex((l) => l === '        run: |');
  assert.notEqual(at, -1, 'the step has no run block');
  return lines.slice(at + 1).filter((l) => l.trim() !== '').map((l) => l.replace(/^ {10}/, '')).join('\n') + '\n';
}

/**
 * Runs the step in a fixture tree: app/ is the working directory and
 * node_modules/.bin/firebase is a fake that records every call and answers
 * projects:list with the given listing. No network, no credential.
 */
function runStep({ approved, rulesFile, listing }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-rtdb-step-'));
  const app = path.join(root, 'app');
  const bin = path.join(root, 'node_modules', '.bin');
  fs.mkdirSync(app, { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  if (rulesFile) fs.writeFileSync(path.join(app, 'database.westayfit.rules.json'), '{"rules":{}}');
  const calls = path.join(root, 'calls.log');
  const listingFile = path.join(root, 'listing.json');
  fs.writeFileSync(listingFile, JSON.stringify(listing ?? { result: [] }));
  const fake = path.join(bin, 'firebase');
  fs.writeFileSync(fake, `#!/bin/sh\necho "$*" >> "${calls}"\nif [ "$1" = "projects:list" ]; then cat "${listingFile}"; fi\n`);
  fs.chmodSync(fake, 0o755);
  const r = spawnSync('bash', ['-c', stepScript()], {
    cwd: app,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, APPROVED: approved, STAGING_PROJECT: 'westayfit-staging' },
  });
  const invoked = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').split('\n').filter(Boolean) : [];
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', invoked };
}

test('the approved candidate reaches the step through env, never interpolated into the script', () => {
  assert.match(databaseStep, /\n        env:\n          APPROVED: \$\{\{ needs\.gate\.outputs\.app_sha \}\}\n/);
  assert.equal(/\$\{\{/.test(stepScript()), false);
});

for (const sha of PRE_LIVE_POSE) {
  test(`reviewed pre-live-pose candidate ${sha} without the rules file: notice, success, no firebase call`, () => {
    const r = runStep({ approved: sha, rulesFile: false });
    assert.equal(r.status, 0, r.stderr);
    const notices = r.stdout.split('\n').filter((l) => l.startsWith('::notice::'));
    assert.equal(notices.length, 1);
    assert.ok(notices[0].includes(sha));
    assert.match(notices[0], /database rules deploy is skipped/);
    assert.equal(/::error::/.test(r.stdout), false);
    assert.deepEqual(r.invoked, []);
  });
}

test('any other candidate without the rules file is refused with the existing line, before any firebase call', () => {
  for (const approved of ['0123456789abcdef0123456789abcdef01234567', 'ec162d17', 'ec162d17a0540e936741027f9b8f90dd372cfaf4x', '']) {
    const r = runStep({ approved, rulesFile: false });
    assert.equal(r.status, 1);
    assert.equal(r.stdout, `${ABSENT_LINE}\n`);
    assert.deepEqual(r.invoked, []);
  }
});

test('rules file present but no default instance: still refused with the existing line, nothing deployed', () => {
  for (const approved of [PRE_LIVE_POSE[0], '0123456789abcdef0123456789abcdef01234567']) {
    const r = runStep({ approved, rulesFile: true, listing: { status: 'success', result: [project({ hostingSite: 'westayfit-staging' })] } });
    assert.equal(r.status, 1);
    assert.ok(r.stdout.includes(MISSING_LINE));
    assert.equal(r.invoked.some((c) => c.startsWith('deploy')), false);
  }
});

test('rules file present with the default instance: deploys only the database, and the step stays before the functions deploy', () => {
  const r = runStep({
    approved: '0123456789abcdef0123456789abcdef01234567',
    rulesFile: true,
    listing: { status: 'success', result: [project({ realtimeDatabaseInstance: 'westayfit-staging-default-rtdb' })] },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.invoked, [
    'projects:list --json',
    'deploy --project westayfit-staging --config firebase.westayfit.staging.json --only database --non-interactive',
  ]);
  assert.ok(deploy.indexOf('      - name: Deploy the Realtime Database rules') < deploy.indexOf('      - name: Deploy WSF functions'));
});

test('a project with no default instance fails with exactly the one plain line', () => {
  for (const listing of [
    { status: 'success', result: [project({ hostingSite: 'westayfit-staging' })] },
    { status: 'success', result: [project({ realtimeDatabaseInstance: '' })] },
    { status: 'success', result: [project(undefined)] },
  ]) {
    const r = runCheck(listing);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, `${MISSING_LINE}\n`);
  }
});

test('a project missing from the listing, or another project with an instance, also fails', () => {
  const other = { projectId: 'goarrive', resources: { realtimeDatabaseInstance: 'goarrive-default-rtdb' } };
  for (const listing of [{ result: [] }, { result: [other] }, { result: null }, {}]) {
    const r = runCheck(listing);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, `${MISSING_LINE}\n`);
  }
});

test('an unreadable listing fails the step rather than passing it', () => {
  const r = runCheck('not json');
  assert.notEqual(r.status, 0);
});

test('a project with its default instance passes the check', () => {
  const r = runCheck({ status: 'success', result: [project({ realtimeDatabaseInstance: 'westayfit-staging-default-rtdb' })] });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});
