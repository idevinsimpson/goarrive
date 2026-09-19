/**
 * THE QUEUE — a real line, and a screen that calls a person by name.
 *
 * The properties pinned here are the ones the feature exists to keep, and the
 * first of them is the whole design problem:
 *
 *   - THE DISCLOSURE RULE. `wsfQueueState` returns {entryId, calledName,
 *     position} and nothing else, for every caller, ever. No uid reaches a
 *     station response, a station document, or anything a screen can read.
 *   - The name on the screen is the one the PERSON chose. It is stored on the
 *     queue entry and nowhere else — not on the member profile, not on the
 *     membership row, not on a contribution.
 *   - Two people joining at the same instant get different positions; the same
 *     person joining twice gets one place in line.
 *   - Two stations calling at the same moment cannot call the same person.
 *   - A person can take their name off a screen immediately, and the station's
 *     next read no longer has them.
 *   - A queue records NOTHING. A full cycle writes no wsfContributions, no
 *     wsfGoalCounters and no wsfGoalMemberTotals row, and wsfGoalPulse still
 *     returns exactly its nine keys.
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
  wsfFinishServing,
  wsfGoalPulse,
  wsfJoinQueue,
  wsfLeaveQueue,
  wsfMyQueueEntry,
  wsfQueueState,
  wsfStationClaimPairing,
  wsfStationRequestPairing,
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

type QueueEntryPublic = { entryId: string; calledName: string; position: number };
type QueueState = {
  serving: QueueEntryPublic | null;
  waiting: QueueEntryPublic[];
  waitingCount: number;
};

async function seedCommunity(championUid: string): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('queueGroup');
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

async function seedMember(groupId: string, uid: string, status = 'active'): Promise<void> {
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role: 'member',
    membershipStatus: status,
  });
}

async function seedGoal(groupId: string): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: 'queueSeed',
    communityGroupId: groupId,
    title: 'Expo Squat Challenge',
    target: 5000,
    unit: 'squats',
    status: 'active',
    startsAt: Timestamp.fromMillis(now - 60_000),
    endsAt: Timestamp.fromMillis(now + 3_600_000),
    timezone: 'America/New_York',
    aggregateDisplayAuthorized: true,
  });
  return ref.id;
}

/** The whole enrolment, as it actually happens. */
async function enrol(opts: {
  goalId: string;
  championUid: string;
  slot?: 1 | 2;
}): Promise<{ stationId: string; secret: string; label: string }> {
  const requested = (await anon(wsfStationRequestPairing, { goalId: opts.goalId })) as {
    pairingId: string;
    code: string;
  };
  await callAs(wsfApproveStation, opts.championUid, {
    goalId: opts.goalId,
    code: requested.code,
    slot: opts.slot ?? 1,
  });
  return (await anon(wsfStationClaimPairing, { pairingId: requested.pairingId })) as {
    stationId: string;
    secret: string;
    label: string;
  };
}

/** A community, an open goal, a Champion and one enrolled screen. */
async function scene(): Promise<{
  groupId: string;
  goalId: string;
  championUid: string;
  station: { stationId: string; secret: string; label: string };
}> {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalId = await seedGoal(groupId);
  const station = await enrol({ goalId, championUid });
  return { groupId, goalId, championUid, station };
}

async function member(groupId: string, label: string): Promise<string> {
  const uid = uniq(label);
  await seedMember(groupId, uid);
  return uid;
}

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-queue').set({ at: Date.now() }, { merge: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE DISCLOSURE RULE
// ═══════════════════════════════════════════════════════════════════════════

describe('what a screen in a room is allowed to know', () => {
  test('wsfQueueState returns exactly {entryId, calledName, position} and no uid, ever', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    await callAs(wsfJoinQueue, a, { goalId, calledName: 'Ann' });
    await callAs(wsfJoinQueue, b, { goalId, calledName: 'B.K.' });

    const state = (await anon(wsfQueueState, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState;

    expect(state.waiting).toHaveLength(2);
    for (const entry of state.waiting) {
      expect(Object.keys(entry).sort()).toEqual(['calledName', 'entryId', 'position']);
    }
    // The property this whole feature turns on, asserted over the WHOLE
    // payload rather than field by field: no uid is in it anywhere.
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain(a);
    expect(serialized).not.toContain(b);

    // And after a call, the serving entry is the same three fields.
    await anon(wsfCallNext, { stationId: station.stationId, secret: station.secret });
    const called = (await anon(wsfQueueState, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState;
    expect(called.serving).not.toBeNull();
    expect(Object.keys(called.serving!).sort()).toEqual(['calledName', 'entryId', 'position']);
    expect(JSON.stringify(called)).not.toContain(a);
    expect(JSON.stringify(called)).not.toContain(b);
  });

  test('the entryId a screen is handed is not a uid wearing a hat', async () => {
    const { groupId, goalId, station } = await scene();
    const uid = await member(groupId, 'cass');
    await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Cass' });
    const state = (await anon(wsfQueueState, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState;
    expect(state.waiting[0]!.entryId).not.toContain(uid);
    expect(state.waiting[0]!.entryId).not.toBe(uid);
  });

  test('no uid reaches the station document either', async () => {
    const { groupId, goalId, station } = await scene();
    const uid = await member(groupId, 'dee');
    await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Dee' });
    await anon(wsfCallNext, { stationId: station.stationId, secret: station.secret });
    const snap = await getFirestore().doc(`wsfKioskStations/${station.stationId}`).get();
    const serving = (snap.data() as { serving?: Record<string, unknown> }).serving!;
    expect(Object.keys(serving).sort()).toEqual([
      'calledAt',
      'calledName',
      'entryId',
      'position',
    ]);
    expect(JSON.stringify(serving)).not.toContain(uid);
  });

  test('the chosen name is stored on the entry and joins nothing else', async () => {
    const { groupId, goalId } = await scene();
    const uid = await member(groupId, 'eve');
    const joined = (await callAs(wsfJoinQueue, uid, {
      goalId,
      calledName: 'Evie',
    })) as { entryId: string };

    const db = getFirestore();
    const entry = (await db.doc(`wsfQueueEntries/${joined.entryId}`).get()).data() as Record<
      string,
      unknown
    >;
    expect(entry.calledName).toBe('Evie');

    // Not on the membership row, and not on a profile. The label is a thing
    // they wrote for a screen, for the length of one turn.
    const membership = (await db.doc(`wsfMemberships/${groupId}_${uid}`).get()).data() as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(membership)).not.toContain('Evie');
    const profile = await db.doc(`wsfMemberProfiles/${uid}`).get();
    if (profile.exists) expect(JSON.stringify(profile.data())).not.toContain('Evie');
  });

  test('a name a room must not read is refused before it is stored', async () => {
    const { groupId, goalId } = await scene();
    const uid = await member(groupId, 'fay');
    for (const bad of ['', '   ', 'fay@example.com', 'https://example.com', null, 42]) {
      const r = await attempt(callAs(wsfJoinQueue, uid, { goalId, calledName: bad }));
      expect({ name: String(bad), ok: r.ok }).toEqual({ name: String(bad), ok: false });
      if (!r.ok) expect(r.error.code).toBe('invalid-argument');
    }
  });

  test('a name is cut to what a hall can read, and never stored ragged', async () => {
    const { groupId, goalId } = await scene();
    const uid = await member(groupId, 'gus');
    const joined = (await callAs(wsfJoinQueue, uid, {
      goalId,
      calledName: '   Bartholomew   Montgomery  Fitzwilliam   ',
    })) as { calledName: string };
    expect(joined.calledName.length).toBeLessThanOrEqual(24);
    expect(joined.calledName).toBe(joined.calledName.trim());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTHORIZATION
// ═══════════════════════════════════════════════════════════════════════════

describe('who may get in line', () => {
  test('a non-member gets the same refusal an unknown goal gives', async () => {
    const { groupId, goalId } = await scene();
    const stranger = uniq('stranger');
    const removed = await member(groupId, 'removed');
    await seedMember(groupId, removed, 'removed');
    const otherGroup = await seedCommunity(uniq('champ'));
    const elsewhere = await member(otherGroup, 'elsewhere');

    const unknownGoal = await attempt(
      callAs(wsfJoinQueue, stranger, { goalId: uniq('nosuchgoal'), calledName: 'Nobody' })
    );
    expect(unknownGoal.ok).toBe(false);

    for (const uid of [stranger, removed, elsewhere]) {
      const r = await attempt(callAs(wsfJoinQueue, uid, { goalId, calledName: 'Nobody' }));
      expect({ uid, ok: r.ok }).toEqual({ uid, ok: false });
      if (!r.ok && !unknownGoal.ok) {
        // Byte-identical, so this callable cannot be walked to learn which
        // goals exist or who is in which community.
        expect(r.error.code).toBe(unknownGoal.error.code);
        expect(r.error.message).toBe(unknownGoal.error.message);
      }
    }
  });

  test('a signed-out caller is refused before anything is read', async () => {
    const { goalId } = await scene();
    const r = await attempt(callAs(wsfJoinQueue, null, { goalId, calledName: 'Nobody' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unauthenticated');
  });

  test('a wrong station secret answers exactly as an unknown station does', async () => {
    const { groupId, goalId, station } = await scene();
    const uid = await member(groupId, 'hal');
    await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Hal' });

    const unknown = await attempt(
      anon(wsfQueueState, { stationId: uniq('nosuchstation'), secret: station.secret })
    );
    const wrongSecret = await attempt(
      anon(wsfQueueState, {
        stationId: station.stationId,
        secret: 'A'.repeat(43),
      })
    );
    const malformed = await attempt(anon(wsfQueueState, { stationId: 5, secret: {} }));

    for (const r of [unknown, wrongSecret, malformed]) {
      expect(r.ok).toBe(false);
    }
    if (!unknown.ok && !wrongSecret.ok && !malformed.ok) {
      expect(wrongSecret.error.code).toBe(unknown.error.code);
      expect(wrongSecret.error.message).toBe(unknown.error.message);
      expect(malformed.error.code).toBe(unknown.error.code);
      expect(malformed.error.message).toBe(unknown.error.message);
    }

    // The same one answer on the calling half, which is the half that writes.
    const call = await attempt(
      anon(wsfCallNext, { stationId: station.stationId, secret: 'B'.repeat(43) })
    );
    expect(call.ok).toBe(false);
    if (!call.ok && !unknown.ok) {
      expect(call.error.code).toBe(unknown.error.code);
      expect(call.error.message).toBe(unknown.error.message);
    }
  });

  test('only the entry’s own uid can take that name off a screen', async () => {
    const { groupId, goalId, championUid, station } = await scene();
    const owner = await member(groupId, 'ida');
    const other = await member(groupId, 'jon');
    const joined = (await callAs(wsfJoinQueue, owner, {
      goalId,
      calledName: 'Ida',
    })) as { entryId: string };

    for (const uid of [other, championUid, uniq('stranger')]) {
      const r = await attempt(callAs(wsfLeaveQueue, uid, { entryId: joined.entryId }));
      expect({ uid, ok: r.ok }).toEqual({ uid, ok: false });
      // The same answer as an entry that is not there: an entryId is not a way
      // to learn whose place it is.
      if (!r.ok) expect(r.error.code).toBe('not-found');
    }
    const missing = await attempt(
      callAs(wsfLeaveQueue, other, { entryId: uniq('nosuchentry') })
    );
    expect(missing.ok).toBe(false);

    // Still in line, and the screen still has them.
    const state = (await anon(wsfQueueState, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState;
    expect(state.waiting.map((e) => e.calledName)).toEqual(['Ida']);

    const mine = await attempt(callAs(wsfLeaveQueue, owner, { entryId: joined.entryId }));
    expect(mine.ok).toBe(true);
  });

  test('wsfMyQueueEntry answers about the caller and nobody else', async () => {
    const { groupId, goalId } = await scene();
    const a = await member(groupId, 'kit');
    const b = await member(groupId, 'lou');
    await callAs(wsfJoinQueue, a, { goalId, calledName: 'Kit' });
    await callAs(wsfJoinQueue, b, { goalId, calledName: 'Lou' });

    const mine = (await callAs(wsfMyQueueEntry, b, { goalId })) as {
      entry: { calledName: string; ahead: number } | null;
    };
    expect(mine.entry?.calledName).toBe('Lou');
    expect(mine.entry?.ahead).toBe(1);
    // A count, never a list: nobody else's name is in the answer.
    expect(JSON.stringify(mine)).not.toContain('Kit');
    expect(JSON.stringify(mine)).not.toContain(a);

    const stranger = (await callAs(wsfMyQueueEntry, uniq('stranger'), { goalId })) as {
      entry: unknown;
    };
    expect(stranger.entry).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ONE PLACE PER PERSON, AND A NUMBER THAT IS NEVER HANDED OUT TWICE
// ═══════════════════════════════════════════════════════════════════════════

describe('places in line', () => {
  test('two people joining at the same instant get DIFFERENT positions', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'mia');
    const b = await member(groupId, 'ned');
    const c = await member(groupId, 'oli');

    const results = (await Promise.all([
      callAs(wsfJoinQueue, a, { goalId, calledName: 'Mia' }),
      callAs(wsfJoinQueue, b, { goalId, calledName: 'Ned' }),
      callAs(wsfJoinQueue, c, { goalId, calledName: 'Oli' }),
    ])) as { position: number; entryId: string }[];

    const positions = results.map((r) => r.position);
    expect(new Set(positions).size).toBe(3);
    expect(new Set(results.map((r) => r.entryId)).size).toBe(3);

    const state = (await anon(wsfQueueState, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState;
    expect(state.waitingCount).toBe(3);
    // And the screen sees them in the order the counter handed out.
    expect(state.waiting.map((e) => e.position)).toEqual([...positions].sort((x, y) => x - y));
  });

  test('joining twice while waiting returns the SAME entry and the line does not grow', async () => {
    const { groupId, goalId, station } = await scene();
    const uid = await member(groupId, 'pat');
    const first = (await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Pat' })) as {
      entryId: string;
      position: number;
      alreadyInLine: boolean;
    };
    const second = (await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Patricia' })) as {
      entryId: string;
      position: number;
      calledName: string;
      alreadyInLine: boolean;
    };

    expect(first.alreadyInLine).toBe(false);
    expect(second.alreadyInLine).toBe(true);
    expect(second.entryId).toBe(first.entryId);
    expect(second.position).toBe(first.position);
    // A second tap must not silently relabel somebody who is already on a
    // screen in a room.
    expect(second.calledName).toBe('Pat');

    const state = (await anon(wsfQueueState, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState;
    expect(state.waitingCount).toBe(1);
  });

  test('two taps at the same instant are still one place in line', async () => {
    const { groupId, goalId, station } = await scene();
    const uid = await member(groupId, 'quin');
    const both = (await Promise.all([
      callAs(wsfJoinQueue, uid, { goalId, calledName: 'Quin' }),
      callAs(wsfJoinQueue, uid, { goalId, calledName: 'Quin' }),
    ])) as { entryId: string }[];
    expect(new Set(both.map((r) => r.entryId)).size).toBe(1);
    const state = (await anon(wsfQueueState, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState;
    expect(state.waitingCount).toBe(1);
  });

  test('joining again while CALLED does not take a second place', async () => {
    const { groupId, goalId, station } = await scene();
    const uid = await member(groupId, 'rae');
    const first = (await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Rae' })) as {
      entryId: string;
    };
    await anon(wsfCallNext, { stationId: station.stationId, secret: station.secret });
    const again = (await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Rae' })) as {
      entryId: string;
      status: string;
      alreadyInLine: boolean;
    };
    expect(again.entryId).toBe(first.entryId);
    expect(again.status).toBe('called');
    expect(again.alreadyInLine).toBe(true);
  });

  test('a position is never reused after somebody leaves', async () => {
    const { groupId, goalId } = await scene();
    const a = await member(groupId, 'sam');
    const b = await member(groupId, 'tay');
    const first = (await callAs(wsfJoinQueue, a, { goalId, calledName: 'Sam' })) as {
      entryId: string;
      position: number;
    };
    await callAs(wsfLeaveQueue, a, { entryId: first.entryId });
    const next = (await callAs(wsfJoinQueue, b, { goalId, calledName: 'Tay' })) as {
      position: number;
    };
    expect(next.position).toBeGreaterThan(first.position);
  });

  test('leaving and rejoining puts a person at the BACK, not back where they were', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'uma');
    const b = await member(groupId, 'vic');
    const first = (await callAs(wsfJoinQueue, a, { goalId, calledName: 'Uma' })) as {
      entryId: string;
    };
    await callAs(wsfJoinQueue, b, { goalId, calledName: 'Vic' });
    await callAs(wsfLeaveQueue, a, { entryId: first.entryId });
    await callAs(wsfJoinQueue, a, { goalId, calledName: 'Uma' });

    const state = (await anon(wsfQueueState, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState;
    expect(state.waiting.map((e) => e.calledName)).toEqual(['Vic', 'Uma']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CALLING
// ═══════════════════════════════════════════════════════════════════════════

describe('calling the next person', () => {
  test('the oldest place is called first, and their own phone is told', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'wes');
    const b = await member(groupId, 'xan');
    await callAs(wsfJoinQueue, a, { goalId, calledName: 'Wes' });
    await callAs(wsfJoinQueue, b, { goalId, calledName: 'Xan' });

    const called = (await anon(wsfCallNext, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState & { called: boolean };
    expect(called.called).toBe(true);
    expect(called.serving?.calledName).toBe('Wes');
    expect(called.waiting.map((e) => e.calledName)).toEqual(['Xan']);

    const mine = (await callAs(wsfMyQueueEntry, a, { goalId })) as {
      entry: { status: string; calledByLabel: string | null } | null;
    };
    expect(mine.entry?.status).toBe('called');
    expect(mine.entry?.calledByLabel).toBe(station.label);
  });

  test('TWO STATIONS CALLING AT THE SAME MOMENT DO NOT CALL THE SAME PERSON', async () => {
    const championUid = uniq('champ');
    const groupId = await seedCommunity(championUid);
    const goalId = await seedGoal(groupId);
    const one = await enrol({ goalId, championUid, slot: 1 });
    const two = await enrol({ goalId, championUid, slot: 2 });

    const a = await member(groupId, 'yan');
    const b = await member(groupId, 'zoe');
    await callAs(wsfJoinQueue, a, { goalId, calledName: 'Yan' });
    await callAs(wsfJoinQueue, b, { goalId, calledName: 'Zoe' });

    const [first, second] = (await Promise.all([
      anon(wsfCallNext, { stationId: one.stationId, secret: one.secret }),
      anon(wsfCallNext, { stationId: two.stationId, secret: two.secret }),
    ])) as (QueueState & { called: boolean })[];

    expect(first.called).toBe(true);
    expect(second.called).toBe(true);
    // The whole point: two screens, two different people.
    const names = [first.serving?.calledName, second.serving?.calledName].sort();
    expect(names).toEqual(['Yan', 'Zoe']);
    expect(first.serving!.entryId).not.toBe(second.serving!.entryId);

    // And the queue agrees: exactly one entry per station, nobody called twice.
    const db = getFirestore();
    const snap = await db.collection('wsfQueueEntries').where('queueId', '==', goalId).get();
    const called = snap.docs.map((d) => d.data() as Record<string, unknown>);
    expect(called.filter((e) => e.status === 'called')).toHaveLength(2);
    expect(new Set(called.map((e) => e.calledByStationId)).size).toBe(2);
  });

  test('two stations on a line of ONE call one person and one empty line', async () => {
    const championUid = uniq('champ');
    const groupId = await seedCommunity(championUid);
    const goalId = await seedGoal(groupId);
    const one = await enrol({ goalId, championUid, slot: 1 });
    const two = await enrol({ goalId, championUid, slot: 2 });
    const solo = await member(groupId, 'solo');
    await callAs(wsfJoinQueue, solo, { goalId, calledName: 'Solo' });

    const results = (await Promise.all([
      anon(wsfCallNext, { stationId: one.stationId, secret: one.secret }),
      anon(wsfCallNext, { stationId: two.stationId, secret: two.secret }),
    ])) as (QueueState & { called: boolean })[];

    expect(results.filter((r) => r.called)).toHaveLength(1);
    expect(results.filter((r) => r.serving !== null)).toHaveLength(1);
  });

  test('an empty line is a normal answer, not an error', async () => {
    const { station } = await scene();
    const r = (await anon(wsfCallNext, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState & { called: boolean };
    expect(r.called).toBe(false);
    expect(r.serving).toBeNull();
    expect(r.waitingCount).toBe(0);
  });

  test('leaving removes the person from what the station shows, on the next read', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'ada');
    const b = await member(groupId, 'bo');
    const first = (await callAs(wsfJoinQueue, a, { goalId, calledName: 'Ada' })) as {
      entryId: string;
    };
    await callAs(wsfJoinQueue, b, { goalId, calledName: 'Bo' });

    await callAs(wsfLeaveQueue, a, { entryId: first.entryId });
    const state = (await anon(wsfQueueState, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState;
    expect(state.waiting.map((e) => e.calledName)).toEqual(['Bo']);
  });

  test('leaving while CALLED takes the name off the screen immediately', async () => {
    const { groupId, goalId, station } = await scene();
    const uid = await member(groupId, 'cy');
    const joined = (await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Cy' })) as {
      entryId: string;
    };
    await anon(wsfCallNext, { stationId: station.stationId, secret: station.secret });

    const showing = (await anon(wsfQueueState, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState;
    expect(showing.serving?.calledName).toBe('Cy');

    await callAs(wsfLeaveQueue, uid, { entryId: joined.entryId });
    const after = (await anon(wsfQueueState, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState;
    // The entry is the truth; the station's cached pointer is not.
    expect(after.serving).toBeNull();
  });

  test('finishing clears the screen, and a station cannot finish another station’s person', async () => {
    const championUid = uniq('champ');
    const groupId = await seedCommunity(championUid);
    const goalId = await seedGoal(groupId);
    const one = await enrol({ goalId, championUid, slot: 1 });
    const two = await enrol({ goalId, championUid, slot: 2 });
    const uid = await member(groupId, 'dot');
    await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Dot' });

    const called = (await anon(wsfCallNext, {
      stationId: one.stationId,
      secret: one.secret,
    })) as QueueState & { called: boolean };
    expect(called.serving?.calledName).toBe('Dot');

    // Station 2 finishing does not close Station 1's call.
    await anon(wsfFinishServing, { stationId: two.stationId, secret: two.secret });
    const stillCalled = (await anon(wsfQueueState, {
      stationId: one.stationId,
      secret: one.secret,
    })) as QueueState;
    expect(stillCalled.serving?.calledName).toBe('Dot');

    const finished = (await anon(wsfFinishServing, {
      stationId: one.stationId,
      secret: one.secret,
    })) as QueueState;
    expect(finished.serving).toBeNull();

    // And the person is out of the line, so they may get back in.
    const mine = (await callAs(wsfMyQueueEntry, uid, { goalId })) as { entry: unknown };
    expect(mine.entry).toBeNull();
    const again = (await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Dot' })) as {
      alreadyInLine: boolean;
    };
    expect(again.alreadyInLine).toBe(false);
  });

  test('calling next finishes the person this screen was already serving', async () => {
    const { groupId, goalId, station } = await scene();
    const a = await member(groupId, 'eli');
    const b = await member(groupId, 'fin');
    const firstJoin = (await callAs(wsfJoinQueue, a, { goalId, calledName: 'Eli' })) as {
      entryId: string;
    };
    await callAs(wsfJoinQueue, b, { goalId, calledName: 'Fin' });

    await anon(wsfCallNext, { stationId: station.stationId, secret: station.secret });
    const second = (await anon(wsfCallNext, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState & { called: boolean };
    expect(second.serving?.calledName).toBe('Fin');

    const closed = (
      await getFirestore().doc(`wsfQueueEntries/${firstJoin.entryId}`).get()
    ).data() as Record<string, unknown>;
    expect(closed.status).toBe('done');
  });

  test('a call that is never finished expires, so the line does not wedge on somebody who left', async () => {
    const { groupId, goalId, station } = await scene();
    const uid = await member(groupId, 'gil');
    const joined = (await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Gil' })) as {
      entryId: string;
    };
    await anon(wsfCallNext, { stationId: station.stationId, secret: station.secret });

    // Eleven minutes ago, written directly: nothing in the product can make a
    // clock move, and a test that sleeps ten minutes is not a test.
    await getFirestore()
      .doc(`wsfQueueEntries/${joined.entryId}`)
      .update({ calledAt: Timestamp.fromMillis(Date.now() - 11 * 60 * 1000) });

    const state = (await anon(wsfQueueState, {
      stationId: station.stationId,
      secret: station.secret,
    })) as QueueState;
    expect(state.serving).toBeNull();

    const mine = (await callAs(wsfMyQueueEntry, uid, { goalId })) as { entry: unknown };
    expect(mine.entry).toBeNull();

    // And their place is free again.
    const again = (await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Gil' })) as {
      alreadyInLine: boolean;
      entryId: string;
    };
    expect(again.alreadyInLine).toBe(false);
    expect(again.entryId).not.toBe(joined.entryId);
  });

  test('a revoked screen cannot call anybody', async () => {
    const { groupId, goalId, station } = await scene();
    const uid = await member(groupId, 'hana');
    await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Hana' });
    await getFirestore()
      .doc(`wsfKioskStations/${station.stationId}`)
      .update({ status: 'revoked' });

    for (const fn of [wsfQueueState, wsfCallNext, wsfFinishServing]) {
      const r = await attempt(
        anon(fn, { stationId: station.stationId, secret: station.secret })
      );
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('permission-denied');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A QUEUE RECORDS NOTHING
// ═══════════════════════════════════════════════════════════════════════════

describe('being called is not recording', () => {
  test('a full cycle writes no contribution, no counter shard and no member total', async () => {
    const { groupId, goalId, station } = await scene();
    const db = getFirestore();
    const a = await member(groupId, 'iris');
    const b = await member(groupId, 'jax');

    const joinedA = (await callAs(wsfJoinQueue, a, { goalId, calledName: 'Iris' })) as {
      entryId: string;
    };
    await callAs(wsfJoinQueue, b, { goalId, calledName: 'Jax' });
    await anon(wsfCallNext, { stationId: station.stationId, secret: station.secret });
    await anon(wsfFinishServing, { stationId: station.stationId, secret: station.secret });
    await anon(wsfCallNext, { stationId: station.stationId, secret: station.secret });
    await callAs(wsfLeaveQueue, a, { entryId: joinedA.entryId });

    const contributions = await db
      .collection('wsfContributions')
      .where('goalId', '==', goalId)
      .get();
    expect(contributions.empty).toBe(true);

    const shards = await db.collection(`wsfGoalCounters/${goalId}/shards`).get();
    expect(shards.empty).toBe(true);

    for (const uid of [a, b]) {
      const total = await db.doc(`wsfGoalMemberTotals/${goalId}_${uid}`).get();
      expect(total.exists).toBe(false);
    }

    // The shared total is still zero, from the product's own read.
    const pulse = (await callAs(wsfGoalPulse, a, { goalId })) as { sharedTotal: number };
    expect(pulse.sharedTotal).toBe(0);
  });

  test('wsfGoalPulse still returns exactly its nine keys with a queue running', async () => {
    const { groupId, goalId, station } = await scene();
    const uid = await member(groupId, 'kai');
    await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Kai' });
    await anon(wsfCallNext, { stationId: station.stationId, secret: station.secret });

    const pulse = (await callAs(wsfGoalPulse, uid, { goalId })) as Record<string, unknown>;
    expect(Object.keys(pulse).sort()).toEqual([
      'communityDisplayName',
      'endsAt',
      'goalTitle',
      'sharedTotal',
      'startsAt',
      'status',
      'target',
      'timezone',
      'unit',
    ]);
    // And no queue label has leaked into the public aggregate.
    expect(JSON.stringify(pulse)).not.toContain('Kai');
  });

  test('a queue admits nobody: the community’s policy and code are untouched', async () => {
    const { groupId, goalId } = await scene();
    const db = getFirestore();
    const before = (await db.doc(`wsfCommunityGroups/${groupId}`).get()).data();
    const uid = await member(groupId, 'lyn');
    await callAs(wsfJoinQueue, uid, { goalId, calledName: 'Lyn' });
    const after = (await db.doc(`wsfCommunityGroups/${groupId}`).get()).data();
    expect(after).toEqual(before);
  });
});
