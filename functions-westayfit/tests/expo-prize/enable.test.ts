/**
 * EXP2A — the enable transition on real emulator transactions. Proofs 1–6
 * of the Director's packet (#467 5810305427).
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import { contribute, count, member, promotionState, seedCommunity, seedGoal, seedPromotion, setPromotion, uniq } from './fixtures';
import {
  COLLECTIONS,
  configDigest,
  enablePromotion,
  ingestContribution,
  onContributionCreatedBody,
  readPromotion,
  validatePromotionConfig,
  type AwardDeps,
} from '../../src/expo-prize';

const deps = (): AwardDeps => ({ db: getFirestore() });

async function scene() {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalA = await seedGoal({ groupId, title: 'A' });
  const goalB = await seedGoal({ groupId, title: 'B' });
  return { groupId, goalA, goalB };
}

/** A complete draft: every decision present, no digest, no enabledAt. */
async function draft(goals: { goalId: string; communityGroupId: string }[], over: Record<string, unknown> = {}) {
  const p = await seedPromotion({ status: 'draft', goals, digest: 'absent', entrantCap: null });
  if (Object.keys(over).length) await setPromotion(p, over);
  return p;
}

async function readDoc(p: string) {
  const snap = await getFirestore().doc(`${COLLECTIONS.promotions}/${p}`).get();
  return snap.data() as Record<string, unknown>;
}

/** Byte-comparable view of a promotion document (Timestamps → millis). */
function comparable(doc: Record<string, unknown>) {
  return JSON.stringify(doc, (_k, v) => (v instanceof Timestamp ? v.toMillis() : v));
}

describe('EXP2A enable transition', () => {
  beforeAll(async () => {
    await getFirestore().doc('_warmup/expo-prize-enable').set({ at: Date.now() });
  });

  test('a complete draft enables once: status, derived array, digest and server timestamp in one write', async () => {
    const { groupId, goalA, goalB } = await scene();
    // Goals listed in reverse order and a forged routing array on the draft.
    const p = await draft(
      [
        { goalId: goalB, communityGroupId: groupId },
        { goalId: goalA, communityGroupId: groupId },
      ],
      { eligibleGoalIds: ['forged', goalB] }
    );
    const before = await readDoc(p);
    expect(before.enabledConfigDigest).toBeUndefined();
    expect(before.enabledAt).toBeUndefined();

    const result = await enablePromotion(deps(), p);
    expect(result.outcome).toBe('enabled');
    const after = await readDoc(p);
    const expectedIds = [goalA, goalB].sort();
    expect(after.status).toBe('enabled');
    expect(after.eligibleGoalIds).toEqual(expectedIds);
    expect(after.enabledAt).toBeInstanceOf(Timestamp);
    const v = validatePromotionConfig(after);
    if (!v.ok) throw new Error('enabled doc must validate');
    expect(after.enabledConfigDigest).toBe(configDigest(v.policy));
    if (result.outcome === 'enabled') {
      expect(result.digest).toBe(after.enabledConfigDigest);
      expect(result.eligibleGoalIds).toEqual(expectedIds);
    }
    // Only the four fields changed.
    const { status: s0, eligibleGoalIds: e0, ...restBefore } = before;
    const { status: s1, eligibleGoalIds: e1, enabledConfigDigest, enabledAt, ...restAfter } = after;
    expect(comparable(restAfter)).toBe(comparable(restBefore));
    expect([s0, s1]).toEqual(['draft', 'enabled']);
    expect(e0).toEqual(['forged', goalB]);
    expect(e1).toEqual(expectedIds);
    expect(readPromotion(after)).toMatchObject({ kind: 'active', status: 'enabled' });
  });

  test('proof 1: a missing or invalid decision → refused with the field named, nothing written', async () => {
    const { groupId, goalA } = await scene();
    const cases: Array<[string, Record<string, unknown>]> = [
      ['repeatRule', { repeatRule: null }],
      ['entrantCap', { entrantCap: 0 }],
      ['operatorUids', { operatorUids: [] }],
      ['windowEndsAt', { windowEndsAt: Timestamp.fromMillis(Date.now() - 10 * 86_400_000) }],
      ['eligibleGoals', { eligibleGoals: [] }],
      ['ruleVersion', { ruleVersion: 0 }],
    ];
    for (const [field, over] of cases) {
      const p = await draft([{ goalId: goalA, communityGroupId: groupId }]);
      // `entrantCap` missing altogether is its own case: delete the key.
      await getFirestore().doc(`${COLLECTIONS.promotions}/${p}`).set(over, { merge: true });
      const before = comparable(await readDoc(p));
      const r = await enablePromotion(deps(), p);
      expect(r.outcome).toBe('refused');
      if (r.outcome === 'refused') expect(r.problems.map((x) => x.field)).toContain(field);
      expect(comparable(await readDoc(p))).toBe(before);
    }
    // entrantCap absent (undefined) is not a decision either.
    const p = await draft([{ goalId: goalA, communityGroupId: groupId }]);
    const ref = getFirestore().doc(`${COLLECTIONS.promotions}/${p}`);
    const { entrantCap: _drop, ...rest } = await readDoc(p);
    await ref.set(rest);
    const r = await enablePromotion(deps(), p);
    expect(r.outcome).toBe('refused');
    if (r.outcome === 'refused') expect(r.problems.map((x) => x.field)).toContain('entrantCap');
    expect((await readDoc(p)).status).toBe('draft');
  });

  test('proof 2: a forged array is replaced on enable; later drift fences adjudication and trigger routing', async () => {
    const { groupId, goalA, goalB } = await scene();
    const p = await draft(
      [
        { goalId: goalA, communityGroupId: groupId },
        { goalId: goalB, communityGroupId: groupId },
      ],
      { eligibleGoalIds: [goalB, goalA, 'extra'] }
    );
    expect((await enablePromotion(deps(), p)).outcome).toBe('enabled');
    expect((await readDoc(p)).eligibleGoalIds).toEqual([goalA, goalB].sort());

    const uid = await member(groupId, 'drift');
    const c = await contribute(uid, goalA, 3);
    expect(await ingestContribution(deps(), p, c.path)).toMatchObject({ outcome: 'accepted' });

    // Drift 1: the array is reordered after enablement → adjudication fenced.
    await setPromotion(p, { eligibleGoalIds: [goalB, goalA].sort().reverse() });
    const c2 = await contribute(uid, goalA, 3);
    expect(await ingestContribution(deps(), p, c2.path)).toEqual({ outcome: 'fenced', reason: 'configDrift' });
    // The trigger body still finds the promotion by array-contains, and the award fences it.
    const routed = await onContributionCreatedBody(deps(), { contributionPath: c2.path, goalId: goalA });
    expect(routed.find((x) => x.promotionId === p)?.result).toEqual({ outcome: 'fenced', reason: 'configDrift' });

    // Drift 2: a goal is appended to the array only → fenced; the array can never widen eligibility.
    await setPromotion(p, { eligibleGoalIds: [goalA, goalB].sort().concat(['smuggled']) });
    expect(await ingestContribution(deps(), p, c2.path)).toEqual({ outcome: 'fenced', reason: 'configDrift' });

    // Drift 3: the array is removed → the trigger body no longer routes here at all, and a direct ingest is fenced.
    await getFirestore().doc(`${COLLECTIONS.promotions}/${p}`).update({ eligibleGoalIds: (await import('firebase-admin/firestore')).FieldValue.delete() });
    const routedAfterRemoval = await onContributionCreatedBody(deps(), { contributionPath: c2.path, goalId: goalA });
    expect(routedAfterRemoval.find((x) => x.promotionId === p)).toBeUndefined();
    expect(await ingestContribution(deps(), p, c2.path)).toEqual({ outcome: 'fenced', reason: 'configDrift' });

    // Restoring the exact derived array restores adjudication: the digest never covered a forged value.
    await setPromotion(p, { eligibleGoalIds: [goalA, goalB].sort() });
    expect(await ingestContribution(deps(), p, c2.path)).toMatchObject({ outcome: 'accepted' });
    expect(count((await promotionState(p)).entries)).toBe(2);
  });

  test('proof 3: an entrant under a draft refuses enable, including cap null → number after admissions', async () => {
    const { groupId, goalA } = await scene();
    // Enabled with no cap, one admission.
    const p = await seedPromotion({ goals: [{ goalId: goalA, communityGroupId: groupId }], entrantCap: null });
    const uid = await member(groupId, 'admitted');
    const c = await contribute(uid, goalA, 2);
    expect(await ingestContribution(deps(), p, c.path)).toMatchObject({ outcome: 'accepted', entrantCreated: true });
    expect(count((await promotionState(p)).entrants)).toBe(1);

    // Set back to draft with a cap of 1 and the artefacts still present → fenced on the artefacts.
    await setPromotion(p, { status: 'draft', entrantCap: 1 });
    const before = comparable(await readDoc(p));
    expect(await enablePromotion(deps(), p)).toEqual({ outcome: 'fenced', reason: 'enableArtefactsPresent', status: 'draft' });
    expect(comparable(await readDoc(p))).toBe(before);

    // Artefacts scrubbed too → fenced on the entrant.
    const { FieldValue } = await import('firebase-admin/firestore');
    await getFirestore().doc(`${COLLECTIONS.promotions}/${p}`).update({ enabledConfigDigest: FieldValue.delete(), enabledAt: FieldValue.delete() });
    const before2 = comparable(await readDoc(p));
    expect(await enablePromotion(deps(), p)).toEqual({ outcome: 'fenced', reason: 'entrantsExist', status: 'draft' });
    expect(comparable(await readDoc(p))).toBe(before2);
    expect((await promotionState(p)).entrantCount).toBe(0); // never initialised

    // A leftover link alone, or a nonzero counter alone, is enough to refuse.
    const q = await draft([{ goalId: goalA, communityGroupId: groupId }]);
    await getFirestore().doc(`${COLLECTIONS.entrantLinks}/${q}_uid_${uid}`).set({ entrantId: 'stale' });
    expect(await enablePromotion(deps(), q)).toEqual({ outcome: 'fenced', reason: 'entrantsExist', status: 'draft' });
    const r = await draft([{ goalId: goalA, communityGroupId: groupId }]);
    await getFirestore().doc(`${COLLECTIONS.counters}/${r}`).set({ entrantCount: 1 });
    expect(await enablePromotion(deps(), r)).toEqual({ outcome: 'fenced', reason: 'entrantsExist', status: 'draft' });
    expect((await readDoc(r)).status).toBe('draft');
  });

  test('proof 4: no status but draft can enable; an enabled document cannot be re-enabled or mutated through this path', async () => {
    const { groupId, goalA } = await scene();
    for (const status of ['enabled', 'closing', 'disabled', 'frozen', 'drawn', 'archived'] as const) {
      const p = await seedPromotion({ status, goals: [{ goalId: goalA, communityGroupId: groupId }] });
      const before = comparable(await readDoc(p));
      expect(await enablePromotion(deps(), p)).toEqual({ outcome: 'fenced', reason: 'notDraft', status });
      expect(comparable(await readDoc(p))).toBe(before);
    }
    expect(await enablePromotion(deps(), 'no-such-promotion')).toEqual({ outcome: 'fenced', reason: 'promotionMissing', status: null });

    // Enabled once; a second call is fenced and the first enablement is untouched.
    const p = await draft([{ goalId: goalA, communityGroupId: groupId }]);
    expect((await enablePromotion(deps(), p)).outcome).toBe('enabled');
    const enabled = comparable(await readDoc(p));
    expect(await enablePromotion(deps(), p)).toEqual({ outcome: 'fenced', reason: 'notDraft', status: 'enabled' });
    expect(comparable(await readDoc(p))).toBe(enabled);
    // A cap change after enablement is drift for the award, and enable cannot bless it.
    await setPromotion(p, { entrantCap: 5 });
    expect(readPromotion(await readDoc(p))).toMatchObject({ kind: 'fenced', reason: 'configDrift' });
    expect(await enablePromotion(deps(), p)).toEqual({ outcome: 'fenced', reason: 'notDraft', status: 'enabled' });
  });

  test.each([1, 2, 3])('proof 5 (run %i): eight concurrent enables → one enabled configuration, no partial state', async () => {
    const { groupId, goalA, goalB } = await scene();
    const p = await draft([
      { goalId: goalB, communityGroupId: groupId },
      { goalId: goalA, communityGroupId: groupId },
    ]);
    const results = await Promise.all(Array.from({ length: 8 }, () => enablePromotion(deps(), p)));
    const enabled = results.filter((r) => r.outcome === 'enabled');
    const fenced = results.filter((r) => r.outcome === 'fenced' && r.reason === 'notDraft');
    expect(enabled.length).toBe(1);
    expect(fenced.length).toBe(7);
    const after = await readDoc(p);
    expect(after.status).toBe('enabled');
    expect(after.eligibleGoalIds).toEqual([goalA, goalB].sort());
    const v = validatePromotionConfig(after);
    if (!v.ok) throw new Error('enabled doc must validate');
    expect(after.enabledConfigDigest).toBe(configDigest(v.policy));
    expect(after.enabledAt).toBeInstanceOf(Timestamp);
    expect(readPromotion(after)).toMatchObject({ kind: 'active' });
  });

  test('proof 6: award behaviour and contribution persistence are unchanged after a real enable', async () => {
    const { groupId, goalA } = await scene();
    const p = await draft([{ goalId: goalA, communityGroupId: groupId }]);
    const uid = await member(groupId, 'after');
    const early = await contribute(uid, goalA, 4);
    // Under the draft: fenced, nothing written, contribution intact.
    expect(await ingestContribution(deps(), p, early.path)).toEqual({ outcome: 'fenced', reason: 'promotionInactive' });
    expect((await getFirestore().doc(early.path).get()).data()).toMatchObject({ count: 4, userId: uid });

    expect((await enablePromotion(deps(), p)).outcome).toBe('enabled');
    // The pre-enable contribution is inside the window and is now adjudicated exactly as before.
    expect(await ingestContribution(deps(), p, early.path)).toMatchObject({ outcome: 'accepted', kind: 'movement', entrantCreated: true });
    expect(await ingestContribution(deps(), p, early.path)).toMatchObject({ outcome: 'replay' });
    const later = await contribute(uid, goalA, 40);
    expect(await ingestContribution(deps(), p, later.path)).toMatchObject({ outcome: 'accepted', entrantCreated: false });
    const s = await promotionState(p);
    expect(count(s.entries)).toBe(2);
    expect((await getFirestore().doc(early.path).get()).data()).toMatchObject({ count: 4 });
    expect((await getFirestore().doc(later.path).get()).data()).toMatchObject({ count: 40 });
  });
});
