import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

import {
  PROJECT_ID,
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * ACTUAL IMPLEMENTATION AFTER for /move and /contribute/[goalId].
 *
 * Real screenshots of the running product with the slice applied, at the three
 * device classes the gate asks for. These are NOT targets: nothing here is
 * drawn, and no frame carries a concept banner.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/page-02-move/after');

/** The callable's emulator URL, for the two outcomes that need forcing. */
function callableUrl(name: string): string {
  return `http://127.0.0.1:5001/${PROJECT_ID}/us-central1/${name}`;
}

/**
 * Close a goal, changing ONLY its status.
 *
 * The shared `firestoreWrite` helper PATCHes with no updateMask, which
 * REPLACES the document -- the goal lost its communityGroupId and the refusal
 * came back `notMember` instead of `closed`. The frame was a real refusal of
 * the wrong kind, which is worse than no frame: it would have been filed as
 * evidence of a state it does not show.
 */
async function closeGoal(goalId: string): Promise<void> {
  const url =
    `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents/wsfGoals/${goalId}` +
    `?updateMask.fieldPaths=status`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: { status: { stringValue: 'closed' } } }),
  });
  if (!res.ok) throw new Error(`close ${goalId} failed: ${res.status} ${await res.text()}`);
}

const CLASSES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
  { key: '430x932', width: 430, height: 932 },
] as const;

async function seed(label: string) {
  const id = stampId();
  const email = `wsf-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin');
  const groupId = `${label}-${id}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'inviteOnly',
    members: [{ uid, role: 'foundingChampion' }],
  });
  const goalId = `${label}goal-${id}`;
  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });
  // A second open goal, so MOVE has to ask rather than guess. Counted in
  // `steps`, which the product actually has counting guidance for.
  const secondGoalId = `${label}goal2-${id}`;
  await seedActiveGoal({
    goalId: secondGoalId,
    groupId,
    ownerUid: uid,
    title: 'Step count week',
    target: 2000,
    unit: 'steps',
    total: 612,
  });
  return { email, password, groupId, goalId, secondGoalId };
}

/**
 * FIRST VIEWPORT, ALWAYS -- AND window.scrollTo IS NOT ENOUGH.
 *
 * Filling the amount field scrolls it into view, and the scroll that moves is
 * the React Native ScrollView's OWN element, not the window. Resetting the
 * window left the short phone captured mid-page while the README claimed every
 * frame was taken from the top. This resets every scrollable element on the
 * page and then PROVES the claim: the named top element must be within a few
 * pixels of the viewport top before the shutter fires.
 */
async function shot(page: Page, name: string) {
  const offsets = await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll('*').forEach((el) => {
      if (el instanceof HTMLElement && el.scrollTop > 0) el.scrollTop = 0;
    });
    // What is STILL scrolled after the reset. Anything here is a container
    // that refused to go back, which is the failure this guards against.
    const stuck: number[] = [];
    document.querySelectorAll('*').forEach((el) => {
      if (el instanceof HTMLElement && el.scrollTop > 0) stuck.push(el.scrollTop);
    });
    return { window: window.scrollY, stuck };
  });
  /*
    THE CLAIM IS "CAPTURED FROM THE TOP", so assert exactly that rather than a
    guessed y-coordinate for some element. The first attempt asserted the
    wordmark sat above y=24; it sits at 27 when the page IS at the top, because
    of the container's padding and the chrome row's own centring. A threshold
    picked by eye tests the threshold, not the thing.
  */
  expect(offsets.window, `${name}: the window is still scrolled`).toBe(0);
  expect(offsets.stuck, `${name}: a scroll container did not reset`).toEqual([]);
  // The Living WE is an image; let it decode before the shutter.
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

test('AFTER: the MOVE and contribution surfaces as implemented', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(420_000);

  for (const c of CLASSES) {
    /*
      A FRESH FIXTURE PER DEVICE CLASS.

      The first cut seeded once and ran the flow three times, so each class
      recorded 20 into the SAME goal: 390x844 showed "0 -> 20", 390x640 showed
      "20 -> 40", and the shared total drifted with them. Three frames of three
      different states cannot be compared as three sizes of one screen. Every
      class now gets its own community and goal, so all three start at 1,847
      and end at 1,867, and the only difference between the frames is the
      thing under review.
    */
    const fx = await seed(`aft2${c.key.replace(/\D/g, '')}`);
    const ctx = await browser.newContext({
      viewport: { width: c.width, height: c.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      reducedMotion: 'reduce',
    });
    try {
      const page = await ctx.newPage();
      await signInVia(page, fx.email, fx.password);

      // MOVE with more than one actionable goal: it asks rather than guesses.
      await page.goto('/move');
      await expect(page.getByTestId('wsf-move-choose')).toBeVisible({ timeout: 40_000 });
      await shot(page, `AFTER-move-choose-${c.key}`);

      await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=move`);
      await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({
        timeout: 40_000,
      });
      await shot(page, `AFTER-contribute-move-${c.key}`);

      await page.getByTestId('wsf-contribute-done').last().click();
      await expect(page.getByTestId('wsf-contribute-entry-screen').last()).toBeVisible({
        timeout: 20_000,
      });
      await page.getByTestId('wsf-contribute-entry').last().fill('20');
      await shot(page, `AFTER-contribute-entry-${c.key}`);

      await page.getByTestId('wsf-contribute-review').last().click();
      await expect(page.getByTestId('wsf-contribute-review-screen').last()).toBeVisible({
        timeout: 20_000,
      });
      await shot(page, `AFTER-contribute-review-${c.key}`);

      await page.getByTestId('wsf-contribute-submit').last().click();
      await expect(page.getByTestId('wsf-contribute-receipt').last()).toBeVisible({
        timeout: 40_000,
      });
      await shot(page, `AFTER-contribute-confirmed-${c.key}`);
    } finally {
      await ctx.close();
    }
  }
});

/**
 * THE TWO OUTCOMES THAT NEED FORCING.
 *
 * A passing test proves the logic; it does not show what the screen looks
 * like. Both of these are states a member can land in and neither was in the
 * evidence, so each is driven here the same way the torture specs drive it --
 * the response dropped for the unknown outcome, the goal closed underneath
 * the write for the refusal.
 */
test('AFTER: the unknown outcome and the definitive refusal', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(300_000);
  const c = CLASSES[0];

  // ---- the outcome nobody knows ------------------------------------------
  {
    const fx = await seed('aftu');
    const ctx = await browser.newContext({
      viewport: { width: c.width, height: c.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      reducedMotion: 'reduce',
    });
    try {
      const page = await ctx.newPage();
      await signInVia(page, fx.email, fx.password);
      await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`);
      await expect(page.getByTestId('wsf-contribute-entry-screen').last()).toBeVisible({
        timeout: 40_000,
      });
      await page.getByTestId('wsf-contribute-entry').last().fill('20');
      // The write leaves; the answer never comes back.
      await page.route(callableUrl('wsfContribute'), async (route: Route) => {
        await route.abort('failed');
      });
      await page.getByTestId('wsf-contribute-review').last().click();
      await page.getByTestId('wsf-contribute-submit').last().click();
      await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
      await shot(page, `AFTER-contribute-pending-${c.key}`);
    } finally {
      await ctx.close();
    }
  }

  // ---- the definitive refusal --------------------------------------------
  {
    const fx = await seed('aftr');
    const ctx = await browser.newContext({
      viewport: { width: c.width, height: c.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      reducedMotion: 'reduce',
    });
    try {
      const page = await ctx.newPage();
      await signInVia(page, fx.email, fx.password);
      await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`);
      await expect(page.getByTestId('wsf-contribute-entry-screen').last()).toBeVisible({
        timeout: 40_000,
      });
      await page.getByTestId('wsf-contribute-entry').last().fill('20');
      await page.getByTestId('wsf-contribute-review').last().click();
      await expect(page.getByTestId('wsf-contribute-review-screen').last()).toBeVisible({
        timeout: 20_000,
      });
      // The goal closes after Record is tapped and before the server runs it,
      // so the state at the tap is deterministic and the refusal is the real
      // server's, not a mocked one.
      await page.route(callableUrl('wsfContribute'), async (route: Route) => {
        await closeGoal(fx.goalId);
        await route.continue();
      });
      await page.getByTestId('wsf-contribute-submit').last().click();
      await expect(page.getByTestId('wsf-contribute-refused')).toBeVisible({ timeout: 40_000 });
      await shot(page, `AFTER-contribute-refused-${c.key}`);
    } finally {
      await ctx.close();
    }
  }
});

/**
 * MOVE with nothing open. Its own community, because the state is a property
 * of the community rather than of the member.
 */
test('AFTER: MOVE when nothing is running', async ({ browser }: { browser: Browser }) => {
  test.setTimeout(180_000);
  const id = stampId();
  const email = `wsf-aftq-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin');
  const groupId = `aftq-${id}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'inviteOnly',
    members: [{ uid, role: 'foundingChampion' }],
  });

  for (const c of CLASSES) {
    const ctx = await browser.newContext({
      viewport: { width: c.width, height: c.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
      timezoneId: 'America/New_York',
      reducedMotion: 'reduce',
    });
    try {
      const page = await ctx.newPage();
      await signInVia(page, email, password);
      await page.goto('/move');
      await expect(page.getByTestId('wsf-move-no-goal')).toBeVisible({ timeout: 40_000 });
      await shot(page, `AFTER-move-nogoal-${c.key}`);
    } finally {
      await ctx.close();
    }
  }
});
