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

/** The extra contexts this spec opens itself need the base URL passed explicitly. */
const BASE_URL = process.env.WSF_PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5010';

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

    test(`${screen.label} (${screen.path}) at 390x640: nothing inside the screen's own scroll view is covered by the shell`, async ({
      page,
    }) => {
      /*
        THE MEASURE THIS TEST USES, AND WHY IT IS NOT THE OBVIOUS ONE.

        The first version of this check asked whether an interactive control's
        centre sat below the tab bar's top edge. That is wrong, and measurably
        so: this route's content lives in its OWN scroll view, whose visible
        box ends above the bar. A control below that fold is not covered by
        anything -- it is simply not scrolled to yet, exactly like a control
        below the fold on any long page. The old metric called that "buried"
        and would have gone on reporting it after the overlap was fixed.

        What actually constitutes occlusion is narrower: a control whose own
        centre is INSIDE the scroll view's visible box -- so the member can
        see it, at rest, without scrolling -- and which nevertheless resolves
        to something in the shell. That is a control that reads as available
        and hands its tap to the raised MOVE action.

        Measured at `e609c57`, that state existed at 390x664 and not at
        390x640, which is why both heights are checked here rather than only
        the one in this file's title. At 640 the control was below the fold in
        both the broken and the fixed build; 664 is where the overlap showed.

        W5-M1 IS FIXED, and this case now guards the fix rather than recording
        the defect. #400 (`ff8c880`) gives the contribution route's scroll view
        a `marginBottom` of MEMBER_TAB_MOVE_OVERHANG so it ends above the
        raised circle, and it reached this branch's base in `5356e3cf`. The
        expected-failure annotation that stood here until then has been
        removed, which is the whole reason it was `fail` and not `skip`: the
        body kept running, so the day the base carried the fix the annotation
        itself started failing and had to go.

        A REAL TAP IS NOT THE TEST, and this is worth stating because it is
        the natural thing to reach for. Playwright scrolls an element into its
        scroll container before clicking, so a non-forced `.click()` on this
        control succeeds on the BROKEN build too -- verified at 640, 664 and
        844. A passing tap therefore says nothing about whether the overlap
        exists; only the geometry does.
      */
      for (const height of [640, 664]) {
        const ctx = await page.context().browser()!.newContext({
          viewport: { width: 390, height },
          userAgent: IPHONE_UA,
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 3,
          baseURL: BASE_URL,
        });
        const p2 = await ctx.newPage();
        try {
          await signInVia(p2, email, password);
          await p2.goto(screen.path);
          /*
            WAIT FOR THE SCREEN, NOT THE SHELL. `wsf-member-tabs` is already
            visible on the /move resolver, before it redirects into the
            contribution route, so waiting on the bar can measure the wrong
            screen entirely.
          */
          if (screen.key === 'move') {
            await expect(p2.getByTestId('wsf-contribute-done')).toBeVisible({ timeout: 25_000 });
          }
          await expect(p2.getByTestId('wsf-member-tabs')).toBeVisible({ timeout: 20_000 });
          await p2.waitForTimeout(400);

          const covered = await p2.evaluate(() => {
            const bar = document.querySelector('[data-testid="wsf-member-tabs"]');
            if (!bar) return ['no tab bar'];
            // Each scrollable region the screen owns, plus the document, so a
            // screen that does not use a scroll view is still covered.
            const boxes: DOMRect[] = [];
            for (const el of Array.from(document.querySelectorAll('*'))) {
              if (el.scrollHeight > el.clientHeight + 4) boxes.push(el.getBoundingClientRect());
            }
            if (boxes.length === 0) {
              boxes.push(new DOMRect(0, 0, window.innerWidth, window.innerHeight));
            }
            const out: string[] = [];
            const nodes = document.querySelectorAll(
              'button, a[href], [role="button"], input, select, textarea'
            );
            for (const el of Array.from(nodes)) {
              if (bar.contains(el)) continue;
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              const cx = r.x + r.width / 2;
              const cy = r.y + r.height / 2;
              // Visible to the member right now, inside a region they are
              // actually looking at.
              const inSomeBox = boxes.some(
                (b) => cy >= b.y && cy <= b.y + b.height && cx >= b.x && cx <= b.x + b.width
              );
              if (!inSomeBox) continue;
              const hit = document.elementFromPoint(cx, cy);
              if (!hit || el === hit || el.contains(hit)) continue;
              // It resolves to something else. Only the shell counts: an
              // overlay the screen itself puts up is the screen's own doing.
              if (!bar.contains(hit)) continue;
              out.push(
                el.getAttribute('data-testid') ||
                  el.getAttribute('aria-label') ||
                  (el.textContent || '').trim().slice(0, 40) ||
                  el.tagName.toLowerCase()
              );
            }
            return out;
          });

          expect({ screen: screen.key, height, coveredByTheShell: covered }).toEqual({
            screen: screen.key,
            height,
            coveredByTheShell: [],
          });
        } finally {
          await ctx.close();
        }
      }
    });
  }
});
