import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * RECENT ADDITIONS ON THE PUBLIC DISPLAY — the quiet list under the hero.
 *
 * NOT RUN BY ITS AUTHOR. This file was written in a git worktree, where
 * Playwright cannot run (the app has to be built and served from the primary
 * checkout against the shared emulators). Every assertion below is written
 * against the real testIDs and copy shipped in this change, but the integrator
 * is the first person to execute it. Treat a failure here as unverified rather
 * than as a regression until it has been run once.
 *
 * Modelled on ui-display.spec.ts (anonymous browser, synthetic fixtures seeded
 * straight into the emulators) and e5-display-authorization.spec.ts (revoking
 * the permission out from under a display that is already running).
 *
 * What it proves through the real interface:
 *   CASE 1  an authorized goal with recorded additions shows the list, at
 *           phone and at distant-display size: the "Recent" heading, at most
 *           five lines, the approved "+20 squats · 3 min ago" shape, and the
 *           polite live region the display's accessibility contract requires.
 *   CASE 2  the list carries NOTHING per-member — no uid, no display name, no
 *           count of how many people are behind it.
 *   CASE 3  a goal with no recorded additions shows no list and no empty
 *           heading standing in for one.
 *   CASE 4  revoking the permission under a running display takes the list
 *           away with everything else, leaving the one generic state.
 *
 * Everything here is fixture data.
 */

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-display-recent-additions');
const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 900 };
const GOAL_TZ = 'America/New_York';

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

/** The ISO minute the server would have stored `minutesAgo` minutes ago. */
function isoMinutesAgo(minutesAgo: number): string {
  const ms = Date.now() - minutesAgo * 60_000;
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
}

/**
 * The stored tail. Each addition is its OWN document at
 * `wsfGoals/{goalId}/recentAdditions/{attemptId}` holding exactly
 * `{ amount, at }` — the tail is a subcollection, not a field on the goal, so
 * that a contribution never writes the goal document.
 *
 * Seeded directly rather than driven through wsfContribute: the write itself
 * is proven in the callable suite
 * (tests/callable/wsf-goal-recent-additions.test.ts), and seeding is the only
 * way to give each line its own minute — contributions made inside one test
 * run all share a minute, and the read orders on the minute.
 */
async function seedAdditions(
  goalId: string,
  entries: { amount: number; minutesAgo: number }[]
): Promise<void> {
  for (const [i, e] of entries.entries()) {
    // Named like the attempt ids the app mints, and never rendered: these
    // documents are keyed by the attempt id and do not contain it.
    const attemptId = `uiRAattempt${String(i).padStart(4, '0')}${randomBytes(4).toString('hex')}`;
    await firestoreWrite(`wsfGoals/${goalId}/recentAdditions/${attemptId}`, {
      amount: { integerValue: String(e.amount) },
      at: { stringValue: isoMinutesAgo(e.minutesAgo) },
    });
  }
}

async function seedShards(goalId: string, total: number): Promise<void> {
  await firestoreWrite(`wsfGoalCounters/${goalId}/shards/0`, {
    count: { integerValue: String(total) },
  });
}

type Fx = { stamp: string; groupId: string; championUid: string; memberUid: string };

async function seedCommunity(displayName: string): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const groupId = `uiRA-grp-${stamp}`;
  const championUid = `uiRA-champ-${stamp}`;
  const memberUid = `uiRA-member-${stamp}`;
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: displayName },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: `JOIN${randomBytes(4).toString('hex')}` },
    createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  for (const [uid, role] of [
    [championUid, 'foundingChampion'],
    [memberUid, 'member'],
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
      displayName: { stringValue: `Fixture ${role}` },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }
  return { stamp, groupId, championUid, memberUid };
}

async function seedGoal(
  fx: Fx,
  key: string,
  opts: {
    total: number;
    authorized: boolean;
    additions?: { amount: number; minutesAgo: number }[];
  }
): Promise<string> {
  const goalId = `uiRA-${key}-${fx.stamp}`;
  const now = new Date();
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: fx.championUid },
    communityGroupId: { stringValue: fx.groupId },
    title: { stringValue: 'Squats together this week' },
    target: { integerValue: '5000' },
    unit: { stringValue: 'squats' },
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now.getTime() - 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + 3 * 24 * 60 * 60_000)),
    timezone: { stringValue: GOAL_TZ },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  };
  if (opts.authorized) fields.aggregateDisplayAuthorized = { booleanValue: true };
  await firestoreWrite(`wsfGoals/${goalId}`, fields);
  await seedShards(goalId, opts.total);
  if (opts.additions?.length) await seedAdditions(goalId, opts.additions);
  return goalId;
}

async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: false });
}

/**
 * Eight recorded additions, each in its OWN minute — so the order the display
 * shows is the order the server's `orderBy('at','desc')` establishes, not a
 * tie-break. More than the five the display shows, so the cap is exercised,
 * and the ages are spread so every branch of the age label appears.
 */
const EIGHT = [
  { amount: 20, minutesAgo: 3 },
  { amount: 15, minutesAgo: 8 },
  { amount: 50, minutesAgo: 21 },
  { amount: 5, minutesAgo: 44 },
  { amount: 100, minutesAgo: 75 },
  { amount: 12, minutesAgo: 140 },
  { amount: 30, minutesAgo: 400 },
  { amount: 8, minutesAgo: 1600 },
];

test.describe('recent additions on the public display', () => {
  test('CASE 1 — the list renders under the hero at both sizes', async ({ page }) => {
    const fx = await seedCommunity('Maple Street Movers');
    const goalId = await seedGoal(fx, 'list', { total: 1240, authorized: true, additions: EIGHT });

    for (const [label, size] of [
      ['phone', PHONE],
      ['wide', WIDE],
    ] as const) {
      await page.setViewportSize(size);
      await page.goto(`/display/${goalId}`);
      await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });

      const list = page.getByTestId('wsf-display-recent');
      await expect(list).toBeVisible({ timeout: 20_000 });

      // The accessibility contract: a heading under the goal title, and a
      // POLITE live region — these lines appear because other people acted,
      // never because the viewer did anything.
      await expect(page.getByTestId('wsf-display-recent-heading')).toHaveText('Recent');
      await expect(page.getByTestId('wsf-display-recent-heading')).toHaveAttribute(
        'aria-level',
        '2'
      );
      await expect(list).toHaveAttribute('aria-live', 'polite');
      // The goal title remains the page's ONE level-1 heading.
      await expect(page.getByTestId('wsf-display-goal-title')).toHaveAttribute('aria-level', '1');

      // Five of the eight, newest first, in the approved shape.
      const lines = page.getByTestId('wsf-display-recent-line');
      await expect(lines).toHaveCount(5);
      await expect(lines.nth(0)).toHaveText('+20 squats · 3 min ago');
      await expect(lines.nth(1)).toHaveText('+15 squats · 8 min ago');
      await expect(lines.nth(2)).toHaveText('+50 squats · 21 min ago');
      await expect(lines.nth(3)).toHaveText('+5 squats · 44 min ago');
      await expect(lines.nth(4)).toHaveText('+100 squats · 1 hr ago');

      // It sits UNDER the hero, not inside the numbers.
      const total = await page.getByTestId('wsf-display-total-line').boundingBox();
      const box = await list.boundingBox();
      expect(box).not.toBeNull();
      expect(total).not.toBeNull();
      if (box && total) expect(box.y).toBeGreaterThan(total.y);

      await snap(page, `case1-${label}`);
    }
  });

  test('CASE 2 — the list says nothing about who', async ({ page }) => {
    const fx = await seedCommunity('Maple Street Movers');
    const goalId = await seedGoal(fx, 'noleak', { total: 1240, authorized: true, additions: EIGHT });

    await page.setViewportSize(WIDE);
    await page.goto(`/display/${goalId}`);
    await expect(page.getByTestId('wsf-display-recent')).toBeVisible({ timeout: 20_000 });

    const html = await page.content();
    for (const secret of [fx.memberUid, fx.championUid, fx.groupId, 'Fixture member', 'Fixture foundingChampion']) {
      expect(html).not.toContain(secret);
    }
    // No contributor count by any name, and no per-member framing.
    for (const word of ['contributor', 'people', 'members added', 'someone']) {
      expect(html.toLowerCase()).not.toContain(word);
    }
    // The tail documents are NAMED by attempt id. The name is never published.
    expect(html).not.toContain('uiRAattempt');
  });

  test('CASE 3 — nothing recorded shows no list at all, not an empty one', async ({ page }) => {
    const fx = await seedCommunity('Maple Street Movers');
    // No additions at all: the subcollection simply does not exist, which is
    // exactly the shape of every goal that predates this feature.
    const goalId = await seedGoal(fx, 'empty', { total: 1240, authorized: true, additions: [] });

    await page.setViewportSize(PHONE);
    await page.goto(`/display/${goalId}`);
    await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 20_000 });
    // The total is up, so the screen has definitely answered — this is not a
    // race against a list that simply has not loaded.
    await expect(page.getByTestId('wsf-display-total-line')).toBeVisible();
    // Give the list's own (slower) poll more than one cycle to prove itself.
    await page.waitForTimeout(12_000);
    await expect(page.getByTestId('wsf-display-recent')).toHaveCount(0);
    await expect(page.getByTestId('wsf-display-recent-heading')).toHaveCount(0);
    await snap(page, 'case3-empty');
  });

  test('CASE 4 — revocation takes the list away with everything else', async ({ page }) => {
    const fx = await seedCommunity('Maple Street Movers');
    const goalId = await seedGoal(fx, 'revoke', { total: 1240, authorized: true, additions: EIGHT });

    await page.setViewportSize(WIDE);
    await page.goto(`/display/${goalId}`);
    await expect(page.getByTestId('wsf-display-recent')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('wsf-display-recent-line')).toHaveCount(5);

    // Revoke out from under the running display, exactly as
    // e5-display-authorization does.
    await firestoreWrite(
      `wsfGoals/${goalId}`,
      { aggregateDisplayAuthorized: { booleanValue: false } },
      ['aggregateDisplayAuthorized']
    );

    // The pulse's own poll ends the session and the display falls to its ONE
    // generic state. The list goes with it.
    await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('wsf-display-recent')).toHaveCount(0);
    await expect(page.getByTestId('wsf-display-recent-line')).toHaveCount(0);

    const html = await page.content();
    expect(html).not.toContain('squats');
    expect(html).not.toContain('Recent');
    await snap(page, 'case4-revoked');
  });
});
