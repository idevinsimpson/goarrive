import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL, 'WSF_PLAYWRIGHT_BASE_URL must be set to run WSF e2e specs.');
});

test('renders the brand shell at /', async ({ page }) => {
  const response = await page.goto('/');
  expect(response, 'GET / must return a response').not.toBeNull();
  expect(response!.status(), 'GET / must be 2xx').toBeLessThan(400);

  await expect(page).toHaveTitle('We Stay Fit');

  const robots = await page.locator('meta[name="robots"]').getAttribute('content');
  expect(robots, 'brand shell must be noindex,nofollow').toContain('noindex');
  expect(robots).toContain('nofollow');

  await expect(page.getByText('Wherever your people gather, We Stay Fit.')).toBeVisible();
});

test('brand shell has no serious or critical axe violations', async ({ page }) => {
  const response = await page.goto('/');
  expect(response!.status()).toBeLessThan(400);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();

  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(
    serious,
    `Axe found ${serious.length} serious/critical violation(s): ${serious.map((v) => v.id).join(', ')}`
  ).toEqual([]);
});
