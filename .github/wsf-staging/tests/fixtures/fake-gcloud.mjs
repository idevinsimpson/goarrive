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
 */
import { appendFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const scenario = process.env.WSF_FAKE_GCLOUD_SCENARIO ?? 'pinned';
if (process.env.WSF_FAKE_GCLOUD_CALLS) {
  appendFileSync(process.env.WSF_FAKE_GCLOUD_CALLS, `${argv.join(' ')}\n`);
}

const REVISION = 'wsfsendverificationemail-00007-abc';

function fn(version, revision = REVISION) {
  return JSON.stringify({
    name: `projects/westayfit-staging/locations/us-central1/functions/${argv[2]}`,
    state: 'ACTIVE',
    serviceConfig: {
      revision,
      secretEnvironmentVariables: [
        { key: 'WSF_EMAIL_API_KEY', projectId: 'westayfit-staging', secret: 'WSF_EMAIL_API_KEY', version },
      ],
    },
  });
}

const revisionJson = (key) =>
  JSON.stringify({
    spec: { containers: [{ env: [{ name: 'WSF_EMAIL_API_KEY', valueFrom: { secretKeyRef: { key } } }] }] },
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
  if (scenario === 'nosecret') {
    process.stdout.write(
      JSON.stringify({ name: 'x', state: 'ACTIVE', serviceConfig: { revision: REVISION, secretEnvironmentVariables: [] } })
    );
    process.exit(0);
  }
  process.stdout.write(fn(scenario.startsWith('alias') ? 'latest' : '2'));
  process.exit(0);
}

if (isRevisionDescribe) {
  if (scenario === 'alias-revision-unreadable') {
    process.stderr.write('PERMISSION_DENIED: caller lacks run.revisions.get\n');
    process.exit(1);
  }
  process.stdout.write(revisionJson('2'));
  process.exit(0);
}

process.stderr.write(`fake-gcloud: unexpected call ${argv.join(' ')}\n`);
process.exit(2);
