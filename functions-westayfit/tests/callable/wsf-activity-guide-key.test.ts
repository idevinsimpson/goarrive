/**
 * activityGuideKey — the goal's OPTIONAL per-goal counting-guide override.
 *
 * Pins:
 *   * omitting it writes no field at all, so a goal without an override is
 *     byte-identical to one created before the argument existed
 *   * an explicit null is the same as omitting it
 *   * a valid key is stored trimmed and verbatim (no case folding, no
 *     normalization — the client does that)
 *   * > 40 chars, empty/whitespace-only, an ASCII control character and a
 *     non-string are each invalid-argument
 *   * wsfMyContribution publishes the key to the member, and publishes
 *     nothing when the goal carries none
 *   * the key changes nothing that is recorded: target, unit and status are
 *     untouched by it
 *
 * The key names a guide in the CLIENT's guide table. The server does not know
 * that table and deliberately does not police membership of it: an unknown key
 * is stored and the client falls back to the unit-derived guide.
 *
 * Runs against the local Firestore emulator via `func.run(request)`.
 */

process.env.METADATA_SERVER_DETECTION =
  process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfCreateGoal, wsfMyContribution } from '../../src/index';

type Data = Record<string, unknown>;

function makeRequest(uid: string | null, data: Data): any {
  return {
    auth: uid
      ? ({ uid, token: { email_verified: true } as any } as any)
      : undefined,
    data: data as any,
    rawRequest: {} as any,
    acceptsStreaming: false,
  };
}

function uniq(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function seedChampion(groupId: string, uid: string): Promise<void> {
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set(
    {
      groupId,
      userId: uid,
      role: 'foundingChampion',
      membershipStatus: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    { merge: true }
  );
}

function baseGoalArgs(communityGroupId: string): Data {
  const now = Date.now();
  return {
    communityGroupId,
    title: 'Guide key test goal',
    target: 500,
    unit: 'squats',
    startsAt: new Date(now - 60_000).toISOString(),
    endsAt: new Date(now + 7 * 24 * 60 * 60_000).toISOString(),
    timezone: 'America/New_York',
  };
}

async function createGoal(uid: string, data: Data) {
  try {
    return { ok: true as const, value: await wsfCreateGoal.run(makeRequest(uid, data)) };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

describe('wsfCreateGoal — activityGuideKey', () => {
  it('writes no field when the argument is omitted', async () => {
    const groupId = uniq('guideGrp');
    const uid = uniq('guideUid');
    await seedChampion(groupId, uid);
    const created = await createGoal(uid, baseGoalArgs(groupId));
    expect(created.ok).toBe(true);
    const snap = await getFirestore()
      .doc(`wsfGoals/${(created as any).value.goalId}`)
      .get();
    const goal = snap.data() as Record<string, unknown>;
    expect('activityGuideKey' in goal).toBe(false);
    // Nothing else moved.
    expect(goal.unit).toBe('squats');
    expect(goal.target).toBe(500);
    expect(goal.status).toBe('active');
  });

  it('treats an explicit null the same as omitting it', async () => {
    const groupId = uniq('guideGrp');
    const uid = uniq('guideUid');
    await seedChampion(groupId, uid);
    const created = await createGoal(uid, {
      ...baseGoalArgs(groupId),
      activityGuideKey: null,
    });
    expect(created.ok).toBe(true);
    const snap = await getFirestore()
      .doc(`wsfGoals/${(created as any).value.goalId}`)
      .get();
    expect('activityGuideKey' in (snap.data() as Record<string, unknown>)).toBe(false);
  });

  it('stores a valid key trimmed and verbatim', async () => {
    const groupId = uniq('guideGrp');
    const uid = uniq('guideUid');
    await seedChampion(groupId, uid);
    const created = await createGoal(uid, {
      ...baseGoalArgs(groupId),
      activityGuideKey: '  Push Ups  ',
    });
    expect(created.ok).toBe(true);
    const snap = await getFirestore()
      .doc(`wsfGoals/${(created as any).value.goalId}`)
      .get();
    expect((snap.data() as Record<string, unknown>).activityGuideKey).toBe('Push Ups');
  });

  it('accepts a key at the 40-char ceiling and refuses 41', async () => {
    const groupId = uniq('guideGrp');
    const uid = uniq('guideUid');
    await seedChampion(groupId, uid);
    const at40 = 'k'.repeat(40);
    const ok = await createGoal(uid, { ...baseGoalArgs(groupId), activityGuideKey: at40 });
    expect(ok.ok).toBe(true);
    const over = await createGoal(uid, {
      ...baseGoalArgs(groupId),
      activityGuideKey: 'k'.repeat(41),
    });
    expect(over.ok).toBe(false);
    expect((over as any).error.code).toBe('invalid-argument');
  });

  it('refuses whitespace-only, control characters and non-strings', async () => {
    const groupId = uniq('guideGrp');
    const uid = uniq('guideUid');
    await seedChampion(groupId, uid);
    for (const bad of ['   ', 'push\u0000ups', 'push\nups', 12 as unknown as string, true as unknown as string]) {
      const res = await createGoal(uid, { ...baseGoalArgs(groupId), activityGuideKey: bad });
      expect(res.ok).toBe(false);
      expect((res as any).error.code).toBe('invalid-argument');
    }
  });
});

describe('wsfMyContribution — activityGuideKey', () => {
  it('publishes the goal’s key to a member, and nothing when there is none', async () => {
    const groupId = uniq('guideGrp');
    const uid = uniq('guideUid');
    await seedChampion(groupId, uid);

    const withKey = await createGoal(uid, {
      ...baseGoalArgs(groupId),
      activityGuideKey: 'steps',
    });
    expect(withKey.ok).toBe(true);
    const mineWith: any = await wsfMyContribution.run(
      makeRequest(uid, { goalId: (withKey as any).value.goalId })
    );
    expect(mineWith.activityGuideKey).toBe('steps');
    // The own-credit read is unchanged in every other respect.
    expect(mineWith.ownCredit).toBe(0);
    expect(mineWith.unit).toBe('squats');

    const without = await createGoal(uid, baseGoalArgs(groupId));
    expect(without.ok).toBe(true);
    const mineWithout: any = await wsfMyContribution.run(
      makeRequest(uid, { goalId: (without as any).value.goalId })
    );
    expect('activityGuideKey' in mineWithout).toBe(false);
    expect(mineWithout.unit).toBe('squats');
  });
});
