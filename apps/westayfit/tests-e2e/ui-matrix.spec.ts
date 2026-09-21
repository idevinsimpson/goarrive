import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * CROSS-SURFACE MATRIX — the same confirmed goal, on all three surfaces.
 *
 * One synthetic community ("Maple Street Movers") and one goal per state.
 * For every state the run captures an ELEMENT CLIP of
 *   - Community Home's goal hero (open) or past-goal card (closed),
 *   - the contribution screen's compact confirmed context (open) or closed
 *     hero (closed),
 *   - the public display's phone hero,
 * and, for four of them, the whole distant display at 1440 × 900.
 *
 * Every capture is asserted FIRST, on the exact derived strings — the printed
 * percentage, the exact total, the status line and the mark's fill ratio — so
 * the board is self-checking: a surface that drifts fails the run rather than
 * quietly shipping a disagreeing picture. The three surfaces are required to
 * agree except where the difference is designed, and each designed difference
 * is asserted as such:
 *   - a CLOSED goal prints no "N% complete" line on Community Home or the
 *     contribution screen ("Closed at N%" / "N beyond our goal" says it);
 *   - a closed, REACHED goal reads "N squats completed together." + "Goal:
 *     500 squats" on the display, where the member surfaces read "N of 500";
 *   - the compact contribution context carries no status line.
 *
 * Everything here is fixture data: the community, the goals, the totals and
 * the member's credit are seeded for the capture. No real members, no real
 * activity.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const PROJECT_ID = 'demo-wsf-local';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-matrix');
const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 900 };

const COMMUNITY_NAME = 'Maple Street Movers';
const UNIT = 'squats';
const GOAL_TZ = 'America/New_York';
// Aug 2 03:00Z – Aug 16 03:59Z is Aug 1 – 15 in New York (Aug 2 – 16 in UTC),
// so a label derived in the runner's own zone would name the wrong days.
const CLOSED_START = '2026-08-02T03:00:00.000Z';
const CLOSED_END = '2026-08-16T03:59:00.000Z';
const CLOSED_PERIOD = 'Aug 1 – 15';
const OPEN_MS = 6 * 24 * 60 * 60_000;

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

async function seedProfile(uid: string, displayName: string): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfMemberProfiles/${uid}`, {
    displayName: { stringValue: displayName },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
}

async function seedCommunity(
  groupId: string,
  members: Array<{ uid: string; role: 'foundingChampion' | 'member' }>
): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: COMMUNITY_NAME },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') },
    createdByUserId: { stringValue: members[0]!.uid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(new Date(now.getTime() - 60 * 24 * 60 * 60_000)),
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
}

async function seedGoal(
  goalId: string,
  groupId: string,
  ownerUid: string,
  s: MatrixState,
  memberUid: string
): Promise<void> {
  const now = new Date();
  const closed = s.status === 'closed';
  await firestoreWrite(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: ownerUid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: s.title },
    target: { integerValue: String(s.target) },
    unit: { stringValue: UNIT },
    status: { stringValue: s.status },
    startsAt: closed
      ? { timestampValue: CLOSED_START }
      : tsField(new Date(now.getTime() - 8 * 24 * 60 * 60_000)),
    endsAt: closed
      ? { timestampValue: CLOSED_END }
      : tsField(new Date(now.getTime() + OPEN_MS)),
    timezone: { stringValue: GOAL_TZ },
    // Every matrix goal is display-authorized: the public display is one of
    // the three surfaces being compared, and Community Home lists a closed
    // goal only while its authorization stands.
    aggregateDisplayAuthorized: { booleanValue: true },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  await seedShards(goalId, s.total);
  await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${memberUid}`, {
    goalId: { stringValue: goalId },
    userId: { stringValue: memberUid },
    total: { integerValue: String(s.ownCredit) },
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

async function clip(page: Page, testId: string, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.getByTestId(testId).screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`) });
}

async function shot(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: false });
}

type MatrixState = {
  key: string;
  title: string;
  total: number;
  target: number;
  status: 'active' | 'closed';
  ownCredit: number;
  /** Derived, and asserted on every surface that prints it. */
  percentText: string;
  totalLine: string;
  statusLine: string;
  ratio: string;
  /** The display's own closed-reached wording, where it differs by design. */
  displayTotalLine: string;
  displayTargetLine: string | null;
  displayHeadline: string | null;
  displayTogether: string | null;
};

const STATES: MatrixState[] = [
  {
    key: '0-of-500',
    title: 'Squats together this week',
    total: 0,
    target: 500,
    status: 'active',
    ownCredit: 0,
    percentText: '0% complete',
    totalLine: '0 of 500 squats',
    statusLine: '500 to go',
    ratio: '0.0000',
    displayTotalLine: '0 of 500 squats',
    displayTargetLine: null,
    displayHeadline: 'See what WE can do.',
    displayTogether: null,
  },
  {
    key: '241-of-500',
    title: 'Squats together this week',
    total: 241,
    target: 500,
    status: 'active',
    ownCredit: 60,
    percentText: '48.2% complete',
    totalLine: '241 of 500 squats',
    statusLine: '259 to go',
    ratio: '0.4820',
    displayTotalLine: '241 of 500 squats',
    displayTargetLine: null,
    displayHeadline: null,
    displayTogether: null,
  },
  {
    key: '450-of-500',
    title: 'Squats together this week',
    total: 450,
    target: 500,
    status: 'active',
    ownCredit: 60,
    percentText: '90% complete',
    totalLine: '450 of 500 squats',
    statusLine: 'Only 50 to go',
    ratio: '0.9000',
    displayTotalLine: '450 of 500 squats',
    displayTargetLine: null,
    displayHeadline: null,
    displayTogether: null,
  },
  {
    key: '515-of-500-open',
    title: 'Squats together this week',
    total: 515,
    target: 500,
    status: 'active',
    ownCredit: 60,
    percentText: '100% complete',
    totalLine: '515 of 500 squats',
    statusLine: '15 beyond our goal · still open',
    ratio: '1.0000',
    displayTotalLine: '515 of 500 squats',
    displayTargetLine: null,
    displayHeadline: 'WE did it.',
    displayTogether: null,
  },
  {
    key: '515-of-500-closed',
    title: 'August squats',
    total: 515,
    target: 500,
    status: 'closed',
    ownCredit: 60,
    percentText: '100% complete',
    totalLine: '515 of 500 squats',
    statusLine: '15 beyond our goal',
    ratio: '1.0000',
    // Designed difference: a finished, reached goal states the achievement,
    // with the goal it was measured against underneath.
    displayTotalLine: '515 squats completed together.',
    displayTargetLine: 'Goal: 500 squats',
    displayHeadline: 'Look what WE did.',
    displayTogether: null,
  },
  {
    key: '312-of-500-closed',
    title: 'August squats',
    total: 312,
    target: 500,
    status: 'closed',
    ownCredit: 40,
    percentText: '62.4% complete',
    totalLine: '312 of 500 squats',
    statusLine: 'Closed at 62.4%',
    ratio: '0.6240',
    displayTotalLine: '312 of 500 squats',
    displayTargetLine: null,
    displayHeadline: null,
    displayTogether: '312 squats completed together.',
  },
];

const WIDE_KEYS = ['241-of-500', '515-of-500-open', '515-of-500-closed', '312-of-500-closed'];

type Seeded = { state: MatrixState; groupId: string; goalId: string };

/**
 * One goal per state, each in its own community, all called "Maple Street
 * Movers". A community with exactly one goal makes the featured hero
 * deterministic without ordering games, and keeps each capture free of a
 * neighbouring goal's numbers.
 */
async function seedMatrix(
  tag: string,
  championUid: string,
  memberUid: string
): Promise<{ stamp: string; seeded: Seeded[] }> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const seeded: Seeded[] = [];
  for (const state of STATES) {
    const groupId = `uiM-${tag}-${state.key}-${stamp}`;
    const goalId = `uiM-${tag}-goal-${state.key}-${stamp}`;
    await seedCommunity(groupId, [
      { uid: championUid, role: 'foundingChampion' },
      { uid: memberUid, role: 'member' },
    ]);
    await seedGoal(goalId, groupId, championUid, state, memberUid);
    seeded.push({ state, groupId, goalId });
  }
  return { stamp, seeded };
}

async function expectDisplayState(page: Page, s: MatrixState): Promise<void> {
  await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('wsf-display-community')).toHaveText(COMMUNITY_NAME);
  await expect(page.getByTestId('wsf-display-total-line')).toHaveText(s.displayTotalLine);
  if (s.displayTargetLine) {
    await expect(page.getByTestId('wsf-display-target')).toHaveText(s.displayTargetLine);
    await expect(page.getByTestId('wsf-display-percent')).toHaveCount(0);
  } else {
    await expect(page.getByTestId('wsf-display-percent')).toHaveText(s.percentText);
  }
  await expect(page.getByTestId('wsf-display-remaining')).toHaveText(s.statusLine);
  if (s.displayHeadline) {
    await expect(page.getByTestId('wsf-display-headline')).toHaveText(s.displayHeadline);
  } else {
    await expect(page.getByTestId('wsf-display-headline')).toHaveCount(0);
  }
  if (s.displayTogether) {
    await expect(page.getByTestId('wsf-display-together')).toHaveText(s.displayTogether);
  }
  await expect(page.getByTestId('wsf-display-we')).toHaveAttribute('data-fill-ratio', s.ratio);
  await expect(page.getByTestId('wsf-display-closed')).toHaveCount(s.status === 'closed' ? 1 : 0);
  if (s.status === 'closed') {
    await expect(page.getByTestId('wsf-display-period')).toHaveText(CLOSED_PERIOD);
  }
  await expect(page.getByTestId('wsf-display-confirmed-at')).toContainText('Confirmed');
  await expect(page.getByTestId('wsf-display-stale')).toHaveCount(0);
}

test.describe('phone 390×844', () => {
  // 3× so an element clip of a 350 CSS-px-wide hero is wide enough to be
  // DOWN-scaled into the board's 880 px cell rather than blown up.
  test.use({ viewport: PHONE, deviceScaleFactor: 3, isMobile: true, hasTouch: true });

  test('the six states agree across Community Home, the contribution screen and the display', async ({
    page,
  }) => {
    test.setTimeout(600_000);
    const password = 'uiM-password';
    const stampish = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    const championEmail = `wsf-uiM-champ-${stampish}@example.com`;
    const memberEmail = `wsf-uiM-member-${stampish}@example.com`;
    const championUid = await seedVerifiedUser(championEmail, password);
    const memberUid = await seedVerifiedUser(memberEmail, password);
    await seedProfile(championUid, 'Fixture Champion');
    await seedProfile(memberUid, 'Fixture Member');
    const { seeded } = await seedMatrix('phone', championUid, memberUid);

    await signInVia(page, memberEmail, password);
    const observed: Record<string, unknown>[] = [];

    for (const { state: s, groupId, goalId } of seeded) {
      const closed = s.status === 'closed';

      // ---- (i) Community Home -------------------------------------------------
      await page.goto(`/community/${groupId}`);
      await expect(page.getByTestId('wsf-community-name')).toHaveText(COMMUNITY_NAME, {
        timeout: 30_000,
      });
      await expect(page.getByTestId(`wsf-community-goal-total-${goalId}`)).toHaveText(s.totalLine, {
        timeout: 30_000,
      });
      // Community Home's History row states a closed goal's result as
      // "Reached" or "Closed at N%". The exact total beside it still carries
      // the overshoot, so "515 of 500 squats" says how far beyond. An open
      // goal keeps the full status line.
      await expect(page.getByTestId(`wsf-community-goal-status-${goalId}`)).toHaveText(
        closed && s.total >= s.target ? 'Reached' : s.statusLine
      );
      await expect(page.getByTestId(`wsf-community-goal-we-${goalId}`)).toHaveAttribute(
        'data-fill-ratio',
        s.ratio
      );
      if (closed) {
        // A past goal states its result once: "Reached" / "Closed at N%" IS
        // the result, so no "N% complete" line above it.
        await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toHaveCount(0);
        await expect(page.getByTestId(`wsf-community-goal-period-${goalId}`)).toHaveText(
          CLOSED_PERIOD
        );
        await expect(page.getByTestId('wsf-community-history')).toContainText('History');
      } else {
        await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toHaveText(
          s.percentText
        );
        // THE EYEBROW CARRIES REAL STATE NEWS, OR NOTHING. The standing
        // communal line is removed; both branches are still asserted, by
        // exact text where the news exists and by the ABSENCE of the element
        // where it does not — which is what would catch a slogan creeping
        // back into this slot.
        if (s.key === '515-of-500-open') {
          await expect(page.getByTestId('wsf-community-goal-eyebrow')).toHaveText('Goal reached');
        } else {
          await expect(page.getByTestId('wsf-community-goal-eyebrow')).toHaveCount(0);
        }
      }
      await page.waitForTimeout(700);
      await clip(
        page,
        closed ? `wsf-community-goal-closed-${goalId}` : 'wsf-community-goal-hero',
        `${s.key}-home`
      );

      // ---- (ii) contribution screen -------------------------------------------
      await page.goto(`/contribute/${goalId}?groupId=${groupId}&mode=record`);
      await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText(s.totalLine, {
        timeout: 30_000,
      });
      if (closed) {
        await expect(page.getByTestId('wsf-contribute-closed')).toBeVisible();
        await expect(page.getByTestId('wsf-contribute-status')).toHaveText(s.statusLine);
        // Same rule as Community Home's past-goal card.
        await expect(page.getByTestId('wsf-contribute-percent')).toHaveCount(0);
        await expect(page.getByTestId('wsf-contribute-we')).toHaveAttribute(
          'data-fill-ratio',
          s.ratio
        );
      } else {
        await expect(page.getByTestId('wsf-contribute-context')).toBeVisible();
        await expect(page.getByTestId('wsf-contribute-context-percent')).toHaveText(s.percentText);
        await expect(page.getByTestId('wsf-contribute-context-updated')).toHaveText(
          /^Confirmed \d{1,2}:\d{2}/
        );
        await expect(page.getByTestId('wsf-contribute-context-we')).toHaveAttribute(
          'data-fill-ratio',
          s.ratio
        );
        // The compact context carries no status line by design — the status
        // belongs to the hero surfaces, not to a one-line context strip.
        await expect(page.getByTestId('wsf-contribute-status')).toHaveCount(0);
      }
      await expect(page.getByTestId('wsf-contribute-community')).toHaveText(COMMUNITY_NAME, {
        timeout: 30_000,
      });
      await page.waitForTimeout(700);
      await clip(
        page,
        closed ? 'wsf-contribute-closed' : 'wsf-contribute-context',
        `${s.key}-contribute`
      );

      // ---- (iii) public display, phone ----------------------------------------
      await page.goto(`/display/${goalId}`);
      await expectDisplayState(page, s);
      await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-layout', 'phone');
      await page.waitForTimeout(700);
      await clip(page, 'wsf-display-phone-hero', `${s.key}-display-phone`);

      observed.push({
        key: s.key,
        goalId,
        groupId,
        percentText: s.percentText,
        totalLine: s.totalLine,
        statusLine: s.statusLine,
        ratio: s.ratio,
        displayTotalLine: s.displayTotalLine,
        displayTargetLine: s.displayTargetLine,
        displayHeadline: s.displayHeadline,
      });
    }

    // ---- the stale display: confirmed values kept, marked not current --------
    const building = seeded.find((x) => x.state.key === '241-of-500')!;
    let drop = false;
    await page.route(callableUrl('wsfGoalPulse'), async (route: Route) => {
      if (drop) return route.abort('failed');
      return route.continue();
    });
    await page.goto(`/display/${building.goalId}`);
    await expectDisplayState(page, building.state);
    drop = true;
    await expect(page.getByTestId('wsf-display-stale')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('wsf-display-stale')).toHaveText('Connection interrupted');
    await expect(page.getByTestId('wsf-display-confirmed-at')).toContainText('Last confirmed');
    // The numbers do not move, and nothing is invented.
    await expect(page.getByTestId('wsf-display-total-line')).toHaveText(building.state.totalLine);
    await expect(page.getByTestId('wsf-display-percent')).toHaveText(building.state.percentText);
    await expect(page.getByTestId('wsf-display-remaining')).toHaveText(building.state.statusLine);
    await page.waitForTimeout(500);
    await clip(page, 'wsf-display-phone-hero', 'stale-display-phone');
    await page.unroute(callableUrl('wsfGoalPulse'));

    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    writeFileSync(
      path.join(ARTIFACTS_DIR, 'matrix.json'),
      JSON.stringify(
        {
          note: 'Synthetic emulator fixture — not real members or activity.',
          community: COMMUNITY_NAME,
          unit: UNIT,
          timezone: GOAL_TZ,
          closedPeriod: CLOSED_PERIOD,
          viewport: PHONE,
          deviceScaleFactor: 3,
          states: observed,
        },
        null,
        2
      )
    );
  });
});

test.describe('wide 1440×900', () => {
  test.use({ viewport: WIDE, deviceScaleFactor: 1, isMobile: false, hasTouch: false });

  test('the distant display carries the same four states, full page', async ({ page }) => {
    test.setTimeout(300_000);
    const password = 'uiM-password';
    const stampish = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
    const championUid = await seedVerifiedUser(`wsf-uiM-wchamp-${stampish}@example.com`, password);
    const memberUid = await seedVerifiedUser(`wsf-uiM-wmember-${stampish}@example.com`, password);
    await seedProfile(championUid, 'Fixture Champion');
    await seedProfile(memberUid, 'Fixture Member');
    const { seeded } = await seedMatrix('wide', championUid, memberUid);

    for (const { state: s, goalId } of seeded) {
      if (!WIDE_KEYS.includes(s.key)) continue;
      await page.goto(`/display/${goalId}`);
      await expectDisplayState(page, s);
      await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-layout', 'wide');
      const overflow = await page.evaluate(() => ({
        h: document.documentElement.scrollHeight,
        w: document.documentElement.scrollWidth,
      }));
      expect(overflow.h, 'no vertical scroll on the distant display').toBeLessThanOrEqual(WIDE.height);
      expect(overflow.w).toBeLessThanOrEqual(WIDE.width);
      await page.waitForTimeout(600);
      await shot(page, `${s.key}-display-wide`);
    }
  });
});
