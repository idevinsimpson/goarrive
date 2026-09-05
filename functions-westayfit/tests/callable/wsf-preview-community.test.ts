/**
 * wsfPreviewCommunity callable — the unauthenticated read that turns a QR into
 * "which community am I about to join?". Two properties this test is here to
 * pin, and neither is derivable from any other test:
 *
 *   1. Not an existence oracle. Unknown code and a private group with the same
 *      code shape must return byte-identical not-found — same HttpsError code,
 *      same message. Anything less lets a probe distinguish "no such group"
 *      from "group exists but is not public", which is the exact leak the
 *      callable design exists to prevent.
 *
 *   2. Response projection is strict. Only { displayName, groupType,
 *      memberCount } comes back. groupId, createdByUserId, joinPolicy,
 *      lifecycle, timestamps, and every other field on the doc must stay
 *      server-side. If the shape ever expands here, the shape has to expand
 *      deliberately in the spec first.
 *
 * Runs against the Firestore emulator via `.run(request)`, matching the
 * pattern established by wsf-create-community.test.ts.
 */

process.env.GCLOUD_PROJECT = 'goarrive-test';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { mintJoinCode, wsfPreviewCommunity } from '../../src/index';

async function seedGroup(opts: {
  displayName: string;
  joinCode: string;
  joinPolicy: 'private' | 'inviteOnly' | 'public';
  lifecycleStatus?: string;
  members?: number;
}) {
  const db = getFirestore();
  const groupRef = db.collection('wsfCommunityGroups').doc();
  await groupRef.set({
    displayName: opts.displayName,
    groupType: 'custom',
    joinPolicy: opts.joinPolicy,
    joinCode: opts.joinCode,
    createdByUserId: 'seeder',
    lifecycleStatus: opts.lifecycleStatus ?? 'active',
    isSample: false,
  });
  const members = opts.members ?? 0;
  const writes: Promise<unknown>[] = [];
  for (let i = 0; i < members; i++) {
    const memberUid = `${groupRef.id}_member_${i}`;
    writes.push(
      db.doc(`wsfMemberships/${groupRef.id}_${memberUid}`).set({
        groupId: groupRef.id,
        userId: memberUid,
        role: 'member',
        membershipStatus: 'active',
      })
    );
  }
  await Promise.all(writes);
  return groupRef.id;
}

function makeRequest(data: Record<string, unknown>): Parameters<typeof wsfPreviewCommunity.run>[0] {
  return {
    // Unauth: preview MUST work with no request.auth. That is the whole point.
    auth: undefined,
    data: data as any,
    rawRequest: {
      // Randomize IP per test to keep the rate-limit bucket from tripping
      // across many test cases.
      ip: `10.0.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`,
      headers: {},
    } as any,
    acceptsStreaming: false,
  } as any;
}

async function tryRun(data: Record<string, unknown>) {
  try {
    return { ok: true, value: await wsfPreviewCommunity.run(makeRequest(data)) };
  } catch (e) {
    return { ok: false, error: e as HttpsError };
  }
}

describe('wsfPreviewCommunity', () => {
  test('public + active group returns strictly {displayName, groupType, memberCount}', async () => {
    const joinCode = mintJoinCode();
    await seedGroup({
      displayName: 'FitLife Moves',
      joinCode,
      joinPolicy: 'public',
      members: 3,
    });

    const result = await wsfPreviewCommunity.run(makeRequest({ joinCode }));

    expect(result).toEqual({
      displayName: 'FitLife Moves',
      groupType: 'custom',
      memberCount: 3,
    });
    // Strict shape: no extra fields leaked. Delete these keys and any leftover
    // is a new leak.
    const leftover = { ...(result as Record<string, unknown>) };
    delete leftover.displayName;
    delete leftover.groupType;
    delete leftover.memberCount;
    expect(leftover).toEqual({});
  });

  test('unknown code returns not-found ("This link is not valid.")', async () => {
    const result = await tryRun({ joinCode: mintJoinCode() });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBeInstanceOf(HttpsError);
    expect(result.error.code).toBe('not-found');
    expect(result.error.message).toBe('This link is not valid.');
  });

  test('§3.3 ORACLE TEST: unknown code and private group return byte-identical not-found', async () => {
    // The whole design is to make these indistinguishable. Any drift — a
    // different message, a different code, a details payload — turns the
    // endpoint into an oracle. This test exists so that drift fails the suite
    // rather than shipping quietly.
    const privateCode = mintJoinCode();
    await seedGroup({
      displayName: 'Private Family Group',
      joinCode: privateCode,
      joinPolicy: 'private',
    });

    const unknownResult = await tryRun({ joinCode: mintJoinCode() });
    const privateResult = await tryRun({ joinCode: privateCode });

    expect(unknownResult.ok).toBe(false);
    expect(privateResult.ok).toBe(false);
    if (unknownResult.ok || privateResult.ok) return;

    // Byte-identical: same code, same message, same details (both undefined).
    expect(privateResult.error.code).toBe(unknownResult.error.code);
    expect(privateResult.error.message).toBe(unknownResult.error.message);
    expect(privateResult.error.details).toEqual(unknownResult.error.details);
  });

  test('inviteOnly group returns the same not-found as an unknown code', async () => {
    const inviteCode = mintJoinCode();
    await seedGroup({
      displayName: 'Invite-only Group',
      joinCode: inviteCode,
      joinPolicy: 'inviteOnly',
    });

    const inviteResult = await tryRun({ joinCode: inviteCode });
    const unknownResult = await tryRun({ joinCode: mintJoinCode() });

    expect(inviteResult.ok).toBe(false);
    expect(unknownResult.ok).toBe(false);
    if (inviteResult.ok || unknownResult.ok) return;
    expect(inviteResult.error.code).toBe(unknownResult.error.code);
    expect(inviteResult.error.message).toBe(unknownResult.error.message);
  });

  test('non-active lifecycle returns the same not-found as an unknown code', async () => {
    const archivedCode = mintJoinCode();
    await seedGroup({
      displayName: 'Archived Public Group',
      joinCode: archivedCode,
      joinPolicy: 'public',
      lifecycleStatus: 'archived',
    });

    const archivedResult = await tryRun({ joinCode: archivedCode });
    expect(archivedResult.ok).toBe(false);
    if (archivedResult.ok) return;
    expect(archivedResult.error.code).toBe('not-found');
    expect(archivedResult.error.message).toBe('This link is not valid.');
  });

  test('malformed joinCode returns the same not-found (does not leak a distinct error)', async () => {
    const cases: unknown[] = [undefined, null, '', 'too-short', 'has spaces here 1234567890', '!!!'];
    for (const bad of cases) {
      const result = await tryRun({ joinCode: bad });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe('not-found');
      expect(result.error.message).toBe('This link is not valid.');
    }
  });
});
