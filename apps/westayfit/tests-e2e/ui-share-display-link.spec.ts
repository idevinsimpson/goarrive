import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * W7 SOCIAL — sharing the public display link, and only that.
 *
 * Modelled on tests-e2e/ui-community-home.spec.ts (same emulator seeding, same
 * sign-in helper) and tests-e2e/ui-display.spec.ts (anonymous display route).
 * UNRUN by the author: this worker cannot launch a browser. The integrator
 * runs it against the emulators.
 *
 * What it proves through the real interface:
 *   - the Share control exists on Community Home ONLY for a featured goal
 *     whose aggregate is authorized for public display
 *   - what it puts on the clipboard is exactly the /display/{goalId} URL on
 *     this origin, and the control confirms with "Copied"
 *   - the disclosure sentence is on screen BEFORE the link leaves
 *   - a sample community gets no control, because its display shows nothing
 *   - a non-member gets no control (and no Community Home at all)
 *   - the public display itself carries no share control — a wall panel has
 *     no one to share with
 *
 * Everything here is fixture data: community and goal names and totals are
 * seeded for this run and are not real members or real activity.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';
const PHONE = { width: 390, height: 844 };

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

async function firestoreWrite(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` + `/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
  }
}

function tsField(d: Date): { timestampValue: string } {
  return { timestampValue: d.toISOString() };
}

async function seedShards(goalId: string, total: number): Promise<void> {
  const per = Math.floor(total / 10);
  let rest = total - per * 10;
  for (let i = 0; i < 10; i += 1) {
    const count = per + (rest > 0 ? 1 : 0);
    if (rest > 0) rest -= 1;
    if (count === 0) continue;
    await firestoreWrite(`wsfGoalCounters/${goalId}/shards/${i}`, {
      count: { integerValue: String(count) },
    });
  }
}

type GoalSeed = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  total: number;
  endsInMs: number;
  displayAuthorized?: boolean;
};

async function seedGoal(groupId: string, ownerUid: string, g: GoalSeed): Promise<void> {
  const now = new Date();
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: ownerUid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: g.title },
    target: { integerValue: String(g.target) },
    unit: { stringValue: g.unit },
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now.getTime() + g.endsInMs - 14 * 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + g.endsInMs)),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  };
  if (g.displayAuthorized) fields.aggregateDisplayAuthorized = { booleanValue: true };
  await firestoreWrite(`wsfGoals/${g.goalId}`, fields);
  await seedShards(g.goalId, g.total);
}

async function seedCommunity(
  groupId: string,
  displayName: string,
  isSample: boolean,
  members: Array<{ uid: string; role: 'foundingChampion' | 'member' }>
): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: displayName },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') },
    createdByUserId: { stringValue: members[0]!.uid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: isSample },
    createdAt: tsField(new Date(now.getTime() - 40 * 24 * 60 * 60_000)),
    updatedAt: tsField(now),
  });
  for (const m of members) {
    await firestoreWrite(`wsfMemberships/${groupId}_${m.uid}`, {
      groupId: { stringValue: groupId },
      userId: { stringValue: m.uid },
      role: { stringValue: m.role },
      membershipStatus: { stringValue: 'active' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }
}

async function seedProfile(uid: string, displayName: string): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfMemberProfiles/${uid}`, {
    displayName: { stringValue: displayName },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
}

async function signInVia(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/(profile-setup)?$/, { timeout: 15_000 });
}

async function signOutFully(page: Page): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/');
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* ignore */
    }
    return new Promise<void>((resolve) => {
      const req = window.indexedDB.deleteDatabase('firebaseLocalStorageDb');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
}

test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

test('Share is offered only for an authorized display, and copies that URL', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'ui-share-password';

  // The clipboard route is the one under test, so the Web Share API is removed
  // before any script runs. Without this the assertion would depend on whether
  // the browser under test happens to implement navigator.share — the control
  // would then open a native sheet Playwright cannot see.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.addInitScript(() => {
    try {
      // Both the prototype property and any own property, so the feature
      // detection in src/shareGoalDisplay sees no `share` at all.
      delete (Navigator.prototype as unknown as Record<string, unknown>).share;
      delete (navigator as unknown as Record<string, unknown>).share;
    } catch {
      /* ignore */
    }
  });

  const championEmail = `wsf-share-champ-${stamp}@example.com`;
  const outsiderEmail = `wsf-share-out-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const outsiderUid = await seedVerifiedUser(outsiderEmail, password);
  await seedProfile(championUid, 'Fixture Champion');
  await seedProfile(outsiderUid, 'Fixture Outsider');

  // Three communities: one with an unauthorized featured goal, one with an
  // authorized featured goal, one sample community with an authorized goal.
  const plain = `uiShare-plain-${stamp}`;
  const shared = `uiShare-shared-${stamp}`;
  const sample = `uiShare-sample-${stamp}`;
  await seedCommunity(plain, 'Quiet Street Movers', false, [
    { uid: championUid, role: 'foundingChampion' },
  ]);
  await seedCommunity(shared, 'Maple Street Movers', false, [
    { uid: championUid, role: 'foundingChampion' },
  ]);
  await seedCommunity(sample, 'Sample Street Movers', true, [
    { uid: championUid, role: 'foundingChampion' },
  ]);

  const unauthorizedGoal = `uiShare-goal-plain-${stamp}`;
  const authorizedGoal = `uiShare-goal-shared-${stamp}`;
  const sampleGoal = `uiShare-goal-sample-${stamp}`;
  await seedGoal(plain, championUid, {
    goalId: unauthorizedGoal,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 241,
    endsInMs: 3 * 24 * 60 * 60_000,
  });
  await seedGoal(shared, championUid, {
    goalId: authorizedGoal,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 241,
    endsInMs: 3 * 24 * 60 * 60_000,
    displayAuthorized: true,
  });
  await seedGoal(sample, championUid, {
    goalId: sampleGoal,
    title: 'Sample squats',
    target: 500,
    unit: 'squats',
    total: 100,
    endsInMs: 3 * 24 * 60 * 60_000,
    displayAuthorized: true,
  });

  await signInVia(page, championEmail, password);

  // ---- unauthorized goal: nothing published, so nothing to share -----------
  await page.goto(`/community/${plain}`);
  await expect(page.getByTestId(`wsf-community-goal-percent-${unauthorizedGoal}`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId(`wsf-community-goal-share-${unauthorizedGoal}`)).toHaveCount(0);
  await expect(page.getByTestId(`wsf-community-goal-share-block-${unauthorizedGoal}`)).toHaveCount(0);

  // ---- sample community: the display would show a stranger nothing ---------
  await page.goto(`/community/${sample}`);
  await expect(page.getByTestId(`wsf-community-goal-percent-${sampleGoal}`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId(`wsf-community-goal-share-${sampleGoal}`)).toHaveCount(0);

  // ---- authorized goal: the control is there, and says what it shares ------
  await page.goto(`/community/${shared}`);
  await expect(page.getByTestId(`wsf-community-goal-percent-${authorizedGoal}`)).toBeVisible({
    timeout: 30_000,
  });
  const shareControl = page.getByTestId(`wsf-community-goal-share-${authorizedGoal}`);
  await expect(shareControl).toBeVisible();
  // The disclosure is on screen before the link leaves, not after.
  await expect(page.getByTestId(`wsf-community-goal-share-note-${authorizedGoal}`)).toHaveText(
    'Anyone with this link can see the shared progress — never who contributed.'
  );
  // With no Web Share API the control names what it actually does.
  await expect(shareControl).toHaveText('Copy display link');

  await shareControl.click();
  await expect(shareControl).toHaveText('Copied');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const origin = new URL(page.url()).origin;
  expect(copied).toBe(`${origin}/display/${authorizedGoal}`);
  // And it settles back on its own, without wiping anything else.
  await expect(shareControl).toHaveText('Copy display link', { timeout: 10_000 });

  // ---- the shared link really is the public display ------------------------
  await signOutFully(page);
  await page.goto(`/display/${authorizedGoal}`);
  await expect(page.getByTestId('wsf-display-shared-total')).toHaveText('241', { timeout: 30_000 });
  // A wall panel has no one to share with: no share control of any kind here.
  await expect(page.getByTestId(`wsf-community-goal-share-${authorizedGoal}`)).toHaveCount(0);
  await expect(page.locator('[data-testid^="wsf-community-goal-share"]')).toHaveCount(0);

  // ---- a non-member gets no Community Home, and so no share control --------
  await signInVia(page, outsiderEmail, password);
  await page.goto(`/community/${shared}`);
  await expect(page.getByTestId('wsf-community-not-member')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId(`wsf-community-goal-share-${authorizedGoal}`)).toHaveCount(0);
});

test('Community momentum states the open-goal roll-up, and counts no people', async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'ui-momentum-password';
  const memberEmail = `wsf-momentum-${stamp}@example.com`;
  const memberUid = await seedVerifiedUser(memberEmail, password);
  await seedProfile(memberUid, 'Fixture Member');

  // One community with a single open goal (no roll-up to make), one with two
  // open goals of which one has reached its target.
  const one = `uiMomentum-one-${stamp}`;
  const two = `uiMomentum-two-${stamp}`;
  await seedCommunity(one, 'Single Goal Movers', false, [{ uid: memberUid, role: 'member' }]);
  await seedCommunity(two, 'Two Goal Movers', false, [{ uid: memberUid, role: 'member' }]);

  const lone = `uiMomentum-lone-${stamp}`;
  const first = `uiMomentum-first-${stamp}`;
  const second = `uiMomentum-second-${stamp}`;
  await seedGoal(one, memberUid, {
    goalId: lone,
    title: 'Squats together',
    target: 500,
    unit: 'squats',
    total: 241,
    endsInMs: 3 * 24 * 60 * 60_000,
  });
  await seedGoal(two, memberUid, {
    goalId: first,
    title: 'Squats together',
    target: 500,
    unit: 'squats',
    total: 620,
    endsInMs: 3 * 24 * 60 * 60_000,
  });
  await seedGoal(two, memberUid, {
    goalId: second,
    title: 'Minutes walked',
    target: 5000,
    unit: 'minutes',
    total: 35,
    endsInMs: 40 * 24 * 60 * 60_000,
  });

  await signInVia(page, memberEmail, password);

  // One open goal: the hero already states it, so there is no second line.
  await page.goto(`/community/${one}`);
  await expect(page.getByTestId(`wsf-community-goal-percent-${lone}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wsf-community-momentum')).toHaveCount(0);

  // Two open goals, both confirmed, one of them reached.
  await page.goto(`/community/${two}`);
  await expect(page.getByTestId(`wsf-community-goal-percent-${second}`)).toBeVisible({
    timeout: 30_000,
  });
  const momentum = page.getByTestId('wsf-community-momentum');
  await expect(momentum).toHaveText('1 of 2 open goals reached together.', { timeout: 30_000 });
  // It counts goals. Nothing on this screen counts, bands or implies people.
  await expect(momentum).not.toContainText('member');
  await expect(momentum).not.toContainText('active');
  await expect(page.getByTestId('wsf-community')).not.toContainText('active this week');
});
