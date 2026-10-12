import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  seedActiveGoal,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * THE TWO CONFIRMATIONS BOARD 02 NAMES THAT THE ACCEPTED EVIDENCE DOES NOT HOLD.
 *
 * Board 02's lock (PR #365 comment 5771235529) is built from the accepted
 * Page 2 AFTER frames — the byte-frozen evidence `/move` and
 * `/contribute/[goalId]` were accepted on. Those frames carry the ordinary
 * confirmation (1,847 → 1,867 of 5,000), the unknown outcome and the
 * definitive refusal. The lock also names two more confirmations the product
 * distinguishes and the AFTER set never photographed:
 *
 *   · the contribution that takes the community to its goal — the mark
 *     fills, the goal stays open, the copy says so;
 *   · a contribution after the goal was already met — the mark stays full,
 *     the percent stays at 100%, the overshoot lives in the exact total.
 *
 * Both are produced here through the real flow and the real callable, on the
 * emulators, and asserted before they are shot. The first frame reads "Our
 * goal is reached." — the receipt's `crossedTarget` flag is in the contract
 * but the server does not raise it yet, so no member reads a crossing claim.
 * The frame shows what the product says, not what the contract could say.
 *
 * GATED. Set WSF_CAPTURE_FRAMES=1 to (re)produce; an ordinary run skips.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/north-star-final/board-02/captures');
const CAPTURE_FRAMES = process.env.WSF_CAPTURE_FRAMES === '1';

test.skip(!CAPTURE_FRAMES, 'Board 02 captures are produced only on request (WSF_CAPTURE_FRAMES=1).');

async function seed(label: string, total: number) {
  const id = stampId();
  const email = `wsf-ns02-${label}-${id}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');
  const groupId = `ns02${label}${id}`.replace(/-/g, '');
  await seedCommunity({
    groupId,
    displayName: 'Smyrna Strong',
    joinPolicy: 'inviteOnly',
    members: [{ uid, role: 'foundingChampion' }],
  });
  const goalId = `${groupId}g`;
  await seedActiveGoal({ goalId, groupId, ownerUid: uid, title: '500 Squats by Friday', target: 500, unit: 'squats', total });
  return { email, password, groupId, goalId };
}

/** Drives the accepted flow: move → done → entry → review → submit → receipt. */
async function contribute(page: Page, fx: { groupId: string; goalId: string }, amount: string): Promise<void> {
  await page.goto(`/contribute/${fx.goalId}?groupId=${fx.groupId}&mode=move`);
  await expect(page.getByTestId('wsf-contribute-move-screen').last()).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('wsf-contribute-done').last().click();
  await expect(page.getByTestId('wsf-contribute-entry-screen').last()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-entry').last().fill(amount);
  await page.getByTestId('wsf-contribute-review').last().click();
  await expect(page.getByTestId('wsf-contribute-review-screen').last()).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('wsf-contribute-submit').last().click();
  await expect(page.getByTestId('wsf-contribute-receipt').last()).toBeVisible({ timeout: 40_000 });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.waitForTimeout(900);
}

function frame(name: string): string {
  mkdirSync(OUT, { recursive: true });
  return path.join(OUT, name);
}

test.describe('Board 02 · 390x844', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  test('the contribution that takes the community to its goal', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seed('cross', 495);
    await signInVia(page, fx.email, fx.password);
    await contribute(page, fx, '20');
    await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 20 squats.');
    // "Our goal is reached." — the `reached` variant. The receipt's
    // `crossedTarget` flag exists in the contract but the server never raises
    // it today (functions-westayfit/src/index.ts, "never raised here"), so the
    // member whose attempt crossed reads the state truth and no crossing
    // claim. That is the product's word, and it is what the board shows.
    await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText('Our goal is reached.');
    await expect(page.getByTestId('wsf-contribute-result-standing')).toContainText(
      'Our goal of 500 squats is reached and still open. Smyrna Strong is now at 515 of 500 squats.'
    );
    await expect(page.locator('[data-fill-ratio]').first()).toHaveAttribute('data-fill-ratio', '1.0000');
    await page.screenshot({ path: frame('confirmed-reached-open-390x844.png') });
    writeFileSync(
      frame('confirmed-reached-open-390x844.json'),
      JSON.stringify({ note: 'Synthetic emulator fixture — not real members or activity.', before: 495, added: 20, after: 515, target: 500 }, null, 2)
    );
  });

  test('a contribution after the goal was already met', async ({ page }) => {
    test.setTimeout(180_000);
    const fx = await seed('post', 512);
    await signInVia(page, fx.email, fx.password);
    await contribute(page, fx, '20');
    await expect(page.getByTestId('wsf-contribute-result-headline')).toHaveText('You added 20 squats.');
    await expect(page.getByTestId('wsf-contribute-result-subline')).toHaveText(
      'Smyrna Strong is now at 532 of 500 squats together.'
    );
    await expect(page.getByTestId('wsf-contribute-result-standing')).toHaveCount(0);
    await expect(page.locator('[data-fill-ratio]').first()).toHaveAttribute('data-fill-ratio', '1.0000');
    await page.screenshot({ path: frame('confirmed-post-target-390x844.png') });
    writeFileSync(
      frame('confirmed-post-target-390x844.json'),
      JSON.stringify({ note: 'Synthetic emulator fixture — not real members or activity.', before: 512, added: 20, after: 532, target: 500 }, null, 2)
    );
  });
});
