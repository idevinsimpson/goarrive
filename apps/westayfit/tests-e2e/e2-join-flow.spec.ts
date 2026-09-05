import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * E2 end-to-end: a signed-out visitor with only a `/join/<code>` URL reaches
 * `/community/<groupId>`. This spec pins the four criteria in
 * `docs/westayfit/dispatch/E2-JOIN-BY-QR.md §3` that a callable test cannot
 * observe on its own:
 *
 *   §3.1 — a second adult, given only the join URL, reaches the community
 *          page without ever being invited, never knowing the groupId.
 *   §3.4 — a cold load of `/join/<code>` returns 200 and renders. If the
 *          Hosting rewrite is missing, this fails; that is exactly the bug
 *          GATE 1 exists to catch.
 *   §3.5 — the signup round-trip: a signed-out visitor who signs up from the
 *          join page lands back on the join page, then in the community.
 *
 * The community itself is seeded directly against the Firestore emulator, one
 * step upstream of the app, because that mirrors reality: at the FitLife Expo
 * the single public community is pre-provisioned by hand and its QR is
 * printed before doors open. The visitor never creates it.
 *
 * §3.2 (idempotent join) and §3.3 (oracle test) are covered by callable
 * tests — those properties are cheaper to pin at that layer and would not add
 * signal here.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'goarrive';

/**
 * Emulator console noise this spec deliberately tolerates. Same list as
 * `mu2-flow.spec.ts` — keep the two in sync so a new gap has to be justified
 * in one place, not two.
 */
const KNOWN_GAPS = ['/favicon.ico', 'wsfSendVerificationEmail'];

function mintJoinCode(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * Seed a public, active `wsfCommunityGroups` document straight against the
 * Firestore emulator. The rule for that collection is `allow create: if false`
 * — server-only writes — so we hit the emulator via the admin bypass
 * (`Authorization: Bearer owner`), the same way `markEmailVerified` drives
 * the Auth emulator's admin API. This is a stand-in for what will happen on
 * Expo morning: a coach on the platform creates the FitLife group by hand
 * (via a callable path we do not have yet) and the code is printed on QR.
 */
async function seedPublicGroup(opts: {
  joinCode: string;
  displayName: string;
}): Promise<string> {
  const docId = `e2gate1-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/wsfCommunityGroups?documentId=${docId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer owner',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      fields: {
        displayName: { stringValue: opts.displayName },
        groupType: { stringValue: 'custom' },
        joinPolicy: { stringValue: 'public' },
        joinCode: { stringValue: opts.joinCode },
        createdByUserId: { stringValue: 'e2-seeder' },
        lifecycleStatus: { stringValue: 'active' },
        isSample: { booleanValue: false },
      },
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Firestore emulator seed failed: ${res.status} ${await res.text()}`
    );
  }
  return docId;
}

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

test('E2 §3.1/§3.4/§3.5: a signed-out visitor with only a join URL reaches /community/<id>', async ({
  page,
}) => {
  const errors = captureConsoleErrors(page);
  const joinCode = mintJoinCode();
  const displayName = 'Gate 1 Public Community';
  const groupId = await seedPublicGroup({ joinCode, displayName });

  // ---- §3.4: cold load of /join/<code> returns 200 ------------------------
  // The whole point of the Hosting rewrite. Without it, Expo's static export
  // lives at `dist/join/[joinCode].html`, which no direct URL can name, and
  // the QR that gets printed for the Expo is a 404 factory. Cold load first,
  // before any client-side navigation could paper over a missing rewrite.
  const cold = await page.goto(`/join/${encodeURIComponent(joinCode)}`);
  expect(cold, 'cold load must return a response').not.toBeNull();
  expect(cold!.status(), 'cold load of /join/<code>').toBe(200);

  // Signed-out preview renders the community that was seeded.
  await expect(page.getByTestId('wsf-join-signed-out')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(displayName)).toBeVisible();

  // Every WSF page is noindex, the join route included.
  const robots = await page
    .locator('meta[name="robots"]')
    .getAttribute('content', { timeout: 5_000 });
  expect(robots).toBe('noindex,nofollow');

  // ---- §3.5: signup round-trip -------------------------------------------
  // Tap "Sign up to join" — the pendingJoinCode was already stashed on mount.
  await page.getByTestId('wsf-join-signup').click();
  await expect(page.getByTestId('wsf-signup')).toBeVisible({ timeout: 15_000 });

  const email = `e2-join-${Date.now()}@example.com`;
  const password = 'e2-password';

  await page.getByTestId('wsf-signup-displayName').fill('Second Adult');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(password);
  await page.getByTestId('wsf-signup-adultCheckbox').click();
  await page.getByTestId('wsf-signup-submit').click();

  // Signup ships forward to verify-email even when the emulator's mail send
  // returns failed-precondition (no WSF_EMAIL_API_KEY on the emulator, by
  // design). See mu2-flow.spec.ts for the full reasoning.
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 15_000 });
  await markEmailVerified(email);
  await page.getByTestId('wsf-verify-check').click();

  await expect(page.getByTestId('wsf-profile')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-profile-adultCheckbox').click();
  await page.getByTestId('wsf-profile-termsCheckbox').click();
  await page.getByTestId('wsf-profile-submit').click();

  // The round-trip assertion. Without the pendingJoinCode wiring in
  // profile-setup.tsx, the visitor would land on /start-community — which
  // for someone who came in from a QR is the wrong exit entirely; they end
  // up being nudged to create a NEW community instead of joining the one
  // they scanned.
  await expect(page.getByTestId('wsf-join-signed-in')).toBeVisible({ timeout: 20_000 });
  expect(page.url(), 'round-trip should land back on /join/<code>').toContain(
    `/join/${encodeURIComponent(joinCode)}`
  );
  await expect(page.getByText(displayName)).toBeVisible();

  // ---- §3.1: join succeeds, lands on /community/<groupId> -----------------
  await page.getByTestId('wsf-join-submit').click();
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
  expect(page.url(), 'join should land on /community/<groupId>').toContain(
    `/community/${groupId}`
  );

  expect(
    errors.filter((e) => !KNOWN_GAPS.some((gap) => e.includes(gap))),
    'browser console errors during the E2 flow'
  ).toEqual([]);
});

test('E2 §3.4 negative: /join/<unknown-code> cold-loads 200 and renders the not-valid state', async ({
  page,
}) => {
  // A visitor who scans an old flyer or fat-fingers a link must not see a 404
  // — that would leak that "the rewrite worked once, therefore this code is a
  // real one that has been removed". Both unknown and non-public codes get
  // the same shell, same not-valid message, no distinction.
  const cold = await page.goto(`/join/${mintJoinCode()}`);
  expect(cold?.status(), 'unknown code must still resolve via the rewrite').toBe(200);
  await expect(page.getByTestId('wsf-join-invalid')).toBeVisible({ timeout: 20_000 });
});
