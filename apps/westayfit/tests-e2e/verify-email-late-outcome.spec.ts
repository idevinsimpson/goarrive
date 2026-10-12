/**
 * THE RENDER BOUNDARY.
 *
 * Sign-up starts the verification send, the auth effect moves the new member
 * to /verify-email immediately, and the send finishes afterwards. So the
 * screen is already mounted when the answer arrives. Storing that answer is
 * not enough: whoever is showing it has to be told, or the member sits looking
 * at "Sending" until some unrelated render happens to pick it up.
 *
 * These tests hold the send open on purpose, assert what the screen says while
 * nothing is known, then release a specific outcome and assert the screen
 * changes ON ITS OWN — no Resend, no reload, no other tap.
 */
import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

const PASSWORD = 'late-outcome-1';
const unique = (label: string) => `${label}-${randomBytes(6).toString('hex')}@example.com`;

/** Holds every verification send until the test chooses how it ends. */
async function holdVerificationSend(page: Page): Promise<{
  waitForRequest: () => Promise<void>;
  release: (how: 'sent' | 'unconfigured') => Promise<void>;
}> {
  let pending: Route | null = null;
  let arrived: (() => void) | null = null;
  const requestArrived = new Promise<void>((resolve) => {
    arrived = resolve;
  });

  await page.route('**/wsfSendVerificationEmail**', async (route) => {
    pending = route;
    arrived?.();
  });

  return {
    waitForRequest: () => requestArrived,
    release: async (how) => {
      if (!pending) throw new Error('no verification send was held');
      if (how === 'sent') {
        await pending.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ result: { sent: true } }),
        });
      } else {
        // Exactly what an unconfigured build returns: the client keys on this
        // code to show its honest copy.
        await pending.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              status: 'FAILED_PRECONDITION',
              message: 'WSF email sending is not configured.',
            },
          }),
        });
      }
      pending = null;
    },
  };
}

async function startSignUp(page: Page, email: string): Promise<void> {
  await page.goto('/signup');
  await page.getByTestId('wsf-signup-displayName').fill('Late Outcome');
  await page.getByTestId('wsf-signup-email').fill(email);
  await page.getByTestId('wsf-signup-password').fill(PASSWORD);
  await page.getByTestId('wsf-signup-submit').click();
}

test('an unconfigured answer that lands after the screen is mounted reaches it with no further tap', async ({
  page,
}) => {
  const held = await holdVerificationSend(page);
  await startSignUp(page, unique('late-unconf'));

  // The screen is up and the send is still in the air.
  const verify = page.getByTestId('wsf-verify');
  await expect(verify).toBeVisible({ timeout: 20_000 });
  await held.waitForRequest();
  // Nothing is known yet, so nothing is claimed: it must NOT say a link was sent.
  await expect(verify).not.toContainText('We sent a verification link');

  // Release the truth. No tap, no reload, no navigation follows this line.
  await held.release('unconfigured');

  await expect(page.getByTestId('wsf-verify-unconfigured')).toBeVisible({ timeout: 15_000 });
  // The copy moved to the Batch A target's wording, which says the same two
  // things in one sentence instead of repeating them in a panel below. The
  // properties this test exists for are unchanged and both still asserted:
  // the screen states plainly that nothing was sent, and it never claims a
  // link was.
  await expect(verify).toContainText('No message was sent');
  await expect(verify).toContainText('until email is switched on');
  await expect(verify).not.toContainText('We sent a verification link');
});

test('a successful answer that lands late also reaches the mounted screen', async ({ page }) => {
  const held = await holdVerificationSend(page);
  await startSignUp(page, unique('late-sent'));

  const verify = page.getByTestId('wsf-verify');
  await expect(verify).toBeVisible({ timeout: 20_000 });
  await held.waitForRequest();
  await expect(verify).not.toContainText('We sent a verification link');

  await held.release('sent');

  // Changed on its own.
  await expect(verify).toContainText('We sent a verification link', { timeout: 15_000 });
  await expect(page.getByTestId('wsf-verify-unconfigured')).toHaveCount(0);
});

test('signing out clears the previous account’s claim from the screen', async ({ page }) => {
  const held = await holdVerificationSend(page);
  await startSignUp(page, unique('late-signout'));

  const verify = page.getByTestId('wsf-verify');
  await expect(verify).toBeVisible({ timeout: 20_000 });
  await held.waitForRequest();
  await held.release('sent');
  await expect(verify).toContainText('We sent a verification link', { timeout: 15_000 });

  await page.getByTestId('wsf-verify-signout').click();
  await expect(page.getByTestId('wsf-home-signed-out')).toBeVisible({ timeout: 20_000 });

  // A different account, starting from nothing: the previous account's claim
  // must not describe this one.
  const held2 = await holdVerificationSend(page);
  await startSignUp(page, unique('late-second'));
  await expect(page.getByTestId('wsf-verify')).toBeVisible({ timeout: 20_000 });
  await held2.waitForRequest();
  await expect(page.getByTestId('wsf-verify')).not.toContainText('We sent a verification link');
  await held2.release('unconfigured');
  await expect(page.getByTestId('wsf-verify-unconfigured')).toBeVisible({ timeout: 15_000 });
});
