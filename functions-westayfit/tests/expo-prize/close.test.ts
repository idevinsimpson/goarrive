/**
 * EXP2B — the close transition on real emulator transactions. Packet
 * deliverable 1 (#365 5811972490): truthful, one-way, idempotent, no write
 * on any fence.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import {
  awaitServerTimePast,
  comparable,
  contribute,
  count,
  member,
  promotionDoc,
  promotionState,
  seedCommunity,
  seedGoal,
  seedPromotion,
  setPromotion,
  uniq,
} from './fixtures';
import { closePromotion, enablePromotion, ingestContribution, reconcilePromotion, type AwardDeps } from '../../src/expo-prize';

const deps = (): AwardDeps => ({ db: getFirestore() });

async function scene() {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalId = await seedGoal({ groupId });
  return { groupId, goalId, goals: [{ goalId, communityGroupId: groupId }] };
}

describe('EXP2B close transition', () => {
  beforeAll(async () => {
    await getFirestore().doc('_warmup/expo-prize-close').set({ at: Date.now() });
  });

  test('an enabled, digest-valid promotion closes once: status + server timestamp, nothing else changes', async () => {
    const { goals } = await scene();
    const p = await seedPromotion({ goals });
    const before = (await promotionDoc(p)) as Record<string, unknown>;
    expect(before.status).toBe('enabled');
    expect(before.closingRequestedAt).toBeUndefined();

    expect(await closePromotion(deps(), p)).toEqual({ outcome: 'closed' });

    const after = (await promotionDoc(p)) as Record<string, unknown>;
    expect(after.status).toBe('closing');
    expect(after.closingRequestedAt).toBeInstanceOf(Timestamp);
    const { status: _s0, ...restBefore } = before;
    const { status: _s1, closingRequestedAt, ...restAfter } = after;
    expect(comparable(restAfter)).toBe(comparable(restBefore));
    expect(closingRequestedAt).toBeInstanceOf(Timestamp);
  });

  test('a repeated close is idempotent: alreadyClosing, byte-identical, the first timestamp kept', async () => {
    const { goals } = await scene();
    const p = await seedPromotion({ goals });
    expect(await closePromotion(deps(), p)).toEqual({ outcome: 'closed' });
    const once = comparable(await promotionDoc(p));
    for (let i = 0; i < 3; i++) {
      expect(await closePromotion(deps(), p)).toEqual({ outcome: 'alreadyClosing' });
      expect(comparable(await promotionDoc(p))).toBe(once);
    }
    // A close can never reopen: enable is fenced on a closing document.
    expect(await enablePromotion(deps(), p)).toEqual({ outcome: 'fenced', reason: 'notDraft', status: 'closing' });
    expect(comparable(await promotionDoc(p))).toBe(once);
  });

  test('every other status is fenced with no write', async () => {
    const { goals } = await scene();
    for (const status of ['draft', 'disabled', 'frozen', 'drawn', 'archived'] as const) {
      const p = await seedPromotion({ status, goals });
      const before = comparable(await promotionDoc(p));
      expect(await closePromotion(deps(), p)).toEqual({ outcome: 'fenced', reason: 'notEnabled', status });
      expect(comparable(await promotionDoc(p))).toBe(before);
    }
    expect(await closePromotion(deps(), 'no-such-promotion')).toEqual({ outcome: 'fenced', reason: 'promotionMissing', status: null });
  });

  test('config drift or an invalid configuration under enabled is fenced with no write, never closed', async () => {
    const { goals } = await scene();
    // Drift: cap edited after enablement.
    const drifted = await seedPromotion({ goals, entrantCap: null });
    await setPromotion(drifted, { entrantCap: 7 });
    const b1 = comparable(await promotionDoc(drifted));
    expect(await closePromotion(deps(), drifted)).toEqual({ outcome: 'fenced', reason: 'configDrift', status: 'enabled' });
    expect(comparable(await promotionDoc(drifted))).toBe(b1);
    // Drift: stale digest.
    const stale = await seedPromotion({ goals, digest: 'stale' });
    const b2 = comparable(await promotionDoc(stale));
    expect(await closePromotion(deps(), stale)).toEqual({ outcome: 'fenced', reason: 'configDrift', status: 'enabled' });
    expect(comparable(await promotionDoc(stale))).toBe(b2);
    // Invalid: a decision removed after enablement.
    const invalid = await seedPromotion({ goals });
    await setPromotion(invalid, { repeatRule: null });
    const b3 = comparable(await promotionDoc(invalid));
    expect(await closePromotion(deps(), invalid)).toEqual({ outcome: 'fenced', reason: 'invalidConfig', status: 'enabled' });
    expect(comparable(await promotionDoc(invalid))).toBe(b3);
  });

  test.each([1, 2, 3])('run %i: eight concurrent closes → one closed, seven alreadyClosing, one timestamp', async () => {
    const { goals } = await scene();
    const p = await seedPromotion({ goals });
    const results = await Promise.all(Array.from({ length: 8 }, () => closePromotion(deps(), p)));
    expect(results.filter((r) => r.outcome === 'closed').length).toBe(1);
    expect(results.filter((r) => r.outcome === 'alreadyClosing').length).toBe(7);
    const doc = (await promotionDoc(p)) as Record<string, unknown>;
    expect(doc.status).toBe('closing');
    expect(doc.closingRequestedAt).toBeInstanceOf(Timestamp);
  });

  test('closing keeps the write fence honest: a pre-cutoff commit is still awarded, a post-cutoff commit is refused', async () => {
    const { groupId, goalId, goals } = await scene();
    const uid = await member(groupId, 'late');
    const early = await contribute(uid, goalId, 5);
    // Cutoff shortly ahead, closed BEFORE the cutoff has passed: the close is
    // not proof of anything about the window.
    const windowEndsAt = new Date(Date.now() + 1500);
    const p = await seedPromotion({ goals, windowEndsAt, formBonusEntries: 0 });
    expect(await closePromotion(deps(), p)).toEqual({ outcome: 'closed' });
    expect(((await promotionDoc(p)) as Record<string, unknown>).status).toBe('closing');

    // Processed after close, committed before cutoff → accepted.
    expect(await ingestContribution(deps(), p, early.path)).toMatchObject({ outcome: 'accepted', kind: 'movement' });

    await awaitServerTimePast(windowEndsAt.getTime());
    const late = await contribute(uid, goalId, 5);
    expect(await ingestContribution(deps(), p, late.path)).toEqual({ outcome: 'refused', reason: 'afterCutoff', recorded: true });
    const s = await promotionState(p);
    expect(count(s.entries)).toBe(1);
    expect(count(s.sources)).toBe(2);
    // The old broad convergence counts the post-cutoff refusal as a write once and then converges — not the freeze's test.
    expect((await reconcilePromotion(deps(), p, { pageSize: 50 })).converged).toBe(true);
  });
});
