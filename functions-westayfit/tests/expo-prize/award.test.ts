/**
 * EMULATOR ROWS — real Firestore transactions on the local emulator, real
 * canonical contributions through the real callables. Matrix rows 1–7, 18,
 * 20, 21, 22, 24, 25, 26 and the trigger body in isolation.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';

import {
  combinedScene,
  completeAtStation,
  completeOnPhone,
  contribute,
  contributionRow,
  count,
  deepStrings,
  member,
  memberTotal,
  promotionState,
  seedCommunity,
  seedGoal,
  seedPromotion,
  setPromotion,
  shardSum,
  startedTurn,
  turnScene,
  uniq,
} from './fixtures';
import { ingestContribution, onContributionCreatedBody, type AwardDeps } from '../../src/expo-prize';

const deps = (): AwardDeps => ({ db: getFirestore() });

async function scene() {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalId = await seedGoal({ groupId });
  return { championUid, groupId, goalId };
}

describe('award — one contribution, one entry', () => {
  beforeAll(async () => {
    await getFirestore().doc('_warmup/expo-prize-award').set({ at: Date.now() });
  });

  test('row 1: one valid contribution → one confirmed entry; 1 rep and 100 reps are the same entitlement', async () => {
    const { groupId, goalId } = await scene();
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }] });
    const one = await member(groupId, 'one');
    const hundred = await member(groupId, 'hundred');
    const c1 = await contribute(one, goalId, 1);
    const c100 = await contribute(hundred, goalId, 100);

    const r1 = await ingestContribution(deps(), p, c1.path);
    const r100 = await ingestContribution(deps(), p, c100.path);
    expect(r1).toMatchObject({ outcome: 'accepted', kind: 'movement', entryId: `c_${c1.docId}`, entrantCreated: true });
    expect(r100).toMatchObject({ outcome: 'accepted', kind: 'movement', entryId: `c_${c100.docId}`, entrantCreated: true });

    const s = await promotionState(p);
    expect(count(s.entries)).toBe(2);
    expect(count(s.entrants)).toBe(2);
    for (const entry of Object.values(s.entries)) {
      expect(entry).toMatchObject({ kind: 'movement', status: 'confirmed', tickets: 1, ruleVersion: 1 });
      expect('count' in entry).toBe(false);
    }
    const tallies = Object.values(s.tallies).map((t) => t.entryCount);
    expect(tallies).toEqual([1, 1]);
  });

  test('row 2: replay and concurrent duplicate ingestion → one entry', async () => {
    const { groupId, goalId } = await scene();
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }] });
    const uid = await member(groupId, 'replay');
    const c = await contribute(uid, goalId, 10);

    const first = await ingestContribution(deps(), p, c.path);
    expect(first.outcome).toBe('accepted');
    for (let i = 0; i < 5; i++) {
      const again = await ingestContribution(deps(), p, c.path);
      expect(again).toMatchObject({ outcome: 'replay', verdict: { verdict: 'accepted', entryId: `c_${c.docId}` } });
    }
    const burst = await Promise.all(Array.from({ length: 5 }, () => ingestContribution(deps(), p, c.path)));
    for (const r of burst) expect(r.outcome).toBe('replay');

    const s = await promotionState(p);
    expect(count(s.sources)).toBe(1);
    expect(count(s.entries)).toBe(1);
    expect(Object.values(s.tallies)[0].entryCount).toBe(1);
  });

  test('row 2b: a truly concurrent FIRST ingestion still yields one entry (real transaction contention)', async () => {
    const { groupId, goalId } = await scene();
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }] });
    const uid = await member(groupId, 'race');
    const c = await contribute(uid, goalId, 10);

    const burst = await Promise.all(Array.from({ length: 6 }, () => ingestContribution(deps(), p, c.path)));
    const accepted = burst.filter((r) => r.outcome === 'accepted');
    const replays = burst.filter((r) => r.outcome === 'replay');
    expect(accepted.length).toBe(1);
    expect(replays.length).toBe(5);
    const s = await promotionState(p);
    expect(count(s.entries)).toBe(1);
    expect(count(s.entrants)).toBe(1);
    expect(count(s.links)).toBe(1);
    expect(Object.values(s.tallies)[0].entryCount).toBe(1);
  });

  test('row 3: the same attempt finished on the phone and retried at the station → one contribution, one entry', async () => {
    const sc = await turnScene();
    const p = await seedPromotion({ goals: [{ goalId: sc.goalId, communityGroupId: sc.groupId }] });
    const uid = await member(sc.groupId, 'ann');
    const turn = await startedTurn(sc, uid);

    const phone = (await completeOnPhone(uid, turn.entryId, 25)) as { receipt: { alreadyRecorded: boolean } };
    expect(phone.receipt.alreadyRecorded).toBe(false);
    const station = (await completeAtStation(sc.station, 25)) as { recorded: { alreadyRecorded: boolean } };
    expect(station.recorded.alreadyRecorded).toBe(true);

    const path = `wsfContributions/${sc.goalId}_${uid}_${turn.attemptId}`;
    expect(await contributionRow(path)).not.toBeNull();
    expect(await ingestContribution(deps(), p, path)).toMatchObject({ outcome: 'accepted' });
    expect(await ingestContribution(deps(), p, path)).toMatchObject({ outcome: 'replay' });
    const s = await promotionState(p);
    expect(count(s.entries)).toBe(1);
    expect(count(s.sources)).toBe(1);
  });

  test('row 4: a contribution that also credits a combined parent is one entry; the credit row is not a source', async () => {
    const cs = await combinedScene();
    const p = await seedPromotion({ goals: [{ goalId: cs.squats, communityGroupId: cs.groupId }] });
    const uid = await member(cs.groupId, 'combo');
    const c = await contribute(uid, cs.squats, 30);
    // The credit row was written in the same transaction as the contribution.
    const credit = await getFirestore().doc(`wsfCombinedCredits/${c.docId}`).get();
    expect(credit.exists).toBe(true);

    expect(await ingestContribution(deps(), p, c.path)).toMatchObject({ outcome: 'accepted' });
    expect(await ingestContribution(deps(), p, `wsfCombinedCredits/${c.docId}`)).toEqual({
      outcome: 'refused',
      reason: 'notAContributionPath',
      recorded: false,
    });
    const s = await promotionState(p);
    expect(count(s.entries)).toBe(1);
    expect(count(s.sources)).toBe(1);
  });

  test('row 5: wrong goal and wrong community → refused, recorded, no entry, no entrant', async () => {
    const { groupId, goalId } = await scene();
    const other = await seedGoal({ groupId });
    const strangerGroup = await seedCommunity(uniq('champ2'));
    const strangerGoal = await seedGoal({ groupId: strangerGroup });
    const p = await seedPromotion({
      goals: [
        { goalId, communityGroupId: groupId },
        // listed under the WRONG community on purpose
        { goalId: strangerGoal, communityGroupId: groupId },
      ],
    });
    const uid = await member(groupId, 'wrong');
    const stranger = await member(strangerGroup, 'stranger');
    const notListed = await contribute(uid, other, 5);
    const wrongCommunity = await contribute(stranger, strangerGoal, 5);

    expect(await ingestContribution(deps(), p, notListed.path)).toEqual({ outcome: 'refused', reason: 'goalNotInPromotion', recorded: true });
    expect(await ingestContribution(deps(), p, wrongCommunity.path)).toEqual({ outcome: 'refused', reason: 'communityMismatch', recorded: true });
    const s = await promotionState(p);
    expect(count(s.sources)).toBe(2);
    expect(count(s.entries)).toBe(0);
    expect(count(s.entrants)).toBe(0);
    expect(count(s.links)).toBe(0);
  });

  test('row 6: missing, malformed and forged rows → refused, nothing written', async () => {
    const { groupId, goalId } = await scene();
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }] });
    const db = getFirestore();
    // A row planted directly (never through performContribution) whose fields disagree with its name.
    const forgedId = `${goalId}_forgedUid_attempt-forged`;
    await db.doc(`wsfContributions/${forgedId}`).set({
      goalId,
      userId: 'someoneElse',
      attemptId: 'attempt-forged',
      communityGroupId: groupId,
      count: 5,
      createdAt: new Date(),
    });
    // A row with no createdAt has no commit instant.
    const noCreatedAt = `${goalId}_noStamp_attempt-nostamp`;
    await db.doc(`wsfContributions/${noCreatedAt}`).set({ goalId, userId: 'noStamp', attemptId: 'attempt-nostamp', communityGroupId: groupId, count: 5 });

    expect(await ingestContribution(deps(), p, `wsfContributions/${goalId}_nobody_attempt-none`)).toEqual({ outcome: 'refused', reason: 'sourceMissing', recorded: false });
    expect(await ingestContribution(deps(), p, `wsfContributions/${noCreatedAt}`)).toEqual({ outcome: 'refused', reason: 'sourceMalformed', recorded: false });
    expect(await ingestContribution(deps(), p, `wsfContributions/${forgedId}`)).toEqual({ outcome: 'refused', reason: 'sourceMismatch', recorded: true });
    expect(await ingestContribution(deps(), p, 'wsfGoalCounters/x/shards/0')).toEqual({ outcome: 'refused', reason: 'notAContributionPath', recorded: false });
    const s = await promotionState(p);
    expect(count(s.entries)).toBe(0);
    expect(count(s.entrants)).toBe(0);
    expect(count(s.sources)).toBe(1);
  });

  test('rows 7 + 22: the cutoff is the contribution\'s own createdAt; late processing of an early commit is accepted, in closing too', async () => {
    const { groupId, goalId } = await scene();
    const uid = await member(groupId, 'early');
    const late = await member(groupId, 'late');
    const early = await contribute(uid, goalId, 5);
    // The cutoff falls between the two commits.
    await new Promise((r) => setTimeout(r, 30));
    const cutoff = new Date();
    await new Promise((r) => setTimeout(r, 30));
    const after = await contribute(late, goalId, 5);

    const p = await seedPromotion({ status: 'closing', goals: [{ goalId, communityGroupId: groupId }], windowEndsAt: cutoff });
    expect(await ingestContribution(deps(), p, early.path)).toMatchObject({ outcome: 'accepted' });
    expect(await ingestContribution(deps(), p, after.path)).toEqual({ outcome: 'refused', reason: 'afterCutoff', recorded: true });
    const s = await promotionState(p);
    expect(count(s.entries)).toBe(1);
    expect(s.sources[`${p}_c_${early.docId}`]).toMatchObject({ verdict: 'accepted', sourceCommittedAtMs: expect.any(Number) });
    expect(s.sources[`${p}_c_${early.docId}`].sourceCommittedAtMs).toBeLessThan(cutoff.getTime());
  });

  test('row 18: perGoal → one entry per goal per entrant; perContribution → every contribution', async () => {
    const { groupId, goalId } = await scene();
    const uid = await member(groupId, 'rounds');
    const cs = [await contribute(uid, goalId, 5), await contribute(uid, goalId, 6), await contribute(uid, goalId, 7)];

    const perGoal = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }], repeatRule: 'perGoal' });
    const perContribution = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }], repeatRule: 'perContribution' });

    const g = await Promise.all(cs.map((c) => ingestContribution(deps(), perGoal, c.path)));
    const c = await Promise.all(cs.map((c) => ingestContribution(deps(), perContribution, c.path)));
    expect(g.filter((r) => r.outcome === 'accepted').length).toBe(1);
    expect(g.filter((r) => r.outcome === 'refused' && r.reason === 'goalAlreadyEntered').length).toBe(2);
    expect(c.every((r) => r.outcome === 'accepted')).toBe(true);
    expect(count((await promotionState(perGoal)).entries)).toBe(1);
    expect(count((await promotionState(perContribution)).entries)).toBe(3);
  });

  test('row 20: a prize failure leaves the accepted movement intact; a retry then succeeds', async () => {
    const { groupId, goalId } = await scene();
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }] });
    const uid = await member(groupId, 'fail');
    const c = await contribute(uid, goalId, 42);
    const before = { row: await contributionRow(c.path), total: await memberTotal(goalId, uid), shards: await shardSum(goalId) };
    expect(before.total).toBe(42);

    const failing: AwardDeps = {
      db: getFirestore(),
      beforeCommit: () => {
        throw new Error('synthetic prize storage failure');
      },
    };
    await expect(ingestContribution(failing, p, c.path)).rejects.toThrow('synthetic prize storage failure');

    const afterFail = { row: await contributionRow(c.path), total: await memberTotal(goalId, uid), shards: await shardSum(goalId) };
    expect(afterFail).toEqual(before);
    const s0 = await promotionState(p);
    expect(count(s0.sources) + count(s0.entries) + count(s0.entrants) + count(s0.links) + count(s0.tallies)).toBe(0);

    expect(await ingestContribution(deps(), p, c.path)).toMatchObject({ outcome: 'accepted' });
    expect(count((await promotionState(p)).entries)).toBe(1);
  });

  test('row 21: a disabled promotion produces no award — nothing is written, in every inactive status', async () => {
    const { groupId, goalId } = await scene();
    const uid = await member(groupId, 'fenced');
    const c = await contribute(uid, goalId, 5);
    for (const status of ['draft', 'disabled', 'frozen', 'drawn', 'archived'] as const) {
      const p = await seedPromotion({ status, goals: [{ goalId, communityGroupId: groupId }] });
      expect(await ingestContribution(deps(), p, c.path)).toEqual({ outcome: 'fenced', reason: 'promotionInactive' });
      const s = await promotionState(p);
      expect(count(s.sources) + count(s.entries) + count(s.entrants) + count(s.links) + count(s.tallies)).toBe(0);
      expect(s.entrantCount).toBe(0);
    }
    expect(await ingestContribution(deps(), 'no-such-promotion', c.path)).toEqual({ outcome: 'fenced', reason: 'promotionMissing' });
  });

  test('rows 24 + 25: a configuration edited after enablement is fenced as drift, and rule version is stamped', async () => {
    const { groupId, goalId } = await scene();
    const uid = await member(groupId, 'drift');
    const c1 = await contribute(uid, goalId, 5);
    const c2 = await contribute(uid, goalId, 5);
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }], ruleVersion: 3 });
    expect(await ingestContribution(deps(), p, c1.path)).toMatchObject({ outcome: 'accepted' });
    const s1 = await promotionState(p);
    expect(Object.values(s1.sources)[0].ruleVersion).toBe(3);
    expect(Object.values(s1.entries)[0].ruleVersion).toBe(3);

    await setPromotion(p, { repeatRule: 'perGoal' });
    expect(await ingestContribution(deps(), p, c2.path)).toEqual({ outcome: 'fenced', reason: 'configDrift' });
    await setPromotion(p, { repeatRule: 'perContribution', ruleVersion: 4 });
    expect(await ingestContribution(deps(), p, c2.path)).toEqual({ outcome: 'fenced', reason: 'configDrift' });
    expect(count((await promotionState(p)).sources)).toBe(1);

    const stale = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }], digest: 'stale' });
    expect(await ingestContribution(deps(), stale, c2.path)).toEqual({ outcome: 'fenced', reason: 'configDrift' });
    const absent = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }], digest: 'absent' });
    expect(await ingestContribution(deps(), absent, c2.path)).toEqual({ outcome: 'fenced', reason: 'configDrift' });
  });

  test('row 26: entrant identity is opaque — the uid appears only in the link document', async () => {
    const { groupId, goalId } = await scene();
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }] });
    const uid = await member(groupId, 'opaque');
    const c = await contribute(uid, goalId, 5);
    const r = await ingestContribution(deps(), p, c.path);
    expect(r.outcome).toBe('accepted');
    const s = await promotionState(p);
    const { links, ...rest } = s;
    const leaked = deepStrings(rest).filter((v) => v.includes(uid));
    // The source key and entry id embed the canonical contribution id, which
    // contains the uid by construction (it is wsfContributions' own key). That
    // is the ONE place the identity appears outside the link, and it names the
    // ledger row, not a person: assert nothing ELSE carries it.
    const allowed = new Set([`c_${c.docId}`, c.path]);
    for (const v of leaked) expect(allowed.has(v)).toBe(true);
    expect(Object.keys(rest.entrants)[0]).not.toContain(uid);
    expect(Object.values(rest.entries)[0].entrantId).not.toContain(uid);
    expect(Object.keys(links)).toEqual([`${p}_uid_${uid}`]);
  });

  test('trigger body in isolation: finds every awarding promotion listing the goal and ingests once each', async () => {
    const { groupId, goalId } = await scene();
    const pA = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }] });
    const pB = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }], status: 'closing' });
    const pDraft = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }], status: 'draft' });
    const uid = await member(groupId, 'trig');
    const c = await contribute(uid, goalId, 5);

    const results = await onContributionCreatedBody(deps(), { contributionPath: c.path, goalId });
    const byId = Object.fromEntries(results.map((r) => [r.promotionId, r.result]));
    expect(byId[pA]).toMatchObject({ outcome: 'accepted' });
    expect(byId[pB]).toMatchObject({ outcome: 'accepted' });
    expect(byId[pDraft]).toBeUndefined();
    const again = await onContributionCreatedBody(deps(), { contributionPath: c.path, goalId });
    expect(again.every((r) => r.result.outcome === 'replay')).toBe(true);
    expect(count((await promotionState(pDraft)).sources)).toBe(0);
  });
});
