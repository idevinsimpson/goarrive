import path from 'node:path';

import { expect, test, type Locator } from '@playwright/test';

import { CAPTURE_FRAMES, saveFrame } from './helpers/capture';

/**
 * /goals/new — THE PROPOSED SETUP EXPERIENCE, PHOTOGRAPHED OFF ITS OWN ROUTE.
 *
 * TARGET ONLY. There is already a current BEFORE package for this route
 * (`docs/design-target/review/goal-setup-current/`, 16 frames), shot at
 * `0757379`, and the route's blob is `e5be66f` at that SHA and at this
 * branch's base `a193b43` alike. Re-shooting it would produce the same
 * pixels from the same source and put a second copy of frozen evidence in
 * the tree, so this producer does not. `../before/README.md` in the package
 * names each reused frame and its sha256 instead.
 *
 * THESE SIX ARE DRAWINGS. They are a proposal awaiting a verdict — not an
 * accepted target, not an AFTER, and not an implementation. Every frame
 * carries its own PROPOSED / NOT ACCEPTED strip and this spec asserts the
 * strip is on the frame before it writes the frame.
 *
 * WRITES ARE OPT-IN (`helpers/capture`). An ordinary run asserts every claim
 * below and writes NOTHING; frames appear only under WSF_CAPTURE_FRAMES=1.
 * The assertions are the point of running it in the ordinary suite: if a
 * later edit softens the uncertainty wording back into a claim about the
 * server's state, or puts the refused action back on the refused frame, this
 * fails before any byte is written.
 */

const PKG = path.resolve(__dirname, '../../../docs/design-target/review/goal-setup-next');
const TARGET_OUT = path.join(PKG, 'target');

const CLASSES = [
  { w: 390, h: 844 },
  { w: 390, h: 640 },
] as const;

const PROPOSED = [
  'form-top',
  'custom-window',
  'summary-commit',
  'refused',
  'unconfirmed',
  'created',
] as const;

/** The phone's fold: the bottom edge of the frame that stands for the phone. */
async function frameFoldY(frame: Locator): Promise<number> {
  const box = await frame.boundingBox();
  expect(box, 'the frame has no box to measure a fold against').not.toBeNull();
  return box!.y + box!.height;
}

/** The bottom edge of an element, in the same page coordinates. */
async function bottomY(locator: Locator): Promise<number> {
  const box = await locator.first().boundingBox();
  expect(box, 'the element has no box to measure').not.toBeNull();
  return box!.y + box!.height;
}

test.describe('the /goals/new proposal', () => {
  test('six drawings, labelled as proposed, with the claims they exist to make', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext({
      // Tall enough to PAINT the whole contact sheet: an element screenshot
      // captures what is painted, not what is about to be.
      viewport: { width: 1800, height: 3600 },
      deviceScaleFactor: 2,
    });
    try {
      const page = await ctx.newPage();
      await page.goto('/design-target/goal-setup-next');
      // The route is gated on EXPO_PUBLIC_WSF_USE_EMULATORS. If the build
      // ever loses the flag this fails loudly rather than quietly shooting
      // the refusal panel and calling it a target.
      await page
        .getByTestId('wsf-target-goal-setup-next')
        .waitFor({ state: 'visible', timeout: 30_000 });
      // The wordmark is an image; let it decode before the shutter.
      await page.waitForTimeout(2500);

      // ---- the claims these drawings exist to make -----------------------

      // ONE. The unconfirmed state exists at all, and states uncertainty.
      // The per-frame checks below prove it does not also assert an outcome.
      await expect(
        page.getByText('We couldn’t confirm your goal was started.').first(),
      ).toBeVisible();
      await expect(page.getByText('Check your community’s goals').first()).toBeVisible();
      await expect(
        page.getByText('This starts a new, separate goal.', { exact: false }).first(),
      ).toBeVisible();

      // TWO. Exactly two repeat policies, still, and `once` still the one
      // shown as chosen. A third policy is the thing this packet may not add.
      await expect(page.getByText('One contribution per member').first()).toBeVisible();
      await expect(page.getByText('Members can contribute again').first()).toBeVisible();
      expect(
        await page.getByText('Members can contribute daily', { exact: false }).count() +
          await page.getByText('Members can contribute weekly', { exact: false }).count(),
        'a third repeat policy appears in the proposal',
      ).toBe(0);

      // THREE. The four durations, with the route's own labels, and no fifth.
      for (const label of ['1 week', '2 weeks', '1 month', 'Custom']) {
        await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
      }

      // FOUR. The summary is still same-page and still says the same thing,
      // and the control that starts the goal is INSIDE it — the whole point
      // of the commit panel.
      const commit = page.getByTestId('wsf-gsnext-commit').first();
      await expect(commit.getByText('Check it over')).toBeVisible();
      await expect(commit.getByText('This is what your community will see.')).toBeVisible();
      await expect(commit.getByText('Start this goal')).toBeVisible();

      // FIVE. No Living WE anywhere in setup, and no contributed total: a
      // goal that does not exist yet has no confirmed shared total, and one
      // that was just created has nothing in it.
      expect(
        await page.locator('[data-testid*="living-we"], [data-testid*="wsf-we-"]').count(),
        'a Living WE appears in the goal-setup proposal',
      ).toBe(0);

      // SIX. The created state is a success and is worded as one.
      await expect(page.getByText('Your goal is live').first()).toBeVisible();

      await saveFrame(
        page.getByTestId('wsf-contact-gsnext'),
        path.join(TARGET_OUT, 'CONTACT-SHEET-goal-setup-next.png'),
      );

      for (const { w, h } of CLASSES) {
        const c = `${w}x${h}`;
        for (const id of PROPOSED) {
          const frame = page.getByTestId(`wsf-frame-gsnext-${id}-${c}`);
          await expect(frame).toBeVisible();

          // The strip is what stops one of these being mistaken for shipped
          // UI three weeks from now, so it is asserted, not assumed.
          await expect(page.getByTestId(`wsf-frame-banner-gsnext-${id}-${c}`)).toBeVisible();

          if (id === 'form-top') {
            /*
              THE CLAIM OF THIS FRAME, MEASURED RATHER THAN EYEBALLED.
              `toBeInViewport` answers a different question here — the frame
              is one element on a very tall preview page, so the browser
              viewport says nothing about the phone's fold. The fold is the
              frame's own bottom edge, so the check is geometric: the payoff
              line must finish above it at BOTH classes. In the build it does
              not at 390x640: that viewport ends inside the third field.
            */
            const fold = await frameFoldY(frame);
            const payoff = await bottomY(frame.getByText('30,000 squats'));
            // eslint-disable-next-line no-console
            console.log(`[gsnext] ${c} payoff bottom ${Math.round(payoff)} / fold ${Math.round(fold)}`);
            expect(
              payoff,
              `the goal phrase falls below the fold at ${c}, which is the defect this frame claims to fix`,
            ).toBeLessThanOrEqual(fold);
            /*
              REPORTED, NOT ASSERTED, and not asserted for a reason. The
              duration row is the NEXT thing that would have to clear, and at
              390x640 it does not — the frame itself shows the page ending on
              "2 · When". A box read is not proof either way here: an element
              sitting inside an overflow-hidden ancestor still reports a rect,
              so this number is the element's own geometry and the FRAME is
              the evidence. It is printed so the verdict has the figure.
            */
            const pills = await bottomY(frame.getByText('1 week', { exact: true }));
            // eslint-disable-next-line no-console
            console.log(
              `[gsnext] ${c} duration row own-rect bottom ${Math.round(pills)} / fold ${Math.round(fold)} (see the frame, not this number)`,
            );
          }

          if (id === 'summary-commit') {
            /*
              THE CLAIM OF THIS FRAME: the check and the control that acts on
              it arrive WHOLE, on one screen, at both classes. A commit button
              clipped by the reserved tab strip would be the very defect the
              frame is about, so the fold is measured rather than eyeballed.
            */
            const fold = await frameFoldY(frame);
            const button = await bottomY(frame.getByText('Start this goal', { exact: true }));
            // eslint-disable-next-line no-console
            console.log(`[gsnext] ${c} submit bottom ${Math.round(button)} / fold ${Math.round(fold)}`);
            expect(
              button,
              `the commit control is clipped at ${c}, which is the defect this frame claims to fix`,
            ).toBeLessThan(fold);
            await expect(frame.getByText('Harbor Walkers')).toBeVisible();
            await expect(frame.getByText('One contribution per member').first()).toBeVisible();
          }

          if (id === 'custom-window') {
            // goal-setup-current observation 1: under Custom the explicit
            // start control REPLACES the derived "Starts …" line. Drawing
            // both would be drawing a screen the route does not render.
            expect(
              await frame.getByText('Starts today at', { exact: false }).count(),
              'the Custom frame draws a derived start line the route does not render in Custom',
            ).toBe(0);
            await expect(frame.getByText('Ends Sunday, Nov 15 at 6:00 PM')).toBeVisible();
          }

          if (id === 'refused') {
            // The server answered and will answer the same way again, so the
            // action it refused is not offered a second time.
            await expect(frame.getByText('Only a Champion of this community', { exact: false })).toBeVisible();
            expect(
              await frame.getByText('Start this goal', { exact: true }).count(),
              'the refusal still offers the action the server just refused',
            ).toBe(0);
          }

          if (id === 'unconfirmed') {
            // The retry says what it STARTS, and the duplicate risk sits
            // beside it rather than in a banner the reader has scrolled past.
            await expect(frame.getByText('Start this goal anyway')).toBeVisible();
            await expect(
              frame.getByText('you will', { exact: false }).or(frame.getByText('will have two', { exact: false })).first(),
            ).toBeVisible();
            expect(
              await frame.getByText('Try again', { exact: false }).count(),
              'the retry still reads as a free replay of the request that was lost',
            ).toBe(0);
            // The sentence the REFUSAL is allowed to say and this frame is
            // not: the client did not get an answer, so it knows nothing
            // about the server's state.
            expect(
              await frame.getByText('Nothing was started', { exact: false }).count(),
              'the unconfirmed frame asserts an outcome the client cannot observe',
            ).toBe(0);
            expect(
              await frame.getByText('safe to', { exact: false }).count(),
              'the unconfirmed frame promises the retry is safe; the callable has no attempt key',
            ).toBe(0);
          }

          if (id === 'created') {
            await expect(frame.getByText('Open the contribute page')).toBeVisible();
            await expect(frame.getByText('Your goal is live')).toBeVisible();
          }

          await saveFrame(frame, path.join(TARGET_OUT, `PROPOSED-${id}-${c}.png`));
        }
      }
    } finally {
      await ctx.close();
    }
  });
});

test.afterAll(() => {
  if (!CAPTURE_FRAMES) {
    // eslint-disable-next-line no-console
    console.log('[goal-setup PROPOSED] assertions ran; frames withheld (WSF_CAPTURE_FRAMES=1).');
  }
});
