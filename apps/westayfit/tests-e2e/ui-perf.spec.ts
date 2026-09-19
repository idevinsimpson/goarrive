import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Request, type Route } from '@playwright/test';

/**
 * WHAT THE RUNNING APPLICATION COSTS — measured through the real interface.
 *
 * Every assertion here is a COUNT or a TIMING taken off the live app against
 * the emulators with SYNTHETIC fixtures. None of them changes what a member
 * sees; each one pins a cost that a previous version paid and this one does
 * not:
 *
 *   - the display's pulse keeps its cadence exactly (this file would fail if
 *     the idle-re-render change had quietly slowed the poll down), and keeps
 *     asking even behind a slow answer, which is what its revocation rules
 *     need
 *   - the contribution screen's pulse, before the write, never has two
 *     requests outstanding at once
 *   - "Copied" survives a second copy a second later: the confirmation timer
 *     is owned and cancelled rather than left running
 *
 * Everything here is fixture data: communities, goals and totals are seeded
 * for the run and are not real members or real activity.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const PROJECT_ID = 'demo-wsf-local';
const PHONE = { width: 390, height: 844 };

/** The poll both screens run at. Kept here only to name the cadence below. */
const POLL_INTERVAL_MS = 2_000;
/** A server slow enough that a 2s poll would stack requests behind it. */
const SLOW_RESPONSE_MS = 6_000;

function callableUrl(name: string): string {
  return `${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`;
}

// ── fixtures (copied, deliberately, rather than imported across specs) ──────

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
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;
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

type Fx = {
  stamp: string;
  password: string;
  groupId: string;
  championEmail: string;
  championUid: string;
  memberEmail: string;
  memberUid: string;
  joinCode: string;
};

async function seedCommunity(
  tag: string,
  joinPolicy: 'private' | 'inviteOnly' | 'public' = 'private'
): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'uiP-password';
  const groupId = `uiP-${tag}-${stamp}`;
  const championEmail = `wsf-uiP-champ-${tag}-${stamp}@example.com`;
  const memberEmail = `wsf-uiP-member-${tag}-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);
  const joinCode = `JOIN${randomBytes(4).toString('hex')}`;
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'Maple Street Movers' },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: joinPolicy },
    joinCode: { stringValue: joinCode },
    createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(new Date(now.getTime() - 40 * 24 * 60 * 60_000)),
    updatedAt: tsField(now),
  });
  for (const [uid, role, name] of [
    [championUid, 'foundingChampion', 'Fixture Champion'],
    [memberUid, 'member', 'Fixture Member'],
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
      displayName: { stringValue: name },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }
  return { stamp, password, groupId, championEmail, championUid, memberEmail, memberUid, joinCode };
}

async function seedGoal(fx: Fx, key: string, authorized: boolean): Promise<string> {
  const goalId = `uiP-goal-${key}-${fx.stamp}`;
  const now = new Date();
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: fx.championUid },
    communityGroupId: { stringValue: fx.groupId },
    title: { stringValue: 'Squats together this week' },
    target: { integerValue: '500' },
    unit: { stringValue: 'squats' },
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now.getTime() - 11 * 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + 3 * 24 * 60 * 60_000)),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  };
  if (authorized) fields.aggregateDisplayAuthorized = { booleanValue: true };
  await firestoreWrite(`wsfGoals/${goalId}`, fields);
  await seedShards(goalId, 241);
  return goalId;
}

async function signInVia(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/signin');
  await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('wsf-signin-email').fill(email);
  await page.getByTestId('wsf-signin-password').fill(password);
  await page.getByTestId('wsf-signin-submit').click();
  await page.waitForURL(/\/(profile-setup)?$/, { timeout: 15_000 });
}

/**
 * The screen that is actually on top. The router keeps a previous screen
 * mounted underneath the next one, so a testID can legitimately match twice.
 */
function live(page: Page, testId: string) {
  return page.getByTestId(testId).last();
}

/**
 * Counts POSTs to one callable. The preflight is deliberately excluded: what
 * is being measured is how many times the application asked the question.
 */
function countCallable(page: Page, name: string): () => number {
  let calls = 0;
  page.on('request', (r: Request) => {
    if (r.method() === 'POST' && r.url().includes(name)) calls += 1;
  });
  return () => calls;
}

/** Holds every matching request for `ms` before letting it through. */
async function delayCallable(page: Page, name: string, ms: number): Promise<void> {
  await page.route(callableUrl(name), async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

test.use({ viewport: PHONE, deviceScaleFactor: 2 });

// ═══════════════════════════════════════════════════════════════════════════
// The display's poll: cadence unchanged, and never wedged by a slow answer
// ═══════════════════════════════════════════════════════════════════════════

test('display: the pulse keeps its 2s cadence, and keeps asking behind a slow answer', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const fx = await seedCommunity('disp');
  const goalId = await seedGoal(fx, 'disp', true);
  const pulses = countCallable(page, 'wsfGoalPulse');

  await page.goto(`/display/${goalId}`);
  await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-display-total-line')).toHaveText('241 of 500 squats');

  // ---- 1. the network cadence, with the server answering normally ----------
  // This is the measurement the idle-re-render change must NOT move: skipping
  // a React commit for an unchanged answer is only allowed to change what is
  // RENDERED, never how often the screen asks.
  const beforeTwenty = pulses();
  await page.waitForTimeout(20_000);
  const overTwenty = pulses() - beforeTwenty;
  expect(overTwenty, `${POLL_INTERVAL_MS}ms poll over 20s`).toBeGreaterThanOrEqual(8);
  expect(overTwenty, `${POLL_INTERVAL_MS}ms poll over 20s`).toBeLessThanOrEqual(12);

  const beforeTen = pulses();
  await page.waitForTimeout(10_000);
  const overTen = pulses() - beforeTen;
  expect(overTen, 'poll over 10s').toBeGreaterThanOrEqual(4);
  expect(overTen, 'poll over 10s').toBeLessThanOrEqual(7);

  // Still live after 30s of unchanged answers: an unchanged tick keeps the
  // state it has, it does not stop confirming.
  await expect(page.getByTestId('wsf-display-stale')).toHaveCount(0);
  await expect(page.getByTestId('wsf-display-confirmed-at')).toContainText('Confirmed');
  await expect(page.getByTestId('wsf-display-total-line')).toHaveText('241 of 500 squats');

  // ---- 2. a 6s server: the poll keeps overtaking it ----------------------
  // The display's poll is deliberately NOT guarded against overlap: a
  // response held open from before a revocation has to be overtaken by a
  // later poll that gets the refusal (e5-display-authorization CASE 3/4).
  // So a slow answer must NOT stop the screen asking — this is the cost that
  // buys that rule, measured rather than assumed.
  await delayCallable(page, 'wsfGoalPulse', SLOW_RESPONSE_MS);
  await page.reload();
  await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 40_000 });
  const beforeSlow = pulses();
  await page.waitForTimeout(20_000);
  const overSlow = pulses() - beforeSlow;
  expect(overSlow, 'a slow answer never stops the display asking').toBeGreaterThanOrEqual(8);
});

// ═══════════════════════════════════════════════════════════════════════════
// The contribution screen's poll, before the write
// ═══════════════════════════════════════════════════════════════════════════

test('contribute: the entry screen keeps its cadence and never stacks pulse requests', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const fx = await seedCommunity('contrib');
  const goalId = await seedGoal(fx, 'contrib', false);
  const pulses = countCallable(page, 'wsfGoalPulse');

  await signInVia(page, fx.memberEmail, fx.password);
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(live(page, 'wsf-contribute-entry-screen')).toBeVisible({ timeout: 30_000 });
  await expect(live(page, 'wsf-contribute-shared-total')).toHaveText('241 of 500 squats');

  // ---- 1. cadence, answering normally --------------------------------------
  const beforeTwenty = pulses();
  await page.waitForTimeout(20_000);
  const overTwenty = pulses() - beforeTwenty;
  expect(overTwenty, `${POLL_INTERVAL_MS}ms poll over 20s`).toBeGreaterThanOrEqual(8);
  expect(overTwenty, `${POLL_INTERVAL_MS}ms poll over 20s`).toBeLessThanOrEqual(12);

  // ---- 2. a 6s server ------------------------------------------------------
  await delayCallable(page, 'wsfGoalPulse', SLOW_RESPONSE_MS);
  // Let anything already out settle, so the window measures the guarded poll.
  await page.waitForTimeout(SLOW_RESPONSE_MS + 1_000);
  const beforeSlow = pulses();
  await page.waitForTimeout(30_000);
  const overSlow = pulses() - beforeSlow;
  expect(
    overSlow,
    'a 6s answer must not have a 2s interval queueing requests behind it'
  ).toBeLessThanOrEqual(6);
  expect(overSlow, 'the poll is still running').toBeGreaterThanOrEqual(2);

  // The screen is untouched by any of it: still before the write, still usable.
  await expect(live(page, 'wsf-contribute-entry-screen')).toBeVisible();
  await expect(live(page, 'wsf-contribute-shared-total')).toHaveText('241 of 500 squats');
});

// ═══════════════════════════════════════════════════════════════════════════
// The invite copy confirmation
// ═══════════════════════════════════════════════════════════════════════════

test('Community Home: a second copy one second later does not lose its own "Copied"', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const fx = await seedCommunity('copy', 'inviteOnly');

  // Headless Chromium's clipboard is not available to this origin, and the
  // measurement is about the CONFIRMATION TIMER, not about the clipboard. A
  // writeText that simply resolves is enough to reach the same code path.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => undefined },
    });
  });

  await signInVia(page, fx.championEmail, fx.password);
  await page.goto(`/community/${fx.groupId}`);
  await expect(page.getByTestId('wsf-community-invite')).toBeVisible({ timeout: 30_000 });
  const copy = page.getByTestId('wsf-community-invite-copy');
  await expect(copy).toHaveText('Copy invite');

  // t≈0.0 — the first copy arms a 2s return to rest.
  await copy.click();
  await expect(copy).toHaveText('Copied');

  // t≈1.0 — a second copy. Its confirmation owns the label from here.
  await page.waitForTimeout(1_000);
  await copy.click();
  expect(await copy.innerText(), 'the second copy is confirmed too').toBe('Copied');

  // t≈2.5 — the FIRST tap's timer would have fired at t≈2.0 and wiped a
  // confirmation shown 1.5s earlier. Read the label as it is, with no
  // retrying: a "Copied" that comes back later is not the same thing.
  await page.waitForTimeout(1_500);
  expect(
    await copy.innerText(),
    'the first tap’s timer must not clear the second tap’s confirmation'
  ).toBe('Copied');

  // It still returns to rest on its own — the timer is cancelled, not removed.
  await expect(copy).toHaveText('Copy invite', { timeout: 6_000 });
});
