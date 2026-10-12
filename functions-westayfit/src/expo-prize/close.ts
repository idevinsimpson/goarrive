/**
 * EXPO PRIZE — the close transition (EXP2B). UNEXPORTED from src/index.ts.
 *
 * ONE TRANSACTION, ONE WRITE, ONE WAY:
 *
 *   enabled ──close──▶ closing
 *
 * Only an `enabled` promotion whose stored configuration still matches its
 * enablement digest may close. Everything else — any other status, a
 * drifted or invalid configuration, a missing document — is the fence, with
 * no write. A repeated close on a `closing` promotion is idempotent: it
 * returns `alreadyClosing`, writes nothing, and cannot reopen the promotion
 * or edit its policy. Nothing here ever moves a status backwards.
 *
 * The close request records a server timestamp (`closingRequestedAt`). That
 * timestamp is an audit fact, NOT proof that the cutoff has passed: the award
 * keeps accepting pre-cutoff commits under `closing` (CONTRACT §d), and the
 * freeze (freeze.ts) proves the cutoff on Firestore's clock with its own
 * marker. A close may therefore be requested before `windowEndsAt` without
 * changing any row's eligibility.
 */
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

import { refs } from './award';
import { readPromotion, type PromotionStatus } from './policy';

export type CloseDeps = { db: Firestore };

export type CloseFenceReason = 'promotionMissing' | 'notEnabled' | 'invalidConfig' | 'configDrift';

export type CloseResult =
  | { outcome: 'closed' }
  | { outcome: 'alreadyClosing' }
  | { outcome: 'fenced'; reason: CloseFenceReason; status: PromotionStatus | null };

export async function closePromotion(deps: CloseDeps, promotionId: string): Promise<CloseResult> {
  const r = refs(deps.db, promotionId);
  return deps.db.runTransaction(async (tx) => {
    // ── read ───────────────────────────────────────────────────────────
    const snap = await tx.get(r.promotion);
    if (!snap.exists) return { outcome: 'fenced', reason: 'promotionMissing', status: null } as CloseResult;
    const doc = snap.data() as Record<string, unknown>;
    const status = (doc.status as PromotionStatus) ?? null;
    if (status === 'closing') return { outcome: 'alreadyClosing' } as CloseResult;
    if (status !== 'enabled') return { outcome: 'fenced', reason: 'notEnabled', status } as CloseResult;

    // The configuration must still be the one that was enabled. A drifted
    // document is not closed: it is tamper-evident and stays where it is.
    const read = readPromotion(doc);
    if (read.kind === 'fenced') {
      const reason: CloseFenceReason =
        read.reason === 'configDrift' ? 'configDrift' : read.reason === 'invalidConfig' ? 'invalidConfig' : 'notEnabled';
      return { outcome: 'fenced', reason, status } as CloseResult;
    }

    // ── the one write ──────────────────────────────────────────────────
    tx.update(r.promotion, {
      status: 'closing' satisfies PromotionStatus,
      closingRequestedAt: FieldValue.serverTimestamp(),
    });
    return { outcome: 'closed' } as CloseResult;
  });
}
