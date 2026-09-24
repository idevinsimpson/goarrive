/**
 * EMULATOR ROWS — the trusted form-receipt seam through a SYNTHETIC source.
 * Matrix rows 8–12.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';

import { contribute, count, member, memberTotal, promotionState, seedCommunity, seedGoal, seedPromotion, shardSum, uniq } from './fixtures';
import { InMemoryFormReceiptSource, ingestContribution, ingestFormReceipt } from '../../src/expo-prize';

async function scene() {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalId = await seedGoal({ groupId });
  const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }] });
  return { groupId, goalId, p };
}

describe('form receipt — one bonus, server-verified', () => {
  beforeAll(async () => {
    await getFirestore().doc('_warmup/expo-prize-form').set({ at: Date.now() });
  });

  test('row 8: one receipt → one bonus; replay of the receipt and a second receipt → still one', async () => {
    const { groupId, p } = await scene();
    const uid = await member(groupId, 'form');
    const source = new InMemoryFormReceiptSource();
    source.seed({ receiptId: 'rcpt-1', subjectUid: uid, completedAtMs: Date.now() });
    source.seed({ receiptId: 'rcpt-1-edited', subjectUid: uid, completedAtMs: Date.now() });
    const deps = { db: getFirestore(), formSource: source };

    const first = await ingestFormReceipt(deps, p, { receiptId: 'rcpt-1', claimantUid: uid });
    expect(first).toMatchObject({ outcome: 'accepted', kind: 'formBonus', entrantCreated: true });
    for (let i = 0; i < 3; i++) {
      expect(await ingestFormReceipt(deps, p, { receiptId: 'rcpt-1', claimantUid: uid })).toMatchObject({ outcome: 'replay', verdict: { verdict: 'accepted' } });
    }
    expect(await ingestFormReceipt(deps, p, { receiptId: 'rcpt-1-edited', claimantUid: uid })).toEqual({ outcome: 'refused', reason: 'bonusAlreadyAwarded', recorded: true });

    const s = await promotionState(p);
    expect(count(s.entries)).toBe(1);
    expect(Object.values(s.entries)[0]).toMatchObject({ kind: 'formBonus', status: 'confirmed', tickets: 1 });
    expect(Object.values(s.tallies)[0]).toMatchObject({ formBonusAwarded: true, entryCount: 1 });
    expect(count(s.sources)).toBe(2);
  });

  test('row 8b: concurrent claims of two receipts for one subject → one bonus (real contention on the tally)', async () => {
    const { groupId, p } = await scene();
    const uid = await member(groupId, 'formrace');
    const source = new InMemoryFormReceiptSource();
    const ids = ['ra', 'rb', 'rc', 'rd'];
    for (const id of ids) source.seed({ receiptId: id, subjectUid: uid, completedAtMs: Date.now() });
    const deps = { db: getFirestore(), formSource: source };
    const results = await Promise.all(ids.map((id) => ingestFormReceipt(deps, p, { receiptId: id, claimantUid: uid })));
    expect(results.filter((r) => r.outcome === 'accepted').length).toBe(1);
    const s = await promotionState(p);
    expect(count(s.entries)).toBe(1);
    expect(count(s.entrants)).toBe(1);
  });

  test('row 9: a forged receipt is refused and nothing is written', async () => {
    const { groupId, p } = await scene();
    const uid = await member(groupId, 'forge');
    const other = await member(groupId, 'other');
    const source = new InMemoryFormReceiptSource();
    source.seed({ receiptId: 'theirs', subjectUid: other, completedAtMs: Date.now() });
    const deps = { db: getFirestore(), formSource: source };

    expect(await ingestFormReceipt(deps, p, { receiptId: 'never-issued', claimantUid: uid })).toEqual({ outcome: 'refused', reason: 'unknownReceipt', recorded: false });
    expect(await ingestFormReceipt(deps, p, { receiptId: 'theirs', claimantUid: uid })).toEqual({ outcome: 'refused', reason: 'subjectMismatch', recorded: false });
    expect(await ingestFormReceipt(deps, p, { receiptId: 'bad id!', claimantUid: uid })).toEqual({ outcome: 'refused', reason: 'unknownReceipt', recorded: false });
    const s = await promotionState(p);
    expect(count(s.sources) + count(s.entries) + count(s.entrants)).toBe(0);
  });

  test('row 10: marketing consent cannot reach eligibility — the receipt type has no consent field and the verdict is identical', async () => {
    const { groupId, p } = await scene();
    const optIn = await member(groupId, 'optin');
    const optOut = await member(groupId, 'optout');
    const source = new InMemoryFormReceiptSource();
    // The synthetic owning store may hold consent; what it hands the core does not.
    source.seed({ receiptId: 'in', subjectUid: optIn, completedAtMs: Date.now(), ...({ marketingOptIn: true } as object) });
    source.seed({ receiptId: 'out', subjectUid: optOut, completedAtMs: Date.now(), ...({ marketingOptIn: false } as object) });
    const deps = { db: getFirestore(), formSource: source };
    const a = await ingestFormReceipt(deps, p, { receiptId: 'in', claimantUid: optIn });
    const b = await ingestFormReceipt(deps, p, { receiptId: 'out', claimantUid: optOut });
    expect(a.outcome).toBe('accepted');
    expect(b.outcome).toBe('accepted');
    const s = await promotionState(p);
    expect(count(s.entries)).toBe(2);
    for (const doc of [...Object.values(s.entries), ...Object.values(s.sources), ...Object.values(s.tallies)]) {
      expect(Object.keys(doc).some((k) => /consent|marketing|optIn/i.test(k))).toBe(false);
    }
    const shapes = Object.values(s.entries).map((e) => ({ kind: e.kind, status: e.status, tickets: e.tickets }));
    expect(shapes[0]).toEqual(shapes[1]);
  });

  test('rows 11 + 12: a form-only entrant is valid, and a form never changes movement', async () => {
    const { groupId, goalId, p } = await scene();
    const walker = await member(groupId, 'walker');
    const mover = await member(groupId, 'mover');
    const c = await contribute(mover, goalId, 12);
    const sharedBefore = await shardSum(goalId);
    const source = new InMemoryFormReceiptSource();
    source.seed({ receiptId: 'w', subjectUid: walker, completedAtMs: Date.now() });
    source.seed({ receiptId: 'm', subjectUid: mover, completedAtMs: Date.now() });
    const deps = { db: getFirestore(), formSource: source };

    expect(await ingestFormReceipt(deps, p, { receiptId: 'w', claimantUid: walker })).toMatchObject({ outcome: 'accepted', entrantCreated: true });
    expect(await ingestContribution(deps, p, c.path)).toMatchObject({ outcome: 'accepted', entrantCreated: true });
    expect(await ingestFormReceipt(deps, p, { receiptId: 'm', claimantUid: mover })).toMatchObject({ outcome: 'accepted', entrantCreated: false });

    expect(await memberTotal(goalId, walker)).toBe(0);
    expect(await memberTotal(goalId, mover)).toBe(12);
    expect(await shardSum(goalId)).toBe(sharedBefore);
    const s = await promotionState(p);
    expect(count(s.entrants)).toBe(2);
    expect(count(s.entries)).toBe(3);
    const walkerEntrant = (s.links[`${p}_uid_${walker}`] as { entrantId: string }).entrantId;
    expect(s.tallies[`${p}_${walkerEntrant}`]).toMatchObject({ entryCount: 1, formBonusAwarded: true });
    const moverEntrant = (s.links[`${p}_uid_${mover}`] as { entrantId: string }).entrantId;
    expect(s.tallies[`${p}_${moverEntrant}`]).toMatchObject({ entryCount: 2, formBonusAwarded: true });
  });

  test('a receipt completed after the cutoff is refused; formBonusEntries 0 disables the bonus', async () => {
    const { groupId, goalId } = await scene();
    const uid = await member(groupId, 'latef');
    const source = new InMemoryFormReceiptSource();
    source.seed({ receiptId: 'late', subjectUid: uid, completedAtMs: Date.now() + 10 * 60_000 });
    source.seed({ receiptId: 'ok', subjectUid: uid, completedAtMs: Date.now() });
    const deps = { db: getFirestore(), formSource: source };
    // The window closes in one minute; the receipt was completed ten minutes from now.
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }], windowEndsAt: new Date(Date.now() + 60_000) });
    expect(await ingestFormReceipt(deps, p, { receiptId: 'late', claimantUid: uid })).toEqual({ outcome: 'refused', reason: 'afterCutoff', recorded: true });
    const noBonus = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }], formBonusEntries: 0 });
    expect(await ingestFormReceipt(deps, noBonus, { receiptId: 'ok', claimantUid: uid })).toEqual({ outcome: 'refused', reason: 'bonusDisabled', recorded: true });
  });
});
