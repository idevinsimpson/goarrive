import { randomBytes } from 'node:crypto';

import { expect, test, type Browser, type Route } from '@playwright/test';

import {
  firestoreWrite,
  seedActiveGoal,
  seedMembership,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * COMMUNITY (`/community`) — BEHAVIOUR.
 *
 * What the screen DOES, asserted on the running product: which community the
 * resolver picks, what choosing one actually changes, that a retry recovers
 * without a reload, and that no control exists for a route the product does
 * not have.
 *
 * Deliberately separate from the frame capture. Capture writes PNGs into
 * docs/ and is evidence generation, not verification; keeping the two in one
 * file meant every ordinary run paid for 23 rendered phone frames and rewrote
 * the AFTER evidence as a side effect. These assertions are cheap and belong
 * in every run.
 */
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/**
 * The movement tail, written the way `wsfContribute` writes it.
 *
 * `seedActiveGoal` seeds the counter shards but not this subcollection, which
 * only a real contribution creates — so the first capture run showed no
 * recent movement at all. That was the product being honest and the fixture
 * being wrong. The path, the two stored fields and the MINUTE-TRUNCATED `at`
 * all match `recentAdditionsRef` / `isoMinute` exactly; a tail seeded in any
 * other shape would be evidence of a screen reading data the product never
 * produces.
 */
async function seedRecentAddition(
  goalId: string,
  attemptId: string,
  amount: number,
  minutesAgo: number,
): Promise<void> {
  const ms = Date.now() - minutesAgo * 60_000;
  const at = new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
  await firestoreWrite(`wsfGoals/${goalId}/recentAdditions/${attemptId}`, {
    amount: { integerValue: String(amount) },
    at: { stringValue: at },
  });
}

/**
 * Extra active memberships, so `memberCount` is a real count of real rows.
 *
 * The count comes from an aggregate query over `wsfMemberships`, so these are
 * the same documents a real join writes — nothing about the number is faked
 * or passed in. A fixture with one member made every community read "1
 * member", which is true of the fixture and true of nothing else.
 */
async function seedCrowd(groupId: string, howMany: number): Promise<void> {
  // In parallel, not one at a time. Sequentially this is ~40 round trips per
  // fixture and it slowed the shared emulator enough to make two unrelated,
  // timing-sensitive specs fail in the full run while passing alone. The load
  // was mine even though the code was not, so the fixture is what changes.
  await Promise.all(
    Array.from({ length: howMany }, (_, i) =>
      seedMembership(groupId, `${groupId}-m${i}`, 'member'),
    ),
  );
}

/** The key `rememberCurrentCommunity()` writes. Set directly so a frame can
 *  start from "already chose one" without driving the UI to get there. */
const REMEMBER_KEY = (uid: string) => `wsf.currentCommunity.${uid}`;

type Fixture = {
  email: string;
  password: string;
  uid: string;
  alpha: string;
  sunrise: string;
  westside: string;
};

/** One isolated fixture per device class. Deterministic totals throughout. */
async function seedThree(label: string, opts: { dressed?: boolean } = {}): Promise<Fixture> {
  const dressed = opts.dressed ?? false;
  const id = stampId();
  const email = `wsf-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin');

  const alpha = `${label}alpha-${id}`;
  await seedCommunity({
    groupId: alpha,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'inviteOnly',
    members: [{ uid, role: 'foundingChampion' }],
  });
  await seedActiveGoal({
    goalId: `${label}g1-${id}`,
    groupId: alpha,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });
  await seedActiveGoal({
    goalId: `${label}g2-${id}`,
    groupId: alpha,
    ownerUid: uid,
    title: 'Step-ups round',
    target: 2000,
    unit: 'step-ups',
    total: 612,
  });

  if (dressed) await seedCrowd(alpha, 13);

  // A real movement tail on the community that will be current, so the strip
  // shows what the product would actually publish: amount, unit, minute.
  if (dressed) {
    await Promise.all([
      seedRecentAddition(`${label}g1-${id}`, `${label}a1`, 20, 4),
      seedRecentAddition(`${label}g1-${id}`, `${label}a2`, 50, 12),
      seedRecentAddition(`${label}g2-${id}`, `${label}a3`, 15, 31),
      seedRecentAddition(`${label}g1-${id}`, `${label}a4`, 30, 62),
    ]);
  }

  const sunrise = `${label}sun-${id}`;
  await seedCommunity({
    groupId: sunrise,
    displayName: 'Sunrise Striders',
    joinPolicy: 'public',
    members: [{ uid, role: 'member' }],
  });

  if (dressed) await seedCrowd(sunrise, 7);

  const westside = `${label}west-${id}`;
  await seedCommunity({
    groupId: westside,
    displayName: 'Westside Walkers',
    joinPolicy: 'inviteOnly',
    members: [{ uid, role: 'member' }],
  });
  if (dressed) await seedCrowd(westside, 22);
  await seedActiveGoal({
    goalId: `${label}g3-${id}`,
    groupId: westside,
    ownerUid: uid,
    title: 'Spring Lap Round',
    target: 800,
    unit: 'laps',
    total: 617,
  });

  return { email, password, uid, alpha, sunrise, westside };
}

async function seedOne(label: string) {
  const id = stampId();
  const email = `wsf-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin');
  const only = `${label}only-${id}`;
  await seedCommunity({
    groupId: only,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'inviteOnly',
    members: [{ uid, role: 'foundingChampion' }],
  });
  await seedActiveGoal({
    goalId: `${label}og-${id}`,
    groupId: only,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });
  await seedCrowd(only, 13);
  await seedRecentAddition(`${label}og-${id}`, `${label}b1`, 20, 4);
  await seedRecentAddition(`${label}og-${id}`, `${label}b2`, 50, 12);
  await seedRecentAddition(`${label}og-${id}`, `${label}b3`, 30, 62);
  return { email, password, uid, only };
}

async function seedNobody(label: string) {
  const id = stampId();
  const email = `wsf-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin');
  return { email, password, uid };
}

async function phone(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    userAgent: IPHONE_UA,
    timezoneId: 'America/New_York',
  });
  return { context, page: await context.newPage() };
}

test('choosing a community remembers it and opens that community Home', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await seedThree('cpick');
  const { context, page } = await phone(browser, { width: 390, height: 844 });
  await signInVia(page, fx.email, fx.password);
  await page.evaluate((k) => window.localStorage.removeItem(k), REMEMBER_KEY(fx.uid));
  await page.goto('/community');

  // Nothing is current, so the screen asks.
  await expect(page.getByTestId('wsf-community-index-choose')).toBeVisible({ timeout: 40_000 });

  await page.getByTestId(`wsf-community-index-row-${fx.westside}`).click();

  // It opened THAT community's Home...
  await expect(page).toHaveURL(new RegExp(`/community/${fx.westside}$`), { timeout: 30_000 });
  await expect(page.getByTestId('wsf-community')).toBeVisible({ timeout: 40_000 });

  // ...and remembered the choice, which is what makes it stick across a reload.
  const remembered = await page.evaluate((k) => window.localStorage.getItem(k), REMEMBER_KEY(fx.uid));
  expect(remembered).toBe(fx.westside);

  // Coming back, the chosen one is now the current one and nothing is asked.
  await page.goto('/community');
  await expect(page.getByTestId('wsf-community-index-current')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-community-index-current')).toContainText('Westside Walkers');
  await expect(page.getByTestId('wsf-community-index-choose')).toHaveCount(0);

  await context.close();
});

test('switching from the current community opens the one that was tapped', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await seedThree('cswit');
  const { context, page } = await phone(browser, { width: 390, height: 844 });
  await signInVia(page, fx.email, fx.password);
  await page.evaluate(
    ([k, v]) => window.localStorage.setItem(k!, v!),
    [REMEMBER_KEY(fx.uid), fx.alpha],
  );
  await page.goto('/community');
  await expect(page.getByTestId('wsf-community-index-current')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-community-index-current')).toContainText(
    'Alpharetta Morning Movers',
  );

  await page.getByTestId(`wsf-community-index-row-${fx.sunrise}`).click();
  await expect(page).toHaveURL(new RegExp(`/community/${fx.sunrise}$`), { timeout: 30_000 });
  const remembered = await page.evaluate((k) => window.localStorage.getItem(k), REMEMBER_KEY(fx.uid));
  expect(remembered).toBe(fx.sunrise);

  await context.close();
});

test('retry recovers the list without a reload', async ({ browser }) => {
  test.setTimeout(240_000);
  const fx = await seedThree('cretry');
  const { context, page } = await phone(browser, { width: 390, height: 844 });
  await signInVia(page, fx.email, fx.password);

  // Fail the first read only; let the retry through.
  let failed = false;
  await page.route('**/wsfMyCommunities', async (route: Route) => {
    if (!failed) {
      failed = true;
      return route.abort('failed');
    }
    return route.fallback();
  });

  await page.goto('/community');
  await expect(page.getByTestId('wsf-community-index-error')).toBeVisible({ timeout: 40_000 });

  await page.getByTestId('wsf-community-index-retry').click();
  await expect(page.getByTestId('wsf-community-index-rows')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-community-index-error')).toHaveCount(0);

  await context.close();
});

test('Start a community goes to the creation screen, from empty and from a list', async ({
  browser,
}) => {
  test.setTimeout(240_000);

  {
    const nobody = await seedNobody('cstart0');
    const { context, page } = await phone(browser, { width: 390, height: 844 });
    await signInVia(page, nobody.email, nobody.password);
    await page.goto('/community');
    await expect(page.getByTestId('wsf-community-index-empty')).toBeVisible({ timeout: 40_000 });

    // There is no join-by-code route, so there must be no Join control at all.
    await expect(page.getByRole('link', { name: 'Join a community' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Join a community' })).toHaveCount(0);

    await page.getByTestId('wsf-community-index-start').click();
    await expect(page).toHaveURL(/\/start-community$/, { timeout: 30_000 });
    await context.close();
  }

  {
    const one = await seedOne('cstart1');
    const { context, page } = await phone(browser, { width: 390, height: 844 });
    await signInVia(page, one.email, one.password);
    await page.goto('/community');
    await expect(page.getByTestId('wsf-community-index-rows')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByRole('link', { name: 'Join a community' })).toHaveCount(0);
    await page.getByTestId('wsf-community-index-start').click();
    await expect(page).toHaveURL(/\/start-community$/, { timeout: 30_000 });
    await context.close();
  }
});
