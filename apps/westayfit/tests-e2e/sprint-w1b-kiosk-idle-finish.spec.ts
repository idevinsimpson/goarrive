import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page, type Route } from '@playwright/test';

import { saveFrame } from './helpers/capture';
import {
  firestoreWrite,
  seedProfile,
  seedShards,
  seedVerifiedUser,
  signInVia,
  stampId,
  tsField,
} from './helpers/mobile';

/**
 * THE THREE KIOSK SCREENS THAT HAD NO DEADLINE.
 *
 * A kiosk session ends by itself after 90 seconds from a screen it has come to
 * rest on. Until this change that meant a receipt, a refusal or an unresolved
 * attempt only. A goal that CLOSED, one that cannot be FOUND, and a load that
 * FAILED all carried a manual `Finish` in the chrome and no deadline at all —
 * so a shared device left on one of them stayed exactly as the last visitor
 * left it, indefinitely. Reported on #427 and assigned as its own packet
 * (`5787551970`).
 *
 * WHAT IS REUSED, NOT INVENTED. The same 90 seconds, the same `Stay` restart,
 * the same accessible manual `Finish`, the same sign-out-failure protection and
 * the same presentation as every other settled kiosk screen. Nothing here
 * redesigns a screen or adds a preference.
 *
 * DETERMINISTIC TIME, UNMODIFIED DURATION. `KIOSK_IDLE_MS` is untouched at
 * 90_000. Expiry is reached by advancing the page's own clock
 * (`page.clock`), never by waiting 90 seconds and never by shortening the
 * deadline to suit a test.
 *
 * WHAT THE RESUME CASE DOES AND DOES NOT SHOW. The countdown is a difference
 * between two timestamps rather than a decremented counter, so a page that
 * comes back past its deadline is already expired and finishes on its next
 * tick. Advancing the clock is a model of that, not proof that a browser
 * executes while an operating system has it suspended — nothing here claims it
 * does.
 *
 * ARRIVAL. These states cannot be reached through the kiosk start screen: a
 * closed or missing goal has no resting screen to walk up from. The visitor is
 * signed in and the kiosk-mode contribution route is opened directly, which is
 * the same input the screen reads either way — the flag on the route.
 */

const OUT = path.resolve(__dirname, '../../../docs/design-target/review/kiosk-idle-finish');

const TABLET = { width: 800, height: 1280 };
const SHORT_PHONE = { width: 390, height: 640 };

const COMMUNITY = 'Maple Street Movers';
const GOAL_TITLE = 'Squats together this week';
const TARGET = 500;
const UNIT = 'squats';
const START_TOTAL = 241;
const ADDED = 20;
const VISITOR = 'Alex Rivera';

/** The deadline, as the product defines it. Never shortened here. */
const IDLE_MS = 90_000;
const DAY = 24 * 60 * 60_000;

function frame(name: string): string {
  mkdirSync(OUT, { recursive: true });
  return path.join(OUT, name);
}

type Fixture = {
  email: string;
  password: string;
  uid: string;
  groupId: string;
  /** An ordinary active goal. */
  goalId: string;
  /** The same community's goal, seeded closed. */
  closedGoalId: string;
  /** An id no goal was ever written for. */
  missingGoalId: string;
};

async function seedFixture(tag: string): Promise<Fixture> {
  const stamp = `${tag}${stampId()}`.replace(/-/g, '');
  const email = `wsf-w1b-idle-${stamp}@example.com`;
  const password = `Pw-${randomBytes(9).toString('base64url')}`;
  const uid = await seedVerifiedUser(email, password);
  await seedProfile(uid, VISITOR);

  const groupId = `w1bi${stamp}`;
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
  const closedGoalId = `${groupId}c`;
  for (const [id, status] of [
    [goalId, 'active'],
    [closedGoalId, 'closed'],
  ] as const) {
    await firestoreWrite(`wsfGoals/${id}`, {
      ownerUid: { stringValue: uid },
      communityGroupId: { stringValue: groupId },
      title: { stringValue: GOAL_TITLE },
      target: { integerValue: String(TARGET) },
      unit: { stringValue: UNIT },
      status: { stringValue: status },
      startsAt: tsField(new Date(now.getTime() - 4 * DAY)),
      endsAt: tsField(new Date(now.getTime() + (status === 'closed' ? -1 : 3) * DAY)),
      repeatPolicy: { stringValue: 'multiple' },
      timezone: { stringValue: 'America/New_York' },
      aggregateDisplayAuthorized: { booleanValue: true },
      createdAt: tsField(new Date(now.getTime() - 4 * DAY)),
      updatedAt: tsField(now),
    });
    await seedShards(id, START_TOTAL);
  }

  return {
    email,
    password,
    uid,
    groupId,
    goalId,
    closedGoalId,
    missingGoalId: `${groupId}nosuchgoal`,
  };
}

function kioskUrl(goalId: string): string {
  return `/contribute/${goalId}?kiosk=1`;
}

/** Fail the goal load itself, which is what puts the screen in `error`. */
async function breakGoalLoad(page: Page): Promise<void> {
  await page.route('**/wsfGoalPulse', (route: Route) => route.abort('failed'));
  await page.route('**/wsfMyContribution', (route: Route) => route.abort('failed'));
}

/** The end-of-session treatment, as every other settled kiosk screen has it. */
async function expectFinishTreatment(page: Page): Promise<void> {
  await expect(page.getByTestId('wsf-kiosk-finish-bar')).toBeVisible();
  await expect(page.getByTestId('wsf-kiosk-finish')).toHaveText('Finish');
  await expect(page.getByTestId('wsf-kiosk-finish-explainer')).toHaveText(
    'Finish signs you out and returns this device to its start screen.'
  );
  await expect(page.getByTestId('wsf-kiosk-countdown')).toHaveText(/^Finishing in \d+ seconds?$/);
  await expect(page.getByTestId('wsf-kiosk-stay')).toBeVisible();
  // The chrome way out is still there, and still the only one.
  await expect(page.getByTestId('wsf-kiosk-finish-chrome')).toBeVisible();
}

/** No new way into the account, on a screen that just gained a control. */
async function expectNoMemberEscape(page: Page): Promise<void> {
  await expect(page.getByTestId('wsf-member-tabs')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-home')).toHaveCount(0);
  await expect(page.getByTestId('wsf-contribute-back')).toHaveCount(0);
}

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

async function pendingKeys(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(window.localStorage).filter((k) => k.startsWith('wsf.pendingContribution.'))
  );
}

/** Past the deadline, on the page's own clock. */
async function passTheDeadline(page: Page): Promise<void> {
  await page.clock.runFor(IDLE_MS + 2_000);
}

// ---------------------------------------------------------------------------
// The three states, at both classes
// ---------------------------------------------------------------------------

for (const klass of [
  { key: 'tablet-800x1280', viewport: TABLET },
  { key: 'short-phone-390x640', viewport: SHORT_PHONE },
] as const) {
  test.describe(`kiosk idle finish · ${klass.key}`, () => {
    test.use({ viewport: klass.viewport, deviceScaleFactor: 2 });

    test(`the closed, missing and failed screens all carry the deadline · ${klass.key}`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      await page.clock.install();
      const fx = await seedFixture('a');
      await signInVia(page, fx.email, fx.password);

      // ── A GOAL THAT CLOSED ───────────────────────────────────────────────
      await page.goto(kioskUrl(fx.closedGoalId));
      await expect(page.getByTestId('wsf-contribute-closed')).toBeVisible({ timeout: 40_000 });
      await expectFinishTreatment(page);
      await expectNoMemberEscape(page);
      await page.waitForTimeout(600);
      await saveFrame(page, frame(`kiosk-closed-goal-${klass.key}.png`));

      // ── A GOAL THAT IS NOT THERE ─────────────────────────────────────────
      await page.goto(kioskUrl(fx.missingGoalId));
      await expect(page.getByTestId('wsf-contribute-not-found')).toBeVisible({ timeout: 40_000 });
      await expectFinishTreatment(page);
      await expectNoMemberEscape(page);
      await page.waitForTimeout(600);
      await saveFrame(page, frame(`kiosk-not-found-${klass.key}.png`));

      // ── A LOAD THAT FAILED ───────────────────────────────────────────────
      await breakGoalLoad(page);
      await page.goto(kioskUrl(fx.goalId));
      await expect(page.getByTestId('wsf-contribute-load-error')).toBeVisible({ timeout: 40_000 });
      await expectFinishTreatment(page);
      await expectNoMemberEscape(page);
      // A load failure is not a contribution refusal, and the screen still
      // does not say it is.
      await expect(page.getByTestId('wsf-contribute-refused')).toHaveCount(0);
      await page.waitForTimeout(600);
      await saveFrame(page, frame(`kiosk-load-error-${klass.key}.png`));
    });
  });
}

// ---------------------------------------------------------------------------
// What the deadline does, and what it must never do
// ---------------------------------------------------------------------------

test.describe('kiosk idle finish · the behaviour', () => {
  test.use({ viewport: TABLET, deviceScaleFactor: 2 });

  test('the deadline performs the same safe Finish, and Stay renews it', async ({ page }) => {
    test.setTimeout(300_000);
    await page.clock.install();
    const fx = await seedFixture('b');
    await signInVia(page, fx.email, fx.password);
    await page.goto(kioskUrl(fx.closedGoalId));
    await expect(page.getByTestId('wsf-contribute-closed')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-kiosk-countdown')).toHaveText('Finishing in 90 seconds');

    // ── STAY RENEWS THE DEADLINE, rather than pausing it ──────────────────
    await page.clock.runFor(60_000);
    const midway = Number(
      /(\d+)/.exec(await page.getByTestId('wsf-kiosk-countdown').innerText())?.[1] ?? '0'
    );
    expect(midway, 'the countdown actually counts down').toBeLessThanOrEqual(31);
    await page.getByTestId('wsf-kiosk-stay').click();
    await page.clock.runFor(1_000);
    const renewed = Number(
      /(\d+)/.exec(await page.getByTestId('wsf-kiosk-countdown').innerText())?.[1] ?? '0'
    );
    expect(renewed, 'Stay starts a new deadline').toBeGreaterThan(midway);
    // And a renewed deadline is a whole one, not the remainder of the old.
    expect(renewed).toBeGreaterThanOrEqual(85);
    // It did not finish while the visitor was still reading.
    await expect(page.getByTestId('wsf-contribute-closed')).toBeVisible();
    expect(await authRecords(page)).not.toEqual([]);

    // ── AND THEN NOBODY TOUCHES IT ────────────────────────────────────────
    await passTheDeadline(page);
    // The SAME safe Finish: signed out first, then back to the start route.
    await expect
      .poll(async () => page.url(), { timeout: 40_000 })
      .toContain(`/kiosk/${fx.closedGoalId}`);
    expect(await authRecords(page), 'sign-out precedes the return to rest').toEqual([]);
  });

  test('a failed sign-out at the deadline stays protected and offers a retry', async ({ page }) => {
    test.setTimeout(300_000);
    await page.clock.install();
    const fx = await seedFixture('c');
    await signInVia(page, fx.email, fx.password);
    await page.goto(kioskUrl(fx.missingGoalId));
    await expect(page.getByTestId('wsf-contribute-not-found')).toBeVisible({ timeout: 40_000 });

    // Firebase Auth signs out by REMOVING its persisted user; only that
    // removal is made to fail.
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

    await passTheDeadline(page);
    await expect(page.getByTestId('wsf-kiosk-finish-error')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-kiosk-finish-error')).toHaveText(
      'We couldn’t sign you out. Don’t leave this device signed in — try Finish again.'
    );
    // It did NOT return to rest with the account still attached.
    expect(page.url()).toContain('/contribute/');
    expect(await authRecords(page)).not.toEqual([]);
    await expect(page.getByTestId('wsf-kiosk-finish')).toBeEnabled();
    await expectNoMemberEscape(page);
    await page.waitForTimeout(400);
    await saveFrame(page, frame('kiosk-not-found-signout-failed-tablet-800x1280.png'));
  });

  test('an unresolved attempt on a failed-load screen survives the deadline', async ({ page }) => {
    test.setTimeout(300_000);
    await page.clock.install();
    const fx = await seedFixture('d');
    await signInVia(page, fx.email, fx.password);

    // First make an attempt whose outcome nobody knows.
    await page.goto(kioskUrl(fx.goalId));
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });
    await page.getByTestId('wsf-contribute-entry').fill(String(ADDED));
    await page.getByTestId('wsf-contribute-review').click();
    await page.route('**/wsfContribute', (route: Route) => route.abort('failed'));
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
    expect(await pendingKeys(page)).toHaveLength(1);

    // Now the goal itself stops loading. THE ERROR BRANCH RETURNS BEFORE THE
    // PENDING ONE, so this is the screen that renders while an unresolved
    // attempt is still stored — and it is the case where finishing as `none`
    // would have cleared the member's reminder.
    await breakGoalLoad(page);
    await page.reload();
    await expect(page.getByTestId('wsf-contribute-load-error')).toBeVisible({ timeout: 40_000 });
    await expectFinishTreatment(page);
    // The live outcome travels with the screen: this is an unresolved session.
    await expect(page.getByTestId('wsf-kiosk-unresolved-note')).toBeVisible();
    await page.waitForTimeout(400);
    await saveFrame(page, frame('kiosk-load-error-with-unresolved-tablet-800x1280.png'));

    await passTheDeadline(page);
    await expect.poll(async () => page.url(), { timeout: 40_000 }).toContain('/kiosk/');
    expect(await authRecords(page), 'still signed out').toEqual([]);
    const kept = await pendingKeys(page);
    expect(kept, 'the unresolved reminder is the member’s, not the device’s').toHaveLength(1);
    expect(kept[0]).toContain(fx.uid);
    await page.unroute('**/wsfContribute');
  });

  test('an ordinary member on the same broken screens keeps their navigation and gets no timer', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.clock.install();
    const fx = await seedFixture('e');
    await signInVia(page, fx.email, fx.password);

    // The same three states WITHOUT the kiosk flag.
    await page.goto(`/contribute/${fx.missingGoalId}`);
    await expect(page.getByTestId('wsf-contribute-not-found')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-contribute-home')).toBeVisible();
    await expect(page.getByTestId('wsf-kiosk-finish-bar')).toHaveCount(0);
    await expect(page.getByTestId('wsf-member-tabs')).toBeVisible();

    await page.goto(`/contribute/${fx.closedGoalId}`);
    await expect(page.getByTestId('wsf-contribute-closed')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-contribute-back')).toBeVisible();
    await expect(page.getByTestId('wsf-kiosk-finish-bar')).toHaveCount(0);

    // And no amount of time takes a member off their own screen.
    await passTheDeadline(page);
    await expect(page.getByTestId('wsf-contribute-closed')).toBeVisible();
    expect(page.url()).toContain('/contribute/');
    expect(await authRecords(page), 'an ordinary member is never signed out by a timer').not.toEqual(
      []
    );
  });

  test('a request still in flight is never timed out from under the visitor', async ({ page }) => {
    test.setTimeout(300_000);
    await page.clock.install();
    const fx = await seedFixture('f');
    await signInVia(page, fx.email, fx.password);
    await page.goto(kioskUrl(fx.goalId));
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });

    // The entry screen has somebody standing at it: no deadline at all.
    await expect(page.getByTestId('wsf-kiosk-countdown')).toHaveCount(0);
    await passTheDeadline(page);
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible();
    expect(await authRecords(page)).not.toEqual([]);

    // Now a contribution that has left and not answered. Signing out from
    // under it is exactly how an outcome becomes unknowable.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/wsfContribute', async (route: Route) => {
      await held;
      await route.continue();
    });
    await page.getByTestId('wsf-contribute-entry').fill(String(ADDED));
    await page.getByTestId('wsf-contribute-review').click();
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-recording')).toBeVisible({ timeout: 40_000 });

    // No deadline while it is out, and none appears as time passes. 60 seconds
    // is deliberately inside the callable's own patience (the web SDK gives up
    // at 70), so this measures the kiosk's rule and not the network layer's.
    await expect(page.getByTestId('wsf-kiosk-countdown')).toHaveCount(0);
    await page.clock.runFor(60_000);
    await expect(page.getByTestId('wsf-contribute-recording')).toBeVisible();
    await expect(page.getByTestId('wsf-kiosk-countdown')).toHaveCount(0);
    expect(page.url()).toContain('/contribute/');
    expect(await authRecords(page), 'in flight is never a rest state').not.toEqual([]);

    // Let it land, and the ordinary receipt deadline takes over as before.
    release();
    await expect(page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-kiosk-countdown')).toHaveText(/^Finishing in \d+ seconds?$/);
    await page.unroute('**/wsfContribute');
  });

  test('when the client itself gives up on a request, the session becomes unresolved rather than timing out', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await page.clock.install();
    const fx = await seedFixture('g');
    await signInVia(page, fx.email, fx.password);
    await page.goto(kioskUrl(fx.goalId));
    await expect(page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({ timeout: 40_000 });

    // Measured rather than assumed: this is what a request held past the web
    // SDK's own 70-second patience actually does. It is the boundary between
    // "in flight" and "nobody knows", and the kiosk has to hand over cleanly
    // at it — the session must not have been ended underneath the request.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/wsfContribute', async (route: Route) => {
      await held;
      // By the time this resolves the client has usually abandoned the request
      // itself -- which is the condition under test, not a problem with it.
      await route.abort('failed').catch(() => {});
    });
    await page.getByTestId('wsf-contribute-entry').fill(String(ADDED));
    await page.getByTestId('wsf-contribute-review').click();
    await page.getByTestId('wsf-contribute-submit').click();
    await expect(page.getByTestId('wsf-contribute-recording')).toBeVisible({ timeout: 40_000 });

    await page.clock.runFor(IDLE_MS + 5_000);
    // The client gave up: the attempt is now UNRESOLVED, which is a rest state,
    // so it carries the ordinary deadline — a fresh one, not a backdated one
    // that would finish immediately and hide the outcome from the visitor.
    await expect(page.getByTestId('wsf-contribute-pending')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByTestId('wsf-kiosk-unresolved-note')).toBeVisible();
    const left = Number(
      /(\d+)/.exec(await page.getByTestId('wsf-kiosk-countdown').innerText())?.[1] ?? '0'
    );
    expect(left, 'the unresolved screen gets a whole deadline of its own').toBeGreaterThan(30);
    // Still signed in, and the reminder is stored.
    expect(await authRecords(page)).not.toEqual([]);
    expect(await pendingKeys(page)).toHaveLength(1);
    release();
    await page.unroute('**/wsfContribute');
  });
});
