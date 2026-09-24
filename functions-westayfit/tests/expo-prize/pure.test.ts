/**
 * PURE-CORE ROWS — no Firestore. These prove logic, never atomicity, and the
 * evidence labels them as such. Matrix rows 19, 23, 25 (digest half), 27.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp } from 'firebase-admin/firestore';

import {
  adjudicateContribution,
  classifyEntryStatus,
  configDigest,
  contributionDocIdFromPath,
  EMPTY_TALLY,
  readPromotion,
  validatePromotionConfig,
  withinWindow,
} from '../../src/expo-prize';

const now = Date.now();
function baseConfig(): Record<string, unknown> {
  return {
    status: 'enabled',
    ruleVersion: 1,
    repeatRule: 'perContribution',
    entrantCap: null,
    eligibleGoals: [{ goalId: 'goalA', communityGroupId: 'grpA' }],
    windowStartsAt: Timestamp.fromMillis(now - 1000),
    windowEndsAt: Timestamp.fromMillis(now + 1000),
    formBonusEntries: 1,
  };
}

describe('[pure] row 23 — enabling requires explicit decisions', () => {
  test('a complete configuration validates; entrantCap null is "explicitly no cap"', () => {
    const v = validatePromotionConfig(baseConfig());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.policy.entrantCap).toBeNull();
  });

  test.each([
    ['repeatRule', (c: Record<string, unknown>) => delete c.repeatRule],
    ['repeatRule', (c: Record<string, unknown>) => (c.repeatRule = 'onePerActivity')],
    ['entrantCap', (c: Record<string, unknown>) => delete c.entrantCap],
    ['entrantCap', (c: Record<string, unknown>) => (c.entrantCap = 0)],
    ['entrantCap', (c: Record<string, unknown>) => (c.entrantCap = 2.5)],
    ['eligibleGoals', (c: Record<string, unknown>) => (c.eligibleGoals = [])],
    ['eligibleGoals', (c: Record<string, unknown>) => (c.eligibleGoals = [{ goalId: 'g' }])],
    ['windowEndsAt', (c: Record<string, unknown>) => (c.windowEndsAt = c.windowStartsAt)],
    ['windowStartsAt', (c: Record<string, unknown>) => delete c.windowStartsAt],
    ['ruleVersion', (c: Record<string, unknown>) => delete c.ruleVersion],
    ['ruleVersion', (c: Record<string, unknown>) => (c.ruleVersion = 0)],
    ['formBonusEntries', (c: Record<string, unknown>) => (c.formBonusEntries = -1)],
  ])('refuses with the field named: %s', (field, mutate) => {
    const c = baseConfig();
    mutate(c);
    const v = validatePromotionConfig(c);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.problems.map((p) => p.field)).toContain(field);
  });

  test('a goal listed twice is refused', () => {
    const c = baseConfig();
    c.eligibleGoals = [
      { goalId: 'goalA', communityGroupId: 'grpA' },
      { goalId: 'goalA', communityGroupId: 'grpB' },
    ];
    expect(validatePromotionConfig(c).ok).toBe(false);
  });
});

describe('[pure] row 25 — the digest is canonical and drift is detected', () => {
  test('goal order does not change the digest; any decision does', () => {
    const a = validatePromotionConfig({
      ...baseConfig(),
      eligibleGoals: [
        { goalId: 'b', communityGroupId: 'g' },
        { goalId: 'a', communityGroupId: 'g' },
      ],
    });
    const b = validatePromotionConfig({
      ...baseConfig(),
      eligibleGoals: [
        { goalId: 'a', communityGroupId: 'g' },
        { goalId: 'b', communityGroupId: 'g' },
      ],
    });
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) {
      expect(configDigest(a.policy)).toBe(configDigest(b.policy));
      const changed = validatePromotionConfig({ ...baseConfig(), eligibleGoals: b.policy && [{ goalId: 'a', communityGroupId: 'g' }], repeatRule: 'perGoal' });
      if (changed.ok) expect(configDigest(changed.policy)).not.toBe(configDigest(b.policy));
    }
  });

  test('readPromotion: inactive before invalid before drift before active', () => {
    expect(readPromotion(undefined)).toMatchObject({ kind: 'fenced', reason: 'promotionMissing' });
    expect(readPromotion({ ...baseConfig(), status: 'draft' })).toMatchObject({ kind: 'fenced', reason: 'promotionInactive' });
    expect(readPromotion({ ...baseConfig(), status: 'disabled', repeatRule: undefined })).toMatchObject({ kind: 'fenced', reason: 'promotionInactive' });
    expect(readPromotion({ ...baseConfig(), repeatRule: undefined })).toMatchObject({ kind: 'fenced', reason: 'invalidConfig' });
    expect(readPromotion({ ...baseConfig() })).toMatchObject({ kind: 'fenced', reason: 'configDrift' });
    const v = validatePromotionConfig(baseConfig());
    if (!v.ok) throw new Error('fixture');
    const withDigest = { ...baseConfig(), enabledConfigDigest: configDigest(v.policy) };
    expect(readPromotion(withDigest)).toMatchObject({ kind: 'active', status: 'enabled' });
    expect(readPromotion({ ...withDigest, status: 'closing' })).toMatchObject({ kind: 'active', status: 'closing' });
    expect(readPromotion({ ...withDigest, ruleVersion: 2 })).toMatchObject({ kind: 'fenced', reason: 'configDrift' });
    for (const status of ['frozen', 'drawn', 'archived']) {
      expect(readPromotion({ ...withDigest, status })).toMatchObject({ kind: 'fenced', reason: 'promotionInactive' });
    }
  });
});

describe('[pure] row 27 — only wsfContributions/{id} is a source path', () => {
  test.each([
    'wsfGoalCounters/goalA/shards/0',
    'wsfGoalMemberTotals/goalA_uid',
    'wsfGoals/goalA/recentAdditions/attempt',
    'wsfTurnReceipts/line__uid',
    'wsfCombinedCredits/goalA_uid_attempt',
    'wsfContributions',
    'wsfContributions/goalA_uid_attempt/anything/else',
    '/wsfContributions/goalA_uid_attempt/',
    'wsfcontributions/goalA_uid_attempt',
    'wsfContributions/has space',
  ])('refuses %s', (path) => {
    expect(contributionDocIdFromPath(path)).toBeNull();
  });

  test('accepts the canonical shape', () => {
    expect(contributionDocIdFromPath('wsfContributions/goalA_uid_attempt-1')).toBe('goalA_uid_attempt-1');
  });
});

describe('[pure] the movement verdict ignores count and holds the row to the window', () => {
  const v = validatePromotionConfig(baseConfig());
  if (!v.ok) throw new Error('fixture');
  const policy = v.policy;
  const row = (over: Partial<Parameters<typeof adjudicateContribution>[0]['row'] & object>) => ({
    goalId: 'goalA',
    userId: 'u1',
    attemptId: 'attempt-1',
    communityGroupId: 'grpA',
    count: 1,
    createdAtMs: now,
    ...over,
  });
  const docId = 'goalA_u1_attempt-1';

  test('1 rep and 100 reps: the same verdict and the same entry id', () => {
    const one = adjudicateContribution({ policy, contributionDocId: docId, row: row({ count: 1 }), tally: EMPTY_TALLY });
    const hundred = adjudicateContribution({ policy, contributionDocId: docId, row: row({ count: 100 }), tally: EMPTY_TALLY });
    expect(one).toEqual(hundred);
    expect(one).toMatchObject({ verdict: 'accepted', kind: 'movement', entryId: `c_${docId}` });
  });

  test.each([
    ['sourceMissing', null],
    ['sourceMismatch', row({ attemptId: 'attempt-2' })],
    ['goalNotInPromotion', row({ goalId: 'goalZ' })],
    ['communityMismatch', row({ communityGroupId: 'grpZ' })],
    ['beforeWindow', row({ createdAtMs: now - 5000 })],
    ['afterCutoff', row({ createdAtMs: now + 5000 })],
  ] as const)('refuses: %s', (reason, r) => {
    const docFor = r ? `${r.goalId}_${r.userId}_attempt-1` : docId;
    expect(adjudicateContribution({ policy, contributionDocId: docFor, row: r as never, tally: EMPTY_TALLY })).toEqual({ verdict: 'refused', reason });
  });

  test('perGoal blocks a second entry on the same goal; perContribution does not', () => {
    const tally = { entryCount: 1, formBonusAwarded: false, movementGoals: { goalA: true as const } };
    expect(adjudicateContribution({ policy: { ...policy, repeatRule: 'perGoal' }, contributionDocId: docId, row: row({}), tally })).toEqual({ verdict: 'refused', reason: 'goalAlreadyEntered' });
    expect(adjudicateContribution({ policy, contributionDocId: docId, row: row({}), tally })).toMatchObject({ verdict: 'accepted' });
  });

  test('window: start inclusive, end exclusive', () => {
    expect(withinWindow(policy, policy.windowStartMs)).toBe('ok');
    expect(withinWindow(policy, policy.windowEndMs)).toBe('afterCutoff');
    expect(withinWindow(policy, policy.windowEndMs - 1)).toBe('ok');
  });
});

describe('[pure] row 19 — pending and unknown are distinct from confirmed', () => {
  test('the four answers', () => {
    expect(classifyEntryStatus({ promotion: 'active', goalEligible: true, contributionExists: true, source: null })).toEqual({ status: 'pending' });
    expect(classifyEntryStatus({ promotion: 'active', goalEligible: true, contributionExists: true, source: { verdict: 'accepted' } })).toEqual({ status: 'confirmed' });
    expect(classifyEntryStatus({ promotion: 'active', goalEligible: true, contributionExists: true, source: { verdict: 'refused', reason: 'afterCutoff' } })).toEqual({ status: 'notEntered', reason: 'afterCutoff' });
    expect(classifyEntryStatus({ promotion: 'active', goalEligible: true, contributionExists: false, source: null })).toEqual({ status: 'unknown' });
  });

  test('a contribution to a goal the promotion never listed is not "pending" (W7 note)', () => {
    expect(classifyEntryStatus({ promotion: 'active', goalEligible: false, contributionExists: true, source: null })).toEqual({ status: 'notEntered', reason: 'goalNotInPromotion' });
    expect(classifyEntryStatus({ promotion: 'active', goalEligible: false, contributionExists: false, source: null })).toEqual({ status: 'unknown' });
  });

  test('row 21 (pure half): an inactive promotion is never "pending", whatever else is true', () => {
    for (const promotion of ['inactive', 'missing'] as const) {
      expect(classifyEntryStatus({ promotion, goalEligible: true, contributionExists: true, source: null })).toEqual({ status: 'notEntered', reason: 'promotionInactive' });
      expect(classifyEntryStatus({ promotion, goalEligible: true, contributionExists: true, source: { verdict: 'accepted' } })).toEqual({ status: 'notEntered', reason: 'promotionInactive' });
    }
  });
});
