import { randomBytes } from 'node:crypto';

import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

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

/**
 * THE SHORT PHONE ARRIVES AT THE TOP.
 *
 * A review of the 390x640 evidence read `invite-in`, `failed`, `working`,
 * `too-many` and `load-failed` as opening part-way down, with the invitation
 * hero above the viewport. Reading a screenshot cannot tell an offset arrival
 * from a surface that simply is that tall, so this measures the thing itself:
 * the scroll offset on arrival, and whether the first thing the composition
 * leads with is actually on screen.
 *
 * IT MEASURES RATHER THAN ASSUMES, IN BOTH DIRECTIONS. If any of these states
 * ever does open scrolled — and `failed` and `working` are the ones that
 * could, since they are reached by a tap rather than a load — this fails and
 * names which. Nothing here scrolls the page first; that would answer the
 * question by erasing it.
 */
test.describe('Batch B — /join/[joinCode] arrives at the top on a short phone', () => {
  const SHORT = { width: 390, height: 640 };

  async function shortPhone(browser: Browser) {
    const context = await browser.newContext({
      viewport: SHORT,
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    return { context, page: await context.newPage() };
  }

  /**
   * The capture harness waits this long in `shoot()` before the shutter. A
   * guard that measures the instant a state appears cannot see a layout or
   * scroll-anchor shift that lands during that interval — it would pass while
   * the committed frame showed the shift. So every settled assertion below
   * waits the same interval the evidence does, and measures after it.
   */
  const CAPTURE_SETTLE_MS = 700;

  /** The offset the route opened at — the document's and every scroller's. */
  async function arrivalOffsets(page: Page): Promise<number[]> {
    return page.evaluate(() => {
      const offsets = [window.scrollY, document.documentElement.scrollTop];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (el.scrollTop > 0) offsets.push(el.scrollTop);
      }
      return offsets;
    });
  }

  async function expectArrivedAtTop(page: Page, heroTestId: string, label: string) {
    await page.waitForTimeout(CAPTURE_SETTLE_MS);
    const offsets = await arrivalOffsets(page);
    expect(offsets, `${label}: nothing is scrolled on arrival`).toEqual(
      offsets.map(() => 0)
    );
    const hero = await page.getByTestId(heroTestId).boundingBox();
    expect(hero, `${label}: the hero element exists`).not.toBeNull();
    expect(hero!.y, `${label}: the hero is not above the viewport`).toBeGreaterThanOrEqual(0);
    expect(
      hero!.y,
      `${label}: the hero is inside the ${SHORT.height} pt viewport`
    ).toBeLessThan(SHORT.height);
  }

  test('the invitation, the failure and the join in flight all open with the hero on screen', async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const { context, page } = await shortPhone(browser);
    try {
      await page.route('**/wsfPreviewCommunity**', (route) => fulfil(route, OK_PREVIEW));
      await signedInMember(page);
      await page.goto(`/join/${JOIN_CODE}`);
      await expect(page.getByTestId('wsf-join-signed-in')).toBeVisible({ timeout: 30_000 });
      // `wsf-join-conditions` is the LAST line of the hero. If it is on screen,
      // everything above it — eyebrow, name, type — is too.
      await expectArrivedAtTop(page, 'wsf-join-conditions', 'invite-in');

      // FAILED AND WORKING ARE REACHED BY A TAP, not a load, which is exactly
      // where an offset could survive a re-render. Held open first, then
      // failed, so both are measured on the same page instance a person has.
      // eslint-disable-next-line prefer-const -- assigned inside the route handler
      let release: (() => void) | undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route('**/wsfJoinCommunity**', async (route) => {
        await held;
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify(callableError('INTERNAL', 'join failed')),
        });
      });
      await page.getByTestId('wsf-join-submit').click();
      await expect(page.getByTestId('wsf-join-submit')).toBeDisabled({ timeout: 30_000 });
      await expectArrivedAtTop(page, 'wsf-join-conditions', 'working');

      release?.();
      await expect(page.getByTestId('wsf-join-submit-error')).toBeVisible({ timeout: 30_000 });
      // SETTLED, not first-paint. This is the exact state the committed
      // `AFTER-failed-390x640.png` photographs, measured after the same wait.
      await expectArrivedAtTop(page, 'wsf-join-conditions', 'failed (settled)');
      // And the whole hero, not just its last line: a shift that pushed the
      // wordmark off the top while leaving the conditions visible would be
      // exactly the defect the frame was read as showing.
      const wordmark = await page.getByTestId('wsf-form-wordmark').boundingBox();
      expect(wordmark, 'failed (settled): the wordmark exists').not.toBeNull();
      expect(
        wordmark!.y,
        'failed (settled): the top of the hero is still on screen'
      ).toBeGreaterThanOrEqual(0);
    } finally {
      await context.close();
    }
  });

  for (const refusal of [
    { state: 'too-many', status: 429, code: 'RESOURCE_EXHAUSTED', testID: 'wsf-join-rate-limited' },
    { state: 'load-failed', status: 500, code: 'INTERNAL', testID: 'wsf-join-error' },
  ]) {
    test(`the ${refusal.state} refusal opens with its heading on screen`, async ({ browser }) => {
      const { context, page } = await shortPhone(browser);
      try {
        await page.route('**/wsfPreviewCommunity**', (route) =>
          fulfil(route, callableError(refusal.code, 'refused'), refusal.status)
        );
        await page.goto(`/join/${JOIN_CODE}`);
        await expect(page.getByTestId(refusal.testID)).toBeVisible({ timeout: 30_000 });
        await expectArrivedAtTop(page, refusal.testID, refusal.state);
      } finally {
        await context.close();
      }
    });
  }
});

/**
 * NO CALLABLE TEXT REACHES THE SCREEN.
 *
 * The committed evidence rendered the words "join failed" and "preview
 * failed" — fixture strings, straight from the callable, printed as member
 * copy. `describeCallableError` let them through because neither is a bare
 * code nor developer-shaped, so both read as sentences the server wrote for
 * members. That is the right default on the identity screens and the wrong
 * one here, where a stranger holding a link reaches the surface.
 *
 * These inject text no member should ever see and assert it is nowhere in the
 * rendered page — not in the panel, not anywhere else on screen.
 */
test.describe('Batch B — /join/[joinCode] never renders server text', () => {
  const LEAK = 'ZZQX-internal-diagnostic-do-not-render';

  test('a preview failure shows stable recovery copy, not the callable message', async ({
    page,
  }) => {
    await page.route('**/wsfPreviewCommunity**', (route) =>
      fulfil(route, callableError('INTERNAL', LEAK), 500)
    );
    await page.goto(`/join/${JOIN_CODE}`);
    await expect(page.getByTestId('wsf-join-error')).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId('wsf-join-error-why')).toHaveText(
      'We couldn’t load this community. The link may still be good — try again.'
    );
    expect(await page.locator('body').innerText()).not.toContain(LEAK);
  });

  test('a join failure shows stable recovery copy, not the callable message', async ({ page }) => {
    await page.route('**/wsfPreviewCommunity**', (route) => fulfil(route, OK_PREVIEW));
    await signedInMember(page);
    await page.goto(`/join/${JOIN_CODE}`);
    await expect(page.getByTestId('wsf-join-submit')).toBeVisible({ timeout: 30_000 });

    await page.route('**/wsfJoinCommunity**', (route) =>
      fulfil(route, callableError('INTERNAL', LEAK), 500)
    );
    await page.getByTestId('wsf-join-submit').click();
    await expect(page.getByTestId('wsf-join-submit-error')).toBeVisible({ timeout: 30_000 });

    // Truthful as a matter of fact, not reassurance: the callable runs the
    // whole join inside `db.runTransaction`, so a failure commits nothing.
    await expect(page.getByTestId('wsf-join-submit-error')).toContainText(
      'Nothing was changed. Check your connection and try again.'
    );
    expect(await page.locator('body').innerText()).not.toContain(LEAK);
  });

  test('a category the server can really refuse keeps its own actionable reason', async ({
    page,
  }) => {
    /*
      NOT ONE SENTENCE FOR EVERYTHING. `wsfJoinCommunity` refuses a member
      with no profile using `failed-precondition`. Answering that with "check
      your connection" would strand somebody whose real blocker is a profile
      they can go and complete — so the category keeps its meaning while the
      server's own wording still never renders.
    */
    await page.route('**/wsfPreviewCommunity**', (route) => fulfil(route, OK_PREVIEW));
    await signedInMember(page);
    await page.goto(`/join/${JOIN_CODE}`);
    await expect(page.getByTestId('wsf-join-submit')).toBeVisible({ timeout: 30_000 });

    await page.route('**/wsfJoinCommunity**', (route) =>
      fulfil(route, callableError('FAILED_PRECONDITION', LEAK), 400)
    );
    await page.getByTestId('wsf-join-submit').click();
    await expect(page.getByTestId('wsf-join-submit-error')).toBeVisible({ timeout: 30_000 });

    await expect(page.getByTestId('wsf-join-submit-error')).toContainText(
      'Complete your profile before joining a community.'
    );
    expect(await page.locator('body').innerText()).not.toContain(LEAK);
  });
});
