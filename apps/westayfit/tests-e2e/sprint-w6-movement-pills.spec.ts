import fs from 'node:fs';
import path from 'node:path';

import { expect, test, type Page, type Request } from '@playwright/test';

import { CAPTURE_FRAMES, saveFrame } from './helpers/capture';
import {
  FIRESTORE_EMULATOR,
  IPHONE_UA,
  PROJECT_ID,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * MOVEMENT-PILLS-1 (Director #365 `5834082617` §B; L0 #456 `5834097050`).
 *
 * `/goals/new` gains accessible pills for one or several SUPPORTED movements.
 * What a choice means is decided by `src/movementSelection.ts` and tested there
 * as plain functions; this spec proves the screen obeys it end to end, against
 * the real `wsfCreateGoal` on the local emulator:
 *
 *   • one movement        → one goal, the movement's unit and its own guide;
 *   • several, same kind  → still ONE goal (never child goals), the unit naming
 *                           every movement and the review saying how it counts;
 *   • mixed kinds         → the reason on screen, the submit off, and NO
 *                           request to the callable at all;
 *   • nothing picked      → the typed unit, exactly as before, with no guide
 *                           key sent — and a typed draft survives the pills.
 *
 * WRITES ARE OPT-IN (`helpers/capture`): frames and the interaction recording
 * are written only under WSF_CAPTURE_FRAMES=1, into a NEW directory. Nothing
 * accepted is written.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/movement-pills-1');

const TITLE = 'Autumn movement challenge';
const TARGET = '30000';

type Fx = { email: string; password: string; groupId: string };

async function seedChampion(label: string): Promise<Fx> {
  const stamp = stampId();
  const email = `mp1.${label}.${stamp}@example.invalid`;
  const password = 'movement-pills-passw0rd';
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, `Champion ${stamp}`);
  const groupId = `mp1${label}_${stamp}`;
  await seedCommunity({
    groupId,
    displayName: 'Harbor Walkers',
    joinPolicy: 'private',
    members: [{ uid, role: 'foundingChampion' }],
  });
  return { email, password, groupId };
}

async function openForm(page: Page, fx: Fx): Promise<void> {
  await signInVia(page, fx.email, fx.password);
  await page.goto(`/community/${fx.groupId}`);
  await expect(page.getByTestId('wsf-community-no-goal')).toBeVisible({ timeout: 25_000 });
  await page.getByTestId('wsf-community-start-goal').click();
  await page.waitForURL(/\/goals\/new/, { timeout: 20_000 });
  await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 20_000 });
}

async function fillNameAndTarget(page: Page): Promise<void> {
  await page.getByTestId('wsf-new-goal-title').fill(TITLE);
  await page.getByTestId('wsf-new-goal-target').fill(TARGET);
}

const pill = (page: Page, key: string) => page.getByTestId(`wsf-new-goal-movements-${key}`);

async function expectChecked(page: Page, key: string, checked: boolean): Promise<void> {
  await expect(pill(page, key), `${key} states its selection`).toHaveAttribute(
    'aria-checked',
    checked ? 'true' : 'false',
  );
}

/** Every body this page sends to wsfCreateGoal, parsed. */
function watchCreateGoal(page: Page): Array<Record<string, unknown>> {
  const sent: Array<Record<string, unknown>> = [];
  page.on('request', (req: Request) => {
    if (req.method() === 'POST' && req.url().includes('/wsfCreateGoal')) {
      const body = req.postDataJSON() as { data?: Record<string, unknown> } | null;
      sent.push(body?.data ?? {});
    }
  });
  return sent;
}

type GoalFields = Record<string, { stringValue?: string; integerValue?: string }>;

/** Every goal in this community, straight from the emulator. */
async function goalsIn(groupId: string): Promise<GoalFields[]> {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: 'wsfGoals' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'communityGroupId' },
            op: 'EQUAL',
            value: { stringValue: groupId },
          },
        },
      },
    }),
  });
  expect(res.ok, 'emulator query').toBe(true);
  const rows = (await res.json()) as Array<{ document?: { fields: GoalFields } }>;
  return rows.filter((r) => r.document).map((r) => r.document!.fields);
}

async function submitAndExpectCreated(page: Page): Promise<string> {
  const submit = page.getByTestId('wsf-new-goal-submit');
  await submit.scrollIntoViewIfNeeded();
  await submit.click();
  const created = page.getByTestId('wsf-new-goal-created');
  await expect(created).toBeVisible({ timeout: 30_000 });
  const goalId = await created.getAttribute('data-goal-id');
  expect(goalId, 'the server assigned a goal id').toBeTruthy();
  return goalId!;
}

async function shoot(page: Page, name: string): Promise<void> {
  if (CAPTURE_FRAMES) fs.mkdirSync(OUT, { recursive: true });
  await saveFrame(page, path.join(OUT, `${name}.png`));
}

for (const [cls, viewport] of [
  ['390x844', { width: 390, height: 844 }],
  ['390x640', { width: 390, height: 640 }],
] as const) {
  test.describe(cls, () => {
    test.use({ viewport, userAgent: IPHONE_UA, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

    test('one movement makes one goal with that movement’s unit and guide', async ({ page }) => {
      test.setTimeout(150_000);
      const fx = await seedChampion(`one${cls.slice(4)}`);
      const sent = watchCreateGoal(page);
      await openForm(page, fx);
      await fillNameAndTarget(page);

      // Nothing picked: every pill says so, and the typed field is the unit.
      for (const key of ['squats', 'push-ups', 'sit-ups', 'steps', 'laps']) await expectChecked(page, key, false);
      await expect(page.getByTestId('wsf-new-goal-unit')).toBeVisible();

      await pill(page, 'squats').click();
      await expectChecked(page, 'squats', true);
      await expect(page.getByTestId('wsf-new-goal-unit')).toHaveCount(0);
      await expect(page.getByTestId('wsf-new-goal-unit-chosen')).toHaveText('squats');
      await expect(page.getByTestId('wsf-new-goal-definition')).toHaveText('30,000 squats');
      await expect(page.getByTestId('wsf-new-goal-movements-count')).toHaveText('Every squat counts once.');
      await shoot(page, `AFTER-one-movement-${cls}`);

      await page.getByTestId('wsf-new-goal-summary').scrollIntoViewIfNeeded();
      await expect(page.getByTestId('wsf-new-goal-summary')).toContainText('Every squat counts once.');
      await shoot(page, `AFTER-one-movement-review-${cls}`);

      await submitAndExpectCreated(page);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ unit: 'squats', activityGuideKey: 'squats', target: 30000 });
      const goals = await goalsIn(fx.groupId);
      expect(goals).toHaveLength(1);
      expect(goals[0]!.unit?.stringValue).toBe('squats');
      expect(goals[0]!.activityGuideKey?.stringValue).toBe('squats');
    });

    test('several movements counted the same way make ONE goal, said plainly', async ({ page }) => {
      test.setTimeout(150_000);
      const fx = await seedChampion(`many${cls.slice(4)}`);
      const sent = watchCreateGoal(page);
      await openForm(page, fx);
      await fillNameAndTarget(page);

      // Tapped out of catalog order on purpose: the unit is in catalog order.
      await pill(page, 'push-ups').click();
      await pill(page, 'squats').click();
      await expectChecked(page, 'squats', true);
      await expectChecked(page, 'push-ups', true);
      await expect(page.getByTestId('wsf-new-goal-unit-chosen')).toHaveText('squats + push-ups');
      await expect(page.getByTestId('wsf-new-goal-movements-count')).toHaveText(
        'Every squat and push-up counts once toward the same total.',
      );
      await shoot(page, `AFTER-several-movements-${cls}`);

      await page.getByTestId('wsf-new-goal-summary').scrollIntoViewIfNeeded();
      await shoot(page, `AFTER-several-movements-review-${cls}`);

      await submitAndExpectCreated(page);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ unit: 'squats + push-ups', activityGuideKey: 'reps' });
      // ONE goal. No child goals, nothing combined, nothing left behind.
      const goals = await goalsIn(fx.groupId);
      expect(goals).toHaveLength(1);
      expect(goals[0]!.unit?.stringValue).toBe('squats + push-ups');
    });

    test('movements counted differently are refused on screen and never sent', async ({ page }) => {
      test.setTimeout(150_000);
      const fx = await seedChampion(`mix${cls.slice(4)}`);
      const sent = watchCreateGoal(page);
      await openForm(page, fx);
      await fillNameAndTarget(page);

      await pill(page, 'squats').click();
      await pill(page, 'steps').click();
      const mixed = page.getByTestId('wsf-new-goal-movements-mixed');
      await expect(mixed).toHaveText(
        'Squats and steps are counted differently, so they can’t share one total. Choose movements counted the same way, or start a separate goal for each.',
      );
      await expect(page.getByTestId('wsf-new-goal-definition')).toHaveCount(0);
      await shoot(page, `AFTER-mixed-refused-${cls}`);

      const submit = page.getByTestId('wsf-new-goal-submit');
      await submit.scrollIntoViewIfNeeded();
      await expect(submit).toHaveAttribute('aria-disabled', 'true');
      await submit.click({ force: true });
      await page.waitForTimeout(800);
      expect(sent, 'a mixed choice reached the callable').toHaveLength(0);
      await expect(page.getByTestId('wsf-new-goal-created')).toHaveCount(0);
      expect(await goalsIn(fx.groupId)).toHaveLength(0);

      // Resolving the mix turns the submit back on, and it creates one goal.
      await pill(page, 'steps').scrollIntoViewIfNeeded();
      await pill(page, 'steps').click();
      await expect(mixed).toHaveCount(0);
      await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
      await submitAndExpectCreated(page);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ unit: 'squats', activityGuideKey: 'squats' });
    });

    test('a typed unit still works, sends no guide key, and survives the pills', async ({ page }) => {
      test.setTimeout(150_000);
      const fx = await seedChampion(`typed${cls.slice(4)}`);
      const sent = watchCreateGoal(page);
      await openForm(page, fx);
      await fillNameAndTarget(page);

      await page.getByTestId('wsf-new-goal-unit').fill('burpees');
      await expect(page.getByTestId('wsf-new-goal-definition')).toHaveText('30,000 burpees');
      await pill(page, 'laps').click();
      await expect(page.getByTestId('wsf-new-goal-unit-chosen')).toHaveText('laps');
      await pill(page, 'laps').click();
      // The draft is back, untouched.
      await expect(page.getByTestId('wsf-new-goal-unit')).toHaveValue('burpees');

      await submitAndExpectCreated(page);
      expect(sent).toHaveLength(1);
      expect(sent[0]!.unit).toBe('burpees');
      expect(sent[0], 'a typed unit sends no guide key').not.toHaveProperty('activityGuideKey');
    });
  });
}

test.describe('390x844 · keyboard', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the pills are checkboxes reached by Tab and toggled by Space', async ({ page }) => {
    test.setTimeout(120_000);
    const fx = await seedChampion('kbd');
    await openForm(page, fx);
    await page.getByTestId('wsf-new-goal-title').focus();

    let reached = false;
    for (let i = 0; i < 20 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await pill(page, 'squats').evaluate((el) => el === document.activeElement);
    }
    expect(reached, 'Tab never reaches the first movement pill').toBe(true);
    await expect(pill(page, 'squats')).toHaveAttribute('role', 'checkbox');
    await page.keyboard.press('Space');
    await expectChecked(page, 'squats', true);
    await page.keyboard.press('Space');
    await expectChecked(page, 'squats', false);
    await expect(page.getByTestId('wsf-new-goal-movements')).toHaveAttribute('aria-label', 'Movements');
  });
});

/*
  THE INTERACTION RECORDING the definition of done asks for: selection →
  review → submit, at 390×844, as a real browser video. Written only under
  WSF_CAPTURE_FRAMES=1, and only into this packet's own directory.
*/
test.describe('recording', () => {
  test('selection → review → submit, recorded', async ({ browser }) => {
    test.skip(!CAPTURE_FRAMES, 'the recording is evidence; it is written only when asked for');
    test.setTimeout(180_000);
    const fx = await seedChampion('rec');
    const dir = path.join(OUT, '.video-tmp');
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: IPHONE_UA,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      recordVideo: { dir, size: { width: 390, height: 844 } },
    });
    const page = await context.newPage();
    await openForm(page, fx);
    await fillNameAndTarget(page);
    await page.waitForTimeout(400);
    await pill(page, 'steps').click();
    await page.waitForTimeout(500);
    await pill(page, 'squats').click();
    await expect(page.getByTestId('wsf-new-goal-movements-mixed')).toBeVisible();
    await page.waitForTimeout(900);
    await pill(page, 'steps').click();
    await pill(page, 'push-ups').click();
    await expect(page.getByTestId('wsf-new-goal-unit-chosen')).toHaveText('squats + push-ups');
    await page.waitForTimeout(700);
    await page.getByTestId('wsf-new-goal-summary').scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
    await submitAndExpectCreated(page);
    await page.waitForTimeout(1200);
    const video = page.video();
    await context.close();
    const src = await video!.path();
    fs.copyFileSync(src, path.join(OUT, 'RECORDING-selection-review-submit-390x844.webm'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
