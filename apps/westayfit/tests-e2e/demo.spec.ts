import { expect, test } from '@playwright/test';

// Smoke tests + screenshot capture for the /demo experience. Runs against
// whatever WSF_PLAYWRIGHT_BASE_URL points at (staging preview channel or a
// local static server). None of these tests write to Firestore or hit auth.
//
// Screenshots produced:
//   demo-picker-phone.png / demo-picker-desktop.png
//   demo-squats-phone.png / demo-squats-desktop.png
//   demo-squats-milestone-phone.png / demo-squats-milestone-desktop.png
//   demo-display-phone.png / demo-display-desktop.png
//   demo-display-goal-phone.png / demo-display-goal-desktop.png
//
// Files land in apps/westayfit/tests-e2e/screenshots/.

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

test.describe('demo picker', () => {
  test('shows sample-data banner, WE total, and squats card', async ({ page }) => {
    // The picker uses a ScrollView (rendered as overflow:auto div), so
    // Playwright's fullPage capture doesn't reach inside it. A tall viewport
    // lets the whole flow fit in one frame for the screenshot.
    await page.setViewportSize({ width: DESKTOP.width, height: 1400 });
    await page.goto('/demo');
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('demo-banner')).toContainText('Interactive demo');
    await expect(page.getByTestId('demo-banner')).toContainText('Sample data');
    await expect(page.getByTestId('demo-picker-we-total')).toContainText('980');
    await expect(page.getByTestId('demo-picker-we-total')).toContainText('1,000');
    await expect(page.getByTestId('demo-activity-squats')).toContainText('Ready');
    await expect(page.getByTestId('demo-activity-jumping-jacks')).toContainText('Coming soon');
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-picker-desktop.png' });

    await page.setViewportSize({ width: PHONE.width, height: 1400 });
    await page.reload();
    await expect(page.getByTestId('demo-picker-we-total')).toBeVisible();
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-picker-phone.png' });
  });
});

test.describe('demo squats flow', () => {
  test('renders ready state with begin + simulate options', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/demo/squats');
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('demo-squats-ready')).toBeVisible();
    await expect(page.getByTestId('demo-squats-begin')).toBeVisible();
    await expect(page.getByTestId('demo-squats-simulate')).toBeVisible();
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-squats-desktop.png' });

    await page.setViewportSize(PHONE);
    await page.reload();
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-squats-phone.png' });
  });

  test('simulate button crosses the milestone and shows celebration', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/demo/squats');
    // Reset first so the simulate cleanly crosses from 980 → 1000.
    await page.evaluate(() => window.localStorage.removeItem('wsf-demo-state-v1'));
    await page.reload();
    await page.getByTestId('demo-squats-simulate').click();
    await expect(page.getByTestId('demo-squats-recorded')).toBeVisible();
    await expect(page.getByTestId('demo-squats-milestone')).toBeVisible();
    await expect(page.getByTestId('demo-squats-milestone')).toContainText('Milestone');
    // Wait past the 40-step * 40ms count-up so the helper line settles on 1,000
    // instead of catching the animation mid-flight.
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-squats-milestone-desktop.png' });

    await page.setViewportSize(PHONE);
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-squats-milestone-phone.png' });
  });
});

test.describe('demo community display', () => {
  test('shows current total and goal from shared state', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    // Reset to baseline for a stable pre-goal screenshot.
    await page.goto('/demo');
    await page.evaluate(() => window.localStorage.removeItem('wsf-demo-state-v1'));
    await page.goto('/demo/display');
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('demo-display-value')).toContainText('980');
    await expect(page.getByTestId('demo-display-encourage')).toBeVisible();
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-display-desktop.png' });

    await page.setViewportSize(PHONE);
    await page.reload();
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-display-phone.png' });
  });

  test('shows goal-reached celebration when squats hit 1000', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/demo');
    await page.evaluate(() =>
      window.localStorage.setItem(
        'wsf-demo-state-v1',
        JSON.stringify({
          squats: { current: 1000, goal: 1000 },
          milestoneCelebrated: true,
          updatedAt: 1,
        })
      )
    );
    await page.goto('/demo/display');
    await expect(page.getByTestId('demo-display-celebration')).toBeVisible();
    await expect(page.getByTestId('demo-display-value')).toContainText('1,000');
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-display-goal-desktop.png' });

    await page.setViewportSize(PHONE);
    await page.reload();
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-display-goal-phone.png' });
  });
});
