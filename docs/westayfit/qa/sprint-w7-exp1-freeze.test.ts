/**
 * W7 · Check 22 — F: does `reconcilePromotion(...).converged` ever become true
 * on a goal that is still open after the promotion's cutoff? MEASURED at EXP1
 * head 8a434dd7. CONTRACT.md:187-189 says close → frozen is permitted when a
 * full pass reports zero unprocessed rows with createdAt < windowEndsAt;
 * reconcile.ts:136 defines converged as writes === 0 && fenced === 0, and a
 * post-cutoff row is refused `afterCutoff` WITH a recorded source row, which
 * reconcile.ts:76 counts as a write.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';

import { wsfContribute } from '../wt-exp1/functions-westayfit/src/index';
import { configDigest, reconcilePromotion, validatePromotionConfig } from '../wt-exp1/functions-westayfit/src/expo-prize';

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

describe('W7 check 22 — convergence after the cutoff on a goal that is still open', () => {
  test('F: converged flips back to false whenever anyone moves after the cutoff', async () => {
    const { groupId, goalId } = await community();
    const a = await joinMember(groupId, 'a');
    const b = await joinMember(groupId, 'b');
    await contribute(a, goalId, 1); // pre-cutoff
    await new Promise((r) => setTimeout(r, 30));
    const cutoff = Date.now();
    await new Promise((r) => setTimeout(r, 30));

    const now = Date.now();
    const doc: Record<string, unknown> = {
      status: 'closing',
      ruleVersion: 7,
      repeatRule: 'perContribution',
      entrantCap: null,
      eligibleGoals: [{ goalId, communityGroupId: groupId }],
      eligibleGoalIds: [goalId],
      windowStartsAt: Timestamp.fromMillis(now - 3_600_000),
      windowEndsAt: Timestamp.fromMillis(cutoff),
      formBonusEntries: 1,
      operatorUids: [],
    };
    const v = validatePromotionConfig(doc);
    if (!v.ok) throw new Error('W7 fixture: ' + JSON.stringify(v.problems));
    doc.enabledConfigDigest = configDigest(v.policy);
    const ref = db().collection('wsfPromotions').doc();
    await ref.set(doc);
    const p = ref.id;

    const pass1 = await reconcilePromotion({ db: db() }, p, { pageSize: 10 });
    const pass2 = await reconcilePromotion({ db: db() }, p, { pageSize: 10 });
    // The goal is still open: a member moves after the cutoff (performContribution knows no promotion).
    await contribute(b, goalId, 1);
    const pass3 = await reconcilePromotion({ db: db() }, p, { pageSize: 10 });
    const pass4 = await reconcilePromotion({ db: db() }, p, { pageSize: 10 });
    const sources = (await db().collection('wsfPromotionSources').get()).docs.filter((d) => d.id.startsWith(`${p}_`)).map((d) => d.data());
    console.info(
      `W7 F: pass1=${JSON.stringify({ processed: pass1.processed, writes: pass1.writes, converged: pass1.converged })} ` +
        `pass2=${JSON.stringify({ processed: pass2.processed, writes: pass2.writes, converged: pass2.converged })} ` +
        `[post-cutoff contribution] pass3=${JSON.stringify({ processed: pass3.processed, writes: pass3.writes, converged: pass3.converged })} ` +
        `pass4=${JSON.stringify({ processed: pass4.processed, writes: pass4.writes, converged: pass4.converged })} ` +
        `sources=${JSON.stringify(sources.map((s) => ({ verdict: s.verdict, reason: s.reason ?? null })))}`
    );
    expect(pass1).toMatchObject({ processed: 1, writes: 1, converged: false });
    expect(pass2).toMatchObject({ processed: 1, writes: 0, converged: true });
    // The measured point: the post-cutoff row is refused afterCutoff and RECORDED, which counts as a write.
    expect(pass3).toMatchObject({ processed: 2, writes: 1, converged: false });
    expect(sources.filter((s) => s.reason === 'afterCutoff')).toHaveLength(1);
    expect(pass4).toMatchObject({ processed: 2, writes: 0, converged: true });
  });
});
