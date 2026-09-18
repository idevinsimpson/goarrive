import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * PUBLIC / SHARED PROGRESS DISPLAY — visual checkpoint and behaviour.
 *
 * Anonymous browsers open /display/{goalId} against the emulators with
 * SYNTHETIC fixtures and record every state at phone size (390 × 844) and
 * distant-display size (1440 × 900). Proves through the real interface:
 *   - an authorized goal shows the approved context (community name, goal
 *     title, period) with the aggregate and the Living WE
 *   - unknown, unauthorized and revoked goals answer with one generic state
 *     and no context, totals, target or unit
 *   - re-authorization never resumes a refused session; Check again does
 *   - a transient failure keeps the last confirmed values, marks them stale
 *     with their receipt time, and recovers on the next success; before any
 *     confirmation it shows a neutral connection state
 *   - the distant layout needs no scroll
 *
 * Everything here is fixture data.
 */

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const PROJECT_ID = 'demo-wsf-local';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-display');
const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 900 };

function callableUrl(name: string): string {
  return `${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`;
}

async function firestoreWrite(docPath: string, fields: Record<string, unknown>, updateMask?: string[]): Promise<void> {
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
    await firestoreWrite(`wsfGoalCounters/${goalId}/shards/${i}`, { count: { integerValue: String(count) } });
  }
}

type Fx = { stamp: string; groupId: string; championUid: string; joinCode: string; memberUid: string };

async function seedCommunity(tag: string, displayName: string): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const groupId = `uiC-${tag}-${stamp}`;
  const championUid = `uiC-champ-${stamp}`;
  const memberUid = `uiC-member-${stamp}`;
  const joinCode = `JOIN${randomBytes(4).toString('hex')}`;
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: displayName },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: joinCode },
    createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  for (const [uid, role] of [[championUid, 'foundingChampion'], [memberUid, 'member']] as const) {
    await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
      groupId: { stringValue: groupId },
      userId: { stringValue: uid },
      role: { stringValue: role },
      membershipStatus: { stringValue: 'active' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }
  return { stamp, groupId, championUid, joinCode, memberUid };
}

type GoalSeed = {
  key: string;
  title: string;
  target: number;
  unit: string;
  total: number;
  status: 'active' | 'closed';
  endsInMs: number;
  authorized: boolean;
};

async function seedGoal(fx: Fx, g: GoalSeed): Promise<string> {
  const goalId = `uiC-${g.key}-${fx.stamp}`;
  const now = new Date();
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: fx.championUid },
    communityGroupId: { stringValue: fx.groupId },
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
  if (g.authorized) fields.aggregateDisplayAuthorized = { booleanValue: true };
  await firestoreWrite(`wsfGoals/${goalId}`, fields);
  await seedShards(goalId, g.total);
  // A member with credit exists, so a leak would have something to leak.
  await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${fx.memberUid}`, {
    goalId: { stringValue: goalId },
    userId: { stringValue: fx.memberUid },
    total: { integerValue: '7331' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  return goalId;
}

async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: false });
}

async function expectNoLeak(page: Page, fx: Fx): Promise<void> {
  const html = await page.content();
  for (const s of [fx.memberUid, fx.championUid, fx.joinCode, '7331', 'familyFriends', 'private']) {
    expect(html, `display must not contain ${s}`).not.toContain(s);
  }
}

const OPEN = 3 * 24 * 60 * 60_000;
const STATES: GoalSeed[] = [
  { key: 'building', title: 'Squats together this week', target: 500, unit: 'squats', total: 241, status: 'active', endsInMs: OPEN, authorized: true },
  { key: 'zero', title: 'Squats together this week', target: 500, unit: 'squats', total: 0, status: 'active', endsInMs: OPEN, authorized: true },
  { key: 'near', title: 'Squats together this week', target: 500, unit: 'squats', total: 450, status: 'active', endsInMs: OPEN, authorized: true },
  { key: 'almost', title: 'Minutes walked in September', target: 5000, unit: 'minutes', total: 4999, status: 'active', endsInMs: OPEN, authorized: true },
  { key: 'reached', title: 'Squats together this week', target: 500, unit: 'squats', total: 515, status: 'active', endsInMs: OPEN, authorized: true },
  { key: 'closedreached', title: 'Squats together this week', target: 500, unit: 'squats', total: 515, status: 'closed', endsInMs: -20 * 24 * 60 * 60_000, authorized: true },
  { key: 'closedshort', title: 'August push-ups', target: 500, unit: 'push-ups', total: 312, status: 'closed', endsInMs: -20 * 24 * 60 * 60_000, authorized: true },
];

const EXPECT: Record<string, { total: string; percent?: string; status: string; headline?: string; together?: string; target?: string }> = {
  building: { total: '241 of 500 squats', percent: '48.2% complete', status: '259 to go' },
  zero: { total: '0 of 500 squats', percent: '0% complete', status: '500 to go', headline: 'See what WE can do.' },
  near: { total: '450 of 500 squats', percent: '90% complete', status: 'Only 50 to go' },
  almost: { total: '4,999 of 5,000 minutes', percent: '99.9% complete', status: 'Only 1 to go' },
  reached: { total: '515 of 500 squats', percent: '100% complete', status: '15 beyond our goal · still open', headline: 'WE did it.' },
  closedreached: { total: '515 squats completed together.', target: 'Goal: 500 squats', status: '15 beyond our goal', headline: 'Look what WE did.' },
  closedshort: { total: '312 of 500 push-ups', percent: '62.4% of our goal', status: 'Closed at 62.4%', together: '312 push-ups completed together.' },
};

async function expectState(page: Page, key: string, closed: boolean): Promise<void> {
  const e = EXPECT[key]!;
  await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-display-community')).toHaveText('Maple Street Movers');
  await expect(page.getByTestId('wsf-display-total-line')).toHaveText(e.total);
  if (e.percent) await expect(page.getByTestId('wsf-display-percent')).toHaveText(e.percent);
  if (e.target) await expect(page.getByTestId('wsf-display-target')).toHaveText(e.target);
  await expect(page.getByTestId('wsf-display-remaining')).toHaveText(e.status);
  if (e.headline) await expect(page.getByTestId('wsf-display-headline')).toHaveText(e.headline);
  else await expect(page.getByTestId('wsf-display-headline')).toHaveCount(0);
  if (e.together) await expect(page.getByTestId('wsf-display-together')).toHaveText(e.together);
  await expect(page.getByTestId('wsf-display-closed')).toHaveCount(closed ? 1 : 0);
  await expect(page.getByTestId('wsf-display-stale')).toHaveCount(0);
  await expect(page.getByTestId('wsf-display-confirmed-at')).toContainText('Confirmed');
  const text = await page.getByTestId('wsf-display-screen').innerText();
  expect(text).not.toMatch(/failed|missed|incomplete|winning|final rep|join|scan|QR|share/i);
}

test.describe('phone 390×844', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  test('authorized states: building, zero, near goal, 99.9%, reached open, closed reached, closed unreached', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seedCommunity('states', 'Maple Street Movers');
    const ids: Record<string, string> = {};
    for (const g of STATES) ids[g.key] = await seedGoal(fx, g);
    const shots: Array<[string, string]> = [
      ['building', '01-authorized-building'],
      ['zero', '02-zero'],
      ['near', '03-near-goal'],
      ['almost', '04-99-9-below-target'],
      ['reached', '05-reached-still-open'],
      ['closedreached', '06-closed-reached'],
      ['closedshort', '07-closed-unreached'],
    ];
    for (const [key, name] of shots) {
      await page.goto(`/display/${ids[key]}`);
      await expectState(page, key, key.startsWith('closed'));
      await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-layout', 'phone');
      await expectNoLeak(page, fx);
      if (key === 'building') {
        await expect(page.getByTestId('wsf-display-goal-title')).toHaveText('Squats together this week');
        await expect(page.getByTestId('wsf-display-period')).toContainText('Open · Ends');
        await expect(page.getByTestId('wsf-display-we')).toHaveAttribute('data-fill-ratio', '0.4820');
        await expect(page.getByTestId('wsf-display-shared-total')).toHaveText('241');
      }
      if (key === 'almost') {
        await expect(page.getByTestId('wsf-display-we')).toHaveAttribute('data-fill-ratio', '0.9998');
        await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-phase', 'nearGoal');
      }
      if (key === 'reached') await expect(page.getByTestId('wsf-display-we')).toHaveAttribute('data-fill-ratio', '1.0000');
      if (key === 'closedshort') await expect(page.getByTestId('wsf-display-period')).toMatch(/Aug|Sep|–/);
      await page.waitForTimeout(400);
      await snap(page, name);
    }
  });

  test('unknown, unauthorized and revoked goals are one generic state; re-authorization needs Check again', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seedCommunity('refusal', 'Maple Street Movers');
    const unauthorized = await seedGoal(fx, { ...STATES[0]!, key: 'unauth', authorized: false });
    const authorized = await seedGoal(fx, { ...STATES[0]!, key: 'auth' });

    // ---- 8. unknown and unauthorized: same screen, no context ---------------------
    await page.goto(`/display/no-such-goal-${fx.stamp}`);
    await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });
    const unknownText = await page.getByTestId('wsf-display-not-available').innerText();
    await page.goto(`/display/${unauthorized}`);
    await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });
    const unauthorizedText = await page.getByTestId('wsf-display-not-available').innerText();
    expect(unauthorizedText).toBe(unknownText);
    expect(unauthorizedText).toContain('Nothing to show here');
    expect(unauthorizedText).not.toMatch(/Maple|Squats|500|squats|authoriz|exist/i);
    await expectNoLeak(page, fx);
    await page.waitForTimeout(300);
    await snap(page, '08-unavailable');

    // ---- authorized → ready, then revoked ---------------------------------------------
    await page.goto(`/display/${authorized}`);
    await expectState(page, 'building', false);
    await firestoreWrite(`wsfGoals/${authorized}`, { aggregateDisplayAuthorized: { booleanValue: false } }, ['aggregateDisplayAuthorized']);
    await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Maple Street Movers')).toHaveCount(0);
    await expect(page.getByText('Squats together this week')).toHaveCount(0);
    await expect(page.getByText('241')).toHaveCount(0);
    await expectNoLeak(page, fx);

    // ---- 9. re-authorized: the refused session stays refused ---------------------------
    await firestoreWrite(`wsfGoals/${authorized}`, { aggregateDisplayAuthorized: { booleanValue: true } }, ['aggregateDisplayAuthorized']);
    await page.waitForTimeout(6_000);
    await expect(page.getByTestId('wsf-display-not-available')).toBeVisible();
    await expect(page.getByText('241')).toHaveCount(0);
    await snap(page, '09-reauthorized-old-session-still-refused');

    // ---- 10. Check again starts a fresh session ---------------------------------------------
    await page.getByTestId('wsf-display-recheck').click();
    await expectState(page, 'building', false);
    await page.waitForTimeout(300);
    await snap(page, '10-fresh-session-after-check-again');
  });

  test('a transient failure keeps the confirmed values, marks them stale, and recovers', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seedCommunity('stale', 'Maple Street Movers');
    const goalId = await seedGoal(fx, { ...STATES[0]!, key: 'stale' });
    let drop = false;
    await page.route(callableUrl('wsfGoalPulse'), async (route: Route) => {
      if (drop) return route.abort('failed');
      return route.continue();
    });

    await page.goto(`/display/${goalId}`);
    await expectState(page, 'building', false);
    const confirmedAt = await page.getByTestId('wsf-display-confirmed-at').innerText();

    // ---- 11. connection interrupted -----------------------------------------------------
    drop = true;
    await expect(page.getByTestId('wsf-display-stale')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('wsf-display-stale')).toHaveText('Connection interrupted');
    await expect(page.getByTestId('wsf-display-confirmed-at')).toContainText('Last confirmed');
    await expect(page.getByTestId('wsf-display-total-line')).toHaveText('241 of 500 squats');
    await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-stale', 'true');
    // The last confirmed time does not move while nothing new is confirmed.
    expect((await page.getByTestId('wsf-display-confirmed-at').innerText()).replace('Last confirmed', 'Confirmed')).toBe(confirmedAt);
    const staleText = await page.getByTestId('wsf-display-screen').innerText();
    expect(staleText).not.toMatch(/\blive\b/i);
    await page.waitForTimeout(300);
    await snap(page, '11-connection-interrupted');

    // ---- recovery on the next success --------------------------------------------------------
    drop = false;
    await expect(page.getByTestId('wsf-display-stale')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-stale', 'false');
    await expect(page.getByTestId('wsf-display-confirmed-at')).toContainText('Confirmed');

    // ---- never confirmed + transient failure: neutral, no fake total ---------------------------
    drop = true;
    await page.goto(`/display/${goalId}`);
    await expect(page.getByTestId('wsf-display-unreachable')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('241')).toHaveCount(0);
    await expect(page.getByText('Maple Street Movers')).toHaveCount(0);
    await expect(page.getByTestId('wsf-display-recheck')).toBeVisible();
    await snap(page, '11b-unreachable-before-any-confirmation');
  });
});

test.describe('wide 1440×900', () => {
  test.use({ viewport: WIDE, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

  test('distant display states need no scroll', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seedCommunity('wide', 'Maple Street Movers');
    const ids: Record<string, string> = {};
    for (const g of STATES) ids[g.key] = await seedGoal(fx, g);
    const shots: Array<[string, string]> = [
      ['building', '12-wide-authorized-building'],
      ['near', '13-wide-near-goal'],
      ['reached', '14-wide-reached-still-open'],
      ['closedreached', '15-wide-closed-reached'],
      ['closedshort', '16-wide-closed-unreached'],
    ];
    for (const [key, name] of shots) {
      await page.goto(`/display/${ids[key]}`);
      await expectState(page, key, key.startsWith('closed'));
      await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-layout', 'wide');
      const overflow = await page.evaluate(() => ({
        h: document.documentElement.scrollHeight,
        w: document.documentElement.scrollWidth,
      }));
      expect(overflow.h, 'no vertical scroll on the distant display').toBeLessThanOrEqual(WIDE.height);
      expect(overflow.w).toBeLessThanOrEqual(WIDE.width);
      await expectNoLeak(page, fx);
      await page.waitForTimeout(400);
      await snap(page, name);
    }

    // ---- 17. stale on the wide layout ---------------------------------------------------
    let drop = false;
    await page.route(callableUrl('wsfGoalPulse'), async (route: Route) => {
      if (drop) return route.abort('failed');
      return route.continue();
    });
    await page.goto(`/display/${ids.building}`);
    await expectState(page, 'building', false);
    drop = true;
    await expect(page.getByTestId('wsf-display-stale')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('wsf-display-total-line')).toHaveText('241 of 500 squats');
    await page.waitForTimeout(300);
    await snap(page, '17-wide-connection-interrupted');
  });
});
