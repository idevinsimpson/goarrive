import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

/**
 * PUBLIC / SHARED PROGRESS DISPLAY — TORTURE ROUND 2 (overnight 2026-09-18).
 *
 * Companion to ui-display.spec.ts. Same emulators, same SYNTHETIC fixtures,
 * same phone viewport — but every scenario here is one the happy path cannot
 * reach: the screen is opened from the wrong side of the world, the
 * permission is flipped three times inside one cache window, and Check again
 * is pressed while the connection is still down.
 *
 * What it proves through the real interface:
 *   - T2  the device's time zone cannot move a goal's window label. A display
 *         standing in Tokyo and a display standing on Kiritimati read the SAME
 *         period as the New York goal published, on the calendar day the goal's
 *         zone says — even where the device's own zone is a different day. A
 *         goal whose stored zone is unusable is refused outright rather than
 *         shown with a date from the wrong zone.
 *   - T3  authorization is decided BEFORE the server's 2s per-goal cache, so
 *         three flips back-to-back inside one cache window still end with the
 *         session refused and every protected value off the screen; the
 *         refused session stays refused, and only Check again brings it back.
 *         The poll window is then measured, and a new total reaches the screen
 *         inside it.
 *   - T6  REGRESSION LOCK. A refusal followed by Check again while the
 *         connection is down must show the neutral "nothing confirmed yet"
 *         state — never a stale marker over a total from the session that was
 *         refused, and never the refused total itself.
 *
 * Everything here is fixture data: the community, the goal, the totals and the
 * window instants are seeded for the run and are not real people or activity.
 *
 * Helpers below are COPIED from ui-display.spec.ts on purpose — a spec that
 * imports another spec's fixtures makes both harder to change.
 */

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const PROJECT_ID = 'demo-wsf-local';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-display-torture-2');
const PHONE = { width: 390, height: 844 };

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
  const groupId = `uiT2-${tag}-${stamp}`;
  const championUid = `uiT2-champ-${stamp}`;
  const memberUid = `uiT2-member-${stamp}`;
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
  /** Explicit window instants, for fixtures placed on a UTC date boundary. */
  startsAtIso?: string;
  endsAtIso?: string;
};

async function seedGoal(fx: Fx, g: GoalSeed): Promise<string> {
  const goalId = `uiT2-${g.key}-${fx.stamp}`;
  const now = new Date();
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: fx.championUid },
    communityGroupId: { stringValue: fx.groupId },
    title: { stringValue: g.title },
    target: { integerValue: String(g.target) },
    unit: { stringValue: g.unit },
    status: { stringValue: g.status },
    startsAt: g.startsAtIso
      ? { timestampValue: g.startsAtIso }
      : tsField(new Date(now.getTime() + g.endsInMs - 14 * 24 * 60 * 60_000)),
    endsAt: g.endsAtIso ? { timestampValue: g.endsAtIso } : tsField(new Date(now.getTime() + g.endsInMs)),
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
// Every fixture goal is published in New York time. The window instants below
// sit on UTC date boundaries so a label derived in the device's zone would read
// a DIFFERENT calendar day than the goal's zone — and, for the two describes
// below, a different day again in Tokyo (UTC+9) and on Kiritimati (UTC+14):
//   building  ends 2026-10-06T03:30:00Z = Mon Oct 5, 11:30 PM EDT → "Ends Mon, Oct 5"
//             (UTC: Tue Oct 6 · Tokyo: Tue Oct 6 12:30 PM)
//   closed    Aug 2 03:00Z – Aug 16 03:59Z = Aug 1 – 15 in New York
//             (UTC: Aug 2 – 16 · Kiritimati: Aug 2 – 16, seventeen hours ahead)
const GOAL_TZ = 'America/New_York';
const BUILDING_START = '2026-09-15T04:00:00.000Z';
const BUILDING_END = '2026-10-06T03:30:00.000Z';
const CLOSED_START = '2026-08-02T03:00:00.000Z';
const CLOSED_END = '2026-08-16T03:59:00.000Z';
const EXPECT_OPEN_PERIOD = 'Open · Ends Mon, Oct 5';
const EXPECT_CLOSED_PERIOD = 'Aug 1 – 15';

/** The ui-display.spec.ts `building` fixture: authorized, 241 of 500 squats. */
const BUILDING: GoalSeed = {
  key: 'building',
  title: 'Squats together this week',
  target: 500,
  unit: 'squats',
  total: 241,
  status: 'active',
  endsInMs: OPEN,
  authorized: true,
  startsAtIso: BUILDING_START,
  endsAtIso: BUILDING_END,
};

/** The ui-display.spec.ts `closedshort` fixture: authorized, closed, 312 of 500. */
const CLOSED: GoalSeed = {
  key: 'closedshort',
  title: 'August push-ups',
  target: 500,
  unit: 'push-ups',
  total: 312,
  status: 'closed',
  endsInMs: -20 * 24 * 60 * 60_000,
  authorized: true,
  startsAtIso: CLOSED_START,
  endsAtIso: CLOSED_END,
};

/**
 * The `building` fixture, fully rendered and current. Narrowed from
 * ui-display.spec.ts's expectState: the freshness clock is the READER's own,
 * so only the word is asserted here — these tests deliberately stand in zones
 * where the hour is not the runner's.
 */
async function expectBuildingReady(page: Page): Promise<void> {
  await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-display-community')).toHaveText('Maple Street Movers');
  await expect(page.getByTestId('wsf-display-goal-title')).toHaveText('Squats together this week');
  await expect(page.getByTestId('wsf-display-total-line')).toHaveText('241 of 500 squats');
  await expect(page.getByTestId('wsf-display-shared-total')).toHaveText('241');
  await expect(page.getByTestId('wsf-display-percent')).toHaveText('48.2% complete');
  await expect(page.getByTestId('wsf-display-remaining')).toHaveText('259 to go');
  await expect(page.getByTestId('wsf-display-headline')).toHaveCount(0);
  await expect(page.getByTestId('wsf-display-closed')).toHaveCount(0);
  await expect(page.getByTestId('wsf-display-stale')).toHaveCount(0);
  await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-stale', 'false');
  await expect(page.getByTestId('wsf-display-confirmed-at')).toContainText('Confirmed');
}

/** The calendar labels the DEVICE's own zone would produce for an instant. */
async function deviceCalendar(
  page: Page,
  iso: string
): Promise<{ withWeekday: string; monthDay: string }> {
  return page.evaluate(
    (value: string) => ({
      withWeekday: new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      }).format(new Date(value)),
      monthDay: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(
        new Date(value)
      ),
    }),
    iso
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// T2 — the device's zone must not move a goal-zone label.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('T2 · a display standing in Tokyo', () => {
  test.use({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Asia/Tokyo',
    locale: 'en-US',
  });

  test('an open goal reads the New York window, on New York’s calendar day', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seedCommunity('tokyo', 'Maple Street Movers');
    const goalId = await seedGoal(fx, BUILDING);

    await page.goto(`/display/${goalId}`);
    await expectBuildingReady(page);
    await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-layout', 'phone');

    // The device really is nine hours ahead, and its own zone really would
    // name a different day for this instant. Without this the assertion below
    // would pass on a UTC runner that ignored `timezoneId` entirely.
    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
      'Asia/Tokyo'
    );
    expect((await deviceCalendar(page, BUILDING_END)).withWeekday).toBe('Tue, Oct 6');

    // And the screen still says what the goal's zone says — the same string the
    // UTC runner in ui-display.spec.ts expects, to the character.
    await expect(page.getByTestId('wsf-display-period')).toHaveText(EXPECT_OPEN_PERIOD);
    expect(await page.getByTestId('wsf-display-period').innerText()).toBe(EXPECT_OPEN_PERIOD);
    await expectNoLeak(page, fx);
    await snap(page, '60-tokyo-open-period');
  });

  test('a goal whose stored zone is unusable is refused, not dated from the wrong zone', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const fx = await seedCommunity('badzone', 'Maple Street Movers');
    const goalId = await seedGoal(fx, BUILDING);

    await page.goto(`/display/${goalId}`);
    await expectBuildingReady(page);

    // The stored zone becomes unusable. wsfGoalPulse normalizes the goal's
    // timezone and refuses (the generic not-found) when it cannot be resolved,
    // and that check runs BEFORE the 2s cache is consulted, so the refusal is
    // immediate rather than cached-good for another window.
    //
    // NOTE ON src/ui/dates.ts. Its resolveZone withholding branch — a zone
    // supplied but invalid, so the label is null and the screen falls back to
    // the bare "Open" / no period — is UNREACHABLE FROM THIS SCREEN: the only
    // zone the display ever formats with is the one wsfGoalPulse published,
    // and the server never publishes a zone it could not resolve itself. The
    // branch is still right to keep (dates.ts is also called with zones from
    // other sources), and it is covered by the dates unit tests; it simply
    // cannot be driven through /display.
    await firestoreWrite(`wsfGoals/${goalId}`, { timezone: { stringValue: 'Not/AZone' } }, ['timezone']);
    await page.reload();

    await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('wsf-display-not-available')).toContainText('Nothing to show here');
    await expect(page.getByTestId('wsf-display-screen')).toHaveCount(0);
    await expect(page.getByTestId('wsf-display-period')).toHaveCount(0);
    await expect(page.getByText('Maple Street Movers')).toHaveCount(0);
    await expect(page.getByText('241')).toHaveCount(0);
    await expectNoLeak(page, fx);
    await snap(page, '61-unusable-zone-refused');
  });
});

test.describe('T2 · a display standing on Kiritimati', () => {
  test.use({
    viewport: PHONE,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Pacific/Kiritimati',
    locale: 'en-US',
  });

  test('a closed goal reads the New York period, fourteen hours behind the device', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const fx = await seedCommunity('kiritimati', 'Maple Street Movers');
    const goalId = await seedGoal(fx, CLOSED);

    await page.goto(`/display/${goalId}`);
    await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('wsf-display-community')).toHaveText('Maple Street Movers');
    await expect(page.getByTestId('wsf-display-total-line')).toHaveText('312 of 500 push-ups');
    await expect(page.getByTestId('wsf-display-closed')).toHaveCount(1);

    expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
      'Pacific/Kiritimati'
    );
    // The device's own zone would name Aug 2 – 16 for this window.
    expect((await deviceCalendar(page, CLOSED_START)).monthDay).toBe('Aug 2');
    expect((await deviceCalendar(page, CLOSED_END)).monthDay).toBe('Aug 16');

    await expect(page.getByTestId('wsf-display-period')).toHaveText(EXPECT_CLOSED_PERIOD);
    expect(await page.getByTestId('wsf-display-period').innerText()).toBe(EXPECT_CLOSED_PERIOD);
    await expect(page.getByTestId('wsf-display-confirmed-at')).toContainText('Confirmed');
    await expect(page.getByTestId('wsf-display-stale')).toHaveCount(0);
    await expectNoLeak(page, fx);
    await snap(page, '62-kiritimati-closed-period');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// T3 and T6 — the phone display, in the runner's own zone.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('phone 390×844', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  test('T3 — three authorization flips inside one cache window still end the session, and the poll window is honest', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const fx = await seedCommunity('cache', 'Maple Street Movers');
    const goalId = await seedGoal(fx, BUILDING);
    const authorize = (on: boolean) =>
      firestoreWrite(`wsfGoals/${goalId}`, { aggregateDisplayAuthorized: { booleanValue: on } }, [
        'aggregateDisplayAuthorized',
      ]);

    await page.goto(`/display/${goalId}`);
    await expectBuildingReady(page);

    // ---- three flips, back to back, well inside the server's 2s per-goal
    // cache window. The last word is "revoked", and access is decided BEFORE
    // the cache is consulted, so no cached entry can stand in for the
    // decision and no flip can leave a good answer behind to be served.
    await authorize(false);
    await authorize(true);
    await authorize(false);

    await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('wsf-display-screen')).toHaveCount(0);
    await expect(page.getByText('241')).toHaveCount(0);
    await expect(page.getByText('Maple Street Movers')).toHaveCount(0);
    await expect(page.getByText('Squats together this week')).toHaveCount(0);
    await expectNoLeak(page, fx);
    await snap(page, '63-flips-ended-the-session');

    // ---- re-authorized: the refused session stays refused ------------------
    await authorize(true);
    await page.waitForTimeout(6_000);
    await expect(page.getByTestId('wsf-display-not-available')).toBeVisible();
    await expect(page.getByText('241')).toHaveCount(0);

    // ---- Check again starts a fresh session --------------------------------
    await page.getByTestId('wsf-display-recheck').click();
    await expectBuildingReady(page);
    await snap(page, '64-fresh-session-after-check-again');

    // ---- the poll window ---------------------------------------------------
    // The screen claims to be current, so it has to actually ask. Two seconds
    // over ten is five requests; the band allows one either side of that for
    // scheduling, and nothing like a runaway loop.
    let polls = 0;
    const count = (r: { url(): string; method(): string }) => {
      // POST only: a CORS preflight is not a poll.
      if (r.method() === 'POST' && r.url().includes('wsfGoalPulse')) polls += 1;
    };
    page.on('request', count);
    await page.waitForTimeout(10_000);
    page.off('request', count);
    expect(polls, 'wsfGoalPulse calls in 10s at a 2s interval').toBeGreaterThanOrEqual(4);
    expect(polls, 'wsfGoalPulse calls in 10s at a 2s interval').toBeLessThanOrEqual(7);

    // ---- and a new total actually arrives inside that window ---------------
    // Worst case is the 2s cache plus the 2s poll.
    await seedShards(goalId, 300);
    await expect(page.getByTestId('wsf-display-shared-total')).toHaveText('300', { timeout: 5_000 });
    await expect(page.getByTestId('wsf-display-total-line')).toHaveText('300 of 500 squats');
    await expect(page.getByTestId('wsf-display-stale')).toHaveCount(0);
    await snap(page, '65-new-total-inside-the-freshness-window');
  });

  test('T6 — Check again while the connection is down shows the neutral state, never a stale refused total', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const fx = await seedCommunity('recheck', 'Maple Street Movers');
    const goalId = await seedGoal(fx, BUILDING);
    const authorize = (on: boolean) =>
      firestoreWrite(`wsfGoals/${goalId}`, { aggregateDisplayAuthorized: { booleanValue: on } }, [
        'aggregateDisplayAuthorized',
      ]);

    // One programmable route for the whole case: `pass` forwards to the real
    // emulator, `abort` is a transient network failure.
    let mode: 'pass' | 'abort' = 'pass';
    await page.route(callableUrl('wsfGoalPulse'), async (route: Route) => {
      if (mode === 'abort') return route.abort('failed');
      return route.continue();
    });

    await page.goto(`/display/${goalId}`);
    await expectBuildingReady(page);

    // ---- refused ------------------------------------------------------------
    await authorize(false);
    await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('241')).toHaveCount(0);

    // ---- Check again, with the connection down ------------------------------
    // THE REGRESSION THIS LOCKS. The fresh session has confirmed nothing, and
    // the values the refused session held are gone. Carrying them back to mark
    // them "stale" would put a protected total on screen again — under a
    // yellow pill, but on screen — after the server refused it.
    mode = 'abort';
    await page.getByTestId('wsf-display-recheck').click();
    await expect(page.getByTestId('wsf-display-unreachable')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('wsf-display-stale')).toHaveCount(0);
    await expect(page.getByText('241')).toHaveCount(0);
    await expect(page.getByTestId('wsf-display-screen')).toHaveCount(0);
    await expect(page.getByTestId('wsf-display-total-line')).toHaveCount(0);
    await expect(page.getByTestId('wsf-display-freshness')).toHaveCount(0);
    await expect(page.getByText('Maple Street Movers')).toHaveCount(0);
    await expectNoLeak(page, fx);
    await snap(page, '66-unreachable-after-check-again');

    // Several more failed polls change nothing.
    await page.waitForTimeout(6_000);
    await expect(page.getByTestId('wsf-display-unreachable')).toBeVisible();
    await expect(page.getByTestId('wsf-display-stale')).toHaveCount(0);
    await expect(page.getByText('241')).toHaveCount(0);

    // ---- connection back, permission back, one more Check again -------------
    await authorize(true);
    mode = 'pass';
    await page.getByTestId('wsf-display-recheck').click();
    await expect(page.getByTestId('wsf-display-shared-total')).toHaveText('241', { timeout: 20_000 });
    await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-stale', 'false');
    await expectBuildingReady(page);
    await snap(page, '67-recovered-after-the-connection-returned');
  });
});
