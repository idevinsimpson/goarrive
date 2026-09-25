import { expect, test, type Page, type Route } from '@playwright/test';

import {
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W9 — APP-FEEL-PARITY-1, CHECKPOINT 1 (L0 #477 `5834095137`; Director #365
 * `5834082617` §A).
 *
 * THE OWNER'S FINDINGS THIS CHECKPOINT ANSWERS, measured on staging `502b1e8`:
 *   · "MOVE feels like a new page." With ONE open goal, MOVE hands straight to
 *     the contribution flow, and that flow was an opaque root-stack page: the
 *     tab the member pressed MOVE from went `display: none` behind it. The sheet
 *     was only the resolver's working moment.
 *   · "A duplicate Home header in transit." Community Home's loading branch
 *     mounted `FormShell`, whose own wordmark and "Your community" heading sat
 *     under the persistent top bar's wordmark.
 *
 * The contract, against the reference (Lovable `e15b9fa0…` at frozen product
 * `a15a610e`: shell.tsx, move.tsx, ui.tsx `Sheet`, styles.css MOTION-FEEL-1):
 *   · MOVE's contribution steps run in a sheet over the tab the member was on;
 *     that tab stays mounted, visible and untouchable (inert) through
 *     instructions → count → review → receipt;
 *   · focus enters the sheet and stays in it; Close / Escape / scrim return to
 *     the exact tab, scroll and focus (MOVE), with no remount;
 *   · the sheet travels in (translateY, 240 ms) and out (180 ms); reduced
 *     motion gets no travel;
 *   · the outcome exits still go where they say, and a cold link, the page mode
 *     ("Already moved?") and kiosk keep today's page;
 *   · the loading state is the final composition with no second masthead.
 *
 * Everything seeded here is SYNTHETIC. Chromium, local emulators.
 */

const PASSWORD = 'Sup3rSecret!23';
const PHONE = { width: 390, height: 844 };
const SHORT = { width: 390, height: 640 };

type Fx = { email: string; uid: string; groupId: string; goalIds: string[] };

async function seed(tag: string, goals: number): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-afp-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9afp-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  const goalIds: string[] = [];
  for (let i = 0; i < goals; i += 1) {
    const goalId = `w9afpgoal${i}-${stamp}`;
    await seedActiveGoal({
      goalId,
      groupId,
      ownerUid: uid,
      title: i === 0 ? 'October Squat Challenge' : 'Lunchtime Laps',
      target: 5000,
      unit: i === 0 ? 'squats' : 'laps',
      total: 1847,
      endsAt: new Date(Date.now() + (7 + i) * 24 * 60 * 60_000),
    });
    goalIds.push(goalId);
  }
  return { email, uid, groupId, goalIds };
}

// ---- readings -----------------------------------------------------------------

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label}: ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

async function focusedId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body || el === document.documentElement) return 'body';
    const own = el.getAttribute('data-testid');
    if (own) return own;
    const near = el.closest('[data-testid]')?.getAttribute('data-testid');
    return `${el.tagName.toLowerCase()}${near ? ` in ${near}` : ''}`;
  });
}

/** Is any instance of this testID laid out AND painted (not display:none, not hidden)? */
async function painted(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    return Array.from(document.querySelectorAll(`[data-testid="${id}"]`)).some((n) => {
      const el = n as HTMLElement;
      if (el.getClientRects().length === 0) return false;
      for (let a: HTMLElement | null = el; a; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
      }
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight && r.width > 0 && r.height > 0;
    });
  }, testId);
}

async function scrollAbove(page: Page, testId: string): Promise<number | null> {
  return page.evaluate((id) => {
    const all = Array.from(document.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[];
    let el: HTMLElement | null = all.find((e) => e.getClientRects().length > 0) ?? all[0] ?? null;
    while (el) {
      if (el.scrollHeight > el.clientHeight + 1) return Math.round(el.scrollTop);
      el = el.parentElement;
    }
    return null;
  }, testId);
}

async function plantScroll(page: Page, testId: string, top: number): Promise<number | null> {
  await page.evaluate(
    ({ id, value }) => {
      const all = Array.from(document.querySelectorAll(`[data-testid="${id}"]`)) as HTMLElement[];
      let el: HTMLElement | null = all.find((e) => e.getClientRects().length > 0) ?? null;
      while (el) {
        if (el.scrollHeight > el.clientHeight + 1) {
          el.scrollTop = value;
          return;
        }
        el = el.parentElement;
      }
    },
    { id: testId, value: top },
  );
  await page.waitForTimeout(400);
  return scrollAbove(page, testId);
}

/** Marks the mounted instance of a screen, so a remount is detectable. */
async function plantMarker(page: Page, testId: string): Promise<void> {
  await page.evaluate((id) => {
    const el = Array.from(document.querySelectorAll(`[data-testid="${id}"]`)).find(
      (n) => (n as HTMLElement).getClientRects().length > 0,
    ) as HTMLElement | undefined;
    el?.setAttribute('data-w9-afp-marker', 'kept');
  }, testId);
}

async function markerKept(page: Page, testId: string): Promise<boolean> {
  return page.evaluate(
    (id) =>
      Array.from(document.querySelectorAll(`[data-testid="${id}"]`)).some(
        (n) => (n as HTMLElement).getAttribute('data-w9-afp-marker') === 'kept',
      ),
    testId,
  );
}

async function currentTab(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[data-testid^="wsf-member-tab-"][data-current="true"]')).find(
      (n) => (n as HTMLElement).getClientRects().length > 0,
    );
    return el?.getAttribute('data-testid') ?? null;
  });
}

/**
 * Tab through the page `n` times from wherever focus is. Returns every stop
 * that was NOT inside the element carrying `insideId`.
 */
async function tabStopsOutside(page: Page, insideId: string, n: number): Promise<string[]> {
  const outside: string[] = [];
  for (let i = 0; i < n; i += 1) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate((id) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return { inside: false, label: 'body' };
      const inside = Boolean(el.closest(`[data-testid="${id}"]`));
      const label =
        el.getAttribute('data-testid') ??
        `${el.tagName.toLowerCase()} in ${el.closest('[data-testid]')?.getAttribute('data-testid') ?? '?'}`;
      return { inside, label };
    }, insideId);
    if (!where.inside) outside.push(where.label);
  }
  return outside;
}

// ---- journeys -----------------------------------------------------------------

async function openHome(page: Page, fx: Fx): Promise<void> {
  await page.goto(`/community/${fx.groupId}`);
  await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
}

async function pressMove(page: Page): Promise<void> {
  const move = page.locator('[data-testid="wsf-member-tab-move"]:visible').first();
  await expect(move).toBeVisible({ timeout: 40_000 });
  await move.focus();
  await page.keyboard.press('Enter');
}

const SHEET = 'wsf-contribute-sheet';

test.describe('APP-FEEL-PARITY-1 · one-goal MOVE is a sheet over the mounted tab', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 1 });

  test('Home: the tab stays mounted and visible behind every step, untouchable, and Close returns exact scroll, focus and instance', async ({ page }) => {
    test.setTimeout(240_000);
    // The short phone, where one-goal Home is long enough to hold a real scroll.
    await page.setViewportSize(SHORT);
    const fx = await seed('h', 1);
    await signInVia(page, fx.email, PASSWORD);
    await openHome(page, fx);
    const planted = await plantScroll(page, 'wsf-community', 120);
    measure('Home · planted scroll', planted);
    expect(planted ?? 0, 'the planted scroll is not vacuous').toBeGreaterThan(40);
    await plantMarker(page, 'wsf-community');

    await pressMove(page);
    await expect(page.locator('[data-testid="wsf-contribute-move-screen"]:visible')).toBeVisible({ timeout: 40_000 });
    const onOpen = { sheet: await painted(page, SHEET), home: await painted(page, 'wsf-community') };
    measure('Home · MOVE open: sheet / Home painted behind', onOpen);
    expect(onOpen.sheet, 'the one-goal flow is presented as a sheet').toBe(true);
    expect(onOpen.home, 'the Home tab is still painted behind the sheet').toBe(true);

    // Focus entered the sheet, and the keyboard cannot leave it.
    await expect.poll(() => page.evaluate((id) => Boolean(document.activeElement?.closest(`[data-testid="${id}"]`)), SHEET), {
      timeout: 5_000,
      message: 'focus enters the sheet when it opens',
    }).toBe(true);
    const escaped = await tabStopsOutside(page, SHEET, 14);
    measure('Home · Tab stops outside the sheet', escaped);
    expect(escaped, 'Tab never reaches the covered tab or its bar').toEqual([]);

    // Count → review: the tab is still behind the sheet at each step.
    await page.locator(`[data-testid="${SHEET}"] [data-testid="wsf-contribute-skip-timer"]`).click();
    const entry = page.locator('[data-testid="wsf-contribute-entry"]:visible').first();
    await expect(entry).toBeVisible({ timeout: 20_000 });
    expect(await painted(page, 'wsf-community'), 'Home behind the count step').toBe(true);
    await entry.fill('12');
    await page.locator('[data-testid="wsf-contribute-review"]:visible').first().click();
    await expect(page.locator('[data-testid="wsf-contribute-review-screen"]:visible')).toBeVisible();
    expect(await painted(page, 'wsf-community'), 'Home behind the review step').toBe(true);

    // Close (a named control, not a destination) returns to the exact screen.
    const close = page.locator(`[data-testid="${SHEET}"] [data-testid="wsf-contribute-back"]`).first();
    await expect(close).toHaveAttribute('aria-label', 'Close');
    await close.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId(SHEET)).toHaveCount(0, { timeout: 8_000 });
    await page.waitForTimeout(400);
    const after = {
      focus: await focusedId(page),
      tab: await currentTab(page),
      scroll: await scrollAbove(page, 'wsf-community'),
      sameInstance: await markerKept(page, 'wsf-community'),
    };
    measure('Home · after Close', after);
    expect(after.tab).toBe('wsf-member-tab-home');
    expect(after.scroll, 'Home kept its scroll').toBe(planted);
    expect(after.sameInstance, 'the same mounted Home instance, not a rebuild').toBe(true);
    await expect.poll(() => focusedId(page), { timeout: 8_000 }).toBe('wsf-member-tab-move');
  });

  test('the receipt is in the sheet too, over the tab; “Back to community” still goes to the community', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('r', 1);
    await signInVia(page, fx.email, PASSWORD);
    await openHome(page, fx);
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(page.locator('[data-testid="wsf-you-identity"]:visible')).toBeVisible({ timeout: 40_000 });
    await plantMarker(page, 'wsf-you');

    await pressMove(page);
    await expect(page.locator('[data-testid="wsf-contribute-move-screen"]:visible')).toBeVisible({ timeout: 40_000 });
    expect(await painted(page, 'wsf-you'), 'You is painted behind the sheet').toBe(true);
    await page.locator(`[data-testid="${SHEET}"] [data-testid="wsf-contribute-skip-timer"]`).click();
    await page.locator('[data-testid="wsf-contribute-entry"]:visible').first().fill('20');
    await page.locator('[data-testid="wsf-contribute-review"]:visible').first().click();
    await page.locator('[data-testid="wsf-contribute-submit"]:visible').first().click();
    await expect(page.locator('[data-testid="wsf-contribute-receipt"]:visible')).toBeVisible({ timeout: 40_000 });
    const atReceipt = { sheet: await painted(page, SHEET), you: await painted(page, 'wsf-you') };
    measure('You · receipt: sheet / You painted behind', atReceipt);
    expect(atReceipt.sheet).toBe(true);
    expect(atReceipt.you, 'You is still painted behind the receipt').toBe(true);

    await page.locator(`[data-testid="${SHEET}"] [data-testid="wsf-contribute-back"]`).last().click();
    await expect(page).toHaveURL(new RegExp(`/community/${fx.groupId}`), { timeout: 20_000 });
    expect(await currentTab(page)).toBe('wsf-member-tab-home');
  });

  test('Escape and the scrim close the sheet back to the same tab', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('e', 1);
    await signInVia(page, fx.email, PASSWORD);
    await openHome(page, fx);
    await page.getByTestId('wsf-member-tab-community').last().click();
    await expect(page.locator('[data-testid="wsf-community-index-rows"]:visible')).toBeVisible({ timeout: 40_000 });

    await pressMove(page);
    await expect(page.locator(`[data-testid="${SHEET}"]:visible`)).toBeVisible({ timeout: 40_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId(SHEET)).toHaveCount(0, { timeout: 8_000 });
    expect(await currentTab(page)).toBe('wsf-member-tab-community');
    await expect.poll(() => focusedId(page), { timeout: 8_000 }).toBe('wsf-member-tab-move');

    await pressMove(page);
    await expect(page.locator(`[data-testid="${SHEET}"]:visible`)).toBeVisible({ timeout: 40_000 });
    await page.mouse.click(195, 40); // on the scrim, above the panel
    await expect(page.getByTestId(SHEET)).toHaveCount(0, { timeout: 8_000 });
    expect(await currentTab(page)).toBe('wsf-member-tab-community');
  });

  test('the sheet travels in and out; reduced motion gets none', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('m', 1);
    await signInVia(page, fx.email, PASSWORD);
    await openHome(page, fx);

    const sample = async (ms: number) =>
      page.evaluate(
        async ({ id, ms: dur }) => {
          const out: { t: number; y: number; o: number }[] = [];
          const t0 = performance.now();
          while (performance.now() - t0 < dur) {
            const el = document.querySelector(`[data-testid="${id}-panel"]`) as HTMLElement | null;
            if (el) {
              const cs = getComputedStyle(el);
              const m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform);
              out.push({ t: Math.round(performance.now() - t0), y: Math.round(m.m42 * 10) / 10, o: Number(cs.opacity) });
            }
            await new Promise((r) => requestAnimationFrame(r));
          }
          return out;
        },
        { id: SHEET, ms },
      );

    await pressMove(page);
    const entering = await sample(2500);
    const moved = entering.filter((s) => s.y > 0.5 || s.o < 0.99);
    measure('entry timeline (first 8 samples with the panel)', entering.slice(0, 8));
    expect(entering.length, 'the sheet appeared').toBeGreaterThan(0);
    expect(moved.length, 'the panel travels in rather than appearing').toBeGreaterThan(0);
    expect(entering[entering.length - 1], 'and comes to rest').toMatchObject({ y: 0, o: 1 });

    await page.locator(`[data-testid="${SHEET}"] [data-testid="wsf-contribute-back"]`).first().click();
    const leaving = await sample(600);
    measure('exit timeline', leaving);
    expect(leaving.some((s) => s.y > 0.5 || s.o < 0.99), 'the panel travels out').toBe(true);
    await expect(page.getByTestId(SHEET)).toHaveCount(0, { timeout: 8_000 });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await pressMove(page);
    const reduced = await sample(1500);
    measure('reduced-motion entry', reduced.slice(0, 4));
    expect(reduced.length).toBeGreaterThan(0);
    expect(reduced.filter((s) => s.y > 0.5 || s.o < 0.99), 'no travel under reduced motion').toEqual([]);
  });

  test('preserved: a cold one-goal link and “Already moved?” stay pages with their own Back; kiosk has no sheet', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('c', 1);
    await signInVia(page, fx.email, PASSWORD);

    await page.goto(`/contribute/${fx.goalIds[0]}?groupId=${fx.groupId}&mode=move`);
    await expect(page.locator('[data-testid="wsf-contribute-move-screen"]:visible')).toBeVisible({ timeout: 60_000 });
    expect(await page.getByTestId(SHEET).count(), 'cold: no sheet with nothing beneath it').toBe(0);
    await expect(page.locator('[data-testid="wsf-contribute-back"]:visible').first()).toHaveAttribute('aria-label', 'Back');

    await openHome(page, fx);
    await page.locator(`[data-testid="wsf-community-goal-record-${fx.goalIds[0]}"]:visible`).first().click();
    await expect(page.locator('[data-testid="wsf-contribute-entry-screen"]:visible')).toBeVisible({ timeout: 40_000 });
    expect(await page.getByTestId(SHEET).count(), '“Already moved?” is the page flow').toBe(0);

    await page.goto(`/contribute/${fx.goalIds[0]}?groupId=${fx.groupId}&mode=move&kiosk=1`);
    await expect(page.locator('[data-testid="wsf-contribute-move-screen"]:visible')).toBeVisible({ timeout: 60_000 });
    expect(await page.getByTestId(SHEET).count(), 'kiosk: no sheet').toBe(0);
  });

  test('several goals: the chosen goal opens in a sheet over the chooser, and Back returns to the choice', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('s', 2);
    await signInVia(page, fx.email, PASSWORD);
    await openHome(page, fx);
    await pressMove(page);
    await expect(page.locator('[data-testid="wsf-move-choose"]:visible')).toBeVisible({ timeout: 40_000 });
    const escaped = await tabStopsOutside(page, 'wsf-move-screen', 10);
    measure('chooser · Tab stops outside the MOVE sheet', escaped);
    expect(escaped, 'Tab never reaches the covered tab from the chooser').toEqual([]);

    const choice = `wsf-move-choose-${fx.goalIds[0]}`;
    await page.locator(`[data-testid="${choice}"]:visible`).first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`[data-testid="${SHEET}"]:visible`)).toBeVisible({ timeout: 40_000 });
    expect(await painted(page, 'wsf-community'), 'Home is painted behind').toBe(true);
    await page.locator(`[data-testid="${SHEET}"] [data-testid="wsf-contribute-back"]`).first().click();
    await expect(page.getByTestId(SHEET)).toHaveCount(0, { timeout: 8_000 });
    await expect.poll(() => focusedId(page), { timeout: 8_000 }).toBe(choice);
  });
});

test.describe('APP-FEEL-PARITY-1 · Community Home loading is the final composition', () => {
  for (const vp of [PHONE, SHORT]) {
    test(`${vp.width}x${vp.height}: no second masthead while the community resolves`, async ({ page }) => {
      test.setTimeout(240_000);
      await page.setViewportSize(vp);
      const fx = await seed(`l${vp.height}`, 1);
      await signInVia(page, fx.email, PASSWORD);
      // Hold the one callable Home's first render waits on, so the loading
      // state is observable. Labelled delay; the answer itself is real.
      let release: () => void = () => undefined;
      const held = new Promise<void>((r) => (release = r));
      await page.route('**/wsfMyCommunities', async (route: Route) => {
        await held;
        await route.continue();
      });
      await page.goto(`/community/${fx.groupId}`);
      await expect(page.locator('[data-testid="wsf-community-loading"]:visible')).toBeVisible({ timeout: 40_000 });
      // The owner's frame: signed in, the shell's top bar up, and the page
      // still waiting. (Before auth resolves there is no bar at all.)
      await expect(page.locator('[data-testid="wsf-member-topbar-wordmark"]:visible')).toBeVisible({ timeout: 40_000 });
      await expect(page.locator('[data-testid="wsf-community-loading"]:visible')).toBeVisible();
      const loading = await page.evaluate(() => {
        const vis = (n: Element) => (n as HTMLElement).getClientRects().length > 0;
        const wordmarks = Array.from(document.querySelectorAll('[data-testid$="wordmark"], [data-testid*="wordmark-"]'))
          .filter(vis)
          .map((n) => n.getAttribute('data-testid'));
        const h1s = Array.from(document.querySelectorAll('[role="heading"][aria-level="1"], h1'))
          .filter(vis)
          .map((n) => (n as HTMLElement).innerText.trim());
        return {
          wordmarks,
          formWordmark: Array.from(document.querySelectorAll('[data-testid="wsf-form-wordmark"]')).filter(vis).length,
          h1s,
          loadingText: (document.querySelector('[data-testid="wsf-community-loading"]') as HTMLElement | null)?.innerText ?? '',
        };
      });
      measure(`${vp.height} · loading`, loading);
      expect(loading.formWordmark, 'no FormShell wordmark under the top bar').toBe(0);
      expect(loading.wordmarks, 'the top bar’s wordmark is on screen').toContain('wsf-member-topbar-wordmark');
      expect(
        loading.wordmarks.filter((id) => !String(id).startsWith('wsf-member-topbar-')),
        'and no other wordmark',
      ).toEqual([]);
      expect(loading.h1s, 'no stand-in page heading while loading').toEqual([]);
      release();
      await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
    });
  }
});
