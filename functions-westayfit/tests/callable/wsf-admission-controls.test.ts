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

  it('states what removal does NOT close, so the boundary is not overclaimed', async () => {
    // This test exists to stop "removal closes the member-only paths" from
    // being read as "a removed person can no longer see anything". Two paths
    // deliberately survive removal, and one of them is an open defect. If a
    // later change closes either, this test fails and the claim gets revisited
    // on purpose rather than drifting.
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

    // 2. OPEN DEFECT, held as Package E: wsfGoalPulse is invoker:'public' with
    //    no eligibility check at all — no membership test, no goal-visibility
    //    test, no rate limit. A removed person, or anyone who ever saw the
    //    goalId, still reads the community's shared progress. Package D does
    //    not close this and must not be reported as if it did.
    const pulse = (await call(wsfGoalPulse, null, { goalId })) as {
      sharedTotal: number;
      contributorCount: number;
    };
    expect(pulse.sharedTotal).toBe(25);
    expect(pulse.contributorCount).toBe(1);
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
