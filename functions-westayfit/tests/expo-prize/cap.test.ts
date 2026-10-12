/**
 * EMULATOR ROWS — the configured entrant cap under real contention.
 * Matrix rows 13, 14, 15.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';

import { contribute, contributionRow, count, member, memberTotal, promotionState, seedCommunity, seedGoal, seedPromotion, uniq } from './fixtures';
import { ingestContribution, type AwardDeps } from '../../src/expo-prize';

const deps = (): AwardDeps => ({ db: getFirestore() });

async function scene() {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalId = await seedGoal({ groupId });
  return { groupId, goalId };
}

describe('entrant cap', () => {
  beforeAll(async () => {
    await getFirestore().doc('_warmup/expo-prize-cap').set({ at: Date.now() });
  });

  test.each([1, 2, 3])('row 13 (run %i): six concurrent first-time entrants against a cap of 2 → exactly two admitted', async () => {
    const { groupId, goalId } = await scene();
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }], entrantCap: 2 });
    const uids = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((l) => member(groupId, l)));
    const cs = await Promise.all(uids.map((u) => contribute(u, goalId, 3)));

    const results = await Promise.all(cs.map((c) => ingestContribution(deps(), p, c.path)));
    const admitted = results.filter((r) => r.outcome === 'accepted');
    const refused = results.filter((r) => r.outcome === 'refused' && r.reason === 'capReached');
    expect(admitted.length).toBe(2);
    expect(refused.length).toBe(4);

    const s = await promotionState(p);
    expect(count(s.entrants)).toBe(2);
    expect(count(s.links)).toBe(2);
    expect(count(s.entries)).toBe(2);
    expect(s.entrantCount).toBe(2);
    expect(count(s.sources)).toBe(6);
    // Every refusal is durable: a replay returns the same verdict and admits nobody.
    const again = await Promise.all(cs.map((c) => ingestContribution(deps(), p, c.path)));
    expect(again.every((r) => r.outcome === 'replay')).toBe(true);
    expect((await promotionState(p)).entrantCount).toBe(2);
  });

  test('row 14: the cap never limits movement', async () => {
    const { groupId, goalId } = await scene();
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }], entrantCap: 1 });
    const first = await member(groupId, 'first');
    const second = await member(groupId, 'second');
    const c1 = await contribute(first, goalId, 9);
    const c2 = await contribute(second, goalId, 8);
    expect(await ingestContribution(deps(), p, c1.path)).toMatchObject({ outcome: 'accepted' });
    expect(await ingestContribution(deps(), p, c2.path)).toEqual({ outcome: 'refused', reason: 'capReached', recorded: true });

    // The refused person's movement is exactly what performContribution committed.
    expect(await contributionRow(c2.path)).toMatchObject({ count: 8, userId: second });
    expect(await memberTotal(goalId, second)).toBe(8);

    // And with the cap full, a seventh person can STILL move: the contribution
    // path never consults the promotion.
    const third = await member(groupId, 'third');
    const c3 = await contribute(third, goalId, 7);
    expect(await contributionRow(c3.path)).toMatchObject({ count: 7 });
    expect(await memberTotal(goalId, third)).toBe(7);
    expect(await ingestContribution(deps(), p, c3.path)).toEqual({ outcome: 'refused', reason: 'capReached', recorded: true });
  });

  test('row 15: an admitted entrant keeps earning under a full cap', async () => {
    const { groupId, goalId } = await scene();
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }], entrantCap: 1, repeatRule: 'perContribution' });
    const uid = await member(groupId, 'only');
    const c1 = await contribute(uid, goalId, 1);
    expect(await ingestContribution(deps(), p, c1.path)).toMatchObject({ outcome: 'accepted', entrantCreated: true });
    const c2 = await contribute(uid, goalId, 1);
    expect(await ingestContribution(deps(), p, c2.path)).toMatchObject({ outcome: 'accepted', entrantCreated: false });
    const s = await promotionState(p);
    expect(count(s.entries)).toBe(2);
    expect(s.entrantCount).toBe(1);
  });

  test('no cap (explicit null) admits everyone and never touches the counter', async () => {
    const { groupId, goalId } = await scene();
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }], entrantCap: null });
    const uids = await Promise.all(['a', 'b', 'c', 'd'].map((l) => member(groupId, l)));
    const cs = await Promise.all(uids.map((u) => contribute(u, goalId, 3)));
    const results = await Promise.all(cs.map((c) => ingestContribution(deps(), p, c.path)));
    expect(results.every((r) => r.outcome === 'accepted')).toBe(true);
    const s = await promotionState(p);
    expect(count(s.entrants)).toBe(4);
    expect(s.entrantCount).toBe(0);
  });
});
