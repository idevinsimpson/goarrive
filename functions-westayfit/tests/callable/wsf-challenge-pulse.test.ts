/**
 * wsfChallengePulse callable — the public-safe aggregates the kiosk reads.
 * Pins:
 *
 *   1. §5.7 no member identity in the response under any input. Assert
 *      response keys are exactly the whitelist, not just that some sensitive
 *      field is absent — a future field that accidentally leaks would slip a
 *      "does not contain X" assertion.
 *
 *   2. §5.8 groups flagged isSample are excluded from any total presented as
 *      real. Kiosk-facing endpoint must refuse them as not-found.
 *
 *   3. goalTarget nullable flows through as-is.
 *
 *   4. Unauthenticated caller works — this is the public kiosk endpoint.
 *
 * Runs against Firestore emulator via `.run(request)`.
 */

process.env.GCLOUD_PROJECT = 'goarrive-test';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfChallengePulse, wsfCheckIn } from '../../src/index';

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

async function seedGroup(opts?: { isSample?: boolean }): Promise<string> {
  const ref = getFirestore().collection('wsfCommunityGroups').doc();
  await ref.set({
    displayName: 'Pulse Test Group',
    groupType: 'custom',
    joinPolicy: 'public',
    lifecycleStatus: 'active',
    isSample: opts?.isSample === true,
  });
  return ref.id;
}

async function seedChallenge(
  groupId: string,
  goalTarget: number | null = null
): Promise<string> {
  const ref = getFirestore().collection('wsfChallenges').doc();
  await ref.set({ groupId, title: 'FitLife Moves', status: 'active', goalTarget });
  return ref.id;
}

async function seedMove(challengeId: string): Promise<string> {
  const ref = getFirestore().collection('wsfChallengeMoves').doc();
  await ref.set({
    challengeId,
    title: 'Move',
    instructions: '',
    sequence: 0,
    dayNumber: null,
  });
  return ref.id;
}

function makeRequest(
  uid: string | null,
  data: Record<string, unknown>
): Parameters<typeof wsfChallengePulse.run>[0] {
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
      value: await wsfChallengePulse.run(makeRequest(uid, data)),
    };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

describe('wsfChallengePulse', () => {
  test('unauthenticated caller: OK — public kiosk endpoint', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId, 2000);

    const result = await wsfChallengePulse.run(makeRequest(null, { challengeId }));
    expect(result).toEqual({
      participantCount: 0,
      completedCount: 0,
      goalTarget: 2000,
    });
  });

  test('§5.7 response keys are exactly the aggregate whitelist — no member identity leaked', async () => {
    // Seed real check-in traffic so participant + completed counts are non-zero.
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId, 1000);
    const moveId = await seedMove(challengeId);
    for (let i = 0; i < 3; i++) {
      const uid = `wsfPulse_leak_${Date.now()}_${i}`;
      await seedActiveMember(groupId, uid);
      await wsfCheckIn.run({
        auth: { uid, token: { email_verified: true } as any } as any,
        data: { moveId } as any,
        rawRequest: {} as any,
        acceptsStreaming: false,
      } as any);
    }

    // Try every input the caller could smuggle a member identity through.
    // The response must be byte-identical to the challengeId-only call.
    const canonical = await wsfChallengePulse.run(
      makeRequest(null, { challengeId })
    );
    const withInjected = await wsfChallengePulse.run(
      makeRequest(null, {
        challengeId,
        // Ignored fields — must not appear in response and must not change it.
        includeMembers: true,
        userId: 'anyone',
        membershipId: `${groupId}_someone`,
      })
    );
    expect(withInjected).toEqual(canonical);

    // Whitelist check: response keys are EXACTLY these three. A future field
    // that leaks a member identity would fail this even if a "does not
    // contain uid" style test missed it.
    expect(Object.keys(canonical).sort()).toEqual(
      ['completedCount', 'goalTarget', 'participantCount']
    );
    expect(canonical.completedCount).toBe(3);
    expect(canonical.participantCount).toBe(3);
    expect(canonical.goalTarget).toBe(1000);
  });

  test('§5.8 sample-flagged group: not-found — never surfaces in a real total', async () => {
    const sampleGroupId = await seedGroup({ isSample: true });
    const challengeId = await seedChallenge(sampleGroupId);

    const result = await tryRun(null, { challengeId });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
  });

  test('unknown challengeId: not-found', async () => {
    const result = await tryRun(null, { challengeId: 'does-not-exist' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
  });

  test('missing challengeId: not-found (no oracle for a missing arg vs an unknown id)', async () => {
    const result = await tryRun(null, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
  });

  test('goalTarget null flows through as null', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId, null);
    const result = await wsfChallengePulse.run(makeRequest(null, { challengeId }));
    expect(result.goalTarget).toBeNull();
  });
});
