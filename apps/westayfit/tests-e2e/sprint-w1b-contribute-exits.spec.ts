import { randomBytes } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import {
  firestoreWrite,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';

/**
 * EVERY "BACK TO COMMUNITY" ON THE CONTRIBUTION SCREEN RETURNS; NONE BUILDS A
 * COPY.
 *
 * Measured at app-shell `f2f901a`: an ordinary member who opened a
 * contribution from their mounted Community tab and pressed Back on the
 * RECEIPT got a second Community screen pushed over the original — two
 * instances in the document, the visible one not the one they left, and a
 * stray `?groupId=` in the address. The chrome Back already returned
 * correctly; the terminal exits were still plain links.
 *
 * What this file proves, per exit, is the property rather than a control
 * type: exactly ONE Community screen afterwards, and it is the instance the
 * member came from (a marker planted on its host node before leaving is on
 * the screen they see). The marker is asserted planted, and read on the
 * VISIBLE instance, so neither reading can pass by measuring nothing or by
 * finding the stale hidden copy.
 *
 * And the other half, so the fix cannot be "always pop": a member who
 * arrives at a contribution cold, with nothing beneath it, is sent to their
 * community and the contribution screen is not left in history.
 *
 * Kiosk sessions are out of scope by construction — every kiosk rest state
 * renders Finish, never these exits — and remain pinned by
 * sprint-w1b-kiosk-confinement.spec.ts.
 */

const DAY = 24 * 60 * 60_000;

type Fx = { email: string; password: string; groupId: string; goalId: string };

async function seed(tag: string, status: 'active' | 'closed' = 'active'): Promise<Fx> {
  const stamp = `${tag}${stampId()}`.replace(/-/g, '');
  const email = `wsf-w1b-exit-${stamp}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w1bx${stamp}`;
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: 'Maple Street Movers' },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') },
    createdByUserId: { stringValue: uid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(new Date(now.getTime() - 40 * DAY)),
    updatedAt: tsField(now),
  });
  await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: 'foundingChampion' },
    membershipStatus: { stringValue: 'active' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  const goalId = `${groupId}g`;
  await firestoreWrite(`wsfGoals/${goalId}`, {
    ownerUid: { stringValue: uid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: 'Squats together this week' },
    target: { integerValue: '500' },
    unit: { stringValue: 'squats' },
    status: { stringValue: status },
    startsAt: tsField(new Date(now.getTime() - 4 * DAY)),
    endsAt: tsField(new Date(now.getTime() + (status === 'closed' ? -1 : 3) * DAY)),
    repeatPolicy: { stringValue: 'multiple' },
    timezone: { stringValue: 'America/New_York' },
    aggregateDisplayAuthorized: { booleanValue: true },
    createdAt: tsField(new Date(now.getTime() - 4 * DAY)),
    updatedAt: tsField(now),
  });
  await seedShards(goalId, 241);
  return { email, password, groupId, goalId };
}

const context = (fx: Fx) => `wsf-community-goal-record-${fx.goalId}`;

/** Arrive from the mounted Community tab and mark the instance we leave. */
async function arriveFromCommunity(page: Page, fx: Fx): Promise<void> {
  await signInVia(page, fx.email, fx.password);
  await page.goto(`/community/${fx.groupId}`);
  const link = page.getByTestId(context(fx));
  await expect(link).toBeVisible({ timeout: 40_000 });
  const planted = await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return false;
    el.setAttribute('data-w1b-mounted', '1');
    return el.getAttribute('data-w1b-mounted') === '1';
  }, context(fx));
  expect(planted, 'the mount marker was planted on the tab we leave').toBe(true);
  await link.click();
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
}

async function communityReading(page: Page, fx: Fx) {
  return page.evaluate((id) => {
    const all = Array.from(document.querySelectorAll(`[data-testid="${id}"]`));
    const shown = all.find((el) => (el as HTMLElement).offsetParent !== null) ?? null;
    return {
      instances: all.length,
      visibleIsTheOneWeLeft: Boolean(shown && shown.getAttribute('data-w1b-mounted') === '1'),
    };
  }, context(fx));
}

/** Press this exit and prove it returned to the exact instance. */
async function expectReturnedToTheTabWeLeft(page: Page, fx: Fx, exit: string): Promise<void> {
  const back = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
  await expect(back, `${exit}: the member has a way back`).toBeVisible();
  await back.click();
  await expect(page.locator(`[data-testid="${context(fx)}"]:visible`).first()).toBeVisible({
    timeout: 40_000,
  });
  // Let a pushed copy finish mounting before counting, so a slow second
  // instance cannot be missed by reading too early.
  await page.waitForTimeout(800);
  const r = await communityReading(page, fx);
  expect(r.instances, `${exit}: Back built a second Community screen instead of returning`).toBe(1);
  expect(r.visibleIsTheOneWeLeft, `${exit}: the Community screen on show is not the one the member left`).toBe(true);
  expect(new URL(page.url()).pathname, `${exit}: the right community`).toBe(`/community/${fx.groupId}`);
}

test.describe('contribute exits · Back returns to the mounted tab', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  test('from the RECEIPT', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('r');
    await arriveFromCommunity(page, fx);
    await page.getByTestId('wsf-contribute-entry').fill('20');
    await page.getByTestId('wsf-contribute-review').click();
    await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 40_000 });
    await expectReturnedToTheTabWeLeft(page, fx, 'receipt');
  });

  test('from an UNRESOLVED attempt', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('u');
    await arriveFromCommunity(page, fx);
    // A transport failure: the attempt's outcome is unknown and its reminder
    // stays stored. Local injection only, labelled as such.
    await page.route('**/wsfContribute', (route) => route.abort('failed').catch(() => {}));
    await page.getByTestId('wsf-contribute-entry').fill('20');
    await page.getByTestId('wsf-contribute-review').click();
    await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
    await page.unroute('**/wsfContribute');
    await expectReturnedToTheTabWeLeft(page, fx, 'unresolved');
  });
});

test.describe('contribute exits · a cold arrival still gets its destination', () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

  test('closed goal opened directly: Back lands on the community, once, and leaves no contribute entry behind', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const fx = await seed('c', 'closed');
    await signInVia(page, fx.email, fx.password);
    await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}`);
    await expect(page.getByTestId('wsf-contribute-closed')).toBeVisible({ timeout: 40_000 });
    const before = await page.evaluate(() => history.length);
    await page.locator('[data-testid="wsf-contribute-back"]:visible').first().click();
    // Pathname, not the whole address: entering a tab-nested route from outside
    // its tab makes expo-router append `?groupId=` — W9's recorded §7 seam,
    // which exists with or without this change and is not this file's claim.
    await expect
      .poll(() => new URL(page.url()).pathname, { timeout: 40_000 })
      .toBe(`/community/${fx.groupId}`);
    await page.waitForTimeout(800);
    const instances = await page.locator('[data-testid^="wsf-community-"]').count();
    expect(instances, 'the community rendered').toBeGreaterThan(0);
    // `replace`, not push: the dead-end contribute screen is not a Back step.
    expect(await page.evaluate(() => history.length), 'a cold exit replaces rather than pushes').toBe(before);
  });
});
