/**
 * PlaybookSchedulePanel — scheduling inside the playbook drill-in.
 *
 * Phase B.2: per-day modules. Coach taps day chips; each tapped day reveals
 * its own module with a flexible time field ("10a", "7:30pm", "0730" — always
 * displayed as h:mm AM/PM, never military), a per-day Coach-Guided vs
 * Self-Guided selector, and the workout that falls on that day (derived from
 * playbook order). Workout tiles drag between day modules to reorder the
 * playbook. Repeat control removed — schedules repeat weekly by definition;
 * only the horizon remains. Public payloads still show the playbook TITLE
 * only — never workout names.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc, where, Timestamp,
} from 'firebase/firestore';
import { router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, runOnJS, withSpring } from 'react-native-reanimated';
import { db, functions } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import {
  DAY_SHORT_LABELS,
  PLAYBOOK_SESSION_KIND_LABELS,
  PlaybookSessionKind,
  formatDateShort,
  todayInTz,
} from '../lib/schedulingTypes';
import { WorkoutMosaic, WORKOUT_CARD_BG } from './WorkoutMosaic';

const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const DURATIONS = [30, 45, 60];

// Day-module workout tile — 4:5 aspect ratio, same as workout cards on Build.
// Sized to fill the module's full height (left column runs ~150px tall).
const TILE_W = 124;
const TILE_H = 155;

// Hard client-side deadline on the booking callable: if the underlying request
// dies without settling (e.g. iOS PWA suspended mid-flight), the footer must
// never stay stuck on "Booking…".
const BOOKING_TIMEOUT_MS = 45000;

// Sentinel for the 45s client deadline — distinguishes "request may still be
// running server-side" (retry same clientRequestId) from real failures.
const BOOKING_TIMEOUT_SENTINEL = 'booking-client-timeout';

// Crypto-random idempotency key for booking calls.
export function makeRequestId(): string {
  const bytes = new Uint8Array(16);
  const c = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// A bad saved timezone (corrupt doc, renamed zone) would make every
// Intl call downstream throw — fall back to the device timezone.
export function safeTimezone(tz: unknown): string {
  const fallback = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof tz !== 'string' || !tz) return fallback;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return fallback;
  }
}

export function parseDuration(v: string): number | null {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 5 && n <= 240 ? n : null;
}

// DECISION PENDING (rotate vs stop): when there are more scheduled days than
// workouts, ROTATE_AT_END=true wraps back to the first workout; false leaves
// extra days without a mapped workout. Mirrors ROTATE_AT_PLAYBOOK_END in
// functions/src/playbookScheduling.ts — flip both together.
export const ROTATE_AT_END = true;

// ─── Flexible time parsing — coach types "10a", "10:30am", "7p", "0730" ──────
export function parseFlexTime(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/[\s.]/g, '');
  if (!t) return null;
  const m = t.match(/^(\d{1,2})(?::?([0-5]\d))?(a|am|p|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const suffix = m[3];
  if (suffix) {
    if (h < 1 || h > 12) return null;
    if ((suffix === 'p' || suffix === 'pm') && h !== 12) h += 12;
    if ((suffix === 'a' || suffix === 'am') && h === 12) h = 0;
  } else {
    if (h > 23) return null;
    const explicit24 = m[1].length === 2 && (m[1][0] === '0' || h >= 13);
    if (!explicit24) {
      // Bare hour heuristic: 1–6 → PM, 7–12 → AM (12 = noon)
      if (h >= 1 && h <= 6) h += 12;
    }
  }
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function formatTime12(hhmm: string): string {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return hhmm;
  const h = parseInt(m[1], 10);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

// ── Weekly-hours availability (Calendly pattern) ────────────────────────────
// One slot = one start–end interval on one day. The coach edits per-day slot
// lists; on save they serialize back to booking_windows.windows as one
// { days:[d], startTime, endTime } entry per interval (server shape unchanged).
interface AvailSlot {
  startRaw: string;         // what the coach typed / 12-hour display
  start: string | null;     // canonical HH:mm (null = unparseable)
  endRaw: string;
  end: string | null;
}

const DEFAULT_DAY_SLOT = { start: '06:00', end: '22:00' };

function makeSlot(start: string, end: string): AvailSlot {
  return { startRaw: formatTime12(start), start, endRaw: formatTime12(end), end };
}

// booking_windows docs written before multi-day support carry dayOfWeek;
// multi-day windows expand into one slot per covered day.
export function windowsToDaySlots(raw: any[]): AvailSlot[][] {
  const byDay: AvailSlot[][] = Array.from({ length: 7 }, () => []);
  for (const w of raw) {
    const days: number[] = Array.isArray(w?.days)
      ? w.days.filter((d: any) => Number.isInteger(d) && d >= 0 && d <= 6)
      : (typeof w?.dayOfWeek === 'number' ? [w.dayOfWeek] : []);
    const start = typeof w?.startTime === 'string' ? w.startTime : '09:00';
    const end = typeof w?.endTime === 'string' ? w.endTime : '12:00';
    for (const d of days) byDay[d].push(makeSlot(start, end));
  }
  for (const list of byDay) list.sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  return byDay;
}

// Serialize per-day slots to server windows, merging overlapping/adjacent
// intervals within a day (overlap policy: merge, never reject).
export function daySlotsToWindows(byDay: AvailSlot[][]): Array<{ days: number[]; startTime: string; endTime: string }> {
  const out: Array<{ days: number[]; startTime: string; endTime: string }> = [];
  for (let d = 0; d < 7; d++) {
    const iv = byDay[d]
      .filter((s) => s.start && s.end && s.start < s.end)
      .map((s) => ({ start: s.start as string, end: s.end as string }))
      .sort((a, b) => a.start.localeCompare(b.start));
    const merged: Array<{ start: string; end: string }> = [];
    for (const cur of iv) {
      const last = merged[merged.length - 1];
      if (last && cur.start <= last.end) {
        if (cur.end > last.end) last.end = cur.end;
      } else {
        merged.push({ ...cur });
      }
    }
    for (const m of merged) out.push({ days: [d], startTime: m.start, endTime: m.end });
  }
  return out;
}

// ── Date-specific hours (Calendly pattern) ──────────────────────────────────
// An override REPLACES the weekly pattern on one calendar date; zero
// intervals means the date is fully unavailable (doubles as blackout dates).
export interface DateOverride {
  date: string;                                     // YYYY-MM-DD (coach timezone)
  intervals: Array<{ start: string; end: string }>; // HH:mm
}

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

interface BookResult {
  date: string;
  status: 'booked' | 'conflict' | 'cap_reached';
  reason?: string;
}

interface DayConfig {
  raw: string;           // what the coach typed / formatted display
  time: string | null;   // canonical HH:mm (null = unparseable)
  kind: PlaybookSessionKind;
  duration: string;      // free text minutes, validated 5-240
}

interface PlaybookDocLite {
  name?: string;
  description?: string;
  assignedMemberId?: string | null;
  assignedMemberName?: string | null;
  memberIds?: string[];
  workoutIds?: string[];
  sessionKind?: PlaybookSessionKind;
  recordingEnabled?: boolean;
  sessionDurationMinutes?: number;
  weeklySessionCap?: number | null;
  timezone?: string;
  scheduleDaysOfWeek?: number[];
  scheduleStartTime?: string;
  scheduleDaySettings?: Array<{ dayOfWeek: number; startTime: string; sessionKind?: PlaybookSessionKind; durationMinutes?: number | null }>;
  repeatHorizonWeeks?: number;
}

interface UpcomingSession {
  id: string;
  scheduledDate?: string;
  scheduledStartTime?: string;
  memberName?: string;
  startUtcMillis: number;
}

const DEFAULT_CONFIG: DayConfig = { raw: '7:00 AM', time: '07:00', kind: 'coach_review', duration: '45' };

export default function PlaybookSchedulePanel({
  playbookId,
  visible,
  onClose,
}: {
  playbookId: string;
  visible: boolean;
  onClose: () => void;
}) {
  // effectiveUid keeps admin impersonation intact (never user.uid directly)
  const { effectiveUid } = useAuth();
  const [playbook, setPlaybook] = useState<PlaybookDocLite | null>(null);

  const [days, setDays] = useState<number[]>([]);
  const [dayConfigs, setDayConfigs] = useState<Record<number, DayConfig>>({});
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [horizonWeeks, setHorizonWeeks] = useState(4);
  const [weeklyCap, setWeeklyCap] = useState<number | null>(null);
  const [booking, setBooking] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [results, setResults] = useState<BookResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Survives close/reopen on purpose: an unresolved (timed-out) booking must
  // keep its idempotency key so any retry can't double-book.
  const pendingRequestIdRef = useRef<string | null>(null);
  const prefilledRef = useRef(false);
  // Auto-save dirty flags: set only by user edits, never by snapshot prefill,
  // so hydration can't trigger a write-back loop.
  const dayDirtyRef = useRef(false);
  const availDirtyRef = useRef(false);
  const sessionCfgDirtyRef = useRef(false);
  const [availSaved, setAvailSaved] = useState(false);

  // Inline title + description editing (A5 / C10)
  const [titleDraft, setTitleDraft] = useState('');
  const [descDraft, setDescDraft] = useState('');
  const titleDirty = useRef(false);
  const descDirty = useRef(false);

  // Workouts on this playbook — powers the per-day mosaic tiles
  const [workoutNames, setWorkoutNames] = useState<Record<string, string>>({});
  const [workoutDurations, setWorkoutDurations] = useState<Record<string, number | null>>({});
  // Still-image slots per workout (same shape as Build's coverThumbs):
  // URL string for movements with media, { name } placeholder otherwise.
  const [workoutThumbs, setWorkoutThumbs] = useState<Record<string, (string | { name: string })[]>>({});

  // Booking link (Phase 3b): weekly-hours availability + public token URL
  const [daySlots, setDaySlots] = useState<AvailSlot[][]>(() => Array.from({ length: 7 }, () => []));
  const [locations, setLocations] = useState<string[]>([]);
  // Date-specific hours: saved overrides + the add-hours modal state
  const [dateOverrides, setDateOverrides] = useState<DateOverride[]>([]);
  const [ovOpen, setOvOpen] = useState(false);
  const [ovDates, setOvDates] = useState<string[]>([]);
  const [ovSlots, setOvSlots] = useState<AvailSlot[]>([]);
  const [ovMonth, setOvMonth] = useState<{ y: number; m: number }>(() => {
    const n = new Date();
    return { y: n.getFullYear(), m: n.getMonth() };
  });
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  // Members on this playbook (B.1): coach member list + add/remove
  const [coachMembers, setCoachMembers] = useState<Array<{ id: string; name: string }>>([]);
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [memberBusy, setMemberBusy] = useState(false);

  // Upcoming sessions (B9): cancel via existing cancelInstance function
  const [upcoming, setUpcoming] = useState<UpcomingSession[]>([]);
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null);

  // Reset transient state every time the panel opens. The component stays
  // mounted behind the Modal, so without this a stuck `booking` (e.g. a fetch
  // that died while the PWA was backgrounded) persisted across close/reopen.
  useEffect(() => {
    if (visible) {
      setBooking(false);
      setError(null);
      setResults(null);
      // Drag state too — closing mid-drag otherwise leaves dragFromIdx set,
      // which keeps scrollEnabled false and freezes scrolling on reopen.
      setDragFromIdx(null);
      setDragOverIdx(null);
      dragTY.value = 0;
      lastOverRef.current = null;
      dayDirtyRef.current = false;
      availDirtyRef.current = false;
      sessionCfgDirtyRef.current = false;
      setAvailSaved(false);
    }
  }, [visible]);

  // Live playbook doc — pre-fills the form from previously saved settings.
  useEffect(() => {
    if (!visible || !playbookId || !effectiveUid) return;
    prefilledRef.current = false;
    const unsub = onSnapshot(
      doc(db, 'playbooks', playbookId),
      (snap) => {
        const data = (snap.data() || {}) as PlaybookDocLite;
        setPlaybook(data);
        if (!titleDirty.current) setTitleDraft(data.name || '');
        if (!descDirty.current) setDescDraft(data.description || '');
        // Skip while dirty — a snapshot echo from another auto-save write
        // would otherwise revert an unsaved toggle/stepper change.
        if (!sessionCfgDirtyRef.current) {
          if (data.recordingEnabled !== undefined) setRecordingEnabled(data.recordingEnabled !== false);
          if (data.repeatHorizonWeeks) setHorizonWeeks(data.repeatHorizonWeeks);
          if (data.weeklySessionCap !== undefined) setWeeklyCap(data.weeklySessionCap ?? null);
        }
        if (!prefilledRef.current) {
          prefilledRef.current = true;
          const fallbackDuration = String(data.sessionDurationMinutes || 45);
          const saved = data.scheduleDaySettings;
          if (Array.isArray(saved) && saved.length) {
            const ds = saved.map((x) => x.dayOfWeek).sort((a, b) => a - b);
            setDays(ds);
            const cfg: Record<number, DayConfig> = {};
            for (const x of saved) {
              cfg[x.dayOfWeek] = {
                raw: formatTime12(x.startTime),
                time: x.startTime,
                kind: x.sessionKind || data.sessionKind || 'coach_review',
                duration: x.durationMinutes ? String(x.durationMinutes) : fallbackDuration,
              };
            }
            setDayConfigs(cfg);
          } else if (data.scheduleDaysOfWeek?.length) {
            const ds = [...data.scheduleDaysOfWeek].sort((a, b) => a - b);
            setDays(ds);
            const t = data.scheduleStartTime || '07:00';
            const cfg: Record<number, DayConfig> = {};
            for (const d of ds) {
              cfg[d] = { raw: formatTime12(t), time: t, kind: data.sessionKind || 'coach_review', duration: fallbackDuration };
            }
            setDayConfigs(cfg);
          }
        }
      },
      (err) => console.error('[PlaybookSchedulePanel] playbook listener error:', err),
    );
    return unsub;
  }, [visible, playbookId, effectiveUid]);

  // Workout names for the day-module tiles (coach-facing, so names are fine).
  const workoutIds = useMemo<string[]>(() => playbook?.workoutIds || [], [playbook?.workoutIds]);
  useEffect(() => {
    if (!visible || workoutIds.length === 0) return;
    const missing = workoutIds.filter((id) => !(id in workoutNames));
    if (missing.length === 0) return;
    Promise.all(missing.map((id) => getDoc(doc(db, 'workouts', id)).catch(() => null)))
      .then((snaps) => {
        setWorkoutNames((prev) => {
          const next = { ...prev };
          snaps.forEach((snapDoc, i) => {
            next[missing[i]] = (snapDoc?.data()?.name as string) || 'Workout';
          });
          return next;
        });
        setWorkoutDurations((prev) => {
          const next = { ...prev };
          snaps.forEach((snapDoc, i) => {
            const v = snapDoc?.data()?.estimatedDurationMin;
            next[missing[i]] = typeof v === 'number' ? v : null;
          });
          return next;
        });

        // Mosaic slots: still image per movement (poster preferred), name
        // placeholder otherwise. Movements whose embedded block entry lacks a
        // URL get one lookup in the movements collection.
        const movementIdFallbacks = new Set<string>();
        const rawSlots: Record<string, Array<string | { name: string; movementId?: string }>> = {};
        snaps.forEach((snapDoc, i) => {
          const data = snapDoc?.data();
          const slots: Array<string | { name: string; movementId?: string }> = [];
          const seen = new Set<string>();
          outer: for (const block of (data?.blocks ?? [])) {
            for (const mov of (block?.movements ?? [])) {
              if (slots.length >= 16) break outer;
              const still = mov.posterUrl || mov.thumbnailImageUrl || mov.thumbnailUrl || mov.gifUrl || null;
              if (still) {
                if (!seen.has(still)) { seen.add(still); slots.push(still); }
              } else {
                const movId = mov.movementId || mov.id || null;
                if (movId) movementIdFallbacks.add(movId);
                slots.push({ name: mov.movementName || mov.name || 'Movement', movementId: movId || undefined });
              }
            }
          }
          rawSlots[missing[i]] = slots;
        });
        const fallbackIds = [...movementIdFallbacks];
        Promise.all(fallbackIds.map((id) => getDoc(doc(db, 'movements', id)).catch(() => null)))
          .then((movSnaps) => {
            const stillById: Record<string, string> = {};
            movSnaps.forEach((s2, i) => {
              const d = s2?.data();
              const still = d?.posterUrl || d?.thumbnailImageUrl || d?.thumbnailUrl;
              if (still) stillById[fallbackIds[i]] = still;
            });
            setWorkoutThumbs((prev) => {
              const next = { ...prev };
              for (const [wid, slots] of Object.entries(rawSlots)) {
                const seen = new Set<string>();
                next[wid] = slots
                  .map((slot) => {
                    if (typeof slot === 'string') return slot;
                    const resolved = slot.movementId ? stillById[slot.movementId] : undefined;
                    return resolved || { name: slot.name };
                  })
                  .filter((slot) => {
                    if (typeof slot !== 'string') return true;
                    if (seen.has(slot)) return false;
                    seen.add(slot);
                    return true;
                  });
              }
              return next;
            });
          });
      });
  }, [visible, workoutIds, workoutNames]);

  // Prefill saved availability + existing (unrevoked) booking token on open.
  useEffect(() => {
    if (!visible || !playbookId || !effectiveUid) return;
    getDoc(doc(db, 'booking_windows', playbookId))
      .then((snap) => {
        const w = snap.data()?.windows;
        if (Array.isArray(w) && w.length) setDaySlots(windowsToDaySlots(w));
        const locs = snap.data()?.locations;
        if (Array.isArray(locs)) setLocations(locs);
        const ov = snap.data()?.dateOverrides;
        if (Array.isArray(ov)) {
          setDateOverrides(ov.filter(
            (o: any) => typeof o?.date === 'string' && Array.isArray(o?.intervals),
          ));
        }
      })
      .catch(() => {});
    getDocs(query(
      collection(db, 'playbook_booking_tokens'),
      where('coachId', '==', effectiveUid),
      where('playbookId', '==', playbookId),
      where('revokedAt', '==', null),
      limit(1),
    ))
      .then((snap) => { if (!snap.empty) setLinkToken(snap.docs[0].id); })
      .catch(() => {});
  }, [visible, playbookId, effectiveUid]);

  // Coach's member list — powers the add-member picker + name lookups.
  useEffect(() => {
    if (!visible || !effectiveUid) return;
    getDocs(query(collection(db, 'members'), where('coachId', '==', effectiveUid)))
      .then((snap) => {
        setCoachMembers(
          snap.docs
            .filter((d) => !d.data().isArchived)
            .map((d) => {
              const x = d.data();
              return { id: d.id, name: x.name || x.displayName || x.email || 'Unnamed' };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch((e) => console.error('[PlaybookSchedulePanel] members load error:', e));
  }, [visible, effectiveUid]);

  // Upcoming scheduled sessions for this playbook (cancel list).
  useEffect(() => {
    if (!visible || !playbookId || !effectiveUid) return;
    const q = query(
      collection(db, 'session_instances'),
      where('playbookId', '==', playbookId),
      where('startUtc', '>=', Timestamp.now()),
      orderBy('startUtc', 'asc'),
      limit(25),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setUpcoming(
          snap.docs
            .filter((d) => d.data().status === 'scheduled')
            .map((d) => {
              const x = d.data();
              return {
                id: d.id,
                scheduledDate: x.scheduledDate,
                scheduledStartTime: x.scheduledStartTime,
                memberName: x.memberName,
                startUtcMillis: (x.startUtc as Timestamp)?.toMillis?.() || 0,
              };
            }),
        );
      },
      (err) => console.error('[PlaybookSchedulePanel] upcoming listener error:', err),
    );
    return unsub;
  }, [visible, playbookId, effectiveUid]);

  const cancelSession = useCallback(async (instanceId: string) => {
    if (cancelBusyId) return;
    setCancelBusyId(instanceId);
    try {
      const fn = httpsCallable(functions, 'cancelInstance');
      await fn({ instanceId });
    } catch (e: any) {
      console.error('[PlaybookSchedulePanel] cancel error:', e);
      setError(e?.message || 'Cancel failed');
    } finally {
      setCancelBusyId(null);
    }
  }, [cancelBusyId]);

  const playbookMemberIds = useMemo<string[]>(
    () => (playbook?.memberIds?.length
      ? playbook.memberIds
      : (playbook?.assignedMemberId ? [playbook.assignedMemberId] : [])),
    [playbook?.memberIds, playbook?.assignedMemberId],
  );
  const nameOf = useCallback(
    (id: string) => coachMembers.find((m) => m.id === id)?.name
      || (id === playbook?.assignedMemberId ? playbook?.assignedMemberName : null)
      || 'Member',
    [coachMembers, playbook?.assignedMemberId, playbook?.assignedMemberName],
  );

  const writeMembers = useCallback(async (newIds: string[]) => {
    if (memberBusy) return;
    setMemberBusy(true);
    try {
      // assignedMemberId stays in sync for legacy single-member reads
      await updateDoc(doc(db, 'playbooks', playbookId), {
        memberIds: newIds,
        assignedMemberId: newIds[0] || null,
        assignedMemberName: newIds[0] ? nameOf(newIds[0]) : null,
        updatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.error('[PlaybookSchedulePanel] member update error:', e);
    } finally {
      setMemberBusy(false);
    }
  }, [memberBusy, playbookId, nameOf]);

  const saveTitle = useCallback(async () => {
    titleDirty.current = false;
    const v = titleDraft.trim();
    if (!v || v === playbook?.name) return;
    try {
      await updateDoc(doc(db, 'playbooks', playbookId), { name: v, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error('[PlaybookSchedulePanel] title save error:', e);
    }
  }, [titleDraft, playbook?.name, playbookId]);

  const saveDescription = useCallback(async () => {
    descDirty.current = false;
    const v = descDraft.trim();
    if (v === (playbook?.description || '')) return;
    try {
      await updateDoc(doc(db, 'playbooks', playbookId), { description: v, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error('[PlaybookSchedulePanel] description save error:', e);
    }
  }, [descDraft, playbook?.description, playbookId]);

  const memberName = playbook?.assignedMemberName || null;
  const hasMember = playbookMemberIds.length > 0;
  const timezone = useMemo(() => safeTimezone(playbook?.timezone), [playbook?.timezone]);

  const toggleDay = useCallback((d: number) => {
    dayDirtyRef.current = true;
    setDays((prev) => {
      if (prev.includes(d)) return prev.filter((x) => x !== d);
      return [...prev, d].sort((a, b) => a - b);
    });
    setDayConfigs((prev) => (prev[d] ? prev : { ...prev, [d]: { ...DEFAULT_CONFIG } }));
    setResults(null);
  }, []);

  const setDayTime = useCallback((d: number, raw: string) => {
    dayDirtyRef.current = true;
    setDayConfigs((prev) => ({
      ...prev,
      [d]: { ...(prev[d] || DEFAULT_CONFIG), raw, time: parseFlexTime(raw) },
    }));
    setResults(null);
  }, []);

  const blurDayTime = useCallback((d: number) => {
    setDayConfigs((prev) => {
      const cfg = prev[d];
      if (!cfg?.time) return prev;
      return { ...prev, [d]: { ...cfg, raw: formatTime12(cfg.time) } };
    });
  }, []);

  const setDayKind = useCallback((d: number, kind: PlaybookSessionKind) => {
    dayDirtyRef.current = true;
    setDayConfigs((prev) => ({ ...prev, [d]: { ...(prev[d] || DEFAULT_CONFIG), kind } }));
    setResults(null);
  }, []);

  const setDayDuration = useCallback((d: number, v: string) => {
    dayDirtyRef.current = true;
    setDayConfigs((prev) => ({
      ...prev,
      [d]: { ...(prev[d] || DEFAULT_CONFIG), duration: v.replace(/[^0-9]/g, '') },
    }));
    setResults(null);
  }, []);

  // Auto-save per-day settings: any user edit (day toggle, time, duration,
  // kind) debounces ~800ms then persists to the playbook doc. Previously these
  // only saved when Book Sessions ran, so edits vanished on reload.
  const saveDaySettings = useCallback(() => {
    if (!dayDirtyRef.current || !playbookId) return;
    dayDirtyRef.current = false;
    const valid = days.filter(
      (d) => !!dayConfigs[d]?.time && parseDuration(dayConfigs[d]?.duration ?? '') !== null,
    );
    // Mid-edit (nothing parseable yet) — wait for the next valid change.
    if (valid.length === 0 && days.length > 0) return;
    const daySettings = valid.map((d) => ({
      dayOfWeek: d,
      startTime: dayConfigs[d]!.time as string,
      sessionKind: dayConfigs[d]!.kind,
      durationMinutes: parseDuration(dayConfigs[d]!.duration) as number,
    }));
    const payload: Record<string, unknown> = {
      scheduleDaySettings: daySettings,
      scheduleDaysOfWeek: valid,
      updatedAt: serverTimestamp(),
    };
    if (daySettings.length) payload.scheduleStartTime = daySettings[0].startTime;
    updateDoc(doc(db, 'playbooks', playbookId), payload).catch((e) => {
      console.error('[PlaybookSchedulePanel] day settings auto-save error:', e);
    });
  }, [days, dayConfigs, playbookId]);

  useEffect(() => {
    if (!dayDirtyRef.current || !playbookId) return;
    const t = setTimeout(saveDaySettings, 800);
    return () => clearTimeout(t);
  }, [days, dayConfigs, playbookId, saveDaySettings]);

  // Auto-save session settings (recording toggle, book-ahead horizon, weekly
  // cap). Previously these only persisted when Book Sessions ran, so changing
  // them and closing the panel silently lost the edit.
  const saveSessionSettings = useCallback(() => {
    if (!sessionCfgDirtyRef.current || !playbookId) return;
    sessionCfgDirtyRef.current = false;
    updateDoc(doc(db, 'playbooks', playbookId), {
      recordingEnabled,
      repeatHorizonWeeks: horizonWeeks,
      weeklySessionCap: weeklyCap,
      updatedAt: serverTimestamp(),
    }).catch((e) => {
      console.error('[PlaybookSchedulePanel] session settings auto-save error:', e);
    });
  }, [recordingEnabled, horizonWeeks, weeklyCap, playbookId]);

  useEffect(() => {
    if (!sessionCfgDirtyRef.current || !playbookId) return;
    const t = setTimeout(saveSessionSettings, 800);
    return () => clearTimeout(t);
  }, [recordingEnabled, horizonWeeks, weeklyCap, playbookId, saveSessionSettings]);

  // Day k (in sorted selected days) → workout index in playbook order.
  const workoutForModule = useCallback((k: number): string | null => {
    if (workoutIds.length === 0) return null;
    if (k < workoutIds.length) return workoutIds[k];
    return ROTATE_AT_END ? workoutIds[k % workoutIds.length] : null;
  }, [workoutIds]);

  // ── B7: drag workout tiles between day modules ─────────────────────────────
  const moduleLayouts = useRef<Record<number, { y: number; h: number }>>({});
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const dragTY = useSharedValue(0);
  const dragActiveIdx = useSharedValue(-1);
  const lastOverRef = useRef<number | null>(null);

  const SPRING_CFG = { damping: 22, stiffness: 240, mass: 0.7 };

  const endDrag = useCallback(() => {
    lastOverRef.current = null;
    setDragFromIdx(null);
    setDragOverIdx(null);
    dragTY.value = 0;
    dragActiveIdx.value = -1;
  }, [dragTY, dragActiveIdx]);

  // Commit = SWAP the two positions (matches the live preview exactly).
  const swapWorkouts = useCallback((fromModule: number, toModule: number) => {
    const n = workoutIds.length;
    if (fromModule === toModule || n === 0) return;
    const fromPos = fromModule < n ? fromModule : (ROTATE_AT_END ? fromModule % n : -1);
    const toPos = toModule < n ? toModule : (ROTATE_AT_END ? toModule % n : -1);
    if (fromPos < 0 || toPos < 0 || fromPos === toPos) return;
    const next = [...workoutIds];
    [next[fromPos], next[toPos]] = [next[toPos], next[fromPos]];
    updateDoc(doc(db, 'playbooks', playbookId), { workoutIds: next, updatedAt: serverTimestamp() })
      .catch((e) => console.error('[PlaybookSchedulePanel] workout reorder error:', e));
  }, [workoutIds, playbookId]);

  const commitSwap = useCallback((fromModule: number, toModule: number) => {
    swapWorkouts(fromModule, toModule);
    // Firestore's latency-compensated local write has already re-rendered the
    // swapped data by the next frame, so clearing drag state (which drops the
    // preview mapping) leaves the exact same tiles on screen.
    requestAnimationFrame(() => endDrag());
  }, [swapWorkouts, endDrag]);

  const findTarget = (fromIdx: number, ty: number): number | null => {
    const from = moduleLayouts.current[fromIdx];
    if (!from) return null;
    const centerY = from.y + from.h / 2 + ty;
    for (const [k, r] of Object.entries(moduleLayouts.current)) {
      if (centerY >= r.y && centerY < r.y + r.h) return Number(k);
    }
    return null;
  };

  // Live swap preview: while dragging from F over T, the module slots render
  // as if the swap already happened — T's workout shows in F's slot instantly,
  // and swaps back instantly if the coach drags back home. No translated
  // tiles, so nothing can get stranded mid-animation.
  const hoverModule = useCallback((fromIdx: number, ty: number) => {
    let target = findTarget(fromIdx, ty);
    if (target === fromIdx) target = null;
    if (target !== null && workoutForModule(target) === null) target = null;
    if (target === lastOverRef.current) return;
    lastOverRef.current = target;
    setDragOverIdx(target);
  }, [workoutForModule]);

  const finishDrag = useCallback((fromIdx: number, ty: number) => {
    let target = findTarget(fromIdx, ty);
    if (target === fromIdx) target = null;
    if (target !== null && workoutForModule(target) === null) target = null;
    const from = moduleLayouts.current[fromIdx];
    const dest = target !== null ? moduleLayouts.current[target] : null;
    if (!from || !dest || target === null) {
      // No move — spring the tile back home, then clear state.
      dragTY.value = withSpring(0, SPRING_CFG, () => { runOnJS(endDrag)(); });
      return;
    }
    const commitTarget = target;
    lastOverRef.current = commitTarget;
    setDragOverIdx(commitTarget);
    // In-hand tile springs onto its ghost slot; the swap commits when it
    // lands (preview already shows the swapped layout, so nothing jumps).
    dragTY.value = withSpring(dest.y - from.y, SPRING_CFG, () => { runOnJS(commitSwap)(fromIdx, commitTarget); });
  }, [dragTY, commitSwap, workoutForModule]);

  const sortedDays = days;

  const timesValid = sortedDays.length > 0
    && sortedDays.every((d) => !!dayConfigs[d]?.time && parseDuration(dayConfigs[d]?.duration ?? '') !== null);
  const canBook = hasMember && timesValid && !booking;

  const book = useCallback(async () => {
    if (!canBook) return;
    setBooking(true);
    setError(null);
    setResults(null);
    setCheckingStatus(false);
    // Reuse the request ID from a timed-out attempt: the server dedupes on
    // clientRequestId, so the retry either returns the stored result (the
    // first attempt actually landed) or books fresh — never double-books.
    const clientRequestId = pendingRequestIdRef.current || makeRequestId();
    pendingRequestIdRef.current = clientRequestId;
    try {
      const daySettings = sortedDays.map((d) => ({
        dayOfWeek: d,
        startTime: dayConfigs[d]!.time as string,
        sessionKind: dayConfigs[d]!.kind,
        durationMinutes: parseDuration(dayConfigs[d]!.duration) as number,
      }));
      const fn = httpsCallable(functions, 'bookPlaybookSession');
      const payload = {
        playbookId,
        daysOfWeek: sortedDays,
        startTime: daySettings[0].startTime,
        daySettings,
        timezone,
        durationMinutes: daySettings[0].durationMinutes,
        sessionKind: daySettings[0].sessionKind,
        recordingEnabled,
        repeatFrequency: 'weekly',
        repeatHorizonWeeks: horizonWeeks,
        weeklySessionCap: weeklyCap,
        clientRequestId,
      };
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await Promise.race([
            fn(payload),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error(BOOKING_TIMEOUT_SENTINEL)), BOOKING_TIMEOUT_MS);
            }),
          ]);
          const data = (res as { data: { results: BookResult[] } }).data;
          pendingRequestIdRef.current = null;
          setResults(data.results || []);
          return;
        } catch (e: any) {
          const timedOut = e?.message === BOOKING_TIMEOUT_SENTINEL;
          if (timedOut && attempt === 0) {
            // The request may have landed server-side — retry with the SAME
            // clientRequestId to fetch the stored result instead of rebooking.
            setCheckingStatus(true);
            continue;
          }
          if (!timedOut) pendingRequestIdRef.current = null;
          throw timedOut
            ? new Error('Booking timed out — tap Book Sessions again to check status (it will not double-book)')
            : e;
        }
      }
    } catch (e: any) {
      console.error('[PlaybookSchedulePanel] booking error:', e);
      setError(e?.message || 'Booking failed');
    } finally {
      setBooking(false);
      setCheckingStatus(false);
    }
  }, [canBook, playbookId, sortedDays, dayConfigs, timezone, recordingEnabled, horizonWeeks, weeklyCap]);

  const hasAnySlot = daySlots.some((list) => list.length > 0);
  const windowsValid = hasAnySlot && daySlots.every((list) => list.every(
    (sl) => !!sl.start && !!sl.end && sl.start < sl.end,
  ));

  const bookingUrl = useMemo(() => {
    if (!linkToken) return null;
    const origin =
      Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://goarrive.fit';
    return `${origin}/book/${linkToken}`;
  }, [linkToken]);

  // Enable a day (adds the default interval) or append another interval —
  // the new interval starts where the last one ends, one hour long.
  const addDaySlot = useCallback((d: number) => {
    availDirtyRef.current = true;
    setDaySlots((prev) => prev.map((list, idx) => {
      if (idx !== d) return list;
      if (list.length === 0) return [makeSlot(DEFAULT_DAY_SLOT.start, DEFAULT_DAY_SLOT.end)];
      const lastEnd = [...list].map((sl) => sl.end).filter(Boolean).sort().pop() || '17:00';
      const [h, m] = lastEnd.split(':').map(Number);
      if (h >= 23) return [...list, makeSlot('09:00', '12:00')];
      const endH = Math.min(23, h + 1);
      return [...list, makeSlot(lastEnd, `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`)];
    }));
    setLinkError(null);
  }, []);

  const removeDaySlot = useCallback((d: number, i: number) => {
    availDirtyRef.current = true;
    setDaySlots((prev) => prev.map((list, idx) => (idx === d ? list.filter((_, j) => j !== i) : list)));
    setLinkError(null);
  }, []);

  const setSlotTime = useCallback((d: number, i: number, field: 'start' | 'end', raw: string) => {
    availDirtyRef.current = true;
    setDaySlots((prev) => prev.map((list, idx) => (idx === d
      ? list.map((sl, j) => (j === i
        ? { ...sl, [`${field}Raw`]: raw, [field]: parseFlexTime(raw) }
        : sl))
      : list)));
    setLinkError(null);
  }, []);

  const blurSlotTime = useCallback((d: number, i: number, field: 'start' | 'end') => {
    setDaySlots((prev) => prev.map((list, idx) => (idx === d
      ? list.map((sl, j) => {
        if (j !== i) return sl;
        const v = sl[field];
        return v ? { ...sl, [`${field}Raw`]: formatTime12(v) } : sl;
      })
      : list)));
  }, []);

  // ── Date-specific hours modal ─────────────────────────────────────────────
  const openOverrideModal = useCallback(() => {
    const [y, m] = todayInTz(timezone).split('-').map(Number);
    setOvMonth({ y, m: m - 1 });
    setOvDates([]);
    setOvSlots([makeSlot('09:00', '17:00')]);
    setOvOpen(true);
  }, [timezone]);

  const toggleOvDate = useCallback((dateStr: string) => {
    setOvDates((prev) => (prev.includes(dateStr)
      ? prev.filter((d) => d !== dateStr)
      : [...prev, dateStr].sort()));
  }, []);

  const addOvSlot = useCallback(() => {
    setOvSlots((prev) => {
      if (prev.length === 0) return [makeSlot('09:00', '17:00')];
      const lastEnd = [...prev].map((sl) => sl.end).filter(Boolean).sort().pop() || '17:00';
      const [h, m] = lastEnd.split(':').map(Number);
      if (h >= 23) return [...prev, makeSlot('09:00', '12:00')];
      const endH = Math.min(23, h + 1);
      return [...prev, makeSlot(lastEnd, `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`)];
    });
  }, []);

  const removeOvSlot = useCallback((i: number) => {
    setOvSlots((prev) => prev.filter((_, j) => j !== i));
  }, []);

  const setOvSlotTime = useCallback((i: number, field: 'start' | 'end', raw: string) => {
    setOvSlots((prev) => prev.map((sl, j) => (j === i
      ? { ...sl, [`${field}Raw`]: raw, [field]: parseFlexTime(raw) }
      : sl)));
  }, []);

  const blurOvSlotTime = useCallback((i: number, field: 'start' | 'end') => {
    setOvSlots((prev) => prev.map((sl, j) => {
      if (j !== i) return sl;
      const v = sl[field];
      return v ? { ...sl, [`${field}Raw`]: formatTime12(v) } : sl;
    }));
  }, []);

  // Zero interval rows is valid — it marks the selected dates unavailable.
  const ovSlotsValid = ovSlots.every((sl) => !!sl.start && !!sl.end && (sl.start as string) < (sl.end as string));
  const canApplyOv = ovDates.length > 0 && ovSlotsValid;

  const applyOverrides = useCallback(() => {
    if (!canApplyOv) return;
    availDirtyRef.current = true;
    const intervals = ovSlots.map((sl) => ({ start: sl.start as string, end: sl.end as string }));
    setDateOverrides((prev) => {
      const next = prev.filter((o) => !ovDates.includes(o.date));
      for (const d of ovDates) next.push({ date: d, intervals });
      return next.sort((a, b) => a.date.localeCompare(b.date));
    });
    setOvOpen(false);
    setLinkError(null);
  }, [canApplyOv, ovSlots, ovDates]);

  const removeOverride = useCallback((dateStr: string) => {
    availDirtyRef.current = true;
    setDateOverrides((prev) => prev.filter((o) => o.date !== dateStr));
    setLinkError(null);
  }, []);

  const createLink = useCallback(async () => {
    if (!windowsValid || linkBusy) return;
    setLinkBusy(true);
    setLinkError(null);
    try {
      const fn = httpsCallable(functions, 'createPlaybookBookingLink');
      const res = await fn({
        playbookId,
        windows: daySlotsToWindows(daySlots),
        timezone,
        locations: locations.map((l) => l.trim()).filter(Boolean),
        dateOverrides,
      });
      const data = res.data as { token: string };
      setLinkToken(data.token);
    } catch (e: any) {
      console.error('[PlaybookSchedulePanel] booking link error:', e);
      setLinkError(e?.message || 'Could not create booking link');
    } finally {
      setLinkBusy(false);
    }
  }, [windowsValid, linkBusy, playbookId, daySlots, timezone, locations, dateOverrides]);

  // Auto-save availability whether or not a booking link exists yet.
  // booking_windows is Cloud-Functions-write-only (rules), so this reuses the
  // createPlaybookBookingLink callable with saveOnly — it persists windows/
  // locations/overrides but never mints a token. First-time link creation
  // stays behind the explicit Create Booking Link tap.
  const saveAvailability = useCallback(async () => {
    if (!availDirtyRef.current || !windowsValid) return;
    availDirtyRef.current = false;
    try {
      const fn = httpsCallable(functions, 'createPlaybookBookingLink');
      // saveOnly: persist availability without minting a booking link — the
      // shareable link is still only created by the explicit button tap.
      const res = await fn({
        playbookId,
        windows: daySlotsToWindows(daySlots),
        timezone,
        locations: locations.map((l) => l.trim()).filter(Boolean),
        dateOverrides,
        saveOnly: true,
      });
      const tok = (res.data as { token: string | null })?.token;
      if (tok && !linkToken) setLinkToken(tok);
      setAvailSaved(true);
      setTimeout(() => setAvailSaved(false), 2000);
    } catch (e: any) {
      console.error('[PlaybookSchedulePanel] availability auto-save error:', e);
      setLinkError(e?.message || 'Could not save availability');
    }
  }, [daySlots, dateOverrides, locations, linkToken, windowsValid, playbookId, timezone]);

  useEffect(() => {
    if (!availDirtyRef.current || !windowsValid) return;
    const t = setTimeout(() => { void saveAvailability(); }, 800);
    return () => clearTimeout(t);
  }, [daySlots, dateOverrides, locations, windowsValid, playbookId, timezone, saveAvailability]);

  // Closing the panel inside the 800ms debounce window used to clear the
  // timer and silently drop the last edit — flush pending saves on close and
  // unmount. The dirty-flag guards inside the save fns keep snapshot prefill
  // from ever triggering a write.
  const flushPendingSavesRef = useRef<() => void>(() => {});
  flushPendingSavesRef.current = () => {
    if (dayDirtyRef.current) saveDaySettings();
    if (availDirtyRef.current) void saveAvailability();
    if (sessionCfgDirtyRef.current) saveSessionSettings();
    // Title/description normally save on blur, but closing the panel (or the
    // Modal unmounting) doesn't fire blur — flush those too.
    if (titleDirty.current) void saveTitle();
    if (descDirty.current) void saveDescription();
  };
  useEffect(() => {
    if (!visible) flushPendingSavesRef.current();
  }, [visible]);
  useEffect(() => () => flushPendingSavesRef.current(), []);

  const openPreview = useCallback(() => {
    if (!linkToken) return;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.open(`${bookingUrl}?preview=1`, '_blank');
    } else {
      onClose();
      router.push(`/book/${linkToken}?preview=1`);
    }
  }, [linkToken, bookingUrl, onClose]);

  const copyLink = useCallback(async () => {
    if (!bookingUrl) return;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(bookingUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  }, [bookingUrl]);

  const bookedCount = results?.filter((r) => r.status === 'booked').length ?? 0;
  const problems = results?.filter((r) => r.status !== 'booked') ?? [];
  const conflictCount = problems.filter((r) => r.status === 'conflict').length;
  const capCount = problems.filter((r) => r.status === 'cap_reached').length;

  const dragTileStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragTY.value }],
  }));

  const tileBody = (w: string) => (
    <>
      <WorkoutMosaic thumbs={workoutThumbs[w] ?? []} width={TILE_W} height={TILE_H} scrollIdle center />
      <View style={s.workoutTileNameBar}>
        <Text style={s.workoutTileText} numberOfLines={1}>
          {workoutNames[w] || 'Workout'}
        </Text>
        <Text style={s.workoutTileHint}>hold + drag</Text>
      </View>
    </>
  );

  const renderWorkoutTile = (moduleIdx: number) => {
    const wid = workoutForModule(moduleIdx);
    if (!wid) {
      return (
        <View style={[s.workoutTile, { opacity: 0.4, alignItems: 'center', justifyContent: 'center' }]}>
          <Text style={s.workoutTileText} numberOfLines={2}>No workout</Text>
        </View>
      );
    }
    const isDragging = dragFromIdx === moduleIdx;
    const isGhostTarget = dragFromIdx !== null && dragFromIdx !== moduleIdx && dragOverIdx === moduleIdx;
    // Live swap preview: the hovered target's workout renders in the SOURCE
    // slot instantly (underlay below), and the target slot shows a ghost of
    // the in-hand workout. Dragging back home reverses both instantly.
    const shownWid = isGhostTarget && dragFromIdx !== null
      ? (workoutForModule(dragFromIdx) ?? wid)
      : wid;
    // What the source slot shows underneath the floating tile.
    const underWid = isDragging && dragOverIdx !== null ? workoutForModule(dragOverIdx) : null;
    const pan = Gesture.Pan()
      .activateAfterLongPress(250)
      .onStart(() => {
        dragActiveIdx.value = moduleIdx;
        dragTY.value = 0;
        runOnJS(setDragFromIdx)(moduleIdx);
      })
      .onUpdate((e) => {
        dragTY.value = e.translationY;
        runOnJS(hoverModule)(moduleIdx, e.translationY);
      })
      .onEnd((e) => {
        // Snap animation owns dragTY from here — finishDrag/commitSwap clear
        // state when it lands.
        runOnJS(finishDrag)(moduleIdx, e.translationY);
      })
      .onFinalize((_e, success) => {
        if (!success) runOnJS(endDrag)();
      });
    return (
      <View style={{ width: TILE_W, height: TILE_H }}>
        {isDragging && (
          underWid ? (
            <View style={[s.workoutTile, StyleSheet.absoluteFillObject]}>
              {tileBody(underWid)}
            </View>
          ) : (
            <View style={[s.workoutTile, StyleSheet.absoluteFillObject, { opacity: 0.25 }]} />
          )
        )}
        {/* touchAction pan-y: without it RNGH web sets touch-action:none and
            the page can't scroll when a touch starts on a workout tile. */}
        <GestureDetector gesture={pan} touchAction="pan-y">
          <Animated.View
            style={[
              s.workoutTile,
              isDragging && StyleSheet.absoluteFillObject,
              isDragging && dragTileStyle,
              isDragging && { zIndex: 10, elevation: 10, borderColor: '#A78BFA', borderWidth: 1 },
              isGhostTarget && { opacity: 0.45, borderColor: '#A78BFA', borderWidth: 1 },
            ]}
          >
            {tileBody(shownWid)}
          </Animated.View>
        </GestureDetector>
      </View>
    );
  };

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            scrollEnabled={dragFromIdx === null}
          >
            {/* A5: inline editable title */}
            <Text style={s.sectionLabel}>Playbook Title</Text>
            <TextInput
              style={s.titleInput}
              value={titleDraft}
              onChangeText={(v) => { titleDirty.current = true; setTitleDraft(v); }}
              onBlur={saveTitle}
              placeholder="Playbook name"
              placeholderTextColor="#4A5568"
              maxLength={80}
            />
            {hasMember ? (
              <Text style={s.subtitle}>Sessions for {memberName || 'assigned member'}</Text>
            ) : (
              <Text style={[s.subtitle, { color: '#F5A623' }]}>
                Add a member to this playbook before scheduling.
              </Text>
            )}

            <Text style={s.sectionLabel}>Description</Text>
            <Text style={s.hint}>Shown on the public booking page under the title.</Text>
            <TextInput
              style={s.descInput}
              value={descDraft}
              onChangeText={(v) => { descDirty.current = true; setDescDraft(v); }}
              onBlur={saveDescription}
              placeholder="What this program is about…"
              placeholderTextColor="#4A5568"
              multiline
              maxLength={400}
            />

            <Text style={s.sectionLabel}>Members</Text>
            {playbookMemberIds.map((id) => (
              <View key={id} style={s.memberRow}>
                <Text style={s.memberRowName} numberOfLines={1}>{nameOf(id)}</Text>
                <Pressable
                  style={s.windowRemove}
                  disabled={memberBusy}
                  onPress={() => writeMembers(playbookMemberIds.filter((x) => x !== id))}
                >
                  <Text style={s.windowRemoveText}>×</Text>
                </Pressable>
              </View>
            ))}
            {playbookMemberIds.length === 0 && (
              <Text style={s.hint}>No members on this playbook yet.</Text>
            )}
            <Pressable style={s.addWindowBtn} onPress={() => setMemberPickerOpen((v) => !v)}>
              <Text style={s.addWindowText}>{memberPickerOpen ? 'Close member list' : '+ Add member'}</Text>
            </Pressable>
            {memberPickerOpen && (
              <ScrollView style={s.memberPicker} nestedScrollEnabled>
                {coachMembers.filter((m) => !playbookMemberIds.includes(m.id)).length === 0 && (
                  <Text style={s.hint}>All your members are already on this playbook.</Text>
                )}
                {coachMembers
                  .filter((m) => !playbookMemberIds.includes(m.id))
                  .map((m) => (
                    <Pressable
                      key={m.id}
                      style={s.memberPickRow}
                      disabled={memberBusy}
                      onPress={() => { writeMembers([...playbookMemberIds, m.id]); setMemberPickerOpen(false); }}
                    >
                      <Text style={s.memberPickName} numberOfLines={1}>{m.name}</Text>
                      <Text style={s.memberPickAdd}>Add</Text>
                    </Pressable>
                  ))}
              </ScrollView>
            )}

            {/* B6: day chips reveal per-day modules */}
            <Text style={s.sectionLabel}>Days</Text>
            <View style={s.chipRow}>
              {DAY_SHORT_LABELS.map((label, i) => (
                <Pressable
                  key={label}
                  style={[s.dayChip, days.includes(i) && s.dayChipActive]}
                  onPress={() => toggleDay(i)}
                >
                  <Text style={[s.dayChipText, days.includes(i) && s.dayChipTextActive]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            {sortedDays.length === 0 && (
              <Text style={s.hint}>Tap the days you train — each day gets its own time and style.</Text>
            )}

            {sortedDays.map((d, k) => {
              const cfg = dayConfigs[d] || DEFAULT_CONFIG;
              const isOver = dragOverIdx === k && dragFromIdx !== null && dragFromIdx !== k;
              const dur = parseDuration(cfg.duration);
              const moduleWorkoutId = workoutForModule(k);
              const estMin = moduleWorkoutId ? workoutDurations[moduleWorkoutId] : null;
              return (
                <View
                  key={d}
                  style={[
                    s.dayModule,
                    isOver && { borderColor: '#A78BFA', borderWidth: 1 },
                    // Dragged tile must float over LATER sibling modules, not
                    // slide behind them — lift its whole module while dragging.
                    dragFromIdx === k && { zIndex: 20, elevation: 20 },
                  ]}
                  onLayout={(e) => {
                    moduleLayouts.current[k] = {
                      y: e.nativeEvent.layout.y,
                      h: e.nativeEvent.layout.height,
                    };
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={s.dayModuleTitle}>{DAY_SHORT_LABELS[d]}</Text>
                    <View style={s.dayTimeRow}>
                      <TextInput
                        style={[s.dayTimeInput, !cfg.time && s.inputBad]}
                        value={cfg.raw}
                        onChangeText={(v) => setDayTime(d, v)}
                        onBlur={() => blurDayTime(d)}
                        placeholder="7:00 AM"
                        placeholderTextColor="#4A5568"
                        autoCapitalize="none"
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                      />
                      {cfg.time && cfg.raw !== formatTime12(cfg.time) && (
                        <Text style={s.dayTimePreview}>{formatTime12(cfg.time)}</Text>
                      )}
                    </View>
                    <View style={[s.chipRow, { marginTop: 8, alignItems: 'center' }]}>
                      {DURATIONS.map((preset) => (
                        <Pressable
                          key={preset}
                          style={[s.miniChip, dur === preset && s.chipActive]}
                          onPress={() => setDayDuration(d, String(preset))}
                        >
                          <Text style={[s.miniChipText, dur === preset && s.chipTextActive]}>{preset}</Text>
                        </Pressable>
                      ))}
                      <TextInput
                        style={[s.durationInput, dur === null && s.inputBad]}
                        value={cfg.duration}
                        onChangeText={(v) => setDayDuration(d, v)}
                        keyboardType="numeric"
                        placeholder="min"
                        placeholderTextColor="#4A5568"
                        returnKeyType="done"
                        onSubmitEditing={Keyboard.dismiss}
                      />
                      <Text style={s.durationUnit}>min</Text>
                      {estMin ? <Text style={s.durationUnit}>· workout est. ~{estMin} min</Text> : null}
                    </View>
                    <View style={[s.chipRow, { marginTop: 8 }]}>
                      {(Object.keys(PLAYBOOK_SESSION_KIND_LABELS) as PlaybookSessionKind[]).map((kind) => (
                        <Pressable
                          key={kind}
                          style={[s.kindChip, cfg.kind === kind && s.chipActive]}
                          onPress={() => setDayKind(d, kind)}
                        >
                          <Text style={[s.kindChipText, cfg.kind === kind && s.chipTextActive]}>
                            {PLAYBOOK_SESSION_KIND_LABELS[kind]}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  {renderWorkoutTile(k)}
                </View>
              );
            })}
            {sortedDays.length > 0 && workoutIds.length > 0 && (
              <Text style={s.hint}>
                Workouts follow your playbook order — hold and drag a workout card to another day to
                rearrange.{ROTATE_AT_END && sortedDays.length > workoutIds.length
                  ? ' Extra days rotate back to the first workout.'
                  : ''}
              </Text>
            )}

            <View style={s.switchRow}>
              <Text style={s.switchLabel}>Record sessions</Text>
              <Switch
                value={recordingEnabled}
                onValueChange={(v) => { sessionCfgDirtyRef.current = true; setRecordingEnabled(v); }}
                trackColor={{ false: '#4A5568', true: '#A78BFA' }}
                thumbColor="#F0F4F8"
              />
            </View>

            <View style={s.stepperRow}>
              <Text style={s.switchLabel}>Book ahead</Text>
              <View style={s.stepper}>
                <Pressable style={s.stepBtn} onPress={() => { sessionCfgDirtyRef.current = true; setHorizonWeeks((w) => Math.max(2, w - 1)); }}>
                  <Text style={s.stepBtnText}>−</Text>
                </Pressable>
                <Text style={s.stepValue}>{horizonWeeks} wks</Text>
                <Pressable style={s.stepBtn} onPress={() => { sessionCfgDirtyRef.current = true; setHorizonWeeks((w) => Math.min(8, w + 1)); }}>
                  <Text style={s.stepBtnText}>+</Text>
                </Pressable>
              </View>
            </View>

            <View style={s.stepperRow}>
              <Text style={s.switchLabel}>Weekly session cap</Text>
              <View style={s.stepper}>
                <Pressable
                  style={s.stepBtn}
                  onPress={() => { sessionCfgDirtyRef.current = true; setWeeklyCap((c) => (c === null || c <= 1 ? null : c - 1)); }}
                >
                  <Text style={s.stepBtnText}>−</Text>
                </Pressable>
                <Text style={s.stepValue}>{weeklyCap === null ? 'Off' : weeklyCap}</Text>
                <Pressable
                  style={s.stepBtn}
                  onPress={() => { sessionCfgDirtyRef.current = true; setWeeklyCap((c) => Math.min(7, (c ?? 0) + 1)); }}
                >
                  <Text style={s.stepBtnText}>+</Text>
                </Pressable>
              </View>
            </View>

            {/* B9: cancel upcoming sessions */}
            {upcoming.length > 0 && (
              <>
                <Text style={s.sectionLabel}>Upcoming Sessions</Text>
                {upcoming.map((u) => (
                  <View key={u.id} style={s.upcomingRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.upcomingDate}>
                        {u.scheduledDate || new Date(u.startUtcMillis).toLocaleDateString()}
                        {u.scheduledStartTime ? ` · ${formatTime12(u.scheduledStartTime)}` : ''}
                      </Text>
                      {!!u.memberName && <Text style={s.upcomingMember}>{u.memberName}</Text>}
                    </View>
                    <Pressable
                      style={s.cancelBtn}
                      disabled={cancelBusyId === u.id}
                      onPress={() => cancelSession(u.id)}
                    >
                      <Text style={s.cancelBtnText}>
                        {cancelBusyId === u.id ? 'Cancelling…' : 'Cancel'}
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </>
            )}

            <Text style={s.sectionLabel}>Booking Link</Text>
            <Text style={s.hint}>
              Let the member pick their own times from your availability. The public page shows the
              playbook title only — never workout details.
            </Text>
            {/* Weekly hours — one row per day, Calendly pattern */}
            <View style={s.weeklyHours}>
              {DAY_SHORT_LABELS.map((label, d) => {
                const slots = daySlots[d];
                const enabled = slots.length > 0;
                return (
                  <View key={label} style={s.whDayRow}>
                    <View style={[s.whDayCircle, enabled && s.whDayCircleActive]}>
                      <Text style={[s.whDayCircleText, enabled && s.whDayCircleTextActive]}>
                        {label[0]}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      {!enabled && <Text style={s.whUnavailable}>Unavailable</Text>}
                      {slots.map((sl, i) => {
                        const rangeBad = !!sl.start && !!sl.end && sl.start >= sl.end;
                        return (
                          <View key={i} style={[s.whSlotRow, i > 0 && { marginTop: 6 }]}>
                            <TextInput
                              style={[s.whTimeInput, (!sl.start || rangeBad) && s.inputBad]}
                              value={sl.startRaw}
                              onChangeText={(v) => setSlotTime(d, i, 'start', v)}
                              onBlur={() => blurSlotTime(d, i, 'start')}
                              placeholder="9:00 AM"
                              placeholderTextColor="#4A5568"
                              autoCapitalize="none"
                              returnKeyType="done"
                              onSubmitEditing={Keyboard.dismiss}
                            />
                            <Text style={s.windowDash}>–</Text>
                            <TextInput
                              style={[s.whTimeInput, (!sl.end || rangeBad) && s.inputBad]}
                              value={sl.endRaw}
                              onChangeText={(v) => setSlotTime(d, i, 'end', v)}
                              onBlur={() => blurSlotTime(d, i, 'end')}
                              placeholder="5:00 PM"
                              placeholderTextColor="#4A5568"
                              autoCapitalize="none"
                              returnKeyType="done"
                              onSubmitEditing={Keyboard.dismiss}
                            />
                            <Pressable style={s.windowRemove} onPress={() => removeDaySlot(d, i)}>
                              <Text style={s.windowRemoveText}>×</Text>
                            </Pressable>
                          </View>
                        );
                      })}
                    </View>
                    <Pressable style={s.whPlusBtn} onPress={() => addDaySlot(d)}>
                      <Text style={s.whPlusText}>+</Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[s.hint, { flex: 1 }]}>
                Times shown in {timezone}. Overlapping ranges on a day are merged when saved.
              </Text>
              {availSaved && <Text style={s.savedNote}>Saved</Text>}
            </View>

            {/* Date-specific hours (Calendly pattern) */}
            <View style={s.ovEntryRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.ovEntryTitle}>Date-specific hours</Text>
                <Text style={s.hint}>Adjust hours for specific days</Text>
              </View>
              <Pressable style={s.ovHoursBtn} onPress={openOverrideModal}>
                <Text style={s.ovHoursBtnText}>+ Hours</Text>
              </Pressable>
            </View>
            {dateOverrides.map((o) => (
              <View key={o.date} style={s.ovRow}>
                <Text style={s.ovRowDate}>{formatDateShort(o.date)}</Text>
                <Text style={s.ovRowHours} numberOfLines={2}>
                  {o.intervals.length === 0
                    ? 'Unavailable'
                    : o.intervals.map((iv) => `${formatTime12(iv.start)} – ${formatTime12(iv.end)}`).join(', ')}
                </Text>
                <Pressable style={s.windowRemove} onPress={() => removeOverride(o.date)}>
                  <Text style={s.windowRemoveText}>×</Text>
                </Pressable>
              </View>
            ))}
            {dateOverrides.length > 0 && (
              <Text style={s.hint}>
                These dates replace your weekly hours. Unavailable = no bookings that day.
                {linkToken ? ' Changes save automatically.' : ' Tap Create Booking Link to save.'}
              </Text>
            )}

            <Text style={s.sectionLabel}>Locations</Text>
            <Text style={s.hint}>
              Optional — where sessions can happen (e.g. Condo gym, Hotel). The member picks one when booking.
            </Text>
            {locations.map((loc, i) => (
              <View key={i} style={s.windowRow}>
                <TextInput
                  style={[s.timeInput, { flex: 1, width: undefined, textAlign: 'left' }]}
                  value={loc}
                  onChangeText={(v) => { availDirtyRef.current = true; setLocations((prev) => prev.map((x, idx) => (idx === i ? v : x))); setLinkError(null); }}
                  placeholder="Condo gym"
                  placeholderTextColor="#4A5568"
                  maxLength={80}
                />
                <Pressable
                  style={s.windowRemove}
                  onPress={() => { availDirtyRef.current = true; setLocations((prev) => prev.filter((_, idx) => idx !== i)); }}
                >
                  <Text style={s.windowRemoveText}>×</Text>
                </Pressable>
              </View>
            ))}
            {locations.length < 10 && (
              <Pressable style={s.addWindowBtn} onPress={() => setLocations((prev) => [...prev, ''])}>
                <Text style={s.addWindowText}>+ Add location option</Text>
              </Pressable>
            )}
            {hasAnySlot && !linkToken && (
              <Pressable
                style={[s.btn, { backgroundColor: windowsValid && !linkBusy ? '#1E2A3A' : '#161D29', borderWidth: 1, borderColor: '#A78BFA', marginTop: 10 }]}
                onPress={createLink}
                disabled={!windowsValid || linkBusy}
              >
                <Text style={{ color: '#A78BFA', fontWeight: '700', fontFamily: FH }}>
                  {linkBusy ? 'Saving…' : 'Create Booking Link'}
                </Text>
              </Pressable>
            )}
            {linkError && <Text style={s.error}>{linkError}</Text>}
            {bookingUrl && (
              <View style={s.linkBox}>
                <Text style={s.linkUrl} numberOfLines={1}>{bookingUrl}</Text>
                <Pressable
                  style={({ pressed }) => [s.copyBtn, pressed && { opacity: 0.55, transform: [{ scale: 0.96 }] }]}
                  onPress={copyLink}
                >
                  <Text style={s.copyBtnText}>{linkCopied ? 'Copied' : 'Copy'}</Text>
                </Pressable>
                <Pressable style={s.previewBtn} onPress={openPreview}>
                  <Text style={s.previewBtnText}>Preview</Text>
                </Pressable>
              </View>
            )}

            {error && <Text style={s.error}>{error}</Text>}
            {results && (
              <View style={s.resultBox}>
                <Text style={s.resultTitle}>
                  {bookedCount} of {results.length} session{results.length === 1 ? '' : 's'} created
                  {conflictCount > 0 ? ` — ${conflictCount} conflict${conflictCount === 1 ? '' : 's'}` : ''}
                  {capCount > 0 ? ` — ${capCount} at weekly cap` : ''}
                </Text>
                {problems.map((p) => (
                  <Text key={p.date} style={s.resultProblem}>
                    {p.date}: {p.status === 'cap_reached' ? 'weekly cap reached' : `conflict — ${p.reason || 'time taken'}`}
                  </Text>
                ))}
              </View>
            )}

            <View style={{ flexDirection: 'row', gap: 12, marginTop: 20 }}>
              <Pressable style={[s.btn, { backgroundColor: '#0E1117' }]} onPress={onClose}>
                <Text style={{ color: '#8A95A3', fontWeight: '600', fontFamily: FB }}>Close</Text>
              </Pressable>
              <Pressable
                style={[s.btn, { backgroundColor: canBook ? '#A78BFA' : '#4A5568', flex: 1 }]}
                onPress={book}
                disabled={!canBook}
              >
                <Text style={{ color: '#0E1117', fontWeight: '700', fontFamily: FH }}>
                  {booking ? (checkingStatus ? 'Checking status…' : 'Booking…') : 'Book Sessions'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>

          {/* Date-specific hours modal — overlay (not a nested Modal) */}
          {ovOpen && (() => {
            const today = todayInTz(timezone);
            const [ty, tm] = today.split('-').map(Number);
            const atCurrentMonth = ovMonth.y === ty && ovMonth.m === tm - 1;
            const firstDow = new Date(ovMonth.y, ovMonth.m, 1).getDay();
            const daysInMonth = new Date(ovMonth.y, ovMonth.m + 1, 0).getDate();
            const cells: Array<number | null> = [
              ...Array.from({ length: firstDow }, () => null),
              ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
            ];
            while (cells.length % 7 !== 0) cells.push(null);
            const weeks: Array<Array<number | null>> = [];
            for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
            return (
              <View style={s.ovOverlay}>
                <ScrollView
                  style={{ flex: 1 }}
                  contentContainerStyle={{ paddingBottom: 12 }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <Text style={s.ovModalTitle}>
                    Select the date(s) you want to assign specific hours
                  </Text>
                  <View style={s.ovMonthHeader}>
                    <Pressable
                      style={[s.ovNavBtn, atCurrentMonth && { opacity: 0.3 }]}
                      disabled={atCurrentMonth}
                      onPress={() => setOvMonth((p) => (p.m === 0 ? { y: p.y - 1, m: 11 } : { y: p.y, m: p.m - 1 }))}
                    >
                      <Text style={s.ovNavText}>‹</Text>
                    </Pressable>
                    <Text style={s.ovMonthLabel}>{MONTH_LABELS[ovMonth.m]} {ovMonth.y}</Text>
                    <Pressable
                      style={s.ovNavBtn}
                      onPress={() => setOvMonth((p) => (p.m === 11 ? { y: p.y + 1, m: 0 } : { y: p.y, m: p.m + 1 }))}
                    >
                      <Text style={s.ovNavText}>›</Text>
                    </Pressable>
                  </View>
                  <View style={s.ovWeekRow}>
                    {DAY_SHORT_LABELS.map((l) => (
                      <Text key={l} style={s.ovWeekday}>{l[0]}</Text>
                    ))}
                  </View>
                  {weeks.map((week, wi) => (
                    <View key={wi} style={s.ovWeekRow}>
                      {week.map((dayNum, ci) => {
                        if (dayNum === null) return <View key={ci} style={s.ovDayCell} />;
                        const dateStr = `${ovMonth.y}-${String(ovMonth.m + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
                        const past = dateStr < today;
                        const selected = ovDates.includes(dateStr);
                        const hasOverride = dateOverrides.some((o) => o.date === dateStr);
                        return (
                          <Pressable
                            key={ci}
                            style={[s.ovDayCell, selected && s.ovDayCellSelected]}
                            disabled={past}
                            onPress={() => toggleOvDate(dateStr)}
                          >
                            <Text style={[
                              s.ovDayText,
                              past && { color: '#4A5568' },
                              selected && { color: '#0E1117', fontWeight: '700' },
                            ]}>
                              {dayNum}
                            </Text>
                            {hasOverride && !selected && <View style={s.ovDayDot} />}
                          </Pressable>
                        );
                      })}
                    </View>
                  ))}

                  <View style={s.ovHoursHeader}>
                    <Text style={s.ovHoursTitle}>What hours are you available?</Text>
                    <Pressable style={s.whPlusBtn} onPress={addOvSlot}>
                      <Text style={s.whPlusText}>+</Text>
                    </Pressable>
                  </View>
                  {ovSlots.length === 0 && (
                    <Text style={s.hint}>No hours — the selected dates will be unavailable.</Text>
                  )}
                  {ovSlots.map((sl, i) => {
                    const rangeBad = !!sl.start && !!sl.end && sl.start >= sl.end;
                    return (
                      <View key={i} style={[s.whSlotRow, { marginTop: 8 }]}>
                        <TextInput
                          style={[s.whTimeInput, (!sl.start || rangeBad) && s.inputBad]}
                          value={sl.startRaw}
                          onChangeText={(v) => setOvSlotTime(i, 'start', v)}
                          onBlur={() => blurOvSlotTime(i, 'start')}
                          placeholder="9:00 AM"
                          placeholderTextColor="#4A5568"
                          autoCapitalize="none"
                          returnKeyType="done"
                          onSubmitEditing={Keyboard.dismiss}
                        />
                        <Text style={s.windowDash}>–</Text>
                        <TextInput
                          style={[s.whTimeInput, (!sl.end || rangeBad) && s.inputBad]}
                          value={sl.endRaw}
                          onChangeText={(v) => setOvSlotTime(i, 'end', v)}
                          onBlur={() => blurOvSlotTime(i, 'end')}
                          placeholder="5:00 PM"
                          placeholderTextColor="#4A5568"
                          autoCapitalize="none"
                          returnKeyType="done"
                          onSubmitEditing={Keyboard.dismiss}
                        />
                        <Pressable style={s.windowRemove} onPress={() => removeOvSlot(i)}>
                          <Text style={s.windowRemoveText}>×</Text>
                        </Pressable>
                      </View>
                    );
                  })}

                </ScrollView>
                {/* Fixed footer — Apply/Cancel stay reachable no matter how many
                    interval rows the scrollable body grows to. */}
                <View style={s.ovFooter}>
                  <Pressable
                    style={[s.btn, { backgroundColor: canApplyOv ? '#A78BFA' : '#4A5568' }]}
                    onPress={applyOverrides}
                    disabled={!canApplyOv}
                  >
                    <Text style={{ color: '#0E1117', fontWeight: '700', fontFamily: FH }}>Apply</Text>
                  </Pressable>
                  <Pressable
                    style={[s.btn, { backgroundColor: '#0E1117', marginTop: 10 }]}
                    onPress={() => setOvOpen(false)}
                  >
                    <Text style={{ color: '#8A95A3', fontWeight: '600', fontFamily: FB }}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            );
          })()}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: '#1E2A3A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '88%',
  },
  titleInput: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    backgroundColor: '#0E1117',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  descInput: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 12,
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    marginTop: 8,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  subtitle: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 8,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4A5568',
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
    fontFamily: FH,
    textTransform: 'uppercase',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dayChip: {
    width: 42,
    paddingVertical: 8,
    backgroundColor: '#0E1117',
    borderRadius: 20,
    alignItems: 'center',
  },
  dayChipActive: {
    backgroundColor: '#A78BFA',
  },
  dayChipText: {
    color: '#8A95A3',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FB,
  },
  dayChipTextActive: {
    color: '#0E1117',
  },
  dayModule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0E1117',
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
  },
  dayModuleTitle: {
    color: '#F0F4F8',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
  },
  dayTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  dayTimeInput: {
    backgroundColor: '#1E2A3A',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    width: 110,
  },
  dayTimePreview: {
    color: '#A78BFA',
    fontSize: 12,
    fontFamily: FB,
  },
  miniChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#1E2A3A',
    borderRadius: 14,
  },
  miniChipText: {
    color: '#8A95A3',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: FB,
  },
  durationInput: {
    backgroundColor: '#1E2A3A',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    color: '#F0F4F8',
    fontSize: 13,
    fontFamily: FB,
    width: 56,
  },
  durationUnit: {
    color: '#4A5568',
    fontSize: 11,
    fontFamily: FB,
  },
  kindChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#1E2A3A',
    borderRadius: 14,
  },
  kindChipText: {
    color: '#8A95A3',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: FB,
  },
  workoutTile: {
    width: TILE_W,
    height: TILE_H,
    borderRadius: 12,
    backgroundColor: WORKOUT_CARD_BG,
    overflow: 'hidden',
  },
  workoutTileNameBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(14,17,23,0.78)',
    paddingVertical: 3,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  workoutTileText: {
    color: '#F0F4F8',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FH,
    textAlign: 'center',
  },
  workoutTileHint: {
    color: '#8A95A3',
    fontSize: 9,
    fontFamily: FB,
    marginTop: 1,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#0E1117',
    borderRadius: 20,
  },
  chipActive: {
    backgroundColor: '#A78BFA',
  },
  chipText: {
    color: '#8A95A3',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FB,
  },
  chipTextActive: {
    color: '#0E1117',
  },
  hint: {
    color: '#4A5568',
    fontSize: 12,
    fontFamily: FB,
    marginTop: 6,
  },
  savedNote: {
    color: '#6EE7B7',
    fontSize: 12,
    fontFamily: FB,
    marginTop: 6,
    marginLeft: 8,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  switchLabel: {
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
  },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0E1117',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    color: '#A78BFA',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FH,
  },
  stepValue: {
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    minWidth: 48,
    textAlign: 'center',
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: '#E5484D',
    fontSize: 13,
    fontFamily: FB,
    marginTop: 14,
  },
  upcomingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1117',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 6,
    gap: 8,
  },
  upcomingDate: {
    color: '#F0F4F8',
    fontSize: 13,
    fontFamily: FB,
  },
  upcomingMember: {
    color: '#8A95A3',
    fontSize: 11,
    fontFamily: FB,
    marginTop: 2,
  },
  cancelBtn: {
    borderColor: '#E5484D',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  cancelBtnText: {
    color: '#E5484D',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FB,
  },
  windowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  weeklyHours: {
    marginTop: 10,
    gap: 10,
  },
  whDayRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  whDayCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#0E1117',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  whDayCircleActive: {
    backgroundColor: '#A78BFA',
  },
  whDayCircleText: {
    color: '#8A95A3',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FB,
  },
  whDayCircleTextActive: {
    color: '#0E1117',
  },
  whUnavailable: {
    color: '#4A5568',
    fontSize: 13,
    fontFamily: FB,
    paddingVertical: 8,
  },
  whSlotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  whTimeInput: {
    backgroundColor: '#0E1117',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    color: '#F0F4F8',
    fontSize: 13,
    fontFamily: FB,
    width: 84,
    textAlign: 'center',
  },
  whPlusBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#0E1117',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  whPlusText: {
    color: '#A78BFA',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FH,
  },
  timeInput: {
    backgroundColor: '#0E1117',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    color: '#F0F4F8',
    fontSize: 13,
    fontFamily: FB,
    width: 62,
    textAlign: 'center',
  },
  inputBad: {
    borderColor: '#E5484D',
    borderWidth: 1,
  },
  windowDash: {
    color: '#4A5568',
    fontSize: 14,
    fontFamily: FB,
  },
  windowRemove: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#0E1117',
    alignItems: 'center',
    justifyContent: 'center',
  },
  windowRemoveText: {
    color: '#E5484D',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FB,
  },
  addWindowBtn: {
    marginTop: 10,
  },
  addWindowText: {
    color: '#A78BFA',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FB,
  },
  linkBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 10,
    marginTop: 10,
    gap: 8,
  },
  linkUrl: {
    flex: 1,
    color: '#8A95A3',
    fontSize: 12,
    fontFamily: FB,
  },
  copyBtn: {
    backgroundColor: '#A78BFA',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  copyBtnText: {
    color: '#0E1117',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FB,
  },
  previewBtn: {
    borderColor: '#A78BFA',
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  previewBtnText: {
    color: '#A78BFA',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FB,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0E1117',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 6,
    gap: 8,
  },
  memberRowName: {
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    flex: 1,
  },
  memberPicker: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 8,
    marginTop: 8,
    maxHeight: 220,
    overflow: 'hidden',
  },
  memberPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 6,
    gap: 8,
  },
  memberPickName: {
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    flex: 1,
  },
  memberPickAdd: {
    color: '#A78BFA',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FB,
  },
  ovEntryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  ovEntryTitle: {
    color: '#F0F4F8',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
  },
  ovHoursBtn: {
    borderColor: '#A78BFA',
    borderWidth: 1,
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  ovHoursBtnText: {
    color: '#A78BFA',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FB,
  },
  ovRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1117',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginTop: 6,
    gap: 10,
  },
  ovRowDate: {
    color: '#F0F4F8',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FB,
    width: 92,
  },
  ovRowHours: {
    flex: 1,
    color: '#8A95A3',
    fontSize: 12,
    fontFamily: FB,
  },
  ovOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#1E2A3A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    overflow: 'hidden',
  },
  ovFooter: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2A3648',
  },
  ovModalTitle: {
    color: '#F0F4F8',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FH,
  },
  ovMonthHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
  },
  ovNavBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#0E1117',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ovNavText: {
    color: '#A78BFA',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FH,
  },
  ovMonthLabel: {
    color: '#F0F4F8',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
  },
  ovWeekRow: {
    flexDirection: 'row',
    marginTop: 6,
  },
  ovWeekday: {
    flex: 1,
    textAlign: 'center',
    color: '#4A5568',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FB,
  },
  ovDayCell: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ovDayCellSelected: {
    backgroundColor: '#A78BFA',
  },
  ovDayText: {
    color: '#F0F4F8',
    fontSize: 13,
    fontFamily: FB,
  },
  ovDayDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#A78BFA',
    marginTop: 2,
  },
  ovHoursHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  ovHoursTitle: {
    color: '#F0F4F8',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
  },
  resultBox: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
  },
  resultTitle: {
    color: '#4ADE80',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
  },
  resultProblem: {
    color: '#F5A623',
    fontSize: 12,
    fontFamily: FB,
    marginTop: 4,
  },
});
