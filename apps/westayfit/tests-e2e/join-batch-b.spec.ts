import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

import { seedVerifiedUser, signInVia, stampId, visibleCount } from './helpers/mobile';

/**
 * WHAT THE REBUILT `/join/[joinCode]` MUST STILL DO.
 *
 * The Batch B work changed every composition on this route. These are the
 * behaviours that must survive that, written so each one FAILS if the
 * behaviour is removed rather than merely if a pixel moves:
 *
 *   · the refusal stays non-oracular, and it offers no retry it cannot honour
 *   · "Try again" issues a real second call, and a second answer is believed
 *   · the signed-out fork REPLACES this screen, so the return lands on one
 *   · a failed join replaces what a member has read, not stacks on top of it
 *   · the shared-screen answer is undoable WITHOUT leaving the screen
 *
 * Nothing here asserts a colour or a position. This is the contract under the
 * composition, which is the part a later visual pass must not be able to
 * break silently.
 */

/** A join code of the shape `isValidShape` accepts: 16-128 of [A-Za-z0-9_-]. */
const JOIN_CODE = 'HARBOR7WALKERSINVITE01';
const EVENT_GOAL = 'goal-demo-event-1';

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
  const email = `wsf-jb-${stampId()}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  await seedVerifiedUser(email, password);
  await signInVia(page, email, password);
}

test.describe('Batch B — /join/[joinCode]', () => {
  test('a refused code says nothing about which refusal it is, and offers no retry', async ({
    page,
  }) => {
    await page.route('**/wsfPreviewCommunity**', (route) =>
      fulfil(route, callableError('NOT_FOUND', 'no such code'), 404)
    );
    await page.goto(`/join/${JOIN_CODE}`);
    await expect(page.getByTestId('wsf-join-invalid')).toBeVisible({ timeout: 30_000 });

    /*
      THE ORACLE TEST. `wsfPreviewCommunity` answers identically for a code
      that never existed and for a community this visitor may not see. If the
      screen ever names the community, says "no such community", or says
      "you do not have access", a stranger can use it to discover which
      communities exist. So the sentence must cover both and choose neither.
    */
    const said = (await page.getByTestId('wsf-join-invalid').textContent()) ?? '';
    expect(said).toContain('not valid or is no longer active');
    expect(said.toLowerCase()).not.toContain('harbor walkers');
    expect(said.toLowerCase()).not.toContain('access');
    expect(said.toLowerCase()).not.toContain('permission');
    expect(said.toLowerCase()).not.toContain('no such');

    // AND NO "TRY AGAIN": the answer will not change, so a control that
    // invites another attempt would be promising something it cannot do.
    await expect(page.getByTestId('wsf-join-invalid-retry')).toHaveCount(0);
    await expect(page.getByTestId('wsf-join-invalid-home')).toBeVisible();
  });

  test('"Try again" makes a real second call, and the second answer is believed', async ({
    page,
  }) => {
    let calls = 0;
    await page.route('**/wsfPreviewCommunity**', (route) => {
      calls += 1;
      // The FIRST attempt fails and every later one succeeds, so a retry that
      // only re-rendered the old state would leave this screen on the error.
      return calls === 1
        ? fulfil(route, callableError('INTERNAL', 'preview failed'), 500)
        : fulfil(route, OK_PREVIEW);
    });

    await page.goto(`/join/${JOIN_CODE}`);
    await expect(page.getByTestId('wsf-join-error')).toBeVisible({ timeout: 30_000 });
    expect(calls).toBe(1);

    await page.getByTestId('wsf-join-error-retry').click();
    await expect(page.getByTestId('wsf-join-signed-out')).toBeVisible({ timeout: 30_000 });
    expect(calls).toBeGreaterThan(1);
    await expect(page.getByTestId('wsf-join-signed-out')).toContainText('Harbor Walkers');
  });

  test('the invitation states the joining conditions once, not twice', async ({ page }) => {
    /*
      A REGRESSION GUARD WITH A CAUSE. The field carries a type fact and a
      conditions sentence in two different slots; an earlier build fed the
      conditions into both and printed the same sentence twice under the name.
      Counting the occurrences is what catches that, and it catches it however
      the two slots are styled later.
    */
    await page.route('**/wsfPreviewCommunity**', (route) => fulfil(route, OK_PREVIEW));
    await page.goto(`/join/${JOIN_CODE}`);
    await expect(page.getByTestId('wsf-join-signed-out')).toBeVisible({ timeout: 30_000 });

    const said = (await page.getByTestId('wsf-join-signed-out').textContent()) ?? '';
    const sentence = 'Anyone with the invite link can join';
    expect(said.split(sentence).length - 1).toBe(1);
    // The type fact is still there, and it is not the conditions sentence.
    expect(said).toContain('Family and friends');
  });

  test('signing up from the invitation leaves ONE join screen behind', async ({ page }) => {
    await page.route('**/wsfPreviewCommunity**', (route) => fulfil(route, OK_PREVIEW));
    await page.goto(`/join/${JOIN_CODE}`);
    await expect(page.getByTestId('wsf-join-signed-out')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('wsf-join-signup').click();
    await expect(page).toHaveURL(/\/signup/, { timeout: 30_000 });

    /*
      `replace`, NOT push. If this pushed, the join screen would sit under the
      signup -> verify -> profile-setup stack and the return trip would mount
      a SECOND join instance. Zero is the only correct count here, and this
      assertion is what keeps it that way.
    */
    expect(await visibleCount(page, 'wsf-join-signed-out')).toBe(0);

    // And the code is carried, which is what makes the return trip work.
    const carried = await page.evaluate(() => {
      try {
        return window.sessionStorage.getItem('wsf.pendingJoinCode');
      } catch {
        return null;
      }
    });
    expect(carried).toBe(JOIN_CODE);
  });

  test('a failed join replaces what was read, and leaves the invitation standing', async ({
    page,
  }) => {
    await page.route('**/wsfPreviewCommunity**', (route) => fulfil(route, OK_PREVIEW));
    await signedInMember(page);
    await page.goto(`/join/${JOIN_CODE}`);
    await expect(page.getByTestId('wsf-join-meaning')).toBeVisible({ timeout: 30_000 });

    await page.route('**/wsfJoinCommunity**', (route) =>
      fulfil(route, callableError('INTERNAL', 'join failed'), 500)
    );
    await page.getByTestId('wsf-join-submit').click();
    await expect(page.getByTestId('wsf-join-submit-error')).toBeVisible({ timeout: 30_000 });

    // The failure REPLACES "What joining means" — three facts already read do
    // not belong above the one new sentence.
    expect(await visibleCount(page, 'wsf-join-meaning')).toBe(0);
    await expect(page.getByTestId('wsf-join-submit-error')).toContainText(
      'We couldn’t join this community.'
    );
    // The invitation itself is unchanged: the community is still there and
    // the action is still offered. A failed attempt is not a dead end.
    await expect(page.getByTestId('wsf-join-signed-in')).toContainText('Harbor Walkers');
    await expect(page.getByTestId('wsf-join-submit')).toBeVisible();
  });

  test('a shared screen can be un-shared without leaving the screen', async ({ page }) => {
    await page.route('**/wsfPreviewCommunity**', (route) => fulfil(route, OK_PREVIEW));
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('wsf.deviceMode', 'shared');
      } catch {
        // a browser with storage blocked simply has no remembered device
      }
    });
    await page.goto(`/join/${JOIN_CODE}?event=${EVENT_GOAL}`);
    await expect(page.getByTestId('wsf-join-device-shared')).toBeVisible({ timeout: 30_000 });

    const before = page.url();
    await page.getByTestId('wsf-device-shared-reset').click();

    /*
      THE WHOLE POINT OF THIS CONTROL. Without it, a personal phone that
      answered "shared" once would be handed to the kiosk by every future scan
      of this link, with nothing anywhere to undo it. It forgets the answer
      and asks again HERE — so the question must come back and the address
      must not have changed.
    */
    await expect(page.getByTestId('wsf-join-device-choice')).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toBe(before);
    const remembered = await page.evaluate(() => {
      try {
        return window.localStorage.getItem('wsf.deviceMode');
      } catch {
        return null;
      }
    });
    expect(remembered).toBeNull();
  });
});
