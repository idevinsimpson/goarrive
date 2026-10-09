import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

import { CAPTURE_FRAMES, saveFrame } from './helpers/capture';

/**
 * THE RESPONSIVE PUBLIC DISPLAY — behaviour, regressions, and matched AFTERs.
 *
 * The implementation released by the Director on PR #429 (`5787359488`) after
 * the responsive direction passed: `/display/[goalId]` gains a portrait tier
 * and a collective tier, the phone composition is preserved, and 1280×800 is
 * guarded against regression.
 *
 * MOST OF THIS FILE IS NOT ABOUT PICTURES. The frames are written only under
 * `WSF_CAPTURE_FRAMES=1`; every assertion runs on every ordinary run, because
 * a style change that weakened what the display is allowed to say would be a
 * far worse outcome than an ugly one.
 *
 * ── WHAT IS ASSERTED, AND WHY EACH ONE EARNS ITS PLACE ────────────────────
 *
 * THE BOUNDARIES. A portrait tier keyed on "taller than wide" would have
 * swallowed every phone in existence. 599×1000 must stay a phone and 600×1000
 * must not; 1599×900 must stay a booth and 1600×900 must not. Those four
 * viewports are the whole safety of the change, so they are tested directly
 * rather than inferred from the two nice sizes.
 *
 * THE PRESERVED COMPOSITIONS. 390×844 and 430×932 keep `data-layout="phone"`
 * and tier `phone`; 1280×800 and 1440×900 keep `wide` and tier `booth`. The
 * booth's mark width is asserted against the shipped expression, because
 * "guarded against regression" has to mean something checkable.
 *
 * THE TRUTH, AT THE NEW TIERS. Every phase, the exact overshoot, the capped
 * percent, stale retaining its confirmed values, an unreachable first load
 * inventing no zero and no mark, a refusal clearing context and staying
 * terminal until `Check again`, and a recent-list failure touching only that
 * list — all re-asserted at portrait and collective, because a composition
 * change is exactly how a state quietly loses a line.
 *
 * NO QR. Asserted absent on the real route at every tier: the seam stays in
 * the target package and ships as nothing at all.
 *
 * LONG STRINGS. A community name and goal title far longer than any reviewed
 * fixture, at both new tiers, with nothing escaping the canvas.
 */

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const PROJECT_ID = 'demo-wsf-local';
const OUT = path.resolve(__dirname, '..', '..', '..', 'docs/design-target/review/display-responsive-after/after');

const PORTRAIT = { width: 800, height: 1280 };
const COLLECTIVE = { width: 1920, height: 1080 };

const COMMUNITY = 'Maple Street Movers';
const GOAL_TZ = 'America/New_York';
const OPEN_START = '2026-09-15T04:00:00.000Z';
const OPEN_END = '2026-10-06T03:30:00.000Z';
const CLOSED_START = '2026-08-02T03:00:00.000Z';
const CLOSED_END = '2026-08-16T03:59:00.000Z';
const OPEN_PERIOD = 'Open · Ends Mon, Oct 5';

/*
 * THE CLOCK IS FROZEN, SO A FRAME CAN BE REPRODUCED.
 *
 * The display prints the device's own clock on its freshness line ("Confirmed
 * 1:48 AM") and ages each recent addition against the device's current minute
 * ("+20 squats · 1 min ago"). Both are pure functions of `Date` in the page,
 * so a frame captured at a different wall time differs in exactly those pixels
 * and nothing else — which is what made "I re-ran the producer and the frames
 * came back byte-identical" impossible to be true (README, Correction 23 Sep).
 *
 * So the page's `Date` is pinned before the route loads. Timers keep running
 * (the poll still ticks every 2 s, the stale pill still appears on its own);
 * only what the page believes the time IS stands still. The additions are
 * seeded relative to the SAME instant, so "1 min ago" is one minute by the
 * page's clock, not by the seed process's.
 *
 * THE INSTANT IS THE MINUTE THE ACCEPTED FRAMES WERE CAPTURED IN. Six of the
 * eight carry a clock: four read 1:48 AM, and the portrait progress and stale
 * pair, shot a minute earlier, read 1:47; the refused pair prints no clock. So
 * the accepted record and a fresh run agree on the clock text wherever they
 * can, rather than differing by construction. The page's zone and locale are
 * pinned to what that capture ran under (a UTC container, en-US Chromium), so
 * the same frame comes out of a container set to any zone.
 *
 * WHAT STAYS REAL: document ids and seed stamps (uniqueness across runs), and
 * the createdAt / updatedAt fields no frame prints. Nothing in the product is
 * touched; this is the producer being honest about what it can promise.
 *
 * ONE LATENT COUPLING. The mark's Animated.timing path measures its progress
 * with Date.now(), so under a fixed clock a transition would never advance.
 * Today `livingWeTransition()` returns null and the fill is set, not animated;
 * if a transition is ever approved, this producer must advance the clock
 * (`clock.install` + `runFor`) rather than fix it, or it would photograph a
 * stalled fill without saying so.
 */
const FROZEN_AT = new Date('2026-09-23T01:48:00.000Z');
const FROZEN_CLOCK = '1:48 AM'; // FROZEN_AT, as the page prints it under UTC / en-US

const LONG_COMMUNITY = 'The Greater Maple Street and Riverside Parish Movers, Walkers and Early Risers Association';
const LONG_TITLE = 'Squats, lunges, step-ups and everything else we can count together before the end of this month';

function callableUrl(name: string): string {
  return `${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`;
}

/**
 * A PATCH WITHOUT A MASK REPLACES THE DOCUMENT.
 *
 * The first draft of this file dropped the `updateMask` the existing display
 * specs pass, so flipping one boolean on a seeded goal wiped its title,
 * target, unit, status and zone — and the refusal that followed looked like
 * the product refusing to recover. It was this helper deleting the goal's
 * contents. The mask is not optional in spirit: any write to an existing
 * document names the fields it means.
 */
async function firestoreWrite(
  docPath: string,
  fields: Record<string, unknown>,
  updateMask?: string[]
): Promise<void> {
  const mask = updateMask?.length
    ? '?' + updateMask.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&')
    : '';
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}${mask}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
}

const ts = (d: Date) => ({ timestampValue: d.toISOString() });

type Fx = { stamp: string; groupId: string; championUid: string; memberUid: string; joinCode: string };

async function seedCommunity(tag: string, name = COMMUNITY): Promise<Fx> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const groupId = `rsp-${tag}-${stamp}`;
  const championUid = `rsp-champ-${stamp}`;
  const memberUid = `rsp-member-${stamp}`;
  const joinCode = `JOIN${randomBytes(4).toString('hex')}`;
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: name },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: joinCode },
    createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: ts(now),
    updatedAt: ts(now),
  });
  for (const [uid, role] of [[championUid, 'foundingChampion'], [memberUid, 'member']] as const) {
    await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
      groupId: { stringValue: groupId },
      userId: { stringValue: uid },
      role: { stringValue: role },
      membershipStatus: { stringValue: 'active' },
      createdAt: ts(now),
      updatedAt: ts(now),
    });
  }
  return { stamp, groupId, championUid, memberUid, joinCode };
}

type Seed = { key: string; title?: string; target: number; unit: string; total: number; closed?: boolean; authorized?: boolean };

async function seedGoal(fx: Fx, g: Seed): Promise<string> {
  const goalId = `rsp-${g.key}-${fx.stamp}`;
  const now = new Date();
  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: fx.championUid },
    communityGroupId: { stringValue: fx.groupId },
    title: { stringValue: g.title ?? 'Squats together this week' },
    target: { integerValue: String(g.target) },
    unit: { stringValue: g.unit },
    status: { stringValue: g.closed ? 'closed' : 'active' },
    startsAt: { timestampValue: g.closed ? CLOSED_START : OPEN_START },
    endsAt: { timestampValue: g.closed ? CLOSED_END : OPEN_END },
    timezone: { stringValue: GOAL_TZ },
    createdAt: ts(now),
    updatedAt: ts(now),
  };
  if (g.authorized !== false) fields.aggregateDisplayAuthorized = { booleanValue: true };
  await firestoreWrite(`wsfGoals/${goalId}`, fields);
  if (g.total > 0) {
    await firestoreWrite(`wsfGoalCounters/${goalId}/shards/0`, { count: { integerValue: String(g.total) } });
  }
  await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${fx.memberUid}`, {
    goalId: { stringValue: goalId },
    userId: { stringValue: fx.memberUid },
    total: { integerValue: '7331' },
    createdAt: ts(now),
    updatedAt: ts(now),
  });
  return goalId;
}

async function seedAdditions(goalId: string): Promise<void> {
  const entries = [
    { amount: 20, minutesAgo: 1 },
    { amount: 35, minutesAgo: 4 },
    { amount: 12, minutesAgo: 9 },
    { amount: 50, minutesAgo: 14 },
    { amount: 25, minutesAgo: 22 },
  ];
  for (const [i, e] of entries.entries()) {
    await firestoreWrite(
      `wsfGoals/${goalId}/recentAdditions/rspattempt${String(i).padStart(4, '0')}${randomBytes(4).toString('hex')}`,
      // Relative to the page's frozen clock, not this process's: the age label
      // is computed in the page, and both sides are floored to the minute, so
      // an addition seeded a whole number of minutes before FROZEN_AT reads as
      // exactly that many minutes ago.
      { amount: { integerValue: String(e.amount) }, at: { stringValue: new Date(FROZEN_AT.getTime() - e.minutesAgo * 60_000).toISOString() } }
    );
  }
}

/** Nothing the display renders may escape the canvas it cannot scroll. */
async function nodesOutsideCanvas(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    /*
      EVERY STATE HAS A ROOT, AND THEY ARE NOT ALL CALLED THE SAME THING. The
      ready screen is `wsf-display-screen`; loading, unreachable and the one
      generic refusal each carry their own testID. Looking only for the ready
      one reported "not rendered" on exactly the states this check most needs
      to cover.
    */
    const root = (['wsf-display-screen', 'wsf-display-loading', 'wsf-display-unreachable', 'wsf-display-not-available']
      .map((id) => document.querySelector(`[data-testid="${id}"]`))
      .find(Boolean) ?? null) as HTMLElement | null;
    if (!root) return ['no display root rendered'];
    const cs = getComputedStyle(root);
    const rr = root.getBoundingClientRect();
    const box = {
      top: Math.max(rr.top + parseFloat(cs.paddingTop), 0),
      bottom: Math.min(rr.bottom - parseFloat(cs.paddingBottom), document.documentElement.clientHeight),
      left: Math.max(rr.left + parseFloat(cs.paddingLeft), 0),
      right: Math.min(rr.right - parseFloat(cs.paddingRight), document.documentElement.clientWidth),
    };
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('[data-testid^="wsf-display-"]')) as HTMLElement[]) {
      if (el === root) continue;
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      const over: string[] = [];
      if (r.top < box.top - 0.5) over.push('top');
      if (r.left < box.left - 0.5) over.push('left');
      if (r.bottom > box.bottom + 0.5) over.push('bottom');
      if (r.right > box.right + 0.5) over.push('right');
      if (over.length) out.push(`${el.getAttribute('data-testid')}: ${over.join(', ')}`);
    }
    return out;
  });
}

async function expectAnonymous(page: Page, fx: Fx): Promise<void> {
  const html = await page.content();
  for (const s of [fx.memberUid, fx.championUid, fx.joinCode, '7331', 'familyFriends']) {
    expect(html, `a public display must not contain ${s}`).not.toContain(s);
  }
}

/** The seam stays in the target package and ships as nothing. */
async function expectNoJoinUi(page: Page): Promise<void> {
  const text = await page.locator('body').innerText();
  expect(text, 'no QR or join control ships on the real route').not.toMatch(/scan to join|scan me|qr code/i);
}

async function shoot(page: Page, name: string): Promise<void> {
  if (CAPTURE_FRAMES) mkdirSync(OUT, { recursive: true });
  await saveFrame(page, path.join(OUT, `${name}.png`), { fullPage: false });
}

/*
 * The Check-again successor frames live apart from the accepted AFTER set, which
 * stays byte-identical as the historical record of the PROGRESS_GREEN control.
 */
const CHECK_AGAIN_OUT = path.resolve(__dirname, '../../../docs/design-target/review/display-responsive/check-again-green');

async function shootCheckAgain(page: Page, name: string): Promise<void> {
  if (CAPTURE_FRAMES) mkdirSync(CHECK_AGAIN_OUT, { recursive: true });
  await saveFrame(page, path.join(CHECK_AGAIN_OUT, `${name}.png`), { fullPage: false });
}

/** Board 00: ACTION_GREEN #22C55E for actions; PROGRESS_GREEN #91CB7D is reserved for confirmed progress. */
async function expectCheckAgainIsAnAction(page: Page): Promise<void> {
  const control = page.getByTestId('wsf-display-recheck');
  await expect(control).toBeVisible();
  const painted = await control.evaluate((el) => {
    let opacity = 1;
    for (let n: Element | null = el; n; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    return { background: getComputedStyle(el).backgroundColor, opacity };
  });
  expect(painted.background, 'Check again is an action: ACTION_GREEN, not the progress green').toBe('rgb(34, 197, 94)');
  expect(painted.opacity, 'painted at full strength, not faded into another colour').toBe(1);
}

/* ───────────────────────── the tier boundaries ───────────────────────────── */

test.describe('tier boundaries', () => {
  test('a portrait aspect below the floor is still a phone, and the wide tiers split where they should', async ({ browser }) => {
    test.setTimeout(300_000);
    const fx = await seedCommunity('bounds');
    const goalId = await seedGoal(fx, { key: 'bounds', target: 500, unit: 'squats', total: 241 });

    const cases: { viewport: { width: number; height: number }; layout: string; tier: string; why: string }[] = [
      { viewport: { width: 390, height: 844 }, layout: 'phone', tier: 'phone', why: 'the accepted phone' },
      { viewport: { width: 430, height: 932 }, layout: 'phone', tier: 'phone', why: 'the larger accepted phone' },
      { viewport: { width: 599, height: 1000 }, layout: 'phone', tier: 'phone', why: 'one pixel below the portrait floor' },
      { viewport: { width: 600, height: 1000 }, layout: 'portrait', tier: 'portrait', why: 'exactly at the portrait floor' },
      { viewport: { width: 800, height: 1280 }, layout: 'portrait', tier: 'portrait', why: 'the picture frame' },
      { viewport: { width: 899, height: 700 }, layout: 'phone', tier: 'phone', why: 'landscape below the wide floor is not portrait either' },
      { viewport: { width: 900, height: 700 }, layout: 'wide', tier: 'booth', why: 'exactly at the wide floor' },
      { viewport: { width: 1280, height: 800 }, layout: 'wide', tier: 'booth', why: 'the booth, guarded' },
      { viewport: { width: 1440, height: 900 }, layout: 'wide', tier: 'booth', why: 'what the existing suite exercises' },
      { viewport: { width: 1599, height: 900 }, layout: 'wide', tier: 'booth', why: 'one pixel below the collective floor' },
      { viewport: { width: 1600, height: 900 }, layout: 'wide', tier: 'collective', why: 'exactly at the collective floor' },
      { viewport: { width: 1920, height: 1080 }, layout: 'wide', tier: 'collective', why: 'the room' },
    ];

    for (const c of cases) {
      const ctx = await browser.newContext({ viewport: c.viewport, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      try {
        await page.goto(`/display/${goalId}`);
        await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 30_000 });
        const screen = page.getByTestId('wsf-display-screen');
        await expect(screen, `${c.viewport.width}×${c.viewport.height} — ${c.why}`).toHaveAttribute('data-layout', c.layout);
        await expect(screen, `${c.viewport.width}×${c.viewport.height} — ${c.why}`).toHaveAttribute('data-tier', c.tier);
        // Whatever the tier, the confirmed truth is the same truth.
        await expect(page.getByTestId('wsf-display-total-line')).toHaveText('241 of 500 squats');
        await expect(page.getByTestId('wsf-display-we')).toHaveCount(1);
        expect(await nodesOutsideCanvas(page), `${c.viewport.width}×${c.viewport.height}: inside the canvas`).toEqual([]);
        await expectNoJoinUi(page);
      } finally {
        await ctx.close();
      }
    }
  });

  test('the phone and booth instruments are the shipped sizes, to the pixel', async ({ browser }) => {
    test.setTimeout(180_000);
    const fx = await seedCommunity('mark');
    const goalId = await seedGoal(fx, { key: 'mark', target: 500, unit: 'squats', total: 241 });

    // The expressions this change must not have moved.
    const shipped = [
      { viewport: { width: 390, height: 844 }, expected: Math.max(96, Math.min(320, 390 - 2 * 20 - 2 * 22)) },
      { viewport: { width: 1280, height: 800 }, expected: Math.min(640, Math.round(1280 * 0.42)) },
      { viewport: { width: 1440, height: 900 }, expected: Math.min(640, Math.round(1440 * 0.42)) },
    ];
    for (const s of shipped) {
      const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      try {
        await page.goto(`/display/${goalId}`);
        await expect(page.getByTestId('wsf-display-we')).toBeVisible({ timeout: 30_000 });
        const box = await page.getByTestId('wsf-display-we').boundingBox();
        expect(Math.round(box!.width), `${s.viewport.width}: the shipped mark width`).toBe(s.expected);
      } finally {
        await ctx.close();
      }
    }

    // And the room's instrument is genuinely larger than the cap it replaced.
    const ctx = await browser.newContext({ viewport: COLLECTIVE, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    try {
      await page.goto(`/display/${goalId}`);
      await expect(page.getByTestId('wsf-display-we')).toBeVisible({ timeout: 30_000 });
      const box = await page.getByTestId('wsf-display-we').boundingBox();
      expect(Math.round(box!.width), 'the collective mark exceeds the old 640 cap').toBeGreaterThan(640);
    } finally {
      await ctx.close();
    }
  });
});

/* ─────────── the generic states, which carry no mark to measure ─────────── */

test.describe('generic states, per tier', () => {
  /*
    A DISCRIMINATING CHECK, BECAUSE THE MARK TEST CANNOT SEE THIS.

    Loading, unreachable and the one refusal render no Living WE, so the
    mark-width regression above is blind to them — which is exactly how a
    first cut of this change centred the booth's generic states while its own
    evidence said 1280x800 was untouched. The Director caught it in the source
    (`5787628430`).

    So this measures where the block actually sits: the booth keeps the
    shipped top-pinned layout, and only the collective centres.
  */
  test('only the collective centres the generic block; the booth keeps its shipped placement', async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seedCommunity('generic');
    const refusedId = await seedGoal(fx, { key: 'generic', target: 500, unit: 'squats', total: 241, authorized: false });

    const cases = [
      { viewport: { width: 1280, height: 800 }, centred: false, why: 'the booth, preserved' },
      { viewport: { width: 1440, height: 900 }, centred: false, why: 'what the existing suite exercises' },
      { viewport: COLLECTIVE, centred: true, why: 'the room, where the sentence is the screen' },
      { viewport: PORTRAIT, centred: true, why: 'portrait was already centred' },
      { viewport: { width: 390, height: 844 }, centred: true, why: 'the phone was already centred' },
    ];

    for (const c of cases) {
      const ctx = await browser.newContext({ viewport: c.viewport, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      try {
        await page.goto(`/display/${refusedId}`);
        const root = page.getByTestId('wsf-display-not-available');
        await expect(root).toBeVisible({ timeout: 30_000 });
        const offsets = await root.evaluate((el) => {
          const block = el.firstElementChild as HTMLElement;
          const r = el.getBoundingClientRect();
          const b = block.getBoundingClientRect();
          return { fromTop: b.top - r.top, fromBottom: r.bottom - b.bottom };
        });
        // Centred means the block sits at a comparable distance from both
        // edges; top-pinned means it does not.
        const balanced = Math.abs(offsets.fromTop - offsets.fromBottom) < 40;
        expect(
          balanced,
          `${c.viewport.width}×${c.viewport.height} — ${c.why}: top ${Math.round(offsets.fromTop)} vs bottom ${Math.round(offsets.fromBottom)}`
        ).toBe(c.centred);
        // Whatever the placement, a refusal still leaks nothing.
        for (const id of ['wsf-display-community', 'wsf-display-total-line', 'wsf-display-we']) {
          await expect(page.getByTestId(id)).toHaveCount(0);
        }
      } finally {
        await ctx.close();
      }
    }
  });
});

/* ──────────────── the confirmed truth, at the two new classes ─────────────── */

for (const [cls, viewport] of [['portrait', PORTRAIT], ['collective', COLLECTIVE]] as const) {
  const size = `${viewport.width}x${viewport.height}`;

  test.describe(`${cls} · ${size}`, () => {
    test.use({ viewport, deviceScaleFactor: 1, isMobile: false, hasTouch: false, timezoneId: 'UTC', locale: 'en-US' });

    // Before any route script runs, so every navigation in the test sees the
    // same instant. `setFixedTime` pins `Date` and keeps timers running
    // (Playwright drives its fake timers from the real clock), so the poll and
    // the stale pill behave as they do on a wall.
    test.beforeEach(async ({ page }) => {
      await page.clock.setFixedTime(FROZEN_AT);
    });

    test('every phase keeps its exact values', async ({ page }) => {
      test.setTimeout(300_000);
      const fx = await seedCommunity(`phases-${cls}`);
      const phases = [
        { seed: { key: `zero-${cls}`, target: 500, unit: 'squats', total: 0 }, total: '0 of 500 squats', percent: '0% complete', status: '500 to go', headline: 'See what WE can do.' },
        { seed: { key: `near-${cls}`, target: 500, unit: 'squats', total: 450 }, total: '450 of 500 squats', percent: '90% complete', status: 'Only 50 to go' },
        { seed: { key: `over-${cls}`, target: 500, unit: 'squats', total: 515 }, total: '515 of 500 squats', percent: '100% complete', status: '15 beyond our goal · still open', headline: 'WE did it.' },
        { seed: { key: `cr-${cls}`, target: 500, unit: 'squats', total: 515, closed: true }, total: '515 squats completed together.', target: 'Goal: 500 squats', status: '15 beyond our goal', headline: 'Look what WE did.' },
        { seed: { key: `cu-${cls}`, target: 500, unit: 'push-ups', total: 312, closed: true }, total: '312 of 500 push-ups', percent: '62.4% complete', status: 'Closed at 62.4%' },
      ] as const;

      for (const p of phases) {
        const goalId = await seedGoal(fx, p.seed);
        await page.goto(`/display/${goalId}`);
        await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('wsf-display-community')).toHaveText(COMMUNITY);
        await expect(page.getByTestId('wsf-display-total-line')).toHaveText(p.total);
        if ('percent' in p && p.percent) await expect(page.getByTestId('wsf-display-percent')).toHaveText(p.percent);
        if ('target' in p && p.target) await expect(page.getByTestId('wsf-display-target')).toHaveText(p.target);
        await expect(page.getByTestId('wsf-display-remaining')).toHaveText(p.status);
        if ('headline' in p && p.headline) await expect(page.getByTestId('wsf-display-headline')).toHaveText(p.headline);
        else await expect(page.getByTestId('wsf-display-headline')).toHaveCount(0);
        await expect(page.getByTestId('wsf-display-we')).toHaveCount(1);
        await expect(page.getByTestId('wsf-tabbar')).toHaveCount(0);
        await expect(page.getByTestId('wsf-move-button')).toHaveCount(0);
        expect(await nodesOutsideCanvas(page), `${cls}/${p.seed.key}: inside the canvas`).toEqual([]);
        await expectNoJoinUi(page);
        await expectAnonymous(page, fx);
      }
    });

    test('matched AFTER: confirmed, stale and refused', async ({ page }) => {
      test.setTimeout(300_000);
      const fx = await seedCommunity(`after-${cls}`);
      const goalId = await seedGoal(fx, { key: `after-${cls}`, target: 500, unit: 'squats', total: 241 });
      await seedAdditions(goalId);

      let dropping = false;
      await page.route(callableUrl('wsfGoalPulse'), async (route: Route) => {
        if (dropping) return route.abort('failed');
        return route.continue();
      });

      // ---- confirmed ---------------------------------------------------------
      await page.goto(`/display/${goalId}`);
      await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('wsf-display-total-line')).toHaveText('241 of 500 squats');
      await expect(page.getByTestId('wsf-display-percent')).toHaveText('48.2% complete');
      await expect(page.getByTestId('wsf-display-remaining')).toHaveText('259 to go');
      await expect(page.getByTestId('wsf-display-period')).toHaveText(OPEN_PERIOD);
      await expect(page.getByTestId('wsf-display-recent')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('wsf-display-recent-line')).toHaveCount(5);
      // The frozen clock is in force at the moment of capture: the freshness
      // line prints the pinned instant, and each age is measured from it. On a
      // producer running on the wall clock these read whatever time it is.
      await expect(page.getByTestId('wsf-display-confirmed-at')).toHaveText(`Confirmed ${FROZEN_CLOCK}`);
      await expect(page.getByTestId('wsf-display-recent-line')).toHaveText([
        '+20 squats · 1 min ago',
        '+35 squats · 4 min ago',
        '+12 squats · 9 min ago',
        '+50 squats · 14 min ago',
        '+25 squats · 22 min ago',
      ]);
      await expect(page.getByTestId('wsf-display-we')).toHaveCount(1);
      expect(await nodesOutsideCanvas(page)).toEqual([]);
      await page.waitForTimeout(250);
      await shoot(page, `AFTER-progress-${size}`);

      // ---- stale: the number is kept, the claim is dropped -------------------
      dropping = true;
      await expect(page.getByTestId('wsf-display-stale')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('wsf-display-stale')).toHaveText('Connection interrupted');
      await expect(page.getByTestId('wsf-display-confirmed-at')).toHaveText(`Last confirmed ${FROZEN_CLOCK}`);
      await expect(page.getByTestId('wsf-display-total-line')).toHaveText('241 of 500 squats');
      await expect(page.getByTestId('wsf-display-we')).toHaveCount(1);
      await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-stale', 'true');
      expect(await nodesOutsideCanvas(page)).toEqual([]);
      await shoot(page, `AFTER-stale-INJECTED-NETWORK-${size}`);

      // ---- refused: terminal, and nothing of the goal survives ---------------
      dropping = false;
      const refusedId = await seedGoal(fx, { key: `refused-${cls}`, target: 500, unit: 'squats', total: 241, authorized: false });
      await page.goto(`/display/${refusedId}`);
      await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('wsf-display-not-available')).toContainText('Nothing to show here');
      await expect(page.getByTestId('wsf-display-not-available')).toContainText('This display isn’t currently available.');
      for (const id of ['wsf-display-community', 'wsf-display-goal-title', 'wsf-display-total-line', 'wsf-display-we', 'wsf-display-recent']) {
        await expect(page.getByTestId(id)).toHaveCount(0);
      }
      await expectAnonymous(page, fx);
      await expectNoJoinUi(page);
      await expectCheckAgainIsAnAction(page);
      await shootCheckAgain(page, `CHECK-AGAIN-GREEN-refused-${size}`);
    });

    test('an unreachable first load invents nothing, and a recent-list failure touches only that list', async ({ page }) => {
      test.setTimeout(300_000);
      const fx = await seedCommunity(`fail-${cls}`);
      const goalId = await seedGoal(fx, { key: `fail-${cls}`, target: 500, unit: 'squats', total: 241 });
      await seedAdditions(goalId);

      // ---- nothing was ever confirmed ---------------------------------------
      await page.route(callableUrl('wsfGoalPulse'), (route: Route) => route.abort('failed'));
      await page.goto(`/display/${goalId}`);
      await expect(page.getByTestId('wsf-display-unreachable')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('wsf-display-unreachable')).toContainText('Nothing has been confirmed yet.');
      await expect(page.getByTestId('wsf-display-total-line')).toHaveCount(0);
      await expect(page.getByTestId('wsf-display-we')).toHaveCount(0);
      expect(await nodesOutsideCanvas(page)).toEqual([]);

      // ---- the list alone fails ---------------------------------------------
      await page.unroute(callableUrl('wsfGoalPulse'));
      let dropRecent = false;
      await page.route(callableUrl('wsfGoalRecentAdditions'), async (route: Route) => {
        if (dropRecent) return route.abort('failed');
        return route.continue();
      });
      await page.goto(`/display/${goalId}`);
      await expect(page.getByTestId('wsf-display-recent')).toBeVisible({ timeout: 30_000 });
      dropRecent = true;
      await expect(page.getByTestId('wsf-display-recent')).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByTestId('wsf-display-total-line')).toHaveText('241 of 500 squats');
      await expect(page.getByTestId('wsf-display-we')).toHaveCount(1);
      await expect(page.getByTestId('wsf-display-stale')).toHaveCount(0);
    });

    test('a long community name and goal title stay inside the canvas', async ({ page }) => {
      test.setTimeout(180_000);
      const fx = await seedCommunity(`long-${cls}`, LONG_COMMUNITY);
      const goalId = await seedGoal(fx, { key: `long-${cls}`, title: LONG_TITLE, target: 500, unit: 'squats', total: 241 });
      await page.goto(`/display/${goalId}`);
      await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('wsf-display-goal-title')).toHaveText(LONG_TITLE);
      await expect(page.getByTestId('wsf-display-community')).toHaveText(LONG_COMMUNITY);
      expect(await nodesOutsideCanvas(page), `${cls}: long strings inside the canvas`).toEqual([]);
      // The room does not fall back to phone type just because a string is long.
      const size$ = await page
        .getByTestId('wsf-display-goal-title')
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      expect(size$, 'a long title still reads at distance').toBeGreaterThan(24);
      await expect(page.getByTestId('wsf-display-confirmed-at')).toHaveText(`Confirmed ${FROZEN_CLOCK}`);
      await shoot(page, `AFTER-long-strings-${size}`);
    });
  });
}

/* ───────── the refusal is terminal until an explicit Check again ─────────── */

test.describe('recovery is an explicit act', () => {
  test.use({ viewport: COLLECTIVE, deviceScaleFactor: 1 });

  test('a refused session does not resume on its own', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seedCommunity('recover');
    const goalId = await seedGoal(fx, { key: 'recover', target: 500, unit: 'squats', total: 241, authorized: false });
    await page.goto(`/display/${goalId}`);
    await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 30_000 });

    // Authorize it behind the screen's back; the refusal must hold.
    await firestoreWrite(
      `wsfGoals/${goalId}`,
      { aggregateDisplayAuthorized: { booleanValue: true } },
      ['aggregateDisplayAuthorized']
    );
    await page.waitForTimeout(6_000);
    await expect(page.getByTestId('wsf-display-not-available')).toBeVisible();
    await expect(page.getByTestId('wsf-display-total-line')).toHaveCount(0);

    // Only the explicit control starts a new polling session.
    await page.getByTestId('wsf-display-recheck').click();
    await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('wsf-display-total-line')).toHaveText('241 of 500 squats');
  });
});
