import { expect, test, type Page } from '@playwright/test';

import {
  FIRESTORE_EMULATOR,
  PROJECT_ID,
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
 * W9 — PERF-MOBILE-1 CHECKPOINT 1 (Director #365 `5840360454`; ACK #489
 * `5840966421`). Focused fail-before / pass-after for the pass criteria.
 *
 * Every read a screen might wait on is DELAYED here by `SLOW_MS` at the
 * network boundary (page.route on the functions emulator). That makes the
 * question unmistakable: does the screen show its useful content before the
 * reads it starts have returned, or does it wait behind a loading state?
 * Measured on development `0b460ce3` before this checkpoint (W7 Check 41B):
 * Progress, You and MOVE wait; MOVE and cold Home send identical reads twice.
 *
 * Everything seeded here is SYNTHETIC. Chromium, local emulators.
 */

const PASSWORD = 'Sup3rSecret!23';
const PHONE = { width: 390, height: 844 };
const SLOW_MS = 1_500;
const LOADING = ['wsf-activity-loading', 'wsf-you-loading', 'wsf-move-working', 'wsf-home-loading', 'wsf-home-my-loading', 'wsf-home-opening-community', 'wsf-community-loading'];

type Fx = { email: string; uid: string; groupId: string; goalId: string; name: string };

async function seed(tag: string, name = 'Alpharetta Morning Movers', person = 'Alex Rivera'): Promise<Fx> {
  const stamp = `${stampId()}${tag}`;
  const email = `wsf-w9-perf-${stamp}@example.com`;
  const uid = await seedVerifiedUser(email, PASSWORD);
  await seedProfile(uid, person);
  const dana = `w9perf-dana-${stamp}`;
  await seedProfile(dana, 'Dana Whitfield');
  const groupId = `w9perfc-${stamp}`;
  await seedCommunity({ groupId, displayName: name, joinPolicy: 'private', members: [{ uid, role: 'member' }] });
  await seedMembership(groupId, dana, 'foundingChampion');
  const goalId = `w9perfg-${stamp}`;
  await seedActiveGoal({ goalId, groupId, ownerUid: dana, title: 'October Squat Challenge', target: 5000, unit: 'squats', total: 1847 });
  return { email, uid, groupId, goalId, name };
}

function measure(label: string, value: unknown): void {
  // eslint-disable-next-line no-console
  console.log(`MEASURE ${label}: ${JSON.stringify(value)}`);
  test.info().annotations.push({ type: 'measure', description: `${label}: ${JSON.stringify(value)}` });
}

/** Records every loading state painted, frame by frame, for the whole document. */
async function watchLoading(page: Page): Promise<void> {
  await page.addInitScript((ids: string[]) => {
    const seen: string[] = [];
    (window as unknown as { __loadingSeen: string[] }).__loadingSeen = seen;
    const tick = () => {
      for (const id of ids) {
        for (const el of Array.from(document.querySelectorAll(`[data-testid="${id}"]`))) {
          const r = (el as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && !seen.includes(id)) seen.push(id);
        }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, LOADING);
}
async function loadingSince(page: Page, mark: number): Promise<string[]> {
  return page.evaluate((m) => (window as unknown as { __loadingSeen: string[] }).__loadingSeen.slice(m), mark);
}
async function loadingMark(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __loadingSeen: string[] }).__loadingSeen.length);
}

type Call = { name: string; params: string; at: number };
function recordCalls(page: Page): Call[] {
  const calls: Call[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.port !== '5001') return;
    let params = '';
    try {
      params = JSON.stringify((JSON.parse(r.postData() ?? '{}') as { data?: unknown }).data ?? null);
    } catch {
      params = '?';
    }
    calls.push({ name: u.pathname.split('/').pop() ?? '', params, at: Date.now() });
  });
  return calls;
}
function duplicates(calls: Call[]): string[] {
  const seen = new Map<string, number>();
  for (const c of calls) seen.set(`${c.name} ${c.params}`, (seen.get(`${c.name} ${c.params}`) ?? 0) + 1);
  return Array.from(seen.entries()).filter(([, n]) => n > 1).map(([k, n]) => `${k} ×${n}`);
}

/** From now on, every callable answer is held back by SLOW_MS. */
async function slowCallables(page: Page): Promise<void> {
  await page.route(/:5001\//, async (route) => {
    await new Promise((r) => setTimeout(r, SLOW_MS));
    await route.continue();
  });
}

const visible = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();

async function landOnHome(page: Page, fx: Fx): Promise<void> {
  await signInVia(page, fx.email, PASSWORD);
  await expect.poll(() => new URL(page.url()).pathname, { timeout: 40_000 }).toBe(`/community/${fx.groupId}`);
  await expect(visible(page, 'wsf-community-goal-hero')).toBeVisible({ timeout: 40_000 });
  // Home's own part in the goal has been read (its figures are on screen).
  await expect(visible(page, 'wsf-community-goal-hero')).toContainText('1,847', { timeout: 40_000 });
  await page.waitForTimeout(1_500);
}

test.describe('PERF-MOBILE-1 cp1 · useful before the reads return', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 1 });

  test('Progress and You open on what is known: no skeleton, content before their reads return', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('py');
    await watchLoading(page);
    await landOnHome(page, fx);
    await slowCallables(page);

    let mark = await loadingMark(page);
    let t0 = Date.now();
    await page.getByTestId('wsf-member-tab-activity').last().click();
    await expect(page.locator('[data-testid="wsf-activity-rows"]:visible, [data-testid="wsf-activity-empty"]:visible').first()).toBeVisible({ timeout: 30_000 });
    const progressMs = Date.now() - t0;
    const progressLoading = await loadingSince(page, mark);
    measure('Progress: ms to content with every read held 1.5 s; loading painted', { progressMs, progressLoading });
    expect(progressLoading, 'Progress paints no skeleton').toEqual([]);
    expect(progressMs, 'Progress content before its reads could return').toBeLessThan(SLOW_MS);

    mark = await loadingMark(page);
    t0 = Date.now();
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(visible(page, 'wsf-you-member')).toBeVisible({ timeout: 30_000 });
    const youMs = Date.now() - t0;
    const youLoading = await loadingSince(page, mark);
    measure('You: ms to the member composition with every read held 1.5 s; loading painted', { youMs, youLoading });
    expect(youLoading, 'You paints no skeleton').toEqual([]);
    expect(youMs, 'You content before its reads could return').toBeLessThan(SLOW_MS);
    // The name is read, never guessed: it arrives with the profile.
    await expect(visible(page, 'wsf-you-name')).toHaveText('Alex Rivera', { timeout: 20_000 });
  });

  test('MOVE opens over the mounted tab on the known goal: no "working", no second identical goals read', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('mv');
    await watchLoading(page);
    await landOnHome(page, fx);
    const calls = recordCalls(page);
    await slowCallables(page);

    const mark = await loadingMark(page);
    const since = Date.now();
    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(visible(page, 'wsf-contribute-timer')).toBeVisible({ timeout: 30_000 });
    const moveMs = Date.now() - since;
    await page.waitForTimeout(SLOW_MS + 1_000);
    const after = calls.filter((c) => c.at >= since);
    const moveLoading = await loadingSince(page, mark);
    measure('MOVE: ms to the movement step with every read held 1.5 s; loading painted; calls', {
      moveMs,
      moveLoading,
      calls: after.map((c) => `${c.name} ${c.params}`),
    });
    expect(moveLoading, 'MOVE paints no "working"').toEqual([]);
    expect(moveMs, 'the movement step before its reads could return').toBeLessThan(SLOW_MS);
    expect(duplicates(after), 'no identical read twice').toEqual([]);
    expect(after.filter((c) => c.name === 'wsfListGoals').length, 'the goals already known are not re-read').toBeLessThanOrEqual(1);
    // One mounted tab context beneath: Home's community is still there, once.
    expect(await page.locator('[data-testid="wsf-community-goal-hero"]').count()).toBe(1);

    // Close returns to the same mounted Home.
    // (The sheet travels out for 180 ms first; Home is visible beneath it throughout.)
    await page.locator('[data-testid="wsf-contribute-close"]:visible').first().click();
    await expect.poll(() => new URL(page.url()).pathname, { timeout: 20_000 }).toBe(`/community/${fx.groupId}`);
    await expect(page.locator('[data-testid="wsf-contribute-sheet-panel"]')).toHaveCount(0, { timeout: 20_000 });
    await expect(visible(page, 'wsf-community-goal-hero')).toBeVisible();
    expect(await page.locator('[data-testid="wsf-community-goal-hero"]').count()).toBe(1);
  });
});

test.describe('PERF-MOBILE-1 cp1 · cold Home and isolation', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 1 });

  test('cold Home for a member of one community sends no identical read twice', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seed('ch');
    const calls = recordCalls(page);
    await signInVia(page, fx.email, PASSWORD);
    await expect(visible(page, 'wsf-community-goal-hero')).toBeVisible({ timeout: 40_000 });
    // The signed-in landing is quiet first: no callable started for 2 s, so
    // nothing of that document's own reads is counted against the reload.
    await expect
      .poll(() => Date.now() - Math.max(0, ...calls.map((c) => c.at)), { timeout: 30_000 })
      .toBeGreaterThan(2_000);
    const since = Date.now();
    await page.goto('/');
    await expect(visible(page, 'wsf-community-goal-hero')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(2_000);
    const cold = calls.filter((c) => c.at >= since);
    measure('cold Home calls', cold.map((c) => `${c.name} ${c.params}`));
    expect(duplicates(cold), 'no identical member or goals read twice').toEqual([]);
    expect(cold.filter((c) => c.name === 'wsfMyCommunities')).toHaveLength(1);
  });

  test('two accounts in one document: nothing of the first is painted for the second', async ({ page }) => {
    test.setTimeout(300_000);
    const a = await seed('ia', 'Alpharetta Morning Movers', 'Alex Rivera');
    const b = await seed('ib', 'Marietta Evening Walkers', 'Blair Okafor');
    await landOnHome(page, a);
    await page.getByTestId('wsf-member-tab-activity').last().click();
    await expect(page.locator('[data-testid="wsf-activity-rows"]:visible, [data-testid="wsf-activity-empty"]:visible').first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(visible(page, 'wsf-you-member')).toBeVisible({ timeout: 30_000 });

    // Watch for A's names from here on, in this same document.
    await page.evaluate((names) => {
      const leak: string[] = [];
      (window as unknown as { __leak: string[] }).__leak = leak;
      const tick = () => {
        const text = document.body.innerText;
        for (const n of names) if (text.includes(n) && !leak.includes(n)) leak.push(n);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, [a.name, 'Alex Rivera']);
    // Sign out and in again without leaving the document.
    await page.getByTestId('wsf-member-topbar-menu-button').last().click();
    await page.getByTestId('wsf-member-topbar-menu-signout').last().click();
    // Signed out on You, which offers its own way to sign in (client-side).
    await expect(visible(page, 'wsf-you-signin')).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => (window as unknown as { __leak: string[] }).__leak.splice(0));
    await visible(page, 'wsf-you-signin').click();
    await page.getByTestId('wsf-signin-email').fill(b.email);
    await page.getByTestId('wsf-signin-password').fill(PASSWORD);
    await page.getByTestId('wsf-signin-submit').click();
    await expect(visible(page, 'wsf-community-goal-hero')).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-member-tab-activity').last().click();
    await page.waitForTimeout(1_500);
    await page.getByTestId('wsf-member-tab-you').last().click();
    await expect(visible(page, 'wsf-you-name')).toHaveText('Blair Okafor', { timeout: 30_000 });
    await page.getByTestId('wsf-member-tab-home').last().click();
    await page.getByTestId('wsf-member-tab-move').last().click();
    await expect(visible(page, 'wsf-contribute-timer')).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1_000);
    const leak = await page.evaluate(() => (window as unknown as { __leak: string[] }).__leak);
    measure('names of the first account painted for the second', leak);
    expect(leak).toEqual([]);
  });

  test('a refused membership is forgotten: MOVE does not open on the lost community from the record', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('rm');
    await landOnHome(page, fx);
    // Removed behind the member's back, as the server leaves it on removal.
    const now = new Date();
    await firestoreWrite(`wsfMemberships/${fx.groupId}_${fx.uid}`, {
      groupId: { stringValue: fx.groupId },
      userId: { stringValue: fx.uid },
      role: { stringValue: 'member' },
      membershipStatus: { stringValue: 'removed' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
    // A fresh entry to the community is refused, which forgets it.
    await page.goto(`/community/${fx.groupId}`);
    await expect(page.getByTestId('wsf-community-not-member').last()).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('wsf-member-tab-move').last().click();
    await page.waitForTimeout(3_000);
    expect(await page.locator('[data-testid="wsf-contribute-timer"]:visible').count(), 'no flow on the lost goal').toBe(0);
  });

  /*
    H4b (Director #494 `5841923744`; W7 Check 47). A return RE-CHECKS THE
    MEMBERSHIP: the goals read the refresh joins was issued before the removal
    (INJECTED: its real answer is held), so no fresh refusal comes from it.
    The return's own membership read proves the removal; the community leaves
    every surface, and the older answer, released afterwards, brings nothing
    back.
  */
  test('a return re-checks the membership: a held pre-removal goals answer cannot bring the community back', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seed('rr');
    await landOnHome(page, fx);
    for (const k of ['community', 'activity', 'you', 'home']) {
      await visible(page, `wsf-member-tab-${k}`).click();
      await page.waitForTimeout(1_200);
    }
    const held: { armed: boolean; captured: number; release: (() => void) | null } = { armed: true, captured: 0, release: null };
    await page.route('**/wsfListGoals', async (route) => {
      if (!held.armed) return route.continue();
      held.armed = false;
      const res = await route.fetch();
      held.captured += 1;
      await new Promise<void>((resolve) => {
        held.release = resolve;
      });
      return route.fulfill({ response: res });
    });
    await visible(page, 'wsf-member-tab-community').click();
    await visible(page, 'wsf-member-tab-home').click();
    await expect.poll(() => held.captured, { timeout: 15_000 }).toBe(1);

    // Removed while away: the membership document is deleted.
    const del = await fetch(
      `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/wsfMemberships/${fx.groupId}_${fx.uid}`,
      { method: 'DELETE', headers: { authorization: 'Bearer owner' } },
    );
    expect(del.ok).toBe(true);
    await visible(page, 'wsf-member-tab-community').click();
    await page.waitForTimeout(1_200);
    await visible(page, 'wsf-member-tab-home').click();
    await expect(visible(page, 'wsf-community-not-member')).toBeVisible({ timeout: 20_000 });

    held.release?.();
    await page.waitForTimeout(2_500);
    const shown: Record<string, boolean> = {};
    for (const [k, root] of [
      ['home', 'wsf-community'],
      ['community', 'wsf-community-index'],
      ['activity', 'wsf-activity'],
      ['you', 'wsf-you'],
    ] as const) {
      await visible(page, `wsf-member-tab-${k}`).click();
      await page.waitForTimeout(1_200);
      const t = await page.locator(`[data-testid="${root}"]:visible`).first().innerText({ timeout: 3_000 }).catch(() => '');
      shown[k] = t.includes('October Squat Challenge') || t.includes(fx.name);
    }
    await page.unrouteAll({ behavior: 'ignoreErrors' });
    measure('the removed community shown on', shown);
    expect(shown).toEqual({ home: false, community: false, activity: false, you: false });
  });
});
