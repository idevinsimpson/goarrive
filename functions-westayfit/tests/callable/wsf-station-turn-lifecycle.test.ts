/**
 * KIOSK-TURN-LIFECYCLE-1 — the turn line around a revoked screen, and around
 * a member whose contribution is already recorded.
 *
 * 1. REVOKING A STATION GIVES ITS TURN BACK TO THE LINE. Before this packet a
 *    Champion could revoke a screen while it held somebody's turn, and the
 *    entry stayed `assigned`, `ready` or `active` on a screen that no longer
 *    existed. `ready` and `active` never lapse, so the person's phone kept
 *    saying "walk to Station 1" for the rest of the event, and their one place
 *    at the event was held by a turn nobody could run. Now the revoke, in its
 *    own transaction:
 *      - returns an assigned, ready or active turn to `waiting`, at the
 *        position it already had, so the next screen at the event calls that
 *        person first; a started-but-unrecorded attempt is dropped;
 *      - closes a lease that had already lapsed as the no-show it is;
 *      - leaves a finished turn, the waiting line and every other screen's
 *        turn exactly as they were;
 *      - clears the revoked screen's pointer, so no name stays on it.
 *    `wsfMyTurn` and the remaining screens' `wsfTurnState` report it at once.
 *
 * 2. A MEMBER WHOSE CONTRIBUTION IS ALREADY RECORDED IS NOT PUT IN LINE.
 *    Under a goal that takes one contribution from each member, the line used
 *    to take the member's place anyway, call them, start them, and only refuse
 *    at the very end. `wsfJoinTurnLine` now refuses at the door, with the
 *    sentence the contribution itself gives, from the same evidence.
 *
 * All fixtures are synthetic and local to the demo-wsf-local emulator.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  wsfApproveStation,
  wsfCallNext,
  wsfCompleteMyTurn,
  wsfCompleteTurn,
  wsfContribute,
  wsfCreateCombinedGoal,
  wsfJoinTurnLine,
  wsfLeaveTurnLine,
  wsfMyTurn,
  wsfRevokeStation,
  wsfStartTurn,
  wsfStationClaimPairing,
  wsfStationRequestPairing,
  wsfTurnReady,
  wsfTurnState,
} from '../../src/index';

type Data = Record<string, unknown>;

const ONE_CONTRIBUTION = 'This goal takes one contribution from each member, and yours is already recorded.';
const REJECTED = 'This screen is not enrolled.';
const STALE = 'That turn has moved on. This screen now shows the current one.';
const NOT_RUNNING = 'That turn is not running.';
const CLOSED = 'This goal is closed.';

function anon(fn: unknown, data: Data) {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
    acceptsStreaming: false,
  } as never);
}

function callAs(fn: unknown, uid: string, data: Data) {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: { uid, token: { email_verified: true } },
    rawRequest: { ip: '127.0.0.1', headers: {} },
    acceptsStreaming: false,
  } as never);
}

async function attempt<T>(
  p: Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: HttpsError }> {
  try {
    return { ok: true as const, value: await p };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

function expectRefused(r: { ok: boolean; error?: HttpsError }, code: string, message?: string): void {
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error?.code).toBe(code);
    if (message !== undefined) expect(r.error?.message).toBe(message);
  }
}

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

type Station = { stationId: string; secret: string; label: string };
type TurnState = {
  assigned: { calledName: string; state: string; turnRef: string | null } | null;
  waitingCount: number;
};
type MyTurn = {
  turn: {
    entryId: string;
    status: string;
    ahead: number;
    stationLabel: string | null;
    readySecondsLeft: number | null;
    attemptOpen: boolean;
  } | null;
  receipt: { amount: number } | null;
};

// ── synthetic fixtures ──────────────────────────────────────────────────────

async function seedCommunity(championUid: string): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('lifecycleGroup');
  await db.doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'Synthetic Lifecycle Hall',
    groupType: 'custom',
    joinPolicy: 'public',
    joinCode: uniq('joincode1234567890'),
    createdByUserId: championUid,
    lifecycleStatus: 'active',
    isSample: false,
  });
  await db.doc(`wsfMemberships/${groupId}_${championUid}`).set({
    groupId,
    userId: championUid,
    role: 'foundingChampion',
    membershipStatus: 'active',
  });
  return groupId;
}

/** `repeatPolicy` undefined means the field is ABSENT from the document. */
async function seedGoal(
  groupId: string,
  repeatPolicy: unknown = 'multiple',
  extra: Data = {}
): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: 'lifecycleSeed',
    communityGroupId: groupId,
    title: 'Synthetic Squat Challenge',
    target: 5000,
    unit: 'squats',
    status: 'active',
    startsAt: Timestamp.fromDate(new Date(now - 86_400_000)),
    endsAt: Timestamp.fromDate(new Date(now + 6 * 86_400_000)),
    timezone: 'America/New_York',
    ...(repeatPolicy === undefined ? {} : { repeatPolicy }),
    aggregateDisplayAuthorized: true,
    ...extra,
  });
  return ref.id;
}

async function enrol(goalId: string, championUid: string, slot: 1 | 2 = 1): Promise<Station> {
  const requested = (await anon(wsfStationRequestPairing, { goalId })) as {
    pairingId: string;
    code: string;
  };
  await callAs(wsfApproveStation, championUid, { goalId, code: requested.code, slot });
  return (await anon(wsfStationClaimPairing, { pairingId: requested.pairingId })) as Station;
}

/** A community, an open goal, a Champion, and two screens on the goal. */
async function scene(repeatPolicy: unknown = 'multiple') {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalId = await seedGoal(groupId, repeatPolicy);
  const one = await enrol(goalId, championUid, 1);
  const two = await enrol(goalId, championUid, 2);
  return { groupId, goalId, championUid, one, two };
}

async function member(groupId: string, label: string): Promise<string> {
  const uid = uniq(label);
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role: 'member',
    membershipStatus: 'active',
  });
  return uid;
}

async function join(goalId: string, uid: string, calledName: string) {
  return (await callAs(wsfJoinTurnLine, uid, { goalId, calledName })) as {
    entryId: string;
    code: string;
    alreadyInLine: boolean;
  };
}

const state = (s: Station) =>
  anon(wsfTurnState, { stationId: s.stationId, secret: s.secret }) as Promise<TurnState>;
const callNext = (s: Station) =>
  anon(wsfCallNext, { stationId: s.stationId, secret: s.secret }) as Promise<TurnState & { called: boolean }>;
const start = (s: Station, expectedTurn: unknown) =>
  anon(wsfStartTurn, { stationId: s.stationId, secret: s.secret, expectedTurn });
const complete = (s: Station, expectedTurn: unknown, count: number) =>
  anon(wsfCompleteTurn, { stationId: s.stationId, secret: s.secret, count, expectedTurn });
const revoke = (championUid: string, s: Station) =>
  callAs(wsfRevokeStation, championUid, { stationId: s.stationId });
const myTurn = (uid: string, goalId: string) => callAs(wsfMyTurn, uid, { goalId }) as Promise<MyTurn>;

async function heldRef(s: Station): Promise<string> {
  const ref = (await state(s)).assigned?.turnRef;
  expect(typeof ref).toBe('string');
  return ref as string;
}

/** Call the next person at `s`; returns the screen's binding. */
async function callUp(s: Station): Promise<string> {
  const called = await callNext(s);
  expect(called.called).toBe(true);
  return heldRef(s);
}

async function entryOf(entryId: string) {
  return (await getFirestore().doc(`wsfTurnEntries/${entryId}`).get()).data() as Record<string, unknown>;
}

async function stationDoc(s: Station) {
  return (await getFirestore().doc(`wsfKioskStations/${s.stationId}`).get()).data() as Record<string, unknown>;
}

async function placeOf(goalId: string, uid: string) {
  return getFirestore().doc(`wsfTurnMembers/goal__${goalId}__${uid}`).get();
}

async function contributions(goalId: string, uid: string) {
  const snap = await getFirestore()
    .collection('wsfContributions')
    .where('goalId', '==', goalId)
    .where('userId', '==', uid)
    .get();
  return snap.docs.map((d) => d.data() as { count: number; attemptId: string });
}

async function memberTotal(goalId: string, uid: string): Promise<number> {
  const snap = await getFirestore().doc(`wsfGoalMemberTotals/${goalId}_${uid}`).get();
  return ((snap.data() as { total?: number } | undefined)?.total ?? 0) as number;
}

/** The fields a turn handed back to the line must have lost. */
const STATION_FIELDS = [
  'assignedAt',
  'assignedStationId',
  'assignedStationLabel',
  'readyLeaseExpiresAt',
  'readyAt',
  'stationTurnRef',
  'attemptId',
  'attemptStationId',
  'attemptStartedAt',
];

function expectBackInLine(entry: Record<string, unknown>, goalId: string, position: unknown): void {
  expect(entry.status).toBe('waiting');
  expect(entry.lineStatusKey).toBe(`goal__${goalId}#waiting`);
  expect(entry.position).toBe(position);
  for (const f of STATION_FIELDS) expect(entry[f] ?? null).toBeNull();
  expect(entry.requeueReason).toBe('stationRevoked');
}

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-station-turn-lifecycle').set({ at: Date.now() }, { merge: true });
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════
// 1. A REVOKED SCREEN GIVES ITS TURN BACK TO THE LINE
// ═══════════════════════════════════════════════════════════════════════════

describe('revoking a station returns the turn it holds to the line', () => {
  test('an ASSIGNED turn goes back to waiting at its own position; the phone and the remaining screen report it', async () => {
    const { groupId, goalId, championUid, one, two } = await scene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    const aEntry = await join(goalId, a, 'Ann');
    await join(goalId, b, 'Ben');
    const oldRef = await callUp(one);
    const position = (await entryOf(aEntry.entryId)).position;
    expect((await myTurn(a, goalId)).turn).toMatchObject({ status: 'assigned', stationLabel: 'Station 1' });

    await revoke(championUid, one);

    expectBackInLine(await entryOf(aEntry.entryId), goalId, position);
    const screen = await stationDoc(one);
    expect(screen.status).toBe('revoked');
    expect(screen.serving ?? null).toBeNull();

    // The person's own phone says where they are now: first in line, no screen.
    const mine = await myTurn(a, goalId);
    expect(mine.turn).toMatchObject({
      entryId: aEntry.entryId,
      status: 'waiting',
      ahead: 0,
      stationLabel: null,
      readySecondsLeft: null,
      attemptOpen: false,
    });
    expect((await myTurn(b, goalId)).turn).toMatchObject({ status: 'waiting', ahead: 1 });
    // They still hold their ONE place at the event.
    expect((await placeOf(goalId, a)).data()).toEqual({ entryId: aEntry.entryId });

    // The revoked screen hears nothing; the other screen counts them.
    expectRefused(await attempt(state(one)), 'permission-denied', REJECTED);
    expect(await state(two)).toMatchObject({ assigned: null, waitingCount: 2 });

    // And calls them FIRST, under a fresh binding.
    const newRef = await callUp(two);
    expect((await state(two)).assigned?.calledName).toBe('Ann');
    expect(newRef).not.toBe(oldRef);
    expect((await myTurn(a, goalId)).turn).toMatchObject({ status: 'assigned', stationLabel: 'Station 2' });
  }, 60_000);

  test('a READY turn goes back too, and is called again before anyone who joined later', async () => {
    const { groupId, goalId, championUid, one, two } = await scene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    const aEntry = await join(goalId, a, 'Ann');
    await callUp(one);
    await callAs(wsfTurnReady, a, { entryId: aEntry.entryId });
    await join(goalId, b, 'Ben');
    const position = (await entryOf(aEntry.entryId)).position;

    await revoke(championUid, one);

    expectBackInLine(await entryOf(aEntry.entryId), goalId, position);
    expect((await myTurn(a, goalId)).turn).toMatchObject({ status: 'waiting', ahead: 0, stationLabel: null });
    await callUp(two);
    expect((await state(two)).assigned?.calledName).toBe('Ann');
  }, 60_000);

  test('an ACTIVE turn goes back, its unrecorded attempt is dropped, and the next screen records exactly once', async () => {
    const { groupId, goalId, championUid, one, two } = await scene();
    const a = await member(groupId, 'ann');
    const aEntry = await join(goalId, a, 'Ann');
    const ref = await callUp(one);
    await callAs(wsfTurnReady, a, { entryId: aEntry.entryId });
    await start(one, ref);
    const oldAttempt = (await entryOf(aEntry.entryId)).attemptId;
    expect(typeof oldAttempt).toBe('string');
    const position = (await entryOf(aEntry.entryId)).position;

    await revoke(championUid, one);

    expectBackInLine(await entryOf(aEntry.entryId), goalId, position);
    // The dropped attempt cannot be recorded from the phone either.
    expectRefused(
      await attempt(callAs(wsfCompleteMyTurn, a, { entryId: aEntry.entryId, count: 25 })),
      'failed-precondition',
      NOT_RUNNING
    );
    expect(await contributions(goalId, a)).toHaveLength(0);

    // The next screen runs the turn from the start, under a NEW attempt.
    const ref2 = await callUp(two);
    await callAs(wsfTurnReady, a, { entryId: aEntry.entryId });
    await start(two, ref2);
    const newAttempt = (await entryOf(aEntry.entryId)).attemptId;
    expect(typeof newAttempt).toBe('string');
    expect(newAttempt).not.toBe(oldAttempt);
    await complete(two, ref2, 30);
    const recorded = await contributions(goalId, a);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ count: 30, attemptId: newAttempt });
    expect(await memberTotal(goalId, a)).toBe(30);
    expect((await entryOf(aEntry.entryId)).status).toBe('done');
  }, 60_000);

  test('a lease that had already lapsed is closed as the no-show it is, and the place is freed', async () => {
    const { groupId, goalId, championUid, one } = await scene();
    const a = await member(groupId, 'ann');
    const aEntry = await join(goalId, a, 'Ann');
    await callUp(one);
    await getFirestore()
      .doc(`wsfTurnEntries/${aEntry.entryId}`)
      .update({ readyLeaseExpiresAt: Timestamp.fromMillis(Date.now() - 1_000) });

    await revoke(championUid, one);

    const entry = await entryOf(aEntry.entryId);
    expect(entry.status).toBe('noShow');
    expect(entry.lineStatusKey).toBe(`goal__${goalId}#noShow`);
    expect(entry.endedBy).toBe('lease');
    expect((await placeOf(goalId, a)).exists).toBe(false);
    expect((await myTurn(a, goalId)).turn).toBeNull();
  }, 60_000);

  test('a FINISHED turn is left exactly as it was, with its one contribution and its receipt', async () => {
    const { groupId, goalId, championUid, one } = await scene();
    const a = await member(groupId, 'ann');
    const aEntry = await join(goalId, a, 'Ann');
    const ref = await callUp(one);
    await callAs(wsfTurnReady, a, { entryId: aEntry.entryId });
    await start(one, ref);
    await complete(one, ref, 20);
    const before = await entryOf(aEntry.entryId);
    expect(before.status).toBe('done');

    await revoke(championUid, one);

    expect(await entryOf(aEntry.entryId)).toEqual(before);
    expect(await contributions(goalId, a)).toHaveLength(1);
    const mine = await myTurn(a, goalId);
    expect(mine.turn).toBeNull();
    expect(mine.receipt?.amount).toBe(20);
    expect((await stationDoc(one)).serving ?? null).toBeNull();
  }, 60_000);

  test('only THIS screen’s turn moves: another screen’s turn and the waiting line are untouched', async () => {
    const { groupId, goalId, championUid, one, two } = await scene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    const c = await member(groupId, 'cal');
    const aEntry = await join(goalId, a, 'Ann');
    const bEntry = await join(goalId, b, 'Ben');
    const cEntry = await join(goalId, c, 'Cal');
    await callUp(one);
    await callUp(two);
    await callAs(wsfTurnReady, b, { entryId: bEntry.entryId });
    const bBefore = await entryOf(bEntry.entryId);
    const cBefore = await entryOf(cEntry.entryId);
    const twoBefore = (await stationDoc(two)).serving;

    await revoke(championUid, one);

    expect((await entryOf(aEntry.entryId)).status).toBe('waiting');
    expect(await entryOf(bEntry.entryId)).toEqual(bBefore);
    expect(await entryOf(cEntry.entryId)).toEqual(cBefore);
    expect((await stationDoc(two)).serving).toEqual(twoBefore);
    expect((await state(two)).assigned).toMatchObject({ calledName: 'Ben', state: 'ready' });
  }, 60_000);

  test('a pointer that names another screen’s turn moves nothing: the entry must be assigned to THIS screen', async () => {
    const { groupId, goalId, championUid, one, two } = await scene();
    const b = await member(groupId, 'ben');
    const bEntry = await join(goalId, b, 'Ben');
    await callUp(two);
    await callAs(wsfTurnReady, b, { entryId: bEntry.entryId });
    const bBefore = await entryOf(bEntry.entryId);
    // A hand edit: screen one's pointer names screen two's turn.
    await getFirestore()
      .doc(`wsfKioskStations/${one.stationId}`)
      .update({ serving: { entryId: bEntry.entryId, calledName: '', position: 1 } });

    await revoke(championUid, one);

    expect(await entryOf(bEntry.entryId)).toEqual(bBefore);
    expect((await state(two)).assigned).toMatchObject({ calledName: 'Ben', state: 'ready' });
    expect((await stationDoc(one)).serving ?? null).toBeNull();
  }, 60_000);

  test('the revoked screen’s old binding reaches nothing, there or on the next screen', async () => {
    const { groupId, goalId, championUid, one, two } = await scene();
    const a = await member(groupId, 'ann');
    const aEntry = await join(goalId, a, 'Ann');
    const oldRef = await callUp(one);
    await callAs(wsfTurnReady, a, { entryId: aEntry.entryId });

    await revoke(championUid, one);

    expectRefused(await attempt(start(one, oldRef)), 'permission-denied', REJECTED);
    expectRefused(await attempt(complete(one, oldRef, 10)), 'permission-denied', REJECTED);
    await callUp(two);
    await callAs(wsfTurnReady, a, { entryId: aEntry.entryId });
    expectRefused(await attempt(start(two, oldRef)), 'failed-precondition', STALE);
    expectRefused(await attempt(complete(two, oldRef, 10)), 'failed-precondition', STALE);
    expect(await contributions(goalId, a)).toHaveLength(0);
  }, 60_000);

  test('a refused revoke moves nothing, and a second revoke is harmless', async () => {
    const { groupId, goalId, championUid, one } = await scene();
    const a = await member(groupId, 'ann');
    const stranger = await member(groupId, 'sam');
    const aEntry = await join(goalId, a, 'Ann');
    await callUp(one);
    const before = await entryOf(aEntry.entryId);

    expectRefused(await attempt(revoke(stranger, one)), 'not-found');
    expect(await entryOf(aEntry.entryId)).toEqual(before);
    expect((await stationDoc(one)).status).toBe('active');

    await revoke(championUid, one);
    const after = await entryOf(aEntry.entryId);
    expect(after.status).toBe('waiting');
    await revoke(championUid, one);
    expect(await entryOf(aEntry.entryId)).toEqual(after);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. A RECORDED MEMBER IS NOT PUT IN LINE FOR A ONE-CONTRIBUTION GOAL
// ═══════════════════════════════════════════════════════════════════════════

describe('a member whose contribution is already recorded is not put in line', () => {
  test('under a one-contribution goal, a member who recorded on the contribute page is refused, in the contribution’s own words', async () => {
    const { groupId, goalId } = await scene('once');
    const a = await member(groupId, 'ann');
    await callAs(wsfContribute, a, { goalId, attemptId: 'lifecycle_attempt_0001', count: 15 });

    const refused = await attempt(join(goalId, a, 'Ann'));
    expectRefused(refused, 'failed-precondition', ONE_CONTRIBUTION);
    // The same sentence the contribution path gives a second attempt.
    const second = await attempt(callAs(wsfContribute, a, { goalId, attemptId: 'lifecycle_attempt_0002', count: 15 }));
    expectRefused(second, 'failed-precondition', ONE_CONTRIBUTION);
    if (!refused.ok && !second.ok) expect(refused.error.message).toBe(second.error.message);

    // Nothing was written: no place, no entry, no line.
    expect((await placeOf(goalId, a)).exists).toBe(false);
    const entries = await getFirestore().collection('wsfTurnEntries').where('uid', '==', a).get();
    expect(entries.size).toBe(0);
    expect((await getFirestore().doc(`wsfTurnLines/goal__${goalId}`).get()).exists).toBe(false);
  }, 60_000);

  test('under a one-contribution goal, a member whose turn was recorded through the line is refused a second place', async () => {
    const { groupId, goalId, one } = await scene('once');
    const a = await member(groupId, 'ann');
    const aEntry = await join(goalId, a, 'Ann');
    const ref = await callUp(one);
    await callAs(wsfTurnReady, a, { entryId: aEntry.entryId });
    await start(one, ref);
    await complete(one, ref, 12);
    expect(await contributions(goalId, a)).toHaveLength(1);

    expectRefused(await attempt(join(goalId, a, 'Ann')), 'failed-precondition', ONE_CONTRIBUTION);
    expect((await placeOf(goalId, a)).exists).toBe(false);
  }, 60_000);

  test('a goal that takes repeat contributions still lets them back in line, at the back', async () => {
    const { groupId, goalId, one } = await scene('multiple');
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    const aEntry = await join(goalId, a, 'Ann');
    const ref = await callUp(one);
    await callAs(wsfTurnReady, a, { entryId: aEntry.entryId });
    await start(one, ref);
    await complete(one, ref, 12);
    const bEntry = await join(goalId, b, 'Ben');

    const again = await join(goalId, a, 'Ann');
    expect(again.alreadyInLine).toBe(false);
    expect(again.entryId).not.toBe(aEntry.entryId);
    expect((await entryOf(again.entryId)).position as number).toBeGreaterThan(
      (await entryOf(bEntry.entryId)).position as number
    );
  }, 60_000);

  test('the policy is read exactly as the contribution reads it: absent admits, an unknown value refuses', async () => {
    for (const [policy, admitted] of [
      [undefined, true],
      ['multiple', true],
      ['once', false],
      ['twice', false],
    ] as const) {
      const championUid = uniq('champ');
      const groupId = await seedCommunity(championUid);
      const goalId = await seedGoal(groupId, policy);
      const a = await member(groupId, 'ann');
      await callAs(wsfContribute, a, { goalId, attemptId: uniq('policy_attempt'), count: 5 });
      const r = await attempt(join(goalId, a, 'Ann'));
      if (admitted) expect(r.ok).toBe(true);
      else expectRefused(r, 'failed-precondition', ONE_CONTRIBUTION);
    }
  }, 90_000);

  test('an older totals row without a contribution count is settled by the ledger, as the contribution settles it', async () => {
    const db = getFirestore();
    // A total with a contribution behind it: refused.
    {
      const { groupId, goalId } = await scene('once');
      const a = await member(groupId, 'ann');
      await callAs(wsfContribute, a, { goalId, attemptId: 'legacy_attempt_0001', count: 9 });
      await db.doc(`wsfGoalMemberTotals/${goalId}_${a}`).set({ total: 9 }); // drop contributionCount
      expectRefused(await attempt(join(goalId, a, 'Ann')), 'failed-precondition', ONE_CONTRIBUTION);
    }
    // A total moved by a correction alone, with no contribution: admitted.
    {
      const { groupId, goalId } = await scene('once');
      const a = await member(groupId, 'ann');
      await db.doc(`wsfGoalMemberTotals/${goalId}_${a}`).set({ total: 9 });
      const placed = await join(goalId, a, 'Ann');
      expect(placed.alreadyInLine).toBe(false);
    }
  }, 60_000);

  test('at a combined event the refusal is per activity: a recorded activity refuses, another admits', async () => {
    const championUid = uniq('champ');
    const groupId = await seedCommunity(championUid);
    const now = Date.now();
    const squats = await seedGoal(groupId, 'once', { title: 'Squats', unit: 'squats' });
    const pushups = await seedGoal(groupId, 'once', { title: 'Push-ups', unit: 'push-ups' });
    await callAs(wsfCreateCombinedGoal, championUid, {
      communityGroupId: groupId,
      title: 'Move together',
      unit: 'movements',
      target: 2000,
      startsAt: new Date(now - 2 * 86_400_000).toISOString(),
      endsAt: new Date(now + 12 * 86_400_000).toISOString(),
      timezone: 'America/New_York',
      childGoalIds: [squats, pushups],
    });
    const a = await member(groupId, 'ann');
    await callAs(wsfContribute, a, { goalId: squats, attemptId: 'combined_attempt_0001', count: 10 });

    expectRefused(await attempt(join(squats, a, 'Ann')), 'failed-precondition', ONE_CONTRIBUTION);
    const placed = await join(pushups, a, 'Ann');
    expect(placed.alreadyInLine).toBe(false);
    expect((await entryOf(placed.entryId)).goalId).toBe(pushups);
  }, 90_000);

  test('the sentence is said only to a member, and a closed goal still answers first', async () => {
    const { groupId, goalId } = await scene('once');
    const a = await member(groupId, 'ann');
    await callAs(wsfContribute, a, { goalId, attemptId: 'order_attempt_0001', count: 7 });

    // Removed since: the generic not-found, never the member's own fact.
    await getFirestore().doc(`wsfMemberships/${groupId}_${a}`).update({ membershipStatus: 'removed' });
    expectRefused(await attempt(join(goalId, a, 'Ann')), 'not-found');
    await getFirestore().doc(`wsfMemberships/${groupId}_${a}`).update({ membershipStatus: 'active' });

    // Closed: the closed-goal sentence, as before.
    await getFirestore().doc(`wsfGoals/${goalId}`).update({ status: 'closed' });
    expectRefused(await attempt(join(goalId, a, 'Ann')), 'failed-precondition', CLOSED);
  }, 60_000);

  test('a member who records on their own phone while in line is refused a fresh tap, and keeps the place until they leave', async () => {
    const { groupId, goalId } = await scene('once');
    const a = await member(groupId, 'ann');
    const aEntry = await join(goalId, a, 'Ann');
    await callAs(wsfContribute, a, { goalId, attemptId: 'phone_attempt_0001', count: 11 });

    expectRefused(await attempt(join(goalId, a, 'Ann')), 'failed-precondition', ONE_CONTRIBUTION);
    // The refusal writes nothing: the place is still theirs, and leaving frees it.
    expect((await myTurn(a, goalId)).turn).toMatchObject({ entryId: aEntry.entryId, status: 'waiting' });
    await callAs(wsfLeaveTurnLine, a, { entryId: aEntry.entryId });
    expect((await placeOf(goalId, a)).exists).toBe(false);
  }, 60_000);
});
