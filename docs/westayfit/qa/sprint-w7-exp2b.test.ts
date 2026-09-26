/**
 * W7 · Check 25 — EXP2B's close → reconcile → freeze at `e0171fd1`, proved
 * by W7's own instrument (own seeding, raw reads, byte comparison of the
 * promotion and pool documents including their updateTime; cutoffs waited
 * out on Firestore's own clock). `@exp1/*` resolves to the worktree chosen
 * by W7_EXP1_WT.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

import { wsfContribute } from '@exp1/index';
import {
  buildPool,
  closePromotion,
  configDigest,
  enablePromotion,
  freezePromotion,
  ingestContribution,
  poolDigest,
  reconcilePromotion,
  storedPoolIntact,
  validatePromotionConfig,
  type PoolEntryInput,
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

/** A promotion enabled THROUGH the real enable transition (so digest and array are the real ones). */
async function enabled(groupId: string, goalId: string, over: Record<string, unknown> = {}): Promise<string> {
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
    ...over,
  });
  const r = await enablePromotion({ db: db() }, ref.id);
  if (r.outcome !== 'enabled') throw new Error('W7 fixture: enable failed ' + JSON.stringify(r));
  return ref.id;
}

/** Close, then move the cutoff to `inMs` from now by rewriting the window AND the digest (the operator's only way past the drift fence). */
async function closingWithCutoff(p: string, inMs: number): Promise<number> {
  const r = await closePromotion({ db: db() }, p);
  if (r.outcome !== 'closed') throw new Error('W7 fixture: close failed ' + JSON.stringify(r));
  const windowEndsAt = Timestamp.fromMillis(Date.now() + inMs);
  const doc = (await db().doc(`wsfPromotions/${p}`).get()).data() as Record<string, unknown>;
  const v = validatePromotionConfig({ ...doc, windowEndsAt });
  if (!v.ok) throw new Error('W7 fixture: ' + JSON.stringify(v.problems));
  await db().doc(`wsfPromotions/${p}`).update({ windowEndsAt, enabledConfigDigest: configDigest(v.policy) });
  return windowEndsAt.toMillis();
}

/** Wait until Firestore's own clock is at or past `ms` (a probe with serverTimestamp(), read back). */
async function serverClockPast(ms: number): Promise<number> {
  const ref = db().collection('_w7probe').doc();
  for (;;) {
    await ref.set({ at: FieldValue.serverTimestamp() });
    const at = ((await ref.get()).data() as { at: Timestamp }).at.toMillis();
    if (at >= ms) return at;
    await new Promise((res) => setTimeout(res, 80));
  }
}

const norm = (v: unknown): unknown => (v instanceof Timestamp ? { __ts: v.toMillis() } : Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort().map(([k, x]) => [k, norm(x)])) : v);
async function snapshot(path: string): Promise<string> {
  const s = await db().doc(path).get();
  return JSON.stringify({ exists: s.exists, u: s.updateTime?.toMillis() ?? null, d: norm(s.data()) });
}
async function attemptsFor(p: string): Promise<number> {
  return (await db().collection('wsfPromotionFreezeAttempts').get()).docs.filter((d) => d.id.startsWith(`${p}_`)).length;
}
async function poolOf(p: string) {
  const s = await db().doc(`wsfPromotionPools/${p}`).get();
  return s.exists ? (s.data() as Record<string, unknown>) : undefined;
}

describe('W7 check 25 — EXP2B close → reconcile → freeze', () => {
  test('A. close is digest-valid, one-way and idempotent; every fence is a byte-identical no-write', async () => {
    const { groupId, goalId } = await community();
    const p = await enabled(groupId, goalId);
    const before = (await db().doc(`wsfPromotions/${p}`).get()).data() as Record<string, unknown>;
    expect(await closePromotion({ db: db() }, p)).toEqual({ outcome: 'closed' });
    const after = (await db().doc(`wsfPromotions/${p}`).get()).data() as Record<string, unknown>;
    expect(after.status).toBe('closing');
    expect(after.closingRequestedAt).toBeInstanceOf(Timestamp);
    const { status: _a, ...restBefore } = before;
    const { status: _b, closingRequestedAt: _c, ...restAfter } = after;
    expect(JSON.stringify(norm(restAfter))).toBe(JSON.stringify(norm(restBefore)));
    const once = await snapshot(`wsfPromotions/${p}`);
    for (let i = 0; i < 3; i++) expect(await closePromotion({ db: db() }, p)).toEqual({ outcome: 'alreadyClosing' });
    expect(await snapshot(`wsfPromotions/${p}`)).toBe(once);
    // One-way: nothing reopens it.
    expect(await enablePromotion({ db: db() }, p)).toEqual({ outcome: 'fenced', reason: 'notDraft', status: 'closing' });
    expect(await snapshot(`wsfPromotions/${p}`)).toBe(once);

    // Fences, each byte-identical.
    for (const status of ['draft', 'disabled', 'frozen', 'drawn', 'archived', 'bogus']) {
      const q = await enabled(groupId, goalId);
      await db().doc(`wsfPromotions/${q}`).update({ status });
      const b = await snapshot(`wsfPromotions/${q}`);
      expect(await closePromotion({ db: db() }, q)).toEqual({ outcome: 'fenced', reason: 'notEnabled', status });
      expect(await snapshot(`wsfPromotions/${q}`)).toBe(b);
    }
    const drifted = await enabled(groupId, goalId);
    await db().doc(`wsfPromotions/${drifted}`).update({ entrantCap: 3 });
    let b = await snapshot(`wsfPromotions/${drifted}`);
    expect(await closePromotion({ db: db() }, drifted)).toEqual({ outcome: 'fenced', reason: 'configDrift', status: 'enabled' });
    expect(await snapshot(`wsfPromotions/${drifted}`)).toBe(b);
    const invalid = await enabled(groupId, goalId);
    await db().doc(`wsfPromotions/${invalid}`).update({ operatorUids: [] });
    b = await snapshot(`wsfPromotions/${invalid}`);
    expect(await closePromotion({ db: db() }, invalid)).toEqual({ outcome: 'fenced', reason: 'invalidConfig', status: 'enabled' });
    expect(await snapshot(`wsfPromotions/${invalid}`)).toBe(b);
    expect(await closePromotion({ db: db() }, 'w7-no-such')).toEqual({ outcome: 'fenced', reason: 'promotionMissing', status: null });
    // Concurrent closes converge to one write.
    const c = await enabled(groupId, goalId);
    const results = await Promise.all(Array.from({ length: 6 }, () => closePromotion({ db: db() }, c)));
    expect(results.filter((r) => r.outcome === 'closed')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'alreadyClosing')).toHaveLength(5);
    console.info('W7 25.A: close one-way, idempotent ×3, 8 fences byte-identical, 6 concurrent → 1 closed');
  });

  test('B. only the read-back Firestore marker time permits a pass; a before-cutoff attempt writes only its marker', async () => {
    const { groupId, goalId } = await community();
    const uid = await joinMember(groupId, 'early');
    const p = await enabled(groupId, goalId);
    const c = await contribute(uid, goalId, 1);
    expect(await ingestContribution({ db: db() }, p, c.path)).toMatchObject({ outcome: 'accepted' });
    const cutoff = await closingWithCutoff(p, 2_500);
    const promoBefore = await snapshot(`wsfPromotions/${p}`);
    const attemptsBefore = await attemptsFor(p);

    const early = await freezePromotion({ db: db() }, p);
    expect(early).toMatchObject({ outcome: 'notReady', reason: 'beforeCutoff', windowEndMs: cutoff });
    if (early.outcome === 'notReady') {
      expect(early.startedAtMs).toBeLessThan(cutoff);
      // The marker's stored server instant is the one the decision used.
      const marker = (await db().doc(`wsfPromotionFreezeAttempts/${p}_${early.attemptId}`).get()).data() as { startedAt: Timestamp };
      expect(marker.startedAt.toMillis()).toBe(early.startedAtMs);
    }
    expect(await snapshot(`wsfPromotions/${p}`)).toBe(promoBefore);
    expect(await poolOf(p)).toBeUndefined();
    expect(await attemptsFor(p)).toBe(attemptsBefore + 1);
    expect(early.outcome === 'notReady' ? early.pass : 'x').toBeNull(); // no pass was run

    // Even an immediate retry is judged on Firestore's clock, not ours.
    const serverNow = await serverClockPast(0);
    if (serverNow < cutoff) {
      expect(await freezePromotion({ db: db() }, p)).toMatchObject({ outcome: 'notReady', reason: 'beforeCutoff' });
    }
    await serverClockPast(cutoff);
    const late = await freezePromotion({ db: db() }, p);
    expect(late).toMatchObject({ outcome: 'frozen', replay: false, totalTickets: 1, entrantCount: 1 });
    if (late.outcome === 'frozen') {
      expect(late.pass).toMatchObject({ processed: 1, replayed: 1, newAccepted: 0, preCutoffWithoutSource: 0, postCutoffIgnored: 0, rowErrors: 0 });
      const pool = (await poolOf(p)) as Record<string, unknown>;
      expect(pool.passStartedAtMs as number).toBeGreaterThanOrEqual(cutoff);
    }
    console.info(`W7 25.B: early attempt notReady/beforeCutoff (startedAt ${early.outcome === 'notReady' ? early.startedAtMs - cutoff : '?'} ms before cutoff), marker only; after the server clock passed → frozen`);
  });

  test('C. a missing pre-cutoff verdict is adjudicated and needs a subsequent clean pass; post-cutoff-only rows never toggle readiness', async () => {
    const { groupId, goalId } = await community();
    const a = await joinMember(groupId, 'a');
    const b = await joinMember(groupId, 'b');
    const p = await enabled(groupId, goalId);
    const ca = await contribute(a, goalId, 1);
    expect(await ingestContribution({ db: db() }, p, ca.path)).toMatchObject({ outcome: 'accepted' });
    const cb = await contribute(b, goalId, 1); // pre-cutoff, NOT adjudicated
    const cutoff = await closingWithCutoff(p, 1_500);
    await serverClockPast(cutoff);

    const first = await freezePromotion({ db: db() }, p);
    expect(first).toMatchObject({ outcome: 'notReady', reason: 'newAcceptedEntries' });
    if (first.outcome === 'notReady') expect(first.pass).toMatchObject({ processed: 2, replayed: 1, newAccepted: 1, preCutoffWithoutSource: 1, postCutoffIgnored: 0, rowErrors: 0 });
    // The safe adjudication happened: b now has a durable accepted verdict; nothing frozen.
    expect(await ingestContribution({ db: db() }, p, cb.path)).toMatchObject({ outcome: 'replay' });
    expect(await poolOf(p)).toBeUndefined();
    expect(((await db().doc(`wsfPromotions/${p}`).get()).data() as { status: string }).status).toBe('closing');

    // Post-cutoff movement on the still-open goal: a new row that can never enter the pool.
    const late = await joinMember(groupId, 'late');
    await contribute(late, goalId, 1);
    const second = await freezePromotion({ db: db() }, p);
    expect(second).toMatchObject({ outcome: 'frozen', replay: false, totalTickets: 2, entrantCount: 2 });
    if (second.outcome === 'frozen') expect(second.pass).toMatchObject({ processed: 3, replayed: 2, newAccepted: 0, preCutoffWithoutSource: 0, postCutoffIgnored: 1, rowErrors: 0 });
    // The post-cutoff row was refused and recorded (bookkeeping), and is not in the pool.
    const sources = (await db().collection('wsfPromotionSources').get()).docs.filter((d) => d.id.startsWith(`${p}_`)).map((d) => d.data());
    expect(sources.filter((s) => s.reason === 'afterCutoff')).toHaveLength(1);
    // Contrast: the old broad convergence would have flipped false on that same row.
    console.info(`W7 25.C: first pass ${JSON.stringify(first.outcome === 'notReady' ? first.pass : null)} → notReady; second pass ${JSON.stringify(second.outcome === 'frozen' ? second.pass : null)} → frozen`);
  });

  test('D. a bonus-bearing promotion refuses formSourceUnbound before any marker', async () => {
    const { groupId, goalId } = await community();
    const uid = await joinMember(groupId, 'bonus');
    const p = await enabled(groupId, goalId, { formBonusEntries: 1 });
    const c = await contribute(uid, goalId, 1);
    expect(await ingestContribution({ db: db() }, p, c.path)).toMatchObject({ outcome: 'accepted' });
    const cutoff = await closingWithCutoff(p, 300);
    await serverClockPast(cutoff);
    const before = await snapshot(`wsfPromotions/${p}`);
    const r = await freezePromotion({ db: db() }, p);
    expect(r).toEqual({ outcome: 'refused', reason: 'formSourceUnbound', attemptId: null });
    expect(await attemptsFor(p)).toBe(0);
    expect(await poolOf(p)).toBeUndefined();
    expect(await snapshot(`wsfPromotions/${p}`)).toBe(before);
    console.info('W7 25.D: formBonusEntries 1 → refused/formSourceUnbound, 0 markers, no pool, document unchanged');
  });

  test('E. the pool is deterministic and fails closed; a real stored pool carries no identity, source, goal, member time or count', async () => {
    // Pure determinism, W7's own inputs.
    const meta = { ruleVersion: 5, enabledConfigDigest: 'd'.repeat(64) };
    const entries: PoolEntryInput[] = [];
    for (let i = 0; i < 60; i++) entries.push({ entrantId: `e${(i * 31) % 17}`, tickets: 1 + (i % 4), status: i % 9 === 0 ? 'revoked' : i % 11 === 0 ? 'pending' : 'confirmed' });
    const ref = buildPool(entries, meta);
    expect(ref.ok).toBe(true);
    if (!ref.ok) return;
    for (let k = 0; k < 8; k++) {
      const shuffled = [...entries].sort(() => Math.random() - 0.5);
      const again = buildPool(shuffled, meta);
      expect(again.ok && JSON.stringify(again.pool) === JSON.stringify(ref.pool)).toBe(true);
    }
    // Ranges contiguous from 1, sorted, totals consistent, digest recomputable.
    let next = 1;
    for (const r of ref.pool.ranges) {
      expect(r.ticketStart).toBe(next);
      expect(r.ticketEnd).toBeGreaterThanOrEqual(r.ticketStart);
      next = r.ticketEnd + 1;
    }
    expect(ref.pool.totalTickets).toBe(next - 1);
    expect(ref.pool.entrantCount).toBe(ref.pool.ranges.length);
    expect([...ref.pool.ranges.map((r) => r.entrantId)].sort()).toEqual(ref.pool.ranges.map((r) => r.entrantId));
    const { poolDigest: stored, ...body } = ref.pool;
    expect(poolDigest(body)).toBe(stored);
    expect(storedPoolIntact(ref.pool)).toBe(true);
    expect(storedPoolIntact({ ...ref.pool, ranges: ref.pool.ranges.slice(1) })).toBe(false);
    // Fail closed.
    expect(buildPool([], meta)).toEqual({ ok: false, problem: { reason: 'poolEmpty' } });
    expect(buildPool([{ entrantId: 'x', tickets: 1, status: 'pending' }], meta)).toEqual({ ok: false, problem: { reason: 'poolEmpty' } });
    expect(buildPool([{ entrantId: 'ok', tickets: 1, status: 'confirmed' }, { entrantId: 'bad id', tickets: 1, status: 'confirmed' }], meta)).toEqual({ ok: false, problem: { reason: 'entryMalformed', index: 1 } });
    expect(buildPool([{ entrantId: 'ok', tickets: -1, status: 'confirmed' }], meta)).toEqual({ ok: false, problem: { reason: 'entryMalformed', index: 0 } });
    const huge = buildPool(Array.from({ length: 20_000 }, (_, i) => ({ entrantId: `entrant_${i}_${'y'.repeat(30)}`, tickets: 1, status: 'confirmed' as const })), meta);
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.problem.reason).toBe('poolTooLarge');

    // A real stored pool, from a real freeze.
    const { groupId, goalId } = await community();
    const u1 = await joinMember(groupId, 'p1');
    const u2 = await joinMember(groupId, 'p2');
    const p = await enabled(groupId, goalId);
    const c1 = await contribute(u1, goalId, 7);
    const c2 = await contribute(u2, goalId, 9);
    const c3 = await contribute(u2, goalId, 11);
    for (const c of [c1, c2, c3]) expect(await ingestContribution({ db: db() }, p, c.path)).toMatchObject({ outcome: 'accepted' });
    const cutoff = await closingWithCutoff(p, 300);
    await serverClockPast(cutoff);
    const r = await freezePromotion({ db: db() }, p);
    expect(r).toMatchObject({ outcome: 'frozen', replay: false, totalTickets: 3, entrantCount: 2 });
    const pool = (await poolOf(p)) as Record<string, unknown>;
    expect(Object.keys(pool).sort()).toEqual(['enabledConfigDigest', 'entrantCount', 'freezeAttemptId', 'frozenAt', 'passStartedAtMs', 'poolDigest', 'poolVersion', 'ranges', 'ruleVersion', 'totalTickets']);
    const text = JSON.stringify(pool);
    for (const forbidden of [u1, u2, goalId, groupId, c1.attemptId, c2.attemptId, c3.attemptId, c1.docId, c2.docId, c3.docId, 'c_', 'f_', 'b_', '@', OPERATOR, 'count', 'createdAt', 'userId', 'email']) {
      expect(text.includes(forbidden)).toBe(false);
    }
    // Entrant ids in the pool are the opaque ones from the entrant documents, and every entrant is a link target, never a uid.
    const entrants = (await db().collection('wsfPromotionEntrants').get()).docs.filter((d) => d.id.startsWith(`${p}_`)).map((d) => d.id.slice(p.length + 1));
    expect((pool.ranges as Array<{ entrantId: string }>).map((x) => x.entrantId).sort()).toEqual(entrants.sort());
    expect(storedPoolIntact(pool)).toBe(true);
    console.info(`W7 25.E: pool deterministic over 8 shuffles; fail-closed ×5; stored pool keys ${Object.keys(pool).length}, forbidden strings 0/19, ranges ${JSON.stringify(pool.ranges)}`);
  });

  test.each([1, 2, 3])('F%i. foreign pools are never overwritten; pool + transition are atomic; six concurrent finalizers and retries yield one byte-stable pool', async (run) => {
    const { groupId, goalId } = await community();
    const uids = await Promise.all(['x', 'y', 'z'].map((l) => joinMember(groupId, l)));
    const p = await enabled(groupId, goalId);
    for (const u of uids) expect(await ingestContribution({ db: db() }, p, (await contribute(u, goalId, 2)).path)).toMatchObject({ outcome: 'accepted' });
    const cutoff = await closingWithCutoff(p, 400);
    await serverClockPast(cutoff);

    if (run === 1) {
      // A foreign pool under a closing promotion is never overwritten.
      await db().doc(`wsfPromotionPools/${p}`).set({ foreign: true, poolDigest: 'not-ours' });
      const foreign = await snapshot(`wsfPromotionPools/${p}`);
      const promo = await snapshot(`wsfPromotions/${p}`);
      const r = await freezePromotion({ db: db() }, p);
      expect(r).toMatchObject({ outcome: 'fenced', reason: 'poolExistsWithoutFrozen', status: 'closing' });
      expect(await snapshot(`wsfPromotionPools/${p}`)).toBe(foreign);
      expect(await snapshot(`wsfPromotions/${p}`)).toBe(promo);
      await db().doc(`wsfPromotionPools/${p}`).delete();
      // Atomicity: an abort after both writes are queued leaves neither.
      await expect(freezePromotion({ db: db(), beforeFreezeCommit: () => { throw new Error('w7 synthetic abort'); } }, p)).rejects.toThrow('w7 synthetic abort');
      expect(await poolOf(p)).toBeUndefined();
      expect(((await db().doc(`wsfPromotions/${p}`).get()).data() as { status: string }).status).toBe('closing');
    }

    const results = await Promise.all(Array.from({ length: 6 }, () => freezePromotion({ db: db() }, p)));
    const fresh = results.filter((r) => r.outcome === 'frozen' && !r.replay);
    const replays = results.filter((r) => r.outcome === 'frozen' && r.replay);
    expect(fresh).toHaveLength(1);
    expect(replays).toHaveLength(5);
    const digests = new Set(results.map((r) => (r.outcome === 'frozen' ? r.poolDigest : 'x')));
    expect(digests.size).toBe(1);
    for (const r of results) expect(r).toMatchObject({ outcome: 'frozen', totalTickets: 3, entrantCount: 3 });
    const poolBytes = await snapshot(`wsfPromotionPools/${p}`);
    const promoBytes = await snapshot(`wsfPromotions/${p}`);
    for (let i = 0; i < 3; i++) {
      const again = await freezePromotion({ db: db() }, p);
      expect(again).toMatchObject({ outcome: 'frozen', replay: true, poolDigest: [...digests][0] });
    }
    expect(await snapshot(`wsfPromotionPools/${p}`)).toBe(poolBytes);
    expect(await snapshot(`wsfPromotions/${p}`)).toBe(promoBytes);
    const promo = (await db().doc(`wsfPromotions/${p}`).get()).data() as Record<string, unknown>;
    expect(promo.status).toBe('frozen');
    expect(promo.poolDigest).toBe([...digests][0]);
    console.info(`W7 25.F${run}: 6 concurrent → 1 fresh + 5 replay, one digest; 3 retries byte-stable`);
  });

  test('G. after frozen, award, reconcile, enable and close cannot change the pool or the promotion', async () => {
    const { groupId, goalId } = await community();
    const uid = await joinMember(groupId, 'g');
    const p = await enabled(groupId, goalId);
    expect(await ingestContribution({ db: db() }, p, (await contribute(uid, goalId, 3)).path)).toMatchObject({ outcome: 'accepted' });
    const cutoff = await closingWithCutoff(p, 300);
    await serverClockPast(cutoff);
    expect(await freezePromotion({ db: db() }, p)).toMatchObject({ outcome: 'frozen', replay: false });
    const poolBytes = await snapshot(`wsfPromotionPools/${p}`);
    const promoBytes = await snapshot(`wsfPromotions/${p}`);
    const pre = await contribute(uid, goalId, 1); // movement still works; the award is fenced
    expect(await ingestContribution({ db: db() }, p, pre.path)).toEqual({ outcome: 'fenced', reason: 'promotionInactive' });
    expect(await reconcilePromotion({ db: db() }, p, { pageSize: 10 })).toMatchObject({ processed: 0, writes: 0, converged: false });
    expect(await enablePromotion({ db: db() }, p)).toEqual({ outcome: 'fenced', reason: 'notDraft', status: 'frozen' });
    expect(await closePromotion({ db: db() }, p)).toEqual({ outcome: 'fenced', reason: 'notEnabled', status: 'frozen' });
    expect(await freezePromotion({ db: db() }, p)).toMatchObject({ outcome: 'frozen', replay: true });
    expect(await snapshot(`wsfPromotionPools/${p}`)).toBe(poolBytes);
    expect(await snapshot(`wsfPromotions/${p}`)).toBe(promoBytes);
    // The member's post-freeze movement persisted regardless.
    expect((await db().doc(pre.path).get()).data()).toMatchObject({ count: 1, userId: uid });
    console.info('W7 25.G: after frozen — award fenced, reconcile 0, enable/close fenced, freeze replays; pool and promotion byte-identical; movement persisted');
  });
});
