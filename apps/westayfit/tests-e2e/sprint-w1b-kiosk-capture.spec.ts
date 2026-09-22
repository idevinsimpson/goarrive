import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

import { saveFrame, CAPTURE_FRAMES } from './helpers/capture';
import {
  firestoreWrite,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  stampId,
  tsField,
} from './helpers/mobile';

/**
 * CURRENT-BUILD CAPTURES for North Star Board 11 — the single-goal kiosk.
 *
 * Board 11's lock (PR #365, `5771528649`) locks "the CURRENT single-goal
 * shared-device kiosk truth, while preserving Board 14 as the future
 * two-station/queue experience." The route is built —
 * `app/kiosk/[goalId].tsx` with `src/kioskSession.ts` — but the atlas has no
 * photograph of it. `batch-e-room-screens` holds thirteen kiosk DRAWINGS at
 * 800×1280 and no `before/` or `after/` at all, and Board 11 must not be
 * reconstructed from a redesign that was never implemented.
 *
 * So this produces the missing frames, and nothing else. Every state is
 * ASSERTED before it is shot.
 *
 * TWO DEVICE CLASSES, AND WHY. The design target for a kiosk is 800×1280
 * portrait, which is what batch-e drew. The built route switches to its wide
 * treatment at `windowWidth >= 900`, so at exactly the drawn class it renders
 * its NARROW layout. Both are captured — the target class and one above the
 * threshold — because that difference is a real current-build fact and the
 * board should show it rather than pick whichever flatters the drawing.
 * Device classes are design targets, not installed hardware.
 *
 * WHAT IS NOT PRODUCED HERE, deliberately. No QR or phone pairing, no activity
 * chooser, no queue, turn or station assignment, no participant-name callout
 * and no individual display: none of that exists on this route, and Board 14 is
 * where the intended two-station experience lives. A capture producer is not a
 * place to invent capability.
 *
 * WRITES ARE GATED, ASSERTIONS ARE NOT, following `helpers/capture`: frames are
 * written only under `WSF_CAPTURE_FRAMES=1`, and the checks run on every
 * ordinary pass. `ui-kiosk.spec.ts` remains the route's behavioural coverage
 * and is untouched; this file neither replaces nor duplicates its purpose.
 *
 * No application, functions, config, shared-producer or `.github` change. Every
 * account, community, goal and number is synthetic and local to the emulator.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/kiosk-current');

/** The class batch-e drew the kiosk at. */
const TARGET_CLASS = { width: 800, height: 1280 };
/** A portrait tablet above the route's own 900 px wide-layout threshold. */
const WIDE_CLASS = { width: 1024, height: 1366 };

/* The fixture, fixed so every frame and assertion names the same run. The
   numbers are the lock's own illustration: 241 of 500, +20, 261 = 52.2%. */
const COMMUNITY = 'Maple Street Movers';
const GOAL_TITLE = 'Squats together this week';
const TARGET = 500;
const UNIT = 'squats';
const START_TOTAL = 241;
const ADDED = 20;
const NEW_TOTAL = START_TOTAL + ADDED;

const DAY = 24 * 60 * 60_000;

function frame(name: string): string {
  mkdirSync(OUT, { recursive: true });
  return path.join(OUT, name);
}

type Fixture = {
  stamp: string;
  email: string;
  password: string;
  uid: string;
  groupId: string;
  goalId: string;
  /** A goal in the same community that was never authorized for display. */
  unauthorizedGoalId: string;
};

async function seedKiosk(tag: string): Promise<Fixture> {
  const stamp = `${tag}${stampId()}`.replace(/-/g, '');
  const email = `wsf-w1b-kiosk-${stamp}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, 'Alex Rivera');

  const groupId = `w1bk${stamp}`;
  const now = new Date();
  await firestoreWrite(`wsfCommunityGroups/${groupId}`, {
    displayName: { stringValue: COMMUNITY },
    groupType: { stringValue: 'familyFriends' },
    joinPolicy: { stringValue: 'private' },
    joinCode: { stringValue: randomBytes(6).toString('base64url') },
    createdByUserId: { stringValue: uid },
    lifecycleStatus: { stringValue: 'active' },
    isSample: { booleanValue: false },
    createdAt: tsField(new Date(now.getTime() - 40 * DAY)),
    updatedAt: tsField(now),
  });
  await firestoreWrite(`wsfMemberships/${groupId}_${uid}`, {
    groupId: { stringValue: groupId },
    userId: { stringValue: uid },
    role: { stringValue: 'foundingChampion' },
    membershipStatus: { stringValue: 'active' },
    createdAt: tsField(now),
    updatedAt: tsField(now),
  });

  const goalId = `${groupId}g`;
  const unauthorizedGoalId = `${groupId}u`;
  for (const [id, authorized] of [
    [goalId, true],
    [unauthorizedGoalId, false],
  ] as const) {
    const fields: Record<string, unknown> = {
      ownerUid: { stringValue: uid },
      communityGroupId: { stringValue: groupId },
      title: { stringValue: GOAL_TITLE },
      target: { integerValue: String(TARGET) },
      unit: { stringValue: UNIT },
      status: { stringValue: 'active' },
      startsAt: tsField(new Date(now.getTime() - 4 * DAY)),
      endsAt: tsField(new Date(now.getTime() + 3 * DAY)),
      repeatPolicy: { stringValue: 'multiple' },
      timezone: { stringValue: 'America/New_York' },
      createdAt: tsField(new Date(now.getTime() - 4 * DAY)),
      updatedAt: tsField(now),
    };
    // The one thing that makes a goal a PUBLIC surface. Without it the kiosk
    // gets the same generic refusal the display gets.
    if (authorized) fields.aggregateDisplayAuthorized = { booleanValue: true };
    await firestoreWrite(`wsfGoals/${id}`, fields);
    await seedShards(id, START_TOTAL);
  }

  return { stamp, email, password, uid, groupId, goalId, unauthorizedGoalId };
}

/** The resting screen, settled: the hero painted from a confirmed pulse. */
async function restingReady(page: Page, fx: Fixture): Promise<void> {
  await page.goto(`/kiosk/${fx.goalId}`);
  await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 40_000 });
  await expect(page.getByTestId('wsf-kiosk-percent')).toBeVisible({ timeout: 30_000 });
  // The wordmark and the mark's own image: a beat, so a frame is the settled screen.
  await page.waitForTimeout(900);
}

/** Everything the lock fixes about the resting hero, in one place. */
async function assertRestingTruth(page: Page): Promise<void> {
  await expect(page.getByTestId('wsf-kiosk-community')).toHaveText(COMMUNITY);
  await expect(page.getByTestId('wsf-kiosk-goal-title')).toHaveText(GOAL_TITLE);
  await expect(page.getByTestId('wsf-kiosk-shared-total')).toHaveText(String(START_TOTAL));
  await expect(page.getByTestId('wsf-kiosk-total-line')).toHaveText(
    `${START_TOTAL} of ${TARGET} ${UNIT}`
  );
  await expect(page.getByTestId('wsf-kiosk-percent')).toHaveText('48.2% complete');
  await expect(page.getByTestId('wsf-kiosk-confirmed-at')).toHaveText(/^Confirmed /);
  await expect(page.getByTestId('wsf-kiosk-we')).toHaveAttribute('data-fill-ratio', '0.4820');
  // One primary, and it is the only control on the screen.
  await expect(page.getByTestId('wsf-kiosk-start')).toHaveText('Contribute here');
  // NO INDIVIDUAL IDENTITY ON THE START SCREEN. The strongest form of the
  // check: the whole screen's text, asserted not to contain the account.
  const text = await page.getByTestId('wsf-kiosk-screen').innerText();
  expect(text).not.toContain('Alex Rivera');
  expect(text.toLowerCase()).not.toContain('sign out');
  // And nothing this board must not claim.
  for (const forbidden of ['QR', 'queue', 'turn', 'pair', 'station']) {
    expect(text.toLowerCase()).not.toContain(forbidden.toLowerCase());
  }
}

test.describe('Board 11 · the kiosk at its design-target class', () => {
  test.use({ viewport: TARGET_CLASS, deviceScaleFactor: 2 });

  test('resting, loading, refused, unreachable and stale', async ({ page }) => {
    test.setTimeout(300_000);
    const fx = await seedKiosk('a');

    // ── RESTING ──────────────────────────────────────────────────────────────
    await restingReady(page, fx);
    await assertRestingTruth(page);
    // The privacy explanation the lock fixes: own account, own count, nothing
    // left behind. Asserted by its substance, not by a testID alone.
    const caption = await page.getByTestId('wsf-kiosk-caption').innerText();
    const sharedNote = await page.getByTestId('wsf-kiosk-shared-note').innerText();
    expect(`${caption} ${sharedNote}`.toLowerCase()).toContain('your own account');
    expect(`${caption} ${sharedNote}`.toLowerCase()).toContain('nothing about you stays on it');
    await saveFrame(page, frame('kiosk-resting-800x1280.png'));

    // ── LOADING · placeholders, and no fake Living WE ─────────────────────────
    let holdPulse = true;
    await page.route('**/wsfGoalPulse', async (route: Route) => {
      if (holdPulse) {
        // Held open, not answered: the screen stays in its real loading state.
        await new Promise((r) => setTimeout(r, 20_000));
      }
      await route.continue();
    });
    await page.goto(`/kiosk/${fx.goalId}`);
    await expect(page.getByTestId('wsf-kiosk-loading')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('wsf-kiosk-we')).toHaveCount(0);
    await expect(page.getByTestId('wsf-kiosk-shared-total')).toHaveCount(0);
    await page.waitForTimeout(600);
    await saveFrame(page, frame('kiosk-loading-800x1280.png'));
    holdPulse = false;
    await page.unroute('**/wsfGoalPulse');

    // ── REFUSED · a goal that is not a public surface ────────────────────────
    await page.goto(`/kiosk/${fx.unauthorizedGoalId}`);
    await expect(page.getByTestId('wsf-kiosk-not-available')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-kiosk-not-available')).toContainText('Nothing to show here');
    await expect(page.getByTestId('wsf-kiosk-not-available')).toContainText(
      'This display isn’t currently available.'
    );
    // It says nothing about WHY, so it cannot be asked whether a goal exists.
    const refusalText = await page.getByTestId('wsf-kiosk-not-available').innerText();
    expect(refusalText.toLowerCase()).not.toContain('authoriz');
    expect(refusalText).not.toContain(fx.unauthorizedGoalId);
    await expect(page.getByTestId('wsf-kiosk-we')).toHaveCount(0);
    await page.waitForTimeout(600);
    await saveFrame(page, frame('kiosk-refused-800x1280.png'));

    // ── UNREACHABLE · a failure BEFORE any confirmation ──────────────────────
    await page.route('**/wsfGoalPulse', (route: Route) => route.abort('failed'));
    await page.goto(`/kiosk/${fx.goalId}`);
    await expect(page.getByTestId('wsf-kiosk-unreachable')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-kiosk-recheck')).toHaveText('Check again');
    // No invented total and no instrument without a confirmed ratio.
    await expect(page.getByTestId('wsf-kiosk-we')).toHaveCount(0);
    await expect(page.getByTestId('wsf-kiosk-shared-total')).toHaveCount(0);
    await page.waitForTimeout(600);
    await saveFrame(page, frame('kiosk-unreachable-800x1280.png'));
    await page.unroute('**/wsfGoalPulse');

    // ── STALE · one real confirmation, then the poll fails ───────────────────
    // The distinction the lock draws: a screen that HAS been confirmed keeps
    // the last confirmed truth and says it is old; it does not blank.
    await restingReady(page, fx);
    await expect(page.getByTestId('wsf-kiosk-confirmed-at')).toHaveText(/^Confirmed /);
    await page.route('**/wsfGoalPulse', (route: Route) => route.abort('failed'));
    await expect(page.getByTestId('wsf-kiosk-confirmed-at')).toHaveText(/^Last confirmed /, {
      timeout: 30_000,
    });
    // The total it keeps is the one it actually confirmed, not a guess.
    await expect(page.getByTestId('wsf-kiosk-total-line')).toHaveText(
      `${START_TOTAL} of ${TARGET} ${UNIT}`
    );
    await expect(page.getByTestId('wsf-kiosk-we')).toHaveAttribute('data-fill-ratio', '0.4820');
    await expect(page.getByTestId('wsf-kiosk-screen')).toHaveAttribute('data-stale', 'true');
    await page.waitForTimeout(600);
    await saveFrame(page, frame('kiosk-stale-800x1280.png'));
    await page.unroute('**/wsfGoalPulse');

    if (CAPTURE_FRAMES) {
      writeFileSync(
        frame('fixture.json'),
        JSON.stringify(
          {
            note: 'Synthetic emulator fixture — not real members or activity.',
            community: COMMUNITY,
            groupId: fx.groupId,
            authorizedGoalId: fx.goalId,
            unauthorizedGoalId: fx.unauthorizedGoalId,
            title: GOAL_TITLE,
            target: TARGET,
            unit: UNIT,
            startTotal: START_TOTAL,
            added: ADDED,
            newTotal: NEW_TOTAL,
            targetClass: TARGET_CLASS,
            wideClass: WIDE_CLASS,
            wideThresholdPx: 900,
          },
          null,
          2
        )
      );
    }
  });

  test('the whole walk-up: Contribute here → ordinary sign-in → entry → review → receipt → Finish', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const fx = await seedKiosk('b');

    await restingReady(page, fx);
    await page.getByTestId('wsf-kiosk-start').click();

    // THE HANDOFF IS THE ORDINARY JOURNEY. A shared device that asked for a
    // password in its own chrome would be the shape of a credential harvest;
    // this one sends the visitor to the product's own sign-in.
    await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(500);
    await saveFrame(page, frame('kiosk-handoff-signed-out-800x1280.png'));

    await page.getByTestId('wsf-contribute-signin-link').click();
    await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-signin-email').fill(fx.email);
    await page.getByTestId('wsf-signin-password').fill(fx.password);
    await page.getByTestId('wsf-signin-submit').click();

    // Back at the goal the kiosk was resting on, in kiosk mode.
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
    // Kiosk mode: no way off the device, and the Finish chrome instead.
    await expect(page.getByTestId('wsf-contribute-back')).toHaveCount(0);
    await expect(page.getByTestId('wsf-kiosk-finish-chrome')).toBeVisible();
    await page.waitForTimeout(600);
    await saveFrame(page, frame('kiosk-entry-800x1280.png'));

    await page.getByTestId('wsf-contribute-entry').fill(String(ADDED));
    await page.getByTestId('wsf-contribute-review').click();
    await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
    // THE REVIEW PREVIEWS OWN CREDIT ONLY. It does not predict the shared
    // total, because the shared total is not this member's to promise.
    const reviewText = await page.getByTestId('wsf-contribute-review-screen').innerText();
    expect(reviewText).not.toContain(`${NEW_TOTAL} of ${TARGET}`);
    await page.waitForTimeout(500);
    await saveFrame(page, frame('kiosk-review-800x1280.png'));

    await page.getByTestId('wsf-contribute-submit').click();

    // ── THE CONFIRMED RECEIPT ────────────────────────────────────────────────
    await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText(
      `${NEW_TOTAL} of ${TARGET} ${UNIT}`
    );
    // Finish replaces the ordinary repeat/back controls.
    await expect(page.getByTestId('wsf-kiosk-finish')).toHaveText('Finish');
    await expect(page.getByTestId('wsf-kiosk-finish-explainer')).toHaveText(
      'Finish signs you out and returns this device to its start screen.'
    );
    await expect(page.getByTestId('wsf-kiosk-countdown')).toHaveText(
      /^Finishing in \d+ seconds?$/
    );
    await expect(page.getByTestId('wsf-kiosk-stay')).toBeVisible();
    // A confirmed outcome carries no unresolved notice.
    await expect(page.getByTestId('wsf-kiosk-unresolved-note')).toHaveCount(0);
    await page.waitForTimeout(600);
    await saveFrame(page, frame('kiosk-receipt-finish-800x1280.png'));

    // ── STAY · a new deadline, not a pause ───────────────────────────────────
    const before = await page.getByTestId('wsf-kiosk-countdown').innerText();
    const beforeSeconds = Number(/(\d+)/.exec(before)?.[1] ?? '0');
    await page.waitForTimeout(3_000);
    const mid = Number(/(\d+)/.exec(await page.getByTestId('wsf-kiosk-countdown').innerText())?.[1] ?? '0');
    expect(mid, 'the countdown must actually count down').toBeLessThan(beforeSeconds);
    await page.getByTestId('wsf-kiosk-stay').click();
    await page.waitForTimeout(600);
    const after = Number(/(\d+)/.exec(await page.getByTestId('wsf-kiosk-countdown').innerText())?.[1] ?? '0');
    expect(after, 'Stay restarts the countdown rather than pausing it').toBeGreaterThan(mid);
    // The receipt is still the receipt; Stay keeps it visible.
    await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText(
      `${NEW_TOTAL} of ${TARGET} ${UNIT}`
    );
    await saveFrame(page, frame('kiosk-receipt-stay-800x1280.png'));

    // ── FINISH · the device comes to rest, signed out, with nothing left ─────
    await page.getByTestId('wsf-kiosk-finish').click();
    await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-kiosk-percent')).toBeVisible({ timeout: 30_000 });
    // The next visitor inherits nobody, and the new confirmed total is the
    // one the contribution produced.
    await expect(page.getByTestId('wsf-kiosk-total-line')).toHaveText(
      `${NEW_TOTAL} of ${TARGET} ${UNIT}`
    );
    await expect(page.getByTestId('wsf-kiosk-percent')).toHaveText('52.2% complete');
    await expect(page.getByTestId('wsf-kiosk-we')).toHaveAttribute('data-fill-ratio', '0.5220');
    const restText = await page.getByTestId('wsf-kiosk-screen').innerText();
    expect(restText).not.toContain('Alex Rivera');
    expect(restText).not.toContain(String(ADDED));
    await page.waitForTimeout(900);
    await saveFrame(page, frame('kiosk-rested-after-finish-800x1280.png'));
  });
});

test.describe('Board 11 · above the route’s own wide-layout threshold', () => {
  test.use({ viewport: WIDE_CLASS, deviceScaleFactor: 2 });

  test('the same resting screen, wide', async ({ page }) => {
    test.setTimeout(240_000);
    const fx = await seedKiosk('c');
    await restingReady(page, fx);
    await assertRestingTruth(page);
    // The route's own switch: `windowWidth >= 900` selects the wide treatment.
    await expect(page.getByTestId('wsf-kiosk-screen')).toHaveAttribute('data-layout', 'wide');
    await saveFrame(page, frame('kiosk-resting-wide-1024x1366.png'));
  });
});

/**
 * THE TWO LOCKED FAILURE STATES — released as a supplement to the same packet.
 *
 * Board 11's lock fixes two states the first pass named but did not photograph,
 * because reaching either needs a failure injected at a precise instant: the
 * UNKNOWN OUTCOME (`KIOSK_UNRESOLVED_NOTICE`) and the SIGN-OUT FAILURE. Both are
 * central to the single-goal shared-device contract — one is about effort whose
 * fate nobody knows, the other about a device that must not hand the next
 * visitor the last visitor's account — so they are produced here rather than
 * left as prose.
 *
 * WHAT IS INJECTED, AND WHERE. Two faults, both outside the product:
 *
 *   1. `route.abort('failed')` on `wsfContribute` — the same transport fault
 *      `design-after-move-capture.spec.ts` uses for the ordinary MOVE page's
 *      unknown outcome. The request never reaches the server, so nothing is
 *      recorded and nothing can be: that is exactly the state whose defining
 *      property is that the member cannot know.
 *   2. A readwrite transaction on Firebase Auth's own IndexedDB store
 *      (`firebaseLocalStorage`) made to throw, for the instant Finish runs.
 *      The web SDK signs out by REMOVING the persisted user, so a storage layer
 *      that refuses the removal is the real mechanism by which `signOut()`
 *      rejects — which is the condition `runKioskFinish` reports as
 *      `signedOut: false`. Reads are left working; only the removal fails.
 *
 * NEITHER TOUCHES THE PRODUCT. No app, backend, config or existing-producer
 * change was made to reach these screens, and no expected design is substituted
 * for what rendered. Frames are labelled with the fault that produced them.
 *
 * ONE VIEWPORT EACH, the 800×1280 class batch-e drew. The successful Finish
 * captured above remains the positive control.
 */
test.describe('Board 11 · the two locked failure states', () => {
  test.use({ viewport: TARGET_CLASS, deviceScaleFactor: 2 });

  /** Firebase Auth's persisted records for this origin, read read-only. */
  async function authRecords(page: Page): Promise<string[]> {
    return page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const req = indexedDB.open('firebaseLocalStorageDb');
          req.onerror = () => resolve([]);
          req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
              db.close();
              resolve([]);
              return;
            }
            const all = db
              .transaction('firebaseLocalStorage', 'readonly')
              .objectStore('firebaseLocalStorage')
              .getAllKeys();
            all.onsuccess = () => {
              db.close();
              resolve((all.result as unknown[]).map(String));
            };
            all.onerror = () => {
              db.close();
              resolve([]);
            };
          };
        })
    );
  }

  /** Every stored contribution record this browser holds, parsed. */
  async function pendingRecords(page: Page): Promise<{ key: string; state: string; count: number }[]> {
    return page.evaluate(() =>
      Object.keys(window.localStorage)
        .filter((k) => k.startsWith('wsf.pendingContribution.'))
        .map((key) => {
          let state = '';
          let count = -1;
          try {
            const raw = JSON.parse(window.localStorage.getItem(key) ?? '{}') as {
              state?: string;
              count?: number;
            };
            state = String(raw.state ?? '');
            count = Number(raw.count ?? -1);
          } catch {
            /* an unparseable row is reported as it reads */
          }
          return { key, state, count };
        })
    );
  }

  /** Walk up to the kiosk and arrive, signed in, on the entry screen. */
  async function walkUp(page: Page, fx: Fixture): Promise<void> {
    await restingReady(page, fx);
    await page.getByTestId('wsf-kiosk-start').click();
    await expect(page.getByTestId('wsf-contribute-signed-out')).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-contribute-signin-link').click();
    await expect(page.getByTestId('wsf-signin-email')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('wsf-signin-email').fill(fx.email);
    await page.getByTestId('wsf-signin-password').fill(fx.password);
    await page.getByTestId('wsf-signin-submit').click();
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
  }

  test('the unknown outcome: the kiosk says nobody knows, invents no total, and Finish keeps the record', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const fx = await seedKiosk('d');
    await walkUp(page, fx);

    await page.getByTestId('wsf-contribute-entry').fill(String(ADDED));
    await page.getByTestId('wsf-contribute-review').click();
    await expect(page.getByTestId('wsf-contribute-review-screen')).toBeVisible();
    // The write leaves; no answer ever comes back.
    await page.route('**/wsfContribute', (route: Route) => route.abort('failed'));
    await page.getByTestId('wsf-contribute-submit').click();

    // ── THE STATE ITSELF, asserted as uncertainty and not as a result ────────
    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-contribute-pending')).toContainText(
      'We couldn’t confirm your contribution yet.'
    );
    await expect(page.getByTestId('wsf-contribute-pending')).toContainText(
      'We don’t know whether this effort was recorded. Don’t record it again.'
    );
    await expect(page.getByTestId('wsf-contribute-pending-count')).toHaveText(
      `You entered ${ADDED} ${UNIT}.`
    );
    // NO NEW SHARED TOTAL AND NO MARK. The anchor is deliberately absent here:
    // a Living WE beside "we don't know whether this was recorded" would invite
    // exactly the arithmetic the member cannot safely do.
    await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveCount(0);
    await expect(page.getByTestId('wsf-contribute-we')).toHaveCount(0);
    const pendingText = await page.getByTestId('wsf-contribute-screen').innerText();
    expect(pendingText).not.toContain(`${NEW_TOTAL} of ${TARGET}`);
    expect(pendingText).not.toContain(`${START_TOTAL} of ${TARGET}`);
    expect(pendingText).not.toContain('%');
    // THE GUIDANCE IS THE SHARED-DEVICE ONE: do not repeat it here, and the
    // replay that is safe is the SAME attempt, not a second contribution.
    await expect(page.getByTestId('wsf-contribute-reconcile')).toHaveText(
      'Confirm this contribution'
    );
    await expect(page.getByTestId('wsf-kiosk-unresolved-note')).toHaveText(
      'Your attempt is saved to your account; check it from your own device.'
    );
    // The ordinary route's "you can come back to this page" is NOT offered on a
    // device the visitor is about to be signed out of.
    expect(pendingText).not.toContain('The same attempt will be here when you come back');
    // An unresolved attempt is a rest state, so the session can end by itself.
    await expect(page.getByTestId('wsf-kiosk-finish')).toHaveText('Finish');
    await expect(page.getByTestId('wsf-kiosk-countdown')).toHaveText(/^Finishing in \d+ seconds?$/);
    // The record that makes the effort reconcilable exists, under this account.
    const held = await pendingRecords(page);
    expect(held.map((r) => r.state)).toEqual(['unknown']);
    expect(held[0].count).toBe(ADDED);
    expect(held[0].key).toContain(fx.uid);
    await page.waitForTimeout(600);
    await saveFrame(page, frame('kiosk-unresolved-800x1280.png'));

    // ── FINISH FROM UNRESOLVED ───────────────────────────────────────────────
    // The one case where Finish must NOT clear the stored attempt: it is the
    // only thing that lets its owner replay the same attempt id and get the
    // original receipt instead of booking a second contribution.
    await page.getByTestId('wsf-kiosk-finish').click();
    await expect(page.getByTestId('wsf-kiosk-screen')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-kiosk-percent')).toBeVisible({ timeout: 30_000 });
    // The device is signed out, and the resting screen carries the confirmed
    // truth — which is still the total before the attempt, because the request
    // never reached the server. Nothing is invented in either direction.
    expect(await authRecords(page)).toEqual([]);
    await expect(page.getByTestId('wsf-kiosk-total-line')).toHaveText(
      `${START_TOTAL} of ${TARGET} ${UNIT}`
    );
    await expect(page.getByTestId('wsf-kiosk-we')).toHaveAttribute('data-fill-ratio', '0.4820');
    const restedText = await page.getByTestId('wsf-kiosk-screen').innerText();
    expect(restedText).not.toContain('Alex Rivera');
    expect(restedText.toLowerCase()).not.toContain('not confirmed');
    // THE RECORD SURVIVED THE SIGN-OUT, keyed to the account that made it.
    const kept = await pendingRecords(page);
    expect(kept.map((r) => r.state)).toEqual(['unknown']);
    expect(kept[0].key).toContain(fx.uid);
    await page.waitForTimeout(900);
    await saveFrame(page, frame('kiosk-rested-after-unresolved-800x1280.png'));
    await page.unroute('**/wsfContribute');
  });

  test('the sign-out failure: the device refuses to return to rest while the account is still on it', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const fx = await seedKiosk('e');
    await walkUp(page, fx);

    // A REAL, CONFIRMED contribution first: the failure under test is the
    // sign-out, not the write.
    await page.getByTestId('wsf-contribute-entry').fill(String(ADDED));
    await page.getByTestId('wsf-contribute-review').click();
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-contribute-shared-total')).toHaveText(
      `${NEW_TOTAL} of ${TARGET} ${UNIT}`
    );
    expect(await authRecords(page)).not.toEqual([]);

    // ── THE INJECTION ────────────────────────────────────────────────────────
    // Firebase Auth signs out by REMOVING its persisted user from IndexedDB.
    // Only that removal is made to fail; reads keep working, and nothing else
    // in the page is touched.
    await page.evaluate(() => {
      const proto = IDBDatabase.prototype;
      const original = proto.transaction;
      proto.transaction = function patched(
        this: IDBDatabase,
        names: string | string[] | DOMStringList,
        mode?: IDBTransactionMode,
        options?: IDBTransactionOptions
      ): IDBTransaction {
        const list = typeof names === 'string' ? [names] : Array.from(names as string[]);
        if (mode === 'readwrite' && list.includes('firebaseLocalStorage')) {
          throw new DOMException('injected storage fault', 'InvalidStateError');
        }
        return original.call(this, names as string[], mode, options);
      } as typeof proto.transaction;
    });

    await page.getByTestId('wsf-kiosk-finish').click();

    // ── WHAT THE DEVICE DOES ─────────────────────────────────────────────────
    // It stays where it is and says so. A start screen here would be a device
    // claiming to be free while the previous visitor's account is still on it.
    await expect(page.getByTestId('wsf-kiosk-finish-error')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-kiosk-finish-error')).toHaveText(
      'We couldn’t sign you out. Don’t leave this device signed in — try Finish again.'
    );
    // The start screen is MOUNTED but not shown: kiosk mode pushes the
    // contribution route on top of it, and Finish returns by popping back to
    // it. So the check that matters is that the visitor is not LOOKING at a
    // resting screen — it is still underneath, and the failure did not reveal
    // it.
    await expect(page.getByTestId('wsf-kiosk-screen')).toBeHidden();
    expect(page.url()).toContain('/contribute/');
    expect(page.url()).toContain('kiosk=1');
    await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible();
    // Finish is offered again rather than left spinning.
    await expect(page.getByTestId('wsf-kiosk-finish')).toHaveText('Finish');
    await expect(page.getByTestId('wsf-kiosk-finish')).toBeEnabled();
    // THE ACCOUNT IS STILL ATTACHED: its persisted record is still on the
    // device, which is precisely what the warning is about.
    expect(await authRecords(page)).not.toEqual([]);
    await page.waitForTimeout(600);
    await saveFrame(page, frame('kiosk-signout-failed-800x1280.png'));

    // And it is not a cosmetic warning. A reload drops the injected fault with
    // the JS context; the device comes back still signed in as the same
    // visitor, with no sign-in gate between the next person and this account.
    await page.reload();
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-contribute-signed-out')).toHaveCount(0);
    expect(await authRecords(page)).not.toEqual([]);
  });
});
