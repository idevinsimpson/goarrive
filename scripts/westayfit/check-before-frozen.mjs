#!/usr/bin/env node
/**
 * Fails if any frozen BEFORE frame has been modified in the working tree.
 *
 * A BEFORE is a photograph of the product as it was, and it is the thing an
 * AFTER is compared against. The BEFORE capture spec used to run in the
 * ordinary suite, so every verification run of the IMPLEMENTED code re-shot
 * the BEFORE frames against the new code and overwrote them -- at one point
 * the "BEFORE" receipt was the new full-navy one, visually identical to the
 * AFTER beside it, and the comparison the gate exists for had destroyed
 * itself without anyone noticing.
 *
 * The specs are opt-in now (WSF_CAPTURE_BEFORE). This is the belt to that
 * braces: run it after any verification pass and it proves, byte for byte,
 * that nothing touched the evidence.
 *
 *   node scripts/westayfit/check-before-frozen.mjs
 */
import { execFileSync } from 'node:child_process';

/**
 * Every frozen-evidence path. A whole `before/` directory where the BEFOREs
 * live in one, and a BEFORE-only pathspec where they sit beside TARGET and
 * AFTER frames that are *supposed* to change -- naming the directory there
 * would make this fail on every legitimate AFTER refresh, and a guard that
 * cries wolf is a guard that gets ignored.
 */
const FROZEN = [
  'docs/design-target/review/page-01-home/BEFORE-*.png',
  'docs/design-target/review/page-02-move/before',
  'docs/design-target/review/batch-a-identity/before',
  'docs/design-target/review/page-03-community/before',
];

function changed(paths) {
  // --  separates pathspecs; `diff HEAD` covers staged and unstaged alike, and
  // ls-files --others catches a frame that was added rather than edited.
  const tracked = execFileSync('git', ['diff', '--name-only', 'HEAD', '--', ...paths], {
    encoding: 'utf8',
  });
  const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', ...paths],
    { encoding: 'utf8' },
  );
  return [...tracked.split('\n'), ...untracked.split('\n')].map((l) => l.trim()).filter(Boolean);
}

const dirty = changed(FROZEN);
if (dirty.length === 0) {
  console.log(`frozen evidence intact — ${FROZEN.length} directories, no byte changed`);
  process.exit(0);
}

console.error('FROZEN EVIDENCE WAS MODIFIED:\n');
for (const f of dirty) console.error(`  ${f}`);
console.error(
  '\nA verification run must never rewrite a BEFORE. If you meant to re-baseline,\n' +
    'do it deliberately with WSF_CAPTURE_BEFORE=1 and say so in the commit.\n',
);
process.exit(1);
