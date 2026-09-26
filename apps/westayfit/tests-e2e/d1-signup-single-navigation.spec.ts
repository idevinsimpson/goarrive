import { expect, test } from '@playwright/test';

import { clearVerifyGate } from './helpers/mobile';

/**
 * D-1 — signup performs ONE navigation to /verify-email.
 *
 * The signed-in effect in `app/signup.tsx` navigates the moment the account
 * exists; the submit handler must not navigate again after its best-effort
 * `wsfSendVerificationEmail` round trip. This spec holds that round trip open,
 * lets the member verify and move on to profile-setup, releases the hold, and
 * asserts they are never pulled back. It failed on the unfixed screen (the
 * late replace returned them to Verify) and passes on the fixed one.
 *
 * Only the account-verification helper below talks to the emulator directly.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
// E4-A1-R4 lockstep: must match the emulators:exec --project flag in gate1.sh
// and the id the flagged client selects on a loopback host (selectProjectId).
const PROJECT_ID = 'demo-wsf-local';

/**
 * Verify an emulator account's email. Mirrors `mu2-flow.spec.ts` — see there
 * for the reasoning about staying decoupled from how the app actually sends
 * mail.
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

/**
 * D-1 — signup performs ONE navigation to /verify-email.
 *
 * The signed-in effect navigates as soon as the account exists; the submit
 * handler must not navigate again after its best-effort verification-email
 * round trip. A member who verifies and taps "I have verified" while that
 * round trip is still in flight must land on profile-setup and STAY there.
 * Fails on the unfixed screen (the late replace returns them to Verify).
 */
test('D-1: a verified member is not pulled back to /verify-email by the late send round trip', async ({ page }) => {
  test.setTimeout(120_000);
  // Hold the send so the tap lands while it is still outstanding.
  let release = () => {};
  const held = new Promise<void>((r) => { release = r; });
  let intercepted = 0;
  await page.route('**/wsfSendVerificationEmail', async (route) => {
    intercepted += 1;
    await held;
    await route.continue();
  });
  // Registered before the click so the released response is never missed.
  const sendSettled = page.waitForResponse((r) => r.url().includes('wsfSendVerificationEmail'));

  await page.goto('/signup');
  await expect(page.getByTestId('wsf-signup')).toBeVisible({ timeout: 15_000 });
  const email = `d1-signup-${Date.now()}@example.com`;
  await page.getByTestId('wsf-signup-displayName').fill('Single Navigation');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill('d1-password');
  await page.getByTestId('wsf-signup-submit').click();
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 15_000 });

  await markEmailVerified(email);
  await clearVerifyGate(page, 'wsf-profile', 15_000);

  // The send finishes late. Profile-setup must survive it. The window starts
  // when the released response has actually arrived, so a slow function cold
  // start cannot push the late navigation past the assertion.
  release();
  await sendSettled;
  // The interception must have happened, or the race above was not exercised.
  expect(intercepted).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(2_000);
  await expect(page.getByTestId('wsf-profile')).toBeVisible();
  await expect(page.getByTestId('wsf-verify')).toHaveCount(0);
});
