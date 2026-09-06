import { expect, test, type Page } from '@playwright/test';

/**
 * M-U2 end-to-end: signup → verify email → profile setup → HOME → start
 * community → community page, driven through the real UI against the emulator
 * suite.
 *
 * This is GATE 1. It exists because the fixes it guards are only observable in
 * a running app:
 *
 *  - the Firebase web config has to be a real registration or every auth call
 *    dies at `auth/api-key-not-valid`;
 *  - `verify-email.tsx` has to force an ID-token refresh, because
 *    `reload(user)` updates the local User object but leaves the cached token
 *    saying `email_verified: false` — and both firestore.rules and
 *    `wsfCreateCommunity` gate on the TOKEN claim, so the profile write one
 *    step later fails PERMISSION_DENIED and the new member is dead-ended;
 *  - `/community/<id>` has to survive a cold load, which is a Hosting rewrite
 *    question and cannot be answered by any in-process test;
 *  - E3.5 A3: after verify+profile the flow now lands on `/`, not on
 *    `/start-community`. A returning member with a community listed there is
 *    the fix to F1 in the 2026-09-06 phone-test findings; if this path
 *    regresses, every sign-in dumps existing members back onto setup screens.
 *
 * Reasoning about those is not evidence. Only the flow completing is.
 *
 * Requires the emulator suite from firebase.westayfit.emulators.json and a web
 * build made with EXPO_PUBLIC_WSF_AUTH_ENABLED=1 and
 * EXPO_PUBLIC_WSF_USE_EMULATORS=1. See scripts/westayfit/gate1.sh.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const PROJECT_ID = 'goarrive';

/**
 * Console noise this gate deliberately tolerates. Every entry must be a known,
 * pinned gap with a test below that fails once it is closed — never a way to
 * quiet an error nobody has looked at.
 */
const KNOWN_GAPS = [
  '/favicon.ico',
  // wsfSendVerificationEmail refuses to run without WSF_EMAIL_API_KEY /
  // WSF_EMAIL_FROM / WSF_APP_URL, and the emulator deliberately supplies none
  // of them — configuring it would mean a real POST to Resend from a test run.
  // So the call returns failed-precondition (HTTP 400), signup swallows it, and
  // the member still reaches /verify-email. That resilience is the point: the
  // account exists by then, and a send failure must not strand anyone on the
  // signup screen. Matched on the function name rather than a bare 400 so this
  // cannot quietly absorb some other bad request.
  'wsfSendVerificationEmail',
];

/**
 * Marks an address verified through the Auth emulator's admin API.
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
  if (!user) {
    throw new Error(`no emulator account for ${email} — signup did not create one`);
  }

  const update = await fetch(`${base}/accounts:update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localId: user.localId, emailVerified: true }),
  });
  if (!update.ok) {
    throw new Error(`emulator verify failed: ${update.status} ${await update.text()}`);
  }
}

function captureConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const where = msg.location()?.url;
    errors.push(where ? `${msg.text()} [${where}]` : msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push(`HTTP ${res.status()} ${res.url()}`);
  });
  return errors;
}

test('a new member signs up, verifies, builds a profile, lands on home, then starts a community', async ({ page }) => {
  const errors = captureConsoleErrors(page);
  const email = `gate1-${Date.now()}@example.com`;
  const password = 'gate1-password';
  const communityName = 'Gate One Community';

  // ---- signup -------------------------------------------------------------
  await page.goto('/signup');
  await expect(page.getByTestId('wsf-signup')).toBeVisible();

  await page.getByTestId('wsf-signup-displayName').fill('Gate One');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(password);
  // E3.5 A4 (extended to signup): the 18+ checkbox is gone from signup too;
  // the decision now covers account creation, and profile-setup owns the
  // terms/privacy accept. The old wsf-signup-adultCheckbox testID must not
  // exist any more — assert its absence so a re-add regresses this test.
  await expect(page.getByTestId('wsf-signup-adultCheckbox')).toHaveCount(0);
  await page.getByTestId('wsf-signup-submit').click();

  // ---- verify email -------------------------------------------------------
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('wsf-signup-error')).toHaveCount(0);

  await markEmailVerified(email);
  await page.getByTestId('wsf-verify-check').click();

  // ---- profile setup ------------------------------------------------------
  // E3.5 A4: the 18+ checkbox is gone. Only one checkbox now (terms + 13+
  // sentence in the same line). The old wsf-profile-adultCheckbox testID must
  // not exist any more — assert its absence so a re-add regresses this test.
  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('wsf-profile-adultCheckbox')).toHaveCount(0);
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();
  await expect(page.getByTestId('wsf-profile-error')).toHaveCount(0);

  // ---- home ---------------------------------------------------------------
  // E3.5 A3 fix to F1: verify+profile now routes to `/`, not
  // `/start-community`. A returning member with communities sees them here.
  await expect(page.getByTestId('wsf-home')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('wsf-home-signed-in')).toBeVisible();
  await expect(page.getByTestId('wsf-home-start')).toBeVisible();
  // No communities yet, so the "You're not in a community yet" empty state
  // is what shows first.
  await expect(page.getByTestId('wsf-home-my-empty')).toBeVisible();

  await page.getByTestId('wsf-home-start').click();

  // ---- start community ----------------------------------------------------
  await expect(page.getByTestId('wsf-start')).toBeVisible({ timeout: 15_000 });
  // E3.5 A7: three join policies. Select `public` so the invite link on the
  // community page has something to render (also gives F9 a concrete value
  // to round-trip through Firestore).
  await page.getByTestId('wsf-start-name').fill(communityName);
  await page.getByTestId('wsf-start-joinPolicy-public').click();
  await page.getByTestId('wsf-start-submit').click();

  await expect(page.getByTestId('wsf-start-error')).toHaveCount(0);

  // ---- community page -----------------------------------------------------
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(communityName)).toBeVisible();
  // E3.5 A6: raw enums are gone.
  await expect(page.getByTestId('wsf-community-role')).toContainText('Founding Champion');
  await expect(page.getByTestId('wsf-community-status')).toContainText('Active');
  // F9 — the pill I clicked and the stored policy match: I picked Public,
  // so joinPolicyLabel('public') → "Public" is what renders.
  await expect(page.getByTestId('wsf-community-policy')).toContainText('Public');
  // Public → invite section renders with a URL and Copy button.
  await expect(page.getByTestId('wsf-community-invite-url')).toBeVisible();
  await expect(page.getByTestId('wsf-community-invite-copy')).toBeVisible();

  const communityUrl = page.url();
  expect(communityUrl, 'router should land on /community/<groupId>').toMatch(
    /\/community\/[A-Za-z0-9_-]+$/
  );

  // ---- the cold-load fix --------------------------------------------------
  const cold = await page.goto(communityUrl);
  expect(cold?.status(), `cold load of ${communityUrl}`).toBe(200);
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(communityName)).toBeVisible();

  const robots = await page
    .locator('meta[name="robots"]')
    .getAttribute('content', { timeout: 5_000 });
  expect(robots).toBe('noindex,nofollow');

  // ---- re-visit the home shows the community ------------------------------
  // The A3/A2 combination: a signed-in member who navigates back to `/`
  // sees Your communities populated with the new group.
  await page.goto('/');
  await expect(page.getByTestId('wsf-home-my-list')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(communityName)).toBeVisible();

  expect(
    errors.filter((e) => !KNOWN_GAPS.some((gap) => e.includes(gap))),
    'browser console errors during the flow'
  ).toEqual([]);
});

test('known gap: the site still ships no favicon', async ({ request }) => {
  const res = await request.get('/favicon.ico');
  expect(
    res.status(),
    'a favicon now exists — remove this test and its KNOWN_GAPS entry'
  ).toBe(404);
});

test('the home page gets a signed-out visitor to signup', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('wsf-home')).toBeVisible();
  await expect(page.getByTestId('wsf-home-signed-out')).toBeVisible();

  const signup = page.getByTestId('wsf-home-signup');
  await expect(signup, 'home page must offer a way in').toBeVisible();
  await expect(page.getByTestId('wsf-home-signin')).toBeVisible();
  // "no signup" was the copy on the flag-off shell; it must never appear when
  // auth is on.
  await expect(page.getByText('no signup')).toHaveCount(0);

  // E3.5 A2 addition: the signed-out home has a "Join with a code" field.
  await expect(page.getByTestId('wsf-home-join-field')).toBeVisible();

  await signup.click();
  await expect(page.getByTestId('wsf-signup')).toBeVisible({ timeout: 15_000 });
});

test('a signed-out visitor cannot read a community page', async ({ page }) => {
  const response = await page.goto('/community/some-group-that-does-not-exist');
  expect(response?.status(), 'rewrite should serve the route, not 404').toBe(200);
  await expect(page.getByTestId('wsf-community-signed-out')).toBeVisible({ timeout: 20_000 });
});
