#!/usr/bin/env node
/** Local regression suite for the staging automation. Runs from the repo root. */
import { spawnSync } from 'node:child_process';
const suites = [
  'resolve-candidate.test.mjs',
  'check-build-stamp.test.mjs',
  'read-inventory.test.mjs',
  'workflow-contract.test.mjs',
  'scan-evidence.test.mjs',
  'cleanup-synthetic.test.mjs',
  'hosted-smoke-contract.test.mjs',
  'write-sdk-config.test.mjs',
  'verify-deployment.test.mjs',
];
let failed = 0;
for (const s of suites) {
  console.log(`\n=== ${s} ===`);
  const r = spawnSync(process.execPath, [`.github/wsf-staging/tests/${s}`], { stdio: 'inherit' });
  if (r.status !== 0) failed += 1;
}
console.log(failed ? `\n${failed} suite(s) FAILED` : '\nall suites passed');
process.exit(failed ? 1 : 0);
