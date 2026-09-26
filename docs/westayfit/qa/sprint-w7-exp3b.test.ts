/**
 * W7 · Check 26 — EXP3A's private "My entries" read at `80615cae`, proved by
 * W7's own instrument (own seeding through the real enable / close / freeze
 * transitions, raw reads, every lane document compared byte-for-byte
 * including updateTime). `@exp1/*` resolves to the worktree chosen by
 * W7_EXP1_WT.
 *
 * D2 is the Director's full stored-pool integrity boundary: each malformed
 * pool is written WITH ITS DIGEST RECOMPUTED and the promotion's stamped
 * digest updated to match, so only structural validation can refuse it. The
 * expectation written there is the Director's ("must not yield a member
 * count"); a failure records the exact pool shape that yields one.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

import { wsfContribute } from '@exp1/index';
import {
  closePromotion,
  configDigest,
  enablePromotion,
  freezePromotion,
  ingestContribution,
  poolDigest,
  readMyEntries,
  validatePromotionConfig,
  type PoolRecord,
  type ReceiptTrace,
} from '@exp1/expo-prize';

const db = () => getFirestore();
const uniq = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

async function call(fn: unknown, uid: string, data: Record<string, unknown>): Promise<unknown> {
  return (fn as { run: (req: unknown) => Promise<unknown> }).run({
    auth: { uid, token: { email_verified: true } },
    data,
    rawRequest: {},
    acceptsStreaming: false,
  });
}

async function community(): Promise<{ groupId: string; goalId: string }> {
  const championUid = uniq('w7champ');
  const groupId = uniq('w7grp');
  await db().doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'W7 Expo Movers',
    groupType: 'custom',
    joinPolicy: 'public',
    joinCode: uniq('w7join1234567890'),
    createdByUserId: championUid,
    lifecycleStatus: 'active',
    isSample: false,
  });
  await db().doc(`wsfMemberships/${groupId}_${championUid}`).set({ groupId, userId: championUid, role: 'foundingChampion', membershipStatus: 'active' });
  const goalRef = db().collection('wsfGoals').doc();
  const now = Date.now();
  await goalRef.set({
    ownerUid: championUid,
    communityGroupId: groupId,
    title: 'W7 squats',
    target: 5000,
    unit: 'squats',
    status: 'active',
    startsAt: Timestamp.fromMillis(now - 86_400_000),
    endsAt: Timestamp.fromMillis(now + 6 * 86_400_000),
    timezone: 'America/New_York',
    repeatPolicy: 'multiple',
    aggregateDisplayAuthorized: true,
    crossingTracked: true,
  });
  return { groupId, goalId: goalRef.id };
}

async function joinMember(groupId: string, label: string): Promise<string> {
  const uid = uniq(`w7${label}`);
  await db().doc(`wsfMemberships/${groupId}_${uid}`).set({ groupId, userId: uid, role: 'member', membershipStatus: 'active' });
  return uid;
}

async function contribute(uid: string, goalId: string, count: number): Promise<{ path: string; docId: string; attemptId: string }> {
  const attemptId = uniq('w7att');
  await call(wsfContribute, uid, { goalId, attemptId, count });
  const docId = `${goalId}_${uid}_${attemptId}`;
  return { path: `wsfContributions/${docId}`, docId, attemptId };
}

const OPERATOR = 'w7op_' + Math.random().toString(36).slice(2, 8);

async function enabled(groupId: string, goalId: string): Promise<string> {
  const now = Date.now();
  const ref = db().collection('wsfPromotions').doc();
  await ref.set({
    status: 'draft',
    ruleVersion: 5,
    repeatRule: 'perContribution',
    entrantCap: null,
    eligibleGoals: [{ goalId, communityGroupId: groupId }],
    windowStartsAt: Timestamp.fromMillis(now - 86_400_000),
    windowEndsAt: Timestamp.fromMillis(now + 3_600_000),
    formBonusEntries: 0,
    operatorUids: [OPERATOR],
    createdAt: Timestamp.now(),
  });
  const r = await enablePromotion({ db: db() }, ref.id);
  if (r.outcome !== 'enabled') throw new Error('W7 fixture: enable failed ' + JSON.stringify(r));
  return ref.id;
}

async function award(p: string, uid: string, goalId: string, n: number): Promise<Array<{ path: string; docId: string; attemptId: string }>> {
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = await contribute(uid, goalId, 1);
    const r = await ingestContribution({ db: db() }, p, c.path);
    if (r.outcome !== 'accepted') throw new Error('W7 fixture: award ' + JSON.stringify(r));
    out.push(c);
  }
  return out;
}

async function closeAndFreeze(p: string): Promise<void> {
  const c = await closePromotion({ db: db() }, p);
  if (c.outcome !== 'closed' && c.outcome !== 'alreadyClosing') throw new Error('W7 fixture: close ' + JSON.stringify(c));
  const windowEndsAt = Timestamp.fromMillis(Date.now() + 300);
  const doc = (await db().doc(`wsfPromotions/${p}`).get()).data() as Record<string, unknown>;
  const v = validatePromotionConfig({ ...doc, windowEndsAt });
  if (!v.ok) throw new Error('W7 fixture: ' + JSON.stringify(v.problems));
  await db().doc(`wsfPromotions/${p}`).update({ windowEndsAt, enabledConfigDigest: configDigest(v.policy) });
  const probe = db().collection('_w7probe').doc();
  for (;;) {
    await probe.set({ at: FieldValue.serverTimestamp() });
    if (((await probe.get()).data() as { at: Timestamp }).at.toMillis() >= windowEndsAt.toMillis()) break;
    await new Promise((res) => setTimeout(res, 60));
  }
  // EXP2B semantics: a pass that admits contributions no award reached yet is `notReady`
  // (fail closed); the next pass replays them and converges. Bounded, never masked.
  let f = await freezePromotion({ db: db() }, p);
  for (let i = 0; i < 4 && f.outcome === 'notReady'; i++) f = await freezePromotion({ db: db() }, p);
  if (f.outcome !== 'frozen') throw new Error('W7 fixture: freeze ' + JSON.stringify(f));
}

function traced() {
  const traces: ReceiptTrace[] = [];
  return { deps: { db: db(), trace: (t: ReceiptTrace) => traces.push(t) }, traces };
}

const norm = (v: unknown): unknown => (v instanceof Timestamp ? { __ts: v.toMillis() } : Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort().map(([k, x]) => [k, norm(x)])) : v);
const LANE = ['wsfPromotions', 'wsfPromotionEntrants', 'wsfPromotionEntrantLinks', 'wsfPromotionSources', 'wsfPromotionEntries', 'wsfPromotionEntrantTallies', 'wsfPromotionCounters', 'wsfPromotionPools', 'wsfPromotionFreezeAttempts', 'wsfPromotionContacts'];
/** Every lane document belonging to a promotion, with updateTime, by a full scan (no cursor tricks). */
async function laneBytes(p: string): Promise<string> {
  const out: Record<string, string> = {};
  for (const col of LANE) {
    const snap = await db().collection(col).get();
    for (const d of snap.docs) if (d.id === p || d.id.startsWith(`${p}_`)) out[`${col}/${d.id}`] = `${d.updateTime.toMillis()}:${JSON.stringify(norm(d.data()))}`;
  }
  return JSON.stringify(out);
}
async function laneDocCount(): Promise<number> {
  let n = 0;
  for (const col of LANE) n += (await db().collection(col).get()).size;
  return n;
}
function assertShape(r: unknown, forbidden: string[]) {
  const o = r as Record<string, unknown>;
  expect(Object.getPrototypeOf(o)).toBe(Object.prototype);
  if (o.status === 'ok') {
    expect(Object.keys(o).sort()).toEqual(['settled', 'status', 'tickets']);
    expect(Number.isInteger(o.tickets)).toBe(true);
    expect(typeof o.settled).toBe('boolean');
  } else {
    expect(Object.keys(o)).toEqual(['status']);
    expect(o.status).toBe('unavailable');
  }
  const json = JSON.stringify(o);
  for (const s of forbidden) if (s.length >= 2) expect(json.includes(s)).toBe(false);
}

async function setPool(p: string, pool: Record<string, unknown>, stampPromotion = true): Promise<void> {
  await db().doc(`wsfPromotionPools/${p}`).set(pool);
  if (stampPromotion) await db().doc(`wsfPromotions/${p}`).update({ poolDigest: pool.poolDigest });
}
/** A pool body with its digest recomputed from its own content — the "consistent but malformed" shape. */
function stamped(body: Omit<PoolRecord, 'poolDigest'>): PoolRecord {
  return { ...body, poolDigest: poolDigest(body) };
}

/** A document's data and its updateTime, serialised: equal strings mean not a byte moved. */
async function snapshotBytes(path: string): Promise<string> {
  const s = await db().doc(path).get();
  return JSON.stringify({ exists: s.exists, updateTime: s.updateTime ? s.updateTime.toMillis() + ':' + s.updateTime.nanoseconds : null, data: s.data() ?? null });
}
async function markerCount(p: string): Promise<number> {
  return (await db().collection('wsfPromotionFreezeAttempts').get()).docs.filter((d) => d.id.startsWith(p + '_')).length;
}

describe('W7 check 26D — EXP3A integrity successor: the stored-pool structural boundary', () => {
  test('D2+ · every recomputed-and-stamped malformed shape refuses BOTH member reads AND the frozen replay, with the pool and promotion byte-identical; the intact pool restored answers 2 / 1 and replays', async () => {
    const { groupId, goalId } = await community();
    const a = await joinMember(groupId, 'a');
    const b = await joinMember(groupId, 'b');
    const p = await enabled(groupId, goalId);
    await award(p, a, goalId, 2);
    await award(p, b, goalId, 1);
    await closeAndFreeze(p);
    const intact = (await db().doc(`wsfPromotionPools/${p}`).get()).data() as PoolRecord;
    expect(intact.totalTickets).toBe(3);
    // Baseline on the head: intact → 2 / 1 settled, and a replay that changes nothing.
    expect(await readMyEntries({ db: db() }, { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 2, settled: true });
    expect(await readMyEntries({ db: db() }, { uid: b, promotionId: p })).toEqual({ status: 'ok', tickets: 1, settled: true });
    const replay0 = await freezePromotion({ db: db() }, p);
    expect([replay0.outcome, (replay0 as { replay?: boolean }).replay]).toEqual(['frozen', true]); // a replay of the frozen state, nothing written
    const A = intact.ranges.find((r) => r.ticketEnd - r.ticketStart === 1) as PoolRecord['ranges'][number];
    const B = intact.ranges.find((r) => r.ticketEnd === r.ticketStart) as PoolRecord['ranges'][number];
    const base = { poolVersion: intact.poolVersion, ruleVersion: intact.ruleVersion, enabledConfigDigest: intact.enabledConfigDigest };
    const byId = (x: { entrantId: string }, y: { entrantId: string }) => (x.entrantId < y.entrantId ? -1 : 1);
    const shapes: Array<[string, Omit<PoolRecord, 'poolDigest'>]> = [
      ['overlap (other range overlaps mine)', { ...base, totalTickets: 3, entrantCount: 2, ranges: [{ entrantId: A.entrantId, ticketStart: 1, ticketEnd: 2 }, { entrantId: B.entrantId, ticketStart: 2, ticketEnd: 3 }].sort(byId) }],
      ['gap', { ...base, totalTickets: 3, entrantCount: 2, ranges: [{ entrantId: A.entrantId, ticketStart: 1, ticketEnd: 2 }, { entrantId: B.entrantId, ticketStart: 5, ticketEnd: 5 }].sort(byId) }],
      ['duplicate other entrant', { ...base, totalTickets: 4, entrantCount: 3, ranges: [{ entrantId: A.entrantId, ticketStart: 1, ticketEnd: 2 }, { entrantId: B.entrantId, ticketStart: 3, ticketEnd: 3 }, { entrantId: B.entrantId, ticketStart: 4, ticketEnd: 4 }] }],
      ['totalTickets mismatch', { ...base, totalTickets: 99, entrantCount: 2, ranges: intact.ranges }],
      ['entrantCount mismatch', { ...base, totalTickets: 3, entrantCount: 7, ranges: intact.ranges }],
      ['not starting at 1', { ...base, totalTickets: 4, entrantCount: 2, ranges: [{ entrantId: A.entrantId, ticketStart: 2, ticketEnd: 3 }, { entrantId: B.entrantId, ticketStart: 4, ticketEnd: 4 }].sort(byId) }],
      ['unsorted ranges', { ...base, totalTickets: 3, entrantCount: 2, ranges: [...intact.ranges].reverse() }],
      ['other range malformed (end < start)', { ...base, totalTickets: 3, entrantCount: 2, ranges: [{ entrantId: A.entrantId, ticketStart: 1, ticketEnd: 2 }, { entrantId: B.entrantId, ticketStart: 3, ticketEnd: 2 }].sort(byId) }],
      ['other range non-integer', { ...base, totalTickets: 3, entrantCount: 2, ranges: [{ entrantId: A.entrantId, ticketStart: 1, ticketEnd: 2 }, { entrantId: B.entrantId, ticketStart: 2.5, ticketEnd: 3 }].sort(byId) }],
      ['my own range malformed (end < start)', { ...base, totalTickets: 3, entrantCount: 2, ranges: [{ entrantId: A.entrantId, ticketStart: 2, ticketEnd: 1 }, { entrantId: B.entrantId, ticketStart: 3, ticketEnd: 3 }].sort(byId) }],
      ['my own entrant duplicated', { ...base, totalTickets: 4, entrantCount: 3, ranges: [{ entrantId: A.entrantId, ticketStart: 1, ticketEnd: 2 }, { entrantId: A.entrantId, ticketStart: 3, ticketEnd: 3 }, { entrantId: B.entrantId, ticketStart: 4, ticketEnd: 4 }] }],
      ['empty ranges with a positive total', { ...base, totalTickets: 3, entrantCount: 2, ranges: [] }],
    ];
    const outcomes: string[] = [];
    const counted: string[] = [];
    const replayed: string[] = [];
    const moved: string[] = [];
    for (const [name, body] of shapes) {
      const pool = stamped(body);
      await setPool(p, pool); // digest recomputed AND stamped on the promotion: only structure can refuse it
      const markersBefore = await markerCount(p);
      const poolBefore = await snapshotBytes(`wsfPromotionPools/${p}`);
      const promoBefore = await snapshotBytes(`wsfPromotions/${p}`);
      const ta = traced();
      const tb = traced();
      const ra = await readMyEntries(ta.deps, { uid: a, promotionId: p });
      const rb = await readMyEntries(tb.deps, { uid: b, promotionId: p });
      const f = await freezePromotion({ db: db() }, p);
      const fmt = (r: { status: string; tickets?: number }) => (r.status === 'ok' ? `COUNT ${r.tickets}` : 'unavailable');
      const fenced = f.outcome === 'fenced' && (f as { reason: string }).reason === 'poolCorrupt';
      outcomes.push(`${name}: a=${fmt(ra as never)}/${ta.traces.at(-1)} b=${fmt(rb as never)}/${tb.traces.at(-1)} replay=${f.outcome}${fenced ? '/poolCorrupt' : ''}`);
      if (ra.status === 'ok' || rb.status === 'ok') counted.push(name);
      if (!fenced) replayed.push(name);
      if ((await snapshotBytes(`wsfPromotionPools/${p}`)) !== poolBefore || (await snapshotBytes(`wsfPromotions/${p}`)) !== promoBefore || (await markerCount(p)) !== markersBefore) moved.push(name);
    }
    console.info(`W7 26D.D2+:\n  ${outcomes.join('\n  ')}\n  shapes that yielded a member count: ${counted.length} of ${shapes.length}; shapes not fenced poolCorrupt on replay: ${replayed.length}; shapes whose pool / promotion / markers moved: ${moved.length}`);
    expect(counted).toEqual([]);
    expect(replayed).toEqual([]);
    expect(moved).toEqual([]);
    // Restoration: the builder's own pool is still accepted by the strengthened boundary.
    await setPool(p, intact);
    expect(await readMyEntries({ db: db() }, { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 2, settled: true });
    expect(await readMyEntries({ db: db() }, { uid: b, promotionId: p })).toEqual({ status: 'ok', tickets: 1, settled: true });
    const replay1 = await freezePromotion({ db: db() }, p);
    expect([replay1.outcome, (replay1 as { replay?: boolean }).replay]).toEqual(['frozen', true]);
    expect(((await db().doc(`wsfPromotionPools/${p}`).get()).data() as PoolRecord).poolDigest).toBe(intact.poolDigest);
    console.info('W7 26D: intact pool restored → 2 / 1 settled and freeze replay with the same digest');
  });
});
