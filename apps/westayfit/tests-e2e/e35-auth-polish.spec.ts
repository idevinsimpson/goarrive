import { expect, test, type Page } from '@playwright/test';

/**
 * E3.5 §3C — sign-in and password polish. Covers the surfaces Devin's
 * 2026-09-06 Safari retest found broken:
 *
 *  - C1 show/hide password toggle flips `type=password` on both screens.
 *  - C2 the password field submits on Enter (returnKeyType="go" +
 *    onSubmitEditing on web).
 *  - C4 a wrong-password sign-in renders BOTH "Forgot your password?" and
 *    "New here? Create an account" as tappable next steps. The credential
 *    mismatch was the dead end that stopped the phone test.
 *  - C3 /reset-password happy path: intercept the callable so we prove the
 *    screen renders the enumeration-safe copy without hitting Resend.
 *  - C3 /reset-password unconfigured path: fire the REAL emulator callable
 *    (WSF_EMAIL_* deliberately absent) and expect the honest "not set up yet"
 *    line, not a raw functions/failed-precondition string.
 *  - C5 a signed-in visitor landing on /signin is redirected out (verify →
 *    verify-email; verified+profile → home).
 *
 * The emulator suite from firebase.westayfit.emulators.json is required and
 * the web build must be made with EXPO_PUBLIC_WSF_AUTH_ENABLED=1 and
 * EXPO_PUBLIC_WSF_USE_EMULATORS=1 — same shape as mu2-flow.spec.ts.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const PROJECT_ID = 'goarrive';

/**
 * Marks an address verified through the Auth emulator's admin API — copied
 * from mu2-flow.spec.ts so this file stays self-contained (the shared helper
 * pattern is not established across the tests-e2e/ suite yet).
 */
async function markEmailVerified(email: string): Promise<void> {
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' };
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const lookup = await fetch(`${base}/projects/${PROJECT_ID}/accounts:query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expression: [] }),
  });
  if (!lookup.ok) {
    throw new Error(`emulator account query failed: ${lookup.status} ${await lookup.text()}`);
  }
  const { userInfo = [] } = (await lookup.json()) as {
    userInfo?: { localId: string; email?: string }[];
  };
  const user = userInfo.find((u) => u.email === email);
  if (!user) throw new Error(`no emulator account for ${email} — signup did not create one`);
  const update = await fetch(`${base}/accounts:update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localId: user.localId, emailVerified: true }),
  });
  if (!update.ok) {
    throw new Error(`emulator verify failed: ${update.status} ${await update.text()}`);
  }
}

/** Creates a fully set-up account (verified + profile) so /signin's C5 redirect has something to short-circuit against. */
async function signUpVerifyAndSetupProfile(
  page: Page,
  email: string,
  password: string
): Promise<void> {
  await page.goto('/signup');
  await page.getByTestId('wsf-signup-displayName').fill('Polish Test');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(password);
  await page.getByTestId('wsf-signup-submit').click();

  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 15_000 });
  await markEmailVerified(email);
  await page.getByTestId('wsf-verify-check').click();

  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();

  await expect(page.getByTestId('wsf-home-signed-in')).toBeVisible({ timeout: 15_000 });
}

test('C1: the password toggle flips input type on /signin', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin')).toBeVisible();

  const passwordInput = page.getByTestId('wsf-signin-password');
  // react-native-web renders a <input type="password"> when secureTextEntry
  // is true. Reading the DOM attribute directly is what proves the toggle is
  // wired to the actual native prop, not just visually.
  await expect(passwordInput).toHaveAttribute('type', 'password');
  await page.getByTestId('wsf-password-toggle').click();
  await expect(passwordInput).toHaveAttribute('type', 'text');
  await page.getByTestId('wsf-password-toggle').click();
  await expect(passwordInput).toHaveAttribute('type', 'password');
});

test('C1: the password toggle flips input type on /signup', async ({ page }) => {
  await page.goto('/signup');
  await expect(page.getByTestId('wsf-signup')).toBeVisible();

  const passwordInput = page.getByTestId('wsf-signup-password');
  await expect(passwordInput).toHaveAttribute('type', 'password');
  await page.getByTestId('wsf-password-toggle').click();
  await expect(passwordInput).toHaveAttribute('type', 'text');
});

test('C2: pressing Enter in the password field submits /signin', async ({ page }) => {
  // Unknown email — the callable's exact response does not matter here; we
  // only care that Enter triggered the same code path the button would (any
  // outcome that renders the error line proves submit fired).
  await page.goto('/signin');
  await page.getByTestId('wsf-signin-email').fill('press-enter@example.test');
  await page.getByTestId('wsf-signin-password').fill('some-password');
  await page.getByTestId('wsf-signin-password').press('Enter');
  await expect(page.getByTestId('wsf-signin-error')).toBeVisible({ timeout: 15_000 });
});

test('C4: a credential mismatch on /signin renders the two next-step links', async ({ page }) => {
  await page.goto('/signin');
  // Unknown-email is enough to trigger auth/invalid-credential (Firebase Auth
  // collapses unknown-user and wrong-password into the same code). No account
  // setup required — isCredentialMismatch keys on the code, not the shape.
  await page.getByTestId('wsf-signin-email').fill(`e35c-unknown-${Date.now()}@example.test`);
  await page.getByTestId('wsf-signin-password').fill('does-not-matter');
  await page.getByTestId('wsf-signin-submit').click();

  await expect(page.getByTestId('wsf-signin-error')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('wsf-signin-error-forgot')).toBeVisible();
  await expect(page.getByTestId('wsf-signin-error-create')).toBeVisible();
});

test('C3: /reset-password happy path renders enumeration-safe copy without hitting Resend', async ({
  page,
}) => {
  // Intercept the Functions callable at the URL shape the emulator serves
  // ({project}/{region}/{name}) so the test does not depend on WSF_EMAIL_*
  // being configured — the point of this case is to prove the SCREEN
  // renders correctly on a successful callable, not to exercise Resend.
  await page.route('**/wsfSendPasswordResetEmail', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ result: { accepted: true } }),
    });
  });

  await page.goto('/reset-password');
  await expect(page.getByTestId('wsf-reset-screen')).toBeVisible();
  await page.getByTestId('wsf-reset-email').fill('reset-happy@example.test');
  await page.getByTestId('wsf-reset').click();

  await expect(page.getByTestId('wsf-reset-sent')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('wsf-reset-sent')).toContainText(
    'If an account exists for that email, a reset link is on its way. Check your inbox and spam.'
  );
  // The screen must NEVER reveal whether the address is registered — assert
  // the two enumeration-tells (an unconfigured error, a "sent" confirmation)
  // do not co-render.
  await expect(page.getByTestId('wsf-reset-unconfigured')).toHaveCount(0);
  await expect(page.getByTestId('wsf-reset-error')).toHaveCount(0);
});

test('C3: /reset-password renders the honest not-set-up line when the callable is unconfigured', async ({
  page,
}) => {
  // NO page.route — fire the real emulator callable. In the gate1 emulator
  // context the WSF_EMAIL_* env vars are deliberately absent, so the callable
  // throws functions/failed-precondition. This is the F13 state; the screen
  // must render the honest message, not a raw Firebase code.
  await page.goto('/reset-password');
  await expect(page.getByTestId('wsf-reset-screen')).toBeVisible();
  await page.getByTestId('wsf-reset-email').fill(`e35c-reset-real-${Date.now()}@example.test`);
  await page.getByTestId('wsf-reset').click();

  await expect(page.getByTestId('wsf-reset-unconfigured')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('wsf-reset-unconfigured')).toContainText(
    'Password reset email is not set up yet on this build.'
  );
});

test('C5: a signed-in verified member with a profile who lands on /signin is redirected home', async ({
  page,
}) => {
  const email = `e35c-signedin-${Date.now()}@example.com`;
  const password = 'e35c-password';
  await signUpVerifyAndSetupProfile(page, email, password);

  // Now the interesting move: with the session live, hit /signin directly —
  // the useEffect on mount MUST detect the signed-in user and route out.
  await page.goto('/signin');
  await page.waitForURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByTestId('wsf-home-signed-in')).toBeVisible();
});
