import { expect, test, type Page } from '@playwright/test';

/**
 * W7 — CHECK 31, item 4: the real browser / fake-clock stall, independently.
 *
 * The lab's synthetic scene is driven by the lab's own requestAnimationFrame
 * loop; Playwright's fake clock controls that loop. W10's e2e case asserts on
 * the successor's new readout line; this one asserts ONLY on the rep count, so
 * it runs unchanged on the rejected head `8642e330` and on the successor
 * `eda58218`:
 *   B0  control — the loop, never stalled, counts the scene's first three reps
 *       (the zero below is not an engine that never counts);
 *   B1  the loop stalls at the bottom of rep 1 and resumes 11.2 s later with the
 *       member standing -> the unobserved completion must not count.
 * Synthetic landmarks only; no camera, no engine, no network.
 */

const BASE = process.env.WSF_PLAYWRIGHT_BASE_URL;
test.skip(!BASE, 'Set WSF_PLAYWRIGHT_BASE_URL to an emulator-flagged build of the movement lab.');
const ROUTE = '/design-target/movement-vision';

async function readout(page: Page): Promise<string> {
  return (await page.getByTestId('mv-debug-readout').textContent()) ?? '';
}
async function reps(page: Page): Promise<number> {
  return Number((await page.getByTestId('mv-reps').textContent())?.trim());
}
async function startSynthetic(page: Page): Promise<void> {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto(ROUTE);
  await page.getByTestId('mv-privacy').waitFor();
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await page.getByTestId('mv-start-synthetic').click();
}

test('B0 control: an unstalled loop counts the scene’s first three reps', async ({ page }) => {
  test.setTimeout(120_000);
  await startSynthetic(page);
  for (let i = 0; i < 180; i += 1) await page.clock.runFor(50); // ~9 s of scene
  const n = await reps(page);
  // eslint-disable-next-line no-console
  console.log(`MEASURE B0 reps after ~9 s: ${n}`);
  expect(n).toBe(3);
});

test('B1 a loop stalled at the bottom of a rep and resumed 11.2 s later does not count that rep', async ({ page }) => {
  test.setTimeout(120_000);
  await startSynthetic(page);
  let atBottom = false;
  for (let i = 0; i < 200 && !atBottom; i += 1) {
    await page.clock.runFor(50);
    atBottom = (await readout(page)).includes('phase: down');
  }
  expect(atBottom, 'never reached the bottom of rep 1').toBe(true);
  expect(await reps(page)).toBe(0);
  await page.clock.fastForward(11_200);
  for (let i = 0; i < 12; i += 1) await page.clock.runFor(50); // 600 ms of standing frames after the stall
  const n = await reps(page);
  // eslint-disable-next-line no-console
  console.log(`MEASURE B1 reps 600 ms after the resume: ${n} | ${(await readout(page)).replace(/\s+/g, ' ').slice(0, 300)}`);
  expect(n, 'the unobserved completion counted').toBe(0);
});
