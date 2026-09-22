#!/usr/bin/env node
/**
 * Fails if a run modified any ACCEPTED evidence.
 *
 * Accepted evidence is a committed BEFORE, TARGET or AFTER frame that a review
 * has already decided on. It is the record of what was approved, so a routine
 * verification pass must leave every byte of it alone.
 *
 * This exists because it kept not being true:
 *
 *   The BEFORE capture specs ran in the ordinary suite, so every verification
 *   run re-shot them against the NEW code. At one point a Page 2 "BEFORE" was
 *   the new full-navy receipt, byte-identical to the AFTER beside it — the
 *   comparison the gate exists for had quietly destroyed itself. The first
 *   version of this script caught four more corrupted Batch A frames that a
 *   careful manual review had missed.
 *
 *   Later the same thing turned up one level up: a routine run came back with
 *   seven of Page 2's ACCEPTED AFTER frames and a Page 1 target matrix dirty.
 *   Nothing had been reviewed again; the run had simply rewritten them.
 *
 * Producers are gated now (WSF_CAPTURE_BEFORE, WSF_CAPTURE_FRAMES). This is
 * the belt to those braces: run it after any verification pass and it proves,
 * byte for byte, that the evidence is the evidence.
 *
 *   node scripts/westayfit/check-evidence-intact.mjs
 *   node scripts/westayfit/check-evidence-intact.mjs --before-only
 */
import { execFileSync } from 'node:child_process';

/**
 * Frozen BEFOREs. A whole `before/` directory where they live in one, and a
 * BEFORE-only pathspec where they sit beside TARGET and AFTER frames.
 */
const FROZEN_BEFORE = [
  'docs/design-target/review/page-01-home/BEFORE-*.png',
  'docs/design-target/review/page-02-move/before',
  'docs/design-target/review/batch-a-identity/before',
  'docs/design-target/review/page-03-community/before',
  'docs/design-target/review/page-03-community/context-home-route',
  'docs/design-target/review/page-04-progress/before',
  'docs/design-target/review/page-05-you/before',
  // Captured against the untouched /join route before Batch B implementation.
  // The package had NO before/ at all; once the route is built to the
  // target this screen stops existing and no later run can recover it.
  'docs/design-target/review/batch-b-join-and-setup/before',
];

/**
 * Accepted TARGET and AFTER frames, and the committed shell/baseline sheets.
 *
 * These are not frozen in the sense a BEFORE is — a target is revised when a
 * review asks and an AFTER is re-shot when the code it photographs changes.
 * They are frozen against ROUTINE RUNS, which is a different claim: nothing
 * here may move because a test happened to execute.
 */
const ACCEPTED_FRAMES = [
  'docs/design-target/review/page-01-home/TARGET-*.png',
  'docs/design-target/review/page-01-home/AFTER-*.png',
  'docs/design-target/review/page-02-move/TARGET-*.png',
  'docs/design-target/review/page-02-move/after',
  'docs/design-target/review/page-03-community/TARGET-*.png',
  'docs/design-target/review/page-03-community/PROPOSAL-*.png',
  'docs/design-target/review/page-03-community/after',
  'docs/design-target/review/page-04-progress/TARGET-*.png',
  'docs/design-target/review/page-04-progress/after',
  'docs/design-target/review/page-05-you/TARGET-*.png',
  // Submitted for Before -> After acceptance. Frozen from now so a routine
  // run cannot change what is being reviewed; a deliberate re-baseline is
  // recorded in its commit, the way this guard asks.
  'docs/design-target/review/page-05-you/after',
  // Batch A identity, submitted for visual/functional review. Frozen from
  // this commit so a routine run cannot change what is under review.
  'docs/design-target/review/batch-a-identity/after',
  'docs/design-target/review/batch-a-identity/TARGET-*.png',
  'docs/design-target/targets',
  'docs/westayfit/app-shell-2026-09-19',
  'docs/westayfit/visual-baseline-2026-09-19',
];

function changed(paths) {
  // `diff HEAD` covers staged and unstaged alike; ls-files --others catches a
  // frame that was ADDED rather than edited, which a diff would not show.
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

const beforeOnly = process.argv.includes('--before-only');
const groups = beforeOnly
  ? [['frozen BEFORE', FROZEN_BEFORE]]
  : [
      ['frozen BEFORE', FROZEN_BEFORE],
      ['accepted TARGET / AFTER', ACCEPTED_FRAMES],
    ];

let bad = false;
for (const [label, paths] of groups) {
  const dirty = changed(paths);
  if (dirty.length === 0) {
    console.log(`${label}: intact — ${paths.length} paths, no byte changed`);
    continue;
  }
  bad = true;
  console.error(`\n${label.toUpperCase()} WAS MODIFIED:\n`);
  for (const f of dirty) console.error(`  ${f}`);
}

if (!bad) process.exit(0);

console.error(
  '\nA verification run must never rewrite accepted evidence. If you meant to\n' +
    're-baseline, do it deliberately — WSF_CAPTURE_BEFORE=1 for a BEFORE,\n' +
    'WSF_CAPTURE_FRAMES=1 for a TARGET or AFTER — and say so in the commit.\n',
);
process.exit(1);
