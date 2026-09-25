#!/usr/bin/env node
/**
 * WHAT THE DEPLOYED MAIL FUNCTIONS' DESCRIBED REVISION CONFIGURES FOR THE
 * SECRET — and nothing wider than that.
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
 * "latest" IS AN ANSWER, AND IT IS NOT A NUMBER — AT EITHER LEVEL.
 *
 * An earlier revision of this script said the alias "is resolved when a
 * revision is created", and resolved the served number from the revision on
 * that basis. THAT WAS WRONG, and the error mattered: Google documents secret
 * environment values as resolved at INSTANCE STARTUP, not at revision
 * creation. A `--set-secrets=SECRET:latest` deploy leaves the literal string
 * `latest` in the revision's own `secretKeyRef.key`, so the revision resolves
 * nothing. Reading it and printing `served version latest` under the one label
 * an operator reads as the answer is how the central question goes unanswered
 * while the run log looks complete.
 *
 * So: a non-numeric value is reported as an alias AT BOTH LEVELS, the observed
 * string is shown as what it is, and the number stays UNRESOLVED. Neither read
 * yields a number in that case, and this script does not supply one.
 *
 * ONE REVISION IS NOT THE SERVICE. Traffic split is NOT read here — adding a
 * `run services describe` would widen this script's scope, and the narrower
 * choice was taken deliberately. Everything below therefore describes THE
 * DESCRIBED REVISION'S CONFIGURED BINDING, and serving traffic is reported
 * `unverified`. It is never a claim about every serving instance.
 *
 * `key` MEANS TWO DIFFERENT THINGS, which is how a wrong secret read as
 * verified. On a gen2 SecretEnvVar, `key` is the ENVIRONMENT VARIABLE NAME and
 * `secret` is the secret RESOURCE. On a Cloud Run `secretKeyRef`, `name` is the
 * secret resource and `key` is the SECRET VERSION. Matching one against the
 * other made an env var named WSF_EMAIL_API_KEY fed from RESEND_API_KEY report
 * as a verified binding. Both halves are now required, separately.
 *
 * ABSENCE IS NEVER A MATCH. If the identity metadata needed to tell those apart
 * is missing — no `secret`, no `projectId` — the answer is `unknown`. A missing
 * field is not permission to assume the convenient value.
 *
 * SIX STATES, NEVER COLLAPSED — the same discipline as the sibling script,
 * for the same reason: "I could not read it" is not "it is not bound".
 *
 *   bound_pinned    the function references the secret at a numeric version
 *   bound_alias     the function references it by alias (e.g. `latest`)
 *   mismatch        that environment variable is fed from a DIFFERENT secret
 *   unbound         the function exists and references no such secret
 *   absent          gcloud gave a real NOT_FOUND for the function
 *   unknown         permission, auth, tooling, network, or metadata too
 *                   incomplete to answer
 *
 * WHAT IT NEVER DOES. No payload: `versions access` is never called, here or
 * anywhere. No full environment dump — every read is an explicit field
 * projection naming the variable NAME and the secret REFERENCE only, never
 * `env[].value`, so a plain-text variable this script was not asked about is
 * not returned to it in the first place. No IAM change, no deploy, no write of
 * any kind.
 */
import { spawnSync } from 'node:child_process';

const project = process.argv[2];
const region = process.argv[3] ?? 'us-central1';
const secretName = process.argv[4] ?? 'WSF_EMAIL_API_KEY';
/*
  THE ENVIRONMENT VARIABLE NAME, WHICH IS NOT THE SECRET NAME.

  They happen to be spelled the same in this deployment, which is precisely why
  conflating them went unnoticed. It is an env var rather than a sixth
  positional argument so the workflow job's argv and the pinned contract tests
  keep working unchanged.
*/
const envName = process.env.WSF_EMAIL_ENV_NAME ?? secretName;
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

const isNumericVersion = (v) => /^\d+$/.test(String(v));

/*
  SHAPE IS PART OF THE ANSWER, NOT A DETAIL OF PARSING IT.

  `typeof null === 'object'` and `typeof [] === 'object'`, so a `!= null` test
  admits a string, a number and an array where an object was meant. That is how
  `serviceConfig: "invalid"` and `serviceConfig: []` reached the reference
  lookup, found nothing there, and were reported `unbound` — the report
  asserting the deploy never wired the secret, from metadata that was not a
  function description at all.
*/
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

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

/** The project segment of a resource name the describe itself returned. */
function projectOfResourceName(name) {
  const m = /^projects\/([^/]+)\//.exec(String(name ?? ''));
  return m ? m[1] : null;
}

/*
  PROJECT IDENTITY, ESTABLISHED OR UNRESOLVED — NEVER ASSUMED.

  GCP names a project by id OR by number, and the two are not comparable by
  string. The only equivalence this script can establish without a further read
  is against what the describe ITSELF returned, so a `projectId` is accepted
  when it matches the project asked for, or the project segment of the
  function's own resource name. Anything else is `unresolved` — not a match,
  and not a mismatch either, because an id and a number may well name the same
  project and this script cannot tell.
*/
function projectIdentity(observed, describedProject) {
  if (observed == null || observed === '') return 'absent';
  const s = String(observed);
  if (s === project) return 'established';
  if (describedProject && s === describedProject) return 'established';
  return 'unresolved';
}

/** The secret's binding on one revision, read from that revision alone. */
function revisionBinding(revision) {
  if (!revision) return { version: null, observed: null, detail: 'no serving revision reported' };
  const r = run([
    'run',
    'revisions',
    'describe',
    revision,
    `--region=${region}`,
    `--project=${project}`,
    /*
      WHITELISTED PROJECTION — VARIABLE NAME AND SECRET REFERENCE ONLY.

      A bare `env` returns every entry whole, including `env[].value` for
      ordinary plain-text variables. Nothing downstream printed those, but the
      guarantee then rested on this script's own selection rather than on the
      read, while the comment here claimed otherwise. Now the values are not
      returned to this process at all.
    */
    '--format=json(spec.containers[].env[].name,spec.containers[].env[].valueFrom.secretKeyRef)',
  ]);
  if (r.failedToRun || r.status !== 0) {
    return { version: null, observed: null, detail: 'revision could not be read' };
  }
  let parsed;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return { version: null, observed: null, detail: 'revision response was not JSON' };
  }
  /*
    VALIDATE BEFORE ITERATING. `for…of` over a non-iterable throws, and this
    ran at top level — so one malformed revision did not merely lose its own
    answer, it terminated the whole report and suppressed the OTHER function's
    row. A reporter that disappears is worse than one that says `unresolved`.
  */
  if (!isPlainObject(parsed)) {
    return { version: null, observed: null, detail: 'revision response was not an object' };
  }
  if (parsed.spec !== undefined && !isPlainObject(parsed.spec)) {
    return { version: null, observed: null, detail: 'revision structure was malformed' };
  }
  const containers = parsed.spec?.containers;
  if (containers === undefined || containers === null) {
    return { version: null, observed: null, detail: 'revision reported no containers' };
  }
  if (!Array.isArray(containers)) {
    return { version: null, observed: null, detail: 'revision container list was malformed' };
  }
  for (const c of containers) {
    if (!isPlainObject(c)) {
      return { version: null, observed: null, detail: 'revision container was malformed' };
    }
    // An omitted env list is ordinary; a non-array one is not.
    if (c.env === undefined || c.env === null) continue;
    if (!Array.isArray(c.env)) {
      return { version: null, observed: null, detail: 'revision env list was malformed' };
    }
    for (const e of c.env) {
      if (!isPlainObject(e)) {
        return { version: null, observed: null, detail: 'revision env entry was malformed' };
      }
      if (e?.name !== envName) continue;
      const ref = e?.valueFrom?.secretKeyRef;
      if (!ref) continue;
      // IDENTITY FIRST. `secretKeyRef.name` is the secret resource; absent, the
      // revision cannot tell us which secret feeds this variable.
      if (ref.name == null || ref.name === '') {
        return { version: null, observed: null, detail: 'revision names no secret for this variable' };
      }
      if (String(ref.name) !== secretName) {
        return {
          version: null,
          observed: null,
          detail: 'revision feeds this variable from a different secret',
        };
      }
      if (ref.key == null || ref.key === '') {
        return { version: null, observed: null, detail: 'revision names no version for this variable' };
      }
      const observed = String(ref.key);
      // AN ALIAS ON THE REVISION IS STILL AN ALIAS. Resolution happens at
      // instance startup, so there is no number here to report.
      if (!isNumericVersion(observed)) {
        return {
          version: null,
          observed,
          detail: `the revision carries the alias ${observed}, which resolves at instance startup`,
        };
      }
      return { version: observed, observed, detail: '' };
    }
  }
  return { version: null, observed: null, detail: 'revision carries no reference to this secret' };
}

const rows = [];
/*
  ONE FUNCTION'S BAD METADATA MUST NOT SUPPRESS THE OTHER'S ROW.

  Every shape this reads is validated below, so the catch should be
  unreachable — which is precisely why it is here. It costs nothing, and the
  failure it guards against is the worst kind: an uncaught throw part-way
  through the loop ends the process, so the run log shows neither function
  rather than one answer and one `unknown`. A reporter that vanishes tells an
  operator less than one that admits what it could not read.

  The loop body is the `try` statement itself, which keeps `continue` working
  as it reads — it continues this loop.
*/
for (const fn of functions) try {
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
    const absent = readsAsAbsent(r.stderr);
    rows.push({
      fn,
      state: absent ? 'absent' : 'unknown',
      detail: absent ? 'no such function in this project/region' : 'describe refused',
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

  /*
    A SUCCESSFUL EXIT CARRYING `{}` IDENTIFIES NO FUNCTION.

    Absence of a binding may only be asserted from a response that identified
    the thing asked about. Partial or malformed metadata is UNKNOWN. A
    serviceConfig that is present and simply carries no secret references is a
    legitimate empty binding and still falls through to `unbound` below.
  */
  if (
    !isPlainObject(d) ||
    typeof d.name !== 'string' ||
    d.name === '' ||
    !isPlainObject(d.serviceConfig)
  ) {
    rows.push({ fn, state: 'unknown', detail: 'describe response was incomplete' });
    continue;
  }

  const fnState = d.state ?? 'unknown';
  const revision = d.serviceConfig.revision ?? null;
  const describedProject = projectOfResourceName(d.name);

  /*
    AN OMITTED LIST IS NOT A MALFORMED ONE, AND THE DIFFERENCE IS THE WHOLE
    POINT.

    A projected describe omits a field that has no value, so an absent or empty
    `secretEnvironmentVariables` on an otherwise valid function is a genuine
    empty binding and must stay `unbound`. Anything else that is not an array —
    an object, a string — was silently coerced to `[]` and reported as that
    same `unbound`, which states a fact about the deploy on the strength of
    metadata nobody could read.
  */
  const rawRefs = d.serviceConfig.secretEnvironmentVariables;
  if (rawRefs !== undefined && rawRefs !== null && !Array.isArray(rawRefs)) {
    rows.push({
      fn,
      state: 'unknown',
      fnState,
      revision,
      detail: 'the secret reference collection was malformed',
    });
    continue;
  }
  const refs = Array.isArray(rawRefs) ? rawRefs : [];
  // A non-object entry would be filtered out silently below and could hide a
  // real reference behind it; unreadable is unknown, not absent.
  if (refs.some((v) => !isPlainObject(v))) {
    rows.push({
      fn,
      state: 'unknown',
      fnState,
      revision,
      detail: 'a secret reference entry was malformed',
    });
    continue;
  }

  /*
    BOTH HALVES, SEPARATELY. The variable is found by env var name; the secret
    it is fed from is then checked on its own terms. An OR across the two
    proves neither.
  */
  const named = refs.filter((v) => v?.key === envName);
  if (named.length === 0) {
    rows.push({ fn, state: 'unbound', fnState, revision, detail: 'no reference to this secret' });
    continue;
  }

  // Identity is evaluated per candidate, and the first entry that is fully
  // established wins. Absence is never an established match.
  let ref = null;
  let identityDetail = '';
  for (const v of named) {
    if (v?.secret == null || v.secret === '') {
      identityDetail = 'the reference names no secret resource';
      continue;
    }
    if (String(v.secret) !== secretName) {
      identityDetail = `this variable is fed from ${String(v.secret)}`;
      continue;
    }
    const identity = projectIdentity(v.projectId, describedProject);
    if (identity === 'absent') {
      identityDetail = 'the reference names no project';
      continue;
    }
    if (identity === 'unresolved') {
      identityDetail = 'the reference names a project that could not be matched (id vs number)';
      continue;
    }
    ref = v;
    break;
  }

  if (!ref) {
    /*
      A NAMED-BUT-UNCONFIRMED BINDING IS NOT A BINDING.

      `mismatch` when the secret is positively a different one; `unknown` when
      the metadata simply does not say. Neither is `bound_*`, and neither is
      `unbound` — the variable is there, so claiming the deploy never wired it
      would misdirect exactly as badly.
    */
    const wrongSecret = named.some(
      (v) => v?.secret != null && v.secret !== '' && String(v.secret) !== secretName
    );
    rows.push({
      fn,
      state: wrongSecret ? 'mismatch' : 'unknown',
      fnState,
      revision,
      detail: identityDetail || 'the reference could not be identified',
    });
    continue;
  }

  const declared = ref.version == null || ref.version === '' ? 'unset' : String(ref.version);
  /*
    `unset` IS MISSING METADATA, NOT AN OBSERVED ALIAS. Calling it bound_alias
    printed "(an alias, not a number)" about a reference that never named one.
  */
  const state = isNumericVersion(declared)
    ? 'bound_pinned'
    : declared === 'unset'
      ? 'unknown'
      : 'bound_alias';
  const served =
    state === 'unknown'
      ? { version: null, observed: null, detail: 'the reference names no version' }
      : revisionBinding(revision);

  rows.push({
    fn,
    state,
    fnState,
    revision,
    declared,
    secret: String(ref.secret),
    servedVersion: served.version,
    servedObserved: served.observed,
    servedDetail: served.detail,
    detail: state === 'unknown' ? 'the reference names no version' : '',
  });
} catch {
  // Deliberately not re-thrown and deliberately not detailed: the exception
  // text could carry metadata this script is careful never to print.
  rows.push({ fn, state: 'unknown', detail: 'the describe response could not be interpreted' });
}

console.log(`WSF MAIL BINDING — read-only, metadata only`);
console.log(`  project   ${project}`);
console.log(`  region    ${region}`);
console.log(`  secret    ${secretName}`);
console.log(`  variable  ${envName}`);
console.log('');
for (const row of rows) {
  console.log(`  ${row.fn}`);
  console.log(`    binding          ${row.state}${row.detail ? ` (${row.detail})` : ''}`);
  if (row.fnState) console.log(`    function state   ${row.fnState}`);
  if (row.revision) console.log(`    described rev    ${row.revision}`);
  // The secret the variable is ACTUALLY fed from, printed so the report is
  // self-evidencing rather than resting on the header above.
  if (row.secret) console.log(`    fed from secret  ${row.secret}`);
  if (row.declared) {
    console.log(
      `    declared version ${row.declared}${row.state === 'bound_alias' ? '  (an alias, not a number)' : ''}`
    );
    if (row.servedVersion) {
      console.log(`    revision version ${row.servedVersion}`);
    } else {
      console.log(
        `    revision version UNRESOLVED${
          row.servedObserved ? ` (the revision carries the alias ${row.servedObserved})` : ''
        }${row.servedDetail && !row.servedObserved ? ` (${row.servedDetail})` : ''}`
      );
    }
    console.log(`    serving traffic  unverified (traffic split is not read)`);
  }
  console.log('');
}

// Machine-readable, one line per function, for a later step or a log tail.
for (const row of rows) {
  const key = row.fn.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  console.log(`WSF_MAIL_BINDING_${key}=${row.state}`);
  console.log(`WSF_MAIL_BINDING_${key}_DECLARED=${row.declared ?? 'none'}`);
  console.log(`WSF_MAIL_BINDING_${key}_SECRET=${row.secret ?? 'none'}`);
  console.log(`WSF_MAIL_BINDING_${key}_SERVED=${row.servedVersion ?? 'unresolved'}`);
  console.log(`WSF_MAIL_BINDING_${key}_REVISION=${row.revision ?? 'unknown'}`);
  /*
    TRAFFIC IS NOT READ, AND THE MACHINE OUTPUT SAYS SO. Without this a later
    step reading `_SERVED` would treat one revision as the whole service —
    which is the claim this script is careful never to make in prose.
  */
  console.log(`WSF_MAIL_BINDING_${key}_TRAFFIC=unverified`);
}

console.log('');
console.log('  A version here is what the function REFERENCES and what the DESCRIBED');
console.log('  REVISION CONFIGURES. Traffic split is not read, so this says nothing');
console.log('  about every serving instance, and an alias resolves at instance');
console.log('  startup rather than here. It is not proof the key works either: that');
console.log('  is only knowable from the provider, and a delivered message is the');
console.log('  only evidence of it. The facts are reported separately on purpose.');

// A REPORT NEVER FAILS THE RUN. One that exits nonzero becomes a thing people
// route around rather than read — the same rule the preflight states.
process.exit(0);
