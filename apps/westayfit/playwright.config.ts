import { defineConfig, devices } from '@playwright/test';

// Optional escape hatch for environments that already ship a Chromium and
// cannot run `playwright install` — set WSF_PLAYWRIGHT_CHROMIUM to that
// binary. Left unset, Playwright uses its own managed download, so CI and a
// normal dev machine are unaffected.
const chromiumPath = process.env.WSF_PLAYWRIGHT_CHROMIUM;

export default defineConfig({
  testDir: './tests-e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  use: {
    baseURL: process.env.WSF_PLAYWRIGHT_BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
  ],
});
