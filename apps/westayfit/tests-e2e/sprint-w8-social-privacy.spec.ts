import { expect, test, type Browser, type Page } from '@playwright/test';

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

async function seedMembershipWithVisibility(
  groupId: string,
  uid: string,
  role: 'foundingChampion' | 'member',
  vis: { name?: 'visible' | 'private'; activity?: 'visible' | 'private' },
): Promise<void> {
  const now = new Date();
  const fields: Record<string, unknown> = {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: role },
    membershipStatus: { stringValue: 'active' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  };
  if (vis.name) fields.communityNameVisibility = { stringValue: vis.name };
  if (vis.activity) fields.communityActivityVisibility = { stringValue: vis.activity };
  await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, fields as never);
}

async function seedContribution(
  groupId: string,
  goalId: string,
  uid: string,
  count: number,
  minutesAgo: number,
): Promise<void> {
  const attemptId = stampId();
  await firestoreWrite(`wsfContributions/${goalId}_${uid}_${attemptId}`, {
    goalId: { stringValue: goalId },
    attemptId: { stringValue: attemptId },
    userId: { stringValue: uid },
    count: { integerValue: String(count) },
    shardIndex: { integerValue: '0' },
    unit: { stringValue: 'squats' },
    communityGroupId: { stringValue: groupId },
    crossedTarget: { booleanValue: false },
    createdAt: tsField(new Date(Date.now() - minutesAgo * 60_000)),
  } as never);
}

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

  return { groupId, goalId, email, password, meUid, named, namePrivate, activityPrivate };
}

/** Everything the page actually holds: markup, not just visible text. */
async function pageBlob(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.outerHTML);
}

async function phone(browser: Browser, fx: Fixture) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
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
    // The social reads are a second round trip; wait for the row they produce.
    await expect(page.getByTestId('wsf-presence-row')).toBeVisible({ timeout: 40_000 });

    const blob = await pageBlob(page);

    // The default resolves to visible.
    expect(blob).toContain('Openly Named');
    // An explicit private choice is absent from the DOCUMENT, not merely
    // hidden by a style.
    expect(blob).not.toContain('Secret Identity');
    // Activity privacy hides the row; the name was never eligible anyway.
    expect(blob).not.toContain('Quiet Contributor');

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
    expect(text).toContain('A member');
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
    const toggle = page.getByTestId(`wsf-privacy-name-${fx.groupId}`);
    await expect(toggle).toBeVisible({ timeout: 20_000 });
    await toggle.click();
    /*
      WAIT FOR THE CONSEQUENCE COPY, NOT FOR THE SWITCH'S OWN ATTRIBUTE.
      react-native-web renders Switch as a div wrapper and puts no aria-checked
      on the node carrying the testID, so asserting it there waits forever on a
      control that did flip. The note below renders ONLY in the name-off +
      activity-on state, and the screen adopts the SETTLED server value rather
      than the requested one — so its appearance is proof the write landed,
      which is the thing actually worth waiting for.
    */
    await expect(page.getByTestId(`wsf-privacy-note-${fx.groupId}`)).toBeVisible({
      timeout: 20_000,
    });

    // The OLD contribution is now anonymous: current preference governs history.
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId('wsf-community-momentum-card')).toBeVisible({
      timeout: 40_000,
    });
    const after = await pageBlob(page);
    expect(after).not.toContain('Viewing Member');
    expect(after).toContain('A member');
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
