import { expect, test, type Page } from '@playwright/test';

/**
 * THE SCANNED EVENT SURVIVES THE AUTH ROUND TRIP.
 *
 * The defect: a visitor scanned the QR at an event, landed on
 * `/event/<goalId>`, was told they needed an account, signed in — and the app
 * put them on its home page. The event they were standing in front of was
 * gone and they had to find the QR and scan it again. `nextRouteAfterAuth`
 * carried a pending join code and a kiosk return goal, and nothing else.
 *
 * Only a browser can establish this one: it is a property of a navigation
 * sequence across four routes and a storage handoff, not of any single
 * function. `tests/event-return.test.ts` pins what may be stored and what a
 * read refuses; this pins that the return actually happens.
 *
 * NOT A MAIL PROOF. The verification hop here is completed by marking the
 * address verified through the Auth emulator's admin API. No message is sent,
 * received or clicked, and nothing in this file should be read as evidence
 * that one could be.
 *
 * Requires the emulator suite from firebase.westayfit.emulators.json and a web
 * build made with EXPO_PUBLIC_WSF_AUTH_ENABLED=1 and
 * EXPO_PUBLIC_WSF_USE_EMULATORS=1 — the same shape as the rest of tests-e2e/.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const PROJECT_ID = 'demo-wsf-local';

/** Mark an address verified through the emulator's admin API. No mail. */
async function markEmailVerified(email: string): Promise<void> {
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' };
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const lookup = await fetch(`${base}/projects/${PROJECT_ID}/accounts:query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expression: [] }),
  });
  if (!lookup.ok) throw new Error(`emulator account query failed: ${lookup.status}`);
  const { userInfo } = (await lookup.json()) as { userInfo?: { localId: string; email?: string }[] };
  const found = (userInfo ?? []).find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase());
  if (!found) throw new Error(`no emulator account for ${email}`);
  const update = await fetch(`${base}/projects/${PROJECT_ID}/accounts:update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localId: found.localId, emailVerified: true }),
  });
  if (!update.ok) throw new Error(`emulator verify failed: ${update.status}`);
}

/** The device question is asked before anything else on a fresh browser. */
async function answerOwnPhone(page: Page): Promise<void> {
  await expect(page.getByTestId('wsf-device-choice')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-device-choice-personal').click();
}

const goalFor = (label: string) => `evt-${label}-${Date.now()}`;

test('a visitor who signs in from a scanned event is brought back to that event', async ({ page }) => {
  test.setTimeout(180_000);
  const goalId = goalFor('signin');
  const email = `event-return-signin-${Date.now()}@example.com`;
  const password = 'event-return-password';

  // An account that already exists, made the ordinary way. It is created away
  // from the event so nothing about the event is in play when it is made.
  await page.goto('/signup');
  await expect(page.getByTestId('wsf-signup')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signup-displayName').fill('Event Return');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(password);
  await page.getByTestId('wsf-signup-submit').click();
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 20_000 });
  await markEmailVerified(email);
  await page.getByTestId('wsf-verify-check').click();
  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-profile-displayName').fill('Event Return');
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();
  await expect(page).not.toHaveURL(/profile-setup/, { timeout: 20_000 });

  // Sign out, so the next arrival at the event is a signed-out visitor.
  await page.goto('/');
  await expect(page.getByTestId('wsf-home-signout')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-home-signout').click();
  await expect(page.getByTestId('wsf-home-signout')).toHaveCount(0, { timeout: 20_000 });

  // SCAN. Whose screen is this, then the account invitation — never the
  // member view, which a visitor with no session cannot be shown.
  await page.goto(`/event/${goalId}`);
  await answerOwnPhone(page);
  await expect(page.getByTestId('wsf-event-signed-out')).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('wsf-event-signin').click();
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();

  // THE ASSERTION. The product returns to the exact scanned address, by
  // itself. Before this change the visitor landed on `/`.
  await expect(page).toHaveURL(new RegExp(`/event/${goalId}(\\?|$|#)`), { timeout: 30_000 });
});

test('a visitor who creates an account from a scanned event is brought back after verifying', async ({ page }) => {
  test.setTimeout(180_000);
  const goalId = goalFor('signup');
  const email = `event-return-signup-${Date.now()}@example.com`;

  await page.goto(`/event/${goalId}`);
  await answerOwnPhone(page);
  await expect(page.getByTestId('wsf-event-signed-out')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-event-signup').click();

  // signup -> verify-email -> profile-setup, three routes away from the event.
  await expect(page.getByTestId('wsf-signup')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signup-displayName').fill('New At The Event');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill('event-return-password');
  await page.getByTestId('wsf-signup-submit').click();
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 20_000 });

  // The interim gates must NOT bounce back early — the profile has to exist
  // first. Standing on verify-email is the proof that the return waited.
  await expect(page).toHaveURL(/verify-email/, { timeout: 20_000 });

  await markEmailVerified(email);
  await page.getByTestId('wsf-verify-check').click();
  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-profile-displayName').fill('New At The Event');
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();

  await expect(page).toHaveURL(new RegExp(`/event/${goalId}(\\?|$|#)`), { timeout: 30_000 });
});

test('a stored return that cannot be vouched for sends nobody anywhere', async ({ page }) => {
  test.setTimeout(180_000);
  const email = `event-return-tampered-${Date.now()}@example.com`;
  const password = 'event-return-password';

  await page.goto('/signup');
  await expect(page.getByTestId('wsf-signup')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-signup-displayName').fill('Tampered Return');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(password);
  await page.getByTestId('wsf-signup-submit').click();
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 20_000 });
  await markEmailVerified(email);
  await page.getByTestId('wsf-verify-check').click();
  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-profile-displayName').fill('Tampered Return');
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();
  await expect(page).not.toHaveURL(/profile-setup/, { timeout: 20_000 });

  await page.goto('/');
  await expect(page.getByTestId('wsf-home-signout')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-home-signout').click();
  await expect(page.getByTestId('wsf-home-signout')).toHaveCount(0, { timeout: 20_000 });

  // Three records nothing legitimate would ever write: an off-site address, a
  // path, and one stamped long enough ago to be a different visit.
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      'wsf.eventReturn',
      JSON.stringify({ goalId: 'https://evil.example.com/steal', at: Date.now() })
    );
  });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();

  // It lands on the ordinary destination. Nothing navigates off-site, and no
  // /event/ address is constructed from a value that was never a goal id.
  await expect(page.getByTestId('wsf-home-signout')).toBeVisible({ timeout: 30_000 });
  await expect(page).not.toHaveURL(/evil\.example\.com/);
  await expect(page).not.toHaveURL(/\/event\//);
  // Still on the app's own origin, which is the whole point of storing an id
  // and building the route rather than storing somebody's URL.
  const landed = new URL(page.url());
  const expected = new URL(String(process.env.WSF_PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5010'));
  expect(landed.host).toBe(expected.host);
});
