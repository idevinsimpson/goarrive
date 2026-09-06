import { expect, test } from '@playwright/test';

/**
 * E3.5 supplementary — pins surfaces `mu2-flow.spec.ts` does not touch:
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
 *  - §6.2: a member who edits their profile via /profile-setup?edit=1 must not
 *    lose their createdAt — the callable's update branch has to preserve it
 *    (the phone-test finding was that the client setDoc was clobbering it).
 *  - §6.9: a REAL Instagram-webview UA shows the banner; a real Safari UA
 *    does not. The URL override is a spec convenience but production behaviour
 *    turns on the UA sniff, so cover both. Dismissal survives navigation
 *    within a session (sessionStorage), which is what makes the banner
 *    non-annoying after the first Dismiss.
 *  - F9: a Private community's community page shows "Private" as the join
 *    policy, the human-readable type label, and a members count of 1.
 *
 * The signed-in home with a real membership card is exercised end-to-end by
 * mu2-flow.spec.ts's "re-visit the home shows the community" step. This spec
 * covers the signed-in empty state (no memberships yet) so the section header
 * and empty-state copy still ship.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
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

/**
 * Reads a profile document directly from the Firestore emulator via its REST
 * bypass (Bearer owner skips firestore.rules). Returns the raw REST envelope
 * so the caller can pull specific fields.timestampValue strings.
 */
async function readProfileDirect(uid: string): Promise<{
  createTime: string;
  fields: Record<string, { timestampValue?: string; stringValue?: string }>;
}> {
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/wsfMemberProfiles/${uid}`;
  const res = await fetch(url, { headers: { authorization: 'Bearer owner' } });
  if (!res.ok) {
    throw new Error(`profile read failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as {
    createTime: string;
    fields: Record<string, { timestampValue?: string; stringValue?: string }>;
  };
}

async function lookupUid(email: string): Promise<string> {
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' };
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const lookup = await fetch(`${base}/projects/${PROJECT_ID}/accounts:query`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ expression: [] }),
  });
  const { userInfo = [] } = (await lookup.json()) as {
    userInfo?: { localId: string; email?: string }[];
  };
  const user = userInfo.find((u) => u.email === email);
  if (!user) throw new Error(`no emulator account for ${email}`);
  return user.localId;
}

test('§6.2: re-saving the profile via ?edit=1 preserves createdAt', async ({ page }) => {
  // Sign up, verify, save profile once — this is the create branch of the
  // callable. Then hit /profile-setup?edit=1 and save again with a new name —
  // this must hit the update branch and NOT touch createdAt. If the client
  // ever falls back to setDoc-with-merge, createdAt gets clobbered by the new
  // serverTimestamp; that is the exact regression this test guards.
  const email = `e35-edit-${Date.now()}@example.com`;
  const password = 'e35-password';

  await page.goto('/signup');
  await page.getByTestId('wsf-signup-displayName').fill('Edit Me');
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

  const uid = await lookupUid(email);
  const firstRead = await readProfileDirect(uid);
  const originalCreatedAt = firstRead.fields.createdAt?.timestampValue;
  expect(originalCreatedAt, 'first save must stamp createdAt').toBeTruthy();

  // Come back through ?edit=1 and rename. Wait past 1s so serverTimestamp on
  // updatedAt necessarily lands on a different timestamp than createdAt.
  await page.waitForTimeout(1_100);
  await page.goto('/profile-setup?edit=1');
  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-profile-displayName').fill('Edit Me Renamed');
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();

  await expect(page.getByTestId('wsf-home-signed-in')).toBeVisible({ timeout: 15_000 });

  const secondRead = await readProfileDirect(uid);
  expect(
    secondRead.fields.createdAt?.timestampValue,
    'createdAt must be unchanged after an update'
  ).toBe(originalCreatedAt);
  expect(
    secondRead.fields.displayName?.stringValue,
    'displayName should reflect the edit'
  ).toBe('Edit Me Renamed');
  expect(
    secondRead.fields.updatedAt?.timestampValue,
    'updatedAt must move forward'
  ).not.toBe(originalCreatedAt);
});

// §6.9 — real UA sniffing. `test.describe.configure` + `test.use({ userAgent })`
// gives every test in the block a WebView-shaped navigator.userAgent, which is
// what production InAppBrowserBanner keys on. This is the deterministic
// complement to A8's URL override.
test.describe('§6.9 in-app-browser banner: Instagram UA shows it', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.20.109',
  });

  test('shows the banner on a real Instagram UA', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('wsf-in-app-banner')).toBeVisible({ timeout: 10_000 });
  });

  test('dismissal survives client-side navigation within the session', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('wsf-in-app-banner')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('wsf-in-app-banner-dismiss').click();
    await expect(page.getByTestId('wsf-in-app-banner')).toHaveCount(0);

    // Navigate to a different route in the same session — sessionStorage
    // persists across client-side navigation, so the banner must stay hidden.
    // /signup is a safe target because it exists both signed-in and out.
    await page.goto('/signup');
    await expect(page.getByTestId('wsf-signup')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('wsf-in-app-banner')).toHaveCount(0);
  });
});

test.describe('§6.9 in-app-browser banner: Safari UA does not show it', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  });

  test('a plain Safari UA never triggers the banner', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('wsf-home')).toBeVisible();
    await expect(page.getByTestId('wsf-in-app-banner')).toHaveCount(0);
  });
});

test('F9: a Private community shows Private + type label + members count', async ({ page }) => {
  // Sign up, verify, save profile, then start a Private community. Assert the
  // community page renders the human labels (not the raw enum) and the members
  // count section is present at 1.
  const email = `e35-f9-${Date.now()}@example.com`;
  const password = 'e35-password';
  const communityName = 'F9 Private Circle';

  await page.goto('/signup');
  await page.getByTestId('wsf-signup-displayName').fill('F9 Owner');
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
  await page.getByTestId('wsf-home-start').click();

  await expect(page.getByTestId('wsf-start')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-start-name').fill(communityName);
  // familyFriends defaults to `private`; be explicit so a default flip does
  // not silently drift this test off the case it is trying to pin.
  await page.getByTestId('wsf-start-groupType-familyFriends').click();
  await page.getByTestId('wsf-start-joinPolicy-private').click();
  await page.getByTestId('wsf-start-submit').click();

  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(communityName)).toBeVisible();
  // Human labels, not raw enums.
  await expect(page.getByTestId('wsf-community-policy')).toContainText('Private');
  await expect(page.getByTestId('wsf-community-type')).toContainText('Family and friends');
  await expect(page.getByTestId('wsf-community-member-count')).toContainText('1 member');
  // Private communities do not render the public invite URL.
  await expect(page.getByTestId('wsf-community-invite-url')).toHaveCount(0);
});
