/**
 * EMULATOR ROWS — bounded reconciliation converges. Matrix rows 16, 17.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';

import { contribute, count, member, promotionState, seedCommunity, seedGoal, seedPromotion, shuffle, uniq } from './fixtures';
import { ingestContribution, reconcileGoal, reconcilePromotion, type ReconcileDeps } from '../../src/expo-prize';

const deps = (): ReconcileDeps => ({ db: getFirestore() });

async function ledger(n: number) {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalId = await seedGoal({ groupId });
  const uids = await Promise.all(['x', 'y', 'z'].map((l) => member(groupId, l)));
  const paths: string[] = [];
  for (let i = 0; i < n; i++) paths.push((await contribute(uids[i % 3], goalId, 1 + i)).path);
  return { groupId, goalId, paths };
}

/**
 * The comparable shape of everything written under a promotion, with the
 * promotion id stripped from keys, timestamps dropped, and each random
 * entrant id replaced by the uid it links to — so two promotions over the
 * same ledger compare structurally.
 */
async function canonicalState(p: string) {
  const s = await promotionState(p);
  const uidOf = new Map<string, string>();
  for (const [k, v] of Object.entries(s.links)) {
    uidOf.set((v as { entrantId: string }).entrantId, k.replace(`${p}_uid_`, ''));
  }
  const label = (entrantId: string) => `entrant:${uidOf.get(entrantId) ?? '?'}`;
  const clean = (v: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(v)
        .filter(([f]) => !/At$/.test(f))
        .map(([f, x]) => [f, f === 'entrantId' && typeof x === 'string' ? label(x) : x])
    );
  const rekey = (o: Record<string, Record<string, unknown>>, viaEntrant: boolean) =>
    Object.fromEntries(
      Object.entries(o).map(([k, v]) => {
        const bare = k.replace(`${p}_`, '');
        return [viaEntrant ? label(bare) : bare, clean(v)];
      })
    );
  return {
    sources: rekey(s.sources, false),
    entries: rekey(s.entries, false),
    tallies: rekey(s.tallies, true),
    entrants: count(s.entrants),
    links: count(s.links),
    entrantCount: s.entrantCount,
  };
}

describe('reconciliation', () => {
  beforeAll(async () => {
    await getFirestore().doc('_warmup/expo-prize-reconcile').set({ at: Date.now() });
  });

  test('row 16: shuffled, reversed and in-order ingestion reach the same state', async () => {
    const { groupId, goalId, paths } = await ledger(12);
    const goals = [{ goalId, communityGroupId: groupId }];
    const inOrder = await seedPromotion({ goals, repeatRule: 'perGoal' });
    const shuffled = await seedPromotion({ goals, repeatRule: 'perGoal' });
    const reversed = await seedPromotion({ goals, repeatRule: 'perGoal' });

    for (const path of paths) await ingestContribution(deps(), inOrder, path);
    for (const path of shuffle(paths)) await ingestContribution(deps(), shuffled, path);
    for (const path of [...paths].reverse()) await ingestContribution(deps(), reversed, path);

    const a = await canonicalState(inOrder);
    const b = await canonicalState(shuffled);
    const c = await canonicalState(reversed);
    // perGoal: three people, one goal → exactly three entries however the twelve
    // arrive; WHICH contribution carried the entry depends on order, so compare
    // counts and the per-entrant tallies rather than the winning source keys.
    for (const fp of [a, b, c]) {
      expect(count(fp.entries)).toBe(3);
      expect(count(fp.sources)).toBe(12);
      expect(fp.entrants).toBe(3);
      expect(Object.values(fp.tallies).map((t) => t.entryCount)).toEqual([1, 1, 1]);
    }
    expect(a.tallies).toEqual(b.tallies);
    expect(a.tallies).toEqual(c.tallies);

    // perContribution: the whole state is identical whatever the order.
    const pc1 = await seedPromotion({ goals });
    const pc2 = await seedPromotion({ goals });
    for (const path of paths) await ingestContribution(deps(), pc1, path);
    for (const path of shuffle(paths)) await ingestContribution(deps(), pc2, path);
    const f1 = await canonicalState(pc1);
    const f2 = await canonicalState(pc2);
    expect(count(f1.entries)).toBe(12);
    expect(f1).toEqual(f2);
  });

  test('row 17: an interrupted page, resumed from the cursor or from scratch, converges; the settled pass writes nothing', async () => {
    const { groupId, goalId, paths } = await ledger(10);
    const goals = [{ goalId, communityGroupId: groupId }];
    const p = await seedPromotion({ goals });

    // Interrupt after 4 rows of a 6-row page.
    await expect(reconcileGoal({ ...deps(), faultAfter: 4 }, p, goalId, { pageSize: 6 })).rejects.toThrow('fault injected');
    expect(count((await promotionState(p)).sources)).toBe(4);

    // Resume from scratch: the 4 replay, the rest are new.
    const page1 = await reconcileGoal(deps(), p, goalId, { pageSize: 6 });
    expect(page1).toMatchObject({ processed: 6, replayed: 4, accepted: 2, writes: 2, done: false });
    const page2 = await reconcileGoal(deps(), p, goalId, { cursor: page1.nextCursor, pageSize: 6 });
    expect(page2).toMatchObject({ processed: 4, accepted: 4, writes: 4, done: true });

    const settled = await reconcilePromotion(deps(), p, { pageSize: 3 });
    expect(settled).toMatchObject({ processed: 10, writes: 0, fenced: 0, converged: true });
    const s = await promotionState(p);
    expect(count(s.entries)).toBe(10);
    expect(count(s.sources)).toBe(10);
    expect(paths.length).toBe(10);

    // A full pass on a fresh promotion over the same ledger, page size 4: same count, then converged.
    const q = await seedPromotion({ goals });
    const first = await reconcilePromotion(deps(), q, { pageSize: 4 });
    expect(first).toMatchObject({ processed: 10, writes: 10, converged: false });
    const second = await reconcilePromotion(deps(), q, { pageSize: 4 });
    expect(second).toMatchObject({ processed: 10, writes: 0, converged: true });
  });

  test('a fenced promotion reconciles nothing and is not "converged"', async () => {
    const { groupId, goalId } = await ledger(2);
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }], status: 'draft' });
    const r = await reconcilePromotion(deps(), p, { pageSize: 5 });
    expect(r).toMatchObject({ processed: 0, writes: 0, converged: false });
    expect(count((await promotionState(p)).sources)).toBe(0);
  });
});
