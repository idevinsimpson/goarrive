/**
 * EXPO PRIZE — the enable transition (EXP2A). UNEXPORTED from src/index.ts.
 *
 * ONE TRANSACTION that takes a complete draft configuration to `enabled`:
 *
 *   draft ──enable──▶ enabled
 *
 * and nothing else. Every other status is the fence, with no write. It
 * requires every owner decision explicitly (policy.ts validates them; none
 * is defaulted), derives the canonical sorted `eligibleGoalIds` from the
 * validated goals — a caller's or document's array is never trusted, it is
 * replaced — and writes the status, the derived array, the enablement digest
 * and the server timestamp atomically.
 *
 * FAILS CLOSED once anything has happened under this promotion: an entrant,
 * a uid link or a nonzero counter under a draft means the document was
 * enabled before and set back, and the Director's D ruling is that a cap
 * can never be added or changed after an admission and a partial counter is
 * never initialised. A draft that already carries enable artefacts
 * (`enabledConfigDigest` / `enabledAt`) is refused for the same reason.
 *
 * Two concurrent enables: both read the draft; one commits; the other's
 * read set has changed, the SDK retries it, it reads `enabled` and is
 * fenced. There is no partial state because there is one write.
 *
 * `closing → frozen` and the freeze's convergence (W7 G) are NOT here.
 */
import { FieldPath, FieldValue, type Firestore } from 'firebase-admin/firestore';

import { COLLECTIONS, refs } from './award';
import {
  configDigest,
  validatePromotionConfig,
  type PolicyProblem,
  type PromotionStatus,
} from './policy';

export type EnableDeps = { db: Firestore };

export type EnableFenceReason =
  | 'promotionMissing'
  | 'notDraft'
  | 'enableArtefactsPresent'
  | 'entrantsExist';

export type EnableResult =
  | { outcome: 'enabled'; digest: string; eligibleGoalIds: string[] }
  | { outcome: 'fenced'; reason: EnableFenceReason; status: PromotionStatus | null }
  | { outcome: 'refused'; reason: 'invalidConfig'; problems: PolicyProblem[] };

/** Is there any entrant, link or counted admission under this promotion? Read inside the transaction. */
async function anyAdmission(tx: FirebaseFirestore.Transaction, db: Firestore, promotionId: string): Promise<boolean> {
  const prefixQuery = (collection: string) =>
    db
      .collection(collection)
      .orderBy(FieldPath.documentId())
      .startAt(`${promotionId}_`)
      .endAt(`${promotionId}_\uf8ff`)
      .limit(1);
  const [entrants, links, counter] = await Promise.all([
    tx.get(prefixQuery(COLLECTIONS.entrants)),
    tx.get(prefixQuery(COLLECTIONS.entrantLinks)),
    tx.get(refs(db, promotionId).counter),
  ]);
  if (!entrants.empty || !links.empty) return true;
  const count = (counter.data() as { entrantCount?: unknown } | undefined)?.entrantCount;
  return typeof count === 'number' && count > 0;
}

export async function enablePromotion(deps: EnableDeps, promotionId: string): Promise<EnableResult> {
  const db = deps.db;
  const r = refs(db, promotionId);
  return db.runTransaction(async (tx) => {
    // ── reads ──────────────────────────────────────────────────────────
    const snap = await tx.get(r.promotion);
    if (!snap.exists) return { outcome: 'fenced', reason: 'promotionMissing', status: null } as EnableResult;
    const doc = snap.data() as Record<string, unknown>;
    const status = (doc.status as PromotionStatus) ?? null;
    if (status !== 'draft') return { outcome: 'fenced', reason: 'notDraft', status } as EnableResult;
    if (doc.enabledConfigDigest !== undefined || doc.enabledAt !== undefined) {
      return { outcome: 'fenced', reason: 'enableArtefactsPresent', status } as EnableResult;
    }
    if (await anyAdmission(tx, db, promotionId)) {
      return { outcome: 'fenced', reason: 'entrantsExist', status } as EnableResult;
    }

    // ── decide ─────────────────────────────────────────────────────────
    const validation = validatePromotionConfig(doc);
    if (!validation.ok) {
      return { outcome: 'refused', reason: 'invalidConfig', problems: validation.problems } as EnableResult;
    }
    const { policy } = validation;
    const eligibleGoalIds = [...policy.eligibleGoalIds];
    const digest = configDigest(policy);

    // ── the one write ──────────────────────────────────────────────────
    tx.update(r.promotion, {
      status: 'enabled' satisfies PromotionStatus,
      eligibleGoalIds,
      enabledConfigDigest: digest,
      enabledAt: FieldValue.serverTimestamp(),
    });
    return { outcome: 'enabled', digest, eligibleGoalIds } as EnableResult;
  });
}
