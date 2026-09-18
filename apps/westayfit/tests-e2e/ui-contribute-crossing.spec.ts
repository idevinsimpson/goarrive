import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * THE ONE-TIME TARGET-CROSSING EVENT, THROUGH THE REAL INTERFACE.
 *
 * The server decides, once, which contribution moved the shared total from
 * below the target to at or beyond it (wsfContribute writes reachedAt,
 * reachedAttemptId and reachedSharedTotal on the goal and returns
 * `crossedTarget` on that attempt). This spec proves the member-facing half:
 *
 *   1. the member whose contribution crossed reads the crossing sentence on
 *      their own receipt, and nowhere else in the product
 *   2. the next contribution — same member, past the target — does not repeat
 *      it, and reads as the ordinary past-target result
 *   3. a REPLAY of the crossing attempt (its response was lost in flight) says
 *      the same thing again, with "it counted once" in the same breath,
 *      because the outcome is stored on the attempt
 *   4. Community Home shows the DAY we reached it, in the goal's own zone,
 *      from the member-authorized goal list — not from the public pulse
 *
 * Fixture data throughout: names, totals and credits are seeded for the run.
 *
 * Run against the integrated head on 2026-09-18 (emulator, 390×844): both
 * cases pass; the crossing is claimed after the contribution commits (see
 * claimTargetCrossing in functions-westayfit/src/index.ts).
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const PROJECT_ID = 'demo-wsf-local';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-contribute-crossing');
const PHONE = { width: 390, height: 844 };
const GOAL_ZONE = 'America/New_York';

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
    await firestoreWrite(`wsfGoalCounters/${goalId}/shards/${i}`, {
      count: { integerValue: String(count) },
    });
  }
}

async function seedGoal(
  groupId: string,
  ownerUid: string,
  g: { goalId: string; title: string; target: number; unit: string; total: number }
): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfGoals/${g.goalId}`, {
    ownerUid: { stringValue: ownerUid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: g.title },
    target: { integerValue: String(g.target) },
    unit: { stringValue: g.unit },
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now.getTime() - 7 * 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + 7 * 24 * 60 * 60_000)),
    timezone: { stringValue: GOAL_ZONE },
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
  const groupId = `uiX-${tag}`;
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

async function enterAndRecord(page: Page, amount: string): Promise<void> {
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-entry').fill(amount);
  await page.getByTestId('wsf-contribute-review').click();
  await page.getByTestId('wsf-contribute-submit').click();
}

/** "Reached Sep 18" as the goal's own zone writes the stored instant. */
function expectedReachedLabel(iso: string): string {
  const d = new Date(iso);
  const year = new Intl.DateTimeFormat('en-US', { timeZone: GOAL_ZONE, year: 'numeric' });
  const sameYear = year.format(d) === year.format(new Date());
  return `Reached ${new Intl.DateTimeFormat('en-US', {
    timeZone: GOAL_ZONE,
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' as const }),
  }).format(d)}`;
}

test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

test('the crossing is the server’s to say: once, to the member who made it', async ({ page }) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'uiX-password';
  const memberEmail = `wsf-uiX-member-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(`wsf-uiX-champ-${stamp}@example.com`, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);
  await seedProfile(championUid, 'Fixture Champion');
  await seedProfile(memberUid, 'Fixture Member');
  const groupId = await seedCommunity(stamp, 'Maple Street Movers', [
    { uid: championUid, role: 'foundingChampion' },
    { uid: memberUid, role: 'member' },
  ]);
  const goalId = `uiX-goal-${stamp}`;
  await seedGoal(groupId, championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 480,
  });

  await signInVia(page, memberEmail, password);

  // ---- 1. the contribution that takes us past the goal ----------------------
  await page.goto(`/contribute/${goalId}?groupId=${groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('480 of 500 squats', {
    timeout: 20_000,
  });
  await enterAndRecord(page, '25');

  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'crossed');
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 25 squats.');
  await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText(
    'This one took us past our goal.'
  );
  await expect(page.getByTestId('wsf-contribute-result-standing')).toHaveText(
    'Our goal of 500 squats is reached and still open. Maple Street Movers is now at 505 of 500 squats.'
  );
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('505 of 500 squats');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText(
    'Your total on this goal: 25 squats'
  );
  const crossedText = await page.getByTestId('wsf-contribute-receipt').innerText();
  // Plainly said, and said about US. Not the display's headline, not a
  // scoreboard, not a winner.
  expect(crossedText).not.toMatch(/WE did it|winning|winner|congratulations|!/i);
  await snap(page, '01-crossing-receipt');

  // The server wrote the event, exactly once, with the total it committed.
  const goalAfter = await firestoreRead(`wsfGoals/${goalId}`);
  expect(goalAfter?.reachedAt?.timestampValue).toBeTruthy();
  expect(Number(goalAfter?.reachedSharedTotal?.integerValue)).toBe(505);
  const reachedIso = goalAfter!.reachedAt.timestampValue as string;
  const reachedAttemptId = goalAfter!.reachedAttemptId.stringValue as string;

  // ---- 2. the next contribution does not say it again -----------------------
  await page.goto(`/contribute/${goalId}?groupId=${groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('505 of 500 squats', {
    timeout: 20_000,
  });
  await enterAndRecord(page, '10');
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute(
    'data-variant',
    'postTarget'
  );
  const secondText = await page.getByTestId('wsf-contribute-receipt').innerText();
  expect(secondText, 'the crossing is a moment, not a state').not.toMatch(/took us past/i);
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('515 of 500 squats');

  // The event is untouched by the overshoot.
  const goalAfterOvershoot = await firestoreRead(`wsfGoals/${goalId}`);
  expect(goalAfterOvershoot?.reachedAt?.timestampValue).toBe(reachedIso);
  expect(goalAfterOvershoot?.reachedAttemptId?.stringValue).toBe(reachedAttemptId);
  expect(Number(goalAfterOvershoot?.reachedSharedTotal?.integerValue)).toBe(505);
  await snap(page, '02-overshoot-receipt');

  // ---- 3. the day we reached it, on Community Home --------------------------
  // Read from the member-authorized goal list and written in the GOAL's zone.
  // wsfGoalPulse — the public aggregate — never carries this.
  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId(`wsf-community-goal-reached-${goalId}`)).toHaveText(
    expectedReachedLabel(reachedIso),
    { timeout: 30_000 }
  );
  await snap(page, '03-community-home-reached-date');
});

test('a replay of the crossing attempt says the same thing, and that it counted once', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'uiX-password';
  const memberEmail = `wsf-uiX-replay-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(`wsf-uiX-replaychamp-${stamp}@example.com`, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);
  await seedProfile(championUid, 'Fixture Champion');
  await seedProfile(memberUid, 'Fixture Member');
  const groupId = await seedCommunity(`replay-${stamp}`, 'Maple Street Movers', [
    { uid: championUid, role: 'foundingChampion' },
    { uid: memberUid, role: 'member' },
  ]);
  const goalId = `uiX-goal-replay-${stamp}`;
  await seedGoal(groupId, championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 490,
  });

  // The request reaches the server and the answer never reaches the member.
  let mode: 'landButDrop' | 'pass' = 'landButDrop';
  await page.route(callableUrl('wsfContribute'), async (route: Route) => {
    if (mode === 'landButDrop') {
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });

  await signInVia(page, memberEmail, password);
  await page.goto(`/contribute/${goalId}?groupId=${groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('490 of 500 squats', {
    timeout: 20_000,
  });
  await enterAndRecord(page, '20');
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });
  await snap(page, '10-unresolved-attempt');

  // It landed, and it was the crossing.
  const goalAfterLanding = await firestoreRead(`wsfGoals/${goalId}`);
  expect(goalAfterLanding?.reachedAt?.timestampValue).toBeTruthy();
  expect(Number(goalAfterLanding?.reachedSharedTotal?.integerValue)).toBe(510);

  // The member replays the SAME attempt. The server counts it once and
  // answers with the outcome it stored for that attempt.
  mode = 'pass';
  await page.getByTestId('wsf-contribute-reconcile').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'crossed');
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText(
    'This contribution was already recorded.'
  );
  await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText(
    'It counted once, and it took us past our goal.'
  );
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('510 of 500 squats');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText(
    'Your total on this goal: 20 squats'
  );
  await snap(page, '11-replayed-crossing-receipt');

  // One contribution, one event, unchanged by the replay.
  const goalAfterReplay = await firestoreRead(`wsfGoals/${goalId}`);
  expect(goalAfterReplay?.reachedAt?.timestampValue).toBe(
    goalAfterLanding?.reachedAt?.timestampValue
  );
  expect(goalAfterReplay?.reachedAttemptId?.stringValue).toBe(
    goalAfterLanding?.reachedAttemptId?.stringValue
  );
  const memberTotal = await firestoreRead(`wsfGoalMemberTotals/${goalId}_${memberUid}`);
  expect(Number(memberTotal?.total?.integerValue), 'counted exactly once').toBe(20);
});
