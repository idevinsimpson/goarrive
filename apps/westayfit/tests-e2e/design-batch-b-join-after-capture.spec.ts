import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

import { seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * ACTUAL AFTER for Atlas Batch B — `/join/[joinCode]`.
 *
 * Real screenshots of the rebuilt route. Nothing here is drawn, and no frame
 * carries a TARGET strip: these are not targets.
 *
 * IT IS THE SAME TEN STATES, IN THE SAME ORDER, UNDER THE SAME NAMES as the
 * frozen `before/` set, and every one of them is pinned by the same intercept
 * rather than raced. That is what makes the pairs comparable: a reviewer can
 * put `BEFORE-<state>-<class>.png` next to `AFTER-<state>-<class>.png` and
 * know the only difference between the two frames is the implementation.
 *
 * The fixtures are deliberately identical to the BEFORE spec's — same join
 * code shape, same preview payload, same seeded device mode — so a difference
 * in a frame is never a difference in what the screen was asked to show.
 */
const OUT = path.resolve(
  __dirname,
  '../../../docs/design-target/review/batch-b-join-and-setup/after'
);

const CLASSES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
  { key: '430x932', width: 430, height: 932 },
];

/** A join code of the shape `isValidShape` accepts: 16-128 of [A-Za-z0-9_-]. */
const JOIN_CODE = 'HARBOR7WALKERSINVITE01';

const CAPTURE = /^(1|true)$/i.test(process.env.WSF_CAPTURE_FRAMES ?? '');
test.skip(
  !CAPTURE,
  'AFTER frames are committed evidence; set WSF_CAPTURE_FRAMES=1 to re-baseline them deliberately.'
);

async function phone(browser: Browser, c: { width: number; height: number }) {
  const context = await browser.newContext({
    viewport: { width: c.width, height: c.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });
  return { context, page: await context.newPage() };
}

async function shoot(page: Page, name: string, key: string) {
  // The wordmark is an image; let it decode before the shutter.
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(OUT, `AFTER-${name}-${key}.png`) });
}

/** The preview the route asks for, answered exactly. */
function pinPreview(page: Page, body: unknown, status = 200) {
  return page.route('**/wsfPreviewCommunity**', (route: Route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  );
}

const OK_PREVIEW = {
  result: {
    displayName: 'Harbor Walkers',
    groupType: 'familyFriends',
    joinPolicy: 'inviteOnly',
    memberCount: 6,
  },
};

function callableError(status: string, message: string) {
  return { error: { status, message } };
}

test('Batch B: /join/[joinCode] as it renders now', async ({ browser }) => {
  test.setTimeout(300_000);

  for (const c of CLASSES) {
    /* ── the code is refused ──────────────────────────────────────────── */
    // STILL NON-ORACULAR. The rebuilt refusal says the same thing the old one
    // did about which of the two cases this is: nothing. A visitor cannot
    // learn from this screen whether the code never existed or belongs to a
    // community they may not see, and the implementation must not have
    // quietly traded that property for a friendlier sentence.
    {
      const { context, page } = await phone(browser, c);
      await pinPreview(page, callableError('NOT_FOUND', 'no such code'), 404);
      await page.goto(`/join/${JOIN_CODE}`);
      await expect(page.getByTestId('wsf-join-invalid')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'not-valid', c.key);
      await context.close();
    }

    /* ── too many attempts ────────────────────────────────────────────── */
    {
      const { context, page } = await phone(browser, c);
      await pinPreview(page, callableError('RESOURCE_EXHAUSTED', 'slow down'), 429);
      await page.goto(`/join/${JOIN_CODE}`);
      await expect(page.getByTestId('wsf-join-rate-limited')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'too-many', c.key);
      await context.close();
    }

    /* ── the preview itself failed ────────────────────────────────────── */
    {
      const { context, page } = await phone(browser, c);
      await pinPreview(page, callableError('INTERNAL', 'preview failed'), 500);
      await page.goto(`/join/${JOIN_CODE}`);
      await expect(page.getByTestId('wsf-join-error')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'load-failed', c.key);
      await context.close();
    }

    /* ── still loading ────────────────────────────────────────────────── */
    // Held open rather than raced, so this is the real loading state and not
    // a frame the shutter happened to win.
    {
      const { context, page } = await phone(browser, c);
      await page.route('**/wsfPreviewCommunity**', async (route: Route) => {
        await new Promise((r) => setTimeout(r, 20_000));
        await route.abort('failed');
      });
      await page.goto(`/join/${JOIN_CODE}`);
      await expect(page.getByTestId('wsf-join-loading')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'loading', c.key);
      await context.close();
    }

    /* ── the invitation, to somebody signed OUT ───────────────────────── */
    {
      const { context, page } = await phone(browser, c);
      await pinPreview(page, OK_PREVIEW);
      await page.goto(`/join/${JOIN_CODE}`);
      await expect(page.getByTestId('wsf-join-signed-out')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'invite-out', c.key);
      await context.close();
    }

    /* ── the invitation, to somebody signed IN ────────────────────────── */
    {
      const { context, page } = await phone(browser, c);
      const email = `wsf-ajoin-${stampId()}@example.com`;
      const password = `Pw-${randomBytes(9).toString('base64url')}`;
      await seedVerifiedUser(email, password);
      await pinPreview(page, OK_PREVIEW);
      await signInVia(page, email, password);
      await page.goto(`/join/${JOIN_CODE}`);
      await expect(page.getByTestId('wsf-join-signed-in')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'invite-in', c.key);

      /* ── and the join itself failing ───────────────────────────────── */
      await page.route('**/wsfJoinCommunity**', (route: Route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify(callableError('INTERNAL', 'join failed')),
        })
      );
      await page.getByTestId('wsf-join-submit').click();
      await expect(page.getByTestId('wsf-join-submit-error')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'failed', c.key);
      await context.close();
    }

    /* ── the join in flight ───────────────────────────────────────────── */
    {
      const { context, page } = await phone(browser, c);
      const email = `wsf-awork-${stampId()}@example.com`;
      const password = `Pw-${randomBytes(9).toString('base64url')}`;
      await seedVerifiedUser(email, password);
      await pinPreview(page, OK_PREVIEW);
      await signInVia(page, email, password);
      await page.route('**/wsfJoinCommunity**', async (route: Route) => {
        await new Promise((r) => setTimeout(r, 20_000));
        await route.abort('failed');
      });
      await page.goto(`/join/${JOIN_CODE}`);
      await expect(page.getByTestId('wsf-join-submit')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('wsf-join-submit').click();
      await shoot(page, 'working', c.key);
      await context.close();
    }

    /* ── the device question, which lives on THIS route ───────────────── */
    // Signed out AND `?event=<goalId>`: the QR at an event encodes the goal,
    // and that is the only way this state is reachable. Batch D owns the
    // event route's own variant and is untouched here.
    {
      const { context, page } = await phone(browser, c);
      await pinPreview(page, OK_PREVIEW);
      await page.goto(`/join/${JOIN_CODE}?event=goal-demo-event-1`);
      await expect(page.getByTestId('wsf-join-device-choice')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'device-choice', c.key);
      await context.close();
    }

    /* ── the shared-screen notice ─────────────────────────────────────── */
    // Reached by RETURNING to a link on a device already marked shared, not
    // by answering the question — choosing "a shared screen" navigates to the
    // kiosk. The device mode is seeded the way the product stores it.
    {
      const { context, page } = await phone(browser, c);
      await pinPreview(page, OK_PREVIEW);
      await page.addInitScript(() => {
        try {
          window.localStorage.setItem('wsf.deviceMode', 'shared');
        } catch {
          // a browser with storage blocked simply has no remembered device
        }
      });
      await page.goto(`/join/${JOIN_CODE}?event=goal-demo-event-1`);
      await expect(page.getByTestId('wsf-join-device-shared')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'device-shared', c.key);
      await context.close();
    }
  }
});
