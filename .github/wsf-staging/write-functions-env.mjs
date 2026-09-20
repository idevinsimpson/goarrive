#!/usr/bin/env node
/**
 * THE NONSECRET RUNTIME CONFIG THE MAIL CALLABLES READ.
 *
 * `readSendConfig()` in functions-westayfit needs three things beyond the
 * Secret Manager key:
 *
 *   WSF_EMAIL_FROM            the verified sender, which is account-specific
 *                             and therefore supplied, never guessed
 *   WSF_APP_URL               the origin a minted action link returns to
 *   WSF_AUTH_ACTION_HANDLER   the handler that actually serves that link
 *
 * WHY A FILE AND NOT AN EXPORT. An outer `export WSF_EMAIL_FROM=…` in the
 * deploy step configures the RUNNER, not the deployed function: Cloud
 * Functions gets its runtime environment from the project-specific dotenv
 * that firebase-tools packages with the source (`.env.<projectId>`, see
 * firebase.google.com/docs/functions/config-env). A shell export would have
 * deployed a function that still answers `failed-precondition`, and the
 * deploy would have looked like it worked.
 *
 * WHY IT IS GENERATED AND NOT COMMITTED. The file is per-project and belongs
 * to the deployment, not to the source tree. Generating it also means the
 * check below runs on every deploy rather than once at review time.
 *
 * NO SECRET IS EVER WRITTEN HERE. WSF_EMAIL_API_KEY is bound through
 * `defineSecret` and mounted by Cloud Run; putting it in a dotenv is exactly
 * the trap the functions source documents at length. This script refuses to
 * write a key-shaped value.
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , outPath, projectId, appUrl, actionHandler] = process.argv;
const from = process.env.WSF_EMAIL_FROM ?? '';

/**
 * THE STAGING BOUNDARY, PINNED HERE AND NOT INFERRED FROM THE ARGUMENTS.
 *
 * The first version validated the SHAPE of what it was handed — https, a host
 * beginning with the project id — and accepted anything that matched. Four
 * negative probes all wrote a config and exited 0:
 *
 *   https://example.invalid                                   (foreign origin)
 *   https://westayfit-staging.example.invalid/__/auth/action  (lookalike host)
 *   https://westayfit-staging.firebaseapp.com/not-an-action-handler
 *   project goarrive with production-shaped URLs
 *
 * The workflow's literals were right, so nothing was actually mis-deployed —
 * but a validator that only agrees with a correct caller is not a validator.
 * These are exact values. A future edit that changes one has to change it
 * here too, where it is reviewed, rather than silently in a shell line.
 */
const ALLOWED_PROJECT = 'westayfit-staging';
const ALLOWED_APP_URL = 'https://westayfit-staging--staging-4a616y5m.web.app';
const ALLOWED_ACTION_HANDLER = 'https://westayfit-staging.firebaseapp.com/__/auth/action';

function die(message) {
  console.error(`::error::${message}`);
  process.exit(1);
}

if (!outPath || !projectId || !appUrl || !actionHandler) {
  die('write-functions-env.mjs needs <outPath> <projectId> <appUrl> <actionHandler>');
}
if (projectId !== ALLOWED_PROJECT) {
  die(`this writer configures ${ALLOWED_PROJECT} only; refused ${projectId}`);
}
// EXACT BASENAME. `endsWith` admitted `anything.env.westayfit-staging`, and a
// file firebase-tools does not recognise is a green deploy that changed
// nothing — the most expensive failure available.
if (path.basename(outPath) !== `.env.${ALLOWED_PROJECT}`) {
  die(`the functions env file must be named exactly .env.${ALLOWED_PROJECT}; got ${path.basename(outPath)}`);
}

// A Resend key is `re_…`. If one is ever pasted into the sender variable by
// mistake, it must not reach a file, a log or a deployment — and it must be
// diagnosed as a KEY. This check comes FIRST: a bare key has no `@`, so the
// address-shape check below would otherwise catch it and report the far less
// useful "does not look like an address", leaving somebody to work out on
// their own that they had just pasted a credential into a variable.
if (/\bre_[A-Za-z0-9_-]{8,}/.test(from)) {
  die('WSF_EMAIL_FROM looks like an API key, not a sender address. Nothing was written. Rotate it if it was a real key.');
}
// THE SENDER IS SUPPLIED, NEVER INVENTED. A guessed From address fails DMARC
// and burns the real domain on the way out — the functions source says so in
// its own words, and this is the check that keeps it true.
if (!from.trim()) {
  die(
    'WSF_EMAIL_FROM is not set for this environment. Set it as a GitHub Actions ' +
    'variable on the wsf-staging environment to the verified Resend sender ' +
    '(for example "We Stay Fit <no-reply@example-verified-domain>"), then re-run. ' +
    'Nothing was written.'
  );
}
if (!/@/.test(from) || /\n|\r/.test(from)) {
  die('WSF_EMAIL_FROM does not look like an address, or contains a newline. Nothing was written.');
}

/**
 * An exact URL match, plus the parts a string compare would not catch on its
 * own if the value were ever assembled rather than pasted: credentials, a
 * port, a query or a fragment all change where a minted action code goes.
 */
function pinUrl(label, value, allowed) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return die(`${label} is not a URL: ${value}`);
  }
  if (url.username || url.password) die(`${label} carries credentials in the URL`);
  if (url.port) die(`${label} carries a port: ${value}`);
  if (url.search) die(`${label} carries a query string: ${value}`);
  if (url.hash) die(`${label} carries a fragment: ${value}`);
  if (url.protocol !== 'https:') die(`${label} must be https: ${value}`);
  // Compared after normalisation so a trailing slash is not a false alarm,
  // and against the EXACT expected value so a lookalike host, a foreign
  // origin or a wrong path is.
  const normal = url.origin + url.pathname.replace(/\/$/, '');
  const expected = new URL(allowed);
  const expectedNormal = expected.origin + expected.pathname.replace(/\/$/, '');
  if (normal !== expectedNormal) {
    die(`${label} must be exactly ${allowed}; refused ${value}`);
  }
}

pinUrl('WSF_APP_URL', appUrl, ALLOWED_APP_URL);
pinUrl('WSF_AUTH_ACTION_HANDLER', actionHandler, ALLOWED_ACTION_HANDLER);

const body = [
  `# Generated by .github/wsf-staging/write-functions-env.mjs for ${projectId}.`,
  '# Nonsecret runtime config only. WSF_EMAIL_API_KEY is a Secret Manager',
  '# binding and must never appear here.',
  `WSF_EMAIL_FROM=${from.trim()}`,
  `WSF_APP_URL=${appUrl}`,
  `WSF_AUTH_ACTION_HANDLER=${actionHandler}`,
  '',
].join('\n');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, body, { mode: 0o600 });

// The sender is printed because it is not a secret and because a deploy that
// configured the WRONG sender should be visible in the log. The key is not
// printed anywhere because it is not read here at all.
console.log(`WSF_FUNCTIONS_ENV=${outPath}`);
console.log(`WSF_EMAIL_FROM_CONFIGURED=${from.trim()}`);
console.log(`WSF_APP_URL_CONFIGURED=${appUrl}`);
console.log(`WSF_AUTH_ACTION_HANDLER_CONFIGURED=${actionHandler}`);
