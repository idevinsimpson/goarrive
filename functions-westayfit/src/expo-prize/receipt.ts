/**
 * EXPO PRIZE — the private "My entries" read core (EXP3A). UNEXPORTED from
 * src/index.ts. No callable, no route, no UI; nothing here is reachable.
 *
 * ONE MEMBER, ONE PROMOTION, ONE MINIMAL TRUTHFUL RECEIPT. The caller is a
 * future authenticated server surface that hands in the TRUSTED uid from
 * the auth context and a promotion id — never a count, never an entrant id,
 * never anything the client claims. The answer is one of two shapes:
 *
 *   { status: 'ok', tickets: <exact>, settled: false }   enabled | closing
 *   { status: 'ok', tickets: <exact>, settled: true  }   frozen | drawn | archived, from the intact pool
 *   { status: 'unavailable' }                            draft | disabled | missing | any fence
 *
 * and nothing else. No prediction, no odds, no rank, no other entrant, no
 * total, no winner. `settled:false` is a provisional count of the member's
 * own confirmed entries as of the read; `settled:true` is the member's own
 * ticket count as the immutable pool recorded it. A member with no entrant
 * link is exactly zero either way: provisional before the freeze, final
 * after an intact one.
 *
 * FAILS CLOSED. A promotion whose configuration no longer validates or
 * matches its enablement digest, or whose frozen pool is absent, edited, or
 * not the pool that promotion froze, answers `unavailable` — never a number
 * the server cannot stand behind. `unavailable` is deliberately reasonless
 * on the wire; the reason goes to an optional trace hook for tests and
 * server logs, never to the member.
 *
 * READ-ONLY BY CONSTRUCTION: every Firestore read happens inside a
 * read-only transaction, so this module cannot write even by mistake.
 *
 * PRIVACY: the receipt is built through `sealReceipt`, which constructs a
 * fresh object carrying only the allow-listed keys. No uid, entrantId,
 * source key, contribution / attempt / entry / goal id, name, email,
 * contact, timestamp, range endpoint, pool digest, entrant count or pool
 * size can reach the response.
 */
import { FieldPath, type Firestore, type Transaction } from 'firebase-admin/firestore';

import { COLLECTIONS, refs } from './award';
import {
  configDigest,
  storedEligibleGoalIdsMatch,
  validatePromotionConfig,
  type PromotionStatus,
} from './policy';
import { storedPoolIntact, type PoolRecord } from './pool';

export type MyEntriesReceipt =
  | { status: 'ok'; tickets: number; settled: boolean }
  | { status: 'unavailable' };

/** Why a read answered as it did. For tests and server logs only; never part of the receipt. */
export type ReceiptTrace =
  | 'invalidInput'
  | 'promotionMissing'
  | 'promotionInactive'
  | 'invalidConfig'
  | 'configDrift'
  | 'poolMissing'
  | 'poolCorrupt'
  | 'poolUnbound'
  | 'linkMissing'
  | 'currentRead'
  | 'settledRead';

export type ReceiptDeps = {
  db: Firestore;
  /** Optional observer of the reason behind an answer. Receives no ids. */
  trace?: (reason: ReceiptTrace) => void;
};

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

/** Statuses answered from the member's own confirmed entries, provisionally. */
const CURRENT_STATUSES: ReadonlySet<PromotionStatus> = new Set(['enabled', 'closing']);
/** Statuses answered from the immutable pool, finally. */
const SETTLED_STATUSES: ReadonlySet<PromotionStatus> = new Set(['frozen', 'drawn', 'archived']);

/**
 * THE ONLY WAY A RECEIPT IS BUILT. A fresh object with exactly the allowed
 * keys; anything else passed in is dropped. Pure.
 */
export function sealReceipt(input: { status: 'ok'; tickets: number; settled: boolean } | { status: 'unavailable' }): MyEntriesReceipt {
  if (input.status !== 'ok') return { status: 'unavailable' };
  const tickets = Number.isInteger(input.tickets) && input.tickets >= 0 ? input.tickets : null;
  if (tickets === null) return { status: 'unavailable' };
  return { status: 'ok', tickets, settled: input.settled === true };
}

/** One entry as the current read needs it. */
export type ReceiptEntryInput = { status: unknown; tickets: unknown };

/**
 * The member's provisional ticket count from their own entries. PURE.
 * Only `confirmed` entries with a positive integer ticket count contribute;
 * `pending` (paper, next phase), `revoked`, and anything malformed count zero.
 */
export function ticketsFromEntries(entries: readonly ReceiptEntryInput[]): number {
  let total = 0;
  for (const e of entries) {
    if (e.status !== 'confirmed') continue;
    if (typeof e.tickets !== 'number' || !Number.isInteger(e.tickets) || e.tickets < 1) continue;
    total += e.tickets;
  }
  return total;
}

/**
 * The member's final ticket count from an intact pool. PURE. An entrant
 * absent from the pool has exactly zero tickets. A range that is not a
 * well-formed 1-based inclusive interval makes the pool unusable (null).
 */
export function ticketsFromPool(pool: PoolRecord, entrantId: string): number | null {
  let found: number | null = 0;
  for (const r of pool.ranges) {
    if (r.entrantId !== entrantId) continue;
    if (!Number.isInteger(r.ticketStart) || !Number.isInteger(r.ticketEnd) || r.ticketStart < 1 || r.ticketEnd < r.ticketStart) {
      return null;
    }
    // An entrant appears at most once in a canonical pool; a second range is corruption.
    if (found !== 0) return null;
    found = r.ticketEnd - r.ticketStart + 1;
  }
  return found;
}

/**
 * Does the stored promotion document still carry the configuration that was
 * enabled? The same test the award applies (validate, derived array, digest),
 * applied here regardless of status so a frozen promotion is held to it too.
 */
function configIntact(doc: Record<string, unknown>): { ok: true; ruleVersion: number; digest: string } | { ok: false; reason: 'invalidConfig' | 'configDrift' } {
  const validation = validatePromotionConfig(doc);
  if (!validation.ok) return { ok: false, reason: 'invalidConfig' };
  if (!storedEligibleGoalIdsMatch(doc.eligibleGoalIds, validation.policy)) return { ok: false, reason: 'configDrift' };
  const digest = configDigest(validation.policy);
  if (doc.enabledConfigDigest !== digest) return { ok: false, reason: 'configDrift' };
  return { ok: true, ruleVersion: validation.policy.ruleVersion, digest };
}

async function readLinkedEntrant(tx: Transaction, r: ReturnType<typeof refs>, uid: string): Promise<string | null> {
  const linkSnap = await tx.get(r.link(uid));
  const entrantId = (linkSnap.data() as { entrantId?: unknown } | undefined)?.entrantId;
  return linkSnap.exists && typeof entrantId === 'string' && ID_RE.test(entrantId) ? entrantId : null;
}

/** The member's own entries under the promotion, read inside the transaction. Equality + document-name order, the reconcile's index-free shape. */
async function readOwnEntries(tx: Transaction, db: Firestore, promotionId: string, entrantId: string): Promise<ReceiptEntryInput[]> {
  const q = db
    .collection(COLLECTIONS.entries)
    .where('entrantId', '==', entrantId)
    .orderBy(FieldPath.documentId())
    .startAt(`${promotionId}_`)
    .endAt(`${promotionId}_`);
  const snap = await tx.get(q);
  return snap.docs.map((d) => {
    const x = d.data() as Record<string, unknown>;
    return { status: x.status, tickets: x.tickets };
  });
}

/**
 * THE READ. `uid` is the trusted authenticated subject; `promotionId` names
 * the promotion. Nothing else is accepted. See the header for the answer
 * table. Every read is inside one read-only transaction.
 */
export async function readMyEntries(deps: ReceiptDeps, args: { uid: string; promotionId: string }): Promise<MyEntriesReceipt> {
  const trace = deps.trace ?? (() => undefined);
  const uid = typeof args.uid === 'string' ? args.uid : '';
  const promotionId = typeof args.promotionId === 'string' ? args.promotionId : '';
  if (!ID_RE.test(uid) || !ID_RE.test(promotionId)) {
    trace('invalidInput');
    return sealReceipt({ status: 'unavailable' });
  }
  const db = deps.db;
  const r = refs(db, promotionId);

  return db.runTransaction(
    async (tx) => {
      const promoSnap = await tx.get(r.promotion);
      if (!promoSnap.exists) {
        trace('promotionMissing');
        return sealReceipt({ status: 'unavailable' });
      }
      const doc = promoSnap.data() as Record<string, unknown>;
      const status = doc.status as PromotionStatus;

      // ── provisional: the member's own confirmed entries ─────────────────
      if (CURRENT_STATUSES.has(status)) {
        const config = configIntact(doc);
        if (!config.ok) {
          trace(config.reason);
          return sealReceipt({ status: 'unavailable' });
        }
        const entrantId = await readLinkedEntrant(tx, r, uid);
        if (entrantId === null) {
          trace('linkMissing');
          return sealReceipt({ status: 'ok', tickets: 0, settled: false });
        }
        const entries = await readOwnEntries(tx, db, promotionId, entrantId);
        trace('currentRead');
        return sealReceipt({ status: 'ok', tickets: ticketsFromEntries(entries), settled: false });
      }

      // ── final: the immutable pool, held to the promotion it froze ────────
      if (SETTLED_STATUSES.has(status)) {
        const config = configIntact(doc);
        if (!config.ok) {
          trace(config.reason);
          return sealReceipt({ status: 'unavailable' });
        }
        const poolSnap = await tx.get(r.pool);
        if (!poolSnap.exists) {
          trace('poolMissing');
          return sealReceipt({ status: 'unavailable' });
        }
        const pool = poolSnap.data();
        if (!storedPoolIntact(pool)) {
          trace('poolCorrupt');
          return sealReceipt({ status: 'unavailable' });
        }
        // The pool must be THIS promotion's frozen pool: same enablement
        // digest, same rule version, and the digest the freeze stamped on
        // the promotion. A pool copied from elsewhere or re-frozen by hand
        // does not answer for anyone.
        if (pool.enabledConfigDigest !== config.digest || pool.ruleVersion !== config.ruleVersion || doc.poolDigest !== pool.poolDigest) {
          trace('poolUnbound');
          return sealReceipt({ status: 'unavailable' });
        }
        const entrantId = await readLinkedEntrant(tx, r, uid);
        if (entrantId === null) {
          trace('linkMissing');
          return sealReceipt({ status: 'ok', tickets: 0, settled: true });
        }
        const tickets = ticketsFromPool(pool, entrantId);
        if (tickets === null) {
          trace('poolCorrupt');
          return sealReceipt({ status: 'unavailable' });
        }
        trace('settledRead');
        return sealReceipt({ status: 'ok', tickets, settled: true });
      }

      // draft, disabled, anything unknown: nothing is owed and nothing is promised.
      trace('promotionInactive');
      return sealReceipt({ status: 'unavailable' });
    },
    { readOnly: true }
  );
}
