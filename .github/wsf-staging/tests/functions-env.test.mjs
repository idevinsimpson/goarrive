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

function run({ from, out = `.env.${PROJECT}`, project = PROJECT, appUrl = APP_URL, handler = HANDLER } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-env-'));
  const target = path.join(dir, out);
  const result = spawnSync(process.execPath, [SCRIPT, target, project, appUrl, handler], {
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

test('a file named for the wrong project is refused', () => {
  // firebase-tools silently ignores it, which is a green deploy that changed
  // nothing — the most expensive possible failure.
  const r = run({ from: 'a@b.test', out: '.env.production' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /must be named \.env\.westayfit-staging/);
});

test('a handler belonging to another project is refused', () => {
  const r = run({ from: 'a@b.test', handler: 'https://goarrive.firebaseapp.com/__/auth/action' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /does not belong to westayfit-staging/);
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
  // Presence only: the secret's material must never be read or printed.
  assert.ok(/secrets versions list WSF_EMAIL_API_KEY/.test(WORKFLOW), 'the deploy does not report the secret binding state');
  assert.equal(/secrets versions access/.test(WORKFLOW), false,
    'the deploy must report the secret PRESENCE, never access its payload');
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
