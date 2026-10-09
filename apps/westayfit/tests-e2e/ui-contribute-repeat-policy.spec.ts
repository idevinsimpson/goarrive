import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * PER-GOAL REPEAT POLICY — through the real interface.
 *
 * UNRUN IN THE AUTHORING WORKTREE: a worktree has no web build, so this spec
 * was written but never executed here. It is modelled line for line on
 * ui-contribute.spec.ts and expects the same emulator fixtures (auth 9099,
 * firestore 8080, functions 5001, project demo-wsf-local).
 *
 * Three goals, three policies, one member:
 *   'multiple' — the review screen says more can be added later, the confirmed
 *                result offers "Add more", and taking it records a SECOND
 *                contribution under a NEW attempt id, with own credit and the
 *                shared total both moving.
 *   'once'     — the review screen keeps today's sentence, the confirmed
 *                result offers no second contribution, and a second attempt
 *                forced through the same screen is refused in plain words
 *                with nothing recorded.
 *   ABSENT     — a goal written before the field existed behaves exactly as
 *                'multiple' does, which is what it has always done.
 *
 * The offer is named "Record more {unit}" — the wording Community Home already
 * uses for the same act — so the product has one name for it, not two.
 *
 * Everything here is fixture data: names, totals and credits are seeded for
 * the run and are not real members or activity.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-contribute-repeat-policy');
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
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` +
    `/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
}

async function firestoreRead(docPath: string): Promise<Record<string, any> | null> {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, { headers: { authorization: 'Bearer owner' } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`emulator read ${docPath} failed: ${res.status}`);
  return ((await res.json()) as { fields?: Record<string, any> }).fields ?? null;
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

async function shardSum(goalId: string): Promise<number> {
  let total = 0;
  for (let i = 0; i < 10; i += 1) {
    const f = await firestoreRead(`wsfGoalCounters/${goalId}/shards/${i}`);
    total += Number(f?.count?.integerValue ?? 0);
  }
  return total;
}

async function seedGoal(
  groupId: string,
  ownerUid: string,
  g: {
    goalId: string;
    title: string;
    target: number;
    unit: string;
    total: number;
    /** Omitted on purpose writes NO field — the shape a pre-existing goal has. */
    repeatPolicy?: 'once' | 'multiple';
  }
): Promise<void> {
  const now = new Date();
  const endsInMs = 3 * 24 * 60 * 60_000;
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: ownerUid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: g.title },
    target: { integerValue: String(g.target) },
    unit: { stringValue: g.unit },
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now.getTime() + endsInMs - 14 * 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + endsInMs)),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  };
  if (g.repeatPolicy) fields.repeatPolicy = { stringValue: g.repeatPolicy };
  await firestoreWrite(`wsfGoals/${g.goalId}`, fields);
  await seedShards(g.goalId, g.total);
}

async function seedCommunity(
  tag: string,
  displayName: string,
  members: Array<{ uid: string; role: 'foundingChampion' | 'member' }>
): Promise<string> {
  const now = new Date();
  const groupId = `uiRP-${tag}`;
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

/** Enter a number and walk it to the review screen. */
async function enterAndReview(page: Page, count: string): Promise<void> {
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-entry').fill(count);
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
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
  const password = 'uiRP-password';
  const memberEmail = `wsf-uiRP-member-${tag}-${stamp}@example.com`;
  const championEmail = `wsf-uiRP-champ-${tag}-${stamp}@example.com`;
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

test('multiple: the screen says more can be added, and "Add more" records a real second contribution', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const fx = await seedBase('multi');
  const goalId = `uiRP-goal-multi-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 100,
    repeatPolicy: 'multiple',
  });

  await signInVia(page, fx.memberEmail, fx.password);
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}`);

  // ---- 1. review says plainly that more can be added later -------------------
  await enterAndReview(page, '20');
  await expect(page.getByTestId('wsf-contribute-repeat-notice')).toHaveText(
    'This will be recorded toward this goal. You can add more later.'
  );
  await snap(page, '01-review-multiple');

  // ---- 2. first contribution -------------------------------------------------
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 20 squats.');
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('120 of 500 squats');
  // The offer exists, is named for the unit, and does not shout.
  const addMore = page.getByTestId('wsf-contribute-record-more');
  await expect(addMore).toHaveText('Record more squats');
  await expect(page.getByTestId('wsf-contribute-receipt')).not.toContainText('!');
  // Still a real 44 px target.
  const box = await addMore.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await snap(page, '02-receipt-with-add-more');

  const firstAttempt = await page.evaluate(
    (k) => window.localStorage.getItem(k),
    `wsf.pendingContribution.${goalId}.${fx.memberUid}`
  );
  // The confirmed attempt's reminder is retired once the server answers.
  expect(firstAttempt).toBeNull();

  // ---- 3. add more: a NEW attempt, not a replay -------------------------------
  await addMore.click();
  await enterAndReview(page, '15');
  await expect(page.getByTestId('wsf-contribute-review-quantity')).toHaveText('15 squats');
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  // "Recorded", not "Already recorded" — this is a second contribution.
  await expect(page.getByTestId('wsf-contribute-receipt')).toContainText('Recorded');
  await expect(page.getByTestId('wsf-contribute-receipt')).not.toContainText('Already recorded');
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 15 squats.');
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('135 of 500 squats');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toContainText('35');
  await snap(page, '03-second-contribution');

  // ---- 4. the server agrees ---------------------------------------------------
  expect(await shardSum(goalId)).toBe(135);
  const totals = await firestoreRead(`wsfGoalMemberTotals/${goalId}_${fx.memberUid}`);
  expect(Number(totals?.total?.integerValue)).toBe(35);
  expect(Number(totals?.contributionCount?.integerValue)).toBe(2);
  // The offer is still there: 'multiple' means more than two, as well.
  await expect(page.getByTestId('wsf-contribute-record-more')).toBeVisible();
});

test('absent policy: a goal written before the field existed behaves exactly as multiple', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const fx = await seedBase('absent');
  const goalId = `uiRP-goal-absent-${fx.stamp}`;
  // No repeatPolicy field at all — the shape every pre-existing goal has.
  await seedGoal(fx.groupId, fx.championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 100,
  });

  await signInVia(page, fx.memberEmail, fx.password);
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}`);

  await enterAndReview(page, '20');
  await expect(page.getByTestId('wsf-contribute-repeat-notice')).toHaveText(
    'This will be recorded toward this goal. You can add more later.'
  );
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-record-more')).toHaveText('Record more squats');
  await snap(page, '07-absent-policy-receipt');

  await page.getByTestId('wsf-contribute-record-more').click();
  await enterAndReview(page, '15');
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 15 squats.');
  expect(await shardSum(goalId)).toBe(135);
});

test('once: today’s copy is unchanged, no second contribution is offered, and a forced one is refused in plain words', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const fx = await seedBase('once');
  const goalId = `uiRP-goal-once-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 100,
    repeatPolicy: 'once',
  });

  await signInVia(page, fx.memberEmail, fx.password);
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}`);

  // ---- 1. review keeps today's sentence exactly ------------------------------
  await enterAndReview(page, '20');
  await expect(page.getByTestId('wsf-contribute-repeat-notice')).toHaveText(
    'This will be recorded once toward this goal.'
  );
  await snap(page, '04-review-once');

  // ---- 2. the result offers no second contribution ---------------------------
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 20 squats.');
  await expect(page.getByTestId('wsf-contribute-record-more')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-back')).toBeVisible();
  await snap(page, '05-receipt-once-no-add-more');

  // ---- 3. forcing a second attempt through the same screen is refused --------
  // A reload is the honest way to reach the entry screen again without an
  // affordance for it, and it also proves a NEW attempt id buys nothing.
  await page.reload();
  await enterAndReview(page, '15');
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-refused')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-refused')).toHaveAttribute(
    'data-reason',
    'alreadyContributed'
  );
  await expect(page.getByTestId('wsf-contribute-refused-headline')).toHaveText(
    'This goal takes one contribution from each member.'
  );
  await expect(page.getByTestId('wsf-contribute-refused-body')).toHaveText(
    'Your 15 squats were not recorded. Your earlier contribution to this goal still counts.'
  );
  await expect(page.getByTestId('wsf-contribute-refused')).not.toContainText('!');
  await snap(page, '06-refused-once');

  // ---- 4. nothing was recorded ------------------------------------------------
  expect(await shardSum(goalId)).toBe(120);
  // ---- 5. and Community Home does not invite what the goal will refuse -------
  await page.goto(`/community/${fx.groupId}`);
  await expect(page.getByTestId(`wsf-community-your-part-${goalId}`)).toBeVisible({
    timeout: 20_000,
  });
  // SLICE 2, item 7. THE SAME FACT IS NOT STATED TWICE ON ONE SCREEN.
  // The hero above now says "You've recorded 20 squats." — the number, in the
  // first viewport — so Your part no longer repeats it. It carries what the
  // hero does not: that the part is counted, and where. The number itself is
  // still asserted, one line down, on the surface that actually shows it.
  await expect(page.getByTestId(`wsf-community-goal-complete-${goalId}`)).toContainText(
    'You’ve recorded 20 squats.'
  );
  await expect(page.getByTestId(`wsf-community-your-part-${goalId}`)).toContainText(
    'Counted in the shared total above.'
  );
  // SLICE 1. The Your-part duplicate is gone from every goal now, so asserting
  // its absence here would pass for the wrong reason and prove nothing about
  // the repeat policy. The property this test exists for — Community Home does
  // not invite what the goal will refuse — now lives on the hero's own
  // controls, so that is what is asserted.
  //
  // SLICE 1f. BOTH ROUTES, not just the quiet one. Slice 1 gated only
  // "I already moved" and left the green primary inviting exactly the journey
  // this test proves the server refuses. Asserting only the quiet route's
  // absence would have passed while the loudest control on the screen still
  // offered it.
  await expect(page.getByTestId(`wsf-community-your-part-link-${goalId}`)).toHaveCount(0);
  await expect(page.getByTestId(`wsf-community-goal-record-${goalId}`)).toHaveCount(0);
  await expect(page.getByTestId(`wsf-community-goal-link-${goalId}`)).toHaveCount(0);
  // And the screen does not simply go blank where two controls were: it says
  // what was RECORDED, and why there is nothing further to do.
  const completed = page.getByTestId(`wsf-community-goal-complete-${goalId}`);
  await expect(completed).toBeVisible();
  await expect(completed).toContainText('You’ve recorded 20 squats.');
  await expect(completed).toContainText('This goal takes one contribution from each member.');
  await snap(page, '08-community-home-no-invitation');
  // The state a member actually meets, at phone width.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(completed).toBeVisible();
  await snap(page, '09-community-home-once-contributed-390');
  const totals = await firestoreRead(`wsfGoalMemberTotals/${goalId}_${fx.memberUid}`);
  expect(Number(totals?.total?.integerValue)).toBe(20);
  expect(Number(totals?.contributionCount?.integerValue)).toBe(1);
  // The refused attempt's reminder is retired, not left to be replayed.
  const pending = await page.evaluate(
    (k) => window.localStorage.getItem(k),
    `wsf.pendingContribution.${goalId}.${fx.memberUid}`
  );
  expect(pending).toBeNull();
});
