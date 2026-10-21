/**
 * W7 · Check 22 — two cap edges the review raised, MEASURED on the emulator
 * at EXP1 head 8a434dd7. Same independent seeding as the concurrency file.
 *
 * D: a cap configured AFTER cap-less admissions (the operator re-enables with a
 *    cap, recomputing the digest — the only way past the drift fence). The
 *    expectation written here is the CONTRACT's ("the cap is an explicit
 *    configured number of entrants"); if the head admits past it, this test
 *    fails at the exact assertion and the console line records what happened.
 * E: the form path under a cap — a form-only first entrant against a full cap
 *    must be refused capReached and create no entrant; with room, admitted and
 *    counted. EXP1's cap rows create only movement sources.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';

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
  await db().doc(`wsfMemberships/${groupId}_${championUid}`).set({ groupId, userId: championUid, role: 'foundingChampion', membershipStatus: 'active' });
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

function promotionDoc(groupId: string, goalId: string, entrantCap: number | null): Record<string, unknown> {
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
  if (!v.ok) throw new Error('W7 fixture: ' + JSON.stringify(v.problems));
  doc.enabledConfigDigest = configDigest(v.policy);
  return doc;
}

async function promotion(groupId: string, goalId: string, entrantCap: number | null): Promise<string> {
  const ref = db().collection('wsfPromotions').doc();
  await ref.set(promotionDoc(groupId, goalId, entrantCap));
  return ref.id;
}

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
    entrantCount: (counter.data() as { entrantCount?: number } | undefined)?.entrantCount ?? null,
  };
}

describe('W7 check 22 — cap edges, measured', () => {
  test('D: a cap of 1 configured after three cap-less admissions — does the fourth first-time entrant get in?', async () => {
    const { groupId, goalId } = await community();
    const ref = db().collection('wsfPromotions').doc();
    await ref.set(promotionDoc(groupId, goalId, null));
    const p = ref.id;
    const early = await Promise.all(['a', 'b', 'c'].map((l) => joinMember(groupId, l)));
    for (const uid of early) {
      expect(await ingestContribution({ db: db() }, p, await contribute(uid, goalId, 1))).toMatchObject({ outcome: 'accepted', entrantCreated: true });
    }
    const s0 = await rawState(p);
    expect(s0.entrants).toHaveLength(3);
    expect(s0.entrantCount).toBeNull();

    // The operator re-enables with a cap of 1: the whole configuration is rewritten
    // with a fresh digest (the only way past the configDrift fence, policy.ts:224-227).
    await ref.set(promotionDoc(groupId, goalId, 1));

    const fourth = await joinMember(groupId, 'd');
    const r = await ingestContribution({ db: db() }, p, await contribute(fourth, goalId, 1));
    const s1 = await rawState(p);
    console.info(`W7 D: fourth entrant under cap 1 after 3 cap-less admissions → outcome=${r.outcome}${r.outcome === 'refused' ? '/' + r.reason : ''} entrants=${s1.entrants.length} entrantCount=${s1.entrantCount}`);
    // CONTRACT expectation: the cap is "an explicit configured number of entrants" — 3 > 1, so no room.
    expect(r).toMatchObject({ outcome: 'refused', reason: 'capReached' });
    expect(s1.entrants).toHaveLength(3);
  });

  test('E1: a form-only first entrant against a FULL cap is refused capReached, recorded, no entrant', async () => {
    const { groupId, goalId } = await community();
    const p = await promotion(groupId, goalId, 1);
    const mover = await joinMember(groupId, 'mover');
    expect(await ingestContribution({ db: db() }, p, await contribute(mover, goalId, 1))).toMatchObject({ outcome: 'accepted', entrantCreated: true });
    const walker = await joinMember(groupId, 'walker');
    const source = new InMemoryFormReceiptSource();
    source.seed({ receiptId: 'w7-e1', subjectUid: walker, completedAtMs: Date.now() });
    const r = await ingestFormReceipt({ db: db(), formSource: source }, p, { receiptId: 'w7-e1', claimantUid: walker });
    const s = await rawState(p);
    console.info(`W7 E1: form-only entrant vs full cap → ${JSON.stringify(r)} entrants=${s.entrants.length} entrantCount=${s.entrantCount} sources=${s.sources.length}`);
    expect(r).toEqual({ outcome: 'refused', reason: 'capReached', recorded: true });
    expect(s.entrants).toHaveLength(1);
    expect(s.links).toHaveLength(1);
    expect(s.entrantCount).toBe(1);
    expect(s.sources.filter((x) => x.id === `${p}_f_w7-e1`)).toHaveLength(1);
    expect(s.entries).toHaveLength(1);
  });

  test('E2: a form-only first entrant with room under the cap is admitted and counted', async () => {
    const { groupId, goalId } = await community();
    const p = await promotion(groupId, goalId, 2);
    const walker = await joinMember(groupId, 'walker2');
    const source = new InMemoryFormReceiptSource();
    source.seed({ receiptId: 'w7-e2', subjectUid: walker, completedAtMs: Date.now() });
    const r = await ingestFormReceipt({ db: db(), formSource: source }, p, { receiptId: 'w7-e2', claimantUid: walker });
    const s = await rawState(p);
    console.info(`W7 E2: form-only first entrant with room → ${JSON.stringify(r)} entrants=${s.entrants.length} entrantCount=${s.entrantCount}`);
    expect(r).toMatchObject({ outcome: 'accepted', kind: 'formBonus', entrantCreated: true });
    expect(s.entrants).toHaveLength(1);
    expect(s.entrantCount).toBe(1);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toMatchObject({ kind: 'formBonus', tickets: 1 });
  });
});
