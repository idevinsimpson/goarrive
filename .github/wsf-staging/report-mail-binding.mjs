#!/usr/bin/env node
/**
 * WHICH SECRET VERSION THE DEPLOYED MAIL FUNCTIONS ACTUALLY SERVE.
 *
 * `report-mail-secret.mjs` says whether WSF_EMAIL_API_KEY exists and has an
 * enabled version. Its own docstring is careful to say that this is NOT proof
 * the deployed function can read it: "runtime binding is a property of the
 * function's own secret reference and service identity". This script reports
 * that property, and nothing else.
 *
 * A SUCCESSFUL SEND DOES NOT ESTABLISH A VERSION. Mail arriving proves that
 * whatever key the instance held was accepted by the provider. It does not say
 * which version supplied it, and neither does the sender's domain nor a
 * comparison of connector inventories — several versions can carry keys that
 * would each succeed. If the binding is the evidence wanted, the binding has to
 * be read.
 *
 * "latest" IS AN ANSWER, AND IT IS NOT A NUMBER. A function may reference the
 * secret by alias. Reporting that as an observed version 2 would be inventing
 * a fact: the alias is resolved when a revision is created, so the number a
 * running instance holds is a property of THE SERVING REVISION rather than of
 * the function's reference. So this reads both, reports the alias as an alias,
 * and resolves the number from the revision the service is actually serving.
 *
 * FOUR STATES, NEVER COLLAPSED — the same discipline as the sibling script,
 * for the same reason: "I could not read it" is not "it is not bound".
 *
 *   bound_pinned    the function references the secret at a numeric version
 *   bound_alias     the function references it by alias (e.g. `latest`)
 *   unbound         the function exists and references no such secret
 *   absent          gcloud gave a real NOT_FOUND for the function
 *   unknown         permission, auth, tooling or network failure
 *
 * WHAT IT NEVER DOES. No payload: `versions access` is never called, here or
 * anywhere. No full environment dump — every read is an explicit field
 * projection, so a variable this script was not asked about cannot be printed
 * by accident. No IAM change, no deploy, no write of any kind.
 */
import { spawnSync } from 'node:child_process';

const project = process.argv[2];
const region = process.argv[3] ?? 'us-central1';
const secretName = process.argv[4] ?? 'WSF_EMAIL_API_KEY';
const functions = process.argv.slice(5);
if (!project || functions.length === 0) {
  console.error(
    '::error::report-mail-binding.mjs needs <projectId> [region] [secretName] <function> [function...]'
  );
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
 * NOT_FOUND about the thing asked for is the only absence.
 *
 * Google's permission failure deliberately reads "does not exist or caller
 * lacks access", so a substring match on "does not exist" reports a
 * permission problem as absence — the exact bug the sibling script documents
 * at length. Permission always wins.
 */
function readsAsAbsent(stderr) {
  const s = stderr.toLowerCase();
  if (s.includes('permission') || s.includes('denied') || s.includes('lacks access')) return false;
  return s.includes('not_found') || s.includes('could not be found');
}

/** The secret's binding on one revision, read from that revision alone. */
function revisionBinding(revision) {
  if (!revision) return { version: null, detail: 'no serving revision reported' };
  const r = run([
    'run',
    'revisions',
    'describe',
    revision,
    `--region=${region}`,
    `--project=${project}`,
    // WHITELISTED PROJECTION. Only the secret references on this revision.
    '--format=json(spec.containers[].env)',
  ]);
  if (r.failedToRun || r.status !== 0) {
    return { version: null, detail: 'revision could not be read' };
  }
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return { version: null, detail: 'revision response was not JSON' };
  }
  const containers = parsed?.spec?.containers ?? [];
  for (const c of containers) {
    for (const e of c?.env ?? []) {
      if (e?.name !== secretName) continue;
      const ref = e?.valueFrom?.secretKeyRef;
      if (ref?.key) return { version: String(ref.key), detail: '' };
    }
  }
  return { version: null, detail: 'revision carries no reference to this secret' };
}

const rows = [];
for (const fn of functions) {
  const r = run([
    'functions',
    'describe',
    fn,
    '--gen2',
    `--region=${region}`,
    `--project=${project}`,
    // WHITELISTED PROJECTION, not a full describe: state, the serving
    // revision, and the secret references. Nothing else is printed.
    '--format=json(name,state,serviceConfig.revision,serviceConfig.secretEnvironmentVariables)',
  ]);

  if (r.failedToRun) {
    rows.push({ fn, state: 'unknown', detail: 'gcloud could not be run' });
    continue;
  }
  if (r.status !== 0) {
    rows.push({
      fn,
      state: readsAsAbsent(r.stderr) ? 'absent' : 'unknown',
      detail: readsAsAbsent(r.stderr) ? 'no such function in this project/region' : 'describe refused',
    });
    continue;
  }

  let d;
  try {
    d = JSON.parse(r.stdout);
  } catch {
    rows.push({ fn, state: 'unknown', detail: 'describe response was not JSON' });
    continue;
  }

  const fnState = d?.state ?? 'unknown';
  const revision = d?.serviceConfig?.revision ?? null;
  const refs = d?.serviceConfig?.secretEnvironmentVariables ?? [];
  const ref = refs.find((v) => v?.key === secretName || v?.secret === secretName);

  if (!ref) {
    rows.push({ fn, state: 'unbound', fnState, revision, detail: 'no reference to this secret' });
    continue;
  }

  const declared = ref.version == null ? 'unset' : String(ref.version);
  const pinned = /^\d+$/.test(declared);
  const served = revisionBinding(revision);

  rows.push({
    fn,
    state: pinned ? 'bound_pinned' : 'bound_alias',
    fnState,
    revision,
    declared,
    servedVersion: served.version,
    servedDetail: served.detail,
  });
}

console.log(`WSF MAIL BINDING — read-only, metadata only`);
console.log(`  project   ${project}`);
console.log(`  region    ${region}`);
console.log(`  secret    ${secretName}`);
console.log('');
for (const row of rows) {
  console.log(`  ${row.fn}`);
  console.log(`    binding          ${row.state}${row.detail ? ` (${row.detail})` : ''}`);
  if (row.fnState) console.log(`    function state   ${row.fnState}`);
  if (row.revision) console.log(`    serving revision ${row.revision}`);
  if (row.declared) {
    console.log(`    declared version ${row.declared}${row.state === 'bound_alias' ? '  (an alias, not a number)' : ''}`);
  }
  if (row.declared) {
    console.log(
      `    served version   ${row.servedVersion ?? 'unresolved'}${
        row.servedVersion ? '' : ` (${row.servedDetail})`
      }`
    );
  }
  console.log('');
}

// Machine-readable, one line per function, for a later step or a log tail.
for (const row of rows) {
  const key = row.fn.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  console.log(`WSF_MAIL_BINDING_${key}=${row.state}`);
  console.log(`WSF_MAIL_BINDING_${key}_DECLARED=${row.declared ?? 'none'}`);
  console.log(`WSF_MAIL_BINDING_${key}_SERVED=${row.servedVersion ?? 'unresolved'}`);
  console.log(`WSF_MAIL_BINDING_${key}_REVISION=${row.revision ?? 'unknown'}`);
}

console.log('');
console.log('  A version here is what the service REFERENCES and what its serving');
console.log('  revision RESOLVED. It is not proof the key works: that is only');
console.log('  knowable from the provider, and a delivered message is the only');
console.log('  evidence of it. The two facts are reported separately on purpose.');

// A REPORT NEVER FAILS THE RUN. One that exits nonzero becomes a thing people
// route around rather than read — the same rule the preflight states.
process.exit(0);
