/**
 * EXPO PRIZE — the award transaction.
 *
 * ONE TRANSACTION PER SOURCE. The canonical contribution row is in the READ
 * SET ONLY: nothing here writes to wsfContributions, wsfGoalCounters,
 * wsfGoalMemberTotals, wsfCombinedCredits or any turn document, so a failed
 * award leaves accepted movement exactly as performContribution committed it.
 *
 * The durable rows (source, entry, entrant, link) are creates under
 * deterministic ids; the counter and the tally are increment merges and the
 * entrant id is random, so their idempotence is borrowed from the
 * co-transactional creates: they commit only when the creates do. A losing
 * transaction is retried by the SDK (ABORTED), observes the source row and
 * replays. That is what makes replay, duplicate delivery, out-of-order
 * delivery and interrupted reconciliation converge.
 *
 * The only cross-entrant document is wsfPromotionCounters/{promotionId}, read
 * and incremented once per entrant, and only when a cap is configured. There
 * is no ticket counter.
 *
 * See docs/westayfit/expo-prize/CONTRACT.md §(d).
 */
import { randomBytes } from 'crypto';
import {
  FieldValue,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';

import {
  adjudicateContribution,
  adjudicateFormReceipt,
  contributionDocIdFromPath,
  EMPTY_TALLY,
  formSourceKey,
  movementSourceKey,
  readContributionRow,
  type EntrantTally,
  type RefusalReason,
  type Verdict,
} from './adjudicate';
import type { FormReceiptSource } from './form';
import { readPromotion, type FenceReason, type PromotionPolicy } from './policy';

export const COLLECTIONS = {
  promotions: 'wsfPromotions',
  entrants: 'wsfPromotionEntrants',
  entrantLinks: 'wsfPromotionEntrantLinks',
  contacts: 'wsfPromotionContacts',
  sources: 'wsfPromotionSources',
  entries: 'wsfPromotionEntries',
  tallies: 'wsfPromotionEntrantTallies',
  counters: 'wsfPromotionCounters',
  /** EXP2B: the immutable frozen pool, one per promotion (CONTRACT §d″). */
  pools: 'wsfPromotionPools',
  /** EXP2B: one server-timestamped marker per freeze attempt (CONTRACT §d″). */
  freezeAttempts: 'wsfPromotionFreezeAttempts',
} as const;

export type AwardDeps = {
  db: Firestore;
  /**
   * TEST-ONLY fault injection: called inside the transaction after every write
   * has been queued and before commit. Throwing here aborts the transaction —
   * a real abort, which is what "prize failure leaves movement intact" must
   * prove against.
   */
  beforeCommit?: () => void;
};

export type IngestResult =
  | { outcome: 'fenced'; reason: FenceReason }
  | { outcome: 'replay'; verdict: Verdict }
  | { outcome: 'accepted'; kind: 'movement' | 'formBonus'; entryId: string; entrantId: string; entrantCreated: boolean }
  | { outcome: 'refused'; reason: RefusalReason; recorded: boolean };

export function refs(db: Firestore, promotionId: string) {
  return {
    promotion: db.doc(`${COLLECTIONS.promotions}/${promotionId}`),
    source: (sourceKey: string) => db.doc(`${COLLECTIONS.sources}/${promotionId}_${sourceKey}`),
    entry: (entryId: string) => db.doc(`${COLLECTIONS.entries}/${promotionId}_${entryId}`),
    entrant: (entrantId: string) => db.doc(`${COLLECTIONS.entrants}/${promotionId}_${entrantId}`),
    link: (uid: string) => db.doc(`${COLLECTIONS.entrantLinks}/${promotionId}_uid_${uid}`),
    tally: (entrantId: string) => db.doc(`${COLLECTIONS.tallies}/${promotionId}_${entrantId}`),
    counter: db.doc(`${COLLECTIONS.counters}/${promotionId}`),
    pool: db.doc(`${COLLECTIONS.pools}/${promotionId}`),
    freezeAttempt: (attemptId: string) => db.doc(`${COLLECTIONS.freezeAttempts}/${promotionId}_${attemptId}`),
  };
}

function newEntrantId(): string {
  // Opaque. Not derived from the uid, the time or anything a person supplied.
  return randomBytes(15).toString('base64url');
}

function readTally(raw: unknown): EntrantTally {
  if (!raw || typeof raw !== 'object') return EMPTY_TALLY;
  const d = raw as Record<string, unknown>;
  return {
    entryCount: typeof d.entryCount === 'number' ? d.entryCount : 0,
    formBonusAwarded: d.formBonusAwarded === true,
    movementGoals:
      d.movementGoals && typeof d.movementGoals === 'object'
        ? (d.movementGoals as Record<string, true>)
        : {},
  };
}

/**
 * The entrant-resolution half of both ingests, inside the transaction.
 * Reads the link and the tally, and if the uid has no entrant yet, reads the
 * counter when a cap applies. All reads; no writes.
 */
async function resolveEntrant(
  tx: Transaction,
  r: ReturnType<typeof refs>,
  uid: string,
  policy: PromotionPolicy
): Promise<
  | { existing: true; entrantId: string; tally: EntrantTally }
  | { existing: false; entrantId: string; tally: EntrantTally; capFull: boolean; counterRef: DocumentReference | null }
> {
  const linkSnap = await tx.get(r.link(uid));
  const linkedId = (linkSnap.data() as { entrantId?: unknown } | undefined)?.entrantId;
  if (linkSnap.exists && typeof linkedId === 'string') {
    const tallySnap = await tx.get(r.tally(linkedId));
    return { existing: true, entrantId: linkedId, tally: readTally(tallySnap.data()) };
  }
  let capFull = false;
  let counterRef: DocumentReference | null = null;
  if (policy.entrantCap !== null) {
    counterRef = r.counter;
    const counterSnap = await tx.get(counterRef);
    const count = (counterSnap.data() as { entrantCount?: unknown } | undefined)?.entrantCount;
    capFull = (typeof count === 'number' ? count : 0) >= policy.entrantCap;
  }
  return { existing: false, entrantId: newEntrantId(), tally: EMPTY_TALLY, capFull, counterRef };
}

function writeSourceRow(
  tx: Transaction,
  r: ReturnType<typeof refs>,
  args: {
    sourceKey: string;
    kind: 'contribution' | 'formReceipt';
    verdict: Verdict;
    ruleVersion: number;
    canonicalPath: string;
    sourceCommittedAtMs: number;
  }
) {
  const base = {
    kind: args.kind,
    ruleVersion: args.ruleVersion,
    canonicalPath: args.canonicalPath,
    sourceCommittedAtMs: args.sourceCommittedAtMs,
    adjudicatedAt: FieldValue.serverTimestamp(),
  };
  if (args.verdict.verdict === 'accepted') {
    tx.create(r.source(args.sourceKey), { ...base, verdict: 'accepted', entryId: args.verdict.entryId });
  } else {
    tx.create(r.source(args.sourceKey), { ...base, verdict: 'refused', reason: args.verdict.reason });
  }
}

function writeEntrantIfNew(
  tx: Transaction,
  r: ReturnType<typeof refs>,
  resolved: Awaited<ReturnType<typeof resolveEntrant>>,
  uid: string
): boolean {
  if (resolved.existing) return false;
  tx.create(r.entrant(resolved.entrantId), {
    identityBasis: 'firebaseUid',
    createdAt: FieldValue.serverTimestamp(),
  });
  tx.create(r.link(uid), { entrantId: resolved.entrantId, createdAt: FieldValue.serverTimestamp() });
  if (resolved.counterRef) {
    tx.set(resolved.counterRef, { entrantCount: FieldValue.increment(1) }, { merge: true });
  }
  return true;
}

function storedVerdict(raw: unknown, sourceKey: string): Verdict {
  const d = (raw ?? {}) as Record<string, unknown>;
  if (d.verdict === 'accepted' && typeof d.entryId === 'string') {
    const kind = d.kind === 'formReceipt' ? 'formBonus' : 'movement';
    return { verdict: 'accepted', kind, sourceKey, entryId: d.entryId };
  }
  return { verdict: 'refused', reason: (d.reason as RefusalReason) ?? 'sourceMalformed' };
}

/**
 * Ingest one canonical contribution by PATH. The row is re-read inside the
 * transaction; nothing about it is taken from the caller.
 */
export async function ingestContribution(
  deps: AwardDeps,
  promotionId: string,
  contributionPath: string
): Promise<IngestResult> {
  const docId = contributionDocIdFromPath(contributionPath);
  if (!docId) return { outcome: 'refused', reason: 'notAContributionPath', recorded: false };

  const db = deps.db;
  const r = refs(db, promotionId);
  const sourceKey = movementSourceKey(docId);

  return db.runTransaction(async (tx) => {
    // ── reads ──────────────────────────────────────────────────────────
    const promoSnap = await tx.get(r.promotion);
    const promotion = readPromotion(promoSnap.exists ? promoSnap.data() : undefined);
    if (promotion.kind === 'fenced') {
      return { outcome: 'fenced', reason: promotion.reason } as IngestResult;
    }
    const { policy } = promotion;

    const sourceSnap = await tx.get(r.source(sourceKey));
    if (sourceSnap.exists) {
      return { outcome: 'replay', verdict: storedVerdict(sourceSnap.data(), sourceKey) } as IngestResult;
    }

    const rowSnap = await tx.get(db.doc(contributionPath));
    if (!rowSnap.exists) return { outcome: 'refused', reason: 'sourceMissing', recorded: false } as IngestResult;
    const row = readContributionRow(rowSnap.data());
    if (!row) return { outcome: 'refused', reason: 'sourceMalformed', recorded: false } as IngestResult;

    const resolved = await resolveEntrant(tx, r, row.userId, policy);

    // ── decide ─────────────────────────────────────────────────────────
    let verdict = adjudicateContribution({ policy, contributionDocId: docId, row, tally: resolved.tally });
    if (verdict.verdict === 'accepted' && !resolved.existing && resolved.capFull) {
      verdict = { verdict: 'refused', reason: 'capReached' };
    }

    // ── writes ─────────────────────────────────────────────────────────
    writeSourceRow(tx, r, {
      sourceKey,
      kind: 'contribution',
      verdict,
      ruleVersion: policy.ruleVersion,
      canonicalPath: contributionPath,
      sourceCommittedAtMs: row.createdAtMs,
    });
    if (verdict.verdict === 'refused') {
      deps.beforeCommit?.();
      return { outcome: 'refused', reason: verdict.reason, recorded: true } as IngestResult;
    }

    const entrantCreated = writeEntrantIfNew(tx, r, resolved, row.userId);
    tx.create(r.entry(verdict.entryId), {
      entrantId: resolved.entrantId,
      kind: 'movement',
      status: 'confirmed',
      tickets: 1,
      sourceKey,
      ruleVersion: policy.ruleVersion,
      goalId: row.goalId,
      awardedAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      r.tally(resolved.entrantId),
      {
        entryCount: FieldValue.increment(1),
        // A NESTED MAP under merge, not a dotted key: `set` with merge treats
        // a dotted object key as a literal field name, and the per-goal rule
        // would then never see a prior goal. Merge deep-merges maps.
        movementGoals: { [row.goalId]: true },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    deps.beforeCommit?.();
    return {
      outcome: 'accepted',
      kind: 'movement',
      entryId: verdict.entryId,
      entrantId: resolved.entrantId,
      entrantCreated,
    } as IngestResult;
  });
}

/**
 * Ingest one form receipt, claimed for `claimantUid`. The receipt is re-read
 * through the trusted seam inside the call; the caller supplies only its id.
 * A receipt that does not resolve, or resolves to another subject, is refused
 * without writing anything — there is no canonical source to record.
 */
export async function ingestFormReceipt(
  deps: AwardDeps & { formSource: FormReceiptSource },
  promotionId: string,
  args: { receiptId: string; claimantUid: string }
): Promise<IngestResult> {
  const db = deps.db;
  const r = refs(db, promotionId);
  const receiptId = args.receiptId.trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(receiptId)) {
    return { outcome: 'refused', reason: 'unknownReceipt', recorded: false };
  }
  const sourceKey = formSourceKey(receiptId);

  return db.runTransaction(async (tx) => {
    const promoSnap = await tx.get(r.promotion);
    const promotion = readPromotion(promoSnap.exists ? promoSnap.data() : undefined);
    if (promotion.kind === 'fenced') {
      return { outcome: 'fenced', reason: promotion.reason } as IngestResult;
    }
    const { policy } = promotion;

    const sourceSnap = await tx.get(r.source(sourceKey));
    if (sourceSnap.exists) {
      return { outcome: 'replay', verdict: storedVerdict(sourceSnap.data(), sourceKey) } as IngestResult;
    }

    // Re-read the receipt server-side, BEHIND the fence and the dedupe: a
    // fenced promotion or a replay never touches the seam. The seam is not
    // Firestore in general, so this read is outside the transaction's read
    // set; a retried transaction re-reads it, and the verdict depends only on
    // what it returned plus the transactional reads.
    const receipt = await deps.formSource.read(receiptId);
    if (!receipt) return { outcome: 'refused', reason: 'unknownReceipt', recorded: false } as IngestResult;
    if (receipt.subjectUid !== args.claimantUid) {
      return { outcome: 'refused', reason: 'subjectMismatch', recorded: false } as IngestResult;
    }

    const resolved = await resolveEntrant(tx, r, args.claimantUid, policy);

    let verdict = adjudicateFormReceipt({
      policy,
      receipt,
      claimantUid: args.claimantUid,
      entrantId: resolved.entrantId,
      tally: resolved.tally,
    });
    if (verdict.verdict === 'accepted' && !resolved.existing && resolved.capFull) {
      verdict = { verdict: 'refused', reason: 'capReached' };
    }

    writeSourceRow(tx, r, {
      sourceKey,
      kind: 'formReceipt',
      verdict,
      ruleVersion: policy.ruleVersion,
      canonicalPath: `formReceipt:${receiptId}`,
      sourceCommittedAtMs: receipt.completedAtMs,
    });
    if (verdict.verdict === 'refused') {
      deps.beforeCommit?.();
      return { outcome: 'refused', reason: verdict.reason, recorded: true } as IngestResult;
    }

    const entrantCreated = writeEntrantIfNew(tx, r, resolved, args.claimantUid);
    tx.create(r.entry(verdict.entryId), {
      entrantId: resolved.entrantId,
      kind: 'formBonus',
      status: 'confirmed',
      tickets: policy.formBonusEntries,
      sourceKey,
      ruleVersion: policy.ruleVersion,
      awardedAt: FieldValue.serverTimestamp(),
    });
    tx.set(
      r.tally(resolved.entrantId),
      {
        entryCount: FieldValue.increment(policy.formBonusEntries),
        formBonusAwarded: true,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    deps.beforeCommit?.();
    return {
      outcome: 'accepted',
      kind: 'formBonus',
      entryId: verdict.entryId,
      entrantId: resolved.entrantId,
      entrantCreated,
    } as IngestResult;
  });
}
