import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

import {
  firestoreWrite,
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';

/**
 * ACTUAL CURRENT BEFORE for COMMUNITY — `/community` and `/community/[groupId]`.
 *
 * Real screenshots of the product as it renders today, so the Community target
 * can be compared against the thing it is actually replacing rather than
 * against a memory of it. These are NOT targets. Nothing here is drawn.
 *
 * Captured at dd608a8, before any Community target exists.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/page-03-community/before');

/**
 * `/community/[groupId]` IS HOME — `/` replaces to it, and it is Page 1,
 * already targeted and accepted. Its frames are captured for context and kept
 * apart from Community's own BEFORE, because a page's accepted AFTER filed as
 * another page's BEFORE is exactly the mislabelled evidence the frozen guard
 * exists to prevent.
 */
const OUT_CONTEXT = path.resolve(
  __dirname,
  '../../../docs/design-target/review/page-03-community/context-home-route',
);

/*
  OPT-IN, AND OFF BY DEFAULT — the same rule the Page 1 and Page 2 BEFOREs
  learned the hard way. A BEFORE is a photograph of the product as it was;
  a verification run of later code must never be able to rewrite it.
*/
const CAPTURE_BEFORE = /^(1|true)$/i.test(process.env.WSF_CAPTURE_BEFORE ?? '');

test.skip(
  !CAPTURE_BEFORE,
  'BEFORE frames are frozen evidence; set WSF_CAPTURE_BEFORE=1 to re-baseline them deliberately.',
);

/** The three device classes the visual gate asks for. */
const CLASSES = [
  { key: '390x844', viewport: { width: 390, height: 844 } },
  { key: '390x640', viewport: { width: 390, height: 640 } },
  { key: '430x932', viewport: { width: 430, height: 932 } },
] as const;

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

/**
 * A goal that is over. Written as a whole document rather than PATCHed onto an
 * active one: a partial Firestore PATCH with no updateMask REPLACES the doc,
 * which is how the Page 2 refusal frame came back the wrong kind.
 */
async function seedClosedGoal(opts: {
  goalId: string;
  groupId: string;
  ownerUid: string;
  title: string;
  target: number;
  unit: string;
  total: number;
  endedDaysAgo: number;
  reached: boolean;
}): Promise<void> {
  const ended = new Date(Date.now() - opts.endedDaysAgo * 24 * 60 * 60_000);
  await firestoreWrite(`wsfGoals/${opts.goalId}`, {
    ownerUid: { stringValue: opts.ownerUid },
    communityGroupId: { stringValue: opts.groupId },
    title: { stringValue: opts.title },
    target: { integerValue: String(opts.target) },
    unit: { stringValue: opts.unit },
    status: { stringValue: 'closed' },
    startsAt: tsField(new Date(ended.getTime() - 30 * 24 * 60 * 60_000)),
    endsAt: tsField(ended),
    closedAt: tsField(ended),
    ...(opts.reached ? { reachedAt: tsField(new Date(ended.getTime() - 2 * 60 * 60_000)) } : {}),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(new Date(ended.getTime() - 30 * 24 * 60 * 60_000)),
    updatedAt: tsField(ended),
  });
  await seedShards(opts.goalId, opts.total);
}

type Fixture = {
  email: string;
  password: string;
  uid: string;
  /** Alpharetta Morning Movers — an active goal, a second active goal, history. */
  richId: string;
  /** Sunrise Striders — no goal running. */
  bareId: string;
  /** Westside Walkers — closed goals only. */
  pastId: string;
};

/** One isolated fixture per device class, so no frame shares state with another. */
async function seed(label: string): Promise<Fixture> {
  const id = stampId();
  const email = `wsf-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin');

  const richId = `${label}rich-${id}`;
  await seedCommunity({
    groupId: richId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'inviteOnly',
    members: [{ uid, role: 'foundingChampion' }],
  });
  await seedActiveGoal({
    goalId: `${label}g1-${id}`,
    groupId: richId,
    ownerUid: uid,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });
  await seedActiveGoal({
    goalId: `${label}g2-${id}`,
    groupId: richId,
    ownerUid: uid,
    title: 'Step-ups round',
    target: 2000,
    unit: 'step-ups',
    total: 612,
  });
  await seedClosedGoal({
    goalId: `${label}g3-${id}`,
    groupId: richId,
    ownerUid: uid,
    title: 'September Push-up Push',
    target: 3000,
    unit: 'push-ups',
    total: 3142,
    endedDaysAgo: 21,
    reached: true,
  });

  const bareId = `${label}bare-${id}`;
  await seedCommunity({
    groupId: bareId,
    displayName: 'Sunrise Striders',
    joinPolicy: 'public',
    members: [{ uid, role: 'member' }],
  });

  const pastId = `${label}past-${id}`;
  await seedCommunity({
    groupId: pastId,
    displayName: 'Westside Walkers',
    joinPolicy: 'inviteOnly',
    members: [{ uid, role: 'member' }],
  });
  await seedClosedGoal({
    goalId: `${label}g4-${id}`,
    groupId: pastId,
    ownerUid: uid,
    title: 'Summer Step Streak',
    target: 100000,
    unit: 'steps',
    total: 104820,
    endedDaysAgo: 46,
    reached: true,
  });
  await seedClosedGoal({
    goalId: `${label}g5-${id}`,
    groupId: pastId,
    ownerUid: uid,
    title: 'Spring Lap Round',
    target: 800,
    unit: 'laps',
    total: 617,
    endedDaysAgo: 92,
    reached: false,
  });

  return { email, password, uid, richId, bareId, pastId };
}

/** A member of nothing at all — the zero-membership arrival. */
async function seedLonely(label: string) {
  const id = stampId();
  const email = `wsf-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Devin');
  return { email, password, uid };
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.waitForTimeout(600);
  const dir = name.includes('-detail-') ? OUT_CONTEXT : OUT;
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
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

/** Make one callable hang, so the real loading state can be photographed. */
async function stall(page: Page, callable: string) {
  await page.route(`**/${callable}`, async (route: Route) => {
    await new Promise((r) => setTimeout(r, 30_000));
    await route.abort();
  });
}

/** Make one callable fail, so the real failure state can be photographed. */
async function breakCallable(page: Page, callable: string) {
  await page.route(`**/${callable}`, (route: Route) => route.abort('failed'));
}

for (const cls of CLASSES) {
  test(`community BEFORE — ${cls.key}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seed(`cb${cls.key.replace('x', '')}`);

    // ── the list, with several memberships ──────────────────────────────────
    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await page.goto('/community');
      await expect(page.getByTestId('wsf-community-index-rows')).toBeVisible();
      await shot(page, `BEFORE-index-several-${cls.key}`);

      // Selecting one is how a member switches which community Home opens.
      await page.getByTestId(`wsf-community-index-row-${fx.richId}`).click();
      await expect(page.getByTestId('wsf-community')).toBeVisible();
      await shot(page, `BEFORE-detail-active-${cls.key}`);

      await page.goto(`/community/${fx.bareId}`);
      await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible();
      await shot(page, `BEFORE-detail-nogoal-${cls.key}`);

      await page.goto(`/community/${fx.pastId}`);
      await expect(page.getByTestId('wsf-community')).toBeVisible();
      await shot(page, `BEFORE-detail-history-${cls.key}`);
      await context.close();
    }

    // ── zero memberships ────────────────────────────────────────────────────
    {
      const lonely = await seedLonely(`cbz${cls.key.replace('x', '')}`);
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, lonely.email, lonely.password);
      await page.goto('/community');
      await expect(page.getByTestId('wsf-community-index-empty')).toBeVisible();
      await shot(page, `BEFORE-index-none-${cls.key}`);
      await context.close();
    }

    // The remaining states are captured once, at the reference size only.
    if (cls.key !== '390x844') return;

    // ── the list while it is still loading ──────────────────────────────────
    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await stall(page, 'wsfMyCommunities');
      await page.goto('/community');
      await expect(page.getByTestId('wsf-community-index-loading')).toBeVisible();
      await shot(page, `BEFORE-index-loading-${cls.key}`);
      await context.close();
    }

    // ── the list when it cannot be loaded ───────────────────────────────────
    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await breakCallable(page, 'wsfMyCommunities');
      await page.goto('/community');
      await expect(page.getByTestId('wsf-community-index-error')).toBeVisible();
      await shot(page, `BEFORE-index-error-${cls.key}`);
      await context.close();
    }

    // ── one membership only ─────────────────────────────────────────────────
    {
      const single = await seedLonely(`cbs${cls.key.replace('x', '')}`);
      await seedCommunity({
        groupId: `cbsolo-${stampId()}`,
        displayName: 'Alpharetta Morning Movers',
        joinPolicy: 'inviteOnly',
        members: [{ uid: single.uid, role: 'foundingChampion' }],
      });
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, single.email, single.password);
      await page.goto('/community');
      await expect(page.getByTestId('wsf-community-index-rows')).toBeVisible();
      await shot(page, `BEFORE-index-one-${cls.key}`);
      await context.close();
    }

    // ── a community whose goals cannot be loaded ────────────────────────────
    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await breakCallable(page, 'wsfListGoals');
      await page.goto(`/community/${fx.richId}`);
      await expect(page.getByTestId('wsf-community-goals-error')).toBeVisible();
      await shot(page, `BEFORE-detail-goals-error-${cls.key}`);
      await context.close();
    }
  });
}

