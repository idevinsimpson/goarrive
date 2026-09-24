/**
 * EXPO PRIZE — the typed promotion contract.
 *
 * A promotion is a server-only configuration document. Nothing here is
 * exported from functions-westayfit/src/index.ts; nothing here is reachable
 * from a client. See docs/westayfit/expo-prize/CONTRACT.md §(b) and §(d).
 *
 * THE CODE REFUSES TO DEFAULT THE OWNER'S DECISIONS. A promotion whose
 * configuration omits the repeat rule, the cap decision (a number, or an
 * explicit null meaning "no cap"), the eligible goals, the window or the rule
 * version does not validate, and a promotion that does not validate is fenced:
 * it awards nothing.
 */
import { createHash } from 'crypto';
import { Timestamp } from 'firebase-admin/firestore';

export type PromotionStatus =
  | 'draft'
  | 'enabled'
  | 'closing'
  | 'frozen'
  | 'drawn'
  | 'archived'
  | 'disabled';

/** The statuses under which a source may be adjudicated. Everything else is the fence. */
export const AWARDING_STATUSES: ReadonlySet<PromotionStatus> = new Set(['enabled', 'closing']);

/**
 * The eventual published rule for repeated legitimate rounds. Required at
 * enablement; never defaulted. `perContribution`: every distinct accepted
 * contribution is one entry. `perGoal`: one entry per goal per entrant.
 */
export type RepeatRule = 'perContribution' | 'perGoal';

export type EligibleGoal = { goalId: string; communityGroupId: string };

/** The validated, immutable shape the adjudicator works from. */
export type PromotionPolicy = {
  ruleVersion: number;
  repeatRule: RepeatRule;
  /** A number, or null for "explicitly no cap". Never undefined once validated. */
  entrantCap: number | null;
  /** goalId -> communityGroupId. A goal is eligible only under its own community. */
  eligibleGoals: ReadonlyMap<string, string>;
  windowStartMs: number;
  windowEndMs: number;
  /** Entries one qualifying community-interest form provides. */
  formBonusEntries: number;
};

export type PolicyProblem = { field: string; reason: string };

export type PolicyValidation =
  | { ok: true; policy: PromotionPolicy }
  | { ok: false; problems: PolicyProblem[] };

const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function idOrNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return ID_RE.test(t) ? t : null;
}

function millisOrNull(v: unknown): number | null {
  if (v instanceof Timestamp) return v.toMillis();
  if (v && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
    const ms = (v as { toMillis: () => unknown }).toMillis();
    return typeof ms === 'number' && Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/**
 * Validate a raw promotion document's configuration fields. Pure: no I/O.
 * Every missing decision is a named problem; the caller never sees a policy
 * with a defaulted field.
 */
export function validatePromotionConfig(raw: unknown): PolicyValidation {
  const problems: PolicyProblem[] = [];
  const doc = (raw ?? {}) as Record<string, unknown>;

  const ruleVersion = doc.ruleVersion;
  if (typeof ruleVersion !== 'number' || !Number.isInteger(ruleVersion) || ruleVersion < 1) {
    problems.push({ field: 'ruleVersion', reason: 'ruleVersion must be a positive integer.' });
  }

  const repeatRule = doc.repeatRule;
  if (repeatRule !== 'perContribution' && repeatRule !== 'perGoal') {
    problems.push({
      field: 'repeatRule',
      reason: "repeatRule must be 'perContribution' or 'perGoal' — the published rule for repeated rounds is a decision, not a default.",
    });
  }

  // The cap is a decision either way: a number, or an explicit null.
  if (!('entrantCap' in doc) || doc.entrantCap === undefined) {
    problems.push({
      field: 'entrantCap',
      reason: 'entrantCap must be a positive integer or an explicit null (no cap).',
    });
  } else if (
    doc.entrantCap !== null &&
    (typeof doc.entrantCap !== 'number' ||
      !Number.isInteger(doc.entrantCap) ||
      doc.entrantCap < 1)
  ) {
    problems.push({
      field: 'entrantCap',
      reason: 'entrantCap must be a positive integer or an explicit null (no cap).',
    });
  }

  const eligibleGoals = new Map<string, string>();
  if (!Array.isArray(doc.eligibleGoals) || doc.eligibleGoals.length === 0) {
    problems.push({ field: 'eligibleGoals', reason: 'eligibleGoals must list at least one goal.' });
  } else {
    for (const entry of doc.eligibleGoals as unknown[]) {
      const e = (entry ?? {}) as Record<string, unknown>;
      const goalId = idOrNull(e.goalId);
      const communityGroupId = idOrNull(e.communityGroupId);
      if (!goalId || !communityGroupId) {
        problems.push({
          field: 'eligibleGoals',
          reason: 'each eligible goal needs a goalId and its communityGroupId.',
        });
        continue;
      }
      if (eligibleGoals.has(goalId)) {
        problems.push({ field: 'eligibleGoals', reason: `goal ${goalId} is listed twice.` });
        continue;
      }
      eligibleGoals.set(goalId, communityGroupId);
    }
  }

  const windowStartMs = millisOrNull(doc.windowStartsAt);
  const windowEndMs = millisOrNull(doc.windowEndsAt);
  if (windowStartMs === null) {
    problems.push({ field: 'windowStartsAt', reason: 'windowStartsAt must be a Timestamp.' });
  }
  if (windowEndMs === null) {
    problems.push({ field: 'windowEndsAt', reason: 'windowEndsAt must be a Timestamp.' });
  }
  if (windowStartMs !== null && windowEndMs !== null && windowEndMs <= windowStartMs) {
    problems.push({ field: 'windowEndsAt', reason: 'windowEndsAt must be after windowStartsAt.' });
  }

  const formBonusEntries = doc.formBonusEntries;
  if (
    typeof formBonusEntries !== 'number' ||
    !Number.isInteger(formBonusEntries) ||
    formBonusEntries < 0
  ) {
    problems.push({
      field: 'formBonusEntries',
      reason: 'formBonusEntries must be a non-negative integer (0 disables the bonus).',
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    policy: {
      ruleVersion: ruleVersion as number,
      repeatRule: repeatRule as RepeatRule,
      entrantCap: doc.entrantCap as number | null,
      eligibleGoals,
      windowStartMs: windowStartMs as number,
      windowEndMs: windowEndMs as number,
      formBonusEntries: formBonusEntries as number,
    },
  };
}

/**
 * The digest an operator's enablement freezes. Canonical: sorted goal ids,
 * fixed field order, integers only. Stored as `enabledConfigDigest`; the
 * adjudicator recomputes it from the fields it reads and fences on mismatch.
 */
export function configDigest(policy: PromotionPolicy): string {
  const goals = [...policy.eligibleGoals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([goalId, communityGroupId]) => ({ goalId, communityGroupId }));
  const canonical = JSON.stringify({
    ruleVersion: policy.ruleVersion,
    repeatRule: policy.repeatRule,
    entrantCap: policy.entrantCap,
    eligibleGoals: goals,
    windowStartMs: policy.windowStartMs,
    windowEndMs: policy.windowEndMs,
    formBonusEntries: policy.formBonusEntries,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

export type FenceReason = 'promotionMissing' | 'promotionInactive' | 'invalidConfig' | 'configDrift';

export type PromotionRead =
  | { kind: 'fenced'; reason: FenceReason; status: PromotionStatus | null; problems?: PolicyProblem[] }
  | { kind: 'active'; status: 'enabled' | 'closing'; policy: PromotionPolicy };

/**
 * Decide, from a promotion document as read, whether a source may be
 * adjudicated at all. Pure. Order matters: an inactive promotion is fenced
 * before its configuration is even looked at, so a draft with half a config
 * is "inactive", not "invalid" — and a member is never told anything about a
 * promotion that is not running.
 */
export function readPromotion(raw: unknown | undefined): PromotionRead {
  if (raw === undefined || raw === null) {
    return { kind: 'fenced', reason: 'promotionMissing', status: null };
  }
  const doc = raw as Record<string, unknown>;
  const status = doc.status as PromotionStatus;
  if (!AWARDING_STATUSES.has(status)) {
    return { kind: 'fenced', reason: 'promotionInactive', status: status ?? null };
  }
  const validation = validatePromotionConfig(doc);
  if (!validation.ok) {
    return { kind: 'fenced', reason: 'invalidConfig', status, problems: validation.problems };
  }
  const digest = doc.enabledConfigDigest;
  if (typeof digest !== 'string' || digest !== configDigest(validation.policy)) {
    return { kind: 'fenced', reason: 'configDrift', status };
  }
  return { kind: 'active', status: status as 'enabled' | 'closing', policy: validation.policy };
}

/**
 * The window test every source is held to, on the source's OWN commit
 * instant — never on the clock at processing time. Start inclusive, end
 * exclusive, the same convention performContribution uses for the goal window.
 */
export function withinWindow(policy: PromotionPolicy, committedAtMs: number): 'ok' | 'beforeWindow' | 'afterCutoff' {
  if (committedAtMs < policy.windowStartMs) return 'beforeWindow';
  if (committedAtMs >= policy.windowEndMs) return 'afterCutoff';
  return 'ok';
}
