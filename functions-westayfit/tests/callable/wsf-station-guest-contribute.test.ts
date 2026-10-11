/**
 * KIOSK-GUEST-MOVE-1 — wsfStationGuestContribute: a walk-up guest's squats at
 * a paired kiosk count toward that station's goal.
 *
 * The queue's proof, here on the emulator:
 *   - a retry with the same attemptId counts once (one after another, and all
 *     at once);
 *   - a revoked station is refused, including one revoked after its
 *     credential was checked;
 *   - a busy station is refused: somebody waiting for its line, or a live
 *     turn at this screen;
 *   - the goal's shared total rises by exactly the count;
 *   - no raffle entry is written: nothing in wsfContributions, the raffle's
 *     only movement source (the raffle's own functions are driven against a
 *     guest move in tests/expo-prize/guest-never-a-ticket.test.ts).
 *
 * And what the packet asks besides: counts capped as completeTurn caps them,
 * a per-station rate limit, no uid and no name anywhere, the goal total moved
 * exactly as a member's contribution moves it (shard, recent-addition line,
 * combined parent credit, pulse freshness, target crossing), and an activity
 * feed that says nothing about a guest.
 *
 * All fixtures are synthetic and local to the demo-wsf-local emulator.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { FieldPath, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  GUEST_BUSY_MESSAGE,
  GUEST_LIMITS_COLLECTION,
  GUEST_MOVES_COLLECTION,
  GUEST_NOT_PUBLIC_MESSAGE,
  GUEST_ONCE_MESSAGE,
  GUEST_RATE_MAX,
  GUEST_RATE_MESSAGE,
  GUEST_RATE_WINDOW_MS,
  guestLinkId,
  guestMoveId,
  nextGuestRateWindow,
} from '../../src/guest-contribute';
import {
  wsfApproveStation,
  wsfCallNext,
  wsfCommunityActivity,
  wsfCompleteTurn,
  wsfContribute,
  wsfCreateCombinedGoal,
  wsfGoalPulse,
  wsfGoalRecentAdditions,
  wsfJoinTurnLine,
  wsfLeaveTurnLine,
  wsfRepairCombinedGoal,
  wsfRevokeStation,
  wsfStartTurn,
  wsfStationClaimPairing,
  wsfStationGuestContribute,
  wsfStationRequestPairing,
  wsfTurnReady,
  wsfTurnState,
} from '../../src/index';

type Data = Record<string, unknown>;

const REJECTED = 'This screen is not enrolled.';
const CLOSED = 'This goal is closed.';
const BAD_COUNT = 'count must be a positive integer up to 100000.';
const BAD_ATTEMPT = 'attemptId must be 8..128 chars of A-Z, a-z, 0-9, _ or -.';
const RESPONSE_KEYS = ['after', 'alreadyRecorded', 'amount', 'before', 'recorded', 'status', 'target', 'unit'];

/** A station call, from `ip`. Refusal tests use their own documentation-range
 * address so the station credential limiter (per IP) never couples suites. */
function anon(fn: unknown, data: Data, ip = '127.0.0.1') {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: undefined,
    rawRequest: { ip, headers: {} },
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
/** A fresh attempt id, as the kiosk mints one per guest set. */
function aid(): string {
  return uniq('guestAttempt');
}
let ipSeq = 0;
function freshIp(): string {
  ipSeq += 1;
  return `198.51.100.${(ipSeq % 250) + 1}`;
}
/**
 * The address each enrolment comes from. Requesting and claiming a pairing
 * both charge the per-IP station limiter (300 a minute), and this suite enrols
 * over a hundred screens: from 127.0.0.1 it would spend the budget the other
 * station suites share with it in a parallel run, and a second run inside the
 * same minute would be refused. Each enrolment gets its own address in the
 * IPv6 documentation range, salted per run.
 */
const ENROL_SALT = (Date.now() % 0xffff).toString(16);
let enrolSeq = 0;
function enrolIp(): string {
  enrolSeq += 1;
  return `2001:db8:${ENROL_SALT}::${enrolSeq.toString(16)}`;
}

type Station = { stationId: string; secret: string; label: string };
type GuestReply = {
  recorded: boolean;
  alreadyRecorded: boolean;
  amount: number;
  unit: string;
  before: number | null;
  after: number | null;
  target: number | null;
  status: string | null;
};

// ── synthetic fixtures ──────────────────────────────────────────────────────

async function seedCommunity(championUid: string): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('guestGroup');
  await db.doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'Synthetic Guest Hall',
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

async function seedGoal(groupId: string, extra: Data = {}): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: 'guestSeed',
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
    ...extra,
  });
  return ref.id;
}

async function enrol(goalId: string, championUid: string, slot: 1 | 2 = 1): Promise<Station> {
  const ip = enrolIp();
  const requested = (await anon(wsfStationRequestPairing, { goalId }, ip)) as {
    pairingId: string;
    code: string;
  };
  await callAs(wsfApproveStation, championUid, { goalId, code: requested.code, slot });
  return (await anon(wsfStationClaimPairing, { pairingId: requested.pairingId }, ip)) as Station;
}

/** A community, an open public goal, a Champion, and two screens on it. */
async function scene(goalExtra: Data = {}) {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalId = await seedGoal(groupId, goalExtra);
  const one = await enrol(goalId, championUid, 1);
  const two = await enrol(goalId, championUid, 2);
  return { groupId, goalId, championUid, one, two };
}

/** A COMBINED event: two activity goals behind one setup, a screen on each. */
async function combinedScene() {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const now = Date.now();
  const squats = await seedGoal(groupId, { title: 'Squats', unit: 'squats' });
  const pushups = await seedGoal(groupId, { title: 'Push-ups', unit: 'push-ups' });
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
  const squatScreen = await enrol(squats, championUid, 1);
  const pushupScreen = await enrol(pushups, championUid, 2);
  return { groupId, championUid, setupId: created.setupId, squats, pushups, squatScreen, pushupScreen };
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

const guest = (s: Station, count: unknown, attemptId: unknown, extra: Data = {}, ip?: string) =>
  anon(
    wsfStationGuestContribute,
    { stationId: s.stationId, secret: s.secret, count, attemptId, ...extra },
    ip
  ) as Promise<GuestReply>;

const join = (goalId: string, uid: string, calledName: string) =>
  callAs(wsfJoinTurnLine, uid, { goalId, calledName }) as Promise<{ entryId: string }>;
const turnState = (s: Station) =>
  anon(wsfTurnState, { stationId: s.stationId, secret: s.secret }) as Promise<{
    assigned: { turnRef: string | null } | null;
  }>;
const callNext = (s: Station) =>
  anon(wsfCallNext, { stationId: s.stationId, secret: s.secret }) as Promise<{ called: boolean }>;
const revoke = (championUid: string, s: Station) =>
  callAs(wsfRevokeStation, championUid, { stationId: s.stationId });

async function callUp(s: Station): Promise<string> {
  expect((await callNext(s)).called).toBe(true);
  const ref = (await turnState(s)).assigned?.turnRef;
  expect(typeof ref).toBe('string');
  return ref as string;
}

async function lapseLease(entryId: string): Promise<void> {
  await getFirestore()
    .doc(`wsfTurnEntries/${entryId}`)
    .update({ readyLeaseExpiresAt: Timestamp.fromMillis(Date.now() - 1_000) });
}

async function shardSum(goalId: string): Promise<number> {
  const snap = await getFirestore().collection(`wsfGoalCounters/${goalId}/shards`).get();
  return snap.docs.reduce((t, d) => t + (((d.data() as { count?: number }).count ?? 0) as number), 0);
}

async function combinedShardSum(setupId: string, goalId: string): Promise<number> {
  const snap = await getFirestore().collection(`wsfCombinedCounters/${setupId}/shards`).get();
  return snap.docs
    .filter((d) => d.id.startsWith(`${goalId}_`))
    .reduce((t, d) => t + (((d.data() as { count?: number }).count ?? 0) as number), 0);
}

async function moveDoc(s: Station, attemptId: string) {
  return getFirestore().doc(`${GUEST_MOVES_COLLECTION}/${guestMoveId(s.stationId, attemptId)}`).get();
}

async function guestMovesFor(goalId: string) {
  return (await getFirestore().collection(GUEST_MOVES_COLLECTION).where('goalId', '==', goalId).get()).docs;
}

async function windowOf(s: Station) {
  return (await getFirestore().doc(`${GUEST_LIMITS_COLLECTION}/${s.stationId}`).get()).data() ?? null;
}

async function recentLines(goalId: string) {
  return (await getFirestore().collection(`wsfGoals/${goalId}/recentAdditions`).get()).docs;
}

/** Every member-scoped row for the goal: contributions and member totals. */
async function memberRowsFor(goalId: string): Promise<number> {
  const db = getFirestore();
  const contribs = await db.collection('wsfContributions').where('goalId', '==', goalId).get();
  const totals = await db
    .collection('wsfGoalMemberTotals')
    .orderBy(FieldPath.documentId())
    .startAt(`${goalId}_`)
    .endAt(`${goalId}_`)
    .get();
  return contribs.size + totals.size;
}

/** Everything the turn line and the screens hold, raw, for "wrote nothing". */
async function turnSnapshot(lineId: string, stations: Station[]): Promise<string> {
  const db = getFirestore();
  const line = await db.doc(`wsfTurnLines/${lineId}`).get();
  const entries = await db.collection('wsfTurnEntries').where('lineId', '==', lineId).get();
  const screens = await Promise.all(stations.map((s) => db.doc(`wsfKioskStations/${s.stationId}`).get()));
  const strip = (d: FirebaseFirestore.DocumentSnapshot) =>
    d.exists ? { id: d.id, data: d.data(), updateTime: d.updateTime?.toMillis() } : { id: d.id };
  return JSON.stringify({
    line: strip(line),
    entries: entries.docs.map(strip).sort((a, b) => a.id.localeCompare(b.id)),
    screens: screens.map(strip),
  });
}

/** Every string value anywhere in a payload, however deeply nested. */
function deepStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) deepStrings(v, out);
  else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepStrings(v, out);
  }
  return out;
}

/** Proof that a refused call wrote nothing a guest move writes. */
async function expectNothingWritten(goalId: string, s: Station, attemptId: string, total: number) {
  expect(await shardSum(goalId)).toBe(total);
  expect((await moveDoc(s, attemptId)).exists).toBe(false);
  expect((await getFirestore().doc(`wsfGoals/${goalId}/recentAdditions/${guestLinkId(s.stationId, attemptId)}`).get()).exists).toBe(false);
}

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-station-guest-contribute').set({ at: Date.now() }, { merge: true });
}, 30_000);

afterEach(() => jest.restoreAllMocks());

// ═══════════════════════════════════════════════════════════════════════════
// 1. THE MOVE: the shared total rises by exactly the count, and nothing else
// ═══════════════════════════════════════════════════════════════════════════

describe('a guest move', () => {
  test('raises the shared total by exactly the count, and answers with the receipt', async () => {
    const { goalId, one } = await scene();
    const a = aid();
    const reply = await guest(one, 12, a);

    expect(reply).toEqual({
      recorded: true,
      alreadyRecorded: false,
      amount: 12,
      unit: 'squats',
      before: 0,
      after: 12,
      target: 5000,
      status: 'active',
    });
    expect(Object.keys(reply).sort()).toEqual(RESPONSE_KEYS);
    expect(await shardSum(goalId)).toBe(12);

    // And a second guest, after members' movement already counted, moves it
    // by its own count and no more.
    const before = await shardSum(goalId);
    const second = await guest(one, 7, aid());
    expect(second).toMatchObject({ recorded: true, amount: 7, before, after: before + 7 });
    expect(await shardSum(goalId)).toBe(before + 7);
  });

  test('is one stored row with no uid, no name and no device detail, and nothing member-scoped', async () => {
    const { goalId, groupId, championUid, one } = await scene();
    const signedIn = await member(groupId, 'kioskOwner');
    const a = aid();
    // The kiosk may be signed in as somebody, and a client may send anything:
    // none of it is read, stored or returned.
    const reply = (await callAs(wsfStationGuestContribute, signedIn, {
      stationId: one.stationId,
      secret: one.secret,
      count: 9,
      attemptId: a,
      goalId: 'someOtherGoal',
      calledName: 'Guest Gus',
      name: 'Gus Walkup',
      deviceId: 'device-guest-42',
      photoUrl: 'https://example.invalid/guest.jpg',
      userId: signedIn,
    })) as GuestReply;
    expect(reply).toMatchObject({ recorded: true, amount: 9 });

    const snap = await moveDoc(one, a);
    expect(snap.exists).toBe(true);
    const row = snap.data() as Data;
    expect(Object.keys(row).sort()).toEqual(
      ['attemptId', 'communityGroupId', 'count', 'createdAt', 'goalId', 'shardIndex', 'source', 'stationId', 'unit']
    );
    expect(row).toMatchObject({
      source: 'kioskGuest',
      stationId: one.stationId,
      attemptId: a,
      goalId,
      communityGroupId: groupId,
      unit: 'squats',
      count: 9,
    });
    expect(Number.isInteger(row.shardIndex)).toBe(true);
    expect(row.createdAt).toBeInstanceOf(Timestamp);

    const line = (await getFirestore().doc(`wsfGoals/${goalId}/recentAdditions/${guestLinkId(one.stationId, a)}`).get()).data();
    const written = [row, line, await windowOf(one)];
    const leaks = [signedIn, championUid, 'Guest Gus', 'Gus Walkup', 'device-guest-42', 'example.invalid', 'someOtherGoal', one.secret];
    for (const s of deepStrings(written)) for (const leak of leaks) expect(s).not.toContain(leak);

    // Nothing in wsfContributions (the raffle's only source, and the
    // activity feed's scan) and no member total, for anybody.
    expect(await memberRowsFor(goalId)).toBe(0);
    expect(await memberRowsFor('someOtherGoal')).toBe(0);
    expect(await shardSum(goalId)).toBe(9);
  });

  test('the answer names nothing: no station, attempt, secret or person', async () => {
    const { championUid, one } = await scene();
    const a = aid();
    for (const reply of [await guest(one, 4, a), await guest(one, 4, a)]) {
      expect(Object.keys(reply).sort()).toEqual(RESPONSE_KEYS);
      for (const s of deepStrings(reply)) {
        for (const leak of [one.stationId, one.secret, a, championUid, one.label]) {
          expect(s).not.toContain(leak);
        }
      }
    }
  });

  test('writes no turn: the line, its entries and both screens are untouched', async () => {
    const { goalId, groupId, one, two } = await scene();
    // A finished member turn first, so the line has a lastResult and history.
    const m = await member(groupId, 'mae');
    const mae = await join(goalId, m, 'Mae');
    const ref = await callUp(one);
    await callAs(wsfTurnReady, m, { entryId: mae.entryId });
    await anon(wsfStartTurn, { stationId: one.stationId, secret: one.secret, expectedTurn: ref });
    await anon(wsfCompleteTurn, { stationId: one.stationId, secret: one.secret, count: 5, expectedTurn: ref });

    const lineId = `goal__${goalId}`;
    const before = await turnSnapshot(lineId, [one, two]);
    await guest(one, 11, aid());
    await guest(two, 3, aid());
    expect(await turnSnapshot(lineId, [one, two])).toBe(before);
    expect(await shardSum(goalId)).toBe(5 + 11 + 3);
  }, 60_000);

  test('a member contribution with the same attemptId is a different record: both count, neither overwrites the other', async () => {
    const { goalId, groupId, one } = await scene();
    const m = await member(groupId, 'max');
    const shared = aid();
    await callAs(wsfContribute, m, { goalId, count: 20, attemptId: shared });
    await guest(one, 6, shared);

    expect(await shardSum(goalId)).toBe(26);
    const lines = await recentLines(goalId);
    expect(lines.map((d) => d.data().amount).sort((x, y) => x - y)).toEqual([6, 20]);
    expect(lines.map((d) => d.id)).toContain(guestLinkId(one.stationId, shared));
    // The member's record is the member's alone.
    const contribs = await getFirestore().collection('wsfContributions').where('goalId', '==', goalId).get();
    expect(contribs.docs.map((d) => d.data().count)).toEqual([20]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. A RETRY COUNTS ONCE
// ═══════════════════════════════════════════════════════════════════════════

describe('the same attemptId counts once', () => {
  test('one after another: the retry answers alreadyRecorded with the stored amount and moves nothing', async () => {
    const { goalId, one } = await scene();
    const a = aid();
    const first = await guest(one, 15, a);
    // A retry that (wrongly) carries a different count still answers what was
    // recorded — the stored count is the truth.
    const retry = await guest(one, 99, a);
    const third = await guest(one, 15, a);

    expect(first).toMatchObject({ recorded: true, alreadyRecorded: false, amount: 15, before: 0, after: 15 });
    for (const r of [retry, third]) {
      expect(r).toEqual({
        recorded: false,
        alreadyRecorded: true,
        amount: 15,
        unit: 'squats',
        before: null,
        after: 15,
        target: 5000,
        status: 'active',
      });
    }
    expect(await shardSum(goalId)).toBe(15);
    expect(await guestMovesFor(goalId)).toHaveLength(1);
    expect(await recentLines(goalId)).toHaveLength(1);
    // The window is charged for the move, not for its retries.
    expect(await windowOf(one)).toMatchObject({ count: 1 });
  });

  test('all at once: exactly one of the racing calls records, and the total rises once', async () => {
    const { goalId, one } = await scene();
    const a = aid();
    const replies = await Promise.all([1, 2, 3, 4].map(() => guest(one, 25, a)));
    expect(replies.filter((r) => r.recorded)).toHaveLength(1);
    expect(replies.filter((r) => r.alreadyRecorded)).toHaveLength(3);
    for (const r of replies) expect(r.amount).toBe(25);
    expect(await shardSum(goalId)).toBe(25);
    expect(await guestMovesFor(goalId)).toHaveLength(1);
    expect(await recentLines(goalId)).toHaveLength(1);
  }, 60_000);

  test('a recorded attempt is never refused afterwards: its retry answers after the goal closes, the line fills, or the window fills', async () => {
    const { goalId, groupId, one } = await scene();
    const a = aid();
    await guest(one, 8, a);

    // The line fills…
    const m = await member(groupId, 'meg');
    const meg = await join(goalId, m, 'Meg');
    expect(await guest(one, 8, a)).toMatchObject({ alreadyRecorded: true, amount: 8, after: 8 });
    await callAs(wsfLeaveTurnLine, m, { entryId: meg.entryId });

    // …the window fills…
    await getFirestore().doc(`${GUEST_LIMITS_COLLECTION}/${one.stationId}`).set({ windowStartMs: Date.now(), count: GUEST_RATE_MAX });
    expect(await guest(one, 8, a)).toMatchObject({ alreadyRecorded: true, amount: 8 });

    // …the goal closes.
    await getFirestore().doc(`wsfGoals/${goalId}`).update({ status: 'closed' });
    expect(await guest(one, 8, a)).toEqual({
      recorded: false,
      alreadyRecorded: true,
      amount: 8,
      unit: 'squats',
      before: null,
      after: 8,
      target: 5000,
      status: 'closed',
    });
    expect(await shardSum(goalId)).toBe(8);
  }, 40_000);

  test('a retry after the goal stops being public answers without the shared total', async () => {
    const { goalId, one } = await scene();
    const a = aid();
    await guest(one, 5, a);
    await getFirestore().doc(`wsfGoals/${goalId}`).update({ aggregateDisplayAuthorized: false });
    expect(await guest(one, 5, a)).toEqual({
      recorded: false,
      alreadyRecorded: true,
      amount: 5,
      unit: 'squats',
      before: null,
      after: null,
      target: null,
      status: null,
    });
  });

  test('attempt ids are the station\'s own: the same id at the other screen is that screen\'s own guest', async () => {
    const { goalId, one, two } = await scene();
    const a = aid();
    expect((await guest(one, 4, a)).recorded).toBe(true);
    expect((await guest(two, 6, a)).recorded).toBe(true);
    expect(await shardSum(goalId)).toBe(10);
    expect(await guestMovesFor(goalId)).toHaveLength(2);
    // Each has its own recent-addition line: neither screen's overwrote the other's.
    const lines = await recentLines(goalId);
    expect(lines.map((d) => d.id).sort()).toEqual([guestLinkId(one.stationId, a), guestLinkId(two.stationId, a)].sort());
    expect(lines.map((d) => d.data().amount).sort((x, y) => x - y)).toEqual([4, 6]);
  });

  test.each(['source', 'stationId', 'goalId', 'attemptId'])(
    'a stored row whose %s does not match the request is refused, never trusted',
    async (field) => {
      const { goalId, one } = await scene();
      const a = aid();
      const row: Data = { source: 'kioskGuest', stationId: one.stationId, attemptId: a, goalId, unit: 'squats', count: 1000 };
      row[field] = `${String(row[field])}X`;
      await getFirestore().doc(`${GUEST_MOVES_COLLECTION}/${guestMoveId(one.stationId, a)}`).set(row);
      expectRefused(await attempt(guest(one, 3, a)), 'internal', 'Guest record mismatch.');
      expect(await shardSum(goalId)).toBe(0);
    }
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. ONLY AN ENROLLED, ACTIVE STATION
// ═══════════════════════════════════════════════════════════════════════════

describe('the station credential', () => {
  test('a revoked station is refused and writes nothing', async () => {
    const { goalId, championUid, one } = await scene();
    await revoke(championUid, one);
    const a = aid();
    expectRefused(await attempt(guest(one, 10, a, {}, freshIp())), 'permission-denied', REJECTED);
    await expectNothingWritten(goalId, one, a, 0);
  });

  test('a station revoked after its credential was checked, before the transaction, records nothing', async () => {
    const { goalId, championUid, one } = await scene();
    const fs = getFirestore();
    const proto = Object.getPrototypeOf(fs) as { runTransaction: (...a: unknown[]) => unknown };
    const original = proto.runTransaction;
    let revokedFirst = false;
    jest.spyOn(proto, 'runTransaction').mockImplementationOnce(async function (this: unknown, ...args: unknown[]) {
      await revoke(championUid, one);
      revokedFirst = true;
      return original.apply(this, args);
    });
    const a = aid();
    expectRefused(await attempt(guest(one, 10, a)), 'permission-denied', REJECTED);
    expect(revokedFirst).toBe(true);
    await expectNothingWritten(goalId, one, a, 0);
  });

  test('a revoked station cannot even replay a move it recorded', async () => {
    const { goalId, championUid, one } = await scene();
    const a = aid();
    await guest(one, 10, a);
    await revoke(championUid, one);
    expectRefused(await attempt(guest(one, 10, a, {}, freshIp())), 'permission-denied', REJECTED);
    expect(await shardSum(goalId)).toBe(10);
  });

  test('a wrong secret, a missing secret and an unknown station are the same refusal', async () => {
    const { goalId, one } = await scene();
    const a = aid();
    const ip = freshIp();
    const wrong = { ...one, secret: one.secret.replace(/.$/, (c) => (c === '0' ? '1' : '0')) };
    expectRefused(await attempt(guest(wrong, 10, a, {}, ip)), 'permission-denied', REJECTED);
    expectRefused(await attempt(guest({ ...one, secret: '' }, 10, a, {}, ip)), 'permission-denied', REJECTED);
    expectRefused(await attempt(guest({ ...one, stationId: uniq('noSuchStation') }, 10, a, {}, ip)), 'permission-denied', REJECTED);
    await expectNothingWritten(goalId, one, a, 0);
  });

  test('a bad credential is refused before the payload is even read', async () => {
    const { one } = await scene();
    const r = await attempt(guest({ ...one, secret: 'nope' }, -5, 'x', {}, freshIp()));
    expectRefused(r, 'permission-denied', REJECTED);
  });

  test('the station names the goal: a goalId in the request is ignored', async () => {
    const { goalId, one } = await scene();
    const other = await scene();
    await guest(one, 13, aid(), { goalId: other.goalId });
    expect(await shardSum(goalId)).toBe(13);
    expect(await shardSum(other.goalId)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. A BUSY STATION IS REFUSED
// ═══════════════════════════════════════════════════════════════════════════

describe('a station with anyone waiting or assigned', () => {
  test('somebody waiting for the line: refused at every screen on the goal, and nothing is written', async () => {
    const { goalId, groupId, one, two } = await scene();
    const m = await member(groupId, 'ned');
    const ned = await join(goalId, m, 'Ned');
    const lineId = `goal__${goalId}`;
    const before = await turnSnapshot(lineId, [one, two]);
    for (const s of [one, two]) {
      const a = aid();
      expectRefused(await attempt(guest(s, 10, a)), 'failed-precondition', GUEST_BUSY_MESSAGE);
      await expectNothingWritten(goalId, s, a, 0);
      // A refusal is never charged to the window.
      expect(await windowOf(s)).toBeNull();
    }
    expect(await turnSnapshot(lineId, [one, two])).toBe(before);

    // Once the line is clear, a guest can move.
    await callAs(wsfLeaveTurnLine, m, { entryId: ned.entryId });
    expect((await guest(one, 10, aid())).recorded).toBe(true);
  }, 40_000);

  test('a live turn at THIS screen refuses it; the other screen, free, takes a guest; the finished turn frees it', async () => {
    const { goalId, groupId, one, two } = await scene();
    const m = await member(groupId, 'ola');
    const ola = await join(goalId, m, 'Ola');
    const ref = await callUp(one); // assigned at one; nobody waiting now

    expectRefused(await attempt(guest(one, 10, aid())), 'failed-precondition', GUEST_BUSY_MESSAGE);
    expect((await guest(two, 10, aid())).recorded).toBe(true);

    await callAs(wsfTurnReady, m, { entryId: ola.entryId });
    expectRefused(await attempt(guest(one, 10, aid())), 'failed-precondition', GUEST_BUSY_MESSAGE);
    await anon(wsfStartTurn, { stationId: one.stationId, secret: one.secret, expectedTurn: ref });
    expectRefused(await attempt(guest(one, 10, aid())), 'failed-precondition', GUEST_BUSY_MESSAGE);

    await anon(wsfCompleteTurn, { stationId: one.stationId, secret: one.secret, count: 4, expectedTurn: ref });
    expect((await guest(one, 10, aid())).recorded).toBe(true);
    expect(await shardSum(goalId)).toBe(10 + 4 + 10);
  }, 60_000);

  test('an assigned turn whose lease ran out is not live: the screen takes a guest', async () => {
    const { goalId, groupId, one } = await scene();
    const m = await member(groupId, 'pia');
    const entry = await join(goalId, m, 'Pia');
    await callUp(one);
    expectRefused(await attempt(guest(one, 10, aid())), 'failed-precondition', GUEST_BUSY_MESSAGE);
    await lapseLease(entry.entryId);
    expect((await guest(one, 10, aid())).recorded).toBe(true);
    expect(await shardSum(goalId)).toBe(10);
  }, 40_000);

  test('a combined event: somebody waiting on the OTHER activity holds the shared line, so both screens refuse', async () => {
    const { groupId, squats, pushups, squatScreen, pushupScreen } = await combinedScene();
    const m = await member(groupId, 'quin');
    await join(pushups, m, 'Quin');
    expectRefused(await attempt(guest(squatScreen, 10, aid())), 'failed-precondition', GUEST_BUSY_MESSAGE);
    expectRefused(await attempt(guest(pushupScreen, 10, aid())), 'failed-precondition', GUEST_BUSY_MESSAGE);
    expect(await shardSum(squats)).toBe(0);
    expect(await shardSum(pushups)).toBe(0);
  }, 40_000);

  test('a combined event: somebody still waiting on a CLOSED activity is nobody the line will call, so the open screen takes a guest', async () => {
    const { groupId, squats, pushups, squatScreen } = await combinedScene();
    const m = await member(groupId, 'rae');
    await join(pushups, m, 'Rae');
    await getFirestore().doc(`wsfGoals/${pushups}`).update({ status: 'closed' });
    expect((await guest(squatScreen, 10, aid())).recorded).toBe(true);
    expect(await shardSum(squats)).toBe(10);
  }, 40_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. THE PAYLOAD: counts capped as completeTurn caps them
// ═══════════════════════════════════════════════════════════════════════════

describe('count and attemptId', () => {
  test.each([0, -1, 1.5, '12', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, 100_001])(
    'count %p is refused and writes nothing',
    async (count) => {
      const { goalId, one } = await scene();
      const a = aid();
      expectRefused(await attempt(guest(one, count, a)), 'invalid-argument', BAD_COUNT);
      await expectNothingWritten(goalId, one, a, 0);
    }
  );

  test('the cap itself, 100000, is a legal count', async () => {
    const { goalId, one } = await scene({ target: 1_000_000 });
    expect(await guest(one, 100_000, aid())).toMatchObject({ recorded: true, amount: 100_000 });
    expect(await shardSum(goalId)).toBe(100_000);
  });

  test.each(['short', 'x'.repeat(129), 'has~tilde1', 'has space1', 'slash/inside', 42, null, undefined])(
    'attemptId %p is refused and writes nothing',
    async (attemptId) => {
      const { goalId, one } = await scene();
      expectRefused(await attempt(guest(one, 10, attemptId)), 'invalid-argument', BAD_ATTEMPT);
      expect(await shardSum(goalId)).toBe(0);
      expect(await guestMovesFor(goalId)).toHaveLength(0);
    }
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. THE GOAL MUST TAKE A GUEST
// ═══════════════════════════════════════════════════════════════════════════

describe('the goal', () => {
  const cases: Array<[string, (goalId: string, groupId: string) => Promise<unknown>, string, string]> = [
    ['closed', (g) => getFirestore().doc(`wsfGoals/${g}`).update({ status: 'closed' }), 'failed-precondition', CLOSED],
    [
      'not started',
      (g) => getFirestore().doc(`wsfGoals/${g}`).update({ startsAt: Timestamp.fromMillis(Date.now() + 3_600_000) }),
      'failed-precondition',
      'Goal has not started yet.',
    ],
    [
      'ended',
      (g) => getFirestore().doc(`wsfGoals/${g}`).update({ endsAt: Timestamp.fromMillis(Date.now() - 1_000) }),
      'failed-precondition',
      'Goal window has ended.',
    ],
    ['once per member', (g) => getFirestore().doc(`wsfGoals/${g}`).update({ repeatPolicy: 'once' }), 'failed-precondition', GUEST_ONCE_MESSAGE],
    [
      'of an unknown repeat policy',
      (g) => getFirestore().doc(`wsfGoals/${g}`).update({ repeatPolicy: 'twice' }),
      'failed-precondition',
      GUEST_ONCE_MESSAGE,
    ],
    [
      'not authorized for public display',
      (g) => getFirestore().doc(`wsfGoals/${g}`).update({ aggregateDisplayAuthorized: false }),
      'failed-precondition',
      GUEST_NOT_PUBLIC_MESSAGE,
    ],
    [
      'authorized only by a truthy non-boolean',
      (g) => getFirestore().doc(`wsfGoals/${g}`).update({ aggregateDisplayAuthorized: 'true' }),
      'failed-precondition',
      GUEST_NOT_PUBLIC_MESSAGE,
    ],
    [
      'in a sample community',
      (_g, group) => getFirestore().doc(`wsfCommunityGroups/${group}`).update({ isSample: true }),
      'failed-precondition',
      GUEST_NOT_PUBLIC_MESSAGE,
    ],
    [
      'in a deleted community',
      (_g, group) => getFirestore().doc(`wsfCommunityGroups/${group}`).delete(),
      'failed-precondition',
      GUEST_NOT_PUBLIC_MESSAGE,
    ],
  ];

  test.each(cases)('a goal that is %s refuses a guest and writes nothing', async (_name, change, code, message) => {
    const { goalId, groupId, one } = await scene();
    await change(goalId, groupId);
    const a = aid();
    expectRefused(await attempt(guest(one, 10, a)), code, message);
    await expectNothingWritten(goalId, one, a, 0);
    expect(await windowOf(one)).toBeNull();
  });

  test('a goal with no repeat policy at all (every legacy goal) takes guests', async () => {
    const { goalId, one } = await scene();
    const { FieldValue } = await import('firebase-admin/firestore');
    await getFirestore().doc(`wsfGoals/${goalId}`).update({ repeatPolicy: FieldValue.delete() });
    expect((await guest(one, 10, aid())).recorded).toBe(true);
  });

  test('a goal that disappears is not found, before or inside the transaction', async () => {
    const { goalId, one } = await scene();
    // Gone before the call: the station's event no longer resolves.
    const gone = await scene();
    await getFirestore().doc(`wsfGoals/${gone.goalId}`).delete();
    expectRefused(await attempt(guest(gone.one, 10, aid())), 'not-found', 'This link is not valid.');

    // Gone between the preflight and the transaction.
    const fs = getFirestore();
    const proto = Object.getPrototypeOf(fs) as { runTransaction: (...a: unknown[]) => unknown };
    const original = proto.runTransaction;
    jest.spyOn(proto, 'runTransaction').mockImplementationOnce(async function (this: unknown, ...args: unknown[]) {
      await getFirestore().doc(`wsfGoals/${goalId}`).delete();
      return original.apply(this, args);
    });
    const a = aid();
    expectRefused(await attempt(guest(one, 10, a)), 'not-found', 'Goal not found.');
    expect((await moveDoc(one, a)).exists).toBe(false);
    expect(await shardSum(goalId)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. THE PER-STATION RATE LIMIT
// ═══════════════════════════════════════════════════════════════════════════

describe('the per-station guest window', () => {
  test(`${GUEST_RATE_MAX} moves fill the window; the next is refused and writes nothing; the other screen is unaffected`, async () => {
    const { goalId, one, two } = await scene();
    for (let i = 0; i < GUEST_RATE_MAX; i++) expect((await guest(one, 1, aid())).recorded).toBe(true);
    const a = aid();
    expectRefused(await attempt(guest(one, 1, a)), 'resource-exhausted', GUEST_RATE_MESSAGE);
    await expectNothingWritten(goalId, one, a, GUEST_RATE_MAX);
    expect(await windowOf(one)).toMatchObject({ count: GUEST_RATE_MAX });
    expect((await guest(two, 1, aid())).recorded).toBe(true);
  }, 60_000);

  test('the window is decided inside the transaction: racing moves record at most the cap', async () => {
    const { goalId, one } = await scene();
    const replies = await Promise.all(
      Array.from({ length: GUEST_RATE_MAX + 2 }, () => attempt(guest(one, 3, aid())))
    );
    const recorded = replies.filter((r) => r.ok);
    const refused = replies.filter((r) => !r.ok);
    expect(recorded).toHaveLength(GUEST_RATE_MAX);
    for (const r of refused) expectRefused(r, 'resource-exhausted', GUEST_RATE_MESSAGE);
    expect(await shardSum(goalId)).toBe(3 * GUEST_RATE_MAX);
    expect(await guestMovesFor(goalId)).toHaveLength(GUEST_RATE_MAX);
  }, 90_000);

  test('an expired window starts again; a window more than a whole window in the future is not trusted', async () => {
    const { one } = await scene();
    const ref = getFirestore().doc(`${GUEST_LIMITS_COLLECTION}/${one.stationId}`);
    await ref.set({ windowStartMs: Date.now() - GUEST_RATE_WINDOW_MS - 1, count: GUEST_RATE_MAX });
    expect((await guest(one, 1, aid())).recorded).toBe(true);
    expect((await ref.get()).data()).toMatchObject({ count: 1 });

    await ref.set({ windowStartMs: Date.now() + 3_600_000, count: GUEST_RATE_MAX });
    expect((await guest(one, 1, aid())).recorded).toBe(true);
    expect((await ref.get()).data()).toMatchObject({ count: 1 });
  });

  test('nextGuestRateWindow, the whole table', () => {
    const now = 1_000_000;
    expect(nextGuestRateWindow(null, now)).toEqual({ windowStartMs: now, count: 1 });
    expect(nextGuestRateWindow(undefined, now)).toEqual({ windowStartMs: now, count: 1 });
    expect(nextGuestRateWindow({ windowStartMs: 'x', count: 3 }, now)).toEqual({ windowStartMs: now, count: 1 });
    expect(nextGuestRateWindow({ windowStartMs: now - 10, count: 2 }, now)).toEqual({ windowStartMs: now - 10, count: 3 });
    expect(nextGuestRateWindow({ windowStartMs: now - 10, count: GUEST_RATE_MAX - 1 }, now)).toEqual({
      windowStartMs: now - 10,
      count: GUEST_RATE_MAX,
    });
    expect(nextGuestRateWindow({ windowStartMs: now - 10, count: GUEST_RATE_MAX }, now)).toBeNull();
    expect(nextGuestRateWindow({ windowStartMs: now - 10, count: 'lots' }, now)).toEqual({ windowStartMs: now - 10, count: 1 });
    expect(nextGuestRateWindow({ windowStartMs: now - GUEST_RATE_WINDOW_MS, count: GUEST_RATE_MAX }, now)).toEqual({
      windowStartMs: now,
      count: 1,
    });
    expect(nextGuestRateWindow({ windowStartMs: now - GUEST_RATE_WINDOW_MS + 1, count: GUEST_RATE_MAX }, now)).toBeNull();
    // A start just after `now` is the window a racing move opened: it counts.
    expect(nextGuestRateWindow({ windowStartMs: now + 1, count: GUEST_RATE_MAX }, now)).toBeNull();
    expect(nextGuestRateWindow({ windowStartMs: now + 5, count: 2 }, now)).toEqual({ windowStartMs: now + 5, count: 3 });
    expect(nextGuestRateWindow({ windowStartMs: now + GUEST_RATE_WINDOW_MS, count: GUEST_RATE_MAX }, now)).toBeNull();
    // More than a whole window ahead is not a window this server opened.
    expect(nextGuestRateWindow({ windowStartMs: now + GUEST_RATE_WINDOW_MS + 1, count: GUEST_RATE_MAX }, now)).toEqual({
      windowStartMs: now,
      count: 1,
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. THE TOTAL MOVES EXACTLY AS A MEMBER'S CONTRIBUTION MOVES IT
// ═══════════════════════════════════════════════════════════════════════════

describe('the shared total, as a member contribution moves it', () => {
  test('the recent-addition line is {amount, at} under the guest link id, and the public read shows it', async () => {
    const { goalId, one } = await scene();
    const a = aid();
    await guest(one, 14, a);
    const lines = await recentLines(goalId);
    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe(guestLinkId(one.stationId, a));
    const line = lines[0].data();
    expect(Object.keys(line).sort()).toEqual(['amount', 'at']);
    expect(line.amount).toBe(14);
    expect(line.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);

    const read = (await anon(wsfGoalRecentAdditions, { goalId })) as { additions: Data[] };
    expect(read.additions).toEqual([{ amount: 14, unit: 'squats', at: line.at }]);
  });

  test('the public pulse is fresh at once, not a cached pre-move total', async () => {
    const { goalId, one } = await scene();
    const first = (await anon(wsfGoalPulse, { goalId })) as { sharedTotal: number };
    expect(first.sharedTotal).toBe(0);
    await guest(one, 17, aid());
    const next = (await anon(wsfGoalPulse, { goalId })) as { sharedTotal: number };
    expect(next.sharedTotal).toBe(17);
  });

  test('a guest move that carries the goal over its target claims the crossing, naming no attempt', async () => {
    const { goalId, one } = await scene();
    await getFirestore().doc(`wsfGoalCounters/${goalId}/shards/0`).set({ count: 4990 });
    expect(await guest(one, 20, aid())).toMatchObject({ recorded: true, before: 4990, after: 5010, target: 5000 });
    const goal = (await getFirestore().doc(`wsfGoals/${goalId}`).get()).data() as Data;
    expect(goal.reachedAt).toBeInstanceOf(Timestamp);
    expect(goal.reachedSharedTotal).toBe(5010);
    expect(goal.reachedAttemptId).toBeNull();
  });

  test('a guest move below the target claims nothing', async () => {
    const { goalId, one } = await scene();
    await getFirestore().doc(`wsfGoalCounters/${goalId}/shards/0`).set({ count: 4000 });
    await guest(one, 20, aid());
    const goal = (await getFirestore().doc(`wsfGoals/${goalId}`).get()).data() as Data;
    expect(goal.reachedAt ?? null).toBeNull();
  });

  test('the activity feed says nothing about a guest', async () => {
    const { goalId, groupId, championUid, one } = await scene();
    const read = () =>
      callAs(wsfCommunityActivity, championUid, { groupId, goalId }) as Promise<{
        entries: unknown[];
        contributorsToday: number | null;
      }>;
    const before = await read();
    await guest(one, 30, aid());
    const after = await read();
    expect(after.entries).toEqual(before.entries);
    expect(after.contributorsToday).toBe(before.contributorsToday);
  });

  test('a combined child: the parent is credited once, by a row with no uid, and the repair finds it healthy', async () => {
    const { championUid, setupId, squats, squatScreen } = await combinedScene();
    const a = aid();
    await guest(squatScreen, 40, a);
    await guest(squatScreen, 40, a); // the retry credits nothing more

    expect(await shardSum(squats)).toBe(40);
    expect(await combinedShardSum(setupId, squats)).toBe(40);
    const credit = (await getFirestore().doc(`wsfCombinedCredits/${guestLinkId(squatScreen.stationId, a)}`).get()).data() as Data;
    expect(Object.keys(credit).sort()).toEqual(
      [
        'amount',
        'attemptId',
        'communityGroupId',
        'contributionRuleVersion',
        'createdAt',
        'goalId',
        'setupId',
        'setupVersion',
        'shardIndex',
        'source',
        'stationId',
      ].sort()
    );
    expect(credit).toMatchObject({ setupId, goalId: squats, attemptId: a, source: 'kioskGuest', amount: 40 });
    expect(credit.userId).toBeUndefined();

    const repair = (await callAs(wsfRepairCombinedGoal, championUid, { setupId })) as {
      status: string;
      unreadableCreditRows: number;
      ledgerTotal: number;
      counterTotalBefore: number;
    };
    expect(repair).toMatchObject({ status: 'healthy', unreadableCreditRows: 0, ledgerTotal: 40, counterTotalBefore: 40 });
  }, 40_000);

  test('a goal that is not a combined child writes no parent credit', async () => {
    const { one } = await scene();
    const a = aid();
    await guest(one, 5, a);
    expect((await getFirestore().doc(`wsfCombinedCredits/${guestLinkId(one.stationId, a)}`).get()).exists).toBe(false);
  });
});
