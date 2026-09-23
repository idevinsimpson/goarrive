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

/**
 * The member's communities, straight from Firestore — not from the screen.
 *
 * A SERVER-SIDE QUERY, NOT A PAGE OF THE COLLECTION. This used to list
 * `wsfCommunityGroups?pageSize=300` and filter by creator in the browser, which
 * silently depends on collection size: a long-lived emulator holding 878
 * groups returned only the first 300, so a community that really had been
 * created was reported missing and three tests failed intermittently for a
 * reason that had nothing to do with the route. Filtering on
 * `createdByUserId` in the query makes the answer the same at 8 groups or
 * 8,000 — the same `documents:runQuery` form the other emulator specs use.
 *
 * `Bearer owner` reads past the rules; without it the query is refused, and
 * an empty result would make every assertion below pass for the wrong reason.
 * So a refusal throws rather than returning [].
 */
async function communityNames(uid: string): Promise<string[]> {
  const res = await fetch(
    `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'wsfCommunityGroups' }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'createdByUserId' },
              op: 'EQUAL',
              value: { stringValue: uid },
            },
          },
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`community query failed: ${res.status} ${await res.text()}`);
  // An empty result is one row carrying only `readTime`, so rows without a
  // document are dropped rather than read as a nameless community.
  const rows = (await res.json()) as {
    document?: { fields?: Record<string, { stringValue?: string }> };
  }[];
  return rows
    .filter((row) => row.document)
    .map((row) => row.document!.fields?.displayName?.stringValue ?? '');
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

  /**
   * M5 — A MEMBER WHO LEAVES MID-CREATE STAYS WHERE THEY WENT.
   *
   * This REPLACES a test that used `page.goto`: a full document reload, which
   * destroys the JavaScript realm, so the guard it claimed to prove was never
   * exercised and the test passed with the guard deleted. The real journey is
   * the route's own "Back to home", which is a PUSH: the form stays mounted,
   * hidden, under the Home the member went to, and a `router.replace` with no
   * source replaces the FOCUSED route — that Home. On 5c28e45 the late success
   * therefore pulled the member off Home into the new community.
   *
   * The request may still finish server-side; that is fine. What must not
   * happen is the member being moved, or anything being painted where they are.
   */
  test('leaving by Back to home mid-create leaves the member on Home when the create lands', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const me = await member(true);
    const creates = countCreates(page);
    await signInVia(page, me.email, me.password);
    await page.goto('/');
    await expect(page.getByTestId('wsf-home-start').last()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-home-start').last().click();
    await expect(page.getByTestId('wsf-start-name')).toBeVisible({ timeout: 25_000 });

    const gate: { release: () => void } = { release: () => {} };
    const held = new Promise<void>((resolve) => {
      gate.release = resolve;
    });
    await page.route(CREATE_URL, async (route: Route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await held;
      await route.continue().catch(() => undefined);
    });

    await fillValid(page, 'Left Before It Landed');
    await page.getByTestId('wsf-start-submit').click();
    await page.waitForTimeout(400);
    await page.getByTestId('wsf-start-back').click();
    await page.waitForURL((u) => u.pathname === '/', { timeout: 20_000 });

    gate.release();
    // Long enough for the create to settle AND for the 1.5 s navigation grace.
    await page.waitForTimeout(4_000);
    await page.unroute(CREATE_URL);

    expect(new URL(page.url()).pathname, 'the late success moved the member after they left').toBe('/');
    expect(creates(), 'more than one create left the browser').toBe(1);
    expect(await communityNames(me.uid), 'the create did not commit exactly once').toEqual([
      'Left Before It Landed',
    ]);
    // Nothing from the form is painted where the member is. VISIBLE, not
    // counted: the left form is still in the DOM, hidden, by design — which
    // is also what lets a member who comes back find Open instead of a fresh
    // form that would make a second community.
    for (const id of ['wsf-start-created', 'wsf-start-outcome', 'wsf-start-error']) {
      expect(await page.getByTestId(id).and(page.locator(':visible')).count(), `${id} is painted on Home`).toBe(0);
    }
  });
});

/*
  M4 — THE BARLESS UNVERIFIED GATE HAS A WAY OUT.

  On W9's shell this gate has no tabs, and "Verify email" is forward progress,
  not an exit. Hit-tested at the control's own centre, at rest, because a link
  that exists but sits under something is not a way out.
*/
test.describe('the unverified gate', () => {
  test.use({ viewport: { width: 390, height: 640 } });

  test('offers Back to home at a real touch size, reachable at its own centre', async ({ page }) => {
    test.setTimeout(150_000);
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
    await page.goto('/signin');
    await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('wsf-signin-email').fill(email);
    await page.getByTestId('wsf-signin-password').fill(password);
    await page.getByTestId('wsf-signin-submit').click();
    await page.waitForURL(/\/verify-email/, { timeout: 20_000 });

    await page.goto('/start-community');
    await expect(page.getByTestId('wsf-start-unverified')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-member-tabs')).toHaveCount(0);

    await wheelUntilInView(page, 'wsf-start-unverified-back');
    const back = await elementState(page, { testId: 'wsf-start-unverified-back' });
    expect(back.inView, 'Back to home is not in view').toBe(true);
    expect(back.covered, 'something covers Back to home at its own centre').toBe(false);
    expect(back.box.h, 'Back to home is under the 44 px touch minimum').toBeGreaterThanOrEqual(44);

    await page.getByTestId('wsf-start-unverified-back').click();
    await page.waitForURL((u) => u.pathname === '/', { timeout: 20_000 });
  });
});

/*
  Q3 — THE FIRST INVALID PRESS DOES WHAT IT SAYS.

  W7's reproducer, on the positions W7 measured: the name field still partly
  on screen when Create community is pressed. On 5c28e45 the blur inserted the
  sentence ABOVE the button, the button moved ~52 px between press and release,
  and the press did nothing — 16/16 at 390x844 and 16/16 at 430x932. The
  instrument is W7's, deliberately: placement relative to the route's own
  scroller, the pointer verified on the button before pressing, and SUBMITTED
  read from focus() calls on the field or focus now on it — never from the
  error's presence, which the blur alone used to produce.

  390x640 cannot fail first: wherever the whole button is on screen there, the
  field is already above the viewport. It stays as a regression guard and says
  how many risky positions it reached (none).
*/
async function watchFieldFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __w4fc: number };
    w.__w4fc = 0;
    const orig = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (this: HTMLElement, ...a: unknown[]) {
      if (this.dataset?.testid === 'wsf-start-name') w.__w4fc += 1;
      return orig.apply(this, a as []);
    };
  });
}

async function placeSubmitAt(
  page: Page,
  scrollTop: number,
): Promise<{ scrollTop: number; max: number; inputBottom: number; cx: number; cy: number; valid: boolean }> {
  return page.evaluate((st) => {
    const btn = document.querySelector('[data-testid="wsf-start-submit"]') as HTMLElement;
    let sc: HTMLElement | null = btn;
    while (sc && !(sc.scrollHeight > sc.clientHeight + 1)) sc = sc.parentElement;
    if (!sc) throw new Error('no scroller above the submit');
    sc.scrollTop = st;
    const s = sc.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    const i = (document.querySelector('[data-testid="wsf-start-name"]') as HTMLElement).getBoundingClientRect();
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    let n = document.elementFromPoint(cx, cy) as HTMLElement | null;
    while (n && !n.dataset?.testid) n = n.parentElement;
    return {
      scrollTop: Math.round(sc.scrollTop),
      max: sc.scrollHeight - sc.clientHeight,
      inputBottom: Math.round(i.bottom),
      cx,
      cy,
      valid: b.top >= s.top && b.bottom <= s.bottom && !!n && n.dataset.testid === 'wsf-start-submit',
    };
  }, scrollTop);
}

type FirstPress = { kind: 'mouse' | 'touch'; ms: number };

async function pressOnce(page: Page, press: FirstPress, x: number, y: number): Promise<void> {
  if (press.kind === 'mouse') {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(press.ms);
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(press.ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

for (const vp of [
  { width: 390, height: 844, risky: true },
  { width: 430, height: 932, risky: true },
  { width: 390, height: 640, risky: false },
]) {
  for (const press of [
    { kind: 'mouse', ms: 5 },
    { kind: 'mouse', ms: 120 },
    { kind: 'touch', ms: 80 },
    { kind: 'touch', ms: 150 },
  ] as FirstPress[]) {
    test.describe(`Q3 first invalid press @${vp.width}x${vp.height} ${press.kind} ${press.ms} ms`, () => {
      test.use(
        press.kind === 'touch'
          ? { viewport: vp, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }
          : { viewport: vp },
      );

      test(`validates and shows the error on that same press, field partly visible`, async ({ page }) => {
        test.setTimeout(300_000);
        const me = await member(true);
        await signInVia(page, me.email, me.password);
        await openStart(page);
        const max = await page.evaluate(() => {
          const b = document.querySelector('[data-testid="wsf-start-submit"]') as HTMLElement;
          let sc: HTMLElement | null = b;
          while (sc && !(sc.scrollHeight > sc.clientHeight + 1)) sc = sc.parentElement;
          return sc ? sc.scrollHeight - sc.clientHeight : 0;
        });
        const stops = [...new Set([max - 60, max - 20, max].map((v) => Math.max(0, v)))];

        const rows: string[] = [];
        const bad: string[] = [];
        let pressed = 0;
        let risky = 0;
        for (const st of stops) {
          await openStart(page);
          await watchFieldFocus(page);
          // Focus stays in the field: the press must blur it, as a member's does.
          await page.getByTestId('wsf-start-name').fill('a');
          const p = await placeSubmitAt(page, st);
          await page.waitForTimeout(150);
          if (!p.valid) {
            rows.push(`scrollTop ${p.scrollTop}/${p.max}: button clipped or covered, not pressed`);
            continue;
          }
          pressed += 1;
          if (p.inputBottom > 0) risky += 1;
          await pressOnce(page, press, p.cx, p.cy);
          await page.waitForTimeout(600);
          const o = await page.evaluate(() => {
            const fc = (window as unknown as { __w4fc: number }).__w4fc;
            const a = document.activeElement as HTMLElement | null;
            const active = a?.dataset?.testid ?? a?.tagName.toLowerCase() ?? 'null';
            const err = document.querySelector('[data-testid="wsf-start-name-error"]') as HTMLElement | null;
            const r = err?.getBoundingClientRect();
            return {
              submitted: fc > 0 || active === 'wsf-start-name' || active === 'wsf-start-name-error',
              exposed: !!r && r.height > 0 && r.top >= 0 && r.bottom <= window.innerHeight,
              active,
            };
          });
          const verdict = !o.submitted ? 'SWALLOWED' : !o.exposed ? 'ERROR-OFFSCREEN' : 'SUBMITTED';
          const row = `scrollTop ${p.scrollTop}/${p.max} fieldBottom=${p.inputBottom} -> ${verdict} (focus=${o.active})`;
          rows.push(row);
          if (verdict !== 'SUBMITTED') bad.push(row);
        }
        test.info().annotations.push({ type: 'positions', description: rows.join(' | ') });
        test.info().annotations.push({ type: 'risky-positions', description: String(risky) });
        expect(pressed, `no pressable position was found: ${rows.join(' | ')}`).toBeGreaterThan(0);
        // NOT VACUOUS: at the classes where the defect lived, the field really
        // was on screen for at least one press.
        if (vp.risky) expect(risky, `never pressed with the field on screen: ${rows.join(' | ')}`).toBeGreaterThan(0);
        expect(bad, 'first presses that did not validate and show the error').toEqual([]);
      });
    });
  }
}

/**
 * The surface has to stay usable, not only correct: the shared navigation is
 * still there, the header has not grown, and the control a member must reach
 * is genuinely reachable AT REST on the shortest phone — Playwright scrolls
 * before it taps, so a passing tap proves nothing about that.
 */
test.describe('start-community stays a usable form', () => {
  test.use({ viewport: { width: 390, height: 640 } });

  /**
   * BARLESS ON THE INTEGRATED SHELL.
   *
   * This used to assert the member tabs were present, because the shell drew
   * them over every page. W9's shell makes `/start-community` a focused flow
   * presented ABOVE the tab navigator (`app/_layout.tsx`), so it is barless by
   * where it sits in the tree — and the Director ruled that is the final
   * composition. The assertion is inverted rather than deleted: a bar
   * reappearing here would be a regression.
   *
   * The rest of what this test proves matters more now, not less. The bar used
   * to TAKE 62 px as a flex sibling; with it gone the composition moves, so
   * reachability is re-measured rather than assumed, and the space the bar
   * held must not survive as a blank reservation.
   */
  test('no member tabs on this focused route, and the submit is reachable at rest and by keyboard', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const me = await member(true);
    await signInVia(page, me.email, me.password);
    await openStart(page);

    // No bar on a flow a member is inside.
    await expect(page.getByTestId('wsf-member-tabs')).toHaveCount(0);

    // One masthead. The shell's stack runs with `headerShown: false`, so the
    // route's own navy header is the only one — two would mean the shell had
    // started drawing a header over a page that already has one.
    //
    // Counted across the WHOLE page, by the wordmark's testID. Scoping this to
    // `wsf-start` could never catch a masthead the shell draws, which is the
    // case that matters; and counting `img` as well double-counts, because the
    // wordmark's testID sits on a wrapper around its own image.
    expect(
      await page.locator('[data-testid*="wordmark"]').count(),
      'the page does not carry exactly one masthead',
    ).toBe(1);

    // No reservation: the scrolling surface runs to the bottom of the
    // viewport. A leftover 62 px strip would end it short.
    const gap = await page.evaluate(() => {
      const scrollers = Array.from(document.querySelectorAll('*')).filter((el) => {
        const cs = getComputedStyle(el);
        return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
      });
      scrollers.sort((a, b) => b.scrollHeight - a.scrollHeight);
      const main = scrollers[0];
      return main ? Math.round(window.innerHeight - main.getBoundingClientRect().bottom) : null;
    });
    expect(gap, 'no scrolling surface found').not.toBeNull();
    expect(gap!, 'a blank strip is still reserved below the page').toBeLessThanOrEqual(2);

    // At rest: wheel-scrolled the way a member scrolls, then measured without
    // touching the page again. Playwright auto-scrolls before it taps, so a
    // passing `.click()` proves nothing about this.
    await fillValid(page, 'Short Phone');
    await wheelUntilInView(page, 'wsf-start-submit');
    const submit = await elementState(page, { testId: 'wsf-start-submit' });
    expect(submit.found).toBe(true);
    expect(submit.inView, 'the submit never came into view').toBe(true);
    expect(submit.covered, 'something covers the submit at rest').toBe(false);
    expect(submit.box.h, 'the submit is under the 44px touch minimum').toBeGreaterThanOrEqual(44);

    // By keyboard: from the name field, Tab reaches the submit, and it is in
    // view when it does. Nothing is pressed — this is reachability, not a
    // create.
    await wheelUntilInView(page, 'wsf-start-name');
    await page.getByTestId('wsf-start-name').focus();
    const field = await elementState(page, { testId: 'wsf-start-name' });
    expect(field.covered, 'the name field is covered while focused').toBe(false);
    expect(field.box.h).toBeGreaterThanOrEqual(44);
    let reached = false;
    for (let i = 0; i < 20 && !reached; i += 1) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') === 'wsf-start-submit',
      );
    }
    expect(reached, 'Tab never reaches the submit').toBe(true);
    await page.getByTestId('wsf-start-submit').scrollIntoViewIfNeeded();
    const focusedSubmit = await elementState(page, { testId: 'wsf-start-submit' });
    expect(focusedSubmit.covered, 'the focused submit is covered').toBe(false);
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
