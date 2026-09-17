import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

/**
 * COMMUNITY HOME — phone-first visual checkpoint.
 *
 * Renders the real Community Home against the emulators at a phone viewport
 * (390 × 844, 2× scale) with SYNTHETIC fixture data seeded under the admin
 * bypass, and records what a member and a Champion actually see. It also
 * proves the Living WE presentation contract through the real data path
 * (shard counters → wsfGoalPulse → screen): for each of the approved static
 * states the printed percentage, the exact total, the status line and the
 * mark's fill ratio are read off the rendered page.
 *
 * Everything here is fixture data: community and goal names, totals and the
 * member's own credit are seeded for the capture and are not real members or
 * real activity.
 */

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const PROJECT_ID = 'demo-wsf-local';

const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts', 'ui-community-home');
const PHONE = { width: 390, height: 844 };

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
  const url =
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}` + `/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
  }
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
    // A goal runs for a fortnight before its end, whether that end is ahead
    // (open) or behind (closed).
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
  const groupId = `uiA-${tag}`;
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

async function snapViewport(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: false });
}

/**
 * The page scrolls inside its own ScrollView, so Playwright's fullPage option
 * (which grows the document) captures only the first screen. For the
 * full-length mobile capture the viewport is grown to the content height for
 * one shot and restored afterwards.
 */
async function snapFull(page: Page, name: string): Promise<void> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const contentHeight = await page.evaluate(() => {
    const s = findScroller();
    return s.scrollHeight;
    function findScroller(): Element {
      const all = Array.from(document.querySelectorAll('*'));
      const scroller = all.find((e) => {
        const cs = getComputedStyle(e);
        return (
          e.scrollHeight > e.clientHeight + 10 && (cs.overflowY === 'auto' || cs.overflowY === 'scroll')
        );
      });
      return scroller ?? document.scrollingElement!;
    }
  });
  await scrollTo(page, 0);
  await page.setViewportSize({ width: PHONE.width, height: Math.max(PHONE.height, contentHeight + 4) });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${name}.png`), fullPage: false });
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(300);
}

/** Scrolls whatever element actually scrolls so a given fraction of its content is above the fold. */
async function scrollTo(page: Page, fraction: number): Promise<void> {
  await page.evaluate((f) => {
    const all = Array.from(document.querySelectorAll('*'));
    const scroller =
      all.find((e) => {
        const cs = getComputedStyle(e);
        return (
          e.scrollHeight > e.clientHeight + 10 && (cs.overflowY === 'auto' || cs.overflowY === 'scroll')
        );
      }) ?? document.scrollingElement!;
    const max = scroller.scrollHeight - scroller.clientHeight;
    scroller.scrollTo({ top: Math.round(max * f), behavior: 'instant' as ScrollBehavior });
  }, fraction);
  await page.waitForTimeout(300);
}

async function waitForProgress(page: Page, goalId: string): Promise<void> {
  await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toBeVisible({
    timeout: 30_000,
  });
  // Let the mark settle: the first render has no previous confirmed state so
  // it draws in place, but give fonts and images a beat.
  await page.waitForTimeout(900);
}

test.use({
  viewport: PHONE,
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

test('Community Home at phone size — member view, Champion view, full page', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'uiA-password';
  const championEmail = `wsf-uiA-champ-${stamp}@example.com`;
  const memberEmail = `wsf-uiA-member-${stamp}@example.com`;
  const championUid = await seedVerifiedUser(championEmail, password);
  const memberUid = await seedVerifiedUser(memberEmail, password);
  await seedProfile(championUid, 'Fixture Champion');
  await seedProfile(memberUid, 'Fixture Member');

  const groupId = await seedCommunity(`home-${stamp}`, 'Maple Street Movers', [
    { uid: championUid, role: 'foundingChampion' },
    { uid: memberUid, role: 'member' },
  ]);

  const featured = `uiA-squats-${stamp}`;
  const second = `uiA-walk-${stamp}`;
  const closed = `uiA-closed-${stamp}`;
  await seedGoal(groupId, championUid, {
    goalId: featured,
    title: 'Squats together this week',
    target: 500,
    unit: 'squats',
    total: 241,
    status: 'active',
    endsInMs: 3 * 24 * 60 * 60_000 + 5 * 60 * 60_000,
    ownCredit: { uid: memberUid, total: 60 },
  });
  await seedGoal(groupId, championUid, {
    goalId: second,
    title: 'Minutes walked in September',
    target: 5000,
    unit: 'minutes',
    total: 35,
    status: 'active',
    endsInMs: 13 * 24 * 60 * 60_000,
  });
  await seedGoal(groupId, championUid, {
    goalId: closed,
    title: 'August push-ups',
    target: 500,
    unit: 'push-ups',
    total: 312,
    status: 'closed',
    endsInMs: -20 * 24 * 60 * 60_000,
    displayAuthorized: true,
  });

  // ---- member ---------------------------------------------------------------
  await signInVia(page, memberEmail, password);
  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community-wordmark')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-community-name')).toHaveText('Maple Street Movers');
  await waitForProgress(page, featured);

  // The contract, read off the screen.
  await expect(page.getByTestId(`wsf-community-goal-percent-${featured}`)).toHaveText('48.2% complete');
  await expect(page.getByTestId(`wsf-community-goal-total-${featured}`)).toContainText(
    '241 of 500 squats'
  );
  await expect(page.getByTestId(`wsf-community-goal-status-${featured}`)).toHaveText('259 to go');
  await expect(page.getByTestId(`wsf-community-goal-we-${featured}`)).toHaveAttribute(
    'data-fill-ratio',
    '0.4820'
  );
  await expect(page.getByTestId(`wsf-community-your-part-${featured}`)).toContainText(
    'You’ve added 60 squats'
  );
  await expect(page.getByTestId(`wsf-community-goal-link-${featured}`)).toBeVisible();
  await expect(page.getByTestId(`wsf-community-goal-record-${featured}`)).toBeVisible();
  // The second open goal prints its own honest number: 35 of 5,000 is 0.7%.
  await expect(page.getByTestId(`wsf-community-goal-percent-${second}`)).toHaveText('0.7% complete', {
    timeout: 30_000,
  });
  // Closed history is separate from reached, and separate from the open goal.
  await expect(page.getByTestId(`wsf-community-goal-closed-${closed}`)).toBeVisible();
  await expect(page.getByTestId(`wsf-community-goal-status-${closed}`)).toHaveText(
    'Closed at 62.4%',
    { timeout: 30_000 }
  );
  // No Champion tools for a member.
  await expect(page.getByTestId('wsf-community-manage')).toHaveCount(0);
  await expect(page.getByTestId('wsf-community-invite-reset')).toHaveCount(0);
  await expect(page.getByTestId('wsf-community-member-count')).toContainText('2 members');

  await scrollTo(page, 0);
  await snapViewport(page, 'member-01-top');
  await scrollTo(page, 0.45);
  await snapViewport(page, 'member-02-middle');
  await scrollTo(page, 1);
  await snapViewport(page, 'member-03-bottom');
  await scrollTo(page, 0);
  await snapFull(page, 'member-full-page');

  // ---- Champion, Manage panel open ------------------------------------------
  await page.context().clearCookies();
  await page.goto('/');
  await page.evaluate(() => {
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* ignore */
    }
    return new Promise<void>((resolve) => {
      const req = window.indexedDB.deleteDatabase('firebaseLocalStorageDb');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
  await signInVia(page, championEmail, password);
  await page.goto(`/community/${groupId}`);
  await waitForProgress(page, featured);
  const manage = page.getByTestId('wsf-community-manage');
  await expect(manage).toBeVisible();
  await expect(page.getByTestId('wsf-community-manage-panel')).toHaveCount(0);
  await scrollTo(page, 0);
  await snapViewport(page, 'champion-01-top-manage-closed');
  await manage.click();
  await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible();
  await expect(page.getByTestId(`wsf-goal-display-auth-toggle-${featured}`)).toBeVisible();
  await expect(page.getByTestId(`wsf-goal-display-auth-toggle-${closed}`)).toBeVisible();
  await page.waitForTimeout(300);
  await snapViewport(page, 'champion-02-top-manage-open');
  await snapFull(page, 'champion-full-page-manage-open');

  writeFileSync(
    path.join(ARTIFACTS_DIR, 'fixture.json'),
    JSON.stringify(
      {
        note: 'Synthetic emulator fixture — not real members or activity.',
        groupId,
        goals: { featured, second, closed },
        viewport: PHONE,
        deviceScaleFactor: 2,
      },
      null,
      2
    )
  );
});

const STATES: Array<{
  key: string;
  total: number;
  target: number;
  percent: string;
  status: string;
  ratio: string;
}> = [
  { key: '0-of-500', total: 0, target: 500, percent: '0%', status: '500 to go', ratio: '0.0000' },
  { key: '241-of-500', total: 241, target: 500, percent: '48.2%', status: '259 to go', ratio: '0.4820' },
  { key: '261-of-500', total: 261, target: 500, percent: '52.2%', status: '239 to go', ratio: '0.5220' },
  { key: '450-of-500', total: 450, target: 500, percent: '90.0%', status: 'Only 50 to go', ratio: '0.9000' },
  { key: '4999-of-5000', total: 4999, target: 5000, percent: '99.9%', status: 'Only 1 to go', ratio: '0.9998' },
  { key: '500-of-500', total: 500, target: 500, percent: '100%', status: 'Goal reached · still open', ratio: '1.0000' },
];

test('Living WE static states through the real data path', async ({ page }) => {
  test.setTimeout(300_000);
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const password = 'uiA-password';
  const email = `wsf-uiA-states-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Fixture Champion');

  // One community per state so each hero card shows exactly one goal.
  const groups: Array<{ groupId: string; goalId: string; state: (typeof STATES)[number] }> = [];
  for (const state of STATES) {
    const groupId = await seedCommunity(`we-${state.key}-${stamp}`, `WE state ${state.key}`, [
      { uid, role: 'foundingChampion' },
    ]);
    const goalId = `uiA-we-${state.key}-${stamp}`;
    await seedGoal(groupId, uid, {
      goalId,
      title: `Fixture goal ${state.total} of ${state.target}`,
      target: state.target,
      unit: 'squats',
      total: state.total,
      status: 'active',
      endsInMs: 2 * 24 * 60 * 60_000,
    });
    groups.push({ groupId, goalId, state });
  }

  await signInVia(page, email, password);
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const measured: Record<string, unknown>[] = [];
  for (const { groupId, goalId, state } of groups) {
    await page.goto(`/community/${groupId}`);
    await waitForProgress(page, goalId);
    await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toHaveText(`${state.percent} complete`);
    await expect(page.getByTestId(`wsf-community-goal-total-${goalId}`)).toContainText(
      `${state.total.toLocaleString('en-US')} of ${state.target.toLocaleString('en-US')} squats`
    );
    await expect(page.getByTestId(`wsf-community-goal-status-${goalId}`)).toHaveText(state.status);
    const we = page.getByTestId(`wsf-community-goal-we-${goalId}`);
    await expect(we).toHaveAttribute('data-fill-ratio', state.ratio);
    await expect(we).toHaveAttribute(
      'aria-label',
      `${state.total.toLocaleString('en-US')} of ${state.target.toLocaleString('en-US')} squats, ${state.percent} filled`
    );
    await page.getByTestId('wsf-community-goal-hero').screenshot({
      path: path.join(ARTIFACTS_DIR, `we-state-${state.key}-hero.png`),
    });
    await we.screenshot({ path: path.join(ARTIFACTS_DIR, `we-state-${state.key}-mark.png`) });
    measured.push({ ...state, goalId, groupId });
  }
  writeFileSync(
    path.join(ARTIFACTS_DIR, 'we-states.json'),
    JSON.stringify({ note: 'Synthetic emulator fixture.', states: measured }, null, 2)
  );
});
