/**
 * W7 · Check 24 — EXP2A's enable transition at `41cb6dff`, proved by W7's own
 * instrument (own seeding, raw reads, byte comparison of the promotion
 * document including its updateTime). `@exp1/*` resolves to the worktree
 * chosen by W7_EXP1_WT.
 *
 *  A. invalid / missing decisions → refused, field named, no write;
 *  B. the stored routing array is replaced by the sorted derived ids; a
 *     missing / reordered / widened / edited array fences adjudication and
 *     the trigger body's routed award instead of rerouting;
 *  C. any entrant, uid link or nonzero counter blocks enable, including a
 *     cap-null promotion manually returned to draft — no mutation;
 *  D. every non-draft status and every enable artefact blocks, no mutation;
 *  E. concurrent enables → one immutable enablement, no partial state;
 *  F. operator uids: nonempty / valid / unique, canonical in the digest,
 *     never written into any award document.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';

import { wsfContribute } from '@exp1/index';
import {
  configDigest,
  enablePromotion,
  ingestContribution,
  onContributionCreatedBody,
  readPromotion,
  validatePromotionConfig,
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

async function community(goalCount = 1): Promise<{ groupId: string; goals: string[] }> {
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
  const goals: string[] = [];
  const now = Date.now();
  for (let i = 0; i < goalCount; i++) {
    const goalRef = db().collection('wsfGoals').doc();
    await goalRef.set({
      ownerUid: championUid,
      communityGroupId: groupId,
      title: `W7 goal ${i}`,
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
    goals.push(goalRef.id);
  }
  return { groupId, goals };
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

const OPERATOR = 'w7operator_' + Math.random().toString(36).slice(2, 8);

/** A complete draft document (no digest, no enabledAt) with the given goals, in the given order. */
function draftDoc(groupId: string, goals: string[], over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    status: 'draft',
    ruleVersion: 3,
    repeatRule: 'perContribution',
    entrantCap: null,
    eligibleGoals: goals.map((goalId) => ({ goalId, communityGroupId: groupId })),
    eligibleGoalIds: ['w7-forged-array'],
    windowStartsAt: Timestamp.fromMillis(now - 3_600_000),
    windowEndsAt: Timestamp.fromMillis(now + 3_600_000),
    formBonusEntries: 1,
    operatorUids: [OPERATOR],
    createdAt: Timestamp.now(),
    ...over,
  };
}

async function seed(doc: Record<string, unknown>): Promise<string> {
  const ref = db().collection('wsfPromotions').doc();
  await ref.set(doc);
  return ref.id;
}

/** Everything about the stored document, including the server's updateTime. */
async function snapshot(p: string) {
  const s = await db().doc(`wsfPromotions/${p}`).get();
  return JSON.stringify({ u: s.updateTime?.toMillis() ?? null, d: s.data() }, (_k, v) => (v instanceof Timestamp ? v.toMillis() : v));
}

async function enabledDoc(groupId: string, goals: string[]): Promise<string> {
  const p = await seed(draftDoc(groupId, goals));
  const r = await enablePromotion({ db: db() }, p);
  if (r.outcome !== 'enabled') throw new Error('W7 fixture: enable failed ' + JSON.stringify(r));
  return p;
}

describe('W7 check 24 — EXP2A enable transition', () => {
  test('A. every missing or invalid decision is refused with its field named, and nothing is written', async () => {
    const { groupId, goals } = await community();
    const cases: Array<[string, Record<string, unknown>]> = [
      ['repeatRule', { repeatRule: FieldValue.delete() }],
      ['repeatRule', { repeatRule: 'onePerActivity' }],
      ['entrantCap', { entrantCap: FieldValue.delete() }],
      ['entrantCap', { entrantCap: 0 }],
      ['entrantCap', { entrantCap: 1.5 }],
      ['eligibleGoals', { eligibleGoals: [] }],
      ['eligibleGoals', { eligibleGoals: [{ goalId: goals[0] }] }],
      ['windowEndsAt', { windowEndsAt: Timestamp.fromMillis(Date.now() - 7_200_000) }],
      ['windowStartsAt', { windowStartsAt: FieldValue.delete() }],
      ['ruleVersion', { ruleVersion: FieldValue.delete() }],
      ['ruleVersion', { ruleVersion: 0 }],
      ['formBonusEntries', { formBonusEntries: -1 }],
      ['operatorUids', { operatorUids: FieldValue.delete() }],
      ['operatorUids', { operatorUids: [] }],
      ['operatorUids', { operatorUids: ['ok', 'not valid!'] }],
      ['operatorUids', { operatorUids: ['dup', 'dup'] }],
    ];
    const seen: string[] = [];
    for (const [field, over] of cases) {
      const p = await seed(draftDoc(groupId, goals));
      await db().doc(`wsfPromotions/${p}`).update(over);
      const before = await snapshot(p);
      const r = await enablePromotion({ db: db() }, p);
      expect(r.outcome).toBe('refused');
      if (r.outcome === 'refused') {
        expect(r.reason).toBe('invalidConfig');
        expect(r.problems.map((x) => x.field)).toContain(field);
        seen.push(`${field}:${r.problems.length}`);
      }
      expect(await snapshot(p)).toBe(before);
    }
    console.info(`W7 24.A: ${cases.length} cases refused, fields named: ${seen.join(' ')}`);
  });

  test('B. the stored array is replaced by the sorted derived ids; missing / reordered / widened / edited arrays fence, never reroute', async () => {
    const { groupId, goals } = await community(3);
    const [g0, g1, g2] = goals;
    // Goals listed out of order, a forged routing array on the draft.
    const p = await seed(draftDoc(groupId, [g2, g0, g1]));
    const r = await enablePromotion({ db: db() }, p);
    const sorted = [g0, g1, g2].sort();
    expect(r).toMatchObject({ outcome: 'enabled', eligibleGoalIds: sorted });
    const doc = (await db().doc(`wsfPromotions/${p}`).get()).data() as Record<string, unknown>;
    expect(doc.eligibleGoalIds).toEqual(sorted);
    expect(doc.status).toBe('enabled');
    expect(doc.enabledAt).toBeInstanceOf(Timestamp);
    const v = validatePromotionConfig(doc);
    expect(v.ok).toBe(true);
    if (v.ok) expect(doc.enabledConfigDigest).toBe(configDigest(v.policy));
    expect(readPromotion(doc)).toMatchObject({ kind: 'active' });

    const uid = await joinMember(groupId, 'route');
    const path = await contribute(uid, g0, 1);
    const drifts: Array<[string, unknown]> = [
      ['missing', FieldValue.delete()],
      ['reordered', [...sorted].reverse()],
      ['widened', [...sorted, 'w7-extra-goal']],
      ['edited', [sorted[0], sorted[1], 'w7-swapped']],
      ['narrowed', sorted.slice(0, 2)],
    ];
    const seen: string[] = [];
    for (const [name, value] of drifts) {
      await db().doc(`wsfPromotions/${p}`).update({ eligibleGoalIds: value });
      const stored = (await db().doc(`wsfPromotions/${p}`).get()).data() as Record<string, unknown>;
      expect(readPromotion(stored)).toEqual({ kind: 'fenced', reason: 'configDrift', status: 'enabled' });
      const direct = await ingestContribution({ db: db() }, p, path);
      expect(direct).toEqual({ outcome: 'fenced', reason: 'configDrift' });
      // The trigger body may still find the document by array-contains; whatever it finds is fenced, never awarded.
      const routed = await onContributionCreatedBody({ db: db() }, { contributionPath: path, goalId: g0 });
      const mine = routed.find((x) => x.promotionId === p);
      if (mine) expect(mine.result).toEqual({ outcome: 'fenced', reason: 'configDrift' });
      seen.push(`${name}:${mine ? 'routed-fenced' : 'not-routed'}`);
      // No source row was written under any drift.
      const sources = (await db().collection('wsfPromotionSources').get()).docs.filter((d) => d.id.startsWith(`${p}_`));
      expect(sources).toHaveLength(0);
    }
    // A goal smuggled into the array only (not in the map) never routes an award anywhere.
    await db().doc(`wsfPromotions/${p}`).update({ eligibleGoalIds: [...sorted, 'w7-smuggled'] });
    const smuggled = await onContributionCreatedBody({ db: db() }, { contributionPath: path, goalId: 'w7-smuggled' });
    expect(smuggled.find((x) => x.promotionId === p)?.result).toEqual({ outcome: 'fenced', reason: 'configDrift' });
    // Restoring the exact derived array restores adjudication.
    await db().doc(`wsfPromotions/${p}`).update({ eligibleGoalIds: sorted });
    expect(await ingestContribution({ db: db() }, p, path)).toMatchObject({ outcome: 'accepted' });
    console.info(`W7 24.B: derived=${JSON.stringify(sorted)} drifts=${seen.join(' ')}`);
  });

  test('C. any entrant, uid link or nonzero counter blocks enable — including a cap-null promotion returned to draft — with no mutation', async () => {
    const { groupId, goals } = await community();
    const [g] = goals;
    // Enabled with no cap; one real admission.
    const p = await enabledDoc(groupId, [g]);
    const uid = await joinMember(groupId, 'admit');
    expect(await ingestContribution({ db: db() }, p, await contribute(uid, g, 1))).toMatchObject({ outcome: 'accepted', entrantCreated: true });
    const counterBefore = (await db().doc(`wsfPromotionCounters/${p}`).get()).exists;
    expect(counterBefore).toBe(false); // cap null: never written

    // Manually returned to draft with a cap of 1, artefacts still present.
    await db().doc(`wsfPromotions/${p}`).update({ status: 'draft', entrantCap: 1 });
    let before = await snapshot(p);
    expect(await enablePromotion({ db: db() }, p)).toEqual({ outcome: 'fenced', reason: 'enableArtefactsPresent', status: 'draft' });
    expect(await snapshot(p)).toBe(before);
    // Artefacts scrubbed by hand → still blocked, on the entrant.
    await db().doc(`wsfPromotions/${p}`).update({ enabledConfigDigest: FieldValue.delete(), enabledAt: FieldValue.delete() });
    before = await snapshot(p);
    expect(await enablePromotion({ db: db() }, p)).toEqual({ outcome: 'fenced', reason: 'entrantsExist', status: 'draft' });
    expect(await snapshot(p)).toBe(before);
    expect((await db().doc(`wsfPromotionCounters/${p}`).get()).exists).toBe(false); // never initialised

    // Each artefact of an admission alone blocks a fresh draft.
    const alone: Array<[string, (q: string) => Promise<void>]> = [
      ['entrant', async (q) => db().doc(`wsfPromotionEntrants/${q}_w7stale`).set({ identityBasis: 'firebaseUid' }).then(() => undefined)],
      ['link', async (q) => db().doc(`wsfPromotionEntrantLinks/${q}_uid_${uid}`).set({ entrantId: 'w7stale' }).then(() => undefined)],
      ['counter', async (q) => db().doc(`wsfPromotionCounters/${q}`).set({ entrantCount: 1 }).then(() => undefined)],
    ];
    for (const [name, plant] of alone) {
      const q = await seed(draftDoc(groupId, [g]));
      await plant(q);
      const b = await snapshot(q);
      expect(await enablePromotion({ db: db() }, q)).toEqual({ outcome: 'fenced', reason: 'entrantsExist', status: 'draft' });
      expect(await snapshot(q)).toBe(b);
      console.info(`W7 24.C: ${name} alone → fenced/entrantsExist, document unchanged`);
    }
    // A zero counter alone does not block (it is not an admission).
    const z = await seed(draftDoc(groupId, [g]));
    await db().doc(`wsfPromotionCounters/${z}`).set({ entrantCount: 0 });
    expect((await enablePromotion({ db: db() }, z)).outcome).toBe('enabled');
  });

  test('D. every non-draft status and every enable artefact blocks without mutation', async () => {
    const { groupId, goals } = await community();
    for (const status of ['enabled', 'closing', 'disabled', 'frozen', 'drawn', 'archived', 'bogus']) {
      const p = await seed(draftDoc(groupId, goals, { status }));
      const before = await snapshot(p);
      expect(await enablePromotion({ db: db() }, p)).toEqual({ outcome: 'fenced', reason: 'notDraft', status });
      expect(await snapshot(p)).toBe(before);
    }
    for (const [name, over] of [
      ['digest only', { enabledConfigDigest: 'w7-stale' }],
      ['enabledAt only', { enabledAt: Timestamp.now() }],
      ['both', { enabledConfigDigest: 'w7-stale', enabledAt: Timestamp.now() }],
    ] as Array<[string, Record<string, unknown>]>) {
      const p = await seed(draftDoc(groupId, goals, over));
      const before = await snapshot(p);
      expect(await enablePromotion({ db: db() }, p)).toEqual({ outcome: 'fenced', reason: 'enableArtefactsPresent', status: 'draft' });
      expect(await snapshot(p)).toBe(before);
      console.info(`W7 24.D: draft with ${name} → fenced/enableArtefactsPresent, unchanged`);
    }
    expect(await enablePromotion({ db: db() }, 'w7-no-such')).toEqual({ outcome: 'fenced', reason: 'promotionMissing', status: null });
    // An enabled document is immutable through this path: a second enable is fenced and the first enablement untouched.
    const p = await enabledDoc(groupId, goals);
    const enabled = await snapshot(p);
    expect(await enablePromotion({ db: db() }, p)).toEqual({ outcome: 'fenced', reason: 'notDraft', status: 'enabled' });
    expect(await snapshot(p)).toBe(enabled);
  });

  test.each([1, 2, 3])('E%i. eight concurrent enables → exactly one enablement, one digest, one enabledAt, no partial state', async (run) => {
    const { groupId, goals } = await community(2);
    const p = await seed(draftDoc(groupId, [goals[1], goals[0]]));
    const results = await Promise.all(Array.from({ length: 8 }, () => enablePromotion({ db: db() }, p)));
    const enabled = results.filter((r) => r.outcome === 'enabled');
    const fenced = results.filter((r) => r.outcome === 'fenced');
    expect(enabled).toHaveLength(1);
    expect(fenced).toHaveLength(7);
    for (const f of fenced) expect(f).toMatchObject({ reason: 'notDraft', status: 'enabled' });
    const doc = (await db().doc(`wsfPromotions/${p}`).get()).data() as Record<string, unknown>;
    expect(doc.status).toBe('enabled');
    expect(doc.eligibleGoalIds).toEqual([...goals].sort());
    expect(typeof doc.enabledConfigDigest).toBe('string');
    expect(doc.enabledAt).toBeInstanceOf(Timestamp);
    const v = validatePromotionConfig(doc);
    if (!v.ok) throw new Error('must validate');
    expect(doc.enabledConfigDigest).toBe(configDigest(v.policy));
    expect((enabled[0] as { digest: string }).digest).toBe(doc.enabledConfigDigest);
    expect(readPromotion(doc)).toMatchObject({ kind: 'active', status: 'enabled' });
    console.info(`W7 24.E${run}: enabled=${enabled.length} fenced=${fenced.length}`);
  });

  test('F. operator uids: validated, canonical in the digest, never written into an award document', async () => {
    const { groupId, goals } = await community();
    const [g] = goals;
    // Canonical: order does not change the digest; membership does.
    const base = draftDoc(groupId, [g]);
    const a = validatePromotionConfig({ ...base, operatorUids: ['w7b', 'w7a'] });
    const b = validatePromotionConfig({ ...base, operatorUids: ['w7a', 'w7b'] });
    const c = validatePromotionConfig({ ...base, operatorUids: ['w7a'] });
    expect(a.ok && b.ok && c.ok).toBe(true);
    if (a.ok && b.ok && c.ok) {
      expect(a.policy.operatorUids).toEqual(['w7a', 'w7b']);
      expect(configDigest(a.policy)).toBe(configDigest(b.policy));
      expect(configDigest(a.policy)).not.toBe(configDigest(c.policy));
    }
    // After enable + an award, the operator uid appears in the promotion document only.
    const p = await enabledDoc(groupId, [g]);
    const uid = await joinMember(groupId, 'ops');
    expect(await ingestContribution({ db: db() }, p, await contribute(uid, g, 1))).toMatchObject({ outcome: 'accepted' });
    const hits: string[] = [];
    for (const col of ['wsfPromotionSources', 'wsfPromotionEntries', 'wsfPromotionEntrants', 'wsfPromotionEntrantLinks', 'wsfPromotionEntrantTallies', 'wsfPromotionCounters', 'wsfContributions', 'wsfGoalMemberTotals']) {
      const snap = await db().collection(col).get();
      for (const d of snap.docs) if (JSON.stringify({ id: d.id, ...d.data() }).includes(OPERATOR)) hits.push(`${col}/${d.id}`);
    }
    expect(hits).toEqual([]);
    // A post-enable operator change is drift.
    await db().doc(`wsfPromotions/${p}`).update({ operatorUids: [OPERATOR, 'w7-added'] });
    expect(readPromotion((await db().doc(`wsfPromotions/${p}`).get()).data())).toMatchObject({ kind: 'fenced', reason: 'configDrift' });
    console.info(`W7 24.F: operator uid found outside wsfPromotions in ${hits.length} documents`);
  });
});
