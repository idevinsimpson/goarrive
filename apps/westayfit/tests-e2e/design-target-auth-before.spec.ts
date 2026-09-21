import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Browser, type Page } from '@playwright/test';

import { seedVerifiedUser, stampId } from './helpers/mobile';

/**
 * ACTUAL CURRENT BEFORE for Atlas Batch A — identity and onboarding.
 *
 * Real screenshots of the product as it renders today. Nothing here is drawn.
 * These exist so the Batch A targets are compared against the thing they are
 * actually replacing rather than against a memory of it.
 *
 * TWO OF THESE ARE THE SAME ROUTE IN A DIFFERENT SITUATION. "Return to event"
 * and "return to join" are not pages: they are the sign-in screen with a
 * pending destination waiting in sessionStorage, which `nextRouteAfterAuth`
 * consumes on the terminal hop. Capturing them proves what the target has to
 * fix -- today the screen says nothing at all about where the visitor is
 * going to land.
 */
const OUT = path.resolve(__dirname, '../../../docs/design-target/review/batch-a-identity/before');

const CLASSES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
];

async function shoot(page: Page, name: string, key: string) {
  // The Living WE and the wordmark are images; let them decode.
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `BEFORE-${name}-${key}.png`) });
}

test('Batch A: the identity surfaces as they render today', async ({
  browser,
}: {
  browser: Browser;
}) => {
  test.setTimeout(240_000);
  for (const c of CLASSES) {
    const ctx = await browser.newContext({
      viewport: { width: c.width, height: c.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    try {
      const page = await ctx.newPage();

      // ---- the three surfaces a signed-out visitor can reach directly -----
      await page.goto('/signin');
      await expect(page.getByTestId('wsf-signin')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'signin', c.key);

      await page.goto('/signup');
      await expect(page.getByTestId('wsf-signup')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'signup', c.key);

      await page.goto('/reset-password');
      await expect(page.getByTestId('wsf-reset')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'reset-password', c.key);

      // ---- the error state ------------------------------------------------
      // Firebase collapses "no such user" and "wrong password" into one code,
      // so this is the shape every credential failure takes.
      await page.goto('/signin');
      await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('wsf-signin-email').fill(`nobody-${stampId()}@example.com`);
      await page.getByTestId('wsf-signin-password').fill('definitely-not-the-password');
      await page.getByTestId('wsf-signin-submit').click();
      await expect(page.getByTestId('wsf-signin-error')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'auth-error', c.key);

      // ---- verify email: a real, freshly created, unverified account ------
      const id = stampId();
      const email = `wsf-batcha-${id}@example.com`;
      const password = `Pw-${randomBytes(9).toString('base64url')}`;
      await page.goto('/signup');
      await expect(page.getByTestId('wsf-signup')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('wsf-signup-displayName').fill('Devin');
      await page.getByTestId('wsf-signup-email').fill(email);
      await page.getByTestId('wsf-signup-password').fill(password);
      await page.getByTestId('wsf-signup-submit').click();
      await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 40_000 });
      await shoot(page, 'verify-email', c.key);

    } finally {
      await ctx.close();
    }

    // ---- profile setup: verified, signed in, no profile written ----------
    // ITS OWN CONTEXT. The signup above left an unverified member SIGNED IN,
    // and Firebase persists that in IndexedDB, which clearing cookies does
    // not touch -- /signin would redirect straight back to /verify-email.
    const ctx2 = await browser.newContext({
      viewport: { width: c.width, height: c.height },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    try {
      const page2 = await ctx2.newPage();
      const email2 = `wsf-batcha-p-${stampId()}@example.com`;
      const password2 = `Pw-${randomBytes(9).toString('base64url')}`;
      await seedVerifiedUser(email2, password2);
      await page2.goto('/signin');
      await expect(page2.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 30_000 });
      await page2.getByTestId('wsf-signin-email').fill(email2);
      await page2.getByTestId('wsf-signin-password').fill(password2);
      await page2.getByTestId('wsf-signin-submit').click();
      await expect(page2.getByTestId('wsf-profile')).toBeVisible({ timeout: 40_000 });
      await shoot(page2, 'profile-setup', c.key);
    } finally {
      await ctx2.close();
    }

    // ---- the two returns, which are sign-in carrying a destination -------
    const returns: [string, string, string][] = [
      ['return-to-join', 'wsf.pendingJoinCode', 'ABC123'],
      ['return-to-event', 'wsf.pendingEventGoalId', 'goal-demo-1'],
    ];
    for (const [name, key, value] of returns) {
      const ctx3 = await browser.newContext({
        viewport: { width: c.width, height: c.height },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      });
      try {
        const page3 = await ctx3.newPage();
        await page3.goto('/signin');
        await expect(page3.getByTestId('wsf-signin')).toBeVisible({ timeout: 30_000 });
        await page3.evaluate(
          ([k, v]: [string, string]) => window.sessionStorage.setItem(k, v),
          [key, value] as [string, string]
        );
        await page3.reload();
        await expect(page3.getByTestId('wsf-signin')).toBeVisible({ timeout: 30_000 });
        await shoot(page3, name, c.key);
      } finally {
        await ctx3.close();
      }
    }
  }
});
