import { expect, test } from '@playwright/test';

// Smoke tests + screenshot capture for the /demo experience. Runs against
// whatever WSF_PLAYWRIGHT_BASE_URL points at (staging preview channel or a
// local static server). None of these tests write to Firestore or hit auth.
//
// Screenshots produced:
//   demo-picker-phone.png / demo-picker-desktop.png
//   demo-squats-ready-phone.png / demo-squats-ready-desktop.png
//   demo-squats-entering-phone.png / demo-squats-entering-desktop.png
//   demo-squats-recorded-phone.png / demo-squats-recorded-desktop.png
//   demo-squats-milestone-phone.png / demo-squats-milestone-desktop.png
//   demo-display-phone.png / demo-display-desktop.png
//   demo-display-goal-phone.png / demo-display-goal-desktop.png
//
// Files land in apps/westayfit/tests-e2e/screenshots/.

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

test.describe('demo picker', () => {
  test('shows sample-data banner, WE total, hero squats card, and concepts block', async ({ page }) => {
    // Tall viewport so the whole picker fits in a single screenshot.
    await page.setViewportSize({ width: DESKTOP.width, height: 1400 });
    await page.goto('/demo');
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('demo-banner')).toContainText('Interactive demo');
    await expect(page.getByTestId('demo-banner')).toContainText('Sample data');
    await expect(page.getByTestId('demo-picker-we-total')).toContainText('980');
    await expect(page.getByTestId('demo-picker-we-total')).toContainText('1,000');
    await expect(page.getByTestId('demo-activity-squats')).toContainText('Squats');
    await expect(page.getByTestId('demo-activity-squats')).toContainText('Ready');
    await expect(page.getByTestId('demo-picker-concepts')).toBeVisible();
    await expect(page.getByTestId('demo-picker-concepts')).toContainText('Not in this demo');
    await expect(page.getByTestId('demo-picker-concepts')).toContainText('Jumping jacks');
    // Concepts block must NOT market these as coming soon or Ready.
    await expect(page.getByTestId('demo-picker-concepts')).not.toContainText('Coming soon');
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-picker-desktop.png' });

    await page.setViewportSize({ width: PHONE.width, height: 1400 });
    await page.reload();
    await expect(page.getByTestId('demo-picker-we-total')).toBeVisible();
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-picker-phone.png' });
  });
});

test.describe('demo squats — ready screen', () => {
  test('renders three paths: start timer, skip timer, simulate', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/demo/squats');
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('demo-squats-ready')).toBeVisible();
    await expect(page.getByTestId('demo-squats-start-timer')).toBeVisible();
    await expect(page.getByTestId('demo-squats-skip-timer')).toBeVisible();
    await expect(page.getByTestId('demo-squats-simulate')).toBeVisible();
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-squats-ready-desktop.png' });

    await page.setViewportSize(PHONE);
    await page.reload();
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-squats-ready-phone.png' });
  });
});

test.describe('demo squats — manual entry with overshoot', () => {
  test('skip timer → enter 35 → logs 1015 with visible YOU→WE and milestone', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/demo/squats');
    // Reset first so 980 → 980 + 35 = 1015 is deterministic.
    await page.evaluate(() => window.localStorage.removeItem('wsf-demo-state-v1'));
    await page.reload();

    await page.getByTestId('demo-squats-skip-timer').click();
    await expect(page.getByTestId('demo-squats-entering')).toBeVisible();

    const input = page.getByTestId('demo-squats-entry-input');
    await input.fill('35');
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-squats-entering-desktop.png' });

    await page.getByTestId('demo-squats-log').click();
    await expect(page.getByTestId('demo-squats-recorded')).toBeVisible();
    await expect(page.getByTestId('demo-squats-milestone')).toBeVisible();
    await expect(page.getByTestId('demo-squats-milestone')).toContainText('Milestone');
    await expect(page.getByTestId('demo-squats-you-block')).toContainText('35');
    // Wait past the count-up animation (≤ 40 steps × 40ms) so the screenshot lands on 1,015.
    await page.waitForTimeout(2200);
    await expect(page.getByTestId('demo-squats-we-block')).toContainText('1,015');
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-squats-milestone-desktop.png' });

    await page.setViewportSize(PHONE);
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-squats-milestone-phone.png' });

    await page.setViewportSize(PHONE);
    await page.reload();
    // Land on ready to grab entering-phone at the correct viewport.
    await page.getByTestId('demo-squats-add-more').isVisible().catch(() => null);
    await page.evaluate(() =>
      window.localStorage.setItem(
        'wsf-demo-state-v1',
        JSON.stringify({
          squats: { current: 980, goal: 1000 },
          milestoneCelebrated: false,
          updatedAt: 1,
        })
      )
    );
    await page.reload();
    await page.getByTestId('demo-squats-skip-timer').click();
    await page.getByTestId('demo-squats-entry-input').fill('35');
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-squats-entering-phone.png' });
  });
});

test.describe('demo squats — repeat submissions, guards, cancel', () => {
  test('later sets stack; milestone fires once; cancel and zero do not mutate state', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/demo/squats');
    await page.evaluate(() => window.localStorage.removeItem('wsf-demo-state-v1'));
    await page.reload();

    // First set: 15 (below goal).
    await page.getByTestId('demo-squats-skip-timer').click();
    await page.getByTestId('demo-squats-entry-input').fill('15');
    await page.getByTestId('demo-squats-log').click();
    await expect(page.getByTestId('demo-squats-recorded')).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.getByTestId('demo-squats-we-block')).toContainText('995');

    // Second set: 20 → total 1015 with milestone.
    await page.getByTestId('demo-squats-add-more').click();
    await expect(page.getByTestId('demo-squats-ready')).toBeVisible();
    await page.getByTestId('demo-squats-skip-timer').click();
    await page.getByTestId('demo-squats-entry-input').fill('20');
    await page.getByTestId('demo-squats-log').click();
    await expect(page.getByTestId('demo-squats-milestone')).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.getByTestId('demo-squats-we-block')).toContainText('1,015');

    // Screenshot recorded state after two sets.
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-squats-recorded-desktop.png' });

    // Third set: 10 after milestone still stacks and does NOT re-fire milestone.
    await page.getByTestId('demo-squats-add-more').click();
    await page.getByTestId('demo-squats-skip-timer').click();
    await page.getByTestId('demo-squats-entry-input').fill('10');
    await page.getByTestId('demo-squats-log').click();
    await expect(page.getByTestId('demo-squats-recorded')).toBeVisible();
    await page.waitForTimeout(700);
    await expect(page.getByTestId('demo-squats-we-block')).toContainText('1,025');
    await expect(page.getByTestId('demo-squats-milestone')).toHaveCount(0);

    // Cancel and zero-entry guards: reset, filling 0 leaves the Log button
    // disabled (guard rejects zero-effort submits). Cancel returns to ready
    // without mutating the total.
    await page.getByTestId('demo-squats-reset').click();
    await expect(page.getByTestId('demo-squats-ready')).toBeVisible();
    await page.getByTestId('demo-squats-skip-timer').click();
    await page.getByTestId('demo-squats-entry-input').fill('0');
    await expect(page.getByTestId('demo-squats-log')).toBeDisabled();
    await page.getByTestId('demo-squats-cancel-entry').click();
    await expect(page.getByTestId('demo-squats-ready')).toBeVisible();
    const totalAfterCancel = await page.getByTestId('demo-squats-total').innerText();
    expect(totalAfterCancel).toContain('980');

    await page.setViewportSize(PHONE);
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-squats-recorded-phone.png' });
  });
});

test.describe('demo squats — replay', () => {
  test('reset from recorded state re-arms milestone for the next run', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/demo/squats');
    await page.evaluate(() => window.localStorage.removeItem('wsf-demo-state-v1'));
    await page.reload();

    // First run: simulate hits milestone.
    await page.getByTestId('demo-squats-simulate').click();
    await expect(page.getByTestId('demo-squats-milestone')).toBeVisible();

    // Reset and replay from the recorded panel.
    await page.getByTestId('demo-squats-reset').click();
    await expect(page.getByTestId('demo-squats-ready')).toBeVisible();
    await page.getByTestId('demo-squats-simulate').click();
    // Milestone re-fires because the latch cleared on reset.
    await expect(page.getByTestId('demo-squats-milestone')).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.getByTestId('demo-squats-we-block')).toContainText('1,000');
  });
});

test.describe('demo community display', () => {
  test('shows current total and goal from shared state', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/demo');
    await page.evaluate(() => window.localStorage.removeItem('wsf-demo-state-v1'));
    await page.goto('/demo/display');
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.getByTestId('demo-display-value')).toContainText('980');
    await expect(page.getByTestId('demo-display-encourage')).toBeVisible();
    await expect(page.getByTestId('demo-display-percent')).toContainText('98%');
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-display-desktop.png' });

    await page.setViewportSize(PHONE);
    await page.reload();
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-display-phone.png' });
  });

  test('goal-reached celebration acknowledges overshoot when squats exceed 1000', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto('/demo');
    await page.evaluate(() =>
      window.localStorage.setItem(
        'wsf-demo-state-v1',
        JSON.stringify({
          squats: { current: 1015, goal: 1000 },
          milestoneCelebrated: true,
          updatedAt: 1,
        })
      )
    );
    await page.goto('/demo/display');
    await expect(page.getByTestId('demo-display-celebration')).toBeVisible();
    await expect(page.getByTestId('demo-display-value')).toContainText('1,015');
    await expect(page.getByTestId('demo-display-percent')).toContainText('102%');
    await expect(page.getByTestId('demo-display-celebration')).toContainText('past the goal');
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-display-goal-desktop.png' });

    await page.setViewportSize(PHONE);
    await page.reload();
    await page.screenshot({ path: 'tests-e2e/screenshots/demo-display-goal-phone.png' });
  });
});
