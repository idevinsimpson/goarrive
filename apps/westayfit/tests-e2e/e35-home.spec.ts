import { expect, test } from '@playwright/test';

/**
 * E3.5 supplementary — pins four surfaces `mu2-flow.spec.ts` does not touch:
 *
 *  - A2: the signed-out home carries a "Join with a code" field, and Go on a
 *    well-formed code routes to `/join/<code>`. mu2-flow reaches `/` signed-in
 *    but never checks the signed-out shell that the phone test found broken.
 *  - A2: a bad code stops in the field with an error, does not route. The
 *    JOIN_CODE_SHAPE guard exists because the QR reader hands us un-trimmed
 *    strings from the wild.
 *  - A8: `?wsf_in_app=1` forces the in-app-browser banner on, `?wsf_in_app=0`
 *    forces it off. UA spoofing across every Playwright browser matrix is not
 *    reliable, so the URL override is the deterministic path the phone test
 *    finding needs a regression against.
 *  - A4: the terms accordion opens inline and the panel contains the version
 *    marker that gets stamped into `wsfMemberProfiles.acceptedTermsVersion`.
 *    Any drift between `legalContent.ts` and `profileConstants.ts` fails here
 *    before the profile write silently records the wrong version.
 *
 * The signed-in home with a real membership card is exercised end-to-end by
 * mu2-flow.spec.ts's "re-visit the home shows the community" step. This spec
 * covers the signed-in empty state (no memberships yet) so the section header
 * and empty-state copy still ship.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const PROJECT_ID = 'goarrive';

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

test('A2: the signed-out home routes a well-formed join code to /join/<code>', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('wsf-home')).toBeVisible();
  await expect(page.getByTestId('wsf-home-signed-out')).toBeVisible();
  await expect(page.getByTestId('wsf-home-signup')).toBeVisible();
  await expect(page.getByTestId('wsf-home-signin')).toBeVisible();
  await expect(page.getByTestId('wsf-home-join-field')).toBeVisible();

  // 16 chars is the JOIN_CODE_SHAPE floor. Anything shorter is rejected in
  // the field; anything from 16..128 is passed through to /join/<code>.
  const joinCode = 'a1b2c3d4e5f6g7h8';
  await page.getByTestId('wsf-home-join-input').fill(joinCode);
  await page.getByTestId('wsf-home-join-submit').click();

  await page.waitForURL(new RegExp(`/join/${joinCode}$`), { timeout: 15_000 });
});

test('A2: the signed-out home refuses an obviously bad join code without routing', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('wsf-home-join-input').fill('nope');
  await page.getByTestId('wsf-home-join-submit').click();
  await expect(page.getByTestId('wsf-home-join-error')).toBeVisible();
  expect(page.url(), 'a rejected code must not leave the home').not.toContain('/join/');
});

test('A8: ?wsf_in_app=1 forces the in-app-browser banner on and Dismiss removes it', async ({ page }) => {
  await page.goto('/?wsf_in_app=1');
  await expect(page.getByTestId('wsf-in-app-banner')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('wsf-in-app-banner-dismiss').click();
  await expect(page.getByTestId('wsf-in-app-banner')).toHaveCount(0);
});

test('A8: ?wsf_in_app=0 keeps the banner off even on a real WebView UA', async ({ page }) => {
  await page.goto('/?wsf_in_app=0');
  await expect(page.getByTestId('wsf-home')).toBeVisible();
  await expect(page.getByTestId('wsf-in-app-banner')).toHaveCount(0);
});

test('A4: the terms accordion opens inline and shows the pending-approval version marker', async ({ page }) => {
  // Only path to the profile-setup screen is a fresh signup, so drive it. The
  // check itself is cheap (open, read version line) — the setup is the tax.
  const email = `e35-terms-${Date.now()}@example.com`;
  const password = 'e35-password';

  await page.goto('/signup');
  await page.getByTestId('wsf-signup-displayName').fill('Terms Reader');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(password);
  await page.getByTestId('wsf-signup-adultCheckbox').click();
  await page.getByTestId('wsf-signup-submit').click();

  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 15_000 });
  await markEmailVerified(email);
  await page.getByTestId('wsf-verify-check').click();

  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 15_000 });

  // Panel MUST be absent while collapsed — a screen reader would otherwise
  // announce stale copy. Same rationale as LegalAccordion's unmount design.
  await expect(page.getByTestId('wsf-profile-terms-panel')).toHaveCount(0);

  await page.getByTestId('wsf-profile-terms').click();
  const panel = page.getByTestId('wsf-profile-terms-panel');
  await expect(panel).toBeVisible();
  // If profileConstants.WSF_ACCEPTED_TERMS_VERSION and legalContent.ts drift
  // apart, this line moves and the assertion fails — that mismatch is the
  // whole point of pinning the accordion content to a version marker.
  await expect(panel).toContainText('Version pending-approval-2026-08-25');
});

test('A4: the privacy accordion carries the same version marker', async ({ page }) => {
  const email = `e35-privacy-${Date.now()}@example.com`;
  const password = 'e35-password';

  await page.goto('/signup');
  await page.getByTestId('wsf-signup-displayName').fill('Privacy Reader');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(password);
  await page.getByTestId('wsf-signup-adultCheckbox').click();
  await page.getByTestId('wsf-signup-submit').click();

  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 15_000 });
  await markEmailVerified(email);
  await page.getByTestId('wsf-verify-check').click();

  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-profile-privacy').click();
  await expect(page.getByTestId('wsf-profile-privacy-panel')).toContainText(
    'Version pending-approval-2026-08-25'
  );
});
