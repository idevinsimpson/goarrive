import { randomBytes } from 'node:crypto';

import { expect, test, type Route } from '@playwright/test';

/**
 * PUBLIC DISPLAY — two things the screen was saying that were not true.
 *
 *   D-6  "Check again" started a new polling session but left the refusal on
 *        screen for the whole round trip, so the press looked like it had done
 *        nothing and a second press restarted the session already running.
 *   D-2  A goal is `active` until something closes it, and nothing closes one
 *        automatically — so "Open · Ends Mon, Sep 14" outlived its own window.
 *        The label is the only thing that changes here; the status line still
 *        reports what the server says.
 *
 * Anonymous browsers, synthetic fixtures seeded under the admin bypass.
 * Helpers are copied rather than imported — a spec file that imports another
 * spec file runs it.
 */

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const PROJECT_ID = 'demo-wsf-local';
const GOAL_TZ = 'America/New_York';

function callableUrl(name: string): string {
  return `${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`;
}

async function firestoreWrite(
  docPath: string,
  fields: Record<string, unknown>,
  updateMask?: string[]
): Promise<void> {
  const mask = updateMask?.length
    ? '?' + updateMask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')
    : '';
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}${mask}`;
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

type Fx = { stamp: string; groupId: string; championUid: string };

async function seedCommunity(tag: string): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const groupId = `dtor-${tag}-${stamp}`;
  const championUid = `dtor-champ-${stamp}`;
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'Maple Street Movers' },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: `JOIN${randomBytes(4).toString('hex')}` },
    createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  await firestoreWrite(`wsfMemberships/${groupId}_${championUid}`, {
    groupId: { stringValue: groupId },
    userId: { stringValue: championUid },
    role: { stringValue: 'foundingChampion' },
    membershipStatus: { stringValue: 'active' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  return { stamp, groupId, championUid };
}

async function seedGoal(
  fx: Fx,
  key: string,
  opts: { endsInMs: number; total: number; authorized: boolean }
): Promise<string> {
  const goalId = `dtor-${key}-${fx.stamp}`;
  const now = new Date();
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: fx.championUid },
    communityGroupId: { stringValue: fx.groupId },
    title: { stringValue: 'Squats together this week' },
    target: { integerValue: '500' },
    unit: { stringValue: 'squats' },
    // `active` whatever the window says: nothing closes a goal on its own.
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now.getTime() + opts.endsInMs - 14 * 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + opts.endsInMs)),
    timezone: { stringValue: GOAL_TZ },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  };
  if (opts.authorized) fields.aggregateDisplayAuthorized = { booleanValue: true };
  await firestoreWrite(`wsfGoals/${goalId}`, fields);
  await seedShards(goalId, opts.total);
  return goalId;
}

// ─────────────────────────────────────────────────────────────────────────────

test('DEFECT 6: Check again clears the refusal at once, not a round trip later', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const fx = await seedCommunity('d6');
  const goalId = await seedGoal(fx, 'recheck', {
    endsInMs: 3 * 24 * 60 * 60_000,
    total: 241,
    authorized: true,
  });

  await page.goto(`/display/${goalId}`);
  await expect(page.getByTestId('wsf-display-shared-total')).toHaveText('241', { timeout: 20_000 });

  // Revoked: the running display stops on its own and the session is closed.
  await firestoreWrite(
    `wsfGoals/${goalId}`,
    { aggregateDisplayAuthorized: { booleanValue: false } },
    ['aggregateDisplayAuthorized']
  );
  await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 30_000 });

  // Every answer from here on takes 1.5s, which is the whole point: the press
  // has to change the screen BEFORE the answer arrives, or it is indis-
  // tinguishable from a press that did nothing.
  await page.route(callableUrl('wsfGoalPulse'), async (route: Route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    return route.continue();
  });

  await page.getByTestId('wsf-display-recheck').click();
  await expect(page.getByTestId('wsf-display-loading')).toBeVisible({ timeout: 500 });

  // The goal is still revoked, so the fresh session lands on the same refusal
  // — reached this time by way of a screen that admitted it was asking.
  await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });

  // ---- and a fresh session really is a fresh session -----------------------
  await firestoreWrite(
    `wsfGoals/${goalId}`,
    { aggregateDisplayAuthorized: { booleanValue: true } },
    ['aggregateDisplayAuthorized']
  );
  await page.unroute(callableUrl('wsfGoalPulse'));
  await page.getByTestId('wsf-display-recheck').click();
  await expect(page.getByTestId('wsf-display-shared-total')).toHaveText('241', { timeout: 20_000 });
});

test('DEFECT 2: an active goal whose window has passed does not claim to be open', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const fx = await seedCommunity('d2');
  const goalId = await seedGoal(fx, 'ended', {
    endsInMs: -2 * 60 * 60_000,
    total: 241,
    authorized: true,
  });

  await page.goto(`/display/${goalId}`);
  await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });

  const period = page.getByTestId('wsf-display-period');
  const text = await period.innerText();
  expect(text.startsWith('Open ·')).toBe(false);
  expect(text.startsWith('Open')).toBe(false);
  expect(text).toContain('Ended');

  // The server still calls this goal active, and the display still says what
  // the server says: the "to go" line and the totals are untouched.
  await expect(page.getByTestId('wsf-display-total-line')).toHaveText('241 of 500 squats');
  await expect(page.getByTestId('wsf-display-remaining')).toHaveText('259 to go');
  await expect(page.getByTestId('wsf-display-closed')).toHaveCount(0);
});
