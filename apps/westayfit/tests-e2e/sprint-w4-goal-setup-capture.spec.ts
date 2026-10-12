import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

import { CAPTURE_FRAMES, saveFrame } from './helpers/capture';
import {
  IPHONE_UA,
  PROJECT_ID,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * CURRENT-BUILD CAPTURES of the real goal-setup route, `app/goals/new.tsx`,
 * for Board 08. Source is pinned: claude/wsf-app-shell 0757379.
 *
 * Board 08's existing arrival captures are truthful but stop at the top of the
 * form: they cannot show the lower duration and custom-window controls, the
 * same-page summary, or the created state. This fills exactly that gap.
 *
 * NOT a new page and not an acceptance. Every frame is the route the product
 * already ships, entered the real way — the community's own "Start a goal"
 * control — with fixtures and helpers shared with the existing goal-form
 * coverage (`helpers/mobile`, the same shape `e5-goal-form.spec.ts` seeds).
 *
 * WHAT IS REAL AND WHAT IS INJECTED. The created receipt is produced by the
 * REAL `wsfCreateGoal` callable against the local emulator; no success
 * response is faked anywhere. Two frames need a callable to misbehave and say
 * so in their filenames: an in-flight state needs the call held open
 * (INJECTED-DELAY, then released so the real call completes), and a refusal
 * needs it to fail (INJECTED-NETWORK). Nothing widens product capability.
 *
 * WRITES ARE OPT-IN via `helpers/capture`: an ordinary run asserts every state
 * and writes nothing.
 *
 * RNW INNER SCROLL. The form scrolls inside an element, not the document, so
 * a fullPage shot misses the lower controls entirely. Each section is scrolled
 * into view before its shot, and the frame is named for the section it shows.
 *
 * Every shot is preceded by an assertion of the named state, and the fixture
 * uses a fixed title, target, unit and custom window so frames are stable.
 */

const OUT = path.resolve(
  __dirname,
  '../../../docs/design-target/review/goal-setup-current',
);

const MAIN = { width: 390, height: 844 } as const;
const SHORT = { width: 390, height: 640 } as const;

// Stable fixture identity: the same words and numbers in every frame.
const TITLE = 'Autumn squat challenge';
const TARGET = '30000';
const UNIT = 'squats';
// A fixed custom window, so the dates in the frames do not drift by run.
const CUSTOM_START = '2026-10-01T09:00';
const CUSTOM_END = '2026-11-15T18:00';

function callableUrl(name: string): string {
  return `http://127.0.0.1:5001/${PROJECT_ID}/us-central1/${name}`;
}

type Fx = { email: string; password: string; groupId: string };

/** A Champion with an empty community — the state the form is reached from. */
async function seedChampion(label: string): Promise<Fx> {
  const stamp = stampId();
  const email = `gs.${label}.${stamp}@example.invalid`;
  const password = 'goal-setup-passw0rd';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, `Champion ${stamp}`);
  const groupId = `gs${label}_${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Harbor Walkers',
    joinPolicy: 'private',
    members: [{ uid, role: 'foundingChampion' }],
  });
  return { email, password, groupId };
}

/** The real way in, as a Champion does it. */
async function openForm(page: Page, groupId: string): Promise<void> {
  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-community-start-goal').click();
  await page.waitForURL(/\/goals\/new/, { timeout: 20_000 });
  await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 20_000 });
}

async function fillCore(page: Page): Promise<void> {
  await page.getByTestId('wsf-new-goal-title').fill(TITLE);
  await page.getByTestId('wsf-new-goal-target').fill(TARGET);
  await page.getByTestId('wsf-new-goal-unit').fill(UNIT);
  // The live definition proves the three fields were actually taken.
  await expect(page.getByTestId('wsf-new-goal-definition')).toContainText('30,000 squats');
}

/** Bring a section into the frame — the form scrolls inside an element. */
async function frameOn(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).scrollIntoViewIfNeeded();
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 10_000 });
}

async function shoot(page: Page, name: string): Promise<void> {
  await saveFrame(page, path.join(OUT, `${name}.png`));
}

/**
 * The Living WE rule for this surface: a goal that does not exist yet has no
 * confirmed shared total, so there is no ratio to draw and the mark must not
 * appear anywhere on the setup route.
 */
async function assertNoLivingWe(page: Page): Promise<void> {
  expect(
    await page.locator('[data-testid*="living-we"], [data-testid*="wsf-we-"]').count(),
    'a Living WE appears on the goal-setup route, which has no confirmed ratio',
  ).toBe(0);
}

test.describe('goal setup — current build captures', () => {
  test.describe('390x844', () => {
    test.use({
      viewport: MAIN,
      userAgent: IPHONE_UA,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    test('the populated form, its lower duration controls and the custom window', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const fx = await seedChampion('form');
      await signInVia(page, fx.email, fx.password);
      await openForm(page, fx.groupId);
      await fillCore(page);
      await assertNoLivingWe(page);
      await shoot(page, 'form-populated-top-390x844');

      // The lower controls Board 08's arrival frames cannot reach.
      await frameOn(page, 'wsf-new-goal-duration');
      await expect(page.getByTestId('wsf-new-goal-duration-1w')).toBeVisible();
      await expect(page.getByTestId('wsf-new-goal-duration-2w')).toBeVisible();
      await expect(page.getByTestId('wsf-new-goal-duration-1m')).toBeVisible();
      await expect(page.getByTestId('wsf-new-goal-duration-custom')).toBeVisible();
      await shoot(page, 'form-duration-options-390x844');

      // A preset duration DERIVES the window in words. `new.tsx:853` renders
      // the "Starts …" line only while duration is not custom, so this is
      // where that line exists to be photographed.
      await page.getByTestId('wsf-new-goal-duration-2w').click();
      await expect(page.getByTestId('wsf-new-goal-starts-line')).toBeVisible();
      await expect(page.getByTestId('wsf-new-goal-ends-line')).toBeVisible();
      await frameOn(page, 'wsf-new-goal-starts-line');
      await shoot(page, 'form-duration-derived-window-390x844');

      // Custom replaces that derived start line with the exact controls.
      await page.getByTestId('wsf-new-goal-duration-custom').click();
      await expect(page.getByTestId('wsf-new-goal-starts-at')).toBeVisible();
      await expect(page.getByTestId('wsf-new-goal-ends-at')).toBeVisible();
      await page.getByTestId('wsf-new-goal-starts-at').fill(CUSTOM_START);
      await page.getByTestId('wsf-new-goal-ends-at').fill(CUSTOM_END);
      // The derived start line is GONE in custom — the control states it now.
      await expect(page.getByTestId('wsf-new-goal-starts-line')).toHaveCount(0);
      await expect(page.getByTestId('wsf-new-goal-ends-line')).toBeVisible();
      await frameOn(page, 'wsf-new-goal-starts-at');
      await shoot(page, 'form-custom-window-390x844');
    });

    test('both repeat choices, and the same-page summary', async ({ page }) => {
      test.setTimeout(120_000);
      const fx = await seedChampion('rep');
      await signInVia(page, fx.email, fx.password);
      await openForm(page, fx.groupId);
      await fillCore(page);

      // TWO choices exist. Board 08 must not invent a third.
      await frameOn(page, 'wsf-new-goal-repeat');
      await expect(page.getByTestId('wsf-new-goal-repeat-once')).toBeVisible();
      await expect(page.getByTestId('wsf-new-goal-repeat-multiple')).toBeVisible();
      // Count the ROWS, not the markup: OptionRow gives each row `-indicator`,
      // `-indicator-dot`, `-label` and `-description` children that all share
      // the prefix, so a prefix match counts nodes rather than choices.
      const repeatKeys = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-testid^="wsf-new-goal-repeat-"]'))
          .map((el) => el.getAttribute('data-testid') ?? '')
          .filter((id) => /^wsf-new-goal-repeat-[^-]+$/.test(id))
          .sort(),
      );
      expect(repeatKeys, 'the repeat group offers exactly these two choices').toEqual([
        'wsf-new-goal-repeat-multiple',
        'wsf-new-goal-repeat-once',
      ]);

      await page.getByTestId('wsf-new-goal-repeat-once').click();
      await expect(
        page.getByText('Each member records one contribution toward this goal.'),
      ).toBeVisible();
      await shoot(page, 'form-repeat-once-390x844');

      await page.getByTestId('wsf-new-goal-repeat-multiple').click();
      await expect(
        page.getByText(
          'Each member can record as many contributions as they like while the goal is open.',
        ),
      ).toBeVisible();
      await shoot(page, 'form-repeat-multiple-390x844');

      // The summary is ON THIS PAGE — not a separate review step.
      await frameOn(page, 'wsf-new-goal-summary');
      const summary = page.getByTestId('wsf-new-goal-summary');
      await expect(summary.getByText('Check it over')).toBeVisible();
      await expect(summary.getByText('This is what your community will see.')).toBeVisible();
      await expect(summary).toContainText(TITLE);
      await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible();
      await assertNoLivingWe(page);
      await shoot(page, 'form-summary-check-it-over-390x844');
    });

    test('submit validation puts the first refused field in view', async ({ page }) => {
      test.setTimeout(120_000);
      const fx = await seedChampion('val');
      await signInVia(page, fx.email, fx.password);
      await openForm(page, fx.groupId);

      // Nothing is claimed before a submit.
      expect(
        await page.locator('[data-testid^="wsf-new-goal-"][data-testid$="-error"]').count(),
        'a validation message appeared before any submit',
      ).toBe(0);

      await page.getByTestId('wsf-new-goal-submit').click();
      const firstError = page.getByTestId('wsf-new-goal-title-error');
      await expect(firstError).toBeVisible({ timeout: 10_000 });
      await expect(firstError).toHaveText('Give your goal a name.');
      // In view means in view: the first refused field is on screen, not
      // somewhere the member has to go looking for.
      await expect(page.getByTestId('wsf-new-goal-title')).toBeInViewport();
      await shoot(page, 'form-validation-first-refused-390x844');
    });

    test('submitting in flight, then the real created receipt', async ({ page }) => {
      test.setTimeout(150_000);
      const fx = await seedChampion('create');
      await signInVia(page, fx.email, fx.password);
      await openForm(page, fx.groupId);
      await fillCore(page);
      await frameOn(page, 'wsf-new-goal-repeat');
      await page.getByTestId('wsf-new-goal-repeat-multiple').click();

      // INJECTED DELAY on the REAL wsfCreateGoal — held so the in-flight
      // state is a real frame, then released so the real call completes. No
      // success response is fabricated.
      const gate: { release: () => void } = { release: () => {} };
      const held = new Promise<void>((r) => {
        gate.release = r;
      });
      await page.route(callableUrl('wsfCreateGoal'), async (route: Route) => {
        await held;
        await route.continue().catch(() => {});
      });

      await frameOn(page, 'wsf-new-goal-submit');
      await page.getByTestId('wsf-new-goal-submit').click();
      await expect(page.getByTestId('wsf-new-goal-submit')).toContainText('Starting…', {
        timeout: 20_000,
      });
      await shoot(page, 'form-submitting-INJECTED-DELAY-390x844');

      gate.release();
      const created = page.getByTestId('wsf-new-goal-created');
      await expect(created).toBeVisible({ timeout: 45_000 });
      // The receipt came from the real callable: it carries the ids the
      // server assigned, as data attributes on the container.
      const goalId = await created.getAttribute('data-goal-id');
      expect(goalId, 'the created receipt carries no server-assigned goal id').toBeTruthy();
      await expect(page.getByTestId('wsf-new-goal-goto-contribute')).toBeVisible();
      await shoot(page, 'created-receipt-390x844');
      await page.unroute(callableUrl('wsfCreateGoal'));
    });

    test('a refused create recovers on the same form', async ({ page }) => {
      test.setTimeout(120_000);
      const fx = await seedChampion('refuse');
      await signInVia(page, fx.email, fx.password);
      await openForm(page, fx.groupId);
      await fillCore(page);

      // INJECTED NETWORK FAILURE on wsfCreateGoal.
      await page.route(callableUrl('wsfCreateGoal'), async (route: Route) => {
        await route.abort('failed');
      });
      await frameOn(page, 'wsf-new-goal-submit');
      await page.getByTestId('wsf-new-goal-submit').click();

      const err = page.getByTestId('wsf-new-goal-error');
      await expect(err).toBeVisible({ timeout: 30_000 });
      // The form is still there to try again — the work is not lost.
      await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible();
      await expect(page.getByTestId('wsf-new-goal-title')).toHaveValue(TITLE);
      await frameOn(page, 'wsf-new-goal-error');
      await shoot(page, 'form-server-refusal-INJECTED-NETWORK-390x844');
      await page.unroute(callableUrl('wsfCreateGoal'));
    });

    test('the route with no community chosen', async ({ page }) => {
      test.setTimeout(120_000);
      const fx = await seedChampion('nocom');
      await signInVia(page, fx.email, fx.password);
      // Straight to the route with no groupId — the real no-community state.
      await page.goto('/goals/new');
      await expect(page.getByTestId('wsf-new-goal-no-community')).toBeVisible({ timeout: 25_000 });
      await expect(
        page.getByText('Choose a community before starting a goal.'),
      ).toBeVisible();
      await assertNoLivingWe(page);
      await shoot(page, 'no-community-390x844');
    });

    test('the route signed out', async ({ page }) => {
      test.setTimeout(120_000);
      // No sign-in at all. The route answers for itself.
      await page.goto('/goals/new');
      await expect(page.getByText('Sign in to start a goal')).toBeVisible({ timeout: 25_000 });
      await expect(
        page.getByText('Only a signed-in Champion can start a goal for their community.'),
      ).toBeVisible();
      await assertNoLivingWe(page);
      await shoot(page, 'signed-out-390x844');
    });
  });

  /** The short phone: can the form, the summary and the created action be used. */
  test.describe('390x640', () => {
    test.use({
      viewport: SHORT,
      userAgent: IPHONE_UA,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    test('form, summary and the created action are all reachable', async ({ page }) => {
      test.setTimeout(150_000);
      const fx = await seedChampion('short');
      await signInVia(page, fx.email, fx.password);
      await openForm(page, fx.groupId);
      await fillCore(page);
      await shoot(page, 'form-populated-top-390x640');

      await frameOn(page, 'wsf-new-goal-summary');
      await expect(page.getByTestId('wsf-new-goal-summary')).toContainText('Check it over');
      await shoot(page, 'form-summary-check-it-over-390x640');

      await frameOn(page, 'wsf-new-goal-submit');
      expect(
        await hitsItself(page, 'wsf-new-goal-submit'),
        'the submit control does not take its own tap at 390x640',
      ).toBe(true);
      await page.getByTestId('wsf-new-goal-submit').click();

      const created = page.getByTestId('wsf-new-goal-created');
      await expect(created).toBeVisible({ timeout: 45_000 });
      await frameOn(page, 'wsf-new-goal-goto-contribute');
      // Reachability of the created action is the question here.
      expect(
        await hitsItself(page, 'wsf-new-goal-goto-contribute'),
        'the created action does not take its own tap at 390x640',
      ).toBe(true);
      await shoot(page, 'created-actions-390x640');
    });
  });
});

/**
 * Does a tap at the control's own centre reach it? `toBeVisible` answers a
 * different question — W5-M1 was a control that passed it while the shell took
 * its taps — so reachability is a hit test.
 */
async function hitsItself(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(hit && (el === hit || el.contains(hit) || hit.contains(el)));
  }, testId);
}

test.afterAll(() => {
  if (!CAPTURE_FRAMES) {
    // eslint-disable-next-line no-console
    console.log('[goal-setup] assertions ran; frames withheld (set WSF_CAPTURE_FRAMES=1).');
  }
});
