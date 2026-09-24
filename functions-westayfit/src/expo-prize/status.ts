/**
 * EXPO PRIZE — the member-facing status classifier. PURE.
 *
 * The next-phase "My entries" receipt reads three facts and asks this function
 * what to say. `pending` is a real state — the movement is confirmed and the
 * award has not been processed yet — and it is distinct from `confirmed`. A
 * promotion that is not running never yields `pending`: nothing is owed.
 */
import type { RefusalReason } from './adjudicate';

export type EntryStatus =
  | { status: 'confirmed' }
  | { status: 'pending' }
  | { status: 'notEntered'; reason: RefusalReason | 'promotionInactive' }
  | { status: 'unknown' };

export function classifyEntryStatus(input: {
  promotion: 'active' | 'inactive' | 'missing';
  contributionExists: boolean;
  source: null | { verdict: 'accepted' } | { verdict: 'refused'; reason: RefusalReason };
}): EntryStatus {
  if (input.promotion !== 'active') {
    return { status: 'notEntered', reason: 'promotionInactive' };
  }
  if (!input.contributionExists) return { status: 'unknown' };
  if (input.source === null) return { status: 'pending' };
  if (input.source.verdict === 'accepted') return { status: 'confirmed' };
  return { status: 'notEntered', reason: input.source.reason };
}
