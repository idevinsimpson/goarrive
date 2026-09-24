/**
 * W7 · Check 22 — an INDEPENDENT re-derivation of EXP1's three concurrency
 * results on the Firestore emulator (demo-wsf-local), at EXP1 head 8a434dd7.
 *
 * Not EXP1's fixtures, not EXP1's assertions: this file seeds the community,
 * goal and promotion itself through the Admin SDK, makes real contributions
 * through the real `wsfContribute` callable, drives the core, and reads the
 * resulting state back by scanning the raw collections. Each scenario runs
 * three times. Every sample is asserted.
 *
 * The only EXP1 code used besides the unit under test is `configDigest` /
 * `validatePromotionConfig`, because the contract requires the enablement
 * digest on the promotion document (policy.ts:224-227) and nothing else in
 * the packet writes it.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';

// The worktree under test (EXP1 head), reached relatively from the scratch dir.
import { wsfContribute } from '../wt-exp1/functions-westayfit/src/index';
import {
  InMemoryFormReceiptSource,
  configDigest,
  ingestContribution,
  ingestFormReceipt,
  validatePromotionConfig,
} from '../wt-exp1/functions-westayfit/src/expo-prize';

const db = () => getFirestore();
const uniq = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;

async function call(fn: unknown, uid: string, data: Record<string, unknown>): Promise<unknown> {
  return (fn as { run: (req: unknown) => Promise<unknown> }).run({
    auth: { uid, token: { email_verified: true } },
    data,
    rawRequest: {},
    acceptsStreaming: false,
  });
}

async function community(): Promise<{ groupId: string; goalId: string }> {
  const championUid = uniq('w7champ');
  const groupId = uniq('w7grp');
  await db().doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'W7 Expo Movers',
    groupType: 'custom',
    joinPolicy: 'public',
    joinCode: uniq('w7join1234567890'),
    createdByUserId: championUid,
    lifecycleStatus: 'active',
    isSample: false,
  });
  await db().doc(`wsfMemberships/${groupId}_${championUid}`).set({
    groupId,
    userId: championUid,
    role: 'foundingChampion',
    membershipStatus: 'active',
  });
  const goalRef = db().collection('wsfGoals').doc();
  const now = Date.now();
  await goalRef.set({
    ownerUid: championUid,
    communityGroupId: groupId,
    title: 'W7 squats',
    target: 5000,
    unit: 'squats',
    status: 'active',
    startsAt: Timestamp.fromMillis(now - 86_400_000),
    endsAt: Timestamp.fromMillis(now + 6 * 86_400_000),
    timezone: 'America/New_York',
    repeatPolicy: 'multiple',
    aggregateDisplayAuthorized: true,
    crossingTracked: true,
  });
  return { groupId, goalId: goalRef.id };
}

async function joinMember(groupId: string, label: string): Promise<string> {
  const uid = uniq(`w7${label}`);
  await db().doc(`wsfMemberships/${groupId}_${uid}`).set({ groupId, userId: uid, role: 'member', membershipStatus: 'active' });
  return uid;
}

async function contribute(uid: string, goalId: string, count: number): Promise<string> {
  const attemptId = uniq('w7att');
  await call(wsfContribute, uid, { goalId, attemptId, count });
  return `wsfContributions/${goalId}_${uid}_${attemptId}`;
}

async function promotion(groupId: string, goalId: string, entrantCap: number | null): Promise<string> {
  const now = Date.now();
  const doc: Record<string, unknown> = {
    status: 'enabled',
    ruleVersion: 7,
    repeatRule: 'perContribution',
    entrantCap,
    eligibleGoals: [{ goalId, communityGroupId: groupId }],
    eligibleGoalIds: [goalId],
    windowStartsAt: Timestamp.fromMillis(now - 3_600_000),
    windowEndsAt: Timestamp.fromMillis(now + 3_600_000),
    formBonusEntries: 1,
    operatorUids: [],
  };
  const v = validatePromotionConfig(doc);
  if (!v.ok) throw new Error('W7 fixture: promotion does not validate: ' + JSON.stringify(v.problems));
  doc.enabledConfigDigest = configDigest(v.policy);
  const ref = db().collection('wsfPromotions').doc();
  await ref.set(doc);
  return ref.id;
}

/** Raw state: a full scan of each collection, filtered by the promotion prefix in code. */
async function rawState(p: string) {
  const scan = async (col: string) => {
    const snap = await db().collection(col).get();
    return snap.docs.filter((d) => d.id.startsWith(`${p}_`)).map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));
  };
  const counter = await db().doc(`wsfPromotionCounters/${p}`).get();
  return {
    sources: await scan('wsfPromotionSources'),
    entries: await scan('wsfPromotionEntries'),
    entrants: await scan('wsfPromotionEntrants'),
    links: await scan('wsfPromotionEntrantLinks'),
    tallies: await scan('wsfPromotionEntrantTallies'),
    entrantCount: (counter.data() as { entrantCount?: number } | undefined)?.entrantCount ?? null,
  };
}

const RUNS = [1, 2, 3];

describe('W7 check 22 — concurrency, re-derived', () => {
  beforeAll(async () => {
    await db().doc('_warmup/w7-exp1').set({ at: Date.now() });
  });

  test.each(RUNS)('A%i: six concurrent FIRST ingestions of one contribution → 1 accepted, 5 replay, one of everything', async (run) => {
    const { groupId, goalId } = await community();
    const p = await promotion(groupId, goalId, null);
    const uid = await joinMember(groupId, 'dup');
    const path = await contribute(uid, goalId, 4);
    const before = await db().doc(path).get();

    const results = await Promise.all(Array.from({ length: 6 }, () => ingestContribution({ db: db() }, p, path)));
    const outcomes = results.map((r) => r.outcome).sort();
    expect(outcomes).toEqual(['accepted', 'replay', 'replay', 'replay', 'replay', 'replay']);
    const accepted = results.find((r) => r.outcome === 'accepted') as { entryId: string; entrantId: string };
    for (const r of results) {
      if (r.outcome === 'replay') expect(r.verdict).toMatchObject({ verdict: 'accepted', entryId: accepted.entryId });
    }

    const s = await rawState(p);
    expect(s.sources.map((x) => x.id)).toEqual([`${p}_c_${path.split('/')[1]}`]);
    expect(s.entries.map((x) => x.id)).toEqual([`${p}_c_${path.split('/')[1]}`]);
    expect(s.entries[0]).toMatchObject({ entrantId: accepted.entrantId, status: 'confirmed', kind: 'movement', tickets: 1, ruleVersion: 7 });
    expect(s.entrants.map((x) => x.id)).toEqual([`${p}_${accepted.entrantId}`]);
    expect(s.links.map((x) => x.id)).toEqual([`${p}_uid_${uid}`]);
    expect(s.tallies).toHaveLength(1);
    expect(s.tallies[0]).toMatchObject({ entryCount: 1 });
    expect(s.entrantCount).toBeNull(); // no cap → the counter is never touched
    // The contribution row is untouched by six concurrent awards.
    const after = await db().doc(path).get();
    expect(after.data()).toEqual(before.data());
    expect(after.updateTime?.toMillis()).toBe(before.updateTime?.toMillis());
    console.info(`W7 A${run}: outcomes=${JSON.stringify(outcomes)} sources=${s.sources.length} entries=${s.entries.length} entrants=${s.entrants.length} tally=${JSON.stringify(s.tallies[0]?.entryCount)}`);
  });

  test.each(RUNS)('B%i: four concurrent receipts for one subject → exactly one bonus', async (run) => {
    const { groupId, goalId } = await community();
    const p = await promotion(groupId, goalId, null);
    const uid = await joinMember(groupId, 'form');
    const source = new InMemoryFormReceiptSource();
    const ids = ['w7r1', 'w7r2', 'w7r3', 'w7r4'].map((x) => `${x}-${run}`);
    for (const receiptId of ids) source.seed({ receiptId, subjectUid: uid, completedAtMs: Date.now() });

    const results = await Promise.all(ids.map((receiptId) => ingestFormReceipt({ db: db(), formSource: source }, p, { receiptId, claimantUid: uid })));
    const accepted = results.filter((r) => r.outcome === 'accepted');
    const refused = results.filter((r) => r.outcome === 'refused');
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(3);
    for (const r of refused) expect(r).toMatchObject({ reason: 'bonusAlreadyAwarded', recorded: true });

    const s = await rawState(p);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ kind: 'formBonus', status: 'confirmed', tickets: 1 });
    expect(s.entrants).toHaveLength(1);
    expect(s.links).toHaveLength(1);
    expect(s.sources).toHaveLength(4);
    expect(s.sources.filter((x) => x.verdict === 'accepted')).toHaveLength(1);
    expect(s.sources.filter((x) => x.verdict === 'refused' && x.reason === 'bonusAlreadyAwarded')).toHaveLength(3);
    expect(s.tallies).toHaveLength(1);
    expect(s.tallies[0]).toMatchObject({ entryCount: 1, formBonusAwarded: true });
    // No movement was created or changed by four form claims.
    const totals = await db().doc(`wsfGoalMemberTotals/${goalId}_${uid}`).get();
    expect(totals.exists).toBe(false);
    console.info(`W7 B${run}: accepted=${accepted.length} refused=${refused.length} entries=${s.entries.length} tally=${JSON.stringify({ c: s.tallies[0]?.entryCount, b: s.tallies[0]?.formBonusAwarded })}`);
  });

  test.each(RUNS)('C%i: six concurrent first-time entrants against a cap of 2 → exactly 2 admitted, 4 refused capReached', async (run) => {
    const { groupId, goalId } = await community();
    const p = await promotion(groupId, goalId, 2);
    const uids = await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map((l) => joinMember(groupId, l)));
    const paths = await Promise.all(uids.map((u) => contribute(u, goalId, 2)));

    const results = await Promise.all(paths.map((path) => ingestContribution({ db: db() }, p, path)));
    const admitted = results.filter((r) => r.outcome === 'accepted');
    const refused = results.filter((r) => r.outcome === 'refused');
    expect(admitted).toHaveLength(2);
    expect(refused).toHaveLength(4);
    for (const r of refused) expect(r).toMatchObject({ reason: 'capReached', recorded: true });

    const s = await rawState(p);
    expect(s.entrantCount).toBe(2);
    expect(s.entrants).toHaveLength(2);
    expect(s.links).toHaveLength(2);
    expect(s.entries).toHaveLength(2);
    expect(s.sources).toHaveLength(6);
    expect(s.sources.filter((x) => x.verdict === 'accepted')).toHaveLength(2);
    expect(s.sources.filter((x) => x.reason === 'capReached')).toHaveLength(4);
    // Every one of the six contributions is exactly as performContribution committed it.
    for (const [i, path] of paths.entries()) {
      const row = (await db().doc(path).get()).data() as { count: number; userId: string };
      expect(row).toMatchObject({ count: 2, userId: uids[i] });
      const total = (await db().doc(`wsfGoalMemberTotals/${goalId}_${uids[i]}`).get()).data() as { total?: number };
      expect(total?.total).toBe(2);
    }
    // A replay admits nobody and the counter stays at 2.
    const again = await Promise.all(paths.map((path) => ingestContribution({ db: db() }, p, path)));
    expect(again.every((r) => r.outcome === 'replay')).toBe(true);
    expect((await rawState(p)).entrantCount).toBe(2);
    console.info(`W7 C${run}: admitted=${admitted.length} refused=${refused.length} entrantCount=${s.entrantCount} entrants=${s.entrants.length}`);
  });
});
