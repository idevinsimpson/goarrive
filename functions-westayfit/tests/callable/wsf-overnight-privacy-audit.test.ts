/**
 * Overnight 2026-09-18, Task 2 — adversarial probes against the public
 * wsfGoalPulse boundary and the Champion authorization control.
 *
 * Every case here tries to obtain shared state, context, or an existence
 * signal through a path the approved model does not open: malformed ids,
 * non-active membership rows, a warmed cache on a neighbouring goal, a goal
 * whose community reference dangles, extra fields on the underlying documents,
 * and the authorization control used as an oracle. The approved contract is
 * exactly nine fields for an entitled caller and one generic not-found for
 * everyone else.
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

const APPROVED_PUBLIC_FIELDS = [
  'communityDisplayName',
  'endsAt',
  'goalTitle',
  'sharedTotal',
  'startsAt',
  'status',
  'target',
  'timezone',
  'unit',
];

function call(fn: unknown, uid: string | null, data: unknown) {
  return (fn as { run: (r: never) => Promise<never> }).run({
    data,
    auth: uid ? { uid, token: { email_verified: true } } : undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
  } as never);
}

async function attempt<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: HttpsError }> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: e as HttpsError };
  }
}

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

async function seedCommunity(championUid: string, extra: Data = {}): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('auditGroup');
  await db.doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'Audit community',
    groupType: 'custom',
    joinPolicy: 'private',
    joinCode: uniq('code'),
    createdByUserId: championUid,
    lifecycleStatus: 'active',
    isSample: false,
    ...extra,
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

async function seedMembership(groupId: string, uid: string, row: Data): Promise<void> {
  await getFirestore()
    .doc(`wsfMemberships/${groupId}_${uid}`)
    .set({ groupId, userId: uid, role: 'member', ...row });
}

async function seedGoal(groupId: unknown, opts: { authorized?: boolean; extra?: Data } = {}): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  const doc: Data = {
    ownerUid: 'auditSeed',
    communityGroupId: groupId,
    title: 'Audit goal',
    target: 500,
    unit: 'squats',
    status: 'active',
    startsAt: Timestamp.fromMillis(now - 60_000),
    endsAt: Timestamp.fromMillis(now + 3_600_000),
    timezone: 'America/New_York',
    ...(opts.extra ?? {}),
  };
  if (opts.authorized === true) doc.aggregateDisplayAuthorized = true;
  await ref.set(doc);
  return ref.id;
}

async function seedShard(goalId: string, count: number): Promise<void> {
  await getFirestore().doc(`wsfGoalCounters/${goalId}/shards/0`).set({ count }, { merge: true });
}

function expectGenericRefusal(r: { ok: boolean; error?: HttpsError }) {
  expect(r.ok).toBe(false);
  expect((r as { error: HttpsError }).error.code).toBe('not-found');
}

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-overnight-privacy-audit').set({ at: Date.now() }, { merge: true });
});

describe('route-parameter trust: a malformed goalId never reaches a lookup', () => {
  const malformed: [string, unknown][] = [
    ['object', { $ne: null }],
    ['array', ['goal']],
    ['number', 12345],
    ['boolean', true],
    ['empty', ''],
    ['whitespace', '   '],
    ['path segment', 'goals/other'],
    ['dot traversal', '../wsfGoals'],
    ['inner space', 'goal id'],
    ['129 chars', 'a'.repeat(129)],
    ['non-ASCII', 'цель'],
    ['NUL byte', 'goal' + String.fromCharCode(0) + 'id'],
  ];
  test.each(malformed)('%s -> invalid-argument, anonymously and as a member', async (_label, goalId) => {
    const anon = await attempt(call(wsfGoalPulse, null, { goalId }));
    expect(anon.ok).toBe(false);
    expect((anon as { error: HttpsError }).error.code).toBe('invalid-argument');
    const signedIn = await attempt(call(wsfGoalPulse, uniq('stranger'), { goalId }));
    expect(signedIn.ok).toBe(false);
    expect((signedIn as { error: HttpsError }).error.code).toBe('invalid-argument');
  });

  test('extra request fields cannot vouch for the caller', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity(champion);
    const goalId = await seedGoal(groupId);
    const r = await attempt(
      call(wsfGoalPulse, null, {
        goalId,
        uid: champion,
        callerUid: champion,
        auth: { uid: champion },
        aggregateDisplayAuthorized: true,
        asMember: true,
      })
    );
    expectGenericRefusal(r);
  });
});

describe('membership: only an ACTIVE row opens the member route', () => {
  const rows: [string, Data][] = [
    ['pending', { membershipStatus: 'pending' }],
    ['removed', { membershipStatus: 'removed' }],
    ['left', { membershipStatus: 'left' }],
    ['invited', { membershipStatus: 'invited' }],
    ['empty status', { membershipStatus: '' }],
    ['no status field', {}],
    ['boolean true status', { membershipStatus: true }],
    ['Active (case)', { membershipStatus: 'Active' }],
  ];
  test.each(rows)('%s -> refused exactly like an unknown goal', async (_label, row) => {
    const champion = uniq('champ');
    const groupId = await seedCommunity(champion);
    const goalId = await seedGoal(groupId);
    const uid = uniq('m');
    await seedMembership(groupId, uid, row);
    const r = await attempt(call(wsfGoalPulse, uid, { goalId }));
    expectGenericRefusal(r);
    const unknown = await attempt(call(wsfGoalPulse, uid, { goalId: uniq('nope') }));
    expect((unknown as { error: HttpsError }).error.message).toBe((r as { error: HttpsError }).error.message);
  });

  test('an active membership in a DIFFERENT community is not membership here', async () => {
    const champA = uniq('champA');
    const champB = uniq('champB');
    const groupA = await seedCommunity(champA);
    const groupB = await seedCommunity(champB);
    const goalB = await seedGoal(groupB);
    const memberOfA = uniq('mA');
    await seedMembership(groupA, memberOfA, { membershipStatus: 'active' });
    expectGenericRefusal(await attempt(call(wsfGoalPulse, memberOfA, { goalId: goalB })));
    // A membership row keyed on the right community but written for another
    // user id is not this caller's either.
    const impostor = uniq('imp');
    await seedMembership(groupB, uniq('someoneElse'), { membershipStatus: 'active', userId: impostor });
    expectGenericRefusal(await attempt(call(wsfGoalPulse, impostor, { goalId: goalB })));
  });
});

describe('the cache is per goal and per decision, never a side door', () => {
  test('a warmed authorized goal does not warm its unauthorized neighbour', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity(champion);
    const authorized = await seedGoal(groupId, { authorized: true });
    const neighbour = await seedGoal(groupId);
    await seedShard(authorized, 41);
    await seedShard(neighbour, 77);
    const warm = await attempt(call(wsfGoalPulse, null, { goalId: authorized }));
    expect(warm.ok).toBe(true);
    expect((warm as { value: Data }).value.sharedTotal).toBe(41);
    expectGenericRefusal(await attempt(call(wsfGoalPulse, null, { goalId: neighbour })));
    // Revoke inside the 2 s TTL: the warmed entry must not answer for the
    // authorized goal either, and the neighbour stays refused.
    await call(wsfSetGoalDisplayAuthorization, champion, { goalId: authorized, authorized: false });
    expectGenericRefusal(await attempt(call(wsfGoalPulse, null, { goalId: authorized })));
    expectGenericRefusal(await attempt(call(wsfGoalPulse, null, { goalId: neighbour })));
    // The member route is unaffected by the display decision in both directions.
    const member = uniq('m');
    await seedMembership(groupId, member, { membershipStatus: 'active' });
    expect((await attempt(call(wsfGoalPulse, member, { goalId: authorized }))).ok).toBe(true);
    expect((await attempt(call(wsfGoalPulse, member, { goalId: neighbour }))).ok).toBe(true);
  });

  test('a member-warmed entry on a SAMPLE community never serves the display', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity(champion, { isSample: true });
    const goalId = await seedGoal(groupId, { authorized: true });
    await seedShard(goalId, 9);
    const asMember = await attempt(call(wsfGoalPulse, champion, { goalId }));
    expect(asMember.ok).toBe(true);
    expect((asMember as { value: Data }).value.sharedTotal).toBe(9);
    // Immediately, well inside the TTL.
    expectGenericRefusal(await attempt(call(wsfGoalPulse, null, { goalId })));
    expectGenericRefusal(await attempt(call(wsfGoalPulse, uniq('stranger'), { goalId })));
  });

  test('a membership removed between two polls is refused on the second, inside the TTL', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity(champion);
    const goalId = await seedGoal(groupId);
    const member = uniq('m');
    await seedMembership(groupId, member, { membershipStatus: 'active' });
    expect((await attempt(call(wsfGoalPulse, member, { goalId }))).ok).toBe(true);
    await getFirestore()
      .doc(`wsfMemberships/${groupId}_${member}`)
      .set({ membershipStatus: 'removed' }, { merge: true });
    expectGenericRefusal(await attempt(call(wsfGoalPulse, member, { goalId })));
  });
});

describe('an authorized goal whose community reference is unusable is refused, not half-published', () => {
  const refs: [string, unknown][] = [
    ['dangling id', 'group_that_does_not_exist'],
    ['empty string', ''],
    ['number', 42],
    ['object', { id: 'x' }],
    ['null', null],
  ];
  test.each(refs)('communityGroupId = %s', async (_label, ref) => {
    const goalId = await seedGoal(ref, { authorized: true });
    const r = await attempt(call(wsfGoalPulse, null, { goalId }));
    expect(r.ok).toBe(false);
    // A generic refusal — never `internal`, which would say "this goal exists
    // and something about it is broken".
    expect((r as { error: HttpsError }).error.code).toBe('not-found');
  });
});

describe('the Champion control is not an existence oracle', () => {
  test('unknown goal, another community’s goal, and another community’s AUTHORIZED goal refuse identically', async () => {
    const champX = uniq('champX');
    const champY = uniq('champY');
    await seedCommunity(champX);
    const groupY = await seedCommunity(champY);
    const goalY = await seedGoal(groupY);
    const goalYAuthorized = await seedGoal(groupY, { authorized: true });

    const unknown = await attempt(
      call(wsfSetGoalDisplayAuthorization, champX, { goalId: uniq('nope'), authorized: true })
    );
    const foreign = await attempt(call(wsfSetGoalDisplayAuthorization, champX, { goalId: goalY, authorized: true }));
    const foreignRevoke = await attempt(
      call(wsfSetGoalDisplayAuthorization, champX, { goalId: goalYAuthorized, authorized: false })
    );
    for (const r of [unknown, foreign, foreignRevoke]) {
      expect(r.ok).toBe(false);
      expect((r as { error: HttpsError }).error.code).toBe('not-found');
    }
    const msgs = new Set(
      [unknown, foreign, foreignRevoke].map((r) => (r as { error: HttpsError }).error.message)
    );
    expect(msgs.size).toBe(1);

    // Nothing moved: Y's goals keep their own decisions.
    const yDoc = (await getFirestore().doc(`wsfGoals/${goalY}`).get()).data() as Data;
    expect('aggregateDisplayAuthorized' in yDoc).toBe(false);
    const yAuthDoc = (await getFirestore().doc(`wsfGoals/${goalYAuthorized}`).get()).data() as Data;
    expect(yAuthDoc.aggregateDisplayAuthorized).toBe(true);
    expect((await attempt(call(wsfGoalPulse, null, { goalId: goalYAuthorized }))).ok).toBe(true);
  });

  test('a member with any non-founding role still cannot authorize', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity(champion);
    const goalId = await seedGoal(groupId);
    for (const role of ['admin', 'champion', 'FoundingChampion', 'owner']) {
      const uid = uniq('r');
      await seedMembership(groupId, uid, { membershipStatus: 'active', role });
      const r = await attempt(call(wsfSetGoalDisplayAuthorization, uid, { goalId, authorized: true }));
      expect(r.ok).toBe(false);
      expect((r as { error: HttpsError }).error.code).toBe('not-found');
    }
    expectGenericRefusal(await attempt(call(wsfGoalPulse, null, { goalId })));
  });
});

describe('unapproved document fields never travel', () => {
  test('sensitive fields on the community and goal documents are absent from the nine-field response', async () => {
    const champion = uniq('champ');
    const groupId = await seedCommunity(champion, {
      joinCode: 'SECRETJOIN',
      // Values that cannot occur in the response by accident: a two-digit
      // count collides with the clock (the nine-field response carries ISO
      // timestamps, and '17' matched one at 15:17 UTC), so the needles below
      // are strings no timestamp, count or id can contain.
      memberCount: 9040171,
      contributorCount: 9,
      ownerEmail: 'owner@example.com',
      location: 'Maple Street',
      inviteLink: 'https://example.com/invite',
    });
    const goalId = await seedGoal(groupId, {
      authorized: true,
      extra: {
        contributorCount: 6,
        contributorUids: [champion, 'someone'],
        notes: 'internal note',
        ownerEmail: 'goalowner@example.com',
        createdByDisplayName: 'Devin',
      },
    });
    await seedShard(goalId, 123);
    const r = await attempt(call(wsfGoalPulse, null, { goalId }));
    expect(r.ok).toBe(true);
    const value = (r as { value: Data }).value;
    expect(Object.keys(value).sort()).toEqual(APPROVED_PUBLIC_FIELDS);
    const json = JSON.stringify(value);
    for (const needle of [
      'SECRETJOIN',
      '9040171',
      'owner@example.com',
      'Maple Street',
      'invite',
      'internal note',
      'Devin',
      champion,
      'someone',
      groupId,
    ]) {
      expect(json.includes(needle)).toBe(false);
    }
    expect(value.sharedTotal).toBe(123);
  });
});
