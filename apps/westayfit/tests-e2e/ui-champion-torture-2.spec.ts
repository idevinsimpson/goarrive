import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test';
import { openMemberManage } from './helpers/memberShell';

/**
 * CHAMPION TOOLS — TORTURE ROUND 2 (overnight 2026-09-18).
 *
 * Companion to e5-display-authorization.spec.ts. Same emulators, same
 * SYNTHETIC fixtures, the same real controls — one case the numbered cases
 * there do not reach.
 *
 * T8  THE CHAMPION WALKS AWAY MID-REQUEST. Champion tools are a sheet over
 *     Community Home, and the sheet is where the display-permission card
 *     lives. Closing it while a request is still outstanding unmounts the
 *     card that was going to report the outcome. The outcome must survive
 *     that: when the request finally fails with nobody watching, reopening
 *     the sheet has to find the same unresolved notice — and the retry still
 *     carrying the value that was asked for — rather than an ordinary toggle
 *     that quietly forgot a request the Champion made.
 *
 *     This is the same rule CASE 5 proves against work on ANOTHER goal, with
 *     the pressure applied from the other side: the surface itself goes away.
 *
 * Everything here is fixture data: disposable verified auth users and
 * documents seeded to the emulators under the admin bypass.
 *
 * Helpers below are COPIED from e5-display-authorization.spec.ts on purpose —
 * a spec that imports another spec's fixtures makes both harder to change.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';

const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-champion-torture-2');

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

/** A private community with ONE Champion and ONE ordinary member. */
async function seedFixture(tag: string): Promise<Fixture> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'ui-champ-password';
  const championEmail = `wsf-ct2-champ-${tag}-${stamp}@example.com`;
  const memberEmail = `wsf-ct2-member-${tag}-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);

  const now = new Date();
  const groupId = `ct2grp-${stamp}`;
  const goalId = `ct2goal-${stamp}`;

  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'Champion tools synthetic community' },
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

  // Display permission is deliberately ABSENT, not false.
  await firestoreWrite(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: championUid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: 'Champion tools synthetic goal' },
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

// The Champion's display-authorization controls live behind the "Manage"
// sheet on Community Home. Opening it is the real interaction a Champion
// performs, so every Champion visit goes through it.
async function openManage(page: Page): Promise<void> {
  await openMemberManage(page);
}

// ─────────────────────────────────────────────────────────────────────────────

test('T8 — closing the Manage sheet mid-request does not lose the outcome', async ({ browser }) => {
  test.setTimeout(180_000);
  const fx = await seedFixture('t8');

  const ctx: BrowserContext = await browser.newContext();
  const champion = await ctx.newPage();
  await signInVia(champion, fx.championEmail, fx.password);
  await champion.goto(`/community/${fx.groupId}`);
  await openManage(champion);

  const toggle = champion.getByTestId(`wsf-goal-display-auth-toggle-${fx.goalId}`);
  const stateText = champion.getByTestId(`wsf-goal-display-auth-state-${fx.goalId}`);
  const unsettled = champion.getByTestId(`wsf-goal-display-auth-unsettled-${fx.goalId}`);
  await expect(stateText).toHaveText('Public display is not authorized for this goal.', {
    timeout: 20_000,
  });
  expect(await readGoalAuthorization(fx.goalId)).toBe(false);

  // ---- the request is held open, and never reaches the server -------------
  // Held rather than aborted outright, so the Champion really does leave with
  // the request outstanding. The read-back is blocked too, so the outcome the
  // failure produces is the UNKNOWN one — the outcome with the most to lose.
  //
  // Blocking wsfListGoals from here is safe: the goal list is already loaded,
  // and the unknown-outcome path deliberately does not reload it.
  const hold: { route: Route | null } = { route: null };
  await champion.route('**/wsfSetGoalDisplayAuthorization', async (route: Route) => {
    if (!hold.route) {
      hold.route = route; // captured, and deliberately not resolved yet
      return;
    }
    return route.continue();
  });
  await champion.route('**/wsfListGoals', async (route: Route) => route.abort('failed'));

  await toggle.click();
  await expect(toggle).toHaveText('Saving…', { timeout: 20_000 });
  await expect.poll(() => hold.route !== null, { timeout: 20_000 }).toBe(true);
  await snap(champion, '70-saving-in-flight');

  // ---- the Champion closes the sheet while it is still in flight ----------
  await champion.getByTestId('wsf-community-manage-close').click();
  await expect(champion.getByTestId('wsf-community-manage-panel')).toBeHidden();
  // The card that was going to report the outcome is gone from the page.
  await expect(champion.getByTestId(`wsf-goal-display-auth-${fx.goalId}`)).toHaveCount(0);
  await expect(unsettled).toHaveCount(0);
  // The community itself is still perfectly usable underneath.
  await expect(champion.getByTestId('wsf-community-name')).toBeVisible();
  await snap(champion, '71-sheet-closed-mid-request');

  // ---- and now the request fails, with nobody looking ---------------------
  await hold.route!.abort('failed');
  // Nothing was ever sent, so nothing was saved. The honest answer is also
  // the correct one.
  expect(await readGoalAuthorization(fx.goalId)).toBe(false);

  // ---- reopening Manage finds the outcome waiting -------------------------
  // THE ASSERTION THIS CASE EXISTS FOR. Unmounting the card must not settle,
  // clear or forget the operation it belonged to.
  await openManage(champion);
  await expect(unsettled).toContainText('could not confirm', { timeout: 30_000 });
  // And the retry still carries the value that was asked for — ON — rather
  // than the inverse of the OFF the card is showing.
  await expect(toggle).toHaveText('Try again: authorize public display');
  await expect(stateText).toHaveText('Public display is not authorized for this goal.');
  expect(await readGoalAuthorization(fx.goalId)).toBe(false);
  await snap(champion, '72-outcome-survived-the-sheet');

  // ---- an unresolved outcome leaves only by being settled or dismissed ----
  await champion.getByTestId(`wsf-goal-display-auth-dismiss-${fx.goalId}`).click();
  await expect(unsettled).toHaveCount(0);
  await expect(toggle).toHaveText('Authorize public display');
  // Dismissing the notice says nothing about the permission, which is still
  // whatever the server holds.
  expect(await readGoalAuthorization(fx.goalId)).toBe(false);
  await snap(champion, '73-dismissed');

  await ctx.close();
});
