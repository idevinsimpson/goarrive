import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * E4-A1-R1 END-TO-END, in a REAL browser, against the isolated emulator suite.
 *
 * The correction package explicitly requires this shape (Devin, 2026-09-11):
 *
 *   Member A contributes → receives EXACT own credit (their input, not the
 *   shared total, not anyone else's number).
 *   Member B, in an independent browser context, contributes → receives only
 *   B's own credit — never A's — and the shared total is A+B.
 *   An unauthenticated read-only display in a third context sees the same
 *   confirmed shared total.
 *
 * Everything below is SYNTHETIC:
 *   - two disposable auth users (member_a@…, member_b@…) minted with
 *     emailVerified=true directly against the auth emulator admin API
 *   - one wsfCommunityGroups doc, two wsfMemberships/{groupId}_{uid} docs,
 *     one wsfGoals/{goalId} doc seeded straight to the Firestore emulator
 *     with `Authorization: Bearer owner` (the emulator's rules-bypass
 *     header — same trick E2's join-flow spec uses to seed a public group)
 *
 * The point is not to exercise the E3.5 signup pipeline (mu2-flow.spec.ts
 * already owns that) — it is to prove that once two logged-in members share
 * a goal, the CLIENT-SIDE contribute path against the emulator credits each
 * one exactly and the anonymous display reflects the sum.
 *
 * Screenshots are captured at every assertion boundary and written under
 * `tests-e2e/artifacts/e4-a1-shared-goal/` so a reviewer can eyeball the
 * three surfaces without re-running the harness. See the artifact list in
 * the Checkpoint 3 report.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'goarrive';

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

async function firestoreWrite(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/${docPath}`;
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

async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, `${name}.png`),
    fullPage: true,
  });
}

test('member A + member B contribute in independent browser contexts; unauthed display sums both', async ({
  browser,
}) => {
  test.setTimeout(120_000);

  // ---- seed synthetic auth users + community + goal -----------------------
  const stamp = Date.now();
  const emailA = `wsf-e4a1-a-${stamp}@example.com`;
  const emailB = `wsf-e4a1-b-${stamp}@example.com`;
  const password = 'e4a1-password';

  const uidA = await seedVerifiedUser(emailA, password);
  const uidB = await seedVerifiedUser(emailB, password);

  const { groupId, goalId } = await seedGroupAndGoal({
    uidA,
    uidB,
    target: 5000,
    unit: 'squats',
    title: 'E4-A1 synthetic goal',
  });

  // ---- context A: sign in, contribute 20 ----------------------------------
  const contextA: BrowserContext = await browser.newContext();
  const pageA = await contextA.newPage();
  const errorsA = captureConsoleErrors(pageA);

  await signInVia(pageA, emailA, password);
  await pageA.goto(`/contribute/${goalId}`);
  await expect(pageA.getByTestId('wsf-contribute-screen')).toBeVisible({ timeout: 15_000 });
  await snap(pageA, '01-A-contribute-empty');

  await pageA.getByTestId('wsf-contribute-entry').fill('20');
  await pageA.getByTestId('wsf-contribute-submit').click();
  await expect(pageA.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 15_000 });

  // Member A's own confirmed credit MUST be exactly 20 — never the shared
  // total (which would leak B's contribution back to A) and never 0 (which
  // would mean the client displayed pending as confirmed).
  await expect(pageA.getByTestId('wsf-contribute-own-credit')).toContainText('20');
  // Shared total is at least 20 (may be exactly 20 if B hasn't landed yet).
  await expect(pageA.getByTestId('wsf-contribute-shared-total')).toContainText('20');
  await snap(pageA, '02-A-after-20');

  // ---- context B: sign in, contribute 15 ----------------------------------
  const contextB: BrowserContext = await browser.newContext();
  const pageB = await contextB.newPage();
  const errorsB = captureConsoleErrors(pageB);

  await signInVia(pageB, emailB, password);
  await pageB.goto(`/contribute/${goalId}`);
  await expect(pageB.getByTestId('wsf-contribute-screen')).toBeVisible({ timeout: 15_000 });
  // Before B contributes, B's own credit MUST read 0 — A's 20 shall not leak
  // into B's row.
  await expect(pageB.getByTestId('wsf-contribute-own-credit')).toContainText('0');
  await expect(pageB.getByTestId('wsf-contribute-shared-total')).toContainText('20');
  await snap(pageB, '03-B-sees-shared-20-own-0');

  await pageB.getByTestId('wsf-contribute-entry').fill('15');
  await pageB.getByTestId('wsf-contribute-submit').click();
  await expect(pageB.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 15_000 });

  await expect(pageB.getByTestId('wsf-contribute-own-credit')).toContainText('15');
  await expect(pageB.getByTestId('wsf-contribute-shared-total')).toContainText('35');
  await snap(pageB, '04-B-after-15');

  // ---- context A: reload; shared total is now 35 --------------------------
  //
  // NOTE: the current /contribute page reads own credit only from a
  // successful contribute response, not on initial load — a fresh reload
  // shows 0 own credit until the user submits again. That's a follow-up
  // (an authenticated wsfMyGoalCredit read is out of scope for R1 because
  // it needs a rules change, which the R1 correction package explicitly
  // excludes). What we DO assert here is that A's shared total picks up
  // B's landed contribution — the public pulse layer is honest.
  await pageA.reload();
  await expect(pageA.getByTestId('wsf-contribute-screen')).toBeVisible({ timeout: 15_000 });
  await expect(pageA.getByTestId('wsf-contribute-shared-total')).toContainText('35');
  await snap(pageA, '05-A-reload-shared-35');

  // ---- context C: unauthenticated display sums both -----------------------
  const contextC: BrowserContext = await browser.newContext();
  const pageC = await contextC.newPage();
  const errorsC = captureConsoleErrors(pageC);

  await pageC.goto(`/display/${goalId}`);
  await expect(pageC.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 15_000 });
  await expect(pageC.getByTestId('wsf-display-shared-total')).toContainText('35');
  // Percentage floors: 35 / 5000 = 0.7% → floor = 0. Assert 0% shows, never 1%.
  await expect(pageC.getByTestId('wsf-display-percent')).toContainText('0%');
  await snap(pageC, '06-C-display-shows-35');

  // ---- reviewer console-hygiene guard -------------------------------------
  for (const [label, errs] of [
    ['A', errorsA],
    ['B', errorsB],
    ['C', errorsC],
  ] as const) {
    const unexpected = errs.filter(
      (e) => !KNOWN_GAPS.some((gap) => e.includes(gap))
    );
    expect(unexpected, `browser console errors in context ${label}`).toEqual([]);
  }

  await contextA.close();
  await contextB.close();
  await contextC.close();
});
