import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { saveFrame, CAPTURE_FRAMES } from './helpers/capture';
import {
  AUTH_EMULATOR,
  PROJECT_ID,
  firestoreRead,
  firestoreWrite,
  seedCommunity,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';

/**
 * CORRECTED BELOW TARGET — the one lifecycle state North Star Board 09 could
 * not show.
 *
 * Board 09's lock (PR #365, `5771469193`) names it exactly: "an authoritative
 * later correction may move the current total below target even when historical
 * reachedAt exists: current UI shows current phase/status (`460 of 500`, `92%`,
 * `40 to go`) and MUST NOT show `Reached on …` as if it still described the
 * present state."
 *
 * No capture of it existed on any surface, so the board stated the rule and
 * drew nothing. The Director's pixel review (`5785588557`) passed the layout and
 * held state coverage PARTIAL for this one gap: "the board's main lifecycle
 * contract needs a visible specimen, not only a text promise." This spec
 * produces that specimen.
 *
 * WHAT MAKES IT EVIDENCE RATHER THAN A PICTURE OF AN EMPTY SCREEN.
 *
 *   1. The goal REACHES ITS TARGET FOR REAL. Nothing seeds `reachedAt`. A real
 *      `wsfContribute` call crosses the target and the SERVER stamps the event,
 *      which is the only way the stamp here is a historical fact rather than a
 *      fixture field. The reached state is asserted and photographed before
 *      anything is corrected.
 *
 *   2. The correction is AUTHORITATIVE. It is a real `wsfAdjustGoal` call by
 *      the community's own foundingChampion, with a reason, producing the same
 *      audited row any other correction does. No shard is hand-edited.
 *
 *   3. The STAMP IS PROVED TO SURVIVE. After the correction the spec reads
 *      `wsfGoals/{goalId}` straight from Firestore and asserts `reachedAt` is
 *      STILL THERE. Without that, a missing date line would be evidence of
 *      deleted data rather than of a page reporting the present tense — the
 *      opposite of the rule.
 *
 *   4. A ZERO IS NOT A PASS. Every post-correction assertion names the exact
 *      non-zero total and percent (`460 of 500 squats`, `92% complete`,
 *      `40 to go`). A stale or failed read renders 0% or an error, and each of
 *      those would fail these assertions rather than slip through as "no
 *      reached treatment".
 *
 *   5. THE POSITIVE CASE IS PRESERVED, and on the same screens. A second goal
 *      — genuinely reached, closed, never corrected — keeps its `Reached`
 *      result in Home's History and its `REACHED` badge and full mark on
 *      Progress. So the frames show a RULE, by contrast, rather than a fixture
 *      with all reached treatment removed.
 *
 * WRITES ARE GATED, ASSERTIONS ARE NOT. The frames are written only under
 * `WSF_CAPTURE_FRAMES=1`, through `helpers/capture`. The checks run on every
 * ordinary pass, because they cover a regression the build has had once before:
 * `app/activity.tsx` records that "a goal corrected down to 380 of 500 still
 * wore REACHED, and still drew the celebratory Living WE, because of something
 * that had been true a week earlier." Gating the whole file would have made the
 * guard against that depend on someone asking for pictures.
 *
 * Product, functions, config and shared producers are untouched. Every account,
 * community and number here is synthetic and local to the emulator.
 */

const OUT = path.resolve(
  __dirname,
  '../../../docs/design-target/review/lifecycle-corrected-current'
);

const PHONE = { width: 390, height: 844 };
const DAY = 24 * 60 * 60_000;

const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001';

/* The fixture, fixed so every frame and every assertion names the same run. */
const COMMUNITY = 'Smyrna Strong';
const OPEN_TITLE = '500 Squats by Friday';
const OPEN_TARGET = 500;
const OPEN_UNIT = 'squats';
/** Past the target, by a margin the status line has to print. */
const CONTRIBUTED = 520;
/** The correction, chosen so the result is the lock's own example: 460 of 500. */
const CORRECTION = -60;
const CORRECTED_TOTAL = CONTRIBUTED + CORRECTION;

const CLOSED_TITLE = 'August push-ups';
const CLOSED_TARGET = 500;
const CLOSED_TOTAL = 515;
const CLOSED_UNIT = 'push-ups';
const CLOSED_OWN = 120;

function frame(name: string): string {
  mkdirSync(OUT, { recursive: true });
  return path.join(OUT, name);
}

/**
 * An ID token for the emulator's own account, which is what the app holds
 * after signing in. The callables below are therefore reached the same way the
 * product reaches them: as this member, with this member's authority.
 */
async function idTokenFor(email: string, password: string): Promise<string> {
  const res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  if (!res.ok) throw new Error(`emulator signIn failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { idToken?: string };
  if (!body.idToken) throw new Error('emulator signIn returned no idToken');
  return body.idToken;
}

/** One real callable invocation against the functions emulator. */
async function callable<T>(name: string, token: string, data: unknown): Promise<T> {
  const res = await fetch(`${FUNCTIONS_EMULATOR}/${PROJECT_ID}/us-central1/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  const body = (await res.json()) as { result?: T; error?: unknown };
  if (!res.ok || body.error) {
    throw new Error(`${name} failed: ${res.status} ${JSON.stringify(body)}`);
  }
  return body.result as T;
}

type SeedGoal = {
  goalId: string;
  groupId: string;
  ownerUid: string;
  title: string;
  target: number;
  unit: string;
  /** Starting total. The open goal starts at zero and is moved by the product. */
  total: number;
  status: 'active' | 'closed';
  startsAt: Date;
  endsAt: Date;
  closedAt?: Date;
  /** Seeded only for the untouched control; the corrected goal earns its own. */
  reachedAt?: Date;
  ownCredit?: number;
  repeatPolicy?: 'once' | 'multiple';
};

async function seedGoal(g: SeedGoal): Promise<void> {
  const now = new Date();
  await firestoreWrite(`wsfGoals/${g.goalId}`, {
    ownerUid: { stringValue: g.ownerUid },
    communityGroupId: { stringValue: g.groupId },
    title: { stringValue: g.title },
    target: { integerValue: String(g.target) },
    unit: { stringValue: g.unit },
    status: { stringValue: g.status },
    startsAt: tsField(g.startsAt),
    endsAt: tsField(g.endsAt),
    ...(g.closedAt ? { closedAt: tsField(g.closedAt) } : {}),
    ...(g.reachedAt ? { reachedAt: tsField(g.reachedAt) } : {}),
    repeatPolicy: { stringValue: g.repeatPolicy ?? 'multiple' },
    timezone: { stringValue: 'America/New_York' },
    createdAt: tsField(g.startsAt),
    updatedAt: tsField(now),
  });
  if (g.total > 0) await seedShards(g.goalId, g.total);
  if (g.ownCredit != null) {
    await firestoreWrite(`wsfGoalMemberTotals/${g.goalId}_${g.ownerUid}`, {
      goalId: { stringValue: g.goalId },
      userId: { stringValue: g.ownerUid },
      total: { integerValue: String(g.ownCredit) },
      createdAt: tsField(now),
      updatedAt: tsField(now),
    });
  }
}

/** The confirmed total, summed from the ten counter shards the server writes. */
async function shardTotal(goalId: string): Promise<number> {
  const url =
    `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents/` +
    `wsfGoalCounters/${goalId}/shards`;
  const res = await fetch(url, { headers: { authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`shard read failed: ${res.status}`);
  const body = (await res.json()) as {
    documents?: Array<{ fields?: { count?: { integerValue?: string } } }>;
  };
  return (body.documents ?? []).reduce(
    (sum, d) => sum + Number(d.fields?.count?.integerValue ?? 0),
    0
  );
}

async function openHome(page: Page, groupId: string): Promise<void> {
  await page.goto(`/community/${groupId}`);
  await expect(page.getByTestId('wsf-community-name')).toHaveText(COMMUNITY, { timeout: 40_000 });
}

async function settled(page: Page, goalId: string): Promise<void> {
  await expect(page.getByTestId(`wsf-community-goal-percent-${goalId}`)).toBeVisible({
    timeout: 30_000,
  });
  // The wordmark and the mark's own image: a beat, so a frame is the settled screen.
  await page.waitForTimeout(900);
}

test.describe('Corrected Below Target · the current total decides, not the stamp', () => {
  test.use({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

  test('a goal that really reached its target, then an authoritative correction below it', async ({
    page,
  }) => {
    test.setTimeout(300_000);

    // ── the fixture: one Champion, one community, two goals ──────────────────
    const stamp = stampId();
    const email = `wsf-w1b-lifecycle-${stamp}@example.com`;
    const password = `Pw-${randomBytes(9).toString('base64url')}`;
    const uid = await seedVerifiedUser(email, password);
    await seedProfile(uid, 'Alex Rivera');
    const groupId = `w1bl${stamp}`.replace(/-/g, '');
    await seedCommunity({
      groupId,
      displayName: COMMUNITY,
      joinPolicy: 'inviteOnly',
      members: [{ uid, role: 'foundingChampion' }],
    });

    const now = Date.now();
    const openGoal = `${groupId}o`;
    const closedGoal = `${groupId}c`;

    // The goal under test starts at ZERO. Its total and its reachedAt are both
    // earned below, by the product, not by this fixture.
    await seedGoal({
      goalId: openGoal,
      groupId,
      ownerUid: uid,
      title: OPEN_TITLE,
      target: OPEN_TARGET,
      unit: OPEN_UNIT,
      total: 0,
      status: 'active',
      startsAt: new Date(now - 6 * DAY),
      endsAt: new Date(now + 3 * DAY),
      repeatPolicy: 'multiple',
    });

    // The untouched control: genuinely reached, closed, never corrected. It is
    // what keeps these frames a rule rather than an absence.
    await seedGoal({
      goalId: closedGoal,
      groupId,
      ownerUid: uid,
      title: CLOSED_TITLE,
      target: CLOSED_TARGET,
      unit: CLOSED_UNIT,
      total: CLOSED_TOTAL,
      status: 'closed',
      startsAt: new Date(now - 34 * DAY),
      endsAt: new Date(now - 20 * DAY),
      closedAt: new Date(now - 20 * DAY),
      reachedAt: new Date(now - 22 * DAY),
      ownCredit: CLOSED_OWN,
    });

    const token = await idTokenFor(email, password);

    // ── 1 · IT ACTUALLY REACHES. The server stamps the crossing. ─────────────
    await callable('wsfContribute', token, {
      goalId: openGoal,
      attemptId: `w1b-reach-${stamp}`,
      count: CONTRIBUTED,
    });

    const afterReach = await firestoreRead(`wsfGoals/${openGoal}`);
    expect(
      afterReach.reachedAt,
      'the server must stamp reachedAt when a real contribution crosses the target'
    ).toBeTruthy();

    await signInVia(page, email, password);
    await openHome(page, groupId);
    await settled(page, openGoal);

    // The positive case, asserted before it is photographed.
    await expect(page.getByTestId(`wsf-community-goal-total-${openGoal}`)).toHaveText(
      `${CONTRIBUTED} of ${OPEN_TARGET} ${OPEN_UNIT}`
    );
    await expect(page.getByTestId(`wsf-community-goal-percent-${openGoal}`)).toHaveText(
      '100% complete'
    );
    await expect(page.getByTestId(`wsf-community-goal-status-${openGoal}`)).toHaveText(
      `${CONTRIBUTED - OPEN_TARGET} beyond our goal · still open`
    );
    const reachedLine = page.getByTestId(`wsf-community-goal-reached-${openGoal}`);
    await expect(reachedLine).toBeVisible();
    await expect(reachedLine).toContainText(/Reached/);
    await expect(page.getByTestId(`wsf-community-goal-we-${openGoal}`)).toHaveAttribute(
      'data-fill-ratio',
      '1.0000'
    );

    await saveFrame(page, frame('home-reached-open-before-correction-390x844.png'));

    // ── 2 · THE AUTHORITATIVE CORRECTION ─────────────────────────────────────
    await callable('wsfAdjustGoal', token, {
      goalId: openGoal,
      delta: CORRECTION,
      reason: 'Duplicate entry removed after review',
    });

    // The correction landed on the counters, not merely on an audit row: the
    // shards are the confirmed total every surface reads.
    expect(await shardTotal(openGoal), 'the correction must move the confirmed total').toBe(
      CORRECTED_TOTAL
    );

    // ── 3 · THE STAMP SURVIVES. Only the present tense changes. ──────────────
    const afterCorrection = await firestoreRead(`wsfGoals/${openGoal}`);
    expect(
      afterCorrection.reachedAt,
      'reachedAt is an event and must NOT be erased by a correction — the page stops printing it, the record keeps it'
    ).toBeTruthy();

    // ── 4 · WHAT THE PAGE SAYS NOW ───────────────────────────────────────────
    /*
      THE PAGE REPORTS A CONFIRMED SNAPSHOT, AND SAYS WHEN IT WAS CONFIRMED.
      Home prints "Confirmed <time>" beside its own Refresh control, so a
      reload alone can still show the total the member last confirmed — which
      is the product being honest, not a bug. The correction is therefore taken
      the way a member takes it: by asking for a fresh confirmation. Pressing
      the product's own control is also the only honest way to photograph this;
      reaching past it into the cache would be staging the result.
    */
    await page.reload();
    await expect(page.getByTestId('wsf-community-name')).toHaveText(COMMUNITY, { timeout: 40_000 });
    await settled(page, openGoal);
    await page.getByTestId('wsf-community-progress-refresh').click();

    // Exact, non-zero, and not a rounded-percent read: a stale or failed load
    // renders 0% or an error and fails every one of these.
    await expect(page.getByTestId(`wsf-community-goal-total-${openGoal}`)).toHaveText(
      `${CORRECTED_TOTAL} of ${OPEN_TARGET} ${OPEN_UNIT}`,
      { timeout: 30_000 }
    );
    await expect(page.getByTestId(`wsf-community-goal-percent-${openGoal}`)).toHaveText(
      '92% complete'
    );
    /*
      THE LOCK'S EXAMPLE SAYS "40 to go"; THE BUILD SAYS "Only 40 to go".
      460 of 500 is 92%, which is past the near-goal threshold of 90%, so the
      goal does not merely stop being reached — it lands back in nearGoal and
      takes that phase's own wording. The lock's line is illustrative of the
      numbers, not a copy string, and the assertion names what the product
      actually renders rather than what would have been convenient.
    */
    await expect(page.getByTestId(`wsf-community-goal-status-${openGoal}`)).toHaveText(
      `Only ${OPEN_TARGET - CORRECTED_TOTAL} to go`
    );
    // The whole rule, in one assertion.
    await expect(page.getByTestId(`wsf-community-goal-reached-${openGoal}`)).toHaveCount(0);
    // The mark follows the same confirmed ratio, and is no longer full.
    await expect(page.getByTestId(`wsf-community-goal-we-${openGoal}`)).toHaveAttribute(
      'data-fill-ratio',
      '0.9200'
    );
    // And no progress error is masquerading as the corrected state.
    await expect(
      page.getByTestId(`wsf-community-goal-progress-error-${openGoal}`)
    ).toHaveCount(0);

    // The control, on the same screen: still Reached, because it still is.
    // Home's History row prints the compact closed result, which for a goal
    // that really did reach its target is the single word.
    await expect(page.getByTestId(`wsf-community-goal-status-${closedGoal}`)).toHaveText('Reached');
    /*
      The frame's subject is the HERO — the corrected goal saying what is true
      now — so the shot is taken there. The control's History row is asserted
      above and sits below this fold; the preserved positive case is carried by
      the before-correction frame of this same goal and by the Progress frame,
      rather than by scrolling the subject out of its own picture.
    */
    await page
      .getByTestId(`wsf-community-goal-total-${openGoal}`)
      .evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }));
    await page.waitForTimeout(700);
    await saveFrame(page, frame('home-corrected-below-target-390x844.png'));

    // ── 5 · THE MEMBER'S OWN PAGE AGREES ─────────────────────────────────────
    await page.goto('/activity');
    await expect(page.getByTestId('wsf-activity-title')).toBeVisible({ timeout: 40_000 });
    const runningRow = page.getByTestId(`wsf-activity-row-${openGoal}`);
    await expect(runningRow).toBeVisible({ timeout: 40_000 });
    await expect(runningRow).toContainText(
      `${CORRECTED_TOTAL} of ${OPEN_TARGET} ${OPEN_UNIT}`
    );
    await expect(runningRow).toContainText('92%');
    // The corrected goal carries no reached treatment on this surface either.
    await expect(runningRow).not.toContainText('REACHED');

    // The control keeps its badge, and the one mark on this screen is its own,
    // filled by its real final total — the one-per-screen rule, on Progress.
    const doneRow = page.getByTestId(`wsf-activity-done-${closedGoal}`);
    await expect(doneRow).toBeVisible();
    await expect(doneRow).toContainText('REACHED');
    await expect(page.getByTestId('wsf-activity-we')).toHaveCount(1);
    await expect(page.getByTestId('wsf-activity-we')).toHaveAttribute('data-fill-ratio', '1.0000');

    await doneRow.evaluate((el) =>
      el.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior })
    );
    await page.waitForTimeout(700);
    await saveFrame(page, frame('progress-corrected-below-target-390x844.png'));

    if (CAPTURE_FRAMES) {
      writeFileSync(
        frame('fixture.json'),
        JSON.stringify(
          {
            note: 'Synthetic emulator fixture — not real members or activity.',
            community: COMMUNITY,
            groupId,
            corrected: {
              goalId: openGoal,
              title: OPEN_TITLE,
              target: OPEN_TARGET,
              unit: OPEN_UNIT,
              contributed: CONTRIBUTED,
              correction: CORRECTION,
              correctedTotal: CORRECTED_TOTAL,
              reachedAtStamped: 'by wsfContribute, and still present after wsfAdjustGoal',
            },
            control: {
              goalId: closedGoal,
              title: CLOSED_TITLE,
              target: CLOSED_TARGET,
              unit: CLOSED_UNIT,
              total: CLOSED_TOTAL,
              status: 'closed',
              corrected: false,
            },
            viewport: PHONE,
          },
          null,
          2
        )
      );
    }
  });
});
