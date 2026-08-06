import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('public coach discovery experience', () => {
  test('renders all scenes at the primary iPhone viewport without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/coach-discovery');

    await expect(page.getByRole('heading', { name: /Build the coaching career/i })).toBeVisible();
    await expect(page.locator('[id^="coach-discovery-scene-"]')).toHaveCount(27);
    await expect(page.locator('#coach-discovery-root h1')).toHaveCount(1);
    await expect(page.locator('#coach-discovery-root h2')).toHaveCount(26);
    await expect(page.getByRole('img', { name: /coach listening to a member/i }).first()).toBeVisible();
    await expect(page).toHaveURL(/\/coach-discovery/);
    await expect(page).toHaveTitle('Build Your Coaching Future | GoArrive');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /more human way/i);

    const overflow = await page.evaluate(() => {
      const root = document.getElementById('coach-discovery-root');
      return root ? root.scrollWidth - root.clientWidth : 999;
    });
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('supports keyboard scrolling in standard desktop mode', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/coach-discovery');
    const story = page.getByRole('region', { name: 'GoArrive coach discovery story' });
    await story.focus();
    await expect(story).toBeFocused();
    await page.keyboard.press('PageDown');
    await expect.poll(() => story.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  });

  test('renders the sanitized Build product capture in the coach experience', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/coach-discovery?present=1');
    await page.evaluate(() => {
      document.getElementById('coach-discovery-scene-14')?.scrollIntoView();
    });

    const buildCapture = page.getByRole('img', {
      name: /Sanitized GoArrive Build workspace showing workout cards/i,
    });
    await expect(buildCapture).toHaveCount(1);
    await expect(buildCapture).toBeVisible();
    await expect(buildCapture).toHaveAttribute('src', '/coach-discovery/product-build.webp');
  });

  test('has no automatically detectable WCAG A or AA violations', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/coach-discovery');
    await page.locator('#coach-discovery-root').waitFor({ state: 'attached' });
    const results = await new AxeBuilder({ page })
      .include('#coach-discovery-root')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });

  test('emits the scoped product events and routes the final CTA', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__coachDiscoveryEvents = [];
      window.addEventListener('goarrive:coach-discovery', (event) => {
        (window as any).__coachDiscoveryEvents.push((event as CustomEvent).detail);
      });
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/coach-discovery');
    await expect.poll(() => page.evaluate(() =>
      (window as any).__coachDiscoveryEvents.some((item: any) => item.event === 'experience_opened'),
    )).toBe(true);

    await page.evaluate(() => document.getElementById('coach-discovery-scene-19')?.scrollIntoView());
    await expect.poll(() => page.evaluate(() =>
      (window as any).__coachDiscoveryEvents.some((item: any) => item.event === 'compensation_section_viewed'),
    )).toBe(true);

    await page.evaluate(() => document.getElementById('coach-discovery-scene-27')?.scrollIntoView());
    await page.getByRole('button', { name: /Continue to the GoArrive coach application/i }).click();
    await expect(page).toHaveURL(/\/coach-apply/);
    await expect.poll(() => page.evaluate(() =>
      (window as any).__coachDiscoveryEvents.some((item: any) => item.event === 'next_step_cta_selected'),
    )).toBe(true);
  });

  test('supports reduced motion and presentation keyboard navigation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/coach-discovery?present=1');
    await expect(page.getByText('01', { exact: true }).first()).toBeVisible();

    await page.keyboard.press('End');
    await expect(page.getByText('27', { exact: true }).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Continue to the GoArrive coach application/i })).toBeVisible();
  });

  test('keeps compensation qualifiers and future leadership status explicit', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/coach-discovery?present=1');
    await page.keyboard.press('End');
    await page.evaluate(() => {
      document.getElementById('coach-discovery-scene-21')?.scrollIntoView();
    });

    await expect(page.getByText('PLANNED · NOT IN CURRENT TERMS')).toBeVisible();
    await expect(page.getByText(/High-level education only/i).last()).toBeVisible();
    await expect(page.getByText(/7% of the receiving coach’s net revenue/i)).toBeVisible();
    await expect(page.getByText(/up to 10 additional percentage points/i)).toBeVisible();
  });
});
