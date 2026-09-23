import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

import { CAPTURE_FRAMES, saveFrame } from './helpers/capture';
import { PROJECT_ID, seedProfile, seedVerifiedUser, signInVia, stampId } from './helpers/mobile';

/**
 * /start-community — ONE PRODUCER FOR BOTH HALVES OF THE CHECKPOINT.
 *
 * BEFORE is the actual current route, photographed. There was no current
 * BEFORE for it — `batch-b-join-and-setup/before` has none — so these are it.
 * Real route, real fixtures, no drawing: whatever the proposal claims to
 * improve has to be measured against what is on screen today.
 *
 * TARGET is the proposal, photographed off its own gated preview route. Those
 * four are DRAWINGS awaiting a verdict, not an accepted target and not an
 * implementation, and the frames say so on their own strip.
 *
 * ONE FILE, because they are one checkpoint and the second half is only
 * legible beside the first.
 *
 * WRITES ARE OPT-IN (`helpers/capture`). An ordinary run asserts every state
 * and writes nothing; frames appear only under WSF_CAPTURE_FRAMES=1.
 *
 * Every shot is preceded by an assertion of the named state.
 */

const PKG = path.resolve(__dirname, '../../../docs/design-target/review/start-community-next');
const OUT = path.join(PKG, 'before');
const TARGET_OUT = path.join(PKG, 'target');

const CLASSES = [
  { w: 390, h: 844 },
  { w: 390, h: 640 },
] as const;

// Stable fixture identity so the frames do not drift between runs.
const NAME = 'Harbor Walkers';

function callableUrl(name: string): string {
  return `http://127.0.0.1:5001/${PROJECT_ID}/us-central1/${name}`;
}

async function signedInMember(page: Page): Promise<void> {
  const email = `wsf-sc-${stampId()}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Start Community Member');
  await signInVia(page, email, password);
}

async function openStart(page: Page): Promise<void> {
  await page.goto('/start-community');
  await expect(page.getByTestId('wsf-start')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-start-name')).toBeVisible();
}

async function frameOn(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).scrollIntoViewIfNeeded();
  await expect(page.getByTestId(testId)).toBeVisible({ timeout: 10_000 });
}

/**
 * No Living WE on this route: a community that does not exist yet has no
 * confirmed goal and therefore no ratio to draw.
 */
async function assertNoLivingWe(page: Page): Promise<void> {
  expect(
    await page.locator('[data-testid*="living-we"], [data-testid*="wsf-we-"]').count(),
    'a Living WE appears on /start-community, which has no confirmed goal',
  ).toBe(0);
}

for (const { w, h } of CLASSES) {
  test.describe(`${w}x${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test('arrival, a filled form, and the refusals the route actually has', async ({ page }) => {
      test.setTimeout(150_000);
      await signedInMember(page);

      // ---- arrival -------------------------------------------------------
      await openStart(page);
      await expect(page.getByTestId('wsf-start-groupType')).toBeVisible();
      await expect(page.getByTestId('wsf-start-joinPolicy')).toBeVisible();
      await assertNoLivingWe(page);
      await saveFrame(page, path.join(OUT, `start-arrival-${w}x${h}.png`));

      // ---- the name refusal the CLIENT has ------------------------------
      // One character: below NAME_MIN_LENGTH, so the route's own message.
      await page.getByTestId('wsf-start-name').fill('H');
      await page.getByTestId('wsf-start-submit').click();
      await expect(page.getByTestId('wsf-start-name-error')).toBeVisible({ timeout: 10_000 });
      await saveFrame(page, path.join(OUT, `start-name-too-short-${w}x${h}.png`));

      // ---- a representative filled form ----------------------------------
      await page.getByTestId('wsf-start-name').fill(NAME);
      await expect(page.getByTestId('wsf-start-name-error')).toHaveCount(0);
      await frameOn(page, 'wsf-start-summary');
      await saveFrame(page, path.join(OUT, `start-filled-${w}x${h}.png`));

      // ---- the 80-CHARACTER GAP, photographed ----------------------------
      // The server refuses >80 after trim (functions index.ts:134). The form
      // has NAME_MIN_LENGTH and no maximum, so this is accepted locally and
      // only the server objects. The frame is the evidence for that gap.
      const tooLong = 'H'.repeat(120);
      await page.getByTestId('wsf-start-name').fill(tooLong);
      await expect(page.getByTestId('wsf-start-name-error')).toHaveCount(0);
      expect(
        await page.getByTestId('wsf-start-name').inputValue(),
        'the form accepted a name longer than the server allows',
      ).toHaveLength(120);
      await frameOn(page, 'wsf-start-name');
      await saveFrame(page, path.join(OUT, `start-name-over-80-accepted-${w}x${h}.png`));

      // ---- the server refusal --------------------------------------------
      // INJECTED NETWORK FAILURE on wsfCreateCommunity: the only way to reach
      // the route's error state without a real server fault.
      await page.getByTestId('wsf-start-name').fill(NAME);
      await page.route(callableUrl('wsfCreateCommunity'), async (route: Route) => {
        await route.abort('failed');
      });
      await frameOn(page, 'wsf-start-submit');
      await page.getByTestId('wsf-start-submit').click();
      await expect(page.getByTestId('wsf-start-error')).toBeVisible({ timeout: 30_000 });
      // The form survives: the typed name is still there to try again with.
      await expect(page.getByTestId('wsf-start-name')).toHaveValue(NAME);
      await frameOn(page, 'wsf-start-error');
      await saveFrame(page, path.join(OUT, `start-failed-INJECTED-NETWORK-${w}x${h}.png`));
      await page.unroute(callableUrl('wsfCreateCommunity'));
    });
  });
}

/* ── the proposal ───────────────────────────────────────────────────────── */

/**
 * The four drawings, off `/design-target/start-community-next`. The route is
 * gated on EXPO_PUBLIC_WSF_USE_EMULATORS, so this test fails loudly rather
 * than quietly shooting the refusal card if the build ever loses the flag.
 */
const PROPOSED = [
  'start-next-name-too-long',
  'start-next-refused',
  'start-next-unconfirmed',
  'start-next-created',
] as const;

test.describe('the proposal', () => {
  test('four drawings, labelled as proposed, with the claim they exist to fix', async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext({
      // Tall enough to PAINT the whole contact sheet: an element screenshot
      // captures what is painted, not what is about to be.
      viewport: { width: 1800, height: 3200 },
      deviceScaleFactor: 2,
    });
    try {
      const page = await ctx.newPage();
      await page.goto('/design-target/start-community-next');
      await page
        .getByTestId('wsf-target-start-community-next')
        .waitFor({ state: 'visible', timeout: 30_000 });
      // The wordmark is an image; let it decode before the shutter.
      await page.waitForTimeout(2500);

      // ---- the claim these drawings exist to make ------------------------
      // The uncertainty state must NOT assert an outcome it cannot observe,
      // and must not promise the retry is free. If a later edit softens this
      // back into the accepted wording, this fails before anything is written.
      await expect(
        page.getByText('We couldn’t confirm your community was created.').first(),
      ).toBeVisible();
      expect(
        await page.getByText('Nothing was created', { exact: false }).count(),
        'the proposal repeats the accepted claim about the server’s state',
      ).toBe(0);
      expect(
        await page.getByText('Check your communities', { exact: false }).count(),
        'the uncertainty state offers no way to resolve the uncertainty',
      ).toBeGreaterThan(0);
      // Created-but-not-navigated is a success, so it may not be worded as a
      // failure to create.
      await expect(page.getByText('Your community is ready.').first()).toBeVisible();

      await saveFrame(
        page.getByTestId('wsf-contact-sc-next'),
        path.join(TARGET_OUT, 'CONTACT-SHEET-start-community-next.png'),
      );

      for (const { w, h } of CLASSES) {
        const c = `${w}x${h}`;
        for (const id of PROPOSED) {
          const frame = page.getByTestId(`wsf-frame-scnext-${id}-${c}`);
          await expect(frame).toBeVisible();
          // The strip is what stops one of these being mistaken for shipped
          // UI three weeks from now, so it is asserted, not assumed.
          await expect(page.getByTestId(`wsf-frame-banner-scnext-${id}-${c}`)).toBeVisible();
          await saveFrame(frame, path.join(TARGET_OUT, `PROPOSED-${id}-${c}.png`));

          /*
            THE REST OF A SCREEN THAT DOES NOT FIT ON ONE, the way Batch B
            takes it: the same element at the same size with its own
            ScrollView run to the end. Nothing is stretched and no layout is
            faked — a taller frame would change the share of the screen the
            navy field takes and show a composition no phone renders.

            It matters most on `start-next-unconfirmed`, where the whole claim
            is BELOW the fold: the retry is demoted to a secondary, and a
            review that only sees the top of that screen has not seen the
            proposal at all. So an end frame is REQUIRED there, not optional.
          */
          const scrolled = await frame.evaluate((el: Element) => {
            let moved = false;
            for (const n of Array.from(el.querySelectorAll('*'))) {
              const node = n as HTMLElement;
              if (node.scrollHeight > node.clientHeight + 4) {
                node.scrollTop = node.scrollHeight;
                moved = true;
              }
            }
            return moved;
          });
          if (id === 'start-next-unconfirmed') {
            expect(
              scrolled,
              'the demoted retry is below the fold and no end frame was taken',
            ).toBe(true);
            await expect(page.getByText('Create it again').first()).toBeVisible();
          }
          if (scrolled) {
            await page.waitForTimeout(120);
            await saveFrame(frame, path.join(TARGET_OUT, `PROPOSED-${id}-${c}-end.png`));
            await frame.evaluate((el: Element) => {
              Array.from(el.querySelectorAll('*')).forEach((n) => {
                (n as HTMLElement).scrollTop = 0;
              });
            });
          }
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
    console.log(
      '[start-community BEFORE+PROPOSED] assertions ran; frames withheld (WSF_CAPTURE_FRAMES=1).',
    );
  }
});
