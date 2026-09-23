import { expect, test, type Page } from '@playwright/test';

import {
  MANAGE_MENU_ROW,
  closeShellMenu,
  manageOffered,
  openMemberManage,
  openShellMenu,
} from './helpers/memberShell';
import {
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W9 — CHAMPION TOOLS, RELOCATED INTO THE PERSISTENT MENU.
 *
 * THE RULING THIS GUARDS (`5795072805`). Community Home drew its own chrome
 * row holding one control, Manage. Under a persistent top bar that row is a
 * second masthead: a Champion paid 44px plus a 14px gap for it, and the goal
 * hero fell outside the 220px product-area budget because of it. The trigger
 * moves into the bar's existing menu; the row is deleted rather than left
 * reserving blank space; and the sheet itself — its state, its content, its
 * behaviour — does not move at all.
 *
 * THE DANGEROUS PART IS THE STALE ACTION, and it is the reason this file
 * exists rather than a line in another one. The tabs stay mounted on purpose,
 * so "the community screen is mounted" is not the same question as "the member
 * is looking at it". Without care, a Champion who opens their community and
 * then taps Progress would still be offered Manage — from a screen they are
 * not on, for a community they are not looking at. Every assertion below is
 * about that boundary: who is offered it, from where, and when it goes away.
 *
 * Everything seeded here is SYNTHETIC: no community, member or goal is real.
 */

const PHONE = { width: 390, height: 844 };
/** The global product-area budget the Champion view has to meet again. */
const TOP_BUDGET_PX = 220;

type Fixture = {
  email: string;
  password: string;
  uid: string;
  groupId: string;
  goalId: string;
};

async function seedMemberOf(
  role: 'foundingChampion' | 'member',
  tag: string,
): Promise<Fixture> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-manage-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, role === 'foundingChampion' ? 'Alex Rivera' : 'Sam Ortiz');
  const groupId = `w9manage-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role }],
  });
  const goalId = `w9managegoal-${stamp}`;
  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });
  return { email, password, uid, groupId, goalId };
}

async function openCommunity(page: Page, fx: Fixture): Promise<void> {
  await page.goto(`/community/${fx.groupId}`);
  await expect(page.getByTestId('wsf-community-goal-hero')).toBeVisible({ timeout: 40_000 });
}

test('a Champion is offered Manage in the shell menu, and it opens the sheet that did not move', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const fx = await seedMemberOf('foundingChampion', 'ch');
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
    await signInVia(page, fx.email, fx.password);
    await openCommunity(page, fx);

    // THE ROW IS GONE FROM THE PAGE. Not hidden, not empty — not there.
    expect(
      await page.getByTestId('wsf-community-manage').count(),
      'the page still draws its own Manage row',
    ).toBe(0);

    // THE WAY IN IS THE SHELL'S MENU, and it is a real touch target.
    await openShellMenu(page);
    const row = page.getByTestId(MANAGE_MENU_ROW).last();
    await expect(row, 'a Champion is offered Manage community').toBeVisible();
    await expect(row).toHaveText('Manage community');
    const rowBox = (await row.boundingBox())!;
    expect(rowBox.height, 'the menu row is at least 44px tall').toBeGreaterThanOrEqual(44);

    // The bar's own button stays a 44x44 target with the menu open.
    const button = (await page.getByTestId('wsf-member-topbar-menu-button').last().boundingBox())!;
    expect(button.width, 'the menu button is at least 44px wide').toBeGreaterThanOrEqual(44);
    expect(button.height, 'the menu button is at least 44px tall').toBeGreaterThanOrEqual(44);

    // Settings is still a utility entry in the same menu, not a fifth tab.
    await expect(
      page.getByTestId('wsf-member-topbar-menu-settings'),
      'Settings is still in the menu as a utility',
    ).toBeVisible();
    await closeShellMenu(page);

    /*
      AND IT OPENS THE SHEET THAT DID NOT MOVE. The panel, its title, its
      close, and a Champion-only control inside it: this is the same sheet the
      page's own row used to open, which is what makes this a relocation.
    */
    await openMemberManage(page);
    await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible();
    await expect(page.getByTestId('wsf-community-leave')).toBeVisible();
    await page.getByTestId('wsf-community-manage-close').click();
    await expect(page.getByTestId('wsf-community-manage-panel')).toHaveCount(0);

    /*
      THE BUDGET THE ROW COST. With the row gone the goal hero has to meet the
      ordinary 220px product-area budget on the CHAMPION's view — the view that
      could not meet it before — and meet it as a measurement rather than a
      race: the presence line is on screen when this is taken.
    */
    await expect(page.getByTestId('wsf-community-hero-presence')).toBeVisible();
    const hero = (await page.getByTestId('wsf-community-goal-hero').boundingBox())!;
    expect(
      Math.round(hero.y),
      `the Champion's goal hero starts within ${TOP_BUDGET_PX}px of the top of the product area`,
    ).toBeLessThanOrEqual(TOP_BUDGET_PX);
  } finally {
    await context.close();
  }
});

test('the action belongs to the screen the member is on, and to nobody else', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const champion = await seedMemberOf('foundingChampion', 'sc');
  const ordinary = await seedMemberOf('member', 'sm');
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const page = await context.newPage();
  try {
    await signInVia(page, champion.email, champion.password);
    await openCommunity(page, champion);
    expect(await manageOffered(page), 'a Champion on their community is offered Manage').toBe(true);

    /*
      SWITCHING TABS TAKES IT AWAY. This is the assertion the whole design is
      for: the community screen is STILL MOUNTED under the Progress tab — that
      is what makes coming back instant — so an action registered on mount
      rather than on focus would still be offered here, from a screen the
      member is not looking at.
    */
    await page.getByTestId('wsf-member-tab-activity').last().click();
    await expect(page.getByTestId('wsf-activity-title')).toBeVisible({ timeout: 30_000 });
    expect(
      await manageOffered(page),
      'Progress is offering Manage for a community screen the member is not on',
    ).toBe(false);

    // And coming back offers it again — it was withdrawn, not destroyed.
    await page.getByTestId('wsf-member-tab-home').last().click();
    await expect(page.getByTestId('wsf-community-goal-hero')).toBeVisible({ timeout: 30_000 });
    expect(await manageOffered(page), 'coming back to the community offers it again').toBe(true);

    /*
      LEAVING THE COMMUNITY TAKES IT AWAY TOO — a focused flow outside the tab
      tree has no shell at all, so there is nothing to offer from.
    */
    await page.goto(`/contribute/${champion.goalId}?groupId=${champion.groupId}&mode=record`);
    await expect(page.getByTestId('wsf-contribute-entry-screen').last()).toBeVisible({
      timeout: 30_000,
    });
    expect(
      await manageOffered(page),
      'the contribution flow is offering Champion tools',
    ).toBe(false);

    /*
      AND THE NEXT ACCOUNT DOES NOT INHERIT IT. Same device, same browser
      context: one person signs out, another signs in and opens their own
      community, where they are an ordinary member.
    */
    await page.goto('/');
    await openShellMenu(page);
    await page.getByTestId('wsf-member-topbar-menu-signout').click();
    // Signed out, the member shell is gone with the account — which is the
    // claim that matters here, and the one the signed-out home's own contents
    // are not needed to make.
    await expect(page.getByTestId('wsf-member-topbar')).toHaveCount(0, { timeout: 40_000 });

    await signInVia(page, ordinary.email, ordinary.password);
    await openCommunity(page, ordinary);
    expect(
      await manageOffered(page),
      'an ordinary member is offered Champion tools',
    ).toBe(false);
    expect(
      await page.getByTestId('wsf-community-manage').count(),
      'an ordinary member is shown a Manage control on the page',
    ).toBe(0);
  } finally {
    await context.close();
  }
});
