import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * GUIDED ACTIVITY RULES — the counting guide on the contribution entry screen.
 *
 * Modelled on ui-contribute.spec.ts: same emulator fixtures, same phone
 * viewport, same seeding helpers. It proves through the real interface:
 *   - the guide section is present on the ENTRY screen and collapsed on arrival
 *   - the toggle opens and closes it, and is at least 44 px tall
 *   - the heading is a level-2 heading under the entry screen's own h1
 *   - the rules shown are the table's rules for the goal's unit
 *   - an unknown unit still gets a guide, phrased in that unit
 *   - a goal carrying activityGuideKey overrides the unit-derived guide
 *   - the guide is ABSENT on the review screen and on the receipt
 *   - the guide remembers nothing: a reload comes back collapsed
 *   - no guide text contradicts the screen's own "Count your own …" sentence,
 *     and none of it makes a claim the app has no standing to make
 *
 * Everything here is fixture data: names, totals and credits are seeded for
 * the run and are not real members or activity.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-contribute-guide');
const PHONE = { width: 390, height: 844 };

// Mirrors GUIDE_BANNED_WORDS in src/activityGuides.ts. Whole words only:
// "closed" contains the letters of "lose" and is not a claim about anything.
const BANNED = /\b(safe|safely|injury|doctor|calorie|burn|lose|medical|health)\b/i;

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
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
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
  status: 'active' | 'closed';
  /** The per-goal counting-guide override, when the fixture carries one. */
  activityGuideKey?: string;
};

async function seedGoal(groupId: string, ownerUid: string, g: GoalSeed): Promise<void> {
  const now = new Date();
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: ownerUid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: g.title },
    target: { integerValue: String(g.target) },
    unit: { stringValue: g.unit },
    status: { stringValue: g.status },
    startsAt: tsField(new Date(now.getTime() - 11 * 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + 3 * 24 * 60 * 60_000)),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  };
  if (g.activityGuideKey) fields.activityGuideKey = { stringValue: g.activityGuideKey };
  await firestoreWrite(`wsfGoals/${g.goalId}`, fields);
  await seedShards(g.goalId, g.total);
}

async function seedCommunity(
  tag: string,
  displayName: string,
  members: Array<{ uid: string; role: 'foundingChampion' | 'member' }>
): Promise<string> {
  const now = new Date();
  const groupId = `uiG-${tag}`;
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: displayName },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') },
    createdByUserId: { stringValue: members[0]!.uid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
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
  return groupId;
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

async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: false });
}

type Fx = {
  stamp: string;
  password: string;
  memberEmail: string;
  memberUid: string;
  championUid: string;
  groupId: string;
};

async function seedBase(tag: string): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'uiG-password';
  const memberEmail = `wsf-uiG-member-${tag}-${stamp}@example.com`;
  const championEmail = `wsf-uiG-champ-${tag}-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);
  await seedProfile(championUid, 'Fixture Champion');
  await seedProfile(memberUid, 'Fixture Member');
  const groupId = await seedCommunity(`${tag}-${stamp}`, 'Maple Street Movers', [
    { uid: championUid, role: 'foundingChampion' },
    { uid: memberUid, role: 'member' },
  ]);
  return { stamp, password, memberEmail, memberUid, championUid, groupId };
}

test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

test('the counting guide toggles on the entry screen and is absent on the receipt', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const fx = await seedBase('toggle');
  const goalId = `uiG-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 241,
    status: 'active',
  });

  await signInVia(page, fx.memberEmail, fx.password);
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });

  // ---- 1. present, collapsed, in the goal's own words -------------------------
  const guide = page.getByTestId('wsf-contribute-guide');
  const toggle = page.getByTestId('wsf-contribute-guide-toggle');
  await expect(guide).toBeVisible();
  await expect(toggle).toContainText('How we count squats');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('wsf-contribute-guide-rule-0')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-guide-panel')).toHaveCount(0);
  await snap(page, '01-entry-guide-collapsed');

  // The toggle is a real target: 44 px is the floor the rest of this screen uses.
  const box = await toggle.boundingBox();
  expect(box, 'the toggle has a box').not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // A level-2 heading: one h1 for the screen, the guide's heading under it.
  const level2 = page.locator('[role="heading"][aria-level="2"]');
  await expect(level2.filter({ hasText: 'How we count squats' })).toHaveCount(1);
  // The screen's own sentence stays the h1; the guide sits under it.
  await expect(
    page.locator('[role="heading"][aria-level="1"]').first()
  ).toContainText('How many squats did you complete?');

  // ---- 2. it opens, with the table's squat rules -------------------------------
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('wsf-contribute-guide-panel')).toBeVisible();
  await expect(page.getByTestId('wsf-contribute-guide-rule-0')).toHaveText(
    'Count one squat when you stand back up.'
  );
  await expect(page.getByTestId('wsf-contribute-guide-rule-1')).toHaveText(
    'Count only the squats you finished.'
  );
  await expect(page.getByTestId('wsf-contribute-guide-counts')).toHaveText(
    'A squat counts when you go down and stand back up.'
  );
  await expect(page.getByTestId('wsf-contribute-guide-does-not-count')).toHaveText(
    'A squat you stopped partway through does not count.'
  );
  // The guide never contradicts the self-count truth the screen already tells.
  await expect(page.getByTestId('wsf-contribute-guide-self-count')).toHaveText(
    'You count your own. Nothing here checks it.'
  );
  const openText = await guide.innerText();
  expect(openText).not.toMatch(BANNED);
  expect(openText).not.toContain('!');
  // Counting rules only: nothing about depth, tempo, form or what to attempt.
  expect(openText).not.toMatch(/depth|tempo|form|posture|should|must|target/i);
  await snap(page, '02-entry-guide-open');

  // ---- 3. it closes again, and the entry controls are untouched ----------------
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('wsf-contribute-guide-panel')).toHaveCount(0);
  await page.getByTestId('wsf-contribute-entry').fill('20');
  await expect(page.getByTestId('wsf-contribute-entry')).toHaveValue('20');

  // ---- 4. it remembers nothing ---------------------------------------------------
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-guide-toggle')).toHaveAttribute(
    'aria-expanded',
    'false'
  );

  // ---- 5. absent on review, and absent on the receipt ---------------------------
  await page.getByTestId('wsf-contribute-entry').fill('20');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
  await expect(page.getByTestId('wsf-contribute-guide')).toHaveCount(0);

  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 20 squats.');
  await expect(page.getByTestId('wsf-contribute-guide')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-guide-toggle')).toHaveCount(0);
  await snap(page, '03-receipt-no-guide');
});

test('an unknown unit still gets a guide, and a per-goal key overrides the unit', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const fx = await seedBase('keys');

  // (a) a unit the default table has never heard of.
  const unknownGoalId = `uiG-unknown-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId: unknownGoalId,
    title: 'Burpees together',
    target: 300,
    unit: 'burpees',
    total: 40,
    status: 'active',
  });
  // (b) a goal whose unit says one thing and whose override says another.
  const overrideGoalId = `uiG-override-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId: overrideGoalId,
    title: 'Moving together',
    target: 20000,
    unit: 'movement',
    total: 500,
    status: 'active',
    activityGuideKey: 'steps',
  });

  await signInVia(page, fx.memberEmail, fx.password);

  await page.goto(`/contribute/${unknownGoalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-guide-toggle')).toContainText(
    'How we count burpees'
  );
  await page.getByTestId('wsf-contribute-guide-toggle').click();
  await expect(page.getByTestId('wsf-contribute-guide-rule-0')).toHaveText(
    'Count each completed burpees once.'
  );
  expect(await page.getByTestId('wsf-contribute-guide').innerText()).not.toMatch(BANNED);
  await snap(page, '04-unknown-unit-generic-guide');

  await page.goto(`/contribute/${overrideGoalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  // The heading is always the goal's own unit; the RULES are the override's.
  await expect(page.getByTestId('wsf-contribute-guide-toggle')).toContainText(
    'How we count movement'
  );
  await page.getByTestId('wsf-contribute-guide-toggle').click();
  await expect(page.getByTestId('wsf-contribute-guide-rule-0')).toHaveText(
    'Count each step you take.'
  );
  await expect(page.getByTestId('wsf-contribute-guide-does-not-count')).toHaveText(
    'Steps someone else took do not count.'
  );
  expect(await page.getByTestId('wsf-contribute-guide').innerText()).not.toMatch(BANNED);
  await snap(page, '05-override-wins');
});

test('the movement screen keeps its own words and gains no guide', async ({ page }) => {
  test.setTimeout(240_000);
  const fx = await seedBase('move');
  const goalId = `uiG-move-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 100,
    status: 'active',
  });

  await signInVia(page, fx.memberEmail, fx.password);
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=move`);
  await expect(page.getByTestId('wsf-contribute-move-screen')).toBeVisible({ timeout: 20_000 });
  // Unchanged, and still the only sentence about counting on this screen.
  await expect(page.getByTestId('wsf-contribute-move-screen')).toContainText(
    'Count your own squats. When you’re finished, enter the number you completed.'
  );
  await expect(page.getByTestId('wsf-contribute-guide')).toHaveCount(0);

  // The guide appears when the member reaches entry, and says nothing that
  // contradicts the sentence they just read.
  await page.getByTestId('wsf-contribute-done').click();
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible();
  await page.getByTestId('wsf-contribute-guide-toggle').click();
  const text = await page.getByTestId('wsf-contribute-guide').innerText();
  expect(text).not.toMatch(BANNED);
  expect(text).not.toMatch(/\b(verified|confirmed|checked by|approved|proves)\b/i);
});
