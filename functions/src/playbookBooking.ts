/**
 * Playbook Booking — Phase B (3b)
 *
 * Public Calendly-style booking links for playbooks, built on the Phase A
 * transactional guard (bookOccurrence in playbookScheduling.ts).
 *
 * Collections:
 *  - booking_windows/{playbookId}: coach-defined availability — IANA timezone
 *    plus [{ dayOfWeek 0-6, startTime HH:mm, endTime HH:mm }]. Written only by
 *    createPlaybookBookingLink (Admin SDK); coach-readable via rules.
 *  - playbook_booking_tokens/{token}: 32-hex crypto-random token →
 *    { playbookId, coachId, memberId | null }. No client writes; resolver and
 *    booking run through Admin SDK, so rules never expose playbook internals.
 *
 * Title-only rule (locked product decision): every public payload carries the
 * playbook TITLE only — never workout names, workoutIds, or sequence details.
 */

import * as admin from 'firebase-admin';
import * as crypto from 'crypto';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import {
  bookOccurrence,
  memberWeekWindowUtc,
  wallTimeToUtc,
  PlaybookSessionKind,
} from './playbookScheduling';

const getDb = () => admin.firestore();
const emailApiKey = defineSecret('EMAIL_API_KEY');

const BOOKING_HORIZON_DAYS = 21;
const BLOCKING_OR_DONE = ['scheduled', 'allocated', 'in_progress', 'skip_requested', 'allocation_failed', 'completed'];
const ICS_URL = 'https://us-central1-goarrive.cloudfunctions.net/playbookBookingIcs';
const SESSIONS_URL = 'https://goarrive.fit/my-sessions';

interface BookingWindow {
  days: number[];      // 0 (Sun) – 6 (Sat), one or more
  startTime: string;   // HH:mm
  endTime: string;     // HH:mm
}

/** Accept both the legacy single-day shape ({ dayOfWeek }) and the new multi-day shape ({ days }). */
function windowDays(w: any): number[] {
  if (Array.isArray(w?.days)) return w.days.filter((d: any) => Number.isInteger(d) && d >= 0 && d <= 6);
  return Number.isInteger(w?.dayOfWeek) ? [w.dayOfWeek] : [];
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function guestMemberKey(email: string): string {
  return `guest:${crypto.createHash('sha256').update(email).digest('hex')}`;
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return null;
  return email;
}

function validateWindows(raw: unknown): BookingWindow[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 21) {
    throw new HttpsError('invalid-argument', 'Provide 1-21 booking windows');
  }
  return raw.map((w: any) => {
    const days = [...new Set(windowDays(w))].sort();
    if (days.length === 0 || days.length > 7) {
      throw new HttpsError('invalid-argument', 'each window needs 1-7 days (0-6)');
    }
    if (typeof w?.startTime !== 'string' || !HHMM.test(w.startTime)
      || typeof w?.endTime !== 'string' || !HHMM.test(w.endTime)) {
      throw new HttpsError('invalid-argument', 'window times must be HH:mm');
    }
    if (minutesOf(w.endTime) <= minutesOf(w.startTime)) {
      throw new HttpsError('invalid-argument', 'window endTime must be after startTime');
    }
    return { days, startTime: w.startTime, endTime: w.endTime };
  });
}

function validateLocations(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.length > 10) {
    throw new HttpsError('invalid-argument', 'Provide at most 10 locations');
  }
  const out: string[] = [];
  for (const l of raw) {
    if (typeof l !== 'string') throw new HttpsError('invalid-argument', 'locations must be strings');
    const v = l.trim().slice(0, 80);
    if (v) out.push(v);
  }
  return [...new Set(out)];
}

async function loadActiveToken(token: string) {
  if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) {
    throw new HttpsError('invalid-argument', 'Invalid booking link');
  }
  const snap = await getDb().collection('playbook_booking_tokens').doc(token).get();
  if (!snap.exists) throw new HttpsError('not-found', 'This booking link is no longer available');
  const data = snap.data()!;
  if (data.revokedAt) throw new HttpsError('permission-denied', 'This booking link has been revoked');
  return data as { playbookId: string; coachId: string; memberId: string | null };
}

function dateStrsAhead(timezone: string, days: number): Array<{ dateStr: string; dow: number }> {
  const out: Array<{ dateStr: string; dow: number }> = [];
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
    const parts: Record<string, string> = {};
    for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
    const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
    if (out.length && out[out.length - 1].dateStr === dateStr) continue; // DST edge dedupe
    out.push({ dateStr, dow: dowMap[parts.weekday] ?? 0 });
  }
  return out;
}

// ── createPlaybookBookingLink (coach) ───────────────────────────────────────

export const createPlaybookBookingLink = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in');
    const db = getDb();
    const callerToken = request.auth.token as Record<string, any>;
    const coachId = (callerToken.coachId as string) || request.auth.uid;
    const isAdmin = callerToken.role === 'platformAdmin' || !!callerToken.admin;

    const { playbookId, windows, timezone, locations } = request.data as {
      playbookId: string; windows: unknown; timezone: string; locations?: unknown;
    };
    if (!playbookId) throw new HttpsError('invalid-argument', 'playbookId is required');
    if (typeof timezone !== 'string' || !timezone) {
      throw new HttpsError('invalid-argument', 'timezone is required');
    }
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      throw new HttpsError('invalid-argument', 'timezone must be a valid IANA timezone');
    }
    const validated = validateWindows(windows);
    const validatedLocations = validateLocations(locations);

    const playbookSnap = await db.collection('playbooks').doc(playbookId).get();
    if (!playbookSnap.exists) throw new HttpsError('not-found', 'Playbook not found');
    const playbook = playbookSnap.data()!;
    if (playbook.coachId !== coachId && !isAdmin) {
      throw new HttpsError('permission-denied', 'This playbook does not belong to you');
    }

    await db.collection('booking_windows').doc(playbookId).set({
      playbookId,
      coachId: playbook.coachId,
      timezone,
      windows: validated,
      locations: validatedLocations,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const existing = await db.collection('playbook_booking_tokens')
      .where('playbookId', '==', playbookId)
      .where('revokedAt', '==', null)
      .limit(1)
      .get();

    if (!existing.empty) {
      return { token: existing.docs[0].id, alreadyExists: true };
    }

    const token = crypto.randomBytes(16).toString('hex');
    await db.collection('playbook_booking_tokens').doc(token).set({
      playbookId,
      coachId: playbook.coachId,
      memberId: playbook.assignedMemberId || null,
      revokedAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { token, alreadyExists: false };
  }
);

// ── resolvePlaybookBookingToken (public, Admin SDK projection) ──────────────

export const resolvePlaybookBookingToken = onRequest(
  { cors: true, region: 'us-central1' },
  async (req, res) => {
    try {
      const token = (req.query.token as string) || (req.body?.token as string);
      const tokenData = await loadActiveToken(token);
      const db = getDb();

      const [playbookSnap, windowsSnap] = await Promise.all([
        db.collection('playbooks').doc(tokenData.playbookId).get(),
        db.collection('booking_windows').doc(tokenData.playbookId).get(),
      ]);
      if (!playbookSnap.exists) {
        res.status(404).json({ error: 'This playbook no longer exists.' });
        return;
      }
      const playbook = playbookSnap.data()!;
      if (!windowsSnap.exists) {
        res.status(409).json({ error: 'The coach has not opened booking for this playbook yet.' });
        return;
      }
      const windowsDoc = windowsSnap.data() as { timezone: string; windows: BookingWindow[]; locations?: string[] };
      const timezone = windowsDoc.timezone;
      const locations = Array.isArray(windowsDoc.locations) ? windowsDoc.locations : [];
      const durationMinutes = playbook.sessionDurationMinutes || 45;
      const weeklySessionCap: number | null =
        typeof playbook.weeklySessionCap === 'number' && playbook.weeklySessionCap > 0
          ? playbook.weeklySessionCap : null;

      let coachName: string | null = null;
      try {
        const coachSnap = await db.collection('coaches').doc(tokenData.coachId).get();
        const c = coachSnap.data() || {};
        coachName = c.displayName || c.name || null;
      } catch { /* branding only — never block booking on it */ }

      // Optional identity for slot subtraction + cap state: signed-in member
      // token, or guest email passed back after entry.
      const guestEmail = normalizeEmail(req.query.guestEmail || req.body?.guestEmail);
      const memberId = tokenData.memberId;
      const memberKey = guestEmail ? guestMemberKey(guestEmail) : memberId;

      const now = new Date();
      const days = dateStrsAhead(timezone, BOOKING_HORIZON_DAYS);
      const horizonEndUtc = new Date(now.getTime() + (BOOKING_HORIZON_DAYS + 2) * 24 * 60 * 60 * 1000);

      // Existing reservations for this member/guest (any playbook) — busy windows.
      const busy: Array<{ start: number; end: number }> = [];
      if (memberKey) {
        const resSnap = await db.collection('member_time_reservations')
          .where('memberKey', '==', memberKey)
          .where('startUtc', '>', Timestamp.fromMillis(now.getTime() - 4 * 60 * 60 * 1000))
          .where('startUtc', '<', Timestamp.fromDate(horizonEndUtc))
          .get();
        for (const doc of resSnap.docs) {
          const r = doc.data();
          busy.push({ start: (r.startUtc as Timestamp).toMillis(), end: (r.endUtc as Timestamp).toMillis() });
        }
      }

      // Per-week booked counts toward this playbook's cap.
      const weekCounts = new Map<number, number>();
      if (memberKey && weeklySessionCap !== null) {
        const { weekStartUtc } = memberWeekWindowUtc(now, timezone);
        const base = db.collection('session_instances')
          .where('playbookId', '==', tokenData.playbookId);
        const capQuery = guestEmail
          ? base.where('memberKey', '==', memberKey)
          : base.where('memberId', '==', memberId);
        const instSnap = await capQuery
          .where('startUtc', '>=', Timestamp.fromDate(weekStartUtc))
          .where('startUtc', '<', Timestamp.fromDate(horizonEndUtc))
          .get();
        for (const doc of instSnap.docs) {
          const inst = doc.data();
          if (!BLOCKING_OR_DONE.includes(inst.status)) continue;
          const instStart = (inst.startUtc as Timestamp).toDate();
          const wk = memberWeekWindowUtc(instStart, timezone).weekStartUtc.getTime();
          weekCounts.set(wk, (weekCounts.get(wk) || 0) + 1);
        }
      }

      const slots: Array<{ date: string; startTime: string; startUtcMillis: number; capReached: boolean }> = [];
      for (const { dateStr, dow } of days) {
        for (const w of windowsDoc.windows) {
          if (!windowDays(w).includes(dow)) continue;
          const startMin = minutesOf(w.startTime);
          const endMin = minutesOf(w.endTime);
          for (let m = startMin; m + durationMinutes <= endMin; m += durationMinutes) {
            const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
            const startUtc = wallTimeToUtc(dateStr, hhmm, timezone);
            if (startUtc.getTime() <= now.getTime()) continue;
            const endUtcMs = startUtc.getTime() + durationMinutes * 60 * 1000;
            if (busy.some((b) => b.start < endUtcMs && b.end > startUtc.getTime())) continue;
            const wk = memberWeekWindowUtc(startUtc, timezone).weekStartUtc.getTime();
            const capReached = weeklySessionCap !== null && (weekCounts.get(wk) || 0) >= weeklySessionCap;
            slots.push({ date: dateStr, startTime: hhmm, startUtcMillis: startUtc.getTime(), capReached });
          }
        }
      }
      slots.sort((a, b) => a.startUtcMillis - b.startUtcMillis);

      const currentWeekStart = memberWeekWindowUtc(now, timezone).weekStartUtc.getTime();
      const bookedThisWeek = weekCounts.get(currentWeekStart) || 0;

      let memberName: string | null = null;
      if (memberId) {
        try {
          const memberSnap = await db.collection('members').doc(memberId).get();
          const full = (memberSnap.data()?.name as string) || '';
          memberName = full ? full.split(' ')[0] : null; // first name only on a public page
        } catch { /* non-blocking */ }
      }

      // Title-only projection — no workoutIds, workout names, or member docs.
      res.json({
        playbookTitle: playbook.name || 'Playbook',
        playbookDescription: (typeof playbook.description === 'string' && playbook.description.trim()) || null,
        coachId: tokenData.coachId,
        coachName,
        memberName,
        guestMode: !memberId,
        sessionKind: (playbook.sessionKind === 'coach_guided' ? 'coach_guided' : 'coach_review') as PlaybookSessionKind,
        durationMinutes,
        timezone,
        weeklySessionCap,
        capState: weeklySessionCap !== null && memberKey
          ? { booked: bookedThisWeek, cap: weeklySessionCap }
          : null,
        locations,
        slots,
      });
    } catch (err: any) {
      if (err instanceof HttpsError) {
        const status = err.code === 'not-found' ? 404 : err.code === 'permission-denied' ? 410 : 400;
        res.status(status).json({ error: err.message });
        return;
      }
      console.error('[resolvePlaybookBookingToken] error:', err);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  }
);

// ── bookViaBookingToken (public — signed-in member OR guest by email) ───────

export const bookViaBookingToken = onCall(
  { region: 'us-central1', invoker: 'public', secrets: [emailApiKey] },
  async (request) => {
    const db = getDb();
    const { token, date, startTime, guestEmail: rawGuestEmail, location: rawLocation } = request.data as {
      token: string; date: string; startTime: string; guestEmail?: string; location?: string;
    };
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new HttpsError('invalid-argument', 'date must be YYYY-MM-DD');
    }
    if (!startTime || !HHMM.test(startTime)) {
      throw new HttpsError('invalid-argument', 'startTime must be HH:mm');
    }

    const tokenData = await loadActiveToken(token);

    const [playbookSnap, windowsSnap] = await Promise.all([
      db.collection('playbooks').doc(tokenData.playbookId).get(),
      db.collection('booking_windows').doc(tokenData.playbookId).get(),
    ]);
    if (!playbookSnap.exists) throw new HttpsError('not-found', 'This playbook no longer exists');
    if (!windowsSnap.exists) throw new HttpsError('failed-precondition', 'Booking is not open for this playbook');
    const playbook = playbookSnap.data()!;
    const windowsDoc = windowsSnap.data() as { timezone: string; windows: BookingWindow[]; locations?: string[] };
    const timezone = windowsDoc.timezone;
    const durationMinutes = playbook.sessionDurationMinutes || 45;

    const definedLocations = Array.isArray(windowsDoc.locations) ? windowsDoc.locations : [];
    let location: string | null = null;
    if (definedLocations.length > 0) {
      if (typeof rawLocation !== 'string' || !definedLocations.includes(rawLocation.trim())) {
        throw new HttpsError('invalid-argument', 'Pick a location for this session');
      }
      location = rawLocation.trim();
    }

    // Server-side slot validation: the requested time must sit inside a coach
    // window, on the duration grid — the public page is never trusted.
    const startUtc = wallTimeToUtc(date, startTime, timezone);
    if (startUtc.getTime() <= Date.now()) {
      throw new HttpsError('invalid-argument', 'That time is in the past');
    }
    if (startUtc.getTime() > Date.now() + (BOOKING_HORIZON_DAYS + 2) * 24 * 60 * 60 * 1000) {
      throw new HttpsError('invalid-argument', 'That date is beyond the booking window');
    }
    const dowFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'short' });
    const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const slotDow = dowMap[dowFmt.format(wallTimeToUtc(date, '12:00', timezone))] ?? -1;
    const startMin = minutesOf(startTime);
    const inWindow = windowsDoc.windows.some((w) =>
      windowDays(w).includes(slotDow)
      && startMin >= minutesOf(w.startTime)
      && startMin + durationMinutes <= minutesOf(w.endTime)
      && (startMin - minutesOf(w.startTime)) % durationMinutes === 0
    );
    if (!inWindow) {
      throw new HttpsError('invalid-argument', 'That time is not an available slot');
    }

    // Identity: signed-in member on this playbook books as themselves;
    // everyone else books as a guest by email. Guests are never blocked —
    // the page just encourages account creation after booking.
    const authUid = request.auth?.uid || null;
    const memberIds: string[] = Array.isArray(playbook.memberIds) && playbook.memberIds.length > 0
      ? playbook.memberIds
      : (playbook.assignedMemberId ? [playbook.assignedMemberId] : []);

    let memberId: string | null = null;
    let memberKey: string;
    let memberName: string;
    let guestEmail: string | null = null;
    let bookerEmail: string | null = null;

    // Coach preview booking (Phase B.2 testing behavior): the playbook's own
    // coach (or an admin) books on behalf of the assigned member.
    const callerClaims = (request.auth?.token || {}) as Record<string, any>;
    const callerIsCoach = !!authUid && (
      authUid === tokenData.coachId
      || callerClaims.coachId === tokenData.coachId
      || callerClaims.role === 'platformAdmin' || callerClaims.admin === true
    );
    const onBehalfMemberId = tokenData.memberId || memberIds[0] || null;

    if (authUid && (authUid === tokenData.memberId || memberIds.includes(authUid))) {
      memberId = authUid;
      memberKey = authUid;
      const memberSnap = await db.collection('members').doc(memberId).get();
      memberName = (memberSnap.data()?.name as string) || playbook.assignedMemberName || 'Member';
      bookerEmail = normalizeEmail(memberSnap.data()?.email) || normalizeEmail(request.auth?.token?.email);
    } else if (callerIsCoach && onBehalfMemberId) {
      memberId = onBehalfMemberId;
      memberKey = onBehalfMemberId;
      const memberSnap = await db.collection('members').doc(memberId).get();
      memberName = (memberSnap.data()?.name as string) || playbook.assignedMemberName || 'Member';
      bookerEmail = normalizeEmail(memberSnap.data()?.email);
    } else {
      guestEmail = normalizeEmail(rawGuestEmail);
      if (!guestEmail) {
        throw new HttpsError('invalid-argument', 'Enter a valid email to book');
      }
      memberKey = guestMemberKey(guestEmail);
      memberName = guestEmail.split('@')[0];
      bookerEmail = guestEmail;
    }

    const weeklySessionCap: number | null =
      typeof playbook.weeklySessionCap === 'number' && playbook.weeklySessionCap > 0
        ? playbook.weeklySessionCap : null;

    const { instanceId } = await bookOccurrence({
      playbookId: tokenData.playbookId,
      playbook,
      coachId: tokenData.coachId,
      memberKey,
      memberId,
      guestEmail,
      memberName,
      dateStr: date,
      startTime,
      timezone,
      durationMinutes,
      sessionKind: playbook.sessionKind === 'coach_guided' ? 'coach_guided' : 'coach_review',
      recordingEnabled: playbook.recordingEnabled !== false,
      weeklySessionCap,
      bookedVia: 'booking_link',
      location,
    });

    await db.collection('scheduling_audit_log').add({
      coachId: tokenData.coachId,
      action: 'playbook_session_booked_via_link',
      memberId,
      details: `${guestEmail ? `Guest ${guestEmail}` : memberName} booked ${playbook.name || 'playbook'} session ${date} ${startTime}${location ? ` at ${location}` : ''} via booking link`,
      metadata: { playbookId: tokenData.playbookId, instanceId, guest: !!guestEmail },
      createdAt: FieldValue.serverTimestamp(),
    });

    // Calendar + email confirmation (never blocks the booking itself)
    let coachFirstName = 'your coach';
    try {
      const coachSnap = await db.collection('coaches').doc(tokenData.coachId).get();
      const full = (coachSnap.data()?.displayName as string) || (coachSnap.data()?.name as string) || '';
      if (full) coachFirstName = full.split(' ')[0];
    } catch { /* branding only */ }

    const startUtc2 = wallTimeToUtc(date, startTime, timezone);
    const endUtc2 = new Date(startUtc2.getTime() + durationMinutes * 60 * 1000);
    const eventTitle = `Session with ${coachFirstName} — ${playbook.name || 'Playbook'}`;
    const icsUrl = `${ICS_URL}?token=${token}&instance=${instanceId}`;
    const googleCalUrl = 'https://calendar.google.com/calendar/render?action=TEMPLATE'
      + `&text=${encodeURIComponent(eventTitle)}`
      + `&dates=${icsUtcStamp(startUtc2)}/${icsUtcStamp(endUtc2)}`
      + `&location=${encodeURIComponent(SESSIONS_URL)}`
      + `&details=${encodeURIComponent(`Booked via GoArrive.${location ? ` Location: ${location}.` : ''} Your Zoom join link appears in ${SESSIONS_URL} once the session room is ready.`)}`;

    if (bookerEmail) {
      try {
        // Lazy import — notifications.ts touches Firestore at module load, so
        // it must not be pulled in before index.ts runs admin.initializeApp().
        const { sendNotification } = await import('./notifications');
        const whenLine = `${friendlyIcsDate(date)} at ${startTime} (${timezone}) · ${durationMinutes} min`;
        await sendNotification({
          messageType: 'booking_confirmation',
          channel: 'email',
          recipient: {
            uid: memberId || memberKey,
            email: bookerEmail,
            displayName: memberName,
            role: 'member',
          },
          subject: `You're booked — ${playbook.name || 'Playbook'} on ${friendlyIcsDate(date)}`,
          body: `${eventTitle}\n${whenLine}${location ? `\nLocation: ${location}` : ''}\n\nAdd to calendar: ${icsUrl}\nGoogle Calendar: ${googleCalUrl}\n\nYour Zoom join link will appear at ${SESSIONS_URL} once the session room is ready.`,
          htmlBody: `<h2>${eventTitle}</h2>`
            + `<p>${whenLine}</p>`
            + (location ? `<p><strong>Location:</strong> ${location}</p>` : '')
            + `<p><a href="${icsUrl}">Add to calendar (.ics)</a> · <a href="${googleCalUrl}">Add to Google Calendar</a></p>`
            + `<p>Your Zoom join link will appear in <a href="${SESSIONS_URL}">My Sessions</a> once the session room is ready.</p>`,
          sessionInstanceId: instanceId,
          coachId: tokenData.coachId,
          memberId: memberId || undefined,
        });
      } catch (err: any) {
        console.error(`[bookViaBookingToken] confirmation email failed for ${instanceId}: ${err.message}`);
      }
    }

    return {
      success: true,
      instanceId,
      date,
      startTime,
      timezone,
      guest: !!guestEmail,
      encourageAccount: !!guestEmail,
      location,
      eventTitle,
      startUtcMillis: startUtc2.getTime(),
      endUtcMillis: endUtc2.getTime(),
      icsUrl,
      googleCalUrl,
      confirmationEmailSent: !!bookerEmail,
    };
  }
);

// ── Calendar helpers + public .ics endpoint ─────────────────────────────────

function icsUtcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function friendlyIcsDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/**
 * Serves a downloadable .ics for a booked session. Auth = the unguessable
 * booking token + the instance must belong to that token's playbook.
 * LOCATION = the session's Zoom join link when allocated, else the member
 * sessions page (locked decision: calendar LOCATION carries the join link).
 */
export const playbookBookingIcs = onRequest(
  { cors: true, region: 'us-central1' },
  async (req, res) => {
    try {
      const token = (req.query.token as string) || '';
      const instanceId = (req.query.instance as string) || '';
      const tokenData = await loadActiveToken(token);
      if (!instanceId || !/^[A-Za-z0-9]{1,40}$/.test(instanceId)) {
        res.status(400).json({ error: 'Invalid instance' });
        return;
      }
      const instSnap = await getDb().collection('session_instances').doc(instanceId).get();
      if (!instSnap.exists || instSnap.data()!.playbookId !== tokenData.playbookId) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const inst = instSnap.data()!;

      let coachFirstName = 'your coach';
      try {
        const coachSnap = await getDb().collection('coaches').doc(tokenData.coachId).get();
        const full = (coachSnap.data()?.displayName as string) || (coachSnap.data()?.name as string) || '';
        if (full) coachFirstName = full.split(' ')[0];
      } catch { /* branding only */ }

      const startUtc = (inst.startUtc as Timestamp).toDate();
      const endUtc = (inst.endUtc as Timestamp).toDate();
      const title = `Session with ${coachFirstName} — ${inst.playbookTitle || 'Playbook'}`;
      const locationField = inst.zoomJoinUrl || SESSIONS_URL;
      const description = `${inst.location ? `Location: ${inst.location}\n` : ''}`
        + (inst.zoomJoinUrl ? `Join: ${inst.zoomJoinUrl}` : `Your Zoom join link will appear at ${SESSIONS_URL} once the session room is ready.`);

      const ics = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//GoArrive//Playbook Booking//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'BEGIN:VEVENT',
        `UID:${instanceId}@goarrive.fit`,
        `DTSTAMP:${icsUtcStamp(new Date())}`,
        `DTSTART:${icsUtcStamp(startUtc)}`,
        `DTEND:${icsUtcStamp(endUtc)}`,
        `SUMMARY:${icsEscape(title)}`,
        `LOCATION:${icsEscape(locationField)}`,
        `DESCRIPTION:${icsEscape(description)}`,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');

      res.set('Content-Type', 'text/calendar; charset=utf-8');
      res.set('Content-Disposition', 'attachment; filename="goarrive-session.ics"');
      res.status(200).send(ics);
    } catch (err: any) {
      if (err instanceof HttpsError) {
        res.status(err.code === 'not-found' ? 404 : 400).json({ error: err.message });
        return;
      }
      console.error('[playbookBookingIcs] error:', err);
      res.status(500).json({ error: 'Something went wrong.' });
    }
  }
);
