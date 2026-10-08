/**
 * EVENT-LIFECYCLE-BACKEND-RECOVERY-1 — the Event lifecycle as a Champion uses
 * it: create, read, list, edit, publish, close, cancel, archive; idempotency,
 * strict transitions, field rules, retained history, locked times after
 * publication, the goal left untouched, and existing stations unaffected.
 *
 * The handlers live in src/eventLifecycle.ts and are NOT exported from
 * index.ts (that integration is separate), so they are called here directly.
 * index.ts is imported for app initialisation and for the real goal, combined
 * setup and station callables the compatibility rows drive.
 *
 * Emulator only (demo-wsf-local); every account, community and goal is synthetic.
 */
process.env.METADATA_SERVER_DETECTION = process.env.METADATA_SERVER_DETECTION || 'none';
process.env.GCLOUD_PROJECT = 'demo-wsf-local';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  wsfApproveStation,
  wsfCallNext,
  wsfCloseCombinedGoal,
  wsfCompleteTurn,
  wsfCreateCombinedGoal,
  wsfEventContext,
  wsfJoinTurnLine,
  wsfStartTurn,
  wsfStationClaimPairing,
  wsfStationRequestPairing,
  wsfTurnReady,
  wsfTurnState,
} from '../../src/index';
import {
  wsfArchiveEvent,
  wsfCancelEvent,
  wsfCloseEvent,
  wsfCreateEvent,
  wsfGetEvent,
  wsfListEvents,
  wsfPublishEvent,
  wsfUpdateEvent,
  eventAllowsEnrollment,
} from '../../src/eventLifecycle';

type Data = Record<string, unknown>;
type EventView = {
  eventId: string;
  communityGroupId: string;
  goalId: string;
  eventScope: 'goal' | 'setup';
  setupId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: string;
  version: number;
  publishedAtMillis: number | null;
  closedAtMillis: number | null;
  cancelledAtMillis: number | null;
  archivedAtMillis: number | null;
  history: { op: string; status: string; atMillis: number }[];
};
type Written = { event: EventView; replayed: boolean; inFlight?: { queued: number; inProgress: number } | null };

function callAs(fn: unknown, uid: string | null, data: Data, verified = true) {
  return (fn as { run: (r: never) => Promise<unknown> }).run({
    data,
    auth: uid ? { uid, token: { email_verified: verified } } : undefined,
    rawRequest: { ip: '127.0.0.1', headers: {} },
    acceptsStreaming: false,
  } as never);
}
const anon = (fn: unknown, data: Data) => callAs(fn, null, data);

async function attempt<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: HttpsError }> {
  try {
    return { ok: true as const, value: await p };
  } catch (e) {
    return { ok: false as const, error: e as HttpsError };
  }
}
function refused(r: { ok: boolean; error?: HttpsError }, code: string, message?: string) {
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.code).toBe(code);
    if (message !== undefined) expect(r.error.message).toBe(message);
  }
}

let seq = 0;
const uniq = (p: string) => `${p}_${Date.now().toString(36)}_${(seq += 1)}`;
const rid = () => uniq('req').replace(/[^A-Za-z0-9_-]/g, '');
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

async function seedCommunity(championUid: string): Promise<string> {
  const db = getFirestore();
  const groupId = uniq('evGroup');
  await db.doc(`wsfCommunityGroups/${groupId}`).set({
    displayName: 'Synthetic Event Community',
    groupType: 'custom',
    joinPolicy: 'public',
    joinCode: uniq('joincode1234567890'),
    createdByUserId: championUid,
    lifecycleStatus: 'active',
    isSample: false,
  });
  await db.doc(`wsfMemberships/${groupId}_${championUid}`).set({ groupId, userId: championUid, role: 'foundingChampion', membershipStatus: 'active' });
  return groupId;
}
async function seedMember(groupId: string, label: string): Promise<string> {
  const uid = uniq(label);
  await getFirestore().doc(`wsfMemberships/${groupId}_${uid}`).set({ groupId, userId: uid, role: 'member', membershipStatus: 'active' });
  return uid;
}
async function seedGoal(groupId: string, opts: { title?: string; unit?: string; startsAt?: number; endsAt?: number } = {}): Promise<string> {
  const now = Date.now();
  const ref = getFirestore().collection('wsfGoals').doc();
  await ref.set({
    ownerUid: 'evSeed',
    communityGroupId: groupId,
    title: opts.title ?? 'Synthetic Squat Challenge',
    target: 5000,
    unit: opts.unit ?? 'squats',
    status: 'active',
    startsAt: Timestamp.fromMillis(opts.startsAt ?? now - DAY),
    endsAt: Timestamp.fromMillis(opts.endsAt ?? now + 20 * DAY),
    timezone: 'America/New_York',
    repeatPolicy: 'multiple',
    aggregateDisplayAuthorized: true,
  });
  return ref.id;
}
async function scene() {
  const champ = uniq('champ');
  const groupId = await seedCommunity(champ);
  const goalId = await seedGoal(groupId);
  return { champ, groupId, goalId };
}

const createEvent = (uid: string, data: Data) => callAs(wsfCreateEvent, uid, data) as Promise<Written>;
function draftInput(groupId: string, goalId: string, extra: Data = {}): Data {
  const now = Date.now();
  return { groupId, goalId, title: 'Synthetic Expo Day', startsAt: iso(now + DAY), endsAt: iso(now + DAY + 8 * 3_600_000), timezone: 'America/Chicago', requestId: rid(), ...extra };
}
const transition = (fn: unknown, uid: string, eventId: string, requestId = rid()) => callAs(fn, uid, { eventId, requestId }) as Promise<Written>;
const getEvent = (uid: string, eventId: string) =>
  callAs(wsfGetEvent, uid, { eventId }) as Promise<{ event: EventView; goalActivity: { contributions: number; turns: number } }>;

beforeAll(async () => {
  await getFirestore().doc('_warmup/wsf-event-lifecycle').set({ at: Date.now() }, { merge: true });
}, 30_000);

// ═══════════════════════════════════════════════════════════════════════════
// 1. CREATE, READ, LIST — and stable identity under duplicates
// ═══════════════════════════════════════════════════════════════════════════

describe('create, read and list', () => {
  test('a Champion creates a draft over an existing goal; the answer is the whitelisted Event and names no account', async () => {
    const s = await scene();
    const input = draftInput(s.groupId, s.goalId);
    const made = await createEvent(s.champ, input);
    expect(made.replayed).toBe(false);
    expect(Object.keys(made.event).sort()).toEqual(
      ['archivedAtMillis', 'cancelledAtMillis', 'closedAtMillis', 'communityGroupId', 'createdAtMillis', 'endsAt', 'eventId', 'eventScope', 'goalId', 'history', 'publishedAtMillis', 'setupId', 'startsAt', 'status', 'timezone', 'title', 'updatedAtMillis', 'version'].sort()
    );
    expect(made.event).toMatchObject({
      communityGroupId: s.groupId,
      goalId: s.goalId,
      eventScope: 'goal',
      setupId: null,
      title: 'Synthetic Expo Day',
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      timezone: 'America/Chicago',
      status: 'draft',
      version: 1,
      publishedAtMillis: null,
    });
    expect(made.event.eventId).toMatch(/^ev_[A-Za-z0-9_-]{24}$/);
    expect(made.event.history.map((h) => [h.op, h.status])).toEqual([['create', 'draft']]);
    expect(JSON.stringify(made)).not.toContain(s.champ);

    const got = await getEvent(s.champ, made.event.eventId);
    expect(got.event).toEqual(made.event);
    expect(got.goalActivity).toEqual({ contributions: 0, turns: 0 });
    const listed = (await callAs(wsfListEvents, s.champ, { groupId: s.groupId })) as { events: EventView[] };
    expect(listed.events.map((e) => e.eventId)).toEqual([made.event.eventId]);
  }, 30_000);

  test('a duplicate submit or a lost answer retried — even concurrently — is ONE Event with the same id', async () => {
    const s = await scene();
    const input = draftInput(s.groupId, s.goalId);
    const results = await Promise.all([createEvent(s.champ, input), createEvent(s.champ, input), createEvent(s.champ, input)]);
    const ids = new Set(results.map((r) => r.event.eventId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    const again = await createEvent(s.champ, { ...input, title: 'A different title on the retry' });
    expect(again.replayed).toBe(true);
    expect(again.event.title).toBe('Synthetic Expo Day');
    const docs = await getFirestore().collection('wsfEvents').where('communityGroupId', '==', s.groupId).get();
    expect(docs.size).toBe(1);
  }, 30_000);

  test('a goal in an active combined setup is snapshotted as scope "setup" with its setupId, by the rule the turn line uses', async () => {
    const s = await scene();
    const now = Date.now();
    const pushups = await seedGoal(s.groupId, { title: 'Push-ups', unit: 'push-ups' });
    const created = (await callAs(wsfCreateCombinedGoal, s.champ, {
      communityGroupId: s.groupId,
      title: 'Move together',
      unit: 'movements',
      target: 2000,
      startsAt: iso(now - 2 * DAY),
      endsAt: iso(now + 25 * DAY),
      timezone: 'America/New_York',
      childGoalIds: [s.goalId, pushups],
    })) as { setupId: string };
    const made = await createEvent(s.champ, draftInput(s.groupId, s.goalId));
    expect(made.event).toMatchObject({ eventScope: 'setup', setupId: created.setupId, goalId: s.goalId });
    const stored = (await getFirestore().doc(`wsfEvents/${made.event.eventId}`).get()).data()!;
    expect(stored.lineId).toBe(`setup__${created.setupId}`);
    const served = (await callAs(wsfEventContext, s.champ, { goalId: s.goalId })) as { eventScope: string; setupId: string | null };
    expect({ eventScope: made.event.eventScope, setupId: made.event.setupId }).toEqual({ eventScope: served.eventScope, setupId: served.setupId });
  }, 40_000);

  test('every condition of the turn line\'s rule is mirrored: a hand-edited claim or setup that the line would not use is scope "goal"', async () => {
    const edits: [string, (db: FirebaseFirestore.Firestore, goalId: string, setupId: string) => Promise<unknown>][] = [
      ['setup closed, claim left active', (db, _g, setupId) => db.doc(`wsfCombinedGoals/${setupId}`).update({ status: 'closed' })],
      ['setup moved to another community', (db, _g, setupId) => db.doc(`wsfCombinedGoals/${setupId}`).update({ communityGroupId: 'someOtherGroup' })],
      ['setup with no frozen children', (db, _g, setupId) => db.doc(`wsfCombinedGoals/${setupId}`).update({ children: [] })],
      ['claim released, setup left active', (db, goalId) => db.doc(`wsfCombinedGoalClaims/${goalId}`).update({ status: 'released' })],
    ];
    for (const [label, edit] of edits) {
      const s = await scene();
      const now = Date.now();
      const pushups = await seedGoal(s.groupId, { title: 'Push-ups', unit: 'push-ups' });
      const created = (await callAs(wsfCreateCombinedGoal, s.champ, {
        communityGroupId: s.groupId,
        title: 'Move together',
        unit: 'movements',
        target: 2000,
        startsAt: iso(now - 2 * DAY),
        endsAt: iso(now + 25 * DAY),
        timezone: 'America/New_York',
        childGoalIds: [s.goalId, pushups],
      })) as { setupId: string };
      await edit(getFirestore(), s.goalId, created.setupId);
      const made = await createEvent(s.champ, draftInput(s.groupId, s.goalId));
      const served = (await callAs(wsfEventContext, s.champ, { goalId: s.goalId })) as { eventScope: string; setupId: string | null };
      expect([label, served.eventScope, served.setupId]).toEqual([label, 'goal', null]);
      expect([label, made.event.eventScope, made.event.setupId]).toEqual([label, 'goal', null]);
      const stored = (await getFirestore().doc(`wsfEvents/${made.event.eventId}`).get()).data() as { lineId: string };
      expect([label, stored.lineId]).toEqual([label, `goal__${s.goalId}`]);
    }
  }, 90_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. FIELD RULES
// ═══════════════════════════════════════════════════════════════════════════

describe('field rules', () => {
  test('title, timestamps, order, length, zone, goal window and request id are validated, and nothing is written', async () => {
    const s = await scene();
    const now = Date.now();
    const cases: [string, Data, string, string][] = [
      ['short title', { title: 'x' }, 'invalid-argument', 'title must be 2..120 chars.'],
      ['blank title', { title: '   ' }, 'invalid-argument', 'title must be 2..120 chars.'],
      ['long title', { title: 'y'.repeat(121) }, 'invalid-argument', 'title must be 2..120 chars.'],
      ['bad start', { startsAt: 'tomorrow' }, 'invalid-argument', 'startsAt must be a valid ISO 8601 timestamp.'],
      ['bad end', { endsAt: 12 }, 'invalid-argument', 'endsAt must be a valid ISO 8601 timestamp.'],
      ['end before start', { startsAt: iso(now + 2 * DAY), endsAt: iso(now + DAY) }, 'invalid-argument', 'endsAt must be strictly after startsAt.'],
      ['zero length', { startsAt: iso(now + DAY), endsAt: iso(now + DAY) }, 'invalid-argument', 'endsAt must be strictly after startsAt.'],
      ['too long', { startsAt: iso(now), endsAt: iso(now + 32 * DAY) }, 'invalid-argument', 'An event can last at most 31 days.'],
      ['bad zone', { timezone: 'Mars/Olympus' }, 'invalid-argument', 'timezone must be a valid IANA identifier.'],
      ['offset is not a zone', { timezone: '+05:00' }, 'invalid-argument', 'timezone must be a valid IANA identifier.'],
      ['before the goal', { startsAt: iso(now - 3 * DAY), endsAt: iso(now) }, 'invalid-argument', "The event must fall within the goal's own start and end."],
      ['after the goal', { startsAt: iso(now + 19 * DAY), endsAt: iso(now + 22 * DAY) }, 'invalid-argument', "The event must fall within the goal's own start and end."],
      ['no request id', { requestId: undefined }, 'invalid-argument', 'requestId is required.'],
      ['short request id', { requestId: 'abc' }, 'invalid-argument', 'requestId is required.'],
      ['no goal', { goalId: undefined }, 'invalid-argument', 'goalId is required.'],
      ['unknown goal', { goalId: 'nosuchgoal' }, 'not-found', 'That goal is not part of this community.'],
    ];
    for (const [name, patch, code, message] of cases) {
      const r = await attempt(createEvent(s.champ, draftInput(s.groupId, s.goalId, patch)));
      expect([name, r.ok]).toEqual([name, false]);
      if (!r.ok) expect([name, r.error.code, r.error.message]).toEqual([name, code, message]);
    }
    expect((await getFirestore().collection('wsfEvents').where('communityGroupId', '==', s.groupId).get()).size).toBe(0);
  }, 40_000);

  test('a closed goal takes no new Event, and an Event cannot be published once its goal is closed or its window has ended', async () => {
    const s = await scene();
    const later = await createEvent(s.champ, draftInput(s.groupId, s.goalId));
    const now = Date.now();
    const past = await createEvent(s.champ, draftInput(s.groupId, s.goalId, { startsAt: iso(now - 20 * 3_600_000), endsAt: iso(now - 3_600_000) }));
    refused(await attempt(transition(wsfPublishEvent, s.champ, past.event.eventId)), 'failed-precondition', 'That event has already ended.');
    await getFirestore().doc(`wsfGoals/${s.goalId}`).update({ status: 'closed' });
    refused(await attempt(createEvent(s.champ, draftInput(s.groupId, s.goalId))), 'failed-precondition', 'That goal is closed.');
    refused(await attempt(transition(wsfPublishEvent, s.champ, later.event.eventId)), 'failed-precondition', 'That goal is closed.');
    expect((await getEvent(s.champ, later.event.eventId)).event.status).toBe('draft');
  }, 30_000);
});

describe('the enrollment helper the admission integration will use', () => {
  test('only a published Event that has not ended admits enrollment; before its start it already does', () => {
    const at = (ms: number) => Timestamp.fromMillis(ms);
    const now = 1_800_000_000_000;
    const window = { startsAt: at(now + DAY), endsAt: at(now + DAY + 3_600_000) };
    expect(eventAllowsEnrollment({ status: 'published', ...window }, now)).toBe(true);
    expect(eventAllowsEnrollment({ status: 'published', ...window }, now + DAY + 60_000)).toBe(true);
    expect(eventAllowsEnrollment({ status: 'published', ...window }, now + DAY + 3_600_000)).toBe(false);
    for (const status of ['draft', 'closed', 'cancelled', 'archived'] as const) {
      expect([status, eventAllowsEnrollment({ status, ...window }, now + DAY + 60_000)]).toEqual([status, false]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. TRANSITIONS, IDEMPOTENCY, HISTORY
// ═══════════════════════════════════════════════════════════════════════════

describe('the lifecycle', () => {
  test('draft → published → closed → archived, each step once in history; nothing is ever deleted', async () => {
    const s = await scene();
    const { event } = await createEvent(s.champ, draftInput(s.groupId, s.goalId));
    const pub = await transition(wsfPublishEvent, s.champ, event.eventId);
    expect(pub.event).toMatchObject({ status: 'published', version: 2 });
    expect(typeof pub.event.publishedAtMillis).toBe('number');
    expect(pub.inFlight).toBeNull();
    const closed = await transition(wsfCloseEvent, s.champ, event.eventId);
    expect(closed.event).toMatchObject({ status: 'closed', version: 3 });
    expect(closed.inFlight).toEqual({ queued: 0, inProgress: 0 });
    const archived = await transition(wsfArchiveEvent, s.champ, event.eventId);
    expect(archived.event).toMatchObject({ status: 'archived', version: 4 });
    expect(archived.event.history.map((h) => [h.op, h.status])).toEqual([
      ['create', 'draft'], ['publish', 'published'], ['close', 'closed'], ['archive', 'archived'],
    ]);
    // Retained: still readable, hidden from the default list, shown when asked.
    expect((await getEvent(s.champ, event.eventId)).event.status).toBe('archived');
    expect(((await callAs(wsfListEvents, s.champ, { groupId: s.groupId })) as { events: EventView[] }).events).toEqual([]);
    expect(((await callAs(wsfListEvents, s.champ, { groupId: s.groupId, includeArchived: true })) as { events: EventView[] }).events.map((e) => e.status)).toEqual(['archived']);
  }, 30_000);

  test('cancel from draft and from published; an archived cancellation keeps both timestamps', async () => {
    const s = await scene();
    const a = (await createEvent(s.champ, draftInput(s.groupId, s.goalId))).event;
    expect((await transition(wsfCancelEvent, s.champ, a.eventId)).event.status).toBe('cancelled');
    const b = (await createEvent(s.champ, draftInput(s.groupId, s.goalId))).event;
    await transition(wsfPublishEvent, s.champ, b.eventId);
    const cancelled = await transition(wsfCancelEvent, s.champ, b.eventId);
    expect(cancelled.event.status).toBe('cancelled');
    const archived = (await transition(wsfArchiveEvent, s.champ, b.eventId)).event;
    expect(typeof archived.publishedAtMillis).toBe('number');
    expect(typeof archived.cancelledAtMillis).toBe('number');
    expect(archived.closedAtMillis).toBeNull();
  }, 30_000);

  test('every illegal transition is refused by name and changes nothing', async () => {
    const s = await scene();
    const draft = (await createEvent(s.champ, draftInput(s.groupId, s.goalId))).event;
    refused(await attempt(transition(wsfCloseEvent, s.champ, draft.eventId)), 'failed-precondition', 'An event that is draft cannot be closed.');
    refused(await attempt(transition(wsfArchiveEvent, s.champ, draft.eventId)), 'failed-precondition', 'An event that is draft cannot be archived.');
    await transition(wsfPublishEvent, s.champ, draft.eventId);
    refused(await attempt(transition(wsfArchiveEvent, s.champ, draft.eventId)), 'failed-precondition', 'An event that is published cannot be archived.');
    await transition(wsfCloseEvent, s.champ, draft.eventId);
    refused(await attempt(transition(wsfPublishEvent, s.champ, draft.eventId)), 'failed-precondition', 'An event that is closed cannot be published.');
    refused(await attempt(transition(wsfCancelEvent, s.champ, draft.eventId)), 'failed-precondition', 'An event that is closed cannot be cancelled.');
    await transition(wsfArchiveEvent, s.champ, draft.eventId);
    for (const fn of [wsfPublishEvent, wsfCloseEvent, wsfCancelEvent]) {
      refused(await attempt(transition(fn, s.champ, draft.eventId)), 'failed-precondition');
    }
    const after = (await getEvent(s.champ, draft.eventId)).event;
    expect(after.version).toBe(4);
    expect(after.history).toHaveLength(4);
  }, 30_000);

  test('a duplicate transition — the same request retried, or racing — is one step, not two', async () => {
    const s = await scene();
    const { event } = await createEvent(s.champ, draftInput(s.groupId, s.goalId));
    const req = rid();
    const both = await Promise.all([transition(wsfPublishEvent, s.champ, event.eventId, req), transition(wsfPublishEvent, s.champ, event.eventId, req), transition(wsfPublishEvent, s.champ, event.eventId)]);
    expect(both.filter((r) => !r.replayed)).toHaveLength(1);
    const now = await getEvent(s.champ, event.eventId);
    expect(now.event.version).toBe(2);
    expect(now.event.history.filter((h) => h.op === 'publish')).toHaveLength(1);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. EDITS — and what an edit can never reach
// ═══════════════════════════════════════════════════════════════════════════

describe('edits', () => {
  const update = (uid: string, data: Data) => callAs(wsfUpdateEvent, uid, data) as Promise<Written>;

  test('a draft edits title, window and zone against its version; a stale or retried edit does not double-apply', async () => {
    const s = await scene();
    const { event } = await createEvent(s.champ, draftInput(s.groupId, s.goalId));
    const now = Date.now();
    const req = rid();
    const edited = await update(s.champ, { eventId: event.eventId, expectedVersion: 1, requestId: req, title: 'Synthetic Expo Saturday', startsAt: iso(now + 2 * DAY), endsAt: iso(now + 2 * DAY + 3_600_000), timezone: 'Europe/London' });
    expect(edited.event).toMatchObject({ title: 'Synthetic Expo Saturday', timezone: 'Europe/London', version: 2 });
    const retry = await update(s.champ, { eventId: event.eventId, expectedVersion: 1, requestId: req, title: 'Ignored on retry' });
    expect(retry.replayed).toBe(true);
    expect(retry.event.title).toBe('Synthetic Expo Saturday');
    refused(await attempt(update(s.champ, { eventId: event.eventId, expectedVersion: 1, requestId: rid(), title: 'Stale' })), 'failed-precondition', 'This event changed. Refresh and try again.');
    refused(await attempt(update(s.champ, { eventId: event.eventId, expectedVersion: 2, requestId: rid(), endsAt: iso(now + DAY) })), 'invalid-argument', 'endsAt must be strictly after startsAt.');
    refused(await attempt(update(s.champ, { eventId: event.eventId, expectedVersion: 2, requestId: rid() })), 'invalid-argument', 'Nothing to change.');
    refused(await attempt(update(s.champ, { eventId: event.eventId, requestId: rid(), title: 'No version' })), 'invalid-argument', 'expectedVersion is required.');
  }, 30_000);

  test('once published, the times and zone are locked (only the title may change); closed and later events are frozen', async () => {
    const s = await scene();
    const { event } = await createEvent(s.champ, draftInput(s.groupId, s.goalId));
    await transition(wsfPublishEvent, s.champ, event.eventId);
    const now = Date.now();
    for (const patch of [{ startsAt: iso(now + 3 * DAY) }, { endsAt: iso(now + 4 * DAY) }, { timezone: 'Asia/Tokyo' }]) {
      refused(await attempt(update(s.champ, { eventId: event.eventId, expectedVersion: 2, requestId: rid(), ...patch })), 'failed-precondition', 'Times and time zone are locked once an event is published.');
    }
    const renamed = await update(s.champ, { eventId: event.eventId, expectedVersion: 2, requestId: rid(), title: 'Synthetic Expo (renamed)' });
    expect(renamed.event).toMatchObject({ title: 'Synthetic Expo (renamed)', startsAt: event.startsAt, endsAt: event.endsAt, timezone: event.timezone });
    await transition(wsfCloseEvent, s.champ, event.eventId);
    refused(await attempt(update(s.champ, { eventId: event.eventId, expectedVersion: 4, requestId: rid(), title: 'Too late' })), 'failed-precondition', 'This event can no longer be edited.');
  }, 30_000);

  test('an edit can never name the goal, community, target, unit, rules or status', async () => {
    const s = await scene();
    const other = await seedGoal(s.groupId, { title: 'Other goal', unit: 'laps' });
    const { event } = await createEvent(s.champ, draftInput(s.groupId, s.goalId));
    for (const patch of [{ goalId: other }, { groupId: 'elsewhere' }, { communityGroupId: 'elsewhere' }, { target: 1 }, { unit: 'laps' }, { status: 'published' }, { repeatPolicy: 'once' }]) {
      refused(await attempt(update(s.champ, { eventId: event.eventId, expectedVersion: 1, requestId: rid(), title: 'x y', ...patch })), 'invalid-argument', 'Only title, startsAt, endsAt and timezone can be edited.');
    }
    expect((await getEvent(s.champ, event.eventId)).event).toMatchObject({ goalId: s.goalId, version: 1, status: 'draft' });
  }, 30_000);

  test('no Event operation changes the goal: target, unit, rules, window and status are byte-identical afterwards', async () => {
    const s = await scene();
    const goalRef = getFirestore().doc(`wsfGoals/${s.goalId}`);
    const before = (await goalRef.get()).data();
    const { event } = await createEvent(s.champ, draftInput(s.groupId, s.goalId));
    await update(s.champ, { eventId: event.eventId, expectedVersion: 1, requestId: rid(), title: 'Renamed draft' });
    await transition(wsfPublishEvent, s.champ, event.eventId);
    await transition(wsfCloseEvent, s.champ, event.eventId);
    await transition(wsfArchiveEvent, s.champ, event.eventId);
    expect((await goalRef.get()).data()).toEqual(before);
  }, 30_000);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. EXISTING STATIONS, IN-FLIGHT TURNS AND RECORDED ATTEMPTS
// ═══════════════════════════════════════════════════════════════════════════

describe('existing stations and in-flight truth', () => {
  type Station = { stationId: string; secret: string };
  async function enrol(goalId: string, champ: string): Promise<Station> {
    const req = (await anon(wsfStationRequestPairing, { goalId })) as { pairingId: string; code: string };
    await callAs(wsfApproveStation, champ, { goalId, code: req.code, slot: 1 });
    return (await anon(wsfStationClaimPairing, { pairingId: req.pairingId })) as Station;
  }
  const hall = (st: Station) => anon(wsfTurnState, { stationId: st.stationId, secret: st.secret }) as Promise<{ assigned: { turnRef: string } | null }>;
  async function upAndReady(st: Station, uid: string, entryId: string): Promise<string> {
    await anon(wsfCallNext, { stationId: st.stationId, secret: st.secret });
    const ref = (await hall(st)).assigned!.turnRef;
    await callAs(wsfTurnReady, uid, { entryId });
    return ref;
  }

  test('a station works with NO Event at all — Events are not required for already-working stations', async () => {
    const s = await scene();
    const station = await enrol(s.goalId, s.champ);
    const a = await seedMember(s.groupId, 'ann');
    const entry = (await callAs(wsfJoinTurnLine, a, { goalId: s.goalId, calledName: 'Ann' })) as { entryId: string };
    const ref = await upAndReady(station, a, entry.entryId);
    await anon(wsfStartTurn, { stationId: station.stationId, secret: station.secret, expectedTurn: ref });
    const done = (await anon(wsfCompleteTurn, { stationId: station.stationId, secret: station.secret, expectedTurn: ref, count: 9 })) as { receipt: { addedCount: number } };
    expect(done.receipt.addedCount).toBe(9);
    expect((await getFirestore().collection('wsfEvents').where('goalId', '==', s.goalId).get()).size).toBe(0);
  }, 40_000);

  test('closing and archiving an Event leaves a queued place and a running turn exactly as they were, reports them, and the recorded attempt still replays', async () => {
    const s = await scene();
    const station = await enrol(s.goalId, s.champ);
    const { event } = await createEvent(s.champ, draftInput(s.groupId, s.goalId, { startsAt: iso(Date.now() - 3_600_000), endsAt: iso(Date.now() + 5 * 3_600_000) }));
    await transition(wsfPublishEvent, s.champ, event.eventId);

    const a = await seedMember(s.groupId, 'ann');
    const b = await seedMember(s.groupId, 'ben');
    const c = await seedMember(s.groupId, 'cat');
    const ea = (await callAs(wsfJoinTurnLine, a, { goalId: s.goalId, calledName: 'Ann' })) as { entryId: string };
    const refA = await upAndReady(station, a, ea.entryId);
    await anon(wsfStartTurn, { stationId: station.stationId, secret: station.secret, expectedTurn: refA });
    const first = (await anon(wsfCompleteTurn, { stationId: station.stationId, secret: station.secret, expectedTurn: refA, count: 5 })) as { receipt: { addedCount: number } };
    expect(first.receipt.addedCount).toBe(5);
    const eb = (await callAs(wsfJoinTurnLine, b, { goalId: s.goalId, calledName: 'Ben' })) as { entryId: string };
    const refB = await upAndReady(station, b, eb.entryId);
    await anon(wsfStartTurn, { stationId: station.stationId, secret: station.secret, expectedTurn: refB });
    const ec = (await callAs(wsfJoinTurnLine, c, { goalId: s.goalId, calledName: 'Cat' })) as { entryId: string };

    const entries = getFirestore().collection('wsfTurnEntries');
    const snapshot = async () => JSON.stringify(await Promise.all([eb.entryId, ec.entryId].map(async (id) => (await entries.doc(id).get()).data())));
    const before = await snapshot();
    const contributionsBefore = (await getFirestore().collection('wsfContributions').where('goalId', '==', s.goalId).get()).size;

    const closed = await transition(wsfCloseEvent, s.champ, event.eventId);
    expect(closed.inFlight).toEqual({ queued: 1, inProgress: 1 });
    const archived = await transition(wsfArchiveEvent, s.champ, event.eventId);
    expect(archived.inFlight).toEqual({ queued: 1, inProgress: 1 });
    expect(await snapshot()).toBe(before);
    expect((await getFirestore().collection('wsfContributions').where('goalId', '==', s.goalId).get()).size).toBe(contributionsBefore);

    // The running turn finishes on its own goal; the recorded attempt replays its own receipt; the queued place is still called.
    const bDone = (await anon(wsfCompleteTurn, { stationId: station.stationId, secret: station.secret, expectedTurn: refB, count: 7 })) as { receipt: { addedCount: number; goalId: string } };
    expect(bDone.receipt).toMatchObject({ addedCount: 7, goalId: s.goalId });
    const replay = (await anon(wsfCompleteTurn, { stationId: station.stationId, secret: station.secret, expectedTurn: refA, count: 999 })) as { receipt: { addedCount: number; alreadyRecorded: boolean } };
    expect(replay.receipt).toMatchObject({ addedCount: 5, alreadyRecorded: true });
    const next = (await anon(wsfCallNext, { stationId: station.stationId, secret: station.secret })) as { called: boolean };
    expect(next.called).toBe(true);
    expect(((await entries.doc(ec.entryId).get()).data() as { status: string }).status).toBe('assigned');

    // History and goal activity are retained on the archived Event.
    const got = await getEvent(s.champ, event.eventId);
    expect(got.event.history.map((h) => h.op)).toEqual(['create', 'publish', 'close', 'archive']);
    expect(got.goalActivity).toEqual({ contributions: 2, turns: 3 });
  }, 60_000);

  test('a place queued after a combined setup claims the goal is still counted when the Event is closed', async () => {
    const s = await scene();
    const now = Date.now();
    const { event } = await createEvent(s.champ, draftInput(s.groupId, s.goalId, { startsAt: iso(now - 3_600_000), endsAt: iso(now + 5 * 3_600_000) }));
    expect(event.eventScope).toBe('goal');
    await transition(wsfPublishEvent, s.champ, event.eventId);
    const pushups = await seedGoal(s.groupId, { title: 'Push-ups', unit: 'push-ups' });
    const created = (await callAs(wsfCreateCombinedGoal, s.champ, {
      communityGroupId: s.groupId,
      title: 'Move together',
      unit: 'movements',
      target: 2000,
      startsAt: iso(now - 2 * DAY),
      endsAt: iso(now + 25 * DAY),
      timezone: 'America/New_York',
      childGoalIds: [s.goalId, pushups],
    })) as { setupId: string };
    const a = await seedMember(s.groupId, 'ann');
    const ea = (await callAs(wsfJoinTurnLine, a, { goalId: s.goalId, calledName: 'Ann' })) as { entryId: string };
    const entry = (await getFirestore().doc(`wsfTurnEntries/${ea.entryId}`).get()).data() as { lineId: string; status: string };
    expect(entry.lineId).toBe(`setup__${created.setupId}`);
    const closed = await transition(wsfCloseEvent, s.champ, event.eventId);
    expect(closed.inFlight).toEqual({ queued: 1, inProgress: 0 });
    expect((await getFirestore().doc(`wsfTurnEntries/${ea.entryId}`).get()).data()).toEqual(expect.objectContaining({ lineId: entry.lineId, status: entry.status }));
    // The Event's own record is not rebound: it keeps the line it was created on.
    expect(((await getFirestore().doc(`wsfEvents/${event.eventId}`).get()).data() as { lineId: string; eventScope: string })).toMatchObject({ lineId: `goal__${s.goalId}`, eventScope: 'goal' });
  }, 60_000);

  test('a place queued on a combined line is still counted after that setup is closed and the goal is served alone', async () => {
    const s = await scene();
    const now = Date.now();
    const pushups = await seedGoal(s.groupId, { title: 'Push-ups', unit: 'push-ups' });
    const created = (await callAs(wsfCreateCombinedGoal, s.champ, {
      communityGroupId: s.groupId,
      title: 'Move together',
      unit: 'movements',
      target: 2000,
      startsAt: iso(now - 2 * DAY),
      endsAt: iso(now + 25 * DAY),
      timezone: 'America/New_York',
      childGoalIds: [s.goalId, pushups],
    })) as { setupId: string };
    const { event } = await createEvent(s.champ, draftInput(s.groupId, s.goalId, { startsAt: iso(now - 3_600_000), endsAt: iso(now + 5 * 3_600_000) }));
    expect(event).toMatchObject({ eventScope: 'setup', setupId: created.setupId });
    await transition(wsfPublishEvent, s.champ, event.eventId);
    const a = await seedMember(s.groupId, 'ann');
    const ea = (await callAs(wsfJoinTurnLine, a, { goalId: s.goalId, calledName: 'Ann' })) as { entryId: string };
    const before = (await getFirestore().doc(`wsfTurnEntries/${ea.entryId}`).get()).data() as { lineId: string };
    expect(before.lineId).toBe(`setup__${created.setupId}`);
    await callAs(wsfCloseCombinedGoal, s.champ, { setupId: created.setupId });
    expect(((await callAs(wsfEventContext, s.champ, { goalId: s.goalId })) as { eventScope: string }).eventScope).toBe('goal');
    const closed = await transition(wsfCloseEvent, s.champ, event.eventId);
    expect(closed.inFlight).toEqual({ queued: 1, inProgress: 0 });
    expect((await getFirestore().doc(`wsfTurnEntries/${ea.entryId}`).get()).data()).toEqual(before);
  }, 60_000);
});
