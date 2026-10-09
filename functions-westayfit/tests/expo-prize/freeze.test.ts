/**
 * EXP2B — the freeze transition on real emulator transactions. The
 * failure-catching proofs of #365 5811972490: server-clock marker,
 * pool-relevant convergence, form fence, immutable pool, concurrency.
 *
 * Every pre-cutoff contribution is made through the real wsfContribute
 * BEFORE the promotion is seeded with a cutoff a moment ahead, so no row's
 * eligibility depends on a race; the cutoff is then waited out on
 * FIRESTORE'S clock (awaitServerTimePast), never the process clock.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import {
  awaitServerTimePast,
  comparable,
  contribute,
  count,
  deepStrings,
  freezeAttempts,
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
  classifyEntryStatus,
  closePromotion,
  enablePromotion,
  freezePromotion,
  ingestContribution,
  poolDigest,
  readPromotion,
  reconcilePromotion,
  storedPoolIntact,
  type FreezeDeps,
  type FreezeResult,
} from '../../src/expo-prize';

const deps = (over: Partial<FreezeDeps> = {}): FreezeDeps => ({ db: getFirestore(), ...over });

async function scene() {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalId = await seedGoal({ groupId });
  return { groupId, goalId, goals: [{ goalId, communityGroupId: groupId }] };
}

function frozen(r: FreezeResult) {
  if (r.outcome !== 'frozen') throw new Error(`expected frozen, got ${JSON.stringify(r)}`);
  return r;
}

describe('EXP2B freeze transition', () => {
  beforeAll(async () => {
    await getFirestore().doc('_warmup/expo-prize-freeze').set({ at: Date.now() });
  });

  test('proof 1: a before-cutoff server marker cannot freeze; a later resolved marker begins the pass', async () => {
    const { groupId, goalId, goals } = await scene();
    const uid = await member(groupId, 'early');
    await contribute(uid, goalId, 3);
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 2500 });

    const early = await freezePromotion(deps(), p);
    expect(early.outcome).toBe('notReady');
    if (early.outcome !== 'notReady') throw new Error('unreachable');
    expect(early.reason).toBe('beforeCutoff');
    expect(early.startedAtMs).toBeLessThan(windowEndMs);
    expect(early.windowEndMs).toBe(windowEndMs);
    expect(early.pass).toBeNull();
    // Non-mutating except the marker: no pass ran (no source rows), no pool, still closing.
    const attempts = await freezeAttempts(p);
    expect(Object.keys(attempts)).toEqual([early.attemptId]);
    expect(attempts[early.attemptId].startedAt).toBeInstanceOf(Timestamp);
    expect((attempts[early.attemptId].startedAt as Timestamp).toMillis()).toBe(early.startedAtMs);
    expect(attempts[early.attemptId]).toMatchObject({ outcome: 'notReady', reason: 'beforeCutoff' });
    expect(count((await promotionState(p)).sources)).toBe(0);
    expect(await poolDoc(p)).toBeUndefined();
    expect(((await promotionDoc(p)) as Record<string, unknown>).status).toBe('closing');

    // A later attempt, once Firestore's clock has passed the cutoff, runs the pass.
    await awaitServerTimePast(windowEndMs);
    const later = await freezePromotion(deps(), p);
    expect(later.outcome).toBe('notReady');
    if (later.outcome !== 'notReady') throw new Error('unreachable');
    expect(later.startedAtMs).toBeGreaterThanOrEqual(windowEndMs);
    expect(later.reason).toBe('newAcceptedEntries');
    expect(later.pass).toMatchObject({ processed: 1, newAccepted: 1, preCutoffWithoutSource: 1, replayed: 0, postCutoffIgnored: 0, rowErrors: 0 });
    expect(count((await promotionState(p)).sources)).toBe(1);
    // The earlier marker is simply superseded; both remain as audit.
    expect(Object.keys(await freezeAttempts(p)).sort()).toEqual([early.attemptId, later.attemptId].sort());

    const done = frozen(await freezePromotion(deps(), p));
    expect(done.replay).toBe(false);
    expect(done.pass).toMatchObject({ processed: 1, replayed: 1, newAccepted: 0, preCutoffWithoutSource: 0 });
    expect(done.totalTickets).toBe(1);
    expect(((await promotionDoc(p)) as Record<string, unknown>).status).toBe('frozen');
  });

  test('proof 2a: a pre-cutoff row with no source — even one whose verdict is a refusal — makes the pass notReady; the next clean pass freezes', async () => {
    const { groupId, goalId, goals } = await scene();
    const uid = await member(groupId, 'repeat');
    const first = await contribute(uid, goalId, 1);
    await contribute(uid, goalId, 2); // second round: refused under perGoal
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1200, repeatRule: 'perGoal' });
    expect(await ingestContribution(deps(), p, first.path)).toMatchObject({ outcome: 'accepted' });
    await awaitServerTimePast(windowEndMs);

    // The second row has no durable verdict yet. Its verdict will be a
    // refusal, so no new entry is created — and the pass must STILL refuse
    // to freeze, because a pre-cutoff row lacked a source when the pass began.
    const r1 = await freezePromotion(deps(), p);
    expect(r1.outcome).toBe('notReady');
    if (r1.outcome !== 'notReady') throw new Error('unreachable');
    expect(r1.reason).toBe('preCutoffSourceMissing');
    expect(r1.pass).toMatchObject({ processed: 2, replayed: 1, newAccepted: 0, preCutoffWithoutSource: 1, postCutoffIgnored: 0 });
    const s = await promotionState(p);
    expect(count(s.sources)).toBe(2);
    expect(Object.values(s.sources).map((x) => x.verdict).sort()).toEqual(['accepted', 'refused']);
    expect(await poolDoc(p)).toBeUndefined();

    const r2 = frozen(await freezePromotion(deps(), p));
    expect(r2.pass).toMatchObject({ processed: 2, replayed: 2, newAccepted: 0, preCutoffWithoutSource: 0 });
    expect(r2.totalTickets).toBe(1);
    expect(r2.entrantCount).toBe(1);
  });

  test('proof 2b: accepted and refused pre-cutoff sources are both accounted for (perGoal repeat + cap)', async () => {
    const { groupId, goalId, goals } = await scene();
    const a = await member(groupId, 'a');
    const b = await member(groupId, 'b');
    await contribute(a, goalId, 1);
    await contribute(a, goalId, 1); // goalAlreadyEntered under perGoal
    await contribute(b, goalId, 1); // capReached under entrantCap 1 (a admitted first, by document order? not assumed — see below)
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1200, repeatRule: 'perGoal', entrantCap: 1 });
    await awaitServerTimePast(windowEndMs);

    const r1 = await freezePromotion(deps(), p);
    expect(r1.outcome).toBe('notReady');
    if (r1.outcome !== 'notReady') throw new Error('unreachable');
    expect(r1.reason).toBe('newAcceptedEntries');
    expect(r1.pass).toMatchObject({ processed: 3, preCutoffWithoutSource: 3, newAccepted: 1, replayed: 0 });
    const s = await promotionState(p);
    expect(count(s.sources)).toBe(3);
    const reasons = Object.values(s.sources)
      .filter((x) => x.verdict === 'refused')
      .map((x) => x.reason)
      .sort();
    expect(reasons).toEqual(['capReached', 'goalAlreadyEntered']);
    expect(count(s.entries)).toBe(1);
    expect(s.entrantCount).toBe(1);

    const r2 = frozen(await freezePromotion(deps(), p));
    expect(r2.pass).toMatchObject({ processed: 3, replayed: 3, newAccepted: 0, preCutoffWithoutSource: 0 });
    expect(r2.totalTickets).toBe(1);
    expect(r2.entrantCount).toBe(1);
    const pool = (await poolDoc(p)) as Record<string, unknown>;
    expect((pool.ranges as unknown[]).length).toBe(1);
  });

  test('proof 3: post-cutoff-only rows do not prevent a clean pool-relevant pass (W7 G)', async () => {
    const { groupId, goalId, goals } = await scene();
    const uid = await member(groupId, 'mover');
    const pre = await contribute(uid, goalId, 4);
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1200 });
    expect(await ingestContribution(deps(), p, pre.path)).toMatchObject({ outcome: 'accepted' });
    await awaitServerTimePast(windowEndMs);
    // Movement continues after the cutoff (the goal is still open); it is not pool-relevant.
    const post1 = await contribute(uid, goalId, 4);
    const post2 = await contribute(uid, goalId, 4);

    // The old broad convergence would say "not converged" here: two recorded refusals are writes.
    const r = frozen(await freezePromotion(deps(), p));
    expect(r.replay).toBe(false);
    expect(r.pass).toMatchObject({ processed: 3, replayed: 1, newAccepted: 0, preCutoffWithoutSource: 0, postCutoffIgnored: 2, rowErrors: 0 });
    expect(r.totalTickets).toBe(1);
    const s = await promotionState(p);
    expect(count(s.sources)).toBe(3);
    expect(s.sources[`${p}_c_${post1.docId}`]).toMatchObject({ verdict: 'refused', reason: 'afterCutoff' });
    expect(s.sources[`${p}_c_${post2.docId}`]).toMatchObject({ verdict: 'refused', reason: 'afterCutoff' });
    expect(count(s.entries)).toBe(1);
    // Contrast, recorded not assumed: a sibling promotion over the same ledger,
    // reconciled through the old summary, reports writes > 0 for the same rows.
    const sibling = await seedPromotion({ goals, windowEndsAt: new Date(windowEndMs), formBonusEntries: 0 });
    expect(await ingestContribution(deps(), sibling, pre.path)).toMatchObject({ outcome: 'accepted' });
    const summary = await reconcilePromotion(deps(), sibling, { pageSize: 50 });
    expect(summary.writes).toBe(2);
    expect(summary.converged).toBe(false);
  });

  test('proof 4: a contribution committed before the cutoff but processed after close is included', async () => {
    const { groupId, goalId, goals } = await scene();
    const uid = await member(groupId, 'unprocessed');
    const c = await contribute(uid, goalId, 9);
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1200, status: 'enabled' });
    expect(await closePromotion(deps(), p)).toEqual({ outcome: 'closed' });
    await awaitServerTimePast(windowEndMs);
    expect(count((await promotionState(p)).sources)).toBe(0);

    const r1 = await freezePromotion(deps(), p);
    expect(r1).toMatchObject({ outcome: 'notReady', reason: 'newAcceptedEntries' });
    const s = await promotionState(p);
    expect(s.sources[`${p}_c_${c.docId}`]).toMatchObject({ verdict: 'accepted' });
    expect(count(s.entries)).toBe(1);
    const r2 = frozen(await freezePromotion(deps(), p));
    expect(r2.totalTickets).toBe(1);
    expect(r2.entrantCount).toBe(1);
    // Movement untouched throughout.
    expect((await getFirestore().doc(c.path).get()).data()).toMatchObject({ count: 9, userId: uid });
  });

  test('proof 5: formBonusEntries > 0 refuses freeze (formSourceUnbound) with no marker; a zero-bonus promotion freezes from movement', async () => {
    const { groupId, goalId, goals } = await scene();
    const uid = await member(groupId, 'bonus');
    const c = await contribute(uid, goalId, 1);
    const withBonus = await seedClosing(goals, { cutoffInMs: 1200, formBonusEntries: 1 });
    const noBonus = await seedClosing(goals, { cutoffInMs: 1200, formBonusEntries: 0 });
    for (const p of [withBonus.promotionId, noBonus.promotionId]) {
      expect(await ingestContribution(deps(), p, c.path)).toMatchObject({ outcome: 'accepted' });
    }
    await awaitServerTimePast(Math.max(withBonus.windowEndMs, noBonus.windowEndMs));

    const before = comparable(await promotionDoc(withBonus.promotionId));
    expect(await freezePromotion(deps(), withBonus.promotionId)).toEqual({ outcome: 'refused', reason: 'formSourceUnbound', attemptId: null });
    expect(comparable(await promotionDoc(withBonus.promotionId))).toBe(before);
    expect(await freezeAttempts(withBonus.promotionId)).toEqual({});
    expect(await poolDoc(withBonus.promotionId)).toBeUndefined();
    // Still refused after a repeat: this packet cannot prove a bonus-bearing pool.
    expect(await freezePromotion(deps(), withBonus.promotionId)).toMatchObject({ outcome: 'refused', reason: 'formSourceUnbound' });

    const r = frozen(await freezePromotion(deps(), noBonus.promotionId));
    expect(r.totalTickets).toBe(1);
  });

  test('proof 6: the pool is deterministic, digest-intact and privacy-safe; the promotion carries the digest', async () => {
    const { groupId, goalId, goals } = await scene();
    const a = await member(groupId, 'a');
    const b = await member(groupId, 'b');
    const c = await member(groupId, 'c');
    const rows = [
      await contribute(a, goalId, 1),
      await contribute(a, goalId, 2),
      await contribute(a, goalId, 3),
      await contribute(b, goalId, 4),
      await contribute(c, goalId, 5),
      await contribute(c, goalId, 6),
    ];
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1500 });
    for (const r of rows) expect(await ingestContribution(deps(), p, r.path)).toMatchObject({ outcome: 'accepted' });
    await awaitServerTimePast(windowEndMs);

    const r = frozen(await freezePromotion(deps(), p));
    expect(r).toMatchObject({ replay: false, totalTickets: 6, entrantCount: 3, ruleVersion: 1 });
    const pool = (await poolDoc(p)) as Record<string, unknown>;
    expect(storedPoolIntact(pool)).toBe(true);
    expect(pool.poolDigest).toBe(r.poolDigest);
    expect(pool.totalTickets).toBe(6);
    expect(pool.entrantCount).toBe(3);
    expect(pool.frozenAt).toBeInstanceOf(Timestamp);
    expect(pool.freezeAttemptId).toBe(r.attemptId);
    expect(typeof pool.passStartedAtMs).toBe('number');
    expect(pool.passStartedAtMs as number).toBeGreaterThanOrEqual(windowEndMs);
    const ranges = pool.ranges as Array<{ entrantId: string; ticketStart: number; ticketEnd: number }>;
    // Sorted canonically, contiguous from 1, per-entrant totals 3 / 1 / 2 in entrant-id order.
    const ids = ranges.map((x) => x.entrantId);
    expect([...ids].sort()).toEqual(ids);
    let next = 1;
    for (const x of ranges) {
      expect(x.ticketStart).toBe(next);
      next = x.ticketEnd + 1;
    }
    expect(next - 1).toBe(6);
    const s = await promotionState(p);
    const entrantOf = (uid: string) => (s.links[`${p}_uid_${uid}`] as { entrantId: string }).entrantId;
    const width = (uid: string) => {
      const x = ranges.find((y) => y.entrantId === entrantOf(uid)) as { ticketStart: number; ticketEnd: number };
      return x.ticketEnd - x.ticketStart + 1;
    };
    expect([width(a), width(b), width(c)]).toEqual([3, 1, 2]);
    expect(pool.enabledConfigDigest).toBe(((await promotionDoc(p)) as Record<string, unknown>).enabledConfigDigest);

    // Privacy: no uid, goal, attempt, source/entry key, member timestamp or count anywhere in the pool.
    expect(Object.keys(pool).sort()).toEqual(
      ['enabledConfigDigest', 'entrantCount', 'freezeAttemptId', 'frozenAt', 'passStartedAtMs', 'poolDigest', 'poolVersion', 'ranges', 'ruleVersion', 'totalTickets'].sort()
    );
    for (const x of ranges) expect(Object.keys(x).sort()).toEqual(['entrantId', 'ticketEnd', 'ticketStart']);
    const strings = deepStrings(pool);
    for (const str of strings) {
      for (const uid of [a, b, c]) expect(str).not.toContain(uid);
      expect(str).not.toContain(goalId);
      for (const row of rows) {
        expect(str).not.toContain(row.attemptId);
        expect(str).not.toContain(row.docId);
      }
      expect(str).not.toMatch(/^c_|^f_|^b_/);
    }
    // The tickets came from entries; no entry id, source key or awardedAt was copied.
    for (const entryId of Object.keys(s.entries)) expect(JSON.stringify(pool)).not.toContain(entryId.replace(`${p}_`, ''));

    const promo = (await promotionDoc(p)) as Record<string, unknown>;
    expect(promo.status).toBe('frozen');
    expect(promo.poolDigest).toBe(r.poolDigest);
    expect(promo.frozenAt).toBeInstanceOf(Timestamp);
    expect(promo.freezeAttemptId).toBe(r.attemptId);
  });

  test('proof 7: zero tickets is refused (poolEmpty): no pool, still closing', async () => {
    const { goals } = await scene();
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 800 });
    await awaitServerTimePast(windowEndMs);
    const r = await freezePromotion(deps(), p);
    expect(r).toMatchObject({ outcome: 'refused', reason: 'poolEmpty' });
    expect(await poolDoc(p)).toBeUndefined();
    expect(((await promotionDoc(p)) as Record<string, unknown>).status).toBe('closing');
    if (r.outcome === 'refused' && r.attemptId) {
      expect((await freezeAttempts(p))[r.attemptId]).toMatchObject({ outcome: 'refused', reason: 'poolEmpty' });
    }
    // A second attempt is the same refusal: nothing accumulated.
    expect(await freezePromotion(deps(), p)).toMatchObject({ outcome: 'refused', reason: 'poolEmpty' });
    expect(await poolDoc(p)).toBeUndefined();
  });

  test('proof 8: an oversize pool is refused (poolTooLarge) before any write; the same pool freezes under the real bound', async () => {
    const { groupId, goalId, goals } = await scene();
    const uids = await Promise.all(['a', 'b', 'c'].map((l) => member(groupId, l)));
    const rows = [];
    for (const uid of uids) rows.push(await contribute(uid, goalId, 1));
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1200 });
    for (const r of rows) expect(await ingestContribution(deps(), p, r.path)).toMatchObject({ outcome: 'accepted' });
    await awaitServerTimePast(windowEndMs);

    const r = await freezePromotion(deps({ maxPoolBytes: 120 }), p);
    expect(r).toMatchObject({ outcome: 'refused', reason: 'poolTooLarge' });
    if (r.outcome === 'refused') {
      expect(r.detail?.maxBytes).toBe(120);
      expect(r.detail?.serializedBytes).toBeGreaterThan(120);
    }
    expect(await poolDoc(p)).toBeUndefined();
    expect(((await promotionDoc(p)) as Record<string, unknown>).status).toBe('closing');

    const ok = frozen(await freezePromotion(deps(), p));
    expect(ok).toMatchObject({ totalTickets: 3, entrantCount: 3 });
  });

  test.each([1, 2, 3])('proof 9 (run %i): six concurrent freeze attempts → one byte-stable pool, one transition; retries replay', async () => {
    const { groupId, goalId, goals } = await scene();
    const uids = await Promise.all(['a', 'b', 'c', 'd'].map((l) => member(groupId, l)));
    const rows = [];
    for (const uid of uids) rows.push(await contribute(uid, goalId, 1));
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1200 });
    for (const r of rows) expect(await ingestContribution(deps(), p, r.path)).toMatchObject({ outcome: 'accepted' });
    await awaitServerTimePast(windowEndMs);

    const results = await Promise.all(Array.from({ length: 6 }, () => freezePromotion(deps(), p)));
    const all = results.map(frozen);
    expect(all.filter((r) => !r.replay).length).toBe(1);
    expect(all.filter((r) => r.replay).length).toBe(5);
    const digests = new Set(all.map((r) => r.poolDigest));
    expect(digests.size).toBe(1);
    for (const r of all) expect(r).toMatchObject({ totalTickets: 4, entrantCount: 4 });
    const winner = all.find((r) => !r.replay) as FreezeResult & { attemptId: string };
    const pool = (await poolDoc(p)) as Record<string, unknown>;
    expect(pool.freezeAttemptId).toBe(winner.attemptId);
    expect(storedPoolIntact(pool)).toBe(true);
    const snapshot = comparable(pool);
    const promoSnapshot = comparable(await promotionDoc(p));

    // Every attempt left its marker; exactly one committed.
    const attempts = await freezeAttempts(p);
    expect(Object.keys(attempts).length).toBe(6);
    expect(Object.values(attempts).filter((x) => x.outcome === 'frozen' && x.replay === false).length).toBe(1);

    // Retries after the fact return the same receipt and rewrite nothing.
    for (let i = 0; i < 3; i++) {
      const again = frozen(await freezePromotion(deps(), p));
      expect(again.replay).toBe(true);
      expect(again.poolDigest).toBe(winner.poolDigest);
      expect(again.attemptId).toBeNull();
    }
    expect(comparable(await poolDoc(p))).toBe(snapshot);
    expect(comparable(await promotionDoc(p))).toBe(promoSnapshot);
    expect(Object.keys(await freezeAttempts(p)).length).toBe(6);
  });

  test('proof 10: frozen keeps every later award path fenced immediately', async () => {
    const { groupId, goalId, goals } = await scene();
    const uid = await member(groupId, 'x');
    const pre = await contribute(uid, goalId, 1);
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1000 });
    expect(await ingestContribution(deps(), p, pre.path)).toMatchObject({ outcome: 'accepted' });
    await awaitServerTimePast(windowEndMs);
    frozen(await freezePromotion(deps(), p));
    const promo = (await promotionDoc(p)) as Record<string, unknown>;
    expect(readPromotion(promo)).toEqual({ kind: 'fenced', reason: 'promotionInactive', status: 'frozen' });

    const post = await contribute(uid, goalId, 1);
    expect(await ingestContribution(deps(), p, post.path)).toEqual({ outcome: 'fenced', reason: 'promotionInactive' });
    expect(await ingestContribution(deps(), p, pre.path)).toEqual({ outcome: 'fenced', reason: 'promotionInactive' });
    expect(await reconcilePromotion(deps(), p, { pageSize: 50 })).toMatchObject({ processed: 0, writes: 0, converged: false });
    expect(await enablePromotion(deps(), p)).toEqual({ outcome: 'fenced', reason: 'notDraft', status: 'frozen' });
    expect(await closePromotion(deps(), p)).toEqual({ outcome: 'fenced', reason: 'notEnabled', status: 'frozen' });
    expect(classifyEntryStatus({ promotion: 'inactive', goalEligible: true, contributionExists: true, source: null })).toEqual({
      status: 'notEntered',
      reason: 'promotionInactive',
    });
    const s = await promotionState(p);
    expect(count(s.sources)).toBe(1);
    expect(count(s.entries)).toBe(1);
    expect(comparable(await promotionDoc(p))).toBe(comparable(promo));
  });

  test('proof 11: fences — not closing, drift, invalid, missing — write nothing, not even a marker', async () => {
    const { goals } = await scene();
    for (const status of ['draft', 'enabled', 'disabled', 'drawn', 'archived'] as const) {
      const p = await seedPromotion({ status, goals, formBonusEntries: 0, windowEndsAt: new Date(Date.now() - 1000) });
      const before = comparable(await promotionDoc(p));
      expect(await freezePromotion(deps(), p)).toEqual({ outcome: 'fenced', reason: 'notClosing', status, attemptId: null });
      expect(comparable(await promotionDoc(p))).toBe(before);
      expect(await freezeAttempts(p)).toEqual({});
    }
    const drifted = await seedPromotion({ status: 'closing', goals, formBonusEntries: 0, windowEndsAt: new Date(Date.now() - 1000), entrantCap: null });
    await setPromotion(drifted, { entrantCap: 3 });
    expect(await freezePromotion(deps(), drifted)).toEqual({ outcome: 'fenced', reason: 'configDrift', status: 'closing', attemptId: null });
    expect(await freezeAttempts(drifted)).toEqual({});
    const invalid = await seedPromotion({ status: 'closing', goals, formBonusEntries: 0, windowEndsAt: new Date(Date.now() - 1000) });
    await setPromotion(invalid, { operatorUids: [] });
    expect(await freezePromotion(deps(), invalid)).toEqual({ outcome: 'fenced', reason: 'invalidConfig', status: 'closing', attemptId: null });
    expect(await freezePromotion(deps(), 'no-such-promotion')).toEqual({ outcome: 'fenced', reason: 'promotionMissing', status: null, attemptId: null });
  });

  test('proof 12: a pool document that already exists is never overwritten; a frozen promotion without an intact pool is fenced', async () => {
    const { groupId, goalId, goals } = await scene();
    const uid = await member(groupId, 'x');
    const pre = await contribute(uid, goalId, 1);
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1000 });
    expect(await ingestContribution(deps(), p, pre.path)).toMatchObject({ outcome: 'accepted' });
    await awaitServerTimePast(windowEndMs);
    // A foreign pool under a closing promotion: an inconsistent state this transition never produces.
    const foreign = { poolVersion: 1, ruleVersion: 1, enabledConfigDigest: 'x', totalTickets: 99, entrantCount: 1, ranges: [{ entrantId: 'ghost', ticketStart: 1, ticketEnd: 99 }], poolDigest: 'forged' };
    await getFirestore().doc(`${COLLECTIONS.pools}/${p}`).set(foreign);
    const r = await freezePromotion(deps(), p);
    expect(r).toMatchObject({ outcome: 'fenced', reason: 'poolExistsWithoutFrozen', status: 'closing' });
    expect(comparable(await poolDoc(p))).toBe(comparable(foreign));
    expect(((await promotionDoc(p)) as Record<string, unknown>).status).toBe('closing');

    // Frozen by hand with no pool → fenced; with an edited pool → fenced poolCorrupt; nothing written either way.
    const q = await seedPromotion({ status: 'frozen', goals, formBonusEntries: 0 });
    expect(await freezePromotion(deps(), q)).toEqual({ outcome: 'fenced', reason: 'poolMissingWhileFrozen', status: 'frozen', attemptId: null });
    await getFirestore().doc(`${COLLECTIONS.pools}/${q}`).set(foreign);
    expect(await freezePromotion(deps(), q)).toEqual({ outcome: 'fenced', reason: 'poolCorrupt', status: 'frozen', attemptId: null });
    expect(await freezeAttempts(q)).toEqual({});
  });

  test('proof 12b: a structurally malformed stored pool with a recomputed digest cannot replay as frozen (W7 Check 26 item 5b)', async () => {
    const { groupId, goalId, goals } = await scene();
    const a = await member(groupId, 'a');
    const b = await member(groupId, 'b');
    const rows = [await contribute(a, goalId, 1), await contribute(b, goalId, 1)];
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1000 });
    for (const c of rows) expect(await ingestContribution(deps(), p, c.path)).toMatchObject({ outcome: 'accepted' });
    await awaitServerTimePast(windowEndMs);
    const first = frozen(await freezePromotion(deps(), p));
    const poolRef = getFirestore().doc(`${COLLECTIONS.pools}/${p}`);
    const intact = (await poolRef.get()).data() as Record<string, unknown>;
    const ranges = intact.ranges as Array<{ entrantId: string; ticketStart: number; ticketEnd: number }>;
    const { poolDigest: _d, frozenAt: _f, freezeAttemptId: _i, passStartedAtMs: _m, ...body } = intact;
    const restamp = (over: Record<string, unknown>) => {
      const merged = { ...body, ...over } as Parameters<typeof poolDigest>[0];
      return { ...merged, poolDigest: poolDigest(merged) };
    };
    const shapes: Array<[string, Record<string, unknown>]> = [
      ['overlap', restamp({ ranges: [{ ...ranges[0], ticketStart: 1, ticketEnd: 1 }, { ...ranges[1], ticketStart: 1, ticketEnd: 2 }] })],
      ['gap', restamp({ ranges: [{ ...ranges[0] }, { ...ranges[1], ticketStart: 5, ticketEnd: 5 }], totalTickets: 5 })],
      ['totalTickets wrong', restamp({ totalTickets: 99 })],
      ['entrantCount wrong', restamp({ entrantCount: 7 })],
      ['unsorted', restamp({ ranges: [...ranges].reverse() })],
      ['empty ranges', restamp({ ranges: [] })],
    ];
    for (const [label, pool] of shapes) {
      await poolRef.set(pool);
      await setPromotion(p, { poolDigest: pool.poolDigest });
      const r = await freezePromotion(deps(), p);
      expect([label, r]).toEqual([label, { outcome: 'fenced', reason: 'poolCorrupt', status: 'frozen', attemptId: null }]);
      // The digest alone would have passed: it was recomputed from the malformed content.
      expect(storedPoolIntact(pool)).toBe(false);
      // Nothing written by the fenced replay: the malformed pool is exactly as planted, no marker.
      expect(comparable(await poolDoc(p))).toBe(comparable(pool));
    }
    expect(await freezeAttempts(p)).toEqual(Object.fromEntries(Object.entries(await freezeAttempts(p)).filter(([k]) => k === first.attemptId)));
    // Restored → replay works again, same receipt.
    await poolRef.set(intact);
    await setPromotion(p, { poolDigest: intact.poolDigest });
    const again = frozen(await freezePromotion(deps(), p));
    expect(again.replay).toBe(true);
    expect(again.poolDigest).toBe(first.poolDigest);
  });

  test('proof 13: a freeze transaction that aborts before commit leaves no pool and no transition; a retry then freezes', async () => {
    const { groupId, goalId, goals } = await scene();
    const uid = await member(groupId, 'x');
    const pre = await contribute(uid, goalId, 1);
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1000 });
    expect(await ingestContribution(deps(), p, pre.path)).toMatchObject({ outcome: 'accepted' });
    await awaitServerTimePast(windowEndMs);
    const before = comparable(await promotionDoc(p));
    await expect(
      freezePromotion(
        deps({
          beforeFreezeCommit: () => {
            throw new Error('injected: freeze commit failure');
          },
        }),
        p
      )
    ).rejects.toThrow('injected');
    expect(await poolDoc(p)).toBeUndefined();
    expect(comparable(await promotionDoc(p))).toBe(before);
    const r = frozen(await freezePromotion(deps(), p));
    expect(r.replay).toBe(false);
    expect(r.totalTickets).toBe(1);
  });

  test('proof 14: the pass walks every eligible goal and pages the ledger; the pool spans goals', async () => {
    const championUid = uniq('champ');
    const groupId = await seedCommunity(championUid);
    const goalA = await seedGoal({ groupId, title: 'A' });
    const goalB = await seedGoal({ groupId, title: 'B' });
    const uids = await Promise.all(['a', 'b', 'c'].map((l) => member(groupId, l)));
    const rows = [];
    for (let i = 0; i < 7; i++) rows.push(await contribute(uids[i % 3], i % 2 ? goalA : goalB, 1));
    const goals = [
      { goalId: goalA, communityGroupId: groupId },
      { goalId: goalB, communityGroupId: groupId },
    ];
    const { promotionId: p, windowEndMs } = await seedClosing(goals, { cutoffInMs: 1500 });
    await awaitServerTimePast(windowEndMs);
    // Page size 2 forces several pages per goal.
    const r1 = await freezePromotion(deps(), p, { pageSize: 2 });
    expect(r1).toMatchObject({ outcome: 'notReady', reason: 'newAcceptedEntries' });
    if (r1.outcome === 'notReady') expect(r1.pass).toMatchObject({ goals: 2, processed: 7, newAccepted: 7 });
    const r2 = frozen(await freezePromotion(deps(), p, { pageSize: 2 }));
    expect(r2.pass).toMatchObject({ goals: 2, processed: 7, replayed: 7 });
    expect(r2.totalTickets).toBe(7);
    expect(r2.entrantCount).toBe(3);
  });
});
