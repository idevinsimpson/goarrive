import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

import { CAPTURE_FRAMES, saveFrame } from './helpers/capture';
import {
  IPHONE_UA,
  PROJECT_ID,
  firestoreWrite,
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';

/**
 * CURRENT-BUILD CAPTURES of the Champion's contextual Manage sheet, for
 * Board 07. Source is pinned: claude/wsf-app-shell 5356e3c.
 *
 * NOT a new page, not an acceptance, not hosted proof. Every frame is the
 * real sheet the product renders at `/community/[groupId]` behind the quiet
 * "Manage" control — no admin page was built and nothing is mocked UI. What
 * IS injected, and labelled as such in every filename and in the README, is
 * network and clipboard failure: a callable made to fail or to hang is the
 * only way to photograph an error state, and saying so is the difference
 * between evidence and a fabrication.
 *
 * WRITES ARE OPT-IN. `saveFrame` writes only under WSF_CAPTURE_FRAMES=1
 * (helpers/capture). Run ordinarily, this spec asserts every state and
 * writes nothing, so no routine run can regenerate the package.
 *
 * EVERY SHOT IS PRECEDED BY AN ASSERTION OF THE NAMED STATE. A screenshot of
 * the wrong state is worse than no screenshot, because it looks like proof.
 *
 * 390x844 is the primary class. 390x640 is shot only where reachability of
 * the sheet and its confirmations is the question, rather than multiplying
 * every case across every device.
 */

const OUT = path.resolve(
  __dirname,
  '../../../docs/design-target/review/champion-manage/after',
);

const PRIMARY = { width: 390, height: 844 } as const;
const SHORT = { width: 390, height: 640 } as const;

function callableUrl(name: string): string {
  return `http://127.0.0.1:5001/${PROJECT_ID}/us-central1/${name}`;
}

type Fx = { email: string; password: string; uid: string; groupId: string; goalIds: string[] };

async function seed(
  label: string,
  opts: { joinPolicy?: 'public' | 'inviteOnly' | 'private'; goals?: number } = {},
): Promise<Fx> {
  const stamp = stampId();
  const email = `cm.${label}.${stamp}@example.invalid`;
  const password = 'champion-manage-passw0rd';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, `Champion ${stamp}`);
  const groupId = `cm${label}_${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Harbor Walkers',
    joinPolicy: opts.joinPolicy ?? 'inviteOnly',
    members: [{ uid, role: 'foundingChampion' }],
  });
  const goalIds: string[] = [];
  for (let i = 0; i < (opts.goals ?? 0); i += 1) {
    const goalId = `cm${label}goal${i}_${stamp}`;
    await seedActiveGoal({
      goalId,
      groupId,
      ownerUid: uid,
      title: i === 0 ? 'Autumn squat challenge' : 'Morning walks',
      target: 30_000,
      unit: 'squats',
      total: 14_460,
    });
    await seedShards(goalId, 14_460);
    goalIds.push(goalId);
  }
  return { email, password, uid, groupId, goalIds };
}

/** Remove the stored join code, so the screen has no invite link to offer. */
async function clearJoinCode(groupId: string): Promise<void> {
  const url =
    `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents/wsfCommunityGroups/${groupId}` +
    `?updateMask.fieldPaths=joinCode`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: { joinCode: { stringValue: '' } } }),
  });
  if (!res.ok) throw new Error(`clearJoinCode ${groupId}: ${res.status} ${await res.text()}`);
}

async function openCommunity(page: Page, groupId: string): Promise<void> {
  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 25_000 });
}

/** Open the sheet through the real quiet control, as a Champion does. */
async function openManage(page: Page): Promise<void> {
  await expect(page.getByTestId('wsf-community-manage')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-community-manage').click();
  await expect(page.getByTestId('wsf-community-manage-panel')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wsf-manage-title')).toBeVisible();
}

/** The sheet panel itself, so a frame is the sheet rather than the page behind it. */
function sheet(page: Page) {
  return page.getByTestId('wsf-community-manage-panel');
}

/**
 * The quiet hierarchy the lock asks for, asserted rather than eyeballed: the
 * sheet names the member's OWN community, keeps Advanced last and labelled,
 * and carries NO Living WE — the mark is the shared-progress instrument and
 * belongs on the goal hero, not in a tools sheet.
 */
async function assertSheetInvariants(page: Page): Promise<void> {
  await expect(sheet(page).getByTestId('wsf-manage-story')).toBeVisible();
  await expect(sheet(page).getByTestId('wsf-manage-advanced')).toBeVisible();
  // No Living WE anywhere inside the sheet, at any state.
  expect(
    await sheet(page).locator('[data-testid*="living-we"], [data-testid*="wsf-we-"]').count(),
    'a Living WE appears inside the Manage sheet',
  ).toBe(0);
}

/**
 * Bring a section of the sheet into the frame.
 *
 * The sheet is a tall scroller capped at 88% of the viewport, so a shot of
 * the page shows its TOP and nothing else. Two states that differ only below
 * the fold then photograph identically — which is how the first run of this
 * spec produced a byte-identical `invite-not-ready` and `private-no-link`.
 * A frame that cannot show the difference it is evidence for is not evidence,
 * so the state's own section is scrolled into view before the shutter.
 */
async function scrollSheetTo(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).scrollIntoViewIfNeeded();
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 10_000 });
}

async function shoot(page: Page, name: string): Promise<void> {
  await saveFrame(page, path.join(OUT, `${name}.png`));
}

test.describe('Champion Manage sheet — current build captures', () => {
  test.describe('390x844', () => {
    test.use({
      viewport: PRIMARY,
      userAgent: IPHONE_UA,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    test('entry, goals loaded, and the sheet invariants', async ({ page }) => {
      test.setTimeout(120_000);
      const fx = await seed('entry', { goals: 2 });
      await signInVia(page, fx.email, fx.password);
      await openCommunity(page, fx.groupId);
      await openManage(page);
      await expect(sheet(page).getByTestId('wsf-manage-goals')).toBeVisible();
      await expect(sheet(page).getByText('A permission you grant per goal.')).toBeVisible();
      await assertSheetInvariants(page);
      await shoot(page, 'manage-entry-390x844');
    });

    test('goals still loading', async ({ page }) => {
      test.setTimeout(120_000);
      const fx = await seed('load', { goals: 1 });
      await signInVia(page, fx.email, fx.password);
      // INJECTED DELAY on wsfListGoals, held open so the loading state is a
      // real frame rather than a race won by luck.
      // Held in an object: a bare `let` assigned inside the executor is
      // narrowed to `never` by the compiler and cannot then be called.
      const gate: { release: () => void } = { release: () => {} };
      const held = new Promise<void>((r) => {
        gate.release = r;
      });
      await page.route(callableUrl('wsfListGoals'), async (route: Route) => {
        await held;
        // Best effort: by the time the gate opens the route may already have
        // been torn down, and that is not a failure of the thing under test.
        await route.continue().catch(() => {});
      });
      await openCommunity(page, fx.groupId);
      await openManage(page);
      await expect(sheet(page).getByText('Loading goals…')).toBeVisible({ timeout: 20_000 });
      await assertSheetInvariants(page);
      await shoot(page, 'manage-goals-loading-INJECTED-DELAY-390x844');
      gate.release();
      // The delay is the only injected thing: once released the real read
      // completes, which is also the proof the loading frame was a real
      // in-flight state and not a broken screen.
      await expect(sheet(page).getByText('A permission you grant per goal.')).toBeVisible({
        timeout: 30_000,
      });
      await page.unroute(callableUrl('wsfListGoals'));
    });

    test('the goal read failed', async ({ page }) => {
      test.setTimeout(120_000);
      const fx = await seed('gerr', { goals: 1 });
      await signInVia(page, fx.email, fx.password);
      // INJECTED NETWORK FAILURE on wsfListGoals.
      await page.route(callableUrl('wsfListGoals'), async (route: Route) => {
        await route.abort('failed');
      });
      await openCommunity(page, fx.groupId);
      await openManage(page);
      await expect(
        sheet(page).getByText('Goals could not be loaded, so there is nothing to manage yet.'),
      ).toBeVisible({ timeout: 25_000 });
      await assertSheetInvariants(page);
      await shoot(page, 'manage-goals-error-INJECTED-NETWORK-390x844');
      await page.unroute(callableUrl('wsfListGoals'));
    });

    test('no goals yet', async ({ page }) => {
      test.setTimeout(120_000);
      const fx = await seed('nogoal', { goals: 0 });
      await signInVia(page, fx.email, fx.password);
      await openCommunity(page, fx.groupId);
      await openManage(page);
      await expect(
        sheet(page).getByText('No goals yet. Close this and start one from the community page.'),
      ).toBeVisible({ timeout: 25_000 });
      await assertSheetInvariants(page);
      await shoot(page, 'manage-no-goals-390x844');
    });

    test('the invite link is not ready', async ({ page }) => {
      test.setTimeout(120_000);
      const fx = await seed('noinv', { goals: 1 });
      await clearJoinCode(fx.groupId);
      await signInVia(page, fx.email, fx.password);
      await openCommunity(page, fx.groupId);
      // The page card states it plainly; the sheet offers no link to reset.
      await expect(page.getByTestId('wsf-community-invite-pending')).toBeVisible({
        timeout: 25_000,
      });
      await shoot(page, 'page-invite-not-ready-390x844');
      await openManage(page);
      await assertSheetInvariants(page);
      // inviteOnly is link-joinable, so the subsection and its reset DO
      // render — there is simply no link behind them yet.
      await expect(sheet(page).getByTestId('wsf-community-invite-link')).toHaveCount(1);
      await scrollSheetTo(page, 'wsf-community-invite-link');
      await shoot(page, 'manage-invite-not-ready-390x844');
    });

    test('a private community offers no invite link at all', async ({ page }) => {
      test.setTimeout(120_000);
      const fx = await seed('priv', { joinPolicy: 'private', goals: 1 });
      await signInVia(page, fx.email, fx.password);
      await openCommunity(page, fx.groupId);
      await openManage(page);
      // The rule: a private community has no join link, so the whole
      // invite-link subsection and its reset are absent — not disabled.
      await expect(sheet(page).getByTestId('wsf-community-invite-link')).toHaveCount(0);
      await expect(sheet(page).getByTestId('wsf-community-reset')).toHaveCount(0);
      await assertSheetInvariants(page);
      // Framed on Members, which is where the invite-link subsection would
      // have been, so the frame shows the absence rather than the sheet top.
      await scrollSheetTo(page, 'wsf-manage-members');
      await shoot(page, 'manage-private-no-link-390x844');
    });

    test('copied, and copy failed', async ({ page, context }) => {
      test.setTimeout(120_000);
      const fx = await seed('copy', { goals: 1 });
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await signInVia(page, fx.email, fx.password);
      await openCommunity(page, fx.groupId);
      const copy = page.getByTestId('wsf-community-invite-copy');
      await expect(copy).toBeVisible({ timeout: 25_000 });
      await copy.click();
      await expect(copy).toHaveText('Copied', { timeout: 10_000 });
      await shoot(page, 'page-invite-copied-390x844');

      // INJECTED CLIPBOARD FAILURE: the write is made to reject, which is the
      // only way to reach the failure label. The label names the QR fallback.
      await page.reload();
      await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 25_000 });
      await page.evaluate(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: { writeText: () => Promise.reject(new Error('injected clipboard failure')) },
        });
      });
      const copy2 = page.getByTestId('wsf-community-invite-copy');
      await copy2.click();
      await expect(copy2).toHaveText('Copy failed — use the QR code', { timeout: 10_000 });
      await shoot(page, 'page-invite-copy-failed-INJECTED-CLIPBOARD-390x844');
    });

    test('resetting the invite link: confirming, then in flight', async ({ page }) => {
      test.setTimeout(120_000);
      const fx = await seed('reset', { goals: 1 });
      await signInVia(page, fx.email, fx.password);
      await openCommunity(page, fx.groupId);
      await openManage(page);

      // The confirmation the rule requires: a reset asks first, because the
      // consequence belongs to everyone holding the old link.
      await expect(sheet(page).getByTestId('wsf-community-reset')).toBeVisible({ timeout: 20_000 });
      await sheet(page).getByTestId('wsf-community-reset').click();
      await expect(sheet(page).getByTestId('wsf-community-reset-confirm')).toBeVisible();
      await expect(sheet(page).getByTestId('wsf-community-reset-confirm-yes')).toBeVisible();
      await expect(sheet(page).getByTestId('wsf-community-reset-cancel')).toBeVisible();
      await assertSheetInvariants(page);
      await shoot(page, 'manage-reset-confirming-390x844');

      // INJECTED DELAY on wsfResetJoinCode, held so "Creating a new link…" is
      // genuinely in flight when photographed.
      // Held in an object: a bare `let` assigned inside the executor is
      // narrowed to `never` by the compiler and cannot then be called.
      const gate: { release: () => void } = { release: () => {} };
      const held = new Promise<void>((r) => {
        gate.release = r;
      });
      await page.route(callableUrl('wsfResetJoinCode'), async (route: Route) => {
        await held;
        await route.continue().catch(() => {});
      });
      await sheet(page).getByTestId('wsf-community-reset-confirm-yes').click();
      await expect(sheet(page).getByTestId('wsf-community-reset')).toHaveText(
        'Creating a new link…',
        { timeout: 20_000 },
      );
      await shoot(page, 'manage-resetting-INJECTED-DELAY-390x844');
      gate.release();
      await expect(sheet(page).getByTestId('wsf-community-invite-reset-done')).toBeVisible({
        timeout: 30_000,
      });
      await shoot(page, 'manage-reset-done-390x844');
      await page.unroute(callableUrl('wsfResetJoinCode'));
    });

    test('leaving: the confirmation, and a failure that does not pretend', async ({ page }) => {
      test.setTimeout(120_000);
      const fx = await seed('leave', { goals: 1 });
      await signInVia(page, fx.email, fx.password);
      await openCommunity(page, fx.groupId);
      await openManage(page);

      const advanced = sheet(page).getByTestId('wsf-manage-advanced');
      await expect(advanced).toBeVisible();
      await expect(advanced.getByTestId('wsf-community-leave')).toBeVisible();
      await advanced.getByTestId('wsf-community-leave').click();
      await expect(sheet(page).getByTestId('wsf-community-leave-confirm')).toBeVisible();
      await expect(sheet(page).getByTestId('wsf-community-leave-confirm-yes')).toBeVisible();
      await expect(sheet(page).getByTestId('wsf-community-leave-cancel')).toBeVisible();
      await assertSheetInvariants(page);
      await shoot(page, 'manage-leave-confirming-390x844');

      // INJECTED NETWORK FAILURE on wsfLeaveCommunity. The member stays in the
      // community and is told so; nothing claims an irreversible departure.
      await page.route(callableUrl('wsfLeaveCommunity'), async (route: Route) => {
        await route.abort('failed');
      });
      await sheet(page).getByTestId('wsf-community-leave-confirm-yes').click();
      await expect(sheet(page).getByTestId('wsf-community-leave-error')).toBeVisible({
        timeout: 30_000,
      });
      await expect(sheet(page).getByTestId('wsf-community-leave-dismiss')).toBeVisible();
      await shoot(page, 'manage-leave-failed-INJECTED-NETWORK-390x844');
      await page.unroute(callableUrl('wsfLeaveCommunity'));
    });
  });

  /**
   * The short phone. Only the cases where reaching the sheet and its
   * confirmations is the question — the sheet is height-capped at 88% of the
   * viewport, so this is where a confirmation could fall out of reach.
   */
  test.describe('390x640', () => {
    test.use({
      viewport: SHORT,
      userAgent: IPHONE_UA,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    test('the sheet, the reset confirmation and the leave confirmation are all reachable', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const fx = await seed('short', { goals: 1 });
      await signInVia(page, fx.email, fx.password);
      await openCommunity(page, fx.groupId);
      await openManage(page);
      await assertSheetInvariants(page);
      await shoot(page, 'manage-entry-390x640');

      const reset = sheet(page).getByTestId('wsf-community-reset');
      await reset.scrollIntoViewIfNeeded();
      await expect(reset).toBeVisible({ timeout: 20_000 });
      await reset.click();
      const confirmYes = sheet(page).getByTestId('wsf-community-reset-confirm-yes');
      await confirmYes.scrollIntoViewIfNeeded();
      await expect(confirmYes).toBeVisible();
      // Reachable means a tap at its own centre reaches IT, not something over it.
      expect(await hitsItself(page, 'wsf-community-reset-confirm-yes')).toBe(true);
      await shoot(page, 'manage-reset-confirming-390x640');
      await sheet(page).getByTestId('wsf-community-reset-cancel').click();

      const leave = sheet(page).getByTestId('wsf-community-leave');
      await leave.scrollIntoViewIfNeeded();
      await expect(leave).toBeVisible();
      await leave.click();
      const leaveYes = sheet(page).getByTestId('wsf-community-leave-confirm-yes');
      await leaveYes.scrollIntoViewIfNeeded();
      await expect(leaveYes).toBeVisible();
      expect(await hitsItself(page, 'wsf-community-leave-confirm-yes')).toBe(true);
      await shoot(page, 'manage-leave-confirming-390x640');
    });
  });
});

/**
 * Does a tap at the control's own centre land on the control? `toBeVisible`
 * answers a different question — W5-M1 was a control that passed it while the
 * shell took its taps — so reachability is asserted by hit test.
 */
async function hitsItself(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(hit && (el === hit || el.contains(hit) || hit.contains(el)));
  }, testId);
}

test.afterAll(() => {
  if (!CAPTURE_FRAMES) {
    // Said once, so a reader of a green run knows why no frames appeared.
    // eslint-disable-next-line no-console
    console.log('[champion-manage] assertions ran; frames withheld (set WSF_CAPTURE_FRAMES=1).');
  }
});
