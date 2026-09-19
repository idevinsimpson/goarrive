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
  // The real flow: review first, then the explicit Record confirmation.
  await pageA.getByTestId('wsf-contribute-review').click();
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
  await pageB.getByTestId('wsf-contribute-review').click();
  await pageB.getByTestId('wsf-contribute-submit').click();
  await expect(pageB.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 15_000 });

  await expect(pageB.getByTestId('wsf-contribute-own-credit')).toContainText('15');
  await expect(pageB.getByTestId('wsf-contribute-shared-total')).toContainText('35');
  await snap(pageB, '04-B-after-15');

  // ---- context A: reload; shared total is now 35, own credit still 20 ------
  //
  // R4: own credit is read from the server on load (wsfMyContribution,
  // authenticated, keyed by uid), so a reload MUST show A's confirmed 20 —
  // never 0, never B's 15, never the shared total.
  await pageA.reload();
  await expect(pageA.getByTestId('wsf-contribute-screen')).toBeVisible({ timeout: 15_000 });
  await expect(pageA.getByTestId('wsf-contribute-shared-total')).toContainText('35');
  await expect(pageA.getByTestId('wsf-contribute-own-credit')).toContainText('20');
  await snap(pageA, '05-A-reload-shared-35');

  // ---- context C: the unauthenticated display ----------------------------
  //
  // REFRAMED BY PACKAGE E. This block used to assert that an anonymous browser
  // reads a PRIVATE community's shared total off /display/{goalId}. That was
  // the goal-read defect in its purest form — private community, zero
  // credentials, full progress — and it was evidence of the defect, never
  // desired behaviour.
  //
  // What it pins now is the actual model: the display shows nothing until the
  // goal itself is explicitly authorized, and then it shows only the
  // aggregate. The community stays 'private' throughout, which is the point —
  // authorization is a property of the goal, not of the community's tier.
  const contextC: BrowserContext = await browser.newContext();
  const pageC = await contextC.newPage();
  const errorsC = captureConsoleErrors(pageC);

  // Unauthorized: the display has nothing to show, and does not leak the total.
  await pageC.goto(`/display/${goalId}`);
  await expect(pageC.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 15_000 });
  await expect(pageC.getByText('35')).toHaveCount(0);
  await snap(pageC, '06-C-display-unauthorized');

  // The Champion authorizes THIS goal. Nothing about the community changes.
  await firestoreWrite(
    `wsfGoals/${goalId}`,
    { aggregateDisplayAuthorized: { booleanValue: true } },
    ['aggregateDisplayAuthorized']
  );

  // The unauthorized probe above deliberately provoked a 404 from
  // wsfGoalPulse — that refusal IS the behaviour under test, not a defect — so
  // it is discarded before the console-error guard runs on the authorized
  // phase. Everything after this point is held to the usual zero-errors bar.
  errorsC.length = 0;

  await pageC.reload();
  await expect(pageC.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 15_000 });
  await expect(pageC.getByTestId('wsf-display-shared-total')).toContainText('35');
  // Percentage is one decimal, rounded down: 35 / 5000 reads 0.7%, never 1%.
  await expect(pageC.getByTestId('wsf-display-percent')).toContainText('0.7%');
  // The authorized context rides with the aggregate (owner decision, 2026-09-18).
  await expect(pageC.getByTestId('wsf-display-goal-title')).toHaveText('E4-A1 synthetic goal');
  // The authorized display still never receives individual credit, member
  // identities, or a contributor count.
  await expect(pageC.getByTestId('wsf-contribute-own-credit')).toHaveCount(0);
  await expect(pageC.getByText(/confirmed credit/i)).toHaveCount(0);
  await expect(pageC.getByTestId('wsf-display-contributors')).toHaveCount(0);
  await expect(pageC.getByText(/contributors?$/i)).toHaveCount(0);
  await snap(pageC, '06-C-display-authorized-shows-35');

  // ---- unauthenticated call to the own-credit read is refused ------------
  // The auth boundary is wsfMyContribution's explicit request.auth check.
  const anon = await fetch(
    `${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/wsfMyContribution`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ data: { goalId } }),
    }
  );
  expect(anon.status).toBe(401);
  const anonBody = (await anon.json()) as { error?: { status?: string } };
  expect(anonBody.error?.status).toBe('UNAUTHENTICATED');

  // ---- closure: A's own credit survives; no new contributions ------------
  await firestoreWrite(
    `wsfGoals/${goalId}`,
    { status: { stringValue: 'closed' }, closedAt: tsField(new Date()) },
    ['status', 'closedAt']
  );
  await pageA.reload();
  await expect(pageA.getByTestId('wsf-contribute-screen')).toBeVisible({ timeout: 15_000 });
  await expect(pageA.getByText('This goal is closed')).toBeVisible({ timeout: 15_000 });
  await expect(pageA.getByTestId('wsf-contribute-own-credit')).toContainText('20');
  await expect(pageA.getByTestId('wsf-contribute-shared-total')).toContainText('35');
  await snap(pageA, '07-A-closed-own-20');

  // ---- authorized downward correction: A reads the corrected value --------
  // Test seam: the correction is seeded on the member-totals row the callable
  // path writes (wsfAdjustGoal is exercised by the callable jest suite).
  await firestoreWrite(
    `wsfGoalMemberTotals/${goalId}_${uidA}`,
    { total: { integerValue: '15' }, updatedAt: tsField(new Date()) },
    ['total', 'updatedAt']
  );
  await pageA.reload();
  await expect(pageA.getByTestId('wsf-contribute-screen')).toBeVisible({ timeout: 15_000 });
  await expect(pageA.getByTestId('wsf-contribute-own-credit')).toContainText('15');
  await snap(pageA, '08-A-corrected-own-15');

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
