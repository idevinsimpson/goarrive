/**
 * EVENT-LIFECYCLE-BACKEND-RECOVERY-1 — who may manage an Event, and what a
 * refusal leaves behind (nothing).
 *
 * Only an active Founding Champion of the Event's OWN community, with a
 * verified email for writes. A member, a nonmember, a removed Champion, a
 * Champion of a different community and a signed-out caller are all refused;
 * an Event of another community is indistinguishable from one that does not
 * exist; no answer names an account; and the module is not live (index.ts does
 * not export it).
 *
 * Emulator only (demo-wsf-local); every account and community is synthetic.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import * as fs from 'node:fs';
import * as path from 'node:path';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import '../../src/index';
import {
  wsfArchiveEvent,
  wsfCancelEvent,
  wsfCloseEvent,
  wsfCreateEvent,
  wsfGetEvent,
  wsfListEvents,
  wsfPublishEvent,
  wsfUpdateEvent,
} from '../../src/eventLifecycle';

type Data = Record<string, unknown>;
type EventView = { eventId: string; status: string; version: number; communityGroupId: string };

function callAs(fn: unknown, uid: string | null, data: Data, verified = true) {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: uid ? { uid, token: { email_verified: verified } } : undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
    acceptsStreaming: false,
  } as never);
}
async function attempt<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: HttpsError }> {
  try {
    return { ok: true as const, value: await p };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}
function refused(name: string, r: { ok: boolean; error?: HttpsError }, code: string, message: string) {
  expect([name, r.ok]).toEqual([name, false]);
  if (!r.ok) expect([name, r.error.code, r.error.message]).toEqual([name, code, message]);
}

let seq = 0;
const uniq = (p: string) => `${p}_${Date.now().toString(36)}_${(seq += 1)}`;
const rid = () => uniq('req').replace(/[^A-Za-z0-9_-]/g, '');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

const NOT_CHAMPION = 'Only a Champion of this community can manage its events.';
const NOT_AVAILABLE = 'That event is not available.';

async function community(label: string) {
  const db = getFirestore();
  const champ = uniq(`${label}Champ`);
  const groupId = uniq(`${label}Group`);
  await db.doc(`wsfCommunityGroups/${groupId}`).set({ displayName: `Synthetic ${label}`, groupType: 'custom', joinPolicy: 'public', joinCode: uniq('joincode1234567890'), createdByUserId: champ, lifecycleStatus: 'active', isSample: false });
  await db.doc(`wsfMemberships/${groupId}_${champ}`).set({ groupId, userId: champ, role: 'foundingChampion', membershipStatus: 'active' });
  const goal = db.collection('wsfGoals').doc();
  const now = Date.now();
  await goal.set({ ownerUid: champ, communityGroupId: groupId, title: 'Synthetic goal', target: 1000, unit: 'squats', status: 'active', startsAt: Timestamp.fromMillis(now - DAY), endsAt: Timestamp.fromMillis(now + 20 * DAY), timezone: 'America/New_York', repeatPolicy: 'multiple' });
  return { champ, groupId, goalId: goal.id };
}
async function member(groupId: string, label: string, extra: Data = {}) {
  const uid = uniq(label);
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({ groupId, userId: uid, role: 'member', membershipStatus: 'active', ...extra });
  return uid;
}
function input(groupId: string, goalId: string, extra: Data = {}): Data {
  const now = Date.now();
  return { groupId, goalId, title: 'Synthetic Expo Day', startsAt: iso(now + DAY), endsAt: iso(now + DAY + 3_600_000), timezone: 'America/Chicago', requestId: rid(), ...extra };
}
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out));
  return out;
}

/** C1 with a draft and a published Event; C2 whose Champion is a stranger to C1. */
async function scene() {
  const c1 = await community('One');
  const c2 = await community('Two');
  const draft = ((await callAs(wsfCreateEvent, c1.champ, input(c1.groupId, c1.goalId))) as { event: EventView }).event;
  const pub = ((await callAs(wsfCreateEvent, c1.champ, input(c1.groupId, c1.goalId))) as { event: EventView }).event;
  await callAs(wsfPublishEvent, c1.champ, { eventId: pub.eventId, requestId: rid() });
  const mem = await member(c1.groupId, 'mem');
  const removedChamp = await member(c1.groupId, 'exChamp', { role: 'foundingChampion', membershipStatus: 'removed' });
  const stranger = uniq('stranger');
  return { c1, c2, draft, pub, mem, removedChamp, stranger };
}

async function eventDoc(eventId: string) {
  const snap = await getFirestore().doc(`wsfEvents/${eventId}`).get();
  return { data: snap.data(), updateTime: snap.updateTime };
}

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-event-lifecycle-privacy').set({ at: Date.now() }, { merge: true });
}, 30_000);

describe('who may manage an Event', () => {
  test('a member, a nonmember, a removed Champion and another community\'s Champion are refused for EVERY operation; nothing changes', async () => {
    const s = await scene();
    const beforeDraft = await eventDoc(s.draft.eventId);
    const beforePub = await eventDoc(s.pub.eventId);
    for (const [who, uid] of [['member', s.mem], ['nonmember', s.stranger], ['removed Champion', s.removedChamp], ['Champion of C2', s.c2.champ]] as const) {
      refused(`${who} create`, await attempt(callAs(wsfCreateEvent, uid, input(s.c1.groupId, s.c1.goalId))), 'permission-denied', NOT_CHAMPION);
      refused(`${who} list`, await attempt(callAs(wsfListEvents, uid, { groupId: s.c1.groupId })), 'permission-denied', NOT_CHAMPION);
      refused(`${who} get`, await attempt(callAs(wsfGetEvent, uid, { eventId: s.pub.eventId })), 'not-found', NOT_AVAILABLE);
      refused(`${who} update`, await attempt(callAs(wsfUpdateEvent, uid, { eventId: s.draft.eventId, expectedVersion: 1, requestId: rid(), title: 'Hijacked' })), 'not-found', NOT_AVAILABLE);
      refused(`${who} publish`, await attempt(callAs(wsfPublishEvent, uid, { eventId: s.draft.eventId, requestId: rid() })), 'not-found', NOT_AVAILABLE);
      for (const [name, fn] of [['close', wsfCloseEvent], ['cancel', wsfCancelEvent], ['archive', wsfArchiveEvent]] as const) {
        refused(`${who} ${name}`, await attempt(callAs(fn, uid, { eventId: s.pub.eventId, requestId: rid() })), 'not-found', NOT_AVAILABLE);
      }
    }
    expect(await eventDoc(s.draft.eventId)).toEqual(beforeDraft);
    expect(await eventDoc(s.pub.eventId)).toEqual(beforePub);
    expect((await getFirestore().collection('wsfEvents').where('communityGroupId', '==', s.c1.groupId).get()).size).toBe(2);
  }, 60_000);

  test('another community\'s Event is indistinguishable from one that does not exist', async () => {
    const s = await scene();
    const missing = await attempt(callAs(wsfGetEvent, s.c2.champ, { eventId: 'ev_doesnotexistdoesnotexi' }));
    const foreign = await attempt(callAs(wsfGetEvent, s.c2.champ, { eventId: s.pub.eventId }));
    expect(missing.ok || foreign.ok).toBe(false);
    if (!missing.ok && !foreign.ok) expect([foreign.error.code, foreign.error.message]).toEqual([missing.error.code, missing.error.message]);
  }, 40_000);

  test('a Champion cannot attach an Event in their own community to another community\'s goal, or list another community', async () => {
    const s = await scene();
    refused('C2 champ, C1 goal', await attempt(callAs(wsfCreateEvent, s.c2.champ, input(s.c2.groupId, s.c1.goalId))), 'not-found', 'That goal is not part of this community.');
    const list = (await callAs(wsfListEvents, s.c2.champ, { groupId: s.c2.groupId })) as { events: EventView[] };
    expect(list.events).toEqual([]);
    expect((await getFirestore().collection('wsfEvents').where('goalId', '==', s.c1.goalId).get()).size).toBe(2);
  }, 40_000);

  test('a stray uid, role or community in a request grants nothing', async () => {
    const s = await scene();
    const r = await attempt(callAs(wsfCreateEvent, s.mem, { ...input(s.c1.groupId, s.c1.goalId), role: 'foundingChampion', uid: s.c1.champ, userId: s.c1.champ, createdByUid: s.c1.champ }));
    refused('member claiming a role', r, 'permission-denied', NOT_CHAMPION);
    const u = await attempt(callAs(wsfUpdateEvent, s.c1.champ, { eventId: s.draft.eventId, expectedVersion: 1, requestId: rid(), title: 'x y', createdByUid: s.mem }));
    refused('update naming an account', u, 'invalid-argument', 'Only title, startsAt, endsAt and timezone can be edited.');
  }, 40_000);

  test('a creator who is no longer a Champion gets nothing back by retrying their own create, removed or demoted', async () => {
    const db = getFirestore();
    for (const [label, change] of [['removed', { membershipStatus: 'removed' }], ['demoted', { role: 'member' }]] as const) {
      const c = await community(label === 'removed' ? 'Gone' : 'Down');
      const request = input(c.groupId, c.goalId);
      const made = (await callAs(wsfCreateEvent, c.champ, request)) as { event: EventView; replayed: boolean };
      expect([label, made.replayed]).toEqual([label, false]);
      const before = await eventDoc(made.event.eventId);
      await db.doc(`wsfMemberships/${c.groupId}_${c.champ}`).update(change);
      const retry = await attempt(callAs(wsfCreateEvent, c.champ, request));
      refused(`${label} creator replay`, retry, 'permission-denied', NOT_CHAMPION);
      expect([label, strings(retry.ok ? retry.value : {}).includes(made.event.eventId)]).toEqual([label, false]);
      expect(await eventDoc(made.event.eventId)).toEqual(before);
    }
  }, 40_000);

  test('a membership row counts only when its own fields name the caller and this community, not just its document id', async () => {
    const s = await scene();
    const db = getFirestore();
    // Row id says "C1 + borrowed", but the row itself belongs to C1's Champion.
    const borrowed = uniq('borrowed');
    await db.doc(`wsfMemberships/${s.c1.groupId}_${borrowed}`).set({ groupId: s.c1.groupId, userId: s.c1.champ, role: 'foundingChampion', membershipStatus: 'active' });
    // Row id says "C1 + moved", but the row itself is a Champion row of C2.
    const moved = uniq('moved');
    await db.doc(`wsfMemberships/${s.c1.groupId}_${moved}`).set({ groupId: s.c2.groupId, userId: moved, role: 'foundingChampion', membershipStatus: 'active' });
    const before = await eventDoc(s.draft.eventId);
    for (const [who, uid] of [['row naming another account', borrowed], ['row naming another community', moved]] as const) {
      refused(`${who} create`, await attempt(callAs(wsfCreateEvent, uid, input(s.c1.groupId, s.c1.goalId))), 'permission-denied', NOT_CHAMPION);
      refused(`${who} list`, await attempt(callAs(wsfListEvents, uid, { groupId: s.c1.groupId })), 'permission-denied', NOT_CHAMPION);
      refused(`${who} get`, await attempt(callAs(wsfGetEvent, uid, { eventId: s.draft.eventId })), 'not-found', NOT_AVAILABLE);
      refused(`${who} publish`, await attempt(callAs(wsfPublishEvent, uid, { eventId: s.draft.eventId, requestId: rid() })), 'not-found', NOT_AVAILABLE);
    }
    expect(await eventDoc(s.draft.eventId)).toEqual(before);
    expect((await db.collection('wsfEvents').where('communityGroupId', '==', s.c1.groupId).get()).size).toBe(2);
  }, 40_000);

  test('signed out: every operation is refused; an unverified Champion may read but not write', async () => {
    const s = await scene();
    const all: [string, unknown, Data][] = [
      ['create', wsfCreateEvent, input(s.c1.groupId, s.c1.goalId)],
      ['get', wsfGetEvent, { eventId: s.pub.eventId }],
      ['list', wsfListEvents, { groupId: s.c1.groupId }],
      ['update', wsfUpdateEvent, { eventId: s.draft.eventId, expectedVersion: 1, requestId: rid(), title: 'x y' }],
      ['publish', wsfPublishEvent, { eventId: s.draft.eventId, requestId: rid() }],
      ['close', wsfCloseEvent, { eventId: s.pub.eventId, requestId: rid() }],
      ['cancel', wsfCancelEvent, { eventId: s.pub.eventId, requestId: rid() }],
      ['archive', wsfArchiveEvent, { eventId: s.pub.eventId, requestId: rid() }],
    ];
    for (const [name, fn, data] of all) refused(`signed-out ${name}`, await attempt(callAs(fn, null, data)), 'unauthenticated', 'Sign in first.');
    for (const [name, fn, data] of all.filter(([n]) => !['get', 'list'].includes(n))) {
      refused(`unverified ${name}`, await attempt(callAs(fn, s.c1.champ, data, false)), 'failed-precondition', 'Verify your email before managing events.');
    }
    expect(((await callAs(wsfGetEvent, s.c1.champ, { eventId: s.pub.eventId }, false)) as { event: EventView }).event.status).toBe('published');
    expect((await getFirestore().collection('wsfEvents').where('communityGroupId', '==', s.c1.groupId).get()).size).toBe(2);
  }, 40_000);
});

describe('what an answer may carry', () => {
  test('no response names an account: not the creator, not an actor in the history', async () => {
    const s = await scene();
    const answers = [
      await callAs(wsfGetEvent, s.c1.champ, { eventId: s.pub.eventId }),
      await callAs(wsfListEvents, s.c1.champ, { groupId: s.c1.groupId, includeArchived: true }),
      await callAs(wsfCloseEvent, s.c1.champ, { eventId: s.pub.eventId, requestId: rid() }),
      await callAs(wsfUpdateEvent, s.c1.champ, { eventId: s.draft.eventId, expectedVersion: 1, requestId: rid(), title: 'Renamed' }),
    ];
    const all = strings(answers).join('\n');
    for (const uid of [s.c1.champ, s.mem, s.removedChamp, s.c2.champ]) expect(all).not.toContain(uid);
    // The audit trail does keep the actor, server-side only.
    const stored = (await getFirestore().doc(`wsfEvents/${s.pub.eventId}`).get()).data() as { history: { byUid: string }[] };
    expect(stored.history.every((h) => h.byUid === s.c1.champ)).toBe(true);
  }, 40_000);
});

describe('the module is not live', () => {
  test('index.ts neither imports nor re-exports the Event handlers (integration is a separate reviewed step)', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../src/index.ts'), 'utf8');
    expect(src).not.toMatch(/eventLifecycle/);
    for (const name of ['wsfCreateEvent', 'wsfGetEvent', 'wsfListEvents', 'wsfUpdateEvent', 'wsfPublishEvent', 'wsfCloseEvent', 'wsfCancelEvent', 'wsfArchiveEvent']) {
      expect([name, src.includes(name)]).toEqual([name, false]);
    }
    const mod = fs.readFileSync(path.resolve(__dirname, '../../src/eventLifecycle.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    expect(mod).not.toMatch(/invoker/);
    expect(mod).not.toMatch(/\.delete\(/);
  });
});
