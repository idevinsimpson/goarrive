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

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
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
      'calledName',
      'code',
      'readySecondsLeft',
      'state',
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

    const wrong = await attempt(
      anon(wsfStartTurn, { stationId: two.stationId, secret: two.secret }) as Promise<unknown>
    );
    expect(wrong.ok).toBe(false);
    const right = (await anon(wsfStartTurn, {
      stationId: one.stationId,
      secret: one.secret,
    })) as { started: boolean };
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
      anon(wsfStartTurn, {
        stationId: station.stationId,
        secret: station.secret,
      }) as Promise<unknown>
    );
    expect(early.ok).toBe(false);

    await callNext(station);
    // Called, but not ready: an offer nobody accepted is not a turn.
    const notReady = await attempt(
      anon(wsfStartTurn, {
        stationId: station.stationId,
        secret: station.secret,
      }) as Promise<unknown>
    );
    expect(notReady.ok).toBe(false);
    if (!notReady.ok) expect(notReady.error.message).toMatch(/ready/i);

    await callAs(wsfTurnReady, a, { entryId: entry.entryId });
    const started = (await anon(wsfStartTurn, {
      stationId: station.stationId,
      secret: station.secret,
    })) as { started: boolean; activity: { goalId: string; unit: string } | null };
    expect(started.started).toBe(true);
    expect(started.activity?.goalId).toBe(goalId);

    const stored = await entryOf(entry.entryId);
    expect(stored?.status).toBe('active');
    expect(typeof stored?.attemptId).toBe('string');
    expect(stored?.attemptStationId).toBe(station.stationId);
    expect(stored?.goalId).toBe(goalId);
    expect(stored?.uid).toBe(a);

    // A second start is the SAME attempt.
    await anon(wsfStartTurn, { stationId: station.stationId, secret: station.secret });
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
    await anon(wsfStartTurn, { stationId: station.stationId, secret: station.secret });

    const first = (await anon(wsfCompleteTurn, {
      stationId: station.stationId,
      secret: station.secret,
      count: 30,
    })) as TurnState & { recorded: { amount: number; alreadyRecorded: boolean } };
    expect(first.recorded).toEqual({ amount: 30, unit: 'squats', alreadyRecorded: false });

    // THE RETRY. The same call, as a screen that never saw the answer would
    // make it — and with a different count, which must change nothing.
    const retry = (await anon(wsfCompleteTurn, {
      stationId: station.stationId,
      secret: station.secret,
      count: 999,
    })) as TurnState & { recorded: { amount: number; alreadyRecorded: boolean } };
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
    await anon(wsfStartTurn, { stationId: station.stationId, secret: station.secret });
    const attemptId = (await entryOf(entry.entryId))?.attemptId;

    const phone = (await callAs(wsfCompleteMyTurn, a, { entryId: entry.entryId, count: 25 })) as {
      receipt: { addedCount: number; alreadyRecorded: boolean };
    };
    expect(phone.receipt).toMatchObject({ addedCount: 25, alreadyRecorded: false });

    // The station, which believes it is still mid-turn, retries. One write.
    const again = (await anon(wsfCompleteTurn, {
      stationId: station.stationId,
      secret: station.secret,
      count: 25,
    })) as { recorded: { amount: number; alreadyRecorded: boolean } };
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
    await anon(wsfCancelTurn, { stationId: station.stationId, secret: station.secret });
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
    await anon(wsfStartTurn, { stationId: station.stationId, secret: station.secret });
    await anon(wsfCompleteTurn, {
      stationId: station.stationId,
      secret: station.secret,
      count: 12,
    });

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
      receipt: { amount: number; unit: string; goalId: string } | null;
    };
    expect(mine.turn).toBeNull();
    expect(mine.receipt).toEqual({ amount: 12, unit: 'squats', goalId });

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
    await anon(wsfStartTurn, { stationId: station.stationId, secret: station.secret });

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
    await anon(wsfStartTurn, { stationId: station.stationId, secret: station.secret });
    await anon(wsfCompleteTurn, {
      stationId: station.stationId,
      secret: station.secret,
      count: 7,
    });

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
