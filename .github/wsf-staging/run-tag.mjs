/**
 * The run tags this repository's staging cleaner owns.
 *
 * WHY THIS IS A SHARED MODULE AND NOT A REGEX IN EACH FILE.
 * `hosted-player-journey.mjs` minted `e5j-…` tags from the day it was written.
 * `cleanup-synthetic.mjs` accepted `^e5h-` alone. Both were reviewed, both were
 * tested, and neither test compared them — so run 35495928362 created three
 * synthetic users and fifty-one documents on staging and then refused to
 * delete any of them: `MANIFEST_UNUSABLE: manifest identity check failed`.
 * Cleanup that cannot recognise its own harness is not a safety property, it
 * is a leak with a receipt.
 *
 * So the predicate lives in ONE place, every harness's prefix is declared
 * here beside the harness that mints it, and a contract test asserts each
 * harness's actual generated tag satisfies it.
 *
 * ADDING A HARNESS is a deliberate edit here, never a loosened pattern
 * elsewhere. The predicate must stay an explicit list: one broad enough to
 * admit any future prefix would also admit a manifest this cleaner never
 * wrote, and every identifier in it would then be validated against a run tag
 * nobody owns.
 */

/** prefix -> the harness that mints it. Order is not significant. */
export const OWNED_RUN_TAG_PREFIXES = Object.freeze({
  'e5h-': 'hosted-package-e-smoke.mjs (the 24-row hosted authorization suite)',
  'e5j-': 'hosted-player-journey.mjs (the browser/player journey)',
});

/**
 * The accepted shape: one of the owned prefixes, then at least one character
 * of the run-unique part, and nothing else. Anchored at both ends, so a
 * lookalike that merely CONTAINS an owned prefix (`xe5h-…`) or merely starts
 * with the letters (`e5hj-…`, `e5jgrp-…`) is refused.
 */
export const OWNED_RUN_TAG = new RegExp(
  `^(?:${Object.keys(OWNED_RUN_TAG_PREFIXES)
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')})[A-Za-z0-9_-]+$`
);

export function isOwnedRunTag(tag) {
  return typeof tag === 'string' && OWNED_RUN_TAG.test(tag);
}
