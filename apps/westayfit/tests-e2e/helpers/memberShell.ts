import { expect, type Page } from '@playwright/test';

/**
 * REACHING CHAMPION TOOLS AFTER THE TRIGGER MOVED INTO THE SHELL.
 *
 * Community Home used to draw its own chrome row holding one control, Manage.
 * Under the persistent member top bar that row was a second masthead — an
 * ordinary member paid for an empty one, a Champion paid 44px plus a gap for a
 * single control, and the goal hero fell outside the 220px product-area budget
 * on the Champion's view because of it. The Director ruled that the TRIGGER
 * moves into the bar's existing menu and the row goes.
 *
 * The sheet itself did not move, and neither did anything inside it: every
 * `wsf-community-manage-panel`, `-close` and `-scrim` locator is unchanged.
 * What changed is the two steps it takes to open it, which is what these
 * helpers hold so that nineteen specs do not each spell it out.
 *
 * EVERY LOCATOR HERE TAKES THE LAST MATCH, for the same reason the contribution
 * specs do: a static-export route that is re-pushed leaves the previous screen
 * mounted, so there can be two shells in the document and the live one is the
 * last. A bare `getByTestId` throws a strict-mode violation the moment that
 * happens, which is not a defect in the product and not what these helpers are
 * for.
 */

/** The menu row the community detail registers while a Champion is on it. */
export const MANAGE_MENU_ROW = 'wsf-member-topbar-menu-manage-community';
const MENU_BUTTON = 'wsf-member-topbar-menu-button';
const MENU_SHEET = 'wsf-member-topbar-menu';

/** Open the shell's menu. Idempotent: already-open stays open. */
export async function openShellMenu(page: Page): Promise<void> {
  if (await page.getByTestId(MENU_SHEET).last().isVisible().catch(() => false)) return;
  await page.getByTestId(MENU_BUTTON).last().click();
  await expect(page.getByTestId(MENU_SHEET).last()).toBeVisible({ timeout: 20_000 });
}

/** Close it again, leaving the page as it was found. */
export async function closeShellMenu(page: Page): Promise<void> {
  if (!(await page.getByTestId(MENU_SHEET).last().isVisible().catch(() => false))) return;
  await page.getByTestId(MENU_BUTTON).last().click();
  await expect(page.getByTestId(MENU_SHEET).last()).toBeHidden({ timeout: 20_000 });
}

/**
 * Open Champion tools the way a Champion now does: the shell's menu, then
 * Manage community. Returns once the sheet the row has always opened is up.
 */
export async function openMemberManage(page: Page): Promise<void> {
  await openShellMenu(page);
  await expect(page.getByTestId(MANAGE_MENU_ROW).last()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(MANAGE_MENU_ROW).last().click();
  await expect(page.getByTestId('wsf-community-manage-panel').last()).toBeVisible({
    timeout: 20_000,
  });
}

/**
 * Whether this person is being offered Champion tools at all, asked without
 * changing where they are: the menu is opened, read, and closed again.
 *
 * This is the assertion that used to be "the Manage control is not in the
 * document". It is the same claim — there is no way in from here — asked of
 * the place the way in now lives.
 */
export async function manageOffered(page: Page): Promise<boolean> {
  /*
    A SURFACE OUTSIDE THE MEMBER SHELL HAS NO WAY IN AT ALL. A signed-out
    visitor on an event screen, a kiosk, a station: none of them renders the
    bar, so there is no menu to open and nothing is offered. That is the
    answer, not a reason to wait 180 seconds for a bar that is never coming.
  */
  if ((await page.getByTestId(MENU_BUTTON).count()) === 0) return false;
  await openShellMenu(page);
  const offered = (await page.getByTestId(MANAGE_MENU_ROW).count()) > 0;
  await closeShellMenu(page);
  return offered;
}
