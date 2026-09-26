import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

import {
  firestoreWrite,
  seedCommunity,
  seedMembership,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';

/**
 * THE REAL CAPTURES BEHIND NORTH STAR BOARD 01 — HOME.
 *
 * Board 01's lock (PR #365, `5771373306` and `5771398679`) accepted its
 * creative direction and held it for one precision pass whose first item is:
 * "composite the exact owner wordmark and real calibrated LivingWeProgress
 * output" — the generated marks on revisions 1–7 were placeholders. The only
 * source that satisfies that sentence is the running product, so every phone
 * and every lifecycle state on the board is photographed HERE, from the
 * emulator build, through the same data path a member's phone uses.
 *
 * Each state is seeded, ASSERTED (the percent, the status line, the fill
 * ratio attribute, the eyebrow) and only then photographed. A frame whose
 * numbers were never checked is a picture, not evidence.
 *
 * Fixture names are the ones the lock itself uses — "Smyrna Strong",
 * "500 Squats by Friday" — and every member beyond the signed-in one is a
 * membership document with no profile, no name and no activity. Nothing here
 * represents a real person.
 *
 * GATED. Set WSF_CAPTURE_FRAMES=1 to (re)produce the frames; an ordinary run
 * skips this file, because it asserts nothing the product suites do not
 * already cover and its only output is evidence a review has to open.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/north-star-final/board-01/captures');
const CAPTURE_FRAMES = process.env.WSF_CAPTURE_FRAMES === '1';

const PHONE = { width: 390, height: 844 };
const SHORT = { width: 390, height: 640 };

const DAY = 24 * 60 * 60_000;

test.skip(!CAPTURE_FRAMES, 'Board 01 captures are produced only on request (WSF_CAPTURE_FRAMES=1).');

type GoalDoc = {
  goalId: string;
  groupId: string;
  ownerUid: string;
  title: string;
  target: number;
  unit: string;
  total: number;
  status: 'active' | 'closed';
  startsAt: Date;
  endsAt: Date;
  /** The one-time crossing instant, when the total is at or past the target. */
  reachedAt?: Date;
  closedAt?: Date;
  ownCredit?: number;
};

async function seedGoalDoc(g: GoalDoc): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfGoals/${g.goalId}`, {
    ownerUid: { stringValue: g.ownerUid },
    communityGroupId: { stringValue: g.groupId },
    title: { stringValue: g.title },
    target: { integerValue: String(g.target) },
    unit: { stringValue: g.unit },
    status: { stringValue: g.status },
    startsAt: tsField(g.startsAt),
    endsAt: tsField(g.endsAt),
    ...(g.reachedAt ? { reachedAt: tsField(g.reachedAt) } : {}),
    ...(g.closedAt ? { closedAt: tsField(g.closedAt) } : {}),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(g.startsAt),
    updatedAt: tsField(now),
  });
  await seedShards(g.goalId, g.total);
  if (g.ownCredit != null) {
    await firestoreWrite(`wsfGoalMemberTotals/${g.goalId}_${g.ownerUid}`, {
      goalId: { stringValue: g.goalId },
      userId: { stringValue: g.ownerUid },
      total: { integerValue: String(g.ownCredit) },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }
}

type Scene = {
  key: string;
  displayName: string;
  role: 'foundingChampion' | 'member';
  /** Memberships beyond the signed-in member: documents only, nobody real. */
  extraMembers: number;
};

async function seedScene(s: Scene): Promise<{ uid: string; email: string; password: string; groupId: string }> {
  const stamp = stampId();
  const email = `wsf-ns01-${s.key}-${stamp}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `ns01${s.key}${stamp}`.replace(/-/g, '');
  // A member's community needs a Champion to exist; a fixture uid with no
  // account fills the seat when the signed-in member is not it.
  const members =
    s.role === 'foundingChampion'
      ? [{ uid, role: 'foundingChampion' as const }]
      : [{ uid: `champion-${groupId}`, role: 'foundingChampion' as const }, { uid, role: 'member' as const }];
  await seedCommunity({ groupId, displayName: s.displayName, joinPolicy: 'inviteOnly', members });
  const extra = s.role === 'foundingChampion' ? s.extraMembers : s.extraMembers - 1;
  await Promise.all(
    Array.from({ length: Math.max(0, extra) }, (_, i) => seedMembership(groupId, `fixture-${groupId}-${i}`, 'member'))
  );
  return { uid, email, password, groupId };
}

async function openHome(page: Page, groupId: string, name: string): Promise<void> {
  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community-name')).toHaveText(name, { timeout: 40_000 });
}

async function waitForProgress(page: Page, goalId: string): Promise<void> {
  await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toBeVisible({ timeout: 30_000 });
  // Fonts and the mark's images: a beat, so the frame is the settled screen.
  await page.waitForTimeout(900);
}

function frame(name: string): string {
  mkdirSync(OUT, { recursive: true });
  return path.join(OUT, name);
}

function note(name: string, facts: Record<string, unknown>): void {
  writeFileSync(
    frame(`${name}.json`),
    JSON.stringify({ note: 'Synthetic emulator fixture — not real members or activity.', ...facts }, null, 2)
  );
}

async function bring(page: Page, testID: string): Promise<void> {
  // React Native Web scrolls inside an element, not the document, so a
  // `fullPage` shot stops at the fold; the thing to show is brought on screen.
  await page.getByTestId(testID).evaluate((el) =>
    el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
  );
  await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// 390 × 844 — the primary phone
// ---------------------------------------------------------------------------

test.describe('Board 01 · 390x844', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  test('member · building 48.2% · then the same hero unavailable', async ({ page }) => {
    test.setTimeout(240_000);
    const s = await seedScene({ key: 'a', displayName: 'Smyrna Strong', role: 'member', extraMembers: 311 });
    const now = Date.now();
    const goalId = `${s.groupId}g`;
    await seedGoalDoc({
      goalId,
      groupId: s.groupId,
      ownerUid: s.uid,
      title: '500 Squats by Friday',
      target: 500,
      unit: 'squats',
      total: 241,
      status: 'active',
      startsAt: new Date(now - 4 * DAY),
      endsAt: new Date(now + 3 * DAY),
      ownCredit: 45,
    });
    await signInVia(page, s.email, s.password);
    await openHome(page, s.groupId, 'Smyrna Strong');
    await waitForProgress(page, goalId);

    await expect(page.getByTestId('wsf-community-hero-presence')).toHaveText(
      '312 members · moving together this week'
    );
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toHaveText('48.2% complete');
    await expect(page.getByTestId(`wsf-community-goal-status-${goalId}`)).toHaveText('259 to go');
    await expect(page.getByTestId(`wsf-community-goal-we-${goalId}`)).toHaveAttribute('data-fill-ratio', '0.4820');
    await expect(page.getByTestId('wsf-community-goal-eyebrow')).toHaveCount(0);
    // Both real journeys, as the lock requires: move now, or record what is done.
    await expect(page.getByTestId(`wsf-community-goal-link-${goalId}`)).toHaveText('Start moving');
    await expect(page.getByTestId(`wsf-community-goal-record-${goalId}`)).toHaveText('Already moved? Record squats');

    await page.screenshot({ path: frame('phone-member-building-390x844.png') });
    await page.getByTestId('wsf-community-goal-hero').screenshot({ path: frame('state-building.png') });
    note('phone-member-building-390x844', {
      groupId: s.groupId, goalId, total: 241, target: 500, members: 312, ownCredit: 45, viewport: PHONE,
    });

    // UNAVAILABLE: the pulse read fails, the goal list did not. The hero keeps
    // its title and says only what is true — the numbers could not be read.
    await page.route('**/wsfGoalPulse', (route: Route) => route.abort('failed'));
    await page.reload();
    await expect(page.getByTestId('wsf-community-name')).toHaveText('Smyrna Strong', { timeout: 40_000 });
    const error = page.getByTestId(`wsf-community-goal-progress-error-${goalId}`);
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText('Progress couldn’t be loaded just now.');
    await expect(page.getByTestId(`wsf-community-goal-progress-retry-${goalId}`)).toHaveText('Try again');
    await expect(page.getByTestId(`wsf-community-goal-we-${goalId}`)).toHaveCount(0);
    await page.waitForTimeout(600);
    await page.getByTestId('wsf-community-goal-hero').screenshot({ path: frame('state-unavailable.png') });
    await page.unroute('**/wsfGoalPulse');
  });

  test('member · a featured goal with a second goal also under way', async ({ page }) => {
    test.setTimeout(240_000);
    const s = await seedScene({ key: 'b', displayName: 'Smyrna Strong', role: 'member', extraMembers: 311 });
    const now = Date.now();
    const featured = `${s.groupId}f`;
    const second = `${s.groupId}s`;
    await seedGoalDoc({
      goalId: featured,
      groupId: s.groupId,
      ownerUid: s.uid,
      title: '500 Squats by Friday',
      target: 500,
      unit: 'squats',
      total: 241,
      status: 'active',
      startsAt: new Date(now - 4 * DAY),
      endsAt: new Date(now + 3 * DAY),
      ownCredit: 45,
    });
    await seedGoalDoc({
      goalId: second,
      groupId: s.groupId,
      ownerUid: s.uid,
      title: 'Minutes walked in September',
      target: 5000,
      unit: 'minutes',
      total: 1320,
      status: 'active',
      startsAt: new Date(now - 10 * DAY),
      endsAt: new Date(now + 40 * DAY),
    });
    await signInVia(page, s.email, s.password);
    await openHome(page, s.groupId, 'Smyrna Strong');
    await waitForProgress(page, featured);
    // Which goal is featured is decided by endsAt; pin it, so a swap cannot
    // pass as a picture of the right thing.
    await expect(page.locator('[data-testid^="wsf-community-goal-we-"]')).toHaveCount(1);
    await expect(page.getByTestId(`wsf-community-goal-we-${featured}`)).toHaveCount(1);
    await expect(page.getByTestId(`wsf-community-goal-card-${second}`)).toContainText('Also under way');
    await expect(page.getByTestId(`wsf-community-goal-total-${second}`)).toContainText('1,320 of 5,000 minutes');

    await bring(page, `wsf-community-goal-card-${second}`);
    await page.screenshot({ path: frame('phone-member-multiple-goals-390x844.png') });
    note('phone-member-multiple-goals-390x844', { groupId: s.groupId, featured, second, viewport: PHONE });
  });

  test('Champion · building, with the Manage entry', async ({ page }) => {
    test.setTimeout(240_000);
    const s = await seedScene({ key: 'c', displayName: 'Smyrna Strong', role: 'foundingChampion', extraMembers: 22 });
    const now = Date.now();
    const goalId = `${s.groupId}g`;
    await seedGoalDoc({
      goalId,
      groupId: s.groupId,
      ownerUid: s.uid,
      title: '500 Squats by Friday',
      target: 500,
      unit: 'squats',
      total: 241,
      status: 'active',
      startsAt: new Date(now - 4 * DAY),
      endsAt: new Date(now + 3 * DAY),
      ownCredit: 60,
    });
    await signInVia(page, s.email, s.password);
    await openHome(page, s.groupId, 'Smyrna Strong');
    await waitForProgress(page, goalId);
    await expect(page.getByTestId('wsf-community-hero-presence')).toHaveText('23 members · moving together this week');
    await expect(page.getByTestId('wsf-community-manage')).toBeVisible();
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toHaveText('48.2% complete');
    await page.screenshot({ path: frame('phone-champion-building-390x844.png') });
    note('phone-champion-building-390x844', { groupId: s.groupId, goalId, members: 23, role: 'foundingChampion', viewport: PHONE });
  });

  test('member · 0 of 500 · the mark is the brand, unfilled', async ({ page }) => {
    test.setTimeout(240_000);
    const s = await seedScene({ key: 'z', displayName: 'Smyrna Strong', role: 'member', extraMembers: 22 });
    const now = Date.now();
    const goalId = `${s.groupId}g`;
    await seedGoalDoc({
      goalId, groupId: s.groupId, ownerUid: s.uid, title: '500 Squats by Friday', target: 500, unit: 'squats',
      total: 0, status: 'active', startsAt: new Date(now - 1 * DAY), endsAt: new Date(now + 3 * DAY),
    });
    await signInVia(page, s.email, s.password);
    await openHome(page, s.groupId, 'Smyrna Strong');
    await waitForProgress(page, goalId);
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toHaveText('0% complete');
    await expect(page.getByTestId(`wsf-community-goal-status-${goalId}`)).toHaveText('500 to go');
    await expect(page.getByTestId(`wsf-community-goal-we-${goalId}`)).toHaveAttribute('data-fill-ratio', '0.0000');
    await page.getByTestId('wsf-community-goal-hero').screenshot({ path: frame('state-zero.png') });
    note('state-zero', { groupId: s.groupId, goalId, total: 0, target: 500 });
  });

  test('member · 461 of 500 · near the goal', async ({ page }) => {
    test.setTimeout(240_000);
    const s = await seedScene({ key: 'n', displayName: 'Smyrna Strong', role: 'member', extraMembers: 22 });
    const now = Date.now();
    const goalId = `${s.groupId}g`;
    await seedGoalDoc({
      goalId, groupId: s.groupId, ownerUid: s.uid, title: '500 Squats by Friday', target: 500, unit: 'squats',
      total: 461, status: 'active', startsAt: new Date(now - 4 * DAY), endsAt: new Date(now + 3 * DAY),
    });
    await signInVia(page, s.email, s.password);
    await openHome(page, s.groupId, 'Smyrna Strong');
    await waitForProgress(page, goalId);
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toHaveText('92.2% complete');
    await expect(page.getByTestId(`wsf-community-goal-status-${goalId}`)).toHaveText('Only 39 to go');
    await expect(page.getByTestId(`wsf-community-goal-we-${goalId}`)).toHaveAttribute('data-fill-ratio', '0.9220');
    await page.getByTestId('wsf-community-goal-hero').screenshot({ path: frame('state-near.png') });
    note('state-near', { groupId: s.groupId, goalId, total: 461, target: 500 });
  });

  test('member · 512 of 500 · reached and still open', async ({ page }) => {
    test.setTimeout(240_000);
    const s = await seedScene({ key: 'r', displayName: 'Smyrna Strong', role: 'member', extraMembers: 22 });
    const now = Date.now();
    const goalId = `${s.groupId}g`;
    await seedGoalDoc({
      goalId, groupId: s.groupId, ownerUid: s.uid, title: '500 Squats by Friday', target: 500, unit: 'squats',
      total: 512, status: 'active', startsAt: new Date(now - 4 * DAY), endsAt: new Date(now + 3 * DAY),
      reachedAt: new Date(now - 5 * 60 * 60_000), ownCredit: 95,
    });
    await signInVia(page, s.email, s.password);
    await openHome(page, s.groupId, 'Smyrna Strong');
    await waitForProgress(page, goalId);
    await expect(page.getByTestId('wsf-community-goal-eyebrow')).toHaveText('Goal reached');
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toHaveText('100% complete');
    await expect(page.getByTestId(`wsf-community-goal-status-${goalId}`)).toHaveText('12 beyond our goal · still open');
    await expect(page.getByTestId(`wsf-community-goal-reached-${goalId}`)).toBeVisible();
    await expect(page.getByTestId(`wsf-community-goal-we-${goalId}`)).toHaveAttribute('data-fill-ratio', '1.0000');
    // Still open, so both journeys are still offered.
    await expect(page.getByTestId(`wsf-community-goal-link-${goalId}`)).toHaveText('Start moving');
    await expect(page.getByTestId(`wsf-community-goal-record-${goalId}`)).toHaveText('Already moved? Record squats');
    await page.getByTestId('wsf-community-goal-hero').screenshot({ path: frame('state-reached-open.png') });
    note('state-reached-open', { groupId: s.groupId, goalId, total: 512, target: 500 });
  });

  test('member · no goal running, and the record of two closed ones', async ({ page }) => {
    test.setTimeout(240_000);
    const s = await seedScene({ key: 'h', displayName: 'Smyrna Strong', role: 'member', extraMembers: 22 });
    const now = Date.now();
    const reached = `${s.groupId}cr`;
    const short = `${s.groupId}cu`;
    await seedGoalDoc({
      goalId: reached, groupId: s.groupId, ownerUid: s.uid, title: 'August push-ups', target: 500, unit: 'push-ups',
      total: 515, status: 'closed', startsAt: new Date(now - 34 * DAY), endsAt: new Date(now - 20 * DAY),
      reachedAt: new Date(now - 21 * DAY), closedAt: new Date(now - 20 * DAY),
    });
    await seedGoalDoc({
      goalId: short, groupId: s.groupId, ownerUid: s.uid, title: 'July stairs', target: 400, unit: 'flights',
      total: 90, status: 'closed', startsAt: new Date(now - 64 * DAY), endsAt: new Date(now - 50 * DAY),
      closedAt: new Date(now - 50 * DAY),
    });
    await signInVia(page, s.email, s.password);
    await openHome(page, s.groupId, 'Smyrna Strong');
    const empty = page.getByTestId('wsf-community-no-goal');
    await expect(empty).toBeVisible({ timeout: 30_000 });
    await expect(empty).toContainText('No goal running yet');
    await expect(empty).toContainText('Your Champion can start one for this community.');
    await expect(page.getByTestId('wsf-community-start-goal')).toHaveCount(0);
    await expect(page.getByTestId(`wsf-community-goal-status-${reached}`)).toHaveText('Reached');
    await expect(page.getByTestId(`wsf-community-goal-total-${reached}`)).toHaveText('515 of 500 push-ups');
    await expect(page.getByTestId(`wsf-community-goal-status-${short}`)).toHaveText('Closed at 22.5%');
    await expect(page.getByTestId(`wsf-community-goal-total-${short}`)).toHaveText('90 of 400 flights');
    await page.waitForTimeout(600);
    await empty.screenshot({ path: frame('state-no-goal-member.png') });
    // Each row is brought to the middle of the screen first: a locator shot
    // of a row that sits under the floating MOVE control photographs the
    // control across the row's foot.
    await bring(page, `wsf-community-goal-closed-${reached}`);
    await page.getByTestId(`wsf-community-goal-closed-${reached}`).screenshot({ path: frame('state-closed-reached.png') });
    await bring(page, `wsf-community-goal-closed-${short}`);
    await page.getByTestId(`wsf-community-goal-closed-${short}`).screenshot({ path: frame('state-closed-unfinished.png') });
    note('state-history', { groupId: s.groupId, reached: { goalId: reached, total: 515, target: 500 }, short: { goalId: short, total: 90, target: 400 } });
  });

  test('Champion · no goal running, with the one action that is real', async ({ page }) => {
    test.setTimeout(240_000);
    const s = await seedScene({ key: 'e', displayName: 'Smyrna Strong', role: 'foundingChampion', extraMembers: 22 });
    await signInVia(page, s.email, s.password);
    await openHome(page, s.groupId, 'Smyrna Strong');
    const empty = page.getByTestId('wsf-community-no-goal');
    await expect(empty).toBeVisible({ timeout: 30_000 });
    await expect(empty).toContainText('No goal running yet');
    await expect(empty).toContainText('Start one and your community can begin contributing.');
    await expect(page.getByTestId('wsf-community-start-goal')).toBeVisible();
    await page.waitForTimeout(600);
    await empty.screenshot({ path: frame('state-no-goal-champion.png') });
  });
});

// ---------------------------------------------------------------------------
// 390 × 640 — the short phone, reached/open: its own composition per the lock
// ---------------------------------------------------------------------------

test.describe('Board 01 · 390x640', () => {
  test.use({ viewport: SHORT, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  test('member · reached and open on a short phone, first fold and the quiet second route', async ({ page }) => {
    test.setTimeout(240_000);
    const s = await seedScene({ key: 's', displayName: 'Smyrna Strong', role: 'member', extraMembers: 22 });
    const now = Date.now();
    const goalId = `${s.groupId}g`;
    await seedGoalDoc({
      goalId, groupId: s.groupId, ownerUid: s.uid, title: '500 Squats by Friday', target: 500, unit: 'squats',
      total: 512, status: 'active', startsAt: new Date(now - 4 * DAY), endsAt: new Date(now + 3 * DAY),
      reachedAt: new Date(now - 5 * 60 * 60_000), ownCredit: 95,
    });
    await signInVia(page, s.email, s.password);
    await openHome(page, s.groupId, 'Smyrna Strong');
    await waitForProgress(page, goalId);
    await expect(page.getByTestId('wsf-community-goal-eyebrow')).toHaveText('Goal reached');
    await expect(page.getByTestId(`wsf-community-goal-status-${goalId}`)).toHaveText('12 beyond our goal · still open');
    await page.screenshot({ path: frame('phone-short-reached-open-390x640.png') });
    // Lock item 8: the secondary route must survive on the short phone even
    // when it sits just under the first fold. Bring it up and show it.
    await bring(page, `wsf-community-goal-record-${goalId}`);
    await expect(page.getByTestId(`wsf-community-goal-record-${goalId}`)).toHaveText('Already moved? Record squats');
    await page.screenshot({ path: frame('phone-short-reached-open-390x640-actions.png') });
    note('phone-short-reached-open-390x640', { groupId: s.groupId, goalId, total: 512, target: 500, viewport: SHORT });
  });
});
