import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

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
 * ACTUAL IMPLEMENTATION AFTER for `/community`.
 *
 * Real screenshots of the running product with the slice applied. These are
 * NOT targets: nothing here is drawn, and no frame carries a concept banner.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/page-03-community/after');

/*
  OPT-IN, LIKE THE BEFORE CAPTURE, AND FOR THE SAME REASON.

  This spec's product is PNGs in docs/, not an assertion about behaviour. Run
  in the ordinary suite it rewrote the AFTER evidence on every verification
  pass and — rendering 23 phone frames and driving seven browser contexts
  against the shared emulator — starved timing-sensitive specs elsewhere until
  the set of failures wandered between runs. The behaviour this screen must
  have is asserted in community-list.spec.ts, which does run every time.

  Set WSF_CAPTURE_FRAMES=1 to regenerate the frames deliberately.
*/
const CAPTURE_FRAMES = /^(1|true)$/i.test(process.env.WSF_CAPTURE_FRAMES ?? '');

test.skip(
  !CAPTURE_FRAMES,
  'Frame capture is evidence generation; set WSF_CAPTURE_FRAMES=1 to regenerate it.',
);

const CLASSES = [
  { key: '390x844', viewport: { width: 390, height: 844 } },
  { key: '390x640', viewport: { width: 390, height: 640 } },
  { key: '430x932', viewport: { width: 430, height: 932 } },
] as const;

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

/**
 * The shutter. Every frame must be the arrival state, at the top, with every
 * interactive control reachable clear of the shell — the two defects the Page
 * 2 gate sent back, asserted here rather than re-learned.
 */
async function shot(page: Page, name: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.waitForTimeout(500);

  const offsets = await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll('*').forEach((el) => {
      if (el instanceof HTMLElement && el.scrollTop > 0) el.scrollTop = 0;
    });
    const stuck: number[] = [];
    document.querySelectorAll('*').forEach((el) => {
      if (el instanceof HTMLElement && el.scrollTop > 0) stuck.push(el.scrollTop);
    });
    return { window: window.scrollY, stuck };
  });
  expect(offsets.window, `${name}: the window is still scrolled`).toBe(0);
  expect(offsets.stuck, `${name}: a scroll container did not reset`).toEqual([]);

  const title = await page.getByTestId('wsf-community-index-title').boundingBox();
  expect(title, `${name}: the page title is not rendered`).not.toBeNull();
  expect(title!.y, `${name}: the frame is not the arrival state`).toBeGreaterThanOrEqual(0);

  await assertEverythingReachable(page, name);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

/**
 * Nothing on this screen may be permanently trapped under the shell.
 *
 * Content that ends at its own padding leaves the last control half-covered no
 * matter how far you scroll; that is the defect the measured bottom inset
 * fixes. Asserting instead that nothing crosses the bar line AT REST would
 * fail every scrollable screen and teach us to ignore it, so the rule is
 * reachability: each control must be able to come fully clear.
 */
async function assertEverythingReachable(page: Page, name: string) {
  const bar = await page.getByTestId('wsf-member-tabs').boundingBox();
  if (!bar) return;
  const move = await page.getByTestId('wsf-member-tab-move').boundingBox();
  const ceiling = Math.min(bar.y, move ? move.y : bar.y);

  const trapped = await page.evaluate((limit: number) => {
    const shell = document.querySelector('[data-testid="wsf-member-tabs"]');
    let slack = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
    document.querySelectorAll('*').forEach((el) => {
      if (el instanceof HTMLElement && el.scrollHeight > el.clientHeight + 1) {
        slack = Math.max(slack, el.scrollHeight - el.clientHeight - el.scrollTop);
      }
    });
    const hits: string[] = [];
    document
      .querySelectorAll('button, a, input, [role="button"], [role="link"]')
      .forEach((el) => {
        if (shell && shell.contains(el)) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        const overlap = r.bottom - limit;
        if (overlap > 0 && overlap > slack) {
          hits.push(`${(el.textContent ?? '').trim().slice(0, 40)} (+${Math.round(overlap)}px)`);
        }
      });
    return hits;
  }, ceiling);

  expect(trapped, `${name}: controls can never be scrolled clear of the shell`).toEqual([]);
}

/** Make a callable hang, so the real loading state can be photographed. */
async function stall(page: Page, callable: string) {
  await page.route(`**/${callable}`, async (route: Route) => {
    await new Promise((r) => setTimeout(r, 30_000));
    await route.abort();
  });
}

/** Make a callable fail outright. */
async function breakCallable(page: Page, callable: string) {
  await page.route(`**/${callable}`, (route: Route) => route.abort('failed'));
}

/**
 * Fail ONE community's goal read and let every other one through.
 *
 * This is the state the brief asks to see proved: a single failed enrichment
 * must not empty the screen. Matching on the request body is the only way to
 * single one out — every call goes to the same callable URL.
 */
async function breakGoalsFor(page: Page, groupId: string) {
  await page.route('**/wsfListGoals', async (route: Route) => {
    const body = route.request().postData() ?? '';
    if (body.includes(groupId)) return route.abort('failed');
    return route.fallback();
  });
}

for (const cls of CLASSES) {
  test(`community AFTER — ${cls.key}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const tag = `ca${cls.key.replace('x', '')}`;
    const fx = await seedThree(tag, { dressed: true });

    // ── several memberships, one already current ────────────────────────────
    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await page.evaluate(
        ([k, v]) => window.localStorage.setItem(k!, v!),
        [REMEMBER_KEY(fx.uid), fx.alpha],
      );
      await page.goto('/community');
      await expect(page.getByTestId('wsf-community-index-current')).toBeVisible({
        timeout: 40_000,
      });
      await expect(page.getByTestId('wsf-community-index-momentum')).toBeVisible();
      await shot(page, `AFTER-several-current-${cls.key}`);
      await context.close();
    }

    // ── several memberships, none chosen yet ────────────────────────────────
    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await page.evaluate((k) => window.localStorage.removeItem(k), REMEMBER_KEY(fx.uid));
      await page.goto('/community');
      await expect(page.getByTestId('wsf-community-index-choose')).toBeVisible({
        timeout: 40_000,
      });
      // The resolver returned null, so NOTHING may claim to be current.
      await expect(page.getByTestId('wsf-community-index-current')).toHaveCount(0);
      await shot(page, `AFTER-several-nocurrent-${cls.key}`);
      await context.close();
    }

    // ── one membership ──────────────────────────────────────────────────────
    {
      const one = await seedOne(`${tag}o`);
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, one.email, one.password);
      await page.goto('/community');
      await expect(page.getByTestId('wsf-community-index-current')).toBeVisible({
        timeout: 40_000,
      });
      await shot(page, `AFTER-one-${cls.key}`);
      await context.close();
    }

    // ── no memberships ──────────────────────────────────────────────────────
    {
      const nobody = await seedNobody(`${tag}n`);
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, nobody.email, nobody.password);
      await page.goto('/community');
      await expect(page.getByTestId('wsf-community-index-empty')).toBeVisible({ timeout: 40_000 });
      await shot(page, `AFTER-none-${cls.key}`);
      await context.close();
    }

    // The remaining states are captured once, at the reference size.
    if (cls.key !== '390x844') return;

    // ── loading ─────────────────────────────────────────────────────────────
    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await stall(page, 'wsfMyCommunities');
      await page.goto('/community');
      await expect(page.getByTestId('wsf-community-index-loading')).toBeVisible({
        timeout: 40_000,
      });
      await shot(page, `AFTER-loading-${cls.key}`);
      await context.close();
    }

    // ── one community's goals fail; the screen survives ─────────────────────
    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await page.evaluate(
        ([k, v]) => window.localStorage.setItem(k!, v!),
        [REMEMBER_KEY(fx.uid), fx.alpha],
      );
      await breakGoalsFor(page, fx.westside);
      await page.goto('/community');
      await expect(page.getByTestId('wsf-community-index-current')).toBeVisible({
        timeout: 40_000,
      });
      // The current community is intact; only the failed one says so.
      await expect(page.getByTestId('wsf-community-index-we')).toBeVisible();
      await expect(page.getByTestId(`wsf-community-index-row-${fx.westside}`)).toContainText(
        'Progress unavailable',
      );
      await shot(page, `AFTER-partial-failure-${cls.key}`);
      await context.close();
    }

    // ── the whole list fails ────────────────────────────────────────────────
    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, fx.email, fx.password);
      await breakCallable(page, 'wsfMyCommunities');
      await page.goto('/community');
      await expect(page.getByTestId('wsf-community-index-error')).toBeVisible({ timeout: 40_000 });
      await shot(page, `AFTER-failure-${cls.key}`);
      await context.close();
    }
  });
}

