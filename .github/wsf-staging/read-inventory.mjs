#!/usr/bin/env node
/**
 * Read the pre-deploy function inventory, failing CLOSED.
 *
 * The previous shape was `firebase functions:list ... > raw.json || true`
 * followed by `raw.result || []`. Both halves fail open. The `|| true` discards
 * a nonzero exit, and `|| []` turns an error document — an auth failure, a
 * quota message, anything with no `result` key — into an empty baseline. A
 * deploy then "verifies" against nothing, and a run that silently dropped every
 * existing function looks identical to a first deploy into a new project.
 *
 * Five conditions, all required:
 *   1. the CLI exited 0 (passed in as an argument; the workflow no longer
 *      swallows it)
 *   2. the output parses as JSON
 *   3. a `result` property exists — its ABSENCE is an error, not an empty list
 *   4. `result` is an array
 *   5. the baseline is plausible for this deployment
 *
 * On (5): the expectation lives in approved-candidate.json as
 * `expectedPriorFunctions`, so it is reviewed per candidate rather than frozen
 * into this script. One historic count must not become a permanent rule — the
 * next package will have a different prior inventory. When the field is absent
 * the baseline must still be non-empty, because deploying Package E into a
 * project with no WSF functions is not a scenario this pipeline supports.
 */
import fs from 'node:fs';

const [, , cliExitCode, rawPath, outPath, approvalPath] = process.argv;

function fail(message) {
  console.error(`::error::${message}`);
  console.error('PREFLIGHT_BEFORE=error');
  process.exit(1);
}

// 1. the CLI's own exit status
if (String(cliExitCode) !== '0') {
  fail(`the pre-deploy inventory command exited ${cliExitCode}; refusing to deploy without a baseline`);
}

let raw;
try {
  raw = fs.readFileSync(rawPath, 'utf8');
} catch {
  fail('the pre-deploy inventory output could not be read');
}

// 2. parses as JSON
let doc;
try {
  doc = JSON.parse(raw);
} catch {
  fail('the pre-deploy inventory output is not valid JSON');
}
if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
  fail('the pre-deploy inventory output is not a JSON object');
}

// 3. `result` must EXIST. An error document carries `error` and no `result`.
if (!Object.prototype.hasOwnProperty.call(doc, 'result')) {
  const status = doc?.error?.status || doc?.status || 'unknown';
  fail(`the pre-deploy inventory returned no result property (status: ${status})`);
}

// 4. and be an array
if (!Array.isArray(doc.result)) {
  fail('the pre-deploy inventory result is not an array');
}

const names = doc.result
  .map((f) => String(f?.id ?? '').toLowerCase())
  .filter((n) => n.startsWith('wsf'))
  .sort();

// 5. plausibility, from the reviewed approval file
let expected = null;
if (approvalPath) {
  try {
    const approval = JSON.parse(fs.readFileSync(approvalPath, 'utf8'));
    const v = approval?.expectedPriorFunctions;
    if (v !== undefined && v !== null) {
      if (!Number.isInteger(v) || v < 0) fail('expectedPriorFunctions in the approval file is not a non-negative integer');
      expected = v;
    }
  } catch {
    fail('the approval file could not be read while checking the expected baseline');
  }
}

if (expected !== null) {
  if (names.length !== expected) {
    fail(
      `the staging baseline has ${names.length} WSF functions but this candidate was approved against ${expected}. ` +
        `Staging has changed since review — re-check before deploying, and update expectedPriorFunctions if the new baseline is correct.`
    );
  }
} else if (names.length === 0) {
  fail('the staging baseline is empty; Package E deploys into an existing WSF project, so an empty baseline is an error rather than a new project');
}

fs.writeFileSync(outPath, JSON.stringify({ functions: names }) + '\n', { mode: 0o600 });
console.log(`PREFLIGHT_BEFORE=${names.length}`);
if (expected !== null) console.log(`PREFLIGHT_BASELINE_MATCHES_APPROVAL=true`);
