/**
 * PROGRESS-SELF-HISTORY-1 (#365 6128740540): the caller's own recorded
 * contributions, newest first, for personal self-comparison on Progress.
 *
 * DRAFT authored in the Lovable Web Twin project (backend-canonical/), written
 * against idevinsimpson/goarrive @ a6eaf0be95cb0a81de4f24bc6d7f30ac82ce922f.
 * W9 copies it into a goarrive PR; nothing here is served until a CLAUDE-ANSWER
 * says SERVED.
 *
 * Reads only wsfContributions rows whose userId is the caller. Rows are the
 * ones wsfContribute writes (wsfContributions/{goalId}_{uid}_{attemptId}).
 * These are RECORDED contributions: a Champion correction (wsfAdjustGoal)
 * changes totals, not these rows, so they must never be summed into credit.
 * Credit stays with wsfMyContribution.
 *
 * An unwritten server time is not a fact: a row without a Firestore Timestamp
 * createdAt, a positive finite count, or non-empty goalId/unit/communityGroupId
 * is skipped, never defaulted.
 */
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import { requireRealIdentity } from './anon-gate';

export const MY_CONTRIBUTIONS_DEFAULT_LIMIT = 50;
export const MY_CONTRIBUTIONS_MAX_LIMIT = 100;

export type MyContributionItem = {
  attemptId: string;
  goalId: string;
  communityId: string;
  amount: number;
  unit: string;
  at: string;
};
export type MyContributionsResponse = { items: MyContributionItem[]; truncated: boolean };

/** A number is floored then clamped to 1..100; anything else means 50. */
export function clampMyContributionsLimit(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MY_CONTRIBUTIONS_DEFAULT_LIMIT;
  return Math.min(MY_CONTRIBUTIONS_MAX_LIMIT, Math.max(1, Math.floor(raw)));
}

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** Maps one stored row, or null when any required fact is missing. Never invents a value. */
export function toMyContributionItem(data: Record<string, unknown>): MyContributionItem | null {
  const { attemptId, goalId, communityGroupId, count, unit, createdAt } = data;
  if (!(createdAt instanceof Timestamp)) return null;
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null;
  if (!nonEmpty(attemptId) || !nonEmpty(goalId) || !nonEmpty(unit) || !nonEmpty(communityGroupId)) return null;
  return { attemptId, goalId, communityId: communityGroupId, amount: count, unit, at: createdAt.toDate().toISOString() };
}

export const wsfMyContributions = onCall<{ limit?: unknown }>({ region: 'us-central1' }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  requireRealIdentity(request);
  const uid = request.auth.uid;
  const limit = clampMyContributionsLimit(request.data?.limit);

  let snap;
  try {
    snap = await getFirestore()
      .collection('wsfContributions')
      .where('userId', '==', uid)
      .orderBy('createdAt', 'desc')
      .limit(limit + 1)
      .get();
  } catch (e) {
    const code = typeof (e as { code?: unknown })?.code === 'string' || typeof (e as { code?: unknown })?.code === 'number'
      ? String((e as { code: unknown }).code) : 'unknown';
    console.error('wsfMyContributions.read_failed', code);
    throw new HttpsError('unavailable', 'Your history could not be read. Try again.');
  }

  const truncated = snap.docs.length > limit;
  const items: MyContributionItem[] = [];
  for (const doc of snap.docs.slice(0, limit)) {
    const data = doc.data();
    // Defense in depth: the query already scopes to the caller.
    if (data.userId !== uid) continue;
    const item = toMyContributionItem(data);
    if (item) items.push(item);
  }
  const response: MyContributionsResponse = { items, truncated };
  return response;
});
