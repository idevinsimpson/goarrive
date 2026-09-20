#!/usr/bin/env node
/** The mail runtime config: what gets written, and what must never be. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const SCRIPT = '.github/wsf-staging/write-functions-env.mjs';
const WORKFLOW = fs.readFileSync('.github/workflows/wsf-staging-deploy.yml', 'utf8');
const PROJECT = 'westayfit-staging';
const APP_URL = 'https://westayfit-staging--staging-4a616y5m.web.app';
const HANDLER = `https://${PROJECT}.firebaseapp.com/__/auth/action`;

const TARGET = `functions-westayfit/.env.${PROJECT}`;

// The writer is run from a throwaway checkout root with a real
// functions-westayfit/ beside it, because the target it pins is RELATIVE —
// the file only counts where firebase-tools reads it, next to the source.
function run({ from, out = TARGET, project = PROJECT, appUrl = APP_URL, handler = HANDLER } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-env-'));
  fs.mkdirSync(path.join(dir, 'functions-westayfit'), { recursive: true });
  const target = path.isAbsolute(out) ? out : path.join(dir, out);
  const result = spawnSync(process.execPath, [path.resolve(SCRIPT), out, project, appUrl, handler], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, WSF_EMAIL_FROM: from ?? '' },
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    target,
    exists: fs.existsSync(target),
    body: fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null,
    mode: fs.existsSync(target) ? (fs.statSync(target).mode & 0o777) : null,
  };
}

test('a supplied sender writes exactly the three nonsecret values', () => {
  const r = run({ from: 'We Stay Fit <no-reply@example.test>' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.body, /^WSF_EMAIL_FROM=We Stay Fit <no-reply@example\.test>$/m);
  assert.match(r.body, new RegExp(`^WSF_APP_URL=${APP_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(r.body, /^WSF_AUTH_ACTION_HANDLER=https:\/\/westayfit-staging\.firebaseapp\.com\/__\/auth\/action$/m);
  // The key is a Secret Manager binding. It must not be here in any form.
  assert.equal(/WSF_EMAIL_API_KEY/.test(r.body.replace(/^#.*$/gm, '')), false,
    'the generated env must not carry the API key name as a value line');
  assert.equal(r.mode, 0o600, 'the generated env file must not be world-readable');
});

test('a missing sender fails the deploy instead of deploying a silent refusal', () => {
  const r = run({ from: '' });
  assert.equal(r.status, 1);
  assert.equal(r.exists, false, 'nothing may be written when the sender is unknown');
  assert.match(r.stderr, /WSF_EMAIL_FROM is not set/);
  // The message has to say where to put it, or the next person re-derives it.
  assert.match(r.stderr, /GitHub Actions variable/);
});

test('a sender that is actually an API key is refused, and nothing is written', () => {
  const r = run({ from: 're_abcdefgh12345678' });
  assert.equal(r.status, 1);
  assert.equal(r.exists, false);
  assert.match(r.stderr, /looks like an API key/);
  assert.equal(/re_abcdefgh12345678/.test(r.stdout), false, 'a key-shaped value must never be echoed');
});

test('the four reported staging-boundary probes are all refused', () => {
  // Every one of these wrote a config and exited 0 before this fix. The
  // workflow's literals were correct, so nothing was mis-deployed — but a
  // validator that only agrees with a correct caller is not a validator.
  const probes = [
    ['foreign app origin', { appUrl: 'https://example.invalid' }, /must be exactly/],
    ['lookalike handler host', { handler: 'https://westayfit-staging.example.invalid/__/auth/action' }, /must be exactly/],
    ['wrong handler path', { handler: 'https://westayfit-staging.firebaseapp.com/not-an-action-handler' }, /must be exactly/],
    ['production project', { project: 'goarrive', out: 'functions-westayfit/.env.goarrive', appUrl: 'https://goarrive.web.app', handler: 'https://goarrive.firebaseapp.com/__/auth/action' }, /configures westayfit-staging only/],
  ];
  for (const [label, overrides, message] of probes) {
    const r = run({ from: 'a@b.test', ...overrides });
    assert.equal(r.status, 1, `${label} was accepted`);
    assert.equal(r.exists, false, `${label} wrote a config`);
    assert.match(r.stderr, message, label);
  }
});

test('misleading URL forms are refused', () => {
  for (const [label, overrides] of [
    ['credentials in the URL', { appUrl: 'https://user:pass@westayfit-staging--staging-4a616y5m.web.app' }],
    ['a port', { appUrl: 'https://westayfit-staging--staging-4a616y5m.web.app:8443' }],
    ['a query string', { handler: 'https://westayfit-staging.firebaseapp.com/__/auth/action?x=1' }],
    ['a fragment', { handler: 'https://westayfit-staging.firebaseapp.com/__/auth/action#x' }],
    ['a prefixed host', { appUrl: 'https://evil-westayfit-staging--staging-4a616y5m.web.app' }],
    ['a suffixed host', { appUrl: 'https://westayfit-staging--staging-4a616y5m.web.app.example.invalid' }],
  ]) {
    const r = run({ from: 'a@b.test', ...overrides });
    assert.equal(r.status, 1, `${label} was accepted`);
    assert.equal(r.exists, false, `${label} wrote a config`);
  }
});

test('a trailing slash on the handler is not a false alarm', () => {
  // Normalised before comparison: the boundary must reject lookalikes without
  // rejecting the same URL written slightly differently.
  const r = run({ from: 'a@b.test', handler: 'https://westayfit-staging.firebaseapp.com/__/auth/action/' });
  assert.equal(r.status, 0, r.stderr);
});

test('a file named for the wrong project is refused', () => {
  // firebase-tools silently ignores it, which is a green deploy that changed
  // nothing — the most expensive possible failure.
  const r = run({ from: 'a@b.test', out: '.env.production' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /must be exactly functions-westayfit\/\.env\.westayfit-staging/);
});

test('a handler belonging to another project is refused', () => {
  const r = run({ from: 'a@b.test', handler: 'https://goarrive.firebaseapp.com/__/auth/action' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /must be exactly/);
});

test('the file must land exactly where firebase-tools reads it', () => {
  // Three ways to write a correctly named file firebase-tools will ignore —
  // a green step, a green deploy, and mail still refusing to send.
  for (const [label, out] of [
    ['suffix form', 'functions-westayfit/anything.env.westayfit-staging'],
    ['right name, wrong directory', '.env.westayfit-staging'],
    ['a sibling directory', 'functions/.env.westayfit-staging'],
    ['traversal out of the checkout', '../functions-westayfit/.env.westayfit-staging'],
    ['an absolute path', '/tmp/.env.westayfit-staging'],
  ]) {
    const r = run({ from: 'a@b.test', out });
    assert.equal(r.status, 1, `${label} was accepted`);
    assert.equal(r.exists, false, `${label} wrote a file`);
  }
});

test('a non-https app url is refused', () => {
  const r = run({ from: 'a@b.test', appUrl: 'http://westayfit-staging--staging-4a616y5m.web.app' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /must be https/);
});

test('the workflow writes the env BEFORE the functions deploy, and never echoes a key', () => {
  const envAt = WORKFLOW.indexOf('Write the functions runtime config');
  const deployAt = WORKFLOW.indexOf('Deploy WSF functions');
  assert.notEqual(envAt, -1, 'the deploy no longer writes the functions runtime config');
  assert.ok(envAt < deployAt, 'the runtime config must be written before the deploy that packages it');
  assert.ok(/vars\.WSF_EMAIL_FROM/.test(WORKFLOW), 'the sender must come from an environment variable, not a literal');
  // The exact relative target, in the workflow too: a correctly named file in
  // the wrong directory is one firebase-tools never reads.
  assert.ok(
    /"functions-westayfit\/\.env\.\$STAGING_PROJECT"/.test(WORKFLOW),
    'the workflow must write the dotenv beside the functions source'
  );
  // The diagnostic moved into a script so its four states are testable; the
  // workflow must still call it.
  assert.ok(/report-mail-secret\.mjs/.test(WORKFLOW), 'the deploy does not report the secret state');
  assert.equal(/secrets versions access/.test(WORKFLOW), false,
    'the deploy must report the secret STATE, never access its payload');
  assert.equal(/WSF_EMAIL_API_KEY=/.test(WORKFLOW), false,
    'the API key must never be assigned in the workflow; it is a Secret Manager binding');
});

test('the hosted smoke still sends no mail from staging', () => {
  const smoke = fs.readFileSync('.github/wsf-staging/hosted-package-e-smoke.mjs', 'utf8');
  // This is the guard that keeps synthetic signups from mailing fabricated
  // addresses once staging can actually send. It predates this change; the
  // assertion exists so enabling mail cannot quietly remove it.
  assert.ok(
    /page\.route\('\*\*\/wsfSendVerificationEmail'/.test(smoke),
    'the D-1 row must keep intercepting the verification send in the browser'
  );
  assert.ok(
    /sendAttempts >= 1/.test(smoke),
    'the gate must still prove the screen ATTEMPTED the send, so the interception does not weaken the assertion'
  );
  assert.equal(
    /wsfSendPasswordResetEmail/.test(smoke),
    false,
    'no hosted row may trigger a password reset send'
  );
});

// ── The secret diagnostic: four states, never collapsed ────────────────────
const REPORTER = '.github/wsf-staging/report-mail-secret.mjs';

function reportWith(script) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-gcloud-'));
  const fake = path.join(dir, 'gcloud');
  fs.writeFileSync(fake, script, { mode: 0o755 });
  const r = spawnSync(process.execPath, [REPORTER, 'westayfit-staging', 'WSF_EMAIL_API_KEY'], {
    encoding: 'utf8',
    env: { ...process.env, WSF_GCLOUD_BIN: fake },
  });
  const out = r.stdout || '';
  const field = (name) => (out.match(new RegExp(`^${name}=(.*)$`, 'm')) ?? [])[1];
  return { status: r.status, out, state: field('WSF_EMAIL_SECRET_STATE'), versions: field('WSF_EMAIL_SECRET_ENABLED_VERSIONS') };
}

const DESCRIBE_OK = 'echo "projects/x/secrets/WSF_EMAIL_API_KEY"';

test('a permission failure is UNKNOWN, never "not present"', () => {
  // The previous shell printed EXISTS=false here — a confident, false claim
  // that would send an operator to create a second secret beside a good one,
  // or to widen IAM to make a diagnostic go green.
  const r = reportWith('#!/bin/sh\necho "ERROR: PERMISSION_DENIED: caller lacks secretmanager.secrets.get" >&2\nexit 1\n');
  assert.equal(r.state, 'unknown');
  assert.notEqual(r.state, 'absent');
  assert.match(r.out, /NOT a report that it is missing/);
  assert.equal(r.status, 0, 'a diagnostic must not fail an otherwise correct deploy');
});

test('a missing gcloud is UNKNOWN and says so as tooling', () => {
  const r = reportWith('#!/bin/sh\necho "bash: gcloud: command not found" >&2\nexit 127\n');
  assert.equal(r.state, 'unknown');
});

test('a permission error that CONTAINS "does not exist" is UNKNOWN, not absent', () => {
  // gcloud's real permission message is deliberately ambiguous:
  //   PERMISSION_DENIED: caller lacks secretmanager.secrets.get;
  //   resource does not exist or caller lacks access
  // Matching the phrase anywhere reported `absent` and told the operator to
  // create a secret that already exists. Permission always wins.
  const r = reportWith('#!/bin/sh\necho "ERROR: PERMISSION_DENIED: caller lacks secretmanager.secrets.get; resource does not exist or caller lacks access" >&2\nexit 1\n');
  assert.equal(r.state, 'unknown');
  assert.notEqual(r.state, 'absent');
  assert.match(r.out, /NOT a report that it is missing/);
});

test('the hedge phrase alone is enough to refuse "absent"', () => {
  // Isolates the ambiguous-phrasing rule: no PERMISSION_DENIED, no "lacks",
  // no 403 — only Google's deliberate "does not exist OR is not visible",
  // which is designed to reveal nothing either way. Without this probe the
  // rule could be deleted and the suite would stay green on the strength of
  // the other keywords.
  const r = reportWith('#!/bin/sh\necho "ERROR: The resource does not exist or is not visible." >&2\nexit 1\n');
  assert.equal(r.state, 'unknown');
  assert.notEqual(r.state, 'absent');
});

test('when NOT_FOUND and a permission hint arrive together, permission wins', () => {
  // gcloud can answer NOT_FOUND *because* the caller may not see the
  // resource. Isolates the precedence rule: with both signals present, the
  // order of the two checks is the only thing deciding the answer.
  const r = reportWith('#!/bin/sh\necho "ERROR: NOT_FOUND: Secret [WSF_EMAIL_API_KEY] not found; PERMISSION_DENIED on secretmanager.secrets.get" >&2\nexit 1\n');
  assert.equal(r.state, 'unknown');
  assert.notEqual(r.state, 'absent');
});

test('a 403 with no keyword is UNKNOWN', () => {
  const r = reportWith('#!/bin/sh\necho "ERROR: (gcloud.secrets.describe) HttpError 403" >&2\nexit 1\n');
  assert.equal(r.state, 'unknown');
});

test('only gcloud\u2019s own NOT_FOUND is reported as absent', () => {
  const r = reportWith('#!/bin/sh\necho "ERROR: NOT_FOUND: Secret [WSF_EMAIL_API_KEY] not found." >&2\nexit 1\n');
  assert.equal(r.state, 'absent');
});

test('present with enabled versions, and present with none, are different answers', () => {
  const withTwo = reportWith(`#!/bin/sh\ncase "$*" in *"versions list"*) echo v1; echo v2;; *) ${DESCRIBE_OK};; esac\nexit 0\n`);
  assert.equal(withTwo.state, 'present_with_enabled');
  assert.equal(withTwo.versions, '2');

  const withNone = reportWith(`#!/bin/sh\ncase "$*" in *"versions list"*) : ;; *) ${DESCRIBE_OK};; esac\nexit 0\n`);
  assert.equal(withNone.state, 'present_no_enabled');
  assert.equal(withNone.versions, '0');
});

test('an unreadable version list does not become "no enabled versions"', () => {
  // The same false-confidence bug, one level down.
  const r = reportWith(`#!/bin/sh\ncase "$*" in *"versions list"*) echo "ERROR: PERMISSION_DENIED" >&2; exit 1;; *) ${DESCRIBE_OK};; esac\nexit 0\n`);
  assert.equal(r.state, 'unknown');
  assert.notEqual(r.state, 'present_no_enabled');
});

test('an enabled version is never reported as runtime binding or a working key', () => {
  const r = reportWith(`#!/bin/sh\ncase "$*" in *"versions list"*) echo v1;; *) ${DESCRIBE_OK};; esac\nexit 0\n`);
  assert.match(r.out, /WSF_EMAIL_RUNTIME_BINDING=not_established_by_this_check/);
  assert.match(r.out, /WSF_EMAIL_KEY_VALIDITY=not_established_by_this_check/);
});

test('the payload is never read', () => {
  // Comments stripped first: the file EXPLAINS that it never calls
  // `versions access`, and a naive search matched that sentence rather than
  // any code. A check that fires on its own documentation is not a check.
  const code = fs.readFileSync(REPORTER, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/'access'/.test(code), false, 'the reporter must never pass `access` to gcloud');
  assert.equal(/versions[^\n]{0,20}access/.test(code), false, 'the reporter must never access a secret payload');
});
