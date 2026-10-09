/**
 * EXPO PRIZE — the PROPOSED Firestore-created trigger, as a handler body only.
 *
 * NOT REGISTERED. No `onDocumentCreated` call exists in this module or
 * anywhere in this lane; registering one is central wiring (an index.ts
 * export) that needs an L0 reservation, and its first deployment needs
 * Eventarc enablement, service-agent IAM and a region matching the Firestore
 * database location — operator-verified facts, not assumptions.
 *
 * The body is what such a trigger would call, and it is tested in isolation
 * by handing it the path of a real emulator row. It finds every promotion
 * that lists the row's goal (one `array-contains` on `eligibleGoalIds`,
 * which needs no composite index), lets the award decide the rest, and
 * returns one result per promotion.
 */
import { ingestContribution, COLLECTIONS, type AwardDeps, type IngestResult } from './award';
import { AWARDING_STATUSES, type PromotionStatus } from './policy';

export async function onContributionCreatedBody(
  deps: AwardDeps,
  args: { contributionPath: string; goalId: string }
): Promise<Array<{ promotionId: string; result: IngestResult }>> {
  const snap = await deps.db
    .collection(COLLECTIONS.promotions)
    .where('eligibleGoalIds', 'array-contains', args.goalId)
    .get();
  const out: Array<{ promotionId: string; result: IngestResult }> = [];
  for (const doc of snap.docs) {
    const status = (doc.data() as { status?: PromotionStatus }).status;
    // Filtered in code, not in the query, so no second filter needs an index.
    // The award re-reads the promotion inside its transaction and fences on
    // its own; this is only a pre-filter that saves the round trip.
    if (!status || !AWARDING_STATUSES.has(status)) continue;
    out.push({
      promotionId: doc.id,
      result: await ingestContribution(deps, doc.id, args.contributionPath),
    });
  }
  return out;
}
