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

describe('W7 check 26 — EXP3A "My entries"', () => {
  test('A. non-vacuous account isolation: sequential and concurrent switching on one deps object carries nothing', async () => {
    const { groupId, goalId } = await community();
    const [a, b, c] = await Promise.all(['a', 'b', 'c'].map((l) => joinMember(groupId, l)));
    const p = await enabled(groupId, goalId);
    const q = await enabled(groupId, goalId);
    await award(p, a, goalId, 3);
    await award(p, b, goalId, 1);
    await award(q, a, goalId, 2);
    await award(q, c, goalId, 4);
    const expected: Array<[string, string, number]> = [[a, p, 3], [b, p, 1], [c, p, 0], [a, q, 2], [b, q, 0], [c, q, 4]];
    const shared = { db: db() };
    // Sequential, shuffled, 24 reads on the same deps object.
    const seq = Array.from({ length: 24 }, (_, i) => expected[(i * 5) % expected.length]);
    for (const [uid, promotionId, tickets] of seq) {
      const r = await readMyEntries(shared, { uid, promotionId });
      expect(r).toEqual({ status: 'ok', tickets, settled: false });
      assertShape(r, [a, b, c, p, q, goalId]);
    }
    // Concurrent, 18 reads on the same deps object.
    const conc = Array.from({ length: 18 }, (_, i) => expected[(i * 7) % expected.length]);
    const results = await Promise.all(conc.map(([uid, promotionId]) => readMyEntries(shared, { uid, promotionId })));
    expect(results.map((r) => (r.status === 'ok' ? r.tickets : -1))).toEqual(conc.map(([, , t]) => t));
    console.info(`W7 26.A: values ${JSON.stringify(expected.map((e) => e[2]))} — 24 sequential + 18 concurrent reads on one deps, all exact`);
  });

  test('B. the current count is confirmed positive-integer entries only; pending / revoked / malformed count zero; the tally is ignored', async () => {
    const { groupId, goalId } = await community();
    const a = await joinMember(groupId, 'a');
    const p = await enabled(groupId, goalId);
    const rows = await award(p, a, goalId, 6);
    expect(await readMyEntries({ db: db() }, { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 6, settled: false });
    const entry = (i: number) => db().doc(`wsfPromotionEntries/${p}_c_${rows[i].docId}`);
    await entry(0).update({ status: 'revoked' });
    await entry(1).update({ status: 'pending' });
    await entry(2).update({ tickets: 'two' });
    await entry(3).update({ tickets: 0 });
    await entry(4).update({ tickets: 2.5 });
    // One genuine multi-ticket confirmed entry.
    await entry(5).update({ tickets: 3 });
    // The tally says something else entirely.
    const links = (await db().collection('wsfPromotionEntrantLinks').get()).docs.filter((d) => d.id === `${p}_uid_${a}`);
    const entrantId = (links[0].data() as { entrantId: string }).entrantId;
    await db().doc(`wsfPromotionEntrantTallies/${p}_${entrantId}`).set({ entryCount: 99, formBonusAwarded: true, movementGoals: {} }, { merge: true });
    const r = await readMyEntries({ db: db() }, { uid: a, promotionId: p });
    expect(r).toEqual({ status: 'ok', tickets: 3, settled: false });
    // An entry that belongs to someone else's entrant is not counted even if it sits under the same promotion.
    const b = await joinMember(groupId, 'b');
    await award(p, b, goalId, 2);
    expect(await readMyEntries({ db: db() }, { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 3, settled: false });
    expect(await readMyEntries({ db: db() }, { uid: b, promotionId: p })).toEqual({ status: 'ok', tickets: 2, settled: false });
    console.info('W7 26.B: 6 entries → revoked, pending, "two", 0, 2.5 count zero; one confirmed 3 → 3; tally 99 ignored; the other member 2');
  });

  test('C. provisional → settled through frozen / drawn / archived, including zero states', async () => {
    const { groupId, goalId } = await community();
    const a = await joinMember(groupId, 'a');
    const z = await joinMember(groupId, 'z'); // never enters
    const v = await joinMember(groupId, 'v'); // enters, then every entry revoked before the freeze
    const p = await enabled(groupId, goalId);
    await award(p, a, goalId, 2);
    const rowsV = await award(p, v, goalId, 1);
    await db().doc(`wsfPromotionEntries/${p}_c_${rowsV[0].docId}`).update({ status: 'revoked' });
    const read = (uid: string) => readMyEntries({ db: db() }, { uid, promotionId: p });
    expect(await read(a)).toEqual({ status: 'ok', tickets: 2, settled: false });
    expect(await read(z)).toEqual({ status: 'ok', tickets: 0, settled: false });
    expect(await read(v)).toEqual({ status: 'ok', tickets: 0, settled: false });
    expect(await closePromotion({ db: db() }, p)).toEqual({ outcome: 'closed' });
    expect(await read(a)).toEqual({ status: 'ok', tickets: 2, settled: false }); // closing: still provisional
    await closeAndFreeze(p);
    const pool = (await db().doc(`wsfPromotionPools/${p}`).get()).data() as PoolRecord;
    expect(pool.totalTickets).toBe(2); // v's revoked entry carried no ticket
    for (const status of ['frozen', 'drawn', 'archived']) {
      await db().doc(`wsfPromotions/${p}`).update({ status });
      expect(await read(a)).toEqual({ status: 'ok', tickets: 2, settled: true });
      expect(await read(z)).toEqual({ status: 'ok', tickets: 0, settled: true }); // no link
      expect(await read(v)).toEqual({ status: 'ok', tickets: 0, settled: true }); // linked, absent from the pool
    }
    // Post-freeze, entries changing cannot move the settled answer (the pool is the truth).
    await db().doc(`wsfPromotions/${p}`).update({ status: 'frozen' });
    const rowsA = (await db().collection('wsfPromotionEntries').get()).docs.filter((d) => d.id.startsWith(`${p}_c_`) && (d.data() as { entrantId: string }).entrantId === pool.ranges[0].entrantId);
    for (const d of rowsA) await d.ref.update({ tickets: 50 });
    expect(await read(a)).toEqual({ status: 'ok', tickets: 2, settled: true });
    // draft / disabled / unknown / missing / malformed → unavailable, with the trace naming why (never on the wire).
    for (const status of ['draft', 'disabled', 'bogus']) {
      await db().doc(`wsfPromotions/${p}`).update({ status });
      const t = traced();
      expect(await readMyEntries(t.deps, { uid: a, promotionId: p })).toEqual({ status: 'unavailable' });
      expect(t.traces).toEqual(['promotionInactive']);
    }
    expect(await readMyEntries({ db: db() }, { uid: a, promotionId: 'w7-no-such' })).toEqual({ status: 'unavailable' });
    expect(await readMyEntries({ db: db() }, { uid: 'bad uid', promotionId: p })).toEqual({ status: 'unavailable' });
    expect(await readMyEntries({ db: db() }, { uid: a, promotionId: 'x/y' })).toEqual({ status: 'unavailable' });
    console.info('W7 26.C: 2 / 0 / 0 provisional → same under closing → 2 / 0(no link) / 0(absent from pool) settled under frozen, drawn, archived; post-freeze entry edits ignored; draft / disabled / bogus / missing / malformed unavailable');
  });

  test('D1. config drift and missing / corrupt / unbound pool fences answer unavailable, and recover when restored', async () => {
    const { groupId, goalId } = await community();
    const a = await joinMember(groupId, 'a');
    const p = await enabled(groupId, goalId);
    await award(p, a, goalId, 2);
    const read = (uid: string) => readMyEntries({ db: db() }, { uid, promotionId: p });
    // Drift before freeze.
    await db().doc(`wsfPromotions/${p}`).update({ entrantCap: 4 });
    expect(await read(a)).toEqual({ status: 'unavailable' });
    await db().doc(`wsfPromotions/${p}`).update({ entrantCap: null });
    expect(await read(a)).toEqual({ status: 'ok', tickets: 2, settled: false });
    await db().doc(`wsfPromotions/${p}`).update({ eligibleGoalIds: [goalId, 'w7-extra'] });
    expect(await read(a)).toEqual({ status: 'unavailable' });
    await db().doc(`wsfPromotions/${p}`).update({ eligibleGoalIds: [goalId] });
    await closeAndFreeze(p);
    expect(await read(a)).toEqual({ status: 'ok', tickets: 2, settled: true });
    const intact = (await db().doc(`wsfPromotionPools/${p}`).get()).data() as PoolRecord;
    const stampedDigest = ((await db().doc(`wsfPromotions/${p}`).get()).data() as { poolDigest: string }).poolDigest;
    expect(stampedDigest).toBe(intact.poolDigest);
    const seen: string[] = [];
    const expectUnavailable = async (name: string) => {
      const t = traced();
      const r = await readMyEntries(t.deps, { uid: a, promotionId: p });
      seen.push(`${name}:${r.status === 'unavailable' ? t.traces[t.traces.length - 1] : 'COUNT ' + (r as { tickets: number }).tickets}`);
      expect(r).toEqual({ status: 'unavailable' });
    };
    // Missing pool.
    await db().doc(`wsfPromotionPools/${p}`).delete();
    await expectUnavailable('missing');
    // Corrupt: a range edited with the stored digest left stale.
    await setPool(p, { ...intact, ranges: [{ ...intact.ranges[0], ticketEnd: intact.ranges[0].ticketEnd + 3 }] }, false);
    await expectUnavailable('editedStaleDigest');
    // Unbound: another promotion's intact pool copied in.
    const q = await enabled(groupId, goalId);
    await award(q, a, goalId, 1);
    await closeAndFreeze(q);
    const foreign = (await db().doc(`wsfPromotionPools/${q}`).get()).data() as PoolRecord;
    await setPool(p, foreign, false);
    await expectUnavailable('foreignPool');
    // Unbound: the intact pool but the promotion's stamped digest edited.
    await setPool(p, intact, false);
    await db().doc(`wsfPromotions/${p}`).update({ poolDigest: 'w7-edited' });
    await expectUnavailable('stampedDigestEdited');
    await db().doc(`wsfPromotions/${p}`).update({ poolDigest: intact.poolDigest });
    // Unbound: a pool whose rule version disagrees, digest recomputed and stamped.
    await setPool(p, stamped({ ...intact, ruleVersion: intact.ruleVersion + 1 }));
    await expectUnavailable('ruleVersionMismatch');
    // Unbound: a pool whose enablement digest disagrees, digest recomputed and stamped.
    await setPool(p, stamped({ ...intact, enabledConfigDigest: 'f'.repeat(64) }));
    await expectUnavailable('enablementDigestMismatch');
    // Drift after freeze with the intact pool restored.
    await setPool(p, intact);
    await db().doc(`wsfPromotions/${p}`).update({ formBonusEntries: 1 });
    await expectUnavailable('driftAfterFreeze');
    await db().doc(`wsfPromotions/${p}`).update({ formBonusEntries: 0 });
    expect(await read(a)).toEqual({ status: 'ok', tickets: 2, settled: true });
    console.info(`W7 26.D1: ${seen.join(' | ')} → all unavailable; restored → 2`);
  });

  test('D2. the full stored-pool structural boundary with a RECOMPUTED digest stamped on the promotion: no malformed pool may yield a member count', async () => {
    const { groupId, goalId } = await community();
    const a = await joinMember(groupId, 'a');
    const b = await joinMember(groupId, 'b');
    const p = await enabled(groupId, goalId);
    await award(p, a, goalId, 2);
    await award(p, b, goalId, 1);
    await closeAndFreeze(p);
    const intact = (await db().doc(`wsfPromotionPools/${p}`).get()).data() as PoolRecord;
    expect(intact.totalTickets).toBe(3);
    const A = intact.ranges.find((r) => r.ticketEnd - r.ticketStart === 1) as PoolRecord['ranges'][number]; // a's range (2 tickets)
    const B = intact.ranges.find((r) => r.ticketEnd === r.ticketStart) as PoolRecord['ranges'][number]; // b's range (1 ticket)
    const base = { poolVersion: intact.poolVersion, ruleVersion: intact.ruleVersion, enabledConfigDigest: intact.enabledConfigDigest };
    const shapes: Array<[string, Omit<PoolRecord, 'poolDigest'>]> = [
      ['overlap (other range overlaps mine)', { ...base, totalTickets: 3, entrantCount: 2, ranges: [{ entrantId: A.entrantId, ticketStart: 1, ticketEnd: 2 }, { entrantId: B.entrantId, ticketStart: 2, ticketEnd: 3 }].sort((x, y) => (x.entrantId < y.entrantId ? -1 : 1)) }],
      ['gap', { ...base, totalTickets: 3, entrantCount: 2, ranges: [{ entrantId: A.entrantId, ticketStart: 1, ticketEnd: 2 }, { entrantId: B.entrantId, ticketStart: 5, ticketEnd: 5 }].sort((x, y) => (x.entrantId < y.entrantId ? -1 : 1)) }],
      ['duplicate other entrant', { ...base, totalTickets: 4, entrantCount: 3, ranges: [{ entrantId: A.entrantId, ticketStart: 1, ticketEnd: 2 }, { entrantId: B.entrantId, ticketStart: 3, ticketEnd: 3 }, { entrantId: B.entrantId, ticketStart: 4, ticketEnd: 4 }] }],
      ['totalTickets mismatch', { ...base, totalTickets: 99, entrantCount: 2, ranges: intact.ranges }],
      ['entrantCount mismatch', { ...base, totalTickets: 3, entrantCount: 7, ranges: intact.ranges }],
      ['not starting at 1', { ...base, totalTickets: 4, entrantCount: 2, ranges: [{ entrantId: A.entrantId, ticketStart: 2, ticketEnd: 3 }, { entrantId: B.entrantId, ticketStart: 4, ticketEnd: 4 }].sort((x, y) => (x.entrantId < y.entrantId ? -1 : 1)) }],
      ['unsorted ranges', { ...base, totalTickets: 3, entrantCount: 2, ranges: [...intact.ranges].reverse() }],
      ['other range malformed (end < start)', { ...base, totalTickets: 3, entrantCount: 2, ranges: [{ entrantId: A.entrantId, ticketStart: 1, ticketEnd: 2 }, { entrantId: B.entrantId, ticketStart: 3, ticketEnd: 2 }].sort((x, y) => (x.entrantId < y.entrantId ? -1 : 1)) }],
      ['other range non-integer', { ...base, totalTickets: 3, entrantCount: 2, ranges: [{ entrantId: A.entrantId, ticketStart: 1, ticketEnd: 2 }, { entrantId: B.entrantId, ticketStart: 2.5, ticketEnd: 3 }].sort((x, y) => (x.entrantId < y.entrantId ? -1 : 1)) }],
      ['my own range malformed (end < start)', { ...base, totalTickets: 3, entrantCount: 2, ranges: [{ entrantId: A.entrantId, ticketStart: 2, ticketEnd: 1 }, { entrantId: B.entrantId, ticketStart: 3, ticketEnd: 3 }].sort((x, y) => (x.entrantId < y.entrantId ? -1 : 1)) }],
      ['my own entrant duplicated', { ...base, totalTickets: 4, entrantCount: 3, ranges: [{ entrantId: A.entrantId, ticketStart: 1, ticketEnd: 2 }, { entrantId: A.entrantId, ticketStart: 3, ticketEnd: 3 }, { entrantId: B.entrantId, ticketStart: 4, ticketEnd: 4 }] }],
      ['empty ranges with a positive total', { ...base, totalTickets: 3, entrantCount: 2, ranges: [] }],
    ];
    const outcomes: string[] = [];
    const counted: string[] = [];
    for (const [name, body] of shapes) {
      const pool = stamped(body);
      await setPool(p, pool); // digest recomputed AND stamped on the promotion: only structure can refuse it
      const ta = traced();
      const ra = await readMyEntries(ta.deps, { uid: a, promotionId: p });
      const rb = await readMyEntries({ db: db() }, { uid: b, promotionId: p });
      const fmt = (r: { status: string; tickets?: number }) => (r.status === 'ok' ? `COUNT ${r.tickets}` : 'unavailable');
      outcomes.push(`${name}: a=${fmt(ra as never)} b=${fmt(rb as never)}`);
      if (ra.status === 'ok' || rb.status === 'ok') counted.push(name);
    }
    await setPool(p, intact);
    expect(await readMyEntries({ db: db() }, { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 2, settled: true });
    console.info(`W7 26.D2:\n  ${outcomes.join('\n  ')}\n  shapes that yielded a member count: ${counted.length} of ${shapes.length}`);
    // The Director's standard: none of these may yield a member count.
    expect(counted).toEqual([]);
  });

  test('E. exact payload allow-list and deep privacy; a read never mutates anything, including updateTime', async () => {
    const { groupId, goalId } = await community();
    const a = await joinMember(groupId, 'a');
    const b = await joinMember(groupId, 'b');
    const p = await enabled(groupId, goalId);
    const rowsA = await award(p, a, goalId, 2);
    const rowsB = await award(p, b, goalId, 1);
    const drifted = await enabled(groupId, goalId);
    await db().doc(`wsfPromotions/${drifted}`).update({ entrantCap: 2 });
    // Everything the lane stores for this promotion, as forbidden strings.
    const forbidden = new Set<string>([a, b, p, groupId, goalId, OPERATOR, '@', ...rowsA.map((r) => r.attemptId), ...rowsB.map((r) => r.attemptId), ...rowsA.map((r) => r.docId), ...rowsB.map((r) => r.docId)]);
    for (const col of LANE) for (const d of (await db().collection(col).get()).docs) if (d.id.startsWith(`${p}_`) || d.id === p) { forbidden.add(d.id); JSON.stringify(d.data(), (_k, v) => { if (typeof v === 'string' && v.length >= 3) forbidden.add(v); return v; }); }
    const forbiddenList = [...forbidden].filter((s) => s !== 'ok' && s !== 'unavailable' && !/^(confirmed|movement|enabled|closing|frozen|perContribution|firebaseUid|contribution|accepted)$/.test(s));
    expect(forbiddenList.length).toBeGreaterThan(20);

    const before = (await laneBytes(p)) + (await laneBytes(drifted));
    const docsBefore = await laneDocCount();
    const reads = [
      () => readMyEntries({ db: db() }, { uid: a, promotionId: p }),
      () => readMyEntries({ db: db() }, { uid: b, promotionId: p }),
      () => readMyEntries({ db: db() }, { uid: uniq('w7stranger'), promotionId: p }),
      () => readMyEntries({ db: db() }, { uid: a, promotionId: drifted }),
      () => readMyEntries({ db: db() }, { uid: a, promotionId: 'w7-none' }),
    ];
    for (let i = 0; i < 3; i++) {
      const [ra, rb, rs, rd, rn] = await Promise.all(reads.map((f) => f()));
      expect(ra).toEqual({ status: 'ok', tickets: 2, settled: false });
      expect(rb).toEqual({ status: 'ok', tickets: 1, settled: false });
      expect(rs).toEqual({ status: 'ok', tickets: 0, settled: false });
      expect(rd).toEqual({ status: 'unavailable' });
      expect(rn).toEqual({ status: 'unavailable' });
      for (const r of [ra, rb, rs, rd, rn]) assertShape(r, forbiddenList);
    }
    expect((await laneBytes(p)) + (await laneBytes(drifted))).toBe(before);
    expect(await laneDocCount()).toBe(docsBefore);
    await closeAndFreeze(p);
    const frozenBytes = await laneBytes(p);
    const frozenDocs = await laneDocCount();
    for (let i = 0; i < 3; i++) {
      const ra = await readMyEntries({ db: db() }, { uid: a, promotionId: p });
      const rs = await readMyEntries({ db: db() }, { uid: uniq('w7stranger'), promotionId: p });
      expect(ra).toEqual({ status: 'ok', tickets: 2, settled: true });
      expect(rs).toEqual({ status: 'ok', tickets: 0, settled: true });
      const pool = (await db().doc(`wsfPromotionPools/${p}`).get()).data() as PoolRecord;
      assertShape(ra, [...forbiddenList, pool.poolDigest, ...pool.ranges.map((r) => r.entrantId), String(pool.totalTickets)]);
      expect(Object.entries(ra).filter(([, v]) => typeof v === 'number')).toEqual([['tickets', 2]]);
    }
    expect(await laneBytes(p)).toBe(frozenBytes);
    expect(await laneDocCount()).toBe(frozenDocs);
    console.info(`W7 26.E: ${forbiddenList.length} forbidden strings absent from every receipt; 15 provisional/unavailable and 6 settled reads changed no lane document (updateTime included) and created none`);
  });
});
