/**
 * W8 — the social layer's privacy properties, pinned.
 *
 * These are the assertions that must fail the day somebody removes the care:
 * the DEFAULT is community-visible, an EXPLICIT choice is honoured and survives
 * leaving and being reinstated, a Champion cannot override it, the two settings
 * are independent, and no payload ever carries a uid, an email, an attempt id
 * or a second-level time.
 *
 * Runs against the Firestore emulator via `.run(request)`.
 */

process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  wsfCommunityActivity,
  wsfCommunityMembers,
  wsfMyCommunities,
  wsfSetCommunityVisibility,
} from '../../src/index';

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
}

type MembershipSeed = {
  status?: string;
  role?: string;
  /** Written ONLY when provided, so "absent" is a real, testable state. */
  nameVis?: string | null;
  activityVis?: string | null;
};

async function seedMember(
  groupId: string,
  uid: string,
  displayName: string | null,
  seedOpts: MembershipSeed = {}
): Promise<void> {
  const db = getFirestore();
  const row: Record<string, unknown> = {
    groupId,
    userId: uid,
    role: seedOpts.role ?? 'member',
    membershipStatus: seedOpts.status ?? 'active',
  };
  if (seedOpts.nameVis !== undefined && seedOpts.nameVis !== null) {
    row.communityNameVisibility = seedOpts.nameVis;
  }
  if (seedOpts.activityVis !== undefined && seedOpts.activityVis !== null) {
    row.communityActivityVisibility = seedOpts.activityVis;
  }
  await db.doc(`wsfMemberships/${groupId}_${uid}`).set(row);
  if (displayName !== null) {
    await db.doc(`wsfMemberProfiles/${uid}`).set({ displayName, adultConfirmation: true });
  }
}

async function seedGroup(groupId: string, displayName = 'Test Community'): Promise<void> {
  await getFirestore()
    .doc(`wsfCommunityGroups/${groupId}`)
    .set({ displayName, groupType: 'community', joinPolicy: 'code' });
}

async function seedContribution(
  groupId: string,
  goalId: string,
  uid: string,
  count: number,
  atMs: number
): Promise<void> {
  await getFirestore()
    .doc(`wsfContributions/${goalId}_${uid}_${uniq('att')}`)
    .set({
      goalId,
      attemptId: uniq('att'),
      userId: uid,
      count,
      shardIndex: 0,
      unit: 'squats',
      communityGroupId: groupId,
      crossedTarget: false,
      createdAt: Timestamp.fromMillis(atMs),
    });
}

function makeRequest(uid: string | null, data: Record<string, unknown> = {}): any {
  return {
    auth: uid ? ({ uid, token: { email_verified: true } as any } as any) : undefined,
    data: data as any,
    rawRequest: {} as any,
    acceptsStreaming: false,
  } as any;
}

async function run<T>(fn: { run: (r: any) => Promise<T> }, uid: string | null, data: any = {}) {
  try {
    return { ok: true as const, value: await fn.run(makeRequest(uid, data)) };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

describe('W8 · directory default and explicit privacy', () => {
  test('a membership with NO stored preference is community-visible', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    const other = uniq('uid');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');
    await seedMember(g, other, 'Dana Whitfield'); // no visibility field at all

    const res = await run(wsfCommunityMembers, me, { groupId: g });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const names = res.value.members.map((m) => m.displayName);
    expect(names).toContain('Dana Whitfield');
  });

  test('an explicit private choice removes the name but keeps the person a member', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    const shy = uniq('uid');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');
    await seedMember(g, shy, 'Hidden Person', { nameVis: 'private' });

    const res = await run(wsfCommunityMembers, me, { groupId: g });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.members.map((m) => m.displayName)).not.toContain('Hidden Person');

    // Still counted where counting happens: wsfMyCommunities counts ALL active
    // memberships and knows nothing about visibility.
    const mine = await run(wsfMyCommunities, me, {});
    expect(mine.ok).toBe(true);
    if (!mine.ok) return;
    const item = mine.value.items.find((i) => i.groupId === g);
    expect(item?.memberCount).toBe(2);
  });

  test('an UNRECOGNISED stored value resolves to private, never to visible', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    const odd = uniq('uid');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');
    // The setter cannot write this; an import or hand-edit could.
    await seedMember(g, odd, 'Imported Row', { nameVis: 'Visible' });

    const res = await run(wsfCommunityMembers, me, { groupId: g });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.members.map((m) => m.displayName)).not.toContain('Imported Row');
  });

  test('the directory payload carries no uid, email or timestamp', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');

    const res = await run(wsfCommunityMembers, me, { groupId: g });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    for (const m of res.value.members) {
      expect(Object.keys(m).sort()).toEqual(['displayName', 'role']);
    }
    // The whole serialised response must not contain the caller's uid.
    expect(JSON.stringify(res.value)).not.toContain(me);
  });

  test('a non-member and a signed-out caller are refused identically', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    const stranger = uniq('uid');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');

    const out = await run(wsfCommunityMembers, null, { groupId: g });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe('unauthenticated');

    const nonMember = await run(wsfCommunityMembers, stranger, { groupId: g });
    expect(nonMember.ok).toBe(false);
    if (nonMember.ok) return;
    expect(nonMember.error.code).toBe('permission-denied');

    // A community that does not exist must be refused with the SAME sentence,
    // or the pair becomes a way to enumerate real community ids.
    const noSuchGroup = await run(wsfCommunityMembers, stranger, { groupId: uniq('grp') });
    expect(noSuchGroup.ok).toBe(false);
    if (noSuchGroup.ok) return;
    expect(noSuchGroup.error.code).toBe(nonMember.error.code);
    expect(noSuchGroup.error.message).toBe(nonMember.error.message);
  });

  test('a removed member is not listed', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    const gone = uniq('uid');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');
    await seedMember(g, gone, 'Departed Person', { status: 'removed' });

    const res = await run(wsfCommunityMembers, me, { groupId: g });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.members.map((m) => m.displayName)).not.toContain('Departed Person');
  });
});

describe('W8 · the setter is self-only and literal', () => {
  test('a non-literal value is refused WITHOUT writing', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');

    for (const bad of [true, 1, 'Visible', ' visible', {}, ['visible'], null]) {
      const res = await run(wsfSetCommunityVisibility, me, { groupId: g, name: bad });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('invalid-argument');
    }
    const row = await getFirestore().doc(`wsfMemberships/${g}_${me}`).get();
    expect(row.data()?.communityNameVisibility).toBeUndefined();
  });

  test('there is no targetUid: a Champion cannot set anybody else', async () => {
    const g = uniq('grp');
    const champion = uniq('uid');
    const victim = uniq('uid');
    await seedGroup(g);
    await seedMember(g, champion, 'The Champion', { role: 'foundingChampion' });
    await seedMember(g, victim, 'Private Person', { nameVis: 'private' });

    // Even passing the shape the Champion family uses, the write lands on the
    // CALLER's own row and the victim's stays exactly as it was.
    const res = await run(wsfSetCommunityVisibility, champion, {
      groupId: g,
      targetUid: victim,
      name: 'visible',
    });
    expect(res.ok).toBe(true);

    const victimRow = await getFirestore().doc(`wsfMemberships/${g}_${victim}`).get();
    expect(victimRow.data()?.communityNameVisibility).toBe('private');

    const listed = await run(wsfCommunityMembers, champion, { groupId: g });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.members.map((m) => m.displayName)).not.toContain('Private Person');
  });

  test('the two settings are independent and the response is the settled value', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');

    const one = await run(wsfSetCommunityVisibility, me, { groupId: g, name: 'private' });
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    expect(one.value.name).toBe('private');
    // Untouched, and therefore still the default.
    expect(one.value.activity).toBe('visible');

    const two = await run(wsfSetCommunityVisibility, me, { groupId: g, activity: 'private' });
    expect(two.ok).toBe(true);
    if (!two.ok) return;
    expect(two.value.name).toBe('private'); // the earlier choice survives
    expect(two.value.activity).toBe('private');
  });

  test('an explicit choice survives leaving and Champion reinstatement', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');
    await run(wsfSetCommunityVisibility, me, { groupId: g, name: 'private' });

    const ref = getFirestore().doc(`wsfMemberships/${g}_${me}`);
    // Departure and reinstatement as the product writes them: merges that name
    // only the status. Nothing in this lane resets the preference, which is why
    // the choice is still here afterwards.
    await ref.set({ membershipStatus: 'departed' }, { merge: true });
    await ref.set({ membershipStatus: 'active' }, { merge: true });

    const row = await ref.get();
    expect(row.data()?.communityNameVisibility).toBe('private');

    const other = uniq('uid');
    await seedMember(g, other, 'Someone Else');
    const listed = await run(wsfCommunityMembers, other, { groupId: g });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.members.map((m) => m.displayName)).not.toContain('Me Myself');
  });

  test('wsfMyCommunities reports the caller their own settled preferences', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');

    const before = await run(wsfMyCommunities, me, {});
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    const b = before.value.items.find((i) => i.groupId === g);
    expect(b?.nameVisibility).toBe('visible');
    expect(b?.activityVisibility).toBe('visible');

    await run(wsfSetCommunityVisibility, me, { groupId: g, name: 'private' });
    const after = await run(wsfMyCommunities, me, {});
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.value.items.find((i) => i.groupId === g)?.nameVisibility).toBe('private');
  });
});

describe('W8 · the activity feed', () => {
  test('name-private + activity-visible keeps the row and drops the identity', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    const shy = uniq('uid');
    const goal = uniq('goal');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');
    await seedMember(g, shy, 'Shy Person', { nameVis: 'private' });
    await seedContribution(g, goal, shy, 25, Date.now() - 60_000);

    const res = await run(wsfCommunityActivity, me, { groupId: g });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.entries).toHaveLength(1);
    expect(res.value.entries[0]!.displayName).toBeNull();
    expect(res.value.entries[0]!.amount).toBe(25);
    expect(JSON.stringify(res.value)).not.toContain('Shy Person');
    expect(JSON.stringify(res.value)).not.toContain(shy);
  });

  test('activity-private omits the row entirely', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    const quiet = uniq('uid');
    const goal = uniq('goal');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');
    await seedMember(g, quiet, 'Quiet Person', { activityVis: 'private' });
    await seedContribution(g, goal, quiet, 40, Date.now() - 60_000);

    const res = await run(wsfCommunityActivity, me, { groupId: g });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.entries).toHaveLength(0);
  });

  test('a default contributor is NAMED, and the change is retroactive', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    const mover = uniq('uid');
    const goal = uniq('goal');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');
    await seedMember(g, mover, 'Marcus Reed');
    // Written long before any preference existed.
    await seedContribution(g, goal, mover, 20, Date.now() - 3_600_000);

    const named = await run(wsfCommunityActivity, me, { groupId: g });
    expect(named.ok).toBe(true);
    if (!named.ok) return;
    expect(named.value.entries[0]!.displayName).toBe('Marcus Reed');

    // The CURRENT preference governs OLD rows: no name is snapshotted into
    // contribution history, so opting out removes identity retroactively.
    await run(wsfSetCommunityVisibility, mover, { groupId: g, name: 'private' });
    const anon = await run(wsfCommunityActivity, me, { groupId: g });
    expect(anon.ok).toBe(true);
    if (!anon.ok) return;
    expect(anon.value.entries[0]!.displayName).toBeNull();
    expect(JSON.stringify(anon.value)).not.toContain('Marcus Reed');
  });

  test('the activity payload publishes no uid, attempt id, shard or seconds', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    const goal = uniq('goal');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');
    await seedContribution(g, goal, me, 10, Date.now() - 120_000);

    const res = await run(wsfCommunityActivity, me, { groupId: g });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const entry = res.value.entries[0]!;
    expect(Object.keys(entry).sort()).toEqual(['amount', 'at', 'displayName', 'unit']);
    /*
      MINUTE GRANULARITY, asserted as the PROPERTY rather than as a format.
      `isoMinute` keeps the full ISO shape and floors the time to the minute, so
      what must hold is that the seconds and milliseconds are always zero — no
      second-level information about when a person moved is ever published. An
      earlier version of this test asserted a shortened string instead and
      failed against correct code, which would have been a reason to loosen the
      product rather than the assertion.
    */
    expect(entry.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(\.000)?Z$/);
    expect(new Date(entry.at).getUTCSeconds()).toBe(0);
    expect(new Date(entry.at).getUTCMilliseconds()).toBe(0);
    const blob = JSON.stringify(res.value);
    expect(blob).not.toContain(me);
    expect(blob).not.toContain('shardIndex');
    expect(blob).not.toContain('attemptId');
  });

  test('a signed-out caller and a non-member cannot read the feed', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');

    expect((await run(wsfCommunityActivity, null, { groupId: g })).ok).toBe(false);
    expect((await run(wsfCommunityActivity, uniq('uid'), { groupId: g })).ok).toBe(false);
  });

  test('contributorsToday is null without a goal, and counts distinct movers with one', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    const a = uniq('uid');
    const goal = uniq('goal');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');
    await seedMember(g, a, 'Alpha Mover');
    const now = Date.now();
    // Two contributions from ONE person plus one from another: two movers.
    await seedContribution(g, goal, a, 10, now - 60_000);
    await seedContribution(g, goal, a, 10, now - 120_000);
    await seedContribution(g, goal, me, 5, now - 180_000);

    // A goal whose window is open and whose zone is real.
    await getFirestore()
      .doc(`wsfGoals/${goal}`)
      .set({
        communityGroupId: g,
        title: 'T',
        target: 100,
        unit: 'squats',
        status: 'active',
        ownerUid: me,
        timezone: 'America/New_York',
        startsAt: Timestamp.fromMillis(now - 86_400_000),
        endsAt: Timestamp.fromMillis(now + 86_400_000),
      });

    const withoutGoal = await run(wsfCommunityActivity, me, { groupId: g });
    expect(withoutGoal.ok).toBe(true);
    if (!withoutGoal.ok) return;
    // No goal named means no clock to compute "today" on, so nothing is claimed.
    expect(withoutGoal.value.contributorsToday).toBeNull();

    const withGoal = await run(wsfCommunityActivity, me, { groupId: g, goalId: goal });
    expect(withGoal.ok).toBe(true);
    if (!withGoal.ok) return;
    expect(withGoal.value.contributorsToday).toBe(2);
  });

  test('a goal with an unusable timezone yields null rather than another clock', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    const goal = uniq('goal');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');
    const now = Date.now();
    await seedContribution(g, goal, me, 5, now - 60_000);
    await getFirestore()
      .doc(`wsfGoals/${goal}`)
      .set({
        communityGroupId: g,
        title: 'T',
        target: 100,
        unit: 'squats',
        status: 'active',
        ownerUid: me,
        timezone: 'Not/AZone',
        startsAt: Timestamp.fromMillis(now - 86_400_000),
        endsAt: Timestamp.fromMillis(now + 86_400_000),
      });

    const res = await run(wsfCommunityActivity, me, { groupId: g, goalId: goal });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.contributorsToday).toBeNull();
  });

  test('a goal belonging to another community cannot be counted through this one', async () => {
    const g = uniq('grp');
    const otherGroup = uniq('grp');
    const me = uniq('uid');
    const goal = uniq('goal');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');
    const now = Date.now();
    await getFirestore()
      .doc(`wsfGoals/${goal}`)
      .set({
        communityGroupId: otherGroup,
        title: 'T',
        target: 100,
        unit: 'squats',
        status: 'active',
        ownerUid: me,
        timezone: 'America/New_York',
        startsAt: Timestamp.fromMillis(now - 86_400_000),
        endsAt: Timestamp.fromMillis(now + 86_400_000),
      });

    const res = await run(wsfCommunityActivity, me, { groupId: g, goalId: goal });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.contributorsToday).toBeNull();
  });

  test('a malformed cursor is refused, never a silent restart', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');

    for (const bad of ['!!!!', 'eyJvIjotMX0', 'x'.repeat(300)]) {
      const res = await run(wsfCommunityActivity, me, { groupId: g, cursor: bad });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('invalid-argument');
    }
  });

  test('a contributor who has left the community is never named', async () => {
    const g = uniq('grp');
    const me = uniq('uid');
    const gone = uniq('uid');
    const goal = uniq('goal');
    await seedGroup(g);
    await seedMember(g, me, 'Me Myself');
    await seedMember(g, gone, 'Departed Mover', { status: 'departed' });
    await seedContribution(g, goal, gone, 30, Date.now() - 60_000);

    const res = await run(wsfCommunityActivity, me, { groupId: g });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Their effort stays in the shared total; their identity does not come back
    // through the feed.
    expect(JSON.stringify(res.value)).not.toContain('Departed Mover');
  });
});
