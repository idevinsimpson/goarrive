import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

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
 * NATIVE-STATE-1 — THE WEB COPY THAT CHANGED: a browser that refuses to store
 * the pending attempt.
 *
 * Before NATIVE-STATE-1 the unknown screen always said "You can leave this
 * page. The same attempt will be here when you come back." — including when
 * the browser had refused the write, so the promise was false. The pending
 * record's write is now confirmed before the request fires, and when the
 * browser refuses it the screen says instead:
 *
 *   "This device couldn’t save this attempt, so it won’t be here if you leave
 *    this page. Confirm it here."
 *
 * This spec pins that on the real route, next to the recovery-port spec it
 * borrows its injection from:
 *   · STORAGE REFUSAL (labelled injection): `Storage.prototype.setItem` throws
 *     for `wsf.pendingContribution.*` keys only — a full or locked-down
 *     browser, for this record alone;
 *   · REPLY LOST (labelled injection): the server records the write and the
 *     browser never hears back, so the screen lands on the unknown state.
 *
 * It asserts: the honest sentence is shown and the "will be here" one is not;
 * nothing was stored; "Confirm this contribution" sends the SAME attempt and
 * it counts once; and leaving the page restores nothing (as the screen said)
 * and sends nothing on arrival. And, for the #635 delta: a saved attempt the
 * browser cannot READ (LABELLED INJECTION: getItem throws for those keys)
 * keeps recording paused behind "Couldn’t read this device’s saved attempt."
 * until Retry reads it, and nothing is sent meanwhile.
 *
 * Requires the Firebase emulators and a served web build (WSF_PLAYWRIGHT_BASE_URL),
 * like every spec in this folder. Everything seeded is SYNTHETIC.
 */

const PASSWORD = 'Sup3rSecret!23';
const PENDING_PREFIX = 'wsf.pendingContribution.';
const NOT_SAVED =
  'This device couldn’t save this attempt, so it won’t be here if you leave this page. Confirm it here.';
const WILL_BE_HERE = 'You can leave this page. The same attempt will be here when you come back.';

type Fixture = { email: string; uid: string; groupId: string; goalId: string };

async function seed(tag: string): Promise<Fixture> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-ns1-sr-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `ns1sr-${stamp}`;
  const goalId = `ns1srgoal-${stamp}`;
  const owner = `ns1sr-owner-${stamp}`;
  await seedCommunity({ groupId, displayName: 'Synthetic Morning Movers', joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedMembership(groupId, owner, 'foundingChampion');
  await seedProfile(owner, 'Dana Whitfield');
  await seedActiveGoal({ goalId, groupId, ownerUid: owner, title: 'Synthetic Squat Goal', target: 5000, unit: 'squats', total: 1847 });
  return { email, uid, groupId, goalId };
}

/** LABELLED INJECTION: this browser refuses to store the pending-attempt record, and only that record. */
async function refusePendingWrites(page: Page): Promise<void> {
  await page.addInitScript((prefix: string) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (typeof key === 'string' && key.startsWith(prefix)) {
        throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      }
      return original.call(this, key, value);
    };
  }, PENDING_PREFIX);
}

/** LABELLED INJECTION: let the write land and lose the reply, or pass it. */
function contributeRoute(page: Page) {
  const control = { mode: 'pass' as 'pass' | 'landButDrop', seen: [] as string[] };
  const ready = page.route('**/wsfContribute', async (route: Route) => {
    const body = route.request().postDataJSON() as { data?: { attemptId?: string } } | null;
    control.seen.push(body?.data?.attemptId ?? '?');
    if (control.mode === 'landButDrop') {
      await route.fetch();
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  return { control, ready };
}

async function pendingKeys(page: Page): Promise<string[]> {
  return page.evaluate((prefix) => Object.keys(window.localStorage).filter((k) => k.startsWith(prefix)), PENDING_PREFIX);
}

async function withViewer(browser: Browser, fx: Fixture, run: (page: Page) => Promise<void>): Promise<void> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/New_York' });
  try {
    const page = await ctx.newPage();
    await refusePendingWrites(page);
    await signInVia(page, fx.email, PASSWORD);
    await run(page);
  } finally {
    await ctx.close();
  }
}

async function recordAndLoseTheReply(page: Page, fx: Fixture, control: { mode: string; seen: string[] }): Promise<void> {
  await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('wsf-contribute-entry').fill('20');
  await page.getByTestId('wsf-contribute-review').click();
  await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible({ timeout: 20_000 });
  control.mode = 'landButDrop';
  await page.getByTestId('wsf-contribute-submit').click();
  const pending = page.getByTestId('wsf-contribute-pending');
  await expect(pending).toBeVisible({ timeout: 30_000 });
  await expect(pending).toContainText('We couldn’t confirm your contribution yet.');
  expect(control.seen, 'one write left the browser').toHaveLength(1);
}

const RESTORE_FAILED = 'Couldn’t read this device’s saved attempt.';

/** LABELLED INJECTION: reading `wsf.pendingContribution.*` throws while `window.__wsfFailPendingReads` is true. */
async function failPendingReads(page: Page): Promise<void> {
  await page.addInitScript((prefix: string) => {
    (window as unknown as { __wsfFailPendingReads: boolean }).__wsfFailPendingReads = true;
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function (this: Storage, key: string) {
      const failing = (window as unknown as { __wsfFailPendingReads?: boolean }).__wsfFailPendingReads;
      if (failing && typeof key === 'string' && key.startsWith(prefix)) {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      }
      return original.call(this, key);
    };
  }, PENDING_PREFIX);
}

test.describe('NATIVE-STATE-1 · a browser that refuses to keep the pending attempt', () => {
  test('the unknown screen says it was not saved, and Confirm still reconciles the same attempt once', async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seed('a');
    await withViewer(browser, fx, async (page) => {
      const { control, ready } = contributeRoute(page);
      await ready;
      await recordAndLoseTheReply(page, fx, control);

      await expect(page.getByTestId('wsf-contribute-not-saved')).toHaveText(NOT_SAVED);
      await expect(page.getByText(WILL_BE_HERE)).toHaveCount(0);
      expect(await pendingKeys(page), 'a refused record was stored anyway').toEqual([]);

      // Confirm, on this page: the SAME attempt, and the server counts it once.
      control.mode = 'pass';
      await page.getByTestId('wsf-contribute-reconcile').click();
      await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'alreadyRecorded', {
        timeout: 30_000,
      });
      expect(control.seen, 'the replay was a different attempt').toEqual([control.seen[0], control.seen[0]]);
      const member = await firestoreRead(`wsfGoalMemberTotals/${fx.goalId}_${fx.uid}`);
      expect(Number(member.total?.integerValue ?? 0), 'the replay counted twice').toBe(20);
    });
  });

  test('leaving the page restores nothing — as the screen said — and sends nothing on arrival', async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seed('b');
    await withViewer(browser, fx, async (page) => {
      const { control, ready } = contributeRoute(page);
      await ready;
      await recordAndLoseTheReply(page, fx, control);
      await expect(page.getByTestId('wsf-contribute-not-saved')).toHaveText(NOT_SAVED);

      control.mode = 'pass';
      const sent = control.seen.length;
      await page.reload();
      await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(2_000);
      await expect(page.getByTestId('wsf-contribute-pending')).toHaveCount(0);
      await expect(page.getByTestId('wsf-contribute-reconcile')).toHaveCount(0);
      expect(control.seen.length, 'arriving sent something').toBe(sent);
      expect(await pendingKeys(page)).toEqual([]);
    });
  });

  test('a saved attempt the browser cannot read: recording stays paused, Retry reads it once it can', async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seed('d');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/New_York' });
    try {
      const page = await ctx.newPage();
      await signInVia(page, fx.email, PASSWORD);
      // An unresolved attempt this account left on this device.
      await page.evaluate(
        ({ k, goalId }) =>
          window.localStorage.setItem(
            k,
            JSON.stringify({ goalId, attemptId: 'ns1readfail01', count: 20, ts: Date.now(), state: 'unknown' })
          ),
        { k: `${PENDING_PREFIX}${fx.goalId}.${fx.uid}`, goalId: fx.goalId }
      );
      await failPendingReads(page);
      const { control, ready } = contributeRoute(page);
      await ready;
      await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`);
      const failed = page.getByTestId('wsf-contribute-restore-failed');
      await expect(failed).toBeVisible({ timeout: 60_000 });
      await expect(failed).toContainText(RESTORE_FAILED);
      for (const id of ['wsf-contribute-entry-screen', 'wsf-contribute-review-screen', 'wsf-contribute-submit']) {
        await expect(page.getByTestId(id), id).toHaveCount(0);
      }
      expect(control.seen, 'something was sent').toEqual([]);
      // The browser can read it again: Retry restores the attempt, untouched.
      await page.evaluate(() => {
        (window as unknown as { __wsfFailPendingReads: boolean }).__wsfFailPendingReads = false;
      });
      await page.getByTestId('wsf-contribute-restore-retry').click();
      await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('wsf-contribute-pending-count')).toHaveText('You entered 20 squats.');
      expect(control.seen, 'something was sent').toEqual([]);
    } finally {
      await ctx.close();
    }
  });

  test('with storage working, the screen still makes the original promise (control)', async ({ browser }) => {
    test.setTimeout(240_000);
    const fx = await seed('c');
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-US', timezoneId: 'America/New_York' });
    try {
      const page = await ctx.newPage();
      await signInVia(page, fx.email, PASSWORD);
      const { control, ready } = contributeRoute(page);
      await ready;
      await recordAndLoseTheReply(page, fx, control);
      await expect(page.getByText(WILL_BE_HERE)).toBeVisible();
      await expect(page.getByTestId('wsf-contribute-not-saved')).toHaveCount(0);
      expect(await pendingKeys(page)).toEqual([`${PENDING_PREFIX}${fx.goalId}.${fx.uid}`]);
    } finally {
      await ctx.close();
    }
  });
});
