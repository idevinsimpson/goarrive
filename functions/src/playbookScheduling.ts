/**
 * Playbook Scheduling — Phase A (3a)
 *
 * Adds the member-level double-booking guard that the legacy scheduling
 * system never had, plus the transactional booking path for playbook
 * sessions.
 *
 * Collections:
 *  - member_time_reservations: one doc per member per booked time window,
 *    keyed `${memberKey}_${startUtcMillis}` so two concurrent bookings of the
 *    identical start collide on create(); overlapping-but-not-identical
 *    windows are caught by a range query inside the same transaction.
 *    memberKey is `memberId` for signed-in members and `guest:<sha256(email)>`
 *    for guest-by-email bookings (Phase B) — the guard works before the guest
 *    ever creates an account.
 *  - session_instances: playbook bookings reuse the existing state machine
 *    (scheduled → allocated → in_progress → completed / missed / cancelled /
 *    skipped) with new fields: playbookId, playbookTitle, sessionKind,
 *    recordingEnabled, pinnedWorkoutId, startUtc, endUtc, reservationId.
 *
 * Group-proofing: reservations and caps are keyed per member, never per
 * playbook. A future group playbook books N members = N transactions of this
 * exact shape; nothing here assumes a single member.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp, FieldValue, Transaction } from 'firebase-admin/firestore';

const getDb = () => admin.firestore();

// Longest plausible session — bounds the reservation range query so the
// composite index stays single-field-range (memberKey ==, startUtc range).
const MAX_SESSION_MS = 4 * 60 * 60 * 1000;

export type PlaybookSessionKind = 'coach_guided' | 'coach_review';

/**
 * DECISION PENDING (Devin, Phase B.2): after the last workout in the playbook,
 * rotate back to the first workout (true) or stop assigning workouts (false).
 * Single flip point — the client-side day→workout mapping reads the same
 * default. Change here + PlaybookSchedulePanel.ROTATE_AT_END to flip.
 */
export const ROTATE_AT_PLAYBOOK_END = true;

// ── Timezone math (no tz library in functions/ — Intl only) ─────────────────
// All conversions are done per-date in the member's IANA timezone so DST
// transitions land on the correct UTC instant.

function tzOffsetMs(utcDate: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const p of dtf.formatToParts(utcDate)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return asUtc - utcDate.getTime();
}

/** Convert a wall-clock date + HH:mm in an IANA timezone to a UTC Date. */
export function wallTimeToUtc(dateStr: string, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0);
  // Fixed-point iteration: offset can change across a DST boundary, so
  // re-evaluate once with the first guess.
  let guess = naive - tzOffsetMs(new Date(naive), timeZone);
  guess = naive - tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

function wallDateOf(utc: Date, timeZone: string): { dateStr: string; dow: number } {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(utc)) parts[p.type] = p.value;
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dateStr: `${parts.year}-${parts.month}-${parts.day}`,
    dow: dowMap[parts.weekday] ?? 0,
  };
}

function addDaysToDateStr(dateStr: string, days: number): string {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().split('T')[0];
}

/**
 * Cap week boundary: Monday 00:00 in the member's timezone (locked product
 * decision). Returns the UTC window [weekStart, weekEnd) containing instant.
 */
export function memberWeekWindowUtc(instant: Date, timeZone: string): { weekStartUtc: Date; weekEndUtc: Date } {
  const { dateStr, dow } = wallDateOf(instant, timeZone);
  const daysSinceMonday = (dow + 6) % 7;
  const mondayStr = addDaysToDateStr(dateStr, -daysSinceMonday);
  const nextMondayStr = addDaysToDateStr(mondayStr, 7);
  return {
    weekStartUtc: wallTimeToUtc(mondayStr, '00:00', timeZone),
    weekEndUtc: wallTimeToUtc(nextMondayStr, '00:00', timeZone),
  };
}

// ── Reservation helpers ─────────────────────────────────────────────────────

/** Statuses that hold a member's time (block double-booking / count toward cap). */
const BLOCKING_STATUSES = ['scheduled', 'allocated', 'in_progress', 'skip_requested', 'allocation_failed'];

function reservationId(memberKey: string, startUtc: Date): string {
  return `${memberKey}_${startUtc.getTime()}`;
}

/**
 * Inside a transaction: verify [startUtc, endUtc) is free for memberKey.
 * Checks (1) member_time_reservations — covers all playbook bookings incl.
 * future guest bookings — and (2) legacy session_instances that predate the
 * reservation system (no reservationId), tz-normalized per occurrence.
 * Returns a human-readable conflict description or null if free.
 */
async function findOverlapInTxn(
  txn: Transaction,
  memberKey: string,
  memberId: string | null,
  startUtc: Date,
  endUtc: Date,
): Promise<string | null> {
  const db = getDb();

  const resSnap = await txn.get(
    db.collection('member_time_reservations')
      .where('memberKey', '==', memberKey)
      .where('startUtc', '>', Timestamp.fromMillis(startUtc.getTime() - MAX_SESSION_MS))
      .where('startUtc', '<', Timestamp.fromDate(endUtc))
  );
  for (const doc of resSnap.docs) {
    const r = doc.data();
    const rStart = (r.startUtc as Timestamp).toMillis();
    const rEnd = (r.endUtc as Timestamp).toMillis();
    if (rStart < endUtc.getTime() && rEnd > startUtc.getTime()) {
      return `existing booking ${new Date(rStart).toISOString()}`;
    }
  }

  // Legacy instances: local wall-clock only (scheduledDate + HH:mm + IANA tz).
  // Bound by scheduledDate ±1 day around the target window, then normalize
  // each candidate through its own timezone (DST-safe, per-date).
  if (memberId) {
    const targetDate = startUtc.toISOString().split('T')[0];
    const legacySnap = await txn.get(
      db.collection('session_instances')
        .where('memberId', '==', memberId)
        .where('scheduledDate', '>=', addDaysToDateStr(targetDate, -1))
        .where('scheduledDate', '<=', addDaysToDateStr(targetDate, 1))
    );
    for (const doc of legacySnap.docs) {
      const inst = doc.data();
      if (inst.reservationId) continue; // reservation-backed — already checked above
      if (!BLOCKING_STATUSES.includes(inst.status)) continue;
      const instTz = inst.timezone || 'America/New_York';
      const instStart = wallTimeToUtc(inst.scheduledDate, inst.scheduledStartTime || '00:00', instTz);
      const instEnd = new Date(instStart.getTime() + (inst.durationMinutes || 30) * 60 * 1000);
      if (instStart.getTime() < endUtc.getTime() && instEnd.getTime() > startUtc.getTime()) {
        return `legacy session on ${inst.scheduledDate} at ${inst.scheduledStartTime}`;
      }
    }
  }

  return null;
}

/**
 * Release the reservation held by a session instance (cancel / skip /
 * reschedule). Deletes the doc — deterministic IDs mean a released window
 * must be re-creatable via create(). Safe no-op when there is none.
 */
export async function releaseReservationForInstance(instanceData: Record<string, any>): Promise<void> {
  const resId = instanceData.reservationId as string | undefined;
  if (!resId) return;
  try {
    await getDb().collection('member_time_reservations').doc(resId).delete();
  } catch (err: any) {
    console.warn(`[playbookScheduling] Failed to release reservation ${resId}: ${err.message}`);
  }
}

/**
 * Move an instance's reservation to a new window, transactionally re-running
 * the overlap guard. Throws already-exists on conflict. Returns the new
 * reservation ID and UTC instants (caller updates the instance doc).
 */
export async function moveReservationForInstance(
  instanceId: string,
  instanceData: Record<string, any>,
  newDate: string,
  newStartTime: string,
): Promise<{ reservationId: string; startUtc: Date; endUtc: Date } | null> {
  const oldResId = instanceData.reservationId as string | undefined;
  if (!oldResId) return null; // legacy instance — no reservation to move

  const db = getDb();
  const tz = instanceData.timezone || 'America/New_York';
  const startUtc = wallTimeToUtc(newDate, newStartTime, tz);
  const endUtc = new Date(startUtc.getTime() + (instanceData.durationMinutes || 30) * 60 * 1000);
  const memberKey = instanceData.memberKey || instanceData.memberId;
  const newResId = reservationId(memberKey, startUtc);

  await db.runTransaction(async (txn) => {
    const conflict = await findOverlapInTxn(txn, memberKey, instanceData.memberId || null, startUtc, endUtc);
    if (conflict) {
      throw new HttpsError('already-exists', `That time overlaps another session for this member (${conflict})`);
    }
    const oldResRef = db.collection('member_time_reservations').doc(oldResId);
    const oldResSnap = await txn.get(oldResRef);
    txn.create(db.collection('member_time_reservations').doc(newResId), {
      ...(oldResSnap.exists ? oldResSnap.data() : {
        memberKey,
        memberId: instanceData.memberId || null,
        guestEmail: instanceData.guestEmail || null,
        coachId: instanceData.coachId,
        playbookId: instanceData.playbookId || null,
      }),
      sessionInstanceId: instanceId,
      startUtc: Timestamp.fromDate(startUtc),
      endUtc: Timestamp.fromDate(endUtc),
      createdAt: FieldValue.serverTimestamp(),
    });
    if (oldResSnap.exists) txn.delete(oldResRef);
  });

  return { reservationId: newResId, startUtc, endUtc };
}

// ── Idempotent booking requests (optional client-supplied clientRequestId) ──
// booking_requests/{clientRequestId}: dedupe guard so a client retry after a
// timeout can never double-book. Requests without a clientRequestId behave
// exactly as before (fully backward compatible).

const CLIENT_REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const PENDING_CLAIM_STALE_MS = 5 * 60 * 1000;
const CLAIM_EXPIRY_MS = 24 * 60 * 60 * 1000;

export function validClientRequestId(raw: unknown): string | null {
  return typeof raw === 'string' && CLIENT_REQUEST_ID_RE.test(raw) ? raw : null;
}

export interface BookingRequestScope {
  fn: 'bookPlaybookSession' | 'bookViaBookingToken';
  coachId: string;
  memberKey: string;
  playbookId: string;
}

/**
 * Transactionally claim booking_requests/{clientRequestId}. Returns the
 * stored result when this exact request already completed (idempotent
 * replay); otherwise writes a pending claim and returns null. Scope fields
 * must match on replay — a request ID can never cross coach/member/function.
 */
export async function claimBookingRequest(
  clientRequestId: string,
  scope: BookingRequestScope,
): Promise<Record<string, any> | null> {
  const db = getDb();
  const ref = db.collection('booking_requests').doc(clientRequestId);
  let prior: Record<string, any> | null = null;
  await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref);
    if (snap.exists) {
      const data = snap.data()!;
      if (data.fn !== scope.fn || data.coachId !== scope.coachId
        || data.memberKey !== scope.memberKey || data.playbookId !== scope.playbookId) {
        throw new HttpsError('permission-denied', 'This request ID belongs to a different booking');
      }
      if (data.result) {
        prior = data.result;
        return;
      }
      const createdMs = (data.createdAt as Timestamp | undefined)?.toMillis?.() ?? 0;
      if (Date.now() - createdMs < PENDING_CLAIM_STALE_MS) {
        throw new HttpsError('aborted', 'This booking is still processing — try again in a moment');
      }
      // Stale pending claim from a crashed run — reclaim it.
    }
    txn.set(ref, {
      ...scope,
      result: null,
      createdAt: FieldValue.serverTimestamp(),
      // TTL-style cleanup guard: anything past expiresAt is safe to delete.
      expiresAt: Timestamp.fromMillis(Date.now() + CLAIM_EXPIRY_MS),
    });
  });
  return prior;
}

export async function storeBookingRequestResult(
  clientRequestId: string,
  result: Record<string, any>,
): Promise<void> {
  try {
    await getDb().collection('booking_requests').doc(clientRequestId).set(
      { result, completedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  } catch (err: any) {
    console.warn(`[playbookScheduling] Failed to store booking request result ${clientRequestId}: ${err.message}`);
  }
}

/** Release a pending claim after a failed run so a retry can book fresh. */
export async function releaseBookingRequest(clientRequestId: string): Promise<void> {
  try {
    await getDb().collection('booking_requests').doc(clientRequestId).delete();
  } catch (err: any) {
    console.warn(`[playbookScheduling] Failed to release booking request ${clientRequestId}: ${err.message}`);
  }
}

export const cleanupExpiredBookingRequests = onSchedule(
  { schedule: '30 3 * * *', timeZone: 'UTC' },
  async () => {
    const db = getDb();
    const batchSize = 400;
    let deletedCount = 0;

    const expiredQuery = db
      .collection('booking_requests')
      .where('expiresAt', '<', Timestamp.now())
      .limit(batchSize);
    let snap = await expiredQuery.get();
    while (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deletedCount += snap.size;
      snap = await expiredQuery.get();
    }

    console.log(`[cleanupExpiredBookingRequests] Deleted ${deletedCount} expired booking request(s)`);
  }
);

// ── Shared single-occurrence booking (coach path + public token path) ───────

export interface BookOccurrenceParams {
  playbookId: string;
  playbook: Record<string, any>;
  coachId: string;
  memberKey: string;               // memberId, or `guest:<sha256(email)>`
  memberId: string | null;         // null for guest bookings
  guestEmail: string | null;
  memberName: string;
  dateStr: string;                 // YYYY-MM-DD (member-local wall clock)
  startTime: string;               // HH:mm
  timezone: string;                // IANA
  durationMinutes: number;
  sessionKind: PlaybookSessionKind;
  recordingEnabled: boolean;
  weeklySessionCap: number | null;
  pinnedWorkoutId?: string | null;
  bookedVia?: 'coach_panel' | 'booking_link';
  location?: string | null;
}

export function hostingFieldsFor(sessionKind: PlaybookSessionKind): Record<string, any> {
  // coach_guided rides the coach's own Zoom room; coach_review rides the
  // shared bot-room pool (round-robin in allocateSessionInstance).
  return sessionKind === 'coach_guided'
    ? { roomSource: 'coach_personal', hostingMode: 'coach_led', coachExpectedLive: true, personalZoomRequired: true, guidancePhase: 'coach_guided' }
    : { roomSource: 'shared_pool', hostingMode: 'hosted', coachExpectedLive: false, personalZoomRequired: false, guidancePhase: 'self_guided' };
}

/**
 * One atomic booking: global overlap guard + per-playbook weekly cap +
 * reservation create + session_instance create, all in one transaction.
 * Throws HttpsError already-exists (conflict) / resource-exhausted (cap).
 */
export async function bookOccurrence(p: BookOccurrenceParams): Promise<{ instanceId: string; reservationId: string }> {
  const db = getDb();
  const startUtc = wallTimeToUtc(p.dateStr, p.startTime, p.timezone);
  const endUtc = new Date(startUtc.getTime() + p.durationMinutes * 60 * 1000);
  const endMinutesTotal = Number(p.startTime.split(':')[0]) * 60 + Number(p.startTime.split(':')[1]) + p.durationMinutes;
  const scheduledEndTime = `${String(Math.floor(endMinutesTotal / 60) % 24).padStart(2, '0')}:${String(endMinutesTotal % 60).padStart(2, '0')}`;
  const resId = reservationId(p.memberKey, startUtc);
  const instRef = db.collection('session_instances').doc();

  await db.runTransaction(async (txn) => {
    // 1. Global overlap guard — reservations (all playbooks) + legacy instances
    const conflict = await findOverlapInTxn(txn, p.memberKey, p.memberId, startUtc, endUtc);
    if (conflict) throw new HttpsError('already-exists', conflict);

    // 2. Per-playbook weekly cap — Monday boundary in member tz. Signed-in
    // members are counted by memberId (covers Phase A instances that predate
    // the memberKey field); guests are counted by memberKey.
    if (p.weeklySessionCap !== null) {
      const { weekStartUtc, weekEndUtc } = memberWeekWindowUtc(startUtc, p.timezone);
      const baseQuery = db.collection('session_instances')
        .where('playbookId', '==', p.playbookId);
      const capQuery = p.memberId
        ? baseQuery.where('memberId', '==', p.memberId)
        : baseQuery.where('memberKey', '==', p.memberKey);
      const capSnap = await txn.get(
        capQuery
          .where('startUtc', '>=', Timestamp.fromDate(weekStartUtc))
          .where('startUtc', '<', Timestamp.fromDate(weekEndUtc))
      );
      const activeCount = capSnap.docs.filter((doc) => BLOCKING_STATUSES.includes(doc.data().status) || doc.data().status === 'completed').length;
      if (activeCount >= p.weeklySessionCap) {
        throw new HttpsError('resource-exhausted', `weekly cap of ${p.weeklySessionCap} reached`);
      }
    }

    // 3. Reservation — deterministic ID, create() collides on races
    txn.create(db.collection('member_time_reservations').doc(resId), {
      memberKey: p.memberKey,
      memberId: p.memberId,
      guestEmail: p.guestEmail,
      coachId: p.coachId,
      playbookId: p.playbookId,
      sessionInstanceId: instRef.id,
      startUtc: Timestamp.fromDate(startUtc),
      endUtc: Timestamp.fromDate(endUtc),
      createdAt: FieldValue.serverTimestamp(),
    });

    // 4. Session instance — reuses the legacy state machine end-to-end
    const inst: Record<string, any> = {
      id: instRef.id,
      coachId: p.coachId,
      memberId: p.memberId,
      memberKey: p.memberKey,
      memberName: p.memberName,
      playbookId: p.playbookId,
      playbookTitle: p.playbook.name || 'Playbook',
      sessionKind: p.sessionKind,
      recordingEnabled: p.recordingEnabled,
      scheduledDate: p.dateStr,
      scheduledStartTime: p.startTime,
      scheduledEndTime,
      durationMinutes: p.durationMinutes,
      timezone: p.timezone,
      startUtc: Timestamp.fromDate(startUtc),
      endUtc: Timestamp.fromDate(endUtc),
      reservationId: resId,
      status: 'scheduled',
      allocationAttempts: 0,
      guestEmail: p.guestEmail,
      bookedVia: p.bookedVia || 'coach_panel',
      location: p.location || null,
      ...hostingFieldsFor(p.sessionKind),
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (p.pinnedWorkoutId && Array.isArray(p.playbook.workoutIds) && p.playbook.workoutIds.includes(p.pinnedWorkoutId)) {
      inst.pinnedWorkoutId = p.pinnedWorkoutId;
    }
    txn.set(instRef, inst);
  });

  return { instanceId: instRef.id, reservationId: resId };
}

// ── bookPlaybookSession ──────────────────────────────────────────────────────

interface BookPlaybookSessionData {
  playbookId: string;
  daysOfWeek: number[];          // 0–6, at least one
  startTime: string;             // HH:mm (member-local wall clock)
  timezone: string;              // IANA — the member's timezone
  durationMinutes?: number;      // default 45
  sessionKind?: PlaybookSessionKind;      // default coach_review
  recordingEnabled?: boolean;    // default true; per-playbook OFF toggle
  repeatFrequency?: 'weekly' | 'every_2_weeks' | 'none';  // default weekly
  repeatHorizonWeeks?: number;   // 2–8, default 4
  weeklySessionCap?: number | null;       // per-playbook cap, null = uncapped
  startDate?: string;            // YYYY-MM-DD, default today (member tz)
  memberId?: string;             // default playbook.assignedMemberId
  pinnedWorkoutIds?: Record<string, string>; // date → workoutId (coach-pinned occurrences)
  // Phase B.2: per-day time + kind. When present, overrides startTime /
  // sessionKind for that day; daysOfWeek/startTime stay as the legacy shape.
  daySettings?: Array<{ dayOfWeek: number; startTime: string; sessionKind?: PlaybookSessionKind; durationMinutes?: number }>;
  // Optional idempotency key — a retry with the same ID returns the stored
  // result of the original attempt instead of booking again.
  clientRequestId?: string;
}

export const bookPlaybookSession = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');
    const db = getDb();

    const d = request.data as BookPlaybookSessionData;
    if (!d.playbookId || !Array.isArray(d.daysOfWeek) || d.daysOfWeek.length === 0 || !d.startTime || !d.timezone) {
      throw new HttpsError('invalid-argument', 'playbookId, daysOfWeek, startTime, and timezone are required');
    }
    if (d.daysOfWeek.some((x) => typeof x !== 'number' || x < 0 || x > 6)) {
      throw new HttpsError('invalid-argument', 'daysOfWeek entries must be 0-6');
    }
    if (!/^\d{2}:\d{2}$/.test(d.startTime)) {
      throw new HttpsError('invalid-argument', 'startTime must be HH:mm');
    }

    const playbookRef = db.collection('playbooks').doc(d.playbookId);
    const playbookSnap = await playbookRef.get();
    if (!playbookSnap.exists) throw new HttpsError('not-found', 'Playbook not found');
    const playbook = playbookSnap.data()!;

    const token = request.auth?.token as Record<string, any> | undefined;
    const isAdmin = token?.role === 'platformAdmin' || token?.admin === true;
    if (playbook.coachId !== callerUid && !isAdmin) {
      throw new HttpsError('permission-denied', 'This playbook does not belong to you');
    }
    const coachId = playbook.coachId as string;

    const memberId = d.memberId || playbook.assignedMemberId;
    if (!memberId) {
      throw new HttpsError('failed-precondition', 'Assign a member to this playbook before scheduling');
    }
    // Group-proofing: membership is a list from day one. Booking is valid for
    // any member of the playbook (single-member UI just has one).
    const memberIds: string[] = Array.isArray(playbook.memberIds) && playbook.memberIds.length > 0
      ? playbook.memberIds
      : (playbook.assignedMemberId ? [playbook.assignedMemberId] : []);
    if (!memberIds.includes(memberId)) {
      throw new HttpsError('failed-precondition', 'That member is not on this playbook');
    }

    const memberSnap = await db.collection('members').doc(memberId).get();
    if (!memberSnap.exists) throw new HttpsError('not-found', 'Member not found');
    if (memberSnap.data()!.coachId !== coachId) {
      throw new HttpsError('permission-denied', 'This member does not belong to this coach');
    }
    const memberName = memberSnap.data()!.name || playbook.assignedMemberName || 'Member';

    // Per-day settings (Phase B.2) — validated map dow → { startTime, kind }
    const daySettingsMap = new Map<number, { startTime: string; sessionKind: PlaybookSessionKind; durationMinutes: number | null }>();
    if (Array.isArray(d.daySettings)) {
      for (const ds of d.daySettings) {
        if (typeof ds?.dayOfWeek !== 'number' || ds.dayOfWeek < 0 || ds.dayOfWeek > 6) {
          throw new HttpsError('invalid-argument', 'daySettings dayOfWeek must be 0-6');
        }
        if (typeof ds?.startTime !== 'string' || !/^\d{2}:\d{2}$/.test(ds.startTime)) {
          throw new HttpsError('invalid-argument', 'daySettings startTime must be HH:mm');
        }
        if (ds.durationMinutes !== undefined && (typeof ds.durationMinutes !== 'number' || ds.durationMinutes < 5 || ds.durationMinutes > 240)) {
          throw new HttpsError('invalid-argument', 'daySettings durationMinutes must be 5-240');
        }
        daySettingsMap.set(ds.dayOfWeek, {
          startTime: ds.startTime,
          sessionKind: ds.sessionKind === 'coach_guided' ? 'coach_guided' : 'coach_review',
          durationMinutes: typeof ds.durationMinutes === 'number' ? Math.round(ds.durationMinutes) : null,
        });
      }
    }

    const sessionKind: PlaybookSessionKind = d.sessionKind === 'coach_guided' ? 'coach_guided' : 'coach_review';
    const recordingEnabled = d.recordingEnabled !== false;
    const durationMinutes = d.durationMinutes && d.durationMinutes > 0 && d.durationMinutes <= 240 ? d.durationMinutes : 45;
    const repeatFrequency = d.repeatFrequency === 'every_2_weeks' ? 'every_2_weeks' : d.repeatFrequency === 'none' ? 'none' : 'weekly';
    const repeatHorizonWeeks = Math.min(8, Math.max(2, Math.round(d.repeatHorizonWeeks || 4)));
    const weeklySessionCap = typeof d.weeklySessionCap === 'number' && d.weeklySessionCap > 0
      ? Math.round(d.weeklySessionCap) : null;
    const timezone = d.timezone;

    // Persist scheduling settings on the playbook (also normalizes memberIds
    // so group support later is purely additive).
    await playbookRef.update({
      schedulingEnabled: true,
      sessionKind,
      recordingEnabled,
      sessionDurationMinutes: durationMinutes,
      weeklySessionCap,
      timezone,
      scheduleDaysOfWeek: d.daysOfWeek,
      scheduleStartTime: d.startTime,
      scheduleDaySettings: Array.isArray(d.daySettings)
        ? [...daySettingsMap.entries()].map(([dayOfWeek, v]) => ({ dayOfWeek, ...v }))
        : FieldValue.delete(),
      repeatFrequency,
      repeatHorizonWeeks,
      memberIds,
      nextWorkoutIndex: typeof playbook.nextWorkoutIndex === 'number' ? playbook.nextWorkoutIndex : 0,
      updatedAt: FieldValue.serverTimestamp(),
    });

    // ── Materialize occurrences (matches the legacy generator pattern:
    // wall-clock date walk, N weeks ahead, skip past times) ────────────────
    const now = new Date();
    const todayStr = wallDateOf(now, timezone).dateStr;
    const firstDate = d.startDate && /^\d{4}-\d{2}-\d{2}$/.test(d.startDate) && d.startDate > todayStr
      ? d.startDate : todayStr;
    const horizonEnd = addDaysToDateStr(firstDate, repeatHorizonWeeks * 7);
    const stepDays = repeatFrequency === 'every_2_weeks' ? 14 : 7;

    const occurrences: Array<{ dateStr: string; startTime: string; sessionKind: PlaybookSessionKind; durationMinutes: number }> = [];
    for (const dow of [...new Set(d.daysOfWeek)].sort()) {
      const dayStart = daySettingsMap.get(dow)?.startTime || d.startTime;
      const dayKind = daySettingsMap.get(dow)?.sessionKind || sessionKind;
      const dayDuration = daySettingsMap.get(dow)?.durationMinutes || durationMinutes;
      let cursor = firstDate;
      while (wallDateOf(wallTimeToUtc(cursor, '12:00', timezone), timezone).dow !== dow) {
        cursor = addDaysToDateStr(cursor, 1);
      }
      // Same-day booking only if the start time hasn't passed yet
      if (cursor === todayStr && wallTimeToUtc(cursor, dayStart, timezone) <= now) {
        cursor = addDaysToDateStr(cursor, stepDays);
      }
      if (repeatFrequency === 'none') {
        if (cursor <= horizonEnd) occurrences.push({ dateStr: cursor, startTime: dayStart, sessionKind: dayKind, durationMinutes: dayDuration });
        continue;
      }
      while (cursor <= horizonEnd) {
        occurrences.push({ dateStr: cursor, startTime: dayStart, sessionKind: dayKind, durationMinutes: dayDuration });
        cursor = addDaysToDateStr(cursor, stepDays);
      }
    }
    occurrences.sort((a, b) => a.dateStr.localeCompare(b.dateStr));

    if (occurrences.length === 0) {
      throw new HttpsError('invalid-argument', 'No bookable occurrences in the selected window');
    }

    const memberKey = memberId; // guests book via bookViaBookingToken with `guest:<sha256(email)>`

    // Idempotency: a retry carrying the same clientRequestId returns the
    // stored result of the attempt that already ran (e.g. client timed out
    // at 45s while the server finished booking).
    const clientRequestId = validClientRequestId(d.clientRequestId);
    if (clientRequestId) {
      const prior = await claimBookingRequest(clientRequestId, {
        fn: 'bookPlaybookSession',
        coachId,
        memberKey,
        playbookId: d.playbookId,
      });
      if (prior) {
        console.log(`[bookPlaybookSession] idempotent replay for request ${clientRequestId}`);
        return prior;
      }
    }

    const results: Array<{ date: string; status: 'booked' | 'conflict' | 'cap_reached'; reason?: string; instanceId?: string }> = [];

    for (const occ of occurrences) {
      const dateStr = occ.dateStr;
      try {
        const { instanceId } = await bookOccurrence({
          playbookId: d.playbookId,
          playbook,
          coachId,
          memberKey,
          memberId,
          guestEmail: null,
          memberName,
          dateStr,
          startTime: occ.startTime,
          timezone,
          durationMinutes: occ.durationMinutes,
          sessionKind: occ.sessionKind,
          recordingEnabled,
          weeklySessionCap,
          pinnedWorkoutId: d.pinnedWorkoutIds?.[dateStr] || null,
          bookedVia: 'coach_panel',
        });
        results.push({ date: dateStr, status: 'booked', instanceId });
      } catch (err: any) {
        if (err instanceof HttpsError && err.code === 'resource-exhausted') {
          results.push({ date: dateStr, status: 'cap_reached', reason: err.message });
        } else if (err instanceof HttpsError && err.code === 'already-exists') {
          results.push({ date: dateStr, status: 'conflict', reason: err.message });
        } else if (err?.code === 6 || /already exists/i.test(err?.message || '')) {
          // Firestore ALREADY_EXISTS from txn.create() racing another booking
          results.push({ date: dateStr, status: 'conflict', reason: 'booked concurrently' });
        } else {
          if (clientRequestId) await releaseBookingRequest(clientRequestId);
          throw err;
        }
      }
    }

    const bookedCount = results.filter((r) => r.status === 'booked').length;
    await db.collection('scheduling_audit_log').add({
      coachId,
      action: 'playbook_sessions_booked',
      memberId,
      details: `Booked ${bookedCount}/${results.length} ${playbook.name || 'playbook'} sessions (${sessionKind}, ${repeatFrequency}, ${repeatHorizonWeeks}w horizon)`,
      metadata: { playbookId: d.playbookId, results },
      createdAt: FieldValue.serverTimestamp(),
    });

    console.log(`[bookPlaybookSession] ${bookedCount}/${results.length} booked for playbook ${d.playbookId} member ${memberId}`);
    const response = { success: true, bookedCount, results };
    if (clientRequestId) await storeBookingRequestResult(clientRequestId, response);
    return response;
  }
);
