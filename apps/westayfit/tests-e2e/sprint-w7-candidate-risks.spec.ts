import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

import {
  FIRESTORE_EMULATOR,
  PROJECT_ID,
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
  visibleCount,
} from './helpers/mobile';

/**
 * W7 — TWO PRODUCT RISKS ON THE COMBINED CANDIDATE `9f27c6ea`, raised by a
 * read-only adversarial review of W7's combined check and MEASURED here. They
 * are outside the routed M5 / exits contracts, which pass; each test asserts
 * what a member should get, so a failure is a measured finding for L0 and the
 * Director, not a claim about the routed items.
 *
 *   R1  M5'S NEGATIVE PATH. A first-community member presses Create, then
 *       "Back to home" while the create is in flight; the create commits.
 *       M5 correctly does not navigate them. Does anything tell them the
 *       community exists — or does Home, read before the commit, still offer
 *       "Start a community", opening a blank form and a silent second
 *       community? R1b records what browser Back shows instead.
 *   R2  A WARM "BACK TO HOME". From the member's mounted Community, a goal
 *       whose screen fails to load offers "Back to home". Does the member come
 *       back to the Community they left, or to a second, freshly mounted one
 *       with the first kept hidden beneath it?
 *
 * MEASURED (QA report, Check 16):
 *
 *   test   9f27c6ea (candidate)                     6c98f485 (W4 5c28e45 route, old exits)
 *   R1     FAIL: Home offers "Start a community";   pass: the late success moved the
 *          the blank form made a SECOND community   member into the new community
 *   R1b    FAIL: "We couldn't open it               FAIL: the same card sentence
 *          automatically." (pre-existing copy)
 *   R2     FAIL: 2 Community roots, 1 tab bar       FAIL: 2 Community roots, 2 tab bars
 *
 * So R1 is introduced by the candidate's M5 fix (a trade: no yank, but no
 * sign of the new community either); R1b's copy and R2's second Community
 * are pre-existing, and R2 is narrower on the candidate (one tab bar).
 */

test.use({ viewport: { width: 390, height: 844 } });

const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const CREATE = '**/wsfCreateCommunity';

async function member(tag: string) {
  const id = stampId();
  const email = `w7rk-${tag}-${id}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Robin Vale');
  return { id, email, password, uid };
}

async function communitiesOf(uid: string): Promise<string[]> {
  const res = await fetch(`${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`, {
    method: 'POST',
    headers: OWNER,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'wsfCommunityGroups' }],
        where: { fieldFilter: { field: { fieldPath: 'createdByUserId' }, op: 'EQUAL', value: { stringValue: uid } } },
      },
    }),
  });
  if (!res.ok) throw new Error(`runQuery refused: ${res.status}`);
  const rows = (await res.json()) as Array<{ document?: { fields?: { displayName?: { stringValue?: string } } } }>;
  return rows.filter((r) => r.document).map((r) => r.document!.fields?.displayName?.stringValue ?? '');
}

/** Hold every create until released; count them. */
async function holdCreates(page: Page): Promise<{ count: () => number; release: () => void }> {
  let n = 0;
  let open: () => void = () => {};
  const gate = new Promise<void>((r) => {
    open = r;
  });
  await page.route(CREATE, async (route: Route) => {
    if (route.request().method() !== 'POST') return route.continue();
    n += 1;
    await gate;
    await route.continue().catch(() => undefined);
  });
  return { count: () => n, release: () => open() };
}

async function leaveMidCreate(page: Page, name: string) {
  const me = await member('r1');
  await signInVia(page, me.email, me.password);
  await page.goto('/');
  await expect(page.getByTestId('wsf-home-start').last()).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wsf-home-start').last().click();
  await expect(page.getByTestId('wsf-start-name')).toBeVisible({ timeout: 25_000 });
  const creates = await holdCreates(page);
  await page.getByTestId('wsf-start-name').fill(name);
  await page.getByTestId('wsf-start-submit').click();
  await page.waitForTimeout(400);
  await page.getByTestId('wsf-start-back').click();
  await page.waitForURL((u) => u.pathname === '/', { timeout: 20_000 });
  await expect(page.getByTestId('wsf-home-start').last()).toBeVisible({ timeout: 20_000 });
  creates.release();
  await page.waitForTimeout(4_000);
  return { me, creates };
}

test.describe('Candidate risks, measured', () => {
  test('R1 after leaving mid-create, the member is told the community exists before a blank form can make a second', async ({ page }) => {
    test.setTimeout(300_000);
    const { me, creates } = await leaveMidCreate(page, 'W7 Risk First');
    const committed = await communitiesOf(me.uid);
    const home = {
      path: new URL(page.url()).pathname,
      startOffered: await visibleCount(page, 'wsf-home-start'),
      listShowsIt: await page.locator('[data-testid="wsf-home-my-list"]:visible').filter({ hasText: 'W7 Risk First' }).count(),
    };
    test.info().annotations.push({ type: 'Home after the commit', description: JSON.stringify({ ...home, committed, creates: creates.count() }) });
    expect(committed, 'precondition: the create committed once').toEqual(['W7 Risk First']);

    // What a member does next on this Home: press its primary.
    let afterStart: Record<string, unknown> = { pressed: false };
    if (home.startOffered > 0) {
      await page.getByTestId('wsf-home-start').last().click();
      await expect(page.locator('[data-testid="wsf-start-name"]:visible')).toBeVisible({ timeout: 25_000 });
      afterStart = {
        pressed: true,
        nameValue: await page.locator('[data-testid="wsf-start-name"]:visible').inputValue(),
        createdCardVisible: await visibleCount(page, 'wsf-start-created'),
        retryNoteVisible: await visibleCount(page, 'wsf-start-retry-note'),
        submitText: (await page.locator('[data-testid="wsf-start-submit"]:visible').innerText()).trim(),
      };
    }
    test.info().annotations.push({ type: 'after pressing Start a community', description: JSON.stringify(afterStart) });

    // THE PROPERTY: before a blank form can make a second community, the member
    // has been shown the first — on Home, or as a created card on the form.
    const told = home.listShowsIt > 0 || home.startOffered === 0 || (afterStart.createdCardVisible as number) > 0;
    expect.soft(told, `the member was not told their community exists; Home offers a blank "Start a community": ${JSON.stringify({ home, afterStart })}`).toBe(true);

    // And the consequence, carried through: the blank form makes a second one.
    if (afterStart.pressed && !told) {
      await page.unroute(CREATE);
      await page.locator('[data-testid="wsf-start-name"]:visible').fill('W7 Risk Second');
      await page.locator('[data-testid="wsf-start-submit"]:visible').click();
      await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toMatch(/^\/community\//);
      const after = await communitiesOf(me.uid);
      test.info().annotations.push({ type: 'communities after the blank form', description: JSON.stringify(after) });
      expect.soft(after, 'a second community was created without the member being told the first exists').toHaveLength(1);
    }
  });

  test('R1b the same journey, then browser Back: what the member sees', async ({ page }) => {
    test.setTimeout(300_000);
    const { me } = await leaveMidCreate(page, 'W7 Risk Back');
    await page.goBack();
    await page.waitForTimeout(2_000);
    const seen = {
      path: new URL(page.url()).pathname,
      createdVisible: await visibleCount(page, 'wsf-start-created'),
      body: (await page.locator('[data-testid="wsf-start-created"]:visible').innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
    };
    test.info().annotations.push({ type: 'after Back', description: JSON.stringify(seen) });
    // Recorded, then the one assertion this step supports: nothing on screen
    // may say the app tried and failed to open a community it chose not to open.
    expect(await communitiesOf(me.uid)).toHaveLength(1);
    expect(seen.body, 'the card says the app could not open the community, which on this path it did not try to do').not.toMatch(/couldn.t open it automatically/i);
  });

  test('R2 a warm "Back to home" returns to the Community the member left, not a second one', async ({ page }) => {
    test.setTimeout(300_000);
    const me = await member('r2');
    const groupId = `w7rk-r2-${me.id}`;
    const goalId = `w7rkg-r2-${me.id}`;
    await seedCommunity({ groupId, displayName: 'W7 Risk Movers', joinPolicy: 'private', members: [{ uid: me.uid, role: 'member' }] });
    await seedActiveGoal({ goalId, groupId, ownerUid: me.uid, title: 'W7 Risk Squats', target: 5000, unit: 'squats', total: 100 });
    await signInVia(page, me.email, me.password);
    await page.goto('/');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000 }).toBe(`/community/${groupId}`);
    await expect(page.locator(`[data-testid="wsf-community-goal-link-${goalId}"]:visible`).first()).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(3_000);
    await page.evaluate(() => {
      const shown = Array.from(document.querySelectorAll('[data-testid="wsf-community"]')).find((el) => (el as HTMLElement).offsetParent !== null) as HTMLElement;
      shown.setAttribute('data-w7-risk', 'kept');
    });
    // The goal's screen fails to load, so it offers "Back to home".
    await page.route('**/wsfGoalPulse', (route: Route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { status: 'INTERNAL', message: 'INTERNAL' } }) })
        : route.continue(),
    );
    await page.getByTestId(`wsf-community-goal-link-${goalId}`).last().click();
    const home = page.locator('[data-testid="wsf-contribute-home"]:visible').first();
    await expect(home).toBeVisible({ timeout: 40_000 });
    await page.unroute('**/wsfGoalPulse');
    await home.click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 40_000 }).toBe(`/community/${groupId}`);
    await page.waitForTimeout(1_500);
    const r = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll('[data-testid="wsf-community"]')) as HTMLElement[];
      const shown = all.filter((el) => el.offsetParent !== null);
      return {
        roots: all.length,
        visible: shown.length,
        visibleIsTheOneLeft: shown.length === 1 && shown[0]!.getAttribute('data-w7-risk') === 'kept',
        hiddenKept: all.some((el) => el.offsetParent === null && el.getAttribute('data-w7-risk') === 'kept'),
        tabBars: document.querySelectorAll('[data-testid="wsf-member-tabs"]').length,
      };
    });
    test.info().annotations.push({ type: 'after the warm Back to home', description: JSON.stringify(r) });
    expect(r.tabBars, 'one tab bar').toBe(1);
    expect(r.roots, 'a second Community screen was mounted, the one left kept hidden beneath it').toBe(1);
    expect(r.visibleIsTheOneLeft, 'the Community on show is not the one the member left').toBe(true);
  });
});
