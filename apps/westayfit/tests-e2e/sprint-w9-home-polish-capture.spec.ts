import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Browser, type FrameLocator, type Page, type Route } from '@playwright/test';

import { CAPTURE_FRAMES } from './helpers/capture';
import {
  firestoreWrite,
  seedActiveGoal,
  seedCommunity,
  seedMembership,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';
import {
  GOAL_TZ,
  seedContribution,
  seedContributionAt,
  seedMembershipWithVisibility,
  zonedDayStartMs,
} from './sprint-w8-social-fixture';

/**
 * W9 — HOME-POLISH-1: THE ORDINARY MEMBER'S COMMUNITY HOME, CAPTURED ON THE
 * REAL ROUTE (Director #365 `5817775726`).
 *
 * TWO STAGES FROM ONE PRODUCER. The same seeding, the same easel and the same
 * checks photograph the route twice:
 *   · MIGRATED — the route as it ships on the development base, before this
 *     packet's change, so every later frame has a same-harness baseline;
 *   · CANDIDATE — the route with this packet's recomposition.
 * `WSF_HOME_POLISH_STAGE` names which build is being served. Neither is an
 * AFTER: nothing here has been through the Director, and the in-frame strip
 * says so inside every PNG, asserted rather than trusted.
 *
 * FOUR STATES, AT 390x844 AND 390x640, the packet's list:
 *   · populated — people visible, movement today, the member's own credit;
 *   · quiet     — the same community on a day nobody has moved yet (the
 *                 server PROVES the zero; movement exists, but yesterday);
 *   · privacy   — the viewer and one other member chose not to be named, and
 *                 one member chose not to show activity: rows are anonymous
 *                 or absent, and the shared total is unchanged;
 *   · stale     — the progress read fails: the product's own "we could not
 *                 confirm" state, which never prints a number it did not get.
 * Plus one scrolled populated frame, so the momentum section is on record.
 *
 * WHAT IT ASSERTS BESIDES THE PICTURES, on either build and whether or not
 * frames are written: each state is really in the state it is named for, the
 * primary action ends above the tab bar on both devices, and there is one top
 * bar. WSF_CAPTURE_FRAMES only gates the bytes on disk.
 *
 * Everything seeded here is SYNTHETIC: no person, community or goal is real.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/home-polish-1');

const STAGE = (process.env.WSF_HOME_POLISH_STAGE ?? 'CANDIDATE').toUpperCase();
if (STAGE !== 'MIGRATED' && STAGE !== 'CANDIDATE') {
  throw new Error(`WSF_HOME_POLISH_STAGE must be MIGRATED or CANDIDATE, not ${STAGE}`);
}

/**
 * THE BUILD IS READ, NOT ASSUMED. The stage comes from the environment, so a
 * MIGRATED run against a candidate build would otherwise overwrite the
 * baseline with candidate pixels and still say MIGRATED. The served build's
 * own commit is on /health (stamped by `build:web`); it is read before any
 * frame, checked against the stage, and printed in every frame's strip:
 *   · MIGRATED must be the development base this packet started from;
 *   · CANDIDATE must be anything else.
 */
const BASE_SHORT = '018cd29';

function stripLabel(commit: string): string {
  return `${STAGE} BUILD ${commit} / NOT ACCEPTED`;
}

/** The strip's height, added on top of the device height. */
const BANNER = 18;

const DEVICES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
] as const;

const PASSWORD = 'Sup3rSecret!23';
const TARGET = 5000;
const TOTAL = 1847;

type State = 'populated' | 'quiet' | 'privacy' | 'stale';

type Fixture = { email: string; groupId: string; goalId: string };

/** The member's own exact credit, written the way `wsfContribute` writes it. */
async function seedOwnTotal(goalId: string, uid: string, total: number): Promise<void> {
  await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${uid}`, {
    goalId: { stringValue: goalId },
    userId: { stringValue: uid },
    total: { integerValue: String(total) },
    contributionCount: { integerValue: '1' },
    updatedAt: tsField(new Date()),
  } as never);
}

/**
 * One community per state, one viewer per community, so the viewer is in
 * exactly one community (no Switch chip) and every frame is the same shape.
 */
async function seed(state: State): Promise<Fixture> {
  const stamp = `${stampId()}${state.slice(0, 2)}`;
  const email = `wsf-w9-hp-${stamp}@example.com`;
  const me = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(me, 'Alex Rivera');

  const groupId = `w9hp-${stamp}`;
  const goalId = `w9hpgoal-${stamp}`;
  const dana = `w9hp-dana-${stamp}`;
  const marcus = `w9hp-marcus-${stamp}`;
  const leah = `w9hp-leah-${stamp}`;
  const priya = `w9hp-priya-${stamp}`;
  const tom = `w9hp-tom-${stamp}`;

  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid: me, role: 'member' }],
  });
  if (state === 'privacy') {
    // The viewer chose not to be named here; activity stays visible.
    await seedMembershipWithVisibility(groupId, me, 'member', { name: 'private', activity: 'visible' });
  }
  await seedMembership(groupId, dana, 'foundingChampion');
  await seedMembership(groupId, marcus, 'member');
  await seedMembership(groupId, leah, 'member');
  if (state === 'privacy') {
    await seedMembershipWithVisibility(groupId, priya, 'member', { name: 'private' });
    await seedMembershipWithVisibility(groupId, tom, 'member', { activity: 'private' });
  } else {
    await seedMembership(groupId, priya, 'member');
    await seedMembership(groupId, tom, 'member');
  }
  await seedProfile(dana, 'Dana Whitfield');
  await seedProfile(marcus, 'Marcus Reed');
  await seedProfile(leah, 'Leah Brooks');
  await seedProfile(priya, 'Priya Nair');
  await seedProfile(tom, 'Tom Okafor');

  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: dana,
    title: 'October Squat Challenge',
    target: TARGET,
    unit: 'squats',
    total: TOTAL,
    timezone: GOAL_TZ,
  });

  if (state === 'quiet') {
    // Real movement, all of it before the goal's own day began: the only way
    // to get a zero the server can prove rather than one it cannot establish.
    const dayStart = zonedDayStartMs(GOAL_TZ);
    await seedContributionAt(groupId, goalId, marcus, 40, dayStart - 3 * 60 * 60_000);
    await seedContributionAt(groupId, goalId, dana, 60, dayStart - 5 * 60 * 60_000);
    return { email, groupId, goalId };
  }

  await seedContribution(groupId, goalId, me, 20, 20);
  await seedOwnTotal(goalId, me, 20);
  await seedContribution(groupId, goalId, marcus, 40, 55);
  await seedContribution(groupId, goalId, tom, 15, 90);
  await seedContribution(groupId, goalId, priya, 25, 180);
  await seedContribution(groupId, goalId, dana, 60, 300);
  return { email, groupId, goalId };
}

/** The easel: a labelled strip flush above an iframe of the device size. */
async function easel(
  page: Page,
  width: number,
  height: number,
  src: string,
): Promise<{ stage: FrameLocator; label: string }> {
  await page.goto('/health');
  const commit = ((await page.getByTestId('wsf-health-commit').innerText()).match(/[0-9a-f]{7,40}/) ?? [''])[0];
  expect(commit, 'the served build carries no commit stamp').not.toBe('');
  if (STAGE === 'MIGRATED') {
    expect(commit, 'MIGRATED frames must come from the development base build').toBe(BASE_SHORT);
  } else {
    expect(commit, 'CANDIDATE frames must not come from the base build').not.toBe(BASE_SHORT);
  }
  const label = stripLabel(commit);
  await page.evaluate(
    ({ w, h, banner, label, source }) => {
      document.documentElement.style.background = '#FFFFFF';
      document.body.style.cssText = 'margin:0;padding:0;background:#FFFFFF';
      document.body.innerHTML = `
        <div data-testid="wsf-w9hp-frame"
             style="width:${w}px;height:${h + banner}px;background:#FFFFFF;overflow:hidden;">
          <div data-testid="wsf-w9hp-banner"
               style="height:${banner}px;width:${w}px;background:#0B1F35;color:#F7F5F0;
                      font:700 10px/${banner}px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
                      letter-spacing:.9px;text-align:center;box-sizing:border-box;">${label}</div>
          <iframe id="wsf-w9hp-stage" src="${source}"
                  style="width:${w}px;height:${h}px;border:0;display:block;"></iframe>
        </div>`;
    },
    { w: width, h: height, banner: BANNER, label, source: src },
  );
  return { stage: page.frameLocator('#wsf-w9hp-stage'), label };
}

/** Wait until the state the frame is named for has actually rendered. */
async function settled(stage: FrameLocator, state: State, fx: Fixture): Promise<void> {
  await expect(stage.getByTestId('wsf-community-name')).toBeVisible({ timeout: 60_000 });
  if (state === 'stale') {
    await expect(stage.getByTestId(`wsf-community-goal-progress-error-${fx.goalId}`)).toBeVisible({
      timeout: 40_000,
    });
  } else {
    await expect(stage.getByTestId(`wsf-community-goal-total-${fx.goalId}`)).toContainText(
      TOTAL.toLocaleString('en-US'),
      { timeout: 40_000 },
    );
    await expect(stage.getByTestId('wsf-community-contributors-today')).toBeVisible({ timeout: 30_000 });
  }
  // Past the return settle and the Living WE's decode, so nothing moves under the shutter.
  await stage.locator('body').evaluate(() => new Promise((r) => setTimeout(r, 3_500)));
}

/** What the state is named for, checked on the rendered route. */
async function assertState(stage: FrameLocator, state: State, fx: Fixture): Promise<void> {
  const tag = `${STAGE} ${state}`;
  await expect(stage.getByTestId('wsf-member-topbar'), `${tag}: one top bar`).toHaveCount(1);
  if (state === 'populated') {
    await expect(stage.getByTestId('wsf-community-contributors-today')).toHaveText('5 people moved today');
    await expect(stage.getByTestId('wsf-community-momentum-card'), `${tag}: momentum`).toBeVisible();
    await expect(stage.getByTestId(`wsf-community-your-part-${fx.goalId}`), `${tag}: own part`).toContainText(
      '20 squats',
    );
  }
  if (state === 'quiet') {
    await expect(stage.getByTestId('wsf-community-contributors-today'), `${tag}: a proven zero`).toHaveText(
      '0 people moved today',
    );
  }
  if (state === 'privacy') {
    const momentum = stage.getByTestId('wsf-community-momentum-card');
    await expect(momentum, `${tag}: momentum`).toBeVisible();
    await expect(momentum, `${tag}: a member not named`).toContainText('Anonymous member');
    // Tom chose not to show activity: counted in the total, no row, no name.
    await expect(momentum.getByText('Tom Okafor'), `${tag}: an activity-off row appeared`).toHaveCount(0);
    await expect(momentum.getByText('Priya Nair'), `${tag}: a name-off member was named`).toHaveCount(0);
    await expect(momentum.getByText('Alex Rivera'), `${tag}: the viewer was named`).toHaveCount(0);
  }
  if (state === 'stale') {
    await expect(
      stage.getByTestId(`wsf-community-goal-total-${fx.goalId}`),
      `${tag}: a number was printed that the read never returned`,
    ).toHaveCount(0);
  }
}

/**
 * THE ACTION IS REACHABLE WITHOUT SCROLLING, ON BOTH DEVICES: the primary
 * control (or the retry, when progress is unavailable) ends above the tab bar.
 */
async function assertActionAboveTabs(stage: FrameLocator, state: State, fx: Fixture, device: string) {
  const action =
    state === 'stale'
      ? stage.getByTestId(`wsf-community-goal-progress-retry-${fx.goalId}`)
      : stage.getByTestId(`wsf-community-goal-link-${fx.goalId}`);
  const tabs = stage.getByTestId('wsf-member-tabs');
  const a = (await action.boundingBox())!;
  const t = (await tabs.boundingBox())!;
  expect(a, `${STAGE} ${state} ${device}: the action is not rendered`).not.toBeNull();
  expect(
    Math.round(a.y + a.height),
    `${STAGE} ${state} ${device}: the action ends below the top of the tab bar`,
  ).toBeLessThanOrEqual(Math.round(t.y));
}

async function capture(browser: Browser, state: State): Promise<void> {
  const fx = await seed(state);
  const ctx = await browser.newContext({ viewport: { width: 480, height: 940 }, deviceScaleFactor: 2 });
  try {
    const page = await ctx.newPage();
    if (state === 'stale') {
      // The progress read fails, every time it is asked. Labelled injection:
      // the server holds the total; the member's browser cannot confirm it.
      await page.route('**/wsfGoalPulse', (route: Route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: JSON.stringify({ error: { status: 'INTERNAL', message: 'progress unavailable (capture)' } }),
        }),
      );
    }
    await signInVia(page, fx.email, PASSWORD);
    for (const device of DEVICES) {
      await page.setViewportSize({ width: device.width + 60, height: device.height + BANNER + 60 });
      const { stage, label } = await easel(page, device.width, device.height, `/community/${fx.groupId}`);
      await settled(stage, state, fx);
      await assertState(stage, state, fx);
      await assertActionAboveTabs(stage, state, fx, device.key);

      const frameEl = page.getByTestId('wsf-w9hp-frame');
      const box = (await frameEl.boundingBox())!;
      expect(Math.round(box.width), `${state} ${device.key}: frame width`).toBe(device.width);
      expect(Math.round(box.height), `${state} ${device.key}: frame height`).toBe(device.height + BANNER);
      await expect(page.getByTestId('wsf-w9hp-banner')).toHaveText(label);

      if (CAPTURE_FRAMES) {
        fs.mkdirSync(OUT, { recursive: true });
        // An injected failure says so in the filename, as every review package does.
        const name = state === 'stale' ? 'stale-INJECTED-PULSE-FAILURE' : state;
        await frameEl.screenshot({ path: path.join(OUT, `${STAGE}-home-${name}-${device.key}.png`) });
      }

      if (state === 'populated' && device.key === '390x844') {
        // The momentum section, brought up under the top bar the way a thumb would.
        const momentum = stage.getByTestId('wsf-community-momentum-card');
        await momentum.evaluate((el) => el.scrollIntoView({ block: 'center' }));
        await stage.locator('body').evaluate(() => new Promise((r) => setTimeout(r, 600)));
        await expect(stage.getByTestId('wsf-member-topbar'), 'scrolled: one top bar').toHaveCount(1);
        if (CAPTURE_FRAMES) {
          await frameEl.screenshot({ path: path.join(OUT, `${STAGE}-home-populated-scrolled-390x844.png`) });
        }
      }
    }
  } finally {
    await ctx.close();
  }
}

test.describe(`HOME-POLISH-1 · ${STAGE} captures of the community Home`, () => {
  for (const state of ['populated', 'quiet', 'privacy', 'stale'] as const) {
    test(`${state}`, async ({ browser }) => {
      test.setTimeout(240_000);
      await capture(browser, state);
    });
  }
});
