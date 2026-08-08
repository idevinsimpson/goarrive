"use strict";
/**
 * Playbook Booking — Phase B (3b)
 *
 * Public Calendly-style booking links for playbooks, built on the Phase A
 * transactional guard (bookOccurrence in playbookScheduling.ts).
 *
 * Collections:
 *  - booking_windows/{playbookId}: coach-defined availability — IANA timezone
 *    plus [{ dayOfWeek 0-6, startTime HH:mm, endTime HH:mm }] and optional
 *    dateOverrides [{ date YYYY-MM-DD, intervals: [{ start, end }] }] that
 *    REPLACE the weekly pattern on that calendar date (empty intervals = the
 *    date is fully unavailable). Written only by createPlaybookBookingLink
 *    (Admin SDK); coach-readable via rules.
 *  - playbook_booking_tokens/{token}: 32-hex crypto-random token →
 *    { playbookId, coachId, memberId | null }. No client writes; resolver and
 *    booking run through Admin SDK, so rules never expose playbook internals.
 *
 * Title-only rule (locked product decision): every public payload carries the
 * playbook TITLE only — never workout names, workoutIds, or sequence details.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSessionWorkout = exports.getPlaybookRescheduleSlots = exports.playbookBookingIcs = exports.bookViaBookingToken = exports.resolvePlaybookBookingToken = exports.revokePlaybookBookingLink = exports.createPlaybookBookingLink = void 0;
const admin = __importStar(require("firebase-admin"));
const crypto = __importStar(require("crypto"));
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const firestore_1 = require("firebase-admin/firestore");
const playbookScheduling_1 = require("./playbookScheduling");
const getDb = () => admin.firestore();
const emailApiKey = (0, params_1.defineSecret)('EMAIL_API_KEY');
const BOOKING_HORIZON_DAYS = 21;
const BLOCKING_OR_DONE = ['scheduled', 'allocated', 'in_progress', 'skip_requested', 'allocation_failed', 'completed'];
const ICS_URL = 'https://us-central1-goarrive.cloudfunctions.net/playbookBookingIcs';
const SESSIONS_URL = 'https://goarrive.fit/my-sessions';
/** Accept both the legacy single-day shape ({ dayOfWeek }) and the new multi-day shape ({ days }). */
function windowDays(w) {
    if (Array.isArray(w === null || w === void 0 ? void 0 : w.days))
        return w.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    return Number.isInteger(w === null || w === void 0 ? void 0 : w.dayOfWeek) ? [w.dayOfWeek] : [];
}
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function minutesOf(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}
function guestMemberKey(email) {
    return `guest:${crypto.createHash('sha256').update(email).digest('hex')}`;
}
function normalizeEmail(raw) {
    if (typeof raw !== 'string')
        return null;
    const email = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254)
        return null;
    return email;
}
function validateWindows(raw) {
    // Weekly-hours UI writes one window per day-interval: 7 days × up to 6
    // intervals each.
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 42) {
        throw new https_1.HttpsError('invalid-argument', 'Provide 1-42 booking windows');
    }
    return raw.map((w) => {
        const days = [...new Set(windowDays(w))].sort();
        if (days.length === 0 || days.length > 7) {
            throw new https_1.HttpsError('invalid-argument', 'each window needs 1-7 days (0-6)');
        }
        if (typeof (w === null || w === void 0 ? void 0 : w.startTime) !== 'string' || !HHMM.test(w.startTime)
            || typeof (w === null || w === void 0 ? void 0 : w.endTime) !== 'string' || !HHMM.test(w.endTime)) {
            throw new https_1.HttpsError('invalid-argument', 'window times must be HH:mm');
        }
        if (minutesOf(w.endTime) <= minutesOf(w.startTime)) {
            throw new https_1.HttpsError('invalid-argument', 'window endTime must be after startTime');
        }
        return { days, startTime: w.startTime, endTime: w.endTime };
    });
}
const YMD = /^\d{4}-\d{2}-\d{2}$/;
function validateDateOverrides(raw) {
    var _a;
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw) || raw.length > 90) {
        throw new https_1.HttpsError('invalid-argument', 'Provide at most 90 date-specific overrides');
    }
    const byDate = new Map();
    for (const o of raw) {
        if (typeof (o === null || o === void 0 ? void 0 : o.date) !== 'string' || !YMD.test(o.date)) {
            throw new https_1.HttpsError('invalid-argument', 'override date must be YYYY-MM-DD');
        }
        const rawIntervals = (_a = o === null || o === void 0 ? void 0 : o.intervals) !== null && _a !== void 0 ? _a : [];
        if (!Array.isArray(rawIntervals) || rawIntervals.length > 6) {
            throw new https_1.HttpsError('invalid-argument', 'each override allows 0-6 intervals');
        }
        const intervals = rawIntervals.map((iv) => {
            if (typeof (iv === null || iv === void 0 ? void 0 : iv.start) !== 'string' || !HHMM.test(iv.start)
                || typeof (iv === null || iv === void 0 ? void 0 : iv.end) !== 'string' || !HHMM.test(iv.end)) {
                throw new https_1.HttpsError('invalid-argument', 'override times must be HH:mm');
            }
            if (minutesOf(iv.end) <= minutesOf(iv.start)) {
                throw new https_1.HttpsError('invalid-argument', 'override end must be after start');
            }
            return { start: iv.start, end: iv.end };
        }).sort((a, b) => a.start.localeCompare(b.start));
        byDate.set(o.date, { date: o.date, intervals });
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}
function overrideMap(doc) {
    const map = new Map();
    for (const o of doc.dateOverrides || []) {
        if (typeof (o === null || o === void 0 ? void 0 : o.date) === 'string' && Array.isArray(o === null || o === void 0 ? void 0 : o.intervals))
            map.set(o.date, o.intervals);
    }
    return map;
}
function validateLocations(raw) {
    if (raw === undefined || raw === null)
        return [];
    if (!Array.isArray(raw) || raw.length > 10) {
        throw new https_1.HttpsError('invalid-argument', 'Provide at most 10 locations');
    }
    const out = [];
    for (const l of raw) {
        if (typeof l !== 'string')
            throw new https_1.HttpsError('invalid-argument', 'locations must be strings');
        const v = l.trim().slice(0, 80);
        if (v)
            out.push(v);
    }
    return [...new Set(out)];
}
async function loadActiveToken(token) {
    if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid booking link');
    }
    const snap = await getDb().collection('playbook_booking_tokens').doc(token).get();
    if (!snap.exists)
        throw new https_1.HttpsError('not-found', 'This booking link is no longer available');
    const data = snap.data();
    if (data.revokedAt)
        throw new https_1.HttpsError('permission-denied', 'This booking link has been revoked');
    return data;
}
function dateStrsAhead(timezone, days) {
    var _a;
    const out = [];
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
    });
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    for (let i = 0; i < days; i++) {
        const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
        const parts = {};
        for (const p of fmt.formatToParts(d))
            parts[p.type] = p.value;
        const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
        if (out.length && out[out.length - 1].dateStr === dateStr)
            continue; // DST edge dedupe
        out.push({ dateStr, dow: (_a = dowMap[parts.weekday]) !== null && _a !== void 0 ? _a : 0 });
    }
    return out;
}
/**
 * Shared slot computation for the public booking resolver and the member
 * session-page reschedule picker. Expands coach windows over the horizon,
 * subtracts the member's busy reservations, and flags weekly-cap-reached
 * slots. `excludeInstanceId` lets a reschedule ignore the session being
 * moved (its own reservation must not block, and it must not count toward
 * the weekly cap it already occupies).
 */
async function computeMemberSlots(opts) {
    const db = getDb();
    const { playbookId, playbook, windowsDoc, memberKey, memberId, guestEmail, excludeInstanceId } = opts;
    const timezone = windowsDoc.timezone;
    const overrides = overrideMap(windowsDoc);
    const durationMinutes = playbook.sessionDurationMinutes || 45;
    const weeklySessionCap = typeof playbook.weeklySessionCap === 'number' && playbook.weeklySessionCap > 0
        ? playbook.weeklySessionCap : null;
    const now = new Date();
    const days = dateStrsAhead(timezone, BOOKING_HORIZON_DAYS);
    const horizonEndUtc = new Date(now.getTime() + (BOOKING_HORIZON_DAYS + 2) * 24 * 60 * 60 * 1000);
    // Existing reservations for this member/guest (any playbook) — busy windows.
    const busy = [];
    if (memberKey) {
        const resSnap = await db.collection('member_time_reservations')
            .where('memberKey', '==', memberKey)
            .where('startUtc', '>', firestore_1.Timestamp.fromMillis(now.getTime() - 4 * 60 * 60 * 1000))
            .where('startUtc', '<', firestore_1.Timestamp.fromDate(horizonEndUtc))
            .get();
        for (const doc of resSnap.docs) {
            const r = doc.data();
            if (excludeInstanceId && r.sessionInstanceId === excludeInstanceId)
                continue;
            busy.push({ start: r.startUtc.toMillis(), end: r.endUtc.toMillis() });
        }
    }
    // Per-week booked counts toward this playbook's cap.
    const weekCounts = new Map();
    if (memberKey && weeklySessionCap !== null) {
        const { weekStartUtc } = (0, playbookScheduling_1.memberWeekWindowUtc)(now, timezone);
        const base = db.collection('session_instances')
            .where('playbookId', '==', playbookId);
        const capQuery = guestEmail
            ? base.where('memberKey', '==', memberKey)
            : base.where('memberId', '==', memberId);
        const instSnap = await capQuery
            .where('startUtc', '>=', firestore_1.Timestamp.fromDate(weekStartUtc))
            .where('startUtc', '<', firestore_1.Timestamp.fromDate(horizonEndUtc))
            .get();
        for (const doc of instSnap.docs) {
            if (excludeInstanceId && doc.id === excludeInstanceId)
                continue;
            const inst = doc.data();
            if (!BLOCKING_OR_DONE.includes(inst.status))
                continue;
            const instStart = inst.startUtc.toDate();
            const wk = (0, playbookScheduling_1.memberWeekWindowUtc)(instStart, timezone).weekStartUtc.getTime();
            weekCounts.set(wk, (weekCounts.get(wk) || 0) + 1);
        }
    }
    const slots = [];
    // Multiple windows may cover the same day (weekly-hours UI writes one
    // window per day-interval); dedupe identical date+time slots.
    const seenSlots = new Set();
    for (const { dateStr, dow } of days) {
        // Date-specific override REPLACES the weekly pattern for that date;
        // zero override intervals = the whole date is unavailable.
        const ov = overrides.get(dateStr);
        const intervals = ov !== undefined
            ? ov
            : windowsDoc.windows
                .filter((w) => windowDays(w).includes(dow))
                .map((w) => ({ start: w.startTime, end: w.endTime }));
        for (const iv of intervals) {
            const startMin = minutesOf(iv.start);
            const endMin = minutesOf(iv.end);
            for (let m = startMin; m + durationMinutes <= endMin; m += durationMinutes) {
                const hhmm = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
                const startUtc = (0, playbookScheduling_1.wallTimeToUtc)(dateStr, hhmm, timezone);
                if (startUtc.getTime() <= now.getTime())
                    continue;
                const endUtcMs = startUtc.getTime() + durationMinutes * 60 * 1000;
                if (busy.some((b) => b.start < endUtcMs && b.end > startUtc.getTime()))
                    continue;
                const slotKey = `${dateStr}_${hhmm}`;
                if (seenSlots.has(slotKey))
                    continue;
                seenSlots.add(slotKey);
                const wk = (0, playbookScheduling_1.memberWeekWindowUtc)(startUtc, timezone).weekStartUtc.getTime();
                const capReached = weeklySessionCap !== null && (weekCounts.get(wk) || 0) >= weeklySessionCap;
                slots.push({ date: dateStr, startTime: hhmm, startUtcMillis: startUtc.getTime(), capReached });
            }
        }
    }
    slots.sort((a, b) => a.startUtcMillis - b.startUtcMillis);
    const currentWeekStart = (0, playbookScheduling_1.memberWeekWindowUtc)(now, timezone).weekStartUtc.getTime();
    const bookedThisWeek = weekCounts.get(currentWeekStart) || 0;
    return { slots, bookedThisWeek, weeklySessionCap, durationMinutes };
}
// ── createPlaybookBookingLink (coach) ───────────────────────────────────────
exports.createPlaybookBookingLink = (0, https_1.onCall)({ region: 'us-central1', invoker: 'public' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const db = getDb();
    const callerToken = request.auth.token;
    const coachId = callerToken.coachId || request.auth.uid;
    const isAdmin = callerToken.role === 'platformAdmin' || !!callerToken.admin;
    const { playbookId, windows, timezone, locations, dateOverrides, saveOnly } = request.data;
    if (!playbookId)
        throw new https_1.HttpsError('invalid-argument', 'playbookId is required');
    if (typeof timezone !== 'string' || !timezone) {
        throw new https_1.HttpsError('invalid-argument', 'timezone is required');
    }
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    }
    catch (_a) {
        throw new https_1.HttpsError('invalid-argument', 'timezone must be a valid IANA timezone');
    }
    const validated = validateWindows(windows);
    const validatedLocations = validateLocations(locations);
    const validatedOverrides = validateDateOverrides(dateOverrides);
    const playbookSnap = await db.collection('playbooks').doc(playbookId).get();
    if (!playbookSnap.exists)
        throw new https_1.HttpsError('not-found', 'Playbook not found');
    const playbook = playbookSnap.data();
    if (playbook.coachId !== coachId && !isAdmin) {
        throw new https_1.HttpsError('permission-denied', 'This playbook does not belong to you');
    }
    await db.collection('booking_windows').doc(playbookId).set({
        playbookId,
        coachId: playbook.coachId,
        timezone,
        windows: validated,
        locations: validatedLocations,
        dateOverrides: validatedOverrides,
        updatedAt: firestore_1.FieldValue.serverTimestamp(),
    });
    const existing = await db.collection('playbook_booking_tokens')
        .where('playbookId', '==', playbookId)
        .where('revokedAt', '==', null)
        .limit(1)
        .get();
    if (!existing.empty) {
        return { token: existing.docs[0].id, alreadyExists: true };
    }
    // saveOnly: persist availability without minting a shareable link — used
    // by the panel's auto-save before the coach explicitly creates the link.
    if (saveOnly)
        return { token: null, alreadyExists: false };
    const token = crypto.randomBytes(16).toString('hex');
    await db.collection('playbook_booking_tokens').doc(token).set({
        playbookId,
        coachId: playbook.coachId,
        memberId: playbook.assignedMemberId || null,
        revokedAt: null,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return { token, alreadyExists: false };
});
// ── revokePlaybookBookingLink (coach) ───────────────────────────────────────
exports.revokePlaybookBookingLink = (0, https_1.onCall)({ region: 'us-central1', invoker: 'public' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const db = getDb();
    const callerToken = request.auth.token;
    const coachId = callerToken.coachId || request.auth.uid;
    const isAdmin = callerToken.role === 'platformAdmin' || !!callerToken.admin;
    const { playbookId, regenerate, deleteWindows } = request.data;
    if (!playbookId)
        throw new https_1.HttpsError('invalid-argument', 'playbookId is required');
    const playbookSnap = await db.collection('playbooks').doc(playbookId).get();
    if (!playbookSnap.exists)
        throw new https_1.HttpsError('not-found', 'Playbook not found');
    const playbook = playbookSnap.data();
    if (playbook.coachId !== coachId && !isAdmin) {
        throw new https_1.HttpsError('permission-denied', 'This playbook does not belong to you');
    }
    const active = await db.collection('playbook_booking_tokens')
        .where('playbookId', '==', playbookId)
        .where('revokedAt', '==', null)
        .get();
    const batch = db.batch();
    active.docs.forEach((d) => batch.update(d.ref, { revokedAt: firestore_1.FieldValue.serverTimestamp() }));
    if (deleteWindows)
        batch.delete(db.collection('booking_windows').doc(playbookId));
    await batch.commit();
    if (!regenerate)
        return { revoked: active.size, token: null };
    const token = crypto.randomBytes(16).toString('hex');
    await db.collection('playbook_booking_tokens').doc(token).set({
        playbookId,
        coachId: playbook.coachId,
        memberId: playbook.assignedMemberId || null,
        revokedAt: null,
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    return { revoked: active.size, token };
});
// ── resolvePlaybookBookingToken (public, Admin SDK projection) ──────────────
exports.resolvePlaybookBookingToken = (0, https_1.onRequest)({ cors: true, region: 'us-central1' }, async (req, res) => {
    var _a, _b, _c;
    try {
        const token = req.query.token || ((_a = req.body) === null || _a === void 0 ? void 0 : _a.token);
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
        const playbook = playbookSnap.data();
        if (playbook.isArchived) {
            res.status(410).json({ error: 'Booking is closed for this playbook.' });
            return;
        }
        if (!windowsSnap.exists) {
            res.status(409).json({ error: 'The coach has not opened booking for this playbook yet.' });
            return;
        }
        const windowsDoc = windowsSnap.data();
        const timezone = windowsDoc.timezone;
        const locations = Array.isArray(windowsDoc.locations) ? windowsDoc.locations : [];
        let coachName = null;
        try {
            const coachSnap = await db.collection('coaches').doc(tokenData.coachId).get();
            const c = coachSnap.data() || {};
            coachName = c.displayName || c.name || null;
        }
        catch ( /* branding only — never block booking on it */_d) { /* branding only — never block booking on it */ }
        // Optional identity for slot subtraction + cap state: signed-in member
        // token, or guest email passed back after entry.
        const guestEmail = normalizeEmail(req.query.guestEmail || ((_b = req.body) === null || _b === void 0 ? void 0 : _b.guestEmail));
        const memberId = tokenData.memberId;
        const memberKey = guestEmail ? guestMemberKey(guestEmail) : memberId;
        const { slots, bookedThisWeek, weeklySessionCap, durationMinutes } = await computeMemberSlots({
            playbookId: tokenData.playbookId,
            playbook,
            windowsDoc,
            memberKey,
            memberId,
            guestEmail,
        });
        let memberName = null;
        if (memberId) {
            try {
                const memberSnap = await db.collection('members').doc(memberId).get();
                const full = ((_c = memberSnap.data()) === null || _c === void 0 ? void 0 : _c.name) || '';
                memberName = full ? full.split(' ')[0] : null; // first name only on a public page
            }
            catch ( /* non-blocking */_e) { /* non-blocking */ }
        }
        // Title-only projection — no workoutIds, workout names, or member docs.
        res.json({
            playbookTitle: playbook.name || 'Playbook',
            playbookDescription: (typeof playbook.description === 'string' && playbook.description.trim()) || null,
            coachId: tokenData.coachId,
            coachName,
            memberName,
            guestMode: !memberId,
            sessionKind: (playbook.sessionKind === 'coach_guided' ? 'coach_guided' : 'coach_review'),
            durationMinutes,
            timezone,
            weeklySessionCap,
            capState: weeklySessionCap !== null && memberKey
                ? { booked: bookedThisWeek, cap: weeklySessionCap }
                : null,
            locations,
            slots,
        });
    }
    catch (err) {
        if (err instanceof https_1.HttpsError) {
            const status = err.code === 'not-found' ? 404 : err.code === 'permission-denied' ? 410 : 400;
            res.status(status).json({ error: err.message });
            return;
        }
        console.error('[resolvePlaybookBookingToken] error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});
// ── bookViaBookingToken (public — signed-in member OR guest by email) ───────
exports.bookViaBookingToken = (0, https_1.onCall)({ region: 'us-central1', invoker: 'public', secrets: [emailApiKey] }, async (request) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    const db = getDb();
    const { token, date, startTime, guestEmail: rawGuestEmail, location: rawLocation, clientRequestId: rawClientRequestId } = request.data;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new https_1.HttpsError('invalid-argument', 'date must be YYYY-MM-DD');
    }
    if (!startTime || !HHMM.test(startTime)) {
        throw new https_1.HttpsError('invalid-argument', 'startTime must be HH:mm');
    }
    const tokenData = await loadActiveToken(token);
    const [playbookSnap, windowsSnap] = await Promise.all([
        db.collection('playbooks').doc(tokenData.playbookId).get(),
        db.collection('booking_windows').doc(tokenData.playbookId).get(),
    ]);
    if (!playbookSnap.exists)
        throw new https_1.HttpsError('not-found', 'This playbook no longer exists');
    if (!windowsSnap.exists)
        throw new https_1.HttpsError('failed-precondition', 'Booking is not open for this playbook');
    const playbook = playbookSnap.data();
    if (playbook.isArchived)
        throw new https_1.HttpsError('failed-precondition', 'Booking is closed for this playbook');
    const windowsDoc = windowsSnap.data();
    const timezone = windowsDoc.timezone;
    const durationMinutes = playbook.sessionDurationMinutes || 45;
    const definedLocations = Array.isArray(windowsDoc.locations) ? windowsDoc.locations : [];
    let location = null;
    if (definedLocations.length > 0) {
        if (typeof rawLocation !== 'string' || !definedLocations.includes(rawLocation.trim())) {
            throw new https_1.HttpsError('invalid-argument', 'Pick a location for this session');
        }
        location = rawLocation.trim();
    }
    // Server-side slot validation: the requested time must sit inside a coach
    // window, on the duration grid — the public page is never trusted.
    const startUtc = (0, playbookScheduling_1.wallTimeToUtc)(date, startTime, timezone);
    if (startUtc.getTime() <= Date.now()) {
        throw new https_1.HttpsError('invalid-argument', 'That time is in the past');
    }
    if (startUtc.getTime() > Date.now() + (BOOKING_HORIZON_DAYS + 2) * 24 * 60 * 60 * 1000) {
        throw new https_1.HttpsError('invalid-argument', 'That date is beyond the booking window');
    }
    const dowFmt = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, weekday: 'short' });
    const dowMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const slotDow = (_a = dowMap[dowFmt.format((0, playbookScheduling_1.wallTimeToUtc)(date, '12:00', timezone))]) !== null && _a !== void 0 ? _a : -1;
    const startMin = minutesOf(startTime);
    // Same override semantics as the resolver: an override for this date is
    // the ONLY availability on that date (empty = fully blocked).
    const bookOv = overrideMap(windowsDoc).get(date);
    const bookIntervals = bookOv !== undefined
        ? bookOv
        : windowsDoc.windows
            .filter((w) => windowDays(w).includes(slotDow))
            .map((w) => ({ start: w.startTime, end: w.endTime }));
    const inWindow = bookIntervals.some((iv) => startMin >= minutesOf(iv.start)
        && startMin + durationMinutes <= minutesOf(iv.end)
        && (startMin - minutesOf(iv.start)) % durationMinutes === 0);
    if (!inWindow) {
        throw new https_1.HttpsError('invalid-argument', 'That time is not an available slot');
    }
    // Identity: signed-in member on this playbook books as themselves;
    // everyone else books as a guest by email. Guests are never blocked —
    // the page just encourages account creation after booking.
    const authUid = ((_b = request.auth) === null || _b === void 0 ? void 0 : _b.uid) || null;
    const memberIds = Array.isArray(playbook.memberIds) && playbook.memberIds.length > 0
        ? playbook.memberIds
        : (playbook.assignedMemberId ? [playbook.assignedMemberId] : []);
    let memberId = null;
    let memberKey;
    let memberName;
    let guestEmail = null;
    let bookerEmail = null;
    // Coach preview booking (Phase B.2 testing behavior): the playbook's own
    // coach (or an admin) books on behalf of the assigned member.
    const callerClaims = (((_c = request.auth) === null || _c === void 0 ? void 0 : _c.token) || {});
    const callerIsCoach = !!authUid && (authUid === tokenData.coachId
        || callerClaims.coachId === tokenData.coachId
        || callerClaims.role === 'platformAdmin' || callerClaims.admin === true);
    const onBehalfMemberId = tokenData.memberId || memberIds[0] || null;
    if (authUid && (authUid === tokenData.memberId || memberIds.includes(authUid))) {
        memberId = authUid;
        memberKey = authUid;
        const memberSnap = await db.collection('members').doc(memberId).get();
        memberName = ((_d = memberSnap.data()) === null || _d === void 0 ? void 0 : _d.name) || playbook.assignedMemberName || 'Member';
        bookerEmail = normalizeEmail((_e = memberSnap.data()) === null || _e === void 0 ? void 0 : _e.email) || normalizeEmail((_g = (_f = request.auth) === null || _f === void 0 ? void 0 : _f.token) === null || _g === void 0 ? void 0 : _g.email);
    }
    else if (callerIsCoach && onBehalfMemberId) {
        memberId = onBehalfMemberId;
        memberKey = onBehalfMemberId;
        const memberSnap = await db.collection('members').doc(memberId).get();
        memberName = ((_h = memberSnap.data()) === null || _h === void 0 ? void 0 : _h.name) || playbook.assignedMemberName || 'Member';
        bookerEmail = normalizeEmail((_j = memberSnap.data()) === null || _j === void 0 ? void 0 : _j.email);
    }
    else {
        guestEmail = normalizeEmail(rawGuestEmail);
        if (!guestEmail) {
            throw new https_1.HttpsError('invalid-argument', 'Enter a valid email to book');
        }
        memberKey = guestMemberKey(guestEmail);
        memberName = guestEmail.split('@')[0];
        bookerEmail = guestEmail;
    }
    const weeklySessionCap = typeof playbook.weeklySessionCap === 'number' && playbook.weeklySessionCap > 0
        ? playbook.weeklySessionCap : null;
    // Idempotency: a retry carrying the same clientRequestId (e.g. after a
    // client-side timeout) returns the stored result of the original attempt
    // instead of booking a second session.
    const clientRequestId = (0, playbookScheduling_1.validClientRequestId)(rawClientRequestId);
    if (clientRequestId) {
        const prior = await (0, playbookScheduling_1.claimBookingRequest)(clientRequestId, {
            fn: 'bookViaBookingToken',
            coachId: tokenData.coachId,
            memberKey,
            playbookId: tokenData.playbookId,
        });
        if (prior) {
            console.log(`[bookViaBookingToken] idempotent replay for request ${clientRequestId}`);
            return prior;
        }
    }
    let bookedOccurrence;
    try {
        bookedOccurrence = await (0, playbookScheduling_1.bookOccurrence)({
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
    }
    catch (err) {
        if (clientRequestId)
            await (0, playbookScheduling_1.releaseBookingRequest)(clientRequestId);
        throw err;
    }
    const { instanceId } = bookedOccurrence;
    await db.collection('scheduling_audit_log').add({
        coachId: tokenData.coachId,
        action: 'playbook_session_booked_via_link',
        memberId,
        details: `${guestEmail ? `Guest ${guestEmail}` : memberName} booked ${playbook.name || 'playbook'} session ${date} ${startTime}${location ? ` at ${location}` : ''} via booking link`,
        metadata: { playbookId: tokenData.playbookId, instanceId, guest: !!guestEmail },
        createdAt: firestore_1.FieldValue.serverTimestamp(),
    });
    // Calendar + email confirmation (never blocks the booking itself)
    let coachFirstName = 'your coach';
    try {
        const coachSnap = await db.collection('coaches').doc(tokenData.coachId).get();
        const full = ((_k = coachSnap.data()) === null || _k === void 0 ? void 0 : _k.displayName) || ((_l = coachSnap.data()) === null || _l === void 0 ? void 0 : _l.name) || '';
        if (full)
            coachFirstName = full.split(' ')[0];
    }
    catch ( /* branding only */_m) { /* branding only */ }
    const startUtc2 = (0, playbookScheduling_1.wallTimeToUtc)(date, startTime, timezone);
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
            const { sendNotification } = await Promise.resolve().then(() => __importStar(require('./notifications')));
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
        }
        catch (err) {
            console.error(`[bookViaBookingToken] confirmation email failed for ${instanceId}: ${err.message}`);
        }
    }
    const response = {
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
    if (clientRequestId)
        await (0, playbookScheduling_1.storeBookingRequestResult)(clientRequestId, response);
    return response;
});
// ── Calendar helpers + public .ics endpoint ─────────────────────────────────
function icsUtcStamp(d) {
    return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function friendlyIcsDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
}
function icsEscape(s) {
    return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}
/**
 * Serves a downloadable .ics for a booked session. Auth = the unguessable
 * booking token + the instance must belong to that token's playbook.
 * LOCATION = the session's Zoom join link when allocated, else the member
 * sessions page (locked decision: calendar LOCATION carries the join link).
 */
exports.playbookBookingIcs = (0, https_1.onRequest)({ cors: true, region: 'us-central1' }, async (req, res) => {
    var _a, _b;
    try {
        const token = req.query.token || '';
        const instanceId = req.query.instance || '';
        const tokenData = await loadActiveToken(token);
        if (!instanceId || !/^[A-Za-z0-9]{1,40}$/.test(instanceId)) {
            res.status(400).json({ error: 'Invalid instance' });
            return;
        }
        const instSnap = await getDb().collection('session_instances').doc(instanceId).get();
        if (!instSnap.exists || instSnap.data().playbookId !== tokenData.playbookId) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        const inst = instSnap.data();
        let coachFirstName = 'your coach';
        try {
            const coachSnap = await getDb().collection('coaches').doc(tokenData.coachId).get();
            const full = ((_a = coachSnap.data()) === null || _a === void 0 ? void 0 : _a.displayName) || ((_b = coachSnap.data()) === null || _b === void 0 ? void 0 : _b.name) || '';
            if (full)
                coachFirstName = full.split(' ')[0];
        }
        catch ( /* branding only */_c) { /* branding only */ }
        const startUtc = inst.startUtc.toDate();
        const endUtc = inst.endUtc.toDate();
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
    }
    catch (err) {
        if (err instanceof https_1.HttpsError) {
            res.status(err.code === 'not-found' ? 404 : 400).json({ error: err.message });
            return;
        }
        console.error('[playbookBookingIcs] error:', err);
        res.status(500).json({ error: 'Something went wrong.' });
    }
});
// ── Member session-page callables (live-session route) ──────────────────────
async function loadInstanceForCaller(instanceId, auth) {
    if (typeof instanceId !== 'string' || !instanceId) {
        throw new https_1.HttpsError('invalid-argument', 'instanceId is required');
    }
    const snap = await getDb().collection('session_instances').doc(instanceId).get();
    if (!snap.exists)
        throw new https_1.HttpsError('not-found', 'Session not found');
    const inst = snap.data();
    const claims = auth.token || {};
    const isCoach = auth.uid === inst.coachId || claims.coachId === inst.coachId;
    const isAdmin = claims.role === 'platformAdmin' || claims.admin === true;
    if (auth.uid !== inst.memberId && !isCoach && !isAdmin) {
        throw new https_1.HttpsError('permission-denied', 'This session does not belong to you');
    }
    return inst;
}
/**
 * getPlaybookRescheduleSlots — available slots for moving a booked playbook
 * session, computed with the same engine as the public booking page. The
 * session's own reservation is excluded so its current time doesn't block
 * or count against the weekly cap.
 */
exports.getPlaybookRescheduleSlots = (0, https_1.onCall)({ region: 'us-central1', invoker: 'public' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { instanceId } = request.data;
    const inst = await loadInstanceForCaller(instanceId, request.auth);
    if (!inst.playbookId) {
        throw new https_1.HttpsError('failed-precondition', 'This session was not booked through a booking link');
    }
    const db = getDb();
    const [playbookSnap, windowsSnap] = await Promise.all([
        db.collection('playbooks').doc(inst.playbookId).get(),
        db.collection('booking_windows').doc(inst.playbookId).get(),
    ]);
    if (!playbookSnap.exists)
        throw new https_1.HttpsError('not-found', 'This playbook no longer exists');
    if (!windowsSnap.exists) {
        throw new https_1.HttpsError('failed-precondition', 'The coach has not opened booking for this playbook');
    }
    const playbook = playbookSnap.data();
    const windowsDoc = windowsSnap.data();
    const { slots, durationMinutes } = await computeMemberSlots({
        playbookId: inst.playbookId,
        playbook,
        windowsDoc,
        memberKey: inst.memberKey || inst.memberId || null,
        memberId: inst.memberId || null,
        guestEmail: inst.guestEmail || null,
        excludeInstanceId: instanceId,
    });
    return {
        playbookTitle: playbook.name || 'Playbook',
        timezone: windowsDoc.timezone,
        durationMinutes,
        slots,
    };
});
/**
 * getSessionWorkout — resolves and returns the workout for a session so the
 * member session page can launch the normal WorkoutPlayer. Members cannot
 * read workouts/playbooks/coaches directly (rules), so this Admin-SDK
 * projection is scoped to the session's own member (or the coach/admin).
 * Resolution: pinnedWorkoutId, else the playbook's next-in-sequence
 * (workoutIds[nextWorkoutIndex % length]).
 */
exports.getSessionWorkout = (0, https_1.onCall)({ region: 'us-central1', invoker: 'public' }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { sessionInstanceId } = request.data;
    const inst = await loadInstanceForCaller(sessionInstanceId, request.auth);
    const db = getDb();
    let coachName = null;
    try {
        const coachSnap = await db.collection('coaches').doc(inst.coachId).get();
        const c = coachSnap.data() || {};
        coachName = c.displayName || c.name || null;
    }
    catch ( /* branding only */_a) { /* branding only */ }
    let workoutId = inst.pinnedWorkoutId || null;
    if (!workoutId && inst.playbookId) {
        try {
            const playbookSnap = await db.collection('playbooks').doc(inst.playbookId).get();
            const p = playbookSnap.data() || {};
            const ids = Array.isArray(p.workoutIds) ? p.workoutIds : [];
            if (ids.length > 0) {
                const idx = Number.isInteger(p.nextWorkoutIndex) ? p.nextWorkoutIndex : 0;
                workoutId = ids[((idx % ids.length) + ids.length) % ids.length];
            }
        }
        catch (err) {
            console.warn(`[getSessionWorkout] playbook lookup failed for ${sessionInstanceId}: ${err.message}`);
        }
    }
    if (!workoutId)
        return { workout: null, coachName };
    const workoutSnap = await db.collection('workouts').doc(workoutId).get();
    if (!workoutSnap.exists)
        return { workout: null, coachName };
    return { workout: Object.assign({ id: workoutSnap.id }, workoutSnap.data()), coachName };
});
//# sourceMappingURL=playbookBooking.js.map