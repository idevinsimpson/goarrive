import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * CONTRIBUTION EXPERIENCE — phone-first visual checkpoint and behaviour.
 *
 * Drives the real contribution flow against the emulators at 390 × 844 with
 * SYNTHETIC fixtures, records every screen a member can land on, and proves
 * the accounting rules through the real interface:
 *   - mode=move starts on the movement screen; mode=record starts at entry
 *   - no callable write happens before the explicit Record confirmation
 *   - the confirmed result shows the member's exact addition and the server's
 *     current shared total, and never assigns concurrent work to the member
 *   - an unknown outcome keeps the same attempt and replays it once
 *   - a definitive refusal retires the reminder and says what was not recorded
 *   - a replay of a landed attempt is "already recorded", not a celebration
 *   - crossing the target and contributing past it read differently
 *   - a closed goal is still useful and never shamed
 *   - a cold link without groupId stays generic and usable
 *
 * Everything here is fixture data: names, totals and credits are seeded for
 * the run and are not real members or activity.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const PROJECT_ID = 'demo-wsf-local';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-contribute');
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
  const groupId = `uiB-${tag}`;
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

/** Full-length capture: the page scrolls in a ScrollView, so grow the viewport for one shot. */
async function snapFull(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const contentHeight = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('*'));
    const scroller = all.find((e) => {
      const cs = getComputedStyle(e);
      return e.scrollHeight > e.clientHeight + 10 && (cs.overflowY === 'auto' || cs.overflowY === 'scroll');
    });
    return (scroller ?? document.scrollingElement!).scrollHeight;
  });
  if (contentHeight > PHONE.height) {
    await page.setViewportSize({ width: PHONE.width, height: contentHeight + 4 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: false });
    await page.setViewportSize(PHONE);
    await page.waitForTimeout(200);
  }
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
  const password = 'uiB-password';
  const memberEmail = `wsf-uiB-member-${tag}-${stamp}@example.com`;
  const championEmail = `wsf-uiB-champ-${tag}-${stamp}@example.com`;
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

test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

test('happy path: move → enter → review → recording → confirmed, then a concurrent peer', async ({ page }) => {
  test.setTimeout(240_000);
  const fx = await seedBase('happy');
  const goalId = `uiB-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 241,
    status: 'active',
    endsInMs: 3 * 24 * 60 * 60_000,
  });

  // Count every write attempt: none may happen before Record.
  let writes = 0;
  let holdNext: Promise<void> | null = null;
  await page.route(callableUrl('wsfContribute'), async (route: Route) => {
    writes += 1;
    if (holdNext) await holdNext;
    await route.continue();
  });

  await signInVia(page, fx.memberEmail, fx.password);
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=move`);

  // ---- 1. start moving ------------------------------------------------------
  await expect(page.getByTestId('wsf-contribute-move-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toHaveCount(0);
  // The only guidance is about the app, with the goal's unit in place of
  // the generic "reps"; nothing about form, tempo, depth or a target.
  await expect(page.getByTestId('wsf-contribute-move-screen')).toContainText('Ready when you are.');
  await expect(page.getByTestId('wsf-contribute-move-screen')).toContainText(
    'Count your own squats. When you’re finished, enter the number you completed.'
  );
  await expect(page.getByTestId('wsf-contribute-done')).toHaveText('I’m done — enter my squats');
  await expect(page.getByTestId('wsf-contribute-skip-timer')).toHaveText('Skip timer and enter squats');
  const moveText = await page.getByTestId('wsf-contribute-move-screen').innerText();
  expect(moveText).not.toMatch(/depth|tempo|form|safety|target|at least|should|must/i);
  await expect(page.getByTestId('wsf-contribute-community')).toHaveText('Maple Street Movers', { timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-goal-title')).toHaveText('Squats together this week');
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('241 of 500 squats');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 0 squats');
  // A6. The compact context is polled live, so it says when it was last
  // confirmed — the same fact, in the same words, as Community Home and the
  // public display. No refresh control: nothing is waiting to be asked.
  await expect(page.getByTestId('wsf-contribute-context-percent')).toHaveText('48.2% complete');
  await expect(page.getByTestId('wsf-contribute-context-updated')).toHaveText(/^Confirmed \d{1,2}:\d{2}/);
  await expect(page.getByTestId('wsf-contribute-back')).toHaveText('Back');
  await page.waitForTimeout(400);
  await snap(page, '01-start-moving');

  // ---- 2. optional timer ------------------------------------------------------
  await page.getByTestId('wsf-contribute-timer-start').click();
  await page.waitForTimeout(2_300);
  await expect(page.getByTestId('wsf-contribute-timer-clock')).not.toHaveText('0:00');
  await snap(page, '02-timer-running');
  await page.getByTestId('wsf-contribute-timer-pause').click();
  expect(writes, 'the timer never writes').toBe(0);

  // ---- 3. enter -----------------------------------------------------------------
  await page.getByTestId('wsf-contribute-done').click();
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible();
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toContainText('How many squats did you complete?');
  // Invalid values never become a submission.
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-error')).toBeVisible();
  await page.getByTestId('wsf-contribute-entry').fill('0');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-error')).toBeVisible();
  await page.getByTestId('wsf-contribute-entry').fill('1.5');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-error')).toBeVisible();
  // Convenient controls: +10, +10, −1, +1 → 20.
  await page.getByTestId('wsf-contribute-entry').fill('');
  await page.getByTestId('wsf-contribute-plus-10').click();
  await page.getByTestId('wsf-contribute-plus-10').click();
  await page.getByTestId('wsf-contribute-minus').click();
  await page.getByTestId('wsf-contribute-plus').click();
  await expect(page.getByTestId('wsf-contribute-entry')).toHaveValue('20');
  await snap(page, '03-enter-result');
  expect(writes, 'entry never writes').toBe(0);

  // ---- 4. review ------------------------------------------------------------------
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
  await expect(page.getByTestId('wsf-contribute-review-quantity')).toHaveText('20 squats');
  await expect(page.getByTestId('wsf-contribute-submit')).toHaveText('Record 20 squats');
  // This fixture's goal carries NO repeatPolicy field, which resolves to
  // 'multiple' — the behaviour this server has always had, and the reason the
  // concurrency step below can record a SECOND contribution from this same
  // member on this same goal at all. The once sentence is
  // pinned against an explicitly-'once' goal in ui-contribute-repeat-policy.spec.ts.
  await expect(page.getByTestId('wsf-contribute-review-screen')).toContainText('This will be recorded toward this goal. You can add more later.');
  await snap(page, '04-review');
  expect(writes, 'review never writes').toBe(0);
  // Edit goes back with the number intact.
  await page.getByTestId('wsf-contribute-edit').click();
  await expect(page.getByTestId('wsf-contribute-entry')).toHaveValue('20');
  await page.getByTestId('wsf-contribute-review').click();

  // ---- 5. recording ------------------------------------------------------------
  let release: () => void = () => undefined;
  holdNext = new Promise<void>((r) => {
    release = r;
  });
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-recording')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('wsf-contribute-recording')).toContainText('Recording your contribution…');
  await expect(page.getByTestId('wsf-contribute-we')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-recording')).not.toContainText('261');
  await snap(page, '05-recording');
  // The attempt is persisted before the response.
  const key = pendingKey(goalId, fx.memberUid);
  const attemptId = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) as string).attemptId, key);
  expect(attemptId).toMatch(/^\S+$/);
  release();
  holdNext = null;

  // ---- 6. confirmed ordinary result -----------------------------------------------
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'ordinary');
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 20 squats.');
  await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText('You moved us closer.');
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('261 of 500 squats');
  await expect(page.getByTestId('wsf-contribute-percent')).toHaveText('52.2% complete');
  await expect(page.getByTestId('wsf-contribute-status')).toHaveText('239 to go');
  await expect(page.getByTestId('wsf-contribute-result-standing')).toHaveText(
    'Maple Street Movers is now at 261 of 500 squats.'
  );
  // No immediate repeat prompt: the goal schema carries no repeat rule.
  await expect(page.getByTestId('wsf-contribute-another')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-back')).toHaveText('Back to community');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20 squats');
  await expect(page.getByTestId('wsf-contribute-we')).toHaveAttribute('data-fill-ratio', '0.5220');
  expect(writes, 'exactly one write for one Record').toBe(1);
  expect(await page.evaluate((k) => window.localStorage.getItem(k), key)).toBeNull();
  await page.waitForTimeout(400);
  await snap(page, '06-confirmed-ordinary');
  await snapFull(page, '06-confirmed-ordinary-full');

  // ---- concurrency: a peer's 15 lands before this member's next 5 -------------------
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-entry').fill('5');
  await page.getByTestId('wsf-contribute-review').click();
  await addToShard(goalId, 15);
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 5 squats.');
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('281 of 500 squats');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 25 squats');
  await expect(page.getByTestId('wsf-contribute-result-standing')).toHaveText(
    'Maple Street Movers is now at 281 of 500 squats.'
  );
  const receiptText = await page.getByTestId('wsf-contribute-receipt').innerText();
  expect(receiptText, 'no before/after pair, no arrow, no crediting of the peer').not.toMatch(/→|261 to 281|added 20|added 15/);
  expect(writes).toBe(2);
  await snap(page, '06b-confirmed-after-concurrent-peer');

  writeFileSync(
    path.join(ARTIFACTS_DIR, 'fixture.json'),
    JSON.stringify({ note: 'Synthetic emulator fixture — not real members or activity.', groupId: fx.groupId, goalId }, null, 2)
  );
});

test('mode=record starts at entry; a cold link without groupId stays generic', async ({ page }) => {
  test.setTimeout(180_000);
  const fx = await seedBase('modes');
  const goalId = `uiB-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId, title: 'Squats together this week', target: 500, unit: 'squats', total: 241, status: 'active', endsInMs: 3 * 24 * 60 * 60_000,
    ownCredit: { uid: fx.memberUid, total: 60 },
  });
  await signInVia(page, fx.memberEmail, fx.password);

  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-move-screen')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-community')).toHaveText('Maple Street Movers', { timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 60 squats');
  await page.waitForTimeout(400);
  await snap(page, '03b-mode-record-entry');

  // Cold link: no groupId, no mode. Usable, and no labels the route did not verify.
  const cold = await page.goto(`/contribute/${goalId}`);
  expect(cold?.status()).toBe(200);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId('wsf-contribute-community')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-goal-title')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-back')).toHaveText('Back');
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('241 of 500 squats');
  await snap(page, '03c-cold-link-generic');

  // A groupId the goal does not belong to: verified nothing, so nothing shown.
  const other = await seedCommunity(`other-${fx.stamp}`, 'Another Community', [{ uid: fx.memberUid, role: 'member' }]);
  await page.goto(`/contribute/${goalId}?groupId=${other}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId('wsf-contribute-community')).toHaveCount(0);
  await expect(page.getByText('Another Community')).toHaveCount(0);
  // A groupId the member does not belong to: same.
  const stranger = await seedCommunity(`stranger-${fx.stamp}`, 'Not Your Community', [{ uid: fx.championUid, role: 'foundingChampion' }]);
  await page.goto(`/contribute/${goalId}?groupId=${stranger}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_500);
  await expect(page.getByText('Not Your Community')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-community')).toHaveCount(0);
});

test('unknown outcome keeps the same attempt; replaying a landed attempt is "already recorded"', async ({ page }) => {
  test.setTimeout(240_000);
  const fx = await seedBase('pending');
  const goalId = `uiB-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId, title: 'Squats together this week', target: 500, unit: 'squats', total: 241, status: 'active', endsInMs: 3 * 24 * 60 * 60_000,
  });
  await signInVia(page, fx.memberEmail, fx.password);
  const key = pendingKey(goalId, fx.memberUid);

  // ---- 7. the response never comes back --------------------------------------------
  let mode: 'drop' | 'landButDrop' | 'pass' = 'drop';
  const seen: string[] = [];
  await page.route(callableUrl('wsfContribute'), async (route: Route) => {
    const body = route.request().postDataJSON() as { data?: { attemptId?: string } };
    seen.push(body?.data?.attemptId ?? '?');
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

  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-entry').fill('20');
  await page.getByTestId('wsf-contribute-review').click();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-pending')).toContainText('We couldn’t confirm your contribution yet.');
  await expect(page.getByTestId('wsf-contribute-pending')).toContainText(
    'We don’t know whether this effort was recorded. Don’t record it again.'
  );
  await expect(page.getByTestId('wsf-contribute-pending')).toContainText(
    'This sends the same attempt again. If it already reached us, it will not count twice.'
  );
  // No control that discards the only recovery context for an unresolved attempt.
  await expect(page.getByTestId('wsf-contribute-discard-pending')).toHaveCount(0);
  const pendingText = await page.getByTestId('wsf-contribute-pending').innerText();
  expect(pendingText).not.toMatch(/remove this reminder|discard|check status|try again/i);
  await expect(page.getByTestId('wsf-contribute-pending-count')).toHaveText('You entered 20 squats.');
  await expect(page.getByTestId('wsf-contribute-reconcile')).toHaveText('Confirm this contribution');
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveCount(0);
  const stored = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) as string), key);
  expect(stored.state).toBe('unknown');
  expect(stored.count).toBe(20);
  await page.waitForTimeout(300);
  await snap(page, '07-pending-unknown');

  // A reload keeps the same reminder and the same attempt.
  await page.reload();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });
  const stored2 = await page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) as string), key);
  expect(stored2.attemptId).toBe(stored.attemptId);

  // ---- confirm: the SAME attempt is replayed and lands once -------------------------
  mode = 'pass';
  await page.getByTestId('wsf-contribute-reconcile').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'ordinary');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20 squats');
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('261 of 500 squats');
  expect(seen[0]).toBe(stored.attemptId);
  expect(seen[1]).toBe(stored.attemptId);
  expect(await page.evaluate((k) => window.localStorage.getItem(k), key)).toBeNull();

  // ---- 10. a landed attempt whose response was lost: replay is "already recorded" ---
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-entry').fill('7');
  await page.getByTestId('wsf-contribute-review').click();
  mode = 'landButDrop';
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });
  mode = 'pass';
  await page.getByTestId('wsf-contribute-reconcile').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'alreadyRecorded');
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('This contribution was already recorded.');
  await expect(page.getByTestId('wsf-contribute-result-subline')).toContainText('It counted once.');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 27 squats');
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('268 of 500 squats');
  await expect(page.getByTestId('wsf-contribute-another')).toHaveCount(0);
  const text = await page.getByTestId('wsf-contribute-receipt').innerText();
  expect(text).not.toMatch(/WE did it|closer/);
  // The server counted it exactly once.
  const memberTotal = await firestoreRead(`wsfGoalMemberTotals/${goalId}_${fx.memberUid}`);
  expect(Number(memberTotal?.total?.integerValue)).toBe(27);
  await page.waitForTimeout(300);
  await snap(page, '10-already-recorded-replay');

  // ---- 10b. the same, after this member has been removed --------------------------
  // The attempt landed, the response was lost, and the Champion removed the
  // member before they replayed it. The server answers about THEIR effort only:
  // it counted once, here is their total — and nothing about the community.
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-entry').fill('3');
  await page.getByTestId('wsf-contribute-review').click();
  mode = 'landButDrop';
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 20_000 });
  await firestoreWrite(`wsfMemberships/${fx.groupId}_${fx.memberUid}`, { membershipStatus: { stringValue: 'removed' } }, ['membershipStatus']);
  mode = 'pass';
  await page.getByTestId('wsf-contribute-reconcile').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'ownOnly');
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('This contribution was already recorded.');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 30 squats');
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-we')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-another')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-not-found')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-back')).toHaveText('Back to home');
  const ownOnly = await page.getByTestId('wsf-contribute-screen').innerText();
  expect(ownOnly).not.toMatch(/of 500|Maple Street|WE did it|closer|%/);
  expect(await page.evaluate((k) => window.localStorage.getItem(k), key)).toBeNull();
  await snap(page, '10b-already-recorded-own-only');
});

test('a definitive refusal retires the reminder and says what was not recorded', async ({ page }) => {
  test.setTimeout(240_000);
  const fx = await seedBase('refused');
  const goalId = `uiB-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId, title: 'Squats together this week', target: 500, unit: 'squats', total: 241, status: 'active', endsInMs: 3 * 24 * 60 * 60_000,
  });
  await signInVia(page, fx.memberEmail, fx.password);
  const key = pendingKey(goalId, fx.memberUid);

  // ---- 8a. the goal closes between review and Record ----------------------------------
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-entry').fill('20');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
  // The goal closes after Record is tapped and before the server runs it, so
  // the screen state at the tap is deterministic (no poll can flip it first).
  await page.route(callableUrl('wsfContribute'), async (route: Route) => {
    await firestoreWrite(`wsfGoals/${goalId}`, { status: { stringValue: 'closed' } }, ['status']);
    await route.continue();
  });
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-refused')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-refused')).toHaveAttribute('data-reason', 'closed');
  await expect(page.getByTestId('wsf-contribute-refused-headline')).toHaveText('This goal is no longer accepting contributions.');
  await expect(page.getByTestId('wsf-contribute-refused-body')).toContainText('20 squats were not recorded');
  await expect(page.getByTestId('wsf-contribute-pending')).toHaveCount(0);
  expect(await page.evaluate((k) => window.localStorage.getItem(k), key), 'no false pending reminder').toBeNull();
  await page.waitForTimeout(300);
  await snap(page, '08-definitive-failure-closed');
  // Nothing landed.
  expect(await firestoreRead(`wsfGoalMemberTotals/${goalId}_${fx.memberUid}`)).toBeNull();

  // ---- 8b. membership lost ---------------------------------------------------------------
  await firestoreWrite(`wsfGoals/${goalId}`, { status: { stringValue: 'active' } }, ['status']);
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-entry').fill('12');
  await page.getByTestId('wsf-contribute-review').click();
  await page.unroute(callableUrl('wsfContribute'));
  await page.route(callableUrl('wsfContribute'), async (route: Route) => {
    await firestoreWrite(`wsfMemberships/${fx.groupId}_${fx.memberUid}`, { membershipStatus: { stringValue: 'removed' } }, ['membershipStatus']);
    await route.continue();
  });
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-refused')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-refused')).toHaveAttribute('data-reason', 'notMember');
  await expect(page.getByTestId('wsf-contribute-refused-headline')).toHaveText('This contribution can’t be recorded from this account.');
  expect(await page.evaluate((k) => window.localStorage.getItem(k), key)).toBeNull();
  await page.waitForTimeout(300);
  await snap(page, '08b-definitive-failure-membership');
});

test('closed goal, goal crossing, and contributing past the target', async ({ page }) => {
  test.setTimeout(240_000);
  const fx = await seedBase('crossing');
  const closedId = `uiB-closed-${fx.stamp}`;
  const crossId = `uiB-cross-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId: closedId, title: 'August push-ups', target: 500, unit: 'push-ups', total: 312, status: 'closed',
    endsInMs: -20 * 24 * 60 * 60_000, displayAuthorized: true, ownCredit: { uid: fx.memberUid, total: 40 },
  });
  await seedGoal(fx.groupId, fx.championUid, {
    goalId: crossId, title: 'Squats together this week', target: 500, unit: 'squats', total: 470, status: 'active',
    endsInMs: 3 * 24 * 60 * 60_000,
  });
  await signInVia(page, fx.memberEmail, fx.password);

  // ---- 9. closed goal, cold link ----------------------------------------------------------
  await page.goto(`/contribute/${closedId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-closed')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-closed')).toContainText('This goal is closed.');
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('312 of 500 push-ups');
  // A5. A closed goal states its result once: "Closed at 62.4%" IS the
  // percentage, so the "N% complete" line is not repeated above it. Same rule
  // as Community Home's past-goal card.
  await expect(page.getByTestId('wsf-contribute-percent')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-status')).toHaveText('Closed at 62.4%');
  expect(await page.getByTestId('wsf-contribute-closed').innerText()).not.toContain('62.4% complete');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 40 push-ups');
  await expect(page.getByTestId('wsf-contribute-entry')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-submit')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-community')).toHaveText('Maple Street Movers', { timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-back')).toHaveText('Back to community');
  const closedText = await page.getByTestId('wsf-contribute-screen').innerText();
  expect(closedText).not.toMatch(/failed|missed|completed|incomplete/i);
  await page.waitForTimeout(400);
  await snap(page, '09-closed-goal');

  // ---- 11. the goal is reached, with a peer's 20 landing between review and record ------------
  // The member saw 470, entered 20, and a peer's 20 landed first. The server
  // returns 510. The CLIENT still infers nothing from 470 → 510; what it says
  // now comes from the server's one-time crossing signal, and here the signal
  // is true: the transaction that recorded this member's 20 found the total
  // at 490 and committed it at 510. That crossing was theirs, and the receipt
  // says so in the member's own words — the shared display still says only
  // "WE did it." and names nobody.
  await page.goto(`/contribute/${crossId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('470 of 500 squats');
  await page.getByTestId('wsf-contribute-entry').fill('20');
  await page.getByTestId('wsf-contribute-review').click();
  await addToShard(crossId, 20);
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'reached');
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 20 squats.');
  await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText(
    'Our goal is reached.'
  );
  await expect(page.getByTestId('wsf-contribute-result-standing')).toHaveText(
    'Our goal of 500 squats is reached and still open. Maple Street Movers is now at 510 of 500 squats.'
  );
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('510 of 500 squats');
  await expect(page.getByTestId('wsf-contribute-percent')).toHaveText('100% complete');
  await expect(page.getByTestId('wsf-contribute-status')).toHaveText('10 beyond our goal · still open');
  await expect(page.getByTestId('wsf-contribute-we')).toHaveAttribute('data-fill-ratio', '1.0000');
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20 squats');
  const reached = await page.getByTestId('wsf-contribute-receipt').innerText();
  expect(reached).not.toMatch(/WE did it|you crossed|winning|final rep|closer|completed the goal|→/i);
  await expect(page.getByTestId('wsf-contribute-another')).toHaveCount(0);
  await page.waitForTimeout(400);
  await snap(page, '11-goal-reached');
  await snapFull(page, '11-goal-reached-full');

  // ---- 12. past the target while still open ----------------------------------------------------
  await page.goto(`/contribute/${crossId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('510 of 500 squats');
  await page.getByTestId('wsf-contribute-entry').fill('5');
  await page.getByTestId('wsf-contribute-review').click();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'postTarget');
  await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 5 squats.');
  // A7. Named like every other variant.
  await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText(
    'Maple Street Movers is now at 515 of 500 squats together.'
  );
  await expect(page.getByTestId('wsf-contribute-status')).toHaveText('15 beyond our goal · still open');
  await expect(page.getByTestId('wsf-contribute-result-standing')).toHaveCount(0);
  const post = await page.getByTestId('wsf-contribute-receipt').innerText();
  expect(post).not.toMatch(/closer|WE did it/);
  await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 25 squats');
  await page.waitForTimeout(300);
  await snap(page, '12-post-target');
});

test('sign-in and not-found states are in the same visual system and do not enumerate', async ({ page }) => {
  test.setTimeout(120_000);
  const fx = await seedBase('states');
  const goalId = `uiB-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId, title: 'Squats together this week', target: 500, unit: 'squats', total: 241, status: 'active', endsInMs: 3 * 24 * 60 * 60_000,
  });

  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-signin-link')).toBeVisible();
  await expect(page.getByTestId('wsf-contribute-entry')).toHaveCount(0);
  await expect(page.getByText('Maple Street Movers')).toHaveCount(0);
  await snap(page, '13-sign-in-required');

  await signInVia(page, fx.memberEmail, fx.password);
  await page.goto(`/contribute/no-such-goal-${fx.stamp}?groupId=${fx.groupId}`);
  await expect(page.getByTestId('wsf-contribute-not-found')).toBeVisible({ timeout: 20_000 });
  const nf = await page.getByTestId('wsf-contribute-not-found').innerText();
  expect(nf).toContain('Goal not found');
  expect(nf).not.toMatch(/member|group|permission|exists but/i);
  await snap(page, '14-not-found');

  // A malformed id (the server answers invalid-argument) is the same screen,
  // with no server message and no retry control.
  await page.goto(`/contribute/not%20a%20goal%21?groupId=${fx.groupId}`);
  await expect(page.getByTestId('wsf-contribute-not-found')).toBeVisible({ timeout: 20_000 });
  expect(await page.getByTestId('wsf-contribute-not-found').innerText()).toBe(nf);
  await expect(page.getByText(/goalId is required|invalid/i)).toHaveCount(0);
});

test('membership lost while on the entry screen: the poll ends and the goal is not found', async ({ page }) => {
  test.setTimeout(120_000);
  const fx = await seedBase('lost');
  const goalId = `uiB-goal-${fx.stamp}`;
  await seedGoal(fx.groupId, fx.championUid, {
    goalId, title: 'Squats together this week', target: 500, unit: 'squats', total: 241, status: 'active', endsInMs: 3 * 24 * 60 * 60_000,
  });
  let pulses = 0;
  let writes = 0;
  await page.route(callableUrl('wsfGoalPulse'), async (route) => {
    pulses += 1;
    await route.continue();
  });
  await page.route(callableUrl('wsfContribute'), async (route) => {
    writes += 1;
    await route.continue();
  });
  await signInVia(page, fx.memberEmail, fx.password);
  await page.goto(`/contribute/${goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('241 of 500 squats');

  // The Champion removes this member while the entry screen is open.
  await firestoreWrite(`wsfMemberships/${fx.groupId}_${fx.memberUid}`, { membershipStatus: { stringValue: 'removed' } }, ['membershipStatus']);
  await expect(page.getByTestId('wsf-contribute-not-found')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveCount(0);
  await expect(page.getByText('241')).toHaveCount(0);
  await expect(page.getByText('Maple Street Movers')).toHaveCount(0);

  // The poll stopped with the refusal, nothing was written, nothing is pending.
  const settled = pulses;
  await page.waitForTimeout(5_000);
  expect(pulses).toBe(settled);
  expect(writes).toBe(0);
  expect(await page.evaluate((k) => window.localStorage.getItem(k), pendingKey(goalId, fx.memberUid))).toBeNull();
});
