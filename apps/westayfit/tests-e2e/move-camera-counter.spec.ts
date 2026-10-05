/**
 * MOVE-CAMERA-NATIVE-PORT-1 — the camera-assisted squat MOVE flow.
 *
 * Captures (WSF_CAMERA_LABEL=before|after) are written to
 * tests-e2e/artifacts/move-camera-counter/ and are not committed by the run.
 *
 * Emulator fixture data only: synthetic accounts, a synthetic community and
 * a synthetic squat goal. No real camera is used by the capture producer.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { openPhone, seedExpoEvent } from './helpers/expo-attendee-fixtures';

test.describe.configure({ timeout: 240_000 });

const ARTIFACTS = path.resolve(__dirname, 'artifacts', 'move-camera-counter');
const LABEL = process.env.WSF_CAMERA_LABEL;

async function snap(page: Page, name: string): Promise<void> {
  if (!LABEL) return;
  mkdirSync(ARTIFACTS, { recursive: true });
  await page.screenshot({ path: path.join(ARTIFACTS, `${LABEL}-${name}.png`), fullPage: false });
}

test('capture: Settings and squat MOVE at 390x844 and 390x640', async ({ browser }) => {
  test.skip(!LABEL, 'capture producer: set WSF_CAMERA_LABEL=before|after');
  const fx = await seedExpoEvent({ tag: `camcap${LABEL}`, attendees: ['Fixture Mover'], target: 1000, seededTotal: 120 });
  for (const vp of [
    { width: 390, height: 844 },
    { width: 390, height: 640 },
  ]) {
    const phone = await openPhone(browser, fx.attendees[0]!);
    try {
      await phone.page.setViewportSize(vp);
      await phone.page.goto('/settings');
      await expect(phone.page.getByTestId('wsf-settings-screen')).toBeVisible({ timeout: 40_000 });
      await expect(phone.page.getByText('Loading your communities…')).toHaveCount(0, { timeout: 40_000 });
      await phone.page.waitForTimeout(1_200);
      await snap(phone.page, `settings-${vp.width}x${vp.height}`);

      await phone.page.goto('/move');
      await phone.page.waitForURL(/\/contribute\//, { timeout: 40_000 });
      await phone.page.waitForTimeout(2_500);
      await snap(phone.page, `move-squat-${vp.width}x${vp.height}`);
    } finally {
      await phone.context.close();
    }
  }
});
