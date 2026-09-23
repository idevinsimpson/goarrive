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
 * MATCHED AFTERS for the accepted `/goals/new` target — the real route, after
 * the implementation, photographed the way the BEFOREs were.
 *
 * WHY THIS IS A SECOND PRODUCER AND NOT A BLOCK IN THE TARGET ONE.
 * `sprint-w6-goal-setup-next-capture.spec.ts` photographs the drawings, and
 * those drawings are now ACCEPTED (`5788308449`). A gated run of a file that
 * wrote both sets would rewrite accepted evidence as a side effect of
 * capturing an AFTER — exactly the failure `check-evidence-intact.mjs` exists
 * to catch. Two producers, one job each: that one writes `target/` and never
 * runs gated again, this one writes `after/` and nothing else.
 *
 * NOTHING IS DRAWN HERE. Every frame is the shipped route entered the real
 * way — the community's own "Start a goal" control — with the same fixtures
 * and the same identity as the BEFOREs (`Harbor Walkers`, `Autumn squat
 * challenge`, `30,000 squats`, the 2026-10-01 → 2026-11-15 custom window), so
 * BEFORE, TARGET and AFTER can be read as one row.
 *
 * WHAT IS REAL AND WHAT IS INJECTED.
 *
 *   The created receipt comes from the REAL `wsfCreateGoal` against the local
 *   emulator, and the spec asserts the server-assigned `data-goal-id` is on
 *   the container: that attribute cannot exist without a real server answer.
 *
 *   The REFUSAL IS REAL TOO, and deliberately so. It is not injected: an
 *   ordinary member of the community submits the form, and the real callable
 *   raises `permission-denied` because their membership role is not
 *   `foundingChampion`. That is the refusal the target drew, produced by the
 *   server that actually produces it.
 *
 *   Only the UNKNOWN result needs a fault, and its name says so
 *   (INJECTED-NETWORK): the request is aborted so no answer comes back. That
 *   is the whole point of the state — the client cannot tell this from a
 *   transaction that committed and lost its response, which is what W7
 *   measured (#434, evidence `e6a208a`).
 *
 * WRITES ARE OPT-IN (`helpers/capture`). An ordinary run asserts every claim
 * below — including the ones the accepted target is made of — and writes
 * nothing.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/goal-setup-next/after');

const MAIN = { width: 390, height: 844 } as const;
const SHORT = { width: 390, height: 640 } as const;

const TITLE = 'Autumn squat challenge';
const TARGET = '30000';
const UNIT = 'squats';
const CUSTOM_START = '2026-10-01T09:00';
const CUSTOM_END = '2026-11-15T18:00';

function callableUrl(name: string): string {
  return `http://127.0.0.1:5001/${PROJECT_ID}/us-central1/${name}`;
}

type Fx = { email: string; password: string; groupId: string; memberEmail: string; memberPassword: string };

/**
 * A Champion with an empty community, and an ORDINARY MEMBER of that same
 * community. The member is what makes the refusal real rather than injected,
 * and being a member is also why the community's name still renders for them:
 * a non-member could not read the document, and the page would fall back to
 * "Your community" — truthful, but a different frame from the one the target
 * was accepted on.
 */
async function seedChampionAndMember(label: string): Promise<Fx> {
  const stamp = stampId();
  const email = `gsa.${label}.${stamp}@example.invalid`;
  const password = 'goal-setup-after-passw0rd';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, `Champion ${stamp}`);

  const memberEmail = `gsa.${label}.m.${stamp}@example.invalid`;
  const memberPassword = 'goal-setup-after-passw0rd';
  const memberUid = await seedVerifiedUser(memberEmail, memberPassword);
  await seedProfile(memberUid, `Member ${stamp}`);

  const groupId = `gsa${label}_${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Harbor Walkers',
    joinPolicy: 'private',
    members: [
      { uid, role: 'foundingChampion' },
      { uid: memberUid, role: 'member' },
    ],
  });
  return { email, password, groupId, memberEmail, memberPassword };
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
  await expect(page.getByTestId('wsf-new-goal-definition')).toContainText('30,000 squats');
}

/** Bring a section into the frame — the form scrolls inside an element. */
async function frameOn(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).scrollIntoViewIfNeeded();
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 10_000 });
}

/**
 * The form scrolls INSIDE an element, not the document, so `window.scrollTo`
 * does nothing here. This runs every inner scroller to its end.
 */
async function scrollFormToEnd(page: Page): Promise<void> {
  const moved = await page.evaluate(() => {
    let any = false;
    for (const n of Array.from(document.querySelectorAll('*'))) {
      const el = n as HTMLElement;
      if (el.scrollHeight > el.clientHeight + 4) {
        el.scrollTop = el.scrollHeight;
        any = true;
      }
    }
    return any;
  });
  expect(moved, 'nothing on this page scrolls, so there is no page end to reach').toBe(true);
  await page.waitForTimeout(150);
}

/**
 * Board 00 gives primary actions ACTION_GREEN and reserves PROGRESS_GREEN for
 * confirmed progress — the colour the Living WE speaks in. The Director ruled
 * on it for this route (F6), so the fill is asserted rather than left to a
 * pixel review: a later edit that reaches for `kit.primaryButton` here fails
 * before a frame is written.
 */
const ACTION_GREEN_RGB = 'rgb(34, 197, 94)';
const PROGRESS_GREEN_RGB = 'rgb(145, 203, 125)';

async function backgroundOf(page: Page, testId: string): Promise<string> {
  return page
    .getByTestId(testId)
    .evaluate((el: Element) => getComputedStyle(el as HTMLElement).backgroundColor);
}

async function expectActionGreen(page: Page, testId: string, at: string): Promise<void> {
  const bg = await backgroundOf(page, testId);
  expect(bg, `${at}: ${testId} is not the action green`).toBe(ACTION_GREEN_RGB);
  expect(bg, `${at}: ${testId} wears the confirmed-progress green`).not.toBe(PROGRESS_GREEN_RGB);
}

async function shoot(page: Page, name: string): Promise<void> {
  await saveFrame(page, path.join(OUT, `${name}.png`));
}

/** A goal that does not exist yet has no confirmed total, so no Living WE. */
async function assertNoLivingWe(page: Page): Promise<void> {
  expect(
    await page.locator('[data-testid*="living-we"], [data-testid*="wsf-we-"]').count(),
    'a Living WE appears on the goal-setup route, which has no confirmed ratio',
  ).toBe(0);
}

/**
 * The parts of the accepted target that are structure rather than pixels, and
 * that a later edit could quietly undo. Asserted on every class.
 */
async function assertAcceptedShape(page: Page, at: string): Promise<void> {
  /*
    THE ROUTE'S OWN CHROME, WHICH NOTHING HERE USED TO PIN.
    `/goals/new` is a focused flow: no shell bar renders over it, so the
    wordmark it draws is its SOLE chrome rather than a second copy of one
    (the Director's ruling, `5792030574`: "Focused routes such as /goals/new
    retain their sole route-owned wordmark"). It is in all fifteen accepted
    AFTER frames — and until this line, a chrome pass that removed it from
    this route would have passed every check in this file, leaving a human
    noticing the frames no longer matched as the only signal.
  */
  await expect(
    page.getByTestId('wsf-new-goal-wordmark'),
    `${at}: the route's own wordmark is gone`,
  ).toBeVisible();
  // Four durations, still, with the route's own labels — and each one still
  // states its selected state without relying on colour.
  for (const key of ['1w', '2w', '1m', 'custom']) {
    const pill = page.getByTestId(`wsf-new-goal-duration-${key}`);
    await expect(pill, `${at}: duration ${key} is present`).toBeVisible();
    await expect(pill, `${at}: duration ${key} states its selection`).toHaveAttribute(
      'aria-checked',
      /^(true|false)$/,
    );
  }
  // EXACTLY two repeat policies. A third is the thing this packet may not add.
  await expect(page.getByTestId('wsf-new-goal-repeat-once')).toBeVisible();
  await expect(page.getByTestId('wsf-new-goal-repeat-multiple')).toBeVisible();
  expect(
    await page.getByTestId('wsf-new-goal-repeat-daily').count() +
      await page.getByTestId('wsf-new-goal-repeat-weekly').count(),
    `${at}: a third repeat policy exists`,
  ).toBe(0);
  // The review is still on the same page as the form — not a wizard step —
  // and the control that acts on it is INSIDE it.
  const summary = page.getByTestId('wsf-new-goal-summary');
  await expect(summary).toContainText('Check it over');
  await expect(summary).toContainText('This is what your community will see.');
  await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible();
  expect(
    await summary.getByTestId('wsf-new-goal-submit').count(),
    `${at}: the commit control is no longer inside the review it commits`,
  ).toBe(1);
  // The zone is still stated in words, with nothing to pick.
  await expect(page.getByTestId('wsf-new-goal-timezone-line')).toHaveText(/^Times are in /);
  await assertNoLivingWe(page);
}

for (const [cls, viewport] of [
  ['390x844', MAIN],
  ['390x640', SHORT],
] as const) {
  test.describe(cls, () => {
    test.use({
      viewport,
      userAgent: IPHONE_UA,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });

    test('the form, the custom window and the review with its commit', async ({ page }) => {
      test.setTimeout(150_000);
      const fx = await seedChampionAndMember('form');
      await signInVia(page, fx.email, fx.password);
      await openForm(page, fx.groupId);

      await fillCore(page);
      await assertAcceptedShape(page, cls);

      // ---- the form from the top: the spine and the payoff -------------
      // The claim the target was accepted on: the goal phrase is on screen
      // with the fields that make it, at BOTH classes.
      await expect(page.getByTestId('wsf-new-goal-definition')).toBeInViewport();
      await shoot(page, `AFTER-form-top-${cls}`);

      // ---- Custom: the window stated once ------------------------------
      await frameOn(page, 'wsf-new-goal-duration-custom');
      await page.getByTestId('wsf-new-goal-duration-custom').click();
      await expect(page.getByTestId('wsf-new-goal-duration-custom')).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await page.getByTestId('wsf-new-goal-starts-at').fill(CUSTOM_START);
      await page.getByTestId('wsf-new-goal-ends-at').fill(CUSTOM_END);
      // Under Custom the control states the start, so the derived line is
      // NOT drawn as well. This is the assumption the BEFORE package caught
      // (observation 1) and the target kept.
      expect(
        await page.getByTestId('wsf-new-goal-starts-line').count(),
        `${cls}: Custom renders a derived start line as well as the control`,
      ).toBe(0);
      await expect(page.getByTestId('wsf-new-goal-ends-line')).toHaveText(/^Ends /);
      await frameOn(page, 'wsf-new-goal-ends-at');
      await shoot(page, `AFTER-custom-window-${cls}`);

      // ---- the review and the commit, as one object ---------------------
      await frameOn(page, 'wsf-new-goal-summary');
      const summary = page.getByTestId('wsf-new-goal-summary');
      await expect(summary).toContainText('Harbor Walkers');
      await expect(summary).toContainText(TITLE);
      await expect(summary).toContainText('30,000 squats');
      await expect(summary).toContainText('One contribution per member');
      const submit = page.getByTestId('wsf-new-goal-submit');
      await expect(submit).toHaveText('Start this goal');
      await expectActionGreen(page, 'wsf-new-goal-submit', cls);
      // Whole, not clipped: the control that agrees to the review is on
      // screen with it, which is the defect the target exists to fix.
      await expect(submit).toBeInViewport();
      await shoot(page, `AFTER-summary-commit-${cls}`);
    });

    test('a real permission refusal from the callable itself', async ({ page }) => {
      test.setTimeout(150_000);
      const fx = await seedChampionAndMember('refuse');

      // ---- REFUSED, by the real callable --------------------------------
      // An ordinary member of this community, not its Champion. Nothing is
      // injected: wsfCreateGoal raises permission-denied itself.
      await signInVia(page, fx.memberEmail, fx.memberPassword);
      await page.goto(`/goals/new?groupId=${encodeURIComponent(fx.groupId)}`);
      await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 25_000 });
      await fillCore(page);
      await frameOn(page, 'wsf-new-goal-submit');
      await page.getByTestId('wsf-new-goal-submit').click();

      const refusal = page.getByTestId('wsf-new-goal-error');
      await expect(refusal).toBeVisible({ timeout: 30_000 });
      await expect(refusal).toContainText('Only a Champion of this community can start a goal here.');
      // The server answered, and answered before it wrote, so the screen may
      // say so. This sentence is allowed HERE and nowhere else.
      await expect(refusal).toContainText('The server refused this request, so no goal was created.');
      // The control the server just refused is gone; the way forward is not.
      expect(
        await page.getByTestId('wsf-new-goal-submit').count(),
        `${cls}: the refusal still offers the action the server just refused`,
      ).toBe(0);
      await expect(page.getByTestId('wsf-new-goal-refused-back')).toBeVisible();
      // The work is not lost.
      await expect(page.getByTestId('wsf-new-goal-title')).toHaveValue(TITLE);
      await frameOn(page, 'wsf-new-goal-error');
      await shoot(page, `AFTER-refused-${cls}`);
    });

    /*
      A TEST OF ITS OWN, not a second act of the one above. `signInVia` goes
      to /signin, and a page that is already signed in is sent away from it —
      so swapping accounts inside one test signs nobody in and fails on a
      field that is correctly absent. A fresh context per account is the
      honest fixture, and it is also what keeps the refusal's evidence from
      depending on the unknown result's injected fault.
    */
    test('an unknown result that claims nothing in either direction', async ({ page }) => {
      test.setTimeout(150_000);
      const fx = await seedChampionAndMember('unknown');

      // ---- UNKNOWN, with the answer taken away ---------------------------
      await signInVia(page, fx.email, fx.password);
      await openForm(page, fx.groupId);
      await fillCore(page);

      // INJECTED NETWORK FAILURE on wsfCreateGoal: no answer comes back, so
      // the client genuinely does not know. It is the one fault in this file.
      await page.route(callableUrl('wsfCreateGoal'), async (route: Route) => {
        await route.abort('failed');
      });
      await frameOn(page, 'wsf-new-goal-submit');
      await page.getByTestId('wsf-new-goal-submit').click();

      const unknown = page.getByTestId('wsf-new-goal-error');
      await expect(unknown).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByText('We couldn’t confirm your goal was created.'),
      ).toBeVisible();
      await expect(unknown).toContainText('Starting another one could create a duplicate.');
      // THE CONTRACT (`5787676653`), on the real route.
      const form = page.getByTestId('wsf-new-goal-form');
      for (const forbidden of [
        'Nothing was created',
        'Nothing was started',
        'no goal was created',
        'Please try again',
        'Try again',
        'saved',
      ]) {
        expect(
          await form.getByText(forbidden, { exact: false }).count(),
          `${cls}: the unknown result says "${forbidden}", which it cannot know or does not have`,
        ).toBe(0);
      }
      // The resolving action is promoted and is COMMUNITY-level: it names no
      // goal, because no id may be inferred from a title.
      const check = page.getByTestId('wsf-new-goal-check-goals');
      await expect(check).toHaveText('Check community goals');
      await expect(check).toHaveAttribute('href', `/community/${fx.groupId}`);
      await expect(check).toBeInViewport();
      await expectActionGreen(page, 'wsf-new-goal-check-goals', cls);
      // And the demoted retry is still NOT an action: promoting it with the
      // same fill would undo the whole point of demoting it.
      expect(
        await backgroundOf(page, 'wsf-new-goal-submit'),
        `${cls}: the deliberate second create is dressed as a primary action`,
      ).not.toBe(ACTION_GREEN_RGB);
      // A fresh create is its own deliberate thing, with the consequence
      // beside it — and it is NOT sent on the Champion's behalf.
      await expect(page.getByTestId('wsf-new-goal-submit')).toHaveText('Start another goal');
      await expect(form).toContainText('This starts a new, separate goal.');
      await expect(form).toContainText('your community will have two.');
      await frameOn(page, 'wsf-new-goal-error');
      await shoot(page, `AFTER-unconfirmed-INJECTED-NETWORK-${cls}`);

      /*
        A SECOND FRAME, because on the real page this state does not fit in
        one. The target drew the banner, the resolving action, the review and
        the demoted retry together; the shipped route has the three form
        sections above all of that, so a single viewport can hold the top of
        the state or its foot, not both. Shooting only the top would leave the
        half of the contract that matters most — the retry saying what it
        starts, with the duplicate consequence beside it — unphotographed, and
        a reviewer would be taking my word for it.
      */
      // Run the form's own scroller to its end rather than nudging one
      // element into view. `scrollIntoViewIfNeeded` stops as soon as the
      // element's box is inside the viewport, which on this route means
      // resting it directly under the floating tab bar — the very thing the
      // route's new foot reserve exists to prevent. At the end of the scroll
      // that reserve is what holds the consequence line clear of the bar, so
      // this frame is also the evidence that the reserve works.
      await scrollFormToEnd(page);
      const retry = page.getByTestId('wsf-new-goal-submit');
      await expect(retry).toBeInViewport();
      await expect(page.getByText('your community will have two.')).toBeInViewport();
      await shoot(page, `AFTER-unconfirmed-retry-INJECTED-NETWORK-${cls}`);
      await page.unroute(callableUrl('wsfCreateGoal'));
    });

    test('the goal goes live, from the real callable', async ({ page }) => {
      test.setTimeout(150_000);
      const fx = await seedChampionAndMember('live');
      await signInVia(page, fx.email, fx.password);
      await openForm(page, fx.groupId);
      await fillCore(page);
      await frameOn(page, 'wsf-new-goal-submit');
      await page.getByTestId('wsf-new-goal-submit').click();

      const created = page.getByTestId('wsf-new-goal-created');
      await expect(created).toBeVisible({ timeout: 45_000 });
      // The receipt is the server's: this attribute cannot exist without a
      // real answer, and the action below resolves from it rather than from
      // the title.
      const goalId = await created.getAttribute('data-goal-id');
      expect(goalId, 'the created receipt carries no server-assigned goal id').toBeTruthy();
      await expect(page.getByTestId('wsf-new-goal-goto-contribute')).toHaveAttribute(
        'href',
        `/contribute/${goalId}`,
      );
      await expectActionGreen(page, 'wsf-new-goal-goto-contribute', cls);
      await expect(created).toContainText('Your goal is live');
      await expect(created).toContainText('30,000 squats');
      // The phrase is the TARGET, not a total: nobody has contributed yet.
      await assertNoLivingWe(page);
      await shoot(page, `AFTER-created-${cls}`);
    });
  });
}

/**
 * THE ARRIVAL GUARD, AND THE ONE FRAME IT NEEDED.
 *
 * `/goals/new` opened without a community — a typed URL or a stale bookmark.
 * There is nothing to type here, so the page names the way in, and `Go to
 * your communities` is plainly its primary action.
 *
 * It was left on the progress green while the F6 ruling named only the three
 * captured CTAs and the release said no other visual change; the Director
 * closed that gap on the pixel pass. One frame, at one height, because that
 * is what was asked and because this state does not change with viewport
 * height: there is no scroll to lose and nothing below a fold.
 */
test.describe('390x844 · the arrival guard', () => {
  test.use({
    viewport: MAIN,
    userAgent: IPHONE_UA,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
  });

  test('opened with no community, the one way on wears the action green', async ({ page }) => {
    test.setTimeout(120_000);
    const stamp = stampId();
    const email = `gsa.guard.${stamp}@example.invalid`;
    const password = 'goal-setup-after-passw0rd';
    const uid = await seedVerifiedUser(email, password);
    await seedProfile(uid, `Champion ${stamp}`);
    await signInVia(page, email, password);

    await page.goto('/goals/new');
    await expect(page.getByTestId('wsf-new-goal-no-community')).toBeVisible({ timeout: 25_000 });
    // The state's own claim, unchanged: nothing to type, no id, no submit.
    await expect(page.getByTestId('wsf-new-goal-no-community')).toContainText(
      'Choose a community before starting a goal.',
    );
    expect(
      await page.getByTestId('wsf-new-goal-form').locator('input').count(),
      'the arrival guard asks for something',
    ).toBe(0);
    expect(
      await page.getByTestId('wsf-new-goal-submit').count(),
      'the arrival guard offers a submit',
    ).toBe(0);

    const home = page.getByTestId('wsf-new-goal-home');
    await expect(home).toHaveText('Go to your communities');
    await expect(home).toHaveAttribute('href', '/');
    await expectActionGreen(page, 'wsf-new-goal-home', '390x844');
    await assertNoLivingWe(page);
    await shoot(page, 'AFTER-no-community-390x844');
  });
});

test.afterAll(() => {
  if (!CAPTURE_FRAMES) {
    // eslint-disable-next-line no-console
    console.log('[goal-setup AFTER] assertions ran; frames withheld (WSF_CAPTURE_FRAMES=1).');
  }
});
