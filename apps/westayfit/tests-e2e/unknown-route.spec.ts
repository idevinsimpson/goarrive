import { expect, test } from '@playwright/test';

test.beforeEach(({ baseURL }) => {
  test.skip(!baseURL, 'WSF_PLAYWRIGHT_BASE_URL must be set to run WSF e2e specs.');
});

test('unknown route returns 404 without leaking a stack trace or GoArrive content', async ({ page }) => {
  const response = await page.goto('/definitely-not-a-real-wsf-route');
  expect(response, 'GET unknown route must return a response').not.toBeNull();

  expect(response!.status(), 'unknown route must be 404').toBe(404);

  const body = await page.content();
  expect(body.toLowerCase()).not.toContain('goarrive');
  expect(body.toLowerCase()).not.toContain('command center');
});
