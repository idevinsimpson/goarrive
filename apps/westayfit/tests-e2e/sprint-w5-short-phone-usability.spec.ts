import { expect, test, type Page } from '@playwright/test';

import {
  IPHONE_UA,
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W5 INDEPENDENT QA — THE SHORT PHONE. 390x640, Home / MOVE / You.
 *
 * Sprint Round 1, W5 packet (PR #365 comment 5781435779). Added alongside the
 * existing specs; nothing here edits or weakens an existing test, and it
 * asserts no design opinion — only that the shipped design remains OPERABLE
 * when the viewport is shorter than any context currently covered.
 *
 * WHY 390x640 SPECIFICALLY. `helpers/mobile.ts` already covers 390x844,
 * 390x664 and 360x800. 640 is 24px shorter than the shortest of those, and it
 * is the height a 390-wide phone actually presents once the browser's own
 * chrome is on screen. Every layout in this app reserves room for persistent
 * bottom chrome, so the height is the dimension where reserving it can stop
 * fitting — and the failure mode is silent: a control that is merely
 * UNDERNEATH the bar still renders, still passes a visibility check, and
 * cannot be tapped.
 *
 * WHAT IT ASSERTS, per screen:
 *
 *   1. NO HORIZONTAL OVERFLOW. A vertical squeeze that pushes content sideways
 *      is the commonest short-viewport regression, and side-scrolling a phone
 *      layout is a defect on any screen it happens on.
 *   2. THE TAB BAR IS WHOLLY ON SCREEN. Not "visible" — `toBeVisible` passes
 *      for an element whose lower half is past the fold. The bar's bottom edge
 *      must be inside the viewport.
 *   3. EVERY TAB IS A REAL TARGET. `MemberTabBar` documents a 48px minimum
 *      (`tab.minHeight`); this checks the rendered box against the 44px floor
 *      below which a touch target is not reliably hittable, and checks it for
 *      each tab rather than for the bar as a whole.
 *   4. THE RAISED MOVE ACTION IS NOT CLIPPED. It rises 24px above the bar
 *      (`MEMBER_TAB_MOVE_OVERHANG`), so it is the one control whose top can
 *      leave the bar's own box.
 *   5. NOTHING THE SCREEN OWNS HIDES UNDER THE BAR UNREACHABLY. The page is
 *      scrolled to its end and the bar's top edge is compared against what
 *      remains below it.
 *
 * WHAT IT DELIBERATELY DOES NOT ASSERT. Nothing about spacing, colour,
 * hierarchy or copy: those are settled design, and reopening them from a test
 * would be preference wearing a regression's clothes.
 */

const VIEWPORT = { width: 390, height: 640 } as const;

/** The floor below which a touch target is not reliably hittable. */
const MIN_TAP_PX = 44;

type Screen = { key: string; label: string; path: string };

const SCREENS: readonly Screen[] = [
  { key: 'home', label: 'Home', path: '/' },
  { key: 'move', label: 'MOVE', path: '/move' },
  { key: 'you', label: 'You', path: '/you' },
];

async function horizontalOverflowPx(page: Page): Promise<number> {
  return page.evaluate(() => {
    const d = document.documentElement;
    // The widest of the two, because a fixed-position child can overflow the
    // documentElement without widening the body.
    const widest = Math.max(d.scrollWidth, document.body.scrollWidth);
    return Math.round(widest - d.clientWidth);
  });
}

async function scrollToEnd(page: Page): Promise<void> {
  await page.evaluate(() => {
    const targets: Element[] = [document.scrollingElement ?? document.documentElement];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (el.scrollHeight > el.clientHeight + 4) targets.push(el);
    }
    for (const t of targets) t.scrollTop = t.scrollHeight;
  });
  await page.waitForTimeout(250);
}

test.describe('W5 probe — 390x640 short phone stays operable', () => {
  test.use({
    viewport: VIEWPORT,
    userAgent: IPHONE_UA,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });

  let email = '';
  const password = 'w5-probe-passw0rd';

  test.beforeEach(async ({ page }) => {
    const stamp = stampId();
    email = `w5.shortphone.${stamp}@example.invalid`;
    const uid = await seedVerifiedUser(email, password);
    await seedProfile(uid, `W5 Short Phone ${stamp}`);
    const groupId = `w5sp_${stamp}`;
    await seedCommunity({
      groupId,
      displayName: 'W5 short-phone community',
      joinPolicy: 'private',
      members: [{ uid, role: 'foundingChampion' }],
    });
    // A real active goal, so MOVE has something to render rather than an
    // empty state that would trivially fit any viewport.
    await seedActiveGoal({
      goalId: `w5spgoal_${stamp}`,
      groupId,
      ownerUid: uid,
      title: 'W5 short-phone goal',
      target: 5000,
      unit: 'squats',
      total: 1200,
    });
    // The user is seeded already verified and already profiled, so sign-in
    // lands on the member home directly; there is no verify gate to clear.
    await signInVia(page, email, password);
  });

  for (const screen of SCREENS) {
    test(`${screen.label} (${screen.path}) at 390x640: no sideways scroll, tab bar wholly on screen, every tab tappable`, async ({
      page,
    }) => {
      await page.goto(screen.path);
      const bar = page.getByTestId('wsf-member-tabs');
      await expect(bar).toBeVisible({ timeout: 20_000 });

      // 1. No horizontal overflow. 1px of rounding is not a defect.
      const overflow = await horizontalOverflowPx(page);
      expect({ screen: screen.key, horizontalOverflowPx: overflow }).toEqual({
        screen: screen.key,
        horizontalOverflowPx: expect.any(Number),
      });
      expect(overflow).toBeLessThanOrEqual(1);

      // 2. The bar's whole box is inside the viewport.
      const barBox = await bar.boundingBox();
      expect(barBox).not.toBeNull();
      if (!barBox) return;
      expect(Math.round(barBox.y + barBox.height)).toBeLessThanOrEqual(VIEWPORT.height + 1);

      // 3. Every tab is a real target, measured per tab.
      const tooSmall: Record<string, number> = {};
      for (const key of ['home', 'community', 'activity', 'you']) {
        const tab = page.getByTestId(`wsf-member-tab-${key}`);
        await expect(tab).toBeVisible();
        const box = await tab.boundingBox();
        if (!box) {
          tooSmall[key] = 0;
          continue;
        }
        if (box.height < MIN_TAP_PX) tooSmall[key] = Math.round(box.height);
        // And wholly on screen, not merely rendered.
        expect(Math.round(box.y + box.height)).toBeLessThanOrEqual(VIEWPORT.height + 1);
      }
      expect({ screen: screen.key, tabsBelowMinTapTarget: tooSmall }).toEqual({
        screen: screen.key,
        tabsBelowMinTapTarget: {},
      });

      // 4. The raised MOVE action is not clipped at either edge.
      const move = page.getByTestId('wsf-member-tab-move');
      await expect(move).toBeVisible();
      const moveBox = await move.boundingBox();
      expect(moveBox).not.toBeNull();
      if (!moveBox) return;
      expect(Math.round(moveBox.y)).toBeGreaterThanOrEqual(-1);
      expect(Math.round(moveBox.y + moveBox.height)).toBeLessThanOrEqual(VIEWPORT.height + 1);
      expect(Math.round(moveBox.x)).toBeGreaterThanOrEqual(-1);
      expect(Math.round(moveBox.x + moveBox.width)).toBeLessThanOrEqual(VIEWPORT.width + 1);
    });

    test(`${screen.label} (${screen.path}) at 390x640: scrolled to the end, the tab bar still does not swallow the last control`, async ({
      page,
    }) => {
      /*
        THE SILENT FAILURE. A screen whose content ends at its own padding puts
        its last control under persistent chrome: it renders, it is "visible",
        and it cannot be tapped. Scrolling to the very end first is what makes
        the check meaningful — before that, the last control is off-screen for
        an ordinary reason.
      */
      if (screen.key === 'move') {
        /*
          KNOWN, MEASURED, AND EXPECTED TO FAIL — W5 finding, 2026-09-22, at
          claude/wsf-app-shell e609c57.

          On /move the secondary control `wsf-contribute-skip-timer` ("Skip
          timer and enter <unit>") sits under the raised MOVE action, which
          overhangs the bar by MEMBER_TAB_MOVE_OVERHANG (24px). Measured with
          document.elementFromPoint at the control's own centre:

            390x844  centre hits the control itself          - reachable
            390x664  centre hits `wsf-member-tab-move`       - NOT reachable
            390x640  centre hits the raised MOVE action      - NOT reachable

          The screen does not scroll at any of the three heights
          (scrollHeight === clientHeight), so nothing can bring it clear.

          It is marked `fail` rather than skipped, and that distinction is the
          point: the body still runs, so when the occlusion is fixed this
          annotation starts failing with "expected to fail but passed" and has
          to be removed. A skip would go quiet instead, and the finding would
          rot.

          Severity LOW, and only because the PRIMARY control immediately above
          it -- `wsf-contribute-done` -- calls the very same `onDoneMoving`
          handler, is hittable at all three heights, and was driven by a real
          click at each of them, reaching the entry screen every time. Nobody
          is blocked from recording. What is wrong is a control that reads as
          available and cannot be pressed.
        */
        test.fail();
      }
      await page.goto(screen.path);
      await expect(page.getByTestId('wsf-member-tabs')).toBeVisible({ timeout: 20_000 });
      await scrollToEnd(page);

      const bar = page.getByTestId('wsf-member-tabs');
      const barBox = await bar.boundingBox();
      expect(barBox).not.toBeNull();
      if (!barBox) return;

      // Any interactive element whose centre sits under the bar's top edge is
      // unreachable at this viewport. The bar's own controls are excluded —
      // they are the chrome, not what it is covering.
      const buried = await page.evaluate((barTop: number) => {
        const out: string[] = [];
        const bar = document.querySelector('[data-testid="wsf-member-tabs"]');
        const nodes = document.querySelectorAll(
          'button, a[href], [role="button"], input, select, textarea'
        );
        for (const el of Array.from(nodes)) {
          if (bar && bar.contains(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          const centreY = r.y + r.height / 2;
          // Only things that are on screen at all; something scrolled far
          // below the fold is not "buried", it is simply not here yet.
          if (centreY <= 0 || r.y > window.innerHeight) continue;
          if (centreY > barTop) {
            const label =
              el.getAttribute('data-testid') ||
              el.getAttribute('aria-label') ||
              (el.textContent || '').trim().slice(0, 40) ||
              el.tagName.toLowerCase();
            out.push(label);
          }
        }
        return out;
      }, barBox.y);

      expect({ screen: screen.key, controlsUnderTheTabBar: buried }).toEqual({
        screen: screen.key,
        controlsUnderTheTabBar: [],
      });
    });
  }
});
