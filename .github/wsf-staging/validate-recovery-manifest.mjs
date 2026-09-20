#!/usr/bin/env node
/**
 * Gate on a cleanup manifest recovered from ANOTHER workflow run's artifact,
 * before a privileged job points the cleaner at it.
 *
 * WHY THIS EXISTS. The recovery job downloads `wsf-player-evidence` from a
 * run id an operator types in. That artifact is ordinary run output, so the
 * manifest inside it is INPUT, not a trusted fact: the job must not delete
 * whatever a file it just fetched happens to name. `cleanup-synthetic.mjs`
 * already validates every identifier's provenance and refuses the whole
 * manifest on one bad one — this adds the checks that belong to the recovery
 * path specifically, and fails loudly BEFORE a credential is used:
 *
 *   - the manifest is where the artifact is supposed to put it;
 *   - it names the staging project exactly, never another project;
 *   - its run tag is one this repository's harnesses own (run-tag.mjs);
 *   - users/docs/linkedDocs are the shapes the cleaner expects, so a
 *     malformed field cannot reach the deletion loop as something else;
 *   - no document path is absolute or traversing.
 *
 * It prints the scope it accepted. An operator authorising a deletion should
 * be able to read how much is about to be deleted from the log, before it is.
 */
import fs from 'node:fs';
import { isOwnedRunTag, OWNED_RUN_TAG_PREFIXES } from './run-tag.mjs';

const EXPECTED_PROJECT = 'westayfit-staging';
const target = process.argv[2];

function refuse(reason) {
  console.log('RECOVERY_MANIFEST=refused');
  console.error(`::error::recovery manifest refused: ${reason}`);
  process.exit(1);
}

if (!target) refuse('no manifest path was given');
if (!fs.existsSync(target)) {
  refuse(`no manifest at ${target} — the artifact did not carry one, so the scope of what that run created is unknown`);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(target, 'utf8'));
} catch (e) {
  refuse(`manifest is not readable JSON: ${e.message}`);
}
if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
  refuse('manifest is not a JSON object');
}

if (manifest.project !== EXPECTED_PROJECT) {
  refuse(`manifest names project ${JSON.stringify(manifest.project)}; this job only ever acts on ${EXPECTED_PROJECT}`);
}

const runTag = manifest.runTag;
if (!isOwnedRunTag(runTag)) {
  refuse(
    `run tag ${JSON.stringify(runTag)} is not one this repository's harnesses mint ` +
    `(${Object.keys(OWNED_RUN_TAG_PREFIXES).join(', ')})`
  );
}

const stringList = (value, field) => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) refuse(`${field} is present but not an array`);
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.length) refuse(`${field} contains a non-string or empty entry`);
  }
  return value;
};

const docs = stringList(manifest.docs, 'docs');
const users = stringList(manifest.users, 'users');

for (const docPath of docs) {
  if (docPath.startsWith('/')) refuse(`document path ${docPath} is absolute`);
  if (docPath.split('/').includes('..')) refuse(`document path ${docPath} traverses upward`);
  if (docPath.split('/').some((segment) => segment === '')) refuse(`document path ${docPath} has an empty segment`);
  // Deliberately NOT an even-segment check. An odd-segment path names a
  // collection, and DELETE on one 404s rather than removing anything, so
  // refusing it would buy no safety while risking a false refusal that blocks
  // a recovery — the exact situation this path exists to unblock.
}

const linked = manifest.linkedDocs === undefined ? [] : manifest.linkedDocs;
if (!Array.isArray(linked)) refuse('linkedDocs is present but not an array');
for (const entry of linked) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) refuse('linkedDocs contains a non-object entry');
  if (typeof entry.path !== 'string' || !entry.path.length) refuse('a linkedDocs entry has no path');
  if (typeof entry.via !== 'string' || !entry.via.length) refuse('a linkedDocs entry has no via');
  if (entry.path.startsWith('/') || entry.path.split('/').includes('..')) {
    refuse(`linked document path ${entry.path} is absolute or traverses upward`);
  }
}

// The scope, printed before anything is deleted.
console.log(`RECOVERY_MANIFEST=accepted`);
console.log(`RECOVERY_MANIFEST_PROJECT=${manifest.project}`);
console.log(`RECOVERY_MANIFEST_RUN_TAG=${runTag}`);
console.log(`RECOVERY_MANIFEST_USERS=${users.length}`);
console.log(`RECOVERY_MANIFEST_DOCUMENTS=${docs.length}`);
console.log(`RECOVERY_MANIFEST_LINKED_DOCUMENTS=${linked.length}`);
