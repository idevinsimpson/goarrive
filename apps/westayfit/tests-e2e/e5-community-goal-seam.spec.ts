import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * E5 — the community → goal → contribution seam, in a real browser against the
 * isolated emulator suite (project `demo-wsf-local`).
 *
 * This is the reachability Package C exists to deliver. Before wsfListGoals a
 * member who did not create the goal had no way to learn its id, so the built
 * goal loop could not be entered from the community page at all.
 *
 * LABEL FOR THESE RESULTS:
 *   post-admission integration tested with fixture-seeded membership.
 * Memberships are seeded directly. Nothing here exercises invitations or
 * joining, and nothing here is evidence that Package D's admission controls
 * work. It is also not a physical-device pass.
 *
 * The display assertion below tests that the ROUTE LOADS. It is deliberately
 * NOT an acceptance of that route's access permissions: wsfGoalPulse still has
 * no eligibility check, which is the known display-authorization defect held
 * open as Package E and a release blocker.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
// E4-A1-R4: the browser run is namespaced to the emulator project. The client
// selects this id only under the build flag on a loopback host (selectProjectId).
const PROJECT_ID = 'demo-wsf-local';

const ARTIFACTS_DIR = path.resolve(
  __dirname,
  'artifacts',
  'e4-a1-shared-goal'
);

const KNOWN_GAPS = ['/favicon.ico', 'wsfSendVerificationEmail'];

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

/**
 * Create a verified auth user via the emulator's admin API and return the
 * localId (Firebase uid). This is the same admin surface mu2-flow's
 * markEmailVerified uses — signUp under `Bearer owner` skips send-a-verify-
 * mail entirely, so no wsfSendVerificationEmail 400 shows up on the console.
 */
async function seedVerifiedUser(email: string, password: string): Promise<string> {
  const headers = {
    authorization: 'Bearer owner',
    'content-type': 'application/json',
  };
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;

  const signup = await fetch(`${base}/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!signup.ok) {
    throw new Error(`emulator signUp failed: ${signup.status} ${await signup.text()}`);
  }
  const { localId } = (await signup.json()) as { localId: string };

  const update = await fetch(`${base}/accounts:update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localId, emailVerified: true }),
  });
  if (!update.ok) {
    throw new Error(`emulator verify failed: ${update.status} ${await update.text()}`);
  }
  return localId;
}

async function firestoreWrite(
  docPath: string,
  fields: Record<string, unknown>,
  updateMask?: string[]
): Promise<void> {
  // Without an updateMask the REST PATCH replaces the whole document; with one
  // it merges only the named fields (used for the closure/correction seams).
  const mask = updateMask?.length
    ? '?' + updateMask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')
    : '';
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/${docPath}${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer owner',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(
      `emulator write ${docPath} failed: ${res.status} ${await res.text()}`
    );
  }
}

function tsField(d: Date): { timestampValue: string } {
  return { timestampValue: d.toISOString() };
}

/**
 * Seed a wsfCommunityGroups doc + two wsfMemberships docs + a wsfGoals doc,
 * all straight to Firestore with the emulator's admin bypass. Returns the
 * ids the browser will need to drive /contribute/{goalId} and /display/{goalId}.
 */
/**
 * Seed ONLY what a post-admission test needs: two verified accounts, their
 * profiles, one community, and one membership each — A as foundingChampion,
 * B as an ordinary member. No goal: A creates that through the interface,
 * which is the journey under test.
 *
 * No identity fields beyond what the approved profile fixture already carries.
 */
async function seedCommunityWithRoles(opts: {
  championUid: string;
  memberUid: string;
}): Promise<{ groupId: string }> {
  const now = new Date();
  const groupId = `e5grp-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;

  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'E5 seam community' },
    groupType: { stringValue: 'custom' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') },
    createdByUserId: { stringValue: opts.championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });

  const roles: [string, string][] = [
    [opts.championUid, 'foundingChampion'],
    [opts.memberUid, 'member'],
  ];
  for (const [uid, role] of roles) {
    await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
      groupId: { stringValue: groupId },
      userId: { stringValue: uid },
      role: { stringValue: role },
      membershipStatus: { stringValue: 'active' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
    await firestoreWrite(`wsfMemberProfiles/${uid}`, {
      displayName: { stringValue: `E5 ${role}` },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }

  return { groupId };
}

/** Real sign-out through the interface, so the account switch is the product's own. */
async function signOutVia(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('wsf-home-signout')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-home-signout').click();
  await expect(page.getByTestId('wsf-home-signout')).toHaveCount(0, { timeout: 20_000 });
}

async function signInVia(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();
  // A verified user with a profile lands on /home; a verified user WITHOUT a
  // profile lands on /profile-setup. Either is fine — we don't need the
  // profile for wsfContribute; we just need the token in the tab.
  await page.waitForURL(/\/(profile-setup)?$/, { timeout: 15_000 });
}



/** The callable URL the browser actually calls, so a test can delay or fail it. */
function callableUrl(name: string): string {
  return `${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`;
}

test.describe('community goal seam', () => {
  test('a Champion creates a goal through the interface and an ordinary member contributes', async ({
    browser,
  }) => {
    const stamp = Date.now().toString(36);
    const pwChampion = `Aa1!${randomBytes(6).toString('hex')}`;
    const pwMember = `Bb1!${randomBytes(6).toString('hex')}`;
    const emailChampion = `e5champ-${stamp}@example.com`;
    const emailMember = `e5member-${stamp}@example.com`;

    const championUid = await seedVerifiedUser(emailChampion, pwChampion);
    const memberUid = await seedVerifiedUser(emailMember, pwMember);
    const { groupId } = await seedCommunityWithRoles({ championUid, memberUid });

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    const errorsA = captureConsoleErrors(pageA);

    try {
      // ---- A, the Champion, creates the goal THROUGH THE INTERFACE ----
      await signInVia(pageA, emailChampion, pwChampion);
      await pageA.goto(`/community/${groupId}`);
      await expect(pageA.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
      // No goal yet, and this is a successful empty response.
      await expect(pageA.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 20_000 });

      await pageA.getByTestId('wsf-community-start-goal').click();
      await pageA.waitForURL(/\/goals\/new/, { timeout: 20_000 });
      await expect(pageA.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 20_000 });
      // The community page passed the group it already knows.
      await expect(pageA.getByTestId('wsf-new-goal-group-id-input')).toHaveValue(groupId);

      await pageA.getByTestId('wsf-new-goal-title').fill('E5 created via the interface');
      await pageA.getByTestId('wsf-new-goal-target').fill('500');
      await pageA.getByTestId('wsf-new-goal-unit').fill('squats');
      await pageA.getByTestId('wsf-new-goal-submit').click();
      await expect(pageA.getByTestId('wsf-new-goal-created')).toBeVisible({ timeout: 20_000 });
      // Renders as "goalId: <id>".
      const goalId = (await pageA.getByTestId('wsf-new-goal-id').innerText())
        .replace(/^goalId:\s*/, '')
        .trim();
      expect(goalId, 'the goal id created through the interface').toMatch(/^\S+$/);

      // ---- B, an ordinary member, DISCOVERS it on the community page ----
      await signInVia(pageB, emailMember, pwMember);
      await pageB.goto(`/community/${groupId}`);
      await expect(pageB.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });
      // An ordinary member gets no Champion-only control.
      await expect(pageB.getByTestId('wsf-community-start-goal')).toHaveCount(0);

      await pageB.getByTestId(`wsf-community-goal-link-${goalId}`).click();
      await pageB.waitForURL(new RegExp(`/contribute/${goalId}`), { timeout: 20_000 });
      await pageB.getByTestId('wsf-contribute-entry').fill('30');
      await pageB.getByTestId('wsf-contribute-submit').click();
      // Exact: "Your confirmed credit: 30 squats" — not a substring that 130 would satisfy.
      await expect(pageB.getByTestId('wsf-contribute-own-credit')).toHaveText(
        'Your confirmed credit: 30 squats',
        { timeout: 20_000 }
      );

      // ---- A contributes too; each sees only their own credit ----
      await pageA.goto(`/contribute/${goalId}`);
      await pageA.getByTestId('wsf-contribute-entry').fill('20');
      await pageA.getByTestId('wsf-contribute-submit').click();
      await expect(pageA.getByTestId('wsf-contribute-own-credit')).toHaveText(
        'Your confirmed credit: 20 squats',
        { timeout: 20_000 }
      );
      await expect(pageA.getByTestId('wsf-contribute-shared-total')).toHaveText('50 squats', {
        timeout: 20_000,
      });
      await pageB.reload();
      await expect(pageB.getByTestId('wsf-contribute-own-credit')).toHaveText(
        'Your confirmed credit: 30 squats',
        { timeout: 20_000 }
      );
      await expect(pageB.getByTestId('wsf-contribute-shared-total')).toHaveText('50 squats');

      // ---- Direct navigation and reload through local Hosting ----
      const cold = await pageA.goto(`/contribute/${goalId}`);
      expect(cold?.status(), 'cold load of the contribution route').toBe(200);
      await expect(pageA.getByTestId('wsf-contribute-entry')).toBeVisible({ timeout: 20_000 });
      await pageA.reload();
      await expect(pageA.getByTestId('wsf-contribute-entry')).toBeVisible({ timeout: 20_000 });

      const unexpected = errorsA.filter((e) => !KNOWN_GAPS.some((gap) => e.includes(gap)));
      expect(unexpected, 'no unexpected console errors on the member path').toEqual([]);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('goal loading: delayed shows loading, failure shows unavailable, Retry recovers', async ({
    browser,
  }) => {
    const stamp = Date.now().toString(36);
    const pw = `Cc1!${randomBytes(6).toString('hex')}`;
    const email = `e5load-${stamp}@example.com`;
    const uid = await seedVerifiedUser(email, pw);
    const { groupId } = await seedCommunityWithRoles({ championUid: uid, memberUid: uid });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await signInVia(page, email, pw);

      // ---- delayed: loading, and NOT a claim that the community has no goal ----
      let release: (() => void) | null = null;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route(callableUrl('wsfListGoals'), async (route) => {
        await held;
        await route.continue();
      });
      await page.goto(`/community/${groupId}`);
      await expect(page.getByTestId('wsf-community-goals-loading')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('wsf-community-no-goal')).toHaveCount(0);
      (release as unknown as () => void)();
      await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 20_000 });
      await page.unroute(callableUrl('wsfListGoals'));

      // ---- failed: unavailable, and NOT an empty-community claim ----
      await page.route(callableUrl('wsfListGoals'), (route) => route.abort('failed'));
      await page.reload();
      await expect(page.getByTestId('wsf-community-goals-error')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('wsf-community-no-goal')).toHaveCount(0);
      // The Champion-only control is withheld while the state is unknown.
      await expect(page.getByTestId('wsf-community-start-goal')).toHaveCount(0);
      // The rest of the community page is still usable.
      await expect(page.getByTestId('wsf-community-type')).toBeVisible();

      // ---- Retry recovers ----
      await page.unroute(callableUrl('wsfListGoals'));
      await page.getByTestId('wsf-community-goals-retry').click();
      await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('wsf-community-goals-error')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });

  test('a delayed contribution failure cannot overwrite a newer attempt or leak across accounts', async ({
    browser,
  }) => {
    const stamp = Date.now().toString(36);
    const pwA = `Dd1!${randomBytes(6).toString('hex')}`;
    const pwB = `Ee1!${randomBytes(6).toString('hex')}`;
    const emailA = `e5da-${stamp}@example.com`;
    const emailB = `e5db-${stamp}@example.com`;
    const uidA = await seedVerifiedUser(emailA, pwA);
    const uidB = await seedVerifiedUser(emailB, pwB);
    const { groupId } = await seedCommunityWithRoles({ championUid: uidA, memberUid: uidB });

    // One shared browser context: this is the shared-device case.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await signInVia(page, emailA, pwA);
      await page.goto(`/community/${groupId}`);
      await page.getByTestId('wsf-community-start-goal').click();
      await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('wsf-new-goal-title').fill('E5 delayed-response goal');
      await page.getByTestId('wsf-new-goal-target').fill('500');
      await page.getByTestId('wsf-new-goal-unit').fill('squats');
      await page.getByTestId('wsf-new-goal-submit').click();
      await expect(page.getByTestId('wsf-new-goal-created')).toBeVisible({ timeout: 20_000 });
      const goalId = (await page.getByTestId('wsf-new-goal-id').innerText())
        .replace(/^goalId:\s*/, '')
        .trim();

      // ---- A starts attempt 1 and its response never resolves ----
      let failAttemptOne: (() => void) | null = null;
      const attemptOneHeld = new Promise<void>((resolve) => {
        failAttemptOne = resolve;
      });
      let intercepted = 0;
      await page.route(callableUrl('wsfContribute'), async (route) => {
        intercepted += 1;
        if (intercepted === 1) {
          await attemptOneHeld;
          await route.abort('failed');
          return;
        }
        await route.continue();
      });

      await page.goto(`/contribute/${goalId}`);
      await page.getByTestId('wsf-contribute-entry').fill('11');
      await page.getByTestId('wsf-contribute-submit').click();
      // Attempt 1 is persisted while in flight.
      const pendingKeyA = `wsf.pendingContribution.${goalId}.${uidA}`;
      await expect
        .poll(async () => page.evaluate((k) => window.localStorage.getItem(k) !== null, pendingKeyA), {
          timeout: 20_000,
        })
        .toBe(true);
      const attemptOneId = await page.evaluate(
        (k) => JSON.parse(window.localStorage.getItem(k) as string).attemptId,
        pendingKeyA
      );

      // ---- A -> B -> A, with attempt 1 still outstanding ----
      await signOutVia(page);
      await signInVia(page, emailB, pwB);
      // B must see nothing of A's attempt: no banner, no receipt, no error.
      await page.goto(`/contribute/${goalId}`);
      await expect(page.getByTestId('wsf-contribute-pending')).toHaveCount(0);
      await expect(page.getByTestId('wsf-contribute-receipt')).toHaveCount(0);
      await expect(page.getByTestId('wsf-contribute-error')).toHaveCount(0);

      await signOutVia(page);
      await signInVia(page, emailA, pwA);
      await page.goto(`/contribute/${goalId}`);

      // ---- A reconciles attempt 1 successfully, then starts attempt 2 ----
      await expect(page.getByTestId('wsf-contribute-reconcile')).toBeVisible({ timeout: 20_000 });
      await page.getByTestId('wsf-contribute-reconcile').click();
      await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText(
        'Your confirmed credit: 11 squats',
        { timeout: 20_000 }
      );

      await page.getByTestId('wsf-contribute-entry').fill('7');
      await page.getByTestId('wsf-contribute-submit').click();
      await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText(
        'Your confirmed credit: 18 squats',
        { timeout: 20_000 }
      );

      // ---- NOW attempt 1's original request finally fails ----
      (failAttemptOne as unknown as () => void)();
      await page.waitForTimeout(1_500);

      // Attempt 2's work stands. Attempt 1 is not resurrected over it, and the
      // confirmed credit does not move.
      await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText(
        'Your confirmed credit: 18 squats'
      );
      await expect(page.getByTestId('wsf-contribute-pending')).toHaveCount(0);
      const stored = await page.evaluate(
        (k) => window.localStorage.getItem(k),
        pendingKeyA
      );
      expect(stored, 'an old failure must not resurrect a reconciled attempt').toBeNull();
      expect(attemptOneId, 'attempt 1 had its own identity').toMatch(/^\S+$/);
    } finally {
      await ctx.close();
    }
  });
});
