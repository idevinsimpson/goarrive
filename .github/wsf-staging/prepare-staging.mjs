#!/usr/bin/env node
/**
 * Turn `firebase apps:sdkconfig WEB --json` into the build's staging env file.
 *
 * These six values are the registered Web App's publishable client identifiers
 * — the same class of value the repository already commits for production in
 * apps/westayfit/src/firebase.ts. They are retrieved from authenticated
 * metadata rather than copied by hand so they cannot drift, and nothing is
 * echoed: the file is written at mode 0600 and the values never reach the log.
 *
 * Every field is required and the project is checked. A partial config would
 * otherwise produce a build pointed at a half-configured backend.
 */
import fs from 'node:fs';

const [, , sourcePath, outPath, expectedProject] = process.argv;
if (!sourcePath || !outPath || !expectedProject) {
  console.error('usage: prepare-staging.mjs <sdkconfig.json> <out.env> <expected-project-id>');
  process.exit(1);
}

let doc;
try {
  doc = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
} catch {
  console.error('::error::the SDK config response was not readable JSON');
  process.exit(1);
}
const cfg = doc?.result?.sdkConfig || doc?.sdkConfig || doc?.result || doc;
const FIELDS = {
  EXPO_PUBLIC_WSF_STAGING_PROJECT_ID: 'projectId',
  EXPO_PUBLIC_WSF_STAGING_API_KEY: 'apiKey',
  EXPO_PUBLIC_WSF_STAGING_AUTH_DOMAIN: 'authDomain',
  EXPO_PUBLIC_WSF_STAGING_STORAGE_BUCKET: 'storageBucket',
  EXPO_PUBLIC_WSF_STAGING_SENDER_ID: 'messagingSenderId',
  EXPO_PUBLIC_WSF_STAGING_APP_ID: 'appId',
};

const missing = Object.values(FIELDS).filter((k) => !cfg?.[k]);
if (missing.length) {
  console.error(`::error::staging SDK config is missing required fields: ${missing.join(', ')}`);
  process.exit(1);
}
if (cfg.projectId !== expectedProject) {
  // Never let a production config become a "staging" build.
  console.error(`::error::SDK config names project ${cfg.projectId}, expected ${expectedProject}`);
  process.exit(1);
}

process.umask(0o077);
const body = Object.entries(FIELDS).map(([envName, key]) => `${envName}=${cfg[key]}`).join('\n') + '\n';
fs.writeFileSync(outPath, body, { mode: 0o600 });
console.log(`STAGING_SDK_CONFIG=resolved for ${cfg.projectId}`);
