/**
 * EXPO PRIZE — bounded reconciliation over committed canonical sources.
 *
 * One page at a time, over ONE goal's wsfContributions rows, ordered by
 * document name after a cursor. Equality on one field plus document-name
 * order needs no composite index. The cutoff is applied per row by the
 * award (on the row's own createdAt), never by the query.
 *
 * Interrupt it anywhere and run it again: every ingest is idempotent, so the
 * end state is the same and the pass that finds nothing new to write is the
 * proof of convergence.
 */
import { FieldPath, type Firestore, type Query } from 'firebase-admin/firestore';

import { CONTRIBUTIONS_COLLECTION } from './adjudicate';
import { ingestContribution, refs, type AwardDeps } from './award';
import { readPromotion } from './policy';

export type ReconcileDeps = AwardDeps & {
  /** TEST-ONLY: throw after this many rows have been ingested in one page call. */
  faultAfter?: number;
};

export type ReconcilePage = {
  processed: number;
  accepted: number;
  refused: number;
  replayed: number;
  fenced: number;
  /** Rows that were neither replayed nor fenced: the number of NEW source rows written. */
  writes: number;
  nextCursor: string | null;
  done: boolean;
};

/** Clamp a requested page size to the bounded range every pass uses. */
export function clampPageSize(pageSize: number): number {
  return Math.max(1, Math.min(500, Math.floor(pageSize)));
}

/**
 * THE ONE PAGE QUERY. Equality on `goalId`, ordered by document name, after
 * a cursor, bounded. Shared by the reconciliation pass and the freeze pass
 * (EXP2B) so both walk the ledger in exactly the same order and shape.
 */
export function contributionPageQuery(
  db: Firestore,
  goalId: string,
  cursor: string | null | undefined,
  pageSize: number
): Query {
  let query = db
    .collection(CONTRIBUTIONS_COLLECTION)
    .where('goalId', '==', goalId)
    .orderBy(FieldPath.documentId())
    .limit(pageSize);
  if (cursor) query = query.startAfter(cursor);
  return query;
}

export async function reconcileGoal(
  deps: ReconcileDeps,
  promotionId: string,
  goalId: string,
  opts: { cursor?: string | null; pageSize: number }
): Promise<ReconcilePage> {
  const db: Firestore = deps.db;
  const pageSize = clampPageSize(opts.pageSize);
  const query = contributionPageQuery(db, goalId, opts.cursor, pageSize);

  const page: ReconcilePage = {
    processed: 0,
    accepted: 0,
    refused: 0,
    replayed: 0,
    fenced: 0,
    writes: 0,
    nextCursor: null,
    done: false,
  };
  const snap = await query.get();
  for (const doc of snap.docs) {
    if (deps.faultAfter !== undefined && page.processed >= deps.faultAfter) {
      throw new Error(`reconcile fault injected after ${page.processed} rows`);
    }
    const result = await ingestContribution(deps, promotionId, doc.ref.path);
    page.processed += 1;
    page.nextCursor = doc.id;
    switch (result.outcome) {
      case 'accepted':
        page.accepted += 1;
        page.writes += 1;
        break;
      case 'refused':
        page.refused += 1;
        if (result.recorded) page.writes += 1;
        break;
      case 'replay':
        page.replayed += 1;
        break;
      case 'fenced':
        page.fenced += 1;
        break;
    }
  }
  page.done = snap.size < pageSize;
  return page;
}

export type ReconcileSummary = {
  goals: Record<string, { processed: number; writes: number; fenced: number }>;
  processed: number;
  writes: number;
  fenced: number;
  /** True when a full pass wrote nothing new and nothing was fenced: converged. */
  converged: boolean;
};

/**
 * A full pass over every eligible goal of the promotion. Bounded by page
 * size per query; the loop over pages is sequential. Returns `converged`
 * when the pass wrote nothing — the precondition a later close→freeze
 * transition must see before it freezes the pool.
 */
export async function reconcilePromotion(
  deps: ReconcileDeps,
  promotionId: string,
  opts: { pageSize: number }
): Promise<ReconcileSummary> {
  const promoSnap = await refs(deps.db, promotionId).promotion.get();
  const promotion = readPromotion(promoSnap.exists ? promoSnap.data() : undefined);
  const summary: ReconcileSummary = { goals: {}, processed: 0, writes: 0, fenced: 0, converged: false };
  if (promotion.kind === 'fenced') {
    // Nothing to reconcile and nothing written; a fenced promotion is not "converged".
    return summary;
  }
  for (const goalId of promotion.policy.eligibleGoals.keys()) {
    const perGoal = { processed: 0, writes: 0, fenced: 0 };
    let cursor: string | null = null;
    for (;;) {
      const page: ReconcilePage = await reconcileGoal(deps, promotionId, goalId, {
        cursor,
        pageSize: opts.pageSize,
      });
      perGoal.processed += page.processed;
      perGoal.writes += page.writes;
      perGoal.fenced += page.fenced;
      cursor = page.nextCursor;
      if (page.done) break;
    }
    summary.goals[goalId] = perGoal;
    summary.processed += perGoal.processed;
    summary.writes += perGoal.writes;
    summary.fenced += perGoal.fenced;
  }
  summary.converged = summary.writes === 0 && summary.fenced === 0;
  return summary;
}
