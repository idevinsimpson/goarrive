import { randomBytes } from 'node:crypto';

import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

/**
 * W7 — INDEPENDENT VERIFICATION of W2's responsive public display (PR #435).
 *
 * Product under test: `1fd669f231105f016f4b0e03903f7faf71eec31c` — the
 * successor of `223f880`, verified by blob hash against the candidate before
 * any assertion here was trusted, and exercised through a local merge that is
 * never pushed.
 *
 * This is a FOCUSED check of what this change can break, not another full-app
 * audit and not a re-run of W2's own `sprint-w2-display-responsive-capture`.
 * It captures no frames and rebaselines nothing: on this surface assertions
 * prove behaviour, and the Director owns pixel acceptance.
 *
 * Two groups, and the split is the method:
 *
 *   PRESERVED — phone and booth, asserted with values that exist on BOTH the
 *   candidate and the unmodified base `a193b43`. These tests are meant to pass
 *   on either head; that is exactly what makes them evidence that 390×844,
 *   1280×800 and 1440×900 did not move. The packet is explicit that no
 *   instrument exists on the generic states, so mark width alone is not
 *   evidence there — the generic block is MEASURED instead: its canvas
 *   alignment, its box, its wordmark and its headline size.
 *
 *   NEW — portrait 800×1280 and collective 1920×1080. These cannot pass on the
 *   base, where both viewports are phones, so their passing is a measurement
 *   of the change rather than of the harness.
 *
 * Every failure mode below is driven at the genuine callable boundary
 * (`wsfGoalPulse`, `wsfGoalRecentAdditions`) with synthetic fixtures. No
 * product file is touched.
 */

const FIRESTORE_EMULATOR = 'http://127.0.0.1:8080';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';
const PROJECT_ID = 'demo-wsf-local';

const PHONE = { width: 390, height: 844 };
const PORTRAIT = { width: 800, height: 1280 };
const BOOTH_1280 = { width: 1280, height: 800 };
const BOOTH_1440 = { width: 1440, height: 900 };
const COLLECTIVE = { width: 1920, height: 1080 };

/**
 * The rendered width of the centred generic block at BOTH booth viewports.
 * Content-sized under a 720 cap, so it does not vary with the extra 160px of
 * glass between 1280 and 1440 — and it must not vary between heads either.
 */
const GENERIC_BLOCK_WIDTH = 572;

/** The fixture goal, and the three lines every tier must agree on. */
const TOTAL_LINE = '241 of 500 squats';
const PERCENT_LINE = '48.2% complete';
const STATUS_LINE = '259 to go';

function callableUrl(name: string): string {
  return `${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`;
}

function tsField(d: Date): { timestampValue: string } {
  return { timestampValue: d.toISOString() };
}

async function firestoreWrite(docPath: string, fields: Record<string, unknown>): Promise<void> {
  const url = `${FIRESTORE_EMULATOR}/v1/projects/${PROJECT_ID}/databases/(default)/documents/${docPath}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`emulator write ${docPath} failed: ${res.status} ${await res.text()}`);
}

type Fixture = {
  goalId: string;
  groupId: string;
  championUid: string;
  memberUid: string;
  joinCode: string;
  /** The member's personal credit. It exists so a leak would have something to leak. */
  personalCredit: string;
};

async function seedDisplayGoal(opts: {
  tag: string;
  communityName?: string;
  goalTitle?: string;
  authorized?: boolean;
}): Promise<Fixture> {
  const stamp = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
  const groupId = `w7d-${opts.tag}-${stamp}`;
  const goalId = `w7d-goal-${opts.tag}-${stamp}`;
  const championUid = `w7d-champ-${stamp}`;
  const memberUid = `w7d-member-${stamp}`;
  const joinCode = `JOIN${randomBytes(4).toString('hex')}`;
  const personalCredit = '7331';
  const now = new Date();

  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: opts.communityName ?? 'Maple Street Movers' },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: joinCode },
    createdByUserId: { stringValue: championUid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });
  for (const [uid, role] of [
    [championUid, 'foundingChampion'],
    [memberUid, 'member'],
  ] as const) {
    await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
      groupId: { stringValue: groupId },
      userId: { stringValue: uid },
      role: { stringValue: role },
      membershipStatus: { stringValue: 'active' },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }

  const fields: Record<string, unknown> = {
    ownerUid: { stringValue: championUid },
    communityGroupId: { stringValue: groupId },
    title: { stringValue: opts.goalTitle ?? 'Squats together this week' },
    target: { integerValue: '500' },
    unit: { stringValue: 'squats' },
    status: { stringValue: 'active' },
    startsAt: tsField(new Date(now.getTime() - 11 * 24 * 60 * 60_000)),
    endsAt: tsField(new Date(now.getTime() + 3 * 24 * 60 * 60_000)),
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  };
  if (opts.authorized !== false) fields.aggregateDisplayAuthorized = { booleanValue: true };
  await firestoreWrite(`wsfGoals/${goalId}`, fields);

  // 241 across the ten counter shards, the way real contributions land.
  const per = Math.floor(241 / 10);
  let rest = 241 - per * 10;
  for (let i = 0; i < 10; i += 1) {
    const count = per + (rest > 0 ? 1 : 0);
    if (rest > 0) rest -= 1;
    if (count === 0) continue;
    await firestoreWrite(`wsfGoalCounters/${goalId}/shards/${i}`, {
      count: { integerValue: String(count) },
    });
  }
  await firestoreWrite(`wsfGoalMemberTotals/${goalId}_${memberUid}`, {
    goalId: { stringValue: goalId },
    userId: { stringValue: memberUid },
    total: { integerValue: personalCredit },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });

  return { goalId, groupId, championUid, memberUid, joinCode, personalCredit };
}

/** A cold navigation at the viewport under test, never a resize of a loaded page. */
async function openAt(
  page: Page,
  size: { width: number; height: number },
  path: string,
): Promise<void> {
  await page.setViewportSize(size);
  await page.goto(path);
}

/** The confirmed aggregate: the three lines, identical at every tier. */
async function expectConfirmedAggregate(page: Page): Promise<void> {
  await expect(page.getByTestId('wsf-display-screen')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByTestId('wsf-display-total-line')).toHaveText(TOTAL_LINE);
  await expect(page.getByTestId('wsf-display-percent')).toHaveText(PERCENT_LINE);
  await expect(page.getByTestId('wsf-display-remaining')).toHaveText(STATUS_LINE);
  await expect(page.getByTestId('wsf-display-we')).toBeVisible();
}

/** The rendered width of the Living WE, rounded — the instrument, measured. */
async function markWidth(page: Page): Promise<number> {
  const box = await page.getByTestId('wsf-display-we').boundingBox();
  if (!box) throw new Error('the Living WE has no box');
  return Math.round(box.width);
}

/** A computed CSS value, read from the DOM rather than from the stylesheet source. */
async function computed(target: Locator, property: string): Promise<string> {
  return target.evaluate(
    (el, prop) => window.getComputedStyle(el as HTMLElement).getPropertyValue(prop),
    property,
  );
}

/**
 * The generic states have no instrument, so THIS is what gets measured there:
 * the block that holds the wordmark and the sentence.
 */
async function genericBlockOf(root: Locator): Promise<Locator> {
  return root.locator('> *').first();
}

/**
 * EVERY NEW-TIER TEST SAYS WHICH COMPOSITION IT RAN IN.
 *
 * Without this, most of the failure-state tests below pass on the unmodified
 * base as well — not because the base has these tiers, but because at 800x1280
 * and 1920x1080 it renders the PHONE composition, in which those invariants
 * already held. Asserting the tier is what makes each test a measurement of
 * this change rather than of behaviour that predates it.
 */
async function expectTier(root: Locator, tier: 'portrait' | 'collective'): Promise<void> {
  await expect(root, `the screen did not resolve to the ${tier} tier`).toHaveAttribute(
    'data-tier',
    tier,
  );
}

/** Nothing private has reached a surface anyone can walk past. */
async function expectPublicSafe(page: Page, fx: Fixture): Promise<void> {
  const html = await page.content();
  for (const secret of [
    fx.memberUid,
    fx.championUid,
    fx.joinCode,
    fx.personalCredit,
    fx.groupId,
    'familyFriends',
    'private',
  ]) {
    expect(html, `the public display leaked ${secret}`).not.toContain(secret);
  }
  // No QR, and in particular no DEAD QR control: a placeholder promising a
  // capability this route does not have would be worse than the absence.
  expect(await page.locator('[data-testid*="qr" i]').count(), 'a QR control is on screen').toBe(0);
  const text = await page.locator('body').innerText();
  expect(text, 'the display offers a scan/QR affordance it cannot honour').not.toMatch(
    /scan (me|to join|this)|qr code/i,
  );
}

/** Five recent additions, long enough to stress the column, as the callable would send them. */
function fiveAdditions(unit: string): { amount: number; unit: string; at: string }[] {
  const now = Date.now();
  return [1, 2, 3, 4, 5].map((n) => ({
    amount: n * 111,
    unit,
    at: new Date(now - n * 3 * 60_000).toISOString(),
  }));
}

async function fulfillRecent(
  route: Route,
  additions: { amount: number; unit: string; at: string }[],
): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ result: { additions } }),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// PRESERVED — must hold on the candidate AND on the unmodified base.
// ═══════════════════════════════════════════════════════════════════════════

test.describe('preserved: the phone and booth compositions did not move', () => {
  /**
   * The instrument at the three accepted viewports, measured in the DOM. These
   * are the shipped expressions' own outputs — `min(320, w − 40 − 44)` on a
   * phone and `min(640, round(0.42w))` at booth — so a candidate that quietly
   * re-scaled either would be caught here rather than in a screenshot.
   */
  test('the mark is unchanged at 390x844, 1280x800 and 1440x900', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seedDisplayGoal({ tag: 'preserve' });

    for (const [size, expectedMark, expectedLayout] of [
      [PHONE, 306, 'phone'],
      [BOOTH_1280, 538, 'wide'],
      [BOOTH_1440, 605, 'wide'],
    ] as const) {
      await openAt(page, size, `/display/${fx.goalId}`);
      await expectConfirmedAggregate(page);
      await expect(
        page.getByTestId('wsf-display-screen'),
        `${size.width}x${size.height} changed composition`,
      ).toHaveAttribute('data-layout', expectedLayout);
      expect(await markWidth(page), `the mark moved at ${size.width}x${size.height}`).toBe(
        expectedMark,
      );
    }
  });

  /**
   * THE CORRECTED GENERIC PLACEMENT, at the two viewports the packet names.
   *
   * There is no instrument on a refusal, so the block itself is the
   * measurement: the canvas must still be the booth's `space-between` page and
   * NOT the centred canvas the collective tier got; the block must still cap
   * at 720; the wordmark must still be 44 high and the sentence still 56px.
   *
   * Every number here is what the base renders too, which is the whole point —
   * this test passing on both heads is the evidence that 1280x800 and
   * 1440x900 were preserved.
   */
  test('the generic block is unchanged at 1280x800 and 1440x900', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seedDisplayGoal({ tag: 'generic', authorized: false });

    for (const size of [BOOTH_1280, BOOTH_1440]) {
      await openAt(page, size, `/display/${fx.goalId}`);
      const root = page.getByTestId('wsf-display-not-available');
      await expect(root).toBeVisible({ timeout: 25_000 });

      expect(
        await computed(root, 'justify-content'),
        `the booth refusal canvas was re-aligned at ${size.width}x${size.height}`,
      ).toBe('space-between');

      const block = await genericBlockOf(root);
      expect(
        await computed(block, 'max-width'),
        `the booth generic block was re-capped at ${size.width}x${size.height}`,
      ).toBe('720px');
      /*
        THE CAP IS NOT THE WIDTH. `maxWidth: 720` bounds a block that is
        content-sized and centred, so the rendered box is narrower than the
        cap — 572px for this sentence at this size. Both are asserted: the cap
        because that is the value the change touches, and the rendered width
        because that is what a viewer actually sees, and it is the number that
        has to match the base head.
      */
      const box = await block.boundingBox();
      expect(box, 'the generic block has no box').not.toBeNull();
      expect(
        Math.round(box!.width),
        `the booth generic block was re-sized at ${size.width}`,
      ).toBe(GENERIC_BLOCK_WIDTH);
      expect(
        Math.round(box!.width),
        'the generic block rendered wider than its own cap',
      ).toBeLessThanOrEqual(720);

      const wordmark = await page.getByTestId('wsf-display-wordmark').boundingBox();
      expect(wordmark, 'the wordmark has no box').not.toBeNull();
      expect(Math.round(wordmark!.height), 'the booth wordmark was resized').toBe(44);

      expect(
        await computed(root.getByText('Nothing to show here'), 'font-size'),
        'the booth refusal headline was resized',
      ).toBe('56px');

      await expectPublicSafe(page, fx);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NEW — portrait and collective. These cannot pass on the base.
// ═══════════════════════════════════════════════════════════════════════════

test.describe('new tiers: portrait 800x1280 and collective 1920x1080', () => {
  /**
   * The confirmed numbers are the same numbers in both rooms. The composition
   * changes; the content does not. The mark is measured at each, because a
   * tier that resolved but did not re-scale would still be a failure of the
   * thing this change exists to do.
   */
  test('both tiers resolve and show the same confirmed totals, ratio and status', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const fx = await seedDisplayGoal({ tag: 'tiers' });

    await openAt(page, PORTRAIT, `/display/${fx.goalId}`);
    await expectConfirmedAggregate(page);
    await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-layout', 'portrait');
    await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-tier', 'portrait');
    expect(await markWidth(page), 'the portrait mark is not the portrait size').toBe(440);
    await expect(page.getByTestId('wsf-display-community')).toHaveText('Maple Street Movers');
    await expectPublicSafe(page, fx);

    await openAt(page, COLLECTIVE, `/display/${fx.goalId}`);
    await expectConfirmedAggregate(page);
    await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-layout', 'wide');
    await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-tier', 'collective');
    expect(await markWidth(page), 'the collective mark is not the collective size').toBe(760);
    await expect(page.getByTestId('wsf-display-community')).toHaveText('Maple Street Movers');
    await expectPublicSafe(page, fx);
  });

  /**
   * A GENUINELY CONFIRMED READ, THEN THE NETWORK FAILS.
   *
   * The distinction matters: the value on screen was confirmed before the
   * failure, so it must be RETAINED and LABELLED — not dropped, and not left
   * looking current. The confirmed clock must not advance while nothing is
   * being confirmed, and the warning has to be legible at room distance, which
   * on these tiers means it is no longer the phone's 13px.
   */
  for (const [name, size, freshness] of [
    ['portrait', PORTRAIT, '22px'],
    ['collective', COLLECTIVE, '26px'],
  ] as const) {
    test(`${name}: a confirmed value survives a network failure, labelled and legible`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const fx = await seedDisplayGoal({ tag: `stale-${name}` });
      let drop = false;
      await page.route(callableUrl('wsfGoalPulse'), async (route: Route) => {
        if (drop) return route.abort('failed');
        return route.continue();
      });

      await openAt(page, size, `/display/${fx.goalId}`);
      await expectConfirmedAggregate(page);
      await expectTier(page.getByTestId('wsf-display-screen'), name);
      const confirmedBefore = await page.getByTestId('wsf-display-confirmed-at').innerText();

      drop = true;
      await expect(page.getByTestId('wsf-display-stale')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('wsf-display-stale')).toHaveText('Connection interrupted');
      await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-stale', 'true');

      // RETAINED: the confirmed figures are exactly the figures that were
      // confirmed, not a re-read and not a blank.
      await expect(page.getByTestId('wsf-display-total-line')).toHaveText(TOTAL_LINE);
      await expect(page.getByTestId('wsf-display-percent')).toHaveText(PERCENT_LINE);
      await expect(page.getByTestId('wsf-display-remaining')).toHaveText(STATUS_LINE);
      await expect(page.getByTestId('wsf-display-we')).toBeVisible();

      // LABELLED: and the clock is the old receipt, not a moving one.
      await expect(page.getByTestId('wsf-display-confirmed-at')).toContainText('Last confirmed');
      expect(
        (await page.getByTestId('wsf-display-confirmed-at').innerText()).replace(
          'Last confirmed',
          'Confirmed',
        ),
        'the confirmed time advanced while nothing was confirmed',
      ).toBe(confirmedBefore);

      // LEGIBLE: the warning is sized for this room, and both freshness lines
      // are still inside the canvas rather than pushed off the header.
      expect(await computed(page.getByTestId('wsf-display-stale'), 'font-size')).toBe(freshness);
      expect(await computed(page.getByTestId('wsf-display-confirmed-at'), 'font-size')).toBe(
        freshness,
      );
      const pill = await page.getByTestId('wsf-display-freshness').boundingBox();
      expect(pill, 'the freshness row has no box').not.toBeNull();
      expect(pill!.x, 'the freshness row starts off the left edge').toBeGreaterThanOrEqual(0);
      expect(
        pill!.x + pill!.width,
        'the freshness row runs off the right edge',
      ).toBeLessThanOrEqual(size.width);

      await expectPublicSafe(page, fx);
    });
  }

  /**
   * AN INITIAL READ FAILURE INVENTS NOTHING.
   *
   * Nothing was ever confirmed, so there is no value to retain — and the
   * screen must not manufacture one. In particular it must not draw the
   * instrument: a Living WE with no confirmed total behind it is a claim about
   * a community's progress that nobody made.
   */
  for (const [name, size] of [
    ['portrait', PORTRAIT],
    ['collective', COLLECTIVE],
  ] as const) {
    test(`${name}: an initial read failure invents no value and no instrument`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const fx = await seedDisplayGoal({ tag: `cold-${name}` });
      await page.route(callableUrl('wsfGoalPulse'), (route: Route) => route.abort('failed'));

      await openAt(page, size, `/display/${fx.goalId}`);
      const root = page.getByTestId('wsf-display-unreachable');
      await expect(root).toBeVisible({ timeout: 25_000 });
      await expectTier(root, name);

      await expect(page.getByTestId('wsf-display-we'), 'an instrument was drawn with nothing confirmed').toHaveCount(0);
      await expect(page.getByTestId('wsf-display-total-line')).toHaveCount(0);
      await expect(page.getByTestId('wsf-display-percent')).toHaveCount(0);
      await expect(page.getByTestId('wsf-display-remaining')).toHaveCount(0);
      await expect(page.getByTestId('wsf-display-confirmed-at')).toHaveCount(0);

      const text = await page.locator('body').innerText();
      expect(text, 'a figure appeared on a screen that has confirmed nothing').not.toMatch(
        /241|500|48\.2|259/,
      );
      expect(text).not.toContain('Maple Street Movers');
      expect(text).not.toContain('Squats together this week');
      await expectPublicSafe(page, fx);
    });
  }

  /**
   * AN AUTHORIZATION REFUSAL CLEARS THE CONTEXT.
   *
   * Not "hides the numbers": the community's name, the goal's title and the
   * window are context that a revoked display must not keep showing either.
   * Checked after a confirmed read, so there is something real to clear.
   */
  for (const [name, size] of [
    ['portrait', PORTRAIT],
    ['collective', COLLECTIVE],
  ] as const) {
    test(`${name}: an authorization refusal clears the context`, async ({ page }) => {
      test.setTimeout(240_000);
      const fx = await seedDisplayGoal({ tag: `revoke-${name}` });

      await openAt(page, size, `/display/${fx.goalId}`);
      await expectConfirmedAggregate(page);
      await expectTier(page.getByTestId('wsf-display-screen'), name);
      await expect(page.getByTestId('wsf-display-community')).toHaveText('Maple Street Movers');

      await firestoreWrite(`wsfGoals/${fx.goalId}`, {
        ownerUid: { stringValue: fx.championUid },
        communityGroupId: { stringValue: fx.groupId },
        title: { stringValue: 'Squats together this week' },
        target: { integerValue: '500' },
        unit: { stringValue: 'squats' },
        status: { stringValue: 'active' },
        aggregateDisplayAuthorized: { booleanValue: false },
      });

      await expect(page.getByTestId('wsf-display-not-available')).toBeVisible({ timeout: 25_000 });
      await expectTier(page.getByTestId('wsf-display-not-available'), name);
      await expect(page.getByTestId('wsf-display-we')).toHaveCount(0);
      await expect(page.getByTestId('wsf-display-total-line')).toHaveCount(0);
      await expect(page.getByTestId('wsf-display-community')).toHaveCount(0);
      await expect(page.getByTestId('wsf-display-goal-title')).toHaveCount(0);
      await expect(page.getByTestId('wsf-display-period')).toHaveCount(0);
      const text = await page.locator('body').innerText();
      expect(text, 'the refused display still shows the community').not.toContain(
        'Maple Street Movers',
      );
      expect(text, 'the refused display still shows a figure').not.toMatch(/241|48\.2|259 to go/);
      await expectPublicSafe(page, fx);
    });
  }

  /**
   * THE RECENT LIST FAILING MUST NOT TAKE THE AGGREGATE WITH IT.
   *
   * They are two different callables and two different disclosures. The recent
   * list is allowed to empty itself when it cannot be trusted — that is the
   * route's documented choice — but the confirmed aggregate came from the
   * pulse, which is still answering, and it must stay exactly where it is,
   * unstaled.
   */
  for (const [name, size] of [
    ['portrait', PORTRAIT],
    ['collective', COLLECTIVE],
  ] as const) {
    test(`${name}: a recent-addition failure does not erase the aggregate`, async ({ page }) => {
      test.setTimeout(240_000);
      const fx = await seedDisplayGoal({ tag: `recent-${name}` });
      let failRecent = false;
      await page.route(callableUrl('wsfGoalRecentAdditions'), async (route: Route) => {
        if (failRecent) return route.abort('failed');
        return fulfillRecent(route, fiveAdditions('squats'));
      });

      await openAt(page, size, `/display/${fx.goalId}`);
      await expectConfirmedAggregate(page);
      await expectTier(page.getByTestId('wsf-display-screen'), name);
      await expect(page.getByTestId('wsf-display-recent')).toBeVisible({ timeout: 25_000 });
      await expect(page.getByTestId('wsf-display-recent-line')).toHaveCount(5);

      failRecent = true;
      await expect(page.getByTestId('wsf-display-recent')).toHaveCount(0, { timeout: 30_000 });

      // The aggregate is untouched, and it is NOT marked stale: the pulse
      // never stopped answering.
      await expect(page.getByTestId('wsf-display-total-line')).toHaveText(TOTAL_LINE);
      await expect(page.getByTestId('wsf-display-percent')).toHaveText(PERCENT_LINE);
      await expect(page.getByTestId('wsf-display-remaining')).toHaveText(STATUS_LINE);
      await expect(page.getByTestId('wsf-display-we')).toBeVisible();
      await expect(page.getByTestId('wsf-display-stale')).toHaveCount(0);
      await expect(page.getByTestId('wsf-display-screen')).toHaveAttribute('data-stale', 'false');
    });
  }

  /**
   * LONG TEXT AND FIVE RECENT ADDITIONS, ON A CANVAS THAT CANNOT SCROLL.
   *
   * This is the defect W2 found in their own first cut — a taller type scale
   * pushed the recent list off a 1080 canvas — so it is the one thing on this
   * change most worth an independent measurement. Containment is asserted on
   * the LAST recent line's own box, not on the panel's, because a clipped
   * column can still report a panel that starts on screen.
   */
  for (const [name, size] of [
    ['portrait', PORTRAIT],
    ['collective', COLLECTIVE],
  ] as const) {
    test(`${name}: long text and five recent additions stay inside the canvas`, async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const fx = await seedDisplayGoal({
        tag: `long-${name}`,
        communityName: 'The Greater Riverside Neighbourhood Movement Collective',
        goalTitle: 'Squats together this week for everyone on the whole of Maple Street',
      });
      await page.route(callableUrl('wsfGoalRecentAdditions'), (route: Route) =>
        fulfillRecent(route, fiveAdditions('squats')),
      );

      await openAt(page, size, `/display/${fx.goalId}`);
      await expectConfirmedAggregate(page);
      await expectTier(page.getByTestId('wsf-display-screen'), name);
      await expect(page.getByTestId('wsf-display-community')).toHaveText(
        'The Greater Riverside Neighbourhood Movement Collective',
      );
      const lines = page.getByTestId('wsf-display-recent-line');
      await expect(lines).toHaveCount(5);

      // Every one of the five is on the glass, the fifth included.
      for (let i = 0; i < 5; i += 1) {
        const box = await lines.nth(i).boundingBox();
        expect(box, `recent line ${i + 1} has no box`).not.toBeNull();
        expect(box!.y, `recent line ${i + 1} sits above the canvas`).toBeGreaterThanOrEqual(0);
        expect(
          box!.y + box!.height,
          `recent line ${i + 1} is clipped off the bottom of a canvas that cannot scroll`,
        ).toBeLessThanOrEqual(size.height);
        expect(
          box!.x + box!.width,
          `recent line ${i + 1} runs off the right edge`,
        ).toBeLessThanOrEqual(size.width);
      }

      // The heading and the long identity are contained too, and nothing
      // introduced a scrollbar on a surface that has no way to scroll.
      for (const testId of [
        'wsf-display-recent-heading',
        'wsf-display-community',
        'wsf-display-goal-title',
        'wsf-display-total-line',
      ]) {
        const box = await page.getByTestId(testId).boundingBox();
        expect(box, `${testId} has no box`).not.toBeNull();
        expect(box!.y + box!.height, `${testId} is clipped off the canvas`).toBeLessThanOrEqual(
          size.height,
        );
        expect(box!.x + box!.width, `${testId} runs off the right edge`).toBeLessThanOrEqual(
          size.width,
        );
      }
      const overflow = await page.evaluate(() => ({
        x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
      }));
      expect(overflow.x, 'the display overflows horizontally').toBeLessThanOrEqual(0);
      expect(overflow.y, 'the display overflows vertically').toBeLessThanOrEqual(0);

      await expectPublicSafe(page, fx);
    });
  }
});
