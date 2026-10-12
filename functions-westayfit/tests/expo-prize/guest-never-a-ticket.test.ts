/**
 * KIOSK-GUEST-MOVE-1 — a guest move is never a raffle entry.
 *
 * The owner's rule (17:11Z, relayed in #365 6111692291): anonymous guest kiosk
 * squats count toward the community goal, and guests never earn raffle
 * tickets. This drives the raffle's OWN functions — ingest, the creation
 * trigger's body, reconcile and freeze — against guest moves made through the
 * real wsfStationGuestContribute, on real emulator transactions:
 *
 *   - a guest move is not a contribution path, so ingest and the trigger
 *     body refuse it before reading anything, and write nothing;
 *   - reconcile, which scans wsfContributions for the promotion's goals, never
 *     sees one: a goal moved only by guests reconciles to nothing at all;
 *   - freeze, over a goal moved by members AND guests, counts the members'
 *     tickets exactly, with no row error from any guest; over a goal moved
 *     only by guests, it refuses `poolEmpty` — there is nobody to draw;
 *   - nothing the raffle writes carries a station id or an attempt id.
 *
 * All fixtures are synthetic and local to the demo-wsf-local emulator.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { getFirestore } from 'firebase-admin/firestore';

import {
  anon,
  awaitServerTimePast,
  contribute,
  count,
  deepStrings,
  member,
  poolDoc,
  promotionState,
  seedClosing,
  seedPromotion,
  shardSum,
  turnScene,
  uniq,
  type Station,
} from './fixtures';
import {
  contributionDocIdFromPath,
  freezePromotion,
  ingestContribution,
  onContributionCreatedBody,
  readContributionRow,
  reconcilePromotion,
  type FreezeDeps,
  type FreezeResult,
} from '../../src/expo-prize';
import { GUEST_MOVES_COLLECTION, guestLinkId, guestMoveId } from '../../src/guest-contribute';
import { wsfStationGuestContribute } from '../../src/index';

const deps = (): FreezeDeps => ({ db: getFirestore() });

type GuestReply = { recorded: boolean; amount: number };

async function guestMove(station: Station, count: number) {
  const attemptId = uniq('guestAttempt');
  const reply = (await anon(wsfStationGuestContribute, {
    stationId: station.stationId,
    secret: station.secret,
    count,
    attemptId,
  })) as GuestReply;
  expect(reply.recorded).toBe(true);
  return { attemptId, path: `${GUEST_MOVES_COLLECTION}/${guestMoveId(station.stationId, attemptId)}` };
}

/** Freeze, running the pass as many times as it asks (it converges in two),
 * and proving that no pass on the way met a row it could not read. */
async function freezeUntilSettled(promotionId: string): Promise<FreezeResult> {
  const results: FreezeResult[] = [await freezePromotion(deps(), promotionId)];
  while (results.length < 4 && results[results.length - 1].outcome === 'notReady') {
    results.push(await freezePromotion(deps(), promotionId));
  }
  for (const r of results) {
    if (r.outcome === 'notReady') expect(r.reason).not.toBe('rowErrors');
    if ((r.outcome === 'notReady' || r.outcome === 'frozen') && r.pass) expect(r.pass.rowErrors).toBe(0);
  }
  return results[results.length - 1];
}

beforeAll(async () => {
  await getFirestore().doc('_warmup/expo-prize-guest').set({ at: Date.now() });
});

describe('a guest move is never a raffle entry', () => {
  test('the stored guest move is not a contribution, by path or by shape', async () => {
    const { goalId, station } = await turnScene();
    const move = await guestMove(station, 12);

    expect(contributionDocIdFromPath(move.path)).toBeNull();
    expect(contributionDocIdFromPath(`wsfCombinedCredits/${guestLinkId(station.stationId, move.attemptId)}`)).toBeNull();
    expect(contributionDocIdFromPath(`wsfGoals/${goalId}/recentAdditions/${guestLinkId(station.stationId, move.attemptId)}`)).toBeNull();
    // Even read as if it were one, it names nobody, so it is not a row.
    const raw = (await getFirestore().doc(move.path).get()).data();
    expect(raw).toBeDefined();
    expect(readContributionRow(raw)).toBeNull();
  });

  test('ingest and the creation trigger body refuse a guest move and write nothing, under an enabled promotion', async () => {
    const { groupId, goalId, station } = await turnScene();
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }] });
    const move = await guestMove(station, 20);

    expect(await ingestContribution(deps(), p, move.path)).toEqual({
      outcome: 'refused',
      reason: 'notAContributionPath',
      recorded: false,
    });
    expect(await onContributionCreatedBody(deps(), { contributionPath: move.path, goalId })).toEqual([
      { promotionId: p, result: { outcome: 'refused', reason: 'notAContributionPath', recorded: false } },
    ]);
    // A forged contribution path named after the guest move finds no row.
    expect(await ingestContribution(deps(), p, `wsfContributions/${guestMoveId(station.stationId, move.attemptId)}`)).toEqual({
      outcome: 'refused',
      reason: 'sourceMissing',
      recorded: false,
    });

    const s = await promotionState(p);
    expect(count(s.entrants) + count(s.links) + count(s.sources) + count(s.entries) + count(s.tallies)).toBe(0);
    expect(s.entrantCount).toBe(0);
  });

  test('reconcile over a goal moved only by guests processes nothing and writes nothing; the goal total still moved', async () => {
    const { groupId, goalId, station } = await turnScene();
    const p = await seedPromotion({ goals: [{ goalId, communityGroupId: groupId }] });
    await guestMove(station, 5);
    await guestMove(station, 6);
    await guestMove(station, 7);

    const summary = await reconcilePromotion(deps(), p, { pageSize: 2 });
    expect(summary).toMatchObject({ processed: 0, writes: 0, fenced: 0, converged: true });
    const s = await promotionState(p);
    expect(count(s.entries)).toBe(0);
    expect(count(s.sources)).toBe(0);
    expect(await shardSum(goalId)).toBe(18);
  });

  test('freeze over members AND guests: exactly the members\' tickets, no row error, and the pool names no guest', async () => {
    const { groupId, goalId, station } = await turnScene();
    const a = await member(groupId, 'ann');
    const b = await member(groupId, 'ben');
    await contribute(a, goalId, 10);
    const g1 = await guestMove(station, 11);
    await contribute(b, goalId, 12);
    const g2 = await guestMove(station, 13);
    await contribute(a, goalId, 14);
    expect(await shardSum(goalId)).toBe(10 + 11 + 12 + 13 + 14);

    const { promotionId: p, windowEndMs } = await seedClosing([{ goalId, communityGroupId: groupId }], { cutoffInMs: 1200 });
    await awaitServerTimePast(windowEndMs);
    const done = await freezeUntilSettled(p);
    expect(done.outcome).toBe('frozen');
    if (done.outcome !== 'frozen') throw new Error('unreachable');
    expect(done.totalTickets).toBe(3);
    expect(done.entrantCount).toBe(2);
    expect(done.pass).toMatchObject({ processed: 3, rowErrors: 0 });

    const s = await promotionState(p);
    expect(count(s.entries)).toBe(3);
    expect(count(s.sources)).toBe(3);
    const raffle = [s, await poolDoc(p)];
    for (const str of deepStrings(raffle)) {
      for (const leak of [station.stationId, g1.attemptId, g2.attemptId, 'kioskGuest']) expect(str).not.toContain(leak);
    }
  });

  test('freeze over a goal moved only by guests refuses poolEmpty, with no row error', async () => {
    const { groupId, goalId, station } = await turnScene();
    await guestMove(station, 30);
    await guestMove(station, 40);
    const { promotionId: p, windowEndMs } = await seedClosing([{ goalId, communityGroupId: groupId }], { cutoffInMs: 1200 });
    await awaitServerTimePast(windowEndMs);

    const r = await freezeUntilSettled(p);
    expect(r).toMatchObject({ outcome: 'refused', reason: 'poolEmpty' });
    expect(await poolDoc(p)).toBeUndefined();
    const s = await promotionState(p);
    expect(count(s.entries)).toBe(0);
    expect(count(s.sources)).toBe(0);
    expect(await shardSum(goalId)).toBe(70);
  });
});
