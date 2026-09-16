/**
 * wsfGoalPulse — the AUTHORIZED unauthenticated aggregate-display read.
 *
 * PACKAGE E rewrote this file's premise. It used to assert that any caller
 * holding a goalId receives the shared total, with `auth: undefined` hardcoded
 * and no community or membership documents seeded at all — the goals carried a
 * dangling communityGroupId that pointed at nothing. Those fixtures could not
 * express an authorization question, so they are replaced rather than patched.
 *
 * The property now pinned: possession of a goalId is never permission. The one
 * thing that authorizes this read is an explicit, Champion-set
 * aggregateDisplayAuthorized on the goal itself — not the community's
 * joinPolicy, not discoverability, not membership, not the goal's lifecycle,
 * not isSample, and not the fact that a display is asking.
 *
 * Runs against the local Firestore emulator via `func.run(request)`.
 */

process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import { wsfGoalPulse, wsfSetGoalDisplayAuthorization } from '../../src/index';

type Data = Record<string, unknown>;
type JoinPolicy = 'private' | 'inviteOnly' | 'public';

/** Anonymous by construction: this is the display's call. */
function anonRequest(data: Data): Parameters<typeof wsfGoalPulse.run>[0] {
  return { auth: undefined, data: data as any, rawRequest: {} as any, acceptsStreaming: false } as any;
}

async function pulse(data: Data) {
  try {
    return { ok: true as const, value: await wsfGoalPulse.run(anonRequest(data)) };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

function callAs(fn: unknown, uid: string | null, data: unknown) {
  return (fn as { run: (r: never) => Promise<never> }).run({
    data,
    auth: uid ? { uid, token: { email_verified: true } } : undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
  } as never);
}

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

/**
 * A REAL community with REAL membership documents. Everything a goal's
 * authorization decision might consult actually exists, so a test that passes
 * cannot be passing because a lookup silently found nothing.
 */
async function seedCommunity(opts: {
  joinPolicy: JoinPolicy;
  championUid: string;
  isSample?: boolean;
}): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('pulseGroup');
  await db.doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'Package E pulse community',
    groupType: 'custom',
    joinPolicy: opts.joinPolicy,
    joinCode: uniq('code'),
    createdByUserId: opts.championUid,
    lifecycleStatus: 'active',
    isSample: opts.isSample === true,
  });
  await db.doc(`wsfMemberships/${groupId}_${opts.championUid}`).set({
    groupId,
    userId: opts.championUid,
    role: 'foundingChampion',
    membershipStatus: 'active',
  });
  await db.doc(`wsfMemberProfiles/${opts.championUid}`).set({ displayName: opts.championUid });
  return groupId;
}

async function seedMember(groupId: string, uid: string, status = 'active'): Promise<void> {
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role: 'member',
    membershipStatus: status,
  });
  await getFirestore().doc(`wsfMemberProfiles/${uid}`).set({ displayName: uid });
}

async function seedGoal(
  groupId: string,
  opts?: { target?: number; unit?: string; status?: 'active' | 'closed'; authorized?: boolean }
): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  const doc: Record<string, unknown> = {
    ownerUid: 'pulseSeed',
    communityGroupId: groupId,
    title: 'Package E pulse goal',
    target: opts?.target ?? 5000,
    unit: opts?.unit ?? 'squats',
    status: opts?.status ?? 'active',
    startsAt: Timestamp.fromMillis(now - 60_000),
    endsAt: Timestamp.fromMillis(now + 3_600_000),
    timezone: 'America/New_York',
  };
  // Authorization is set ONLY where a test's purpose is to exercise authorized
  // display. The default seed omits the field entirely, which is the shape
  // every goal written before Package E has.
  if (opts?.authorized === true) doc.aggregateDisplayAuthorized = true;
  await ref.set(doc);
  return ref.id;
}

async function seedShards(goalId: string, perShard: number[]): Promise<void> {
  const db = getFirestore();
  const batch = db.batch();
  perShard.forEach((count, i) => {
    if (count > 0) batch.set(db.doc(`wsfGoalCounters/${goalId}/shards/${i}`), { count }, { merge: true });
  });
  await batch.commit();
}

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-goal-pulse').set({ at: Date.now() }, { merge: true });
});

describe('goal-id possession is never authorization', () => {
  test('missing goalId -> invalid-argument', async () => {
    const r = await pulse({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('invalid-argument');
  });

  test('CASE 13: a valid, real, UNAUTHORIZED goalId is refused', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId);
    await seedShards(goalId, [50, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const r = await pulse({ goalId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
  });

  test('the refusal is byte-identical to an unknown goalId — no existence oracle', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const realButUnauthorized = await seedGoal(groupId);

    const unknown = await pulse({ goalId: uniq('nosuchgoal') });
    const real = await pulse({ goalId: realButUnauthorized });

    expect(unknown.ok).toBe(false);
    expect(real.ok).toBe(false);
    if (unknown.ok || real.ok) return;
    expect(real.error.code).toBe(unknown.error.code);
    expect(real.error.message).toBe(unknown.error.message);
    expect(real.error.details).toEqual(unknown.error.details);
  });
});

describe('only explicit per-goal authorization opens the aggregate read', () => {
  test('CASE 3: anonymous caller + explicitly authorized goal -> aggregate returned', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'inviteOnly', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true, target: 5000, unit: 'squats' });
    await seedShards(goalId, [10, 0, 20, 0, 5, 0, 0, 15, 0, 0]); // 50

    const r = await pulse({ goalId });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual({ sharedTotal: 50, target: 5000, unit: 'squats', status: 'active' });
    }
  });

  test('CASE 4: a PRIVATE community’s authorized goal displays — because the GOAL was authorized', async () => {
    // The point of this test is the reason, not just the result: privacy of the
    // community neither grants nor withholds display. The goal decides.
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });
    await seedShards(goalId, [7, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    const r = await pulse({ goalId });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.sharedTotal).toBe(7);
  });

  test('CASE 5: a PUBLIC community’s unauthorized goal is refused', async () => {
    // The mirror image. Discoverability is not publication.
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId);
    await seedShards(goalId, [99, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    const r = await pulse({ goalId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not-found');
  });

  test('every joinPolicy behaves identically — the tier is simply not consulted', async () => {
    for (const joinPolicy of ['private', 'inviteOnly', 'public'] as JoinPolicy[]) {
      const groupId = await seedCommunity({ joinPolicy, championUid: uniq('champ') });
      const off = await seedGoal(groupId);
      const on = await seedGoal(groupId, { authorized: true });
      expect({ joinPolicy, authorized: (await pulse({ goalId: off })).ok }).toEqual({ joinPolicy, authorized: false });
      expect({ joinPolicy, authorized: (await pulse({ goalId: on })).ok }).toEqual({ joinPolicy, authorized: true });
    }
  });

  test('a goal whose flag is explicitly false is refused', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId);
    await getFirestore().doc(`wsfGoals/${goalId}`).set(
      { aggregateDisplayAuthorized: false },
      { merge: true }
    );
    expect((await pulse({ goalId })).ok).toBe(false);
  });

  test('a truthy non-boolean never authorizes', async () => {
    // A hand edit or an import writing the string "false" — or "true" — must
    // not be able to publish a community's progress.
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: uniq('champ') });
    for (const bad of ['true', 'false', 1, {}]) {
      const goalId = await seedGoal(groupId);
      await getFirestore()
        .doc(`wsfGoals/${goalId}`)
        .set({ aggregateDisplayAuthorized: bad as never }, { merge: true });
      expect({ bad, ok: (await pulse({ goalId })).ok }).toEqual({ bad, ok: false });
    }
  });
});

describe('CASE 1 — the member route is independent of display authorization', () => {
  test('an active member reads an UNAUTHORIZED goal\u2019s progress', async () => {
    // The member experience does not depend on publication. A private
    // community that publishes nothing still shows its own members where they
    // are — this is what the contribution screen polls.
    const champion = uniq('champ');
    const member = uniq('m');
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: champion });
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId);
    await seedShards(goalId, [42, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    // Anonymous: refused.
    expect((await pulse({ goalId })).ok).toBe(false);
    // The member: served.
    const asMember = (await callAs(wsfGoalPulse, member, { goalId })) as { sharedTotal: number };
    expect(asMember.sharedTotal).toBe(42);
  });

  test('a REMOVED member is refused again', async () => {
    const champion = uniq('champ');
    const member = uniq('m');
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: champion });
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId);
    await seedShards(goalId, [42, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(((await callAs(wsfGoalPulse, member, { goalId })) as { sharedTotal: number }).sharedTotal).toBe(42);

    await seedMember(groupId, member, 'removed');
    await expect(callAs(wsfGoalPulse, member, { goalId })).rejects.toThrow(HttpsError);
  });

  test('a signed-in NON-member is refused on an unauthorized goal', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId);
    await expect(callAs(wsfGoalPulse, uniq('stranger'), { goalId })).rejects.toThrow(HttpsError);
  });

  test('a member of a SAMPLE community still sees their own community', async () => {
    const champion = uniq('champ');
    const member = uniq('m');
    const groupId = await seedCommunity({
      joinPolicy: 'public',
      championUid: champion,
      isSample: true,
    });
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId);
    await seedShards(goalId, [5, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const r = (await callAs(wsfGoalPulse, member, { goalId })) as { sharedTotal: number };
    expect(r.sharedTotal).toBe(5);
  });
});

describe('the authorized aggregate response discloses only aggregate progress', () => {
  test('CASE 12: exactly four fields, and no contributorCount', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: uniq('champ') });
    const memberA = uniq('m');
    const memberB = uniq('m');
    await seedMember(groupId, memberA);
    await seedMember(groupId, memberB);
    const goalId = await seedGoal(groupId, { authorized: true });
    await seedShards(goalId, [30, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    // Real per-member totals exist, so a leak would have something to leak.
    await getFirestore()
      .doc(`wsfGoalMemberTotals/${goalId}_${memberA}`)
      .set({ goalId, userId: memberA, total: 20 });
    await getFirestore()
      .doc(`wsfGoalMemberTotals/${goalId}_${memberB}`)
      .set({ goalId, userId: memberB, total: 10 });

    const r = await pulse({ goalId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(Object.keys(r.value).sort()).toEqual(['sharedTotal', 'status', 'target', 'unit']);
    expect(r.value).not.toHaveProperty('contributorCount');

    // No member identity, no individual credit, anywhere in the payload.
    const serialized = JSON.stringify(r.value);
    expect(serialized).not.toContain(memberA);
    expect(serialized).not.toContain(memberB);
    expect(serialized).not.toContain('20');
  });

  test('sample communities are suppressed even when the goal is authorized', async () => {
    // isSample can stop a display. It can never start one.
    const groupId = await seedCommunity({
      joinPolicy: 'public',
      championUid: uniq('champ'),
      isSample: true,
    });
    const goalId = await seedGoal(groupId, { authorized: true });
    await seedShards(goalId, [1000, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect((await pulse({ goalId })).ok).toBe(false);
  });
});

describe('Champion control over the authorization', () => {
  test('CASE 10: a Champion may authorize, and the display then works', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity({ joinPolicy: 'private', championUid: champion });
    const goalId = await seedGoal(groupId);
    await seedShards(goalId, [12, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    expect((await pulse({ goalId })).ok).toBe(false);
    await callAs(wsfSetGoalDisplayAuthorization, champion, { goalId, authorized: true });
    const after = await pulse({ goalId });
    expect(after.ok).toBe(true);
    if (after.ok) expect(after.value.sharedTotal).toBe(12);
  });

  test('CASE 8: revocation takes effect on the next read, without deleting anything', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: champion });
    const goalId = await seedGoal(groupId, { authorized: true });
    await seedShards(goalId, [33, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect((await pulse({ goalId })).ok).toBe(true);

    await callAs(wsfSetGoalDisplayAuthorization, champion, { goalId, authorized: false });

    const after = await pulse({ goalId });
    expect(after.ok).toBe(false);
    // The goal and its counters survive revocation untouched.
    const goalSnap = await getFirestore().doc(`wsfGoals/${goalId}`).get();
    expect(goalSnap.exists).toBe(true);
    expect((goalSnap.data() as { target: number }).target).toBe(5000);
    const shard = await getFirestore().doc(`wsfGoalCounters/${goalId}/shards/0`).get();
    expect((shard.data() as { count: number }).count).toBe(33);
  });

  test('CASE 11: an ordinary member may not change the authorization', async () => {
    const champion = uniq('champ');
    const member = uniq('m');
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: champion });
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId);

    await expect(
      callAs(wsfSetGoalDisplayAuthorization, member, { goalId, authorized: true })
    ).rejects.toThrow(HttpsError);
    expect((await pulse({ goalId })).ok).toBe(false);
  });

  test('a Champion of a DIFFERENT community may not authorize this goal', async () => {
    // Champion authority is community-scoped. There is no global publisher.
    const outsiderChampion = uniq('champ');
    await seedCommunity({ joinPolicy: 'public', championUid: outsiderChampion });
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId);

    await expect(
      callAs(wsfSetGoalDisplayAuthorization, outsiderChampion, { goalId, authorized: true })
    ).rejects.toThrow(HttpsError);
    expect((await pulse({ goalId })).ok).toBe(false);
  });

  test('a removed Champion may not change the authorization', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: champion });
    const goalId = await seedGoal(groupId);
    await getFirestore()
      .doc(`wsfMemberships/${groupId}_${champion}`)
      .set({ membershipStatus: 'removed' }, { merge: true });

    await expect(
      callAs(wsfSetGoalDisplayAuthorization, champion, { goalId, authorized: true })
    ).rejects.toThrow(HttpsError);
  });

  test('an unauthenticated caller may not change the authorization', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId);
    await expect(
      callAs(wsfSetGoalDisplayAuthorization, null, { goalId, authorized: true })
    ).rejects.toThrow(HttpsError);
  });

  test('a non-boolean authorized value is refused rather than coerced', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: champion });
    const goalId = await seedGoal(groupId);
    for (const bad of ['true', 1, null, undefined]) {
      await expect(
        callAs(wsfSetGoalDisplayAuthorization, champion, { goalId, authorized: bad })
      ).rejects.toThrow(HttpsError);
    }
    expect((await pulse({ goalId })).ok).toBe(false);
  });
});

describe('CASE 9: authorization survives goal closure', () => {
  test('a closed, authorized goal still displays — closing is not revoking', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: champion });
    const goalId = await seedGoal(groupId, { authorized: true, status: 'closed', target: 100 });
    await seedShards(goalId, [100, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    const r = await pulse({ goalId });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.status).toBe('closed');
      expect(r.value.sharedTotal).toBe(100);
    }
  });

  test('a closed goal’s authorization is still revocable', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: champion });
    const goalId = await seedGoal(groupId, { authorized: true, status: 'closed' });
    expect((await pulse({ goalId })).ok).toBe(true);
    await callAs(wsfSetGoalDisplayAuthorization, champion, { goalId, authorized: false });
    expect((await pulse({ goalId })).ok).toBe(false);
  });
});

describe('aggregate arithmetic, preserved from the E4-A1 slice', () => {
  test('sharedTotal is the sum of all ten shards', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: uniq('champ') });
    const goalId = await seedGoal(groupId, { authorized: true });
    await seedShards(goalId, [10, 0, 20, 0, 5, 0, 0, 15, 0, 0]);
    const r = await pulse({ goalId });
    if (r.ok) expect(r.value.sharedTotal).toBe(50);
    else throw new Error('expected an authorized read');
  });

  test('cross-goal isolation: two goals do not share counters', async () => {
    const groupId = await seedCommunity({ joinPolicy: 'public', championUid: uniq('champ') });
    const g1 = await seedGoal(groupId, { authorized: true, target: 5000, unit: 'squats' });
    const g2 = await seedGoal(groupId, { authorized: true, target: 3000, unit: 'push-ups' });
    await seedShards(g1, [100, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    await seedShards(g2, [7, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

    const [r1, r2] = await Promise.all([pulse({ goalId: g1 }), pulse({ goalId: g2 })]);
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r1.value.sharedTotal).toBe(100);
      expect(r1.value.unit).toBe('squats');
      expect(r2.value.sharedTotal).toBe(7);
      expect(r2.value.unit).toBe('push-ups');
    }
  });
});
