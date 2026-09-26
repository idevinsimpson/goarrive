import crypto from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

import { firestoreRead, firestoreWrite, seedProfile, seedShards, seedVerifiedUser, signInVia, stampId, tsField } from './helpers/mobile';

/**
 * W9 — COMMUNITY-SETTINGS-PARITY-1 CHECKPOINT 3: THE HARDENING ADDENDUM
 * (Director #489 `5841405625`), at the route.
 *
 *   H1  the privacy switch is the reference's: 48 x 28, a 20 px thumb at a
 *       4 px inset, `role="switch"` + `aria-checked`, a ring on keyboard
 *       focus only, and Space toggles it
 *   H2  a re-read issued before a save lands does not put back what that
 *       save settled
 *   H3  a community with an unresolved save takes no second action on either
 *       switch (W4's accepted panel marks the community busy); after the
 *       reply, the settled value shows and the next action goes through
 *   H4  membership lost before a save: that community's switches go at once
 *       and its block says the member no longer belongs; nothing is stored
 *   H5  the roster follows a settled privacy change: turned off in Settings,
 *       the member is no longer named on the Community tab
 *   H6  Close, Escape and the scrim, pressed together during the exit, are
 *       ONE dismissal, after repeated opens; focus lands on Settings once
 *   H7  reduced motion: Close dismisses without the 180 ms wait
 *   H8  closing mid-save is safe: the reply that lands after a reopen does
 *       not overwrite or error the reopened panel
 *   H9  switching communities: in every animation frame after a chip press,
 *       the heading and the This period title belong to one community
 *   H10 a failed goals read invents nothing: Goals is a dash, never 0, and
 *       no "No active goal"
 *
 * Since the resume on `87a86531` the panel is W4's `CommunityPrivacyPanelView`
 * and the tab W4's `CommunityParityView`; these rows read their test IDs.
 *
 * Emulators only; synthetic accounts; injected delays and failures are
 * labelled where they are made.
 */

const BASE = process.env.WSF_PLAYWRIGHT_BASE_URL;
test.skip(!BASE, 'Set WSF_PLAYWRIGHT_BASE_URL to the emulator-flagged build under test.');
test.use({ viewport: { width: 390, height: 844 } });

const DAY = 864e5;

async function person(tag: string, name: string) {
  const email = `wsf-w9csph-${tag}-${stampId()}@example.com`;
  const password = `Aa1!${crypto.randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, name);
  return { uid, email, password, name };
}

function membership(groupId: string, uid: string, role: string, extra: Record<string, unknown> = {}) {
  const now = new Date();
  return firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: role },
    membershipStatus: { stringValue: 'active' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
    ...extra,
  });
}

async function community(id: string, name: string, champ: string) {
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${id}`, {
    displayName: { stringValue: name },
    groupType: { stringValue: 'custom' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: `JOIN${crypto.randomBytes(4).toString('hex')}` },
    createdByUserId: { stringValue: champ },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
}

async function goal(id: string, groupId: string, owner: string, title: string, target: number, shared: number) {
  const now = Date.now();
  await firestoreWrite(`wsfGoals/${id}`, {
    ownerUid: { stringValue: owner },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: title },
    target: { integerValue: String(target) },
    unit: { stringValue: 'squats' },
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now - 5 * DAY)),
    endsAt: tsField(new Date(now + 9 * DAY)),
    timezone: { stringValue: 'America/New_York' },
    aggregateDisplayAuthorized: { booleanValue: true },
    createdAt: tsField(new Date(now - 5 * DAY)),
    updatedAt: tsField(new Date(now)),
  });
  if (shared > 0) await seedShards(id, shared);
}

/** M in C1 (with O, the Champion, and Q, name private) and in C2. */
async function fixture(tag: string) {
  const s = `${stampId()}${tag}`;
  const m = await person(`${tag}m`, 'Mara Ellis');
  const o = await person(`${tag}o`, 'Olu Adeyemi');
  const q = await person(`${tag}q`, 'Quinn Park');
  const c1 = { id: `w9csphc1-${s}`, name: 'Harbor Movers' };
  const c2 = { id: `w9csphc2-${s}`, name: 'Summit Walkers' };
  await community(c1.id, c1.name, o.uid);
  await community(c2.id, c2.name, o.uid);
  await membership(c1.id, o.uid, 'foundingChampion');
  await membership(c1.id, m.uid, 'member');
  await membership(c1.id, q.uid, 'member', { communityNameVisibility: { stringValue: 'private' } });
  await membership(c2.id, o.uid, 'foundingChampion');
  await membership(c2.id, m.uid, 'member');
  await goal(`w9csphg1-${s}`, c1.id, o.uid, 'Harbor Squat Month', 500, 180);
  await goal(`w9csphg2-${s}`, c2.id, o.uid, 'Summit Steps', 1000, 200);
  return { m, o, q, c1, c2 };
}
type Fx = Awaited<ReturnType<typeof fixture>>;

async function stored(groupId: string, uid: string, field: 'communityNameVisibility' | 'communityActivityVisibility') {
  const f = await firestoreRead(`wsfMemberships/${groupId}_${uid}`);
  return (f[field] as { stringValue?: string } | undefined)?.stringValue ?? null;
}

const sw = (page: Page, kind: 'name' | 'activity', g: string) =>
  page.locator(`[data-testid="wsf-privacy-panel-${kind}-${g}"]:visible`).first();

async function checked(page: Page, kind: 'name' | 'activity', g: string): Promise<'on' | 'off'> {
  return sw(page, kind, g).evaluate((el) => {
    const i = el.querySelector('input') as HTMLInputElement | null;
    return i ? (i.checked ? 'on' : 'off') : el.getAttribute('aria-checked') === 'true' ? 'on' : 'off';
  }) as Promise<'on' | 'off'>;
}

async function flip(page: Page, kind: 'name' | 'activity', g: string): Promise<void> {
  const input = sw(page, kind, g).locator('input');
  if (await input.count()) await input.first().click({ timeout: 10_000, force: true });
  else await sw(page, kind, g).click({ timeout: 10_000, force: true });
}

async function signIn(page: Page, fx: Fx): Promise<void> {
  await signInVia(page, fx.m.email, fx.m.password);
  await page.evaluate(([u, g]) => localStorage.setItem(`wsf.currentCommunity.${u}`, g), [fx.m.uid, fx.c1.id] as const);
}

async function toYou(page: Page): Promise<void> {
  await page.locator('[data-testid="wsf-member-tab-you"]:visible').last().click();
  await expect(page.locator('[data-testid="wsf-you-settings"]:visible')).toBeVisible({ timeout: 40_000 });
}

async function openPanel(page: Page, fx: Fx): Promise<void> {
  await page.locator('[data-testid="wsf-you-settings"]:visible').click();
  await expect(page.locator('[data-testid="wsf-settings-panel"]')).toHaveCount(1, { timeout: 20_000 });
  await expect(sw(page, 'name', fx.c1.id)).toBeVisible({ timeout: 40_000 });
  await page.waitForTimeout(400);
}

/** A promise the test resolves by hand: an injected hold, labelled where used. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = () => undefined as void;
  const wait = new Promise<void>((r) => {
    open = r;
  });
  return { wait, open };
}

test.describe('COMMUNITY-SETTINGS-PARITY-1 cp3 · hardening', () => {
  test('H1 the switch is the reference toggle: geometry, role and state, keyboard ring, Space', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('h1');
    await signIn(page, fx);
    await page.goto('/you');
    await expect(page.locator('[data-testid="wsf-you-settings"]:visible')).toBeVisible({ timeout: 40_000 });
    await openPanel(page, fx);

    const geo = await sw(page, 'name', fx.c1.id).evaluate((el) => {
      const kids = Array.from(el.querySelectorAll('*')).map((k) => k.getBoundingClientRect());
      const track = kids.find((k) => Math.round(k.width) === 48 && Math.round(k.height) === 28) ?? null;
      const thumb = kids.find((k) => Math.round(k.width) === 20 && Math.round(k.height) === 20) ?? null;
      return {
        role: el.getAttribute('role'),
        ariaChecked: el.getAttribute('aria-checked'),
        track: track ? { w: Math.round(track.width), h: Math.round(track.height) } : null,
        thumb:
          track && thumb
            ? { left: Math.round(thumb.left - track.left), right: Math.round(track.right - thumb.right), top: Math.round(thumb.top - track.top) }
            : null,
      };
    });
    expect(geo.role, JSON.stringify(geo)).toBe('switch');
    expect(geo.ariaChecked).toBe('true');
    expect(geo.track, 'a 48 x 28 track').toEqual({ w: 48, h: 28 });
    expect(geo.thumb, 'a 20 px thumb').not.toBeNull();
    expect([geo.thumb!.right, geo.thumb!.top], 'on: the thumb sits 4 px from the right and the top').toEqual([4, 4]);

    // Keyboard: Tab from Close reaches the first switch, which shows a ring.
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('wsf-settings-close');
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      return {
        id: a?.getAttribute('data-testid') ?? null,
        visible: a ? a.matches(':focus-visible') : false,
        outline: a ? getComputedStyle(a).outlineStyle : null,
      };
    });
    expect(ring.id).toBe(`wsf-privacy-panel-name-${fx.c1.id}`);
    expect(ring.visible).toBe(true);
    expect(ring.outline).toBe('solid');

    // Space toggles it, and what shows is what is stored.
    await page.keyboard.press(' ');
    await expect.poll(() => checked(page, 'name', fx.c1.id), { timeout: 20_000 }).toBe('off');
    await expect.poll(() => stored(fx.c1.id, fx.m.uid, 'communityNameVisibility'), { timeout: 20_000 }).toBe('private');
    const off = await sw(page, 'name', fx.c1.id).evaluate((el) => {
      const kids = Array.from(el.querySelectorAll('*')).map((k) => k.getBoundingClientRect());
      const track = kids.find((k) => Math.round(k.width) === 48 && Math.round(k.height) === 28);
      const t = kids.find((k) => Math.round(k.width) === 20 && Math.round(k.height) === 20);
      return track && t ? Math.round(t.left - track.left) : null;
    });
    expect(off, 'off: the thumb sits 4 px from the left').toBe(4);
  });

  test('H2 a re-read issued before a save lands does not put back what the save settled', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('h2');
    await signIn(page, fx);
    await page.goto('/you');
    await expect(page.locator('[data-testid="wsf-you-settings"]:visible')).toBeVisible({ timeout: 40_000 });
    await openPanel(page, fx);

    // INJECTED: the name save fails without writing; the re-read that follows
    // is answered with what was stored at that moment, but held until released.
    let failName = true;
    await page.route('**/wsfSetCommunityVisibility', async (route: Route) => {
      const body = route.request().postDataJSON() as { data?: { name?: string } };
      if (failName && body?.data?.name !== undefined) {
        failName = false;
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"injected"}}' });
      }
      return route.continue();
    });
    const held = gate();
    let heldReads = 0;
    await page.route('**/wsfMyCommunities', async (route: Route) => {
      if (failName) return route.continue();
      heldReads += 1;
      const res = await route.fetch();
      await held.wait;
      return route.fulfill({ response: res });
    });

    await flip(page, 'name', fx.c1.id);
    await expect.poll(() => heldReads, { timeout: 20_000 }).toBeGreaterThan(0);

    // While that (older) re-read is held, the activity save lands.
    await flip(page, 'activity', fx.c1.id);
    await expect.poll(() => stored(fx.c1.id, fx.m.uid, 'communityActivityVisibility'), { timeout: 20_000 }).toBe('private');
    await expect.poll(() => checked(page, 'activity', fx.c1.id), { timeout: 20_000 }).toBe('off');

    held.open();
    await page.waitForTimeout(1_500);
    expect(await checked(page, 'activity', fx.c1.id), 'the older re-read did not put activity back on').toBe('off');
    expect(await checked(page, 'name', fx.c1.id), 'the failed name save shows what is stored').toBe('on');
    expect(await stored(fx.c1.id, fx.m.uid, 'communityNameVisibility')).toBeNull();
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('H3 a community with an unresolved save takes no second action; after the reply the next one goes through', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('h3');
    await signIn(page, fx);
    await page.goto('/you');
    await expect(page.locator('[data-testid="wsf-you-settings"]:visible')).toBeVisible({ timeout: 40_000 });
    await openPanel(page, fx);

    // INJECTED: the name save's reply is held after its write lands.
    const held = gate();
    const sent: string[] = [];
    await page.route('**/wsfSetCommunityVisibility', async (route: Route) => {
      const body = route.request().postDataJSON() as { data?: { name?: string; activity?: string } };
      sent.push(body?.data?.name !== undefined ? `name:${body.data.name}` : `activity:${body?.data?.activity}`);
      const res = await route.fetch();
      if (body?.data?.name !== undefined) await held.wait;
      return route.fulfill({ response: res });
    });

    await flip(page, 'name', fx.c1.id);
    await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
    await flip(page, 'name', fx.c1.id);
    await flip(page, 'activity', fx.c1.id);
    await page.waitForTimeout(600);
    expect(sent, 'no second action while the community is unresolved').toEqual(['name:private']);
    expect(await checked(page, 'name', fx.c1.id), 'nothing optimistic').toBe('on');

    held.open();
    await expect.poll(() => checked(page, 'name', fx.c1.id), { timeout: 20_000 }).toBe('off');
    await flip(page, 'activity', fx.c1.id);
    await expect.poll(() => stored(fx.c1.id, fx.m.uid, 'communityActivityVisibility'), { timeout: 20_000 }).toBe('private');
    await expect.poll(() => checked(page, 'activity', fx.c1.id), { timeout: 20_000 }).toBe('off');
    expect(await checked(page, 'name', fx.c1.id), 'the activity reply did not move name').toBe('off');
    expect(sent).toEqual(['name:private', 'activity:private']);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('H4 membership lost before a save: its switches go at once and its block says so; nothing is stored', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('h4');
    await signIn(page, fx);
    await page.goto('/you');
    await expect(page.locator('[data-testid="wsf-you-settings"]:visible')).toBeVisible({ timeout: 40_000 });
    await openPanel(page, fx);
    await expect(sw(page, 'name', fx.c2.id)).toBeVisible();

    // Removed on the server while the panel is open.
    await membership(fx.c2.id, fx.m.uid, 'member', { membershipStatus: { stringValue: 'removed' } });
    await flip(page, 'name', fx.c2.id);
    await expect(page.locator(`[data-testid="wsf-privacy-panel-error-${fx.c2.id}"]:visible`)).toContainText(
      `no longer a member of ${fx.c2.name}`,
      { timeout: 20_000 },
    );
    const block = page.locator(`[data-testid="wsf-privacy-panel-block-${fx.c2.id}"]:visible`);
    await expect(block.locator('[role="switch"]')).toHaveCount(0);
    await expect(sw(page, 'name', fx.c1.id)).toBeVisible();
    expect(await stored(fx.c2.id, fx.m.uid, 'communityNameVisibility')).toBeNull();
  });

  test('H5 the roster follows a settled privacy change made in Settings', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('h5');
    await signIn(page, fx);
    await page.goto('/community');
    const roster = page.locator('[data-testid="wsf-parity-roster"]:visible');
    await expect(roster).toContainText(fx.m.name, { timeout: 40_000 });
    await expect(roster).toContainText('1 member shown without names');

    await toYou(page);
    await openPanel(page, fx);
    await flip(page, 'name', fx.c1.id);
    await expect.poll(() => checked(page, 'name', fx.c1.id), { timeout: 20_000 }).toBe('off');
    await page.locator('[data-testid="wsf-settings-close"]:visible').click();
    await expect(page.locator('[data-testid="wsf-settings-panel"]')).toHaveCount(0, { timeout: 8_000 });

    await page.locator('[data-testid="wsf-member-tab-community"]:visible').last().click();
    await expect(roster).not.toContainText(fx.m.name, { timeout: 20_000 });
    await expect(roster).toContainText(fx.o.name);
    await expect(roster).toContainText('2 members shown without names');
    await expect(roster).not.toContainText(fx.q.name);
  });

  test('H6 Close, Escape and the scrim during the exit are one dismissal, after repeated opens', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('h6');
    await signIn(page, fx);
    await page.goto('/community');
    await expect(page.locator('[data-testid="wsf-community-index-rows"]:visible')).toBeVisible({ timeout: 40_000 });
    await toYou(page);

    for (const how of ['close', 'escape', 'scrim'] as const) {
      await openPanel(page, fx);
      if (how === 'close') await page.locator('[data-testid="wsf-settings-close"]:visible').click();
      else if (how === 'escape') await page.keyboard.press('Escape');
      else await page.locator('[data-testid="wsf-settings-scrim"]').click({ position: { x: 20, y: 400 }, force: true });
      await expect(page.locator('[data-testid="wsf-settings-panel"]')).toHaveCount(0, { timeout: 8_000 });
    }

    await openPanel(page, fx);
    await page.locator('[data-testid="wsf-settings-close"]:visible').click();
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="wsf-settings-scrim"]').click({ position: { x: 20, y: 400 }, force: true, timeout: 2_000 }).catch(() => undefined);
    await expect(page.locator('[data-testid="wsf-settings-panel"]')).toHaveCount(0, { timeout: 8_000 });
    await page.waitForTimeout(800);

    expect(new URL(page.url()).pathname, 'still on You: one dismissal, not two').toBe('/you');
    await expect(page.locator('[data-testid="wsf-member-tab-you"][data-current="true"]:visible')).toHaveCount(1);
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('wsf-you-settings');
    // One Escape now is not a stray second dismissal handler.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    expect(new URL(page.url()).pathname).toBe('/you');
  });

  test('H7 reduced motion: Close dismisses without the 180 ms wait', async ({ page }) => {
    test.setTimeout(200_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const fx = await fixture('h7');
    await signIn(page, fx);
    await page.goto('/you');
    await expect(page.locator('[data-testid="wsf-you-settings"]:visible')).toBeVisible({ timeout: 40_000 });
    await openPanel(page, fx);
    const ms = await page.evaluate(async () => {
      const btn = document.querySelector('[data-testid="wsf-settings-close"]') as HTMLElement;
      const t0 = performance.now();
      btn.click();
      while (document.querySelector('[data-testid="wsf-settings-panel"]') && performance.now() - t0 < 2_000) {
        await new Promise((r) => requestAnimationFrame(r));
      }
      return Math.round(performance.now() - t0);
    });
    expect(ms, `panel gone ${ms} ms after Close`).toBeLessThan(120);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('wsf-you-settings');
  });

  test('H8 closing mid-save is safe: the late reply does not overwrite or error the reopened panel', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('h8');
    await signIn(page, fx);
    await page.goto('/you');
    await expect(page.locator('[data-testid="wsf-you-settings"]:visible')).toBeVisible({ timeout: 40_000 });
    await openPanel(page, fx);

    // INJECTED: the name save writes, and its reply is held past a close and reopen.
    const held = gate();
    let replied = false;
    await page.route('**/wsfSetCommunityVisibility', async (route: Route) => {
      const res = await route.fetch();
      await held.wait;
      replied = true;
      return route.fulfill({ response: res });
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await flip(page, 'name', fx.c1.id);
    await expect.poll(() => stored(fx.c1.id, fx.m.uid, 'communityNameVisibility'), { timeout: 20_000 }).toBe('private');
    await page.locator('[data-testid="wsf-settings-close"]:visible').click();
    await expect(page.locator('[data-testid="wsf-settings-panel"]')).toHaveCount(0, { timeout: 8_000 });

    await openPanel(page, fx);
    await expect.poll(() => checked(page, 'name', fx.c1.id), { timeout: 20_000 }).toBe('off');
    held.open();
    await expect.poll(() => replied, { timeout: 10_000 }).toBe(true);
    await page.waitForTimeout(1_000);
    expect(await checked(page, 'name', fx.c1.id)).toBe('off');
    await expect(page.locator('[data-testid^="wsf-privacy-panel-error-"]:visible')).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('H9 switching: every frame after a chip press pairs the heading with its own community', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('h9');
    await signIn(page, fx);
    await page.goto('/community');
    await expect(page.locator('[data-testid="wsf-community-index-rows"]:visible')).toContainText('Harbor Squat Month', { timeout: 40_000 });
    await page.waitForTimeout(800);
    const sampling = page.evaluate(async () => {
      const out: { name: string; period: string }[] = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 2_500) {
        const vis = (el: Element | null) => (el && (el as HTMLElement).getClientRects().length > 0 ? (el as HTMLElement) : null);
        const title = Array.from(document.querySelectorAll('[data-testid="wsf-parity-name"]')).map(vis).find(Boolean);
        const period = Array.from(document.querySelectorAll('[data-testid="wsf-parity-period-title"]')).map(vis).find(Boolean);
        const loading = Array.from(document.querySelectorAll('[data-testid="wsf-parity-goals-loading"]')).map(vis).find(Boolean);
        if (title && (period || loading)) out.push({ name: title.innerText.trim(), period: period ? period.innerText.trim() : 'Reading …' });
        await new Promise((r) => requestAnimationFrame(r));
      }
      return out;
    });
    await page.locator(`[data-testid="wsf-parity-chip-${fx.c2.id}"]:visible`).click();
    const frames = await sampling;
    const bad = frames.filter(
      (f) =>
        !(
          (f.name === fx.c1.name && f.period === 'Harbor Squat Month') ||
          (f.name === fx.c2.name && (f.period === 'Summit Steps' || /^Reading /.test(f.period)))
        ),
    );
    expect(frames.length).toBeGreaterThan(20);
    expect(bad, JSON.stringify(bad.slice(0, 3))).toEqual([]);
    expect(frames[frames.length - 1]).toEqual({ name: fx.c2.name, period: 'Summit Steps' });
  });

  test('H10 a failed goals read invents nothing: Goals is a dash and there is no "No active goal"', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await fixture('h10');
    await signIn(page, fx);
    // INJECTED: every goals read fails.
    await page.route('**/wsfListGoals', (r: Route) =>
      r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"status":"INTERNAL","message":"injected"}}' }),
    );
    await page.goto('/community');
    const rows = page.locator('[data-testid="wsf-community-index-rows"]:visible');
    await expect(rows).toContainText('This community’s goals couldn’t be loaded just now.', { timeout: 40_000 });
    await expect(page.locator('[data-testid="wsf-parity-fact-goals"]:visible')).toContainText('—');
    await expect(rows).not.toContainText('No active goal');
    await expect(rows).toContainText('Past goals couldn’t be loaded just now.');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
