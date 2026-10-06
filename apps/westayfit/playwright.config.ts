import { defineConfig, devices } from '@playwright/test';

// Optional escape hatch for environments that already ship a Chromium and
// cannot run `playwright install` — set WSF_PLAYWRIGHT_CHROMIUM to that
// binary. Left unset, Playwright uses its own managed download, so CI and a
// normal dev machine are unaffected.
const chromiumPath = process.env.WSF_PLAYWRIGHT_CHROMIUM;
const baseURL = process.env.WSF_PLAYWRIGHT_BASE_URL;

// MOVE-CAMERA-NATIVE-PORT-1 (Director #497 5999288273). TEST CONTEXT ONLY.
// The product default is the squat camera counter ON. The specs written
// before it walk the manual squat flow, so every test context starts with
// that member choice stored OFF on this device, preserving their pre-camera
// assumption. move-camera-counter.spec.ts clears or overrides it, and proves
// the real default is ON / ON.
const MANUAL_SQUAT_FLOW_STORAGE = { name: 'wsf.moveCamera.v1', value: '{"cameraCounter":false,"stickFigure":true}' };
const manualSquatFlow = baseURL
  ? { cookies: [], origins: [{ origin: new URL(baseURL).origin, localStorage: [MANUAL_SQUAT_FLOW_STORAGE] }] }
  : undefined;

export default defineConfig({
  testDir: './tests-e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  use: {
    baseURL,
    storageState: manualSquatFlow,
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
