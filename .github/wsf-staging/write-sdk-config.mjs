#!/usr/bin/env node
/**
 * Write the Web SDK config file the hosted smoke reads.
 *
 * hosted-package-e-smoke.mjs takes its project id and Web API key from a JSON
 * file named by WSF_SDK_CONFIG_FILE. The workflow's config job already resolves
 * both values (prepare-staging.mjs) into the staging env artifact, so this
 * script only re-shapes what that artifact carries: nothing is fetched, no new
 * credential exists, and the two values are the same publishable Web SDK
 * identifiers the candidate build embeds.
 *
 * The first hosted run failed because the workflow exported the key under a
 * different name and never wrote this file. The regression suite now checks
 * the wiring statically, and this script refuses the two mistakes that would
 * quietly widen exposure: writing inside the repository checkout or the
 * evidence directory (both can end up in an artifact), and echoing the key.
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , outPath, expectedProject] = process.argv;
if (!outPath || !expectedProject) {
  console.error('usage: write-sdk-config.mjs <out.json> <expected-project-id>');
  process.exit(1);
}

const projectId = process.env.EXPO_PUBLIC_WSF_STAGING_PROJECT_ID;
const apiKey = process.env.EXPO_PUBLIC_WSF_STAGING_API_KEY;
if (!projectId || !apiKey) {
  console.error('::error::the staging env artifact did not supply EXPO_PUBLIC_WSF_STAGING_PROJECT_ID and EXPO_PUBLIC_WSF_STAGING_API_KEY');
  process.exit(1);
}
if (projectId !== expectedProject) {
  console.error(`::error::staging env names project ${projectId}, expected ${expectedProject}`);
  process.exit(1);
}

const resolved = path.resolve(outPath);
const inside = (dir) => {
  if (!dir) return false;
  const rel = path.relative(path.resolve(dir), resolved);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};
if (inside(process.env.GITHUB_WORKSPACE) || inside(process.env.WSF_RESULT_DIR)) {
  console.error('::error::the SDK config file must be written outside the repository checkout and the evidence directory');
  process.exit(1);
}

process.umask(0o077);
fs.mkdirSync(path.dirname(resolved), { recursive: true, mode: 0o700 });
fs.writeFileSync(resolved, JSON.stringify({ projectId, apiKey }) + '\n', { mode: 0o600 });
console.log(`SDK_CONFIG_FILE=written for ${projectId}`);
