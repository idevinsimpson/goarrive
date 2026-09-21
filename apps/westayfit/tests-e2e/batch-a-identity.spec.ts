import { randomBytes } from 'node:crypto';
import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

import { seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * BATCH A — IDENTITY AND ONBOARDING, BEHAVIOUR.
 *
 * What the rebuilt identity funnel DOES, asserted on the running product:
 * that a pending destination survives every gate it passes and is named only
 * as a KIND, that each verification outcome offers only controls that can
 * actually do something, that consent starts unticked and the password rule
 * is visible before it is enforced, and that a 390x640 phone can still reach
 * every control.
 *
 * Separate from the frame capture on purpose: capture writes PNGs into docs/
 * and is evidence generation, not verification. These assertions are cheap
 * and belong in every run.
 */

/**
 * A join code of the shape the product accepts: `isValidShape` in
 * pendingJoinCode.ts requires 16-128 of [A-Za-z0-9_-]. A shorter fixture is
 * rejected on read — correctly — and renders no destination at all.
 */
const JOIN_CODE = 'HARBOR7WALKERSINVITE01';

const PHONE = { width: 390, height: 844 };
const SHORT = { width: 390, height: 640 };

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function phone(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    userAgent: IPHONE_UA,
    timezoneId: 'America/New_York',
  });
  return { context, page: await context.newPage() };
}

/**
 * Put a pending destination in session storage the way the product does.
 *
 * Seeded through an init script so it is present before the first render —
 * the screens read it once on mount, exactly so the heading cannot change
 * under somebody mid-type.
 */
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
        // a browser with storage blocked simply has no pending destination
      }
    },
    [kind, value] as [string, string]
  );
}

async function newAccount(label: string) {
  const id = stampId();
  const email = `wsf-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  return { email, password, uid };
}


/**
 * A BRAND-NEW, UNVERIFIED ACCOUNT, created the way a person creates one.
 *
 * `seedVerifiedUser` makes an already-verified account, and /verify-email
 * attempts no send for one of those — so an intercepted send never fires and
 * no outcome is ever reached. The signup flow is what puts somebody on that
 * screen with a send in flight.
 */
async function signUpUnverified(page: Page, label: string): Promise<string> {
  const email = `wsf-${label}-${stampId()}@example.com`;
  await page.goto('/signup');
  await page.getByTestId('wsf-signup-displayName').fill('Devin');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(`Pw-${randomBytes(9).toString('base64url')}`);
  await page.getByTestId('wsf-signup-submit').click();
  return email;
}

/* ── destination continuity ─────────────────────────────────────────────── */

test('a pending invitation is named on sign-in as a kind, never as a community', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { context, page } = await phone(browser, PHONE);
  await seedDestination(page, 'join', JOIN_CODE);
  await page.goto('/signin');

  const card = page.getByTestId('wsf-form-destination');
  await expect(card).toBeVisible({ timeout: 40_000 });
  await expect(card).toContainText('An invitation to a community');
  // THE CODE ITSELF IS NEVER ON THE SCREEN. It is opaque, and a signed-out
  // visitor is not entitled to a read that would resolve it to a name.
  await expect(page.getByTestId('wsf-signin')).not.toContainText(JOIN_CODE);
  // And the screen says it is taking them back, not to home.
  await expect(page.getByTestId('wsf-signin')).toContainText('back to the invitation');
  await expect(page.getByTestId('wsf-signin-submit')).toContainText('Sign in and continue');
  await context.close();
});

test('a scanned event and a shared screen are each named as themselves', async ({ browser }) => {
  test.setTimeout(240_000);
  for (const [kind, value, line] of [
    ['event', 'goal-abc123', 'The event you scanned'],
    ['kiosk', 'goal-xyz789', 'The screen you started at'],
  ] as const) {
    const { context, page } = await phone(browser, PHONE);
    await seedDestination(page, kind, value);
    await page.goto('/signin');
    await expect(page.getByTestId('wsf-form-destination')).toContainText(line, {
      timeout: 40_000,
    });
    await expect(page.getByTestId('wsf-signin')).not.toContainText(value);
    await context.close();
  }
});

test('the kiosk return says finishing signs you out of that device', async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await phone(browser, PHONE);
  await seedDestination(page, 'kiosk', 'goal-xyz789');
  await page.goto('/signin');
  // The person is standing at a SHARED device. What they most need to know is
  // that signing in here does not leave them signed in on it.
  await expect(page.getByTestId('wsf-form-destination')).toContainText(
    'signs you out of this device',
    { timeout: 40_000 }
  );
  await context.close();
});

test('the destination survives the verify gate and still says so', async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await phone(browser, PHONE);
  await seedDestination(page, 'join', JOIN_CODE);
  await signUpUnverified(page, 'bagate');

  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 40_000 });
  const card = page.getByTestId('wsf-form-destination');
  await expect(card).toBeVisible();
  // `nextRouteAfterAuth` is read at three gates, so it must still be here —
  // this is the screen where somebody is most likely to think it was lost.
  await expect(card).toContainText('Still waiting for you');
  await expect(card).toContainText('survives this step and the next one');
  await expect(page.getByTestId('wsf-verify')).not.toContainText(JOIN_CODE);
  await context.close();
});

/* ── truthful outcome controls ──────────────────────────────────────────── */

test('an unconfigured build drops Resend and keeps the control that still works', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const { context, page } = await phone(browser, PHONE);
  // The send fails exactly the way a build with WSF_EMAIL_* unset fails.
  await page.route('**/wsfSendVerificationEmail**', (route: Route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { status: 'FAILED_PRECONDITION', message: 'WSF email sending is not configured.' },
      }),
    })
  );
  await signUpUnverified(page, 'bauncfg');

  await expect(page.getByTestId('wsf-verify-unconfigured')).toBeVisible({ timeout: 40_000 });
  // RESEND IS THE DEAD ONE: it calls the callable that just refused, so
  // pressing it again fails identically. It is gone.
  await expect(page.getByTestId('wsf-verify-resend')).toHaveCount(0);
  // "I have verified" is NOT dead — it reads the current auth state, not
  // anything this build sent — so it stays, demoted.
  await expect(page.getByTestId('wsf-verify-check')).toBeVisible();
  // The way out that resolves this for most people is the primary.
  await expect(page.getByTestId('wsf-verify-signout-primary')).toBeVisible();
  // And it is offered ONCE, not also at the foot.
  await expect(page.getByTestId('wsf-verify-signout')).toHaveCount(0);
  await context.close();
});

test('a build that can send offers Resend, and says so once', async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await phone(browser, PHONE);
  await page.route('**/wsfSendVerificationEmail**', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: { sent: true } }),
    })
  );
  await signUpUnverified(page, 'bacansend');

  await expect(page.getByTestId('wsf-verify-check')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-verify-resend')).toBeVisible();
  await expect(page.getByTestId('wsf-verify-unconfigured')).toHaveCount(0);
  // Sign out is at the foot here, and the primary is not a sign-out.
  await expect(page.getByTestId('wsf-verify-signout')).toBeVisible();
  await expect(page.getByTestId('wsf-verify-signout-primary')).toHaveCount(0);
  await context.close();
});

test('a reset on an unconfigured build does not invite another press', async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await phone(browser, PHONE);
  await page.route('**/wsfSendPasswordReset**', (route: Route) =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { status: 'FAILED_PRECONDITION', message: 'email not configured' },
      }),
    })
  );
  await page.goto('/reset-password');
  await page.getByTestId('wsf-reset-email').fill('someone@example.com');
  await page.getByTestId('wsf-reset').click();

  await expect(page.getByTestId('wsf-reset-unconfigured')).toBeVisible({ timeout: 40_000 });
  // Nothing was sent and nothing can be, so the control is disabled rather
  // than left inviting a press that cannot work.
  await expect(page.getByTestId('wsf-reset')).toBeDisabled();
  await context.close();
});

test('reset never reveals whether an account exists', async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await phone(browser, PHONE);
  await page.goto('/reset-password');
  // Before submit, what happens next is stated in the enumeration-safe form.
  await expect(page.getByTestId('wsf-reset-screen')).toContainText(
    'If an account exists for that email',
    { timeout: 40_000 }
  );
  await context.close();
});

/* ── consent and password states ────────────────────────────────────────── */

test('the password rule is visible before it is enforced', async ({ browser }) => {
  test.setTimeout(240_000);
  const { context, page } = await phone(browser, PHONE);
  await page.goto('/signup');
  // Stated as a standing rule, not discovered at submit.
  await expect(page.getByTestId('wsf-signup-password-hint')).toContainText('At least 8 characters', {
    timeout: 40_000,
  });
  await page.getByTestId('wsf-signup-displayName').fill('Devin');
  await page.getByTestId('wsf-signup-email').fill('someone@example.com');
  await page.getByTestId('wsf-signup-password').fill('short');
  await expect(page.getByTestId('wsf-signup-submit')).toBeDisabled();
  await page.getByTestId('wsf-signup-password').fill('longenough1');
  await expect(page.getByTestId('wsf-signup-submit')).toBeEnabled();
  await context.close();
});

test('consent starts unticked and gates the save', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await newAccount('baconsent');
  const { context, page } = await phone(browser, PHONE);
  await signInVia(page, fx.email, fx.password);
  await page.goto('/profile-setup');

  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 40_000 });
  // CONSENT IS A THING SOMEBODY GIVES, not a thing the product arranged.
  const box = page.getByTestId('wsf-profile-termsCheckbox');
  await page.getByTestId('wsf-profile-displayName').fill('Devin');
  /*
    THE GATE ITSELF IS THE ASSERTION, not the ARIA attribute.

    `canSubmit` requires `acceptedTerms`, which starts false, so a name alone
    cannot save. That is the property that matters and the one a person feels.

    The attribute is asserted separately below, because react-native-web's
    handling of it turned out to be worth pinning rather than assuming.
  */
  await expect(page.getByTestId('wsf-profile-submit')).toBeDisabled();
  await box.click();
  await expect(page.getByTestId('wsf-profile-submit')).toBeEnabled();
  await context.close();
});

test('the consent checkbox announces its state to a screen reader', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await newAccount('baaria');
  const { context, page } = await phone(browser, PHONE);
  await signInVia(page, fx.email, fx.password);
  await page.goto('/profile-setup');

  const box = page.getByTestId('wsf-profile-termsCheckbox');
  await expect(box).toBeVisible({ timeout: 40_000 });
  await expect(box).toHaveAttribute('role', 'checkbox');
  /*
    A role="checkbox" WITH NO aria-checked ANNOUNCES NOTHING.

    This is the legal consent gate, so whether it reads as ticked is exactly
    what a screen-reader user needs before agreeing to something. The state is
    passed as `accessibilityState={{ checked }}`; this pins that it actually
    reaches the DOM, in both positions.
  */
  await expect(box).not.toHaveAttribute('aria-checked', 'true');
  await box.click();
  await expect(box).toHaveAttribute('aria-checked', 'true');
  await context.close();
});

test('the name panel promises only what the rules prove', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await newAccount('baname');
  const { context, page } = await phone(browser, PHONE);
  await signInVia(page, fx.email, fx.password);
  await page.goto('/profile-setup');

  const panel = page.getByTestId('wsf-profile-name-use');
  await expect(panel).toBeVisible({ timeout: 40_000 });
  // wsfMemberProfiles/{uid} is owner-readable only and no callable returns
  // another member's displayName, so neither of these claims may appear.
  await expect(panel).not.toContainText('your community sees');
  await expect(panel).not.toContainText('outside your community');
  // What IS true: it is the account name, and the room name is a separate one.
  await expect(panel).toContainText('name on your account');
  await expect(panel).toContainText('you choose what that screen calls you');
  await context.close();
});

test('the last gate has a way out of the wrong account', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await newAccount('baout');
  const { context, page } = await phone(browser, PHONE);
  await signInVia(page, fx.email, fx.password);
  await page.goto('/profile-setup');

  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-profile-account')).toContainText(fx.email);
  await expect(page.getByTestId('wsf-profile-signout')).toBeVisible();
  await context.close();
});

/* ── short-phone reachability ───────────────────────────────────────────── */

for (const [name, route, controls] of [
  ['signin', '/signin', ['wsf-signin-email', 'wsf-signin-password', 'wsf-signin-submit']],
  [
    'signup',
    '/signup',
    ['wsf-signup-displayName', 'wsf-signup-email', 'wsf-signup-password', 'wsf-signup-submit'],
  ],
  ['reset', '/reset-password', ['wsf-reset-email', 'wsf-reset']],
] as const) {
  test(`every control on ${name} is reachable on a 390x640 phone`, async ({ browser }) => {
    test.setTimeout(240_000);
    const { context, page } = await phone(browser, SHORT);
    await page.goto(route);
    await expect(page.getByTestId(controls[0])).toBeVisible({ timeout: 40_000 });

    for (const id of controls) {
      const el = page.getByTestId(id);
      await el.scrollIntoViewIfNeeded();
      const box = await el.boundingBox();
      expect(box, `${name}: ${id} has no box`).not.toBeNull();
      // A control that cannot be scrolled fully into the viewport cannot be
      // pressed, whatever the page looks like at rest.
      expect(box!.y, `${name}: ${id} is above the viewport`).toBeGreaterThanOrEqual(-1);
      expect(
        box!.y + box!.height,
        `${name}: ${id} cannot be brought inside a 640pt viewport`
      ).toBeLessThanOrEqual(SHORT.height + 1);
      // And it is a real touch target.
      expect(box!.height, `${name}: ${id} is under 44pt tall`).toBeGreaterThanOrEqual(43);
    }
    await context.close();
  });
}
