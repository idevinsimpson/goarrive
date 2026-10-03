/**
 * wsfMyMemberSnapshot — MEMBER-SNAPSHOT-1 Phase A (Director #447 `5843367693`,
 * personal-first `5841625866`, indexed decision `5846469655`).
 *
 * Pins:
 *   1. Anonymous is refused; the subject is request.auth.uid and no request
 *      field (bogus uid / groupIds) widens the answer.
 *   2. Two active communities with owned goals in both: exact own and shared
 *      figures per goal; schemaVersion 1; the recursive key set is exactly
 *      the contract's.
 *   3. Member B never receives member A's ownCredit.
 *   4. A departed membership is excluded, with its goals.
 *   5. Unknown is never 0: an active goal with no own row is a CHECKED 0; a
 *      malformed own row is null; a failed shard read is null; a failed
 *      goal-section read is partial, never zeros.
 *   6. Caps set `truncated`; the own-rows page carries a cursor that resumes
 *      exactly after itself; a forged cursor is refused.
 *   7. Read-count / response-size receipt for the Director's fixtures.
 *
 * INDEX: the own-rows query needs wsfGoalMemberTotals(userId ASC, updatedAt
 * DESC). The emulator does not enforce composite indexes, so nothing here can
 * prove it exists; the dependency is recorded in the receipt, not tested.
 *
 * Runs against the Firestore emulator via `.run(request)`.
 */

process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { randomBytes } from 'crypto';
import { Firestore, Query } from '@google-cloud/firestore';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';
import { wsfMyMemberSnapshot } from '../../src/index';

type Goal = Record<string, unknown> & { goalId: string; sharedTotal: number | null; ownCredit: number | null };
type Community = Record<string, unknown> & { groupId: string; goals: Goal[] | null; partial: boolean; memberCount: number | null };
type Snapshot = {
  schemaVersion: number;
  communities: Community[];
  truncated: { communities: boolean; goals: boolean };
  nextCursor: string | null;
};

const TOP_KEYS = ['communities', 'nextCursor', 'schemaVersion', 'truncated'];
const COMMUNITY_KEYS = ['displayName', 'goals', 'groupId', 'groupType', 'isSample', 'memberCount', 'partial', 'role'];
const GOAL_KEYS = ['endsAt', 'goalId', 'ownCredit', 'sharedTotal', 'startsAt', 'status', 'target', 'timezone', 'title', 'unit'];
const GOAL_OPTIONAL = ['closedAt', 'reachedAt'];

const tag = () => randomBytes(5).toString('hex');
const DAY = 86_400_000;

async function seedGroup(name: string): Promise<string> {
  const ref = getFirestore().collection('wsfCommunityGroups').doc(`snap-${tag()}`);
  await ref.set({
    displayName: name,
    groupType: 'custom',
    joinPolicy: 'private',
    joinCode: `JC${tag()}`,
    lifecycleStatus: 'active',
    isSample: false,
    createdByUserId: 'someone-else',
  });
  return ref.id;
}

async function seedMember(groupId: string, uid: string, membershipStatus = 'active', role = 'member') {
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role,
    membershipStatus,
    // Fields the snapshot must never echo.
    nameVisibility: 'private',
    email: 'never@example.com',
  });
}

async function seedGoal(
  groupId: string,
  opts: { status?: 'active' | 'closed'; total?: number; endsInDays?: number; reached?: boolean; title?: string } = {}
): Promise<string> {
  const db = getFirestore();
  const ref = db.collection('wsfGoals').doc(`g-${tag()}`);
  const now = Date.now();
  const doc: Record<string, unknown> = {
    ownerUid: 'champion-uid',
    communityGroupId: groupId,
    title: opts.title ?? `Goal ${ref.id}`,
    target: 500,
    unit: 'squats',
    status: opts.status ?? 'active',
    startsAt: Timestamp.fromMillis(now - 7 * DAY),
    endsAt: Timestamp.fromMillis(now + (opts.endsInDays ?? 7) * DAY),
    timezone: 'America/New_York',
    aggregateDisplayAuthorized: true,
    reachedAttemptId: null,
  };
  if (opts.status === 'closed') doc.closedAt = Timestamp.fromMillis(now - DAY);
  if (opts.reached) doc.reachedAt = Timestamp.fromMillis(now - 2 * DAY);
  await ref.set(doc);
  if (opts.total) await db.doc(`wsfGoalCounters/${ref.id}/shards/3`).set({ count: opts.total });
  return ref.id;
}

async function seedOwn(goalId: string, uid: string, total: unknown, updatedAtMs: number) {
  await getFirestore().doc(`wsfGoalMemberTotals/${goalId}_${uid}`).set({
    goalId,
    userId: uid,
    total,
    contributionCount: 1,
    updatedAt: Timestamp.fromMillis(updatedAtMs),
  });
}

function call(uid: string | null, data: unknown = {}): Promise<Snapshot> {
  const request = { data, auth: uid ? { uid, token: {} } : undefined, rawRequest: {} } as never;
  return (wsfMyMemberSnapshot as unknown as { run: (r: never) => Promise<Snapshot> }).run(request);
}

async function expectRefused(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toThrow(HttpsError);
  await promise.catch((e: HttpsError) => expect(e.code).toBe(code));
}

/** Every key at every level is exactly the contract's. */
function expectAllowlisted(s: Snapshot) {
  expect(Object.keys(s).sort()).toEqual(TOP_KEYS);
  expect(Object.keys(s.truncated).sort()).toEqual(['communities', 'goals']);
  for (const c of s.communities) {
    expect(Object.keys(c).sort()).toEqual(COMMUNITY_KEYS);
    for (const g of c.goals ?? []) {
      const keys = Object.keys(g).sort();
      const required = keys.filter((k) => !GOAL_OPTIONAL.includes(k));
      expect(required).toEqual(GOAL_KEYS);
    }
  }
  expect(JSON.stringify(s)).not.toMatch(/never@example\.com|nameVisibility|joinCode|champion-uid|someone-else/);
}

const goalsOf = (s: Snapshot) => s.communities.flatMap((c) => c.goals ?? []);
const byId = (s: Snapshot) => new Map(goalsOf(s).map((g) => [g.goalId, g]));

// ── read counter: descriptive receipt, not a pass/fail budget ────────────────
type Reads = { rpcs: number; docs: number };
function countReads(): { reads: Reads; restore: () => void } {
  const reads: Reads = { rpcs: 0, docs: 0 };
  const getAll = jest.spyOn(Firestore.prototype, 'getAll').mockImplementation(async function (
    this: Firestore,
    ...args: unknown[]
  ) {
    reads.rpcs += 1;
    const out = await origGetAll.apply(this, args as never);
    reads.docs += out.length;
    return out;
  } as never);
  const get = jest.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query) {
    reads.rpcs += 1;
    const out = await origQueryGet.apply(this);
    reads.docs += Math.max(out.size, 1); // an empty query still bills one read
    return out;
  } as never);
  const count = jest.spyOn(Query.prototype, 'count').mockImplementation(function (this: Query) {
    const agg = origCount.apply(this);
    const aggGet = agg.get.bind(agg);
    (agg as { get: unknown }).get = async () => {
      reads.rpcs += 1;
      reads.docs += 1;
      return aggGet();
    };
    return agg;
  } as never);
  return {
    reads,
    restore: () => {
      getAll.mockRestore();
      get.mockRestore();
      count.mockRestore();
    },
  };
}
const origGetAll = Firestore.prototype.getAll;
const origQueryGet = Query.prototype.get;
const origCount = Query.prototype.count;

describe('wsfMyMemberSnapshot', () => {
  it('refuses anonymous callers', async () => {
    await expectRefused(call(null), 'unauthenticated');
  });

  it('two active communities: exact own and shared per goal, allowlisted, version 1, request fields ignored', async () => {
    const uid = `snap-a-${tag()}`;
    const oak = await seedGroup('Oak Grove Together');
    const harbor = await seedGroup('Harbor Lunch Crew');
    await seedMember(oak, uid);
    await seedMember(harbor, uid, 'active', 'foundingChampion');
    const now = Date.now();
    const oakOpen = await seedGoal(oak, { total: 241 });
    const oakClosed = await seedGoal(oak, { status: 'closed', total: 1024, reached: true, endsInDays: -3 });
    const harborOpen = await seedGoal(harbor, { total: 90 });
    await seedOwn(oakOpen, uid, 35, now - 1000);
    await seedOwn(oakClosed, uid, 120, now - 5 * DAY);
    await seedOwn(harborOpen, uid, 12, now - 2000);

    // An outsider group the request names must not appear.
    const other = await seedGroup('Not Mine');
    const s = await call(uid, { uid: 'someone-else', groupIds: [other], userId: 'x' });
    expect(s.schemaVersion).toBe(1);
    expectAllowlisted(s);
    expect(s.communities.map((c) => c.displayName)).toEqual(['Harbor Lunch Crew', 'Oak Grove Together']);
    expect(s.communities.find((c) => c.groupId === harbor)!.role).toBe('foundingChampion');
    const g = byId(s);
    expect(g.get(oakOpen)).toMatchObject({ sharedTotal: 241, ownCredit: 35, status: 'active' });
    expect(g.get(oakClosed)).toMatchObject({ sharedTotal: 1024, ownCredit: 120, status: 'closed' });
    expect(typeof g.get(oakClosed)!.reachedAt).toBe('string');
    expect(typeof g.get(oakClosed)!.closedAt).toBe('string');
    expect(g.get(oakOpen)).not.toHaveProperty('reachedAt');
    expect(g.get(harborOpen)).toMatchObject({ sharedTotal: 90, ownCredit: 12 });
    expect(s.communities.every((c) => c.partial === false)).toBe(true);
    expect(s.communities.find((c) => c.groupId === oak)!.memberCount).toBe(1);
    expect(s.communities.some((c) => c.groupId === other)).toBe(false);
    expect(s.truncated).toEqual({ communities: false, goals: false });
    expect(s.nextCursor).toBeNull();
  });

  it('member B never receives member A’s ownCredit; an active goal with no own row is a checked 0', async () => {
    const a = `snap-a-${tag()}`;
    const b = `snap-b-${tag()}`;
    const oak = await seedGroup('Shared Oak');
    await seedMember(oak, a);
    await seedMember(oak, b);
    const goal = await seedGoal(oak, { total: 300 });
    await seedOwn(goal, a, 77, Date.now());

    const sa = await call(a);
    const sb = await call(b);
    expect(byId(sa).get(goal)).toMatchObject({ ownCredit: 77, sharedTotal: 300 });
    expect(byId(sb).get(goal)).toMatchObject({ ownCredit: 0, sharedTotal: 300 });
    expect(JSON.stringify(sb)).not.toContain(a);
    expect(JSON.stringify(sb)).not.toMatch(/\b77\b/);
  });

  it('excludes a departed membership and its goals, even with an own row', async () => {
    const uid = `snap-d-${tag()}`;
    const left = await seedGroup('Left Behind');
    const stay = await seedGroup('Still Here');
    await seedMember(left, uid, 'removed');
    await seedMember(stay, uid);
    const leftGoal = await seedGoal(left, { total: 50 });
    const stayGoal = await seedGoal(stay, { total: 60 });
    await seedOwn(leftGoal, uid, 9, Date.now());
    await seedOwn(stayGoal, uid, 4, Date.now() - 10);

    const s = await call(uid);
    expect(s.communities.map((c) => c.groupId)).toEqual([stay]);
    expect(byId(s).has(leftGoal)).toBe(false);
    expect(byId(s).get(stayGoal)).toMatchObject({ ownCredit: 4 });
  });

  it('a malformed own row is unknown (null), never 0', async () => {
    const uid = `snap-m-${tag()}`;
    const g1 = await seedGroup('Malformed');
    await seedMember(g1, uid);
    const bad = await seedGoal(g1, { total: 10 });
    const neg = await seedGoal(g1, { total: 10 });
    await seedOwn(bad, uid, 'lots', Date.now());
    await seedOwn(neg, uid, -3, Date.now() - 5);
    const s = await call(uid);
    expect(byId(s).get(bad)!.ownCredit).toBeNull();
    expect(byId(s).get(neg)!.ownCredit).toBeNull();
  });

  it('a failed shard read is null, and a failed goal-section read is partial, never zeros', async () => {
    const uid = `snap-f-${tag()}`;
    const g1 = await seedGroup('Failing');
    await seedMember(g1, uid);
    const owned = await seedGoal(g1, { total: 40 });
    await seedOwn(owned, uid, 8, Date.now());

    const spy = jest.spyOn(Firestore.prototype, 'getAll').mockImplementation(async function (
      this: Firestore,
      ...refs: Array<{ path: string }>
    ) {
      if (refs.some((r) => r.path.startsWith('wsfGoalCounters/'))) throw new Error('injected shard failure');
      return origGetAll.apply(this, refs as never);
    } as never);
    try {
      const s = await call(uid);
      const g = byId(s).get(owned)!;
      expect(g.sharedTotal).toBeNull();
      expect(g.ownCredit).toBe(8);
    } finally {
      spy.mockRestore();
    }

    const q = jest.spyOn(Query.prototype, 'get').mockImplementation(async function (this: Query) {
      const collection = (this as unknown as { _queryOptions: { collectionId: string } })._queryOptions.collectionId;
      if (collection === 'wsfGoalMemberTotals' || collection === 'wsfGoals') throw new Error('injected goal failure');
      return origQueryGet.apply(this);
    } as never);
    try {
      const s = await call(uid);
      const c = s.communities[0]!;
      expect(c.partial).toBe(true);
      expect(c.goals).toBeNull();
      expect(JSON.stringify(s)).not.toMatch(/"sharedTotal":0|"ownCredit":0/);
    } finally {
      q.mockRestore();
    }
  });

  it('caps communities at 20 with truncated.communities', async () => {
    const uid = `snap-c-${tag()}`;
    for (let i = 0; i < 21; i += 1) await seedMember(await seedGroup(`Cap ${String(i).padStart(2, '0')}`), uid);
    const s = await call(uid);
    expect(s.communities).toHaveLength(20);
    expect(s.truncated.communities).toBe(true);
    expect(s.communities[19]!.displayName).toBe('Cap 19');
  });

  it('pages own rows newest first; the cursor resumes exactly after the page; forged cursors are refused', async () => {
    const uid = `snap-p-${tag()}`;
    const other = `snap-q-${tag()}`;
    const g1 = await seedGroup('Pager');
    await seedMember(g1, uid);
    await seedMember(g1, other);
    const base = Date.now() - 100_000;
    const ids: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      const id = await seedGoal(g1, { status: 'closed', total: i + 1, endsInDays: -i - 1 });
      await seedOwn(id, uid, i + 1, base + i * 1000);
      ids.push(id);
    }
    // Another member's rows are never paged into this caller's answer.
    const theirs = await seedGoal(g1, { status: 'closed', total: 5, endsInDays: -1 });
    await seedOwn(theirs, other, 5, Date.now());

    const p1 = await call(uid);
    const first = goalsOf(p1).map((g) => g.goalId);
    expect(first).toEqual(ids.slice(5).reverse()); // 25 newest, newest first
    expect(p1.truncated.goals).toBe(true);
    expect(typeof p1.nextCursor).toBe('string');

    const p2 = await call(uid, { cursor: p1.nextCursor });
    const second = goalsOf(p2).map((g) => g.goalId);
    expect(second).toEqual(ids.slice(0, 5).reverse());
    expect(p2.nextCursor).toBeNull();
    expect(new Set([...first, ...second]).size).toBe(30);
    expect([...first, ...second]).not.toContain(theirs);

    for (const bad of ['%%%', 'x'.repeat(401), 42, Buffer.from('{"t":-1,"id":"a"}').toString('base64url'), Buffer.from('{"t":1,"id":"a/b"}').toString('base64url')]) {
      await expectRefused(call(uid, { cursor: bad }), 'invalid-argument');
    }
  });

  it('loses no row that shares a millisecond across the page boundary (W5 F1: exact timestamps)', async () => {
    const uid = `snap-u-${tag()}`;
    const g1 = await seedGroup('Sub-millisecond');
    await seedMember(g1, uid);
    const baseSec = Math.floor(Date.now() / 1000) - 3600;
    const ids: string[] = [];
    for (let i = 0; i < 30; i += 1) {
      const id = await seedGoal(g1, { status: 'closed', total: 1, endsInDays: -2 });
      // Rows 0-9 inside ONE millisecond, a microsecond apart, exactly as
      // production server timestamps can be; rows 10-29 a second apart and
      // newer. The 25th-newest row (row 5) is inside that millisecond, so
      // the page boundary splits it.
      const ts = i < 10 ? new Timestamp(baseSec, 500_000_000 + i * 1000) : new Timestamp(baseSec + i, 0);
      await getFirestore().doc(`wsfGoalMemberTotals/${id}_${uid}`).set({ goalId: id, userId: uid, total: 1, updatedAt: ts });
      ids.push(id);
    }
    const p1 = await call(uid);
    const p2 = await call(uid, { cursor: p1.nextCursor });
    const all = [...goalsOf(p1), ...goalsOf(p2)].map((g) => g.goalId);
    expect(goalsOf(p1)).toHaveLength(25);
    expect(goalsOf(p2)).toHaveLength(5);
    expect(new Set(all).size).toBe(30);
    expect([...all].sort()).toEqual([...ids].sort());
    expect(p2.nextCursor).toBeNull();
  });

  it('refuses cursor instants outside Firestore’s range with invalid-argument, never internal (W5 F2)', async () => {
    const uid = `snap-v-${tag()}`;
    const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    for (const bad of [
      enc({ s: 9007199254740991, n: 0, id: 'a' }),
      enc({ s: 253402300800, n: 0, id: 'a' }),
      enc({ s: -62135596801, n: 0, id: 'a' }),
      enc({ s: 1, n: 1_000_000_000, id: 'a' }),
      enc({ s: 1, n: 1.5, id: 'a' }),
      enc({ t: 1, id: 'a' }),
      enc({ t: 9007199254740991, id: 'a' }),
    ]) {
      await expectRefused(call(uid, { cursor: bad }), 'invalid-argument');
    }
  });

  it('never exceeds 35 goals per community or 50 in total, and says so', async () => {
    const uid = `snap-t-${tag()}`;
    const groups: string[] = [];
    for (let i = 0; i < 20; i += 1) {
      const g = await seedGroup(`Total ${String(i).padStart(2, '0')}`);
      await seedMember(g, uid);
      groups.push(g);
      for (let j = 0; j < 4; j += 1) await seedGoal(g, { total: 1 });
    }
    const s = await call(uid);
    const n = goalsOf(s).length;
    expect(n).toBeLessThanOrEqual(50);
    expect(s.communities.every((c) => (c.goals ?? []).length <= 35)).toBe(true);
    expect(s.truncated.goals).toBe(true);
  }, 120_000);

  it('receipt: first-page reads and response bytes for the Director fixtures', async () => {
    async function fixture(communities: number, activePer: number, owned: number) {
      const uid = `snap-r-${tag()}`;
      const gs: string[] = [];
      for (let i = 0; i < communities; i += 1) {
        const g = await seedGroup(`Receipt ${i}`);
        await seedMember(g, uid);
        gs.push(g);
      }
      const activeIds: string[] = [];
      for (let i = 0; i < communities * activePer; i += 1) activeIds.push(await seedGoal(gs[i % communities]!, { total: 3 }));
      for (let i = 0; i < owned; i += 1) {
        const id = i < activeIds.length ? activeIds[i]! : await seedGoal(gs[i % communities]!, { status: 'closed', total: 2, endsInDays: -2 });
        await seedOwn(id, uid, 1, Date.now() - i * 1000);
      }
      const { reads, restore } = countReads();
      let s: Snapshot;
      try {
        s = await call(uid);
      } finally {
        restore();
      }
      return { communities, activePer, owned, goals: goalsOf(s!).length, ...reads, bytes: JSON.stringify(s!).length };
    }
    const rows = [await fixture(1, 2, 2), await fixture(5, 2, 12), await fixture(20, 4, 25)];
    // eslint-disable-next-line no-console
    console.log(`SNAPSHOT RECEIPT ${JSON.stringify(rows)}`);
    for (const r of rows) expect(r.goals).toBeGreaterThan(0);
  }, 180_000);
});
