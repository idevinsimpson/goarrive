import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

import {
  FIRESTORE_EMULATOR,
  PROJECT_ID,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W7 — INDEPENDENT VERIFICATION of W4's `/start-community` implementation at
 * exactly **`0901765`** (PR #447), merged locally onto app-shell `37367fd`
 * and never pushed.
 *
 * THE CONTRACT THIS ROUTE EXISTS TO FIX is the one W7 measured on
 * `/goals/new` (`5787648446`): `wsfCreateCommunity` carries no attempt key, so
 * a retry is a SECOND COMMUNITY rather than a second try at the first. The
 * client may therefore say "nothing was created" only when the SERVER SAID SO
 * — a callable code the server itself named. Every transport failure leaves
 * the outcome genuinely unknown.
 *
 * So the measurements here are the same shape as that check, deliberately:
 * requests are counted as ATTEMPTED and DELIVERED separately, and the server
 * is read back by query rather than inferred from the screen. A screen that
 * says "unconfirmed" proves nothing on its own; what matters is whether a
 * community exists behind it.
 *
 * Verification only: no product file and no test of W4's is edited, no capture
 * is written, and no target is ever called an AFTER.
 */

const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const CREATE = '**/wsfCreateCommunity';

/** A marker only a leak of the server's developer text could put on screen. */
const DEV_TEXT = 'DEV-ONLY-LEAK-MARKER-9f3a';

const UNCONFIRMED_TITLE = 'We couldn’t confirm your community was created.';
const UNCONFIRMED_BODY =
  'It may have been created anyway. Check your communities before you start another one.';
const RETRY_LABEL = 'Start another community';
const RETRY_NOTE =
  'This starts a new, separate community. If the first one was created, you will have two.';

/** Absent from `REFUSAL_COPY` on purpose — every one must read as unconfirmed. */
const TRANSPORT_CODES = [
  'INTERNAL',
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'UNKNOWN',
  'CANCELLED',
  'ABORTED',
  'DATA_LOSS',
] as const;

/** The refusals the callable actually names. */
const NAMED_REFUSALS: Record<string, string> = {
  UNAUTHENTICATED: 'Please sign in again, then try once more.',
  INVALID_ARGUMENT: 'Something about this didn’t look right. Check the details and try again.',
  PERMISSION_DENIED: 'This account can’t start a community.',
  RESOURCE_EXHAUSTED: 'Too many requests in a short time. Wait a moment and try again.',
};

type Person = { uid: string; email: string; password: string };

async function person(tag: string): Promise<Person> {
  const email = `wsf-w7sc-${tag}-${stampId()}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Ada Starter');
  return { uid, email, password };
}

/** What the server actually holds for this account — read, never inferred. */
async function communitiesOf(uid: string): Promise<{ groupId: string; displayName: string }[]> {
  const res = await fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: OWNER,
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
  const body = (await res.json()) as {
    document?: { name?: string; fields?: Record<string, { stringValue?: string }> };
  }[];
  return body
    .filter((r) => r.document)
    .map((r) => ({
      groupId: r.document!.name!.split('/').pop()!,
      displayName: r.document!.fields?.displayName?.stringValue ?? '',
    }));
}

type Counters = { attempted: number; delivered: number };

function counters(page: Page): Counters {
  const c: Counters = { attempted: 0, delivered: 0 };
  page.on('request', (req) => {
    if (req.url().includes('/wsfCreateCommunity') && req.method() === 'POST') c.attempted += 1;
  });
  return c;
}

const isCreate = (route: Route) => route.request().method() === 'POST';

/** Answers the callable with a named status and a developer message. */
async function refuseWith(route: Route, status: string, httpStatus = 400): Promise<void> {
  await route.fulfill({
    status: httpStatus,
    contentType: 'application/json',
    body: JSON.stringify({ error: { status, message: DEV_TEXT } }),
  });
}

async function openForm(page: Page): Promise<void> {
  await page.goto('/start-community');
  await expect(page.getByTestId('wsf-start')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-start-name')).toBeVisible({ timeout: 20_000 });
}

async function fillName(page: Page, name: string): Promise<void> {
  await page.getByTestId('wsf-start-name').fill(name);
}

/** The unconfirmed screen, asserted by its exact words and its exact link. */
async function expectUnconfirmed(page: Page): Promise<void> {
  await expect(page.getByTestId('wsf-start-error')).toHaveText(UNCONFIRMED_BODY, {
    timeout: 25_000,
  });
  await expect(page.getByTestId('wsf-start-outcome-title')).toHaveText(UNCONFIRMED_TITLE);
  // The list, not bare Home — the seam W7 verified for W4 in check 1.
  await expect(page.getByTestId('wsf-start-check-communities')).toHaveAttribute(
    'href',
    '/?view=communities',
  );
  // The retry is demoted and carries its risk.
  await expect(page.getByTestId('wsf-start-submit')).toHaveText(RETRY_LABEL);
  await expect(page.getByTestId('wsf-start-retry-note')).toHaveText(RETRY_NOTE);
  // Nothing the server said reaches the screen.
  expect(await page.locator('body').innerText()).not.toContain(DEV_TEXT);
}

test.describe('W7 — W4 /start-community at 0901765', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /**
   * ITEM 1a — EVERY TRANSPORT CODE IS UNCONFIRMED.
   *
   * These are the codes the SDK raises for a failure that never reached a
   * decision, wearing a server-shaped code. `deadline-exceeded` in particular
   * is exactly the case where the write landed and the answer did not.
   * Treating any of them as a refusal is the defect this route fixes, so all
   * seven are exercised rather than a representative one.
   */
  for (const code of TRANSPORT_CODES) {
    test(`transport code ${code} reads as unconfirmed, and leaks no developer text`, async ({
      page,
    }) => {
      test.setTimeout(150_000);
      const me = await person('t');
      const c = counters(page);
      await page.route(CREATE, async (route: Route) => {
        if (!isCreate(route)) return route.continue();
        c.delivered += 1;
        await refuseWith(route, code);
      });

      await signInVia(page, me.email, me.password);
      await openForm(page);
      await fillName(page, `W7 ${code}`);
      await page.getByTestId('wsf-start-submit').click();

      await expectUnconfirmed(page);
      // It claims nothing in either direction: no "nothing was created".
      expect(await page.locator('body').innerText()).not.toMatch(/nothing was created/i);
      expect(c).toEqual({ attempted: 1, delivered: 1 });
    });
  }

  /**
   * ITEM 1b — A NAMED REFUSAL IS A REFUSAL, and still never renders the
   * server's own words.
   */
  test('each named refusal renders its own copy, never the server text', async ({ page }) => {
    test.setTimeout(200_000);
    const me = await person('r');
    let current = 'UNAUTHENTICATED';
    await page.route(CREATE, async (route: Route) => {
      if (!isCreate(route)) return route.continue();
      await refuseWith(route, current);
    });
    await signInVia(page, me.email, me.password);

    for (const [code, copy] of Object.entries(NAMED_REFUSALS)) {
      current = code;
      await openForm(page);
      await fillName(page, `W7 refusal ${code}`);
      await page.getByTestId('wsf-start-submit').click();

      await expect(page.getByTestId('wsf-start-error'), `${code} did not render its own copy`)
        .toHaveText(copy, { timeout: 25_000 });
      expect(await page.locator('body').innerText(), `${code} leaked the server text`)
        .not.toContain(DEV_TEXT);
      // A refusal is not the unconfirmed screen.
      await expect(page.getByTestId('wsf-start-check-communities')).toHaveCount(0);
      await expect(page.getByTestId('wsf-start-retry-note')).toHaveCount(0);
    }

    expect(await communitiesOf(me.uid), 'a refused create made a community').toHaveLength(0);
  });

  /**
   * ITEM 2 — RESPONSE LOST. The transaction commits, the reply is discarded,
   * and the screen says it cannot confirm — while the community EXISTS. The
   * server's own reply is captured before it is dropped, so the commit is
   * stated rather than inferred.
   */
  test('a lost response leaves exactly one community, and a screen that claims nothing', async ({
    page,
  }) => {
    test.setTimeout(200_000);
    const me = await person('lost');
    const c = counters(page);
    const replies: { status: number; body: string }[] = [];
    await page.route(CREATE, async (route: Route) => {
      if (!isCreate(route)) return route.continue();
      c.delivered += 1;
      const response = await route.fetch();
      replies.push({ status: response.status(), body: await response.text() });
      await route.abort('failed');
    });

    await signInVia(page, me.email, me.password);
    await openForm(page);
    await fillName(page, 'W7 lost response');
    await page.getByTestId('wsf-start-submit').click();

    await expectUnconfirmed(page);

    expect(replies, 'the callable was asked exactly once').toHaveLength(1);
    expect(replies[0]!.status, 'the callable did not return a success').toBe(200);

    const stored = await communitiesOf(me.uid);
    expect(stored, 'the committed community is missing from the server').toHaveLength(1);
    expect(stored[0]!.displayName).toBe('W7 lost response');
    expect(replies[0]!.body, 'the reply named a different community').toContain(stored[0]!.groupId);
    expect(c).toEqual({ attempted: 1, delivered: 1 });
  });

  /**
   * ITEM 3 — THE DELIBERATE RETRY REALLY DOES MAKE A SECOND COMMUNITY.
   *
   * The control is allowed to exist — the first one may genuinely not have
   * been created — but it must announce what it does, and then do exactly
   * that. Both communities below are made by pressing the screen's own
   * control; nothing is written behind the interface.
   */
  test('the demoted retry creates a genuine second community', async ({ page }) => {
    test.setTimeout(220_000);
    const me = await person('retry');
    const c = counters(page);
    let dropNext = true;
    await page.route(CREATE, async (route: Route) => {
      if (!isCreate(route)) return route.continue();
      c.delivered += 1;
      if (!dropNext) return route.continue();
      await route.fetch();
      dropNext = false;
      await route.abort('failed');
    });

    await signInVia(page, me.email, me.password);
    await openForm(page);
    await fillName(page, 'W7 retried community');
    await page.getByTestId('wsf-start-submit').click();
    await expectUnconfirmed(page);
    expect(await communitiesOf(me.uid), 'the first press did not commit').toHaveLength(1);

    // A create that succeeds NAVIGATES; the "ready" card is the screen shown
    // only when the navigation itself fails. So the success is read from the
    // route it reaches and from the server, not from that card.
    await page.getByTestId('wsf-start-submit').click();
    await page.waitForURL(/\/community\/[^/]+$/, { timeout: 25_000 });

    const stored = await communitiesOf(me.uid);
    expect(stored, 'the retry did not produce a second community').toHaveLength(2);
    expect(stored.map((s) => s.displayName)).toEqual([
      'W7 retried community',
      'W7 retried community',
    ]);
    expect(new Set(stored.map((s) => s.groupId)).size, 'the two rows are one community').toBe(2);
    expect(c).toEqual({ attempted: 2, delivered: 2 });
  });

  /**
   * ITEM 4 — THE PROFILE REFUSAL. Nothing created, the create control gone,
   * the way out is the real profile route, and nothing is promised that does
   * not exist.
   */
  test('failed-precondition blocks creation, removes the control and points at the profile', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const me = await person('prof');
    await page.route(CREATE, async (route: Route) => {
      if (!isCreate(route)) return route.continue();
      await refuseWith(route, 'FAILED_PRECONDITION');
    });

    await signInVia(page, me.email, me.password);
    await openForm(page);
    await fillName(page, 'W7 profile blocked');
    await page.getByTestId('wsf-start-submit').click();

    await expect(page.getByTestId('wsf-start-error')).toHaveText(
      'Complete your profile before creating a community.',
      { timeout: 25_000 },
    );
    // The control is gone, not merely disabled.
    await expect(page.getByTestId('wsf-start-submit')).toHaveCount(0);
    await expect(page.getByTestId('wsf-start-profile')).toBeVisible();
    await expect(page.getByTestId('wsf-start-profile')).toHaveAttribute('href', '/profile-setup');
    // No promise of a return trip or a saved draft, because neither exists.
    const body = await page.locator('body').innerText();
    expect(body, 'the screen promised a return that does not exist').not.toMatch(
      /come back|return here|we.ll bring you back|saved|draft/i,
    );
    expect(body).not.toContain(DEV_TEXT);
    expect(await communitiesOf(me.uid)).toHaveLength(0);
  });

  /**
   * ITEM 5 — THE NAME WINDOW NEVER LEAVES THE BROWSER. Both ends are checked
   * against the TRIMMED value, which is what the callable receives, and the
   * long message carries the count.
   */
  test('a too-short and a too-long name are refused without a request', async ({ page }) => {
    test.setTimeout(180_000);
    const me = await person('name');
    const c = counters(page);
    await page.route(CREATE, async (route: Route) => {
      if (!isCreate(route)) return route.continue();
      c.delivered += 1;
      await route.continue();
    });

    await signInVia(page, me.email, me.password);
    await openForm(page);

    // Too short — one character, and whitespace does not rescue it.
    await fillName(page, 'a');
    await page.getByTestId('wsf-start-submit').click();
    await expect(page.getByTestId('wsf-start-name-error')).toHaveText(
      'Give your community a name.',
      { timeout: 20_000 },
    );
    await expect(page.getByTestId('wsf-start-name')).toBeFocused();

    // Too long — 84 characters, and the message says how many.
    const long = 'x'.repeat(84);
    await fillName(page, long);
    await page.getByTestId('wsf-start-submit').click();
    await expect(page.getByTestId('wsf-start-name-error')).toHaveText(
      'Use 80 characters or fewer. This name is 84.',
      { timeout: 20_000 },
    );
    await expect(page.getByTestId('wsf-start-name')).toBeFocused();

    expect(c, 'a name the browser refused still reached the server').toEqual({
      attempted: 0,
      delivered: 0,
    });
    expect(await communitiesOf(me.uid)).toHaveLength(0);
  });

  /**
   * ITEM 6 — TWO TAPS, ONE COMMUNITY. The guard is a ref rather than state
   * precisely because two taps inside one frame both read `submitting ===
   * false`, so the taps are dispatched in a single JS task rather than as two
   * sequential Playwright clicks, which the disabled state alone would stop.
   */
  test('two taps in one frame create exactly one community', async ({ page }) => {
    test.setTimeout(200_000);
    const me = await person('double');
    const c = counters(page);
    await page.route(CREATE, async (route: Route) => {
      if (!isCreate(route)) return route.continue();
      c.delivered += 1;
      // Held open, so a second create would have every chance to be issued.
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });

    await signInVia(page, me.email, me.password);
    await openForm(page);
    await fillName(page, 'W7 double tap');

    const dispatched = await page.getByTestId('wsf-start-submit').evaluate((el) => {
      const node = el as HTMLElement;
      node.click();
      node.click();
      return 2;
    });
    expect(dispatched).toBe(2);

    await page.waitForURL(/\/community\/[^/]+$/, { timeout: 25_000 });
    const stored = await communitiesOf(me.uid);
    expect(stored, 'two taps in one frame made two communities').toHaveLength(1);
    expect(c.delivered, 'a second create reached the server').toBe(1);
  });

  /**
   * ITEM 7 (part) — CREATED IS NOT NAVIGATED. A success that cannot be opened
   * must still read as created, with an Open that re-navigates and never
   * creates again. Driven through the route's own "server said yes but gave
   * us nothing to open" path, which is the reachable half of this property.
   */
  test('a success with an unusable id reads as unconfirmed, not as a refusal', async ({ page }) => {
    test.setTimeout(180_000);
    const me = await person('badid');
    const c = counters(page);
    await page.route(CREATE, async (route: Route) => {
      if (!isCreate(route)) return route.continue();
      c.delivered += 1;
      // A 200 the route cannot navigate to: an id with a path separator.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ result: { groupId: 'not/usable' } }),
      });
    });

    await signInVia(page, me.email, me.password);
    await openForm(page);
    await fillName(page, 'W7 unusable id');
    await page.getByTestId('wsf-start-submit').click();

    // Unconfirmed, not refused: the community very likely exists.
    await expectUnconfirmed(page);
    await expect(page.getByTestId('wsf-start-created')).toHaveCount(0);
    expect(c).toEqual({ attempted: 1, delivered: 1 });
  });

  /**
   * ITEM 8 — UNMOUNT MID-FLIGHT PAINTS NOTHING. The member leaves while the
   * create is out; the settled call must not write onto the page they landed
   * on.
   */
  test('leaving mid-flight paints no outcome on the next page', async ({ page }) => {
    test.setTimeout(200_000);
    const me = await person('unmount');
    await page.route(CREATE, async (route: Route) => {
      if (!isCreate(route)) return route.continue();
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      await route.continue();
    });

    await signInVia(page, me.email, me.password);
    await openForm(page);
    await fillName(page, 'W7 unmounted');
    await page.getByTestId('wsf-start-submit').click();
    // Leave while it is still out.
    await page.getByTestId('wsf-start-back').click();
    await page.waitForURL(/\/$/, { timeout: 20_000 });

    // Let the call settle on the page the member is now on.
    await page.waitForTimeout(4_000);

    /*
      MEASURED, NOT ASSUMED. Expo Router RETAINS the previous screen in its
      stack rather than unmounting it, so the settled create does write its
      outcome onto that retained screen and `wsf-start-created` is present in
      the document. It is NOT VISIBLE, and none of it reaches the page the
      member is actually looking at — which is what the property asks.
      Asserting absence from the DOM would therefore fail on a route that is
      behaving correctly, so the assertion is on what is PAINTED.
    */
    for (const id of ['wsf-start-outcome', 'wsf-start-created', 'wsf-start-error']) {
      const el = page.getByTestId(id);
      if ((await el.count()) > 0) {
        expect(await el.isVisible(), `${id} is painted on the replacing page`).toBe(false);
      }
    }
    const body = await page.locator('body').innerText();
    expect(body).not.toContain(UNCONFIRMED_TITLE);
    expect(body).not.toContain('Your community is ready.');
    expect(body).not.toContain(DEV_TEXT);
    // And the replacing page is genuinely the one in front of the member.
    expect(new URL(page.url()).pathname, 'the member did not leave the form').not.toBe(
      '/start-community',
    );
  });
});
