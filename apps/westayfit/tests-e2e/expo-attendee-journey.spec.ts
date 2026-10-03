/**
 * EXPO-ATTENDEE-JOURNEY-PROOF-1 — the attendee's journey at an expo, proved
 * against the EXISTING queue/turn system and nothing else.
 *
 * Every device is its own browser context: three phones and two hall
 * screens share nothing but the server. Every claim a screen makes is also
 * checked against the store that holds the truth — the turn entries, the
 * contribution ledger and the ten counter shards — because "the screen said
 * 105" and "105 was recorded once each" are different sentences.
 *
 * EMULATOR ONLY. Synthetic fixtures only (helpers/expo-attendee-fixtures.ts):
 * every name is labelled "Fixture", every address is under example.com, and
 * every starting total is a SEEDED total, never anybody's effort.
 *
 * NOT PROVED HERE, and not claimed: a mailbox, a printed QR, kiosk hardware,
 * Safari or a native build, a hosted environment, or how any of it feels.
 */
import { expect, test, type Page, type Route } from '@playwright/test';

import {
  callAs,
  contributionsOf,
  firestorePatch,
  goalCrossing,
  joinLineFromEventPage,
  lapseLease,
  openEnrolledStation,
  openPhone,
  pageText,
  seedAccount,
  seedExpoEvent,
  shardTotal,
  turnEntriesOf,
} from './helpers/expo-attendee-fixtures';
import { firestoreWrite, tsField } from './helpers/mobile';

// Five contexts, two of them polling every two seconds, through whole turns.
// The waits inside are the product's own (a 2s hall poll, a 3s phone poll);
// the budget is sized to the work, not the other way round.
test.describe.configure({ timeout: 300_000 });

const TURN_CODE = /^[A-HJ-NP-Z2-9]{3}$/;
const PRODUCT_SENTENCES_FOR_A_LOST_ANSWER = [
  'That didn’t go through. Try again.',
  'We couldn’t reach the server. Check your connection and try again.',
];
const NO_SHOW_MESSAGE =
  'The screen called you and the 45 seconds ran out, so it moved on. Get back in line and it will call you again.';

async function callNext(station: Page, expectedName: string): Promise<string> {
  await station.getByTestId('wsf-station-call-next').click();
  await expect(station.getByTestId('wsf-station-queue-serving')).toHaveText(expectedName, {
    timeout: 25_000,
  });
  const code = (await station.getByTestId('wsf-station-queue-code').innerText()).trim();
  expect(code).toMatch(TURN_CODE);
  return code;
}

async function expectHallSaysNothingAbout(station: Page, secrets: string[], where: string) {
  const text = await pageText(station);
  const html = await station.content();
  for (const s of secrets) {
    expect(text, `${where} must not read "${s}"`).not.toContain(s);
    expect(html, `${where} must not carry "${s}"`).not.toContain(s);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// J1 — one attendee on their own phone and two at two stations, all at once.
// ─────────────────────────────────────────────────────────────────────────────

test('one attendee chooses their phone, two take equivalent station turns, and all three land once each on the exact Living WE total', async ({
  browser,
}) => {
  // Seeded 40 of 100. 15 (phone) + 20 (Station 1) + 30 (Station 2) = 105:
  // only the last of the three to commit can cross, so the crossing and the
  // 5-over overshoot are both exact whatever order they land in.
  const fx = await seedExpoEvent({
    tag: 'j1',
    attendees: [
      'Fixture Phone Attendee',
      'Fixture Station Attendee One',
      'Fixture Station Attendee Two',
    ],
    target: 100,
    seededTotal: 40,
  });
  const [onPhone, atOne, atTwo] = fx.attendees as [
    (typeof fx.attendees)[number],
    (typeof fx.attendees)[number],
    (typeof fx.attendees)[number],
  ];
  const nameOne = 'Fixture B';
  const nameTwo = 'Fixture C';

  const [s1, s2] = await Promise.all([
    openEnrolledStation(browser, fx, 1),
    openEnrolledStation(browser, fx, 2),
  ]);
  const [pA, pB, pC] = await Promise.all([
    openPhone(browser, onPhone),
    openPhone(browser, atOne),
    openPhone(browser, atTwo),
  ]);
  try {
    for (const s of [s1, s2]) {
      await expect(s.page.getByTestId('wsf-station-queue-count')).toHaveText('Nobody is waiting.', {
        timeout: 25_000,
      });
    }

    // ---- THE PHONE CHOICE. Opening the event and choosing "Use my phone"
    // lands on the ordinary contribution screen and puts nobody in a line.
    await pA.page.goto(`/event/${fx.goalId}`);
    await expect(pA.page.getByTestId('wsf-event-device-choice')).toBeVisible({ timeout: 40_000 });
    await pA.page.getByTestId('wsf-device-choice-personal').click();
    await expect(pA.page.getByTestId('wsf-event-member')).toBeVisible({ timeout: 40_000 });
    await expect(pA.page.getByTestId('wsf-event-choice-activity')).toHaveText('squats');
    await pA.page.getByTestId('wsf-event-add').click();
    await expect(pA.page.getByTestId('wsf-contribute-entry-screen')).toBeVisible({
      timeout: 40_000,
    });
    expect(new URL(pA.page.url()).pathname).toBe(`/contribute/${fx.goalId}`);
    await expect(pA.page.getByTestId('wsf-kiosk-finish')).toHaveCount(0);
    expect(
      await turnEntriesOf(fx.goalId, onPhone.uid),
      'the phone path makes no queue row',
    ).toEqual([]);

    // ---- DELIBERATE QUEUE ENTRY ONLY. Opening the event page, answering the
    // device question and seeing "Join the kiosk queue" is not joining it.
    await pB.page.goto(`/event/${fx.goalId}`);
    await expect(pB.page.getByTestId('wsf-event-device-choice')).toBeVisible({ timeout: 40_000 });
    await pB.page.getByTestId('wsf-device-choice-personal').click();
    await expect(pB.page.getByTestId('wsf-event-queue-start')).toBeVisible({ timeout: 40_000 });
    await pB.page.getByTestId('wsf-event-queue-start').click();
    await expect(pB.page.getByTestId('wsf-event-queue-name')).toBeVisible();
    expect(
      await turnEntriesOf(fx.goalId, atOne.uid),
      'opening the name control is not joining',
    ).toEqual([]);
    // The hall polls every 2s; three polls later it still counts nobody.
    await s1.page.waitForTimeout(6_000);
    await expect(s1.page.getByTestId('wsf-station-queue-count')).toHaveText('Nobody is waiting.');

    // The one tap that does join, for each of them, in order.
    await joinLineFromEventPage(pB.page, fx.goalId, nameOne);
    await joinLineFromEventPage(pC.page, fx.goalId, nameTwo);
    for (const s of [s1, s2]) {
      await expect(s.page.getByTestId('wsf-station-queue-count')).toHaveText('2 people waiting.', {
        timeout: 25_000,
      });
      await expectHallSaysNothingAbout(
        s.page,
        [nameOne, nameTwo, atOne.displayName, atTwo.displayName, atOne.uid, atTwo.uid],
        `${s.label} while two wait`,
      );
    }

    // ---- TWO EQUIVALENT STATIONS, each calling the next person in line.
    const codeOne = await callNext(s1.page, nameOne);
    await expect(s2.page.getByTestId('wsf-station-queue-count')).toHaveText('1 person waiting.', {
      timeout: 25_000,
    });
    const codeTwo = await callNext(s2.page, nameTwo);
    expect(codeOne, 'two people called at one event never share a code').not.toBe(codeTwo);

    // ---- CORRECT-PERSON CONFIRMATION. Each phone carries ITS OWN station's
    // code and station, and never the other's.
    await expect(pB.page.getByTestId('wsf-queue-called')).toBeVisible({ timeout: 25_000 });
    await expect(pB.page.getByTestId('wsf-queue-code')).toHaveText(codeOne);
    await expect(pB.page.getByTestId('wsf-queue-station')).toHaveText('Go to Station 1.');
    await expect(pC.page.getByTestId('wsf-queue-called')).toBeVisible({ timeout: 25_000 });
    await expect(pC.page.getByTestId('wsf-queue-code')).toHaveText(codeTwo);
    await expect(pC.page.getByTestId('wsf-queue-station')).toHaveText('Go to Station 2.');

    // A call is an offer. Neither station can start anybody yet; the second
    // attendee's "I'm ready" opens Station 2 and leaves Station 1 shut.
    await expect(s1.page.getByTestId('wsf-station-turn-action')).toBeDisabled();
    await expect(s2.page.getByTestId('wsf-station-turn-action')).toBeDisabled();
    await pC.page.getByTestId('wsf-queue-ready').click();
    await expect(s2.page.getByTestId('wsf-station-turn-action')).toBeEnabled({ timeout: 25_000 });
    await s1.page.waitForTimeout(4_000);
    await expect(s1.page.getByTestId('wsf-station-turn-action')).toBeDisabled();
    await pB.page.getByTestId('wsf-queue-ready').click();
    await expect(s1.page.getByTestId('wsf-station-turn-action')).toBeEnabled({ timeout: 25_000 });

    await s1.page.getByTestId('wsf-station-turn-action').click();
    await s2.page.getByTestId('wsf-station-turn-action').click();
    await expect(s1.page.getByTestId('wsf-station-turn-record')).toBeVisible({ timeout: 25_000 });
    await expect(s2.page.getByTestId('wsf-station-turn-record')).toBeVisible({ timeout: 25_000 });

    // ---- AUTHORITATIVE BINDING, from the store: person, movement, goal,
    // station and the one attempt the station minted.
    const [eB] = await turnEntriesOf(fx.goalId, atOne.uid);
    const [eC] = await turnEntriesOf(fx.goalId, atTwo.uid);
    for (const [e, code, label] of [
      [eB, codeOne, 'Station 1'],
      [eC, codeTwo, 'Station 2'],
    ] as const) {
      expect(e).toBeTruthy();
      expect(e!.status).toBe('active');
      expect(e!.goalId).toBe(fx.goalId);
      expect(e!.activityUnit).toBe('squats');
      expect(e!.code).toBe(code);
      expect(e!.assignedStationLabel).toBe(label);
      expect(e!.attemptStationId).toBe(e!.assignedStationId);
      expect(e!.attemptId).toMatch(/^turn_/);
    }
    expect(eB!.assignedStationId).not.toBe(eC!.assignedStationId);
    expect(eB!.attemptId).not.toBe(eC!.attemptId);

    // ---- ALL THREE AT ONCE. The phone records 15 while Station 1 records 20
    // and Station 2 records 30.
    await pA.page.getByTestId('wsf-contribute-entry').fill('15');
    await pA.page.getByTestId('wsf-contribute-review').click();
    await expect(pA.page.getByTestId('wsf-contribute-submit')).toBeVisible({ timeout: 15_000 });
    await s1.page.getByTestId('wsf-station-turn-count').fill('20');
    await s2.page.getByTestId('wsf-station-turn-count').fill('30');
    await expect(s1.page.getByTestId('wsf-station-turn-action')).toHaveText('Record this turn');
    await expect(s2.page.getByTestId('wsf-station-turn-action')).toHaveText('Record this turn');
    await Promise.all([
      pA.page.getByTestId('wsf-contribute-submit').click(),
      s1.page.getByTestId('wsf-station-turn-action').click(),
      s2.page.getByTestId('wsf-station-turn-action').click(),
    ]);

    await expect(pA.page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
    await expect(pA.page.getByTestId('wsf-contribute-result-amount')).toContainText('15');
    await expect(s1.page.getByTestId('wsf-station-queue-result')).toContainText(codeOne, {
      timeout: 25_000,
    });
    await expect(s1.page.getByTestId('wsf-station-queue-result')).toContainText(
      '20 squats recorded.',
    );
    await expect(s2.page.getByTestId('wsf-station-queue-result')).toContainText(codeTwo, {
      timeout: 25_000,
    });
    await expect(s2.page.getByTestId('wsf-station-queue-result')).toContainText(
      '30 squats recorded.',
    );
    await expect(pB.page.getByTestId('wsf-queue-receipt-amount')).toHaveText(
      '20 squats recorded.',
      {
        timeout: 30_000,
      },
    );
    await expect(pC.page.getByTestId('wsf-queue-receipt-amount')).toHaveText(
      '30 squats recorded.',
      {
        timeout: 30_000,
      },
    );

    // ---- THE LEDGER: one contribution each, bound to the right person and,
    // for a turn, to exactly the attempt its station minted.
    const [cA, cB, cC] = await Promise.all([
      contributionsOf(fx.goalId, onPhone.uid),
      contributionsOf(fx.goalId, atOne.uid),
      contributionsOf(fx.goalId, atTwo.uid),
    ]);
    expect(cA.map((c) => c.count)).toEqual([15]);
    expect(cA[0]!.attemptId).not.toMatch(/^turn_/);
    expect(cB.map((c) => c.count)).toEqual([20]);
    expect(cB[0]!.attemptId).toBe(eB!.attemptId);
    expect(cC.map((c) => c.count)).toEqual([30]);
    expect(cC[0]!.attemptId).toBe(eC!.attemptId);
    for (const c of [...cA, ...cB, ...cC]) {
      expect(c.unit).toBe('squats');
      expect(c.goalId).toBe(fx.goalId);
      expect(c.crossedTarget, 'no single attempt is credited with the crossing').toBe(false);
    }
    const doneB = (await turnEntriesOf(fx.goalId, atOne.uid))[0]!;
    const doneC = (await turnEntriesOf(fx.goalId, atTwo.uid))[0]!;
    expect([doneB.status, doneB.resultAmount]).toEqual(['done', 20]);
    expect([doneC.status, doneC.resultAmount]).toEqual(['done', 30]);
    expect(await turnEntriesOf(fx.goalId, onPhone.uid)).toEqual([]);

    // ---- EXACT LIVING WE PROGRESS: 40 seeded + 65 = 105, crossing once.
    expect(await shardTotal(fx.goalId)).toBe(105);
    const crossing = await goalCrossing(fx.goalId);
    expect(crossing.reachedAt, 'the target crossing is recorded').not.toBeNull();
    expect(crossing.reachedSharedTotal).toBe(105);
    expect(crossing.reachedAttemptId ?? null).toBeNull();

    // Both hall screens converge on the same number, overshoot kept.
    for (const s of [s1, s2]) {
      await expect(s.page.getByTestId('wsf-station-total-line')).toHaveText('105 of 100 squats', {
        timeout: 30_000,
      });
      await expect(s.page.getByTestId('wsf-station-percent')).toHaveText('100% complete');
      await expect(s.page.getByTestId('wsf-station-status')).toHaveText(
        '5 beyond our goal · still open',
      );
    }
    // And so does the phone that took the other path, read fresh.
    await pA.page.goto(`/contribute/${fx.goalId}`);
    await expect(pA.page.getByTestId('wsf-contribute-shared-total').first()).toContainText('105', {
      timeout: 30_000,
    });

    // ---- FINISH/RESET: the hall keeps no identity once the turns are done.
    for (const s of [s1, s2]) {
      await expect(s.page.getByTestId('wsf-station-queue-result')).toHaveCount(0, {
        timeout: 30_000,
      });
      await expect(s.page.getByTestId('wsf-station-queue-serving-empty')).toBeVisible({
        timeout: 25_000,
      });
      await expectHallSaysNothingAbout(
        s.page,
        [nameOne, nameTwo, codeOne, codeTwo, atOne.uid, atTwo.uid, onPhone.uid],
        `${s.label} after the turns`,
      );
      s.assertNoCrash(s.label);
    }
    for (const d of [pA, pB, pC]) d.assertNoCrash('an attendee phone');
  } finally {
    await Promise.all([s1, s2, pA, pB, pC].map((d) => d.context.close()));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// J2 — the station's Record lands but its answer is lost; the phone is offline.
// ─────────────────────────────────────────────────────────────────────────────

test('a station whose Record answer is lost retries and counts once, and an offline phone comes back to the truth', async ({
  browser,
}) => {
  const fx = await seedExpoEvent({
    tag: 'j2',
    attendees: ['Fixture Retry Attendee'],
    target: 1000,
    seededTotal: 100,
  });
  const [who] = fx.attendees as [(typeof fx.attendees)[number]];
  const station = await openEnrolledStation(browser, fx, 1);
  const phone = await openPhone(browser, who);
  try {
    await joinLineFromEventPage(phone.page, fx.goalId, 'Fixture R');
    const code = await callNext(station.page, 'Fixture R');
    await expect(phone.page.getByTestId('wsf-queue-code')).toHaveText(code, { timeout: 25_000 });
    await phone.page.getByTestId('wsf-queue-ready').click();
    await expect(station.page.getByTestId('wsf-station-turn-action')).toBeEnabled({
      timeout: 25_000,
    });
    await station.page.getByTestId('wsf-station-turn-action').click();
    await expect(station.page.getByTestId('wsf-station-turn-record')).toBeVisible({
      timeout: 25_000,
    });
    const [entry] = await turnEntriesOf(fx.goalId, who.uid);

    // The phone loses its connection for the rest of the turn.
    await phone.context.setOffline(true);

    // The hall's network drops too: its polls fail (it keeps showing what it
    // last confirmed), and its FIRST Record reaches the server but the answer
    // never comes back.
    await station.page.route('**/wsfTurnState', (route: Route) =>
      route.abort('internetdisconnected'),
    );
    let completes = 0;
    await station.page.route('**/wsfCompleteTurn', async (route: Route) => {
      completes += 1;
      if (completes === 1) {
        await route.fetch();
        await route.abort('connectionreset');
        return;
      }
      await route.continue();
    });

    await station.page.getByTestId('wsf-station-turn-count').fill('25');
    await station.page.getByTestId('wsf-station-turn-action').click();
    // The screen knows the answer never came. (WHAT it says about that is J2b's
    // subject, kept apart so this proof of counting-once is not hostage to it.)
    await expect(station.page.getByTestId('wsf-station-queue-error')).toBeVisible({
      timeout: 25_000,
    });
    // It DID go through: the server recorded it once.
    expect((await contributionsOf(fx.goalId, who.uid)).map((c) => c.count)).toEqual([25]);
    expect(await shardTotal(fx.goalId)).toBe(125);
    // The screen still offers the same turn, with the same count, to retry.
    await expect(station.page.getByTestId('wsf-station-turn-count')).toHaveValue('25');

    // The pending truth on the phone: offline, it claims nothing it has not
    // been told.
    await expect(phone.page.getByTestId('wsf-queue-receipt-amount')).toHaveCount(0);

    const retried = station.page.waitForResponse((r) => r.url().includes('wsfCompleteTurn'));
    await station.page.getByTestId('wsf-station-turn-action').click();
    const answer = (await (await retried).json()) as {
      result?: { recorded?: { amount: number; alreadyRecorded: boolean } };
    };
    expect(answer.result?.recorded).toEqual(
      expect.objectContaining({ amount: 25, alreadyRecorded: true }),
    );
    await expect(station.page.getByTestId('wsf-station-queue-result')).toContainText(
      '25 squats recorded.',
      { timeout: 25_000 },
    );
    expect(completes).toBe(2);

    // ONCE: one contribution, the station's own attempt, 100 + 25.
    const ledger = await contributionsOf(fx.goalId, who.uid);
    expect(ledger.map((c) => [c.count, c.attemptId])).toEqual([[25, entry!.attemptId]]);
    expect(await shardTotal(fx.goalId)).toBe(125);

    // Back online, both screens settle on the same truth.
    await station.page.unroute('**/wsfTurnState');
    await phone.context.setOffline(false);
    await expect(phone.page.getByTestId('wsf-queue-receipt-amount')).toHaveText(
      '25 squats recorded.',
      {
        timeout: 40_000,
      },
    );
    await expect(station.page.getByTestId('wsf-station-total-line')).toHaveText(
      '125 of 1,000 squats',
      {
        timeout: 30_000,
      },
    );
    expect(await shardTotal(fx.goalId)).toBe(125);
    expect(await contributionsOf(fx.goalId, who.uid)).toHaveLength(1);
    station.assertNoCrash('the station');
  } finally {
    await Promise.all([station.context.close(), phone.context.close()]);
  }
});

/**
 * J2b — WHAT A HALL SCREEN SAYS WHEN AN ANSWER IS LOST.
 *
 * The station's own contract (app/station/[goalId].tsx, runTurnAction): "No
 * code, no identifier and no vendor string on a screen in a room", with
 * "That didn’t go through. Try again." as the sentence for a failure that is
 * not the product's own refusal. A request that never gets an answer is the
 * commonest failure a hall has. The smallest reproduction: one "Call next"
 * whose network drops.
 */
test('a station action whose answer is lost says so in the product’s words, never a vendor code', async ({
  browser,
}) => {
  const fx = await seedExpoEvent({ tag: 'j2b', attendees: [], target: 100, seededTotal: 0 });
  const station = await openEnrolledStation(browser, fx, 1);
  try {
    await station.page.route('**/wsfCallNext', (route: Route) =>
      route.abort('internetdisconnected'),
    );
    await station.page.getByTestId('wsf-station-call-next').click();
    const error = station.page.getByTestId('wsf-station-queue-error');
    await expect(error).toBeVisible({ timeout: 25_000 });
    const said = (await error.innerText()).trim();
    console.log(`[J2b] the hall printed: ${JSON.stringify(said)}`);
    // Either product sentence is an honest answer: the station's own fallback,
    // or the app-wide connectivity sentence src/callableErrors.ts gives every
    // other screen for exactly this failure. A bare SDK code is not.
    expect(PRODUCT_SENTENCES_FOR_A_LOST_ANSWER, 'the hall must say a product sentence').toContain(
      said,
    );
    expect(await pageText(station.page)).not.toMatch(/\binternal\b/);
  } finally {
    await station.context.close();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// J3 — the three ways a place ends without a turn being recorded.
// ─────────────────────────────────────────────────────────────────────────────

test('switching to the phone gives the place up, a lapsed call is a no-show, and a station can let somebody go — none of them records anything', async ({
  browser,
}) => {
  const fx = await seedExpoEvent({
    tag: 'j3',
    attendees: ['Fixture Switch Attendee', 'Fixture Absent Attendee', 'Fixture Released Attendee'],
    target: 1000,
    seededTotal: 0,
  });
  const [switcher, absent, released] = fx.attendees as [
    (typeof fx.attendees)[number],
    (typeof fx.attendees)[number],
    (typeof fx.attendees)[number],
  ];
  const station = await openEnrolledStation(browser, fx, 1);
  const [pS, pN, pR] = await Promise.all([
    openPhone(browser, switcher),
    openPhone(browser, absent),
    openPhone(browser, released),
  ]);
  try {
    // ---- GIVING UP A PLACE BY SWITCHING TO THE PHONE --------------------
    await joinLineFromEventPage(pS.page, fx.goalId, 'Fixture S');
    await expect(station.page.getByTestId('wsf-station-queue-count')).toHaveText(
      '1 person waiting.',
      {
        timeout: 25_000,
      },
    );
    await pS.page.getByTestId('wsf-queue-switch-to-phone').click();
    await pS.page.waitForURL(new RegExp(`/contribute/${fx.goalId}`), { timeout: 30_000 });
    await expect(pS.page.getByTestId('wsf-contribute-screen')).toBeVisible({ timeout: 30_000 });
    await expect(station.page.getByTestId('wsf-station-queue-count')).toHaveText(
      'Nobody is waiting.',
      {
        timeout: 25_000,
      },
    );
    const [left] = await turnEntriesOf(fx.goalId, switcher.uid);
    expect([left!.status, left!.endedBy]).toEqual(['left', 'memberToPhone']);
    // The phone they switched to records like any phone.
    await pS.page.getByTestId('wsf-contribute-entry').fill('10');
    await pS.page.getByTestId('wsf-contribute-review').click();
    await pS.page.getByTestId('wsf-contribute-submit').click();
    await expect(pS.page.getByTestId('wsf-contribute-receipt')).toBeVisible({ timeout: 30_000 });
    expect((await contributionsOf(fx.goalId, switcher.uid)).map((c) => c.count)).toEqual([10]);

    // ---- A CALL NOBODY ANSWERS: the 45 seconds run out --------------------
    await joinLineFromEventPage(pN.page, fx.goalId, 'Fixture N');
    await callNext(station.page, 'Fixture N');
    await expect(pN.page.getByTestId('wsf-queue-called')).toBeVisible({ timeout: 25_000 });
    const [called] = await turnEntriesOf(fx.goalId, absent.uid);
    await lapseLease(called!.id);
    await expect(pN.page.getByTestId('wsf-queue-not-in-line-reason')).toHaveText(NO_SHOW_MESSAGE, {
      timeout: 30_000,
    });
    await expect(station.page.getByTestId('wsf-station-queue-serving-empty')).toBeVisible({
      timeout: 25_000,
    });
    await expect(station.page.getByTestId('wsf-station-turn-action')).toHaveCount(0);

    // ---- A STATION LETTING SOMEBODY GO -----------------------------------
    await joinLineFromEventPage(pR.page, fx.goalId, 'Fixture L');
    await callNext(station.page, 'Fixture L');
    // The call that moved on from the lapsed one is what records the no-show.
    const [noShow] = await turnEntriesOf(fx.goalId, absent.uid);
    expect([noShow!.status, noShow!.endedBy]).toEqual(['noShow', 'lease']);
    await expect(pR.page.getByTestId('wsf-queue-called')).toBeVisible({ timeout: 25_000 });
    await pR.page.getByTestId('wsf-queue-ready').click();
    await expect(station.page.getByTestId('wsf-station-turn-action')).toBeEnabled({
      timeout: 25_000,
    });
    await station.page.getByTestId('wsf-station-turn-cancel').click();
    await expect(station.page.getByTestId('wsf-station-queue-serving-empty')).toBeVisible({
      timeout: 25_000,
    });
    await expect(pR.page.getByTestId('wsf-queue-not-in-line')).toBeVisible({ timeout: 30_000 });
    await expect(pR.page.getByTestId('wsf-queue-receipt-amount')).toHaveCount(0);
    const [let_go] = await turnEntriesOf(fx.goalId, released.uid);
    expect([let_go!.status, let_go!.endedBy]).toEqual(['left', 'station']);

    // Nothing was recorded for either of them, and the total is only the
    // switched phone's 10.
    expect(await contributionsOf(fx.goalId, absent.uid)).toEqual([]);
    expect(await contributionsOf(fx.goalId, released.uid)).toEqual([]);
    expect(await shardTotal(fx.goalId)).toBe(10);
    await expectHallSaysNothingAbout(
      station.page,
      ['Fixture S', 'Fixture N', 'Fixture L', switcher.uid, absent.uid, released.uid],
      'the station after all three',
    );
    station.assertNoCrash('the station');
  } finally {
    await Promise.all([station, pS, pN, pR].map((d) => d.context.close()));
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// J4 — a goal that closes while a turn is running.
// ─────────────────────────────────────────────────────────────────────────────

test('a goal closed mid-turn refuses the station’s Record and records nothing', async ({
  browser,
}) => {
  const fx = await seedExpoEvent({
    tag: 'j4',
    attendees: ['Fixture Late Attendee'],
    target: 1000,
    seededTotal: 200,
  });
  const [who] = fx.attendees as [(typeof fx.attendees)[number]];
  const station = await openEnrolledStation(browser, fx, 1);
  const phone = await openPhone(browser, who);
  try {
    await joinLineFromEventPage(phone.page, fx.goalId, 'Fixture Z');
    await callNext(station.page, 'Fixture Z');
    await expect(phone.page.getByTestId('wsf-queue-called')).toBeVisible({ timeout: 25_000 });
    await phone.page.getByTestId('wsf-queue-ready').click();
    await expect(station.page.getByTestId('wsf-station-turn-action')).toBeEnabled({
      timeout: 25_000,
    });
    await station.page.getByTestId('wsf-station-turn-action').click();
    await expect(station.page.getByTestId('wsf-station-turn-record')).toBeVisible({
      timeout: 25_000,
    });

    // FIXTURE: the goal is closed in the store, as a closure would leave it.
    await firestorePatch(`wsfGoals/${fx.goalId}`, {
      status: { stringValue: 'closed' },
      updatedAt: tsField(new Date()),
    });

    await station.page.getByTestId('wsf-station-turn-count').fill('12');
    await station.page.getByTestId('wsf-station-turn-action').click();
    await expect(station.page.getByTestId('wsf-station-queue-error')).toHaveText(
      'This goal is closed.',
      {
        timeout: 25_000,
      },
    );
    expect(await contributionsOf(fx.goalId, who.uid)).toEqual([]);
    expect(await shardTotal(fx.goalId)).toBe(200);
    await expect(phone.page.getByTestId('wsf-queue-receipt-amount')).toHaveCount(0);
    station.assertNoCrash('the station');
  } finally {
    await Promise.all([station.context.close(), phone.context.close()]);
  }
});

/**
 * J4b — WHAT THE LINE DOES ON A GOAL THAT IS ALREADY CLOSED.
 *
 * An OBSERVATION, not a pass: no current requirement says whether the line
 * should refuse a closed goal at join, call or start (only recording is
 * required to refuse, which J4 proves). What each step does is written to the
 * test's annotations and to the QA report as found, so the gap — if it is one
 * — is a decision for the owner and not something this packet settles.
 */
test('observation: joining, calling and starting a turn on a goal that is already closed', async ({
  browser,
}) => {
  const fx = await seedExpoEvent({
    tag: 'j4b',
    attendees: ['Fixture Closed-Goal Attendee'],
    target: 1000,
    seededTotal: 0,
  });
  const [who] = fx.attendees as [(typeof fx.attendees)[number]];
  const station = await openEnrolledStation(browser, fx, 1);
  try {
    await firestorePatch(`wsfGoals/${fx.goalId}`, {
      status: { stringValue: 'closed' },
      updatedAt: tsField(new Date()),
    });
    const join = await callAs<{ entryId: string }>(who.email, 'wsfJoinTurnLine', {
      goalId: fx.goalId,
      calledName: 'Fixture Q',
    });
    test
      .info()
      .annotations.push({
        type: 'observed:join-on-closed-goal',
        description: JSON.stringify(join),
      });
    console.log(`[J4b] join on a closed goal: ${JSON.stringify(join)}`);
    if (join.ok) {
      await expect(station.page.getByTestId('wsf-station-queue-count')).toHaveText(
        '1 person waiting.',
        {
          timeout: 25_000,
        },
      );
      await station.page.getByTestId('wsf-station-call-next').click();
      const served = station.page.getByTestId('wsf-station-queue-serving');
      const refused = station.page.getByTestId('wsf-station-queue-error');
      await expect(served.or(refused)).toBeVisible({ timeout: 25_000 });
      const called = (await served.count()) > 0 ? await served.innerText() : null;
      const callObserved = called ? `called "${called}"` : `refused: ${await refused.innerText()}`;
      test
        .info()
        .annotations.push({ type: 'observed:call-on-closed-goal', description: callObserved });
      console.log(`[J4b] call next on a closed goal: ${callObserved}`);
      const ready = await callAs(who.email, 'wsfTurnReady', { entryId: join.result.entryId });
      test
        .info()
        .annotations.push({
          type: 'observed:ready-on-closed-goal',
          description: JSON.stringify(ready),
        });
      console.log(`[J4b] ready on a closed goal: ${JSON.stringify(ready)}`);
      if (ready.ok && called) {
        const action = station.page.getByTestId('wsf-station-turn-action');
        await expect(action).toBeEnabled({ timeout: 25_000 });
        await action.click();
        const record = station.page.getByTestId('wsf-station-turn-record');
        await expect(record.or(refused)).toBeVisible({ timeout: 25_000 });
        const startObserved =
          (await record.count()) > 0
            ? 'started: the count box is up'
            : `refused: ${await refused.innerText()}`;
        test
          .info()
          .annotations.push({ type: 'observed:start-on-closed-goal', description: startObserved });
        console.log(`[J4b] start on a closed goal: ${startObserved}`);
      }
    }
    // Whatever the line did, nothing was recorded against a closed goal.
    expect(await contributionsOf(fx.goalId, who.uid)).toEqual([]);
    expect(await shardTotal(fx.goalId)).toBe(0);
    station.assertNoCrash('the station');

    // And what the attendee's own event page offers on a closed goal — a
    // second account, so the place taken above does not colour the answer.
    const second = await seedAccount(
      `wsf-expo-att-closed-${fx.stamp}@example.com`,
      'Fixture Second Closed-Goal Attendee',
    );
    await firestoreWrite(`wsfMemberships/${fx.groupId}_${second.uid}`, {
      groupId: { stringValue: fx.groupId },
      userId: { stringValue: second.uid },
      role: { stringValue: 'member' },
      membershipStatus: { stringValue: 'active' },
      createdAt: tsField(new Date()),
      updatedAt: tsField(new Date()),
    });
    const phone = await openPhone(browser, second);
    try {
      await phone.page.goto(`/event/${fx.goalId}`);
      await expect(phone.page.getByTestId('wsf-event-device-choice')).toBeVisible({
        timeout: 40_000,
      });
      await phone.page.getByTestId('wsf-device-choice-personal').click();
      const offered = phone.page.getByTestId('wsf-event-queue-start');
      const settled = phone.page
        .getByTestId('wsf-event-member')
        .or(phone.page.getByTestId('wsf-event-not-member'))
        .or(phone.page.getByTestId('wsf-event-error'));
      await expect(settled.first()).toBeVisible({ timeout: 40_000 });
      const pageObserved =
        `event page settled on ${await settled.first().getAttribute('data-testid')}; ` +
        `"Join the kiosk queue" offered: ${(await offered.count()) > 0}; ` +
        `"Use my phone" offered: ${(await phone.page.getByTestId('wsf-event-add').count()) > 0}`;
      test
        .info()
        .annotations.push({
          type: 'observed:event-page-on-closed-goal',
          description: pageObserved,
        });
      console.log(`[J4b] ${pageObserved}`);
    } finally {
      await phone.context.close();
    }
  } finally {
    await station.context.close();
  }
});
