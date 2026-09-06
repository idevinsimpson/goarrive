/**
 * wsfJoinCommunity callable — the authenticated write that turns "I scanned the
 * QR" into a wsfMemberships row. Three properties this test pins:
 *
 *   1. Idempotent. Joining twice writes exactly one membership doc and does
 *      NOT throw. Deterministic doc ID `${groupId}_${uid}` is what makes this
 *      true; assert it end-to-end so a refactor that changes the doc ID scheme
 *      also has to update this test.
 *
 *   2. Guards in the order the spec names: authenticated -> email verified ->
 *      profile exists -> adult -> group public + active. Not for its own sake:
 *      the callable never leaves a membership without a readable group, so an
 *      out-of-order guard could write and then reject.
 *
 *   3. Not an existence oracle either. Unknown code, non-public group, and
 *      non-active lifecycle all return the same "This link is not valid."
 *      that wsfPreviewCommunity returns.
 *
 * Runs against Firestore emulator via `.run(request)`.
 */

// First-touch hardening (§E3 review fix 6). METADATA_SERVER_DETECTION off
// skips firebase-admin's cold GCP-metadata probe (irrelevant against the
// emulator, ~1s wasted otherwise). The _warmup write in beforeAll below
// forces the emulator RPC channel open before the timed tests fire.
process.env.METADATA_SERVER_DETECTION =
  process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'goarrive-test';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { mintJoinCode, wsfJoinCommunity } from '../../src/index';

async function seedProfile(uid: string, extra: Record<string, unknown> = {}) {
  await getFirestore()
    .doc(`wsfMemberProfiles/${uid}`)
    .set({
      displayName: 'Test User',
      acceptedTermsVersion: 'pending-approval-2026-08-25',
      acceptedPrivacyVersion: 'pending-approval-2026-08-25',
      ...extra,
    });
}

async function seedGroup(opts: {
  displayName?: string;
  joinCode: string;
  joinPolicy: 'private' | 'inviteOnly' | 'public';
  lifecycleStatus?: string;
}) {
  const db = getFirestore();
  const groupRef = db.collection('wsfCommunityGroups').doc();
  await groupRef.set({
    displayName: opts.displayName ?? 'Test Group',
    groupType: 'custom',
    joinPolicy: opts.joinPolicy,
    joinCode: opts.joinCode,
    createdByUserId: 'seeder',
    lifecycleStatus: opts.lifecycleStatus ?? 'active',
    isSample: false,
  });
  return groupRef.id;
}

function makeRequest(
  uid: string | null,
  emailVerified: boolean,
  data: Record<string, unknown>
): Parameters<typeof wsfJoinCommunity.run>[0] {
  return {
    auth: uid
      ? ({ uid, token: { email_verified: emailVerified } as any } as any)
      : undefined,
    data: data as any,
    rawRequest: {} as any,
    acceptsStreaming: false,
  } as any;
}

async function tryRun(
  uid: string | null,
  emailVerified: boolean,
  data: Record<string, unknown>
) {
  try {
    return { ok: true, value: await wsfJoinCommunity.run(makeRequest(uid, emailVerified, data)) };
  } catch (e) {
    return { ok: false, error: e as HttpsError };
  }
}

const TEST_UIDS = [
  'wsfJoin_alice',
  'wsfJoin_bob',
  'wsfJoin_carol',
  'wsfJoin_dave',
  'wsfJoin_erin',
  'wsfJoin_frank',
  'wsfJoin_grace',
];

describe('wsfJoinCommunity', () => {
  beforeAll(async () => {
    // First-touch warm-up: open the Firestore emulator RPC channel before
    // the timed tests fire. Same shape as check-in and pulse.
    await getFirestore()
      .doc('_warmup/wsf-join-community')
      .set({ at: Date.now() });
  }, 30_000);

  afterAll(async () => {
    const db = getFirestore();
    await Promise.all(
      TEST_UIDS.map((uid) =>
        db.doc(`wsfMemberProfiles/${uid}`).delete().catch(() => undefined)
      )
    );
  });

  test('happy path: verified adult joins a public+active group', async () => {
    await seedProfile('wsfJoin_alice');
    const code = mintJoinCode();
    const groupId = await seedGroup({ joinCode: code, joinPolicy: 'public' });

    const result = await wsfJoinCommunity.run(
      makeRequest('wsfJoin_alice', true, { joinCode: code })
    );

    expect(result).toEqual({ groupId, alreadyMember: false });

    const membership = await getFirestore()
      .doc(`wsfMemberships/${groupId}_wsfJoin_alice`)
      .get();
    expect(membership.exists).toBe(true);
    expect(membership.data()).toMatchObject({
      groupId,
      userId: 'wsfJoin_alice',
      role: 'member',
      membershipStatus: 'active',
    });
  });

  test('§3.2 idempotency: joining twice writes ONE membership doc and returns alreadyMember=true', async () => {
    await seedProfile('wsfJoin_bob');
    const code = mintJoinCode();
    const groupId = await seedGroup({ joinCode: code, joinPolicy: 'public' });

    const first = await wsfJoinCommunity.run(
      makeRequest('wsfJoin_bob', true, { joinCode: code })
    );
    const second = await wsfJoinCommunity.run(
      makeRequest('wsfJoin_bob', true, { joinCode: code })
    );

    expect(first).toEqual({ groupId, alreadyMember: false });
    expect(second).toEqual({ groupId, alreadyMember: true });

    // Exactly one row. If a refactor breaks the deterministic doc ID scheme,
    // this count changes and the test fails.
    const memberships = await getFirestore()
      .collection('wsfMemberships')
      .where('groupId', '==', groupId)
      .where('userId', '==', 'wsfJoin_bob')
      .get();
    expect(memberships.size).toBe(1);
  });

  test('unauthenticated caller: unauthenticated code', async () => {
    const result = await tryRun(null, true, { joinCode: mintJoinCode() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unauthenticated');
  });

  test('unverified email: failed-precondition (default JOIN_REQUIRES_EMAIL_VERIFIED=true)', async () => {
    await seedProfile('wsfJoin_carol');
    const code = mintJoinCode();
    await seedGroup({ joinCode: code, joinPolicy: 'public' });

    const result = await tryRun('wsfJoin_carol', false, { joinCode: code });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('failed-precondition');
    expect(result.error.message).toMatch(/Verify your email/i);
  });

  test('no profile: failed-precondition', async () => {
    const code = mintJoinCode();
    await seedGroup({ joinCode: code, joinPolicy: 'public' });

    const result = await tryRun('wsfJoin_dave', true, { joinCode: code });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('failed-precondition');
    expect(result.error.message).toMatch(/Complete your profile/i);
  });

  test('§3 A5 age gate removed: a profile with no adultConfirmation joins successfully', async () => {
    // Pre-2026-09-06 this failed with "18 or older". Devin removed the guard;
    // the callable is now expected to accept a profile that never wrote an
    // adultConfirmation field at all.
    await seedProfile('wsfJoin_erin');
    const code = mintJoinCode();
    const groupId = await seedGroup({ joinCode: code, joinPolicy: 'public' });

    const result = await tryRun('wsfJoin_erin', true, { joinCode: code });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({ groupId, alreadyMember: false });
  });

  test('non-public group: same not-found as unknown code (no oracle)', async () => {
    await seedProfile('wsfJoin_frank');
    const privateCode = mintJoinCode();
    await seedGroup({ joinCode: privateCode, joinPolicy: 'private' });

    const privateResult = await tryRun('wsfJoin_frank', true, { joinCode: privateCode });
    const unknownResult = await tryRun('wsfJoin_frank', true, { joinCode: mintJoinCode() });

    expect(privateResult.ok).toBe(false);
    expect(unknownResult.ok).toBe(false);
    if (privateResult.ok || unknownResult.ok) return;

    expect(privateResult.error.code).toBe('not-found');
    expect(privateResult.error.code).toBe(unknownResult.error.code);
    expect(privateResult.error.message).toBe(unknownResult.error.message);
  });

  test('non-active lifecycle: same not-found as unknown code', async () => {
    await seedProfile('wsfJoin_grace');
    const archivedCode = mintJoinCode();
    await seedGroup({
      joinCode: archivedCode,
      joinPolicy: 'public',
      lifecycleStatus: 'archived',
    });

    const result = await tryRun('wsfJoin_grace', true, { joinCode: archivedCode });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
    expect(result.error.message).toBe('This link is not valid.');
  });

  test('grandfathered: existing member whose group is now private still resolves alreadyMember=true', async () => {
    // The rule is "new joins require public+active", not "old members lose
    // access when a champion flips a setting." Guard the second, quieter half
    // of that rule here.
    await seedProfile('wsfJoin_alice');
    const code = mintJoinCode();
    const groupId = await seedGroup({ joinCode: code, joinPolicy: 'public' });

    // Establish membership while public.
    await wsfJoinCommunity.run(
      makeRequest('wsfJoin_alice', true, { joinCode: code })
    );

    // Flip the group to private out-of-band (would normally happen via a
    // champion-controls callable that does not exist yet).
    await getFirestore()
      .collection('wsfCommunityGroups')
      .doc(groupId)
      .update({ joinPolicy: 'private' });

    // Existing member re-taps: must still resolve, must NOT get not-found.
    const result = await wsfJoinCommunity.run(
      makeRequest('wsfJoin_alice', true, { joinCode: code })
    );
    expect(result).toEqual({ groupId, alreadyMember: true });
  });
});
