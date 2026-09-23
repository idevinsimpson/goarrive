import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

import {
  AUTH_EMULATOR,
  FIRESTORE_EMULATOR,
  PROJECT_ID,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W7 — THE BOUNDED COLOUR DELTA on W4's `/start-community`, at exactly
 * **`d467754`** (PR #447), with `0901765` as the discrimination head.
 *
 * ROUTED by L0 `5796309092` on the Director's `5796296396`. The functional
 * gate on `0901765` is ACCEPTED (`5796186487`) and is carried forward here
 * rather than re-litigated; what is new is one claim and one claim only:
 *
 *   a primary action on this route is ACTION GREEN, including when it is a
 *   link, and nothing else moved to make that true.
 *
 * WHY THIS IS A RENDER TEST AND NOT A DIFF READ. The diff says the four
 * `ButtonLink`s now take a local `action.primary` carrying `ACTION_GREEN`.
 * That is a statement about source. It is not a statement about pixels: on
 * web, `Link asChild` merges the child's style by OBJECT SPREAD, so an array
 * style silently becomes `{0: …, 1: …}` and paints nothing — `ButtonLink`'s
 * own comment records that exact failure. A local style can also be shadowed
 * by a later prop, and `#22C55E` at 60% opacity is not `#22C55E`. So every
 * assertion below reads `getComputedStyle` off the element the member would
 * actually press.
 *
 * AND WHY THE WRONG GREEN IS NAMED, NOT MERELY EXCLUDED. Board 00 gives
 * #22C55E to primary actions and #91CB7D to confirmed progress. The defect was
 * not "no green"; it was the PROGRESS green on an ACTION. A test that accepted
 * "some green" would have passed on the broken head, so each control asserts
 * the action green positively AND names the progress green as forbidden.
 *
 * GROUPS. `NEW` is what only `d467754` can satisfy — run against `0901765`
 * every test in it must fail, and the report records that it did.
 * `PRESERVED` is true on both heads by design; it is here to catch a colour
 * correction that quietly cost behaviour, and it proves nothing about the
 * commit on its own. The report says which is which rather than reporting a
 * single count.
 *
 * Verification only: no product file and no test of W4's is edited, no capture
 * is written, and no frame is rebaselined.
 */

/* ── the two greens, as a browser reports them ───────────────────────────── */

/** `ACTION_GREEN` — kit.ts:48, #22C55E. What a primary action must be. */
const ACTION_GREEN_RGB = 'rgb(34, 197, 94)';
/** `PROGRESS_GREEN` — brandAssets.ts:25, #91CB7D. The defect's colour. */
const PROGRESS_GREEN_RGB = 'rgb(145, 203, 125)';
/** The ink on an action green fill — `#04260F`, shared with `SubmitButton`. */
const ACTION_TEXT_RGB = 'rgb(4, 38, 15)';
/** `NAVY` — theme.ts, #0B1F3A. The tertiary control's ink. */
const NAVY_RGB = 'rgb(11, 31, 58)';
/** No fill at all, which is what a tertiary control has. */
const NO_FILL_RGB = 'rgba(0, 0, 0, 0)';

const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const CREATE = '**/wsfCreateCommunity';
const DEV_TEXT = 'DEV-ONLY-LEAK-MARKER-9f3a';

/* ── people ──────────────────────────────────────────────────────────────── */

type Person = { uid: string; email: string; password: string };

function credentials(tag: string): { email: string; password: string } {
  return {
    email: `wsf-w7cd-${tag}-${stampId()}@example.com`,
    password: `Aa1!${randomBytes(6).toString('hex')}`,
  };
}

async function verifiedPerson(tag: string): Promise<Person> {
  const { email, password } = credentials(tag);
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Ada Starter');
  return { uid, email, password };
}

/**
 * A real account that has NOT verified its email — the state the unverified
 * gate exists for. `seedVerifiedUser` flips the flag on; this deliberately
 * stops one step short of that, so the gate is reached the way a member
 * reaches it rather than by forcing the screen.
 */
async function unverifiedPerson(tag: string): Promise<Person> {
  const { email, password } = credentials(tag);
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,
    {
      method: 'POST',
      headers: OWNER,
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  if (!res.ok) throw new Error(`emulator signUp failed: ${res.status} ${await res.text()}`);
  const { localId } = (await res.json()) as { localId: string };
  await seedProfile(localId, 'Ada Unverified');
  return { uid: localId, email, password };
}

/**
 * Sign in without asserting where the app lands. `signInVia` waits for `/` or
 * `/profile-setup`, which an unverified account never reaches; this only needs
 * the session, and the test navigates itself afterwards.
 */
async function signInLoosely(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 20_000 });
}

/* ── what the browser actually painted ───────────────────────────────────── */

type Paint = {
  background: string;
  /** Every colour in the control's own subtree, the label's included. */
  inks: string[];
  radius: string;
  height: number;
  width: number;
  opacity: string;
};

/**
 * MEASURED ON THE ELEMENT THE MEMBER PRESSES. `getComputedStyle` resolves the
 * cascade, so a style that was dropped, flattened away or overridden reports
 * the value that actually reached the screen rather than the one the source
 * asked for. `inks` collects the subtree because RN Web puts a `Text`'s colour
 * on a child node, not on the pressable itself.
 */
async function paintOf(page: Page, testId: string): Promise<Paint> {
  const el = page.getByTestId(testId);
  await expect(el, `${testId} never rendered`).toBeVisible({ timeout: 25_000 });
  return el.evaluate((node) => {
    const root = node as HTMLElement;
    const cs = getComputedStyle(root);
    const box = root.getBoundingClientRect();
    const inks = new Set<string>();
    inks.add(getComputedStyle(root).color);
    root.querySelectorAll('*').forEach((child) => {
      inks.add(getComputedStyle(child as HTMLElement).color);
    });
    return {
      background: cs.backgroundColor,
      inks: [...inks],
      radius: cs.borderTopLeftRadius,
      height: box.height,
      width: box.width,
      opacity: cs.opacity,
    };
  });
}

/**
 * THE ACTION-GREEN GATE, applied identically to each of the four controls.
 *
 * The opacity check is not decoration: a fill of #22C55E at 0.6 reports
 * `rgb(34, 197, 94)` for `background-color` while painting something else
 * entirely, so the colour claim is only honest alongside it.
 */
async function expectActionGreen(page: Page, testId: string): Promise<Paint> {
  const p = await paintOf(page, testId);
  expect(p.background, `${testId} is not action green`).toBe(ACTION_GREEN_RGB);
  expect(p.background, `${testId} still paints the PROGRESS green on an ACTION`).not.toBe(
    PROGRESS_GREEN_RGB,
  );
  expect(p.opacity, `${testId} is action green but not at full opacity`).toBe('1');
  expect(p.inks, `${testId} does not carry the ink that belongs on an action fill`).toContain(
    ACTION_TEXT_RGB,
  );
  return p;
}

/** Everything that makes a primary look like a primary, not just its fill. */
type Treatment = Paint & { shadow: string };

async function treatmentOf(page: Page, testId: string): Promise<Treatment> {
  const p = await paintOf(page, testId);
  const shadow = await page
    .getByTestId(testId)
    .evaluate((node) => getComputedStyle(node as HTMLElement).boxShadow);
  return { ...p, shadow };
}

/* ── fixtures for the two outcome states ─────────────────────────────────── */

const isCreate = (route: Route) => route.request().method() === 'POST';

async function refuseWith(route: Route, status: string): Promise<void> {
  await route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ error: { status, message: DEV_TEXT } }),
  });
}

async function openForm(page: Page): Promise<void> {
  await page.goto('/start-community');
  await expect(page.getByTestId('wsf-start')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-start-name')).toBeVisible({ timeout: 20_000 });
}

async function submitNamed(page: Page, name: string): Promise<void> {
  await page.getByTestId('wsf-start-name').fill(name);
  await page.getByTestId('wsf-start-submit').click();
}

/** What the server actually holds — read, never inferred from the screen. */
async function communitiesOf(uid: string): Promise<string[]> {
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
  const body = (await res.json()) as { document?: { name?: string } }[];
  return body.filter((r) => r.document).map((r) => r.document!.name!.split('/').pop()!);
}

/* ════════════════════════════════════════════════════════════════════════ */

test.describe('W7 NEW — the four route controls render action green at d467754', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** CONTROL 1 of 4 — the signed-out gate's only way forward. */
  test('wsf-start-signed-out-signin is action green', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/start-community');
    await expect(page.getByTestId('wsf-start-signed-out')).toBeVisible({ timeout: 25_000 });

    const p = await expectActionGreen(page, 'wsf-start-signed-out-signin');
    // A link that lays out like a button, which is the whole point of the fix.
    expect(p.height, 'the signed-out primary is not a button-sized target').toBeGreaterThanOrEqual(
      52,
    );
    expect(p.radius).toBe('16px');
    // It is still a link, not a repainted div with no destination.
    await expect(page.getByTestId('wsf-start-signed-out-signin')).toHaveAttribute(
      'href',
      '/signin',
    );
  });

  /** CONTROL 2 of 4 — the unverified gate, reached by a real unverified account. */
  test('wsf-start-unverified-verify is action green', async ({ page }) => {
    test.setTimeout(150_000);
    const me = await unverifiedPerson('unver');
    await signInLoosely(page, me.email, me.password);

    await page.goto('/start-community');
    await expect(page.getByTestId('wsf-start-unverified')).toBeVisible({ timeout: 25_000 });

    const p = await expectActionGreen(page, 'wsf-start-unverified-verify');
    expect(p.height).toBeGreaterThanOrEqual(52);
    await expect(page.getByTestId('wsf-start-unverified-verify')).toHaveAttribute(
      'href',
      '/verify-email',
    );
  });

  /**
   * CONTROL 3 of 4 — the profile refusal. `failed-precondition` is the one
   * refusal that hands the member somewhere else to go, and it is the state in
   * which the create control is REMOVED, so this link is the only action on
   * the screen. A primary in the wrong green is most misleading precisely
   * here.
   */
  test('wsf-start-profile is action green', async ({ page }) => {
    test.setTimeout(150_000);
    const me = await verifiedPerson('prof');
    await page.route(CREATE, async (route: Route) => {
      if (!isCreate(route)) return route.continue();
      await refuseWith(route, 'FAILED_PRECONDITION');
    });

    await signInVia(page, me.email, me.password);
    await openForm(page);
    await submitNamed(page, 'W7 colour profile');

    const p = await expectActionGreen(page, 'wsf-start-profile');
    expect(p.height).toBeGreaterThanOrEqual(52);
    await expect(page.getByTestId('wsf-start-profile')).toHaveAttribute('href', '/profile-setup');
    // PRESERVED alongside it: the terminal refusal still takes the create away.
    await expect(page.getByTestId('wsf-start-submit')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain(DEV_TEXT);
  });

  /** CONTROL 4 of 4 — the unconfirmed outcome's "check your communities". */
  test('wsf-start-check-communities is action green', async ({ page }) => {
    test.setTimeout(150_000);
    const me = await verifiedPerson('unconf');
    await page.route(CREATE, async (route: Route) => {
      if (!isCreate(route)) return route.continue();
      await refuseWith(route, 'INTERNAL');
    });

    await signInVia(page, me.email, me.password);
    await openForm(page);
    await submitNamed(page, 'W7 colour unconfirmed');

    const p = await expectActionGreen(page, 'wsf-start-check-communities');
    expect(p.height).toBeGreaterThanOrEqual(52);
    await expect(page.getByTestId('wsf-start-check-communities')).toHaveAttribute(
      'href',
      '/?view=communities',
    );
  });

  /**
   * THE FOUR ARE THE WHOLE SET, AND NOTHING ELSE ON THE ROUTE STILL WEARS THE
   * OLD GREEN. A correction that repainted three of four would pass every test
   * above, so the screen is swept rather than sampled.
   *
   * SCOPED TO THE ROUTE'S OWN SUBTREE, on measurement. The first version of
   * this test swept the whole document and failed, reporting a second action
   * green fill on `wsf-member-tab-move` — the member shell's raised MOVE
   * action, which is a primary and is CORRECTLY action green. That is the app
   * shell W4 does not own and this packet does not route, so the census now
   * asks the question it meant to ask: inside `wsf-start`, which controls are
   * filled green. The shell's own value is asserted separately below, because
   * a sweep that found nothing would otherwise be indistinguishable from a
   * sweep that did not work.
   */
  test('no fifth control on the route wears a green fill', async ({ page }) => {
    test.setTimeout(150_000);
    const me = await verifiedPerson('fifth');
    await page.route(CREATE, async (route: Route) => {
      if (!isCreate(route)) return route.continue();
      await refuseWith(route, 'INTERNAL');
    });
    await signInVia(page, me.email, me.password);
    await openForm(page);
    await submitNamed(page, 'W7 colour census');
    await expect(page.getByTestId('wsf-start-check-communities')).toBeVisible({ timeout: 25_000 });

    const sweep = await page.evaluate(
      ([action, progress]) => {
        const fills = (scope: ParentNode | null) => {
          const found: { testId: string | null; background: string }[] = [];
          if (!scope) return found;
          scope.querySelectorAll('*').forEach((n) => {
            const bg = getComputedStyle(n as HTMLElement).backgroundColor;
            if (bg === action || bg === progress) {
              found.push({ testId: (n as HTMLElement).dataset.testid ?? null, background: bg });
            }
          });
          return found;
        };
        return {
          route: fills(document.querySelector('[data-testid="wsf-start"]')),
          document: fills(document),
        };
      },
      [ACTION_GREEN_RGB, PROGRESS_GREEN_RGB],
    );

    // NOWHERE ON THE PAGE — shell included — may anything still FILL with the
    // progress green. This half is deliberately unscoped: it is the defect.
    expect(
      sweep.document.filter((g) => g.background === PROGRESS_GREEN_RGB),
      'something on this page still fills with the progress green',
    ).toEqual([]);
    // Inside the route, the action green appears exactly where it was routed.
    expect(sweep.route.map((g) => g.testId).sort()).toEqual(['wsf-start-check-communities']);
    // And the sweep demonstrably finds green when green is there: the shell's
    // own raised MOVE action is a primary, and is correctly action green.
    expect(
      sweep.document.find((g) => g.testId === 'wsf-member-tab-move')?.background,
      'the sweep did not find the shell action it is calibrated against',
    ).toBe(ACTION_GREEN_RGB);
  });

  /**
   * MEASURED, NOT A VERDICT — THE DELTA IS NOT COLOUR ONLY.
   *
   * The re-shot AFTER frames say so before this test does: decoded, the
   * control keeps its width and its (x, y) on both heads, and is TWO PIXELS
   * SHORTER — a 350x54 progress-green block at 0901765 becomes a 350x52
   * action-green block at d467754, at the same origin. Source agrees:
   * `kit.primaryButton` is `borderRadius: 14, minHeight: 54` with no shadow,
   * and the local `action.primary` is `borderRadius: 16, minHeight: 52` plus
   * `elevation.action`.
   *
   * That is coherent rather than careless: those are `SubmitButton`'s own
   * primary values, so the four links did not get a second invented treatment,
   * they got the treatment Create community already had. This test pins that
   * down — every one of the four must match `wsf-start-submit` on fill, ink,
   * height, radius AND shadow — so that "they were recoloured" cannot quietly
   * mean "they each drifted somewhere of their own".
   *
   * Whether a 2px height change and a new shadow belong inside a delta routed
   * as a colour delta is the Director's call. W7 measures it and says so.
   */
  test('the four links now carry SubmitButton\'s own primary treatment, exactly', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const me = await verifiedPerson('same');
    await page.route(CREATE, async (route: Route) => {
      if (!isCreate(route)) return route.continue();
      await refuseWith(route, 'INTERNAL');
    });
    await signInVia(page, me.email, me.password);
    await openForm(page);

    // The button primary, read first — it is the reference, not a constant.
    const reference = await treatmentOf(page, 'wsf-start-submit');
    expect(reference.background).toBe(ACTION_GREEN_RGB);
    expect(reference.height).toBe(52);
    expect(reference.radius).toBe('16px');
    expect(reference.shadow, 'the reference primary has no shadow to match').not.toBe('none');

    await submitNamed(page, 'W7 colour sameness');
    await expect(page.getByTestId('wsf-start-check-communities')).toBeVisible({ timeout: 25_000 });

    const link = await treatmentOf(page, 'wsf-start-check-communities');
    expect(link.background).toBe(reference.background);
    expect(link.height).toBe(reference.height);
    expect(link.radius).toBe(reference.radius);
    expect(link.shadow, 'the link primary does not carry the button primary\'s shadow').toBe(
      reference.shadow,
    );
    expect(link.inks).toContain(ACTION_TEXT_RGB);
  });
});

test.describe('W7 PRESERVED — SubmitButton, retry and behaviour are unmoved', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /**
   * `SubmitButton`'s primary was ALREADY correct, which is why Create
   * community needed no change. Asserted here so "the four links were fixed"
   * cannot quietly mean "and the button drifted to match them".
   */
  test('wsf-start-submit is the same action green it already was', async ({ page }) => {
    test.setTimeout(120_000);
    const me = await verifiedPerson('submit');
    await signInVia(page, me.email, me.password);
    await openForm(page);

    const p = await paintOf(page, 'wsf-start-submit');
    expect(p.background).toBe(ACTION_GREEN_RGB);
    expect(p.inks).toContain(ACTION_TEXT_RGB);
    expect(p.height).toBeGreaterThanOrEqual(52);
    expect(p.opacity).toBe('1');
  });

  /**
   * THE RETRY IS STILL DEMOTED. A route that has just learned to paint
   * primaries green is exactly where a risky retry could acquire a green fill
   * by accident — and this retry can create a SECOND community, so it must
   * stay the quiet text control.
   */
  test('the retry in the unconfirmed state is tertiary, not a second primary', async ({ page }) => {
    test.setTimeout(150_000);
    const me = await verifiedPerson('retry');
    await page.route(CREATE, async (route: Route) => {
      if (!isCreate(route)) return route.continue();
      await refuseWith(route, 'DEADLINE_EXCEEDED');
    });

    await signInVia(page, me.email, me.password);
    await openForm(page);
    await submitNamed(page, 'W7 colour retry');
    await expect(page.getByTestId('wsf-start-retry-note')).toBeVisible({ timeout: 25_000 });

    const p = await paintOf(page, 'wsf-start-submit');
    expect(p.background, 'the retry acquired a fill').toBe(NO_FILL_RGB);
    expect(p.background).not.toBe(ACTION_GREEN_RGB);
    expect(p.inks, 'the retry is not the navy text control').toContain(NAVY_RGB);
    expect(p.inks, 'the retry wears the ink of a filled primary').not.toContain(ACTION_TEXT_RGB);
    // 44, not 52: the tertiary treatment, still a real touch target.
    expect(p.height).toBeGreaterThanOrEqual(44);
    expect(p.height).toBeLessThan(52);
    await expect(page.getByTestId('wsf-start-submit')).toHaveText('Start another community');
  });

  /**
   * AND THE BEHAVIOUR THE COLOUR SITS ON. The accepted functional gate is
   * carried forward at its narrowest useful point: one press, one delivered
   * call, exactly ONE community on the server, and the navigation that
   * follows. A repaint that cost a create would pass every colour test above.
   */
  test('a create still makes exactly one community and navigates', async ({ page }) => {
    test.setTimeout(180_000);
    const me = await verifiedPerson('behave');
    let delivered = 0;
    page.on('request', (req) => {
      if (req.url().includes('/wsfCreateCommunity') && req.method() === 'POST') delivered += 1;
    });

    await signInVia(page, me.email, me.password);
    await openForm(page);
    await submitNamed(page, 'W7 colour behaviour');

    await page.waitForURL(/\/community\/[^/]+$/, { timeout: 30_000 });
    const stored = await communitiesOf(me.uid);
    expect(stored, 'one press did not leave exactly one community').toHaveLength(1);
    expect(delivered, 'one press sent more than one create').toBe(1);
    expect(page.url()).toContain(`/community/${stored[0]}`);
  });
});
