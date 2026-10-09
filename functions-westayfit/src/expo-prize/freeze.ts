/**
 * EXPO PRIZE — the freeze transition (EXP2B). UNEXPORTED from src/index.ts.
 *
 *   closing ──freeze──▶ frozen      + wsfPromotionPools/{promotionId}, created once
 *
 * The freeze is the last write before a draw, and it is the write that must
 * be TRUE: every contribution committed before the cutoff has been observed
 * and adjudicated, nothing committed after the cutoff can enter, and the pool
 * is an immutable, privacy-safe function of the confirmed entries. Four
 * guards make that claim, in this order, and each one fails closed:
 *
 * 1. FORM COMPLETENESS. The trusted form-receipt store and its enumerator
 *    are not chosen (CONTRACT §e; no Lovable/Supabase binding here). A
 *    movement-only pass cannot prove a pool that includes form bonuses, so a
 *    promotion with `formBonusEntries > 0` is refused `formSourceUnbound`
 *    before anything is written. A zero-bonus promotion may freeze from
 *    movement evidence alone.
 *
 * 2. THE CUTOFF ON FIRESTORE'S CLOCK. A distinct attempt marker is committed
 *    with `serverTimestamp()` and READ BACK. The pass may begin only when that
 *    resolved server instant is at or after `windowEndsAt`. Process
 *    `Date.now()`, a caller's clock, the largest `createdAt` seen, and the
 *    earlier close request are all rejected as proof: only a commit on the
 *    same clock that stamps `createdAt` proves that no pre-cutoff commit can
 *    still land. A too-early attempt writes its marker and nothing else, and
 *    a later attempt simply replaces it.
 *
 * 3. POOL-RELEVANT CONVERGENCE (W7 G). Starting after the marker, a complete
 *    deterministic pass over every eligible goal's ledger ingests each row
 *    through the same idempotent award. The pass is clean only when it
 *    created no new accepted entry AND observed no pre-cutoff row without a
 *    durable source verdict AND met no fence, drift or row error. A row
 *    committed after the cutoff is ignored for readiness whether or not its
 *    refusal was recorded on this pass: it can never enter the pool, so its
 *    bookkeeping must not toggle convergence (which is exactly what
 *    `reconcilePromotion.converged` gets wrong). A pre-cutoff row that lacked
 *    a source is adjudicated safely on this pass and the pass returns
 *    `notReady`: the freeze needs a subsequent pass that finds nothing.
 *
 * 4. ATOMIC, CREATE-ONLY POOL. One transaction re-reads the promotion (still
 *    `closing`, still digest-valid), reads the confirmed entries, builds the
 *    pool, refuses `poolEmpty` / `poolTooLarge` before writing, and then
 *    CREATES the pool document and updates `closing → frozen` together. The
 *    pool is never truncated, never overwritten, never written without the
 *    status change. Concurrent finalizers each run their own pass; one
 *    transaction commits; the others read `frozen` and return the same
 *    receipt from the stored pool. A retry after success replays too.
 *
 * `frozen` is outside AWARDING_STATUSES, so every later award, reconcile,
 * enable and close path is fenced the instant the transaction commits.
 *
 * NO DRAW. Nothing here selects, ranks, reveals or contacts anyone.
 */
import { randomBytes } from 'crypto';
import { FieldPath, FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';

import { readContributionRow } from './adjudicate';
import { COLLECTIONS, ingestContribution, refs, type AwardDeps } from './award';
import { configDigest, readPromotion, type FenceReason, type PromotionPolicy, type PromotionStatus } from './policy';
import { buildPool, storedPoolIntact, type PoolEntryInput, type PoolRecord } from './pool';
import { clampPageSize, contributionPageQuery } from './reconcile';

export type FreezeDeps = AwardDeps & {
  /** TEST-ONLY: override the pool's serialized-size bound (bytes). */
  maxPoolBytes?: number;
  /** TEST-ONLY fault injection inside the freeze transaction, after the writes are queued. */
  beforeFreezeCommit?: () => void;
};

/** What one complete pass observed. Counts only; no ids. */
export type FreezePass = {
  goals: number;
  processed: number;
  /** Rows that already carried a durable verdict (accepted or refused). */
  replayed: number;
  /** New accepted entries created by this pass: not converged. */
  newAccepted: number;
  /** Pre-cutoff rows that had no durable verdict before this pass (now adjudicated): not converged. */
  preCutoffWithoutSource: number;
  /** Post-cutoff rows first seen on this pass; refused and recorded, and IGNORED for readiness. */
  postCutoffIgnored: number;
  /** Rows the award could not adjudicate (missing / malformed at read time): not converged. */
  rowErrors: number;
};

export type FreezeFenceReason =
  | 'promotionMissing'
  | 'notClosing'
  | 'invalidConfig'
  | 'configDrift'
  | 'promotionInactive'
  | 'poolExistsWithoutFrozen'
  | 'poolMissingWhileFrozen'
  | 'poolCorrupt';

export type FreezeNotReadyReason =
  | 'beforeCutoff'
  | 'newAcceptedEntries'
  | 'preCutoffSourceMissing'
  | 'rowErrors';

export type FreezeRefusalReason = 'formSourceUnbound' | 'poolEmpty' | 'poolTooLarge' | 'entryMalformed';

export type FreezeReceipt = {
  poolDigest: string;
  totalTickets: number;
  entrantCount: number;
  ruleVersion: number;
  enabledConfigDigest: string;
};

export type FreezeResult =
  | ({ outcome: 'frozen'; replay: boolean; attemptId: string | null; pass: FreezePass | null } & FreezeReceipt)
  | { outcome: 'fenced'; reason: FreezeFenceReason; status: PromotionStatus | null; attemptId: string | null }
  | { outcome: 'refused'; reason: FreezeRefusalReason; attemptId: string | null; detail?: Record<string, number> }
  | {
      outcome: 'notReady';
      reason: FreezeNotReadyReason;
      attemptId: string;
      /** The marker's resolved server instant. */
      startedAtMs: number;
      windowEndMs: number;
      pass: FreezePass | null;
    };

function newAttemptId(): string {
  return randomBytes(12).toString('base64url');
}

function emptyPass(): FreezePass {
  return { goals: 0, processed: 0, replayed: 0, newAccepted: 0, preCutoffWithoutSource: 0, postCutoffIgnored: 0, rowErrors: 0 };
}

function receiptOf(pool: PoolRecord): FreezeReceipt {
  return {
    poolDigest: pool.poolDigest,
    totalTickets: pool.totalTickets,
    entrantCount: pool.entrantCount,
    ruleVersion: pool.ruleVersion,
    enabledConfigDigest: pool.enabledConfigDigest,
  };
}

/** Best-effort audit note on the attempt marker. Counts and reasons only; never ids. Failure here changes nothing. */
async function noteAttempt(
  db: Firestore,
  promotionId: string,
  attemptId: string,
  note: Record<string, unknown>
): Promise<void> {
  try {
    await refs(db, promotionId).freezeAttempt(attemptId).set({ ...note, finishedAt: FieldValue.serverTimestamp() }, { merge: true });
  } catch {
    // The marker is audit, not state. A failed note never alters the outcome.
  }
}

/**
 * Guard 2: commit the attempt marker and read back Firestore's own instant.
 * Returns the resolved server time in ms. Nothing about the local clock is
 * consulted.
 */
async function commitAttemptMarker(db: Firestore, promotionId: string, attemptId: string, policy: PromotionPolicy): Promise<number> {
  const ref = refs(db, promotionId).freezeAttempt(attemptId);
  await ref.create({
    startedAt: FieldValue.serverTimestamp(),
    ruleVersion: policy.ruleVersion,
    enabledConfigDigest: configDigest(policy),
    windowEndMs: policy.windowEndMs,
  });
  const back = await ref.get();
  const startedAt = (back.data() as { startedAt?: { toMillis?: () => number } } | undefined)?.startedAt;
  const startedAtMs = startedAt && typeof startedAt.toMillis === 'function' ? startedAt.toMillis() : null;
  if (startedAtMs === null) throw new Error('freeze attempt marker did not resolve a server timestamp');
  return startedAtMs;
}

/**
 * Guard 3: the pool-relevant pass. Walks every eligible goal's ledger in the
 * same order the reconciliation does, ingests each row through the idempotent
 * award, and classifies what it saw by the ROW'S OWN `createdAt` against the
 * cutoff — never by the recorded refusal alone. Returns the fence reason if
 * the award fenced mid-pass (the pass is then void), else the counts.
 */
async function poolRelevantPass(
  deps: FreezeDeps,
  promotionId: string,
  policy: PromotionPolicy,
  pageSize: number
): Promise<{ fenced: FenceReason } | { pass: FreezePass }> {
  const db = deps.db;
  const pass = emptyPass();
  for (const goalId of policy.eligibleGoalIds) {
    pass.goals += 1;
    let cursor: string | null = null;
    for (;;) {
      const snap = await contributionPageQuery(db, goalId, cursor, pageSize).get();
      for (const doc of snap.docs) {
        cursor = doc.id;
        const row = readContributionRow(doc.data());
        const result = await ingestContribution(deps, promotionId, doc.ref.path);
        pass.processed += 1;
        if (result.outcome === 'fenced') return { fenced: result.reason };
        if (result.outcome === 'replay') {
          pass.replayed += 1;
          continue;
        }
        // Not a replay: this row had no durable verdict before this pass.
        if (row === null || (result.outcome === 'refused' && !result.recorded)) {
          // Cannot even be placed against the cutoff, or the award could not
          // record it. Fail closed: not converged.
          pass.rowErrors += 1;
          continue;
        }
        const preCutoff = row.createdAtMs < policy.windowEndMs;
        if (!preCutoff) {
          // Post-cutoff: refused and recorded, and irrelevant to the pool.
          pass.postCutoffIgnored += 1;
          continue;
        }
        pass.preCutoffWithoutSource += 1;
        if (result.outcome === 'accepted') pass.newAccepted += 1;
      }
      if (snap.size < pageSize) break;
    }
  }
  return { pass };
}

function passIsClean(pass: FreezePass): FreezeNotReadyReason | null {
  if (pass.rowErrors > 0) return 'rowErrors';
  if (pass.newAccepted > 0) return 'newAcceptedEntries';
  if (pass.preCutoffWithoutSource > 0) return 'preCutoffSourceMissing';
  return null;
}

/** Read the confirmed entries under a promotion INSIDE the transaction. */
async function readEntriesInTx(tx: Transaction, db: Firestore, promotionId: string): Promise<PoolEntryInput[]> {
  const q = db
    .collection(COLLECTIONS.entries)
    .orderBy(FieldPath.documentId())
    .startAt(`${promotionId}_`)
    .endAt(`${promotionId}_\uf8ff`);
  const snap = await tx.get(q);
  return snap.docs.map((d) => {
    const x = d.data() as Record<string, unknown>;
    return {
      entrantId: x.entrantId as string,
      tickets: x.tickets as number,
      status: x.status as string,
    };
  });
}

/**
 * Guard 4: the atomic freeze. Everything the pool depends on is read in the
 * transaction; the pool document is CREATED (never set) and the status moves
 * `closing → frozen` in the same commit.
 */
async function freezeTransaction(
  deps: FreezeDeps,
  promotionId: string,
  attemptId: string,
  startedAtMs: number
): Promise<FreezeResult> {
  const db = deps.db;
  const r = refs(db, promotionId);
  return db.runTransaction(async (tx) => {
    // ── reads ──────────────────────────────────────────────────────────
    const [promoSnap, poolSnap] = await Promise.all([tx.get(r.promotion), tx.get(r.pool)]);
    if (!promoSnap.exists) {
      return { outcome: 'fenced', reason: 'promotionMissing', status: null, attemptId } as FreezeResult;
    }
    const doc = promoSnap.data() as Record<string, unknown>;
    const status = (doc.status as PromotionStatus) ?? null;
    if (status === 'frozen') {
      // Someone else committed first. Replay their receipt; never rewrite.
      if (!poolSnap.exists) return { outcome: 'fenced', reason: 'poolMissingWhileFrozen', status, attemptId } as FreezeResult;
      const stored = poolSnap.data();
      if (!storedPoolIntact(stored)) return { outcome: 'fenced', reason: 'poolCorrupt', status, attemptId } as FreezeResult;
      return { outcome: 'frozen', replay: true, attemptId, pass: null, ...receiptOf(stored) } as FreezeResult;
    }
    if (status !== 'closing') return { outcome: 'fenced', reason: 'notClosing', status, attemptId } as FreezeResult;
    // A pool under a promotion that is not frozen is an inconsistent state
    // this transition never produces. Refuse; never overwrite it.
    if (poolSnap.exists) return { outcome: 'fenced', reason: 'poolExistsWithoutFrozen', status, attemptId } as FreezeResult;
    const read = readPromotion(doc);
    if (read.kind === 'fenced') {
      return { outcome: 'fenced', reason: read.reason, status, attemptId } as FreezeResult;
    }
    const { policy } = read;
    const entries = await readEntriesInTx(tx, db, promotionId);

    // ── decide ─────────────────────────────────────────────────────────
    const built = buildPool(
      entries,
      { ruleVersion: policy.ruleVersion, enabledConfigDigest: configDigest(policy) },
      { maxSerializedBytes: deps.maxPoolBytes }
    );
    if (!built.ok) {
      const p = built.problem;
      if (p.reason === 'poolTooLarge') {
        return {
          outcome: 'refused',
          reason: 'poolTooLarge',
          attemptId,
          detail: { serializedBytes: p.serializedBytes, maxBytes: p.maxBytes },
        } as FreezeResult;
      }
      if (p.reason === 'entryMalformed') {
        return { outcome: 'refused', reason: 'entryMalformed', attemptId, detail: { index: p.index } } as FreezeResult;
      }
      return { outcome: 'refused', reason: 'poolEmpty', attemptId } as FreezeResult;
    }

    // ── writes: create-only pool + status, one commit ──────────────────
    tx.create(r.pool, {
      ...built.pool,
      freezeAttemptId: attemptId,
      passStartedAtMs: startedAtMs,
      frozenAt: FieldValue.serverTimestamp(),
    });
    tx.update(r.promotion, {
      status: 'frozen' satisfies PromotionStatus,
      frozenAt: FieldValue.serverTimestamp(),
      poolDigest: built.pool.poolDigest,
      freezeAttemptId: attemptId,
    });
    deps.beforeFreezeCommit?.();
    return {
      outcome: 'frozen',
      replay: false,
      attemptId,
      pass: null,
      ...receiptOf(built.pool),
    } as FreezeResult;
  });
}

/**
 * THE FREEZE. See the header for the four guards and their order.
 *
 * Reads the promotion; fences anything but a digest-valid `closing` (a
 * `frozen` promotion replays its receipt); refuses a bonus-bearing
 * promotion; commits and reads back the attempt marker; refuses to pass
 * before the cutoff on the server's clock; runs the pool-relevant pass;
 * returns `notReady` unless the pass was clean; then freezes atomically.
 */
export async function freezePromotion(
  deps: FreezeDeps,
  promotionId: string,
  opts: { pageSize?: number } = {}
): Promise<FreezeResult> {
  const db = deps.db;
  const r = refs(db, promotionId);
  const pageSize = clampPageSize(opts.pageSize ?? 200);

  // ── guard 0: status and configuration, before any write ───────────────
  const snap = await r.promotion.get();
  if (!snap.exists) return { outcome: 'fenced', reason: 'promotionMissing', status: null, attemptId: null };
  const doc = snap.data() as Record<string, unknown>;
  const status = (doc.status as PromotionStatus) ?? null;
  if (status === 'frozen') {
    const poolSnap = await r.pool.get();
    if (!poolSnap.exists) return { outcome: 'fenced', reason: 'poolMissingWhileFrozen', status, attemptId: null };
    const stored = poolSnap.data();
    if (!storedPoolIntact(stored)) return { outcome: 'fenced', reason: 'poolCorrupt', status, attemptId: null };
    return { outcome: 'frozen', replay: true, attemptId: null, pass: null, ...receiptOf(stored) };
  }
  if (status !== 'closing') return { outcome: 'fenced', reason: 'notClosing', status, attemptId: null };
  const read = readPromotion(doc);
  if (read.kind === 'fenced') return { outcome: 'fenced', reason: read.reason, status, attemptId: null };
  const { policy } = read;

  // ── guard 1: form completeness fails closed ───────────────────────────
  if (policy.formBonusEntries > 0) {
    return { outcome: 'refused', reason: 'formSourceUnbound', attemptId: null };
  }

  // ── guard 2: the cutoff on Firestore's clock ──────────────────────────
  const attemptId = newAttemptId();
  const startedAtMs = await commitAttemptMarker(db, promotionId, attemptId, policy);
  if (startedAtMs < policy.windowEndMs) {
    await noteAttempt(db, promotionId, attemptId, { outcome: 'notReady', reason: 'beforeCutoff', startedAtMs });
    return { outcome: 'notReady', reason: 'beforeCutoff', attemptId, startedAtMs, windowEndMs: policy.windowEndMs, pass: null };
  }

  // ── guard 3: the pool-relevant pass ───────────────────────────────────
  const passed = await poolRelevantPass(deps, promotionId, policy, pageSize);
  if ('fenced' in passed) {
    await noteAttempt(db, promotionId, attemptId, { outcome: 'fenced', reason: passed.fenced });
    return { outcome: 'fenced', reason: passed.fenced, status, attemptId };
  }
  const notReady = passIsClean(passed.pass);
  if (notReady) {
    await noteAttempt(db, promotionId, attemptId, { outcome: 'notReady', reason: notReady, pass: passed.pass });
    return { outcome: 'notReady', reason: notReady, attemptId, startedAtMs, windowEndMs: policy.windowEndMs, pass: passed.pass };
  }

  // ── guard 4: atomic, create-only ──────────────────────────────────────
  const result = await freezeTransaction(deps, promotionId, attemptId, startedAtMs);
  const note: Record<string, unknown> = { outcome: result.outcome, pass: passed.pass };
  if (result.outcome === 'frozen') {
    note.replay = result.replay;
    note.poolDigest = result.poolDigest;
  } else {
    note.reason = result.reason;
  }
  await noteAttempt(db, promotionId, attemptId, note);
  if (result.outcome === 'frozen') return { ...result, pass: passed.pass };
  return result;
}
