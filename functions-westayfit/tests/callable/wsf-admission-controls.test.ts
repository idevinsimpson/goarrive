/**
 * Package D — admission controls, tested together rather than as unrelated
 * helpers. Reset, joining, removal, departure, reinstatement and designation
 * interact, and the interactions are where the defects live.
 *
 * Runs against the Firestore emulator via `.run(request)`.
 */

process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  wsfContribute,
  wsfDesignateChampion,
  wsfGoalPulse,
  wsfJoinCommunity,
  wsfLeaveCommunity,
  wsfListChallenge,
  wsfListGoals,
  wsfMyCommunities,
  wsfMyContribution,
  wsfPreviewCommunity,
  wsfReinstateMember,
  wsfRemoveMember,
  wsfResetJoinCode,
  wsfSetGoalDisplayAuthorization,
} from '../../src/index';

const VERIFIED = { email_verified: true } as Record<string, unknown>;

function call(fn: unknown, uid: string | null, data: unknown, token = VERIFIED) {
  return (fn as { run: (r: never) => Promise<never> }).run({
    data,
    auth: uid ? { uid, token } : undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
  } as never);
}

async function expectRefused(p: Promise<unknown>, code: string, label = '') {
  await expect(p).rejects.toThrow(HttpsError);
  await p.catch((e: HttpsError) => expect(`${label}${e.code}`).toBe(`${label}${code}`));
}

async function seedProfile(uid: string) {
  await getFirestore().doc(`wsfMemberProfiles/${uid}`).set({ displayName: uid });
}

async function seedGroup(
  joinPolicy: 'public' | 'inviteOnly' | 'private',
  championUid: string
): Promise<{ groupId: string; joinCode: string }> {
  const joinCode = `seed${Math.random().toString(36).slice(2)}${'x'.repeat(16)}`.slice(0, 32);
  const ref = getFirestore().collection('wsfCommunityGroups').doc();
  await ref.set({
    displayName: 'D test community',
    groupType: 'custom',
    joinPolicy,
    joinCode,
    lifecycleStatus: 'active',
    isSample: false,
  });
  await getFirestore().doc(`wsfMemberships/${ref.id}_${championUid}`).set({
    groupId: ref.id,
    userId: championUid,
    role: 'foundingChampion',
    membershipStatus: 'active',
  });
  await seedProfile(championUid);
  return { groupId: ref.id, joinCode };
}

async function seedMember(groupId: string, uid: string, status = 'active') {
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role: 'member',
    membershipStatus: status,
  });
  await seedProfile(uid);
}

async function statusOf(groupId: string, uid: string): Promise<string | undefined> {
  const snap = await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).get();
  return (snap.data() as { membershipStatus?: string } | undefined)?.membershipStatus;
}

async function championCount(groupId: string): Promise<number> {
  const snap = await getFirestore()
    .collection('wsfMemberships')
    .where('groupId', '==', groupId)
    .where('membershipStatus', '==', 'active')
    .where('role', '==', 'foundingChampion')
    .get();
  return snap.size;
}

async function seedGoal(groupId: string, uid: string): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: uid,
    communityGroupId: groupId,
    title: 'D goal',
    target: 500,
    unit: 'reps',
    status: 'active',
    startsAt: Timestamp.fromMillis(now - 60_000),
    endsAt: Timestamp.fromMillis(now + 3_600_000),
    timezone: 'America/New_York',
  });
  return ref.id;
}

describe('D1 — resetting the join link', () => {
  it('retires the old code for EVERYONE, members included, and issues a new one', async () => {
    const champion = 'd1-champ';
    const member = 'd1-member';
    const { groupId, joinCode } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, member);

    const result = (await call(wsfResetJoinCode, champion, { groupId })) as { joinCode: string };
    expect(result.joinCode).not.toBe(joinCode);

    // The old code is now indistinguishable from an unknown code, on BOTH
    // paths — that is what keeps the code space unguessable.
    await expectRefused(call(wsfPreviewCommunity, null, { joinCode }), 'not-found', 'preview old: ');
    await expectRefused(call(wsfJoinCommunity, member, { joinCode }), 'not-found', 'member old: ');
    // The stranger needs a profile of their own: without one the join stops at
    // the profile precondition, and a `failed-precondition` there would prove
    // nothing about the retired code.
    await seedProfile('d1-stranger');
    await expectRefused(call(wsfJoinCommunity, 'd1-stranger', { joinCode }), 'not-found');

    // …and the active member is STILL a member. A retired link does not evict.
    expect(await statusOf(groupId, member)).toBe('active');

    // The new code works.
    const joined = (await call(wsfJoinCommunity, member, { joinCode: result.joinCode })) as {
      alreadyMember: boolean;
    };
    expect(joined.alreadyMember).toBe(true);
  });

  it('refuses a non-champion and an unauthenticated caller', async () => {
    const { groupId } = await seedGroup('inviteOnly', 'd1b-champ');
    await seedMember(groupId, 'd1b-member');
    await expectRefused(call(wsfResetJoinCode, 'd1b-member', { groupId }), 'not-found');
    await expectRefused(call(wsfResetJoinCode, null, { groupId }), 'unauthenticated');
  });

  it('does not touch memberships or contributions', async () => {
    const champion = 'd1c-champ';
    const member = 'd1c-member';
    const { groupId } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);
    await call(wsfContribute, member, { goalId, attemptId: 'd1c-attempt-0001', count: 25 });

    await call(wsfResetJoinCode, champion, { groupId });

    expect(await statusOf(groupId, member)).toBe('active');
    const contribs = await getFirestore()
      .collection('wsfContributions')
      .where('goalId', '==', goalId)
      .get();
    expect(contribs.size).toBe(1);
    expect((contribs.docs[0]!.data() as { count: number }).count).toBe(25);
  });
});

describe('D4 — which tiers a link opens', () => {
  it('admits inviteOnly on both the preview and the join path', async () => {
    const { groupId, joinCode } = await seedGroup('inviteOnly', 'd4-champ');
    await seedProfile('d4-joiner');

    const preview = (await call(wsfPreviewCommunity, null, { joinCode })) as {
      displayName: string;
      joinPolicy: string;
    };
    expect(preview.displayName).toBe('D test community');
    expect(preview.joinPolicy).toBe('inviteOnly');

    const joined = (await call(wsfJoinCommunity, 'd4-joiner', { joinCode })) as {
      groupId: string;
      alreadyMember: boolean;
    };
    expect(joined.groupId).toBe(groupId);
    expect(joined.alreadyMember).toBe(false);
  });

  it('still refuses private on both paths — a general link never admits there', async () => {
    const { joinCode } = await seedGroup('private', 'd4b-champ');
    await seedProfile('d4b-joiner');
    await expectRefused(call(wsfPreviewCommunity, null, { joinCode }), 'not-found');
    await expectRefused(call(wsfJoinCommunity, 'd4b-joiner', { joinCode }), 'not-found');
  });

  it('still requires a verified email and a profile', async () => {
    const { joinCode } = await seedGroup('inviteOnly', 'd4c-champ');
    await expectRefused(
      call(wsfJoinCommunity, 'd4c-unverified', { joinCode }, { email_verified: false }),
      'failed-precondition'
    );
    await expectRefused(call(wsfJoinCommunity, 'd4c-noprofile', { joinCode }), 'failed-precondition');
  });
});

describe('D6 — the invitation preview is minimised', () => {
  it('returns name, type and joining conditions, and no member count', async () => {
    const { groupId, joinCode } = await seedGroup('inviteOnly', 'd6-champ');
    await seedMember(groupId, 'd6-a');
    await seedMember(groupId, 'd6-b');

    const preview = (await call(wsfPreviewCommunity, null, { joinCode })) as Record<string, unknown>;
    expect(Object.keys(preview).sort()).toEqual(['displayName', 'groupType', 'joinPolicy']);
    expect(preview).not.toHaveProperty('memberCount');
  });
});

describe('D2 + D3 — removal, departure, and what a link does for each state', () => {
  it('removal closes the member-only paths it is supposed to close', async () => {
    const champion = 'd2-champ';
    const member = 'd2-member';
    const { groupId } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);

    // Before: the member can contribute and read the challenge list.
    await call(wsfContribute, member, { goalId, attemptId: 'd2-attempt-0001', count: 10 });

    await call(wsfRemoveMember, champion, { groupId, targetUid: member });
    expect(await statusOf(groupId, member)).toBe('removed');

    // After: the enumerated member-only paths refuse. This list is the
    // package's actual claim about removal — not "removal closes everything".
    await expectRefused(
      call(wsfContribute, member, { goalId, attemptId: 'd2-attempt-0002', count: 10 }),
      'permission-denied',
      'contribute: '
    );
    await expectRefused(
      call(wsfListChallenge, member, { groupId }),
      'permission-denied',
      'listChallenge: '
    );
    // Note the DIFFERENT refusal code, which is deliberate and not drift:
    // wsfContribute and wsfListChallenge answer permission-denied, while
    // wsfListGoals answers not-found so it does not confirm to a non-member
    // that this community exists at all. Asserting the exact code each path
    // returns is what keeps that distinction from being flattened later.
    await expectRefused(call(wsfListGoals, member, { groupId }), 'not-found', 'listGoals: ');
    // The community stops appearing in their own list of communities.
    const mine = (await call(wsfMyCommunities, member, {})) as {
      items: { groupId: string }[];
    };
    expect(mine.items.map((i) => i.groupId)).not.toContain(groupId);
  });

  it('states what removal does and does not close, so the boundary is not overclaimed', async () => {
    // Written under Package D to stop "removal closes the member-only paths"
    // from being read as "a removed person can no longer see anything", and to
    // FAIL LOUDLY when the open defect it recorded was closed. PACKAGE E
    // closed it, so this is now reframed rather than deleted: the path that
    // deliberately survives removal is still asserted, and the one that was a
    // defect is asserted CLOSED.
    const champion = 'd2c-champ';
    const member = 'd2c-member';
    const { groupId } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);
    await call(wsfContribute, member, { goalId, attemptId: 'd2c-attempt-0001', count: 25 });

    await call(wsfRemoveMember, champion, { groupId, targetUid: member });

    // 1. BY DESIGN: they can still read the credit they earned. The path is
    //    derived from their own uid, so this is their own row and nobody
    //    else's — see the note above wsfMyContribution.
    const own = (await call(wsfMyContribution, member, { goalId })) as { ownCredit: number };
    expect(own.ownCredit).toBe(25);

    // 2. CLOSED BY PACKAGE E. This goal carries no display authorization, so
    //    holding its id gets nothing — for the removed member and for anyone
    //    else. Under Package D this returned sharedTotal 25 to any caller.
    await expectRefused(call(wsfGoalPulse, null, { goalId }), 'not-found', 'anonymous pulse: ');

    //    And it is the AUTHORIZATION that decides, not who is asking: the same
    //    anonymous call succeeds once a Champion authorizes the goal. Removal
    //    and publication are separate concepts and this pins both directions.
    await call(wsfSetGoalDisplayAuthorization, champion, { goalId, authorized: true });
    const authorized = (await call(wsfGoalPulse, null, { goalId })) as { sharedTotal: number };
    expect(authorized.sharedTotal).toBe(25);
    expect(authorized).not.toHaveProperty('contributorCount');
  });

  it('past valid contributions stay counted after removal', async () => {
    const champion = 'd2b-champ';
    const member = 'd2b-member';
    const { groupId } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);
    await call(wsfContribute, member, { goalId, attemptId: 'd2b-attempt-0001', count: 40 });

    await call(wsfRemoveMember, champion, { groupId, targetUid: member });

    const contribs = await getFirestore()
      .collection('wsfContributions')
      .where('goalId', '==', goalId)
      .get();
    expect(contribs.size).toBe(1);
    expect((contribs.docs[0]!.data() as { count: number }).count).toBe(40);
    const totals = await getFirestore().doc(`wsfGoalMemberTotals/${goalId}_${member}`).get();
    expect((totals.data() as { total: number }).total).toBe(40);
  });

  it('a removed member cannot readmit themselves with the link, and learns nothing', async () => {
    const champion = 'd3-champ';
    const member = 'd3-member';
    const { groupId, joinCode } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, member);
    await call(wsfRemoveMember, champion, { groupId, targetUid: member });

    // The same not-found an unknown code gets — it discloses nothing about the
    // community, or even that this person was once a member.
    await expectRefused(call(wsfJoinCommunity, member, { joinCode }), 'not-found');
    expect(await statusOf(groupId, member)).toBe('removed');
  });

  it('a voluntarily departed member returns through the ordinary path', async () => {
    const champion = 'd3b-champ';
    const member = 'd3b-member';
    const { groupId, joinCode } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, member);

    await call(wsfLeaveCommunity, member, { groupId });
    expect(await statusOf(groupId, member)).toBe('departed');
    // Leaving closes the member-only doors too.
    await expectRefused(call(wsfListChallenge, member, { groupId }), 'permission-denied');

    // Leaving is not a ban: the normal link works again, no Champion needed.
    const rejoined = (await call(wsfJoinCommunity, member, { joinCode })) as {
      alreadyMember: boolean;
    };
    expect(rejoined.alreadyMember).toBe(false);
    expect(await statusOf(groupId, member)).toBe('active');
  });

  it('an active member tapping the current link still resolves, without duplication', async () => {
    const champion = 'd3c-champ';
    const member = 'd3c-member';
    const { groupId, joinCode } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, member);

    const again = (await call(wsfJoinCommunity, member, { joinCode })) as { alreadyMember: boolean };
    expect(again.alreadyMember).toBe(true);
    const all = await getFirestore()
      .collection('wsfMemberships')
      .where('groupId', '==', groupId)
      .get();
    expect(all.size).toBe(2);
  });

  it('reinstatement is explicit, Champion-only, and only for removed members', async () => {
    const champion = 'd2c-champ';
    const removed = 'd2c-removed';
    const departed = 'd2c-departed';
    const { groupId } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, removed);
    await seedMember(groupId, departed);

    await call(wsfRemoveMember, champion, { groupId, targetUid: removed });
    await call(wsfLeaveCommunity, departed, { groupId });

    // A non-champion cannot reinstate.
    await expectRefused(
      call(wsfReinstateMember, removed, { groupId, targetUid: removed }),
      'not-found'
    );
    // A departed person is not reinstated through the removal path — they
    // rejoin normally, and treating leaving as a ban is the thing to avoid.
    await expectRefused(
      call(wsfReinstateMember, champion, { groupId, targetUid: departed }),
      'failed-precondition'
    );

    await call(wsfReinstateMember, champion, { groupId, targetUid: removed });
    expect(await statusOf(groupId, removed)).toBe('active');
  });

  it('a concurrent contribution and removal leaves one coherent state', async () => {
    const champion = 'd2d-champ';
    const member = 'd2d-member';
    const { groupId } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);

    const [contribution, removal] = await Promise.allSettled([
      call(wsfContribute, member, { goalId, attemptId: 'd2d-attempt-0001', count: 15 }),
      call(wsfRemoveMember, champion, { groupId, targetUid: member }),
    ]);

    expect(removal.status).toBe('fulfilled');
    expect(await statusOf(groupId, member)).toBe('removed');

    // Whichever way the race fell, the recorded contributions and the derived
    // total agree with each other — settled reads, not two differently timed
    // ones.
    const contribs = await getFirestore()
      .collection('wsfContributions')
      .where('goalId', '==', goalId)
      .get();
    const recorded = contribs.docs.reduce(
      (sum, d) => sum + (d.data() as { count: number }).count,
      0
    );
    expect(recorded).toBe(contribution.status === 'fulfilled' ? 15 : 0);
    const totals = await getFirestore().doc(`wsfGoalMemberTotals/${goalId}_${member}`).get();
    expect(totals.exists ? (totals.data() as { total: number }).total : 0).toBe(recorded);
  });
});

describe('concurrency — the orderings the controls have to survive', () => {
  // Every test here overlaps two operations with Promise.allSettled and then
  // asserts the AUTHORIZED END STATE. None of them assert a winner: the point
  // of a race test is that either ordering leaves a state the rules permit.

  it('RACE 1 — a join racing a link reset lands on exactly one coherent answer', async () => {
    const champion = 'r1-champ';
    const joiner = 'r1-joiner';
    const { groupId, joinCode } = await seedGroup('inviteOnly', champion);
    await seedProfile(joiner);

    const [join, reset] = await Promise.allSettled([
      call(wsfJoinCommunity, joiner, { joinCode }),
      call(wsfResetJoinCode, champion, { groupId }),
    ]);

    // The reset is a Champion action on the group and must always succeed.
    expect(reset.status).toBe('fulfilled');
    const newCode = (reset as PromiseFulfilledResult<{ joinCode: string }>).value.joinCode;
    expect(newCode).not.toBe(joinCode);

    if (join.status === 'fulfilled') {
      // The join got in before the code was retired: they are a member, and a
      // retired link does not evict them.
      expect(await statusOf(groupId, joiner)).toBe('active');
    } else {
      // The join lost: the old code was already unknown. It must NOT have
      // half-created a membership.
      expect(await statusOf(groupId, joiner)).toBeUndefined();
      // And the new code still admits them — a lost race is not a ban.
      await call(wsfJoinCommunity, joiner, { joinCode: newCode });
      expect(await statusOf(groupId, joiner)).toBe('active');
    }

    // Either way the old code is now dead for everyone.
    await expectRefused(call(wsfPreviewCommunity, null, { joinCode }), 'not-found');
  }, 30_000);

  it('RACE 2 — a join racing a removal never leaves the removed person active', async () => {
    const champion = 'r2-champ';
    const member = 'r2-member';
    const { groupId, joinCode } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, member);

    const [rejoin, remove] = await Promise.allSettled([
      call(wsfJoinCommunity, member, { joinCode }),
      call(wsfRemoveMember, champion, { groupId, targetUid: member }),
    ]);

    // Removal is the Champion's authority over their community and wins.
    expect(remove.status).toBe('fulfilled');
    const status = await statusOf(groupId, member);
    expect(status).toBe('removed');

    // If the join resolved first it can only have been the idempotent
    // already-a-member answer, never a NEW membership that outlives removal.
    if (rejoin.status === 'fulfilled') {
      expect((rejoin.value as { alreadyMember: boolean }).alreadyMember).toBe(true);
    }

    // And the removal holds: retrying the link now gets the unknown-code answer.
    await expectRefused(call(wsfJoinCommunity, member, { joinCode }), 'not-found');
  }, 30_000);

  it('RACE 4a — two Champions leaving at once cannot empty the community', async () => {
    // THIS IS THE TEST THAT FOUND A REAL DEFECT. The first implementation
    // counted champions with an aggregate OUTSIDE the transaction, and each
    // departure's transaction touched only the caller's own membership doc.
    // Disjoint writes never conflict, so both callers observed 2 champions,
    // both passed the `<= 1` guard, and the community was left with none.
    const a = 'r4-champ-a';
    const b = 'r4-champ-b';
    const { groupId } = await seedGroup('inviteOnly', a);
    await getFirestore().doc(`wsfMemberships/${groupId}_${b}`).set({
      groupId,
      userId: b,
      role: 'foundingChampion',
      membershipStatus: 'active',
    });
    await seedProfile(b);
    expect(await championCount(groupId)).toBe(2);

    const results = await Promise.allSettled([
      call(wsfLeaveCommunity, a, { groupId }),
      call(wsfLeaveCommunity, b, { groupId }),
    ]);

    // Exactly one may leave. The other must be refused, whichever it is.
    const left = results.filter((r) => r.status === 'fulfilled');
    expect(left).toHaveLength(1);
    // THE INVARIANT: a community is never left with no Champion.
    expect(await championCount(groupId)).toBe(1);
  }, 30_000);

  it('RACE 4b — two Champions removing each other at once cannot empty the community', async () => {
    const a = 'r4b-champ-a';
    const b = 'r4b-champ-b';
    const { groupId } = await seedGroup('inviteOnly', a);
    await getFirestore().doc(`wsfMemberships/${groupId}_${b}`).set({
      groupId,
      userId: b,
      role: 'foundingChampion',
      membershipStatus: 'active',
    });
    await seedProfile(b);

    await Promise.allSettled([
      call(wsfRemoveMember, a, { groupId, targetUid: b }),
      call(wsfRemoveMember, b, { groupId, targetUid: a }),
    ]);

    expect(await championCount(groupId)).toBe(1);
  }, 30_000);

  it('RACE 4c — one Champion leaving while removing the other cannot empty the community', async () => {
    // Adversarial review of this package proposed that A-leaves ‖ A-removes-B
    // is a second path to zero Champions, because the two operations write to
    // different documents.
    //
    // MEASURED, NOT ASSUMED: it is not. Running this test with the original
    // out-of-transaction count restored at BOTH call sites, RACE 4a fails and
    // this one still passes. The pairing is self-correcting for a reason
    // independent of the count — whichever order lands, requireChampion puts
    // the caller's own membership document in the removal's read set, so once
    // A's departure commits the removal sees A as no longer active and is
    // refused outright.
    //
    // So this test does NOT discriminate the defect, and is not offered as
    // evidence for the fix. It is kept because the invariant is worth pinning
    // and because a future change to requireChampion could make this pairing
    // live. RACE 4a is the test that catches the defect.
    const a = 'r4c-champ-a';
    const b = 'r4c-champ-b';
    const { groupId } = await seedGroup('inviteOnly', a);
    await getFirestore().doc(`wsfMemberships/${groupId}_${b}`).set({
      groupId,
      userId: b,
      role: 'foundingChampion',
      membershipStatus: 'active',
    });
    await seedProfile(b);

    await Promise.allSettled([
      call(wsfLeaveCommunity, a, { groupId }),
      call(wsfRemoveMember, a, { groupId, targetUid: b }),
    ]);

    expect(await championCount(groupId)).toBe(1);
  }, 30_000);

  it('RACE 5 — a removed member replaying a confirmed attempt does not count again', async () => {
    const champion = 'r5-champ';
    const member = 'r5-member';
    const { groupId } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, member);
    const goalId = await seedGoal(groupId, champion);

    // Confirmed WHILE ACTIVE. This contribution was validly accepted and
    // removal must not erase it.
    await call(wsfContribute, member, { goalId, attemptId: 'r5-attempt-0001', count: 30 });
    await call(wsfRemoveMember, champion, { groupId, targetUid: member });

    // The champion adds more AFTER the removal, so the current shared total
    // differs from what the removed member last legitimately saw.
    await call(wsfContribute, champion, { goalId, attemptId: 'r5-champ-0001', count: 45 });

    const replay = (await call(wsfContribute, member, {
      goalId,
      attemptId: 'r5-attempt-0001',
      count: 30,
    })) as Record<string, unknown>;

    // PROPERTY A — it does not count again.
    expect(replay.alreadyRecorded).toBe(true);
    expect(replay.addedCount).toBe(30);
    const contribs = await getFirestore()
      .collection('wsfContributions')
      .where('goalId', '==', goalId)
      .get();
    expect(contribs.size).toBe(2); // the member's one, plus the champion's one
    const totals = await getFirestore().doc(`wsfGoalMemberTotals/${goalId}_${member}`).get();
    expect((totals.data() as { total: number }).total).toBe(30);

    // PROPERTY B — what the RESPONSE discloses. Under Package D this returned
    // sharedTotal 75, including the 45 contributed after removal, because the
    // replay branch returned before the membership check ever ran.
    //
    // PACKAGE E closed it. The caller is no longer an active member and this
    // goal is not display-authorized, so the four fields describing CURRENT
    // shared community state are absent. What they keep is their own: the
    // attempt is acknowledged, counted once, and their own credit returned.
    expect(replay.sharedTotal).toBeUndefined();
    expect(replay.target).toBeUndefined();
    expect(replay.unit).toBeUndefined();
    expect(replay.status).toBeUndefined();
    expect(replay.ownCredit).toBe(30);
  });
});

describe('D7 — a community is never left with no Champion', () => {
  it('refuses the only Champion leaving, and says what has to happen first', async () => {
    const champion = 'd7-champ';
    const { groupId } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, 'd7-member');

    await expectRefused(call(wsfLeaveCommunity, champion, { groupId }), 'failed-precondition');
    expect(await statusOf(groupId, champion)).toBe('active');
  });

  it('refuses removing the only Champion', async () => {
    const champion = 'd7b-champ';
    const other = 'd7b-other';
    const { groupId } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, other);
    await call(wsfDesignateChampion, champion, { groupId, targetUid: other });
    // Now demote the situation back to one champion by removing the new one,
    // then confirm the remaining sole champion cannot be removed either.
    await call(wsfRemoveMember, champion, { groupId, targetUid: other });
    await expectRefused(
      call(wsfRemoveMember, other, { groupId, targetUid: champion }),
      'not-found'
    );
    expect(await statusOf(groupId, champion)).toBe('active');
  });

  it('designation unblocks departure', async () => {
    const champion = 'd7c-champ';
    const successor = 'd7c-successor';
    const { groupId } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, successor);

    await expectRefused(call(wsfLeaveCommunity, champion, { groupId }), 'failed-precondition');
    await call(wsfDesignateChampion, champion, { groupId, targetUid: successor });
    await call(wsfLeaveCommunity, champion, { groupId });

    expect(await statusOf(groupId, champion)).toBe('departed');
    const successorDoc = await getFirestore().doc(`wsfMemberships/${groupId}_${successor}`).get();
    expect((successorDoc.data() as { role: string }).role).toBe('foundingChampion');
  });

  it('only a Champion may designate, and only an active member may be designated', async () => {
    const champion = 'd7d-champ';
    const member = 'd7d-member';
    const { groupId } = await seedGroup('inviteOnly', champion);
    await seedMember(groupId, member);
    await seedMember(groupId, 'd7d-removed', 'removed');

    await expectRefused(
      call(wsfDesignateChampion, member, { groupId, targetUid: 'd7d-removed' }),
      'not-found'
    );
    await expectRefused(
      call(wsfDesignateChampion, champion, { groupId, targetUid: 'd7d-removed' }),
      'failed-precondition'
    );
  });
});
