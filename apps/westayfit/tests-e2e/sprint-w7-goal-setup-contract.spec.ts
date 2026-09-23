import { randomBytes } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

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
 * W7 — THE `/goals/new` ↔ `wsfCreateGoal` CREATION-RESULT / RECOVERY CONTRACT.
 *
 * This is an investigation of the contract that EXISTS on the pinned code
 * (`apps/westayfit/app/goals/new.tsx` and `wsfCreateGoal` in
 * `functions-westayfit/src/index.ts`), held apart from W6's styling work. It
 * asks one question: WHEN THE CHAMPION CANNOT SEE WHAT HAPPENED, WHAT ACTUALLY
 * HAPPENED ON THE SERVER — and does the screen let them find out?
 *
 * The two cases that matter are kept strictly distinct and are NEVER
 * substituted for one another:
 *
 *   COMMIT-WITH-LOST-RESPONSE — the request reaches the server, the server
 *   commits, and the response is destroyed on the way back. A goal exists.
 *
 *   ABORT-BEFORE-SEND — the request never leaves the browser. No goal exists.
 *
 * A missing response is not proof that nothing was created, so each case reads
 * the SERVER back by query rather than inferring from the screen, and each
 * records the request count twice: attempts the client issued, and requests
 * actually DELIVERED to the callable. Only the delivered count can create a
 * goal, and only the query can say whether one did.
 *
 * WHAT THIS FILE DOES NOT DO. It invents no idempotency: `wsfCreateGoal` takes
 * no attempt key (`db.collection('wsfGoals').doc()` mints a fresh id per
 * invocation) and nothing here pretends otherwise. It makes no extra mutation
 * to force a pass — every goal that comes into existence below is created by
 * pressing the screen's own control. It does not re-create `e5-goal-form`'s
 * coverage: the field validation, the date controls, the zone wording and the
 * stored request shape are proven there and are reused, not repeated. Nothing
 * here is a styling judgement, a screenshot, or a fix.
 */

const OWNER = { authorization: 'Bearer owner', 'content-type': 'application/json' };

/** Matches the callable on the functions emulator, whatever the host prefix. */
const CREATE_GOAL = '**/wsfCreateGoal';

/**
 * The sentence the form shows when the outcome is lost. It is a CONSTANT here,
 * and asserted by equality in both the abort-before-send and the
 * commit-with-lost-response case, because the finding is precisely that the
 * two produce the SAME sentence while leaving DIFFERENT server state. Allowing
 * a set of acceptable messages would have hidden that.
 */
const LOST_MESSAGE = 'Something went wrong. Please try again.';

type Champion = { email: string; password: string; uid: string };

type StoredGoal = { goalId: string; title: string; ownerUid: string };

/** Every goal the server actually holds for this community, by query. */
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
    .filter((row) => row.document)
    .map((row) => ({
      goalId: row.document!.name!.split('/').pop()!,
      title: row.document!.fields?.title?.stringValue ?? '',
      ownerUid: row.document!.fields?.ownerUid?.stringValue ?? '',
    }));
}

async function newVerified(prefix: string): Promise<Champion> {
  const email = `wsf-w7gc-${prefix}-${stampId()}@example.com`;
  const password = `Aa1!${randomBytes(6).toString('hex')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, `W7 ${prefix}`);
  return { email, password, uid };
}

/** One community: a founding Champion who may create, and a member who may not. */
async function seedPair(): Promise<{ champion: Champion; member: Champion; groupId: string }> {
  const champion = await newVerified('champ');
  const member = await newVerified('member');
  const groupId = `w7gc-${stampId()}`;
  await seedCommunity({
    groupId,
    displayName: 'W7 contract community',
    joinPolicy: 'private',
    groupType: 'custom',
    members: [
      { uid: champion.uid, role: 'foundingChampion' },
      { uid: member.uid, role: 'member' },
    ],
  });
  return { champion, member, groupId };
}

/**
 * The form, reached the way the packet pins it: the route the community page
 * opens, carrying the group it already knows. Used directly for the member,
 * who is never offered the control but whose refusal is the server's to give.
 */
async function openForm(page: Page, groupId: string): Promise<void> {
  await page.goto(`/goals/new?groupId=${groupId}`);
  await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 25_000 });
  expect(await page.getByTestId('wsf-new-goal-form').getAttribute('data-group-id')).toBe(groupId);
}

/** Fills a valid goal and leaves the form one press from sending. */
async function fillGoal(page: Page, title: string): Promise<void> {
  await page.getByTestId('wsf-new-goal-title').fill(title);
  await page.getByTestId('wsf-new-goal-unit').fill('squats');
  await page.getByTestId('wsf-new-goal-target').fill('500');
  await expect(page.getByTestId('wsf-new-goal-definition')).toHaveText('500 squats');
}

/**
 * Counts what the client tried to send AND what the callable was actually
 * given. The two differ in exactly the cases this file exists for, and
 * conflating them is how a lost response gets mistaken for a lost request.
 */
type Counters = { attempted: number; delivered: number };

function countAttempts(page: Page): Counters {
  const counters: Counters = { attempted: 0, delivered: 0 };
  page.on('request', (req) => {
    // POST only: a CORS preflight is the browser asking permission, not the
    // Champion asking for a goal, and counting it would inflate every number
    // in this file.
    if (req.url().includes('/wsfCreateGoal') && req.method() === 'POST') counters.attempted += 1;
  });
  return counters;
}

/** True for the one request that can actually create a goal. */
function isCreateCall(route: Route): boolean {
  return route.request().method() === 'POST';
}

test.describe('W7 — /goals/new creation-result and recovery contract', () => {
  /**
   * THE BASELINE. Everything below is read against this: one press, one
   * delivered request, exactly one goal, and a confirmation that names the id
   * the server minted.
   */
  test('normal success: one press, one delivered request, exactly one goal', async ({ page }) => {
    test.setTimeout(180_000);
    const { champion, groupId } = await seedPair();
    const counters = countAttempts(page);
    await page.route(CREATE_GOAL, async (route: Route) => {
      if (!isCreateCall(route)) return route.continue();
      counters.delivered += 1;
      await route.continue();
    });

    await signInVia(page, champion.email, champion.password);
    await openForm(page, groupId);
    expect(await goalsFor(groupId), 'the community started with a goal').toHaveLength(0);

    await fillGoal(page, 'W7 baseline goal');
    await page.getByTestId('wsf-new-goal-submit').click();

    const created = page.getByTestId('wsf-new-goal-created');
    await expect(created).toBeVisible({ timeout: 25_000 });
    const shownId = (await created.getAttribute('data-goal-id')) ?? '';

    const stored = await goalsFor(groupId);
    expect(stored, 'exactly one goal exists after one successful press').toHaveLength(1);
    expect(stored[0]!.goalId, 'the confirmed id is the id the server stored').toBe(shownId);
    expect(stored[0]!.title).toBe('W7 baseline goal');
    expect(stored[0]!.ownerUid).toBe(champion.uid);
    expect(counters).toEqual({ attempted: 1, delivered: 1 });
  });

  /**
   * A KNOWN REFUSAL, on the genuine callable path. An ordinary member reaches
   * the form by its route — the client has no Champion gate, the server does —
   * and `wsfCreateGoal` refuses inside its transaction with
   * `permission-denied`. The refusal must leave the server exactly as it was:
   * the transaction throws before `tx.set` can commit.
   */
  test('known refusal: the member is told plainly and nothing is created', async ({ page }) => {
    test.setTimeout(180_000);
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
      'Only a Champion of this community can start a goal here.',
      { timeout: 25_000 },
    );
    // The refusal is a refusal: no confirmation, and the control comes back.
    await expect(page.getByTestId('wsf-new-goal-created')).toHaveCount(0);
    await expect(page.getByTestId('wsf-new-goal-submit')).toBeEnabled();

    expect(await goalsFor(groupId), 'a refused submit created a goal').toHaveLength(0);
    expect(counters).toEqual({ attempted: 1, delivered: 1 });
  });

  /**
   * ABORT BEFORE SEND — the first of the two cases that look alike.
   *
   * The request never leaves the browser, so the server is never asked and
   * NOTHING is created. Recorded here on its own so the screen it produces can
   * be compared, in the next test, against the screen produced when a goal
   * WAS created.
   */
  test('abort before send: nothing reaches the server and nothing is created', async ({ page }) => {
    test.setTimeout(180_000);
    const { champion, groupId } = await seedPair();
    const counters = countAttempts(page);
    await page.route(CREATE_GOAL, async (route: Route) => {
      if (!isCreateCall(route)) return route.continue();
      // Never fetched: the callable is not asked.
      await route.abort('failed');
    });

    await signInVia(page, champion.email, champion.password);
    await openForm(page, groupId);
    await fillGoal(page, 'W7 never sent');
    await page.getByTestId('wsf-new-goal-submit').click();

    await expect(page.getByTestId('wsf-new-goal-error')).toHaveText(LOST_MESSAGE, {
      timeout: 25_000,
    });
    await expect(page.getByTestId('wsf-new-goal-created')).toHaveCount(0);

    expect(await goalsFor(groupId), 'a request that never left created a goal').toHaveLength(0);
    expect(counters.attempted, 'the client issued exactly one attempt').toBe(1);
    expect(counters.delivered, 'the callable was asked despite the abort').toBe(0);
  });

  /**
   * COMMIT WITH LOST RESPONSE — the second case, and the one the contract
   * turns on.
   *
   * The request IS delivered, the callable DOES commit, and the response is
   * destroyed on the way back. The server's own reply is captured before it is
   * dropped, so this test can state — not infer — that the goal was created.
   *
   * The Champion is then shown a screen, and what that screen can and cannot
   * tell them is recorded exactly.
   */
  test('commit with lost response: the goal exists, and the screen cannot say so', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const { champion, groupId } = await seedPair();
    const counters = countAttempts(page);
    const serverReplies: { status: number; body: string }[] = [];

    await page.route(CREATE_GOAL, async (route: Route) => {
      if (!isCreateCall(route)) return route.continue();
      counters.delivered += 1;
      // Actually ask the callable. This is the genuine path: the server runs
      // its transaction and commits.
      const response = await route.fetch();
      serverReplies.push({ status: response.status(), body: await response.text() });
      // ...and then the reply never reaches the page.
      await route.abort('failed');
    });

    await signInVia(page, champion.email, champion.password);
    await openForm(page, groupId);
    await fillGoal(page, 'W7 committed but unconfirmed');
    await page.getByTestId('wsf-new-goal-submit').click();

    // THE SAME SENTENCE, WORD FOR WORD, as the abort-before-send case above —
    // and this time a goal exists.
    await expect(page.getByTestId('wsf-new-goal-error')).toHaveText(LOST_MESSAGE, {
      timeout: 25_000,
    });
    await expect(page.getByTestId('wsf-new-goal-created')).toHaveCount(0);

    // What the server actually said, before the reply was destroyed.
    expect(serverReplies, 'the callable was asked exactly once').toHaveLength(1);
    expect(serverReplies[0]!.status, 'the callable did not return a success').toBe(200);
    expect(serverReplies[0]!.body).toContain('goalId');

    // And what it actually did.
    const stored = await goalsFor(groupId);
    expect(stored, 'the committed goal is missing from the server').toHaveLength(1);
    expect(stored[0]!.title).toBe('W7 committed but unconfirmed');
    expect(serverReplies[0]!.body, 'the reply named a different goal').toContain(stored[0]!.goalId);
    expect(counters).toEqual({ attempted: 1, delivered: 1 });

    // THE FINDING, ASSERTED RATHER THAN NARRATED: the goal that exists is not
    // reachable from this screen. The confirmation, and with it the only place
    // the new goal's id is ever shown, is not there; the id is nowhere on the
    // page; and nothing on the page links to the goal that was in fact made.
    await expect(page.getByTestId('wsf-new-goal-created')).toHaveCount(0);
    await expect(page.getByTestId('wsf-new-goal-form')).not.toContainText(stored[0]!.goalId);
    expect(
      await page.locator(`[href*="${stored[0]!.goalId}"]`).count(),
      'the screen does link to the created goal after all',
    ).toBe(0);

    // ...BUT THE ANSWER DOES EXIST ONE SCREEN AWAY. Whether the Champion is
    // actually stranded is a product question, so it is read from the product:
    // the community page they came from is asked whether the goal that was in
    // fact created is findable. This is what makes the finding cheap to fix —
    // the information is there, the screen that lost it just never points at
    // it.
    await page.goto(`/community/${groupId}`);
    await expect(
      page.locator(`[href*="${stored[0]!.goalId}"]`).first(),
      'the community page cannot show the goal that was created either',
    ).toBeAttached({ timeout: 25_000 });

    // And going back does not create anything: still exactly one goal.
    expect(await goalsFor(groupId)).toHaveLength(1);
  });

  /**
   * THE CONSEQUENCE OF THE TWO ABOVE BEING THE SAME SCREEN.
   *
   * A Champion who was told "Something went wrong. Please try again." does the
   * one thing the sentence asks for. `wsfCreateGoal` takes no attempt key, so
   * the retry is a second creation, and the community now holds two goals with
   * the same name and no way for the screen to have known better.
   *
   * Both goals here are created by pressing the screen's own control. Nothing
   * is written behind the interface to manufacture this.
   */
  test('retry after a lost response: the press the error asks for creates a second goal', async ({
    page,
  }) => {
    test.setTimeout(200_000);
    const { champion, groupId } = await seedPair();
    const counters = countAttempts(page);
    let dropNext = true;

    await page.route(CREATE_GOAL, async (route: Route) => {
      if (!isCreateCall(route)) return route.continue();
      counters.delivered += 1;
      if (!dropNext) {
        await route.continue();
        return;
      }
      // The first press commits and loses its reply. Every later press is an
      // ordinary, entirely successful submit.
      await route.fetch();
      dropNext = false;
      await route.abort('failed');
    });

    await signInVia(page, champion.email, champion.password);
    await openForm(page, groupId);
    await fillGoal(page, 'W7 retried goal');

    await page.getByTestId('wsf-new-goal-submit').click();
    await expect(page.getByTestId('wsf-new-goal-error')).toBeVisible({ timeout: 25_000 });
    expect(await goalsFor(groupId), 'the first press did not commit').toHaveLength(1);

    // The Champion does exactly what the message asks.
    await expect(page.getByTestId('wsf-new-goal-submit')).toBeEnabled();
    await page.getByTestId('wsf-new-goal-submit').click();
    await expect(page.getByTestId('wsf-new-goal-created')).toBeVisible({ timeout: 25_000 });

    const stored = await goalsFor(groupId);
    expect(stored, 'the retry did not produce a second goal').toHaveLength(2);
    expect(stored.map((g) => g.title)).toEqual(['W7 retried goal', 'W7 retried goal']);
    expect(new Set(stored.map((g) => g.goalId)).size, 'the two rows are one goal').toBe(2);
    // The confirmation names only the second of the two.
    const shownId = await page.getByTestId('wsf-new-goal-created').getAttribute('data-goal-id');
    expect(stored.map((g) => g.goalId)).toContain(shownId);
    expect(counters).toEqual({ attempted: 2, delivered: 2 });
  });

  /**
   * RAPID REPEATED SUBMIT, measured while a real request is genuinely in
   * flight rather than in a gap the harness invented: the reply is held open
   * for two seconds and the control is pressed again inside that window.
   *
   * Only what the interface permits is attempted. The press is a real press
   * with a real timeout, and whether it lands is the measurement.
   */
  test('rapid repeated submit: the second press inside the window, and what reached the server', async ({
    page,
  }) => {
    test.setTimeout(200_000);
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

    // In flight: the control says so and refuses to be pressed again.
    await expect(submit).toHaveText('Starting…', { timeout: 5_000 });
    await expect(submit).toBeDisabled();
    let secondPressLanded = true;
    try {
      await submit.click({ timeout: 1_500 });
    } catch {
      secondPressLanded = false;
    }
    expect(secondPressLanded, 'the disabled control accepted a second press').toBe(false);

    await expect(page.getByTestId('wsf-new-goal-created')).toBeVisible({ timeout: 25_000 });
    const stored = await goalsFor(groupId);
    expect(stored, 'a second goal was created inside the in-flight window').toHaveLength(1);
    expect(counters).toEqual({ attempted: 1, delivered: 1 });
  });

  /**
   * CONFIRMED SUCCESS, THEN THE CONFIRMATION IS LOST.
   *
   * The goal really is created and the Champion really does see "Your goal is
   * live" — and then the page is reloaded, which is the cheapest real version
   * of losing that screen (a closed tab, a dropped phone, a back press). The
   * confirmation lives in component state, so a reload takes it and the goal
   * id with it.
   *
   * The question the packet asks is whether the Champion is stranded, and the
   * answer is read from the product, not assumed: the community page they came
   * from is checked for whether the goal they made is findable again.
   */
  test('confirmed success then a lost confirmation: what is still reachable', async ({ page }) => {
    test.setTimeout(200_000);
    const { champion, groupId } = await seedPair();

    await signInVia(page, champion.email, champion.password);
    await openForm(page, groupId);
    await fillGoal(page, 'W7 confirmed then lost');
    await page.getByTestId('wsf-new-goal-submit').click();

    const created = page.getByTestId('wsf-new-goal-created');
    await expect(created).toBeVisible({ timeout: 25_000 });
    const goalId = (await created.getAttribute('data-goal-id')) ?? '';
    expect(goalId).toMatch(/^\S+$/);
    await expect(page.getByTestId('wsf-new-goal-goto-contribute')).toHaveAttribute(
      'href',
      `/contribute/${goalId}`,
    );

    // The confirmation is lost.
    await page.reload();
    await expect(page.getByTestId('wsf-new-goal-form')).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId('wsf-new-goal-created')).toHaveCount(0);
    expect(
      await page.locator(`[href*="${goalId}"]`).count(),
      'the reloaded form still links to the goal',
    ).toBe(0);
    // The form comes back empty, so a Champion who presses on from here starts
    // a SECOND goal rather than returning to the one they made.
    await expect(page.getByTestId('wsf-new-goal-title')).toHaveValue('');

    // Exactly one goal exists throughout: losing the screen created nothing
    // and destroyed nothing.
    const stored = await goalsFor(groupId);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.goalId).toBe(goalId);

    // THE RECOVERY PATH, READ FROM THE PRODUCT. The community page is the
    // screen the Champion came from and the one they would go back to.
    await page.goto(`/community/${groupId}`);
    await expect(
      page.locator(`[href*="${goalId}"]`).first(),
      'the community page offers no way back to the goal that was just created',
    ).toBeAttached({ timeout: 25_000 });
  });
});
