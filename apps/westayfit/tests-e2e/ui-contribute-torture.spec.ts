import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * CONTRIBUTION EXPERIENCE — the hostile timings.
 *
 * ui-contribute.spec.ts drives the flow the way a member walks it. This file
 * drives the same flow the way a phone, a thumb and a bad network actually
 * behave: two taps in one task, a response that arrives after the member has
 * moved to another goal, a screen left and returned to mid-flight, and a
 * shared total that moved while nobody was allowed to look at it.
 *
 * Every test here asserts the same four invariants the product rests on:
 *   - the member's own effort is exactly what they entered, never more
 *   - the shared total shown is the server's current truth, never derived
 *   - one attempt is one credit, however many times it is sent
 *   - an unknown outcome is never silently discarded, and never re-sent as a
 *     NEW attempt
 *
 * Everything here is fixture data: names, totals and credits are seeded for
 * the run and are not real members or activity.
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

/** Someone else's contribution landing — or an authorized correction: bump one shard directly. */
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
};

async function seedGoal(groupId: string, ownerUid: string, g: GoalSeed): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfGoals/${g.goalId}`, {
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
  });
  await seedShards(g.goalId, g.total);
}

async function seedCommunity(
  tag: string,
  displayName: string,
  members: Array<{ uid: string; role: 'foundingChampion' | 'member' }>
): Promise<string> {
  const now = new Date();
  const groupId = `uiT-${tag}`;
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
  championUid: string;
  groupId: string;
};

async function seedBase(tag: string, communityName = 'Maple Street Movers'): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'uiT-password';
  const memberEmail = `wsf-uiT-member-${tag}-${stamp}@example.com`;
  const championEmail = `wsf-uiT-champ-${tag}-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);
  await seedProfile(championUid, 'Fixture Champion');
  await seedProfile(memberUid, 'Fixture Member');
  const groupId = await seedCommunity(`${tag}-${stamp}`, communityName, [
    { uid: championUid, role: 'foundingChampion' },
    { uid: memberUid, role: 'member' },
  ]);
  return { stamp, password, memberEmail, memberUid, championUid, groupId };
}

function pendingKey(goalId: string, uid: string): string {
  return `wsf.pendingContribution.${goalId}.${uid}`;
}

function readPending(page: Page, goalId: string, uid: string): Promise<any | null> {
  return page.evaluate((k) => {
    const raw = window.localStorage.getItem(k);
    return raw ? JSON.parse(raw) : null;
  }, pendingKey(goalId, uid));
}

/**
 * The attempt id of whatever is in the pending slot, once there is one.
 * The row is written BEFORE the request goes out, so this never races.
 */
async function awaitPendingAttempt(page: Page, goalId: string, uid: string): Promise<string> {
  await expect
    .poll(async () => (await readPending(page, goalId, uid)) !== null, { timeout: 20_000 })
    .toBe(true);
  return (await readPending(page, goalId, uid)).attemptId as string;
}

/**
 * Client-side back. A full page load would tear down the in-flight request
 * these tests exist to keep alive, so navigation between screens goes through
 * the router's own history, exactly as the device's back gesture does.
 */
async function historyBack(page: Page, expectUrl: RegExp): Promise<void> {
  await page.evaluate(() => window.history.back());
  await page.waitForURL(expectUrl, { timeout: 20_000 });
}

/** The community page re-pushes the contribute screen, so take the newest one. */
function screen(page: Page, testID: string) {
  return page.getByTestId(testID).last();
}

test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

/**
 * R1 — a double tap on Record.
 *
 * Two click events arrive in ONE task. A `submitting` flag read from React
 * state is last render's value for both of them, and so is `disabled` on the
 * button, so a state check alone cannot separate them. Credit is safe either
 * way — the second submission reuses the in-flight attempt id and the server
 * counts one attempt once — but two requests mean two replies, and the LAST
 * reply wins the screen. The member who really did add 20 squats is then told
 * their contribution "was already recorded", which is the one thing a first
 * successful contribution must never say.
 */
test('R1 — a double tap on Record is one submission and one truthful receipt', async ({ page }) => {
  test.setTimeout(120_000);
  const fx = await seedBase('r1');
  const goalId = `uiT-goal-r1-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 241,
    status: 'active',
    endsInMs: 3 * 24 * 60 * 60_000,
  });
  await signInVia(page, fx.memberEmail, fx.password);

  const seen: string[] = [];
  let delivered = 0;
  page.on('response', (r) => {
    if (r.url() === callableUrl('wsfContribute')) delivered += 1;
  });

  let releaseFirst: () => void = () => undefined;
  const firstHeld = new Promise<void>((r) => {
    releaseFirst = r;
  });
  await page.route(callableUrl('wsfContribute'), async (route: Route) => {
    const body = route.request().postDataJSON() as { data?: { attemptId?: string } };
    seen.push(body?.data?.attemptId ?? '?');
    if (seen.length === 1) {
      await firstHeld;
      await route.continue();
      return;
    }
    // Ordering is pinned, not left to the network: a SECOND request of the
    // same double tap reaches the server first and books the contribution,
    // so the first request's own reply — released afterwards — is the
    // server's idempotent "already recorded", and it lands last.
    const res = await route.fetch();
    await route.fulfill({ response: res });
  });

  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-entry').fill('20');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-submit')).toBeVisible();

  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="wsf-contribute-submit"]') as HTMLElement;
    const tap = () => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    tap();
    tap();
  });

  await expect(page.getByTestId('wsf-contribute-recording')).toBeVisible({ timeout: 20_000 });
  // Room for a second request, if one was sent, to reach the server and come
  // back before the first one is released.
  await page.waitForTimeout(2_500);
  releaseFirst();
  await expect.poll(() => delivered, { timeout: 30_000 }).toBe(seen.length);
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
  // Long enough for a late second reply to overwrite the receipt, if one exists.
  await page.waitForTimeout(2_000);

  expect(new Set(seen).size, 'one attempt id across every request the double tap produced').toBe(1);
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'ordinary');
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 20 squats.');
  await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText('You moved us closer.');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText(
    'Your total on this goal: 20 squats'
  );
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('261 of 500 squats');
  const memberTotal = await firestoreRead(`wsfGoalMemberTotals/${goalId}_${fx.memberUid}`);
  expect(Number(memberTotal?.total?.integerValue), 'the double tap bought one credit').toBe(20);
  expect(await readPending(page, goalId, fx.memberUid), 'confirmed work leaves no reminder').toBeNull();
});

/**
 * R3 — the member moves to another goal while the first goal's write is still
 * out, and then it succeeds.
 *
 * Nothing about goal A may appear on goal B: not a receipt, not a reminder,
 * not a number. And A's own reminder must survive intact — the member is the
 * only one who can resolve it, and they can only do that if the attempt keeps
 * its identity until they come back to it.
 */
test('R3 — a late success for goal A never lands on goal B, and A stays reconcilable', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const fx = await seedBase('r3');
  const goalA = `uiT-goal-r3a-${fx.stamp}`;
  const goalB = `uiT-goal-r3b-${fx.stamp}`;
  // A ends soonest, so the community page features A and lists B underneath.
  await seedGoal(fx.groupId, fx.championUid, {
    goalId: goalA,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 241,
    status: 'active',
    endsInMs: 2 * 24 * 60 * 60_000,
  });
  await seedGoal(fx.groupId, fx.championUid, {
    goalId: goalB,
    title: 'Minutes moving together',
    target: 300,
    unit: 'minutes',
    total: 100,
    status: 'active',
    endsInMs: 6 * 24 * 60 * 60_000,
  });
  await signInVia(page, fx.memberEmail, fx.password);

  let releaseA: () => void = () => undefined;
  const heldA = new Promise<void>((r) => {
    releaseA = r;
  });
  let holdsA = 0;
  await page.route(callableUrl('wsfContribute'), async (route: Route) => {
    const body = route.request().postDataJSON() as { data?: { goalId?: string } };
    if (body?.data?.goalId === goalA && holdsA === 0) {
      holdsA += 1;
      await heldA;
      await route.continue();
      return;
    }
    await route.continue();
  });

  // ---- record 20 on A; the write is held open ---------------------------------
  await page.goto(`/community/${fx.groupId}`);
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`wsf-community-goal-link-${goalA}`).click();
  await page.waitForURL(new RegExp(`/contribute/${goalA}`), { timeout: 20_000 });
  await screen(page, 'wsf-contribute-done').click();
  await screen(page, 'wsf-contribute-entry').fill('20');
  await screen(page, 'wsf-contribute-review').click();
  await screen(page, 'wsf-contribute-submit').click();
  await expect(screen(page, 'wsf-contribute-recording')).toBeVisible({ timeout: 20_000 });
  const attemptA = await awaitPendingAttempt(page, goalA, fx.memberUid);
  expect(attemptA).toMatch(/^\S+$/);

  // ---- move to goal B, still mid-flight ---------------------------------------
  await historyBack(page, new RegExp(`/community/${fx.groupId}`));
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`wsf-community-goal-link-${goalB}`).click();
  await page.waitForURL(new RegExp(`/contribute/${goalB}`), { timeout: 20_000 });
  await expect(screen(page, 'wsf-contribute-move-screen')).toBeVisible({ timeout: 20_000 });
  await expect(screen(page, 'wsf-contribute-shared-total')).toHaveText('100 of 300 minutes');

  // ---- NOW A's write reaches the server and succeeds --------------------------
  releaseA();
  await page.waitForTimeout(2_000);

  // Goal B is untouched by it, in every way a member could notice.
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-pending')).toHaveCount(0);
  await expect(screen(page, 'wsf-contribute-shared-total')).toHaveText('100 of 300 minutes');
  await expect(screen(page, 'wsf-contribute-own-credit')).toHaveText(
    'Your total on this goal: 0 minutes'
  );
  expect(await readPending(page, goalB, fx.memberUid), 'B has no attempt of its own').toBeNull();
  expect(
    await firestoreRead(`wsfGoalMemberTotals/${goalB}_${fx.memberUid}`),
    'nothing was credited on B'
  ).toBeNull();

  // A's reminder is exactly where the member left it, with the same identity.
  const storedA = await readPending(page, goalA, fx.memberUid);
  expect(storedA?.attemptId, "A's attempt keeps its identity").toBe(attemptA);
  expect(storedA?.count).toBe(20);

  // ---- back on A: the same attempt, replayed once -----------------------------
  await historyBack(page, new RegExp(`/community/${fx.groupId}`));
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`wsf-community-goal-link-${goalA}`).click();
  await page.waitForURL(new RegExp(`/contribute/${goalA}`), { timeout: 20_000 });
  await expect(screen(page, 'wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });
  await expect(screen(page, 'wsf-contribute-pending-count')).toHaveText('You entered 20 squats.');
  expect((await readPending(page, goalA, fx.memberUid))?.attemptId).toBe(attemptA);

  await screen(page, 'wsf-contribute-reconcile').click();
  await expect(screen(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
  await expect(screen(page, 'wsf-contribute-receipt')).toHaveAttribute(
    'data-variant',
    'alreadyRecorded'
  );
  await expect(screen(page, 'wsf-contribute-result-headline')).toHaveText(
    'This contribution was already recorded.'
  );
  await expect(screen(page, 'wsf-contribute-own-credit')).toHaveText(
    'Your total on this goal: 20 squats'
  );
  const totalA = await firestoreRead(`wsfGoalMemberTotals/${goalA}_${fx.memberUid}`);
  expect(Number(totalA?.total?.integerValue), 'the held write counted exactly once').toBe(20);
});

/**
 * R6 — the member leaves the screen while the write is in flight and comes
 * back to it.
 *
 * The stored row says `sending`; nobody can now learn what happened to it, so
 * restoring it escalates it to `unknown` and offers the same attempt back.
 * The late reply belongs to a screen that no longer exists and is discarded —
 * including its "this is confirmed, clear the reminder" half. Clearing it on
 * the strength of a reply the member never saw would leave the only recovery
 * context for that effort gone.
 */
test('R6 — leaving and returning mid-flight keeps the attempt, and the late reply is discarded', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const fx = await seedBase('r6');
  const goalId = `uiT-goal-r6-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 241,
    status: 'active',
    endsInMs: 3 * 24 * 60 * 60_000,
  });
  await signInVia(page, fx.memberEmail, fx.password);

  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => {
    release = r;
  });
  let holds = 0;
  const seen: string[] = [];
  await page.route(callableUrl('wsfContribute'), async (route: Route) => {
    const body = route.request().postDataJSON() as { data?: { attemptId?: string } };
    seen.push(body?.data?.attemptId ?? '?');
    if (holds === 0) {
      holds += 1;
      await held;
      await route.continue();
      return;
    }
    await route.continue();
  });

  await page.goto(`/community/${fx.groupId}`);
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId(`wsf-community-goal-link-${goalId}`).click();
  await page.waitForURL(new RegExp(`/contribute/${goalId}`), { timeout: 20_000 });
  await screen(page, 'wsf-contribute-done').click();
  await screen(page, 'wsf-contribute-entry').fill('20');
  await screen(page, 'wsf-contribute-review').click();
  await screen(page, 'wsf-contribute-submit').click();
  await expect(screen(page, 'wsf-contribute-recording')).toBeVisible({ timeout: 20_000 });
  const attemptId = await awaitPendingAttempt(page, goalId, fx.memberUid);
  expect((await readPending(page, goalId, fx.memberUid)).state).toBe('sending');

  // ---- away, while it is still `sending` --------------------------------------
  await historyBack(page, new RegExp(`/community/${fx.groupId}`));
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 30_000 });

  // ---- back again: `sending` nobody can resolve becomes `unknown` -------------
  await page.getByTestId(`wsf-community-goal-link-${goalId}`).click();
  await page.waitForURL(new RegExp(`/contribute/${goalId}`), { timeout: 20_000 });
  await expect(screen(page, 'wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });
  await expect(screen(page, 'wsf-contribute-pending-count')).toHaveText('You entered 20 squats.');
  const restored = await readPending(page, goalId, fx.memberUid);
  expect(restored.attemptId, 'the same attempt, not a new one').toBe(attemptId);
  expect(restored.state).toBe('unknown');

  // ---- the original write now succeeds, for a screen that is gone -------------
  release();
  await page.waitForTimeout(2_500);
  await expect(screen(page, 'wsf-contribute-pending')).toBeVisible();
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveCount(0);
  const afterLate = await readPending(page, goalId, fx.memberUid);
  expect(afterLate?.attemptId, 'a reply the member never saw does not retire the reminder').toBe(
    attemptId
  );

  // ---- the member confirms it themselves --------------------------------------
  await screen(page, 'wsf-contribute-reconcile').click();
  await expect(screen(page, 'wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
  await expect(screen(page, 'wsf-contribute-receipt')).toHaveAttribute(
    'data-variant',
    'alreadyRecorded'
  );
  await expect(screen(page, 'wsf-contribute-own-credit')).toHaveText(
    'Your total on this goal: 20 squats'
  );
  expect(new Set(seen).size, 'one attempt id for the whole episode').toBe(1);
  const memberTotal = await firestoreRead(`wsfGoalMemberTotals/${goalId}_${fx.memberUid}`);
  expect(Number(memberTotal?.total?.integerValue), 'one write reached the ledger').toBe(20);
  expect(await readPending(page, goalId, fx.memberUid)).toBeNull();
});

/**
 * R11 — the shared total moved while the attempt was unresolved.
 *
 * Polling is deliberately off for the whole unknown period, so the last total
 * the screen saw can be minutes old by the time the member confirms — and it
 * can have moved DOWN, past the target, through an authorized correction. A
 * replay that hands that stale figure to the result copy tells a community
 * that has only just reached its goal that it was already past it. The replay
 * has no trustworthy "before" and must not pretend otherwise.
 */
test('R11 — a stale before-total never inverts the confirmed result copy', async ({ page }) => {
  test.setTimeout(120_000);
  const fx = await seedBase('r11');
  const goalId = `uiT-goal-r11-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 520,
    status: 'active',
    endsInMs: 3 * 24 * 60 * 60_000,
  });
  await signInVia(page, fx.memberEmail, fx.password);

  let mode: 'drop' | 'pass' = 'drop';
  await page.route(callableUrl('wsfContribute'), async (route: Route) => {
    if (mode === 'drop') {
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('520 of 500 squats');
  await page.getByTestId('wsf-contribute-entry').fill('50');
  await page.getByTestId('wsf-contribute-review').click();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });
  const attemptId = await awaitPendingAttempt(page, goalId, fx.memberUid);

  // An authorized correction removes 60 while the attempt sits unresolved and
  // the screen is not allowed to poll. The community is now BELOW its target.
  await addToShard(goalId, -60);

  mode = 'pass';
  await page.getByTestId('wsf-contribute-reconcile').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });

  // The server's current truth: 460 + 50, a first booking of this attempt.
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('510 of 500 squats');
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'reached');
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 50 squats.');
  await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText('Our goal is reached.');
  await expect(page.getByTestId('wsf-contribute-result-standing')).toHaveText(
    'Our goal of 500 squats is reached and still open. Maple Street Movers is now at 510 of 500 squats.'
  );
  await expect(page.getByTestId('wsf-contribute-status')).toHaveText('10 beyond our goal · still open');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText(
    'Your total on this goal: 50 squats'
  );
  const receipt = await page.getByTestId('wsf-contribute-receipt').innerText();
  expect(receipt, 'not the "we were already past it" reading').not.toMatch(/We’re now at .* together/);
  expect(receipt, 'a first booking, not a replay of a landed one').not.toMatch(/already recorded/i);
  expect(attemptId).toMatch(/^\S+$/);
  const memberTotal = await firestoreRead(`wsfGoalMemberTotals/${goalId}_${fx.memberUid}`);
  expect(Number(memberTotal?.total?.integerValue)).toBe(50);
  expect(await readPending(page, goalId, fx.memberUid)).toBeNull();
});
