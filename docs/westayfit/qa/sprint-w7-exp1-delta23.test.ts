/**
 * W7 · Check 23 — the changed behaviour of EXP1's `3b9963c9` (on reviewed
 * `8a434dd7`), proved by W7's own instrument. `@exp1/*` resolves to the
 * worktree chosen by W7_EXP1_WT, so the same file is the fail-first on the
 * reviewed head and the proof on the successor.
 *
 *  1. replay reports the actual non-empty source key (movement and form);
 *  2. fenced (disabled / frozen) and replay paths never call FormReceiptSource;
 *  3. a retried transaction re-reads the receipt and cannot reuse a stale one;
 *  4. an unlisted goal is notEntered / goalNotInPromotion, never pending.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import { wsfContribute } from '@exp1/index';
import {
  classifyEntryStatus,
  configDigest,
  ingestContribution,
  ingestFormReceipt,
  validatePromotionConfig,
  type FormReceipt,
  type FormReceiptSource,
} from '@exp1/expo-prize';

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

async function contribute(uid: string, goalId: string, count: number): Promise<{ path: string; docId: string }> {
  const attemptId = uniq('w7att');
  await call(wsfContribute, uid, { goalId, attemptId, count });
  const docId = `${goalId}_${uid}_${attemptId}`;
  return { path: `wsfContributions/${docId}`, docId };
}

async function promotion(groupId: string, goalId: string, status: string): Promise<string> {
  const now = Date.now();
  const doc: Record<string, unknown> = {
    status,
    ruleVersion: 7,
    repeatRule: 'perContribution',
    entrantCap: null,
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
  const ref = db().collection('wsfPromotions').doc();
  await ref.set(doc);
  return ref.id;
}

/** A receipt store that counts reads and can act on each read. */
class SpySource implements FormReceiptSource {
  reads: string[] = [];
  constructor(private readonly answer: (receiptId: string, n: number) => Promise<FormReceipt | null>) {}
  async read(receiptId: string): Promise<FormReceipt | null> {
    this.reads.push(receiptId);
    return this.answer(receiptId, this.reads.length);
  }
}

async function written(p: string) {
  const scan = async (col: string) => (await db().collection(col).get()).docs.filter((d) => d.id.startsWith(`${p}_`)).length;
  return { sources: await scan('wsfPromotionSources'), entries: await scan('wsfPromotionEntries'), entrants: await scan('wsfPromotionEntrants') };
}

describe('W7 check 23 — the delta of 3b9963c9', () => {
  test('1. replay reports the actual, non-empty source key', async () => {
    const { groupId, goalId } = await community();
    const p = await promotion(groupId, goalId, 'enabled');
    const uid = await joinMember(groupId, 'key');
    const c = await contribute(uid, goalId, 1);
    expect(await ingestContribution({ db: db() }, p, c.path)).toMatchObject({ outcome: 'accepted' });
    const replay = await ingestContribution({ db: db() }, p, c.path);
    console.info(`W7 23.1 movement replay: ${JSON.stringify(replay)}`);
    expect(replay).toEqual({ outcome: 'replay', verdict: { verdict: 'accepted', kind: 'movement', sourceKey: `c_${c.docId}`, entryId: `c_${c.docId}` } });

    const source = new SpySource(async (id) => ({ receiptId: id, subjectUid: uid, completedAtMs: Date.now() }));
    expect(await ingestFormReceipt({ db: db(), formSource: source }, p, { receiptId: 'w7-k1', claimantUid: uid })).toMatchObject({ outcome: 'accepted', kind: 'formBonus' });
    const formReplay = await ingestFormReceipt({ db: db(), formSource: source }, p, { receiptId: 'w7-k1', claimantUid: uid });
    console.info(`W7 23.1 form replay: ${JSON.stringify(formReplay)}`);
    expect(formReplay).toMatchObject({ outcome: 'replay', verdict: { verdict: 'accepted', kind: 'formBonus', sourceKey: 'f_w7-k1' } });
  });

  test('2. disabled / frozen promotions and a replay never touch the receipt store', async () => {
    const { groupId, goalId } = await community();
    const uid = await joinMember(groupId, 'fence');
    const source = new SpySource(async (id) => ({ receiptId: id, subjectUid: uid, completedAtMs: Date.now() }));
    for (const status of ['disabled', 'frozen', 'draft']) {
      const p = await promotion(groupId, goalId, status);
      const r = await ingestFormReceipt({ db: db(), formSource: source }, p, { receiptId: `w7-f-${status}`, claimantUid: uid });
      expect(r).toEqual({ outcome: 'fenced', reason: 'promotionInactive' });
      expect(await written(p)).toEqual({ sources: 0, entries: 0, entrants: 0 });
    }
    const missing = await ingestFormReceipt({ db: db(), formSource: source }, 'w7-no-such-promotion', { receiptId: 'w7-f-missing', claimantUid: uid });
    expect(missing).toEqual({ outcome: 'fenced', reason: 'promotionMissing' });
    console.info(`W7 23.2 reads after four fenced claims: ${source.reads.length}`);
    expect(source.reads).toEqual([]);

    const p = await promotion(groupId, goalId, 'enabled');
    expect(await ingestFormReceipt({ db: db(), formSource: source }, p, { receiptId: 'w7-f-ok', claimantUid: uid })).toMatchObject({ outcome: 'accepted' });
    expect(source.reads).toEqual(['w7-f-ok']);
    for (let i = 0; i < 3; i++) {
      expect(await ingestFormReceipt({ db: db(), formSource: source }, p, { receiptId: 'w7-f-ok', claimantUid: uid })).toMatchObject({ outcome: 'replay' });
    }
    console.info(`W7 23.2 reads after one accepted claim and three replays: ${JSON.stringify(source.reads)}`);
    expect(source.reads).toEqual(['w7-f-ok']);
  });

  test('3a. a retried transaction re-reads the receipt (same answer → accepted, two reads)', async () => {
    const { groupId, goalId } = await community();
    const p = await promotion(groupId, goalId, 'enabled');
    const uid = await joinMember(groupId, 'retry');
    // The first read invalidates the transaction's read of the promotion document
    // (an unrelated, undigested field), so the SDK retries; the second read answers again.
    const source = new SpySource(async (id, n) => {
      if (n === 1) await db().doc(`wsfPromotions/${p}`).set({ w7Touched: n }, { merge: true });
      return { receiptId: id, subjectUid: uid, completedAtMs: Date.now() };
    });
    const r = await ingestFormReceipt({ db: db(), formSource: source }, p, { receiptId: 'w7-r-same', claimantUid: uid });
    console.info(`W7 23.3a: reads=${source.reads.length} outcome=${JSON.stringify(r)}`);
    expect(source.reads.length).toBeGreaterThanOrEqual(2);
    expect(r).toMatchObject({ outcome: 'accepted', kind: 'formBonus' });
    expect(await written(p)).toEqual({ sources: 1, entries: 1, entrants: 1 });
  });

  test('3b. a retried transaction cannot reuse a stale receipt (subject changes between reads → refused, nothing written)', async () => {
    const { groupId, goalId } = await community();
    const p = await promotion(groupId, goalId, 'enabled');
    const uid = await joinMember(groupId, 'stale');
    const other = await joinMember(groupId, 'other');
    const source = new SpySource(async (id, n) => {
      if (n === 1) {
        await db().doc(`wsfPromotions/${p}`).set({ w7Touched: n }, { merge: true });
        return { receiptId: id, subjectUid: uid, completedAtMs: Date.now() }; // the stale answer
      }
      return { receiptId: id, subjectUid: other, completedAtMs: Date.now() }; // the store's current truth
    });
    const r = await ingestFormReceipt({ db: db(), formSource: source }, p, { receiptId: 'w7-r-stale', claimantUid: uid });
    console.info(`W7 23.3b: reads=${source.reads.length} outcome=${JSON.stringify(r)}`);
    expect(source.reads.length).toBeGreaterThanOrEqual(2);
    expect(r).toEqual({ outcome: 'refused', reason: 'subjectMismatch', recorded: false });
    expect(await written(p)).toEqual({ sources: 0, entries: 0, entrants: 0 });
  });

  test('4. an unlisted goal is notEntered / goalNotInPromotion, never pending; the four answers stand', () => {
    const c = classifyEntryStatus as unknown as (i: Record<string, unknown>) => unknown;
    const unlisted = c({ promotion: 'active', goalEligible: false, contributionExists: true, source: null });
    console.info(`W7 23.4 unlisted goal: ${JSON.stringify(unlisted)}`);
    expect(unlisted).toEqual({ status: 'notEntered', reason: 'goalNotInPromotion' });
    expect(c({ promotion: 'active', goalEligible: true, contributionExists: true, source: null })).toEqual({ status: 'pending' });
    expect(c({ promotion: 'active', goalEligible: true, contributionExists: true, source: { verdict: 'accepted' } })).toEqual({ status: 'confirmed' });
    expect(c({ promotion: 'active', goalEligible: true, contributionExists: false, source: null })).toEqual({ status: 'unknown' });
    expect(c({ promotion: 'inactive', goalEligible: false, contributionExists: true, source: null })).toEqual({ status: 'notEntered', reason: 'promotionInactive' });
  });
});
