#!/usr/bin/env node
/**
 * A gcloud that answers from a scenario instead of a cloud.
 *
 * It RECORDS EVERY ARGV IT RECEIVES to the file named by
 * WSF_FAKE_GCLOUD_CALLS, so the suite can assert on what was ASKED FOR — that
 * no secret payload was requested, and that every describe carried a field
 * projection. Asserting on the reporter's output alone could not catch a
 * script that read far more than it printed.
 *
 * The record goes to a FILE and not to stdout, because stdout is the channel
 * the reporter parses as JSON: the first version wrote it there and every
 * scenario came back "describe response was not JSON".
 *
 * THE REVISION FIXTURE MODELS REAL CLOUD RUN, which the first version did not.
 * It returned a numeric `secretKeyRef.key` for EVERY scenario including the
 * alias one, so the case that actually occurs — a `:latest` deploy leaving the
 * literal string `latest` on the revision — was never modelled and the suite
 * could not see the reporter resolve nothing while printing an answer. The
 * alias scenario now carries the alias, and a separate scenario covers a
 * revision that genuinely carries a number.
 */
import { appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const scenario = process.env.WSF_FAKE_GCLOUD_SCENARIO ?? 'pinned';
if (process.env.WSF_FAKE_GCLOUD_CALLS) {
  appendFileSync(process.env.WSF_FAKE_GCLOUD_CALLS, `${argv.join(' ')}\n`);
}

const REVISION = 'wsfsendverificationemail-00007-abc';
const PROJECT = 'westayfit-staging';

/**
 * A gen2 function describe. `key` is the ENVIRONMENT VARIABLE NAME and
 * `secret` is the secret RESOURCE — two different facts that the reporter must
 * check separately, so the fixture has to be able to disagree about them.
 */
function fn(secretEnv, revision = REVISION) {
  return JSON.stringify({
    name: `projects/${PROJECT}/locations/us-central1/functions/${argv[2]}`,
    state: 'ACTIVE',
    serviceConfig: {
      revision,
      secretEnvironmentVariables: secretEnv,
    },
  });
}

const goodEnv = (version) => [
  { key: 'WSF_EMAIL_API_KEY', projectId: PROJECT, secret: 'WSF_EMAIL_API_KEY', version },
];

/*
  THE REVISION'S OWN VIEW. On a Cloud Run secretKeyRef, `name` is the SECRET
  RESOURCE and `key` is the SECRET VERSION — the opposite sense of `key` from
  the function describe above. Both are modelled so identity can be asserted at
  both levels.
*/
const revisionJson = (key, name = 'WSF_EMAIL_API_KEY') =>
  JSON.stringify({
    spec: {
      containers: [
        { env: [{ name: 'WSF_EMAIL_API_KEY', valueFrom: { secretKeyRef: { name, key } } }] },
      ],
    },
  });

const isFunctionDescribe = argv[0] === 'functions' && argv[1] === 'describe';
const isRevisionDescribe = argv[0] === 'run' && argv[1] === 'revisions';

if (isFunctionDescribe) {
  if (scenario === 'denied') {
    process.stderr.write(
      'PERMISSION_DENIED: caller lacks cloudfunctions.functions.get; resource does not exist or caller lacks access\n'
    );
    process.exit(1);
  }
  if (scenario === 'missing') {
    process.stderr.write('NOT_FOUND: the function could not be found\n');
    process.exit(1);
  }
  // A LEGITIMATE EMPTY BINDING: the response identifies the function and simply
  // carries no secret references. This must stay `unbound`.
  if (scenario === 'nosecret') {
    process.stdout.write(fn([]));
    process.exit(0);
  }
  // MALFORMED: exit 0, valid JSON, and it identifies nothing at all.
  if (scenario === 'malformed') {
    process.stdout.write('{}');
    process.exit(0);
  }
  // THE RIGHT SECRET UNDER A DIFFERENT VARIABLE NAME. The variable asked about
  // is genuinely not here, so this is `unbound` — but an identity check that
  // matches on EITHER name would find the secret and call it a binding.
  if (scenario === 'other-variable') {
    process.stdout.write(
      fn([{ key: 'SOME_OTHER_VAR', projectId: PROJECT, secret: 'WSF_EMAIL_API_KEY', version: '2' }])
    );
    process.exit(0);
  }
  // A serviceConfig that looks complete, on a response that identifies no
  // function. The `name` half of the completeness guard is the only thing
  // between this and a confident answer.
  if (scenario === 'no-name') {
    process.stdout.write(
      JSON.stringify({
        state: 'ACTIVE',
        serviceConfig: { revision: REVISION, secretEnvironmentVariables: goodEnv('2') },
      })
    );
    process.exit(0);
  }
  // N1 — `name` PRESENT BUT EMPTY. Distinct from `no-name`: the key exists, so
  // a completeness guard written as a presence check rather than a value check
  // would pass it and attribute the reference to a function nothing identified.
  if (scenario === 'empty-name') {
    process.stdout.write(
      JSON.stringify({
        name: '',
        state: 'ACTIVE',
        serviceConfig: { revision: REVISION, secretEnvironmentVariables: goodEnv('2') },
      })
    );
    process.exit(0);
  }
  // N3 — A VERSION THAT CONTAINS A DIGIT BUT IS NOT A NUMBER. `v2` is an alias.
  // A looser numeric test than `^\d+$` — anything matching `\d`, or a parseInt
  // — reads it as version 2 and invents the fact under investigation.
  if (scenario === 'alias-digits') {
    process.stdout.write(
      fn([{ key: 'WSF_EMAIL_API_KEY', projectId: PROJECT, secret: 'WSF_EMAIL_API_KEY', version: 'v2' }])
    );
    process.exit(0);
  }
  // PARTIAL: a name but no serviceConfig — still not enough to assert absence.
  if (scenario === 'partial') {
    process.stdout.write(
      JSON.stringify({ name: `projects/${PROJECT}/locations/us-central1/functions/${argv[2]}`, state: 'ACTIVE' })
    );
    process.exit(0);
  }
  // THE ENV VAR IS RIGHT AND THE SECRET IS NOT. The substitution the OR match
  // reported as a verified binding.
  if (scenario === 'wrong-secret') {
    process.stdout.write(
      fn([{ key: 'WSF_EMAIL_API_KEY', projectId: PROJECT, secret: 'RESEND_API_KEY', version: '2' }])
    );
    process.exit(0);
  }
  if (scenario === 'wrong-project') {
    process.stdout.write(
      fn([
        { key: 'WSF_EMAIL_API_KEY', projectId: 'different-project', secret: 'WSF_EMAIL_API_KEY', version: '2' },
      ])
    );
    process.exit(0);
  }
  // PROJECT NUMBER RATHER THAN ID. The two may well name the same project, and
  // this script cannot establish that — so it must say so, not guess.
  if (scenario === 'project-number') {
    process.stdout.write(
      fn([
        { key: 'WSF_EMAIL_API_KEY', projectId: '123456789012', secret: 'WSF_EMAIL_API_KEY', version: '2' },
      ])
    );
    process.exit(0);
  }
  // IDENTITY METADATA SIMPLY ABSENT. Absence is never a match.
  if (scenario === 'no-secret-field') {
    process.stdout.write(fn([{ key: 'WSF_EMAIL_API_KEY', projectId: PROJECT, version: '2' }]));
    process.exit(0);
  }
  if (scenario === 'no-project-field') {
    process.stdout.write(fn([{ key: 'WSF_EMAIL_API_KEY', secret: 'WSF_EMAIL_API_KEY', version: '2' }]));
    process.exit(0);
  }
  if (scenario === 'no-version') {
    process.stdout.write(
      fn([{ key: 'WSF_EMAIL_API_KEY', projectId: PROJECT, secret: 'WSF_EMAIL_API_KEY' }])
    );
    process.exit(0);
  }
  process.stdout.write(fn(goodEnv(scenario.startsWith('alias') ? 'latest' : '2')));
  process.exit(0);
}

if (isRevisionDescribe) {
  if (scenario === 'alias-revision-unreadable') {
    process.stderr.write('PERMISSION_DENIED: caller lacks run.revisions.get\n');
    process.exit(1);
  }
  // The revision feeds the variable from a different secret than the one asked
  // about — the identity check at the revision level.
  if (scenario === 'revision-wrong-secret') {
    process.stdout.write(revisionJson('2', 'RESEND_API_KEY'));
    process.exit(0);
  }
  // THE REALISTIC ALIAS CASE: `--set-secrets=SECRET:latest` leaves the literal
  // string on the revision, which resolves at instance startup and not here.
  if (scenario === 'alias') {
    process.stdout.write(revisionJson('latest'));
    process.exit(0);
  }
  // N3 at the revision level too: a digit-containing alias is still an alias.
  if (scenario === 'alias-digits') {
    process.stdout.write(revisionJson('v2'));
    process.exit(0);
  }
  process.stdout.write(revisionJson('2'));
  process.exit(0);
}

process.stderr.write(`fake-gcloud: unexpected call ${argv.join(' ')}\n`);
process.exit(2);
