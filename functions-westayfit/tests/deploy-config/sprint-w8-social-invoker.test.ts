/**
 * THE SOCIAL CALLABLES MUST NEVER BE REACHABLE SIGNED OUT.
 *
 * WHY THIS NEEDS ITS OWN TEST, AND WHY THE CALLABLE SUITE CANNOT COVER IT.
 * `invoker: 'public'` is enforced by Cloud Run IAM at DEPLOY time and is a
 * NO-OP IN THE EMULATOR. A social callable that accidentally carried that
 * marker would pass every emulator test in this repository — including the
 * twenty-one privacy assertions in `sprint-w8-social-visibility.test.ts`,
 * because those all call `.run()` directly and never traverse IAM — and the
 * mistake would first take effect in front of real people.
 *
 * So this pins the declaration in the SOURCE — see the note on
 * `sourceWithoutComments` for why the deployment metadata cannot answer it. It
 * invokes no handler and needs no emulator.
 *
 * These three callables return one member's name, one member's movement, or
 * change one member's privacy. There is no version of this product in which a
 * signed-out stranger may reach any of them.
 */

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import * as wsf from '../../src/index';

/**
 * THE INVOKER IS NOT IN THE DEPLOYMENT METADATA, so this reads the SOURCE.
 *
 * Measured, not assumed: `__endpoint.callableTrigger` is `{}` for
 * `wsfGoalRecentAdditions` — which IS declared `invoker: 'public'` — exactly as
 * it is for a private callable. The firebase-functions SDK does not surface the
 * invoker there at all, so an endpoint-based check would report every callable
 * as private and pass forever while proving nothing. The first version of this
 * file did precisely that, and the positive control below is what caught it.
 *
 * COMMENTS ARE STRIPPED FIRST. Several of these handlers carry a comment saying
 * they must never be public, and a naive substring search reads that sentence
 * as evidence of the thing it forbids.
 */
function sourceWithoutComments(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const src = fs.readFileSync(path.resolve(__dirname, '../../src/index.ts'), 'utf8');
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** The options object a callable is declared with, as written. */
function declaredOptions(name: string): string {
  const src = sourceWithoutComments();
  const re = new RegExp(
    `export const ${name} = onCall(?:<[^>]*>)?\\(\\s*(\\{[^}]*\\})`,
    'm'
  );
  const m = re.exec(src);
  if (m === null) throw new Error(`${name}: could not find its onCall declaration`);
  return m[1]!;
}

function isPublic(name: string): boolean {
  return /invoker\s*:\s*['"]public['"]/.test(declaredOptions(name));
}

type Endpoint = { callableTrigger?: unknown; region?: unknown };

function endpointOf(name: string): Endpoint {
  const fn = (wsf as unknown as Record<string, { __endpoint?: Endpoint }>)[name];
  if (!fn?.__endpoint) {
    throw new Error(`${name} is not an exported function with deployment metadata`);
  }
  return fn.__endpoint;
}

/** Every callable this lane added or changed. */
const SOCIAL_CALLABLES = [
  'wsfCommunityMembers',
  'wsfCommunityActivity',
  'wsfSetCommunityVisibility',
] as const;

describe('W8 social callables — deployment invoker', () => {
  test.each(SOCIAL_CALLABLES)('%s is not reachable by a signed-out caller', (name) => {
    expect(isPublic(name)).toBe(false);
  });

  test.each(SOCIAL_CALLABLES)('%s is exported and is a callable', (name) => {
    expect(endpointOf(name).callableTrigger).toBeDefined();
  });

  /*
    THE POSITIVE CONTROL. Without it, every assertion above would also pass
    against an `invokerOf` that returned [] for everything — including a
    genuinely public function — and the suite would be reporting a guarantee it
    was not measuring. wsfGoalRecentAdditions is deliberately public: it is the
    anonymous aggregate the kiosk and public displays read.
  */
  test('the positive control: a deliberately public callable still reads as public', () => {
    expect(isPublic('wsfGoalRecentAdditions')).toBe(true);
  });

  test('the comment-stripping control: a forbidding comment is not read as a grant', () => {
    // wsfCommunityMembers carries a comment that contains the words
    // `invoker: 'public'` while forbidding it. Stripping must remove it.
    const opts = declaredOptions('wsfCommunityMembers');
    expect(opts).toContain('us-central1');
    expect(opts).not.toContain('public');
  });

  /*
    AND THE PUBLIC ONE MUST STAY ANONYMOUS. This lane's whole boundary is that
    "community-visible" does not mean internet-public, so the payload the
    unauthenticated world can reach is pinned as untouched here too: the
    response type is { additions: [{ amount, unit, at }] } and this test exists
    so that widening it becomes a deliberate act with a red suite attached.
  */
  test('wsfGoalRecentAdditions is still the anonymous aggregate, by source', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../src/index.ts'),
      'utf8'
    );
    const start = src.indexOf('export const wsfGoalRecentAdditions');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('export const', start + 10));
    // The published row is rebuilt from exactly these two stored fields plus
    // the goal's unit. A displayName or userId appearing in this handler would
    // be the boundary breaking.
    expect(body).toContain('additions.push({ amount, unit, at });');
    expect(body).not.toContain('displayName');
    expect(body).not.toContain('userId');
  });
});
