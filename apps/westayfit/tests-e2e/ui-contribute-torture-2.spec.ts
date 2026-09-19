import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * CONTRIBUTION EXPERIENCE — TORTURE ROUND 2 (overnight 2026-09-18, Task 3).
 *
 * Companion to ui-contribute.spec.ts. Same emulators, same SYNTHETIC
 * fixtures, same phone viewport — but every scenario here is one the happy
 * path cannot reach: the member walks away mid-attempt, the goal closes
 * underneath them, a Champion corrects the tally, and the whole flow is
 * driven from the keyboard.
 *
 * What it proves through the real interface:
 *   - R5  leaving and coming back while an outcome is unknown restores the
 *         SAME attempt; the reminder beats mode=record, and returning never
 *         re-sends anything on its own
 *   - R7  an unresolved attempt stops the pulse poll, and the reminder shows
 *         no shared total it could not vouch for
 *   - R9  a goal closing during the unknown period: the attempt that LANDED
 *         replays as "already recorded" with the closed wording; the attempt
 *         that never landed is refused, and nothing is credited
 *   - R10 an authorized wsfAdjustGoal correction is what the contribute
 *         screen shows on the next load — own credit and shared total both
 *   - R8  a goal that closes while the member is on Review never becomes a
 *         write, and the poll surfaces the closure without one
 *   - R14 the pending reminder and the refusal screen are reachable and
 *         operable from the keyboard alone
 *
 * Everything here is fixture data: names, totals and credits are seeded for
 * the run and are not real members or activity.
 *
 * Helpers below are COPIED from ui-contribute.spec.ts on purpose — a spec
 * that imports another spec's fixtures makes both harder to change.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const PROJECT_ID = 'demo-wsf-local';
const PHONE = { width: 390, height: 844 };

function callableUrl(name: string): string {
  return `${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`;
}

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

/** An emulator ID token for a seeded account, for calling a callable over plain HTTP. */
async function emulatorIdToken(email: string, password: string): Promise<string> {
  const base = `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1`;
  const res = await fetch(`${base}/accounts:signInWithPassword?key=fake-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) throw new Error(`emulator signIn failed: ${res.status} ${await res.text()}`);
  const { idToken } = (await res.json()) as { idToken?: string };
  if (!idToken) throw new Error('emulator signIn returned no idToken');
  return idToken;
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

/** Spreads a total across the ten counter shards the way real writes do. */
async function seedShards(goalId: string, total: number): Promise<void> {
  const per = Math.floor(total / 10);
  let rest = total - per * 10;
  for (let i = 0; i < 10; i += 1) {
    const count = per + (rest > 0 ? 1 : 0);
    if (rest > 0) rest -= 1;
    if (count === 0) continue;
    await firestoreWrite(`wsfGoalCounters/${goalId}/shards/${i}`, { count: { integerValue: String(count) } });
  }
}

/** Someone else's contribution landing: bump one shard directly. */
async function addToShard(goalId: string, delta: number): Promise<void> {
  const current = await firestoreRead(`wsfGoalCounters/${goalId}/shards/9`);
  const now = Number(current?.count?.integerValue ?? 0);
  await firestoreWrite(`wsfGoalCounters/${goalId}/shards/9`, { count: { integerValue: String(now + delta) } });
}

type GoalSeed = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  total: number;
  status: 'active' | 'closed';
  endsInMs: number;
  displayAuthorized?: boolean;
  ownCredit?: { uid: string; total: number };
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
    startsAt: tsField(new Date(now.getTime() + g.endsInMs - 14 * 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + g.endsInMs)),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  };
  if (g.displayAuthorized) fields.aggregateDisplayAuthorized = { booleanValue: true };
  await firestoreWrite(`wsfGoals/${g.goalId}`, fields);
  await seedShards(g.goalId, g.total);
  if (g.ownCredit) {
    await firestoreWrite(`wsfGoalMemberTotals/${g.goalId}_${g.ownCredit.uid}`, {
      goalId: { stringValue: g.goalId },
      userId: { stringValue: g.ownCredit.uid },
      total: { integerValue: String(g.ownCredit.total) },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }
}

async function seedCommunity(
  tag: string,
  displayName: string,
  members: Array<{ uid: string; role: 'foundingChampion' | 'member' }>
): Promise<string> {
  const now = new Date();
  const groupId = `uiT2-${tag}`;
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

type Fx = {
  stamp: string;
  password: string;
  memberEmail: string;
  memberUid: string;
  championEmail: string;
  championUid: string;
  groupId: string;
};

/**
 * Same shape as ui-contribute.spec.ts's seedBase, plus the CHAMPION'S EMAIL:
 * R10 needs to act as the Champion over HTTP, which needs credentials, not
 * just a uid.
 */
async function seedBase(tag: string, communityName = 'Maple Street Movers'): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'uiT2-password';
  const memberEmail = `wsf-uiT2-member-${tag}-${stamp}@example.com`;
  const championEmail = `wsf-uiT2-champ-${tag}-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);
  await seedProfile(championUid, 'Fixture Champion');
  await seedProfile(memberUid, 'Fixture Member');
  const groupId = await seedCommunity(`${tag}-${stamp}`, communityName, [
    { uid: championUid, role: 'foundingChampion' },
    { uid: memberUid, role: 'member' },
  ]);
  return { stamp, password, memberEmail, memberUid, championEmail, championUid, groupId };
}

function pendingKey(goalId: string, uid: string): string {
  return `wsf.pendingContribution.${goalId}.${uid}`;
}

function activeGoal(goalId: string): GoalSeed {
  return {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 241,
    status: 'active',
    endsInMs: 3 * 24 * 60 * 60_000,
  };
}

/** Enter a number and get to Review. No write happens on this path. */
async function enterAndReview(page: Page, count: string): Promise<void> {
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-entry').fill(count);
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible({ timeout: 20_000 });
}

/**
 * Walk Tab from a clean focus state and record where focus lands, by
 * data-testid (falling back to the tag name so an unlabelled stop is still
 * visible in a failure message).
 */
async function tabWalk(page: Page, steps: number, stopAt?: string): Promise<string[]> {
  await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) active.blur();
  });
  const order: string[] = [];
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(80);
    const id = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return a?.getAttribute('data-testid') ?? a?.tagName ?? 'none';
    });
    order.push(id);
    if (stopAt && id === stopAt) break;
  }
  return order;
}

test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

// ─────────────────────────────────────────────────────────────────────────────
// R5 — leave and return while the outcome is unknown, same account.
// ─────────────────────────────────────────────────────────────────────────────
test('R5: leaving and returning while the outcome is unknown restores the SAME attempt, not a new one', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fx = await seedBase('leave');
  const goalId = `uiT2-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, activeGoal(goalId));
  const key = pendingKey(goalId, fx.memberUid);

  // Every attempt to reach the server is counted AND dropped: the member
  // never learns the outcome.
  let contributes = 0;
  await page.route(callableUrl('wsfContribute'), async (route: Route) => {
    contributes += 1;
    await route.abort('failed');
  });

  await signInVia(page, fx.memberEmail, fx.password);
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await enterAndReview(page, '20');
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });
  const stored = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) as string), key);
  expect(stored.state).toBe('unknown');
  expect(stored.count).toBe(20);
  expect(contributes, 'one Record, one attempt').toBe(1);

  // ---- leave, by the reminder's own exit -----------------------------------
  await expect(page.getByTestId('wsf-contribute-back')).toHaveText('Back to community', { timeout: 20_000 });
  await page.getByTestId('wsf-contribute-back').click();
  await expect(page.getByTestId('wsf-community-name').last()).toBeVisible({ timeout: 30_000 });
  // (The stack keeps the popped contribute screen mounted underneath, so its
  // elements are still in the DOM here; the assertions that matter are what
  // the member sees on return, below.)

  // ---- come back, on the link that normally opens the entry screen ---------
  // The unresolved attempt outranks mode=record: the member is never invited
  // to type a second number for effort that may already be counted.
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-pending').last()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-entry')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-pending-count').last()).toHaveText('You entered 20 squats.');
  await expect(page.getByTestId('wsf-contribute-reconcile').last()).toHaveText('Confirm this contribution');

  const restored = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) as string), key);
  expect(restored.attemptId, 'the same attempt, not a new one').toBe(stored.attemptId);
  expect(restored.count).toBe(20);
  expect(restored.state).toBe('unknown');

  // Coming back is not a retry. Nothing is sent until the member says so.
  await page.waitForTimeout(3_000);
  expect(contributes, 'returning never re-sends the attempt on its own').toBe(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// R7 — no poll, and no shared number, while the outcome is unknown.
// ─────────────────────────────────────────────────────────────────────────────
test('R7: an unresolved attempt stops the pulse poll and the reminder shows no shared total', async ({ page }) => {
  test.setTimeout(120_000);
  const fx = await seedBase('nopoll');
  const goalId = `uiT2-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, activeGoal(goalId));

  let pulses = 0;
  await page.route(callableUrl('wsfGoalPulse'), async (route: Route) => {
    pulses += 1;
    await route.continue();
  });
  await page.route(callableUrl('wsfContribute'), async (route: Route) => {
    await route.abort('failed');
  });

  await signInVia(page, fx.memberEmail, fx.password);
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await enterAndReview(page, '20');
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });

  // Let any tick issued before the reminder appeared finish, then snapshot.
  await page.waitForTimeout(1_000);
  const settled = pulses;
  expect(settled, 'the screen did poll while the member was still before the write').toBeGreaterThan(0);

  // A peer's 15 lands. The screen is showing an attempt whose outcome is
  // unknown; it must not start narrating a total it cannot place this
  // member's own effort inside.
  await addToShard(goalId, 15);
  await page.waitForTimeout(6_000);
  expect(pulses, 'the poll is off for the whole unknown period').toBe(settled);

  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-context')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-we')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-pending-count')).toHaveText('You entered 20 squats.');
  const reminder = await page.getByTestId('wsf-contribute-pending').innerText();
  expect(reminder, 'the reminder states the member’s own number and nothing else').not.toMatch(
    /of 500|241|256|261/
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// R9 — the goal closes DURING the unknown period. Both branches.
// ─────────────────────────────────────────────────────────────────────────────
test('R9: a goal closing while the outcome is unknown — the landed attempt replays, the lost one is refused', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fx = await seedBase('closing');
  const landedId = `uiT2-landed-${fx.stamp}`;
  const lostId = `uiT2-lost-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, activeGoal(landedId));
  await seedGoal(fx.groupId, fx.championUid, activeGoal(lostId));

  let mode: 'drop' | 'landButDrop' | 'pass' = 'landButDrop';
  await page.route(callableUrl('wsfContribute'), async (route: Route) => {
    if (mode === 'drop') {
      await route.abort('failed');
      return;
    }
    if (mode === 'landButDrop') {
      // The server records it; the client never hears back.
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await signInVia(page, fx.memberEmail, fx.password);

  // ---- (a) it LANDED, then the goal closed --------------------------------
  // Idempotency outranks closure: a member who did the reps and lost only the
  // answer is told it counted, once — with the goal's closed standing, not a
  // refusal.
  mode = 'landButDrop';
  await page.goto(`/contribute/${landedId}?groupId=${fx.groupId}&mode=record`);
  await enterAndReview(page, '20');
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });

  await firestoreWrite(`wsfGoals/${landedId}`, { status: { stringValue: 'closed' } }, ['status']);
  mode = 'pass';
  await page.getByTestId('wsf-contribute-reconcile').click();

  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'alreadyRecorded');
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText(
    'This contribution was already recorded.'
  );
  await expect(page.getByTestId('wsf-contribute-result-subline')).toContainText('It counted once.');
  // The closed wording, from the server's own status — not a celebration and
  // not a refusal.
  await expect(page.getByTestId('wsf-contribute-status')).toHaveText('Closed at 52.2%');
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('261 of 500 squats');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20 squats');
  await expect(page.getByTestId('wsf-contribute-refused')).toHaveCount(0);
  const landedText = await page.getByTestId('wsf-contribute-receipt').innerText();
  expect(landedText, 'a closed goal is never shamed and never re-celebrated').not.toMatch(
    /failed|missed|incomplete|WE did it|closer/i
  );
  expect(
    await page.evaluate((k) => window.localStorage.getItem(k), pendingKey(landedId, fx.memberUid)),
    'a resolved attempt retires its reminder'
  ).toBeNull();
  const landedTotal = await firestoreRead(`wsfGoalMemberTotals/${landedId}_${fx.memberUid}`);
  expect(Number(landedTotal?.total?.integerValue), 'counted exactly once').toBe(20);

  // ---- (b) it NEVER landed, and the goal closed ----------------------------
  // The replay reaches a closed goal for the first time: a definitive refusal
  // that names what was not recorded, and no credit anywhere.
  mode = 'drop';
  await page.goto(`/contribute/${lostId}?groupId=${fx.groupId}&mode=record`);
  await enterAndReview(page, '20');
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });

  await firestoreWrite(`wsfGoals/${lostId}`, { status: { stringValue: 'closed' } }, ['status']);
  mode = 'pass';
  await page.getByTestId('wsf-contribute-reconcile').click();

  await expect(page.getByTestId('wsf-contribute-refused')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-refused')).toHaveAttribute('data-reason', 'closed');
  await expect(page.getByTestId('wsf-contribute-refused-headline')).toHaveText(
    'This goal is no longer accepting contributions.'
  );
  await expect(page.getByTestId('wsf-contribute-refused-body')).toContainText('20 squats were not recorded');
  await expect(page.getByTestId('wsf-contribute-pending')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveCount(0);
  expect(
    await page.evaluate((k) => window.localStorage.getItem(k), pendingKey(lostId, fx.memberUid)),
    'a refused attempt leaves no reminder to replay'
  ).toBeNull();
  expect(
    await firestoreRead(`wsfGoalMemberTotals/${lostId}_${fx.memberUid}`),
    'nothing was credited for a refused attempt'
  ).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// R10 — an authorized correction is what the contribute screen shows next.
// ─────────────────────────────────────────────────────────────────────────────
test('R10: an authorized wsfAdjustGoal correction moves both own credit and the shared total on the contribute screen', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const fx = await seedBase('adjust');
  const goalId = `uiT2-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, activeGoal(goalId));

  await signInVia(page, fx.memberEmail, fx.password);
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await enterAndReview(page, '20');
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('261 of 500 squats');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20 squats');

  // ---- the Champion corrects a five that was counted twice ----------------
  // Over plain HTTP as the Champion's own account: the client never has a
  // path to this, and the screen must not need one.
  const idToken = await emulatorIdToken(fx.championEmail, fx.password);
  const res = await fetch(callableUrl('wsfAdjustGoal'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({
      data: { goalId, delta: -5, targetUid: fx.memberUid, reason: 'tally error' },
    }),
  });
  const rawBody = await res.text();
  expect(res.ok, `wsfAdjustGoal failed: ${res.status} ${rawBody}`).toBe(true);
  const adjusted = (JSON.parse(rawBody) as {
    result: { delta: number; sharedTotal: number; targetMemberTotal: number | null; targetUid: string | null };
  }).result;
  expect(adjusted.delta).toBe(-5);
  expect(adjusted.targetUid).toBe(fx.memberUid);
  expect(adjusted.sharedTotal).toBe(256);
  expect(adjusted.targetMemberTotal).toBe(15);

  // wsfGoalPulse caches for 2 s server-side; let that window pass so the
  // reload is reading the corrected total and not the cached one.
  await page.waitForTimeout(2_500);
  await page.reload();

  // Own credit is read from the server on every load — never derived from the
  // last receipt — so the correction is simply what the member now sees.
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText(
    'Your total on this goal: 15 squats',
    { timeout: 20_000 }
  );
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('256 of 500 squats', {
    timeout: 20_000,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R8 — the goal closes while the member is standing on Review.
// ─────────────────────────────────────────────────────────────────────────────
test('R8: a goal that closes while the member is on Review never becomes a write', async ({ page }) => {
  test.setTimeout(120_000);
  const fx = await seedBase('reviewclose');
  const goalId = `uiT2-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, activeGoal(goalId));

  let contributes = 0;
  await page.route(callableUrl('wsfContribute'), async (route: Route) => {
    contributes += 1;
    await route.continue();
  });

  await signInVia(page, fx.memberEmail, fx.password);
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await enterAndReview(page, '20');
  await expect(page.getByTestId('wsf-contribute-review-quantity')).toHaveText('20 squats');

  // The Champion closes the goal while the member is reading the review.
  await firestoreWrite(`wsfGoals/${goalId}`, { status: { stringValue: 'closed' } }, ['status']);

  // The poll is still running before the write, so the closure surfaces
  // without the member touching anything. Budget: the server's 2 s pulse
  // cache plus the client's 2 s poll, with room to spare.
  await expect(page.getByTestId('wsf-contribute-closed')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('wsf-contribute-review-screen')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-submit')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-entry')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('241 of 500 squats');

  // COPY GAP — documented, not asserted: the closed screen replaces the
  // review screen outright, so the 20 the member had just typed disappears
  // with no sentence accounting for it ("The goal closed before you recorded
  // your 20 squats" or similar). The accounting is correct — nothing was
  // written, nothing was promised — but the member is left to infer that.
  // A sentence here is a copy decision, not a behaviour change, so this test
  // pins only the behaviour.

  expect(contributes, 'a closure the member never confirmed past is never a write').toBe(0);
  expect(
    await firestoreRead(`wsfGoalMemberTotals/${goalId}_${fx.memberUid}`),
    'nothing was credited'
  ).toBeNull();
  expect(
    await page.evaluate((k) => window.localStorage.getItem(k), pendingKey(goalId, fx.memberUid)),
    'no attempt was ever started, so there is no reminder'
  ).toBeNull();
});

// ─────────────────────────────────────────────────────────────────────────────
// R14 — the recovery screens are operable from the keyboard alone.
// ─────────────────────────────────────────────────────────────────────────────
test('R14: the pending reminder and the refusal screen are reachable and operable by keyboard', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const fx = await seedBase('keys');
  const goalId = `uiT2-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, activeGoal(goalId));

  // A keyboard context: a desktop-shaped page at phone width, the same way
  // ui-qa.spec.ts drives its keyboard path.
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  try {
    let mode: 'drop' | 'pass' | 'closeThenPass' = 'drop';
    let hold: Promise<void> | null = null;
    await page.route(callableUrl('wsfContribute'), async (route: Route) => {
      if (mode === 'drop') {
        await route.abort('failed');
        return;
      }
      if (mode === 'closeThenPass') {
        // The goal closes after Record and before the server runs it, so the
        // refusal is deterministic — the same shape the definitive-refusal
        // test uses.
        await firestoreWrite(`wsfGoals/${goalId}`, { status: { stringValue: 'closed' } }, ['status']);
        await route.continue();
        return;
      }
      if (hold) await hold;
      await route.continue();
    });

    await signInVia(page, fx.memberEmail, fx.password);
    await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
    await enterAndReview(page, '20');
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });

    // ---- the reminder's one action is reachable by Tab ---------------------
    const pendingOrder = await tabWalk(page, 10, 'wsf-contribute-reconcile');
    expect(
      pendingOrder,
      `Confirm is reachable by Tab on the reminder; saw ${pendingOrder.join(' → ')}`
    ).toContain('wsf-contribute-reconcile');

    // ...and operable from the keyboard: Enter replays the SAME attempt.
    mode = 'pass';
    let release: () => void = () => undefined;
    hold = new Promise<void>((r) => {
      release = r;
    });
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('wsf-contribute-recording')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('wsf-contribute-recording')).toContainText('Recording your contribution…');
    release();
    hold = null;
    await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20 squats');
    expect(await page.evaluate((k) => window.localStorage.getItem(k), pendingKey(goalId, fx.memberUid))).toBeNull();

    // ---- a definitive refusal is reachable by Tab too -----------------------
    await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
    await enterAndReview(page, '12');
    mode = 'closeThenPass';
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-refused')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('wsf-contribute-refused')).toHaveAttribute('data-reason', 'closed');

    const refusedOrder = await tabWalk(page, 10, 'wsf-contribute-back');
    expect(
      refusedOrder,
      `the refusal's way out is reachable by Tab; saw ${refusedOrder.join(' → ')}`
    ).toContain('wsf-contribute-back');
  } finally {
    await ctx.close();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// R15 — membership lost AFTER an attempt whose outcome is unknown, discovered
// on a fresh load. The goal refuses to load for this account now, but the
// attempt is still theirs: the reminder must be reachable, and its replay must
// end in the truth (own-only receipt if it landed, a refusal if it never did).
// Before the overnight fix the "Goal not found" card rendered above the
// reminder, and the unresolved effort was silently unreachable.
// ─────────────────────────────────────────────────────────────────────────────
test('R15: an unresolved attempt stays reachable after membership is lost, and its replay ends in the truth', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const fx = await seedBase('lostafter');
  const landedId = `uiT2-landedlost-${fx.stamp}`;
  const lostId = `uiT2-lostlost-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, activeGoal(landedId));
  await seedGoal(fx.groupId, fx.championUid, activeGoal(lostId));

  let mode: 'drop' | 'landButDrop' | 'pass' = 'landButDrop';
  await page.route(callableUrl('wsfContribute'), async (route: Route) => {
    if (mode === 'drop') {
      await route.abort('failed');
      return;
    }
    if (mode === 'landButDrop') {
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await signInVia(page, fx.memberEmail, fx.password);

  // Two unknown attempts, one per goal: the first landed, the second never did.
  mode = 'landButDrop';
  await page.goto(`/contribute/${landedId}?groupId=${fx.groupId}&mode=record`);
  await enterAndReview(page, '20');
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });
  mode = 'drop';
  await page.goto(`/contribute/${lostId}?groupId=${fx.groupId}&mode=record`);
  await enterAndReview(page, '20');
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });

  // The Champion removes the member while both outcomes are unknown.
  await firestoreWrite(`wsfMemberships/${fx.groupId}_${fx.memberUid}`, { membershipStatus: { stringValue: 'removed' } }, ['membershipStatus']);
  mode = 'pass';

  // ---- (a) the landed attempt: reminder first, then the own-only receipt ----
  await page.goto(`/contribute/${landedId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-not-found')).toHaveCount(0);
  // The goal did not load for this account, so the unit is not on hand: the
  // number alone, never a guessed unit.
  await expect(page.getByTestId('wsf-contribute-pending-count')).toHaveText('You entered 20.');
  await expect(page.getByText('Maple Street Movers')).toHaveCount(0);
  await page.getByTestId('wsf-contribute-reconcile').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'ownOnly');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20');
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveCount(0);
  await expect(page.getByText('241')).toHaveCount(0);
  await expect(page.getByText('261')).toHaveCount(0);
  expect(await page.evaluate((k) => window.localStorage.getItem(k), pendingKey(landedId, fx.memberUid))).toBeNull();
  const landedTotal = await firestoreRead(`wsfGoalMemberTotals/${landedId}_${fx.memberUid}`);
  expect(Number(landedTotal?.total?.integerValue), 'counted exactly once').toBe(20);

  // ---- (b) the lost attempt: reminder first, then the honest refusal --------
  await page.goto(`/contribute/${lostId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-not-found')).toHaveCount(0);
  await page.getByTestId('wsf-contribute-reconcile').click();
  await expect(page.getByTestId('wsf-contribute-refused')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-refused')).toHaveAttribute('data-reason', 'notMember');
  await expect(page.getByTestId('wsf-contribute-refused-body')).toContainText('20 were not recorded');
  expect(await page.evaluate((k) => window.localStorage.getItem(k), pendingKey(lostId, fx.memberUid))).toBeNull();
  expect(await firestoreRead(`wsfGoalMemberTotals/${lostId}_${fx.memberUid}`)).toBeNull();
});
