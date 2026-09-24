/**
 * Shared fixtures for the expo-prize emulator tests. SYNTHETIC ONLY: the
 * demo project, loopback emulators, seeded communities and goals, and real
 * canonical contributions made through the real callables in src/index.ts —
 * the same way tests/callable does it.
 *
 * Not matched by the jest config (no `.test.ts` suffix).
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import type { HttpsError } from 'firebase-functions/v2/https';

import {
  wsfApproveStation,
  wsfCallNext,
  wsfCompleteMyTurn,
  wsfCompleteTurn,
  wsfContribute,
  wsfCreateCombinedGoal,
  wsfJoinTurnLine,
  wsfStartTurn,
  wsfStationClaimPairing,
  wsfStationRequestPairing,
  wsfTurnReady,
} from '../../src/index';
import {
  COLLECTIONS,
  configDigest,
  deriveEligibleGoalIds,
  validatePromotionConfig,
  type EligibleGoal,
  type PromotionStatus,
  type RepeatRule,
} from '../../src/expo-prize';

type Data = Record<string, unknown>;
type Runnable = { run: (req: unknown) => Promise<unknown> };

export function uniq(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function request(uid: string | null, data: Data) {
  return {
    auth: uid ? ({ uid, token: { email_verified: true } as any } as any) : undefined,
    data: data as any,
    rawRequest: {} as any,
    acceptsStreaming: false,
  } as any;
}

export function callAs(fn: unknown, uid: string | null, data: Data): Promise<unknown> {
  return (fn as Runnable).run(request(uid, data));
}

export function anon(fn: unknown, data: Data): Promise<unknown> {
  return (fn as Runnable).run(request(null, data));
}

export async function attempt<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: HttpsError }> {
  try {
    return { ok: true, value: await p };
  } catch (e) {
    return { ok: false, error: e as HttpsError };
  }
}

// ── community / goal / contribution ────────────────────────────────────────

export async function seedCommunity(championUid: string): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('prizeGroup');
  await db.doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'Expo Hall Movers',
    groupType: 'custom',
    joinPolicy: 'public',
    joinCode: uniq('joincode1234567890'),
    createdByUserId: championUid,
    lifecycleStatus: 'active',
    isSample: false,
  });
  await db.doc(`wsfMemberships/${groupId}_${championUid}`).set({
    groupId,
    userId: championUid,
    role: 'foundingChampion',
    membershipStatus: 'active',
  });
  return groupId;
}

export async function seedMember(groupId: string, uid: string): Promise<void> {
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role: 'member',
    membershipStatus: 'active',
  });
}

export async function member(groupId: string, label: string): Promise<string> {
  const uid = uniq(label);
  await seedMember(groupId, uid);
  return uid;
}

export async function seedGoal(opts: {
  groupId: string;
  title?: string;
  unit?: string;
  startsAt?: Date;
  endsAt?: Date;
  repeatPolicy?: 'once' | 'multiple';
}): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: 'prizeSeed',
    communityGroupId: opts.groupId,
    title: opts.title ?? 'Expo Squat Challenge',
    target: 5000,
    unit: opts.unit ?? 'squats',
    status: 'active',
    startsAt: Timestamp.fromDate(opts.startsAt ?? new Date(now - 86_400_000)),
    endsAt: Timestamp.fromDate(opts.endsAt ?? new Date(now + 6 * 86_400_000)),
    timezone: 'America/New_York',
    repeatPolicy: opts.repeatPolicy ?? 'multiple',
    aggregateDisplayAuthorized: true,
    crossingTracked: true,
  });
  return ref.id;
}

/** A real canonical contribution through the real callable. Returns its document path. */
export async function contribute(
  uid: string,
  goalId: string,
  count: number,
  attemptId: string = uniq('attempt')
): Promise<{ path: string; attemptId: string; docId: string }> {
  await callAs(wsfContribute, uid, { goalId, attemptId, count });
  const docId = `${goalId}_${uid}_${attemptId}`;
  return { path: `wsfContributions/${docId}`, attemptId, docId };
}

export async function contributionRow(path: string) {
  const snap = await getFirestore().doc(path).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : null;
}

export async function memberTotal(goalId: string, uid: string): Promise<number> {
  const snap = await getFirestore().doc(`wsfGoalMemberTotals/${goalId}_${uid}`).get();
  return (snap.data() as { total?: number } | undefined)?.total ?? 0;
}

export async function shardSum(goalId: string): Promise<number> {
  const db = getFirestore();
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const snap = await db.doc(`wsfGoalCounters/${goalId}/shards/${i}`).get();
    const c = (snap.data() as { count?: number } | undefined)?.count;
    if (typeof c === 'number') total += c;
  }
  return total;
}

// ── station / turn scene (ported from tests/callable/wsf-turn.test.ts) ────

export type Station = { stationId: string; secret: string; label: string };

export async function enrol(opts: { goalId: string; championUid: string }): Promise<Station> {
  const requested = (await anon(wsfStationRequestPairing, { goalId: opts.goalId })) as {
    pairingId: string;
    code: string;
  };
  await callAs(wsfApproveStation, opts.championUid, {
    goalId: opts.goalId,
    code: requested.code,
    slot: 1,
  });
  return (await anon(wsfStationClaimPairing, { pairingId: requested.pairingId })) as Station;
}

export async function turnScene(): Promise<{ groupId: string; goalId: string; championUid: string; station: Station }> {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalId = await seedGoal({ groupId });
  const station = await enrol({ goalId, championUid });
  return { groupId, goalId, championUid, station };
}

/** Join the line, be called, be ready, start at the station. Returns the entry id and the minted attempt id. */
export async function startedTurn(scene: { goalId: string; station: Station }, uid: string) {
  const entry = (await callAs(wsfJoinTurnLine, uid, { goalId: scene.goalId, calledName: 'Mover' })) as {
    entryId: string;
  };
  await anon(wsfCallNext, { stationId: scene.station.stationId, secret: scene.station.secret });
  await callAs(wsfTurnReady, uid, { entryId: entry.entryId });
  await anon(wsfStartTurn, { stationId: scene.station.stationId, secret: scene.station.secret });
  const snap = await getFirestore().doc(`wsfTurnEntries/${entry.entryId}`).get();
  const attemptId = (snap.data() as { attemptId?: string }).attemptId as string;
  return { entryId: entry.entryId, attemptId };
}

export const completeOnPhone = (uid: string, entryId: string, count: number) =>
  callAs(wsfCompleteMyTurn, uid, { entryId, count });
export const completeAtStation = (station: Station, count: number) =>
  anon(wsfCompleteTurn, { stationId: station.stationId, secret: station.secret, count });

export async function combinedScene(): Promise<{
  groupId: string;
  championUid: string;
  setupId: string;
  squats: string;
  pushups: string;
}> {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const now = Date.now();
  const squats = await seedGoal({ groupId, title: 'Squats', unit: 'squats' });
  const pushups = await seedGoal({ groupId, title: 'Push-ups', unit: 'push-ups' });
  const created = (await callAs(wsfCreateCombinedGoal, championUid, {
    communityGroupId: groupId,
    title: 'Move together',
    unit: 'movements',
    target: 2000,
    startsAt: new Date(now - 2 * 86_400_000).toISOString(),
    endsAt: new Date(now + 12 * 86_400_000).toISOString(),
    timezone: 'America/New_York',
    childGoalIds: [squats, pushups],
  })) as { setupId: string };
  return { groupId, championUid, setupId: created.setupId, squats, pushups };
}

// ── promotion ──────────────────────────────────────────────────────────────

export type PromotionSeed = {
  status?: PromotionStatus;
  goals: EligibleGoal[];
  repeatRule?: RepeatRule;
  /** undefined here means "omit the field", which must NOT validate. Pass null for "no cap". */
  entrantCap?: number | null;
  windowStartsAt?: Date;
  windowEndsAt?: Date;
  formBonusEntries?: number;
  ruleVersion?: number;
  operatorUids?: string[];
  /** Write a digest that does not match (config drift). */
  digest?: 'valid' | 'stale' | 'absent';
  /** Override the stored routing array (F5 fixtures); default is the derived sorted one. */
  eligibleGoalIds?: unknown;
};

export async function seedPromotion(seed: PromotionSeed): Promise<string> {
  const now = Date.now();
  const doc: Record<string, unknown> = {
    status: seed.status ?? 'enabled',
    ruleVersion: seed.ruleVersion ?? 1,
    repeatRule: seed.repeatRule ?? 'perContribution',
    eligibleGoals: seed.goals,
    eligibleGoalIds:
      seed.eligibleGoalIds !== undefined
        ? seed.eligibleGoalIds
        : deriveEligibleGoalIds(new Map(seed.goals.map((g) => [g.goalId, g.communityGroupId]))),
    windowStartsAt: Timestamp.fromDate(seed.windowStartsAt ?? new Date(now - 86_400_000)),
    windowEndsAt: Timestamp.fromDate(seed.windowEndsAt ?? new Date(now + 86_400_000)),
    formBonusEntries: seed.formBonusEntries ?? 1,
    operatorUids: seed.operatorUids ?? [uniq('op')],
    createdAt: Timestamp.now(),
  };
  if ('entrantCap' in seed) doc.entrantCap = seed.entrantCap;
  else doc.entrantCap = null;
  const validation = validatePromotionConfig(doc);
  const mode = seed.digest ?? 'valid';
  if (mode === 'valid' && validation.ok) doc.enabledConfigDigest = configDigest(validation.policy);
  if (mode === 'stale') doc.enabledConfigDigest = 'stale-digest';
  const ref = getFirestore().collection(COLLECTIONS.promotions).doc();
  await ref.set(doc);
  return ref.id;
}

export async function setPromotion(promotionId: string, patch: Record<string, unknown>): Promise<void> {
  await getFirestore().doc(`${COLLECTIONS.promotions}/${promotionId}`).set(patch, { merge: true });
}

/** Everything written under a promotion, by collection. */
export async function promotionState(promotionId: string) {
  const db = getFirestore();
  const read = async (collection: string) => {
    const snap = await db.collection(collection).orderBy('__name__').startAt(`${promotionId}_`).endAt(`${promotionId}_`).get();
    const out: Record<string, Record<string, unknown>> = {};
    for (const d of snap.docs) out[d.id] = d.data();
    return out;
  };
  const counter = await db.doc(`${COLLECTIONS.counters}/${promotionId}`).get();
  return {
    entrants: await read(COLLECTIONS.entrants),
    links: await read(COLLECTIONS.entrantLinks),
    sources: await read(COLLECTIONS.sources),
    entries: await read(COLLECTIONS.entries),
    tallies: await read(COLLECTIONS.tallies),
    entrantCount: (counter.data() as { entrantCount?: number } | undefined)?.entrantCount ?? 0,
  };
}

/** Every string value anywhere in a payload. */
export function deepStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) deepStrings(v, out);
  else if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) deepStrings(v, out);
  }
  return out;
}

export function count<T>(o: Record<string, T>): number {
  return Object.keys(o).length;
}

export function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── EXP2B: close / freeze helpers ──────────────────────────────────────────

/** A promotion document as stored (undefined when missing). */
export async function promotionDoc(promotionId: string): Promise<Record<string, unknown> | undefined> {
  const snap = await getFirestore().doc(`${COLLECTIONS.promotions}/${promotionId}`).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : undefined;
}

/** Byte-comparable view of a document (Timestamps → millis, keys sorted). */
export function comparable(doc: unknown): string {
  const norm = (v: unknown): unknown => {
    if (v instanceof Timestamp) return { __ts: v.toMillis() };
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, norm(x)])
      );
    }
    return v;
  };
  return JSON.stringify(norm(doc));
}

export async function poolDoc(promotionId: string): Promise<Record<string, unknown> | undefined> {
  const snap = await getFirestore().doc(`${COLLECTIONS.pools}/${promotionId}`).get();
  return snap.exists ? (snap.data() as Record<string, unknown>) : undefined;
}

/** Every freeze-attempt marker under a promotion, by attempt id. */
export async function freezeAttempts(promotionId: string): Promise<Record<string, Record<string, unknown>>> {
  const snap = await getFirestore()
    .collection(COLLECTIONS.freezeAttempts)
    .orderBy('__name__')
    .startAt(`${promotionId}_`)
    .endAt(`${promotionId}_`)
    .get();
  const out: Record<string, Record<string, unknown>> = {};
  for (const d of snap.docs) out[d.id.slice(promotionId.length + 1)] = d.data();
  return out;
}

/**
 * Wait until FIRESTORE'S OWN CLOCK is at or past `ms`, by committing a probe
 * with serverTimestamp() and reading it back. The local clock is never
 * consulted for the decision — the same discipline the freeze uses.
 */
export async function awaitServerTimePast(ms: number): Promise<number> {
  const ref = getFirestore().collection('_probe').doc();
  for (;;) {
    await ref.set({ at: FieldValue.serverTimestamp() });
    const snap = await ref.get();
    const at = (snap.data() as { at: Timestamp }).at.toMillis();
    if (at >= ms) return at;
    await new Promise((res) => setTimeout(res, 100));
  }
}

/** Seed an already-closing promotion (digest valid) whose cutoff is `cutoffInMs` from now. */
export async function seedClosing(
  goals: EligibleGoal[],
  opts: { cutoffInMs: number; repeatRule?: RepeatRule; entrantCap?: number | null; formBonusEntries?: number; status?: PromotionStatus }
): Promise<{ promotionId: string; windowEndMs: number }> {
  const windowEndsAt = new Date(Date.now() + opts.cutoffInMs);
  const seed: PromotionSeed = {
    status: opts.status ?? 'closing',
    goals,
    repeatRule: opts.repeatRule ?? 'perContribution',
    windowStartsAt: new Date(Date.now() - 86_400_000),
    windowEndsAt,
    formBonusEntries: opts.formBonusEntries ?? 0,
  };
  if ('entrantCap' in opts) seed.entrantCap = opts.entrantCap;
  const promotionId = await seedPromotion(seed);
  return { promotionId, windowEndMs: windowEndsAt.getTime() };
}
