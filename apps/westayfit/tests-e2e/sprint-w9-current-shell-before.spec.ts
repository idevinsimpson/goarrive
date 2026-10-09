import fs from 'node:fs';
import path from 'node:path';

import { test, expect, type Page } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';
import {
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W9 — THE CURRENT BUILD'S TOP CHROME, MEASURED ON THE REAL ROUTES.
 *
 * These are BEFORE frames and BEFORE numbers, taken from the shipping member
 * routes at this branch's start SHA against the emulator. They are not
 * reused from an accepted package, so there is no question of whether the
 * route blobs behind an older capture still match: they were taken here, from
 * the same commit as the proposal they sit beside.
 *
 * WHAT IT IS FOR. The owner's finding — "the top composition jumps between
 * routes", "the wordmark/header treatment changes by page" — is reported from
 * a recording. This spec turns it into four numbers per route that anybody can
 * re-derive, so the architecture note argues from measurements rather than
 * from a description of a video nobody else can open.
 *
 * IT ASSERTS, so it runs in the ordinary suite and writes no bytes unless
 * WSF_CAPTURE_FRAMES is set.
 *
 * THIS FILE NOW HAS TWO JOBS, AND ONLY ONE OF THEM IS "BEFORE".
 *
 *   1. It is still the PRODUCER of the frozen `before/` frames and of
 *      `before/chrome-geometry.json`. Those bytes are the record of the build
 *      that had the defect; they are guarded and are not re-shot by a routine
 *      run.
 *   2. Its live assertions used to be the owner's complaint, stated as an
 *      inequality: the top of the app is NOT the same from route to route.
 *      The member shell has since landed and made that false, so keeping the
 *      inequality would mean demanding the defect back. The assertions are now
 *      the AFTER of the same measurements — one wordmark, one top-bar box on
 *      all four destinations, and MOVE no longer wearing the bar — and they
 *      fail if any of that regresses.
 *
 * The measurements themselves are unchanged, so the numbers in the frozen JSON
 * and the numbers this run prints are directly comparable.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/app-shell-next/before');
const REPORT = path.resolve(__dirname, '../../../docs/design-target/review/app-shell-next/before/chrome-geometry.json');

const DEVICES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
] as const;

type Measurement = {
  route: string;
  wordmarkTestId: string | null;
  wordmarkX: number | null;
  wordmarkY: number | null;
  wordmarkHeight: number | null;
  /** The artwork colourway the route chose for the wordmark. */
  wordmarkVariant: 'navy' | 'white' | 'none';
  /** Top of the first text the member reads after the wordmark. */
  firstContentY: number | null;
  /** Whether the bottom bar is present on this route. */
  bar: boolean;
  /** Whether the raised MOVE control is present on this route. */
  move: boolean;
  /** The member shell's own top bar, once there is one: its box on this route. */
  shellBarY: number | null;
  shellBarHeight: number | null;
  /** Whether the bar can be reached where it sits, or is covered by this route. */
  barReachable: boolean;
};

/** Each route, and the wordmark testID it happens to use. There is no shared
 *  one: each route names its own, which is itself part of the finding. */
const ROUTES: { route: string; wordmark: string | null; firstContent: string | null }[] = [
  { route: '/', wordmark: 'wsf-home-wordmark', firstContent: null },
  { route: '/community', wordmark: 'wsf-community-index-wordmark', firstContent: 'wsf-community-index-title' },
  { route: '/activity', wordmark: 'wsf-activity-wordmark', firstContent: 'wsf-activity-title' },
  { route: '/you', wordmark: 'wsf-you-wordmark', firstContent: 'wsf-you-name' },
  { route: '/move', wordmark: null, firstContent: null },
];

async function measure(page: Page, spec: (typeof ROUTES)[number]): Promise<Measurement> {
  const m: Measurement = {
    route: spec.route,
    wordmarkTestId: spec.wordmark,
    wordmarkX: null,
    wordmarkY: null,
    wordmarkHeight: null,
    wordmarkVariant: 'none',
    firstContentY: null,
    bar: false,
    move: false,
    shellBarY: null,
    shellBarHeight: null,
    barReachable: false,
  };

  if (spec.wordmark) {
    const wm = page.getByTestId(spec.wordmark).first();
    if (await wm.count()) {
      const box = await wm.boundingBox();
      if (box) {
        m.wordmarkX = Math.round(box.x);
        m.wordmarkY = Math.round(box.y);
        m.wordmarkHeight = Math.round(box.height);
      }
      /*
        WHICH ARTWORK, NOT WHICH COLOUR VALUE. The two colourways are two
        different image assets, so the variant is read off the source the
        <img> actually resolved rather than inferred from a computed style.
      */
      const src = await wm.evaluate((el) => {
        const img = el.tagName === 'IMG' ? (el as HTMLImageElement) : el.querySelector('img');
        return img ? img.getAttribute('src') : null;
      });
      if (src) m.wordmarkVariant = /white/i.test(src) ? 'white' : 'navy';
    }
  }

  if (spec.firstContent) {
    const fc = page.getByTestId(spec.firstContent).first();
    if (await fc.count()) {
      const box = await fc.boundingBox();
      if (box) m.firstContentY = Math.round(box.y);
    }
  }

  m.bar = (await page.getByTestId('wsf-member-tabs').count()) > 0;
  m.move = (await page.getByTestId('wsf-member-tab-move').count()) > 0;

  const shellBar = page.getByTestId('wsf-member-topbar');
  if (await shellBar.count()) {
    const box = await shellBar.boundingBox();
    if (box) {
      m.shellBarY = Math.round(box.y);
      m.shellBarHeight = Math.round(box.height);
    }
  }

  /*
    REACHABLE, NOT MERELY PRESENT. MOVE opens OVER the member shell, so the tab
    bar stays mounted underneath it and a presence check would report it as
    still on show. The question the owner asked — "MOVE is in the bottom bar
    while I am already on MOVE" — is about what a thumb can hit, so it is asked
    of the pixels: whatever is at the bar's own centre must be part of the bar.
  */
  m.barReachable = await page.evaluate(() => {
    const bar = document.querySelector('[data-testid="wsf-member-tabs"]');
    if (!(bar instanceof HTMLElement)) return false;
    const r = bar.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const top = document.elementFromPoint(
      Math.round(r.x + r.width / 2),
      Math.round(r.y + r.height / 2),
    );
    return top instanceof Node && bar.contains(top);
  });
  return m;
}

test('the shell is measured route by route, and the top of the app agrees with itself', async ({ browser }) => {
  test.setTimeout(300_000);
  if (CAPTURE_FRAMES) fs.mkdirSync(OUT, { recursive: true });

  const stamp = stampId();
  const email = `wsf-w9-before-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9before-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'inviteOnly',
    groupType: 'custom',
    members: [{ uid, role: 'member' }],
  });
  const goalId = `w9beforegoal-${stamp}`;
  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
    timezone: 'America/New_York',
  });
  await seedShards(goalId, 1847);

  const all: Record<string, Measurement[]> = {};

  for (const device of DEVICES) {
    const ctx = await browser.newContext({ viewport: { width: device.width, height: device.height } });
    try {
      const page = await ctx.newPage();
      await signInVia(page, email, password);

      const measured: Measurement[] = [];
      for (const spec of ROUTES) {
        await page.goto(spec.route);
        await page.waitForLoadState('domcontentloaded');
        // Let the route's own reads settle; the chrome is what is being
        // measured, and on these routes it paints with the first frame.
        await page.waitForTimeout(1200);
        measured.push(await measure(page, spec));
        if (CAPTURE_FRAMES) {
          const name = spec.route === '/' ? 'home' : spec.route.replace(/^\//, '').replace(/\//g, '-');
          await page.screenshot({ path: path.join(OUT, `CURRENT-BUILD-${name}-${device.key}.png`) });
        }
      }
      all[device.key] = measured;

      /*
        THE FINDING, AS A CHECK — NOW FROM THE OTHER SIDE.

        This file was written against the shipping build at the branch's start
        SHA, and it asserted the owner's complaint: four member destinations,
        and the top of the app was not the same thing on any two of them. The
        member shell has since landed, so that inequality is no longer true of
        this build, and a test that still demanded it would be demanding the
        defect back.

        The frozen `before/` frames and `before/chrome-geometry.json` remain
        exactly what they were — the record of the build that HAD the defect,
        byte-identical and guarded. What changes here is the claim the live
        assertions make, which is now the AFTER of that record: one wordmark,
        carried once by the shell; one top-bar box on all four destinations;
        and MOVE no longer offering to take a member where they already are.
        Same machinery, same routes, same numbers — opposite verdict, because
        the build is the opposite of what it was.
      */
      const tabs = measured.filter((m) => ['/', '/community', '/activity', '/you'].includes(m.route));

      // NOT ONE PAGE DRAWS ITS OWN. The four wordmark testIDs this file was
      // written around exist in no member surface any more.
      for (const m of tabs) {
        expect(
          m.wordmarkVariant,
          `${device.key}: ${m.route} is drawing a wordmark of its own again (${m.wordmarkTestId})`,
        ).toBe('none');
        expect(
          m.wordmarkHeight,
          `${device.key}: ${m.route} has its own wordmark box again`,
        ).toBeNull();
      }

      // THE SHELL CARRIES ONE, AND IT IS THE SAME OBJECT EVERYWHERE. One box,
      // at one height, on all four — which is the claim the recording made
      // false and this migration makes true.
      const barBoxes = tabs.map((m) => `${m.shellBarY}x${m.shellBarHeight}`);
      for (const m of tabs) {
        expect(
          m.shellBarY,
          `${device.key}: ${m.route} has no member top bar`,
        ).not.toBeNull();
      }
      expect(
        new Set(barBoxes).size,
        `${device.key}: the member top bar is not one box across the four destinations: ${JSON.stringify(
          tabs.map((m) => ({ route: m.route, y: m.shellBarY, h: m.shellBarHeight })),
        )}`,
      ).toBe(1);

      // And the bar is reachable where a member expects it, on all four.
      for (const m of tabs) {
        expect(
          m.barReachable,
          `${device.key}: ${m.route} covers its own tab bar`,
        ).toBe(true);
      }

      // AND /move NO LONGER WEARS THE SHELL. The bar is still mounted beneath
      // the sheet — that is what keeps the tab underneath alive — but nothing
      // of it can be reached, so the control that offered to take a member
      // where they already are is gone from the screen.
      const move = measured.find((m) => m.route === '/move')!;
      expect(
        move.barReachable,
        '/move is showing the member tab bar again, raised MOVE control and all',
      ).toBe(false);
    } finally {
      await ctx.close();
    }
  }

  if (CAPTURE_FRAMES) {
    fs.writeFileSync(REPORT, `${JSON.stringify(all, null, 2)}\n`);
  }
  // eslint-disable-next-line no-console
  console.log('[W9] current-build chrome geometry:', JSON.stringify(all, null, 1));
});
