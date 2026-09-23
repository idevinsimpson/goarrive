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
 * WSF_CAPTURE_FRAMES is set. The assertion is deliberately the owner's claim:
 * that the top of the app is NOT the same from route to route. If a later
 * change ever makes these agree, this test fails and says so — which is the
 * right way round for a BEFORE.
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
  return m;
}

test('the current build is measured route by route, and does not agree with itself', async ({ browser }) => {
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
        THE FINDING, AS A CHECK.

        Four member destinations, and the top of the app is not the same thing
        on any two of them. Asserted as an inequality on purpose: this is a
        BEFORE, and a BEFORE that silently starts agreeing with itself is a
        BEFORE that has stopped describing the build.
      */
      const tabs = measured.filter((m) => ['/', '/community', '/activity', '/you'].includes(m.route));

      // The wordmark does not sit at one height across the four.
      const heights = new Set(tabs.map((m) => m.wordmarkHeight));
      expect(
        heights.size,
        `${device.key}: the current build already uses one wordmark height: ${JSON.stringify(tabs)}`,
      ).toBeGreaterThan(1);

      // Nor in one colourway.
      const variants = new Set(tabs.map((m) => m.wordmarkVariant));
      expect(
        variants.size,
        `${device.key}: the current build already uses one wordmark colourway`,
      ).toBeGreaterThan(1);

      // /you is the outlier the owner described: a different artwork, smaller,
      // higher up the screen than the cream routes' chrome row.
      const you = tabs.find((m) => m.route === '/you')!;
      expect(you.wordmarkVariant, '/you no longer uses the white wordmark').toBe('white');

      // And /move wears the shell today, raised MOVE control and all — the
      // control offering to take a member where they already are.
      const move = measured.find((m) => m.route === '/move')!;
      expect(move.bar, '/move no longer renders the member tab bar').toBe(true);
      expect(move.move, '/move no longer renders the raised MOVE control beneath the MOVE page').toBe(true);
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
