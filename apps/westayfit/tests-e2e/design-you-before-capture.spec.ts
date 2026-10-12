import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * ACTUAL CURRENT BEFORE for YOU — `/you`.
 *
 * Real screenshots of the product as it renders today. These are NOT targets.
 * Nothing here is drawn.
 *
 * Note for the record: the route is `/you`, not `/profile`. `/profile-setup`
 * exists as a step on the way to having an account; there is no `/profile`.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/page-05-you/before');

/* Opt-in and off by default — the rule every earlier BEFORE learned. */
const CAPTURE_BEFORE = /^(1|true)$/i.test(process.env.WSF_CAPTURE_BEFORE ?? '');

test.skip(
  !CAPTURE_BEFORE,
  'BEFORE frames are frozen evidence; set WSF_CAPTURE_BEFORE=1 to re-baseline them deliberately.',
);

const CLASSES = [
  { key: '390x844', viewport: { width: 390, height: 844 } },
  { key: '390x640', viewport: { width: 390, height: 640 } },
  { key: '430x932', viewport: { width: 430, height: 932 } },
] as const;

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

async function phone(browser: Browser, viewport: { width: number; height: number }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    userAgent: IPHONE_UA,
    timezoneId: 'America/New_York',
  });
  return { context, page: await context.newPage() };
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

for (const cls of CLASSES) {
  test(`you BEFORE — ${cls.key}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const id = stampId();
    const email = `wsf-yb${cls.key.replace('x', '')}-${id}@example.com`;
    const password = `Pw-${randomBytes(9).toString('base64url')}`;
    const uid = await seedVerifiedUser(email, password);
    await seedProfile(uid, 'Devin Simpson');

    // ── signed in ───────────────────────────────────────────────────────────
    {
      const { context, page } = await phone(browser, cls.viewport);
      await signInVia(page, email, password);
      await page.goto('/you');
      await expect(page.getByTestId('wsf-you-identity')).toBeVisible({ timeout: 40_000 });
      await shot(page, `BEFORE-identity-${cls.key}`);
      await context.close();
    }

    // ── signed out ──────────────────────────────────────────────────────────
    {
      const { context, page } = await phone(browser, cls.viewport);
      await page.goto('/you');
      await expect(page.getByTestId('wsf-you-signed-out')).toBeVisible({ timeout: 40_000 });
      await shot(page, `BEFORE-signed-out-${cls.key}`);
      await context.close();
    }
  });
}
