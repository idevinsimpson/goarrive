/**
 * EXPO PRIZE — deterministic source adjudication. PURE: no I/O, no clock.
 *
 * Given what the transaction read, decide the verdict. The same inputs always
 * give the same verdict, which is what lets at-least-once and out-of-order
 * ingestion converge: the durable source row stores the verdict once and every
 * later observation returns it.
 */
import type { PromotionPolicy, RepeatRule } from './policy';
import { withinWindow } from './policy';

export const CONTRIBUTIONS_COLLECTION = 'wsfContributions';

/** What a canonical wsfContributions row must carry to be a source. */
export type ContributionRow = {
  goalId: string;
  userId: string;
  attemptId: string;
  communityGroupId: string;
  count: number;
  /** The server timestamp performContribution wrote inside its own transaction. */
  createdAtMs: number;
};

/** The per-entrant facts the award transaction reads by name. */
export type EntrantTally = {
  entryCount: number;
  formBonusAwarded: boolean;
  /** goalId -> true once a movement entry has been awarded for that goal. */
  movementGoals: Record<string, true>;
};

export const EMPTY_TALLY: EntrantTally = { entryCount: 0, formBonusAwarded: false, movementGoals: {} };

export type RefusalReason =
  | 'notAContributionPath'
  | 'sourceMissing'
  | 'sourceMalformed'
  | 'sourceMismatch'
  | 'goalNotInPromotion'
  | 'communityMismatch'
  | 'beforeWindow'
  | 'afterCutoff'
  | 'goalAlreadyEntered'
  | 'capReached'
  | 'unknownReceipt'
  | 'subjectMismatch'
  | 'bonusAlreadyAwarded'
  | 'bonusDisabled';

export type Verdict =
  | { verdict: 'accepted'; kind: 'movement' | 'formBonus'; sourceKey: string; entryId: string }
  | { verdict: 'refused'; reason: RefusalReason };

/**
 * Is this path a canonical contribution document? ONLY `wsfContributions/{id}`
 * — one segment under the one collection. `wsfCombinedCredits/...`,
 * `wsfGoalCounters/...`, `wsfGoals/x/recentAdditions/y`, `wsfTurnReceipts/...`
 * and anything nested are not sources, whatever they contain.
 */
export function contributionDocIdFromPath(path: string): string | null {
  // Exactly `wsfContributions/{id}` — the form DocumentReference.path takes.
  // No leading or trailing slash, no empty segment, no nesting.
  const segments = path.split('/');
  if (segments.length !== 2) return null;
  if (segments[0] !== CONTRIBUTIONS_COLLECTION) return null;
  const id = segments[1];
  if (!/^[A-Za-z0-9_-]{1,1400}$/.test(id)) return null;
  return id;
}

/** Source key for a movement source: the promotion-scoped canonical identity. */
export function movementSourceKey(contributionDocId: string): string {
  return `c_${contributionDocId}`;
}

/** Source key for a form receipt: one adjudication per receipt id. */
export function formSourceKey(receiptId: string): string {
  return `f_${receiptId}`;
}

/** Entry id for the one-time form bonus: one per entrant, whatever the receipt. */
export function formEntryId(entrantId: string): string {
  return `b_${entrantId}`;
}

/**
 * Read a raw wsfContributions document into a ContributionRow, or null when it
 * is not one. `createdAt` must be a server Timestamp; a row without it has no
 * commit instant and cannot be held to a cutoff, so it is malformed here even
 * though performContribution always writes it.
 */
export function readContributionRow(raw: unknown): ContributionRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const goalId = typeof d.goalId === 'string' ? d.goalId : null;
  const userId = typeof d.userId === 'string' ? d.userId : null;
  const attemptId = typeof d.attemptId === 'string' ? d.attemptId : null;
  const communityGroupId = typeof d.communityGroupId === 'string' ? d.communityGroupId : null;
  const count = typeof d.count === 'number' && Number.isInteger(d.count) && d.count >= 1 ? d.count : null;
  const createdAt = d.createdAt as { toMillis?: () => number } | undefined;
  const createdAtMs =
    createdAt && typeof createdAt.toMillis === 'function' ? createdAt.toMillis() : null;
  if (!goalId || !userId || !attemptId || !communityGroupId || count === null || createdAtMs === null) {
    return null;
  }
  return { goalId, userId, attemptId, communityGroupId, count, createdAtMs };
}

/**
 * THE MOVEMENT VERDICT. `count` is deliberately not consulted: one qualifying
 * completed challenge is one entry whether it was 1 repetition or 100.
 */
export function adjudicateContribution(input: {
  policy: PromotionPolicy;
  contributionDocId: string;
  row: ContributionRow | null;
  tally: EntrantTally;
}): Verdict {
  const { policy, contributionDocId, row, tally } = input;
  if (!row) return { verdict: 'refused', reason: 'sourceMissing' };

  // The row must be the document it claims to be: name and fields agree.
  if (`${row.goalId}_${row.userId}_${row.attemptId}` !== contributionDocId) {
    return { verdict: 'refused', reason: 'sourceMismatch' };
  }

  const community = policy.eligibleGoals.get(row.goalId);
  if (community === undefined) return { verdict: 'refused', reason: 'goalNotInPromotion' };
  if (community !== row.communityGroupId) return { verdict: 'refused', reason: 'communityMismatch' };

  const window = withinWindow(policy, row.createdAtMs);
  if (window !== 'ok') return { verdict: 'refused', reason: window };

  if (repeatBlocks(policy.repeatRule, tally, row.goalId)) {
    return { verdict: 'refused', reason: 'goalAlreadyEntered' };
  }

  const sourceKey = movementSourceKey(contributionDocId);
  return { verdict: 'accepted', kind: 'movement', sourceKey, entryId: sourceKey };
}

function repeatBlocks(rule: RepeatRule, tally: EntrantTally, goalId: string): boolean {
  if (rule === 'perContribution') return false;
  return tally.movementGoals[goalId] === true;
}

/** What the trusted form seam returns for a receipt id, after re-reading it server-side. */
export type FormReceipt = {
  receiptId: string;
  /** The verified account the form was completed under. */
  subjectUid: string;
  completedAtMs: number;
};

/**
 * THE FORM VERDICT. The receipt was re-read by the server; the claimant is the
 * uid on whose behalf the bonus is claimed. Consent is not an input: a
 * marketing opt-in or opt-out cannot reach this function.
 */
export function adjudicateFormReceipt(input: {
  policy: PromotionPolicy;
  receipt: FormReceipt | null;
  claimantUid: string;
  entrantId: string;
  tally: EntrantTally;
}): Verdict {
  const { policy, receipt, claimantUid, entrantId, tally } = input;
  if (policy.formBonusEntries < 1) return { verdict: 'refused', reason: 'bonusDisabled' };
  if (!receipt) return { verdict: 'refused', reason: 'unknownReceipt' };
  if (receipt.subjectUid !== claimantUid) return { verdict: 'refused', reason: 'subjectMismatch' };
  const window = withinWindow(policy, receipt.completedAtMs);
  if (window !== 'ok') return { verdict: 'refused', reason: window };
  if (tally.formBonusAwarded) return { verdict: 'refused', reason: 'bonusAlreadyAwarded' };
  return {
    verdict: 'accepted',
    kind: 'formBonus',
    sourceKey: formSourceKey(receipt.receiptId),
    entryId: formEntryId(entrantId),
  };
}
