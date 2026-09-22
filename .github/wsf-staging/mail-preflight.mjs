#!/usr/bin/env node
/**
 * WHICH STAGING MAIL PREREQUISITES EXIST — AND NOTHING ELSE.
 *
 * Three things must be true before WSF staging can send a verification or
 * reset email, and the current failure is configuration rather than missing
 * code: `wsfSendVerificationEmail` and `wsfSendPasswordResetEmail` are
 * deployed and answer `failed-precondition` because `readSendConfig()` has
 * nothing to read.
 *
 *   1. WSF_EMAIL_API_KEY   a secret with an ENABLED version
 *   2. WSF_EMAIL_FROM      a sender on a VERIFIED domain
 *   3. authorized domain   the staging Hosting host, in staging Auth,
 *                          or the action link in the mail will not open
 *
 * THIS READS. It does not deploy, does not write, does not create, does not
 * grant, and does not rotate. It exists so an operator is told which of the
 * three are genuinely missing instead of guessing — and so nobody widens IAM
 * or creates a second secret beside a working one to make a diagnostic go
 * green.
 *
 * WHAT IT NEVER PRINTS. No secret payload — `versions access` is never
 * called. No access token. No full sender address: the local part is a real
 * address that ends up in mail headers and logs, so only its DOMAIN is
 * reported, which is the part that has to match a verified domain.
 *
 * "I COULD NOT READ IT" IS NOT "IT IS NOT THERE". Every check reports
 * `unknown` on permission, auth, tooling or network failure, and `absent`
 * only on an unambiguous answer about the thing being asked for. Google
 * deliberately returns PERMISSION_DENIED with "does not exist or caller
 * lacks access" precisely so absence cannot be inferred by a caller who may
 * not be entitled to know.
 */
import { spawnSync } from 'node:child_process';

const project = process.argv[2];
if (!project) {
  console.error('::error::mail-preflight.mjs needs <projectId>');
  process.exit(1);
}

const gcloud = process.env.WSF_GCLOUD_BIN ?? 'gcloud';

function run(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: 'utf8', ...opts });
  return {
    status: r.error ? null : r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    failedToRun: Boolean(r.error),
  };
}

/* ── 1 · the secret ─────────────────────────────────────────────────────── */
/**
 * Delegated to `report-mail-secret.mjs` rather than re-implemented. That
 * script already distinguishes the four states and already refuses to read a
 * payload; a second implementation of the same judgement is a second place
 * for it to drift.
 */
function secretState() {
  const r = run(process.execPath, [
    new URL('./report-mail-secret.mjs', import.meta.url).pathname,
    project,
    'WSF_EMAIL_API_KEY',
  ]);
  const m = /WSF_EMAIL_SECRET_STATE=(\w+)/.exec(r.stdout);
  return { state: m ? m[1] : 'unknown', detail: m ? '' : 'diagnostic did not report a state' };
}

/* ── 2 · the sender ─────────────────────────────────────────────────────── */
/**
 * Read from the environment the deploy would use, never from a guess.
 *
 * Only the domain is reported. A sender that looks like a key is refused
 * outright and never echoed — that mistake has been made before, and echoing
 * it to prove it happened would put the key in the log.
 */
function senderState() {
  const raw = (process.env.WSF_EMAIL_FROM ?? '').trim();
  if (!raw) return { state: 'absent', domain: null, detail: 'not set on this environment' };
  if (/^re_/i.test(raw) || raw.length > 120) {
    return { state: 'refused', domain: null, detail: 'value looks like a key, not an address' };
  }
  const at = raw.lastIndexOf('@');
  if (at < 1 || at === raw.length - 1) {
    return { state: 'refused', domain: null, detail: 'not an email address' };
  }
  return { state: 'present', domain: raw.slice(at + 1).toLowerCase(), detail: '' };
}

/* ── 3 · the authorized domain ──────────────────────────────────────────── */
/**
 * The staging Hosting host must be an authorized domain in STAGING Auth, or
 * the action link in a delivered message refuses to open — mail that arrives
 * and cannot be completed is not mail working.
 *
 * Read through the Identity Toolkit admin config. The access token is passed
 * to curl through an argument-free env var and is never printed; on any
 * failure this reports `unknown`, never `absent`.
 */
function authorizedDomainState(host) {
  const tok = run(gcloud, ['auth', 'print-access-token']);
  if (tok.failedToRun || tok.status !== 0 || !tok.stdout.trim()) {
    return { state: 'unknown', detail: 'no access token available' };
  }
  const res = run(
    'curl',
    [
      '-sS',
      '--max-time',
      '30',
      '-H',
      'Authorization: Bearer ' + tok.stdout.trim(),
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(project)}/config`,
    ],
    // The token is in argv for curl only; it is never echoed by this script.
    {}
  );
  if (res.failedToRun || res.status !== 0) {
    return { state: 'unknown', detail: 'config read failed' };
  }
  let cfg;
  try {
    cfg = JSON.parse(res.stdout);
  } catch {
    return { state: 'unknown', detail: 'config response was not JSON' };
  }
  if (cfg?.error) {
    // PERMISSION_DENIED and NOT_FOUND about the PROJECT are both "unknown"
    // about the domain — neither is an answer to the question asked.
    return { state: 'unknown', detail: 'config read refused' };
  }
  const domains = Array.isArray(cfg?.authorizedDomains) ? cfg.authorizedDomains : null;
  if (!domains) return { state: 'unknown', detail: 'config carried no authorizedDomains' };
  return {
    state: domains.includes(host) ? 'present' : 'absent',
    detail: `${domains.length} authorized domains configured`,
  };
}

/* ── report ─────────────────────────────────────────────────────────────── */

const STAGING_HOST = 'westayfit-staging--staging-4a616y5m.web.app';
const VERIFIED_SENDER_DOMAIN = (process.env.WSF_VERIFIED_SENDER_DOMAIN ?? 'goarrive.fit').toLowerCase();

const secret = secretState();
const sender = senderState();
const domain = authorizedDomainState(STAGING_HOST);

const senderMatches =
  sender.state === 'present' && sender.domain === VERIFIED_SENDER_DOMAIN;

console.log('WSF STAGING MAIL PREFLIGHT — read-only, metadata only');
console.log(`  project                 ${project}`);
console.log(`  WSF_EMAIL_API_KEY       ${secret.state}${secret.detail ? ` (${secret.detail})` : ''}`);
console.log(
  `  WSF_EMAIL_FROM          ${sender.state}` +
    (sender.domain ? ` on ${sender.domain}` : '') +
    (sender.state === 'present' ? (senderMatches ? ' — matches verified domain' : ' — DOES NOT match the verified domain') : '') +
    (sender.detail ? ` (${sender.detail})` : '')
);
console.log(`  authorized domain       ${domain.state} (${domain.detail})`);
console.log('');
console.log('  This establishes neither runtime binding nor key validity. An');
console.log('  ENABLED secret version is the thing most often mistaken for');
console.log('  "mail works"; it is not. Acceptance stays: provider accepted,');
console.log('  inbox received, action link completed, auth state refreshed.');

// Machine-readable, for a later step or a human skimming the log tail.
console.log('');
console.log(`WSF_MAIL_PREFLIGHT_SECRET=${secret.state}`);
console.log(`WSF_MAIL_PREFLIGHT_SENDER=${sender.state}`);
console.log(`WSF_MAIL_PREFLIGHT_SENDER_DOMAIN_OK=${senderMatches ? 'yes' : 'no'}`);
console.log(`WSF_MAIL_PREFLIGHT_AUTH_DOMAIN=${domain.state}`);

const ready =
  secret.state === 'present_with_enabled' && senderMatches && domain.state === 'present';
console.log(`WSF_MAIL_PREFLIGHT_READY=${ready ? 'yes' : 'no'}`);

// A PREFLIGHT NEVER FAILS THE RUN. It is a report, and a report that exits
// nonzero becomes a thing people route around rather than read.
process.exit(0);
