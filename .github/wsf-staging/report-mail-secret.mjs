#!/usr/bin/env node
/**
 * WHAT IS KNOWN ABOUT THE MAIL SECRET — AND WHAT IS ONLY UNREADABLE.
 *
 * The first version of this was one shell `if`: `gcloud secrets describe …` or
 * else print `WSF_EMAIL_SECRET_EXISTS=false`. Running its exact shell against
 * a gcloud that fails with PERMISSION_DENIED returns exit 0 and prints
 * `false` — a confident, false claim that the secret is not there, which
 * would send an operator to create a second secret beside a perfectly good
 * one, or to widen IAM to make a diagnostic go green.
 *
 * "I could not read it" is not "it is not there". This reports four distinct
 * states and never collapses them:
 *
 *   present_with_enabled  the secret exists and has >=1 ENABLED version
 *   present_no_enabled    the secret exists and no version is ENABLED
 *   absent                gcloud said NOT_FOUND — a real answer
 *   unknown               permission, auth, tooling or network failure
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM. An ENABLED version is not proof that
 * the deployed function can read it, nor that the key inside works: runtime
 * binding is a property of the function's own secret reference and service
 * identity, and the key's validity is only knowable from the provider. Those
 * are reported separately where authorized and labelled unavailable where
 * not. No payload is ever read — `versions access` is never called.
 */
import { spawnSync } from 'node:child_process';

const project = process.argv[2];
const secret = process.argv[3] ?? 'WSF_EMAIL_API_KEY';
if (!project) {
  console.error('::error::report-mail-secret.mjs needs <projectId> [secretName]');
  process.exit(1);
}

const gcloud = process.env.WSF_GCLOUD_BIN ?? 'gcloud';
function run(args) {
  const r = spawnSync(gcloud, args, { encoding: 'utf8' });
  return {
    // A missing binary reports status null; that is tooling, not absence.
    status: r.error ? null : r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    failedToRun: Boolean(r.error),
  };
}

/**
 * ABSENT IS THE NARROWEST POSSIBLE READING, AND PERMISSION ALWAYS WINS.
 *
 * The first version matched the phrase "does not exist" anywhere in the
 * error. gcloud's own permission failure reads:
 *
 *   PERMISSION_DENIED: caller lacks secretmanager.secrets.get;
 *   resource does not exist or caller lacks access
 *
 * — which contains that phrase, so a permission problem was reported as
 * `absent` and the operator was told to create a secret that already exists.
 * That sentence is DESIGNED to be ambiguous: Google deliberately does not
 * disclose whether a resource exists to a caller who may not see it, so its
 * presence is a reason to say UNKNOWN, never a reason to say absent.
 *
 * So: any hint of permission, authentication or the ambiguous phrasing makes
 * it unknown, and only an unambiguous NOT_FOUND with none of those makes it
 * absent.
 */
function classify(result) {
  if (result.status === 0) return 'ok';
  const text = `${result.stderr}\n${result.stdout}`;
  const ambiguous =
    /PERMISSION_DENIED|UNAUTHENTICATED|UNAUTHORIZED|FORBIDDEN|\b40[13]\b/i.test(text) ||
    /lacks? access|lacks? permission|caller lacks|reauthenticate|credentials/i.test(text);
  // Permission wins even when gcloud also says NOT_FOUND, because it answers
  // NOT_FOUND precisely when it will not disclose whether a resource exists.
  if (ambiguous) return 'unknown';
  // NOTHING here matches the bare phrase "does not exist". That phrase only
  // ever reaches this code inside Google's deliberate hedge — "resource does
  // not exist OR caller lacks access" — which reveals nothing, so it must not
  // decide anything. An earlier version of this fix carried a separate clause
  // for that phrase; mutation testing showed removing it changed no outcome,
  // because the absent matcher below is already narrow enough to ignore it.
  // A rule no test can fail is not a rule, so it is gone and the invariant it
  // was protecting is pinned by a test instead.
  if (/\bNOT_FOUND\b|\b404\b|was not found/i.test(text)) return 'absent';
  return 'unknown';
}

const describe = run(['secrets', 'describe', secret, '--project', project, '--format', 'value(name)']);
const described = describe.failedToRun ? 'unknown' : classify(describe);

let state;
let enabledVersions = null;
let detail = '';

if (described === 'absent') {
  state = 'absent';
  detail = `gcloud reports ${secret} does not exist in ${project}`;
} else if (described === 'unknown') {
  state = 'unknown';
  // The reason matters: permission is an operator grant, a missing binary is
  // a runner problem, and they are not the same follow-up.
  detail = describe.failedToRun
    ? 'the gcloud CLI could not be executed on this runner'
    : `the secret could not be read (${(describe.stderr.split('\n').find((l) => l.trim()) ?? 'no detail').trim().slice(0, 160)})`;
} else {
  const versions = run([
    'secrets', 'versions', 'list', secret,
    '--project', project, '--filter', 'state=ENABLED', '--format', 'value(name)',
  ]);
  if (versions.status !== 0) {
    // The secret IS present; only its versions are unreadable. Saying
    // "present_no_enabled" here would be the same false-confidence bug one
    // level down.
    state = 'unknown';
    detail = 'the secret exists but its versions could not be listed';
  } else {
    enabledVersions = versions.stdout.split('\n').filter((line) => line.trim()).length;
    state = enabledVersions > 0 ? 'present_with_enabled' : 'present_no_enabled';
  }
}

console.log(`WSF_EMAIL_SECRET_STATE=${state}`);
console.log(`WSF_EMAIL_SECRET_ENABLED_VERSIONS=${enabledVersions === null ? 'unknown' : enabledVersions}`);
// Said every time, because an ENABLED version is the thing most likely to be
// mistaken for "mail works".
console.log('WSF_EMAIL_RUNTIME_BINDING=not_established_by_this_check');
console.log('WSF_EMAIL_KEY_VALIDITY=not_established_by_this_check');
if (detail) console.log(`WSF_EMAIL_SECRET_DETAIL=${detail}`);

if (state === 'absent') {
  console.log(`::warning::${secret} does not exist in ${project}. Mail will answer failed-precondition until an operator creates it.`);
} else if (state === 'present_no_enabled') {
  console.log(`::warning::${secret} exists in ${project} with no ENABLED version. Mail will still refuse to send.`);
} else if (state === 'unknown') {
  console.log(`::warning::The state of ${secret} in ${project} could not be determined: ${detail}. This is NOT a report that it is missing.`);
}
// Never fails the deploy: this is a diagnostic, and an unreadable secret must
// not block a deployment that is otherwise correct.
process.exit(0);
