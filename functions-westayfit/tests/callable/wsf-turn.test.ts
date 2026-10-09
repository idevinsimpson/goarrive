/**
 * THE TURN CONTRACT — one line per EVENT, one place per ACCOUNT, and one
 * canonical attempt per turn.
 *
 * The properties pinned here are the ones the contract exists to keep, and the
 * first of them is the whole design problem:
 *
 *   - NO NAMED WAITING LIST, EVER. `wsfTurnState` returns five keys, none of
 *     them an array at any depth, and the names of everybody who is NOT the
 *     assigned person appear nowhere in the serialized payload. Asserted over
 *     the SHAPE, so a future change cannot quietly republish names and still
 *     pass.
 *   - ONE PLACE PER ACCOUNT ACROSS THE WHOLE EVENT. A combined setup is one
 *     line over its frozen children, so the same account cannot stand in the
 *     squats line and the push-ups line at the same expo.
 *   - A 45-SECOND READY LEASE that recovers the place transactionally as a
 *     no-show, and a next call that assigns the NEXT person.
 *   - START CLAIMS ONLY A READY ENTRY, and mints ONE attempt bound to station
 *     + account + child goal.
 *   - FINISH OR RETRY RECORDS THAT ATTEMPT IDEMPOTENTLY, from the station or
 *     from the phone, through wsfContribute's own (goal, uid, attemptId) key.
 *   - CALL NEXT NEVER CLOSES AN UNFINISHED TURN.
 *   - TEN SECONDS OF RESULT, and then every name is gone — while the person's
 *     own receipt stays recoverable.
 *   - THE LEGACY ONE-GOAL ROUTE IS UNCHANGED: a goal in no combined setup is
 *     its own event, and wsfGoalPulse still returns exactly its nine keys.
 *
 * Runs against the local Firestore emulator via `func.run(request)`.
 */

process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { DocumentReference, Timestamp, Transaction, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  wsfApproveStation,
  wsfCallNext,
  wsfCancelTurn,
  wsfCompleteMyTurn,
  wsfCompleteTurn,
  wsfContribute,
  wsfCreateCombinedGoal,
  wsfEventContext,
  wsfGoalPulse,
  wsfJoinTurnLine,
  wsfLeaveTurnLine,
  wsfMyTurn,
  wsfStartTurn,
  wsfStationClaimPairing,
  wsfStationRequestPairing,
  wsfTurnReady,
  wsfTurnState,
} from '../../src/index';

type Data = Record<string, unknown>;

/** Anonymous by construction: a screen has no account and must not have one. */
function anon(fn: unknown, data: Data) {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
    acceptsStreaming: false,
  } as never);
}

function callAs(fn: unknown, uid: string | null, data: Data) {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: uid ? { uid, token: { email_verified: true } } : undefined,
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

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

type HallAssignment = {
  code: string;
  calledName: string;
  state: 'assigned' | 'ready' | 'active';
  readySecondsLeft: number | null;
  turnRef: string | null;
};
type HallResult = { code: string; amount: number; unit: string; secondsLeft: number };
type TurnState = {
  stationId: string;
  stationLabel: string;
  assigned: HallAssignment | null;
  result: HallResult | null;
  waitingCount: number;
};
type Station = { stationId: string; secret: string; label: string };

// ── seeding ─────────────────────────────────────────────────────────────────

async function seedCommunity(championUid: string): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('turnGroup');
  await db.doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'Expo Hall Movers',
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

async function seedMember(groupId: string, uid: string): Promise<void> {
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role: 'member',
    membershipStatus: 'active',
  });
}

async function seedGoal(opts: {
  groupId: string;
  title?: string;
  unit?: string;
  startsAt?: Date;
  endsAt?: Date;
}): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: 'turnSeed',
    communityGroupId: opts.groupId,
    title: opts.title ?? 'Expo Squat Challenge',
    target: 5000,
    unit: opts.unit ?? 'squats',
    status: 'active',
    startsAt: Timestamp.fromDate(opts.startsAt ?? new Date(now - 86_400_000)),
    endsAt: Timestamp.fromDate(opts.endsAt ?? new Date(now + 6 * 86_400_000)),
    timezone: 'America/New_York',
    repeatPolicy: 'multiple',
    aggregateDisplayAuthorized: true,
  });
  return ref.id;
}

/** The whole enrolment, as it actually happens. */
async function enrol(opts: {
  goalId: string;
  championUid: string;
  slot?: 1 | 2;
}): Promise<Station> {
  const requested = (await anon(wsfStationRequestPairing, { goalId: opts.goalId })) as {
    pairingId: string;
    code: string;
  };
  await callAs(wsfApproveStation, opts.championUid, {
    goalId: opts.goalId,
    code: requested.code,
    slot: opts.slot ?? 1,
  });
  return (await anon(wsfStationClaimPairing, { pairingId: requested.pairingId })) as Station;
}

/** A community, an open goal, a Champion and one enrolled screen. The LEGACY
 * one-goal event: no combined setup anywhere near it. */
async function scene(): Promise<{
  groupId: string;
  goalId: string;
  championUid: string;
  station: Station;
}> {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalId = await seedGoal({ groupId });
  const station = await enrol({ goalId, championUid });
  return { groupId, goalId, championUid, station };
}

/** A COMBINED event: two activity goals behind one frozen setup, and one
 * screen standing on the first of them. */
async function combinedScene(): Promise<{
  groupId: string;
  championUid: string;
  setupId: string;
  squats: string;
  pushups: string;
  station: Station;
}> {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const now = Date.now();
  const childStart = new Date(now - 86_400_000);
  const childEnd = new Date(now + 6 * 86_400_000);
  const squats = await seedGoal({
    groupId,
    title: 'Squats',
    unit: 'squats',
    startsAt: childStart,
    endsAt: childEnd,
  });
  const pushups = await seedGoal({
    groupId,
    title: 'Push-ups',
    unit: 'push-ups',
    startsAt: childStart,
    endsAt: childEnd,
  });
  const created = (await callAs(wsfCreateCombinedGoal, championUid, {
    communityGroupId: groupId,
    title: 'Move together',
    unit: 'movements',
    target: 2000,
    startsAt: new Date(now - 2 * 86_400_000).toISOString(),
    endsAt: new Date(now + 12 * 86_400_000).toISOString(),
    timezone: 'America/New_York',
    childGoalIds: [squats, pushups],
  })) as { setupId: string };
  const station = await enrol({ goalId: squats, championUid });
  return { groupId, championUid, setupId: created.setupId, squats, pushups, station };
}

async function member(groupId: string, label: string): Promise<string> {
  const uid = uniq(label);
  await seedMember(groupId, uid);
  return uid;
}

const state = (s: Station) =>
  anon(wsfTurnState, { stationId: s.stationId, secret: s.secret }) as Promise<TurnState>;
/** The turn a screen believes it is running, as the client holds it: the
 * `turnRef` from its own latest view of the hall, kept after the hall clears
 * so a screen that lost an answer can retry the SAME turn. */
const heldTurn = new Map<string, string>();
async function bound(s: Station, extra: Data = {}): Promise<Data> {
  const seen = (await state(s)).assigned?.turnRef;
  if (seen) heldTurn.set(s.stationId, seen);
  return { stationId: s.stationId, secret: s.secret, expectedTurn: heldTurn.get(s.stationId), ...extra };
}
const callNext = (s: Station) =>
  anon(wsfCallNext, { stationId: s.stationId, secret: s.secret }) as Promise<
    TurnState & { called: boolean; blocked: string | null; blockedMessage: string | null }
  >;

/** Every string value anywhere in a payload, however deeply nested. */
function deepStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) deepStrings(v, out);
  else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepStrings(v, out);
  }
  return out;
}

/** Whether a payload contains an array anywhere, at any depth. */
function hasArrayAnywhere(value: unknown): boolean {
  if (Array.isArray(value)) return true;
  if (value && typeof value === 'object') {
    return Object.values(value).some((v) => hasArrayAnywhere(v));
  }
  return false;
}

async function entryOf(entryId: string) {
  const snap = await getFirestore().doc(`wsfTurnEntries/${entryId}`).get();
  return snap.data() as Record<string, unknown> | undefined;
}

/** Push a running lease into the past, which is the only way to make 45
 * seconds elapse in a test without waiting 45 seconds. */
async function lapseLease(entryId: string): Promise<void> {
  await getFirestore()
    .doc(`wsfTurnEntries/${entryId}`)
    .update({ readyLeaseExpiresAt: Timestamp.fromMillis(Date.now() - 1_000) });
}

async function contributionCount(goalId: string, uid: string): Promise<number> {
  const snap = await getFirestore()
    .collection('wsfContributions')
    .where('goalId', '==', goalId)
    .where('userId', '==', uid)
    .get();
  return snap.size;
}

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-turn').set({ at: Date.now() }, { merge: true });
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════
// 1. NO NAMED WAITING LIST — the assertion that pins the disclosure rule
// ═══════════════════════════════════════════════════════════════════════════

describe('what a screen in a room is allowed to know', () => {
  test('wsfTurnState returns five keys, no array at any depth, and no other person’s name', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    const c = await member(groupId, 'cass');
    await callAs(wsfJoinTurnLine, a, { goalId, calledName: 'Annalise' });
    await callAs(wsfJoinTurnLine, b, { goalId, calledName: 'Bartholomew' });
    await callAs(wsfJoinTurnLine, c, { goalId, calledName: 'Cassiopeia' });

    const before = await state(station);
    expect(Object.keys(before).sort()).toEqual([
      'assigned',
      'result',
      'stationId',
      'stationLabel',
      'waitingCount',
    ]);
    expect(before.assigned).toBeNull();
    expect(before.waitingCount).toBe(3);
    // THE SHAPE, not the contents: there is no list in this response, so
    // "publish the waiting list again" cannot be done by passing a different
    // argument. It would have to change this assertion.
    expect(hasArrayAnywhere(before)).toBe(false);
    for (const name of ['Annalise', 'Bartholomew', 'Cassiopeia']) {
      expect(deepStrings(before)).not.toContain(name);
    }

    await callNext(station);
    const after = await state(station);
    expect(Object.keys(after).sort()).toEqual([
      'assigned',
      'result',
      'stationId',
      'stationLabel',
      'waitingCount',
    ]);
    expect(hasArrayAnywhere(after)).toBe(false);
    expect(Object.keys(after.assigned!).sort()).toEqual([
      'activityTitle',
      'activityUnit',
      'calledName',
      'code',
      'readySecondsLeft',
      'state',
      'turnRef',
    ]);
    // Exactly ONE of the three names is anywhere in the payload: the one
    // person this screen is serving.
    const strings = deepStrings(after);
    expect(strings.filter((s) => s === 'Annalise')).toHaveLength(1);
    expect(strings).not.toContain('Bartholomew');
    expect(strings).not.toContain('Cassiopeia');
    expect(after.waitingCount).toBe(2);

    // And no uid, ever, for any caller.
    const serialized = JSON.stringify(after);
    for (const uid of [a, b, c]) expect(serialized).not.toContain(uid);
  }, 30_000);

  test('the short code is duplicate-safe within an event', async () => {
    const { groupId, goalId } = await scene();
    const codes: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const uid = await member(groupId, `code${i}`);
      const joined = (await callAs(wsfJoinTurnLine, uid, {
        goalId,
        calledName: `P${i}`,
      })) as { code: string };
      codes.push(joined.code);
    }
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{3}$/);
  }, 30_000);

  test('the code is not derived from the account: one person, two events, two salts', async () => {
    const first = await scene();
    const second = await scene();
    const uid = uniq('both');
    await seedMember(first.groupId, uid);
    await seedMember(second.groupId, uid);

    const a = (await callAs(wsfJoinTurnLine, uid, {
      goalId: first.goalId,
      calledName: 'Sam',
    })) as { code: string };
    const b = (await callAs(wsfJoinTurnLine, uid, {
      goalId: second.goalId,
      calledName: 'Sam',
    })) as { code: string };

    const db = getFirestore();
    const saltA = (
      (await db.doc(`wsfTurnLines/goal__${first.goalId}`).get()).data() as { codeSalt?: number }
    ).codeSalt;
    const saltB = (
      (await db.doc(`wsfTurnLines/goal__${second.goalId}`).get()).data() as { codeSalt?: number }
    ).codeSalt;
    expect(typeof saltA).toBe('number');
    expect(typeof saltB).toBe('number');
    // The same account, at the same position, in two events: the code follows
    // the LINE's salt and the position, so it cannot be a function of the uid.
    if (saltA !== saltB) expect(a.code).not.toBe(b.code);
  }, 40_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. ONE PLACE PER ACCOUNT ACROSS THE WHOLE EVENT
// ═══════════════════════════════════════════════════════════════════════════

describe('one place per account, per EVENT', () => {
  test('a combined QR resolves the setup’s frozen children', async () => {
    const { groupId, squats, pushups } = await combinedScene();
    const m = await member(groupId, 'mem');
    const context = (await callAs(wsfEventContext, m, { goalId: squats })) as {
      eventScope: string;
      setupId: string | null;
      activities: { goalId: string; unit: string }[];
    };
    expect(context.eventScope).toBe('setup');
    expect(context.setupId).toBeTruthy();
    expect(context.activities.map((a) => a.goalId).sort()).toEqual([squats, pushups].sort());
    expect(context.activities.map((a) => a.unit).sort()).toEqual(['push-ups', 'squats']);
  }, 30_000);

  test('the same account cannot stand in two activity lines at one event', async () => {
    const { groupId, squats, pushups } = await combinedScene();
    const m = await member(groupId, 'mem');

    const first = (await callAs(wsfJoinTurnLine, m, {
      goalId: squats,
      calledName: 'Sam',
    })) as { entryId: string; alreadyInLine: boolean };
    expect(first.alreadyInLine).toBe(false);

    const second = await attempt(
      callAs(wsfJoinTurnLine, m, { goalId: pushups, calledName: 'Sam' }) as Promise<unknown>
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe('failed-precondition');
      expect(second.error.message).toMatch(/already in the line at this event/i);
    }

    // The same activity again is idempotent, not a second place.
    const again = (await callAs(wsfJoinTurnLine, m, {
      goalId: squats,
      calledName: 'Something else',
    })) as { entryId: string; calledName: string; alreadyInLine: boolean };
    expect(again.alreadyInLine).toBe(true);
    expect(again.entryId).toBe(first.entryId);
    expect(again.calledName).toBe('Sam');

    // And once they leave, the other activity opens up.
    await callAs(wsfLeaveTurnLine, m, { entryId: first.entryId });
    const third = (await callAs(wsfJoinTurnLine, m, {
      goalId: pushups,
      calledName: 'Sam',
    })) as { entryId: string; alreadyInLine: boolean };
    expect(third.alreadyInLine).toBe(false);
    expect(third.entryId).not.toBe(first.entryId);
  }, 30_000);

  test('one FIFO line spans both activities of a combined event', async () => {
    const { groupId, squats, pushups, station } = await combinedScene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    await callAs(wsfJoinTurnLine, a, { goalId: pushups, calledName: 'Ann' });
    await callAs(wsfJoinTurnLine, b, { goalId: squats, calledName: 'Ben' });

    const s = await state(station);
    // The station stands on `squats`, and it can see BOTH people waiting:
    // one line per event, not one per activity.
    expect(s.waitingCount).toBe(2);

    const called = await callNext(station);
    expect(called.called).toBe(true);
    // FIFO: Ann joined first, on the OTHER activity, and is called first.
    expect(called.assigned?.calledName).toBe('Ann');
  }, 30_000);

  test('KIOSK-EXPECTED-TURN-1: a combined event’s Record receipt is scoped to the ACTIVITY recorded, in its own unit — never the parent’s total', async () => {
    const { groupId, squats, pushups, station } = await combinedScene();
    const a = await member(groupId, 'ann');
    const ann = (await callAs(wsfJoinTurnLine, a, { goalId: pushups, calledName: 'Ann' })) as { entryId: string };
    await callNext(station);
    await callAs(wsfTurnReady, a, { entryId: ann.entryId });
    await anon(wsfStartTurn, await bound(station));
    const done = (await anon(wsfCompleteTurn, await bound(station, { count: 9 }))) as {
      entryId: string;
      receipt: { goalId: string; unit: string; addedCount: number; sharedTotal: number | null };
    };
    expect(done.entryId).toBe(ann.entryId);
    expect(done.receipt.goalId).toBe(pushups);
    expect(done.receipt.goalId).not.toBe(squats);
    expect(done.receipt.unit).toBe('push-ups');
    expect(done.receipt.addedCount).toBe(9);
    // This activity had no other contribution: its own total is exactly 9.
    expect(done.receipt.sharedTotal).toBe(9);
  }, 40_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. THE LEASE, AND WHAT IT RECOVERS
// ═══════════════════════════════════════════════════════════════════════════

describe('the 45-second ready lease', () => {
  test('a call starts a lease, and the phone is told where to walk and what its code is', async () => {
    const { groupId, goalId, station } = await scene();
    const m = await member(groupId, 'mem');
    const joined = (await callAs(wsfJoinTurnLine, m, {
      goalId,
      calledName: 'Sam',
    })) as { entryId: string; code: string };

    await callNext(station);
    const mine = (await callAs(wsfMyTurn, m, { goalId })) as {
      turn: {
        status: string;
        code: string;
        stationLabel: string | null;
        readySecondsLeft: number | null;
      } | null;
    };
    expect(mine.turn?.status).toBe('assigned');
    expect(mine.turn?.code).toBe(joined.code);
    expect(mine.turn?.stationLabel).toBe(station.label);
    expect(mine.turn?.readySecondsLeft).toBeGreaterThan(0);
    expect(mine.turn?.readySecondsLeft).toBeLessThanOrEqual(45);

    const hall = await state(station);
    expect(hall.assigned?.state).toBe('assigned');
    expect(hall.assigned?.code).toBe(joined.code);
    expect(hall.assigned?.readySecondsLeft).toBeGreaterThan(0);
  }, 30_000);

  test('an expired lease is a no-show: the place comes back, the hall clears, and the next person is called', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    const first = (await callAs(wsfJoinTurnLine, a, {
      goalId,
      calledName: 'Ann',
    })) as { entryId: string };
    await callAs(wsfJoinTurnLine, b, { goalId, calledName: 'Ben' });

    await callNext(station);
    await lapseLease(first.entryId);

    // IT IS TRUE FOR EVERY READER THE INSTANT IT LAPSES, before any write.
    const hall = await state(station);
    expect(hall.assigned).toBeNull();
    const annPhone = (await callAs(wsfMyTurn, a, { goalId })) as { turn: unknown };
    expect(annPhone.turn).toBeNull();

    // And the next call assigns the NEXT person and materialises the no-show.
    const next = await callNext(station);
    expect(next.called).toBe(true);
    expect(next.assigned?.calledName).toBe('Ben');
    const stored = await entryOf(first.entryId);
    expect(stored?.status).toBe('noShow');
    expect(stored?.endedBy).toBe('lease');

    // The place is genuinely back: Ann can get in line again.
    const rejoined = (await callAs(wsfJoinTurnLine, a, {
      goalId,
      calledName: 'Ann',
    })) as { alreadyInLine: boolean; entryId: string };
    expect(rejoined.alreadyInLine).toBe(false);
    expect(rejoined.entryId).not.toBe(first.entryId);
  }, 30_000);

  test('“I’m ready” closes the lease, and a tap that arrives too late is refused and recovered', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const entry = (await callAs(wsfJoinTurnLine, a, {
      goalId,
      calledName: 'Ann',
    })) as { entryId: string };
    await callNext(station);

    const ready = (await callAs(wsfTurnReady, a, { entryId: entry.entryId })) as {
      status: string;
      stationLabel: string | null;
    };
    expect(ready.status).toBe('ready');
    expect(ready.stationLabel).toBe(station.label);
    const hall = await state(station);
    expect(hall.assigned?.state).toBe('ready');
    expect(hall.assigned?.readySecondsLeft).toBeNull();

    // A ready entry never lapses: they said they were coming.
    await getFirestore()
      .doc(`wsfTurnEntries/${entry.entryId}`)
      .update({ readyLeaseExpiresAt: Timestamp.fromMillis(Date.now() - 60_000) });
    expect((await state(station)).assigned?.state).toBe('ready');

    // A late tap on somebody else's expired call is refused and recovered.
    const b = await member(groupId, 'ben');
    const late = (await callAs(wsfJoinTurnLine, b, {
      goalId,
      calledName: 'Ben',
    })) as { entryId: string };
    await getFirestore().doc(`wsfTurnEntries/${late.entryId}`).update({
      status: 'assigned',
      lineStatusKey: `goal__${goalId}#assigned`,
      assignedStationId: station.stationId,
      assignedStationLabel: station.label,
      readyLeaseExpiresAt: Timestamp.fromMillis(Date.now() - 1_000),
    });
    const refused = await attempt(
      callAs(wsfTurnReady, b, { entryId: late.entryId }) as Promise<unknown>
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error.code).toBe('failed-precondition');
    expect((await entryOf(late.entryId))?.status).toBe('noShow');
  }, 40_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. TWO STATIONS, AND TWO PHONES
// ═══════════════════════════════════════════════════════════════════════════

describe('two stations and independent phones', () => {
  test('two stations calling at the same instant cannot assign the same person', async () => {
    const { groupId, goalId, championUid } = await scene();
    const one = await enrol({ goalId, championUid, slot: 1 });
    const two = await enrol({ goalId, championUid, slot: 2 });
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    await callAs(wsfJoinTurnLine, a, { goalId, calledName: 'Ann' });
    await callAs(wsfJoinTurnLine, b, { goalId, calledName: 'Ben' });

    const [r1, r2] = await Promise.all([callNext(one), callNext(two)]);
    const names = [r1.assigned?.calledName, r2.assigned?.calledName].filter(Boolean).sort();
    expect(names).toEqual(['Ann', 'Ben']);
    expect(r1.called && r2.called).toBe(true);
    // Each screen shows only its own person.
    expect((await state(one)).assigned?.calledName).toBe(r1.assigned?.calledName);
    expect((await state(two)).assigned?.calledName).toBe(r2.assigned?.calledName);
    expect((await state(one)).waitingCount).toBe(0);
  }, 40_000);

  test('one station cannot start or complete the other’s turn', async () => {
    const { groupId, goalId, championUid } = await scene();
    const one = await enrol({ goalId, championUid, slot: 1 });
    const two = await enrol({ goalId, championUid, slot: 2 });
    const a = await member(groupId, 'ann');
    const entry = (await callAs(wsfJoinTurnLine, a, {
      goalId,
      calledName: 'Ann',
    })) as { entryId: string };
    await callNext(one);
    await callAs(wsfTurnReady, a, { entryId: entry.entryId });

    // The other screen, even holding this turn's binding, is not this screen.
    const wrong = await attempt(
      anon(wsfStartTurn, { ...(await bound(one)), stationId: two.stationId, secret: two.secret }) as Promise<unknown>
    );
    expect(wrong.ok).toBe(false);
    const right = (await anon(wsfStartTurn, await bound(one))) as { started: boolean };
    expect(right.started).toBe(true);
  }, 40_000);

  test('two phones see only their own place, and a count of who is ahead', async () => {
    const { groupId, goalId } = await scene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    await callAs(wsfJoinTurnLine, a, { goalId, calledName: 'Annalise' });
    await callAs(wsfJoinTurnLine, b, { goalId, calledName: 'Bartholomew' });

    const annView = (await callAs(wsfMyTurn, a, { goalId })) as {
      turn: { ahead: number; calledName: string } | null;
    };
    const benView = (await callAs(wsfMyTurn, b, { goalId })) as {
      turn: { ahead: number; calledName: string } | null;
    };
    expect(annView.turn?.ahead).toBe(0);
    expect(benView.turn?.ahead).toBe(1);
    expect(deepStrings(annView)).not.toContain('Bartholomew');
    expect(deepStrings(benView)).not.toContain('Annalise');
    expect(JSON.stringify(annView)).not.toContain(b);
    expect(JSON.stringify(benView)).not.toContain(a);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. START, RECORD, AND THE ONE CANONICAL ATTEMPT
// ═══════════════════════════════════════════════════════════════════════════

describe('the canonical attempt', () => {
  test('start claims only a READY entry, mints ONE attempt, and binds it', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const entry = (await callAs(wsfJoinTurnLine, a, {
      goalId,
      calledName: 'Ann',
    })) as { entryId: string };

    // Nobody is up yet.
    const early = await attempt(
      anon(wsfStartTurn, await bound(station)) as Promise<unknown>
    );
    expect(early.ok).toBe(false);

    await callNext(station);
    // Called, but not ready: an offer nobody accepted is not a turn.
    const notReady = await attempt(
      anon(wsfStartTurn, await bound(station)) as Promise<unknown>
    );
    expect(notReady.ok).toBe(false);
    if (!notReady.ok) expect(notReady.error.message).toMatch(/ready/i);

    await callAs(wsfTurnReady, a, { entryId: entry.entryId });
    const started = (await anon(wsfStartTurn, await bound(station))) as { started: boolean; activity: { goalId: string; unit: string } | null };
    expect(started.started).toBe(true);
    expect(started.activity?.goalId).toBe(goalId);

    const stored = await entryOf(entry.entryId);
    expect(stored?.status).toBe('active');
    expect(typeof stored?.attemptId).toBe('string');
    expect(stored?.attemptStationId).toBe(station.stationId);
    expect(stored?.goalId).toBe(goalId);
    expect(stored?.uid).toBe(a);

    // A second start is the SAME attempt.
    await anon(wsfStartTurn, await bound(station));
    expect((await entryOf(entry.entryId))?.attemptId).toBe(stored?.attemptId);
  }, 40_000);

  test('a lost response retried at the station records exactly once', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const entry = (await callAs(wsfJoinTurnLine, a, {
      goalId,
      calledName: 'Ann',
    })) as { entryId: string };
    await callNext(station);
    await callAs(wsfTurnReady, a, { entryId: entry.entryId });
    await anon(wsfStartTurn, await bound(station));

    const first = (await anon(wsfCompleteTurn, await bound(station, { count: 30 }))) as TurnState & { recorded: { amount: number; alreadyRecorded: boolean } };
    expect(first.recorded).toEqual({ amount: 30, unit: 'squats', alreadyRecorded: false });

    // THE RETRY. The same call, as a screen that never saw the answer would
    // make it — and with a different count, which must change nothing.
    const retry = (await anon(wsfCompleteTurn, await bound(station, { count: 999 }))) as TurnState & { recorded: { amount: number; alreadyRecorded: boolean } };
    expect(retry.recorded.amount).toBe(30);
    expect(retry.recorded.alreadyRecorded).toBe(true);

    expect(await contributionCount(goalId, a)).toBe(1);
    const totals = await getFirestore().doc(`wsfGoalMemberTotals/${goalId}_${a}`).get();
    expect((totals.data() as { total?: number }).total).toBe(30);
  }, 40_000);

  test('the same attempt finishes on the phone, and the station’s retry adds nothing', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const entry = (await callAs(wsfJoinTurnLine, a, {
      goalId,
      calledName: 'Ann',
    })) as { entryId: string };
    await callNext(station);
    await callAs(wsfTurnReady, a, { entryId: entry.entryId });
    await anon(wsfStartTurn, await bound(station));
    const attemptId = (await entryOf(entry.entryId))?.attemptId;

    const phone = (await callAs(wsfCompleteMyTurn, a, { entryId: entry.entryId, count: 25 })) as {
      receipt: { addedCount: number; alreadyRecorded: boolean };
    };
    expect(phone.receipt).toMatchObject({ addedCount: 25, alreadyRecorded: false });

    // The station, which believes it is still mid-turn, retries. One write.
    const again = (await anon(wsfCompleteTurn, await bound(station, { count: 25 }))) as { recorded: { amount: number; alreadyRecorded: boolean } };
    expect(again.recorded.alreadyRecorded).toBe(true);
    expect(await contributionCount(goalId, a)).toBe(1);

    // And it is the attempt the STATION minted — one canonical attempt, and
    // the receipt for it is wsfContribute's own.
    const contrib = await getFirestore()
      .doc(`wsfContributions/${goalId}_${a}_${attemptId}`)
      .get();
    expect(contrib.exists).toBe(true);
    expect((contrib.data() as { count?: number }).count).toBe(25);
  }, 40_000);

  test('call next never closes an unfinished turn', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    const entry = (await callAs(wsfJoinTurnLine, a, {
      goalId,
      calledName: 'Ann',
    })) as { entryId: string };
    await callAs(wsfJoinTurnLine, b, { goalId, calledName: 'Ben' });
    await callNext(station);

    const blocked = await callNext(station);
    expect(blocked.called).toBe(false);
    expect(blocked.blocked).toBe('turnInProgress');
    expect(blocked.blockedMessage).toMatch(/finish or cancel/i);
    expect(blocked.assigned?.calledName).toBe('Ann');
    // Ann is NOT closed. That was the defect.
    expect((await entryOf(entry.entryId))?.status).toBe('assigned');

    // Cancelling is a decision somebody takes, and then the line moves.
    await anon(wsfCancelTurn, await bound(station));
    expect((await entryOf(entry.entryId))?.status).toBe('left');
    expect((await entryOf(entry.entryId))?.endedBy).toBe('station');
    const next = await callNext(station);
    expect(next.assigned?.calledName).toBe('Ben');
  }, 40_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. TEN SECONDS OF RESULT, AND THEN NOTHING
// ═══════════════════════════════════════════════════════════════════════════

describe('the result, and what is left afterwards', () => {
  test('a recorded turn clears every name at once, leaves a code for ten seconds, then nothing', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const entry = (await callAs(wsfJoinTurnLine, a, {
      goalId,
      calledName: 'Annalise',
    })) as { entryId: string; code: string };
    await callNext(station);
    await callAs(wsfTurnReady, a, { entryId: entry.entryId });
    await anon(wsfStartTurn, await bound(station));
    await anon(wsfCompleteTurn, await bound(station, { count: 12 }));

    const after = await state(station);
    // EVERY NAME IS GONE, in the same transaction that recorded the result.
    expect(after.assigned).toBeNull();
    expect(deepStrings(after)).not.toContain('Annalise');
    expect(after.result).toEqual({
      code: entry.code,
      amount: 12,
      unit: 'squats',
      secondsLeft: expect.any(Number),
    });
    expect(after.result!.secondsLeft).toBeLessThanOrEqual(10);

    // The station document holds no name either. Its POINTER survives, so a
    // station whose response was lost can press the button again and land on
    // the same attempt — but the cached name is blanked, so nothing a screen
    // could read carries one.
    const stationDoc = await getFirestore()
      .doc(`wsfKioskStations/${station.stationId}`)
      .get();
    const serving = (stationDoc.data() as { serving?: { calledName?: string } | null }).serving;
    expect(serving?.calledName).toBe('');

    // TEN SECONDS LATER the code goes too.
    await getFirestore()
      .doc(`wsfTurnLines/goal__${goalId}`)
      .update({ 'lastResult.atMillis': Date.now() - 11_000 });
    const later = await state(station);
    expect(later.result).toBeNull();
    expect(later.assigned).toBeNull();

    // AND THE RECEIPT STAYS RECOVERABLE, for the person it belongs to and
    // nobody else.
    const mine = (await callAs(wsfMyTurn, a, { goalId })) as {
      turn: unknown;
      receipt: { amount: number; unit: string; goalId: string; entryId: string | null } | null;
    };
    expect(mine.turn).toBeNull();
    // KIOSK-EXPECTED-TURN-1: the receipt names the turn it was recorded for.
    expect(mine.receipt).toEqual({ amount: 12, unit: 'squats', goalId, entryId: entry.entryId });

    // Their place came back: they may get in line again, at the back.
    const rejoined = (await callAs(wsfJoinTurnLine, a, {
      goalId,
      calledName: 'Annalise',
    })) as { alreadyInLine: boolean };
    expect(rejoined.alreadyInLine).toBe(false);
  }, 40_000);

  test('leaving mid-turn frees the event place and records nothing', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const entry = (await callAs(wsfJoinTurnLine, a, {
      goalId,
      calledName: 'Ann',
    })) as { entryId: string };
    await callNext(station);
    await callAs(wsfTurnReady, a, { entryId: entry.entryId });
    await anon(wsfStartTurn, await bound(station));

    await callAs(wsfLeaveTurnLine, a, { entryId: entry.entryId, switchingToPhone: true });
    expect((await entryOf(entry.entryId))?.status).toBe('left');
    expect((await entryOf(entry.entryId))?.endedBy).toBe('memberToPhone');
    expect(await contributionCount(goalId, a)).toBe(0);
    const hall = await state(station);
    expect(hall.assigned).toBeNull();
    // And the screen is free to call the next person immediately.
    const b = await member(groupId, 'ben');
    await callAs(wsfJoinTurnLine, b, { goalId, calledName: 'Ben' });
    const next = await callNext(station);
    expect(next.assigned?.calledName).toBe('Ben');
  }, 40_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. THE LEGACY ONE-GOAL ROUTE, UNCHANGED
// ═══════════════════════════════════════════════════════════════════════════

describe('a goal in no combined setup', () => {
  test('is its own event, with one activity and a goal-scoped line', async () => {
    const { groupId, goalId } = await scene();
    const m = await member(groupId, 'mem');
    const context = (await callAs(wsfEventContext, m, { goalId })) as {
      eventScope: string;
      setupId: string | null;
      activities: { goalId: string; unit: string }[];
    };
    expect(context.eventScope).toBe('goal');
    expect(context.setupId).toBeNull();
    expect(context.activities).toEqual([
      { goalId, title: 'Expo Squat Challenge', unit: 'squats' },
    ]);

    await callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' });
    const line = await getFirestore().doc(`wsfTurnLines/goal__${goalId}`).get();
    expect(line.exists).toBe(true);
    expect((line.data() as { eventScope?: string }).eventScope).toBe('goal');
  }, 30_000);

  test('wsfGoalPulse still returns exactly its nine keys through a whole turn', async () => {
    const { groupId, goalId, station, championUid } = await scene();
    const before = (await callAs(wsfGoalPulse, championUid, { goalId })) as Record<string, unknown>;
    const nine = Object.keys(before).sort();
    expect(nine).toHaveLength(9);

    const a = await member(groupId, 'ann');
    const entry = (await callAs(wsfJoinTurnLine, a, {
      goalId,
      calledName: 'Ann',
    })) as { entryId: string };
    await callNext(station);
    await callAs(wsfTurnReady, a, { entryId: entry.entryId });
    await anon(wsfStartTurn, await bound(station));
    await anon(wsfCompleteTurn, await bound(station, { count: 7 }));

    const after = (await callAs(wsfGoalPulse, championUid, { goalId })) as Record<string, unknown>;
    expect(Object.keys(after).sort()).toEqual(nine);
  }, 40_000);

  test('the contribute page still records for itself, under the same key, with no turn anywhere', async () => {
    const { groupId, goalId } = await scene();
    const a = await member(groupId, 'ann');
    const receipt = (await callAs(wsfContribute, a, {
      goalId,
      attemptId: 'plain_attempt_0001',
      count: 40,
    })) as { addedCount: number; ownCredit: number; alreadyRecorded: boolean };
    expect(receipt).toMatchObject({ addedCount: 40, ownCredit: 40, alreadyRecorded: false });
    const replay = (await callAs(wsfContribute, a, {
      goalId,
      attemptId: 'plain_attempt_0001',
      count: 40,
    })) as { addedCount: number; alreadyRecorded: boolean };
    expect(replay).toMatchObject({ addedCount: 40, alreadyRecorded: true });
    expect(await contributionCount(goalId, a)).toBe(1);

    const memberDoc = await getFirestore()
      .doc(`wsfTurnMembers/${`goal__${goalId}`}__${a}`)
      .get();
    expect(memberDoc.exists).toBe(false);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. AUTHORIZATION
// ═══════════════════════════════════════════════════════════════════════════

describe('who may do what', () => {
  test('a non-member is refused with the same not-found an unknown goal gives', async () => {
    const { goalId } = await scene();
    const stranger = uniq('stranger');
    const joined = await attempt(
      callAs(wsfJoinTurnLine, stranger, { goalId, calledName: 'Nope' }) as Promise<unknown>
    );
    expect(joined.ok).toBe(false);
    if (!joined.ok) expect(joined.error.code).toBe('not-found');

    const unknown = await attempt(
      callAs(wsfJoinTurnLine, stranger, {
        goalId: 'nosuchgoalid',
        calledName: 'Nope',
      }) as Promise<unknown>
    );
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error.code).toBe('not-found');
  }, 30_000);

  test('a name a screen may not show is refused, and nothing is written', async () => {
    const { groupId, goalId } = await scene();
    const a = await member(groupId, 'ann');
    for (const bad of ['sam@example.com', 'https://example.com', '   ', '']) {
      const r = await attempt(
        callAs(wsfJoinTurnLine, a, { goalId, calledName: bad }) as Promise<unknown>
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('invalid-argument');
    }
    const mine = (await callAs(wsfMyTurn, a, { goalId })) as { turn: unknown };
    expect(mine.turn).toBeNull();
  }, 30_000);

  test('a revoked or wrong credential gets one answer, whatever was wrong with it', async () => {
    const { station } = await scene();
    const wrongSecret = await attempt(
      anon(wsfTurnState, {
        stationId: station.stationId,
        secret: 'A'.repeat(43),
      }) as Promise<unknown>
    );
    const unknownStation = await attempt(
      anon(wsfTurnState, {
        stationId: 'nosuchstation',
        secret: station.secret,
      }) as Promise<unknown>
    );
    expect(wrongSecret.ok).toBe(false);
    expect(unknownStation.ok).toBe(false);
    if (!wrongSecret.ok && !unknownStation.ok) {
      expect(wrongSecret.error.code).toBe(unknownStation.error.code);
      expect(wrongSecret.error.message).toBe(unknownStation.error.message);
    }
  }, 30_000);

  test('an entryId is not a way to learn whose place it is', async () => {
    const { groupId, goalId } = await scene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    const mine = (await callAs(wsfJoinTurnLine, a, {
      goalId,
      calledName: 'Ann',
    })) as { entryId: string };
    for (const fn of [wsfLeaveTurnLine, wsfTurnReady]) {
      const r = await attempt(callAs(fn, b, { entryId: mine.entryId }) as Promise<unknown>);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('not-found');
    }
    expect((await entryOf(mine.entryId))?.status).toBe('waiting');
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. A CLOSED GOAL ADMITS NOBODY — EXPO-CLOSED-GOAL-QUEUE-GATE-1 (GAP-2)
//
// The contribute path has always refused a goal that is not `active` ("This
// goal is closed."). The line now refuses the same goal at every step that
// would create or advance anything — join, call, ready, start — with the same
// sentence, and writes NOTHING when it does. The decision is read inside each
// mutation's own transaction, so a goal that closes between the request's
// preflight read and its transaction is still refused (the TOCTOU tests).
// Existing entries are left exactly as they were: a refusal is not a reason to
// end somebody's place.
// ═══════════════════════════════════════════════════════════════════════════

const CLOSED = 'This goal is closed.';

async function closeGoal(goalId: string): Promise<void> {
  await getFirestore().doc(`wsfGoals/${goalId}`).update({ status: 'closed' });
}

/** Every document the line could create or advance, read raw, so a refusal can
 * be proved to have written nothing at all. */
async function lineSnapshot(opts: {
  lineId: string;
  stationId?: string;
  entryIds?: string[];
  memberIds?: string[];
}): Promise<string> {
  const db = getFirestore();
  const line = await db.doc(`wsfTurnLines/${opts.lineId}`).get();
  const entries = await db.collection('wsfTurnEntries').where('lineId', '==', opts.lineId).get();
  const station = opts.stationId ? await db.doc(`wsfKioskStations/${opts.stationId}`).get() : null;
  const members = await Promise.all(
    (opts.memberIds ?? []).map((uid) => db.doc(`wsfTurnMembers/${opts.lineId}__${uid}`).get())
  );
  const strip = (d: FirebaseFirestore.DocumentSnapshot | null) =>
    d && d.exists ? { id: d.id, data: d.data(), updateTime: d.updateTime?.toMillis() } : null;
  return JSON.stringify({
    line: strip(line),
    entries: entries.docs.map(strip).sort((a, b) => String(a?.id).localeCompare(String(b?.id))),
    station: station ? { serving: station.data()?.serving ?? null, updateTime: station.updateTime?.toMillis() } : null,
    members: members.map(strip),
  });
}

function expectClosed(r: { ok: boolean; error?: HttpsError }): void {
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error?.code).toBe('failed-precondition');
    expect(r.error?.message).toBe(CLOSED);
  }
}

/** Close the goal AFTER the request's preflight reads and BEFORE its
 * transaction begins: the exact window a preflight-only status check leaves
 * open. The next runTransaction call (and only that one) closes it first. */
function closeJustBeforeTheTransaction(goalId: string): jest.SpyInstance {
  const fs = getFirestore();
  const proto = Object.getPrototypeOf(fs) as { runTransaction: (...a: unknown[]) => unknown };
  const original = proto.runTransaction;
  const spy = jest.spyOn(proto, 'runTransaction');
  spy.mockImplementationOnce(async function (this: unknown, ...args: unknown[]) {
    await closeGoal(goalId);
    return original.apply(this, args);
  });
  return spy;
}


/** Close the goal the moment a mutation has READ it from inside its
 * transaction callback — the window between the guard's read and the commit.
 *
 * The closure is fired without being awaited to completion. A read made IN the
 * transaction holds the goal, so the closure waits for the commit and lands
 * after it: the op is serialized first, which is correct. A read made OUTSIDE
 * the transaction (a plain document get, even one issued from inside the
 * callback) holds nothing, so the closure lands first and the op would commit
 * against a goal that is already closed — which is what this exists to catch.
 * Reads before the transaction (resolveTurnEvent's preflight) do not fire it. */
function closeRightAfterTheGoalIsRead(goalId: string): { settled: () => Promise<void> } {
  const db = getFirestore();
  const path = `wsfGoals/${goalId}`;
  let inside = 0;
  let pending: Promise<void> | null = null;
  const fire = () => {
    if (!pending) pending = closeGoal(goalId);
    // Long enough for an unlocked closure to commit before the op goes on.
    return Promise.race([pending, new Promise<void>((r) => setTimeout(r, 600))]);
  };
  const proto = Object.getPrototypeOf(db) as { runTransaction: (...a: unknown[]) => unknown };
  const run = proto.runTransaction;
  jest.spyOn(proto, 'runTransaction').mockImplementation(function (this: unknown, ...args: unknown[]) {
    const fn = args[0] as (tx: Transaction) => Promise<unknown>;
    const wrapped = async (tx: Transaction) => {
      inside += 1;
      try {
        return await fn(tx);
      } finally {
        inside -= 1;
      }
    };
    return run.apply(this, [wrapped, ...args.slice(1)]);
  } as never);
  const txGet = Transaction.prototype.get;
  jest.spyOn(Transaction.prototype, 'get').mockImplementation(async function (this: Transaction, ...a: unknown[]) {
    const r = await (txGet as (...x: unknown[]) => Promise<unknown>).apply(this, a);
    if ((a[0] as { path?: string })?.path === path) await fire();
    return r;
  } as never);
  const refGet = DocumentReference.prototype.get;
  jest.spyOn(DocumentReference.prototype, 'get').mockImplementation(async function (this: DocumentReference, ...a: unknown[]) {
    const r = await (refGet as (...x: unknown[]) => Promise<unknown>).apply(this, a);
    if (this.path === path && inside > 0) await fire();
    return r;
  } as never);
  return {
    settled: async () => {
      if (pending) await pending;
    },
  };
}

/** The commit time of the goal's closure, at the store's full precision. */
async function closedAt(goalId: string): Promise<Timestamp> {
  const snap = await getFirestore().doc(`wsfGoals/${goalId}`).get();
  expect(snap.data()?.status).toBe('closed');
  return snap.updateTime!;
}

/** Strictly earlier, to the nanosecond: two commits in one millisecond are
 * still ordered, and a millisecond comparison would call them equal. */
function committedBefore(a: Timestamp, b: Timestamp): boolean {
  return a.seconds < b.seconds || (a.seconds === b.seconds && a.nanoseconds < b.nanoseconds);
}

describe('a closed goal admits nobody (GAP-2)', () => {
  afterEach(() => jest.restoreAllMocks());

  test('join on a closed goal is refused in the product’s sentence, and no place, entry or line is created', async () => {
    const { groupId, goalId } = await scene();
    const m = await member(groupId, 'mem');
    await closeGoal(goalId);
    const lineId = `goal__${goalId}`;
    const before = await lineSnapshot({ lineId, memberIds: [m] });

    expectClosed(await attempt(callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' }) as Promise<unknown>));

    expect(await lineSnapshot({ lineId, memberIds: [m] })).toBe(before);
    const mine = (await callAs(wsfMyTurn, m, { goalId })) as { turn: unknown };
    expect(mine.turn).toBeNull();
  }, 30_000);

  test('a closed goal does not let a non-member learn it exists: still the same not-found', async () => {
    const { goalId } = await scene();
    await closeGoal(goalId);
    const r = await attempt(callAs(wsfJoinTurnLine, uniq('stranger'), { goalId, calledName: 'Nope' }) as Promise<unknown>);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
  }, 30_000);

  test('closed after an attendee is waiting: call next is refused, nobody is assigned, and the waiting place is left as it was', async () => {
    const { groupId, goalId, station } = await scene();
    const m = await member(groupId, 'mem');
    const joined = (await callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' })) as { entryId: string };
    await closeGoal(goalId);
    const lineId = `goal__${goalId}`;
    const before = await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [m] });

    expectClosed(await attempt(callNext(station)));

    expect(await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [m] })).toBe(before);
    const stored = await entryOf(joined.entryId);
    expect(stored?.status).toBe('waiting');
    expect(stored?.assignedStationId).toBeNull();
    expect(stored?.readyLeaseExpiresAt).toBeNull();
    expect((await state(station)).assigned).toBeNull();
  }, 30_000);

  test('closed after assignment, before Ready: the tap is refused, the lease is not closed and the turn does not advance', async () => {
    const { groupId, goalId, station } = await scene();
    const m = await member(groupId, 'mem');
    const joined = (await callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' })) as { entryId: string };
    await callNext(station);
    await closeGoal(goalId);
    const lineId = `goal__${goalId}`;
    const before = await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [m] });

    expectClosed(await attempt(callAs(wsfTurnReady, m, { entryId: joined.entryId }) as Promise<unknown>));

    expect(await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [m] })).toBe(before);
    const stored = await entryOf(joined.entryId);
    expect(stored?.status).toBe('assigned');
    expect(stored?.readyAt).toBeNull();
  }, 30_000);

  test('closed after Ready, before Start: the station is refused, no attempt is minted and nothing is recorded', async () => {
    const { groupId, goalId, station } = await scene();
    const m = await member(groupId, 'mem');
    const joined = (await callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' })) as { entryId: string };
    await callNext(station);
    await callAs(wsfTurnReady, m, { entryId: joined.entryId });
    await closeGoal(goalId);
    const lineId = `goal__${goalId}`;
    const before = await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [m] });

    expectClosed(
      await attempt(anon(wsfStartTurn, await bound(station)) as Promise<unknown>)
    );

    expect(await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [m] })).toBe(before);
    const stored = await entryOf(joined.entryId);
    expect(stored?.status).toBe('ready');
    expect(stored?.attemptId).toBeNull();
    expect(await contributionCount(goalId, m)).toBe(0);
  }, 30_000);

  // A REFUSAL IS NOT A REASON TO END A PLACE. The one way the line ends a
  // place on its own is the lapse recovery (noShow + the member doc deleted).
  // A closed goal is refused BEFORE it, so a refused tap or start leaves even a
  // lapsed place exactly as it was (W4 finding #394 5968858147).
  test('closed after a lease has lapsed: ready is refused as closed, and the place is NOT recovered as a no-show', async () => {
    const { groupId, goalId, station } = await scene();
    const m = await member(groupId, 'mem');
    const joined = (await callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' })) as { entryId: string };
    await callNext(station);
    await lapseLease(joined.entryId);
    await closeGoal(goalId);
    const lineId = `goal__${goalId}`;
    const before = await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [m] });

    expectClosed(await attempt(callAs(wsfTurnReady, m, { entryId: joined.entryId }) as Promise<unknown>));

    expect(await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [m] })).toBe(before);
    expect((await entryOf(joined.entryId))?.status).toBe('assigned');
    expect((await getFirestore().doc(`wsfTurnMembers/${lineId}__${m}`).get()).exists).toBe(true);
  }, 30_000);

  test('closed after a lease has lapsed: start is refused as closed, and the place is NOT recovered as a no-show', async () => {
    const { groupId, goalId, station } = await scene();
    const m = await member(groupId, 'mem');
    const joined = (await callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' })) as { entryId: string };
    await callNext(station);
    // The screen took the binding when it called them; a lapsed hall shows none.
    const args = await bound(station);
    await lapseLease(joined.entryId);
    await closeGoal(goalId);
    const lineId = `goal__${goalId}`;
    const before = await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [m] });

    expectClosed(
      await attempt(anon(wsfStartTurn, args) as Promise<unknown>)
    );

    expect(await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [m] })).toBe(before);
    expect((await entryOf(joined.entryId))?.status).toBe('assigned');
    expect((await entryOf(joined.entryId))?.attemptId).toBeNull();
    expect((await getFirestore().doc(`wsfTurnMembers/${lineId}__${m}`).get()).exists).toBe(true);
  }, 30_000);

  test('closed while called and not yet ready: start says the goal is closed, not “ask them to tap ready”', async () => {
    const { groupId, goalId, station } = await scene();
    const m = await member(groupId, 'mem');
    const joined = (await callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' })) as { entryId: string };
    await callNext(station);
    await closeGoal(goalId);
    const lineId = `goal__${goalId}`;
    const before = await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [m] });

    expectClosed(
      await attempt(anon(wsfStartTurn, await bound(station)) as Promise<unknown>)
    );

    expect(await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [m] })).toBe(before);
    expect((await entryOf(joined.entryId))?.status).toBe('assigned');
  }, 30_000);

  test('a turn already started before the closure keeps its attempt; only Record refuses it, and nothing is counted', async () => {
    const { groupId, goalId, station } = await scene();
    const m = await member(groupId, 'mem');
    const joined = (await callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' })) as { entryId: string };
    await callNext(station);
    await callAs(wsfTurnReady, m, { entryId: joined.entryId });
    await anon(wsfStartTurn, await bound(station));
    const startedAttempt = (await entryOf(joined.entryId))?.attemptId;
    await closeGoal(goalId);

    // A repeat start is the idempotent replay of the SAME attempt — it writes
    // nothing and advances nothing, so it is not refused.
    const again = (await anon(wsfStartTurn, await bound(station))) as {
      started: boolean;
    };
    expect(again.started).toBe(true);
    expect((await entryOf(joined.entryId))?.attemptId).toBe(startedAttempt);
    expect((await entryOf(joined.entryId))?.status).toBe('active');

    const recorded = await attempt(
      anon(wsfCompleteTurn, await bound(station, { count: 10 })) as Promise<unknown>
    );
    expectClosed(recorded);
    expect(await contributionCount(goalId, m)).toBe(0);
  }, 40_000);

  test('a combined event: a closed activity refuses joins and is never called, while the open one keeps its FIFO line', async () => {
    const { groupId, squats, pushups, station } = await combinedScene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    const c = await member(groupId, 'cat');
    const ann = (await callAs(wsfJoinTurnLine, a, { goalId: pushups, calledName: 'Ann' })) as { entryId: string };
    await callAs(wsfJoinTurnLine, b, { goalId: squats, calledName: 'Ben' });
    await closeGoal(pushups);

    expectClosed(await attempt(callAs(wsfJoinTurnLine, c, { goalId: pushups, calledName: 'Cat' }) as Promise<unknown>));

    // Ann joined first, on the closed activity: she is not called, and her
    // place is not ended for her — Ben, on the open activity, is called.
    const called = await callNext(station);
    expect(called.called).toBe(true);
    expect(called.assigned?.calledName).toBe('Ben');
    expect((await entryOf(ann.entryId))?.status).toBe('waiting');
  }, 40_000);

  test('a combined event with every activity closed: call next is refused and writes nothing', async () => {
    const { groupId, setupId, squats, pushups, station } = await combinedScene();
    const a = await member(groupId, 'ann');
    await callAs(wsfJoinTurnLine, a, { goalId: squats, calledName: 'Ann' });
    await closeGoal(squats);
    await closeGoal(pushups);
    const lineId = `setup__${setupId}`;
    const before = await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [a] });
    expectClosed(await attempt(callNext(station)));
    expect(await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [a] })).toBe(before);
  }, 40_000);
});

describe('a closed goal admits nobody — the decision is inside each transaction (TOCTOU)', () => {
  afterEach(() => jest.restoreAllMocks());

  test('join: the goal closes after the preflight read and before the transaction — refused, nothing created', async () => {
    const { groupId, goalId } = await scene();
    const m = await member(groupId, 'mem');
    const lineId = `goal__${goalId}`;
    const before = await lineSnapshot({ lineId, memberIds: [m] });
    closeJustBeforeTheTransaction(goalId);
    expectClosed(await attempt(callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' }) as Promise<unknown>));
    expect(await lineSnapshot({ lineId, memberIds: [m] })).toBe(before);
  }, 30_000);

  test('join: a goal that disappears after the preflight read is not open — refused, nothing created', async () => {
    const { groupId, goalId } = await scene();
    const m = await member(groupId, 'mem');
    const lineId = `goal__${goalId}`;
    const before = await lineSnapshot({ lineId, memberIds: [m] });
    const fs = getFirestore();
    const proto = Object.getPrototypeOf(fs) as { runTransaction: (...a: unknown[]) => unknown };
    const original = proto.runTransaction;
    jest.spyOn(proto, 'runTransaction').mockImplementationOnce(async function (this: unknown, ...args: unknown[]) {
      await fs.doc(`wsfGoals/${goalId}`).delete();
      return original.apply(this, args);
    });
    expectClosed(await attempt(callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' }) as Promise<unknown>));
    expect(await lineSnapshot({ lineId, memberIds: [m] })).toBe(before);
  }, 30_000);

  test('call next: closes in the same window — refused, nobody assigned', async () => {
    const { groupId, goalId, station } = await scene();
    const m = await member(groupId, 'mem');
    const joined = (await callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' })) as { entryId: string };
    const lineId = `goal__${goalId}`;
    const before = await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [m] });
    closeJustBeforeTheTransaction(goalId);
    expectClosed(await attempt(callNext(station)));
    expect(await lineSnapshot({ lineId, stationId: station.stationId, memberIds: [m] })).toBe(before);
    expect((await entryOf(joined.entryId))?.status).toBe('waiting');
  }, 30_000);

  test('ready: closes in the same window — refused, the turn does not advance', async () => {
    const { groupId, goalId, station } = await scene();
    const m = await member(groupId, 'mem');
    const joined = (await callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' })) as { entryId: string };
    await callNext(station);
    closeJustBeforeTheTransaction(goalId);
    expectClosed(await attempt(callAs(wsfTurnReady, m, { entryId: joined.entryId }) as Promise<unknown>));
    expect((await entryOf(joined.entryId))?.status).toBe('assigned');
  }, 30_000);

  test('start: closes in the same window — refused, no attempt minted', async () => {
    const { groupId, goalId, station } = await scene();
    const m = await member(groupId, 'mem');
    const joined = (await callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' })) as { entryId: string };
    await callNext(station);
    await callAs(wsfTurnReady, m, { entryId: joined.entryId });
    // The binding is read BEFORE the race is armed, as a screen already holds it.
    const args = await bound(station);
    closeJustBeforeTheTransaction(goalId);
    expectClosed(
      await attempt(anon(wsfStartTurn, args) as Promise<unknown>)
    );
    expect((await entryOf(joined.entryId))?.status).toBe('ready');
    expect((await entryOf(joined.entryId))?.attemptId).toBeNull();
  }, 30_000);

  test('join: the goal closes after the in-transaction read and before the commit — the join is serialized before the closure, or refused', async () => {
    const { groupId, goalId } = await scene();
    const m = await member(groupId, 'mem');
    const race = closeRightAfterTheGoalIsRead(goalId);
    const r = await attempt(callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' }) as Promise<{ entryId: string }>);
    await race.settled();
    jest.restoreAllMocks();
    const closure = await closedAt(goalId);
    if (r.ok) {
      const snap = await getFirestore().doc(`wsfTurnEntries/${r.value.entryId}`).get();
      expect(committedBefore(snap.createTime!, closure)).toBe(true);
    } else {
      expectClosed(r);
    }
  }, 30_000);

  test('call next: the goal closes after the in-transaction read and before the commit — the assignment is serialized before the closure, or refused', async () => {
    const { groupId, goalId, station } = await scene();
    const m = await member(groupId, 'mem');
    const joined = (await callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' })) as { entryId: string };
    const race = closeRightAfterTheGoalIsRead(goalId);
    const r = await attempt(callNext(station));
    await race.settled();
    jest.restoreAllMocks();
    const closure = await closedAt(goalId);
    const snap = await getFirestore().doc(`wsfTurnEntries/${joined.entryId}`).get();
    if (r.ok && r.value.called) {
      expect(snap.data()?.status).toBe('assigned');
      expect(committedBefore(snap.updateTime!, closure)).toBe(true);
    } else {
      expect(snap.data()?.status).toBe('waiting');
    }
  }, 30_000);

  test('ready: the goal closes after the in-transaction read and before the commit — the tap is serialized before the closure, or refused', async () => {
    const { groupId, goalId, station } = await scene();
    const m = await member(groupId, 'mem');
    const joined = (await callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' })) as { entryId: string };
    await callNext(station);
    const race = closeRightAfterTheGoalIsRead(goalId);
    const r = await attempt(callAs(wsfTurnReady, m, { entryId: joined.entryId }) as Promise<unknown>);
    await race.settled();
    jest.restoreAllMocks();
    const closure = await closedAt(goalId);
    const snap = await getFirestore().doc(`wsfTurnEntries/${joined.entryId}`).get();
    if (r.ok) {
      expect(snap.data()?.status).toBe('ready');
      expect(committedBefore(snap.updateTime!, closure)).toBe(true);
    } else {
      expectClosed(r);
      expect(snap.data()?.status).toBe('assigned');
    }
  }, 30_000);

  test('start: the goal closes after the in-transaction read and before the commit — the attempt is serialized before the closure, or never minted', async () => {
    const { groupId, goalId, station } = await scene();
    const m = await member(groupId, 'mem');
    const joined = (await callAs(wsfJoinTurnLine, m, { goalId, calledName: 'Sam' })) as { entryId: string };
    await callNext(station);
    await callAs(wsfTurnReady, m, { entryId: joined.entryId });
    const args = await bound(station);
    const race = closeRightAfterTheGoalIsRead(goalId);
    const r = await attempt(anon(wsfStartTurn, args) as Promise<unknown>);
    await race.settled();
    jest.restoreAllMocks();
    const closure = await closedAt(goalId);
    const snap = await getFirestore().doc(`wsfTurnEntries/${joined.entryId}`).get();
    if (r.ok) {
      expect(snap.data()?.status).toBe('active');
      expect(committedBefore(snap.updateTime!, closure)).toBe(true);
    } else {
      expectClosed(r);
      expect(snap.data()?.attemptId).toBeNull();
    }
  }, 30_000);

  test('a closure racing a crowd of joins: every place that exists was committed before the goal closed', async () => {
    const { groupId, goalId } = await scene();
    const uids = await Promise.all(Array.from({ length: 8 }, (_, i) => member(groupId, `crowd${i}`)));
    const goalRef = getFirestore().doc(`wsfGoals/${goalId}`);
    const results = await Promise.all([
      ...uids.map((uid, i) =>
        attempt(callAs(wsfJoinTurnLine, uid, { goalId, calledName: `Crowd ${i}` }) as Promise<unknown>)
      ),
      (async () => {
        await new Promise((r) => setTimeout(r, 15));
        await closeGoal(goalId);
        return { ok: true as const, value: null };
      })(),
    ]);
    const closure = (await goalRef.get()).updateTime!;
    const entries = await getFirestore()
      .collection('wsfTurnEntries')
      .where('lineId', '==', `goal__${goalId}`)
      .get();
    for (const d of entries.docs) {
      expect(committedBefore(d.createTime!, closure)).toBe(true);
    }
    // Every refusal is the closed sentence, and the count of places is exactly
    // the count of successful joins.
    const joins = results.slice(0, uids.length);
    for (const r of joins) if (!r.ok) expect((r as { error: HttpsError }).error.message).toBe(CLOSED);
    expect(entries.size).toBe(joins.filter((r) => r.ok).length);
  }, 60_000);
});

describe('KIOSK-UNVERIFIED-PARTICIPANT-1 — an unverified member takes a place in the line', () => {
  function asUnverified(fn: unknown, uid: string, data: Data) {
    return (fn as { run: (r: never) => Promise<unknown> }).run({
      data,
      auth: { uid, token: { email_verified: false } },
      rawRequest: { ip: '127.0.0.1', headers: {} },
      acceptsStreaming: false,
    } as never);
  }

  test('joins the line, sees its own place, and a retry is the same place', async () => {
    const { groupId, goalId } = await scene();
    const m = await member(groupId, 'unverified');
    const joined = (await asUnverified(wsfJoinTurnLine, m, { goalId, calledName: 'Uma' })) as {
      entryId: string;
      alreadyInLine: boolean;
    };
    expect(joined.alreadyInLine).toBe(false);
    const again = (await asUnverified(wsfJoinTurnLine, m, { goalId, calledName: 'Uma' })) as {
      entryId: string;
      alreadyInLine: boolean;
    };
    expect(again).toEqual({ ...again, entryId: joined.entryId, alreadyInLine: true });
    const mine = (await asUnverified(wsfMyTurn, m, { goalId })) as { turn: { status: string } | null };
    expect(mine.turn).not.toBeNull();
    // The same account, verified later, holds the same place.
    const verifiedView = (await callAs(wsfMyTurn, m, { goalId })) as { turn: { status: string } | null };
    expect(verifiedView).toEqual(mine);
  }, 30_000);

  test('an unverified account that is not a member is refused as a verified one is', async () => {
    const { goalId } = await scene();
    const stranger = uniq('unverified-stranger');
    const codeOf = (p: Promise<unknown>) => p.then(() => 'accepted', (e: HttpsError) => e.code);
    const unverifiedCode = await codeOf(asUnverified(wsfJoinTurnLine, stranger, { goalId, calledName: 'Uma' }));
    const verifiedCode = await codeOf(callAs(wsfJoinTurnLine, stranger, { goalId, calledName: 'Uma' }));
    expect(verifiedCode).not.toBe('accepted');
    expect(unverifiedCode).toBe(verifiedCode);
  }, 30_000);
});
