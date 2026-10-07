/**
 * KIOSK-EXPECTED-TURN-1 — a station command names the turn it is for.
 *
 * A kiosk start, cancel or result travels over a hall network and may land
 * late. Before this packet the server applied it to WHOEVER the screen was on
 * when it landed, so a delayed command for visitor A could start, end or record
 * against visitor B. Now every station command carries `expectedTurn`: the
 * opaque, station-only `turnRef` minted when that person was called and shown
 * to that screen alone in `wsfTurnState.assigned.turnRef`. The server checks it
 * inside the transaction that acts, and:
 *
 *   - A's late start or cancel after B was called changes nothing for B;
 *   - A's late result after B was called is A's result — a replay of A's
 *     recorded attempt, or refused — and never touches B or the screen;
 *   - a missing, malformed, foreign or expired binding fails safely, with no
 *     fallback to "whoever is up now";
 *   - the phone and the station racing record ONE contribution;
 *   - a station revoked between its credential check and the transaction
 *     records nothing.
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
  wsfCancelTurn,
  wsfCompleteMyTurn,
  wsfCompleteTurn,
  wsfCreateGoal,
  wsfGoalPulse,
  wsfJoinTurnLine,
  wsfMyTurn,
  wsfStartTurn,
  wsfStationClaimPairing,
  wsfStationRequestPairing,
  wsfTurnReady,
  wsfTurnState,
} from '../../src/index';

type Data = Record<string, unknown>;

const MISSING = 'This screen needs an update before it can run a turn.';
const STALE = 'That turn has moved on. This screen now shows the current one.';
const NOT_RUNNING = 'That turn is not running.';
const REJECTED = 'This screen is not enrolled.';
const CLOSED = 'This goal is closed.';

function anon(fn: unknown, data: Data) {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
    acceptsStreaming: false,
  } as never);
}

function callAs(fn: unknown, uid: string, data: Data, emailVerified = true) {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: { uid, token: { email_verified: emailVerified } },
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

function expectRefused(
  r: { ok: boolean; error?: HttpsError },
  code: string,
  message: string
): void {
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error?.code).toBe(code);
    expect(r.error?.message).toBe(message);
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
  result: { code: string; amount: number; unit: string } | null;
  waitingCount: number;
};
type Recorded = TurnState & { recorded: { amount: number; unit: string; alreadyRecorded: boolean } };

// ── synthetic fixtures ──────────────────────────────────────────────────────

async function seedCommunity(championUid: string): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('expTurnGroup');
  await db.doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'Synthetic Expected-Turn Hall',
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

async function seedGoal(groupId: string): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: 'expTurnSeed',
    communityGroupId: groupId,
    title: 'Synthetic Squat Challenge',
    target: 5000,
    unit: 'squats',
    status: 'active',
    startsAt: Timestamp.fromDate(new Date(now - 86_400_000)),
    endsAt: Timestamp.fromDate(new Date(now + 6 * 86_400_000)),
    timezone: 'America/New_York',
    repeatPolicy: 'multiple',
    aggregateDisplayAuthorized: true,
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

async function scene() {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalId = await seedGoal(groupId);
  const station = await enrol(goalId, championUid);
  return { groupId, goalId, championUid, station };
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
  };
}

const state = (s: Station) =>
  anon(wsfTurnState, { stationId: s.stationId, secret: s.secret }) as Promise<TurnState>;
const callNext = (s: Station) =>
  anon(wsfCallNext, { stationId: s.stationId, secret: s.secret }) as Promise<TurnState & { called: boolean }>;

/** The binding the screen holds: what ITS hall view said when the person was up. */
async function heldRef(s: Station): Promise<string> {
  const ref = (await state(s)).assigned?.turnRef;
  expect(typeof ref).toBe('string');
  return ref as string;
}

const start = (s: Station, expectedTurn: unknown) =>
  anon(wsfStartTurn, { stationId: s.stationId, secret: s.secret, expectedTurn });
const complete = (s: Station, expectedTurn: unknown, count: number) =>
  anon(wsfCompleteTurn, { stationId: s.stationId, secret: s.secret, count, expectedTurn }) as Promise<Recorded>;
const cancel = (s: Station, expectedTurn: unknown) =>
  anon(wsfCancelTurn, { stationId: s.stationId, secret: s.secret, expectedTurn });

/** Call the next person and take them through Ready; returns the binding. */
async function callAndReady(s: Station, uid: string, entryId: string): Promise<string> {
  const called = await callNext(s);
  expect(called.called).toBe(true);
  const ref = await heldRef(s);
  await callAs(wsfTurnReady, uid, { entryId });
  return ref;
}

async function entryOf(entryId: string) {
  return (await getFirestore().doc(`wsfTurnEntries/${entryId}`).get()).data() as Record<string, unknown>;
}

async function servingOf(s: Station) {
  const snap = await getFirestore().doc(`wsfKioskStations/${s.stationId}`).get();
  return (snap.data() as { serving?: Record<string, unknown> | null }).serving ?? null;
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

/** A's turn is over (finished on the phone); B has been called at the same
 * screen and is ready. Returns both bindings. */
async function aDoneOnPhoneThenBUp() {
  const s = await scene();
  const a = await member(s.groupId, 'ann');
  const b = await member(s.groupId, 'ben');
  const aEntry = await join(s.goalId, a, 'Ann');
  const bEntry = await join(s.goalId, b, 'Ben');
  const aRef = await callAndReady(s.station, a, aEntry.entryId);
  await start(s.station, aRef);
  await callAs(wsfCompleteMyTurn, a, { entryId: aEntry.entryId, count: 20 });
  const bRef = await callAndReady(s.station, b, bEntry.entryId);
  return { ...s, a, b, aEntry, bEntry, aRef, bRef };
}

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-kiosk-expected-turn').set({ at: Date.now() }, { merge: true });
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE BINDING ITSELF — station-only, opaque, fresh per call
// ═══════════════════════════════════════════════════════════════════════════

describe('the binding', () => {
  test('is minted per call, shown only to the serving screen, and carries no uid, entry id or secret', async () => {
    const { groupId, goalId, station, championUid } = await scene();
    const a = await member(groupId, 'ann');
    const aEntry = await join(goalId, a, 'Ann');
    await callNext(station);
    const ref = await heldRef(station);
    expect(ref).toMatch(/^tr_[A-Za-z0-9_-]{16,64}$/);
    for (const forbidden of [a, aEntry.entryId, station.secret, station.stationId, goalId]) {
      expect(ref).not.toContain(forbidden);
    }
    expect((await entryOf(aEntry.entryId)).stationTurnRef).toBe(ref);
    expect((await servingOf(station))?.turnRef).toBe(ref);

    // The person's own phone and the public pulse never carry it.
    const mine = await callAs(wsfMyTurn, a, { goalId });
    expect(JSON.stringify(mine)).not.toContain(ref);
    const pulse = await callAs(wsfGoalPulse, championUid, { goalId });
    expect(JSON.stringify(pulse)).not.toContain(ref);

    // A second screen on the same goal sees no binding for a turn it is not running.
    const two = await enrol(goalId, championUid, 2);
    expect(JSON.stringify(await state(two))).not.toContain(ref);
  }, 40_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. A LATE COMMAND FOR A, AFTER B WAS CALLED
// ═══════════════════════════════════════════════════════════════════════════

describe('a late command for visitor A never reaches visitor B', () => {
  test('A’s result landing after B was called replays A’s one contribution and leaves B exactly as they were', async () => {
    const t = await aDoneOnPhoneThenBUp();
    const servingBefore = await servingOf(t.station);
    const bBefore = await entryOf(t.bEntry.entryId);

    const late = await complete(t.station, t.aRef, 999);
    expect(late.recorded).toEqual({ amount: 20, unit: 'squats', alreadyRecorded: true });

    expect(await contributions(t.goalId, t.a)).toHaveLength(1);
    expect(await memberTotal(t.goalId, t.a)).toBe(20);
    expect(await contributions(t.goalId, t.b)).toHaveLength(0);
    expect(await entryOf(t.bEntry.entryId)).toEqual(bBefore);
    expect(await servingOf(t.station)).toEqual(servingBefore);
    expect(late.assigned?.calledName).toBe('Ben');
    expect(late.assigned?.turnRef).toBe(t.bRef);
  }, 60_000);

  test('A’s result landing after A was cancelled and B was called records nothing for anyone', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    const aEntry = await join(goalId, a, 'Ann');
    const bEntry = await join(goalId, b, 'Ben');
    const aRef = await callAndReady(station, a, aEntry.entryId);
    await start(station, aRef);
    await cancel(station, aRef);
    const bRef = await callAndReady(station, b, bEntry.entryId);
    const bBefore = await entryOf(bEntry.entryId);

    expectRefused(await attempt(complete(station, aRef, 30)), 'failed-precondition', NOT_RUNNING);
    expect(await contributions(goalId, a)).toHaveLength(0);
    expect(await contributions(goalId, b)).toHaveLength(0);
    expect((await entryOf(aEntry.entryId)).status).toBe('left');
    expect(await entryOf(bEntry.entryId)).toEqual(bBefore);
    expect((await servingOf(station))?.turnRef).toBe(bRef);
  }, 60_000);

  test('A’s cancel landing after B was called ends nobody and leaves the screen on B', async () => {
    const t = await aDoneOnPhoneThenBUp();
    const servingBefore = await servingOf(t.station);

    expectRefused(await attempt(cancel(t.station, t.aRef)), 'failed-precondition', STALE);
    expect((await entryOf(t.bEntry.entryId)).status).toBe('ready');
    expect(await servingOf(t.station)).toEqual(servingBefore);
    expect((await state(t.station)).assigned?.calledName).toBe('Ben');
  }, 60_000);

  test('A’s start landing after B was called starts nobody: B stays ready with no attempt', async () => {
    const t = await aDoneOnPhoneThenBUp();

    expectRefused(await attempt(start(t.station, t.aRef)), 'failed-precondition', STALE);
    const b = await entryOf(t.bEntry.entryId);
    expect(b.status).toBe('ready');
    expect(b.attemptId ?? null).toBeNull();

    // B's own binding still works.
    const ok = (await start(t.station, t.bRef)) as { started: boolean };
    expect(ok.started).toBe(true);
  }, 60_000);

  test('an already-confirmed A, replayed while B is mid-turn, is one contribution and does not clear B', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    const aEntry = await join(goalId, a, 'Ann');
    const bEntry = await join(goalId, b, 'Ben');
    const aRef = await callAndReady(station, a, aEntry.entryId);
    await start(station, aRef);
    const first = await complete(station, aRef, 15);
    expect(first.recorded.alreadyRecorded).toBe(false);
    const bRef = await callAndReady(station, b, bEntry.entryId);
    await start(station, bRef);
    const servingBefore = await servingOf(station);
    const lineBefore = (await getFirestore().doc(`wsfTurnLines/goal__${goalId}`).get()).data();

    const replay = await complete(station, aRef, 15);
    expect(replay.recorded).toEqual({ amount: 15, unit: 'squats', alreadyRecorded: true });
    expect(await contributions(goalId, a)).toHaveLength(1);
    expect(await memberTotal(goalId, a)).toBe(15);
    expect((await entryOf(bEntry.entryId)).status).toBe('active');
    expect(await servingOf(station)).toEqual(servingBefore);
    expect((await servingOf(station))?.calledName).toBe('Ben');
    expect((await getFirestore().doc(`wsfTurnLines/goal__${goalId}`).get()).data()).toEqual(lineBefore);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. MISSING, MALFORMED, FOREIGN AND EXPIRED BINDINGS
// ═══════════════════════════════════════════════════════════════════════════

describe('a binding that is not THIS turn fails safely', () => {
  test('missing or malformed: every station command is refused with the update sentence, and nothing changes', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const aEntry = await join(goalId, a, 'Ann');
    const ref = await callAndReady(station, a, aEntry.entryId);
    const before = await entryOf(aEntry.entryId);
    const servingBefore = await servingOf(station);

    for (const bad of [undefined, '', 'tr_short', 'not-a-ref', 42, { ref }]) {
      expectRefused(await attempt(start(station, bad)), 'invalid-argument', MISSING);
      expectRefused(await attempt(cancel(station, bad)), 'invalid-argument', MISSING);
      expectRefused(await attempt(complete(station, bad, 10)), 'invalid-argument', MISSING);
    }
    expect(await entryOf(aEntry.entryId)).toEqual(before);
    expect(await servingOf(station)).toEqual(servingBefore);

    await start(station, ref);
    const runningBefore = await entryOf(aEntry.entryId);
    expectRefused(await attempt(complete(station, undefined, 10)), 'invalid-argument', MISSING);
    expectRefused(await attempt(cancel(station, undefined)), 'invalid-argument', MISSING);
    expect(await entryOf(aEntry.entryId)).toEqual(runningBefore);
    expect(await contributions(goalId, a)).toHaveLength(0);
  }, 60_000);

  test('foreign: a well-formed binding this screen never issued is stale for start, cancel and result', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const aEntry = await join(goalId, a, 'Ann');
    await callAndReady(station, a, aEntry.entryId);
    const foreign = 'tr_' + 'Z'.repeat(24);

    expectRefused(await attempt(start(station, foreign)), 'failed-precondition', STALE);
    expectRefused(await attempt(cancel(station, foreign)), 'failed-precondition', STALE);
    expectRefused(await attempt(complete(station, foreign, 5)), 'failed-precondition', STALE);
    expect((await entryOf(aEntry.entryId)).status).toBe('ready');
    expect(await contributions(goalId, a)).toHaveLength(0);
  }, 60_000);

  test('expired: the binding of a place lapsed as a no-show is stale once the next person is called', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    const aEntry = await join(goalId, a, 'Ann');
    const bEntry = await join(goalId, b, 'Ben');
    await callNext(station);
    const aRef = await heldRef(station);
    await getFirestore()
      .doc(`wsfTurnEntries/${aEntry.entryId}`)
      .update({ readyLeaseExpiresAt: Timestamp.fromMillis(Date.now() - 1_000) });
    await callNext(station);
    expect((await entryOf(aEntry.entryId)).status).toBe('noShow');
    const bRef = await heldRef(station);
    expect(bRef).not.toBe(aRef);
    await callAs(wsfTurnReady, b, { entryId: bEntry.entryId });

    expectRefused(await attempt(start(station, aRef)), 'failed-precondition', STALE);
    expectRefused(await attempt(cancel(station, aRef)), 'failed-precondition', STALE);
    expectRefused(await attempt(complete(station, aRef, 5)), 'failed-precondition', STALE);
    expect((await entryOf(bEntry.entryId)).status).toBe('ready');
    expect((await entryOf(aEntry.entryId)).status).toBe('noShow');
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. RACES — one record, whoever gets there first
// ═══════════════════════════════════════════════════════════════════════════

describe('races', () => {
  test('the phone and the station finishing at the same moment record one contribution', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const aEntry = await join(goalId, a, 'Ann');
    const ref = await callAndReady(station, a, aEntry.entryId);
    await start(station, ref);

    const [phone, screen] = await Promise.all([
      callAs(wsfCompleteMyTurn, a, { entryId: aEntry.entryId, count: 11 }) as Promise<{
        receipt: { addedCount: number; alreadyRecorded: boolean };
      }>,
      complete(station, ref, 22),
    ]);
    const amounts = [phone.receipt.addedCount, screen.recorded.amount];
    expect(amounts[0]).toBe(amounts[1]);
    expect([phone.receipt.alreadyRecorded, screen.recorded.alreadyRecorded].sort()).toEqual([false, true]);
    const recorded = await contributions(goalId, a);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.count).toBe(amounts[0]);
    expect(await memberTotal(goalId, a)).toBe(amounts[0]);
    const entry = await entryOf(aEntry.entryId);
    expect(entry.status).toBe('done');
    expect(entry.resultAmount).toBe(amounts[0]);
  }, 60_000);

  test('a cancel and a result racing: either the result is recorded and the turn is done, or it is cancelled and nothing is recorded', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const aEntry = await join(goalId, a, 'Ann');
    const ref = await callAndReady(station, a, aEntry.entryId);
    await start(station, ref);

    await Promise.all([attempt(complete(station, ref, 9)), attempt(cancel(station, ref))]);
    const entry = await entryOf(aEntry.entryId);
    const recorded = await contributions(goalId, a);
    if (entry.status === 'done') {
      expect(recorded).toHaveLength(1);
    } else {
      expect(entry.status).toBe('left');
      expect(recorded).toHaveLength(0);
    }
  }, 60_000);

  test('two stations contending: neither can start, cancel or record the other’s turn, and each records its own', async () => {
    const { groupId, goalId, station: one, championUid } = await scene();
    const two = await enrol(goalId, championUid, 2);
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    const aEntry = await join(goalId, a, 'Ann');
    const bEntry = await join(goalId, b, 'Ben');
    const [r1, r2] = await Promise.all([callNext(one), callNext(two)]);
    expect(r1.called && r2.called).toBe(true);
    const ref1 = await heldRef(one);
    const ref2 = await heldRef(two);
    await callAs(wsfTurnReady, a, { entryId: aEntry.entryId });
    await callAs(wsfTurnReady, b, { entryId: bEntry.entryId });

    // The other screen, even holding this turn's binding, is not this screen.
    expectRefused(await attempt(start(two, ref1)), 'failed-precondition', STALE);
    expectRefused(await attempt(cancel(two, ref1)), 'failed-precondition', STALE);
    await start(one, ref1);
    expectRefused(await attempt(complete(two, ref1, 50)), 'failed-precondition', STALE);
    await start(two, ref2);

    const [d1, d2] = await Promise.all([complete(one, ref1, 3), complete(two, ref2, 4)]);
    expect(d1.recorded.alreadyRecorded).toBe(false);
    expect(d2.recorded.alreadyRecorded).toBe(false);
    const byUid = new Map([
      [a, await contributions(goalId, a)],
      [b, await contributions(goalId, b)],
    ]);
    expect([...byUid.values()].map((c) => c.length)).toEqual([1, 1]);
    expect([...byUid.values()].map((c) => c[0]!.count).sort()).toEqual([3, 4]);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. LOST ANSWERS, REVOCATION, THE WRONG MEMBER, A CLOSED GOAL
// ═══════════════════════════════════════════════════════════════════════════

describe('recovery and refusal', () => {
  test('lost answer: the screen retries with the binding it holds and gets the SAME receipt, once', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const aEntry = await join(goalId, a, 'Ann');
    const ref = await callAndReady(station, a, aEntry.entryId);
    await start(station, ref);
    await complete(station, ref, 12); // the answer to this one is "lost"

    // The hall has already moved on to the result; the screen still holds ref.
    expect((await state(station)).assigned).toBeNull();
    const retry = await complete(station, ref, 12);
    expect(retry.recorded).toEqual({ amount: 12, unit: 'squats', alreadyRecorded: true });
    const again = await complete(station, ref, 500);
    expect(again.recorded).toEqual({ amount: 12, unit: 'squats', alreadyRecorded: true });
    expect(await contributions(goalId, a)).toHaveLength(1);
    expect(await memberTotal(goalId, a)).toBe(12);
    const receipt = await getFirestore().doc(`wsfTurnReceipts/goal__${goalId}__${a}`).get();
    expect((receipt.data() as { amount: number }).amount).toBe(12);
  }, 60_000);

  test('a revoked station is refused before AND inside the transaction, and records nothing', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const aEntry = await join(goalId, a, 'Ann');
    const ref = await callAndReady(station, a, aEntry.entryId);
    await start(station, ref);

    // Revoked between the credential check and the recording transaction.
    const fs = getFirestore();
    const proto = Object.getPrototypeOf(fs) as { runTransaction: (...a: unknown[]) => unknown };
    const original = proto.runTransaction;
    jest.spyOn(proto, 'runTransaction').mockImplementationOnce(async function (this: unknown, ...args: unknown[]) {
      await fs.doc(`wsfKioskStations/${station.stationId}`).update({ status: 'revoked' });
      return original.apply(this, args);
    });
    const inside = await attempt(complete(station, ref, 8));
    jest.restoreAllMocks();
    expectRefused(inside, 'permission-denied', REJECTED);
    expect(await contributions(goalId, a)).toHaveLength(0);
    expect((await entryOf(aEntry.entryId)).status).toBe('active');

    // And once revoked, the credential itself is refused.
    expectRefused(await attempt(complete(station, ref, 8)), 'permission-denied', REJECTED);
    expectRefused(await attempt(cancel(station, ref)), 'permission-denied', REJECTED);
    expect(await contributions(goalId, a)).toHaveLength(0);

    // The person can still finish their own turn on their phone.
    const phone = (await callAs(wsfCompleteMyTurn, a, { entryId: aEntry.entryId, count: 8 })) as {
      receipt: { addedCount: number };
    };
    expect(phone.receipt.addedCount).toBe(8);
    expect(await contributions(goalId, a)).toHaveLength(1);
  }, 60_000);

  test('the wrong member cannot finish somebody else’s turn from their phone', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    const aEntry = await join(goalId, a, 'Ann');
    const ref = await callAndReady(station, a, aEntry.entryId);
    await start(station, ref);

    const wrong = await attempt(callAs(wsfCompleteMyTurn, b, { entryId: aEntry.entryId, count: 40 }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe('not-found');
    expect(await contributions(goalId, a)).toHaveLength(0);
    expect(await contributions(goalId, b)).toHaveLength(0);
    expect((await entryOf(aEntry.entryId)).status).toBe('active');
  }, 60_000);

  test('a closed goal: the right binding is refused as closed and records nothing; a stale one is still stale', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const aEntry = await join(goalId, a, 'Ann');
    const ref = await callAndReady(station, a, aEntry.entryId);
    await start(station, ref);
    await getFirestore().doc(`wsfGoals/${goalId}`).update({ status: 'closed' });

    expectRefused(await attempt(complete(station, ref, 6)), 'failed-precondition', CLOSED);
    expectRefused(
      await attempt(complete(station, 'tr_' + 'Q'.repeat(24), 6)),
      'failed-precondition',
      STALE
    );
    expect(await contributions(goalId, a)).toHaveLength(0);
    expect((await entryOf(aEntry.entryId)).status).toBe('active');
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. W4's verification-gate regression, unchanged
// ═══════════════════════════════════════════════════════════════════════════

describe('wsfCreateGoal verification gate', () => {
  test('an unverified caller is refused with the verify sentence', async () => {
    const championUid = uniq('unverifiedChamp');
    const groupId = await seedCommunity(championUid);
    const r = await attempt(
      callAs(
        wsfCreateGoal,
        championUid,
        {
          communityGroupId: groupId,
          title: 'Synthetic goal',
          target: 100,
          unit: 'squats',
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          endsAt: new Date(Date.now() + 8 * 86_400_000).toISOString(),
          timezone: 'America/New_York',
        },
        false
      )
    );
    expectRefused(r, 'failed-precondition', 'Verify your email before starting a goal.');
    const goals = await getFirestore()
      .collection('wsfGoals')
      .where('communityGroupId', '==', groupId)
      .get();
    expect(goals.size).toBe(0);
  }, 30_000);
});
