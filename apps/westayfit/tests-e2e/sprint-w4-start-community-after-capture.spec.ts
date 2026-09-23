import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

import { CAPTURE_FRAMES, saveFrame } from './helpers/capture';
import { PROJECT_ID, seedProfile, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * `/start-community` AFTER — the implemented route, photographed.
 *
 * Every frame here is the real page against the real callable on
 * `demo-wsf-local`. Nothing is drawn, and the states are reached the way a
 * member reaches them: a refusal comes from a member with no profile, and the
 * unconfirmed state comes from a create whose request really lands and whose
 * RESPONSE is thrown away — the community exists behind the frame that says we
 * cannot confirm it.
 *
 * ONE ACCEPTED STATE HAS NO AFTER FRAME: `created`, the confirmed create whose
 * navigation failed. It cannot be staged in a browser, and that is measured
 * rather than assumed — breaking `history.replaceState`, by throwing or by
 * silently doing nothing, unmounts this screen anyway, because Expo Router
 * leaves the source route from its own state before it writes history. The
 * state is covered in `tests/start-community-outcomes.test.tsx`, both through a
 * throwing `router.replace` and through the grace period elapsing. Reported
 * rather than faked: a frame of that screen would have to be a drawing, and
 * this package is AFTER evidence.
 *
 * WRITES ARE OPT-IN (`helpers/capture`). An ordinary run asserts every state
 * and writes nothing; frames appear only under WSF_CAPTURE_FRAMES=1.
 */

const OUT = path.resolve(
  __dirname,
  '../../../docs/design-target/review/start-community-next/after',
);

const CLASSES = [
  { w: 390, h: 844 },
  { w: 390, h: 640 },
  { w: 430, h: 932 },
] as const;

const CREATE_URL = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1/wsfCreateCommunity`;

const NAME = 'Harbor Walkers';
/** 84 characters after trimming — just over the callable's ceiling. */
const LONG_NAME =
  'The Henderson Family Reunion Walking and Stretching Group of Greater Portland, Maine';

async function signedIn(page: Page, withProfile: boolean): Promise<void> {
  const email = `wsf-after-${stampId()}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  if (withProfile) await seedProfile(uid, 'After Capture Member');
  await signInVia(page, email, password);
}

async function openStart(page: Page): Promise<void> {
  await page.goto('/start-community');
  await expect(page.getByTestId('wsf-start')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-start-name')).toBeVisible();
}

/** Bring a control into frame the way a member would, then shoot. */
async function frameOn(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).scrollIntoViewIfNeeded();
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 10_000 });
}

async function toTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const n of Array.from(document.querySelectorAll('*'))) {
      (n as HTMLElement).scrollTop = 0;
    }
  });
  await page.waitForTimeout(120);
}

async function toEnd(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    let moved = false;
    for (const n of Array.from(document.querySelectorAll('*'))) {
      const el = n as HTMLElement;
      if (el.scrollHeight > el.clientHeight + 4) {
        el.scrollTop = el.scrollHeight;
        moved = true;
      }
    }
    return moved;
  });
}

for (const { w, h } of CLASSES) {
  const c = `${w}x${h}`;
  test.describe(c, () => {
    test.use({ viewport: { width: w, height: h } });

    test('arrival, the name ceiling, a real refusal and a real unconfirmed create', async ({
      page,
    }) => {
      test.setTimeout(180_000);

      // ---- arrival -------------------------------------------------------
      await signedIn(page, true);
      await openStart(page);
      await expect(page.getByTestId('wsf-start-groupType')).toBeVisible();
      await expect(page.getByTestId('wsf-start-joinPolicy')).toBeVisible();
      // The shared navigation is still here. The target drew no tab bar; that
      // was a drawing, not permission to remove the shell.
      await expect(page.getByTestId('wsf-member-tabs')).toBeVisible();
      await saveFrame(page, path.join(OUT, `AFTER-start-arrival-${c}.png`));

      // ---- the ceiling, stated locally -----------------------------------
      await page.getByTestId('wsf-start-name').fill(LONG_NAME);
      await expect(page.getByTestId('wsf-start-name-error')).toHaveText(
        'Use 80 characters or fewer. This name is 84.',
      );
      await frameOn(page, 'wsf-start-name-error');
      await saveFrame(page, path.join(OUT, `AFTER-start-name-too-long-${c}.png`));

      // ---- an unconfirmed create, from a request that really landed ------
      await page.getByTestId('wsf-start-name').fill(NAME);
      await page.route(CREATE_URL, async (route: Route) => {
        await route.fetch().catch(() => undefined);
        await route.abort('failed').catch(() => undefined);
      });
      await frameOn(page, 'wsf-start-submit');
      await page.getByTestId('wsf-start-submit').click();
      await expect(page.getByTestId('wsf-start-outcome-title')).toHaveText(
        'We couldn’t confirm your community was created.',
        { timeout: 30_000 },
      );
      await page.unroute(CREATE_URL);
      await expect(page.getByTestId('wsf-start-check-communities')).toBeVisible();
      await toTop(page);
      await saveFrame(page, path.join(OUT, `AFTER-start-unconfirmed-${c}.png`));

      // The demoted retry and its warning are below the fold on a short phone,
      // which is the whole reason the warning sits next to the control.
      if (await toEnd(page)) {
        await expect(page.getByTestId('wsf-start-retry-note')).toBeVisible();
        await saveFrame(page, path.join(OUT, `AFTER-start-unconfirmed-${c}-end.png`));
      }
    });

    test('the profile refusal, from a member who really has no profile', async ({ page }) => {
      test.setTimeout(180_000);
      await signedIn(page, false);
      await openStart(page);
      await page.getByTestId('wsf-start-name').fill(NAME);
      await frameOn(page, 'wsf-start-submit');
      await page.getByTestId('wsf-start-submit').click();

      await expect(page.getByTestId('wsf-start-outcome-title')).toHaveText(
        'We couldn’t create your community.',
        { timeout: 30_000 },
      );
      await expect(page.getByTestId('wsf-start-profile')).toBeVisible();
      // The action the server just refused is gone, not merely demoted.
      await expect(page.getByTestId('wsf-start-submit')).toHaveCount(0);
      await toTop(page);
      await saveFrame(page, path.join(OUT, `AFTER-start-refused-profile-${c}.png`));

      if (await toEnd(page)) {
        await saveFrame(page, path.join(OUT, `AFTER-start-refused-profile-${c}-end.png`));
      }
    });
  });
}

test.afterAll(() => {
  if (!CAPTURE_FRAMES) {
    // eslint-disable-next-line no-console
    console.log('[start-community AFTER] assertions ran; frames withheld (WSF_CAPTURE_FRAMES=1).');
  }
});
