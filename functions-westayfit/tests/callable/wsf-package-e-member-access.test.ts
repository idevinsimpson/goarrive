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
  wsfAdjustGoal,
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


/**
 * ITEM 4 — the authorization boundary has to hold across every read that can
 * answer the same question, not just the one named in the packet.
 *
 * wsfGoalPulse is the obvious display read. wsfMyContribution is the one that
 * is easy to miss: it answers about a goal, it takes a goalId, and before
 * Package E it answered ANY signed-in caller. That made it a second oracle for
 * "does this goal exist, and what is it counted in" — reachable by anybody with
 * an account, on a goal whose display permission is OFF.
 */
describe('wsfMyContribution does not tell a stranger that a protected goal exists', () => {
  it('refuses an unrelated signed-in caller holding a real goalId', async () => {
    const champion = uniq('champ');
    const outsider = uniq('outsider');
    const groupId = await seedGroup(champion);
    // The outsider is a real, verified account — just not of this community.
    await seedGroup(outsider);
    const goalId = await seedGoal(groupId, champion);

    await expectRefused(call(wsfMyContribution, outsider, { goalId }), 'not-found');
  });

  it('refuses identically for a goalId that does not exist at all', async () => {
    const outsider = uniq('outsider');
    await seedGroup(outsider);

    // The point of the pairing: a stranger cannot tell a real protected goal
    // from a fabricated id. Same code, same message, so neither the existence
    // of the goal nor its unit leaks.
    let realCode = '';
    let realMessage = '';
    const champion = uniq('champ');
    const groupId = await seedGroup(champion);
    const goalId = await seedGoal(groupId, champion);
    await call(wsfMyContribution, outsider, { goalId }).catch((e: HttpsError) => {
      realCode = e.code;
      realMessage = e.message;
    });

    let fakeCode = '';
    let fakeMessage = '';
    await call(wsfMyContribution, outsider, { goalId: uniq('nosuchgoal') }).catch(
      (e: HttpsError) => {
        fakeCode = e.code;
        fakeMessage = e.message;
      }
    );

    expect({ code: realCode, message: realMessage }).toEqual({
      code: fakeCode,
      message: fakeMessage,
    });
    expect(realCode).toBe('not-found');
  });

  it('still refuses a stranger when the goal IS display-authorized', async () => {
    // Display authorization permits the aggregate, through the display path.
    // It is not a grant of the member path, and own-credit is a member path.
    const champion = uniq('champ');
    const outsider = uniq('outsider');
    const groupId = await seedGroup(champion);
    await seedGroup(outsider);
    const goalId = await seedGoal(groupId, champion);
    await call(wsfSetGoalDisplayAuthorization, champion, { goalId, authorized: true });

    // The aggregate is readable by anyone, as decided.
    const pulse = (await call(wsfGoalPulse, null, { goalId })) as { sharedTotal: number };
    expect(pulse.sharedTotal).toBe(0);
    // The outsider's own-credit read is still refused.
    await expectRefused(call(wsfMyContribution, outsider, { goalId }), 'not-found');
  });

  it('serves an ACTIVE member who has contributed nothing yet, as zero', async () => {
    // Zero credit is an answer, not a refusal. A member who has not started
    // must be able to open the screen and see that they are at zero.
    const champion = uniq('champ');
    const member = uniq('m');
    const groupId = await seedGroup(champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);

    const own = (await call(wsfMyContribution, member, { goalId })) as {
      ownCredit: number;
      unit: string;
    };
    expect(own).toEqual({ ownCredit: 0, unit: 'reps', repeatPolicy: 'multiple' });
  });

  it('keeps a former member’s history when a correction has zeroed their credit', async () => {
    // The check is that their record EXISTS, not that it is positive. A
    // Champion correcting a mis-recording down to zero must not also delete
    // the person's ability to see their own history.
    const champion = uniq('champ');
    const member = uniq('m');
    const groupId = await seedGroup(champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);
    await call(wsfContribute, member, { goalId, attemptId: uniq('a'), count: 40 });

    await call(wsfAdjustGoal, champion, {
      goalId,
      targetUid: member,
      delta: -40,
      reason: 'Tally counter double-counted this member.',
    });
    await call(wsfRemoveMember, champion, { groupId, targetUid: member });

    // Removed, and corrected to zero — and still answered.
    const own = (await call(wsfMyContribution, member, { goalId })) as {
      ownCredit: number;
      unit: string;
    };
    expect(own).toEqual({ ownCredit: 0, unit: 'reps', repeatPolicy: 'multiple' });
  });
});

/**
 * ITEM 4b — one policy, two call sites.
 *
 * The replay branch of wsfContribute answers the same question wsfGoalPulse
 * answers: may this caller see this goal's current shared state? Two
 * independent copies of that rule is how they drift. Both now go through
 * evaluateGoalAggregateAccess, and these cases pin that they agree — including
 * on the case that is easy to get wrong, where display authorization is set
 * but the community is a sample community and the display read is refused
 * anyway.
 */
describe('public-read eligibility is the same rule for the pulse and the replay', () => {
  async function pulseAllowed(goalId: string): Promise<boolean> {
    try {
      await call(wsfGoalPulse, null, { goalId });
      return true;
    } catch {
      return false;
    }
  }

  it('agrees on all four combinations of authorization and sample community', async () => {
    for (const isSample of [false, true]) {
      for (const authorized of [false, true]) {
        const champion = uniq('champ');
        const member = uniq('m');
        const groupId = await seedGroup(champion);
        if (isSample) {
          await getFirestore()
            .doc(`wsfCommunityGroups/${groupId}`)
            .set({ isSample: true }, { merge: true });
        }
        await seedMember(groupId, member);
        const goalId = await seedGoal(groupId, champion);
        const attemptId = uniq('attempt');

        await call(wsfContribute, member, { goalId, attemptId, count: 30 });
        if (authorized) {
          await call(wsfSetGoalDisplayAuthorization, champion, { goalId, authorized: true });
        }
        // Removed, so the replay's only possible route to shared state is the
        // display permission — the same route the anonymous pulse uses.
        await call(wsfRemoveMember, champion, { groupId, targetUid: member });

        const replay = (await call(wsfContribute, member, {
          goalId,
          attemptId,
          count: 30,
        })) as Record<string, unknown>;

        const label = `isSample=${isSample} authorized=${authorized}: `;
        expect(`${label}${await pulseAllowed(goalId)}`).toBe(
          `${label}${replay.sharedTotal !== undefined}`
        );
        // And the expected value of that shared decision.
        expect(`${label}${replay.sharedTotal !== undefined}`).toBe(
          `${label}${authorized && !isSample}`
        );
      }
    }
  });
});

/**
 * ITEM 2 — revocation has to remain reachable after a goal closes.
 *
 * Closing a goal does not revoke a display permission granted while it ran, by
 * decision. That makes "the control disappears when the goal closes" a real
 * defect rather than a cosmetic one: the permission stays in force and the
 * person responsible for it loses the only way to turn it off.
 */
describe('a Champion can still revoke display after the goal closes', () => {
  async function closeGoal(goalId: string): Promise<void> {
    await getFirestore().doc(`wsfGoals/${goalId}`).set({ status: 'closed' }, { merge: true });
  }

  it('closure does not revoke: the display keeps serving a closed authorized goal', async () => {
    const champion = uniq('champ');
    const groupId = await seedGroup(champion);
    const goalId = await seedGoal(groupId, champion);
    await call(wsfSetGoalDisplayAuthorization, champion, { goalId, authorized: true });
    await closeGoal(goalId);

    const pulse = (await call(wsfGoalPulse, null, { goalId })) as { status: string };
    expect(pulse.status).toBe('closed');
  });

  it('wsfListGoals still returns the closed goal, so the control is reachable', async () => {
    const champion = uniq('champ');
    const groupId = await seedGroup(champion);
    const goalId = await seedGoal(groupId, champion);
    await call(wsfSetGoalDisplayAuthorization, champion, { goalId, authorized: true });
    await closeGoal(goalId);

    const listed = (await call(wsfListGoals, champion, { groupId })) as {
      goals: { goalId: string; status: string; aggregateDisplayAuthorized: boolean }[];
    };
    const found = listed.goals.find((g) => g.goalId === goalId);
    expect(found).toBeDefined();
    expect({ status: found!.status, authorized: found!.aggregateDisplayAuthorized }).toEqual({
      status: 'closed',
      authorized: true,
    });
  });

  it('a closed goal that was never authorized stays out of the list', async () => {
    // Closure still means "gone from the list" in the ordinary case. The list
    // widened for exactly one reason, and it is not a general un-closing.
    const champion = uniq('champ');
    const groupId = await seedGroup(champion);
    const goalId = await seedGoal(groupId, champion);
    await closeGoal(goalId);

    const listed = (await call(wsfListGoals, champion, { groupId })) as {
      goals: { goalId: string }[];
    };
    expect(listed.goals.map((g) => g.goalId)).not.toContain(goalId);
  });

  it('revoking on the closed goal stops the display, through the ordinary control', async () => {
    const champion = uniq('champ');
    const groupId = await seedGroup(champion);
    const goalId = await seedGoal(groupId, champion);
    await call(wsfSetGoalDisplayAuthorization, champion, { goalId, authorized: true });
    await closeGoal(goalId);

    // No database edit and no privileged path: the same callable the interface
    // drives, called as the Champion.
    await call(wsfSetGoalDisplayAuthorization, champion, { goalId, authorized: false });

    await expectRefused(call(wsfGoalPulse, null, { goalId }), 'not-found');
    // And it drops back out of the list, because nothing holds it there now.
    const listed = (await call(wsfListGoals, champion, { groupId })) as {
      goals: { goalId: string }[];
    };
    expect(listed.goals.map((g) => g.goalId)).not.toContain(goalId);
  });

  it('an ordinary member still cannot revoke on a closed goal', async () => {
    const champion = uniq('champ');
    const member = uniq('m');
    const groupId = await seedGroup(champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);
    await call(wsfSetGoalDisplayAuthorization, champion, { goalId, authorized: true });
    await closeGoal(goalId);

    // not-found, not permission-denied: the callable refuses a non-Champion
    // with the same answer an unknown goal gets, matching wsfListGoals and
    // wsfPreviewCommunity. Closure does not change that.
    await expectRefused(
      call(wsfSetGoalDisplayAuthorization, member, { goalId, authorized: false }),
      'not-found'
    );
    // Unchanged.
    const pulse = (await call(wsfGoalPulse, null, { goalId })) as { status: string };
    expect(pulse.status).toBe('closed');
  });
});
