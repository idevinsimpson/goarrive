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
 *   · matching an ENVIRONMENT VARIABLE NAME and calling it a secret reports a
 *     different secret's version under the requested secret's header;
 *   · treating a malformed response as an empty one asserts absence from
 *     metadata that identified nothing.
 *
 * EVERY ONE OF THOSE PASSED AN EARLIER VERSION OF THIS SUITE. That is the
 * reason for the shape of the tests below: several of them assert that a
 * previously ACCEPTED behaviour is now REJECTED, rather than merely that the
 * good path still works. A suite that only pins the happy path is how four
 * defects survived ten green tests.
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

// ── The positive control ────────────────────────────────────────────────────
// Everything below rejects something. This one proves the reporter still
// answers the question when the answer is genuinely available — without it,
// a script that reported `unknown` for every input would pass the whole file.

test('POSITIVE CONTROL: numeric version, matching secret and project, is bound_pinned', () => {
  const r = report('pinned');
  assert.equal(r.read(KEY), 'bound_pinned');
  assert.equal(r.read(`${KEY}_DECLARED`), '2');
  assert.equal(r.read(`${KEY}_SECRET`), 'WSF_EMAIL_API_KEY');
  assert.equal(r.read(`${KEY}_SERVED`), '2');
  assert.equal(r.read(`${KEY}_REVISION`), 'wsfsendverificationemail-00007-abc');
});

// ── Alias resolution ────────────────────────────────────────────────────────

test('AN ALIAS ON THE REVISION LEAVES THE NUMBER UNRESOLVED, and says so', () => {
  /*
    THE CORRECTION THIS FILE EXISTS FOR.

    The old test asserted `SERVED=2` for an alias, on the belief that the alias
    "is resolved when a revision is created". It is not: Cloud Run resolves a
    secret env value at INSTANCE STARTUP, so a `:latest` deploy leaves the
    literal string on the revision. The old fixture hid this by returning a
    numeric key for every scenario, so the case that actually happens was never
    modelled. Now it is, and the number must stay unresolved.
  */
  const r = report('alias');
  assert.equal(r.read(KEY), 'bound_alias');
  assert.equal(r.read(`${KEY}_DECLARED`), 'latest');
  assert.equal(r.read(`${KEY}_SERVED`), 'unresolved',
    'the alias on the revision was reported as a resolved version');
  // And the prose must agree with the machine output — it is the prose an
  // operator reads, and it is where the unqualified `latest` used to appear.
  assert.match(r.stdout, /an alias, not a number/);
  assert.match(r.stdout, /revision version UNRESOLVED/);
  assert.doesNotMatch(r.stdout, /revision version latest$/m,
    'the alias was printed under the label that reads as the answer');
});

test('an alias whose REVISION carries a number resolves to that number', () => {
  // The other half: when the revision genuinely pins a version, that is a real
  // observation and must not be thrown away by the fix above.
  const r = report('alias-revision-numeric');
  assert.equal(r.read(KEY), 'bound_alias');
  assert.equal(r.read(`${KEY}_DECLARED`), 'latest');
  assert.equal(r.read(`${KEY}_SERVED`), '2');
});

test('an alias whose revision cannot be read stays UNRESOLVED, never guessed', () => {
  const r = report('alias-revision-unreadable');
  assert.equal(r.read(KEY), 'bound_alias');
  assert.equal(r.read(`${KEY}_DECLARED`), 'latest');
  assert.equal(r.read(`${KEY}_SERVED`), 'unresolved');
});

// ── Binding identity ────────────────────────────────────────────────────────

test('A DIFFERENT SECRET UNDER THE RIGHT VARIABLE NAME IS A MISMATCH, never a binding', () => {
  /*
    `key` is the ENV VAR NAME on a gen2 SecretEnvVar and `secret` is the
    resource. The old `v.key === secretName || v.secret === secretName` matched
    on either, so a variable named WSF_EMAIL_API_KEY fed from RESEND_API_KEY
    reported `bound_pinned` and printed that other secret's version under a
    header reading `secret WSF_EMAIL_API_KEY`. Nothing in the output revealed
    the substitution.
  */
  const r = report('wrong-secret');
  assert.equal(r.read(KEY), 'mismatch');
  assert.notEqual(r.read(KEY), 'bound_pinned');
  assert.match(r.stdout, /fed from RESEND_API_KEY/);
});

test('the revision-level identity is checked too, not just the function-level one', () => {
  // The function read agreed; the revision feeds the variable from something
  // else. The version on it is not this secret's version.
  const r = report('revision-wrong-secret');
  assert.equal(r.read(`${KEY}_SERVED`), 'unresolved');
  assert.match(r.stdout, /different secret/);
});

test('THE RIGHT SECRET UNDER A DIFFERENT VARIABLE NAME IS UNBOUND, not a binding', () => {
  /*
    THE OTHER DIRECTION OF THE SAME CONFLATION, and the one that keeps the
    `||` from creeping back in. Here the secret IS WSF_EMAIL_API_KEY — it is
    simply mounted as a different variable, so the variable asked about is not
    bound. An identity check that matches on either name finds the secret and
    reports a binding for a variable that does not exist.

    Added after a mutation run: restoring the old `v.key === envName ||
    v.secret === secretName` filter did NOT fail this file, because every
    fixture happened to carry the right variable name. A mutation that survives
    is a missing test, not a harmless mutation.
  */
  const r = report('other-variable');
  assert.equal(r.read(KEY), 'unbound');
  assert.notEqual(r.read(KEY), 'bound_pinned');
});

test('A WRONG PROJECT IS NOT A MATCH', () => {
  const r = report('wrong-project');
  assert.notEqual(r.read(KEY), 'bound_pinned');
  assert.equal(r.read(KEY), 'unknown');
});

test('A PROJECT NUMBER THAT CANNOT BE MATCHED TO THE ID IS UNRESOLVED, not assumed', () => {
  /*
    A project id and a project number may well name the same project, and this
    script cannot establish that from the reads it is allowed. So it says so.
    Guessing either way would be inventing the identity half of the answer.
  */
  const r = report('project-number');
  assert.equal(r.read(KEY), 'unknown');
  assert.match(r.stdout, /id vs number/);
});

test('ABSENT SECRET IDENTITY IS UNKNOWN, NEVER A MATCH', () => {
  // A missing field is not permission to assume the convenient value.
  const r = report('no-secret-field');
  assert.equal(r.read(KEY), 'unknown');
  assert.notEqual(r.read(KEY), 'bound_pinned');
});

test('ABSENT PROJECT IDENTITY IS UNKNOWN, NEVER A MATCH', () => {
  const r = report('no-project-field');
  assert.equal(r.read(KEY), 'unknown');
  assert.notEqual(r.read(KEY), 'bound_pinned');
});

test('A REFERENCE WITH NO VERSION IS UNKNOWN, not an observed alias', () => {
  // `unset` is missing metadata. Labelling it bound_alias printed "(an alias,
  // not a number)" about a reference that never named one.
  const r = report('no-version');
  assert.equal(r.read(KEY), 'unknown');
  assert.doesNotMatch(r.stdout, /an alias, not a number/);
});

// ── Absence versus inability to read ────────────────────────────────────────

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

test('A MALFORMED RESPONSE IS UNKNOWN, NOT UNBOUND', () => {
  /*
    `JSON.parse('{}')` succeeds, so the old code fell through to an empty
    reference list and reported `unbound` — "the function exists and references
    no such secret" — from a response that identified no function at all.
  */
  const r = report('malformed');
  assert.equal(r.read(KEY), 'unknown');
  assert.notEqual(r.read(KEY), 'unbound');
});

test('a PARTIAL response — a name but no serviceConfig — is also unknown', () => {
  const r = report('partial');
  assert.equal(r.read(KEY), 'unknown');
  assert.notEqual(r.read(KEY), 'unbound');
});

test('A RESPONSE THAT IDENTIFIES NO FUNCTION IS UNKNOWN, however complete the rest looks', () => {
  /*
    The other half of the completeness guard, and the half a mutation run
    showed was untested: a serviceConfig carrying a perfectly good secret
    reference, on a response with no `name`. Nothing identifies what was
    described, so the reference cannot be attributed to the function asked
    about — and the project half of the identity check has nothing to resolve
    against either.
  */
  const r = report('no-name');
  assert.equal(r.read(KEY), 'unknown');
  assert.notEqual(r.read(KEY), 'bound_pinned');
});

test('A LEGITIMATE EMPTY BINDING IS STILL UNBOUND', () => {
  // The case the malformed-response fix must NOT swallow: the response
  // identifies the function and it genuinely references no secret.
  const r = report('nosecret');
  assert.equal(r.read(KEY), 'unbound');
});

// ── Scope of the reads ──────────────────────────────────────────────────────

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

test('THE REVISION PROJECTION IS VARIABLE-WIDE, AND THE BARE `env` FORM IS REJECTED', () => {
  /*
    THIS ASSERTION REJECTS WHAT THE SUITE PREVIOUSLY ACCEPTED.

    The old rule was "every describe carries a projection", which
    `--format=json(spec.containers[].env)` satisfies — and that returns every
    entry whole, including `env[].value` for ordinary plain-text variables.
    Nothing printed them, but the guarantee rested on the script's own
    selection rather than on the read, while the comment claimed otherwise.
    A projection is not narrow merely because it exists.
  */
  const r = report('pinned');
  const revisionCalls = r.calls.filter((c) => c.includes('revisions describe'));
  assert.ok(revisionCalls.length > 0, 'the revision was never described');
  for (const call of revisionCalls) {
    assert.doesNotMatch(call, /--format=json\(spec\.containers\[\]\.env\)/,
      `the revision read returns every env entry whole, values included: ${call}`);
    assert.match(call, /valueFrom\.secretKeyRef/,
      `the revision projection does not name the secret reference: ${call}`);
    // `value` is a prefix of `valueFrom`, so the negative lookahead is load
    // bearing: without it this rejects the correct projection.
    assert.doesNotMatch(call, /env\[\]\.value(?!From)/,
      `the revision projection asks for plain-text values: ${call}`);
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

// ── What the report does not claim ──────────────────────────────────────────

test('SERVING TRAFFIC IS REPORTED UNVERIFIED, in prose and in the machine output', () => {
  /*
    The described revision is one revision. Traffic split is not read, so a
    version here is the CONFIGURED binding of that revision and never a claim
    about every serving instance. A later step reading `_SERVED` without this
    would make exactly that claim on the reporter's behalf.
  */
  const r = report('pinned');
  assert.equal(r.read(`${KEY}_TRAFFIC`), 'unverified');
  assert.match(r.stdout, /serving traffic {2}unverified/);
  assert.match(r.stdout, /DESCRIBED/);
});

test('the report never fails the run', () => {
  assert.equal(report('denied').status, 0);
  assert.equal(report('missing').status, 0);
  assert.equal(report('malformed').status, 0);
  assert.equal(report('wrong-secret').status, 0);
});
