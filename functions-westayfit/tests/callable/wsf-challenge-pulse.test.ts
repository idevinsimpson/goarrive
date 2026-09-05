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

// First-touch hardening (§E3 review fix 6). METADATA_SERVER_DETECTION off
// skips firebase-admin's cold GCP-metadata probe (irrelevant against the
// emulator, ~1s wasted otherwise). The _warmup write in beforeAll below
// forces the emulator RPC channel open before the timed tests fire, taking
// the check-in happy-path from ~4s to ~0.5s on this suite.
process.env.METADATA_SERVER_DETECTION =
  process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'goarrive-test';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { createHash } from 'crypto';

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
  beforeAll(async () => {
    // First-touch warm-up: open the Firestore emulator RPC channel before
    // the timed tests fire. Same shape as check-in and join-community.
    await getFirestore()
      .doc('_warmup/wsf-challenge-pulse')
      .set({ at: Date.now() });
  }, 30_000);

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

  test('unknown challengeId (well-formed but absent): not-found', async () => {
    // 20-char Firestore-auto-ID shape passes the id check and reaches the doc
    // read; that branch is what this test pins.
    const result = await tryRun(null, { challengeId: 'ZYXWVUTSRQPONMLKJIHG' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
  });

  test('§E3-review missing challengeId: invalid-argument', async () => {
    const result = await tryRun(null, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-argument');
  });

  test('§E3-review malformed challengeId (contains /): invalid-argument — never internal', async () => {
    // Old shape check let `foo/bar` through and db.doc(...) threw TypeError,
    // surfaced as `internal` on a public endpoint. Pin the new contract.
    const result = await tryRun(null, { challengeId: 'wsfChallenges/pwn' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid-argument');
  });

  test('goalTarget null flows through as null', async () => {
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId, null);
    const result = await wsfChallengePulse.run(makeRequest(null, { challengeId }));
    expect(result.goalTarget).toBeNull();
  });

  test('§E3-review rate-limit: over-cap request from one ip throws resource-exhausted (rightmost XFF wins)', async () => {
    // Pre-seed the limiter doc at the cap, keyed by the RIGHTMOST XFF entry.
    // A leftmost-XFF implementation would hash the spoofable prefix
    // (1.2.3.4) and miss the pre-seeded bucket entirely — the call would
    // succeed, and this test would fail. That is what pins rightmost
    // extraction: the shape of the failure, not the presence of a limit.
    const realClient = '203.0.113.42';
    const spoof = '1.2.3.4';
    const now = Date.now();
    const daySalt = Math.floor(now / (24 * 60 * 60 * 1000)).toString();
    const hash = createHash('sha256')
      .update(`${realClient}:${daySalt}`)
      .digest('hex')
      .slice(0, 16);
    // 100 = PREVIEW_RATE_LIMIT_MAX. The 101st call in the window fails.
    await getFirestore().doc(`wsfPreviewRateLimits/${hash}`).set({
      windowStart: now,
      count: 100,
    });

    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId);

    const req = {
      auth: undefined,
      data: { challengeId } as any,
      rawRequest: {
        headers: { 'x-forwarded-for': `${spoof}, ${realClient}` },
      } as any,
      acceptsStreaming: false,
    } as any;

    let caught: HttpsError | null = null;
    try {
      await wsfChallengePulse.run(req);
    } catch (e) {
      caught = e as HttpsError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.code).toBe('resource-exhausted');
  });

  test('§E3-review cache staleness: within TTL returns cached; past TTL returns fresh', async () => {
    // Cache TTL is 2000ms. Verify:
    //   1) First pulse: cache miss, Firestore total=0, cache set at T0.
    //   2) A real check-in advances Firestore state to 1. Cache is stale.
    //   3) Second pulse at T0+500 (inside TTL) MUST return cached 0 —
    //      that is the whole point of the cache and what a "kiosk polls at
    //      2s" spec is buying: collapse to one real read per 2s.
    //   4) Third pulse at T0+2500 (past TTL) MUST return fresh 1.
    // Date.now is mocked only inside the pulse call; check-in runs with
    // real time so its Firestore RPCs are not affected by a frozen clock.
    const groupId = await seedGroup();
    const challengeId = await seedChallenge(groupId, 500);
    const moveId = await seedMove(challengeId);
    const uid = `wsfPulse_cache_${Date.now()}`;
    await seedActiveMember(groupId, uid);

    const T0 = Date.now();

    async function pulseAt(mockedNow: number) {
      const spy = jest.spyOn(Date, 'now').mockReturnValue(mockedNow);
      try {
        return await wsfChallengePulse.run(makeRequest(null, { challengeId }));
      } finally {
        spy.mockRestore();
      }
    }

    const first = await pulseAt(T0);
    expect(first.completedCount).toBe(0);

    // Real-time check-in — advances Firestore state, does not touch the
    // in-process pulse cache.
    await wsfCheckIn.run({
      auth: { uid, token: { email_verified: true } as any } as any,
      data: { moveId } as any,
      rawRequest: {} as any,
      acceptsStreaming: false,
    } as any);

    const cachedWithinTtl = await pulseAt(T0 + 500);
    // The cached value from T0 must still be served — participantCount and
    // completedCount both frozen at 0 despite Firestore now saying 1.
    expect(cachedWithinTtl.completedCount).toBe(0);
    expect(cachedWithinTtl.participantCount).toBe(0);

    const freshPastTtl = await pulseAt(T0 + 2_500);
    // Cache expired at T0+2000, so this pulse re-reads Firestore.
    expect(freshPastTtl.completedCount).toBe(1);
    expect(freshPastTtl.participantCount).toBe(1);
  });
});
