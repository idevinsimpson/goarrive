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
 *       Ruled a release BLOCKER (Director #365 `5803218763`), routed to W4.
 *       The test is the Director's proof contract: no yank (no history write
 *       into a community after the release, still on "/"); before a blank
 *       form can submit, the confirmed community is NAMED on screen (on
 *       top at its own centre: not "Start vanished", not "the path changed"),
 *       on Home or on Start's re-entry; one create request and one community
 *       until a deliberate second; R1b's "couldn't open it" copy not reused;
 *       and a deliberate second still creates one.
 *   R1m THE SAME JOURNEY OVER TIME (L0 #434 `5803105016` bound 4): Home at
 *       +4 s and +30 s, after a tab round trip, after a reload; requests.
 *       Preconditions only; the timeline is the measurement.
 *   R1acct THE ACCOUNT BOUND, a control for the R1 correction: after the same
 *       journey, sign out and in as another member INSIDE the app (no page
 *       load, so nothing held in memory is lost); nothing of the first
 *       account's community is SHOWN on Home, on Start or at any Back step.
 *       A hidden DOM copy is recorded, not asserted.
 *   R1b browser Back after the same journey: the card's copy.
 *   R2  A WARM "BACK TO HOME". From the member's mounted Community, a goal
 *       whose screen fails to load offers "Back to home". Does the member come
 *       back to the Community they left, or to a second, freshly mounted one
 *       with the first kept hidden beneath it?
 *
 * The harness settles Home's own read of the member's communities BEFORE the
 * create starts. Under three workers a slowed read once landed after the
 * commit and Home redirected into the new community by itself: a race with
 * Home's ordinary resolution, never seen serially. Run this file serially.
 *
 * MEASURED:
 *
 *   test    9f27c6ea (candidate)                     6c98f485 (W4 5c28e45 route, old exits)
 *   R1      FAIL: nothing names the community on      FAIL at no-yank (Check 16: the
 *           Home (still "Start a community") or on    late success moved the member
 *           Start's blank form; "/", 1 create         into the new community)
 *   R1m     +4 s and +30 s: "/", Start offered, not named, no Home re-read;
 *           after Progress → Home: the same; after a reload: Home opens the
 *           community and names it. 1 create, 1 community throughout
 *   R1acct  PASS: shown nowhere, Back ×2 stays on "/"; HELD in one unrendered
 *           wsf-start-summary node
 *   R1b     FAIL: "We couldn't open it automatically." (pre-existing copy,
 *           both builds)
 *   R2      FAIL: 2 Community roots, 1 tab bar      FAIL: 2 Community roots, 2 tab bars
 *
 * R1 is introduced by the candidate's M5 fix (a trade: no yank, but no
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
  // Home's read of the member's communities must have ANSWERED before the
  // create starts: that is the journey (Home read the list before the
  // commit). Otherwise a read slowed by load can land after the commit, and
  // Home resolves into the new community by its ordinary redirect, which is
  // not the late success acting. Seen once under three workers, never
  // serially.
  const homeRead = page.waitForResponse((r) => /\/us-central1\/wsfMyCommunities/.test(r.url()) && r.request().method() === 'POST', { timeout: 30_000 });
  await page.goto('/');
  await homeRead;
  await expect(page.getByTestId('wsf-home-start').last()).toBeVisible({ timeout: 30_000 });
  const homeReads: number[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/us-central1\/wsfMyCommunities/.test(r.url())) homeReads.push(Date.now());
  });
  await page.getByTestId('wsf-home-start').last().click();
  await expect(page.getByTestId('wsf-start-name')).toBeVisible({ timeout: 25_000 });
  const creates = await holdCreates(page);
  await page.getByTestId('wsf-start-name').fill(name);
  await page.getByTestId('wsf-start-submit').click();
  await page.waitForTimeout(400);
  await page.getByTestId('wsf-start-back').click();
  await page.waitForURL((u) => u.pathname === '/', { timeout: 20_000 });
  await expect(page.getByTestId('wsf-home-start').last()).toBeVisible({ timeout: 20_000 });
  const releasedAt = Date.now();
  creates.release();
  await page.waitForTimeout(4_000);
  return { me, creates, releasedAt, homeReadsSince: (t: number) => homeReads.filter((x) => x >= t).length };
}

/** Every pushState / replaceState, with its path and wall-clock time. */
async function traceHistory(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __w7h: Array<{ op: string; path: string; at: number }> };
    w.__w7h = [];
    for (const m of ['pushState', 'replaceState'] as const) {
      const orig = History.prototype[m];
      History.prototype[m] = function (this: History, ...a: [unknown, string, (string | URL | null)?]) {
        w.__w7h.push({ op: m, path: new URL(String(a[2] ?? ''), location.href).pathname, at: Date.now() });
        return orig.apply(this, a as never);
      };
    }
  });
}
async function historyOps(page: Page): Promise<Array<{ op: string; path: string; at: number }>> {
  return page.evaluate(() => (window as unknown as { __w7h?: Array<{ op: string; path: string; at: number }> }).__w7h?.slice() ?? []);
}

type Named = { shown: boolean; testId: string; body: string };
/**
 * Is `text` SHOWN to the member: the deepest element whose text contains it,
 * rendered, scrolled into view, and on top at its own centre. A screen kept
 * mounted but covered (the stack keeps them) does not count, and neither does
 * a DOM node the member cannot see. `body` is the text of the nearest
 * testID'd container, for the copy check.
 */
async function shownByName(page: Page, text: string): Promise<Named> {
  return page.evaluate((needle) => {
    const hits = Array.from(document.querySelectorAll('body *')).filter((el) => {
      if (!(el.textContent ?? '').includes(needle)) return false;
      return !Array.from(el.children).some((c) => (c.textContent ?? '').includes(needle));
    }) as HTMLElement[];
    for (const el of hits) {
      if (el.offsetParent === null || el.getClientRects().length === 0) continue;
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!top || !(el === top || el.contains(top) || top.contains(el))) continue;
      let box: HTMLElement | null = el;
      while (box && !box.dataset?.testid) box = box.parentElement;
      return { shown: true, testId: box?.dataset.testid ?? '-', body: (box?.innerText ?? el.innerText).replace(/\s+/g, ' ').trim() };
    }
    return { shown: false, testId: '-', body: '' };
  }, text);
}

/** Every DOM copy of `text` (shown or not), by the nearest testID and whether it is rendered. */
async function heldCopies(page: Page, text: string): Promise<Array<{ testId: string; screen: string; rendered: boolean }>> {
  return page.evaluate((needle) => {
    const deepest = Array.from(document.querySelectorAll('body *')).filter(
      (el) => (el.textContent ?? '').includes(needle) && !Array.from(el.children).some((c) => (c.textContent ?? '').includes(needle)),
    ) as HTMLElement[];
    return deepest.map((el) => {
      let box: HTMLElement | null = el;
      while (box && !box.dataset?.testid) box = box.parentElement;
      let screen: HTMLElement | null = el;
      while (screen && !(screen.dataset?.testid ?? '').match(/^wsf-(start|home|community)$|^wsf-start-/)) screen = screen.parentElement;
      return { testId: box?.dataset.testid ?? '-', screen: screen?.dataset.testid ?? '-', rendered: el.offsetParent !== null };
    });
  }, text);
}

/**
 * The deliberate second, by the ordinary routes a member has: a blank form
 * already on screen, else Home's "Start a community", else the route itself.
 * Returns whether an EMPTY name field was reached.
 */
async function startDeliberateSecond(page: Page): Promise<{ reached: boolean; via: string }> {
  const blank = async () =>
    (await visibleCount(page, 'wsf-start-name')) > 0 &&
    (await page.locator('[data-testid="wsf-start-name"]:visible').first().inputValue()) === '';
  if (await blank()) return { reached: true, via: 'the form on screen' };
  let via = 'the route';
  if (new URL(page.url()).pathname === '/' && (await visibleCount(page, 'wsf-home-start')) > 0) {
    await page.getByTestId('wsf-home-start').last().click();
    via = "Home's Start a community";
  } else {
    await page.goto('/start-community');
  }
  await page.locator('[data-testid="wsf-start-name"]:visible').first().waitFor({ timeout: 25_000 }).catch(() => undefined);
  return { reached: await blank(), via };
}

test.describe('Candidate risks, measured', () => {
  test('R1 after leaving mid-create, the confirmed community is named on screen before a blank form can make a second; no yank; a deliberate second still works', async ({ page }) => {
    test.setTimeout(300_000);
    await traceHistory(page);
    const NAME = 'W7 Risk First';
    const { me, creates, releasedAt } = await leaveMidCreate(page, NAME);
    const committed = await communitiesOf(me.uid);
    const opsSinceRelease = (await historyOps(page)).filter((o) => o.at >= releasedAt);
    const home = {
      elapsedMs: Date.now() - releasedAt,
      path: new URL(page.url()).pathname,
      startOffered: await visibleCount(page, 'wsf-home-start'),
      named: await shownByName(page, NAME),
    };
    test.info().annotations.push({ type: 'Home after the commit', description: JSON.stringify({ ...home, committed, creates: creates.count(), opsSinceRelease }) });
    expect(committed, 'precondition: the create committed once').toEqual([NAME]);
    expect(creates.count(), 'precondition: one create request').toBe(1);

    // M5 kept: the commit moved nobody. No history write to a community after
    // the release, and the member is still where they chose to go.
    expect(home.path, 'the late success moved the member off Home (the M5 yank)').toBe('/');
    expect(opsSinceRelease.filter((o) => o.path.startsWith('/community/')), 'the late success navigated into the community').toEqual([]);

    // Where the member is shown the community: on Home, or on Start's re-entry
    // before its blank form can submit. Pressing Start is what a member on
    // this Home does next if Home says nothing.
    let ack: (Named & { where: string }) | null = home.named.shown ? { ...home.named, where: 'home' } : null;
    let onStart: Record<string, unknown> = { pressed: false };
    if (!ack && home.startOffered > 0) {
      await page.getByTestId('wsf-home-start').last().click();
      await page.waitForURL((u) => u.pathname === '/start-community', { timeout: 25_000 });
      await page.waitForTimeout(2_500);
      const named = await shownByName(page, NAME);
      if (named.shown) ack = { ...named, where: 'start' };
      onStart = {
        pressed: true,
        named,
        blankFormVisible: await visibleCount(page, 'wsf-start-name'),
        nameValue: await page.locator('[data-testid="wsf-start-name"]:visible').first().inputValue().catch(() => null),
        createdCardVisible: await visibleCount(page, 'wsf-start-created'),
      };
    }
    test.info().annotations.push({ type: 'acknowledgment', description: JSON.stringify({ ack, onStart }) });

    // THE PROPERTY. Not "Start vanished", not "the path changed": the name of
    // the community that exists is on screen, on top at its own centre.
    expect(ack, `nothing on screen names "${NAME}" before a blank form is offered: ${JSON.stringify({ home, onStart })}`).not.toBeNull();
    expect(ack!.body, 'the acknowledgment reuses the "couldn\'t open it" sentence (R1b) on a path that did not try to open it').not.toMatch(/couldn.t open it automatically/i);
    expect(await communitiesOf(me.uid), 'a second community exists before any deliberate second').toHaveLength(1);
    expect(creates.count(), 'a second create was sent before any deliberate second').toBe(1);

    // A DELIBERATE second stays possible (Director 5803218763): later
    // communities are not all duplicates.
    await page.unroute(CREATE);
    const second = await startDeliberateSecond(page);
    test.info().annotations.push({ type: 'deliberate second', description: JSON.stringify(second) });
    expect(second.reached, `no way to start a second community after the acknowledgment: ${JSON.stringify(second)}`).toBe(true);
    await page.locator('[data-testid="wsf-start-name"]:visible').first().fill('W7 Risk Second');
    await page.locator('[data-testid="wsf-start-submit"]:visible').first().click();
    await expect.poll(() => communitiesOf(me.uid), { timeout: 30_000 }).toHaveLength(2);
  });

  test('R1m the journey measured over time: Home at +4 s and +30 s, after a tab round trip, after a reload; requests', async ({ page }) => {
    test.setTimeout(300_000);
    const NAME = 'W7 Risk Timed';
    const { me, creates, releasedAt, homeReadsSince } = await leaveMidCreate(page, NAME);
    const homeNow = async () => ({
      elapsedMs: Date.now() - releasedAt,
      path: new URL(page.url()).pathname,
      startOffered: await visibleCount(page, 'wsf-home-start'),
      named: (await shownByName(page, NAME)).shown,
      myCommunitiesReadsSinceRelease: homeReadsSince(releasedAt),
    });
    const at4 = await homeNow();
    await page.waitForTimeout(Math.max(0, releasedAt + 30_000 - Date.now()));
    const at30 = await homeNow();
    await page.getByTestId('wsf-member-tab-activity').last().click();
    await page.waitForURL((u) => u.pathname.startsWith('/activity'), { timeout: 20_000 });
    await page.waitForTimeout(1_500);
    await page.getByTestId('wsf-member-tab-home').last().click();
    await page.waitForTimeout(3_000);
    const afterRoundTrip = await homeNow();
    await page.reload();
    await page.waitForTimeout(6_000);
    const afterReload = { elapsedMs: Date.now() - releasedAt, path: new URL(page.url()).pathname, named: (await shownByName(page, NAME)).shown };
    const committed = await communitiesOf(me.uid);
    test.info().annotations.push({ type: 'Home over time', description: JSON.stringify({ at4, at30, afterRoundTrip, afterReload, creates: creates.count(), committed }) });
    // Preconditions only: the timeline is the measurement.
    expect(committed, 'the create committed once').toEqual([NAME]);
    expect(creates.count(), 'nothing but the one create was sent').toBe(1);
  });

  test('R1acct the result of one account is not shown to the next on the same device (no reload between them)', async ({ page }) => {
    test.setTimeout(300_000);
    const NAME = 'W7 Risk Acct';
    const { me } = await leaveMidCreate(page, NAME);
    expect(await communitiesOf(me.uid), 'precondition: the create committed').toEqual([NAME]);
    const next = await member('r1n');
    // Sign out and in again inside the app, so nothing held in memory is lost
    // to a page load.
    await page.getByTestId('wsf-home-signout').last().click();
    await expect(page.getByTestId('wsf-home-signin').last()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('wsf-home-signin').last().click();
    await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('wsf-signin-email').fill(next.email);
    await page.getByTestId('wsf-signin-password').fill(next.password);
    await page.getByTestId('wsf-signin-submit').click();
    await page.waitForURL((u) => u.pathname === '/', { timeout: 20_000 });
    await expect(page.getByTestId('wsf-home-start').last()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2_000);
    const onHome = { shown: await shownByName(page, NAME), held: await heldCopies(page, NAME) };
    await page.getByTestId('wsf-home-start').last().click();
    await expect(page.locator('[data-testid="wsf-start-name"]:visible').first()).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(2_000);
    const onStart = {
      shown: await shownByName(page, NAME),
      held: await heldCopies(page, NAME),
      createdCard: await visibleCount(page, 'wsf-start-created'),
      nameValue: await page.locator('[data-testid="wsf-start-name"]:visible').first().inputValue(),
    };
    // What browser Back shows the next account, step by step.
    const backs: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 4; i += 1) {
      const before = page.url();
      await page.goBack().catch(() => undefined);
      await page.waitForTimeout(1_500);
      if (!page.url().startsWith('http://127.0.0.1')) {
        backs.push({ step: i + 1, left: page.url() });
        break;
      }
      backs.push({
        step: i + 1,
        path: new URL(page.url()).pathname,
        shown: await shownByName(page, NAME),
        createdCard: await visibleCount(page, 'wsf-start-created'),
      });
      if (page.url() === before) break;
    }
    test.info().annotations.push({ type: 'the next account', description: JSON.stringify({ onHome, onStart, backs }) });
    expect(onHome.shown.shown, "the previous account's community is SHOWN on the next account's Home").toBe(false);
    expect(onStart.shown.shown, "the previous account's community is SHOWN on the next account's Start").toBe(false);
    expect(onStart.createdCard).toBe(0);
    expect(onStart.nameValue).toBe('');
    for (const b of backs) expect((b.shown as Named | undefined)?.shown ?? false, `browser Back showed the previous account's community: ${JSON.stringify(b)}`).toBe(false);
    expect(await communitiesOf(next.uid)).toEqual([]);
    // HELD, NOT SHOWN, is recorded above and not asserted: on 9f27c6ea the
    // previous account's name stays in one unrendered wsf-start-summary node
    // (a Start screen kept mounted), which no screen and no Back step shows.
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
