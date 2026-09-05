/**
 * wsfListChallenge callable — the members-only read behind the community
 * page's challenge panel. Pins:
 *
 *   1. §5.1 A joined member sees the active challenge and its moves,
 *      sorted by sequence, with a top-level `myCheckedInMoveIds` array
 *      naming the caller's own check-ins. A different member's list must
 *      never leak into the caller's response — the check-in doc paths
 *      embed the caller's membershipId, so `db.getAll` on those known
 *      paths can never return anyone else's row.
 *
 *   2. §5.6 non-member refused with permission-denied.
 *
 *   3. No active challenge in the group → challenge: null, moves: [],
 *      myCheckedInMoveIds: [], totals zeroed. This is the pre-event state
 *      and must not throw.
 *
 * Runs against Firestore emulator via `.run(request)`.
 */

process.env.GCLOUD_PROJECT = 'goarrive-test';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfCheckIn, wsfListChallenge } from '../../src/index';

async function seedActiveMember(groupId: string, uid: string) {
  await getFirestore()
    .doc(`wsfMemberships/${groupId}_${uid}`)
    .set({
      groupId,
      userId: uid,
      role: 'member',
      membershipStatus: 'active',
    });
}

async function seedGroup(): Promise<string> {
  const ref = getFirestore().collection('wsfCommunityGroups').doc();
  await ref.set({
    displayName: 'List Test Group',
    groupType: 'custom',
    joinPolicy: 'public',
    lifecycleStatus: 'active',
    isSample: false,
  });
  return ref.id;
}

async function seedChallenge(
  groupId: string,
  status: 'draft' | 'active' | 'completed' = 'active',
  goalTarget: number | null = null
): Promise<string> {
  const ref = getFirestore().collection('wsfChallenges').doc();
  await ref.set({ groupId, title: 'FitLife Moves', status, goalTarget });
  return ref.id;
}

async function seedMove(
  challengeId: string,
  sequence: number,
  title: string
): Promise<string> {
  const ref = getFirestore().collection('wsfChallengeMoves').doc();
  await ref.set({
    challengeId,
    title,
    instructions: '',
    sequence,
    dayNumber: null,
  });
  return ref.id;
}

function makeRequest(
  uid: string | null,
  data: Record<string, unknown>
): Parameters<typeof wsfListChallenge.run>[0] {
  return {
    auth: uid
      ? ({ uid, token: { email_verified: true } as any } as any)
      : undefined,
    data: data as any,
    rawRequest: {} as any,
    acceptsStreaming: false,
  } as any;
}

async function tryRun(uid: string | null, data: Record<string, unknown>) {
  try {
    return {
      ok: true as const,
      value: await wsfListChallenge.run(makeRequest(uid, data)),
    };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

describe('wsfListChallenge', () => {
  test('unauthenticated caller: unauthenticated', async () => {
    const result = await tryRun(null, { groupId: 'anything' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unauthenticated');
  });

  test('non-member refused: permission-denied', async () => {
    const groupId = await seedGroup();
    await seedChallenge(groupId);
    const uid = `wsfList_nonmember_${Date.now()}`;
    // No membership.

    const result = await tryRun(uid, { groupId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('permission-denied');
  });

  test('§5.1 member sees active challenge, moves ordered by sequence, and only their own check-ins in myCheckedInMoveIds', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId, 'active', 1000);
    const moveB = await seedMove(challengeId, 2, 'B move');
    const moveA = await seedMove(challengeId, 1, 'A move');
    const moveC = await seedMove(challengeId, 3, 'C move');
    const callerUid = `wsfList_happy_caller_${Date.now()}`;
    const otherUid = `wsfList_happy_other_${Date.now()}`;
    await seedActiveMember(groupId, callerUid);
    await seedActiveMember(groupId, otherUid);

    // Caller checks in on A. A different member checks in on B — the caller's
    // list must include A and only A, never B; the other member's list must
    // include B and only B, never A. This is the isolation guarantee the doc
    // path `wsfCheckIns/{moveId}_{membershipId}` earns us.
    await wsfCheckIn.run({
      auth: { uid: callerUid, token: { email_verified: true } as any } as any,
      data: { moveId: moveA } as any,
      rawRequest: {} as any,
      acceptsStreaming: false,
    } as any);
    await wsfCheckIn.run({
      auth: { uid: otherUid, token: { email_verified: true } as any } as any,
      data: { moveId: moveB } as any,
      rawRequest: {} as any,
      acceptsStreaming: false,
    } as any);

    const callerResult = await wsfListChallenge.run(
      makeRequest(callerUid, { groupId })
    );
    const otherResult = await wsfListChallenge.run(
      makeRequest(otherUid, { groupId })
    );

    expect(callerResult.challenge?.id).toBe(challengeId);
    expect(callerResult.challenge?.goalTarget).toBe(1000);
    expect(callerResult.moves.map((m) => m.id)).toEqual([moveA, moveB, moveC]);
    expect(callerResult.myCheckedInMoveIds).toEqual([moveA]);
    expect(callerResult.totals.completedCount).toBeGreaterThanOrEqual(2);
    expect(callerResult.totals.goalTarget).toBe(1000);

    expect(otherResult.myCheckedInMoveIds).toEqual([moveB]);
  });

  test('no active challenge: challenge=null, moves=[], myCheckedInMoveIds=[], zeroed totals — no throw', async () => {
    const groupId = await seedGroup();
    // Only a draft challenge exists.
    await seedChallenge(groupId, 'draft');
    const uid = `wsfList_pre_event_${Date.now()}`;
    await seedActiveMember(groupId, uid);

    const result = await wsfListChallenge.run(makeRequest(uid, { groupId }));
    expect(result.challenge).toBeNull();
    expect(result.moves).toEqual([]);
    expect(result.myCheckedInMoveIds).toEqual([]);
    expect(result.totals).toEqual({
      participantCount: 0,
      completedCount: 0,
      goalTarget: null,
    });
  });

  test('missing groupId: invalid-argument', async () => {
    const uid = `wsfList_missing_${Date.now()}`;
    const result = await tryRun(uid, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-argument');
  });

  test('§E3-review malformed groupId (contains /): invalid-argument — never internal', async () => {
    const uid = `wsfList_bad_slash_${Date.now()}`;
    const result = await tryRun(uid, { groupId: 'wsfMemberships/pwn' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-argument');
  });

  test('§E3-review wsfListChallenge NEVER returns checkInCode, even when set on the move', async () => {
    // Seed a move with requiresCode + checkInCode. The response must expose
    // requiresCode:true (so the client renders the "enter code" input) but
    // must never carry the secret it enforces.
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId);
    const codedRef = getFirestore().collection('wsfChallengeMoves').doc();
    await codedRef.set({
      challengeId,
      title: 'Coded move',
      instructions: 'Ask the host for the code.',
      sequence: 1,
      dayNumber: null,
      requiresCode: true,
      checkInCode: 'FITLIFE-SECRET-42',
    });
    const uid = `wsfList_no_leak_${Date.now()}`;
    await seedActiveMember(groupId, uid);

    const result = await wsfListChallenge.run(makeRequest(uid, { groupId }));
    expect(result.moves).toHaveLength(1);
    const move = result.moves[0]!;
    expect(move.requiresCode).toBe(true);
    // Whitelist check — a future field that accidentally leaked the secret
    // (or any other server-side move field) would fail this even if a "does
    // not contain checkInCode" assertion missed it. `checkedIn` is off the
    // per-move shape now that the caller's own history rides at the top
    // level as `myCheckedInMoveIds`.
    expect(Object.keys(move).sort()).toEqual([
      'dayNumber',
      'id',
      'instructions',
      'locationLabel',
      'requiresCode',
      'sequence',
      'title',
    ]);
    expect('checkInCode' in move).toBe(false);
    expect('checkedIn' in move).toBe(false);
    // Top-level shape gains `myCheckedInMoveIds` — anything else added later
    // must be intentional; a stray field would fail this whitelist and force
    // the surface change to be reviewed here.
    expect(Object.keys(result).sort()).toEqual([
      'challenge',
      'moves',
      'myCheckedInMoveIds',
      'totals',
    ]);
  });
});
