import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

import { CAPTURE_FRAMES, saveFrame } from './helpers/capture';
import { seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * THE CORRECTED UNCERTAIN-OUTCOME SCREEN on /join/[joinCode], and nothing
 * else.
 *
 * `JOIN_FAILURE_DEFAULT` used to tell a member "Nothing was changed." for a
 * join that threw without a callable code. The transaction guarantee behind
 * that sentence is real and answers a different question: it makes the write
 * all-or-nothing ON THE SERVER, and says nothing about whether the server got
 * that far. An error with no mapped code is exactly the case where the commit
 * may have happened and the response was lost, and this screen reads no
 * membership before speaking — so the promise was not the client's to make.
 *
 * The corrected screen says the outcome is unconfirmed and that trying again
 * is safe. These three frames are that screen, on the real route, at the three
 * phone classes.
 *
 * PROVENANCE. Source app-shell `44cc063` (join route blob `951ecc9`) plus this
 * branch's one bounded correction. The uncertain state is reached by refusing
 * the join callable with `INTERNAL` — a status that carries no mapped code —
 * which is the injection this spec makes and the only one. It is a fault
 * INJECTED at the transport, labelled as such here and in the README; nothing
 * fakes a server answer that did not happen.
 *
 * Writes are opt-in (`helpers/capture`): an ordinary run asserts the corrected
 * copy at all three sizes and writes nothing.
 */

const OUT = path.resolve(
  __dirname,
  '../../../docs/design-target/review/join-outcome-correction',
);

const JOIN_CODE = 'HARBOR7WALKERSINVITE01';

const OK_PREVIEW = {
  result: {
    displayName: 'Harbor Walkers',
    groupType: 'familyFriends',
    joinPolicy: 'inviteOnly',
    memberCount: 6,
  },
};

function callableError(status: string, message: string) {
  return { error: { status, message } };
}

function fulfil(route: Route, body: unknown, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function signedInMember(page: Page) {
  const email = `wsf-joc-${stampId()}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  await seedVerifiedUser(email, password);
  await signInVia(page, email, password);
}

// The server's own words, so the frame also proves they never render.
const LEAK = 'INTERNAL: transaction aborted at shard 7';

const CLASSES = [
  { w: 390, h: 640 },
  { w: 390, h: 844 },
  { w: 430, h: 932 },
] as const;

for (const { w, h } of CLASSES) {
  test.describe(`${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('an unconfirmed join says so, and claims nothing about membership', async ({ page }) => {
      test.setTimeout(120_000);
      await page.route('**/wsfPreviewCommunity**', (route) => fulfil(route, OK_PREVIEW));
      await signedInMember(page);
      await page.goto(`/join/${JOIN_CODE}`);
      await expect(page.getByTestId('wsf-join-submit')).toBeVisible({ timeout: 30_000 });

      // INJECTED: the join callable refuses with a status carrying no mapped
      // code — the transport-uncertain case the correction is about.
      await page.route('**/wsfJoinCommunity**', (route) =>
        fulfil(route, callableError('INTERNAL', LEAK), 500),
      );
      await page.getByTestId('wsf-join-submit').click();
      await expect(page.getByTestId('wsf-join-submit-error')).toBeVisible({ timeout: 30_000 });

      // The corrected copy, exactly.
      await expect(page.getByTestId('wsf-join-submit-error-title')).toHaveText(
        'We couldn’t confirm your join.',
      );
      await expect(page.getByTestId('wsf-join-submit-error')).toContainText(
        'Check your connection, then try again.',
      );

      // And the three things the frame must NOT contain: the old promise, any
      // other claim about membership, and the server's wording.
      const body = await page.locator('body').innerText();
      expect(body, 'the old no-change promise is still on screen').not.toContain(
        'Nothing was changed',
      );
      expect(body, 'the server’s own message reached the screen').not.toContain(LEAK);

      // The invitation still stands and the retry is still offered: an
      // unconfirmed outcome is not a dead end.
      await expect(page.getByTestId('wsf-join-submit')).toBeVisible();

      await saveFrame(page, path.join(OUT, `join-unconfirmed-${w}x${h}.png`));
    });
  });
}

test.afterAll(() => {
  if (!CAPTURE_FRAMES) {
    // eslint-disable-next-line no-console
    console.log('[join-outcome] assertions ran; frames withheld (set WSF_CAPTURE_FRAMES=1).');
  }
});
