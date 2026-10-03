/**
 * TOGETHER-COMPLETION-1 — the owner-selected Together completion on the
 * confirmed member receipt, through the real contribution journey.
 *
 * EMULATOR ONLY. Synthetic fixtures only (helpers/expo-attendee-fixtures.ts):
 * every name is labelled "Fixture", every address is under example.com, and
 * every starting total is a SEEDED total.
 *
 * THE CROSSING FIXTURE IS LABELLED AS ONE. Today's wsfContribute never returns
 * `crossedTarget: true` (it records reachedAt on the goal and names no
 * attempt). The authoritative-crossing presentation is therefore exercised by
 * a controlled fixture that sets that one field on the real server response
 * for the real attempt; every other number on that receipt is the server's.
 *
 * NOT PROVED HERE, and not claimed: a hosted environment, native/device,
 * Safari, or how the motion feels to the owner.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

import {
  contributionsOf,
  FIXTURE_PASSWORD,
  firestorePatch,
  openPhone,
  seedExpoEvent,
  shardTotal,
  type ExpoFixture,
} from './helpers/expo-attendee-fixtures';
import { firestoreRead } from './helpers/mobile';

test.describe.configure({ timeout: 240_000 });

const REVIEW_DIR = nodePath.resolve(__dirname, '..', '..', '..', 'docs', 'design-target', 'review', 'together-completion-1');
const LABEL = process.env.WSF_TOGETHER_LABEL ?? '';
const SIZES = [
  { name: '390x640', width: 390, height: 640 },
  { name: '390x844', width: 390, height: 844 },
  { name: '1280x900', width: 1280, height: 900 },
] as const;

async function snap(page: Page, name: string): Promise<void> {
  const dir = nodePath.join(REVIEW_DIR, LABEL);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: nodePath.join(dir, `${name}.png`), fullPage: false });
}

async function record(page: Page, fx: ExpoFixture, amount: string): Promise<void> {
  await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`);
  await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('wsf-contribute-entry').fill(amount);
  await page.getByTestId('wsf-contribute-review').click();
  await page.getByTestId('wsf-contribute-submit').click();
  await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
}

/** CONTROLLED FIXTURE: the real response for the real attempt, with the
 * server's crossing signal set. Nothing else on it is altered. */
async function grantCrossingSignal(page: Page): Promise<void> {
  await page.route('**/wsfContribute', async (route: Route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { result?: Record<string, unknown> };
    if (body.result && typeof body.result.sharedTotal === 'number') body.result.crossedTarget = true;
    await route.fulfill({ response, json: body });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CAPTURES. Run once on the declared base (WSF_TOGETHER_LABEL=before) and once
// on the product subject (WSF_TOGETHER_LABEL=after). They assert only what is
// true on both builds; the behaviour tests below assert the new contract.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('captures', () => {
  test.skip(!LABEL, 'capture run only: set WSF_TOGETHER_LABEL=before|after');

  test('ordinary: 3,700 + 20 → 3,720 of 5,000 squats, at three sizes', async ({ browser }) => {
    const fx = await seedExpoEvent({ tag: 'tgo', attendees: ['Fixture Member Ordinary'], target: 5000, seededTotal: 3700 });
    const phone = await openPhone(browser, fx.attendees[0]!);
    try {
      await record(phone.page, fx, '20');
      await expect(phone.page.getByTestId('wsf-contribute-shared-total')).toHaveText('3,720 of 5,000 squats');
      await phone.page.waitForTimeout(3_800); // every presentation settles by 3,400 ms
      for (const s of SIZES) {
        await phone.page.setViewportSize({ width: s.width, height: s.height });
        await phone.page.waitForTimeout(300);
        await snap(phone.page, `ordinary-settled-${s.name}`);
      }
    } finally {
      await phone.context.close();
    }
  });

  test('crossing (controlled fixture): 4,980 + 35 → 5,015 of 5,000 squats', async ({ browser }) => {
    const fx = await seedExpoEvent({ tag: 'tgx', attendees: ['Fixture Member Crossing'], target: 5000, seededTotal: 4980 });
    const phone = await openPhone(browser, fx.attendees[0]!);
    try {
      await grantCrossingSignal(phone.page);
      await record(phone.page, fx, '35');
      await expect(phone.page.getByTestId('wsf-contribute-shared-total')).toHaveText('5,015 of 5,000 squats');
      await phone.page.waitForTimeout(3_800);
      await snap(phone.page, 'crossing-settled-390x844');
    } finally {
      await phone.context.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BEHAVIOUR. The new contract, on the product subject.
// ─────────────────────────────────────────────────────────────────────────────


const together = (page: Page) => page.getByTestId('wsf-together');
const phase = (page: Page) => together(page).getAttribute('data-together-phase');

async function expectSettledStatic(page: Page) {
  await expect(together(page)).toHaveAttribute('data-together-phase', 'settled', { timeout: 5_000 });
  await expect(page.getByTestId('wsf-together-canvas')).toHaveCount(0);
}

test.describe('behaviour', () => {
  test.skip(LABEL === 'before', 'the base build has no Together receipt');

  test('ordinary: the exact receipt is there at once, the motion plays once, settles, and nothing replays', async ({ browser }) => {
    const fx = await seedExpoEvent({ tag: 'tgb1', attendees: ['Fixture Member One'], target: 5000, seededTotal: 3700 });
    const phone = await openPhone(browser, fx.attendees[0]!);
    const page = phone.page;
    try {
      await record(page, fx, '20');
      // TRUTH FIRST: every figure is on screen before any motion has run.
      await expect(page.getByTestId('wsf-contribute-result-amount')).toHaveText('+20');
      await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 20 squats.');
      await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText('You moved us closer.');
      await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('3,720 of 5,000 squats');
      // No printed before → after pair: under concurrency it would credit others' work to this member.
      expect(await page.getByTestId('wsf-contribute-receipt').innerText()).not.toMatch(/→|3,700/);
      await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20 squats');
      await expect(together(page)).toHaveAttribute('data-together-animate', 'eligible');
      expect(await phase(page)).toBe('playing');
      // The decoration is pointer-transparent and hidden from assistive tech.
      const canvas = page.getByTestId('wsf-together-canvas');
      await expect(canvas).toHaveCount(1);
      await expect(canvas).toHaveAttribute('aria-hidden', 'true');
      expect(await canvas.evaluate((c) => getComputedStyle(c).pointerEvents)).toBe('none');
      // The way out is usable throughout.
      await expect(page.getByTestId('wsf-contribute-back')).toBeVisible();
      await expect(page.getByTestId('wsf-contribute-back')).toBeEnabled();
      // Settles by 3,400 ms and leaves the readable receipt with the true fill.
      await expectSettledStatic(page);
      await expect(page.getByTestId('wsf-contribute-we')).toHaveAttribute('data-fill-ratio', /^0\.744/);
      // A re-render does not restart it: wait a whole timeline more.
      await page.waitForTimeout(3_600);
      expect(await phase(page)).toBe('settled');
      await expect(page.getByTestId('wsf-together-canvas')).toHaveCount(0);
      // Recorded exactly once.
      expect((await contributionsOf(fx.goalId, fx.attendees[0]!.uid)).map((c) => c.count)).toEqual([20]);
      expect(await shardTotal(fx.goalId)).toBe(3720);
      phone.assertNoCrash('the receipt');
    } finally {
      await phone.context.close();
    }
  });

  test('the receipt is a snapshot: a later live change does not rewrite it', async ({ browser }) => {
    const fx = await seedExpoEvent({ tag: 'tgb2', attendees: ['Fixture Member Two'], target: 5000, seededTotal: 3700 });
    const phone = await openPhone(browser, fx.attendees[0]!);
    const page = phone.page;
    try {
      await record(page, fx, '20');
      await expectSettledStatic(page);
      // FIXTURE: another member's 100 lands in the store after this receipt.
      const shard0 = Number((await firestoreRead(`wsfGoalCounters/${fx.goalId}/shards/0`)).count?.integerValue ?? 0);
      await firestorePatch(`wsfGoalCounters/${fx.goalId}/shards/0`, { count: { integerValue: String(shard0 + 100) } });
      expect(await shardTotal(fx.goalId)).toBe(3820);
      await page.waitForTimeout(8_000);
      await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('3,720 of 5,000 squats');
      await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText('You moved us closer.');
      expect(await phase(page)).toBe('settled');
    } finally {
      await phone.context.close();
    }
  });

  test('authoritative crossing (controlled fixture): communal payoff, exact overshoot, plays once', async ({ browser }) => {
    const fx = await seedExpoEvent({ tag: 'tgb3', attendees: ['Fixture Member Three'], target: 5000, seededTotal: 4980 });
    const phone = await openPhone(browser, fx.attendees[0]!);
    const page = phone.page;
    try {
      await grantCrossingSignal(page);
      await record(page, fx, '35');
      await expect(together(page)).toHaveAttribute('data-together-crossed', 'true');
      await expect(together(page)).toHaveAttribute('data-together-animate', 'eligible');
      await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText('WE did it. Together.');
      await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('5,015 of 5,000 squats');
      await expect(page.getByTestId('wsf-contribute-percent')).toHaveText('100% complete');
      await expect(page.getByTestId('wsf-contribute-status')).toHaveText('15 beyond our goal · still open');
      await expectSettledStatic(page);
      await expect(page.getByTestId('wsf-contribute-we')).toHaveAttribute('data-fill-ratio', '1.0000');
      // The fact stays after the moment ends.
      await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText('WE did it. Together.');
    } finally {
      await phone.context.close();
    }
  });

  test('a reconciled crossing (answer lost, then confirmed) keeps the fact, counts once, and never moves', async ({ browser }) => {
    const fx = await seedExpoEvent({ tag: 'tgb4', attendees: ['Fixture Member Four'], target: 5000, seededTotal: 4980 });
    const phone = await openPhone(browser, fx.attendees[0]!);
    const page = phone.page;
    try {
      let calls = 0;
      await page.route('**/wsfContribute', async (route: Route) => {
        calls += 1;
        const response = await route.fetch();
        if (calls === 1) {
          await route.abort('connectionreset'); // it landed; the answer did not
          return;
        }
        const body = (await response.json()) as { result?: Record<string, unknown> };
        if (body.result && typeof body.result.sharedTotal === 'number') body.result.crossedTarget = true;
        await route.fulfill({ response, json: body });
      });
      await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`);
      await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
      await page.getByTestId('wsf-contribute-entry').fill('35');
      await page.getByTestId('wsf-contribute-review').click();
      await page.getByTestId('wsf-contribute-submit').click();
      await expect(page.getByTestId('wsf-contribute-reconcile')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('wsf-contribute-reconcile').click();
      await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
      await expect(together(page)).toHaveAttribute('data-together-animate', 'static');
      expect(await phase(page)).toBe('settled');
      await expect(page.getByTestId('wsf-together-canvas')).toHaveCount(0);
      await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('This contribution was already recorded.');
      await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText('WE did it. Together.');
      await expect(page.getByTestId('wsf-contribute-result-standing')).toContainText('It counted once.');
      expect((await contributionsOf(fx.goalId, fx.attendees[0]!.uid)).map((c) => c.count)).toEqual([35]);
    } finally {
      await phone.context.close();
    }
  });

  test('reached WITHOUT the server signal: truthful reached standing, no crossing, no motion', async ({ browser }) => {
    const fx = await seedExpoEvent({ tag: 'tgb5', attendees: ['Fixture Member Five'], target: 5000, seededTotal: 4980 });
    const phone = await openPhone(browser, fx.attendees[0]!);
    const page = phone.page;
    try {
      await record(page, fx, '35');
      await expect(together(page)).toHaveAttribute('data-together-crossed', 'false');
      await expect(together(page)).toHaveAttribute('data-together-animate', 'static');
      await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText('Our goal is reached.');
      const text = await page.getByTestId('wsf-contribute-receipt').innerText();
      expect(text).not.toMatch(/WE did it|moved us closer|took us past/i);
      await expectSettledStatic(page);
    } finally {
      await phone.context.close();
    }
  });

  test('reduced motion: the same exact receipt at once; switched ON mid-motion settles for good; OFF never replays', async ({ browser }) => {
    const fx = await seedExpoEvent({ tag: 'tgb6', attendees: ['Fixture Member Six', 'Fixture Member Seven'], target: 5000, seededTotal: 3700 });
    // Reduced from the start.
    const a = await openPhone(browser, fx.attendees[0]!);
    try {
      await a.page.emulateMedia({ reducedMotion: 'reduce' });
      await record(a.page, fx, '20');
      expect(await phase(a.page)).toBe('settled');
      await expect(a.page.getByTestId('wsf-together-canvas')).toHaveCount(0);
      await expect(a.page.getByTestId('wsf-contribute-we')).toHaveAttribute('data-fill-ratio', /^0\.744/);
      await expect(a.page.getByTestId('wsf-contribute-result-subline')).toHaveText('You moved us closer.');
    } finally {
      await a.context.close();
    }
    // Switched on while playing.
    const b = await openPhone(browser, fx.attendees[1]!);
    try {
      await record(b.page, fx, '20');
      expect(await phase(b.page)).toBe('playing');
      await b.page.waitForTimeout(400);
      await b.page.emulateMedia({ reducedMotion: 'reduce' });
      await expectSettledStatic(b.page);
      await expect(b.page.getByTestId('wsf-contribute-we')).toHaveAttribute('data-fill-ratio', /^0\.748/);
      await b.page.emulateMedia({ reducedMotion: 'no-preference' });
      await b.page.waitForTimeout(1_500);
      expect(await phase(b.page)).toBe('settled');
      await expect(b.page.getByTestId('wsf-together-canvas')).toHaveCount(0);
      await expect(b.page.getByTestId('wsf-contribute-we')).toHaveAttribute('data-fill-ratio', /^0\.748/);
    } finally {
      await b.context.close();
    }
  });

  test('a double tap records once and plays one motion', async ({ browser }) => {
    const fx = await seedExpoEvent({ tag: 'tgb7', attendees: ['Fixture Member Eight'], target: 5000, seededTotal: 3700 });
    const phone = await openPhone(browser, fx.attendees[0]!);
    const page = phone.page;
    try {
      await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`);
      await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
      await page.getByTestId('wsf-contribute-entry').fill('20');
      await page.getByTestId('wsf-contribute-review').click();
      const submit = page.getByTestId('wsf-contribute-submit');
      await submit.evaluate((el) => {
        (el as HTMLElement).click();
        (el as HTMLElement).click();
      });
      await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
      await expectSettledStatic(page);
      expect((await contributionsOf(fx.goalId, fx.attendees[0]!.uid)).map((c) => c.count)).toEqual([20]);
      expect(await shardTotal(fx.goalId)).toBe(3720);
    } finally {
      await phone.context.close();
    }
  });

  test('leaving during the motion: no error, nothing lost, and coming back shows no receipt to replay', async ({ browser }) => {
    const fx = await seedExpoEvent({ tag: 'tgb8', attendees: ['Fixture Member Nine'], target: 5000, seededTotal: 3700 });
    const phone = await openPhone(browser, fx.attendees[0]!);
    const page = phone.page;
    try {
      await record(page, fx, '20');
      expect(await phase(page)).toBe('playing');
      await page.getByTestId('wsf-contribute-back').click();
      await page.waitForURL(new RegExp(`/community/${fx.groupId}`), { timeout: 30_000 });
      await page.waitForTimeout(3_800); // past every timer the motion owned
      phone.assertNoCrash('leaving mid-motion');
      await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`);
      await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
      await expect(page.getByTestId('wsf-together')).toHaveCount(0);
      expect((await contributionsOf(fx.goalId, fx.attendees[0]!.uid)).map((c) => c.count)).toEqual([20]);
    } finally {
      await phone.context.close();
    }
  });

  test('a second movement: its own unit throughout', async ({ browser }) => {
    const fx = await seedExpoEvent({ tag: 'tgb9', attendees: ['Fixture Member Ten'], target: 2000, seededTotal: 400 });
    await firestorePatch(`wsfGoals/${fx.goalId}`, { unit: { stringValue: 'push-ups' }, title: { stringValue: 'Fixture Push-ups' } });
    const phone = await openPhone(browser, fx.attendees[0]!);
    const page = phone.page;
    try {
      await record(page, fx, '15');
      await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 15 push-ups.');
      await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText('415 of 2,000 push-ups');
      await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 15 push-ups');
      const text = await page.getByTestId('wsf-contribute-receipt').innerText();
      expect(text).not.toMatch(/squats/i);
    } finally {
      await phone.context.close();
    }
  });

  test('own-only receipt (controlled fixture: shared fields withheld): no WE, no motion, own facts only', async ({ browser }) => {
    const fx = await seedExpoEvent({ tag: 'tgb10', attendees: ['Fixture Member Eleven'], target: 5000, seededTotal: 3700 });
    const phone = await openPhone(browser, fx.attendees[0]!);
    const page = phone.page;
    try {
      await page.route('**/wsfContribute', async (route: Route) => {
        const response = await route.fetch();
        const body = (await response.json()) as { result?: Record<string, unknown> };
        if (body.result) {
          for (const k of ['sharedTotal', 'target', 'unit', 'status', 'crossedTarget']) delete body.result[k];
        }
        await route.fulfill({ response, json: body });
      });
      await record(page, fx, '20');
      await expect(page.getByTestId('wsf-contribute-receipt')).toHaveAttribute('data-variant', 'ownOnly');
      await expect(page.getByTestId('wsf-contribute-we')).toHaveCount(0);
      await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveCount(0);
      await expect(together(page)).toHaveAttribute('data-together-animate', 'static');
      await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText('It counted once.');
      await expect(page.getByTestId('wsf-contribute-own-credit')).toHaveText('Your total on this goal: 20 squats');
      await expect(page.getByTestId('wsf-contribute-back')).toHaveText('Back to home');
      const text = await page.getByTestId('wsf-contribute-receipt').innerText();
      expect(text).not.toMatch(/of 5,000|Fixture Expo Community|WE did it|moved us closer/);
    } finally {
      await phone.context.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE MOTION CLIP (after only): gathering, ratio fill and rebound, recorded
// from the real receipt at 390×844.
// ─────────────────────────────────────────────────────────────────────────────

test.describe('motion clip', () => {
  test.skip(LABEL !== 'after', 'recorded on the product subject only');
  test('ordinary motion, recorded from the real receipt', async ({ browser }) => {
    const fx = await seedExpoEvent({ tag: 'tgclip', attendees: ['Fixture Member Clip'], target: 5000, seededTotal: 3700 });
    const who = fx.attendees[0]!;
    const dir = nodePath.join(REVIEW_DIR, LABEL, 'video-tmp');
    mkdirSync(dir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      recordVideo: { dir, size: { width: 390, height: 844 } },
    });
    const page = await context.newPage();
    const started = Date.now();
    let receiptAt = 0;
    try {
      // Signing in happens inside the recorded context; the clip is trimmed to the receipt below.
      await page.goto('/signin');
      await page.getByTestId('wsf-signin-email').fill(who.email);
      await page.getByTestId('wsf-signin-password').fill(FIXTURE_PASSWORD);
      await page.getByTestId('wsf-signin-submit').click();
      await page.waitForURL((u) => !u.pathname.startsWith('/signin'), { timeout: 40_000 });
      await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=record`);
      await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
      await page.getByTestId('wsf-contribute-entry').fill('20');
      await page.getByTestId('wsf-contribute-review').click();
      await page.getByTestId('wsf-contribute-submit').click();
      await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
      receiptAt = Date.now() - started;
      await page.waitForTimeout(4_000);
      await expect(together(page)).toHaveAttribute('data-together-phase', 'settled');
    } finally {
      await context.close();
    }
    const video = page.video();
    if (video) await video.saveAs(nodePath.join(REVIEW_DIR, LABEL, 'video-tmp', 'full.webm'));
    writeFileSync(nodePath.join(REVIEW_DIR, LABEL, 'video-tmp', 'receipt-at-ms.txt'), String(receiptAt));
  });
});
