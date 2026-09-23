import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

import { CAPTURE_FRAMES, saveFrame } from './helpers/capture';

/**
 * BOARD 10 — PUBLIC DISPLAY FAMILY · CURRENT-BUILD CAPTURES.
 *
 * Written for W2's Board 10 packet, released by the Director on PR #416
 * (`5785727716`), because the essential CURRENT screenshots genuinely do not
 * exist. Checked before writing this file, across every tracked PNG in the
 * repository rather than one folder:
 *
 *   · `review/batch-f-public-display/` is 40 TARGET frames at all four locked
 *     sizes, captured from the GATED PREVIEW route `/design-target/display-boards`
 *     rendering `DisplayBoardTargets.tsx`. It is a drawing of a redesign, not
 *     the route.
 *   · `tests-e2e/artifacts/e5-display-authorization/` is 28 committed frames of
 *     the REAL route, but at 1280x720 @1x, and they are authorization-
 *     propagation evidence rather than display compositions.
 *   · `ui-display.spec.ts` shoots the real route at 390x844 @2 and 1440x900 @1
 *     and its artifacts directory is not committed.
 *
 * So nothing anywhere is a current-build capture of the real route at the
 * locked 390x844 / 1280x800 / 1920x1080 viewports. This produces them.
 *
 * WHAT THIS IS NOT. Not a new page, not an acceptance, not hosted proof. Every
 * frame is the real `/display/[goalId]` served from the real web build against
 * the local emulators with SYNTHETIC fixtures. No product file was edited to
 * produce any of it, and no route changed.
 *
 * THE WRITE GATE. `WSF_CAPTURE_FRAMES=1`, the repository's opt-in convention,
 * through `helpers/capture`. An ordinary run asserts every state and writes
 * nothing: the checks are the point, and a screenshot of the wrong state is
 * worse than no screenshot, because it looks like proof.
 *
 * EVERY SHOT IS PRECEDED BY AN ASSERTION OF THE NAMED STATE. Failures and
 * in-flight states cannot be photographed without making something fail or
 * hang, so each such frame carries the injection in its FILENAME:
 *
 *   INJECTED-NETWORK   a callable aborted at the network layer
 *   INJECTED-DELAY     a callable held open, released after the shot
 *
 * Nowhere is an injected failure presented as an organic one.
 *
 * THE 800x1280 FRAME IS EVIDENCE OF A NEGATIVE. `app/display/[goalId].tsx:74`
 * reads `const wide = hydrated && windowWidth >= 900`, so a portrait picture
 * frame takes the PHONE layout in current code. Board 10's lock records the
 * portrait composition as a TARGET rather than claiming it is wired, and this
 * one frame is what makes that checkable instead of asserted.
 */

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const PROJECT_ID = 'demo-wsf-local';
const OUT = path.resolve(__dirname, '..', '..', '..', 'docs/design-target/review/sprint-w2-board10/after');

const PHONE = { width: 390, height: 844 };
const FRAME = { width: 800, height: 1280 };
const BOOTH = { width: 1280, height: 800 };
const WALL = { width: 1920, height: 1080 };

/** The accepted display fixture's community, kept so the family reads as one set. */
const COMMUNITY = 'Maple Street Movers';

const GOAL_TZ = 'America/New_York';
// Window instants sit on UTC date boundaries so a label derived in the
// runner's zone would read a different calendar day than the goal's zone —
// the display must show the GOAL's window on every device.
const OPEN_START = '2026-09-15T04:00:00.000Z';
const OPEN_END = '2026-10-06T03:30:00.000Z';
const CLOSED_START = '2026-08-02T03:00:00.000Z';
const CLOSED_END = '2026-08-16T03:59:00.000Z';
const OPEN_PERIOD = 'Open · Ends Mon, Oct 5';
const CLOSED_PERIOD = 'Aug 1 – 15';

function callableUrl(name: string): string {
  return `${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`;
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
  if (total <= 0) return;
  await firestoreWrite(`wsfGoalCounters/${goalId}/shards/0`, { count: { integerValue: String(total) } });
}

type Fx = { stamp: string; groupId: string; championUid: string; memberUid: string; joinCode: string };

async function seedCommunity(tag: string): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const groupId = `b10-${tag}-${stamp}`;
  const championUid = `b10-champ-${stamp}`;
  const memberUid = `b10-member-${stamp}`;
  const joinCode = `JOIN${randomBytes(4).toString('hex')}`;
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: COMMUNITY },
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
  return { stamp, groupId, championUid, memberUid, joinCode };
}

type GoalSeed = {
  key: string;
  title: string;
  target: number;
  unit: string;
  total: number;
  status: 'active' | 'closed';
  authorized: boolean;
};

async function seedGoal(fx: Fx, g: GoalSeed): Promise<string> {
  const goalId = `b10-${g.key}-${fx.stamp}`;
  const now = new Date();
  const closed = g.status === 'closed';
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: fx.championUid },
    communityGroupId: { stringValue: fx.groupId },
    title: { stringValue: g.title },
    target: { integerValue: String(g.target) },
    unit: { stringValue: g.unit },
    status: { stringValue: g.status },
    startsAt: { timestampValue: closed ? CLOSED_START : OPEN_START },
    endsAt: { timestampValue: closed ? CLOSED_END : OPEN_END },
    timezone: { stringValue: GOAL_TZ },
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

function isoMinutesAgo(m: number): string {
  return new Date(Date.now() - m * 60_000).toISOString();
}

async function seedAdditions(goalId: string, entries: { amount: number; minutesAgo: number }[]): Promise<void> {
  for (const [i, e] of entries.entries()) {
    const attemptId = `b10attempt${String(i).padStart(4, '0')}${randomBytes(4).toString('hex')}`;
    await firestoreWrite(`wsfGoals/${goalId}/recentAdditions/${attemptId}`, {
      amount: { integerValue: String(e.amount) },
      at: { stringValue: isoMinutesAgo(e.minutesAgo) },
    });
  }
}

/** The named states, with the exact strings the route must be showing. */
const SEEDS: Record<string, GoalSeed> = {
  building: { key: 'building', title: 'Squats together this week', target: 500, unit: 'squats', total: 241, status: 'active', authorized: true },
  zero: { key: 'zero', title: 'Squats together this week', target: 500, unit: 'squats', total: 0, status: 'active', authorized: true },
  near: { key: 'near', title: 'Squats together this week', target: 500, unit: 'squats', total: 450, status: 'active', authorized: true },
  reached: { key: 'reached', title: 'Squats together this week', target: 500, unit: 'squats', total: 515, status: 'active', authorized: true },
  closedreached: { key: 'closedreached', title: 'Squats together this week', target: 500, unit: 'squats', total: 515, status: 'closed', authorized: true },
  closedshort: { key: 'closedshort', title: 'August push-ups', target: 500, unit: 'push-ups', total: 312, status: 'closed', authorized: true },
  unauthorized: { key: 'unauthorized', title: 'Squats together this week', target: 500, unit: 'squats', total: 241, status: 'active', authorized: false },
};

const EXPECT: Record<string, { total: string; percent?: string; target?: string; status: string; headline?: string; together?: string }> = {
  building: { total: '241 of 500 squats', percent: '48.2% complete', status: '259 to go' },
  zero: { total: '0 of 500 squats', percent: '0% complete', status: '500 to go', headline: 'See what WE can do.' },
  near: { total: '450 of 500 squats', percent: '90% complete', status: 'Only 50 to go' },
  reached: { total: '515 of 500 squats', percent: '100% complete', status: '15 beyond our goal · still open', headline: 'WE did it.' },
  closedreached: { total: '515 squats completed together.', target: 'Goal: 500 squats', status: '15 beyond our goal', headline: 'Look what WE did.' },
  closedshort: { total: '312 of 500 push-ups', percent: '62.4% complete', status: 'Closed at 62.4%', together: '312 push-ups completed together.' },
};

/**
 * Assert the display is showing exactly the named state — the identity, the
 * confirmed numbers, the phase copy, the freshness, the calibrated mark — and
 * that nothing individual is anywhere in the document.
 */
async function expectReady(page: Page, key: string, fx: Fx): Promise<void> {
  const e = EXPECT[key]!;
  const closed = key.startsWith('closed');
  await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wsf-display-community')).toHaveText(COMMUNITY);
  await expect(page.getByTestId('wsf-display-total-line')).toHaveText(e.total);
  if (e.percent) await expect(page.getByTestId('wsf-display-percent')).toHaveText(e.percent);
  if (e.target) await expect(page.getByTestId('wsf-display-target')).toHaveText(e.target);
  await expect(page.getByTestId('wsf-display-remaining')).toHaveText(e.status);
  if (e.headline) await expect(page.getByTestId('wsf-display-headline')).toHaveText(e.headline);
  else await expect(page.getByTestId('wsf-display-headline')).toHaveCount(0);
  if (e.together) await expect(page.getByTestId('wsf-display-together')).toHaveText(e.together);
  await expect(page.getByTestId('wsf-display-period')).toHaveText(closed ? CLOSED_PERIOD : OPEN_PERIOD);
  await expect(page.getByTestId('wsf-display-closed')).toHaveCount(closed ? 1 : 0);
  // Exactly one calibrated mark per coherent display, and it is the real one.
  await expect(page.getByTestId('wsf-display-we')).toHaveCount(1);
  // NO MEMBER SURFACE. The lock is explicit: no member actions, no raised MOVE
  // and no member tab bar on a public display.
  await expect(page.getByTestId('wsf-tabbar')).toHaveCount(0);
  await expect(page.getByTestId('wsf-move-button')).toHaveCount(0);
  await expectAnonymous(page, fx);
}

/** Anonymous aggregate only: no identity may reach this screen, ever. */
async function expectAnonymous(page: Page, fx: Fx): Promise<void> {
  const html = await page.content();
  for (const s of [fx.memberUid, fx.championUid, fx.joinCode, '7331', 'familyFriends']) {
    expect(html, `a public display must not contain ${s}`).not.toContain(s);
  }
}

async function shoot(page: Page, name: string): Promise<void> {
  if (CAPTURE_FRAMES) mkdirSync(OUT, { recursive: true });
  // The display cannot scroll on any board, so a frame IS the whole screen:
  // fullPage would be a different picture than the one a room sees.
  await saveFrame(page, path.join(OUT, `${name}.png`), { fullPage: false });
}

/** Drop the pulse callable on demand; returns a switch. */
async function interceptPulse(page: Page): Promise<{ drop: (v: boolean) => void }> {
  let dropping = false;
  await page.route(callableUrl('wsfGoalPulse'), async (route: Route) => {
    if (dropping) return route.abort('failed');
    return route.continue();
  });
  return { drop: (v: boolean) => { dropping = v; } };
}

async function goStale(page: Page, key: string, fx: Fx): Promise<void> {
  await expect(page.getByTestId('wsf-display-stale')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-display-stale')).toHaveText('Connection interrupted');
  await expect(page.getByTestId('wsf-display-confirmed-at')).toContainText('Last confirmed');
  // The whole point of stale: the confirmed total and the mark are RETAINED.
  await expect(page.getByTestId('wsf-display-total-line')).toHaveText(EXPECT[key]!.total);
  await expect(page.getByTestId('wsf-display-we')).toHaveCount(1);
  await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-stale', 'true');
  expect(await page.getByTestId('wsf-display-screen').innerText()).not.toMatch(/\blive\b/i);
  await expectAnonymous(page, fx);
}

async function expectNotAvailable(page: Page): Promise<void> {
  await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wsf-display-not-available')).toContainText('Nothing to show here');
  await expect(page.getByTestId('wsf-display-not-available')).toContainText('This display isn’t currently available.');
  // Terminal: the context, the total and the list leave together. A refusal
  // that kept any of them would be an oracle for which goals exist.
  for (const id of ['wsf-display-community', 'wsf-display-goal-title', 'wsf-display-total-line', 'wsf-display-we', 'wsf-display-recent']) {
    await expect(page.getByTestId(id)).toHaveCount(0);
  }
}

test.describe('phone preview 390×844', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  test('the six confirmed phases, each asserted before it is photographed', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seedCommunity('phases');
    for (const key of ['building', 'zero', 'near', 'reached', 'closedreached', 'closedshort']) {
      const goalId = await seedGoal(fx, SEEDS[key]!);
      await page.goto(`/display/${goalId}`);
      await expectReady(page, key, fx);
      await page.waitForTimeout(250);
      await shoot(page, `display-${key}-390x844`);
    }
  });

  test('recent additions are amount and age only', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seedCommunity('recent');
    const goalId = await seedGoal(fx, SEEDS.building!);
    await seedAdditions(goalId, [
      { amount: 20, minutesAgo: 1 },
      { amount: 35, minutesAgo: 4 },
      { amount: 12, minutesAgo: 9 },
      { amount: 50, minutesAgo: 14 },
      { amount: 25, minutesAgo: 22 },
      { amount: 40, minutesAgo: 41 },
    ]);
    await page.goto(`/display/${goalId}`);
    await expectReady(page, 'building', fx);
    await expect(page.getByTestId('wsf-display-recent')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('wsf-display-recent-heading')).toHaveText('Recent');
    // At most five of the ten the server keeps.
    await expect(page.getByTestId('wsf-display-recent-line')).toHaveCount(5);
    for (const line of await page.getByTestId('wsf-display-recent-line').allInnerTexts()) {
      expect(line, 'a recent line is amount and age only').toMatch(/^\+\d[\d,]* \S.*· .+$/);
    }
    await page.waitForTimeout(250);
    await shoot(page, 'display-recent-390x844');
  });

  test('loading, then unreachable before anything was ever confirmed', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seedCommunity('cold');
    const goalId = await seedGoal(fx, SEEDS.building!);

    // ---- loading: the pulse is held open, and released after the shot -------
    let hold = true;
    await page.route(callableUrl('wsfGoalPulse'), async (route: Route) => {
      if (hold) await new Promise((r) => setTimeout(r, 6_000));
      return route.continue();
    });
    await page.goto(`/display/${goalId}`);
    await expect(page.getByTestId('wsf-display-loading')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('wsf-display-loading')).toContainText('Loading display…');
    await expect(page.getByTestId('wsf-display-total-line')).toHaveCount(0);
    await shoot(page, 'display-loading-INJECTED-DELAY-390x844');
    hold = false;
    await expectReady(page, 'building', fx);

    // ---- unreachable: a fresh page whose every poll fails ------------------
    await page.unroute(callableUrl('wsfGoalPulse'));
    await page.route(callableUrl('wsfGoalPulse'), (route: Route) => route.abort('failed'));
    await page.goto(`/display/${goalId}`);
    await expect(page.getByTestId('wsf-display-unreachable')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('wsf-display-unreachable')).toContainText('Connection interrupted');
    await expect(page.getByTestId('wsf-display-unreachable')).toContainText(
      'Nothing has been confirmed yet. Check again when you’re connected.'
    );
    // Nothing was ever confirmed, so there is no number and no mark to keep.
    await expect(page.getByTestId('wsf-display-total-line')).toHaveCount(0);
    await expect(page.getByTestId('wsf-display-we')).toHaveCount(0);
    await shoot(page, 'display-unreachable-INJECTED-NETWORK-390x844');
  });

  test('a later failure keeps the confirmed total and stops calling it current', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seedCommunity('stale');
    const goalId = await seedGoal(fx, SEEDS.building!);
    const pulse = await interceptPulse(page);
    await page.goto(`/display/${goalId}`);
    await expectReady(page, 'building', fx);
    pulse.drop(true);
    await goStale(page, 'building', fx);
    await shoot(page, 'display-stale-INJECTED-NETWORK-390x844');
  });

  test('an unauthorized goal is the one generic state', async ({ page }) => {
    test.setTimeout(120_000);
    const fx = await seedCommunity('refused');
    const goalId = await seedGoal(fx, SEEDS.unauthorized!);
    await page.goto(`/display/${goalId}`);
    await expectNotAvailable(page);
    await expectAnonymous(page, fx);
    await shoot(page, 'display-not-available-390x844');
  });
});

test.describe('portrait picture frame 800×1280', () => {
  test.use({ viewport: FRAME, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

  test('at 800x1280 the build takes the PORTRAIT tier (the pre-fix PHONE layout is the board\'s dated record)', async ({ page }) => {
    test.setTimeout(120_000);
    const fx = await seedCommunity('frame');
    const goalId = await seedGoal(fx, SEEDS.building!);
    await page.goto(`/display/${goalId}`);
    await expectReady(page, 'building', fx);
    // Board 10 recorded the pre-fix build taking the PHONE layout here; the accepted
    // #429 target and the #435 implementation (integrated at app-shell ba774ef) give the
    // 800x1280 frame its own PORTRAIT tier. The board's frames stay the dated record;
    // this assertion follows the build so the producer keeps running against it.
    await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-layout', 'portrait');
    await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-tier', 'portrait');
    await page.waitForTimeout(250);
    await shoot(page, 'display-building-800x1280');
  });
});

test.describe('booth display 1280×800', () => {
  test.use({ viewport: BOOTH, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

  test('the wide build: ordinary, reached and closed', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seedCommunity('booth');
    for (const key of ['building', 'reached', 'closedreached']) {
      const goalId = await seedGoal(fx, SEEDS[key]!);
      if (key === 'building') {
        await seedAdditions(goalId, [
          { amount: 20, minutesAgo: 1 },
          { amount: 35, minutesAgo: 4 },
          { amount: 12, minutesAgo: 9 },
          { amount: 50, minutesAgo: 14 },
          { amount: 25, minutesAgo: 22 },
        ]);
      }
      await page.goto(`/display/${goalId}`);
      await expectReady(page, key, fx);
      await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-layout', 'wide');
      if (key === 'building') await expect(page.getByTestId('wsf-display-recent')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(250);
      await shoot(page, `display-${key}-1280x800`);
    }
  });

  test('a recent-list failure clears only that list', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seedCommunity('recentfail');
    const goalId = await seedGoal(fx, SEEDS.building!);
    await seedAdditions(goalId, [
      { amount: 20, minutesAgo: 1 },
      { amount: 35, minutesAgo: 4 },
      { amount: 12, minutesAgo: 9 },
    ]);
    let dropRecent = false;
    await page.route(callableUrl('wsfGoalRecentAdditions'), async (route: Route) => {
      if (dropRecent) return route.abort('failed');
      return route.continue();
    });
    await page.goto(`/display/${goalId}`);
    await expectReady(page, 'building', fx);
    await expect(page.getByTestId('wsf-display-recent')).toBeVisible({ timeout: 30_000 });
    dropRecent = true;
    // The list goes; the pulse-confirmed total and the mark stay, and the
    // screen does not become stale — the pulse never failed.
    await expect(page.getByTestId('wsf-display-recent')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByTestId('wsf-display-total-line')).toHaveText(EXPECT.building!.total);
    await expect(page.getByTestId('wsf-display-we')).toHaveCount(1);
    await expect(page.getByTestId('wsf-display-stale')).toHaveCount(0);
    await shoot(page, 'display-recent-failure-INJECTED-NETWORK-1280x800');
  });

  test('stale and refused, wide', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seedCommunity('boothfail');
    const goalId = await seedGoal(fx, SEEDS.building!);
    const pulse = await interceptPulse(page);
    await page.goto(`/display/${goalId}`);
    await expectReady(page, 'building', fx);
    pulse.drop(true);
    await goStale(page, 'building', fx);
    await shoot(page, 'display-stale-INJECTED-NETWORK-1280x800');

    const refusedId = await seedGoal(fx, SEEDS.unauthorized!);
    pulse.drop(false);
    await page.goto(`/display/${refusedId}`);
    await expectNotAvailable(page);
    await shoot(page, 'display-not-available-1280x800');
  });
});

test.describe('collective display 1920×1080', () => {
  test.use({ viewport: WALL, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

  test('the same confirmed truth at hall scale', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seedCommunity('wall');
    for (const key of ['building', 'reached']) {
      const goalId = await seedGoal(fx, SEEDS[key]!);
      if (key === 'building') {
        await seedAdditions(goalId, [
          { amount: 20, minutesAgo: 1 },
          { amount: 35, minutesAgo: 4 },
          { amount: 12, minutesAgo: 9 },
          { amount: 50, minutesAgo: 14 },
          { amount: 25, minutesAgo: 22 },
        ]);
      }
      await page.goto(`/display/${goalId}`);
      await expectReady(page, key, fx);
      await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-layout', 'wide');
      await page.waitForTimeout(250);
      await shoot(page, `display-${key}-1920x1080`);
    }
  });

  test('stale at hall scale keeps the number and drops the claim', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seedCommunity('wallstale');
    const goalId = await seedGoal(fx, SEEDS.building!);
    const pulse = await interceptPulse(page);
    await page.goto(`/display/${goalId}`);
    await expectReady(page, 'building', fx);
    pulse.drop(true);
    await goStale(page, 'building', fx);
    await shoot(page, 'display-stale-INJECTED-NETWORK-1920x1080');
  });
});
