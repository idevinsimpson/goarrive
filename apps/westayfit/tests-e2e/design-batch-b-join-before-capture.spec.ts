import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Browser, type Page, type Route } from '@playwright/test';

import { seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * ACTUAL CURRENT BEFORE for Atlas Batch B — `/join/[joinCode]`.
 *
 * THIS HAD TO BE CAPTURED BEFORE A LINE OF THE JOIN IMPLEMENTATION WAS
 * WRITTEN. The Batch B package has no `before/` directory at all: ten
 * reviewed target states with nothing to compare them against. A BEFORE only
 * exists while the BEFORE still exists — the moment `/join/[joinCode]` is
 * built to the target, the screen these frames photograph is gone and no
 * later run can recover it.
 *
 * Nothing here is drawn. These are the real route, at the three phone
 * classes, in every state it can actually reach.
 *
 * EVERY STATE IS PINNED, NOT RACED. `wsfPreviewCommunity` and
 * `wsfJoinCommunity` are fulfilled by an intercept, so a frame means the
 * state it is named after. The Batch A BEFORE capture let an outcome resolve
 * however it happened to and caught two different answers at two classes in
 * one run; that is not repeated here.
 *
 * WHAT THE CURRENT SCREEN CANNOT DO is as much the point as what it can.
 * Where a reviewed target state has no BEFORE, that is recorded as a new
 * state rather than manufactured into a pair.
 */
const OUT = path.resolve(
  __dirname,
  '../../../docs/design-target/review/batch-b-join-and-setup/before'
);

const CLASSES = [
  { key: '390x844', width: 390, height: 844 },
  { key: '390x640', width: 390, height: 640 },
  { key: '430x932', width: 430, height: 932 },
];

/** A join code of the shape `isValidShape` accepts: 16-128 of [A-Za-z0-9_-]. */
const JOIN_CODE = 'HARBOR7WALKERSINVITE01';

const CAPTURE_BEFORE = /^(1|true)$/i.test(process.env.WSF_CAPTURE_BEFORE ?? '');
test.skip(
  !CAPTURE_BEFORE,
  'BEFORE frames are frozen evidence; set WSF_CAPTURE_BEFORE=1 to re-baseline them deliberately.'
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
  await page.screenshot({ path: path.join(OUT, `BEFORE-${name}-${key}.png`) });
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

test('Batch B: /join/[joinCode] as it renders today', async ({ browser }) => {
  test.setTimeout(300_000);

  for (const c of CLASSES) {
    /* ── the code is refused ──────────────────────────────────────────── */
    // NOT-FOUND IS DELIBERATELY NON-ORACULAR: the server returns the same
    // shape for "no such code" and "a code you may not see", so the screen
    // cannot tell a visitor which it was. That is the privacy property the
    // target has to preserve, and this frame is what it looks like today.
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
      const email = `wsf-bjoin-${stampId()}@example.com`;
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
    /*
      `joinState.kind === 'joining'` drives the submit control's spinner. It
      is transient by nature, so it is HELD rather than raced: the callable is
      kept open and the shutter fires while it is genuinely in flight. A frame
      of this state caught by luck would be a frame nobody could reproduce.
    */
    {
      const { context, page } = await phone(browser, c);
      const email = `wsf-bwork-${stampId()}@example.com`;
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
    /*
      IT APPEARS ONLY FOR A SIGNED-OUT VISITOR WHOSE LINK CARRIES AN EVENT.
      `!user && eventGoalId`, and the event comes from `?event=<goalId>` — the
      QR at an event encodes it. A first attempt used `?device=ask`, which is
      not a parameter this route reads, and the state was simply never
      reached: the capture then wrote no frame at all rather than a wrong one,
      which is why the gap was visible instead of silent.

      Batch D does not draw this again — the event path's variant differs, and
      the join path's copy lives here.
    */
    {
      const { context, page } = await phone(browser, c);
      await pinPreview(page, OK_PREVIEW);
      await page.goto(`/join/${JOIN_CODE}?event=goal-demo-event-1`);
      await expect(page.getByTestId('wsf-join-device-choice')).toBeVisible({ timeout: 30_000 });
      await shoot(page, 'device-choice', c.key);

      await context.close();
    }

    /* ── the shared-screen notice ─────────────────────────────────────── */
    /*
      REACHED BY RETURNING, NOT BY ANSWERING.

      Choosing "a shared screen" does not render this notice — `onChooseShared`
      hands the device to the kiosk start screen for the event's goal and
      navigates away, because no account is created on a shared screen. The
      notice is what a visitor meets when they come BACK to a join link on a
      device already marked shared, which is the situation it exists for.

      So the device mode is seeded the way the product stores it, rather than
      by clicking through. Two earlier attempts at this state guessed the
      trigger wrong; each wrote no frame at all rather than a misleading one,
      which is how the gap stayed visible.
    */
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
