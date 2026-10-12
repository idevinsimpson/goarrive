/**
 * EVENT-LIFECYCLE-BACKEND-RECOVERY-1 — the canonical Event lifecycle, as an
 * ISOLATED module.
 *
 * Scope: #365 6059919181 (queue), 6060049268 (release), original task
 * 6044547053, withdrawal of the W5 predecessor 6059491796. Proposal reference
 * Lovable 3740225f docs/decisions/EVENT-LIFECYCLE-CONTRACT-DRAFT.md, with the
 * owner's later rule: close / cancel / archive INSTEAD OF delete.
 *
 * NOT LIVE. Nothing here is deployed until index.ts re-exports these handlers
 * (a separately reviewed single-owner integration; the exact diff is in
 * docs/westayfit/qa/event-lifecycle-backend-1.md). Firebase only deploys what
 * index.ts exports, so an unexported module is source, not a callable.
 *
 * WHAT AN EVENT IS, REUSING WHAT EXISTS. The canonical source already has one
 * notion of an event for a goal: resolveTurnEvent's `scope` — 'goal' (the goal
 * alone, line `goal__{goalId}`) or 'setup' (an active combined setup claims the
 * goal, line `setup__{setupId}`). An Event here is a LIFECYCLE RECORD over one
 * existing goal of the community: a title, a window inside the goal's window,
 * an IANA zone and a status, with the scope and setup snapshotted from that same
 * claim rule at creation. It is NOT a new goal, NOT a new ledger and NOT a new
 * line: contributions stay on the goal, turns stay on the existing line, and an
 * Event never writes to wsfGoals, wsfContributions, wsfTurnEntries, stations or
 * any combined-setup document. So already-working stations keep working with no
 * Event at all, and nothing here can rebind an in-flight turn or retarget,
 * re-unit or re-rule a goal.
 *
 * STORAGE. `wsfEvents/{eventId}`, server-only: firestore.rules' catch-all
 * denies every client read and write. No rules, index, IAM or package change.
 *
 * AUTHORIZATION, in every acting transaction: the caller's own membership row
 * (`wsfMemberships/{groupId}_{uid}`, its userId/groupId fields as the
 * authority), active, role 'foundingChampion' — the same rule as
 * requireChampion in index.ts — and, for every write, a verified email (the
 * organizer requirement wsfCreateGoal enforces). Nothing in a request can
 * assign a role, name another account, or move an Event to another community
 * or goal.
 *
 * LIFECYCLE.
 *   draft ──publish──▶ published ──close──▶ closed ──archive──▶ archived
 *     │                   │
 *     └─────cancel────────┴──cancel──▶ cancelled ──archive──▶ archived
 * Nothing is ever deleted; every transition is appended to the Event's history.
 * Closing, cancelling or archiving an Event does NOT close the goal, end a
 * queued place, interrupt a running turn, or touch a recorded attempt: the
 * goal's own status still governs every turn and contribution, and a replay of
 * a recorded attempt still returns its own receipt. The answer reports how many
 * places were queued or in progress on the Event's line at that moment, so the
 * caller sees exactly what was left running.
 */
import { createHash } from 'node:crypto';

import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

// ── vocabulary ──────────────────────────────────────────────────────────────

export type EventStatus = 'draft' | 'published' | 'closed' | 'cancelled' | 'archived';
export type EventOp = 'create' | 'update' | 'publish' | 'close' | 'cancel' | 'archive';

/** Allowed transitions: op -> the statuses it may start from, and where it goes. */
export const TRANSITIONS: Readonly<Record<Exclude<EventOp, 'create' | 'update'>, { from: readonly EventStatus[]; to: EventStatus }>> = {
  publish: { from: ['draft'], to: 'published' },
  close: { from: ['published'], to: 'closed' },
  cancel: { from: ['draft', 'published'], to: 'cancelled' },
  archive: { from: ['closed', 'cancelled'], to: 'archived' },
};

export const EVENT_MSG = {
  signIn: 'Sign in first.',
  verify: 'Verify your email before managing events.',
  notChampion: 'Only a Champion of this community can manage its events.',
  notAvailable: 'That event is not available.',
  goalNotHere: 'That goal is not part of this community.',
  goalClosed: 'That goal is closed.',
  title: 'title must be 2..120 chars.',
  startsAt: 'startsAt must be a valid ISO 8601 timestamp.',
  endsAt: 'endsAt must be a valid ISO 8601 timestamp.',
  order: 'endsAt must be strictly after startsAt.',
  timezone: 'timezone must be a valid IANA identifier.',
  outsideGoal: "The event must fall within the goal's own start and end.",
  ended: 'That event has already ended.',
  requestId: 'requestId is required.',
  expectedVersion: 'expectedVersion is required.',
  editFields: 'Only title, startsAt, endsAt and timezone can be edited.',
  nothingToEdit: 'Nothing to change.',
  locked: 'Times and time zone are locked once an event is published.',
  notEditable: 'This event can no longer be edited.',
  stale: 'This event changed. Refresh and try again.',
  transition: (op: 'publish' | 'close' | 'cancel' | 'archive', status: string) =>
    `An event that is ${status} cannot be ${{ publish: 'published', close: 'closed', cancel: 'cancelled', archive: 'archived' }[op]}.`,
} as const;

/** Longest event window accepted (an event is a session, not a season). */
export const MAX_EVENT_DAYS = 31;
/** How many past request ids each Event remembers for idempotent replay. */
export const REMEMBERED_REQUESTS = 50;
const MEMBERSHIP_ACTIVE = 'active';
const CHAMPION_ROLE = 'foundingChampion';

// ── pure normalizers (the same rules wsfCreateGoal applies) ─────────────────

export function normalizeId(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(t) ? t : null;
}
export function normalizeRequestId(v: unknown): string | null {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(v) ? v : null;
}
export function normalizeTitle(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length >= 2 && t.length <= 120 ? t : null;
}
export function normalizeIso(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length < 1 || t.length > 64) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}
/**
 * An IANA zone NAME (America/Chicago, Etc/GMT+5, UTC), which the runtime can
 * format. The name shape is checked first because the runtime also accepts raw
 * offsets such as "+05:00", which are not IANA identifiers and carry no
 * daylight-saving rules.
 */
export function normalizeZone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (t.length < 1 || t.length > 64) return null;
  if (!/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(t)) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: t });
    return t;
  } catch {
    return null;
  }
}

/** A stable Event id for (community, creator, requestId): a lost answer retried lands on the same Event. */
export function eventIdFor(groupId: string, uid: string, requestId: string): string {
  return `ev_${createHash('sha256').update(`${groupId}\n${uid}\n${requestId}`).digest('base64url').slice(0, 24)}`;
}

// ── storage and the response whitelist ──────────────────────────────────────

type HistoryEntry = { op: EventOp; status: EventStatus; atMillis: number; requestId: string; byUid: string };

export type EventDoc = {
  eventId: string;
  communityGroupId: string;
  goalId: string;
  eventScope: 'goal' | 'setup';
  setupId: string | null;
  lineId: string;
  title: string;
  startsAt: Timestamp;
  endsAt: Timestamp;
  timezone: string;
  status: EventStatus;
  version: number;
  createdByUid: string;
  createRequestId: string;
  createdAtMillis: number;
  updatedAtMillis: number;
  publishedAtMillis: number | null;
  closedAtMillis: number | null;
  cancelledAtMillis: number | null;
  archivedAtMillis: number | null;
  history: HistoryEntry[];
  /** requestId -> the version that request produced (bounded, newest last). */
  requests: { requestId: string; op: EventOp; version: number }[];
};

/** What a Champion is told: no uid anywhere (not the creator's, not an actor's). */
export type EventView = {
  eventId: string;
  communityGroupId: string;
  goalId: string;
  eventScope: 'goal' | 'setup';
  setupId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  status: EventStatus;
  version: number;
  createdAtMillis: number;
  updatedAtMillis: number;
  publishedAtMillis: number | null;
  closedAtMillis: number | null;
  cancelledAtMillis: number | null;
  archivedAtMillis: number | null;
  history: { op: EventOp; status: EventStatus; atMillis: number }[];
};

export function viewOf(d: EventDoc): EventView {
  return {
    eventId: d.eventId,
    communityGroupId: d.communityGroupId,
    goalId: d.goalId,
    eventScope: d.eventScope,
    setupId: d.setupId,
    title: d.title,
    startsAt: d.startsAt.toDate().toISOString(),
    endsAt: d.endsAt.toDate().toISOString(),
    timezone: d.timezone,
    status: d.status,
    version: d.version,
    createdAtMillis: d.createdAtMillis,
    updatedAtMillis: d.updatedAtMillis,
    publishedAtMillis: d.publishedAtMillis,
    closedAtMillis: d.closedAtMillis,
    cancelledAtMillis: d.cancelledAtMillis,
    archivedAtMillis: d.archivedAtMillis,
    history: d.history.map(({ op, status, atMillis }) => ({ op, status, atMillis })),
  };
}

/**
 * For the admission integration that is NOT part of this module: whether an
 * Event's state admits new station enrollment. Only a published Event that has
 * not yet ended does; enrollment may open before the Event starts, so a station
 * can be set up ahead of time. Existing stations are not gated by this module
 * at all.
 */
export function eventAllowsEnrollment(d: Pick<EventDoc, 'status' | 'startsAt' | 'endsAt'>, nowMillis: number): boolean {
  return d.status === 'published' && nowMillis < d.endsAt.toMillis();
}

// ── authorization, inside the acting transaction ────────────────────────────

type Tx = FirebaseFirestore.Transaction;

function requireAuth(request: { auth?: { uid: string; token: unknown } }, write: boolean): string {
  if (!request.auth) throw new HttpsError('unauthenticated', EVENT_MSG.signIn);
  if (write && (request.auth.token as { email_verified?: boolean }).email_verified !== true) {
    throw new HttpsError('failed-precondition', EVENT_MSG.verify);
  }
  return request.auth.uid;
}

/** True only for the caller's own active Founding Champion row in `groupId`, read in `tx`. */
async function isChampion(tx: Tx, groupId: string, uid: string): Promise<boolean> {
  const db = getFirestore();
  const [groupSnap, memberSnap] = await Promise.all([
    tx.get(db.doc(`wsfCommunityGroups/${groupId}`)),
    tx.get(db.doc(`wsfMemberships/${groupId}_${uid}`)),
  ]);
  if (!groupSnap.exists || !memberSnap.exists) return false;
  const m = memberSnap.data() as Record<string, unknown>;
  return m.userId === uid && m.groupId === groupId && m.membershipStatus === MEMBERSHIP_ACTIVE && m.role === CHAMPION_ROLE;
}

/** The Event, only if it exists AND the caller is a Champion of ITS community; otherwise one uniform not-found. */
async function eventForChampion(tx: Tx, eventId: string, uid: string): Promise<EventDoc> {
  const snap = await tx.get(getFirestore().doc(`wsfEvents/${eventId}`));
  if (!snap.exists) throw new HttpsError('not-found', EVENT_MSG.notAvailable);
  const d = snap.data() as EventDoc;
  if (d.eventId !== eventId || !(await isChampion(tx, d.communityGroupId, uid))) {
    throw new HttpsError('not-found', EVENT_MSG.notAvailable);
  }
  return d;
}

type GoalFacts = { status: unknown; communityGroupId: unknown; startsAt?: Timestamp; endsAt?: Timestamp };

async function readGoal(tx: Tx, goalId: string): Promise<GoalFacts | null> {
  const snap = await tx.get(getFirestore().doc(`wsfGoals/${goalId}`));
  return snap.exists ? (snap.data() as GoalFacts) : null;
}

/** The window must sit inside the goal's own window, so an Event never advertises time the goal refuses. */
function windowInsideGoal(goal: GoalFacts, startsAt: Date, endsAt: Date): boolean {
  const gs = goal.startsAt instanceof Timestamp ? goal.startsAt.toMillis() : NaN;
  const ge = goal.endsAt instanceof Timestamp ? goal.endsAt.toMillis() : NaN;
  return Number.isFinite(gs) && Number.isFinite(ge) && startsAt.getTime() >= gs && endsAt.getTime() <= ge;
}

function validateWindow(startsAt: Date, endsAt: Date): void {
  if (endsAt.getTime() <= startsAt.getTime()) throw new HttpsError('invalid-argument', EVENT_MSG.order);
  if (endsAt.getTime() - startsAt.getTime() > MAX_EVENT_DAYS * 86_400_000) {
    throw new HttpsError('invalid-argument', `An event can last at most ${MAX_EVENT_DAYS} days.`);
  }
}

function remember(d: Pick<EventDoc, 'requests'>, requestId: string, op: EventOp, version: number) {
  return [...d.requests.filter((r) => r.requestId !== requestId), { requestId, op, version }].slice(-REMEMBERED_REQUESTS);
}

function priorRequest(d: EventDoc, requestId: string, op: EventOp) {
  return d.requests.find((r) => r.requestId === requestId && r.op === op) ?? null;
}

// ── the goal's line, by the rule the turn callables use ─────────────────────

type Read = (ref: FirebaseFirestore.DocumentReference) => Promise<FirebaseFirestore.DocumentSnapshot>;
type Line = { eventScope: 'goal' | 'setup'; setupId: string | null; lineId: string };

/**
 * The line a goal's turns are on right now: resolveTurnEvent's rule in index.ts,
 * mirrored step for step (an ACTIVE claim on the goal, naming a setup that
 * exists, is active, is in the goal's own community and has at least one frozen
 * child), so an Event names the same line a station serves. `read` is tx.get
 * inside a transaction, or a plain get after one.
 */
async function lineForGoal(read: Read, goalId: string, goalGroupId: string): Promise<Line> {
  const db = getFirestore();
  const claimSnap = await read(db.doc(`wsfCombinedGoalClaims/${goalId}`));
  const claim = claimSnap.exists ? (claimSnap.data() as { status?: unknown; setupId?: unknown }) : null;
  const setupId = claim && claim.status === 'active' ? normalizeId(claim.setupId) : null;
  if (setupId) {
    const setupSnap = await read(db.doc(`wsfCombinedGoals/${setupId}`));
    const setup = setupSnap.exists ? (setupSnap.data() as { status?: unknown; communityGroupId?: unknown; children?: unknown }) : null;
    const children = setup && Array.isArray(setup.children) ? setup.children : [];
    const hasChild = children.some((c) => normalizeId((c as { goalId?: unknown } | null)?.goalId) !== null);
    if (setup && setup.status === 'active' && normalizeId(setup.communityGroupId) === goalGroupId && hasChild) {
      return { eventScope: 'setup', setupId, lineId: `setup__${setupId}` };
    }
  }
  return { eventScope: 'goal', setupId: null, lineId: `goal__${goalId}` };
}

// ── in-flight truth (read after the commit; never changed) ──────────────────

export type InFlight = { queued: number; inProgress: number };

/**
 * Places still queued or running for the Event's goal: on the line the goal is
 * served from NOW, and also on the line snapshotted at creation if a combined
 * setup has since claimed or released the goal, so nothing left running is
 * missed.
 */
async function inFlightFor(d: Pick<EventDoc, 'goalId' | 'communityGroupId' | 'lineId'>): Promise<InFlight> {
  const now = await lineForGoal((ref) => ref.get(), d.goalId, d.communityGroupId);
  const lines = [...new Set([now.lineId, d.lineId])];
  const col = getFirestore().collection('wsfTurnEntries');
  const count = async (lineId: string, status: string) =>
    (await col.where('lineStatusKey', '==', `${lineId}#${status}`).count().get()).data().count;
  const per = await Promise.all(
    lines.map(async (lineId) => {
      const [waiting, assigned, ready, active] = await Promise.all(['waiting', 'assigned', 'ready', 'active'].map((s) => count(lineId, s)));
      return { queued: waiting + assigned + ready, inProgress: active };
    })
  );
  return per.reduce((a, b) => ({ queued: a.queued + b.queued, inProgress: a.inProgress + b.inProgress }), { queued: 0, inProgress: 0 });
}

// ── handlers ────────────────────────────────────────────────────────────────

type CreateEventRequest = {
  groupId?: unknown;
  goalId?: unknown;
  title?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  timezone?: unknown;
  requestId?: unknown;
};

/** Create a DRAFT Event over an existing, active goal of the community. Idempotent on (community, caller, requestId). */
export const wsfCreateEvent = onCall<CreateEventRequest>(
  { region: 'us-central1' },
  async (request): Promise<{ event: EventView; replayed: boolean }> => {
    const uid = requireAuth(request, true);
    const groupId = normalizeId(request.data?.groupId);
    if (!groupId) throw new HttpsError('invalid-argument', 'groupId is required.');
    const goalId = normalizeId(request.data?.goalId);
    if (!goalId) throw new HttpsError('invalid-argument', 'goalId is required.');
    const requestId = normalizeRequestId(request.data?.requestId);
    if (!requestId) throw new HttpsError('invalid-argument', EVENT_MSG.requestId);
    const title = normalizeTitle(request.data?.title);
    if (!title) throw new HttpsError('invalid-argument', EVENT_MSG.title);
    const startsAt = normalizeIso(request.data?.startsAt);
    if (!startsAt) throw new HttpsError('invalid-argument', EVENT_MSG.startsAt);
    const endsAt = normalizeIso(request.data?.endsAt);
    if (!endsAt) throw new HttpsError('invalid-argument', EVENT_MSG.endsAt);
    const timezone = normalizeZone(request.data?.timezone);
    if (!timezone) throw new HttpsError('invalid-argument', EVENT_MSG.timezone);
    validateWindow(startsAt, endsAt);

    const db = getFirestore();
    const eventId = eventIdFor(groupId, uid, requestId);
    const ref = db.doc(`wsfEvents/${eventId}`);
    const now = Date.now();
    return db.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (!(await isChampion(tx, groupId, uid))) throw new HttpsError('permission-denied', EVENT_MSG.notChampion);
      if (existing.exists) {
        // The same request again (a double tap or a lost answer): the same Event, unchanged.
        return { event: viewOf(existing.data() as EventDoc), replayed: true };
      }
      const goal = await readGoal(tx, goalId);
      if (!goal || goal.communityGroupId !== groupId) throw new HttpsError('not-found', EVENT_MSG.goalNotHere);
      if (goal.status !== 'active') throw new HttpsError('failed-precondition', EVENT_MSG.goalClosed);
      if (!windowInsideGoal(goal, startsAt, endsAt)) throw new HttpsError('invalid-argument', EVENT_MSG.outsideGoal);

      // The scope rule resolveTurnEvent uses, read in this transaction.
      const line = await lineForGoal((r) => tx.get(r), goalId, groupId);

      const doc: EventDoc = {
        eventId,
        communityGroupId: groupId,
        goalId,
        eventScope: line.eventScope,
        setupId: line.setupId,
        lineId: line.lineId,
        title,
        startsAt: Timestamp.fromDate(startsAt),
        endsAt: Timestamp.fromDate(endsAt),
        timezone,
        status: 'draft',
        version: 1,
        createdByUid: uid,
        createRequestId: requestId,
        createdAtMillis: now,
        updatedAtMillis: now,
        publishedAtMillis: null,
        closedAtMillis: null,
        cancelledAtMillis: null,
        archivedAtMillis: null,
        history: [{ op: 'create', status: 'draft', atMillis: now, requestId, byUid: uid }],
        requests: [{ requestId, op: 'create', version: 1 }],
      };
      tx.create(ref, { ...doc, createdAt: FieldValue.serverTimestamp() });
      return { event: viewOf(doc), replayed: false };
    });
  }
);

/** One Event, with goal-scoped activity counts. Champions of the Event's community only. */
export const wsfGetEvent = onCall<{ eventId?: unknown }>(
  { region: 'us-central1' },
  async (request): Promise<{ event: EventView; goalActivity: { contributions: number; turns: number } }> => {
    const uid = requireAuth(request, false);
    const eventId = normalizeId(request.data?.eventId);
    if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
    const db = getFirestore();
    const d = await db.runTransaction((tx) => eventForChampion(tx, eventId, uid));
    // Equality-only aggregates (no composite index): counts for the GOAL, labelled as such, never as event-window counts.
    const [contributions, turns] = await Promise.all([
      db.collection('wsfContributions').where('goalId', '==', d.goalId).count().get(),
      db.collection('wsfTurnEntries').where('goalId', '==', d.goalId).count().get(),
    ]);
    return { event: viewOf(d), goalActivity: { contributions: contributions.data().count, turns: turns.data().count } };
  }
);

/** The community's Events, newest first; archived ones only on request. Champions only. */
export const wsfListEvents = onCall<{ groupId?: unknown; goalId?: unknown; includeArchived?: unknown }>(
  { region: 'us-central1' },
  async (request): Promise<{ events: EventView[] }> => {
    const uid = requireAuth(request, false);
    const groupId = normalizeId(request.data?.groupId);
    if (!groupId) throw new HttpsError('invalid-argument', 'groupId is required.');
    const goalFilter = request.data?.goalId === undefined ? null : normalizeId(request.data.goalId);
    if (request.data?.goalId !== undefined && !goalFilter) throw new HttpsError('invalid-argument', 'goalId is not valid.');
    const includeArchived = request.data?.includeArchived === true;
    const db = getFirestore();
    const ok = await db.runTransaction((tx) => isChampion(tx, groupId, uid));
    if (!ok) throw new HttpsError('permission-denied', EVENT_MSG.notChampion);
    // Equality only (single-field index): filtering and ordering happen here, bounded.
    const snap = await db.collection('wsfEvents').where('communityGroupId', '==', groupId).limit(501).get();
    if (snap.size > 500) throw new HttpsError('failed-precondition', 'This community has too many events to list right now.');
    const events = snap.docs
      .map((s) => s.data() as EventDoc)
      .filter((d) => d.communityGroupId === groupId && (goalFilter === null || d.goalId === goalFilter))
      .filter((d) => includeArchived || d.status !== 'archived')
      .sort((a, b) => b.createdAtMillis - a.createdAtMillis)
      .map(viewOf);
    return { events };
  }
);

type UpdateEventRequest = {
  eventId?: unknown;
  expectedVersion?: unknown;
  requestId?: unknown;
  title?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  timezone?: unknown;
};
const EDITABLE = new Set(['eventId', 'expectedVersion', 'requestId', 'title', 'startsAt', 'endsAt', 'timezone']);

/**
 * Edit an Event's own metadata. A draft may change title, window and zone; a
 * published Event only its title (its times are what people were told and
 * what stations may already be serving); closed, cancelled and archived Events
 * are frozen. The goal, community, target, unit and rules are not fields of an
 * Event and cannot be named here.
 */
export const wsfUpdateEvent = onCall<UpdateEventRequest>(
  { region: 'us-central1' },
  async (request): Promise<{ event: EventView; replayed: boolean }> => {
    const uid = requireAuth(request, true);
    const data = (request.data ?? {}) as Record<string, unknown>;
    if (Object.keys(data).some((k) => !EDITABLE.has(k))) throw new HttpsError('invalid-argument', EVENT_MSG.editFields);
    const eventId = normalizeId(data.eventId);
    if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
    const requestId = normalizeRequestId(data.requestId);
    if (!requestId) throw new HttpsError('invalid-argument', EVENT_MSG.requestId);
    const expectedVersion = typeof data.expectedVersion === 'number' && Number.isInteger(data.expectedVersion) && data.expectedVersion >= 1 ? data.expectedVersion : null;
    if (expectedVersion === null) throw new HttpsError('invalid-argument', EVENT_MSG.expectedVersion);

    const patch: { title?: string; startsAt?: Date; endsAt?: Date; timezone?: string } = {};
    if (data.title !== undefined) {
      const t = normalizeTitle(data.title);
      if (!t) throw new HttpsError('invalid-argument', EVENT_MSG.title);
      patch.title = t;
    }
    if (data.startsAt !== undefined) {
      const s = normalizeIso(data.startsAt);
      if (!s) throw new HttpsError('invalid-argument', EVENT_MSG.startsAt);
      patch.startsAt = s;
    }
    if (data.endsAt !== undefined) {
      const e = normalizeIso(data.endsAt);
      if (!e) throw new HttpsError('invalid-argument', EVENT_MSG.endsAt);
      patch.endsAt = e;
    }
    if (data.timezone !== undefined) {
      const z = normalizeZone(data.timezone);
      if (!z) throw new HttpsError('invalid-argument', EVENT_MSG.timezone);
      patch.timezone = z;
    }
    if (Object.keys(patch).length === 0) throw new HttpsError('invalid-argument', EVENT_MSG.nothingToEdit);

    const db = getFirestore();
    const ref = db.doc(`wsfEvents/${eventId}`);
    const now = Date.now();
    return db.runTransaction(async (tx) => {
      const d = await eventForChampion(tx, eventId, uid);
      if (priorRequest(d, requestId, 'update')) return { event: viewOf(d), replayed: true };
      if (d.version !== expectedVersion) throw new HttpsError('failed-precondition', EVENT_MSG.stale);
      if (d.status !== 'draft' && d.status !== 'published') throw new HttpsError('failed-precondition', EVENT_MSG.notEditable);
      const timeFields = patch.startsAt !== undefined || patch.endsAt !== undefined || patch.timezone !== undefined;
      if (d.status === 'published' && timeFields) throw new HttpsError('failed-precondition', EVENT_MSG.locked);

      const startsAt = patch.startsAt ?? d.startsAt.toDate();
      const endsAt = patch.endsAt ?? d.endsAt.toDate();
      if (timeFields) {
        validateWindow(startsAt, endsAt);
        const goal = await readGoal(tx, d.goalId);
        if (!goal || !windowInsideGoal(goal, startsAt, endsAt)) throw new HttpsError('invalid-argument', EVENT_MSG.outsideGoal);
      }
      const version = d.version + 1;
      const next: EventDoc = {
        ...d,
        title: patch.title ?? d.title,
        startsAt: Timestamp.fromDate(startsAt),
        endsAt: Timestamp.fromDate(endsAt),
        timezone: patch.timezone ?? d.timezone,
        version,
        updatedAtMillis: now,
        history: [...d.history, { op: 'update', status: d.status, atMillis: now, requestId, byUid: uid }],
        requests: remember(d, requestId, 'update', version),
      };
      tx.set(ref, { ...next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { event: viewOf(next), replayed: false };
    });
  }
);

type TransitionResponse = { event: EventView; replayed: boolean; inFlight: InFlight | null };

/**
 * One lifecycle transition, strictly from its allowed statuses, idempotent:
 * the same requestId returns the settled Event; asking for the state the Event
 * is already in returns it unchanged. Close / cancel / archive end nothing on
 * the line and touch no contribution; the answer counts what was left running.
 */
function transitionHandler(op: keyof typeof TRANSITIONS) {
  return onCall<{ eventId?: unknown; requestId?: unknown }>(
    { region: 'us-central1' },
    async (request): Promise<TransitionResponse> => {
      const uid = requireAuth(request, true);
      const eventId = normalizeId(request.data?.eventId);
      if (!eventId) throw new HttpsError('invalid-argument', 'eventId is required.');
      const requestId = normalizeRequestId(request.data?.requestId);
      if (!requestId) throw new HttpsError('invalid-argument', EVENT_MSG.requestId);
      const rule = TRANSITIONS[op];
      const db = getFirestore();
      const ref = db.doc(`wsfEvents/${eventId}`);
      const now = Date.now();
      const result = await db.runTransaction(async (tx) => {
        const d = await eventForChampion(tx, eventId, uid);
        if (priorRequest(d, requestId, op) || d.status === rule.to) return { doc: d, replayed: true };
        if (!rule.from.includes(d.status)) throw new HttpsError('failed-precondition', EVENT_MSG.transition(op, d.status));
        if (op === 'publish') {
          const goal = await readGoal(tx, d.goalId);
          if (!goal || goal.communityGroupId !== d.communityGroupId) throw new HttpsError('failed-precondition', EVENT_MSG.goalNotHere);
          if (goal.status !== 'active') throw new HttpsError('failed-precondition', EVENT_MSG.goalClosed);
          if (!windowInsideGoal(goal, d.startsAt.toDate(), d.endsAt.toDate())) throw new HttpsError('failed-precondition', EVENT_MSG.outsideGoal);
          if (now >= d.endsAt.toMillis()) throw new HttpsError('failed-precondition', EVENT_MSG.ended);
        }
        const version = d.version + 1;
        const stamp: Partial<EventDoc> =
          op === 'publish' ? { publishedAtMillis: now }
          : op === 'close' ? { closedAtMillis: now }
          : op === 'cancel' ? { cancelledAtMillis: now }
          : { archivedAtMillis: now };
        const next: EventDoc = {
          ...d,
          ...stamp,
          status: rule.to,
          version,
          updatedAtMillis: now,
          history: [...d.history, { op, status: rule.to, atMillis: now, requestId, byUid: uid }],
          requests: remember(d, requestId, op, version),
        };
        tx.set(ref, { ...next, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { doc: next, replayed: false };
      });
      const inFlight = op === 'publish' ? null : await inFlightFor(result.doc);
      return { event: viewOf(result.doc), replayed: result.replayed, inFlight };
    }
  );
}

export const wsfPublishEvent = transitionHandler('publish');
export const wsfCloseEvent = transitionHandler('close');
export const wsfCancelEvent = transitionHandler('cancel');
export const wsfArchiveEvent = transitionHandler('archive');
