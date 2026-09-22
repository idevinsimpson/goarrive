#!/usr/bin/env node
/**
 * THE VERIFIED SENDER DOMAIN, PINNED.
 *
 * This exists because the domain was wrong once and nothing caught it. The
 * preflight defaulted to `goarrive.fit` on the strength of a real inspection
 * of a real Resend workspace — which turned out to be a DIFFERENT workspace
 * from the one this staging track deploys with. Two workspaces, one reachable
 * from a developer session and owning `goarrive.fit`, one owning verified
 * `westay.fit` and the sending-only key behind `WSF_EMAIL_API_KEY` version 2.
 *
 * A wrong default here is not cosmetic. It decides whether the preflight says
 * "ready" before a deploy that the provider would then refuse, so the mistake
 * surfaces as undelivered mail rather than as a failed check.
 *
 * These assertions are about the DEFAULT specifically. The override still
 * works, and is tested too, so a future domain change stays a variable rather
 * than a commit.
 *
 * Nothing here needs gcloud, curl or the network: the sender check reads one
 * environment variable, and the secret and authorized-domain checks are free
 * to report `unknown` — this suite asserts only the sender-domain verdict.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const PREFLIGHT = path.join('.github', 'wsf-staging', 'mail-preflight.mjs');
const PROJECT = 'westayfit-staging';

/** Run the preflight with a controlled environment and parse its report. */
function preflight(env) {
  const r = spawnSync(process.execPath, [PREFLIGHT, PROJECT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      // Neither is set by this suite unless a case asks for it.
      WSF_EMAIL_FROM: undefined,
      WSF_VERIFIED_SENDER_DOMAIN: undefined,
      // A gcloud that cannot run keeps the other two checks at `unknown`
      // without reaching anything real.
      WSF_GCLOUD_BIN: path.join('.github', 'wsf-staging', 'tests', '__no_such_gcloud__'),
      ...env,
    },
  });
  const read = (key) => {
    const m = new RegExp(`^${key}=(.*)$`, 'm').exec(r.stdout);
    return m ? m[1].trim() : null;
  };
  return {
    status: r.status,
    stdout: r.stdout,
    senderState: read('WSF_MAIL_PREFLIGHT_SENDER'),
    domainOk: read('WSF_MAIL_PREFLIGHT_SENDER_DOMAIN_OK'),
    ready: read('WSF_MAIL_PREFLIGHT_READY'),
  };
}

test('a westay.fit sender matches the default verified domain', () => {
  const r = preflight({ WSF_EMAIL_FROM: 'noreply@westay.fit' });
  assert.equal(r.senderState, 'present');
  assert.equal(r.domainOk, 'yes', 'the intended staging domain must match the default');
});

test('the display-name form is read — this is the form the environment actually uses', () => {
  /*
    THE SECOND REGRESSION THIS FILE EXISTS FOR, and it reached production
    configuration. `WSF_EMAIL_FROM` on the wsf-staging environment is
    `We Stay Fit <noreply@westay.fit>`, the ordinary RFC 5322 display-name
    form. Slicing after the last `@` returned `westay.fit>` — angle bracket
    included — so a correctly configured environment reported NOT READY
    (run 35735970775).

    A diagnostic that accuses a correct configuration is worse than one that
    is merely unhelpful: it sends the next operator chasing a problem that
    does not exist, or teaches them to disbelieve the report.
  */
  const r = preflight({ WSF_EMAIL_FROM: 'We Stay Fit <noreply@westay.fit>' });
  assert.equal(r.senderState, 'present');
  assert.equal(r.domainOk, 'yes', 'the display-name form must resolve to westay.fit');
});

test('the angle-bracket-only form is read too', () => {
  const r = preflight({ WSF_EMAIL_FROM: '<noreply@westay.fit>' });
  assert.equal(r.domainOk, 'yes');
});

test('the display-name form is not a way round the domain check', () => {
  const r = preflight({ WSF_EMAIL_FROM: 'We Stay Fit <noreply@goarrive.fit>' });
  assert.equal(r.senderState, 'present');
  assert.equal(r.domainOk, 'no', 'the other workspace stays refused in every form');
  assert.equal(r.ready, 'no');
});

test('a display name wrapped round something that is not an address is refused', () => {
  const r = preflight({ WSF_EMAIL_FROM: 'We Stay Fit <not-an-address>' });
  assert.equal(r.senderState, 'refused');
  assert.equal(r.domainOk, 'no');
});

test('an empty pair of angle brackets is refused rather than read as a domain', () => {
  const r = preflight({ WSF_EMAIL_FROM: 'We Stay Fit <>' });
  assert.equal(r.senderState, 'refused');
  assert.equal(r.domainOk, 'no');
});

test('a goarrive.fit sender does NOT match — it is the other workspace', () => {
  /*
    THE REGRESSION THIS FILE EXISTS FOR. `goarrive.fit` is verified, and
    sending-enabled, in a workspace this track does not deploy with. Accepting
    it here is exactly the mistake that produced undeliverable staging mail.
  */
  const r = preflight({ WSF_EMAIL_FROM: 'noreply@goarrive.fit' });
  assert.equal(r.senderState, 'present', 'the address is still a well-formed sender');
  assert.equal(r.domainOk, 'no', 'a sender from the other Resend workspace must be refused');
  assert.equal(r.ready, 'no', 'a mismatched sender can never report ready');
});

test('the override still works, so a domain change is a variable not a commit', () => {
  const r = preflight({
    WSF_EMAIL_FROM: 'noreply@example.test',
    WSF_VERIFIED_SENDER_DOMAIN: 'example.test',
  });
  assert.equal(r.domainOk, 'yes', 'WSF_VERIFIED_SENDER_DOMAIN must still govern');
});

test('the override is case-insensitive on both sides', () => {
  const r = preflight({
    WSF_EMAIL_FROM: 'noreply@WeStay.FIT',
    WSF_VERIFIED_SENDER_DOMAIN: 'WESTAY.fit',
  });
  assert.equal(r.domainOk, 'yes');
});

test('an absent sender is absent, not a match', () => {
  const r = preflight({});
  assert.equal(r.senderState, 'absent');
  assert.equal(r.domainOk, 'no', 'nothing to match is not a match');
  assert.equal(r.ready, 'no');
});

test('the report still never prints the local part of the address', () => {
  /*
    The local part is a real address that lands in mail headers and logs, so
    only the DOMAIN is reported. Re-asserted here because this suite is the
    one that feeds real-looking addresses through the script.
  */
  const r = preflight({
    WSF_EMAIL_FROM: 'A Distinctive Display Name <a-very-distinctive-local-part@westay.fit>',
  });
  assert.ok(
    !r.stdout.includes('a-very-distinctive-local-part'),
    'the preflight echoed the local part of the sender address'
  );
  assert.ok(
    !r.stdout.includes('A Distinctive Display Name'),
    'the preflight echoed the display name'
  );
  assert.match(r.stdout, /on westay\.fit\b/, 'the domain itself is still reported');
  assert.ok(
    !/westay\.fit>/.test(r.stdout),
    'the reported domain still carries the closing angle bracket'
  );
});

test('the preflight still exits 0 — a report that fails the run gets routed around', () => {
  const r = preflight({ WSF_EMAIL_FROM: 'noreply@goarrive.fit' });
  assert.equal(r.status, 0, 'even a refusing verdict must not fail the run');
});
