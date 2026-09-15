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
async function seedGroupAndGoal(opts: {
  uidA: string;
  uidB: string;
  target: number;
  unit: string;
  title: string;
}): Promise<{ groupId: string; goalId: string }> {
  const now = new Date();
  const startsAt = new Date(now.getTime() - 60_000);
  const endsAt = new Date(now.getTime() + 60 * 60_000);

  const groupId = `e4a1grp-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const goalId = `e4a1goal-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;

  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'E4-A1 synthetic community' },
    groupType: { stringValue: 'custom' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') },
    createdByUserId: { stringValue: opts.uidA },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });

  for (const uid of [opts.uidA, opts.uidB]) {
    await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
      groupId: { stringValue: groupId },
      userId: { stringValue: uid },
      role: { stringValue: 'foundingChampion' },
      membershipStatus: { stringValue: 'active' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }

  await firestoreWrite(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: opts.uidA },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: opts.title },
    target: { integerValue: String(opts.target) },
    unit: { stringValue: opts.unit },
    status: { stringValue: 'active' },
    startsAt: tsField(startsAt),
    endsAt: tsField(endsAt),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });

  return { groupId, goalId };
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


test.describe('community goal seam', () => {
  test('champion and member reach the goal from the community page and contribute once each', async ({
    browser,
  }) => {
    const stamp = Date.now().toString(36);
    const passwordA = `Aa1!${randomBytes(6).toString('hex')}`;
    const passwordB = `Bb1!${randomBytes(6).toString('hex')}`;
    const emailA = `e5a-${stamp}@example.com`;
    const emailB = `e5b-${stamp}@example.com`;

    const uidA = await seedVerifiedUser(emailA, passwordA);
    const uidB = await seedVerifiedUser(emailB, passwordB);
    const { groupId, goalId } = await seedGroupAndGoal({
      uidA,
      uidB,
      target: 500,
      unit: 'squats',
      title: 'E5 community squats',
    });

    // Independent browser contexts — separate storage, separate sessions.
    const ctxA: BrowserContext = await browser.newContext();
    const ctxB: BrowserContext = await browser.newContext();
    const pageA: Page = await ctxA.newPage();
    const pageB: Page = await ctxB.newPage();
    const errorsA = captureConsoleErrors(pageA);

    try {
      // ---- A reaches the goal FROM THE COMMUNITY PAGE, not by a known id ----
      await signInVia(pageA, emailA, passwordA);
      await pageA.goto(`/community/${groupId}`);
      await expect(pageA.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });

      const goalLink = pageA.getByTestId(`wsf-community-goal-link-${goalId}`);
      await expect(goalLink, 'the goal card is the seam this package adds').toBeVisible({
        timeout: 20_000,
      });
      // A champion also gets an entry point to start one.
      await expect(pageA.getByTestId('wsf-community-start-goal')).toBeVisible();
      await goalLink.click();
      await pageA.waitForURL(new RegExp(`/contribute/${goalId}`), { timeout: 20_000 });

      // ---- A contributes ----
      await expect(pageA.getByTestId('wsf-contribute-entry')).toBeVisible({ timeout: 20_000 });
      await pageA.getByTestId('wsf-contribute-entry').fill('20');
      await pageA.getByTestId('wsf-contribute-submit').click();
      await expect(pageA.getByTestId('wsf-contribute-own-credit')).toContainText('20', {
        timeout: 20_000,
      });

      // ---- B, independently, reaches the same goal the same way ----
      await signInVia(pageB, emailB, passwordB);
      await pageB.goto(`/community/${groupId}`);
      await pageB.getByTestId(`wsf-community-goal-link-${goalId}`).click();
      await pageB.waitForURL(new RegExp(`/contribute/${goalId}`), { timeout: 20_000 });
      await pageB.getByTestId('wsf-contribute-entry').fill('30');
      await pageB.getByTestId('wsf-contribute-submit').click();
      await expect(pageB.getByTestId('wsf-contribute-own-credit')).toContainText('30', {
        timeout: 20_000,
      });

      // Each member's OWN credit is their own effort, never the shared total
      // and never the other member's number.
      await expect(pageB.getByTestId('wsf-contribute-own-credit')).not.toContainText('50');

      // ---- Direct navigation and reload through local Hosting ----
      // A static export alone does not establish this; the rewrite has to
      // actually serve a cold load of a dynamic route.
      const cold = await pageA.goto(`/contribute/${goalId}`);
      expect(cold?.status(), 'cold load of the contribution route').toBe(200);
      await expect(pageA.getByTestId('wsf-contribute-entry')).toBeVisible({ timeout: 20_000 });
      await pageA.reload();
      await expect(pageA.getByTestId('wsf-contribute-entry')).toBeVisible({ timeout: 20_000 });

      // ---- The display ROUTE loads. This is not acceptance of its access
      // rules: wsfGoalPulse has no eligibility check (Package E, open). ----
      const ctxC = await browser.newContext();
      const pageC = await ctxC.newPage();
      const display = await pageC.goto(`/display/${goalId}`);
      expect(display?.status(), 'cold load of the display route').toBe(200);
      await ctxC.close();

      // KNOWN_GAPS is this harness's existing allowance — a missing favicon
      // and the verification-email callable, neither of which this package
      // touches. Everything else would be a real defect.
      const unexpected = errorsA.filter((e) => !KNOWN_GAPS.some((gap) => e.includes(gap)));
      expect(unexpected, 'no unexpected console errors on the member path').toEqual([]);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('a community with no goal says so, and does not claim one is missing when the load failed', async ({
    browser,
  }) => {
    const stamp = Date.now().toString(36);
    const password = `Cc1!${randomBytes(6).toString('hex')}`;
    const email = `e5empty-${stamp}@example.com`;
    const uid = await seedVerifiedUser(email, password);

    // Seed a group and membership but NO goal, by reusing the seeder and then
    // closing the goal it creates.
    const { groupId, goalId } = await seedGroupAndGoal({
      uidA: uid,
      uidB: uid,
      target: 100,
      unit: 'reps',
      title: 'E5 closed goal',
    });
    await firestoreWrite(`wsfGoals/${goalId}`, {
      ownerUid: { stringValue: uid },
      communityGroupId: { stringValue: groupId },
      title: { stringValue: 'E5 closed goal' },
      target: { integerValue: '100' },
      unit: { stringValue: 'reps' },
      status: { stringValue: 'closed' },
      startsAt: tsField(new Date(Date.now() - 120_000)),
      endsAt: tsField(new Date(Date.now() + 120_000)),
      timezone: { stringValue: 'America/New_York' },
    });

    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await signInVia(page, email, password);
      await page.goto(`/community/${groupId}`);
      await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 20_000 });

      // A SUCCESSFUL response with no eligible goals — the only state in which
      // "no goal running yet" is a true statement about the community.
      await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 20_000 });
      // And not the failure state, which is a different fact.
      await expect(page.getByTestId('wsf-community-goals-error')).toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
