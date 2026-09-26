import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

import { seedVerifiedUser, stampId } from './helpers/mobile';

/**
 * ACTUAL AFTER for Atlas Batch A — identity and onboarding.
 *
 * Real screenshots of the rebuilt product. Nothing here is drawn, and no
 * frame carries a TARGET strip: these are not targets.
 *
 * THE FIXTURES ARE NOT LIFTED FROM THE BEFORE SPEC, AND THAT IS DELIBERATE.
 * Its two "return" states seed `wsf.pendingJoinCode = 'ABC123'` and a key
 * called `wsf.pendingEventGoalId`. Neither reaches the product:
 *
 *   · `isValidShape` in pendingJoinCode.ts requires 16-128 characters, so a
 *     six-character code is refused on read.
 *   · The event return is stored under `wsf.eventReturn`, as a JSON record
 *     `{goalId, at}` — `wsf.pendingEventGoalId` is not read by anything.
 *
 * So those frozen BEFORE frames show a sign-in screen with no destination
 * because the fixture never took effect, not because the old screen resolved
 * one and declined to say so. (The old screen did say nothing either way, so
 * the frames are still true about the product — but a fixture that silently
 * does nothing must not be carried into the AFTER, where the whole point is
 * that the destination now appears.) This spec uses shapes the product
 * accepts, and asserts the card is actually on screen before the shutter.
 *
 * OUTCOMES ARE PINNED, NOT RACED. The BEFORE capture let the verification
 * send resolve however it happened to, and caught `sending` at two classes
 * and `unconfigured` at a third in the SAME run. Every outcome here is
 * fulfilled by an intercept, so a frame means the state it is named after.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/batch-a-identity/after');

const CLASSES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
  { key: '430x932', width: 430, height: 932 },
];

/** A join code of the shape `isValidShape` accepts: 16-128 of [A-Za-z0-9_-]. */
const JOIN_CODE = 'HARBOR7WALKERSINVITE01';
const EVENT_GOAL = 'goal-demo-event-1';
const KIOSK_GOAL = 'goal-demo-kiosk-1';

const CAPTURE = /^(1|true)$/i.test(process.env.WSF_CAPTURE_FRAMES ?? '');
test.skip(
  !CAPTURE,
  'AFTER frames are committed evidence; set WSF_CAPTURE_FRAMES=1 to re-baseline them deliberately.',
);

async function ctx(browser: Browser, c: { width: number; height: number }) {
  return browser.newContext({
    viewport: { width: c.width, height: c.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
}

/**
 * The shutter, with the chrome asserted first.
 *
 * Every one of these screens must show the wordmark and the heading wholly
 * inside the viewport at scroll zero. A frame that lost either is a frame of
 * a screen the product should never render, and finding that out by looking
 * at a PNG afterwards is exactly what an assertion is for.
 */
async function shoot(page: Page, name: string, key: string, screenId: string) {
  const viewport = page.viewportSize()!;
  for (const [label, locator] of [
    ['the wordmark', page.getByTestId('wsf-form-wordmark')],
    ['the screen', page.getByTestId(screenId)],
  ] as const) {
    await expect(locator, `${name}: ${label} is not visible`).toBeVisible();
  }
  const mark = (await page.getByTestId('wsf-form-wordmark').boundingBox())!;
  expect(mark.y, `${name}: the wordmark is above the viewport`).toBeGreaterThanOrEqual(0);
  expect(
    mark.y + mark.height,
    `${name}: the wordmark runs past the bottom of the viewport`
  ).toBeLessThanOrEqual(viewport.height + 1);
  expect(mark.x, `${name}: the wordmark is off the left edge`).toBeGreaterThanOrEqual(0);
  expect(
    mark.x + mark.width,
    `${name}: the wordmark runs past the right edge`
  ).toBeLessThanOrEqual(viewport.width + 1);

  // No horizontal page scroll at any class.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, `${name}: the page scrolls sideways`).toBeLessThanOrEqual(1);

  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `AFTER-${name}-${key}.png`) });
}

/** Seed a pending destination before first render, the way the product stores it. */
async function seedDestination(
  page: Page,
  kind: 'join' | 'event' | 'kiosk',
  value: string
): Promise<void> {
  await page.addInitScript(
    ([k, v]: [string, string]) => {
      try {
        if (k === 'join') window.sessionStorage.setItem('wsf.pendingJoinCode', v);
        if (k === 'event') {
          window.sessionStorage.setItem(
            'wsf.eventReturn',
            JSON.stringify({ goalId: v, at: Date.now() })
          );
        }
        if (k === 'kiosk') window.sessionStorage.setItem('wsf.kioskReturnGoalId', v);
      } catch {
        // storage blocked simply means no pending destination
      }
    },
    [kind, value] as [string, string]
  );
}

async function pinVerificationSend(page: Page, how: 'sent' | 'unconfigured'): Promise<void> {
  await page.route('**/wsfSendVerificationEmail**', (route: Route) =>
    how === 'sent'
      ? route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ result: { sent: true } }),
        })
      : route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              status: 'FAILED_PRECONDITION',
              message: 'WSF email sending is not configured.',
            },
          }),
        })
  );
}

async function signUpUnverified(page: Page, label: string): Promise<void> {
  await page.goto('/signup');
  await expect(page.getByTestId('wsf-signup')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wsf-signup-displayName').fill('Devin');
  await page.getByTestId('wsf-signup-email').fill(`wsf-${label}-${stampId()}@example.com`);
  await page.getByTestId('wsf-signup-password').fill(`Pw-${randomBytes(9).toString('base64url')}`);
  await page.getByTestId('wsf-signup-submit').click();
}

for (const c of CLASSES) {
  test(`Batch A AFTER — ${c.key}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const tag = `ba${c.key.replace('x', '')}`;

    /* ── the three a signed-out visitor reaches directly ────────────────── */
    {
      const context = await ctx(browser, c);
      const page = await context.newPage();
      await page.goto('/signin');
      await expect(page.getByTestId('wsf-signin')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'signin', c.key, 'wsf-signin');

      await page.goto('/signup');
      await expect(page.getByTestId('wsf-signup')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'signup', c.key, 'wsf-signup');

      await page.goto('/reset-password');
      await expect(page.getByTestId('wsf-reset')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'reset-password', c.key, 'wsf-reset-screen');
      await context.close();
    }

    /* ── the credential error, with both honest forks ───────────────────── */
    {
      const context = await ctx(browser, c);
      const page = await context.newPage();
      await page.goto('/signin');
      await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('wsf-signin-email').fill(`nobody-${stampId()}@example.com`);
      await page.getByTestId('wsf-signin-password').fill('definitely-not-the-password');
      await page.getByTestId('wsf-signin-submit').click();
      await expect(page.getByTestId('wsf-signin-error')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('wsf-signin-error-forgot')).toBeVisible();
      await shoot(page, 'auth-error', c.key, 'wsf-signin');
      await context.close();
    }

    /* ── reset: sent, and unable to send ────────────────────────────────── */
    for (const [name, how] of [
      ['reset-sent', 'sent'],
      ['reset-unconfigured', 'unconfigured'],
    ] as const) {
      const context = await ctx(browser, c);
      const page = await context.newPage();
      await page.route('**/wsfSendPasswordReset**', (route: Route) =>
        how === 'sent'
          ? route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ result: { ok: true } }),
            })
          : route.fulfill({
              status: 400,
              contentType: 'application/json',
              body: JSON.stringify({
                error: {
                  status: 'FAILED_PRECONDITION',
                  message: 'WSF email sending is not configured.',
                },
              }),
            })
      );
      await page.goto('/reset-password');
      await page.getByTestId('wsf-reset-email').fill('devin@example.com');
      await page.getByTestId('wsf-reset').click();
      await expect(
        page.getByTestId(how === 'sent' ? 'wsf-reset-sent' : 'wsf-reset-unconfigured')
      ).toBeVisible({ timeout: 30_000 });
      await shoot(page, name, c.key, 'wsf-reset-screen');
      await context.close();
    }

    /* ── verify: sent, unable to send, and carrying a destination ───────── */
    for (const [name, how, carrying] of [
      ['verify-sent', 'sent', false],
      ['verify-unconfigured', 'unconfigured', false],
      ['verify-carrying', 'sent', true],
    ] as const) {
      const context = await ctx(browser, c);
      const page = await context.newPage();
      await pinVerificationSend(page, how);
      if (carrying) await seedDestination(page, 'join', JOIN_CODE);
      await signUpUnverified(page, `${tag}${name}`);
      await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 40_000 });
      if (how === 'unconfigured') {
        await expect(page.getByTestId('wsf-verify-unconfigured')).toBeVisible();
      } else {
        await expect(page.getByTestId('wsf-verify-check')).toBeVisible();
      }
      if (carrying) {
        // Asserted BEFORE the shutter, so the frame cannot quietly be a
        // screen with no destination on it.
        await expect(page.getByTestId('wsf-form-destination')).toBeVisible();
      }
      await shoot(page, name, c.key, 'wsf-verify');
      await context.close();
    }

    /* ── profile setup, plain and still carrying ────────────────────────── */
    for (const [name, carrying] of [
      ['profile-setup', false],
      ['profile-carrying', true],
    ] as const) {
      // ITS OWN CONTEXT: an unverified member from the signups above stays
      // signed in via IndexedDB, which clearing cookies does not touch.
      const context = await ctx(browser, c);
      const page = await context.newPage();
      if (carrying) await seedDestination(page, 'join', JOIN_CODE);
      const email = `wsf-${tag}-p-${stampId()}@example.com`;
      const password = `Pw-${randomBytes(9).toString('base64url')}`;
      await seedVerifiedUser(email, password);
      await page.goto('/signin');
      await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('wsf-signin-email').fill(email);
      await page.getByTestId('wsf-signin-password').fill(password);
      await page.getByTestId('wsf-signin-submit').click();
      await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 40_000 });
      if (carrying) await expect(page.getByTestId('wsf-form-destination')).toBeVisible();
      await shoot(page, name, c.key, 'wsf-profile');
      await context.close();
    }

    /* ── the three returns, each named as its own kind ──────────────────── */
    for (const [name, kind, value, line] of [
      ['return-join', 'join', JOIN_CODE, 'An invitation to a community'],
      ['return-event', 'event', EVENT_GOAL, 'The event you scanned'],
      ['return-kiosk', 'kiosk', KIOSK_GOAL, 'The screen you started at'],
    ] as const) {
      const context = await ctx(browser, c);
      const page = await context.newPage();
      await seedDestination(page, kind, value);
      await page.goto('/signin');
      await expect(page.getByTestId('wsf-signin')).toBeVisible({ timeout: 30_000 });
      // The fixture actually reached the product — the thing the BEFORE
      // spec's equivalents silently failed to do.
      await expect(page.getByTestId('wsf-form-destination')).toContainText(line);
      // And the opaque value is never on the screen.
      await expect(page.getByTestId('wsf-signin')).not.toContainText(value);
      await shoot(page, name, c.key, 'wsf-signin');
      await context.close();
    }
  });
}
