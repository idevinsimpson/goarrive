/**
 * EXP3A — the private "My entries" read core. Director #365 5815271789.
 *
 * Emulator rows prove the read against real documents the real award and
 * freeze wrote (contributions through wsfContribute, entries through
 * ingestContribution, the pool through freezePromotion after the server
 * clock passes the cutoff). The `pure` block proves the three pure helpers
 * with no Firestore; it proves logic, never isolation or immutability.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { FieldValue, getFirestore } from 'firebase-admin/firestore';

import {
  awaitServerTimePast,
  comparable,
  contribute,
  deepStrings,
  member,
  poolDoc,
  promotionDoc,
  promotionState,
  seedClosing,
  seedCommunity,
  seedGoal,
  seedPromotion,
  setPromotion,
  uniq,
} from './fixtures';
import {
  COLLECTIONS,
  closePromotion,
  freezePromotion,
  ingestContribution,
  poolDigest,
  readMyEntries,
  sealReceipt,
  ticketsFromEntries,
  ticketsFromPool,
  type MyEntriesReceipt,
  type PoolRecord,
  type ReceiptDeps,
  type ReceiptTrace,
} from '../../src/expo-prize';

/** deps with a trace recorder; the trace never reaches the receipt. */
function deps(): ReceiptDeps & { traces: ReceiptTrace[] } {
  const traces: ReceiptTrace[] = [];
  return { db: getFirestore(), trace: (t) => traces.push(t), traces };
}

async function scene() {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalId = await seedGoal({ groupId });
  return { groupId, goalId, goals: [{ goalId, communityGroupId: groupId }] };
}

/** Award n real contributions for uid under promotion p. */
async function award(p: string, uid: string, goalId: string, n: number) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const c = await contribute(uid, goalId, 1 + i);
    expect(await ingestContribution({ db: getFirestore() }, p, c.path)).toMatchObject({ outcome: 'accepted' });
    rows.push(c);
  }
  return rows;
}

const OK_KEYS = ['settled', 'status', 'tickets'];
const UNAVAILABLE_KEYS = ['status'];

/** The allow-list and deep privacy scan every receipt in this file is held to. */
function assertShape(r: MyEntriesReceipt, forbidden: string[]) {
  expect(Object.keys(r).sort()).toEqual(r.status === 'ok' ? OK_KEYS : UNAVAILABLE_KEYS);
  const json = JSON.stringify(r);
  for (const s of forbidden) {
    expect(s.length).toBeGreaterThan(0);
    expect(json).not.toContain(s);
  }
  for (const s of deepStrings(r)) expect(['ok', 'unavailable']).toContain(s);
  if (r.status === 'ok') {
    expect(Number.isInteger(r.tickets)).toBe(true);
    expect(typeof r.settled).toBe('boolean');
  }
}

/** Every document under the lane's collections for a promotion, with updateTime, for the no-mutation proof. */
async function laneSnapshot(p: string) {
  const db = getFirestore();
  const out: Record<string, string> = {};
  for (const collection of Object.values(COLLECTIONS)) {
    const snap = await db.collection(collection).orderBy('__name__').startAt(p).endAt(`${p}`).get();
    for (const d of snap.docs) out[`${collection}/${d.id}`] = `${d.updateTime.toMillis()}:${comparable(d.data())}`;
  }
  const promo = await db.doc(`${COLLECTIONS.promotions}/${p}`).get();
  if (promo.exists) out[`${COLLECTIONS.promotions}/${p}`] = `${promo.updateTime?.toMillis()}:${comparable(promo.data())}`;
  return out;
}

describe('EXP3A private "My entries" read', () => {
  beforeAll(async () => {
    await getFirestore().doc('_warmup/expo-prize-receipt').set({ at: Date.now() });
  });

  test('R1: draft, disabled, missing and malformed ids are unavailable — never a number, never a promise', async () => {
    const { groupId, goalId, goals } = await scene();
    const uid = await member(groupId, 'm');
    for (const status of ['draft', 'disabled'] as const) {
      const p = await seedPromotion({ status, goals });
      const d = deps();
      const r = await readMyEntries(d, { uid, promotionId: p });
      expect(r).toEqual({ status: 'unavailable' });
      assertShape(r, [uid, p, goalId]);
      expect(d.traces).toEqual(['promotionInactive']);
    }
    const d = deps();
    expect(await readMyEntries(d, { uid, promotionId: 'no-such-promotion' })).toEqual({ status: 'unavailable' });
    expect(d.traces).toEqual(['promotionMissing']);
    for (const bad of [{ uid: '', promotionId: 'x' }, { uid: 'a/b', promotionId: 'x' }, { uid, promotionId: '' }, { uid, promotionId: 'wsfPromotions/x' }]) {
      const dd = deps();
      expect(await readMyEntries(dd, bad)).toEqual({ status: 'unavailable' });
      expect(dd.traces).toEqual(['invalidInput']);
    }
    // A caller cannot smuggle a count or an entrant: the input type has no such field, and extra fields are ignored.
    const p = await seedPromotion({ goals });
    const dd = deps();
    const r = await readMyEntries(dd, { uid, promotionId: p, tickets: 99, entrantId: 'forged' } as never);
    expect(r).toEqual({ status: 'ok', tickets: 0, settled: false });
    expect(dd.traces).toEqual(['linkMissing']);
  });

  test('R2: exact current count under enabled and closing, explicitly not settled; link-missing is current zero', async () => {
    const { groupId, goalId, goals } = await scene();
    const a = await member(groupId, 'a');
    const b = await member(groupId, 'b');
    const p = await seedPromotion({ goals, formBonusEntries: 0 });
    const rowsA = await award(p, a, goalId, 3);
    const forbidden = [a, b, goalId, ...rowsA.map((x) => x.attemptId), ...rowsA.map((x) => x.docId)];

    const d = deps();
    const ra = await readMyEntries(d, { uid: a, promotionId: p });
    expect(ra).toEqual({ status: 'ok', tickets: 3, settled: false });
    assertShape(ra, forbidden);
    expect(d.traces).toEqual(['currentRead']);

    const rb = await readMyEntries(deps(), { uid: b, promotionId: p });
    expect(rb).toEqual({ status: 'ok', tickets: 0, settled: false });
    const never = await readMyEntries(deps(), { uid: uniq('stranger'), promotionId: p });
    expect(never).toEqual({ status: 'ok', tickets: 0, settled: false });

    // A member with entries who then contributes again: the count moves with the award, not with the contribution.
    const c4 = await contribute(a, goalId, 4);
    expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 3, settled: false });
    expect(await ingestContribution({ db: getFirestore() }, p, c4.path)).toMatchObject({ outcome: 'accepted' });
    expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 4, settled: false });

    // closing: still provisional.
    expect(await closePromotion({ db: getFirestore() }, p)).toEqual({ outcome: 'closed' });
    expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 4, settled: false });
    expect(await readMyEntries(deps(), { uid: b, promotionId: p })).toEqual({ status: 'ok', tickets: 0, settled: false });
  });

  test('R3: account isolation and switching carry nothing across reads on the same deps', async () => {
    const { groupId, goalId, goals } = await scene();
    const a = await member(groupId, 'a');
    const b = await member(groupId, 'b');
    const c = await member(groupId, 'c');
    const p = await seedPromotion({ goals, formBonusEntries: 0 });
    const q = await seedPromotion({ goals, formBonusEntries: 0 });
    await award(p, a, goalId, 3);
    await award(p, b, goalId, 1);
    await award(q, a, goalId, 2);
    const shared = deps();
    const sequence: Array<[string, string, number]> = [
      [a, p, 3],
      [b, p, 1],
      [a, p, 3],
      [c, p, 0],
      [b, p, 1],
      [a, q, 2],
      [b, q, 0],
      [a, p, 3],
    ];
    for (const [uid, promotionId, tickets] of sequence) {
      const r = await readMyEntries(shared, { uid, promotionId });
      expect(r).toEqual({ status: 'ok', tickets, settled: false });
      assertShape(r, [a, b, c, p, q, goalId]);
    }
    // Concurrent reads for different accounts do not bleed either.
    const results = await Promise.all(sequence.map(([uid, promotionId]) => readMyEntries(shared, { uid, promotionId })));
    expect(results.map((r) => (r.status === 'ok' ? r.tickets : -1))).toEqual(sequence.map(([, , t]) => t));
  });

  test('R4: pending and revoked entries are excluded from the current count; the tally is not consulted', async () => {
    const { groupId, goalId, goals } = await scene();
    const a = await member(groupId, 'a');
    const p = await seedPromotion({ goals, formBonusEntries: 0 });
    const rows = await award(p, a, goalId, 4);
    expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 4, settled: false });
    const db = getFirestore();
    // Operator-style status changes (no writer exists yet; written directly here) — the tally still says 4.
    await db.doc(`${COLLECTIONS.entries}/${p}_c_${rows[0].docId}`).update({ status: 'revoked' });
    await db.doc(`${COLLECTIONS.entries}/${p}_c_${rows[1].docId}`).update({ status: 'pending' });
    const s = await promotionState(p);
    const entrantId = (s.links[`${p}_uid_${a}`] as { entrantId: string }).entrantId;
    expect(s.tallies[`${p}_${entrantId}`]).toMatchObject({ entryCount: 4 });
    expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 2, settled: false });
    // A malformed ticket count contributes zero rather than poisoning the read.
    await db.doc(`${COLLECTIONS.entries}/${p}_c_${rows[2].docId}`).update({ tickets: 'two' });
    expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 1, settled: false });
  });

  test('R5: provisional → settled — the same count, then final from the pool; link-missing becomes final zero', async () => {
    const { groupId, goalId, goals } = await scene();
    const a = await member(groupId, 'a');
    const b = await member(groupId, 'b');
    const z = await member(groupId, 'z');
    const rowsA = [await contribute(a, goalId, 1), await contribute(a, goalId, 2)];
    const rowsB = [await contribute(b, goalId, 3)];
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1500 });
    for (const c of [...rowsA, ...rowsB]) expect(await ingestContribution({ db: getFirestore() }, p, c.path)).toMatchObject({ outcome: 'accepted' });

    expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 2, settled: false });
    expect(await readMyEntries(deps(), { uid: b, promotionId: p })).toEqual({ status: 'ok', tickets: 1, settled: false });
    expect(await readMyEntries(deps(), { uid: z, promotionId: p })).toEqual({ status: 'ok', tickets: 0, settled: false });

    await awaitServerTimePast(windowEndMs);
    const frozen = await freezePromotion({ db: getFirestore() }, p);
    expect(frozen).toMatchObject({ outcome: 'frozen', totalTickets: 3, entrantCount: 2 });
    const pool = (await poolDoc(p)) as Record<string, unknown>;
    const forbidden = [a, b, z, goalId, ...rowsA.map((x) => x.docId), ...rowsB.map((x) => x.docId), pool.poolDigest as string, pool.enabledConfigDigest as string, '3'];

    const da = deps();
    const ra = await readMyEntries(da, { uid: a, promotionId: p });
    expect(ra).toEqual({ status: 'ok', tickets: 2, settled: true });
    assertShape(ra, forbidden.filter((s) => s !== '2'));
    expect(da.traces).toEqual(['settledRead']);
    const rb = await readMyEntries(deps(), { uid: b, promotionId: p });
    expect(rb).toEqual({ status: 'ok', tickets: 1, settled: true });
    expect(JSON.stringify(rb)).not.toContain('3'); // never the pool total
    const dz = deps();
    expect(await readMyEntries(dz, { uid: z, promotionId: p })).toEqual({ status: 'ok', tickets: 0, settled: true });
    expect(dz.traces).toEqual(['linkMissing']);

    // drawn and archived answer from the same intact pool.
    for (const status of ['drawn', 'archived'] as const) {
      await setPromotion(p, { status });
      expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 2, settled: true });
      expect(await readMyEntries(deps(), { uid: z, promotionId: p })).toEqual({ status: 'ok', tickets: 0, settled: true });
    }
    // The receipt for the entrants' own ranges never exposes an endpoint: a's range is [1,2] or [2,3]; b's is a single ticket.
    const ranges = pool.ranges as Array<{ entrantId: string; ticketStart: number; ticketEnd: number }>;
    expect(ranges.length).toBe(2);
    expect(Object.keys(ra)).not.toContain('ticketStart');
  });

  test('R6: fail closed — missing, edited, foreign or unbound pool; invalid or drifted configuration, before and after freeze', async () => {
    const { groupId, goalId, goals } = await scene();
    const a = await member(groupId, 'a');
    const rows = [await contribute(a, goalId, 1)];
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1200 });
    expect(await ingestContribution({ db: getFirestore() }, p, rows[0].path)).toMatchObject({ outcome: 'accepted' });

    // Before freeze: drift and invalid config → unavailable (not zero, not the count).
    await setPromotion(p, { entrantCap: 9 });
    let d = deps();
    expect(await readMyEntries(d, { uid: a, promotionId: p })).toEqual({ status: 'unavailable' });
    expect(d.traces).toEqual(['configDrift']);
    await setPromotion(p, { entrantCap: null });
    expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 1, settled: false });
    await setPromotion(p, { repeatRule: null });
    d = deps();
    expect(await readMyEntries(d, { uid: a, promotionId: p })).toEqual({ status: 'unavailable' });
    expect(d.traces).toEqual(['invalidConfig']);
    await setPromotion(p, { repeatRule: 'perContribution' });

    await awaitServerTimePast(windowEndMs);
    expect(await freezePromotion({ db: getFirestore() }, p)).toMatchObject({ outcome: 'frozen', totalTickets: 1 });
    expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 1, settled: true });
    const db = getFirestore();
    const poolRef = db.doc(`${COLLECTIONS.pools}/${p}`);
    const intact = (await poolRef.get()).data() as Record<string, unknown>;

    // Edited pool (a range endpoint moved) → unavailable, never the edited number.
    const ranges = intact.ranges as Array<{ entrantId: string; ticketStart: number; ticketEnd: number }>;
    await poolRef.set({ ...intact, ranges: [{ ...ranges[0], ticketEnd: ranges[0].ticketEnd + 5 }] });
    d = deps();
    expect(await readMyEntries(d, { uid: a, promotionId: p })).toEqual({ status: 'unavailable' });
    expect(d.traces).toEqual(['poolCorrupt']);
    // Missing pool → unavailable.
    await poolRef.delete();
    d = deps();
    expect(await readMyEntries(d, { uid: a, promotionId: p })).toEqual({ status: 'unavailable' });
    expect(d.traces).toEqual(['poolMissing']);
    // A different promotion's intact pool copied in (digest-consistent but not this promotion's) → unavailable.
    // Its own goal, so its freeze pass walks only its own ledger.
    const otherGoal = await seedGoal({ groupId, title: 'other' });
    const other = await seedClosing([{ goalId: otherGoal, communityGroupId: groupId }], { cutoffInMs: 600 });
    const rowO = await contribute(a, otherGoal, 7);
    expect(await ingestContribution({ db: getFirestore() }, other.promotionId, rowO.path)).toMatchObject({ outcome: 'accepted' });
    await awaitServerTimePast(other.windowEndMs);
    expect(await freezePromotion({ db: getFirestore() }, other.promotionId)).toMatchObject({ outcome: 'frozen' });
    const foreign = (await poolDoc(other.promotionId)) as Record<string, unknown>;
    await poolRef.set(foreign);
    d = deps();
    expect(await readMyEntries(d, { uid: a, promotionId: p })).toEqual({ status: 'unavailable' });
    expect(d.traces).toEqual(['poolUnbound']);
    // The intact pool restored, but the promotion's stamped digest edited → unavailable.
    await poolRef.set(intact);
    expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 1, settled: true });
    await setPromotion(p, { poolDigest: 'edited' });
    d = deps();
    expect(await readMyEntries(d, { uid: a, promotionId: p })).toEqual({ status: 'unavailable' });
    expect(d.traces).toEqual(['poolUnbound']);
    await setPromotion(p, { poolDigest: intact.poolDigest });
    // Config drift after freeze → unavailable even with an intact, bound pool.
    await setPromotion(p, { formBonusEntries: 2 });
    d = deps();
    expect(await readMyEntries(d, { uid: a, promotionId: p })).toEqual({ status: 'unavailable' });
    expect(d.traces).toEqual(['configDrift']);
    await setPromotion(p, { formBonusEntries: 0 });
    expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 1, settled: true });
    // A link that points at an entrant absent from the pool is final zero, not an error.
    await db.doc(`${COLLECTIONS.entrantLinks}/${p}_uid_${a}`).update({ entrantId: 'notInPool0000' });
    expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 0, settled: true });
    // A malformed link (no entrant id) reads as link-missing.
    await db.doc(`${COLLECTIONS.entrantLinks}/${p}_uid_${a}`).update({ entrantId: FieldValue.delete() });
    d = deps();
    expect(await readMyEntries(d, { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 0, settled: true });
    expect(d.traces).toEqual(['linkMissing']);
  });

  test('R7: payload allow-list and deep privacy scan against every value the lane holds', async () => {
    const { groupId, goalId, goals } = await scene();
    const a = await member(groupId, 'a');
    const b = await member(groupId, 'b');
    const rows = [await contribute(a, goalId, 1), await contribute(a, goalId, 1), await contribute(b, goalId, 1)];
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1200 });
    for (const c of rows) expect(await ingestContribution({ db: getFirestore() }, p, c.path)).toMatchObject({ outcome: 'accepted' });
    const before = await promotionState(p);
    const provisional = await readMyEntries(deps(), { uid: a, promotionId: p });
    await awaitServerTimePast(windowEndMs);
    expect(await freezePromotion({ db: getFirestore() }, p)).toMatchObject({ outcome: 'frozen', totalTickets: 3 });
    const settled = await readMyEntries(deps(), { uid: a, promotionId: p });
    const unavailable = await readMyEntries(deps(), { uid: a, promotionId: 'no-such' });

    // Every string the lane stores for this promotion, plus the ids the fixtures know.
    const laneStrings = new Set<string>();
    for (const bucket of [before.entrants, before.links, before.sources, before.entries, before.tallies]) {
      for (const [id, doc] of Object.entries(bucket)) {
        laneStrings.add(id);
        for (const s of deepStrings(doc)) laneStrings.add(s);
      }
    }
    const pool = (await poolDoc(p)) as Record<string, unknown>;
    for (const s of deepStrings(pool)) laneStrings.add(s);
    const promo = (await promotionDoc(p)) as Record<string, unknown>;
    for (const s of deepStrings(promo)) laneStrings.add(s);
    for (const s of [a, b, p, goalId, groupId, ...rows.map((r) => r.attemptId), ...rows.map((r) => r.docId), '@']) laneStrings.add(s);
    const forbidden = [...laneStrings].filter((s) => s.length >= 3 && s !== 'ok' && s !== 'unavailable');
    expect(forbidden.length).toBeGreaterThan(20);

    for (const r of [provisional, settled, unavailable]) assertShape(r, forbidden);
    expect(provisional).toEqual({ status: 'ok', tickets: 2, settled: false });
    expect(settled).toEqual({ status: 'ok', tickets: 2, settled: true });
    expect(unavailable).toEqual({ status: 'unavailable' });
    // No numeric field but `tickets`: no total, no entrant count, no endpoints, no timestamps.
    for (const r of [provisional, settled]) {
      const numbers = Object.entries(r).filter(([, v]) => typeof v === 'number');
      expect(numbers).toEqual([['tickets', 2]]);
    }
    // Prototype-level hygiene: a plain object with own enumerable keys only.
    for (const r of [provisional, settled, unavailable]) {
      expect(Object.getPrototypeOf(r)).toBe(Object.prototype);
      expect(Object.getOwnPropertySymbols(r)).toEqual([]);
    }
  });

  test('R8: a read never mutates — every lane document byte-identical including updateTime, across ok, unavailable and settled reads', async () => {
    const { groupId, goalId, goals } = await scene();
    const a = await member(groupId, 'a');
    const rows = [await contribute(a, goalId, 1)];
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1200 });
    expect(await ingestContribution({ db: getFirestore() }, p, rows[0].path)).toMatchObject({ outcome: 'accepted' });
    const drifted = await seedPromotion({ goals, entrantCap: null });
    await setPromotion(drifted, { entrantCap: 3 });

    const snapBefore = { ...(await laneSnapshot(p)), ...(await laneSnapshot(drifted)) };
    expect(Object.keys(snapBefore).length).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < 3; i++) {
      expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 1, settled: false });
      expect(await readMyEntries(deps(), { uid: uniq('nobody'), promotionId: p })).toEqual({ status: 'ok', tickets: 0, settled: false });
      expect(await readMyEntries(deps(), { uid: a, promotionId: drifted })).toEqual({ status: 'unavailable' });
    }
    expect(await laneSnapshot(p)).toEqual(await (async () => Object.fromEntries(Object.entries(snapBefore).filter(([k]) => k.includes(p))))());
    expect(await laneSnapshot(drifted)).toEqual(Object.fromEntries(Object.entries(snapBefore).filter(([k]) => k.includes(drifted))));

    await awaitServerTimePast(windowEndMs);
    expect(await freezePromotion({ db: getFirestore() }, p)).toMatchObject({ outcome: 'frozen' });
    const frozenBefore = await laneSnapshot(p);
    for (let i = 0; i < 3; i++) {
      expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 1, settled: true });
      expect(await readMyEntries(deps(), { uid: uniq('nobody'), promotionId: p })).toEqual({ status: 'ok', tickets: 0, settled: true });
    }
    expect(await laneSnapshot(p)).toEqual(frozenBefore);
    // And no document appeared anywhere in the lane's collections for the strangers.
    const db = getFirestore();
    for (const collection of Object.values(COLLECTIONS)) {
      const strangers = await db.collection(collection).orderBy('__name__').startAt(`${p}_uid_nobody`).endAt(`${p}_uid_nobody`).get();
      expect(strangers.size).toBe(0);
    }
  });
});

describe('EXP3A R9 — the stored-pool integrity boundary (W7 Check 26 item 5b)', () => {
  test('R9: all 12 D2 shapes, each re-stamped with its own recomputed digest and stamped on the promotion, yield no member count', async () => {
    const { groupId, goalId, goals } = await scene();
    const a = await member(groupId, 'a');
    const b = await member(groupId, 'b');
    const rows = [await contribute(a, goalId, 1), await contribute(a, goalId, 2), await contribute(b, goalId, 3)];
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1200 });
    for (const c of rows) expect(await ingestContribution({ db: getFirestore() }, p, c.path)).toMatchObject({ outcome: 'accepted' });
    await awaitServerTimePast(windowEndMs);
    expect(await freezePromotion({ db: getFirestore() }, p)).toMatchObject({ outcome: 'frozen', totalTickets: 3, entrantCount: 2 });
    const db = getFirestore();
    const poolRef = db.doc(`${COLLECTIONS.pools}/${p}`);
    const intact = (await poolRef.get()).data() as Record<string, unknown> & PoolRecord;
    const ranges = intact.ranges as Array<{ entrantId: string; ticketStart: number; ticketEnd: number }>;
    const [first, second] = ranges;
    expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 2, settled: true });
    expect(await readMyEntries(deps(), { uid: b, promotionId: p })).toEqual({ status: 'ok', tickets: 1, settled: true });

    const rebody = (over: Partial<PoolRecord>) => {
      const { poolDigest: _d, frozenAt: _f, freezeAttemptId: _i, passStartedAtMs: _m, ...body } = intact as Record<string, unknown>;
      const merged = { ...(body as Omit<PoolRecord, 'poolDigest'>), ...over };
      return { ...merged, poolDigest: poolDigest(merged) };
    };
    const r = (entrantId: string, ticketStart: number, ticketEnd: number) => ({ entrantId, ticketStart, ticketEnd });
    const shapes: Array<[string, PoolRecord]> = [
      ['overlap', rebody({ ranges: [r(first.entrantId, 1, 2), r(second.entrantId, 2, 3)] })],
      ['gap', rebody({ ranges: [r(first.entrantId, 1, 2), r(second.entrantId, 5, 5)], totalTickets: 5 })],
      ['duplicate other entrant', rebody({ ranges: [...ranges, r(second.entrantId, 4, 4)], totalTickets: 4, entrantCount: 3 })],
      ['totalTickets 99', rebody({ totalTickets: 99 })],
      ['entrantCount 7', rebody({ entrantCount: 7 })],
      ['not starting at 1', rebody({ ranges: [r(first.entrantId, 2, 3), r(second.entrantId, 4, 4)], totalTickets: 4 })],
      ['unsorted', rebody({ ranges: [...ranges].reverse() })],
      ['other range malformed', rebody({ ranges: [r(first.entrantId, 1, 2), r(second.entrantId, 3, 2)] })],
      ['non-integer', rebody({ ranges: [r(first.entrantId, 1, 2), r(second.entrantId, 2.5, 3)] })],
      ['own range malformed', rebody({ ranges: [r(first.entrantId, 2, 1), r(second.entrantId, 2, 3)] })],
      ['own entrant duplicated', rebody({ ranges: [r(first.entrantId, 1, 1), r(first.entrantId, 2, 2), r(second.entrantId, 3, 3)], entrantCount: 3 })],
      ['empty ranges', rebody({ ranges: [] })],
    ];
    expect(shapes.length).toBe(12);
    for (const [label, pool] of shapes) {
      await poolRef.set(pool);
      await setPromotion(p, { poolDigest: pool.poolDigest });
      for (const uid of [a, b]) {
        const d = deps();
        const got = await readMyEntries(d, { uid, promotionId: p });
        expect([label, got]).toEqual([label, { status: 'unavailable' }]);
        expect([label, d.traces]).toEqual([label, ['poolCorrupt']]);
      }
      // And the freeze's replay fence refuses the same stored pool.
      expect([label, (await freezePromotion({ db }, p)).outcome, (await freezePromotion({ db }, p) as { reason?: string }).reason]).toEqual([label, 'fenced', 'poolCorrupt']);
    }
    // The intact pool restored → the counts return.
    await poolRef.set(intact);
    await setPromotion(p, { poolDigest: intact.poolDigest });
    expect(await readMyEntries(deps(), { uid: a, promotionId: p })).toEqual({ status: 'ok', tickets: 2, settled: true });
    expect(await readMyEntries(deps(), { uid: b, promotionId: p })).toEqual({ status: 'ok', tickets: 1, settled: true });
    expect(await freezePromotion({ db }, p)).toMatchObject({ outcome: 'frozen', replay: true, totalTickets: 3 });
  });
});

describe('EXP3A pure helpers (pure core only, no Firestore)', () => {
  test('sealReceipt admits only the allowed keys and refuses a non-count', () => {
    expect(sealReceipt({ status: 'ok', tickets: 2, settled: false })).toEqual({ status: 'ok', tickets: 2, settled: false });
    expect(sealReceipt({ status: 'ok', tickets: 0, settled: true, entrantId: 'x', uid: 'y', total: 9 } as never)).toEqual({ status: 'ok', tickets: 0, settled: true });
    expect(sealReceipt({ status: 'unavailable', reason: 'poolCorrupt' } as never)).toEqual({ status: 'unavailable' });
    expect(sealReceipt({ status: 'ok', tickets: -1, settled: false })).toEqual({ status: 'unavailable' });
    expect(sealReceipt({ status: 'ok', tickets: 1.5, settled: false })).toEqual({ status: 'unavailable' });
    expect(sealReceipt({ status: 'ok', tickets: 1, settled: 'yes' as never })).toEqual({ status: 'ok', tickets: 1, settled: false });
  });

  test('ticketsFromEntries counts confirmed positive-integer tickets only', () => {
    expect(ticketsFromEntries([])).toBe(0);
    expect(
      ticketsFromEntries([
        { status: 'confirmed', tickets: 1 },
        { status: 'confirmed', tickets: 3 },
        { status: 'pending', tickets: 1 },
        { status: 'revoked', tickets: 5 },
        { status: 'confirmed', tickets: 0 },
        { status: 'confirmed', tickets: 2.5 },
        { status: 'confirmed', tickets: '4' },
        { status: undefined, tickets: 1 },
      ])
    ).toBe(4);
  });

  test('ticketsFromPool answers the entrant range width, zero when absent, null when the pool is unusable', () => {
    const pool: PoolRecord = {
      poolVersion: 1,
      ruleVersion: 1,
      enabledConfigDigest: 'd',
      totalTickets: 6,
      entrantCount: 3,
      ranges: [
        { entrantId: 'A', ticketStart: 1, ticketEnd: 3 },
        { entrantId: 'B', ticketStart: 4, ticketEnd: 4 },
        { entrantId: 'C', ticketStart: 5, ticketEnd: 6 },
      ],
      poolDigest: 'x',
    };
    expect(ticketsFromPool(pool, 'A')).toBe(3);
    expect(ticketsFromPool(pool, 'B')).toBe(1);
    expect(ticketsFromPool(pool, 'C')).toBe(2);
    expect(ticketsFromPool(pool, 'Z')).toBe(0);
    expect(ticketsFromPool({ ...pool, ranges: [{ entrantId: 'A', ticketStart: 3, ticketEnd: 1 }] }, 'A')).toBeNull();
    expect(ticketsFromPool({ ...pool, ranges: [{ entrantId: 'A', ticketStart: 0, ticketEnd: 1 }] }, 'A')).toBeNull();
    expect(ticketsFromPool({ ...pool, ranges: [...pool.ranges, { entrantId: 'A', ticketStart: 7, ticketEnd: 7 }] }, 'A')).toBeNull();
    expect(ticketsFromPool({ ...pool, ranges: [{ entrantId: 'A', ticketStart: 1.5, ticketEnd: 2 }] }, 'A')).toBeNull();
  });
});
