import path from 'node:path';

import { expect, test, type Browser } from '@playwright/test';

import {
  seedActiveGoal,
  seedCommunity,
  seedMembership,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';
import {
  seedContribution,
  seedMembershipWithVisibility,
} from './sprint-w8-social-fixture';

/**
 * ACTUAL IMPLEMENTATION AFTER for the social/community presence lane.
 *
 * REAL SCREENSHOTS OF THE RUNNING PRODUCT. Nothing here is drawn, no frame
 * carries a concept or proposal banner, and every name, amount and count on
 * screen came out of the emulator through the real callables. The fixture below
 * is seeded the way the product writes — memberships with NO visibility field
 * where the member never chose (which is the real state of every row in the
 * product today) and an explicit `'private'` only where somebody chose it.
 */
const OUT = path.resolve(
  __dirname,
  '../../../docs/design-target/review/community-presence/after',
);

/*
  OPT-IN. This spec's product is PNGs in docs/, not an assertion about
  behaviour. The behaviour these screens must have is asserted in
  sprint-w8-social-privacy.spec.ts and in the callable suite, both of which run
  every time. Set WSF_CAPTURE_FRAMES=1 to regenerate the frames deliberately.
*/
const CAPTURE_FRAMES = /^(1|true)$/i.test(process.env.WSF_CAPTURE_FRAMES ?? '');

test.skip(
  !CAPTURE_FRAMES,
  'Frame capture is evidence generation; set WSF_CAPTURE_FRAMES=1 to regenerate it.',
);

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

test('the social surfaces, as the product actually renders them', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(300_000);

  const stamp = stampId();
  const groupId = `w8after-${stamp}`;
  const goalId = `w8goal-${stamp}`;
  const email = `w8after-${stamp}@example.com`;
  const password = 'Str0ng-Passw0rd!';

  // The member who will be looking at these screens.
  const meUid = await seedVerifiedUser(email, password);
  await seedProfile(meUid, 'Devin Simpson');

  /*
    THE COMMUNITY, AND WHY ITS PEOPLE ARE SHAPED THIS WAY.

    Five other members, every one of them a real seeded profile:
      · Dana is the Champion, so the role pill has something true to say;
      · three carry NO visibility field at all — the real state of every
        membership in the product today, and the one the owner's default
        governs;
      · Priya chose `name: 'private'`, so she is counted everywhere and named
        nowhere;
      · Tom chose `activity: 'private'`, so his contribution moves the shared
        total and never appears as a row.
  */
  const dana = `w8-dana-${stamp}`;
  const marcus = `w8-marcus-${stamp}`;
  const leah = `w8-leah-${stamp}`;
  const priya = `w8-priya-${stamp}`;
  const tom = `w8-tom-${stamp}`;

  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid: meUid, role: 'member' }],
  });
  await seedMembership(groupId, dana, 'foundingChampion');
  await seedMembership(groupId, marcus, 'member');
  await seedMembership(groupId, leah, 'member');
  await seedMembershipWithVisibility(groupId, priya, 'member', { name: 'private' });
  await seedMembershipWithVisibility(groupId, tom, 'member', { activity: 'private' });

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
    target: 5000,
    unit: 'squats',
    total: 1847,
  });

  // Movement today, from four different people. Tom's is seeded deliberately:
  // it must NOT appear as a row while still being a real contribution.
  await seedContribution(groupId, goalId, marcus, 40, 55);
  await seedContribution(groupId, goalId, priya, 25, 180);
  await seedContribution(groupId, goalId, dana, 60, 300);
  await seedContribution(groupId, goalId, tom, 15, 90);

  // A second community, so the privacy screen shows what it is actually for:
  // one member, different answers, per community.
  const workGroupId = `w8work-${stamp}`;
  await seedCommunity({
    groupId: workGroupId,
    displayName: 'Westside Lunch Crew',
    joinPolicy: 'private',
    members: [{ uid: meUid, role: 'member' }],
  });
  await seedMembershipWithVisibility(workGroupId, meUid, 'member', {
    name: 'private',
    activity: 'visible',
  });

  const shots: { key: string; width: number; height: number; go: string; wait: string }[] = [
    { key: 'community-390x844', width: 390, height: 844, go: `/community/${groupId}`, wait: 'wsf-community' },
    { key: 'community-390x640', width: 390, height: 640, go: `/community/${groupId}`, wait: 'wsf-community' },
    { key: 'members-390x844', width: 390, height: 844, go: `/community/${groupId}/members`, wait: 'wsf-members-panel' },
    { key: 'members-390x640', width: 390, height: 640, go: `/community/${groupId}/members`, wait: 'wsf-members-panel' },
    { key: 'settings-privacy-390x844', width: 390, height: 844, go: '/settings/privacy', wait: 'wsf-privacy-screen' },
    { key: 'settings-privacy-390x640', width: 390, height: 640, go: '/settings/privacy', wait: 'wsf-privacy-screen' },
    { key: 'settings-390x844', width: 390, height: 844, go: '/settings', wait: 'wsf-settings-screen' },
    { key: 'you-390x844', width: 390, height: 844, go: '/you', wait: 'wsf-you' },
  ];

  for (const shot of shots) {
    const ctx = await browser.newContext({
      viewport: { width: shot.width, height: shot.height },
      deviceScaleFactor: 2,
      userAgent: IPHONE_UA,
      isMobile: true,
      hasTouch: true,
    });
    try {
      const page = await ctx.newPage();
      await signInVia(page, email, password);
      await page.goto(shot.go);
      await expect(page.getByTestId(shot.wait)).toBeVisible({ timeout: 40_000 });
      // The social reads are a second round trip after the page paints; the
      // Living WE is an image. Let both settle before the shutter, or the
      // evidence shows a screen mid-arrival that no member ever sees.
      await page.waitForTimeout(3000);
      await page.screenshot({ path: path.join(OUT, `AFTER-${shot.key}.png`) });
    } finally {
      await ctx.close();
    }
  }
});
