import { randomBytes } from 'node:crypto';

import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

import {
  FIRESTORE_EMULATOR,
  PROJECT_ID,
  seedCommunity,
  seedProfile,
  seedVerifiedUser,
  signInVia,
  stampId,
} from './helpers/mobile';

/**
 * W7 — VERIFICATION of W6's implemented `/goals/new` recovery behaviour.
 *
 * Product under test: **`8067364`** (PR #433), route blob
 * `cbda3fdea53a40aa1a404da45938cb4766b26718`, verified by hash before any
 * assertion here was trusted and exercised through a local merge that is
 * never pushed.
 *
 * This answers the four things the Director (`5788288648`) and L0
 * (`5788323817` §2) made conditions of acceptance:
 *
 *   1. commit-with-lost-response VERSUS abort-before-send, kept strictly
 *      distinct and never substituted;
 *   2. the deliberate retry and its duplicate warning;
 *   3. duplicate-submit protection;
 *   4. THE REAL `Check community goals` ACTION.
 *
 * (4) is the one this file exists for. My earlier report (`5787648446`) said
 * the community page "already links to the goal that was created" on the
 * strength of a `toBeAttached` assertion. Attachment proves the anchor is in
 * the DOM and NOTHING ELSE — not that it is visible, not that it can be hit,
 * not that following it arrives anywhere, and not that arriving costs no
 * second goal. That overclaim was corrected by the Director and is not
 * repeated: here the control is proven visible, proven hit-testable against
 * whatever might overlay it, actually clicked, followed to the community, and
 * the server is counted afterwards.
 *
 * What is NOT done here: no product file is touched, no frame is captured or
 * rebaselined, no opinion is offered on the open F6 colour ruling or on any
 * pixel question, W6's own suite is not re-run, and no idempotency is
 * invented — `wsfCreateGoal` still takes no attempt key and
 * `functions-westayfit/` is byte-identical to the base at this head.
 */

const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };
const CREATE_GOAL = '**/wsfCreateGoal';

/** The unknown outcome's exact words — the claim that must be made in BOTH lost cases. */
const UNKNOWN_TITLE = 'We couldn’t confirm your goal was created.';
const UNKNOWN_BODY =
  'It may have been created anyway. Starting another one could create a duplicate.';
/** The consequence that must sit with the deliberate retry. */
const RETRY_NOTE =
  'This starts a new, separate goal. If the first one was created, your community will have two.';
/** The sentence a refusal is allowed to say, and the unknown outcome is not. */
const REFUSED_SUFFIX = 'The server refused this request, so no goal was created.';
/** The base's single instruction, which must no longer be what a lost outcome says. */
const OLD_INSTRUCTION = 'Something went wrong. Please try again.';

type Person = { uid: string; email: string; password: string };
type StoredGoal = { goalId: string; title: string };

async function goalsFor(groupId: string): Promise<StoredGoal[]> {
  const res = await fetch(
    `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
    {
      method: 'POST',
      headers: OWNER,
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
    },
  );
  if (!res.ok) throw new Error(`goal query failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as {
    document?: { name?: string; fields?: Record<string, { stringValue?: string }> };
  }[];
  return body
    .filter((r) => r.document)
    .map((r) => ({
      goalId: r.document!.name!.split('/').pop()!,
      title: r.document!.fields?.title?.stringValue ?? '',
    }));
}

async function newVerified(prefix: string): Promise<Person> {
  const email = `wsf-w7rc-${prefix}-${stampId()}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, `W7 ${prefix}`);
  return { uid, email, password };
}

async function seedPair(): Promise<{ champion: Person; member: Person; groupId: string }> {
  const champion = await newVerified('champ');
  const member = await newVerified('member');
  const groupId = `w7rc-${stampId()}`;
  await seedCommunity({
    groupId,
    displayName: 'W7 recovery community',
    joinPolicy: 'private',
    groupType: 'custom',
    members: [
      { uid: champion.uid, role: 'foundingChampion' },
      { uid: member.uid, role: 'member' },
    ],
  });
  return { champion, member, groupId };
}

async function openForm(page: Page, groupId: string): Promise<void> {
  await page.goto(`/goals/new?groupId=${groupId}`);
  await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 25_000 });
}

async function fillGoal(page: Page, title: string): Promise<void> {
  await page.getByTestId('wsf-new-goal-title').fill(title);
  await page.getByTestId('wsf-new-goal-unit').fill('squats');
  await page.getByTestId('wsf-new-goal-target').fill('500');
  await expect(page.getByTestId('wsf-new-goal-definition')).toHaveText('500 squats');
}

type Counters = { attempted: number; delivered: number };

function countAttempts(page: Page): Counters {
  const counters: Counters = { attempted: 0, delivered: 0 };
  page.on('request', (req) => {
    if (req.url().includes('/wsfCreateGoal') && req.method() === 'POST') counters.attempted += 1;
  });
  return counters;
}

const isCreateCall = (route: Route) => route.request().method() === 'POST';

/** The unknown banner, asserted by its exact words rather than by its shape. */
async function expectUnknownOutcome(page: Page): Promise<void> {
  await expect(page.getByTestId('wsf-new-goal-error')).toHaveText(UNKNOWN_BODY, {
    timeout: 25_000,
  });
  await expect(page.getByText(UNKNOWN_TITLE)).toBeVisible();
  // It claims nothing in EITHER direction: no confirmation, and no borrowed
  // sentence about what the server did.
  await expect(page.getByTestId('wsf-new-goal-created')).toHaveCount(0);
  await expect(page.getByText(REFUSED_SUFFIX)).toHaveCount(0);
  // And it is no longer the base's bare instruction to try again.
  expect(await page.locator('body').innerText()).not.toContain(OLD_INSTRUCTION);
}

/**
 * VISIBLE AND HIT-TESTABLE — the part `toBeAttached` never earned.
 *
 * `elementFromPoint` at the control's own centre answers the question a
 * bounding box cannot: whether anything (a floating tab bar, a banner, a
 * sticky footer) is sitting on top of the thing the Champion is told to
 * press. The hit must land on the control itself or inside it.
 */
async function expectHittable(target: Locator, what: string): Promise<void> {
  await expect(target, `${what} is not visible`).toBeVisible();
  const box = await target.boundingBox();
  expect(box, `${what} has no box`).not.toBeNull();
  expect(box!.width, `${what} has no width`).toBeGreaterThan(0);
  expect(box!.height, `${what} has no height`).toBeGreaterThan(0);

  const covered = await target.evaluate((el) => {
    const r = (el as HTMLElement).getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!hit) return 'nothing is at the centre of the control';
    if (hit === el || el.contains(hit) || hit.contains(el)) return null;
    return `covered by <${hit.tagName.toLowerCase()}>`;
  });
  expect(covered, `${what} cannot be pressed: ${covered}`).toBeNull();
}

test.describe('W7 — W6 goal-setup recovery behaviour at 8067364', () => {
  /**
   * CONDITION 1a — A REFUSAL IS NOW A REFUSAL, AND ITS CLAIM IS TRUE.
   *
   * `permission-denied` is raised inside the transaction before `tx.set`, so
   * the screen is entitled to say no goal was created. That entitlement is
   * only worth anything if it is checked against the server, which is what
   * this does. The control is also taken away, because repeating this exact
   * request could never succeed from this page.
   */
  test('a terminal refusal says no goal was created, is right, and drops the control', async ({
    page,
  }) => {
    test.setTimeout(200_000);
    const { member, groupId } = await seedPair();
    const counters = countAttempts(page);
    await page.route(CREATE_GOAL, async (route: Route) => {
      if (!isCreateCall(route)) return route.continue();
      counters.delivered += 1;
      await route.continue();
    });

    await signInVia(page, member.email, member.password);
    await openForm(page, groupId);
    await fillGoal(page, 'W7 refused goal');
    await page.getByTestId('wsf-new-goal-submit').click();

    await expect(page.getByTestId('wsf-new-goal-error')).toHaveText(
      `Only a Champion of this community can start a goal here. ${REFUSED_SUFFIX}`,
      { timeout: 25_000 },
    );
    await expect(page.getByText('We couldn’t start your goal.')).toBeVisible();

    // The claim is TRUE — checked, not taken on trust.
    expect(await goalsFor(groupId), 'a refusal that claimed nothing was created, created one')
      .toHaveLength(0);
    expect(counters).toEqual({ attempted: 1, delivered: 1 });

    // Terminal: the control is gone, and what replaces it goes somewhere real.
    await expect(page.getByTestId('wsf-new-goal-submit')).toHaveCount(0);
    await expectHittable(page.getByTestId('wsf-new-goal-refused-back'), 'the back-to-community link');
    await expect(page.getByTestId('wsf-new-goal-refused-back')).toHaveAttribute(
      'href',
      `/community/${groupId}`,
    );

    // And a refusal is NOT the unknown outcome.
    await expect(page.getByText(UNKNOWN_TITLE)).toHaveCount(0);
    await expect(page.getByTestId('wsf-new-goal-check-goals')).toHaveCount(0);
  });

  /**
   * CONDITION 1b — A REFUSAL THE CHAMPION COULD CLEAR KEEPS THE CONTROL.
   *
   * `invalid-argument` is raised before the write like the others, but it is
   * the one a Champion can act on here, so taking the control away would stop
   * them fixing it. The server's answer is supplied at the callable boundary;
   * nothing is written behind the interface.
   */
  test('a non-terminal refusal keeps the control and still creates nothing', async ({ page }) => {
    test.setTimeout(200_000);
    const { champion, groupId } = await seedPair();
    await page.route(CREATE_GOAL, async (route: Route) => {
      if (!isCreateCall(route)) return route.continue();
      await route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { status: 'INVALID_ARGUMENT', message: 'target must be a positive integer.' },
        }),
      });
    });

    await signInVia(page, champion.email, champion.password);
    await openForm(page, groupId);
    await fillGoal(page, 'W7 non-terminal refusal');
    await page.getByTestId('wsf-new-goal-submit').click();

    await expect(page.getByTestId('wsf-new-goal-error')).toHaveText(
      `Something about this goal didn't look right. Check the details and try again. ${REFUSED_SUFFIX}`,
      { timeout: 25_000 },
    );
    // The Champion can still act on it, and it is still the ordinary control.
    await expectHittable(page.getByTestId('wsf-new-goal-submit'), 'the submit control');
    await expect(page.getByTestId('wsf-new-goal-submit')).toHaveText('Start this goal');
    await expect(page.getByTestId('wsf-new-goal-refused-back')).toHaveCount(0);
    expect(await goalsFor(groupId)).toHaveLength(0);
  });

  /**
   * CONDITION 1c — ABORT BEFORE SEND. Nothing reaches the server, nothing is
   * created, and the screen says only that it could not confirm.
   *
   * Note what is deliberately NOT asserted: that the screen says no goal
   * exists. It does not know that. Being unable to distinguish this from the
   * next test is the honest position, and the next test is why.
   */
  test('abort before send: nothing is created, and the screen claims nothing', async ({ page }) => {
    test.setTimeout(200_000);
    const { champion, groupId } = await seedPair();
    const counters = countAttempts(page);
    await page.route(CREATE_GOAL, async (route: Route) => {
      if (!isCreateCall(route)) return route.continue();
      await route.abort('failed');
    });

    await signInVia(page, champion.email, champion.password);
    await openForm(page, groupId);
    await fillGoal(page, 'W7 never sent');
    await page.getByTestId('wsf-new-goal-submit').click();

    await expectUnknownOutcome(page);
    expect(await goalsFor(groupId), 'a request that never left created a goal').toHaveLength(0);
    expect(counters.attempted, 'the client issued exactly one attempt').toBe(1);
    expect(counters.delivered, 'the callable was asked despite the abort').toBe(0);
  });

  /**
   * CONDITION 1d — COMMIT WITH LOST RESPONSE. The transaction committed, the
   * reply was destroyed, and a goal EXISTS.
   *
   * The server's own 200 is captured before it is dropped, so the commit is
   * stated rather than inferred. The screen renders the SAME words as the
   * previous test — and that is the correct behaviour, not a defect: the
   * client cannot tell these apart, and the fix was to stop pretending it
   * could. What changed is that it no longer instructs a retry.
   */
  test('commit with lost response: the goal exists, and the screen still claims nothing', async ({
    page,
  }) => {
    test.setTimeout(200_000);
    const { champion, groupId } = await seedPair();
    const counters = countAttempts(page);
    const replies: { status: number; body: string }[] = [];
    await page.route(CREATE_GOAL, async (route: Route) => {
      if (!isCreateCall(route)) return route.continue();
      counters.delivered += 1;
      const response = await route.fetch();
      replies.push({ status: response.status(), body: await response.text() });
      await route.abort('failed');
    });

    await signInVia(page, champion.email, champion.password);
    await openForm(page, groupId);
    await fillGoal(page, 'W7 committed but unconfirmed');
    await page.getByTestId('wsf-new-goal-submit').click();

    await expectUnknownOutcome(page);

    // What the server actually said, and actually did.
    expect(replies, 'the callable was asked exactly once').toHaveLength(1);
    expect(replies[0]!.status, 'the callable did not return a success').toBe(200);
    const stored = await goalsFor(groupId);
    expect(stored, 'the committed goal is missing from the server').toHaveLength(1);
    expect(replies[0]!.body, 'the reply named a different goal').toContain(stored[0]!.goalId);
    expect(counters).toEqual({ attempted: 1, delivered: 1 });
  });

  /**
   * CONDITION 4 — THE REAL `Check community goals` ACTION.
   *
   * The proof my last report did not earn. A goal exists and the Champion
   * cannot see it, so the promoted action has to actually work: be visible,
   * survive a hit test against anything that might overlay it (the floating
   * tab bar is the obvious candidate), be clicked, arrive at the community,
   * show the goal that was made — and cost nothing.
   */
  test('Check community goals is visible, hit-testable, clicked, and reaches the goal with no second create', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const { champion, groupId } = await seedPair();
    const counters = countAttempts(page);
    let dropNext = true;
    await page.route(CREATE_GOAL, async (route: Route) => {
      if (!isCreateCall(route)) return route.continue();
      counters.delivered += 1;
      if (!dropNext) return route.continue();
      await route.fetch();
      dropNext = false;
      await route.abort('failed');
    });

    await signInVia(page, champion.email, champion.password);
    await openForm(page, groupId);
    await fillGoal(page, 'W7 recovery goal');
    await page.getByTestId('wsf-new-goal-submit').click();
    await expectUnknownOutcome(page);

    const created = await goalsFor(groupId);
    expect(created, 'the fixture did not leave exactly one unconfirmed goal').toHaveLength(1);
    const goalId = created[0]!.goalId;

    // VISIBLE AND HIT-TESTABLE — not merely attached.
    const check = page.getByTestId('wsf-new-goal-check-goals');
    await expectHittable(check, 'the Check community goals action');
    await expect(check).toHaveText('Check community goals');
    await expect(check).toHaveAttribute('href', `/community/${groupId}`);

    // CLICKED, and it arrives.
    await check.click();
    await page.waitForURL(new RegExp(`/community/${groupId}\\b`), { timeout: 25_000 });

    // THE GOAL THAT WAS MADE IS THERE, and reachable rather than merely present.
    const goalLink = page.locator(`[href*="${goalId}"]`).first();
    await expect(
      goalLink,
      'the community page does not show the goal that was actually created',
    ).toBeVisible({ timeout: 25_000 });
    await expectHittable(goalLink, 'the link to the created goal');

    // AND IT COST NOTHING: still exactly one goal, and no further create call.
    const after = await goalsFor(groupId);
    expect(after, 'following the recovery action created another goal').toHaveLength(1);
    expect(after[0]!.goalId).toBe(goalId);
    expect(counters, 'the recovery path issued another create call').toEqual({
      attempted: 1,
      delivered: 1,
    });
  });

  /**
   * CONDITION 2 — THE DELIBERATE RETRY, AND ITS WARNING.
   *
   * The second create is still possible — it has to be, because the goal may
   * genuinely not exist — but it must announce what it does before it does
   * it. So the warning is asserted ON SCREEN WITH the control, and then the
   * control is taken at its word: pressing it really does make a second goal.
   */
  test('the retry is demoted, states the two-goals consequence, and really does create a second', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const { champion, groupId } = await seedPair();
    const counters = countAttempts(page);
    let dropNext = true;
    await page.route(CREATE_GOAL, async (route: Route) => {
      if (!isCreateCall(route)) return route.continue();
      counters.delivered += 1;
      if (!dropNext) return route.continue();
      await route.fetch();
      dropNext = false;
      await route.abort('failed');
    });

    await signInVia(page, champion.email, champion.password);
    await openForm(page, groupId);
    await fillGoal(page, 'W7 retried goal');
    await page.getByTestId('wsf-new-goal-submit').click();
    await expectUnknownOutcome(page);
    expect(await goalsFor(groupId), 'the first press did not commit').toHaveLength(1);

    // The control is no longer the same control, and the consequence is beside it.
    const submit = page.getByTestId('wsf-new-goal-submit');
    await expect(submit).toHaveText('Start another goal');
    await expect(page.getByText(RETRY_NOTE), 'the duplicate warning is not on screen').toBeVisible();
    await expectHittable(submit, 'the deliberate retry');

    // Taken at its word.
    await submit.click();
    await expect(page.getByTestId('wsf-new-goal-created')).toBeVisible({ timeout: 25_000 });
    const stored = await goalsFor(groupId);
    expect(stored, 'the deliberate retry did not produce a second goal').toHaveLength(2);
    expect(stored.map((g) => g.title)).toEqual(['W7 retried goal', 'W7 retried goal']);
    expect(new Set(stored.map((g) => g.goalId)).size, 'the two rows are one goal').toBe(2);
    const shown = await page.getByTestId('wsf-new-goal-created').getAttribute('data-goal-id');
    expect(stored.map((g) => g.goalId)).toContain(shown);
    expect(counters).toEqual({ attempted: 2, delivered: 2 });
  });

  /**
   * CONDITION 3 — DUPLICATE-SUBMIT PROTECTION, measured while a real request
   * is genuinely in flight rather than in a gap the harness invented. Only
   * what the interface permits is attempted: a real press with a real
   * timeout, and whether it lands is the measurement.
   */
  test('a second press inside a genuinely in-flight window does not reach the server', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const { champion, groupId } = await seedPair();
    const counters = countAttempts(page);
    await page.route(CREATE_GOAL, async (route: Route) => {
      if (!isCreateCall(route)) return route.continue();
      counters.delivered += 1;
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      await route.fulfill({ response });
    });

    await signInVia(page, champion.email, champion.password);
    await openForm(page, groupId);
    await fillGoal(page, 'W7 double press');

    const submit = page.getByTestId('wsf-new-goal-submit');
    await submit.click();
    await expect(submit).toHaveText('Starting…', { timeout: 5_000 });
    await expect(submit).toBeDisabled();

    let landed = true;
    try {
      await submit.click({ timeout: 1_500 });
    } catch {
      landed = false;
    }
    expect(landed, 'the disabled control accepted a second press').toBe(false);

    await expect(page.getByTestId('wsf-new-goal-created')).toBeVisible({ timeout: 25_000 });
    expect(await goalsFor(groupId), 'a second goal appeared from one press').toHaveLength(1);
    expect(counters).toEqual({ attempted: 1, delivered: 1 });
  });
});
