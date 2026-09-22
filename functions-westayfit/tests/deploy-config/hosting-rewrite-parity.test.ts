/**
 * DEPLOYMENT CONFIGURATION, not runtime behaviour. No handler is invoked, no
 * emulator is needed — this reads the two hosting configs off disk and
 * compares them, which is why it lives under the deploy-config jest config
 * with the other hosting/deployment contracts.
 *
 * THE CONTRACT. `firebase.westayfit.emulators.json` says of itself:
 *
 *   "hosting mirrors firebase.westayfit.json exactly — including the
 *    /community/** rewrite, which is the thing GATE 1 has to prove. Keep the
 *    two in sync: if a rewrite or header changes there, change it here, or
 *    the harness stops testing what actually ships."
 *
 * That was prose, and prose does not fail a build. It drifted: the
 * `/community/<id>/members` rewrite was added to the deploy config and not to the
 * emulator config, so a cold direct load of `/community/<id>/members` fell
 * through to `/community/**` and the harness served the generic community
 * shell where production serves the members document.
 *
 * WHY NOTHING CAUGHT IT. Expo Router recovers client-side from whichever shell
 * it is handed, so the members e2e suite passed while the emulator served the
 * wrong document. A green board was the symptom, not the absence of the bug —
 * which is exactly why the contract needs a test rather than a comment.
 *
 * SCOPE. Rewrites only, in order. `ignore` legitimately differs (the emulator
 * config excludes itself from its own upload) and `headers` differs for
 * reasons that predate this test — see the note at the bottom of this file.
 */

import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(__dirname, '../../..');

type Rewrite = { source: string; destination: string };

function rewritesOf(configFile: string): Rewrite[] {
  const full = path.join(REPO, configFile);
  const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  const rewrites = parsed?.hosting?.rewrites;
  if (!Array.isArray(rewrites)) {
    throw new Error(`${configFile} has no hosting.rewrites array`);
  }
  return rewrites;
}

const DEPLOY = 'firebase.westayfit.json';
const EMULATOR = 'firebase.westayfit.emulators.json';

describe('the emulator harness serves the rewrites that actually ship', () => {
  const deploy = rewritesOf(DEPLOY);
  const emulator = rewritesOf(EMULATOR);

  /**
   * Deep equality INCLUDING ORDER. Firebase matches rewrites top-down and
   * takes the first hit, so `/community/**` placed above the more specific members rule
   * silently shadows it. Two configs holding the same rules in a different
   * order are two different routers, and a set comparison would call them
   * equal.
   */
  test('every rewrite matches the deploy config, in the same order', () => {
    expect(emulator).toEqual(deploy);
  });

  /**
   * The failure above reports a whole-array diff. This names the missing rule
   * directly, so a drift says which route stopped being tested rather than
   * leaving that to be read out of two twelve-element arrays.
   */
  test.each(rewritesOf(DEPLOY))(
    'the emulator carries the shipped rule $source -> $destination',
    (rule: Rewrite) => {
      expect(emulator).toContainEqual(rule);
    }
  );

  /**
   * The ordering rule stated independently of parity, so it still holds if
   * both files are ever changed together in the same wrong way: a rule for a
   * specific child of /community must precede the catch-all, in BOTH configs.
   */
  test.each([
    [DEPLOY, deploy],
    [EMULATOR, emulator],
  ])('%s puts specific /community rules before the catch-all', (_name, rules) => {
    const catchAll = rules.findIndex((r) => r.source === '/community/**');
    expect(catchAll).toBeGreaterThanOrEqual(0);

    const specific = rules
      .map((r, i) => ({ ...r, i }))
      .filter((r) => r.source.startsWith('/community/') && r.source !== '/community/**');

    expect(specific.length).toBeGreaterThan(0);
    for (const rule of specific) {
      expect({ source: rule.source, before: rule.i < catchAll }).toEqual({
        source: rule.source,
        before: true,
      });
    }
  });
});

/**
 * NOT ASSERTED HERE, AND DELIBERATELY SO. `hosting.headers` also differs
 * between the two files — the deploy config carries `/index.html` and
 * the `/_expo/static/js` bundle Content-Type rules the emulator config does not.
 * That divergence PREDATES the members-rewrite drift and is outside the
 * bounded fix this test accompanies, so it is reported rather than silently
 * swept in by widening the assertion. Extending this file to headers is a
 * one-line change once that divergence is judged.
 */
