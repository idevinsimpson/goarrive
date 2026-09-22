#!/usr/bin/env node
/**
 * THE BINDING REPORTER, PINNED AGAINST A FAKE gcloud.
 *
 * The states this script distinguishes are exactly the ones a careless version
 * collapses, and each collapse sends an operator somewhere wrong:
 *
 *   · reporting a PERMISSION failure as `unbound` says the deploy did not wire
 *     the secret, when the truth is that the reader may not look;
 *   · reporting an alias as a number invents the central fact — "version 2" —
 *     that this whole exercise exists to establish;
 *   · resolving the served version from the secret's own version list rather
 *     than from the serving revision answers a different question: what
 *     `latest` means NOW, not what this revision pinned when it was created.
 *
 * No network, no real gcloud, no credentials: a stub on PATH answers each
 * `describe` from a fixture.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const SCRIPT = path.join('.github', 'wsf-staging', 'report-mail-binding.mjs');
const STUB = path.join('.github', 'wsf-staging', 'tests', 'fixtures', 'fake-gcloud.mjs');

function report(scenario, fns = ['wsfSendVerificationEmail']) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'wsf-binding-'));
  const callsFile = path.join(dir, 'calls.txt');
  const r = spawnSync(
    process.execPath,
    [SCRIPT, 'westayfit-staging', 'us-central1', 'WSF_EMAIL_API_KEY', ...fns],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        WSF_GCLOUD_BIN: STUB,
        WSF_FAKE_GCLOUD_SCENARIO: scenario,
        WSF_FAKE_GCLOUD_CALLS: callsFile,
      },
    }
  );
  let calls = [];
  try {
    calls = readFileSync(callsFile, 'utf8').split('\n').filter(Boolean);
  } catch {
    calls = [];
  }
  rmSync(dir, { recursive: true, force: true });
  const read = (k) => {
    const m = new RegExp(`^${k}=(.*)$`, 'm').exec(r.stdout);
    return m ? m[1].trim() : null;
  };
  return { status: r.status, stdout: r.stdout, read, calls };
}

const KEY = 'WSF_MAIL_BINDING_WSFSENDVERIFICATIONEMAIL';

test('a numeric reference is reported as pinned, with the revision that serves it', () => {
  const r = report('pinned');
  assert.equal(r.read(KEY), 'bound_pinned');
  assert.equal(r.read(`${KEY}_DECLARED`), '2');
  assert.equal(r.read(`${KEY}_SERVED`), '2');
  assert.equal(r.read(`${KEY}_REVISION`), 'wsfsendverificationemail-00007-abc');
});

test('AN ALIAS IS REPORTED AS AN ALIAS, and the number comes from the revision', () => {
  /*
    THE ASSERTION THIS FILE EXISTS FOR. `latest` is resolved when a revision is
    created, so the number a running instance holds belongs to the revision,
    not to the function's reference. Printing "version 2" off a `latest`
    reference would be inventing the exact fact under investigation.
  */
  const r = report('alias');
  assert.equal(r.read(KEY), 'bound_alias');
  assert.equal(r.read(`${KEY}_DECLARED`), 'latest');
  assert.match(r.stdout, /an alias, not a number/);
  // The served number is resolved from the revision, and it is allowed to
  // differ from whatever `latest` would mean today.
  assert.equal(r.read(`${KEY}_SERVED`), '2');
});

test('an alias whose revision cannot be read stays UNRESOLVED, never guessed', () => {
  const r = report('alias-revision-unreadable');
  assert.equal(r.read(KEY), 'bound_alias');
  assert.equal(r.read(`${KEY}_DECLARED`), 'latest');
  assert.equal(r.read(`${KEY}_SERVED`), 'unresolved');
});

test('PERMISSION DENIED IS UNKNOWN, NEVER ABSENT AND NEVER UNBOUND', () => {
  /*
    Google's refusal reads "does not exist or caller lacks access" on purpose,
    so a substring match on "does not exist" turns a permission problem into a
    confident claim that the function is not there. Permission always wins.
  */
  const r = report('denied');
  assert.equal(r.read(KEY), 'unknown');
  assert.doesNotMatch(r.stdout, /unbound/);
});

test('a real NOT_FOUND is absent', () => {
  const r = report('missing');
  assert.equal(r.read(KEY), 'absent');
});

test('a function that references no such secret is unbound, not unknown', () => {
  const r = report('nosecret');
  assert.equal(r.read(KEY), 'unbound');
});

test('both mail functions are reported independently', () => {
  const r = report('pinned', ['wsfSendVerificationEmail', 'wsfSendPasswordResetEmail']);
  assert.equal(r.read('WSF_MAIL_BINDING_WSFSENDVERIFICATIONEMAIL'), 'bound_pinned');
  assert.equal(r.read('WSF_MAIL_BINDING_WSFSENDPASSWORDRESETEMAIL'), 'bound_pinned');
});

test('NO SECRET PAYLOAD IS EVER REQUESTED', () => {
  /*
    The one thing this script must never do. The stub records every argv it
    was called with; `versions access` must appear in none of them.
  */
  const r = report('pinned');
  assert.ok(r.calls.length > 0, 'the stub recorded no calls');
  for (const call of r.calls) {
    assert.doesNotMatch(call, /versions/, `a version command was issued: ${call}`);
    assert.doesNotMatch(call, /access/, `an access command was issued: ${call}`);
  }
});

test('every read is a whitelisted projection, never a bare describe', () => {
  // A full describe would print the function's entire environment, which is
  // how an unrelated variable ends up in a public run log.
  const r = report('pinned');
  assert.ok(r.calls.length > 0, 'the stub recorded no calls');
  for (const call of r.calls) {
    if (!call.includes('describe')) continue;
    assert.match(call, /--format=json\(/, `a describe ran without a projection: ${call}`);
  }
});

test('the report never fails the run', () => {
  assert.equal(report('denied').status, 0);
  assert.equal(report('missing').status, 0);
});
