/**
 * PACKAGE E — the member side of the authorization model, and the replay path.
 *
 * The goal-pulse suite pins the anonymous display read. This file pins the
 * other half: what an active member may read, what a removed member loses, and
 * what a removed member is told when they replay an attempt that really did
 * count. The two halves are independent on purpose — membership permits the
 * member experience, per-goal authorization permits the display experience,
 * and neither implies the other.
 */

process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  wsfChallengePulse,
  wsfContribute,
  wsfGoalPulse,
  wsfListGoals,
  wsfMyContribution,
  wsfRemoveMember,
  wsfSetGoalDisplayAuthorization,
} from '../../src/index';

const VERIFIED = { email_verified: true } as Record<string, unknown>;

function call(fn: unknown, uid: string | null, data: unknown) {
  return (fn as { run: (r: never) => Promise<never> }).run({
    data,
    auth: uid ? { uid, token: VERIFIED } : undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
  } as never);
}

async function expectRefused(p: Promise<unknown>, code: string, label = '') {
  await expect(p).rejects.toThrow(HttpsError);
  await p.catch((e: HttpsError) => expect(`${label}${e.code}`).toBe(`${label}${code}`));
}

let seq = 0;
const uniq = (p: string) => `${p}_${Date.now().toString(36)}_${(seq += 1)}`;

async function seedGroup(championUid: string, joinPolicy = 'inviteOnly'): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('peGroup');
  await db.doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'Package E community',
    groupType: 'custom',
    joinPolicy,
    joinCode: uniq('code'),
    lifecycleStatus: 'active',
    isSample: false,
  });
  await db.doc(`wsfMemberships/${groupId}_${championUid}`).set({
    groupId,
    userId: championUid,
    role: 'foundingChampion',
    membershipStatus: 'active',
  });
  await db.doc(`wsfMemberProfiles/${championUid}`).set({ displayName: championUid });
  return groupId;
}

async function seedMember(groupId: string, uid: string, status = 'active'): Promise<void> {
  const db = getFirestore();
  await db.doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role: 'member',
    membershipStatus: status,
  });
  await db.doc(`wsfMemberProfiles/${uid}`).set({ displayName: uid });
}

async function seedGoal(groupId: string, ownerUid: string): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid,
    communityGroupId: groupId,
    title: 'Package E goal',
    target: 500,
    unit: 'reps',
    status: 'active',
    startsAt: Timestamp.fromMillis(now - 60_000),
    endsAt: Timestamp.fromMillis(now + 3_600_000),
    timezone: 'America/New_York',
  });
  return ref.id;
}

describe('CASE 1 — an active member reads their community’s shared progress', () => {
  it('reads goals through the member path whether or not display is authorized', async () => {
    const champion = uniq('champ');
    const member = uniq('m');
    const groupId = await seedGroup(champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);

    // Display is OFF. The member experience is unaffected by that.
    const listed = (await call(wsfListGoals, member, { groupId })) as {
      goals: { goalId: string; aggregateDisplayAuthorized: boolean }[];
    };
    expect(listed.goals.map((g) => g.goalId)).toContain(goalId);
    expect(listed.goals[0]!.aggregateDisplayAuthorized).toBe(false);

    // And contributing returns the full shared state to them.
    const res = (await call(wsfContribute, member, {
      goalId,
      attemptId: uniq('a'),
      count: 25,
    })) as Record<string, unknown>;
    expect(res.sharedTotal).toBe(25);
    expect(res.target).toBe(500);
    expect(res.unit).toBe('reps');
    expect(res.ownCredit).toBe(25);
  });
});

describe('CASE 6 — a removed member with a retained goalId', () => {
  it('loses the member paths and gains nothing from the display path', async () => {
    const champion = uniq('champ');
    const member = uniq('m');
    const groupId = await seedGroup(champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);
    await call(wsfContribute, member, { goalId, attemptId: uniq('a'), count: 40 });

    await call(wsfRemoveMember, champion, { groupId, targetUid: member });

    // Member-only paths close.
    await expectRefused(call(wsfListGoals, member, { groupId }), 'not-found', 'listGoals: ');
    await expectRefused(
      call(wsfContribute, member, { goalId, attemptId: uniq('a'), count: 5 }),
      'permission-denied',
      'contribute: '
    );

    // And the goalId they kept is not a way back in: the goal is not
    // display-authorized, so the anonymous path refuses too.
    await expectRefused(call(wsfGoalPulse, null, { goalId }), 'not-found', 'pulse: ');
  });

  it('their own historical credit remains theirs — a separate question', async () => {
    const champion = uniq('champ');
    const member = uniq('m');
    const groupId = await seedGroup(champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);
    await call(wsfContribute, member, { goalId, attemptId: uniq('a'), count: 40 });
    await call(wsfRemoveMember, champion, { groupId, targetUid: member });

    const own = (await call(wsfMyContribution, member, { goalId })) as { ownCredit: number };
    expect(own.ownCredit).toBe(40);

    // The contribution itself is still recorded and still counted.
    const contribs = await getFirestore()
      .collection('wsfContributions')
      .where('goalId', '==', goalId)
      .get();
    expect(contribs.size).toBe(1);
  });
});

describe('CASE 7 — replay by a removed member', () => {
  it('counts zero additional times and withholds current shared state', async () => {
    const champion = uniq('champ');
    const member = uniq('m');
    const groupId = await seedGroup(champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);
    const attemptId = uniq('attempt');

    await call(wsfContribute, member, { goalId, attemptId, count: 30 });
    await call(wsfRemoveMember, champion, { groupId, targetUid: member });
    // The community moves on without them.
    await call(wsfContribute, champion, { goalId, attemptId: uniq('a'), count: 45 });

    const replay = (await call(wsfContribute, member, {
      goalId,
      attemptId,
      count: 30,
    })) as Record<string, unknown>;

    // Idempotent: their own answer is honest and unchanged.
    expect(replay.alreadyRecorded).toBe(true);
    expect(replay.addedCount).toBe(30);
    expect(replay.ownCredit).toBe(30);

    // And it counted exactly once.
    const contribs = await getFirestore()
      .collection('wsfContributions')
      .where('goalId', '==', goalId)
      .get();
    expect(contribs.size).toBe(2); // theirs + the champion's
    const totals = await getFirestore().doc(`wsfGoalMemberTotals/${goalId}_${member}`).get();
    expect((totals.data() as { total: number }).total).toBe(30);

    // THE FIX: no current shared community state. Before Package E this
    // returned sharedTotal 75 — including the 45 contributed after removal.
    expect(replay.sharedTotal).toBeUndefined();
    expect(replay.target).toBeUndefined();
    expect(replay.unit).toBeUndefined();
    expect(replay.status).toBeUndefined();
  });

  it('an ACTIVE member replaying still receives the full shared state', async () => {
    const champion = uniq('champ');
    const member = uniq('m');
    const groupId = await seedGroup(champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);
    const attemptId = uniq('attempt');

    await call(wsfContribute, member, { goalId, attemptId, count: 30 });
    const replay = (await call(wsfContribute, member, {
      goalId,
      attemptId,
      count: 30,
    })) as Record<string, unknown>;

    expect(replay.alreadyRecorded).toBe(true);
    expect(replay.addedCount).toBe(30);
    expect(replay.sharedTotal).toBe(30);
    expect(replay.target).toBe(500);
  });

  it('a removed member replaying an AUTHORIZED goal does receive shared state', async () => {
    // Because those numbers are public by explicit decision — withholding
    // them here would protect nothing, since wsfGoalPulse serves them.
    const champion = uniq('champ');
    const member = uniq('m');
    const groupId = await seedGroup(champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);
    const attemptId = uniq('attempt');

    await call(wsfContribute, member, { goalId, attemptId, count: 30 });
    await call(wsfSetGoalDisplayAuthorization, champion, { goalId, authorized: true });
    await call(wsfRemoveMember, champion, { groupId, targetUid: member });

    const replay = (await call(wsfContribute, member, {
      goalId,
      attemptId,
      count: 30,
    })) as Record<string, unknown>;
    expect(replay.alreadyRecorded).toBe(true);
    expect(replay.sharedTotal).toBe(30);
  });
});

describe('wsfChallengePulse is no longer an anonymous aggregate read', () => {
  it('refuses an unauthenticated caller holding a real challengeId', async () => {
    const champion = uniq('champ');
    const groupId = await seedGroup(champion);
    const challengeId = uniq('ch');
    await getFirestore().doc(`wsfChallenges/${challengeId}`).set({
      groupId,
      title: 'Package E challenge',
      status: 'active',
      goalTarget: 100,
    });

    await expectRefused(call(wsfChallengePulse, null, { challengeId }), 'not-found');
  });

  it('refuses an active member of a DIFFERENT community', async () => {
    const champion = uniq('champ');
    const groupId = await seedGroup(champion);
    const outsider = uniq('out');
    const otherGroup = await seedGroup(uniq('champ2'));
    await seedMember(otherGroup, outsider);

    const challengeId = uniq('ch');
    await getFirestore().doc(`wsfChallenges/${challengeId}`).set({
      groupId,
      title: 'Package E challenge',
      status: 'active',
      goalTarget: 100,
    });

    await expectRefused(call(wsfChallengePulse, outsider, { challengeId }), 'not-found');
  });

  it('refuses a removed member, and serves an active one', async () => {
    const champion = uniq('champ');
    const groupId = await seedGroup(champion);
    const member = uniq('m');
    await seedMember(groupId, member);
    const challengeId = uniq('ch');
    await getFirestore().doc(`wsfChallenges/${challengeId}`).set({
      groupId,
      title: 'Package E challenge',
      status: 'active',
      goalTarget: 100,
    });

    // Active member: served.
    const totals = (await call(wsfChallengePulse, member, { challengeId })) as Record<string, unknown>;
    expect(totals).toBeDefined();

    await call(wsfRemoveMember, champion, { groupId, targetUid: member });
    await expectRefused(call(wsfChallengePulse, member, { challengeId }), 'not-found');
  });
});
