import { expect, test, type Browser, type Page } from '@playwright/test';

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
  GOAL_TZ,
  seedContribution,
  seedContributionAt,
  seedMembershipWithVisibility,
  zonedDayStartMs,
} from './sprint-w8-social-fixture';

/**
 * THE PRIVACY PROPERTIES, ASSERTED IN A REAL BROWSER.
 *
 * The callable suite proves what the server returns. This proves what reaches
 * the DOM — which is a different question, and the one a member's privacy
 * actually depends on. A name that is absent from the payload but present in a
 * hidden node, a uid serialised into a data attribute or a React prop blob, or
 * an identifier in the page's own markup would all pass a server-side test.
 *
 * These run in the ORDINARY suite, every time. The capture spec beside them is
 * opt-in evidence generation; this is the guard.
 */

type Fixture = {
  groupId: string;
  goalId: string;
  email: string;
  password: string;
  meUid: string;
  named: string;
  namePrivate: string;
  activityPrivate: string;
};

async function buildFixture(): Promise<Fixture> {
  const stamp = stampId();
  const groupId = `w8p-${stamp}`;
  const goalId = `w8pg-${stamp}`;
  const email = `w8p-${stamp}@example.com`;
  const password = 'Str0ng-Passw0rd!';
  const meUid = await seedVerifiedUser(email, password);
  await seedProfile(meUid, 'Viewing Member');

  const named = `w8p-named-${stamp}`;
  const namePrivate = `w8p-hidden-${stamp}`;
  const activityPrivate = `w8p-quiet-${stamp}`;

  await seedCommunity({
    groupId,
    displayName: 'Privacy Proof Community',
    joinPolicy: 'private',
    members: [{ uid: meUid, role: 'member' }],
  });
  // No visibility field at all — the real state of every membership today, and
  // the one the owner's default governs.
  await seedMembership(groupId, named, 'member');
  await seedMembershipWithVisibility(groupId, namePrivate, 'member', { name: 'private' });
  await seedMembershipWithVisibility(groupId, activityPrivate, 'member', {
    activity: 'private',
  });

  await seedProfile(named, 'Openly Named');
  await seedProfile(namePrivate, 'Secret Identity');
  await seedProfile(activityPrivate, 'Quiet Contributor');

  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: meUid,
    title: 'Privacy Proof Goal',
    target: 5000,
    unit: 'squats',
    total: 1200,
  });

  await seedContribution(groupId, goalId, named, 40, 30);
  await seedContribution(groupId, goalId, namePrivate, 25, 60);
  await seedContribution(groupId, goalId, activityPrivate, 15, 90);

  /*
    THE FIXTURE IS THE WORST CASE ON PURPOSE, because the viewport assertion
    below is only worth as much as the page it measures. Two more visible
    members push the presence row to its full five, and a SECOND community
    makes `otherCommunityCount` non-zero, which is what renders the `Switch`
    chip and makes the identity block its tallest. An earlier version of this
    fixture had one community and four members, the assertion passed, and the
    real capture — six members, two communities — still had the first momentum
    row below the fold. A guard that only holds for the easy case is worse than
    none, because it reports safety.
  */
  const extraA = `w8p-extra-a-${stamp}`;
  const extraB = `w8p-extra-b-${stamp}`;
  await seedMembership(groupId, extraA, 'foundingChampion');
  await seedMembership(groupId, extraB, 'member');
  await seedProfile(extraA, 'Another Champion');
  await seedProfile(extraB, 'Yet Another Member');

  await seedCommunity({
    groupId: `${groupId}-second`,
    displayName: 'A Second Community',
    joinPolicy: 'private',
    members: [{ uid: meUid, role: 'member' }],
  });

  return { groupId, goalId, email, password, meUid, named, namePrivate, activityPrivate };
}

/** Everything the page actually holds: markup, not just visible text. */
async function pageBlob(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.outerHTML);
}

/**
 * THE SAME PHONE THE AFTER CAPTURE USES.
 *
 * Matched deliberately: a plain 390x844 desktop context lays this page out
 * slightly differently from an emulated iPhone, and the viewport measurement
 * below is only meaningful if it measures the context the evidence was shot
 * in. The guard passed under a bare context while the capture came back with
 * the momentum card below the fold — the same page, measured on two different
 * phones.
 */
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function phone(browser: Browser, fx: Fixture, height = 844) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height },
    deviceScaleFactor: 2,
    userAgent: IPHONE_UA,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  await signInVia(page, fx.email, fx.password);
  return { ctx, page };
}

test('the community surface names only the visible, and never leaks a uid', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(120_000);
  const fx = await buildFixture();
  const { ctx, page } = await phone(browser, fx);
  try {
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 40_000 });
    /*
      WAIT FOR BOTH SOCIAL READS, NOT JUST THE FIRST.

      The directory and the activity feed are two independent round trips, and
      the presence row appears as soon as the directory lands. Capturing the DOM
      there raced the feed: the assertions read a page whose momentum rows had
      not arrived, and the run's verdict depended on which call won. Waiting for
      a momentum row too makes the measurement deterministic — and a privacy
      assertion that passes because data had not loaded yet is the worst kind of
      green.
    */
    await expect(page.getByTestId('wsf-presence-row')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-momentum-row').first()).toBeVisible({ timeout: 40_000 });

    const blob = await pageBlob(page);

    // The default resolves to visible.
    expect(blob).toContain('Openly Named');
    // An explicit private choice is absent from the DOCUMENT, not merely
    // hidden by a style.
    expect(blob).not.toContain('Secret Identity');
    /*
      The activity-private member has NO feed row, so their name never reaches
      this page — and note precisely why, because the reason is not that their
      name is private. It is not: they are listed in the directory and their
      initials are in the presence row above. The Community page simply renders
      initials rather than names, and the only place it prints a full name is a
      momentum row, which this member does not have.
    */
    expect(blob).not.toContain('Quiet Contributor');

    /*
      THE DIRECTOR'S VIEWPORT REQUIREMENT, AS A PERMANENT GUARD.

      The AFTER review asked that the first real momentum ROW be VISIBLE in the
      initial 390x844 viewport, not merely the card's top edge. Asserted here
      rather than re-checked by eye on every recapture: spacing drifts, and a
      screenshot proves it only for the day it was taken.

      MEASURED AGAINST THE TAB BAR, NOT AGAINST 844. The member tab bar FLOATS
      OVER the page rather than shortening it, so a row can sit at y=770 —
      inside the viewport by arithmetic — and be completely hidden behind the
      bar. An earlier version of this assertion compared against the viewport
      height, passed, and the capture came back with the row invisible under the
      tab bar. "Inside the viewport" and "visible" are different claims, and the
      Director asked for the second one.
    */
    /*
      THE WORST CASE IS PROVEN, NOT ASSUMED. The fixture seeds contributions
      inside the goal's own day, so the moved-today line MUST be on screen; if
      it ever stops rendering, this fixture has quietly become the easy case and
      the measurement below would be reporting safety for a shorter page than
      the one a member sees.
    */
    await expect(
      page.getByTestId('wsf-community-contributors-today'),
      'the fixture must produce the taller identity block it is measuring',
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('wsf-community-hero-switch')).toBeVisible();

    const firstRow = page.getByTestId('wsf-momentum-row').first();
    const box = (await firstRow.boundingBox())!;
    const tabBar = (await page.getByTestId('wsf-member-tabs').boundingBox())!;
    expect(
      box.y + box.height,
      'the first momentum row must be visible above the tab bar at 390x844',
    ).toBeLessThanOrEqual(tabBar.y);

    // NO UID ANYWHERE. Not in text, not in an attribute, not in a serialised
    // prop — this is the assertion a server-side test cannot make.
    for (const uid of [fx.named, fx.namePrivate, fx.activityPrivate, fx.meUid]) {
      expect(blob, `a uid reached the DOM: ${uid}`).not.toContain(uid);
    }
  } finally {
    await ctx.close();
  }
});

test('an anonymous momentum row keeps the amount and loses the identity', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(120_000);
  const fx = await buildFixture();
  const { ctx, page } = await phone(browser, fx);
  try {
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId('wsf-community-momentum-card')).toBeVisible({
      timeout: 40_000,
    });
    const card = page.getByTestId('wsf-community-momentum-card');
    const text = (await card.innerText()).replace(/\s+/g, ' ');

    // The name-private member's CONTRIBUTION is still represented, anonymously.
    expect(text).toContain('Anonymous member');
    expect(text).toContain('25');
    expect(text).not.toContain('Secret Identity');

    // The activity-private member has no row at all.
    expect(text).not.toContain('15 squats');
  } finally {
    await ctx.close();
  }
});

test('turning a name off removes it from activity that already happened', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(150_000);
  const fx = await buildFixture();
  // This member's own contribution, made while visible by default.
  await seedContribution(fx.groupId, fx.goalId, fx.meUid, 55, 10);

  const { ctx, page } = await phone(browser, fx);
  try {
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId('wsf-community-momentum-card')).toBeVisible({
      timeout: 40_000,
    });
    expect(await pageBlob(page)).toContain('Viewing Member');

    // Turn the name off through the real settings screen.
    await page.goto('/settings/privacy');
    await expect(page.getByTestId('wsf-privacy-screen')).toBeVisible({ timeout: 40_000 });
    const toggle = page.getByTestId(`wsf-privacy-panel-name-${fx.groupId}`);
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    /*
      WAIT FOR THE SETTLED VALUE ON THE SWITCH ITSELF. The privacy panel is now
      W4's CommunityPrivacyPanelView (COMMUNITY-SETTINGS-PARITY-1), whose switch
      carries `aria-checked` from the STORED value only -- the route adopts the
      server's settled answer and renders nothing optimistic -- so its turning
      false is proof the write landed. (The old react-native-web Switch carried
      no aria-checked on this node, and this test waited on a consequence note
      the accepted panel no longer draws.)
    */
    await expect(toggle).toHaveAttribute('aria-checked', 'false', { timeout: 20_000 });

    // The OLD contribution is now anonymous: current preference governs history.
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId('wsf-community-momentum-card')).toBeVisible({
      timeout: 40_000,
    });
    const after = await pageBlob(page);
    expect(after).not.toContain('Viewing Member');
    expect(after).toContain('Anonymous member');
  } finally {
    await ctx.close();
  }
});

test('the members directory refuses a non-member and leaks nothing to them', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(120_000);
  const fx = await buildFixture();
  const stranger = stampId();
  const strangerEmail = `w8p-stranger-${stranger}@example.com`;
  const password = 'Str0ng-Passw0rd!';
  const strangerUid = await seedVerifiedUser(strangerEmail, password);
  await seedProfile(strangerUid, 'A Stranger');

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const page = await ctx.newPage();
    await signInVia(page, strangerEmail, password);
    await page.goto(`/community/${fx.groupId}/members`);
    // The page loads; the directory does not.
    await expect(page.getByTestId('wsf-members-failed')).toBeVisible({ timeout: 40_000 });
    const blob = await pageBlob(page);
    for (const name of ['Openly Named', 'Secret Identity', 'Quiet Contributor']) {
      expect(blob, `${name} reached a non-member`).not.toContain(name);
    }
  } finally {
    await ctx.close();
  }
});

/**
 * THE ZERO / NULL SEPARATION, PINNED IN BOTH DIRECTIONS.
 *
 * A PROVEN ZERO IS DATA AND A NULL IS SILENCE, and the whole point is that the
 * interface distinguishes them. A one-sided test would pass against a build
 * that rendered the line always, or one that rendered it never — so both cases
 * are asserted, on the same screen, with the same fixture shape.
 *
 * Neither case is contrived: zero is a live goal on a day nobody has moved yet,
 * and null is a goal whose stored zone cannot be resolved, which is one of the
 * four conditions the server refuses to guess from.
 */
async function buildDayFixture(opts: { timezone?: string }): Promise<Fixture> {
  const stamp = stampId();
  const groupId = `w8z-${stamp}`;
  const goalId = `w8zg-${stamp}`;
  const email = `w8z-${stamp}@example.com`;
  const password = 'Str0ng-Passw0rd!';
  const meUid = await seedVerifiedUser(email, password);
  await seedProfile(meUid, 'Day Window Member');
  const mover = `w8z-mover-${stamp}`;

  await seedCommunity({
    groupId,
    displayName: 'Day Window Community',
    joinPolicy: 'private',
    members: [{ uid: meUid, role: 'member' }],
  });
  await seedMembership(groupId, mover, 'member');
  await seedProfile(mover, 'Yesterday Mover');

  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: meUid,
    title: 'Day Window Goal',
    target: 5000,
    unit: 'squats',
    total: 1200,
    timezone: opts.timezone,
  });

  /*
    REAL MOVEMENT, DELIBERATELY OUTSIDE THE GOAL'S CURRENT LOCAL DAY — two hours
    before it began. The feed still has rows to show, so the momentum card
    renders either way and the ONLY thing under test is the count line. Seeded
    through the unclamped writer precisely because the clamped one exists to
    stop this happening by accident.
  */
  const dayStart = zonedDayStartMs(GOAL_TZ);
  await seedContributionAt(groupId, goalId, mover, 30, dayStart - 2 * 60 * 60_000);

  return {
    groupId,
    goalId,
    email,
    password,
    meUid,
    named: mover,
    namePrivate: mover,
    activityPrivate: mover,
  };
}

test('a PROVEN zero renders the line: "0 people moved today"', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(120_000);
  const fx = await buildDayFixture({});
  const { ctx, page } = await phone(browser, fx);
  try {
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId('wsf-community-momentum-card')).toBeVisible({
      timeout: 40_000,
    });
    // The feed proves the read succeeded and simply found nothing inside today.
    await expect(page.getByTestId('wsf-momentum-row').first()).toBeVisible({
      timeout: 40_000,
    });
    const line = page.getByTestId('wsf-community-contributors-today');
    await expect(line).toBeVisible({ timeout: 20_000 });
    await expect(line).toHaveText('0 people moved today');
  } finally {
    await ctx.close();
  }
});

test('an UNESTABLISHED count renders nothing at all', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(120_000);
  // A goal whose stored zone cannot be resolved: the server refuses to guess a
  // day from it, so the count is null rather than zero.
  const fx = await buildDayFixture({ timezone: 'Not/AZone' });
  const { ctx, page } = await phone(browser, fx);
  try {
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId('wsf-community-momentum-card')).toBeVisible({
      timeout: 40_000,
    });
    await expect(page.getByTestId('wsf-momentum-row').first()).toBeVisible({
      timeout: 40_000,
    });
    /*
      The same screen, the same feed, and NO line. Asserted after the feed has
      arrived, so this cannot pass merely because the page had not finished
      loading — which is the way a negative assertion usually lies.
    */
    await expect(page.getByTestId('wsf-community-contributors-today')).toHaveCount(0);
  } finally {
    await ctx.close();
  }
});
