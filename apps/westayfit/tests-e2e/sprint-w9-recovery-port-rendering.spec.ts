import { expect, test, type Page, type Route } from '@playwright/test';

import {
  firestoreRead,
  seedActiveGoal,
  seedCommunity,
  seedMembership,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W9 — RECOVERY-PORT-1: WHAT THE PORTED RECOVERY STATES SAY, IN WHAT ORDER,
 * AND WHERE THEIR WAYS OUT GO (Director #365 `5821372374` §1; ruling
 * `5821650392`).
 *
 * Composition, pinned the way the frozen reference orders it:
 *   · unknown — the title, the kept attempt's amount, the one sentence about
 *     what is and is not known, ONE action, then the same-attempt caption;
 *   · receipt — the badge, the addition as the heading, the member's own
 *     addition and total, THEN the community's standing with the Living WE,
 *     and the labelled way back as the green action;
 *   · review — Edit and the green Record side by side, nothing written first.
 *
 * Truth, which the port must not have moved:
 *   · "Confirm this contribution" is a WRITE of the same attempt, not a status
 *     read: an attempt that never reached the server is recorded by it;
 *   · nothing on the unknown screen offers a discard, names a shared figure or
 *     says the shared total is untouched.
 *
 * The exits (ruling §3) are MEASURED, not built: where a labelled exit and the
 * route's own Back land, which tab is current, the community's scroll, and
 * where keyboard focus is afterwards. Those readings are printed as MEASURE
 * lines and attached as annotations; only the attempt surviving a round trip
 * is asserted, because that is the contract.
 *
 * Everything seeded here is SYNTHETIC.
 */

const PASSWORD = 'Sup3rSecret!23';
const PHONE = { width: 390, height: 844 };

type Fx = { email: string; uid: string; groupId: string; goalId: string };

async function seed(tag: string): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-rpr-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `w9rpr-${stamp}`;
  const goalId = `w9rprgoal-${stamp}`;
  const dana = `w9rpr-dana-${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Alpharetta Morning Movers',
    joinPolicy: 'private',
    members: [{ uid, role: 'member' }],
  });
  await seedMembership(groupId, dana, 'foundingChampion');
  await seedProfile(dana, 'Dana Whitfield');
  await seedActiveGoal({
    goalId,
    groupId,
    ownerUid: dana,
    title: 'October Squat Challenge',
    target: 5000,
    unit: 'squats',
    total: 1847,
  });
  return { email, uid, groupId, goalId };
}

/** The write, under the test's control. */
function routeContribute(page: Page) {
  const control = { mode: 'pass' as 'pass' | 'drop' | 'landButDrop', seen: [] as string[] };
  const ready = page.route('**/wsfContribute', async (route: Route) => {
    const body = route.request().postDataJSON() as { data?: { attemptId?: string } } | null;
    control.seen.push(body?.data?.attemptId ?? '?');
    if (control.mode === 'drop') {
      // The request never reaches the server (labelled injection).
      await route.abort('failed');
      return;
    }
    if (control.mode === 'landButDrop') {
      // The server records it; the browser never hears back (labelled injection).
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  return { control, ready };
}

async function toReview(page: Page, fx: Fx): Promise<void> {
  await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('wsf-contribute-entry').fill('20');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible({ timeout: 20_000 });
}

/** The document order of the named nodes inside a container (-1 when missing). */
async function orderOf(page: Page, container: string, probes: Array<{ id?: string; text?: string }>): Promise<number[]> {
  return page.getByTestId(container).evaluate((root, list) => {
    const nodes = Array.from(root.querySelectorAll('*'));
    return list.map((p) => {
      const i = nodes.findIndex((n) =>
        p.id
          ? n.getAttribute('data-testid') === p.id
          : n.children.length === 0 && (n.textContent ?? '').trim() === p.text,
      );
      return i;
    });
  }, probes);
}

function ascending(xs: number[]): boolean {
  return xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]!));
}

/** The focused element, named the way a reader of the MEASURE line can find it. */
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

test.describe('RECOVERY-PORT-1 · the ported recovery states', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2 });

  test('unknown: the reference order on the accepted words, one action, no discard, no shared figure', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seed('u');
    const { control, ready } = routeContribute(page);
    await ready;
    await signInVia(page, fx.email, PASSWORD);
    await toReview(page, fx);
    control.mode = 'landButDrop';
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 30_000 });

    const order = await orderOf(page, 'wsf-contribute-pending', [
      { text: 'We couldn’t confirm your contribution yet.' },
      { id: 'wsf-contribute-pending-count' },
      { text: 'We don’t know whether this effort was recorded. Don’t record it again.' },
      { id: 'wsf-contribute-reconcile' },
      { text: 'This sends the same attempt again. If it already reached us, it will not count twice.' },
      { text: 'You can leave this page. The same attempt will be here when you come back.' },
    ]);
    expect(ascending(order), `unknown: not in the reference's order (${order.join(', ')})`).toBe(true);
    await expect(
      page.getByTestId('wsf-contribute-pending').getByRole('button'),
      'unknown: more than one action on the sheet',
    ).toHaveCount(1);
    await expect(page.getByTestId('wsf-contribute-discard-pending')).toHaveCount(0);
    const text = await page.getByTestId('wsf-contribute-screen').innerText();
    expect(text).not.toMatch(/discard|check status|nothing was counted|remove this reminder/i);
    expect(text).not.toMatch(/1,847|1,867|of 5,000/);
    expect(text).not.toMatch(/(not|isn’t|isn't) (yet )?(counted|included)[^.]{0,60}shared total/i);
    for (const id of ['wsf-contribute-shared-total', 'wsf-contribute-context', 'wsf-contribute-we']) {
      await expect(page.getByTestId(id)).toHaveCount(0);
    }
  });

  test('Confirm is a write: an attempt that never reached the server is recorded by it, once', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seed('w');
    const { control, ready } = routeContribute(page);
    await ready;
    await signInVia(page, fx.email, PASSWORD);
    await toReview(page, fx);
    control.mode = 'drop';
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 30_000 });
    control.mode = 'pass';
    await page.getByTestId('wsf-contribute-reconcile').click();
    // Not "already recorded": nothing had landed, so the replay itself recorded it.
    await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'ordinary', {
      timeout: 30_000,
    });
    expect(control.seen.length).toBe(2);
    expect(control.seen[1], 'Confirm sent a different attempt').toBe(control.seen[0]);
    await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('1,867 of 5,000 squats');
    const member = await firestoreRead(`wsfGoalMemberTotals/${fx.goalId}_${fx.uid}`);
    expect(Number(member.total?.integerValue ?? 0), 'counted other than once').toBe(20);
  });

  test('receipt: the member’s own numbers before the community’s, and the way back is the green action', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seed('r');
    const { ready } = routeContribute(page);
    await ready;
    await signInVia(page, fx.email, PASSWORD);
    await toReview(page, fx);
    await page.getByTestId('wsf-contribute-submit').click();
    const receipt = page.getByTestId('wsf-contribute-receipt');
    await expect(receipt).toHaveAttribute('data-variant', 'ordinary', { timeout: 30_000 });

    const order = await orderOf(page, 'wsf-contribute-receipt', [
      { text: 'Recorded' },
      { id: 'wsf-contribute-result-headline' },
      { id: 'wsf-contribute-result-subline' },
      { id: 'wsf-contribute-result-amount' },
      { id: 'wsf-contribute-own-credit' },
      { id: 'wsf-contribute-we' },
      { id: 'wsf-contribute-shared-total' },
      { id: 'wsf-contribute-percent' },
      { id: 'wsf-contribute-status' },
      { id: 'wsf-contribute-result-standing' },
    ]);
    expect(ascending(order), `receipt: not in the reference's order (${order.join(', ')})`).toBe(true);
    await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20 squats');

    const fills = await page.evaluate(() => {
      const bg = (id: string) => {
        const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
        return el ? getComputedStyle(el).backgroundColor : null;
      };
      return { back: bg('wsf-contribute-back'), more: bg('wsf-contribute-record-more') };
    });
    expect(fills.back, 'the way back is not the green action').toBe('rgb(34, 197, 94)');
    expect(fills.more, 'record-more is not the outlined one').toBe('rgb(255, 255, 255)');
  });

  test('review: Edit and the green Record side by side, nothing written first', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seed('v');
    const { control, ready } = routeContribute(page);
    await ready;
    await signInVia(page, fx.email, PASSWORD);
    await toReview(page, fx);
    const edit = (await page.getByTestId('wsf-contribute-edit').boundingBox())!;
    const record = (await page.getByTestId('wsf-contribute-submit').boundingBox())!;
    expect(Math.abs(edit.y - record.y), 'Edit and Record are not on one row').toBeLessThanOrEqual(1);
    expect(edit.x, 'Edit is not the first of the pair').toBeLessThan(record.x);
    expect(record.height).toBeGreaterThanOrEqual(54);
    await expect(page.getByTestId('wsf-contribute-review-quantity')).toHaveText('20 squats');
    expect(control.seen.length, 'a write before Record').toBe(0);
  });

  test('exits, measured: the kept attempt survives a round trip; where each way out lands, and focus', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('x');
    const { control, ready } = routeContribute(page);
    await ready;
    await signInVia(page, fx.email, PASSWORD);

    // Opened from the community hero's "Already moved?", by keyboard.
    await page.goto(`/community/${fx.groupId}`);
    const launcher = page.getByTestId(`wsf-community-goal-record-${fx.goalId}`);
    await expect(launcher).toBeVisible({ timeout: 40_000 });
    await launcher.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });

    // The route's own Back (Close / back to the actual opener), by keyboard.
    const chromeBack = page.getByTestId('wsf-contribute-back');
    await expect(chromeBack).toHaveText('Back to community');
    await chromeBack.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/community/${fx.groupId}`), { timeout: 20_000 });
    await page.waitForTimeout(800);
    measure('hero launcher → chrome Back', {
      path: new URL(page.url()).pathname,
      focus: await focusReading(page),
      homeTabCurrent: await page.getByTestId('wsf-member-tab-home').last().getAttribute('data-current'),
    });

    // Again, to an unknown outcome; then the labelled exit (Finish → Community).
    await launcher.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-contribute-entry').fill('20');
    await page.getByTestId('wsf-contribute-review').click();
    control.mode = 'landButDrop';
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 30_000 });
    const kept = control.seen[0];
    const exit = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await expect(exit).toHaveText('Back to community');
    await exit.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/community/${fx.groupId}`), { timeout: 20_000 });
    await page.waitForTimeout(800);
    measure('unknown → labelled exit', {
      path: new URL(page.url()).pathname,
      focus: await focusReading(page),
      communityScreens: await page.locator('[data-testid="wsf-community"]').count(),
    });

    // Back in through the same launcher: the SAME attempt, restored, nothing sent.
    control.mode = 'pass';
    const sent = control.seen.length;
    await launcher.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="wsf-contribute-pending"]:visible')).toBeVisible({ timeout: 40_000 });
    const stored = await page.evaluate(
      (k) => window.localStorage.getItem(k),
      `wsf.pendingContribution.${fx.goalId}.${fx.uid}`,
    );
    expect(stored ? JSON.parse(stored).attemptId : null, 'a different attempt came back').toBe(kept);
    await page.waitForTimeout(2_500);
    expect(control.seen.length, 'coming back sent something').toBe(sent);
    measure('return through the launcher', { restoredSameAttempt: true, sendsOnReturn: control.seen.length - sent });

    // MOVE from the You tab (one open goal), then the route's own Back.
    await page.goto('/you');
    const move = page.getByTestId('wsf-member-tab-move').last();
    await expect(move).toBeVisible({ timeout: 40_000 });
    await move.focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/contribute\//, { timeout: 40_000 });
    // Past "Loading goal…": the kept attempt outranks the move step once the goal has loaded.
    await expect(page.locator('[data-testid="wsf-contribute-pending"]:visible')).toBeVisible({ timeout: 40_000 });
    measure('MOVE centre → contribute', { path: new URL(page.url()).pathname, showsKeptAttempt: true });
    const back = page.locator('[data-testid="wsf-contribute-back"]:visible').first();
    await back.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1_500);
    measure('MOVE centre → labelled exit', {
      path: new URL(page.url()).pathname,
      focus: await focusReading(page),
      youTabCurrent: await page.getByTestId('wsf-member-tab-you').last().getAttribute('data-current').catch(() => null),
      communityTabCurrent: await page
        .getByTestId('wsf-member-tab-community')
        .last()
        .getAttribute('data-current')
        .catch(() => null),
    });
  });
});
