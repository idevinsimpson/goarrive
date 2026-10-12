/**
 * KIOSK-LIVE-POSE-2 — the shared harness for the live-pose suites.
 *
 * Every fixture is synthetic and local to the demo-wsf-local emulators
 * (Firestore, Auth, Realtime Database). Nothing here reaches a real project.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { readFileSync } from 'fs';
import * as path from 'path';

import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  wsfApproveStation,
  wsfCallNext,
  wsfCompleteTurn,
  wsfJoinTurnLine,
  wsfMyTurn,
  wsfStartTurn,
  wsfStationClaimPairing,
  wsfStationRequestPairing,
  wsfTurnReady,
  wsfTurnState,
} from '../../src/index';
import { livePoseDatabaseUrl } from '../../src/live-pose';

export type Data = Record<string, unknown>;

export const PROJECT = 'demo-wsf-local';
/** The namespace the Admin SDK derives from the project id. The rules suite
 * loads the reviewed rules into this same namespace, so the client contexts
 * and the callables see one database. */
export const NAMESPACE = `${PROJECT}-default-rtdb`;
export const RULES_PATH = path.resolve(__dirname, '../../../database.westayfit.rules.json');
export const KEY_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function anon(fn: unknown, data: Data) {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
    acceptsStreaming: false,
  } as never);
}

export function callAs(fn: unknown, uid: string, data: Data) {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: { uid, token: { email_verified: true } },
    rawRequest: { ip: '127.0.0.1', headers: {} },
    acceptsStreaming: false,
  } as never);
}

export async function attempt<T>(
  p: Promise<T>
): Promise<{ ok: true; value: T } | { ok: false; error: HttpsError }> {
  try {
    return { ok: true as const, value: await p };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}

let seq = 0;
export function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

export type Station = { stationId: string; secret: string; label: string };
export type LivePose = { key: string; expiresAt: number };
export type TurnState = {
  assigned: { calledName: string; state: string; turnRef: string | null } | null;
  waitingCount: number;
  livePose?: LivePose | null;
} & Data;
export type MyTurn = {
  turn: { entryId: string; status: string } | null;
  receipt: { amount: number } | null;
  livePose?: LivePose | null;
} & Data;

// ── synthetic fixtures ──────────────────────────────────────────────────────

export async function seedCommunity(championUid: string): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('livePoseGroup');
  await db.doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'Synthetic Live Pose Hall',
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

export async function seedGoal(groupId: string): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: 'livePoseSeed',
    communityGroupId: groupId,
    title: 'Synthetic Squat Challenge',
    target: 5000,
    unit: 'squats',
    status: 'active',
    startsAt: Timestamp.fromDate(new Date(now - 86_400_000)),
    endsAt: Timestamp.fromDate(new Date(now + 6 * 86_400_000)),
    timezone: 'America/New_York',
    repeatPolicy: 'multiple',
    aggregateDisplayAuthorized: true,
  });
  return ref.id;
}

export async function enrol(goalId: string, championUid: string, slot: 1 | 2): Promise<Station> {
  const requested = (await anon(wsfStationRequestPairing, { goalId })) as {
    pairingId: string;
    code: string;
  };
  await callAs(wsfApproveStation, championUid, { goalId, code: requested.code, slot });
  return (await anon(wsfStationClaimPairing, { pairingId: requested.pairingId })) as Station;
}

export async function member(groupId: string, label: string): Promise<string> {
  const uid = uniq(label);
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({
    groupId,
    userId: uid,
    role: 'member',
    membershipStatus: 'active',
  });
  return uid;
}

/** A community, an open goal, a Champion, two screens and two members. */
export async function scene() {
  const championUid = uniq('champ');
  const groupId = await seedCommunity(championUid);
  const goalId = await seedGoal(groupId);
  const one = await enrol(goalId, championUid, 1);
  const two = await enrol(goalId, championUid, 2);
  const a = await member(groupId, 'ann');
  const b = await member(groupId, 'ben');
  return { groupId, goalId, championUid, one, two, a, b };
}

export async function join(goalId: string, uid: string, calledName: string) {
  return (await callAs(wsfJoinTurnLine, uid, { goalId, calledName })) as { entryId: string };
}

export const state = (s: Station) =>
  anon(wsfTurnState, { stationId: s.stationId, secret: s.secret }) as Promise<TurnState>;
export const callNext = (s: Station) =>
  anon(wsfCallNext, { stationId: s.stationId, secret: s.secret }) as Promise<TurnState & { called: boolean }>;
export const start = (s: Station, expectedTurn: unknown) =>
  anon(wsfStartTurn, { stationId: s.stationId, secret: s.secret, expectedTurn }) as Promise<Data>;
export const complete = (s: Station, expectedTurn: unknown, count: number) =>
  anon(wsfCompleteTurn, { stationId: s.stationId, secret: s.secret, count, expectedTurn }) as Promise<Data>;
export const myTurn = (uid: string, goalId: string) =>
  callAs(wsfMyTurn, uid, { goalId }) as Promise<MyTurn>;

/** Join, get called at `s`, tap ready, and start: the turn is `active`. */
export async function startTurn(s: Station, goalId: string, uid: string, name: string) {
  const { entryId } = await join(goalId, uid, name);
  const called = await callNext(s);
  expect(called.called).toBe(true);
  const turnRef = (await state(s)).assigned?.turnRef as string;
  expect(typeof turnRef).toBe('string');
  await callAs(wsfTurnReady, uid, { entryId });
  const started = await start(s, turnRef);
  return { entryId, turnRef, started };
}

export async function entryOf(entryId: string): Promise<Data> {
  return (await getFirestore().doc(`wsfTurnEntries/${entryId}`).get()).data() as Data;
}

export async function stationDoc(s: Station): Promise<Data> {
  return (await getFirestore().doc(`wsfKioskStations/${s.stationId}`).get()).data() as Data;
}

// ── the Realtime Database, as the Admin SDK sees it ────────────────────────

export function adminDb() {
  return getDatabaseWithUrl(livePoseDatabaseUrl(PROJECT));
}

/** The node under a key, or null when it is gone. */
export async function poseNode(key: string): Promise<unknown> {
  return (await adminDb().ref(`wsfLivePose/${key}`).once('value')).val();
}

export async function setMeta(key: string, meta: { writerUid: string; expiresAt: number }) {
  await adminDb().ref(`wsfLivePose/${key}/meta`).set(meta);
}

/** Wait for a node to reach a state. The deletes run after a commit, so the
 * answer the callable gave can arrive a moment before the node changes. */
export async function eventually(check: () => Promise<boolean>, ms = 5_000): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    if (await check()) return true;
    if (Date.now() > until) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

export async function goneEventually(key: string): Promise<boolean> {
  return eventually(async () => (await poseNode(key)) === null);
}

/** 65 bytes (13 landmarks × uint16 x, uint16 y, uint8 v), base64url: 87 characters. */
export function packedPose(fill = 7): string {
  return Buffer.alloc(65, fill).toString('base64url');
}

export function frame(seqN: number, t: number, rep: number, p = packedPose()) {
  return { seq: seqN, t, p, rep };
}

// ── the rules, as a phone or a kiosk sees them ─────────────────────────────

export async function rulesEnvironment(): Promise<RulesTestEnvironment> {
  const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST as string).split(':');
  return initializeTestEnvironment({
    // The namespace the callables use. rules-unit-testing names the database
    // after projectId, so this is the projectId it is given.
    projectId: NAMESPACE,
    database: { host, port: Number(port), rules: readFileSync(RULES_PATH, 'utf8') },
  });
}

/** A phone signed in with a real provider. */
export function phone(env: RulesTestEnvironment, uid: string, provider = 'password') {
  return env.authenticatedContext(uid, { firebase: { sign_in_provider: provider } } as never).database();
}

/** The kiosk: no Firebase sign-in at all. */
export function kiosk(env: RulesTestEnvironment) {
  return env.unauthenticatedContext().database();
}
