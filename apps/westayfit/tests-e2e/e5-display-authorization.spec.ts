import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';

/**
 * PACKAGE E — the display permission, driven through the REAL control.
 *
 * e4-a1-shared-goal already proves the server refuses an unauthorized display
 * read. It grants the permission by writing `aggregateDisplayAuthorized`
 * straight to Firestore, which proves the SERVER but says nothing about
 * whether a Champion can actually reach the permission, whether the interface
 * reports what happened truthfully, or whether revoking through the interface
 * stops a display that is already running. A callable-only action is not a
 * completed member experience, and a database write is not the control.
 *
 * Everything here drives the control a Champion actually touches:
 *   CASE 1  the round trip — authorize via the interface, an anonymous display
 *           picks up the aggregate, an ordinary member has no such control,
 *           revoke via the interface, the running display stops, members keep
 *           their own view, closure does not revoke, and the Champion can
 *           still revoke after closure.
 *   CASE 2  a lost response — the request never comes back. The screen must
 *           not claim an outcome it has not established, and the retry must
 *           send the value that was asked for.
 *   CASE 3  a DELAYED display response — an older successful response released
 *           after a revocation has already been refused. The protected total
 *           must not reappear. This is the regression: without response
 *           sequencing the revocation is undone by physics alone.
 *
 * Synthetic throughout, same fixtures as e4-a1: disposable verified auth users
 * and documents seeded to the emulators under the admin bypass.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';

const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'e5-display-authorization');

async function seedVerifiedUser(email: string, password: string): Promise<string> {
  const headers = { authorization: 'Bearer owner', 'content-type': 'application/json' };
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const signup = await fetch(`${base}/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!signup.ok) throw new Error(`emulator signUp failed: ${signup.status} ${await signup.text()}`);
  const { localId } = (await signup.json()) as { localId: string };
  const update = await fetch(`${base}/accounts:update`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ localId, emailVerified: true }),
  });
  if (!update.ok) throw new Error(`emulator verify failed: ${update.status} ${await update.text()}`);
  return localId;
}

async function firestoreWrite(
  docPath: string,
  fields: Record<string, unknown>,
  updateMask?: string[]
): Promise<void> {
  const mask = updateMask?.length
    ? '?' + updateMask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')
    : '';
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/${docPath}${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
  }
}

async function readGoalAuthorization(goalId: string): Promise<boolean> {
  // Reads the STORED value straight from the emulator, bypassing the app
  // entirely. When a case asserts what the permission actually is, it asks
  // Firestore — never the screen that is itself under test.
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/wsfGoals/${goalId}`;
  const res = await fetch(url, { headers: { authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`emulator read failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    fields?: { aggregateDisplayAuthorized?: { booleanValue?: boolean } };
  };
  return body.fields?.aggregateDisplayAuthorized?.booleanValue === true;
}

function tsField(d: Date): { timestampValue: string } {
  return { timestampValue: d.toISOString() };
}

type Fixture = {
  groupId: string;
  goalId: string;
  championUid: string;
  memberUid: string;
  championEmail: string;
  memberEmail: string;
  password: string;
};

/**
 * A private community with ONE Champion and ONE ordinary member. The
 * distinction matters: e4-a1 makes both users foundingChampion, which cannot
 * show that the control is Champion-only.
 */
async function seedFixture(tag: string): Promise<Fixture> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'e5-password';
  const championEmail = `wsf-e5-champ-${tag}-${stamp}@example.com`;
  const memberEmail = `wsf-e5-member-${tag}-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);

  const now = new Date();
  const groupId = `e5grp-${stamp}`;
  const goalId = `e5goal-${stamp}`;

  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'Package E synthetic community' },
    groupType: { stringValue: 'custom' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') },
    createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });

  for (const [uid, role] of [
    [championUid, 'foundingChampion'],
    [memberUid, 'member'],
  ] as const) {
    await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
      groupId: { stringValue: groupId },
      userId: { stringValue: uid },
      role: { stringValue: role },
      membershipStatus: { stringValue: 'active' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
    await firestoreWrite(`wsfMemberProfiles/${uid}`, {
      displayName: { stringValue: uid },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }

  // Display permission is deliberately ABSENT, not false: an existing goal
  // carries no such field, and the default has to be OFF for those too.
  await firestoreWrite(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: championUid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: 'Package E synthetic goal' },
    target: { integerValue: '5000' },
    unit: { stringValue: 'squats' },
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now.getTime() - 60_000)),
    endsAt: tsField(new Date(now.getTime() + 60 * 60_000)),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });

  return { groupId, goalId, championUid, memberUid, championEmail, memberEmail, password };
}

async function signInVia(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/(profile-setup)?$/, { timeout: 15_000 });
}

async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: true });
}

// ─────────────────────────────────────────────────────────────────────────────

test('CASE 1 — the permission is granted, used, withheld from members, and revoked, all through the interface', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const fx = await seedFixture('c1');

  const championCtx: BrowserContext = await browser.newContext();
  const champion = await championCtx.newPage();
  await signInVia(champion, fx.championEmail, fx.password);
  await champion.goto(`/community/${fx.groupId}`);

  const control = champion.getByTestId(`wsf-goal-display-auth-${fx.goalId}`);
  const toggle = champion.getByTestId(`wsf-goal-display-auth-toggle-${fx.goalId}`);
  const stateText = champion.getByTestId(`wsf-goal-display-auth-state-${fx.goalId}`);

  await expect(control).toBeVisible({ timeout: 20_000 });
  // The starting claim is the supportable one. The screen must not say the
  // total is "not on any public display" — it cannot know that about a
  // screenshot someone took last week.
  await expect(stateText).toHaveText('Public display is not authorized for this goal.');
  expect(await readGoalAuthorization(fx.goalId)).toBe(false);
  await snap(champion, '01-champion-default-off');

  // An anonymous display finds nothing while the permission is off.
  const displayCtx: BrowserContext = await browser.newContext();
  const display = await displayCtx.newPage();
  await display.goto(`/display/${fx.goalId}`);
  await expect(display.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });
  await snap(display, '02-display-refused');

  // ---- authorize, through the control ------------------------------------
  await toggle.click();
  await expect(stateText).toContainText('Public display is authorized for this goal.', {
    timeout: 20_000,
  });
  // The screen's claim has to match the stored permission, not merely look
  // settled.
  expect(await readGoalAuthorization(fx.goalId)).toBe(true);
  await snap(champion, '03-champion-authorized');

  // The anonymous display now serves the aggregate — and only the aggregate.
  await display.reload();
  await expect(display.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
  await expect(display.getByTestId('wsf-display-shared-total')).toBeVisible();
  // Never a member identity, never an individual contribution, never a count
  // of contributors.
  await expect(display.getByText(fx.memberUid)).toHaveCount(0);
  await expect(display.getByText(fx.championUid)).toHaveCount(0);
  await snap(display, '04-display-serving');

  // ---- an ordinary member has no such control ----------------------------
  const memberCtx: BrowserContext = await browser.newContext();
  const member = await memberCtx.newPage();
  await signInVia(member, fx.memberEmail, fx.password);
  await member.goto(`/community/${fx.groupId}`);
  // They see the community and the goal...
  await expect(member.getByTestId(`wsf-community-goal-link-${fx.goalId}`)).toBeVisible({
    timeout: 20_000,
  });
  // ...and no permission control at all. Not disabled — absent.
  await expect(member.getByTestId(`wsf-goal-display-auth-${fx.goalId}`)).toHaveCount(0);
  await expect(member.getByTestId(`wsf-goal-display-auth-toggle-${fx.goalId}`)).toHaveCount(0);
  await snap(member, '05-member-has-no-control');

  // ---- revoke, through the control ---------------------------------------
  await toggle.click();
  await expect(stateText).toHaveText('Public display is not authorized for this goal.', {
    timeout: 20_000,
  });
  expect(await readGoalAuthorization(fx.goalId)).toBe(false);
  await snap(champion, '06-champion-revoked');

  // The display that is ALREADY RUNNING stops on its own. No reload: the
  // revocation has to reach a screen nobody is standing at.
  await expect(display.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 30_000 });
  await snap(display, '07-display-stopped-without-reload');

  // ---- members keep their own view ---------------------------------------
  // Revoking a PUBLIC permission takes nothing away from the community. The
  // member path is membership, and membership did not change.
  await member.goto(`/contribute/${fx.goalId}`);
  await expect(member.getByTestId('wsf-contribute-screen')).toBeVisible({ timeout: 20_000 });
  await expect(member.getByTestId('wsf-contribute-shared-total')).toBeVisible();
  await snap(member, '08-member-retains-view');

  // ---- closure does not revoke -------------------------------------------
  await toggle.click();
  await expect(stateText).toContainText('Public display is authorized for this goal.', {
    timeout: 20_000,
  });
  // Closing is a lifecycle change, seeded directly because no callable closes
  // a goal yet. What is under test is that closing does NOT touch the
  // permission and does not strand the control.
  await firestoreWrite(`wsfGoals/${fx.goalId}`, { status: { stringValue: 'closed' } }, ['status']);

  await display.reload();
  await expect(display.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
  await expect(display.getByTestId('wsf-display-closed')).toBeVisible();
  await snap(display, '09-display-serves-closed-goal');

  // ---- the Champion can still revoke AFTER closure -----------------------
  await champion.reload();
  // The closed goal is distinct: no contribution route off it.
  await expect(champion.getByTestId(`wsf-community-goal-closed-${fx.goalId}`)).toBeVisible({
    timeout: 20_000,
  });
  await expect(champion.getByTestId(`wsf-community-goal-link-${fx.goalId}`)).toHaveCount(0);
  // And the control is still there, which is the whole point — the permission
  // outlived the goal, so the way to withdraw it has to as well.
  await expect(control).toBeVisible();
  await snap(champion, '10-closed-goal-keeps-control');

  await toggle.click();

  // Revoking removes the only thing keeping a CLOSED goal in the list, so the
  // card is gone the moment the change lands. That must not read as a crash:
  // the screen says what happened and names the goal it happened to.
  await expect(champion.getByTestId('wsf-goal-display-auth-confirmed-absent')).toContainText(
    'Public display has been removed for \u201CPackage E synthetic goal\u201D.',
    { timeout: 20_000 }
  );
  await expect(champion.getByTestId(`wsf-goal-display-auth-${fx.goalId}`)).toHaveCount(0);
  expect(await readGoalAuthorization(fx.goalId)).toBe(false);
  await snap(champion, '11-revoked-after-closure');

  await display.reload();
  await expect(display.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });
  await snap(display, '12-display-stopped-after-closure-revoke');

  await championCtx.close();
  await memberCtx.close();
  await displayCtx.close();
});

test('CASE 2 — a lost response is reported as unknown, and the retry sends the value that was asked for', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const fx = await seedFixture('c2');

  const ctx: BrowserContext = await browser.newContext();
  const champion = await ctx.newPage();
  await signInVia(champion, fx.championEmail, fx.password);
  await champion.goto(`/community/${fx.groupId}`);

  const toggle = champion.getByTestId(`wsf-goal-display-auth-toggle-${fx.goalId}`);
  const stateText = champion.getByTestId(`wsf-goal-display-auth-state-${fx.goalId}`);
  const unsettled = champion.getByTestId(`wsf-goal-display-auth-unsettled-${fx.goalId}`);
  await expect(stateText).toHaveText('Public display is not authorized for this goal.', {
    timeout: 20_000,
  });

  // ---- the write is lost AND the read-back is lost ------------------------
  // Nothing is known. The screen has to say so, in those words.
  let blockWrite = true;
  let blockRead = true;
  await champion.route('**/wsfSetGoalDisplayAuthorization', async (route: Route) => {
    if (blockWrite) return route.abort('failed');
    return route.continue();
  });
  await champion.route('**/wsfListGoals', async (route: Route) => {
    if (blockRead) return route.abort('failed');
    return route.continue();
  });

  await toggle.click();
  await expect(unsettled).toContainText('could not confirm', { timeout: 30_000 });
  await snap(champion, '20-unconfirmed');
  // And nothing was actually written, so the honest answer was also the
  // correct one.
  expect(await readGoalAuthorization(fx.goalId)).toBe(false);

  // The retry action is offered, and it is labelled with the value that was
  // asked for — not the inverse of what the card is showing.
  await expect(toggle).toHaveText('Try again: authorize public display');

  // ---- the write is lost, the read-back succeeds --------------------------
  // The outcome is now known: the change did not take. That is a different
  // fact from "unknown", and it gets different words.
  blockRead = false;
  await toggle.click();
  await expect(unsettled).toContainText('did not take effect', { timeout: 30_000 });
  await expect(stateText).toHaveText('Public display is not authorized for this goal.');
  expect(await readGoalAuthorization(fx.goalId)).toBe(false);
  await snap(champion, '21-did-not-take-effect');

  // ---- the retry goes through --------------------------------------------
  // It must send `true`, the value originally asked for. Inverting whatever
  // the card shows would land on the same value here by luck, so the case
  // that actually discriminates is below.
  blockWrite = false;
  await expect(toggle).toHaveText('Try again: authorize public display');
  await toggle.click();
  await expect(stateText).toContainText('Public display is authorized for this goal.', {
    timeout: 30_000,
  });
  expect(await readGoalAuthorization(fx.goalId)).toBe(true);
  await snap(champion, '22-retry-succeeded');

  // ---- the discriminating case: a request that SUCCEEDED on the server but
  // whose response was lost. Inverting the stale card value here would undo a
  // change the Champion did make.
  await toggle.click(); // asks for OFF
  await expect(stateText).toHaveText('Public display is not authorized for this goal.', {
    timeout: 30_000,
  });
  expect(await readGoalAuthorization(fx.goalId)).toBe(false);

  // Now: ask for ON, let the server receive it, and destroy the response.
  await champion.unroute('**/wsfSetGoalDisplayAuthorization');
  await champion.route('**/wsfSetGoalDisplayAuthorization', async (route: Route) => {
    // The request really is forwarded, so the server really does save the
    // change. Only the answer is lost.
    await route.fetch().catch(() => undefined);
    await route.abort('failed');
  });
  blockRead = true;
  await toggle.click();
  await expect(unsettled).toContainText('could not confirm', { timeout: 30_000 });
  // The server saved it.
  expect(await readGoalAuthorization(fx.goalId)).toBe(true);
  // And the retry still offers the value that was asked for — ON — rather
  // than the inverse of the stale OFF the card is showing. Clicking it must
  // not turn the permission back off.
  await expect(toggle).toHaveText('Try again: authorize public display');
  await snap(champion, '23-succeeded-but-unconfirmed');

  await champion.unroute('**/wsfSetGoalDisplayAuthorization');
  blockRead = false;
  await toggle.click();
  await expect(stateText).toContainText('Public display is authorized for this goal.', {
    timeout: 30_000,
  });
  // THE ASSERTION THIS CASE EXISTS FOR: still ON. A retry that inverted the
  // stale card value would have written false here and silently undone a
  // request that had succeeded.
  expect(await readGoalAuthorization(fx.goalId)).toBe(true);
  await snap(champion, '24-retry-did-not-undo');

  await ctx.close();
});

test('CASE 3 — a display response held from before a revocation cannot bring the protected total back', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const fx = await seedFixture('c3');

  // Start authorized, through the control, so the display has a real total.
  const championCtx: BrowserContext = await browser.newContext();
  const champion = await championCtx.newPage();
  await signInVia(champion, fx.championEmail, fx.password);
  await champion.goto(`/community/${fx.groupId}`);
  const toggle = champion.getByTestId(`wsf-goal-display-auth-toggle-${fx.goalId}`);
  const stateText = champion.getByTestId(`wsf-goal-display-auth-state-${fx.goalId}`);
  await expect(toggle).toBeVisible({ timeout: 20_000 });
  await toggle.click();
  await expect(stateText).toContainText('Public display is authorized for this goal.', {
    timeout: 20_000,
  });

  // A member puts a real, identifiable number on the board, so "the protected
  // total reappeared" is something the test can actually see.
  const memberCtx: BrowserContext = await browser.newContext();
  const member = await memberCtx.newPage();
  await signInVia(member, fx.memberEmail, fx.password);
  await member.goto(`/contribute/${fx.goalId}`);
  await expect(member.getByTestId('wsf-contribute-screen')).toBeVisible({ timeout: 20_000 });
  await member.getByTestId('wsf-contribute-entry').fill('137');
  await member.getByTestId('wsf-contribute-submit').click();
  await expect(member.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });

  // ---- the display, with one response held open --------------------------
  const displayCtx: BrowserContext = await browser.newContext();
  const display = await displayCtx.newPage();

  // `held` is a real SERVER RESPONSE, fetched while the goal is still
  // authorized and withheld from the page until after the refusal has landed.
  //
  // Holding the ROUTE and calling continue() later would not reproduce this at
  // all: continue() forwards the request at the moment it is called, so the
  // server would answer it AFTER the revocation and return the refusal. The
  // response has to be captured up front, which is what makes it genuinely
  // older than the refusal the screen has already accepted.
  let held: { route: Route; status: number; headers: Record<string, string>; body: string } | null =
    null;
  let holdNext = false;
  await display.route('**/wsfGoalPulse', async (route: Route) => {
    if (holdNext && !held) {
      holdNext = false;
      const response = await route.fetch();
      held = {
        route,
        status: response.status(),
        headers: response.headers(),
        body: await response.text(),
      };
      return; // fetched, but deliberately not delivered to the page
    }
    return route.continue();
  });

  await display.goto(`/display/${fx.goalId}`);
  await expect(display.getByTestId('wsf-display-shared-total')).toHaveText('137', {
    timeout: 20_000,
  });
  await snap(display, '30-display-showing-protected-total');

  // Hold the next poll. At this instant the goal is still authorized, so the
  // response this route captures is a SUCCESSFUL one carrying 137.
  holdNext = true;
  await expect.poll(() => held !== null, { timeout: 20_000 }).toBe(true);
  // Prove the held response really is the protected total, so that releasing
  // it below is a genuine attempt to repaint 137 and not a no-op.
  expect(held!.status).toBe(200);
  expect(held!.body).toContain('137');

  // ---- revoke while that older response is still in flight ----------------
  await toggle.click();
  await expect(stateText).toHaveText('Public display is not authorized for this goal.', {
    timeout: 20_000,
  });
  expect(await readGoalAuthorization(fx.goalId)).toBe(false);

  // A later poll gets the refusal and the display stops.
  await expect(display.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 30_000 });
  await snap(display, '31-display-stopped');

  // ---- now release the OLDER successful response --------------------------
  // It carries 137 and it is perfectly valid — it was authorized when it was
  // issued. It is simply older than the refusal, and the screen must not take
  // it.
  await held!.route.fulfill({
    status: held!.status,
    headers: held!.headers,
    body: held!.body,
  });

  // Give the released response, and several more poll intervals, every chance
  // to repaint the screen.
  await champion.waitForTimeout(6_000);

  await expect(display.getByTestId('wsf-display-not-available')).toBeVisible();
  await expect(display.getByTestId('wsf-display-shared-total')).toHaveCount(0);
  await expect(display.getByText('137')).toHaveCount(0);
  await snap(display, '32-protected-total-did-not-reappear');

  await championCtx.close();
  await memberCtx.close();
  await displayCtx.close();
});
