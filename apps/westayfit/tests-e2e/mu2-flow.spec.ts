import { expect, test, type Page } from '@playwright/test';

/**
 * M-U2 end-to-end: signup → verify email → profile setup → start community →
 * community page, driven through the real UI against the emulator suite.
 *
 * This is GATE 1. It exists because the three fixes in `51e70ec` are only
 * observable in a running app:
 *
 *  - the Firebase web config has to be a real registration or every auth call
 *    dies at `auth/api-key-not-valid`;
 *  - `verify-email.tsx` has to force an ID-token refresh, because
 *    `reload(user)` updates the local User object but leaves the cached token
 *    saying `email_verified: false` — and both firestore.rules and
 *    `wsfCreateCommunity` gate on the TOKEN claim, so the profile write one
 *    step later fails PERMISSION_DENIED and the new member is dead-ended;
 *  - `/community/<id>` has to survive a cold load, which is a Hosting rewrite
 *    question and cannot be answered by any in-process test.
 *
 * Reasoning about those three is not evidence. Only the flow completing is.
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
const KNOWN_GAPS = ['/favicon.ico'];

type OobCode = {
  email: string;
  oobCode: string;
  oobLink: string;
  requestType: string;
};

/** Pull the verification link the Auth emulator captured instead of sending. */
async function fetchVerificationLink(email: string): Promise<string> {
  const res = await fetch(`${AUTH_EMULATOR}/emulator/v1/projects/${PROJECT_ID}/oobCodes`);
  if (!res.ok) {
    throw new Error(`oobCodes fetch failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { oobCodes?: OobCode[] };
  const codes = (body.oobCodes ?? []).filter(
    (c) => c.email === email && c.requestType === 'VERIFY_EMAIL'
  );
  const latest = codes[codes.length - 1];
  if (!latest) {
    throw new Error(
      `no VERIFY_EMAIL oobCode for ${email}. The app never called ` +
        `sendEmailVerification, or it reached the real project instead of the emulator.`
    );
  }
  return latest.oobLink;
}

/**
 * Fail loudly on a red console instead of letting a silent runtime error show
 * up three steps later as a mystery timeout.
 *
 * Browser console text for a failed request does not name the URL, so failed
 * responses are recorded separately — a bare "404 (Not Found)" is not a
 * finding anyone can act on.
 */
function captureConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    // A bare "Failed to load resource: 404" names nothing actionable, so
    // append the location Chromium attributes it to. Some of these — a
    // browser-initiated favicon probe, for one — never surface through
    // page.on('response') at all, so this line is the only record of them.
    const where = msg.location()?.url;
    errors.push(where ? `${msg.text()} [${where}]` : msg.text());
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push(`HTTP ${res.status()} ${res.url()}`);
  });
  return errors;
}

test('a new adult can sign up, verify, build a profile and start a community', async ({
  page,
  request,
}) => {
  const errors = captureConsoleErrors(page);
  // Unique per run so repeated runs against a warm emulator don't collide on
  // an existing account.
  const email = `gate1-${Date.now()}@example.com`;
  const password = 'gate1-password';
  const communityName = 'Gate One Community';

  // ---- signup -------------------------------------------------------------
  await page.goto('/signup');
  await expect(page.getByTestId('wsf-signup')).toBeVisible();

  await page.getByTestId('wsf-signup-displayName').fill('Gate One');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(password);
  await page.getByTestId('wsf-signup-adultCheckbox').click();
  await page.getByTestId('wsf-signup-submit').click();

  // ---- verify email -------------------------------------------------------
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('wsf-signup-error')).toHaveCount(0);

  const link = await fetchVerificationLink(email);
  const applied = await request.get(link);
  expect(applied.status(), 'applying the emulator verification link').toBeLessThan(400);

  // The regression this guards: before the fix, `reload()` alone left the
  // cached ID token saying email_verified:false, so this click routed forward
  // with a stale token and the profile write below failed PERMISSION_DENIED.
  await page.getByTestId('wsf-verify-check').click();

  // ---- profile setup ------------------------------------------------------
  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-profile-adultCheckbox').click();
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();

  // The assertion GATE 1 is actually about. Check for the error node first:
  // if the write was denied, this names the reason instead of timing out on
  // the next page.
  await expect(page.getByTestId('wsf-profile-error')).toHaveCount(0);

  // ---- start community ----------------------------------------------------
  await expect(page.getByTestId('wsf-start')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-start-name').fill(communityName);
  await page.getByTestId('wsf-start-submit').click();

  await expect(page.getByTestId('wsf-start-error')).toHaveCount(0);

  // ---- community page -----------------------------------------------------
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(communityName)).toBeVisible();
  await expect(page.getByText('foundingChampion')).toBeVisible();

  const communityUrl = page.url();
  expect(communityUrl, 'router should land on /community/<groupId>').toMatch(
    /\/community\/[A-Za-z0-9_-]+$/
  );

  // ---- the cold-load fix --------------------------------------------------
  // A direct hit on this URL is what a refresh or a shared link does. Without
  // the Hosting rewrite it is a 404, because Expo exports the dynamic route to
  // the literal file `community/[groupId].html`, which no URL can name.
  const cold = await page.goto(communityUrl);
  expect(cold?.status(), `cold load of ${communityUrl}`).toBe(200);
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(communityName)).toBeVisible();

  // Every page WSF serves must be noindex, the community route included.
  const robots = await page
    .locator('meta[name="robots"]')
    .getAttribute('content', { timeout: 5_000 });
  expect(robots).toBe('noindex,nofollow');

  expect(
    errors.filter((e) => !KNOWN_GAPS.some((gap) => e.includes(gap))),
    'browser console errors during the flow'
  ).toEqual([]);
});

test('known gap: the site still ships no favicon', async ({ request }) => {
  // Pinned deliberately rather than filtered and forgotten. WSF has no icon
  // asset of any kind — no apps/westayfit/assets, no `web.favicon` in
  // app.json — so every page load logs a 404 and every browser tab shows a
  // generic icon. Cosmetic, not a deploy blocker, and NOT something to fix by
  // inventing a mark: the icon is a brand decision.
  //
  // When one is added this test fails. That is the point: delete it, and
  // delete the matching entry in KNOWN_GAPS above, so the flow test goes back
  // to failing on any 404 at all.
  const res = await request.get('/favicon.ico');
  expect(
    res.status(),
    'a favicon now exists — remove this test and its KNOWN_GAPS entry'
  ).toBe(404);
});

test('a signed-out visitor cannot read a community page', async ({ page }) => {
  // Cheap negative case in the same harness: proves the community route is
  // gated by auth state rather than merely un-linked.
  const response = await page.goto('/community/some-group-that-does-not-exist');
  expect(response?.status(), 'rewrite should serve the route, not 404').toBe(200);
  await expect(page.getByTestId('wsf-community-signed-out')).toBeVisible({ timeout: 20_000 });
});
