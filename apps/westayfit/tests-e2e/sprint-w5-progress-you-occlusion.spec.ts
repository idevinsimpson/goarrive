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
 * W5 INDEPENDENT QA — PROGRESS AND YOU, SHORT PHONES AND THE KEYBOARD.
 *
 * Sprint Round 1, W5 packet (#395 comment 5784436697). Added alongside the
 * existing specs; nothing here edits an existing test or any product file, and
 * it asserts no design opinion — only that a control the member can SEE can be
 * pressed, and that the keyboard can reach the same controls.
 *
 * WHY THESE TWO ROUTES. `app/activity.tsx` (Progress, `/activity`) and
 * `app/you.tsx` (You, `/you`) both still carry the end-padding pattern that
 * W5-M1 found wanting on the contribution route:
 *
 *   activity.tsx:112,253  paddingBottom: MEMBER_TAB_BAR_BODY +
 *                         MEMBER_TAB_MOVE_OVERHANG + safeArea.bottom + 16
 *   you.tsx:662           paddingBottom: MEMBER_TAB_BAR_BODY +
 *                         MEMBER_TAB_MOVE_OVERHANG
 *
 * Padding at the END of the content clears the last control once the member
 * has scrolled all the way down. It does nothing for the FIRST screenful,
 * because until then that padding is off screen — which is exactly how
 * W5-M1's control came to be visible and untappable. So this is a question,
 * not an accusation: the pattern is a reason to look, not evidence of a defect.
 *
 * THE MEASURE, corrected after W5-M1 (see
 * sprint-w5-short-phone-usability.spec.ts for the full reasoning):
 *
 *   · The scroll container is DISCOVERED, never assumed — `/activity` has a
 *     testID and `/you` does not, and the document element scrolls on neither.
 *   · A control counts as occluded only when its own centre is INSIDE that
 *     container's visible box — so the member can see it, at rest, without
 *     scrolling — and still resolves to the shell. Merely being below the fold
 *     is NOT occlusion; the earlier version of this check got that wrong and
 *     would have reported a fixed build as broken forever.
 *   · Checked at REST and at representative scroll positions, because the
 *     overlap band is fixed to the viewport while the content moves through it.
 *   · A real tap is NOT the proof. Playwright scrolls an element into its
 *     container before clicking, so a non-forced `.click()` succeeds on a
 *     BROKEN build too — measured on W5-M1 at 640, 664 and 844. Geometry
 *     decides; the tap is recorded as context only.
 */

const HEIGHTS = [640, 664, 844] as const;
const BASE_URL = process.env.WSF_PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5010';

type Route = { key: string; label: string; path: string; ready: string };

const ROUTES: readonly Route[] = [
  { key: 'activity', label: 'Progress', path: '/activity', ready: 'wsf-activity-title' },
  { key: 'you', label: 'You', path: '/you', ready: 'wsf-you-title' },
];

/**
 * Every element the member is actually looking through, discovered rather than
 * named. Falls back to the viewport so a route that uses no scroll view is
 * still covered rather than silently skipped.
 */
const SCROLL_BOXES = `(() => {
  const boxes = [];
  for (const el of Array.from(document.querySelectorAll('*'))) {
    if (el.scrollHeight > el.clientHeight + 4) boxes.push(el);
  }
  return boxes;
})()`;

async function occludedControls(page: Page): Promise<string[]> {
  return page.evaluate(`(() => {
    const bar = document.querySelector('[data-testid="wsf-member-tabs"]');
    if (!bar) return ['NO TAB BAR RENDERED'];
    const scrollers = ${SCROLL_BOXES};
    const boxes = scrollers.length
      ? scrollers.map((el) => el.getBoundingClientRect())
      : [new DOMRect(0, 0, window.innerWidth, window.innerHeight)];
    const out = [];
    const nodes = document.querySelectorAll(
      'button, a[href], [role="button"], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    for (const el of Array.from(nodes)) {
      if (bar.contains(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cx = r.x + r.width / 2;
      const cy = r.y + r.height / 2;
      const visibleNow = boxes.some(
        (b) => cy >= b.y && cy <= b.y + b.height && cx >= b.x && cx <= b.x + b.width
      );
      if (!visibleNow) continue;
      const hit = document.elementFromPoint(cx, cy);
      if (!hit || el === hit || el.contains(hit)) continue;
      if (!bar.contains(hit)) continue;
      const label =
        el.getAttribute('data-testid') ||
        el.getAttribute('aria-label') ||
        (el.textContent || '').trim().slice(0, 40) ||
        el.tagName.toLowerCase();
      out.push(label + ' -> ' + (hit.getAttribute('data-testid') || (hit.textContent || '').trim().slice(0, 24)));
    }
    return out;
  })()`) as Promise<string[]>;
}

async function scrollAllTo(page: Page, fraction: number): Promise<void> {
  await page.evaluate(`(() => {
    for (const el of ${SCROLL_BOXES}) {
      el.scrollTop = (el.scrollHeight - el.clientHeight) * ${fraction};
    }
  })()`);
  await page.waitForTimeout(250);
}

test.describe('W5 probe — Progress and You stay operable on short phones', () => {
  let email = '';
  const password = 'w5-probe-passw0rd';

  test.beforeEach(async ({ page }) => {
    const stamp = stampId();
    email = `w5.progressyou.${stamp}@example.invalid`;
    const uid = await seedVerifiedUser(email, password);
    await seedProfile(uid, `W5 Progress You ${stamp}`);
    const groupId = `w5py_${stamp}`;
    await seedCommunity({
      groupId,
      displayName: 'W5 progress/you community',
      joinPolicy: 'private',
      members: [{ uid, role: 'foundingChampion' }],
    });
    // Real content on both routes, so neither is an empty state that would
    // trivially fit any viewport.
    await seedActiveGoal({
      goalId: `w5pyg_${stamp}`,
      groupId,
      ownerUid: uid,
      title: 'W5 progress/you goal',
      target: 5000,
      unit: 'squats',
      total: 1200,
    });
    await signInVia(page, email, password);
  });

  for (const route of ROUTES) {
    test(`${route.label} (${route.path}): no control inside its scroll view is covered by the shell, at any height or scroll position`, async ({
      page,
    }) => {
      const found: Record<string, string[]> = {};
      for (const height of HEIGHTS) {
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
          await p2.goto(route.path);
          await expect(p2.getByTestId(route.ready)).toBeVisible({ timeout: 25_000 });
          await expect(p2.getByTestId('wsf-member-tabs')).toBeVisible({ timeout: 20_000 });
          await p2.waitForTimeout(400);

          // At rest, then through the content — the overlap band is fixed to
          // the viewport while the content moves past it.
          for (const [name, fraction] of [
            ['at-rest', 0],
            ['half', 0.5],
            ['end', 1],
          ] as const) {
            if (fraction > 0) await scrollAllTo(p2, fraction);
            const hits = await occludedControls(p2);
            if (hits.length) found[`${height}/${name}`] = hits;
          }
        } finally {
          await ctx.close();
        }
      }
      expect({ route: route.key, occluded: found }).toEqual({ route: route.key, occluded: {} });
    });

    test(`${route.label} (${route.path}): every keyboard-focusable control can be reached and is not covered once focused`, async ({
      page,
    }) => {
      /*
        THE KEYBOARD HALF. Tabbing moves focus and the browser scrolls the
        focused element into view, so the question is not "can focus get
        there" but "once it is there, is the control actually under the
        pointer" — a focused control sitting beneath the raised action is
        reachable by keyboard and dead to touch, which is worse than either
        alone because the two ways of driving the screen disagree.

        Checked at the shortest height only: it is the tightest case, and
        repeating the whole tab order at three heights is the kind of
        unchanged giant suite this packet was told not to re-run.
      */
      const ctx = await page.context().browser()!.newContext({
        viewport: { width: 390, height: 640 },
        userAgent: IPHONE_UA,
        deviceScaleFactor: 3,
        baseURL: BASE_URL,
      });
      const p2 = await ctx.newPage();
      try {
        await signInVia(p2, email, password);
        await p2.goto(route.path);
        await expect(p2.getByTestId(route.ready)).toBeVisible({ timeout: 25_000 });
        await expect(p2.getByTestId('wsf-member-tabs')).toBeVisible({ timeout: 20_000 });
        await p2.waitForTimeout(400);

        const seen: string[] = [];
        const covered: string[] = [];
        for (let i = 0; i < 40; i += 1) {
          await p2.keyboard.press('Tab');
          const info = await p2.evaluate(`(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            const bar = document.querySelector('[data-testid="wsf-member-tabs"]');
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return { label: 'zero-size', covered: false, inBar: false };
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
            const label =
              el.getAttribute('data-testid') ||
              el.getAttribute('aria-label') ||
              (el.textContent || '').trim().slice(0, 30) ||
              el.tagName.toLowerCase();
            const inBar = !!(bar && bar.contains(el));
            const coveredByShell = !!(hit && !(el === hit || el.contains(hit)) && bar && bar.contains(hit));
            return { label, covered: coveredByShell, inBar };
          })()`) as { label: string; covered: boolean; inBar: boolean } | null;
          if (!info) break;
          const key = `${info.label}${info.inBar ? ' (tab bar)' : ''}`;
          if (seen.includes(key) && seen.length > 2) break; // wrapped round
          seen.push(key);
          if (info.covered) covered.push(info.label);
        }

        // Focus must actually move — a route where Tab reaches nothing would
        // otherwise pass this vacuously.
        expect(seen.length, `Tab reached no focusable control on ${route.path}`).toBeGreaterThan(1);
        expect({ route: route.key, focusedButCoveredByShell: covered }).toEqual({
          route: route.key,
          focusedButCoveredByShell: [],
        });
      } finally {
        await ctx.close();
      }
    });
  }
});
