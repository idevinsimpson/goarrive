import { expect, test } from '@playwright/test';

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL, 'WSF_PLAYWRIGHT_BASE_URL must be set to run WSF e2e specs.');
});

test('renders the build stamp at /health', async ({ page }) => {
  const response = await page.goto('/health');
  expect(response, 'GET /health must return a response').not.toBeNull();
  expect(response!.status(), 'GET /health must be 2xx').toBeLessThan(400);

  await expect(page.getByText('Health', { exact: true })).toBeVisible();

  const commit = (await page.getByTestId('wsf-health-commit').textContent())?.trim();
  const builtAt = (await page.getByTestId('wsf-health-builtAt').textContent())?.trim();

  expect(commit, 'commit stamp must be non-empty').toBeTruthy();
  expect(builtAt, 'build time stamp must be non-empty').toBeTruthy();

  expect(
    commit,
    'commit stamp must be a real short SHA injected at build time, not the local-dev "dev" fallback'
  ).not.toBe('dev');
  expect(commit, 'commit stamp must look like a 7-40 char lowercase hex short SHA').toMatch(/^[0-9a-f]{7,40}$/);

  const robots = await page.locator('meta[name="robots"]').getAttribute('content');
  expect(robots, '/health must be noindex,nofollow').toContain('noindex');
});
