import path from 'node:path';

import { test, expect, type Browser } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';

import {
  stampId,
  seedVerifiedUser,
  seedProfile,
  seedCommunity,
  seedActiveGoal,
  seedShards,
  signInVia,
} from './helpers/mobile';

/**
 * THE APP SHELL — persistent navigation, and Home as a community.
 *
 * A LOCAL RENDER of the built artifact, against the emulator. Not a staging
 * screenshot and never evidence about staging.
 */
const OUT = path.resolve(__dirname, '../../../docs/westayfit/app-shell-2026-09-19' + (process.env.WSF_CAPTURE_SUBDIR ? '/' + process.env.WSF_CAPTURE_SUBDIR : ''));

const WIDTHS = [
  { key: '360', width: 360, height: 800 },
  { key: '390', width: 390, height: 844 },
  { key: '430', width: 430, height: 932 },
  { key: 'short-390x640', width: 390, height: 640 },
];

async function seedMember(label: string) {
  const stamp = stampId();
  const email = `wsf-shell-${label}-${stamp}@example.com`;
  const password = 'Sup3rSecret!23';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `shell-${label}-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'inviteOnly',
    groupType: 'custom',
    members: [{ uid, role: 'member' }],
  });
  const goalId = `shellgoal-${label}-${stamp}`;
  await seedActiveGoal({
    goalId, groupId, ownerUid: uid,
    title: 'October Squat Challenge', target: 5000, unit: 'squats', total: 1847,
    timezone: 'America/New_York',
  });
  await seedShards(goalId, 1847);
  return { email, password, uid, groupId, goalId };
}

/** No element may run past the viewport: a shell that clips is not a shell. */
async function expectNoHorizontalOverflow(page: import('@playwright/test').Page, where: string) {
  const report = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > width + 1 || r.left < -1) {
        offenders.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)} @ ${Math.round(r.left)}..${Math.round(r.right)}`);
      }
    }
    return { width, offenders: offenders.slice(0, 5) };
  });
  expect(report.offenders, `${where}: content runs past ${report.width}px — ${report.offenders.join('; ')}`).toEqual([]);
}

/*
  RE-POINTED, NOT RELAXED. This test encoded the four-destination bar. The
  approved shell is four destinations AND one raised action between them:
  Home | Community | MOVE | Progress | You. It now proves strictly more than
  it did — the same four destinations, plus that MOVE resolves to somewhere a
  member can actually move.
*/
test('the shell carries four destinations and the MOVE action, and Home is the community', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(360_000);
  const fx = await seedMember('a');

  for (const w of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width: w.width, height: w.height },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      locale: 'en-US', timezoneId: 'America/New_York', reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await signInVia(page, fx.email, fx.password);

    // HOME IS THE COMMUNITY. One community, so Home opens it rather than
    // offering a list to pick from.
    await page.goto('/');
    await expect(page.getByTestId(`wsf-community-goal-title-${fx.goalId}`)).toBeVisible({ timeout: 40_000 });
    expect(page.url()).toContain(`/community/${fx.groupId}`);

    // The shell is present, and Home is the current destination.
    const tabs = page.getByTestId('wsf-member-tabs');
    await expect(tabs).toBeVisible();
    for (const key of ['home', 'activity', 'community', 'you']) {
      await expect(page.getByTestId(`wsf-member-tab-${key}`)).toBeVisible();
    }
    // The raised action is present at every width that is not the two-row
    // fallback, where it steps aside rather than overlapping the tabs.
    if (w.width >= 260) {
      await expect(page.getByTestId('wsf-member-tab-move')).toBeVisible();
    }
    // PROGRESS, NOT ACTIVITY. The destination is renamed; the route is not.
    await expect(page.getByTestId('wsf-member-tab-activity')).toContainText('Progress');
    await expect(page.getByTestId('wsf-member-tab-home')).toHaveAttribute('data-current', 'true');
    await expectNoHorizontalOverflow(page, `Home at ${w.key}`);
    if (CAPTURE_FRAMES) await page.screenshot({ path: path.join(OUT, `home-${w.key}.png`) });

    // THE BAR IS ABOVE THE FOLD, ALWAYS. A navigation a person has to scroll
    // to reach is not persistent navigation.
    const bar = await tabs.boundingBox();
    expect(bar, `no tab bar at ${w.key}`).not.toBeNull();
    expect(bar!.y + bar!.height, `the tab bar sits below the fold at ${w.key}`).toBeLessThanOrEqual(w.height + 1);

    // EACH DESTINATION IS REAL, and marks itself current.
    // EACH DESTINATION IS REAL, MARKS ITSELF CURRENT, AND IS CAPTURED
    // SETTLED — not mid-load.
    //
    // The first version captured as soon as the heading appeared, so the
    // contact sheet showed "Loading your activity…" and "Loading…" for two of
    // the four destinations. A capture of a spinner is not evidence about a
    // screen. Each one now waits for a RESOLVED state — its content or its
    // honest empty state — before the shutter.
    for (const [key, testId, settled] of [
      ['activity', 'wsf-activity-title', ['wsf-activity-rows', 'wsf-activity-empty', 'wsf-activity-error']],
      ['community', 'wsf-community-index-title', ['wsf-community-index-rows', 'wsf-community-index-empty', 'wsf-community-index-error']],
      ['you', 'wsf-you-title', ['wsf-you-identity', 'wsf-you-signed-out']],
    ] as const) {
      await page.getByTestId(`wsf-member-tab-${key}`).click();
      await expect(page.getByTestId(testId)).toBeVisible({ timeout: 40_000 });
      await expect(page.getByTestId(`wsf-member-tab-${key}`)).toHaveAttribute('data-current', 'true');
      await expect
        .poll(async () => {
          for (const id of settled) if (await page.getByTestId(id).count()) return id;
          return null;
        }, { timeout: 40_000, message: `${key} at ${w.key} never left its loading state` })
        .not.toBeNull();
      await expectNoHorizontalOverflow(page, `${key} at ${w.key}`);
      if (CAPTURE_FRAMES) await page.screenshot({ path: path.join(OUT, `${key}-${w.key}.png`) });
    }

    /*
      THE WORDMARK GOES HOME, from a destination that is not Home — and it is
      the SHELL's wordmark now, not the page's.

      This clicked `wsf-you-wordmark-home`, the You page's own copy. Every
      member page used to draw its own wordmark; with the persistent top bar
      they drew a second one beneath the shell's, and each carried its own Home
      gesture that navigated INTO the tab tree from inside it — which pushed a
      new community screen rather than returning to the mounted one, leaving
      two in the document. The page copies are gone; the bar's is the one
      gesture, and it is asserted here.
    */
    await page.getByTestId('wsf-member-topbar-wordmark-home').click();
    await expect(
      page.locator(`[data-testid="wsf-community-goal-title-${fx.goalId}"]:visible`).first(),
    ).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-member-tab-home')).toHaveAttribute('data-current', 'true');

    /*
      MOVE RESOLVES TO SOMEWHERE A MEMBER CAN ACTUALLY MOVE.

      The bar cannot know which goal without two authorized reads, so /move
      does them. This fixture's community has exactly one open goal, so the
      resolver must land on that goal's contribution flow — not on a chooser,
      and not back where it started. A control in permanent chrome that goes
      nowhere is the thing this assertion exists to catch.
    */
    if (w.width >= 260) {
      await page.getByTestId('wsf-member-tab-move').click();
      await expect
        .poll(() => page.url(), {
          timeout: 40_000,
          message: `MOVE did not resolve to a contribution at ${w.key}`,
        })
        .toContain(`/contribute/${fx.goalId}`);
      // Back does NOT return Home, and should not: /move replaces rather
      // than pushes, so MOVE never leaves a trail of itself in the history.
      // The way back to Home is Home.
      await page.goto('/');
      await expect(page.getByTestId(`wsf-community-goal-title-${fx.goalId}`)).toBeVisible({
        timeout: 40_000,
      });
    }


    await context.close();
  }
});

test('Activity shows what this member actually recorded, and says it is private', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(240_000);
  const fx = await seedMember('c');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'en-US', timezoneId: 'America/New_York', reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await signInVia(page, fx.email, fx.password);

  // An empty Activity proves almost nothing, so this records a real
  // contribution through the product's own flow and then reads it back.
  await page.goto('/');
  await expect(page.getByTestId(`wsf-community-goal-link-${fx.goalId}`)).toBeVisible({ timeout: 40_000 });
  await page.getByTestId(`wsf-community-goal-link-${fx.goalId}`).click();
  // "Start moving" opens the move screen first; Done is what reaches entry.
  await expect(page.getByTestId('wsf-contribute-move-screen')).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('wsf-contribute-done').click();
  await page.getByTestId('wsf-contribute-entry').fill('20');
  await page.getByTestId('wsf-contribute-review').click();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 40_000 });

  await page.goto('/activity');
  await expect(page.getByTestId('wsf-activity-rows')).toBeVisible({ timeout: 40_000 });
  const row = page.getByTestId(`wsf-activity-row-${fx.goalId}`);
  await expect(row).toContainText('20 squats');
  await expect(row).toContainText('October Squat Challenge');
  await expect(row).toContainText('Alpharetta Morning Movers');
  // The number is the member's own, not the goal's shared total: 1,847 is
  // seeded on the goal and must never appear on this private screen.
  await expect(page.getByTestId('wsf-activity')).not.toContainText('1,847');
  // The one clarification says both halves: this summary is the member's own,
  // and their contributions reach community activity per their settings. The
  // old blanket "nobody else can see it" was wrong about the second half.
  await expect(page.getByTestId('wsf-activity-subtitle')).toHaveText('Your recorded contributions, by goal.');
  await expect(page.getByTestId('wsf-activity-privacy')).toHaveText(
    'This personal summary is only for you. Community activity follows your visibility settings.',
  );
  await expect(page.getByTestId('wsf-activity')).not.toContainText('nobody else can see');
  if (CAPTURE_FRAMES) await page.screenshot({ path: path.join(OUT, 'activity-recorded-390.png') });
  await context.close();
});

test('the shell stays off the event surfaces and off the signed-out ones', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(180_000);
  const fx = await seedMember('b');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: 'en-US', timezoneId: 'America/New_York', reducedMotion: 'reduce',
  });
  const page = await context.newPage();

  // Signed out: there is nothing to navigate between yet.
  await page.goto('/');
  await expect(page.getByTestId('wsf-home-signed-out')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-member-tabs')).toHaveCount(0);
  if (CAPTURE_FRAMES) await page.screenshot({ path: path.join(OUT, 'signed-out-390.png') });

  await signInVia(page, fx.email, fx.password);
  await page.goto('/');
  await expect(page.getByTestId('wsf-member-tabs')).toBeVisible({ timeout: 40_000 });

  // An event surface is single-purpose and often not this person's device.
  // Four ways to leave under a thumb mid-round is not the shell's job.
  await page.goto(`/event/${fx.goalId}`);
  // Anchored on the event surface's own chrome rather than its title: a goal
  // that is not part of a combined event renders the event screen's refusal,
  // which is still the event surface and must still carry no shell.
  await expect(page.getByTestId('wsf-event-wordmark')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-member-tabs')).toHaveCount(0);
  if (CAPTURE_FRAMES) await page.screenshot({ path: path.join(OUT, 'event-no-shell-390.png') });

  await context.close();
});
