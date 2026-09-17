#!/usr/bin/env node
/**
 * Confirm a downloaded artifact belongs to the approved commit.
 *
 * The stamp is a plain, non-hidden file. An earlier version used
 * `.wsf-build-sha`, which actions/upload-artifact excludes by default: a
 * correct build would have arrived without its stamp and failed this check for
 * the wrong reason. The alternative — turning on hidden-file upload — would
 * widen what travels between jobs to fix a naming problem.
 *
 * Missing, mismatched and malformed are all rejected. A stamp that cannot be
 * read is not a stamp that passed.
 */
import fs from 'node:fs';

const [, , approved, ...paths] = process.argv;
if (!/^[0-9a-f]{40}$/.test(approved || '')) {
  console.error('::error::check-build-stamp requires a 40-character approved SHA');
  process.exit(1);
}
if (!paths.length) {
  console.error('::error::check-build-stamp requires at least one stamp path');
  process.exit(1);
}

let bad = 0;
for (const p of paths) {
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    console.error(`::error::artifact stamp ${p} is missing — the build artifact cannot be attributed to a commit`);
    bad += 1;
    continue;
  }
  const value = raw.trim();
  if (!/^[0-9a-f]{40}$/.test(value)) {
    // Do not echo arbitrary file content back into the log.
    console.error(`::error::artifact stamp ${p} is malformed (not a 40-character commit SHA)`);
    bad += 1;
    continue;
  }
  if (value !== approved) {
    console.error(`::error::artifact stamp ${p} is ${value}, expected the approved candidate ${approved}`);
    bad += 1;
    continue;
  }
  console.log(`STAMP_OK=${p}`);
}
if (bad) {
  console.error(`BUILD_STAMP=rejected (${bad})`);
  process.exit(1);
}
console.log(`BUILD_STAMP=verified for ${approved}`);
