import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/**
 * THE SERVED DOCUMENT, not the rendered screen.
 *
 * `/community/<id>/members` has its own exported shell. The emulator config
 * was missing the rewrite that points at it, so a cold direct load fell
 * through to `/community/**` and the harness served the generic community
 * shell instead — while every members test stayed green, because Expo Router
 * recovers client-side from whichever shell it is handed and then renders
 * Members either way.
 *
 * So "Members appears on screen" cannot prove this fixed, and a test that
 * asserted it would have been green before the fix too. This asserts the HTTP
 * response body itself, with no browser and no client JavaScript involved:
 * the bytes the server returns must be the members artifact.
 *
 * Uses the `request` fixture rather than `page`, so nothing can run and
 * repair the answer after it arrives.
 */

const DIST = path.resolve(__dirname, '../dist');

const MEMBERS_DOC = path.join(DIST, 'community/__dynamic/members.html');
const COMMUNITY_DOC = path.join(DIST, 'community/__dynamic.html');
const CHALLENGE_DOC = path.join(DIST, 'community/__dynamic/challenge.html');

function builtDoc(file: string): string {
  if (!fs.existsSync(file)) {
    throw new Error(
      `${file} is not built. This spec reads the web artifact, so run ` +
        '`npm --prefix apps/westayfit run build:web` first.'
    );
  }
  return fs.readFileSync(file, 'utf8');
}

// A group id is never resolved by hosting — the rewrite matches on shape
// alone, and which document comes back is the whole question here.
const GROUP = 'wsfw4rewriteprobe';

test.describe('a cold load of the members route is served the members document', () => {
  /**
   * Guards the assertions below against passing for the wrong reason: if the
   * two shells were byte-identical, "served === members" would also be true
   * when the server handed back the community shell, and this spec would
   * prove nothing.
   */
  test('the two shells are actually different documents', () => {
    expect(builtDoc(MEMBERS_DOC)).not.toEqual(builtDoc(COMMUNITY_DOC));
  });

  test('the response body is the members artifact, byte for byte', async ({ request }) => {
    const res = await request.get(`/community/${GROUP}/members`);
    expect(res.status()).toBe(200);

    const served = await res.text();
    expect(served).toEqual(builtDoc(MEMBERS_DOC));
    // Named separately so a regression says which shell came back instead.
    expect(served).not.toEqual(builtDoc(COMMUNITY_DOC));
  });

  /**
   * The control. `/community/<id>/challenge` had its rewrite all along, so it
   * proves the mechanism works and that a members failure is the missing rule
   * rather than something broken about specific-child rewrites in general.
   */
  test('the challenge route, which never lost its rewrite, still resolves', async ({ request }) => {
    const res = await request.get(`/community/${GROUP}/challenge`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toEqual(builtDoc(CHALLENGE_DOC));
  });

  /**
   * The catch-all still catches. The new rule sits above `/community/**` and
   * must not have narrowed it.
   */
  test('the catch-all still serves the community shell for the group itself', async ({ request }) => {
    const res = await request.get(`/community/${GROUP}`);
    expect(res.status()).toBe(200);
    expect(await res.text()).toEqual(builtDoc(COMMUNITY_DOC));
  });
});
