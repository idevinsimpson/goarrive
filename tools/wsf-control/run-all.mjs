#!/usr/bin/env node
/** Local regression suite for the WSF control-state tooling. Runs from the repo root. */
import { spawnSync } from 'node:child_process';
const suites = [
  'ledger.test.mjs',
  'views.test.mjs',
  'skill.test.mjs',
  'closure.test.mjs',
  'review.test.mjs',
];
let failed = 0;
for (const s of suites) {
  console.log(`\n=== ${s} ===`);
  const r = spawnSync(process.execPath, [`tools/wsf-control/tests/${s}`], { stdio: 'inherit' });
  if (r.status !== 0) failed += 1;
}
console.log(failed ? `\n${failed} suite(s) FAILED` : '\nall suites passed');
process.exit(failed ? 1 : 0);
