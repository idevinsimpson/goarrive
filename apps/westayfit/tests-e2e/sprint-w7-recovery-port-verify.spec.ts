import { expect, test, type Page, type Route } from '@playwright/test';

import {
  firestoreRead,
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
 * W7 — CHECK 29: INDEPENDENT REVIEW OF W9's RECOVERY-PORT-1 (#474), exact head
 * `86c160ae` on development `6f994f5a` (Director #434 `5824351707`, exact-head
 * amendment `5824906768`).
 *
 * W9's own specs pin the composition. This instrument asks the questions they
 * do not, from the server's side and from other openers:
 *
 *   T1  unknown → Confirm: the unknown screen names no own or shared figure and
 *       nobody else; the replay counts ONCE on the server (one contribution
 *       document, the shards up by exactly the amount, the member total equal
 *       to it), and every receipt figure equals what the server holds.
 *   T2  a request that never landed: Confirm records it, once, as ordinary.
 *   T3  own-only (membership removed before the replay): no community, no
 *       shared figure, no percent; the exit says "Back to home" and answers
 *       Enter; nothing named the community.
 *   T4  a genuine refusal (once-policy goal already contributed): the server's
 *       own reason, nothing written, the shards unmoved.
 *   T5  the kept attempt is keyed by account AND goal: another account's row
 *       and another goal's row on the same device are never shown or sent.
 *   T6  openers, by keyboard: the community hero, MOVE from the Community tab,
 *       MOVE from You; the route's own Back returns to the actual opener; the
 *       labelled exit lands on ONE community screen; the attempt kept after
 *       leaving is restored by a DIFFERENT launcher with nothing sent. Focus
 *       after every exit is MEASURED (the separately recorded shell limitation),
 *       not asserted.
 *   T7  layout at 390×844, 390×640 and 320×568: no sideways overflow, the one
 *       action and the labelled exit reachable, meaning carried by words.
 *
 * Proof able to fail: the same file is run against the base build `6f994f5a`
 * (the route's own Back said a place and the exits ignored Enter there).
 * Everything seeded is SYNTHETIC. Injected transport faults are labelled.
 */

const PASSWORD = 'Sup3rSecret!23';
const FS = 'http://127.0.0.1:8080/v1/projects/demo-wsf-local/databases/(default)/documents';
const TOTAL = 1847;
const TARGET = 5000;

type Fx = { email: string; uid: string; groupId: string; goalId: string; dana: string };

async function seed(tag: string, opts: { once?: boolean } = {}): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w7-c29-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w7c29-${stamp}`;
  const goalId = `w7c29goal-${stamp}`;
  const dana = `w7c29-dana-${stamp}`;
  await seedCommunity({ groupId, displayName: 'Alpharetta Morning Movers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedMembership(groupId, dana, 'foundingChampion');
  await seedProfile(dana, 'Dana Whitfield');
  await seedActiveGoal({ goalId, groupId, ownerUid: dana, title: 'October Squat Challenge', target: TARGET, unit: 'squats', total: TOTAL });
  if (opts.once) {
    await patch(`wsfGoals/${goalId}`, { repeatPolicy: { stringValue: 'once' } });
    await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${uid}`, {
      goalId: { stringValue: goalId },
      userId: { stringValue: uid },
      total: { integerValue: '20' },
      contributionCount: { integerValue: '1' },
      updatedAt: tsField(new Date()),
    });
  }
  return { email, uid, groupId, goalId, dana };
}

async function patch(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const res = await fetch(`${FS}/${docPath}?${mask}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`patch ${docPath}: ${res.status}`);
}

/** Server truth, read with owner rights straight from the emulator. */
async function serverTruth(fx: Fx): Promise<{ contributions: string[]; shardSum: number; memberTotal: number | null }> {
  const list = async (path: string) => {
    const res = await fetch(`${FS}/${path}?pageSize=500`, { headers: { authorization: 'Bearer owner' } });
    if (!res.ok) return [] as Array<{ name: string; fields?: Record<string, { integerValue?: string }> }>;
    return ((await res.json()) as { documents?: Array<{ name: string; fields?: Record<string, { integerValue?: string }> }> }).documents ?? [];
  };
  const contributions = (await list('wsfContributions'))
    .map((d) => d.name.split('/').pop()!)
    .filter((id) => id.startsWith(`${fx.goalId}_`));
  const shardSum = (await list(`wsfGoalCounters/${fx.goalId}/shards`)).reduce((s, d) => s + Number(d.fields?.count?.integerValue ?? 0), 0);
  let memberTotal: number | null = null;
  try {
    memberTotal = Number((await firestoreRead(`wsfGoalMemberTotals/${fx.goalId}_${fx.uid}`)).total?.integerValue ?? NaN);
  } catch {
    memberTotal = null;
  }
  return { contributions, shardSum, memberTotal };
}

function routeContribute(page: Page) {
  const control = { mode: 'pass' as 'pass' | 'drop' | 'landButDrop', seen: [] as string[] };
  const ready = page.route('**/wsfContribute', async (route: Route) => {
    const body = route.request().postDataJSON() as { data?: { attemptId?: string } } | null;
    control.seen.push(body?.data?.attemptId ?? '?');
    if (control.mode === 'drop') return route.abort('failed'); // INJECTED: never reaches the server
    if (control.mode === 'landButDrop') {
      await route.fetch(); // INJECTED: the server records it, the reply is lost
      return route.abort('failed');
    }
    return route.continue();
  });
  return { control, ready };
}

async function toReview(page: Page, fx: Fx, amount = '20'): Promise<void> {
  await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('wsf-contribute-entry').fill(amount);
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible({ timeout: 20_000 });
}

async function screenText(page: Page): Promise<string> {
  return page.locator('[data-testid="wsf-contribute-screen"]:visible').first().innerText();
}

async function focusReading(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return 'body';
    const id = el.getAttribute('data-testid') ?? el.closest('[data-testid]')?.getAttribute('data-testid');
    return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''}`;
  });
}

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label}: ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

const fmt = (n: number) => n.toLocaleString('en-US');

test.describe('W7 Check 29 · RECOVERY-PORT-1', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('T1 unknown names nothing; the same-attempt replay counts once and the receipt is the server’s', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await seed('t1');
    const { control, ready } = routeContribute(page);
    await ready;
    await signInVia(page, fx.email, PASSWORD);
    await toReview(page, fx);
    control.mode = 'landButDrop';
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 30_000 });

    const unknown = await screenText(page);
    expect(unknown, 'unknown: an own or shared figure').not.toMatch(/1,8\d\d|of 5,000|%|Your total|Shared total|Your addition/);
    expect(unknown, 'unknown: another member named').not.toMatch(/Dana|Whitfield/);
    expect(unknown, 'unknown: an identifier shown').not.toContain(fx.uid);
    expect(unknown, 'unknown: a discard or a claim that nothing counted').not.toMatch(/discard|nothing was counted|check status/i);
    await expect(page.getByTestId('wsf-contribute-pending-count')).toHaveText('You entered 20 squats.');

    // Before the replay, the server already holds it once (the reply was lost, not the write).
    const before = await serverTruth(fx);
    expect(before.contributions.length, 'server: the lost-reply write did not land once').toBe(1);
    expect(before.shardSum).toBe(TOTAL + 20);

    control.mode = 'pass';
    const confirm = page.getByTestId('wsf-contribute-reconcile');
    await confirm.focus();
    await page.keyboard.press('Enter');
    const receipt = page.getByTestId('wsf-contribute-receipt');
    await expect(receipt).toHaveAttribute('data-variant', 'alreadyRecorded', { timeout: 30_000 });
    expect(control.seen.length).toBe(2);
    expect(control.seen[1], 'Confirm sent a different attempt').toBe(control.seen[0]);

    const after = await serverTruth(fx);
    measure('T1 server after replay', after);
    expect(after.contributions, 'server: the replay made a second contribution').toEqual(before.contributions);
    expect(after.shardSum, 'server: the shared total moved on the replay').toBe(TOTAL + 20);
    expect(after.memberTotal, 'server: the member total is not the amount').toBe(20);
    await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText(`${fmt(after.shardSum)} of ${fmt(TARGET)} squats`);
    await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText(`Your total on this goal: ${after.memberTotal} squats`);
    await expect(page.getByTestId('wsf-contribute-result-amount')).toHaveText('20');
    await expect(page.getByTestId('wsf-contribute-percent')).toHaveText('37.3% complete');
    const text = await screenText(page);
    expect(text, 'receipt: another member named').not.toMatch(/Dana|Whitfield/);
    // Own and shared stay two things: the own tile carries 20, the shared line 1,867.
    await expect(page.getByTestId('wsf-contribute-own-credit')).not.toContainText('1,867');
    await expect(page.getByTestId('wsf-contribute-shared-total')).not.toContainText('Your');
    // Non-colour meaning.
    await expect(receipt).toContainText('Already recorded');
    await expect(page.getByTestId('wsf-contribute-status')).not.toHaveText('');

    // Nothing is left to replay: leaving and coming back sends nothing and shows no attempt.
    await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`);
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId('wsf-contribute-pending')).toHaveCount(0);
    expect(control.seen.length, 'coming back after the receipt sent something').toBe(2);
    expect((await serverTruth(fx)).contributions.length).toBe(1);
  });

  test('T2 a request that never landed is recorded by Confirm, once, as ordinary', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await seed('t2');
    const { control, ready } = routeContribute(page);
    await ready;
    await signInVia(page, fx.email, PASSWORD);
    await toReview(page, fx);
    control.mode = 'drop';
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 30_000 });
    const before = await serverTruth(fx);
    expect(before.contributions.length, 'server: the dropped request landed').toBe(0);
    expect(before.shardSum).toBe(TOTAL);
    control.mode = 'pass';
    await page.getByTestId('wsf-contribute-reconcile').click();
    await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'ordinary', { timeout: 30_000 });
    const after = await serverTruth(fx);
    measure('T2 server after Confirm', after);
    expect(after.contributions.length).toBe(1);
    expect(after.contributions[0]).toBe(`${fx.goalId}_${fx.uid}_${control.seen[0]}`);
    expect(after.shardSum).toBe(TOTAL + 20);
    await expect(page.getByTestId('wsf-contribute-result-amount')).toHaveText('+20');
    await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText(`${fmt(after.shardSum)} of ${fmt(TARGET)} squats`);
  });

  test('T3 own-only: no community, no shared figure; "Back to home" answers Enter', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await seed('t3');
    const { control, ready } = routeContribute(page);
    await ready;
    await signInVia(page, fx.email, PASSWORD);
    await toReview(page, fx);
    control.mode = 'landButDrop';
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 30_000 });
    await patch(`wsfMemberships/${fx.groupId}_${fx.uid}`, { membershipStatus: { stringValue: 'removed' } });
    control.mode = 'pass';
    await page.getByTestId('wsf-contribute-reconcile').click();
    await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'ownOnly', { timeout: 30_000 });
    const text = await screenText(page);
    expect(text, 'own-only: a community or shared fact').not.toMatch(/Alpharetta|of 5,000|1,8\d\d|%|Shared total|Dana/);
    for (const id of ['wsf-contribute-shared-total', 'wsf-contribute-we', 'wsf-contribute-percent', 'wsf-contribute-status', 'wsf-contribute-result-standing', 'wsf-contribute-record-more']) {
      await expect(page.getByTestId(id), `own-only: ${id}`).toHaveCount(0);
    }
    await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20 squats');
    expect((await serverTruth(fx)).contributions.length, 'own-only replay wrote twice').toBe(1);
    const exit = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await expect(exit).toHaveText('Back to home');
    await expect(exit).toHaveAccessibleName('Back to home');
    await exit.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 30_000, message: 'Enter on "Back to home" did not leave' }).not.toMatch(/^\/contribute\//);
    await page.waitForTimeout(1_500);
    measure('T3 own-only → "Back to home" (Enter)', { path: new URL(page.url()).pathname, focus: await focusReading(page) });
    expect(new URL(page.url()).pathname, 'own-only exit went to the lost community').not.toBe(`/community/${fx.groupId}`);
  });

  test('T4 a genuine refusal writes nothing and moves nothing', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await seed('t4', { once: true });
    const { ready } = routeContribute(page);
    await ready;
    await signInVia(page, fx.email, PASSWORD);
    await toReview(page, fx);
    await page.getByTestId('wsf-contribute-submit').click();
    const refused = page.getByTestId('wsf-contribute-refused');
    await expect(refused).toHaveAttribute('data-reason', 'alreadyContributed', { timeout: 30_000 });
    const truth = await serverTruth(fx);
    measure('T4 server after refusal', truth);
    expect(truth.contributions.length, 'a refusal wrote a contribution').toBe(0);
    expect(truth.shardSum, 'a refusal moved the shared total').toBe(TOTAL);
    expect(truth.memberTotal).toBe(20);
    expect(await refused.innerText(), 'refusal: a figure invented').not.toMatch(/1,8\d\d|of 5,000|%/);
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), `wsf.pendingContribution.${fx.goalId}.${fx.uid}`);
    expect(stored, 'a refused attempt was kept for replay').toBeNull();
  });

  test('T5 the kept attempt is keyed by account and goal: foreign rows are never shown or sent', async ({ page }) => {
    test.setTimeout(200_000);
    const fx = await seed('t5');
    // A second open goal in the same community.
    const goal2 = `${fx.goalId}b`;
    await seedActiveGoal({ goalId: goal2, groupId: fx.groupId, ownerUid: fx.dana, title: 'November Squat Challenge', target: TARGET, unit: 'squats', total: 100 });
    const { control, ready } = routeContribute(page);
    await ready;
    await signInVia(page, fx.email, PASSWORD);
    // INJECTED device state: another account's unresolved attempt on THIS goal,
    // written under that account's key, as the route itself writes it.
    await page.evaluate(({ g, other }) => {
      window.localStorage.setItem(`wsf.pendingContribution.${g}.${other}`, JSON.stringify({ goalId: g, attemptId: 'foreignc29acct', count: 77, ts: Date.now() - 60_000, state: 'unknown' }));
    }, { g: fx.goalId, other: fx.dana });
    await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`);
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(2_500);
    await expect(page.getByTestId('wsf-contribute-pending')).toHaveCount(0);
    expect(await screenText(page), 'another account’s attempt shown').not.toMatch(/77 squats|You entered/);
    expect(control.seen.length, 'another account’s attempt sent').toBe(0);

    // This account's own attempt on goal 1 is kept …
    await page.getByTestId('wsf-contribute-entry').fill('20');
    await page.getByTestId('wsf-contribute-review').click();
    control.mode = 'drop';
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 30_000 });
    const sent = control.seen.length;
    // … and never appears on goal 2.
    await page.goto(`/contribute/${goal2}?groupId=${fx.groupId}&mode=record`);
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(2_500);
    await expect(page.getByTestId('wsf-contribute-pending')).toHaveCount(0);
    expect(await screenText(page), 'goal 1’s attempt shown on goal 2').not.toMatch(/You entered/);
    expect(control.seen.length, 'goal 1’s attempt sent from goal 2').toBe(sent);
    // Goal 1 still holds it, and the foreign account's row is untouched.
    const rows = await page.evaluate(({ g, me, other }) => ({
      mine: window.localStorage.getItem(`wsf.pendingContribution.${g}.${me}`),
      theirs: window.localStorage.getItem(`wsf.pendingContribution.${g}.${other}`),
    }), { g: fx.goalId, me: fx.uid, other: fx.dana });
    expect(rows.mine ? JSON.parse(rows.mine).attemptId : null).toBe(control.seen[0]);
    expect(rows.theirs ? JSON.parse(rows.theirs).attemptId : null, 'the other account’s row was touched').toBe('foreignc29acct');
    expect((await serverTruth(fx)).contributions.length).toBe(0);
  });

  test('T6 openers by keyboard: the actual opener, one Community screen, the attempt kept across launchers', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('t6');
    const { control, ready } = routeContribute(page);
    await ready;
    await signInVia(page, fx.email, PASSWORD);
    const screens = () => page.locator('[data-testid="wsf-community"]').count();

    // (a) MOVE from the Community page: the route's own Back, pressed (not Enter), returns there.
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId(`wsf-community-goal-record-${fx.goalId}`)).toBeVisible({ timeout: 40_000 });
    const move = page.getByTestId('wsf-member-tab-move').last();
    await move.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/contribute\//, { timeout: 40_000 });
    await expect(page.locator('[data-testid="wsf-contribute-move-screen"]:visible')).toBeVisible({ timeout: 40_000 });
    await expect(page.locator('[data-testid="wsf-contribute-community"]:visible')).toBeVisible({ timeout: 40_000 });
    const ownBack = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await expect(ownBack).toHaveText('Back');
    await expect(ownBack).toHaveAccessibleName('Back');
    await ownBack.click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe(`/community/${fx.groupId}`);
    await page.waitForTimeout(1_000);
    measure('T6a MOVE from Community → own Back (press)', { path: new URL(page.url()).pathname, communityScreens: await screens(), focus: await focusReading(page) });
    expect(await screens(), 'a duplicate Community screen').toBe(1);

    // (b) MOVE from You → an unknown outcome → the labelled exit by Enter.
    await page.goto('/you');
    await expect(page.getByTestId('wsf-member-tab-move').last()).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-member-tab-move').last().focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/contribute\//, { timeout: 40_000 });
    const start = page.locator('[data-testid="wsf-contribute-move-screen"]:visible');
    await expect(start).toBeVisible({ timeout: 40_000 });
    measure('T6b MOVE from You → contribute', { url: page.url() });
    // Through the move flow to the entry, then an unknown outcome.
    await page.locator('[data-testid="wsf-contribute-done"]:visible').first().click();
    await expect(page.locator('[data-testid="wsf-contribute-entry-screen"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.locator('[data-testid="wsf-contribute-entry"]:visible').fill('20');
    await page.locator('[data-testid="wsf-contribute-review"]:visible').click();
    control.mode = 'landButDrop';
    await page.locator('[data-testid="wsf-contribute-submit"]:visible').click();
    await expect(page.locator('[data-testid="wsf-contribute-pending"]:visible')).toBeVisible({ timeout: 30_000 });
    const kept = control.seen[0];
    const exit = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await expect(exit).toHaveText('Back to community');
    await exit.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe(`/community/${fx.groupId}`);
    await page.waitForTimeout(1_000);
    measure('T6b unknown → "Back to community" (Enter)', { path: new URL(page.url()).pathname, communityScreens: await screens(), focus: await focusReading(page) });
    expect(await screens(), 'a duplicate Community screen after the labelled exit').toBe(1);

    // (c) Back in through a DIFFERENT launcher (the hero's "Already moved?"): the same attempt, nothing sent.
    control.mode = 'pass';
    const sent = control.seen.length;
    const hero = page.getByTestId(`wsf-community-goal-record-${fx.goalId}`);
    await hero.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="wsf-contribute-pending"]:visible')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(2_500);
    expect(control.seen.length, 'returning sent something').toBe(sent);
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), `wsf.pendingContribution.${fx.goalId}.${fx.uid}`);
    expect(stored ? JSON.parse(stored).attemptId : null, 'a different attempt came back').toBe(kept);
    await expect(page.locator('[data-testid="wsf-contribute-pending-count"]:visible')).toHaveText('You entered 20 squats.');

    // (d) Confirm, then the receipt's labelled exit by Enter: one screen, counted once.
    await page.locator('[data-testid="wsf-contribute-reconcile"]:visible').focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="wsf-contribute-receipt"]:visible')).toHaveAttribute('data-variant', 'alreadyRecorded', { timeout: 30_000 });
    const rexit = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await expect(rexit).toHaveText('Back to community');
    await rexit.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe(`/community/${fx.groupId}`);
    await page.waitForTimeout(1_000);
    measure('T6d receipt → "Back to community" (Enter)', { path: new URL(page.url()).pathname, communityScreens: await screens(), focus: await focusReading(page) });
    expect(await screens()).toBe(1);
    const truth = await serverTruth(fx);
    expect(truth.contributions.length).toBe(1);
    expect(truth.shardSum).toBe(TOTAL + 20);
  });

  for (const vp of [
    { w: 390, h: 844 },
    { w: 390, h: 640 },
    { w: 320, h: 568 },
  ]) {
    test(`T7 layout ${vp.w}×${vp.h}: unknown and receipt fit, reach and read`, async ({ page }) => {
      test.setTimeout(200_000);
      await page.setViewportSize({ width: vp.w, height: vp.h });
      const fx = await seed(`t7${vp.w}${vp.h}`);
      const { control, ready } = routeContribute(page);
      await ready;
      await signInVia(page, fx.email, PASSWORD);
      await toReview(page, fx);
      control.mode = 'landButDrop';
      await page.getByTestId('wsf-contribute-submit').click();
      await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(800);
      const geo = async (ids: string[]) =>
        page.evaluate((list) => {
          const doc = document.documentElement;
          const out: Record<string, unknown> = { overflowX: doc.scrollWidth - window.innerWidth };
          for (const id of list) {
            const el = Array.from(document.querySelectorAll(`[data-testid="${id}"]`)).find((n) => (n as HTMLElement).offsetParent !== null) as HTMLElement | undefined;
            if (!el) { out[id] = null; continue; }
            const r0 = el.getBoundingClientRect();
            el.scrollIntoView({ block: 'center' });
            const r = el.getBoundingClientRect();
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            out[id] = {
              inFirstViewport: r0.bottom <= window.innerHeight && r0.top >= 0,
              reachable: !!hit && (hit === el || el.contains(hit)),
              width: Math.round(r.width), height: Math.round(r.height),
              insideX: r.left >= -0.5 && r.right <= window.innerWidth + 0.5,
            };
          }
          window.scrollTo(0, 0);
          return out;
        }, ids);
      const u = await geo(['wsf-contribute-reconcile', 'wsf-contribute-back']);
      measure(`T7 ${vp.w}x${vp.h} unknown`, u);
      expect(u.overflowX, 'unknown: sideways overflow').toBeLessThanOrEqual(0);
      for (const id of ['wsf-contribute-reconcile', 'wsf-contribute-back']) {
        const g = u[id] as { reachable: boolean; insideX: boolean; height: number } | null;
        expect(g, `unknown: ${id} missing`).not.toBeNull();
        expect(g!.reachable, `unknown: ${id} not reachable`).toBe(true);
        expect(g!.insideX, `unknown: ${id} outside the width`).toBe(true);
        expect(g!.height, `unknown: ${id} under 44px`).toBeGreaterThanOrEqual(44);
      }
      control.mode = 'pass';
      await page.getByTestId('wsf-contribute-reconcile').click();
      await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'alreadyRecorded', { timeout: 30_000 });
      await page.waitForTimeout(800);
      const r = await geo(['wsf-contribute-back', 'wsf-contribute-record-more', 'wsf-contribute-shared-total', 'wsf-contribute-own-credit']);
      measure(`T7 ${vp.w}x${vp.h} receipt`, r);
      expect(r.overflowX, 'receipt: sideways overflow').toBeLessThanOrEqual(0);
      for (const id of ['wsf-contribute-back', 'wsf-contribute-record-more']) {
        const g = r[id] as { reachable: boolean; insideX: boolean; height: number } | null;
        expect(g, `receipt: ${id} missing`).not.toBeNull();
        expect(g!.reachable, `receipt: ${id} not reachable`).toBe(true);
        expect(g!.insideX, `receipt: ${id} outside the width`).toBe(true);
        expect(g!.height, `receipt: ${id} under 44px`).toBeGreaterThanOrEqual(44);
      }
      // Meaning in words: the badge, the percent and the status are text.
      await expect(page.getByTestId('wsf-contribute-receipt')).toContainText('Already recorded');
      await expect(page.getByTestId('wsf-contribute-percent')).toHaveText(/\d+(\.\d)?% complete/);
      // No figure broken inside itself.
      const lines = await page.getByTestId('wsf-contribute-shared-total').evaluate((el) => {
        const count = el.firstElementChild as HTMLElement | null;
        return count ? Math.round(count.getBoundingClientRect().height / parseFloat(getComputedStyle(count).lineHeight || '32')) : -1;
      });
      expect(lines, 'the shared count broke inside itself').toBeLessThanOrEqual(1);
    });
  }
});
