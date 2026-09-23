import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

import {
  elementState,
  PROJECT_ID,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * `/start-community` — WHAT THE SCREEN IS ENTITLED TO SAY IT KNOWS.
 *
 * `wsfCreateCommunity` carries no attempt key, so a retry is a second
 * community rather than a second try at the first one. Everything here follows
 * from that: a refusal the server NAMED may be reported as "nothing was
 * created"; a lost response may not, because the write may well have landed.
 *
 * THE CENTRAL TEST IS `response lost`. It is not an abort before send — the
 * request really reaches the emulator, the transaction really commits, and
 * only the reply is thrown away. The community is then read back out of
 * Firestore to prove it exists while the screen is saying it cannot confirm
 * it. An abort-before-send would have proved nothing about that case.
 *
 * No frames here; the AFTER evidence is captured by its own producer.
 */

const CREATE_URL = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1/wsfCreateCommunity`;

type Member = { uid: string; email: string; password: string };

async function member(withProfile: boolean): Promise<Member> {
  const email = `wsf-sc-${stampId()}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  if (withProfile) await seedProfile(uid, 'Start Community Member');
  return { uid, email, password };
}

async function openStart(page: Page): Promise<void> {
  await page.goto('/start-community');
  await expect(page.getByTestId('wsf-start')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-start-name')).toBeVisible();
}

async function fillValid(page: Page, name: string): Promise<void> {
  await page.getByTestId('wsf-start-name').fill(name);
  await expect(page.getByTestId('wsf-start-name-error')).toHaveCount(0);
}

/** Counts the create calls that actually left the browser. */
function countCreates(page: Page): () => number {
  let n = 0;
  page.on('request', (r) => {
    if (r.url().startsWith(CREATE_URL)) n += 1;
  });
  return () => n;
}

/** The member's communities, straight from Firestore — not from the screen. */
async function communityNames(uid: string): Promise<string[]> {
  // `Bearer owner` is how the emulator helpers read past the rules; without it
  // the listing is refused and every assertion below silently reads an empty
  // array, which would make this file pass for the wrong reason.
  const res = await fetch(
    `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents/wsfCommunityGroups?pageSize=300`,
    { headers: { authorization: 'Bearer owner' } },
  );
  if (!res.ok) throw new Error(`community listing failed: ${res.status}`);
  const body = (await res.json()) as {
    documents?: Array<{ fields?: Record<string, { stringValue?: string }> }>;
  };
  return (body.documents ?? [])
    .filter((d) => d.fields?.createdByUserId?.stringValue === uid)
    .map((d) => d.fields?.displayName?.stringValue ?? '');
}

/**
 * Scroll the way a member does — wheel steps — and then measure WITHOUT
 * touching the page again. Playwright auto-scrolls before it taps, so a
 * passing `.click()` says nothing about whether a control was reachable at
 * rest; this separates the two.
 */
async function wheelUntilInView(page: Page, testId: string, maxSteps = 40): Promise<void> {
  for (let i = 0; i < maxSteps; i += 1) {
    const st = await elementState(page, { testId });
    if (!st.found) throw new Error(`${testId} is not on the page`);
    if (st.inView) return;
    await page.mouse.wheel(0, st.box.y < 0 ? -300 : 300);
    await page.waitForTimeout(60);
  }
  throw new Error(`${testId} never came into view after ${maxSteps} wheel steps`);
}

/** #22C55E and #91CB7D, as a browser reports them. */
const ACTION_GREEN_RGB = 'rgb(34, 197, 94)';
const PROGRESS_GREEN_RGB = 'rgb(145, 203, 125)';

/**
 * The colour a control is actually painted, walking up from the labelled node
 * to whichever ancestor carries the fill — react-native-web puts the testID on
 * the pressable and the background can sit on it or on its wrapper.
 */
async function paintedBackground(page: Page, testId: string): Promise<string> {
  return page.evaluate((id) => {
    let el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
    if (!el) throw new Error(`${id} is not rendered`);
    const transparent = (v: string) => v === 'rgba(0, 0, 0, 0)' || v === 'transparent' || v === '';
    for (let i = 0; i < 4 && el; i += 1) {
      const bg = getComputedStyle(el).backgroundColor;
      if (!transparent(bg)) return bg;
      el = el.parentElement;
    }
    return 'rgba(0, 0, 0, 0)';
  }, testId);
}

test.describe('start-community outcomes', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('an ordinary create opens the community, and nothing says it failed', async ({ page }) => {
    test.setTimeout(150_000);
    const me = await member(true);
    const creates = countCreates(page);
    await signInVia(page, me.email, me.password);
    await openStart(page);
    await fillValid(page, 'Ordinary Success');

    await page.getByTestId('wsf-start-submit').click();
    await page.waitForURL(/\/community\/[^/]+$/, { timeout: 30_000 });
    expect(creates(), 'more than one create left the browser').toBe(1);
    expect(await communityNames(me.uid)).toContain('Ordinary Success');
  });

  /**
   * THE CASE THE WHOLE CHANGE EXISTS FOR.
   *
   * `route.fetch()` sends the request for real and waits for the server's
   * answer; `route.abort()` then throws that answer away. The transaction has
   * committed. The client knows nothing.
   */
  test('a create whose response is lost is unconfirmed, and the community exists', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const me = await member(true);
    const creates = countCreates(page);
    await signInVia(page, me.email, me.password);
    await openStart(page);
    await fillValid(page, 'Response Lost');

    await page.route(CREATE_URL, async (route: Route) => {
      await route.fetch().catch(() => undefined);
      await route.abort('failed').catch(() => undefined);
    });
    await page.getByTestId('wsf-start-submit').click();

    await expect(page.getByTestId('wsf-start-outcome-title')).toHaveText(
      'We couldn’t confirm your community was created.',
      { timeout: 30_000 },
    );
    // It must NOT claim the server was not reached, and must not claim nothing
    // happened — both were true of the screen this replaces.
    const body = await page.getByTestId('wsf-start-error').innerText();
    expect(body).not.toContain('Nothing was created');
    expect(body).not.toContain('reach the server');

    // The community is really there while the screen is saying it cannot
    // confirm it. That is the whole point.
    expect(
      await communityNames(me.uid),
      'the response-lost fixture did not actually commit a create',
    ).toContain('Response Lost');
    expect(creates()).toBe(1);

    // Checking communities must not create a second one.
    await page.unroute(CREATE_URL);
    await page.getByTestId('wsf-start-check-communities').click();
    await expect(page.getByTestId('wsf-home-my-list')).toBeVisible({ timeout: 25_000 });
    expect(new URL(page.url()).search, 'the list opt-in was not used').toBe('?view=communities');
    // Expo Router leaves the screen we came from in the DOM, hidden, so this
    // has to look inside the list rather than anywhere on the page.
    await expect(
      page.getByTestId('wsf-home-my-list').getByText('Response Lost').first(),
    ).toBeVisible();
    expect(creates(), 'checking communities sent another create').toBe(1);
  });

  test('the retry after an unconfirmed create is a deliberate second community', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const me = await member(true);
    const creates = countCreates(page);
    await signInVia(page, me.email, me.password);
    await openStart(page);
    await fillValid(page, 'Twice Over');

    await page.route(CREATE_URL, async (route: Route) => {
      await route.fetch().catch(() => undefined);
      await route.abort('failed').catch(() => undefined);
    });
    await page.getByTestId('wsf-start-submit').click();
    await expect(page.getByTestId('wsf-start-outcome')).toBeVisible({ timeout: 30_000 });
    await page.unroute(CREATE_URL);

    // Nothing has retried on the member's behalf.
    await page.waitForTimeout(1500);
    expect(creates(), 'the page retried by itself').toBe(1);

    // The control says what it starts, and the risk is next to it.
    await expect(page.getByTestId('wsf-start-submit')).toHaveText(/Start another community/);
    await expect(page.getByTestId('wsf-start-retry-note')).toContainText(
      'you will have two',
    );

    await page.getByTestId('wsf-start-submit').click();
    await page.waitForURL(/\/community\/[^/]+$/, { timeout: 30_000 });
    expect(creates()).toBe(2);
    const names = await communityNames(me.uid);
    expect(names.filter((n) => n === 'Twice Over')).toHaveLength(2);
  });

  test('a named refusal says so, and a profile refusal leads to the profile', async ({ page }) => {
    test.setTimeout(150_000);
    // No profile: the callable refuses inside its transaction with
    // failed-precondition, which no gate on this route catches first.
    const me = await member(false);
    const creates = countCreates(page);
    await signInVia(page, me.email, me.password);
    await openStart(page);
    await fillValid(page, 'No Profile Yet');

    await page.getByTestId('wsf-start-submit').click();
    await expect(page.getByTestId('wsf-start-outcome-title')).toHaveText(
      'We couldn’t create your community.',
      { timeout: 30_000 },
    );
    await expect(page.getByTestId('wsf-start-error')).toHaveText(
      'Complete your profile before creating a community.',
    );
    // Nothing was created, so the screen may say so — and it must not offer
    // the button the server just declined.
    expect(await communityNames(me.uid)).toHaveLength(0);
    await expect(page.getByTestId('wsf-start-submit')).toHaveCount(0);

    await expect(page.getByTestId('wsf-start-profile')).toBeVisible();
    await page.getByTestId('wsf-start-profile').click();
    await page.waitForURL(/\/profile-setup/, { timeout: 25_000 });
    expect(creates(), 'reaching the profile step sent another create').toBe(1);
  });

  test('a name the server would refuse never leaves the browser', async ({ page }) => {
    test.setTimeout(150_000);
    const me = await member(true);
    const creates = countCreates(page);
    await signInVia(page, me.email, me.password);
    await openStart(page);

    // Too short.
    await page.getByTestId('wsf-start-name').fill('H');
    await page.getByTestId('wsf-start-submit').click();
    await expect(page.getByTestId('wsf-start-name-error')).toHaveText(
      'Give your community a name.',
    );

    // Over the server's ceiling — stated locally, with the count, before a
    // round trip. 84 characters after trimming.
    const long = 'The Henderson Family Reunion Walking and Stretching Group of Greater Portland, Maine';
    expect(long.trim()).toHaveLength(84);
    await page.getByTestId('wsf-start-name').fill(long);
    await expect(page.getByTestId('wsf-start-name-error')).toHaveText(
      'Use 80 characters or fewer. This name is 84.',
    );
    await page.getByTestId('wsf-start-submit').click();
    await expect(page.getByTestId('wsf-start-name-error')).toBeVisible();

    expect(creates(), 'an invalid name was sent to the server').toBe(0);
    expect(await page.getByTestId('wsf-start-outcome').count()).toBe(0);
    // The field is where the member is sent, not the top of the page.
    expect(
      await page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') ?? null,
      ),
    ).toBe('wsf-start-name');
  });

  test('two taps in one frame create one community', async ({ page }) => {
    test.setTimeout(150_000);
    const me = await member(true);
    const creates = countCreates(page);
    await signInVia(page, me.email, me.password);
    await openStart(page);
    await fillValid(page, 'Only Once');

    // Hold the response so both taps land while the first is still in flight.
    const gate: { release: () => void } = { release: () => {} };
    const held = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    await page.route(CREATE_URL, async (route: Route) => {
      await held;
      await route.continue().catch(() => undefined);
    });

    const submit = page.getByTestId('wsf-start-submit');
    await submit.click();
    await submit.click({ force: true, timeout: 5_000 }).catch(() => undefined);
    await submit.click({ force: true, timeout: 5_000 }).catch(() => undefined);

    gate.release();
    await page.waitForURL(/\/community\/[^/]+$/, { timeout: 30_000 });
    await page.unroute(CREATE_URL);
    expect(creates(), 'a second create left the browser while the first was open').toBe(1);
    expect(await communityNames(me.uid)).toHaveLength(1);
  });

  /**
   * A BROKEN NAVIGATION STILL CREATES EXACTLY ONE COMMUNITY.
   *
   * This is the half of the confirmed-create/navigation-failure case that a
   * browser can actually prove. The other half — the screen offering the
   * created community — cannot be staged here, and that is a measurement
   * rather than a guess: with `history.replaceState` patched to throw, the
   * page error fires and the URL stays at `/start-community`, but `wsf-start`
   * is ALREADY GONE from the DOM; patching it to silently do nothing gives the
   * same result. Expo Router unmounts the source screen from its own state
   * before it writes history, so no history fault can leave a member sitting
   * on this form with a created community. `tests/start-community-outcomes.test.tsx`
   * covers the state itself, by making `router.replace` throw and by letting
   * the grace period elapse.
   *
   * What matters for safety is provable right here: whatever the navigation
   * does, the member ends up with one community and not two.
   */
  test('a create whose navigation is broken still creates exactly one community', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const me = await member(true);
    const creates = countCreates(page);
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await signInVia(page, me.email, me.password);

    await page.addInitScript(() => {
      const real = history.replaceState.bind(history);
      history.replaceState = ((state: unknown, title: string, url?: string | URL | null) => {
        if (typeof url === 'string' && url.includes('/community/')) {
          throw new Error('navigation blocked by the test');
        }
        return real(state, title, url);
      }) as typeof history.replaceState;
    });
    await openStart(page);
    await fillValid(page, 'Navigation Broken');
    await page.getByTestId('wsf-start-submit').click();

    // The write really was attempted and really did fail.
    await expect
      .poll(() => pageErrors.some((m) => m.includes('navigation blocked')), { timeout: 20_000 })
      .toBe(true);

    await page.waitForTimeout(3000);
    expect(creates(), 'a broken navigation caused a second create').toBe(1);
    expect(await communityNames(me.uid)).toEqual(['Navigation Broken']);
    // And nothing told the member the create failed.
    expect(await page.getByTestId('wsf-start-error').count()).toBe(0);
  });

  test('leaving the page while a create is open leaves no stray outcome', async ({ page }) => {
    test.setTimeout(150_000);
    const me = await member(true);
    await signInVia(page, me.email, me.password);
    await openStart(page);
    await fillValid(page, 'Unmounted Mid Flight');

    const gate: { release: () => void } = { release: () => {} };
    const held = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    await page.route(CREATE_URL, async (route: Route) => {
      await held;
      await route.abort('failed').catch(() => undefined);
    });

    await page.getByTestId('wsf-start-submit').click();
    await page.goto('/you');
    await expect(page.getByTestId('wsf-start')).toHaveCount(0);

    gate.release();
    await page.waitForTimeout(1500);
    await page.unroute(CREATE_URL);
    // The abandoned call does not paint anything onto the page that replaced it.
    expect(await page.getByTestId('wsf-start-outcome').count()).toBe(0);
    expect(await page.getByTestId('wsf-start-error').count()).toBe(0);
  });
});

/**
 * The surface has to stay usable, not only correct: the shared navigation is
 * still there, the header has not grown, and the control a member must reach
 * is genuinely reachable AT REST on the shortest phone — Playwright scrolls
 * before it taps, so a passing tap proves nothing about that.
 */
test.describe('start-community stays a usable form', () => {
  test.use({ viewport: { width: 390, height: 640 } });

  test('the member tabs remain, and the submit is hit-testable on a short phone', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const me = await member(true);
    await signInVia(page, me.email, me.password);
    await openStart(page);

    // The prototype drew no tab bar. That was a drawing, not permission to
    // remove the shell.
    await expect(page.getByTestId('wsf-member-tabs')).toBeVisible();

    await fillValid(page, 'Short Phone');
    await wheelUntilInView(page, 'wsf-start-submit');
    const submit = await elementState(page, { testId: 'wsf-start-submit' });
    expect(submit.found).toBe(true);
    expect(submit.inView, 'the submit never came into view').toBe(true);
    expect(submit.covered, 'something covers the submit at rest').toBe(false);
    expect(submit.box.h, 'the submit is under the 44px touch minimum').toBeGreaterThanOrEqual(44);

    // The field a member types into is reachable with the keyboard open: the
    // viewport shrinks, so re-measure after focusing rather than assuming.
    await wheelUntilInView(page, 'wsf-start-name');
    await page.getByTestId('wsf-start-name').focus();
    const field = await elementState(page, { testId: 'wsf-start-name' });
    expect(field.covered, 'the name field is covered while focused').toBe(false);
    expect(field.box.h).toBeGreaterThanOrEqual(44);
  });
});

/**
 * BOARD 00: #22C55E IS A PRIMARY ACTION, #91CB7D IS CONFIRMED PROGRESS.
 *
 * Every primary on this route has to be the first of those. It was not:
 * `kit.primaryButton` carries the progress green, so the two recovery
 * primaries and both guard primaries rendered in the colour reserved for a
 * reported number. `SubmitButton`'s own primary was already correct, which is
 * why Create community needs verifying rather than changing.
 *
 * Asserted as the BROWSER paints it, not as the stylesheet declares it.
 */
test.describe('primary actions are painted as primary actions', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  // ONE MEMBER PER TEST. Signing a second account in on a page that is already
  // signed in never reaches /signin, so these are four contexts, not one.

  test('the signed-out guard', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/start-community');
    await expect(page.getByTestId('wsf-start-signed-out')).toBeVisible({ timeout: 25_000 });
    expect(await paintedBackground(page, 'wsf-start-signed-out-signin')).toBe(ACTION_GREEN_RGB);
  });

  test('the unverified guard', async ({ page }) => {
    test.setTimeout(150_000);
    // Verified is what the form requires, so an unverified member meets the
    // other guard. Same emulator path as the helper, minus the verify step.
    const email = `wsf-sc-${stampId()}@example.com`;
    const password = `Pw-${randomBytes(9).toString('base64url')}`;
    const res = await fetch(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key',
      {
        method: 'POST',
        headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    if (!res.ok) throw new Error(`emulator signUp failed: ${res.status}`);
    // Not `signInVia`: that helper waits for Home or the profile step, and an
    // unverified sign-in lands on /verify-email, which is the whole point here.
    await page.goto('/signin');
    await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('wsf-signin-email').fill(email);
    await page.getByTestId('wsf-signin-password').fill(password);
    await page.getByTestId('wsf-signin-submit').click();
    await page.waitForURL(/\/verify-email/, { timeout: 20_000 });
    await page.goto('/start-community');
    await expect(page.getByTestId('wsf-start-unverified')).toBeVisible({ timeout: 25_000 });
    expect(await paintedBackground(page, 'wsf-start-unverified-verify')).toBe(ACTION_GREEN_RGB);
  });

  test('the form, and the unconfirmed recovery beside its tertiary retry', async ({ page }) => {
    test.setTimeout(180_000);
    // Create community — already action green through SubmitButton. Verified,
    // not redesigned.
    const me = await member(true);
    await signInVia(page, me.email, me.password);
    await openStart(page);
    expect(await paintedBackground(page, 'wsf-start-submit')).toBe(ACTION_GREEN_RGB);

    await fillValid(page, 'Painted Green');
    await page.route(CREATE_URL, async (route: Route) => {
      await route.fetch().catch(() => undefined);
      await route.abort('failed').catch(() => undefined);
    });
    await page.getByTestId('wsf-start-submit').click();
    await expect(page.getByTestId('wsf-start-check-communities')).toBeVisible({ timeout: 30_000 });
    await page.unroute(CREATE_URL);

    expect(await paintedBackground(page, 'wsf-start-check-communities')).toBe(ACTION_GREEN_RGB);
    const retry = await paintedBackground(page, 'wsf-start-submit');
    expect(retry, 'the deliberate retry is painted as the primary action').not.toBe(
      ACTION_GREEN_RGB,
    );
  });

  test('the profile refusal’s way forward', async ({ page }) => {
    test.setTimeout(150_000);
    const me = await member(false);
    await signInVia(page, me.email, me.password);
    await openStart(page);
    await fillValid(page, 'Painted Green');
    await page.getByTestId('wsf-start-submit').click();
    await expect(page.getByTestId('wsf-start-profile')).toBeVisible({ timeout: 30_000 });
    expect(await paintedBackground(page, 'wsf-start-profile')).toBe(ACTION_GREEN_RGB);
  });

  test('no control on this route is painted in the progress green', async ({ page }) => {
    test.setTimeout(150_000);
    const me = await member(true);
    await signInVia(page, me.email, me.password);
    await openStart(page);
    const offenders = await page.evaluate((progress) => {
      const out: string[] = [];
      for (const n of Array.from(document.querySelectorAll('[data-testid^="wsf-start"]'))) {
        if (getComputedStyle(n as HTMLElement).backgroundColor === progress) {
          out.push((n as HTMLElement).dataset.testid ?? '?');
        }
      }
      return out;
    }, PROGRESS_GREEN_RGB);
    expect(offenders, 'progress green is reserved for a confirmed number').toEqual([]);
  });
});
