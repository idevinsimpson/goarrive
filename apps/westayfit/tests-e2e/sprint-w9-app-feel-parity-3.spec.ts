import { expect, test, type Page } from '@playwright/test';

import {
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W9 — APP-FEEL-PARITY-1, CHECKPOINT 3 (ACK #477 `5840258940`).
 *
 * Community selection, against the reference's switcher (Lovable `a15a610e`,
 * screens/community.tsx): one chip per community, the current one pressed and
 * checked, and pressing another selects it in place, announced. Measured on
 * development `0b460ce3` before this checkpoint:
 *   · there are no chips; the only way to switch leaves the tab;
 *   · after a switch the mounted Community tab still names the OLD community
 *     as CURRENT;
 *   · Home keeps showing the community the member switched away from.
 *
 * Everything seeded here is SYNTHETIC. Chromium, local emulators.
 */

const PASSWORD = 'Sup3rSecret!23';
const PHONE = { width: 390, height: 844 };
const SHORT = { width: 390, height: 640 };

type Fx = { email: string; uid: string; a: string; b: string };

async function seed(tag: string): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-afp3-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const a = `w9afp3a-${stamp}`;
  const b = `w9afp3b-${stamp}`;
  await seedCommunity({ groupId: a, displayName: 'Alpharetta Morning Movers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedCommunity({ groupId: b, displayName: 'Roswell Lunch Walkers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedActiveGoal({
    goalId: `w9afp3g-${stamp}`,
    groupId: a,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
    endsAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
  });
  return { email, uid, a, b };
}

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label}: ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

async function currentTab(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[data-testid^="wsf-member-tab-"][data-current="true"]')).find(
      (n) => (n as HTMLElement).getClientRects().length > 0,
    );
    return el?.getAttribute('data-testid') ?? null;
  });
}

async function currentPanelName(page: Page): Promise<string> {
  return page
    .locator('[data-testid="wsf-parity-banner"]:visible')
    .first()
    .innerText()
    .catch(() => '');
}

async function openCommunityTab(page: Page): Promise<void> {
  await page.getByTestId('wsf-member-tab-community').last().click();
  await expect(page.locator('[data-testid="wsf-community-index-rows"]:visible')).toBeVisible({ timeout: 40_000 });
}

for (const vp of [PHONE, SHORT]) {
  test.describe(`APP-FEEL-PARITY-1 cp3 · community chips · ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, deviceScaleFactor: 1 });

    test('one chip per community, the current one pressed; another selects it in place, announced, keyboard too', async ({ page }) => {
      test.setTimeout(240_000);
      const fx = await seed(`c${vp.height}`);
      await signInVia(page, fx.email, PASSWORD);
      await page.goto(`/community/${fx.a}`);
      await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
      await openCommunityTab(page);

      const chipA = page.locator(`[data-testid="wsf-parity-chip-${fx.a}"]:visible`);
      const chipB = page.locator(`[data-testid="wsf-parity-chip-${fx.b}"]:visible`);
      await expect(chipA).toBeVisible({ timeout: 20_000 });
      await expect(chipA).toHaveAttribute('aria-pressed', 'true');
      await expect(chipB).toHaveAttribute('aria-pressed', 'false');
      const box = await chipB.boundingBox();
      measure('chip B box', box);
      expect(box!.height, 'a 44 px target').toBeGreaterThanOrEqual(44);

      await chipB.focus();
      await page.keyboard.press('Enter');
      await expect(chipB).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
      await expect(chipA).toHaveAttribute('aria-pressed', 'false');
      expect(await currentTab(page), 'still on the Community tab').toBe('wsf-member-tab-community');
      await expect.poll(() => currentPanelName(page), { timeout: 20_000 }).toContain('Roswell Lunch Walkers');
      await expect(page.getByTestId('wsf-community-index-announce')).toHaveText('Now showing Roswell Lunch Walkers.');

      // And back, by pointer.
      await chipA.click();
      await expect(chipA).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 });
      await expect.poll(() => currentPanelName(page), { timeout: 20_000 }).toContain('Alpharetta Morning Movers');
    });

    test('Home follows the chosen community; the Community tab is never stale after a switch', async ({ page }) => {
      test.setTimeout(240_000);
      const fx = await seed(`h${vp.height}`);
      await signInVia(page, fx.email, PASSWORD);
      await page.goto(`/community/${fx.a}`);
      await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
      await openCommunityTab(page);
      await page.locator(`[data-testid="wsf-parity-chip-${fx.b}"]:visible`).click();
      await expect.poll(() => currentPanelName(page), { timeout: 20_000 }).toContain('Roswell Lunch Walkers');

      await page.getByTestId('wsf-member-tab-home').last().click();
      await expect(page.locator('[data-testid="wsf-community-name"]:visible')).toHaveText('Roswell Lunch Walkers', { timeout: 40_000 });
      const homeInstances = await page.locator('[data-testid="wsf-community"]').count();
      const tabBars = await page.locator('[data-testid="wsf-member-tab-home"]').count();
      measure('Home after choosing B', { path: new URL(page.url()).pathname, homeInstances, tabBars });
      expect(tabBars, 'one tab navigator').toBe(1);
      expect(new URL(page.url()).pathname).toBe(`/community/${fx.b}`);

      // Switch back through Home's own Switch → the list's row A → Community tab
      // must say CURRENT: A.
      await openCommunityTab(page);
      await page.locator(`[data-testid="wsf-parity-chip-${fx.a}"]:visible`).click();
      await page.getByTestId('wsf-member-tab-home').last().click();
      await expect(page.locator('[data-testid="wsf-community-name"]:visible')).toHaveText('Alpharetta Morning Movers', { timeout: 40_000 });
      await openCommunityTab(page);
      await expect.poll(() => currentPanelName(page), { timeout: 20_000 }).toContain('Alpharetta Morning Movers');
      await expect(page.locator(`[data-testid="wsf-parity-chip-${fx.a}"]:visible`)).toHaveAttribute('aria-pressed', 'true');
    });
  });
}

test.describe('APP-FEEL-PARITY-1 cp3 · CURRENT after a switch made elsewhere', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 1 });

  test('switching through a row (which opens that community’s Home) and coming back: CURRENT is the new one', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('r');
    await signInVia(page, fx.email, PASSWORD);
    await page.goto(`/community/${fx.a}`);
    await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
    await openCommunityTab(page);
    await page.locator(`[data-testid="wsf-community-index-row-${fx.b}"]:visible`).click();
    await expect(page.locator('[data-testid="wsf-community-name"]:visible')).toHaveText('Roswell Lunch Walkers', { timeout: 40_000 });
    await openCommunityTab(page);
    await expect.poll(() => currentPanelName(page), { timeout: 20_000 }).toContain('Roswell Lunch Walkers');
    await expect(page.locator(`[data-testid="wsf-community-index-row-${fx.a}"]:visible`)).toBeVisible();
  });
});

/*
 * SETTINGS FROM THE SIDE, and the tab fade. The reference's utility panel
 * (ui.tsx `Sheet variant="panel"`; styles.css wsf-panel-in/out): from the
 * right, 240 ms in, 180 out, over a scrim; focus in it and back out of it.
 */
async function focusedId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return 'body';
    return el.getAttribute('data-testid') ?? el.tagName.toLowerCase();
  });
}

async function panelTimeline(page: Page, ms: number) {
  return page.evaluate(async (dur) => {
    const out: { t: number; x: number; o: number }[] = [];
    const t0 = performance.now();
    while (performance.now() - t0 < dur) {
      const el = document.querySelector('[data-testid="wsf-settings-panel"]') as HTMLElement | null;
      if (el) {
        const cs = getComputedStyle(el);
        const m = new DOMMatrixReadOnly(cs.transform === 'none' ? undefined : cs.transform);
        out.push({ t: Math.round(performance.now() - t0), x: Math.round(m.m41 * 10) / 10, o: Number(cs.opacity) });
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    return out;
  }, ms);
}

test.describe('APP-FEEL-PARITY-1 cp3 · Settings from the side', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 1 });

  test('from the menu: a panel over the dimmed, mounted tab; focus on Close, contained; Escape returns to the menu button', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('s');
    await signInVia(page, fx.email, PASSWORD);
    await page.goto(`/community/${fx.a}`);
    await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('wsf-member-topbar-menu-button').last().click();
    await page.getByTestId('wsf-member-topbar-menu-settings').last().click();
    await expect(page.locator('[data-testid="wsf-settings-panel"]:visible')).toBeVisible({ timeout: 20_000 });
    const behind = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="wsf-community"]')).some(
        (n) => (n as HTMLElement).getClientRects().length > 0,
      ),
    );
    measure('Home painted behind the panel', behind);
    expect(behind, 'the tab stays mounted and painted behind').toBe(true);
    await page.waitForTimeout(400); // past the 240 ms entry
    const box = await page.locator('[data-testid="wsf-settings-panel"]:visible').boundingBox();
    measure('panel box', box);
    // The frozen reference's geometry (Director #506 `5844878042`): 12 px in
    // from every edge, at most 380 wide.
    expect(Math.round(box!.x + box!.width), '12 px in from the right edge').toBe(PHONE.width - 12);
    expect(Math.round(box!.width), 'at most 380, 12 px in from the left too').toBe(Math.min(380, PHONE.width - 24));
    expect(Math.round(box!.y), '12 px down from the top').toBe(12);
    expect(Math.round(box!.y + box!.height), '12 px up from the bottom').toBe(PHONE.height - 12);
    await expect.poll(() => focusedId(page), { timeout: 5_000 }).toBe('wsf-settings-close');
    const scrimTab = await page.getByTestId('wsf-settings-scrim').getAttribute('tabindex');
    expect(scrimTab, 'the scrim is not a Tab stop').toBe('-1');
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press(i % 2 ? 'Shift+Tab' : 'Tab');
      const inside = await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="wsf-settings-panel"]')));
      expect(inside, `stop ${i} stays in the panel`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('wsf-settings-panel')).toHaveCount(0, { timeout: 8_000 });
    await expect.poll(() => focusedId(page), { timeout: 8_000 }).toBe('wsf-member-topbar-menu-button');
    expect(await page.locator('[data-testid="wsf-member-tab-home"]').count(), 'one tab navigator').toBe(1);
  });

  test('from You’s row: Close returns focus to that row; Privacy still opens', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('y');
    await signInVia(page, fx.email, PASSWORD);
    await page.goto(`/community/${fx.a}`);
    await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('wsf-member-tab-you').last().click();
    const row = page.locator('[data-testid="wsf-you-settings"]:visible');
    // By pointer: You's row is a role=link with no href and does not answer
    // Enter on the base or here (react-native-web leaves Enter to the
    // browser) -- measured and reported, not in this checkpoint's files.
    await row.click();
    await expect(page.locator('[data-testid="wsf-settings-panel"]:visible')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-testid="wsf-settings-close"]:visible').click();
    await expect(page.getByTestId('wsf-settings-panel')).toHaveCount(0, { timeout: 8_000 });
    await expect.poll(() => focusedId(page), { timeout: 8_000 }).toBe('wsf-you-settings');
    expect(await currentTab(page)).toBe('wsf-member-tab-you');

    // COMMUNITY-SETTINGS-PARITY-1 (Director #489 `5841078939`) replaced the
    // panel's Privacy row with the privacy controls themselves: the panel now
    // holds this community's section and its switches.
    await row.click();
    const panel = page.locator('[data-testid="wsf-settings-panel"]:visible');
    await expect(panel.locator(`[data-testid="wsf-privacy-panel-block-${fx.a}"]`)).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator(`[data-testid="wsf-privacy-panel-name-${fx.a}"]`)).toBeVisible();
  });

  test('it travels in from the right and out; reduced motion does neither; a cold link is still the page', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('m');
    await signInVia(page, fx.email, PASSWORD);
    await page.goto(`/community/${fx.a}`);
    await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('wsf-member-tab-you').last().click();
    await page.locator('[data-testid="wsf-you-settings"]:visible').click();
    const entry = await panelTimeline(page, 1500);
    measure('panel entry (first 6)', entry.slice(0, 6));
    expect(entry.some((s) => s.x > 0.5 || s.o < 0.99), 'it travels in').toBe(true);
    expect(entry[entry.length - 1]).toMatchObject({ x: 0, o: 1 });
    await page.locator('[data-testid="wsf-settings-close"]:visible').click();
    const exitT = await panelTimeline(page, 400);
    measure('panel exit', exitT);
    expect(exitT.some((s) => s.x > 0.5 || s.o < 0.99), 'it travels out').toBe(true);
    await expect(page.getByTestId('wsf-settings-panel')).toHaveCount(0, { timeout: 8_000 });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('[data-testid="wsf-you-settings"]:visible').click();
    const reduced = await panelTimeline(page, 800);
    expect(reduced.length).toBeGreaterThan(0);
    expect(reduced.filter((s) => s.x > 0.5 || s.o < 0.99), 'no travel under reduced motion').toEqual([]);

    await page.goto('/settings');
    await expect(page.locator('[data-testid="wsf-settings-screen"]:visible')).toBeVisible({ timeout: 40_000 });
    expect(await page.getByTestId('wsf-settings-panel').count(), 'cold: the page').toBe(0);
    await expect(page.locator('[data-testid="wsf-settings-back"]:visible')).toBeVisible();
  });
});

test.describe('APP-FEEL-PARITY-1 cp3 · a tab change fades', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 1 });

  async function sceneOpacity(page: Page, testId: string, ms: number) {
    return page.evaluate(
      async ({ id, dur }) => {
        const out: number[] = [];
        const t0 = performance.now();
        while (performance.now() - t0 < dur) {
          const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
          if (el) {
            let o = 1;
            for (let n: HTMLElement | null = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
            out.push(Math.round(o * 100) / 100);
          }
          await new Promise((r) => requestAnimationFrame(r));
        }
        return out;
      },
      { id: testId, dur: ms },
    );
  }

  test('the new tab fades in over ~140 ms; reselect does not animate; reduced motion does not fade', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('f');
    await signInVia(page, fx.email, PASSWORD);
    await page.goto(`/community/${fx.a}`);
    await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
    await openCommunityTab(page);
    await page.getByTestId('wsf-member-tab-home').last().click();
    await page.waitForTimeout(800);

    await page.getByTestId('wsf-member-tab-community').last().click();
    const fade = await sceneOpacity(page, 'wsf-community-index', 600);
    measure('Community scene opacity from the press', fade.slice(0, 12));
    expect(Math.min(...fade), 'it fades in').toBeLessThan(0.95);
    expect(fade[fade.length - 1], 'and settles').toBe(1);

    await page.getByTestId('wsf-member-tab-community').last().click();
    const reselect = await sceneOpacity(page, 'wsf-community-index', 400);
    expect(Math.min(...reselect), 'reselect: nothing moves').toBe(1);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByTestId('wsf-member-tab-home').last().click();
    await page.waitForTimeout(500);
    await page.getByTestId('wsf-member-tab-community').last().click();
    const reduced = await sceneOpacity(page, 'wsf-community-index', 400);
    measure('reduced-motion opacity', reduced.slice(0, 6));
    expect(Math.min(...reduced), 'no fade under reduced motion').toBe(1);
  });

  /*
    THE TAB IT LEAVES IS GONE AT ONCE. The reference hides the leaving tab
    outright (styles.css `.tab-stage > section[hidden] { display: none; }`)
    and fades only the entering one, over the app's own ground. A cross-fade
    paints both tabs together for the length of the fade: two screens of
    text on top of each other. Found in this checkpoint's own frame
    (`CANDIDATE-tab-fade-000ms` at a8d117da), not by review.

    WHAT IS MEASURED, AND WHY NOT "IS IT DISPLAYED". On the web every visited
    tab stays laid out (react-native-screens is off there); a tab is hidden
    by the focused tab's opaque ground lying over it. So per frame this reads
    how much of the leaving tab SHOWS THROUGH: the leaving tab's own painted
    opacity times what the entering tab's ground lets through (1 minus that
    ground's composite opacity). Content fading inside an opaque ground lets
    nothing through; a ground that is itself fading does.
  */
  test('the tab it leaves is gone at once: the two tabs are never painted together', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('x');
    await signInVia(page, fx.email, PASSWORD);
    await page.goto(`/community/${fx.a}`);
    await expect(page.locator('[data-testid="wsf-community-hero-presence"]:visible')).toBeVisible({ timeout: 60_000 });
    await openCommunityTab(page);
    await page.getByTestId('wsf-member-tab-home').last().click();
    await expect(page.locator('[data-testid="wsf-community-name"]:visible')).toBeVisible();
    await page.waitForTimeout(800);

    for (const [to, leaving, entering] of [
      ['community', 'wsf-community-name', 'wsf-community-index'],
      ['home', 'wsf-community-index', 'wsf-community-name'],
    ] as const) {
      // Sampling starts before the press, so the first frame of the change is in it.
      const sampler = page.evaluate(
        async ({ out: leavingId, in: enteringId }) => {
          const chain = (el: HTMLElement): HTMLElement[] => {
            const out: HTMLElement[] = [];
            for (let n: HTMLElement | null = el; n; n = n.parentElement) out.push(n);
            return out;
          };
          const opacity = (nodes: HTMLElement[]): number =>
            nodes.reduce((o, n) => o * Number(getComputedStyle(n).opacity), 1);
          const first = (id: string): HTMLElement | null =>
            Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)).find(
              (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden',
            ) ?? null;
          const opaque = (n: HTMLElement): boolean => {
            const m = getComputedStyle(n).backgroundColor.match(/rgba?\(([^)]+)\)/);
            if (!m) return false;
            const parts = m[1]!.split(',').map((s) => Number(s.trim()));
            return parts.length === 3 || parts[3] === 1;
          };
          const frame = () => {
            const l = first(leavingId);
            const e = first(enteringId);
            const content = e ? opacity(chain(e)) : 0;
            if (!l || !e) return { out: l ? opacity(chain(l)) : 0, ground: null as number | null, leak: 0, content };
            const lc = chain(l);
            const ec = chain(e);
            const lca = ec.find((n) => lc.includes(n))!;
            // The entering tab's path below the common ancestor, outermost first.
            const below = ec.slice(0, ec.indexOf(lca)).reverse();
            // Until the press takes effect the entering tab is the one UNDER
            // (the focused tab sits at z 0, the rest at -1): nothing leaks yet.
            const sceneL = lc[lc.indexOf(lca) - 1]!;
            const sceneE = below[0]!;
            const z = (n: HTMLElement) => Number(getComputedStyle(n).zIndex) || 0;
            const enteringOnTop =
              z(sceneE) > z(sceneL) ||
              (z(sceneE) === z(sceneL) && Boolean(sceneL.compareDocumentPosition(sceneE) & Node.DOCUMENT_POSITION_FOLLOWING));
            if (!enteringOnTop) return { out: opacity(lc), ground: null as number | null, leak: 0, content };
            const groundAt = below.findIndex(opaque);
            const ground = groundAt < 0 ? 0 : opacity(below.slice(0, groundAt + 1)) * opacity(chain(lca));
            const out = opacity(lc);
            return { out, ground, leak: Math.round(out * (1 - ground) * 100) / 100, content };
          };
          const frames: { t: number; out: number; ground: number | null; leak: number; content: number }[] = [];
          const t0 = performance.now();
          while (performance.now() - t0 < 600) {
            frames.push({ t: Math.round(performance.now() - t0), ...frame() });
            await new Promise((r) => requestAnimationFrame(r));
          }
          return frames;
        },
        { out: leaving, in: entering },
      );
      await page.getByTestId(`wsf-member-tab-${to}`).last().click();
      const frames = await sampler;
      const leaks = frames.filter((f) => f.leak > 0.01);
      measure(`to ${to}: frames where the leaving tab shows through`, leaks.slice(0, 8));
      measure(`to ${to}: entering content opacity`, frames.map((f) => Math.round(f.content * 100) / 100).slice(0, 16));
      expect(frames.some((f) => f.content > 0), `to ${to}: the entering tab is painted`).toBe(true);
      expect(leaks, `to ${to}: the leaving tab never shows through`).toEqual([]);
      await page.waitForTimeout(400);
    }
  });
});
