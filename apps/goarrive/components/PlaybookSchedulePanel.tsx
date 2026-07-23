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
  Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import {
  collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query,
  serverTimestamp, updateDoc, where, Timestamp,
} from 'firebase/firestore';
import { router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, runOnJS } from 'react-native-reanimated';
import { db, functions } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import {
  DAY_SHORT_LABELS,
  PLAYBOOK_SESSION_KIND_LABELS,
  PlaybookSessionKind,
} from '../lib/schedulingTypes';
import { WorkoutMosaic, WORKOUT_CARD_BG } from './WorkoutMosaic';

const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const DURATIONS = [30, 45, 60];

// Day-module workout tile — 4:5 aspect ratio, same as workout cards on Build.
const TILE_W = 108;
const TILE_H = 135;

// Hard client-side deadline on the booking callable: if the underlying request
// dies without settling (e.g. iOS PWA suspended mid-flight), the footer must
// never stay stuck on "Booking…".
const BOOKING_TIMEOUT_MS = 45000;

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

interface BookingWindowRow {
  days: number[];
  startTime: string;
  endTime: string;
}

// booking_windows docs written before multi-day support carry dayOfWeek.
function normalizeWindow(w: any): BookingWindowRow {
  return {
    days: Array.isArray(w?.days) ? w.days : (typeof w?.dayOfWeek === 'number' ? [w.dayOfWeek] : []),
    startTime: w?.startTime || '09:00',
    endTime: w?.endTime || '12:00',
  };
}

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
  const [results, setResults] = useState<BookResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prefilledRef = useRef(false);

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

  // Booking link (Phase 3b): availability windows + public token URL
  const [windows, setWindows] = useState<BookingWindowRow[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
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
        if (data.recordingEnabled !== undefined) setRecordingEnabled(data.recordingEnabled !== false);
        if (data.repeatHorizonWeeks) setHorizonWeeks(data.repeatHorizonWeeks);
        if (data.weeklySessionCap !== undefined) setWeeklyCap(data.weeklySessionCap ?? null);
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
        if (Array.isArray(w) && w.length) setWindows(w.map(normalizeWindow));
        const locs = snap.data()?.locations;
        if (Array.isArray(locs)) setLocations(locs);
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
  const timezone = useMemo(
    () => playbook?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    [playbook?.timezone],
  );

  const toggleDay = useCallback((d: number) => {
    setDays((prev) => {
      if (prev.includes(d)) return prev.filter((x) => x !== d);
      return [...prev, d].sort((a, b) => a - b);
    });
    setDayConfigs((prev) => (prev[d] ? prev : { ...prev, [d]: { ...DEFAULT_CONFIG } }));
    setResults(null);
  }, []);

  const setDayTime = useCallback((d: number, raw: string) => {
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
    setDayConfigs((prev) => ({ ...prev, [d]: { ...(prev[d] || DEFAULT_CONFIG), kind } }));
    setResults(null);
  }, []);

  const setDayDuration = useCallback((d: number, v: string) => {
    setDayConfigs((prev) => ({
      ...prev,
      [d]: { ...(prev[d] || DEFAULT_CONFIG), duration: v.replace(/[^0-9]/g, '') },
    }));
    setResults(null);
  }, []);

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

  const moveWorkout = useCallback(async (fromModule: number, toModule: number) => {
    setDragFromIdx(null);
    setDragOverIdx(null);
    if (fromModule === toModule) return;
    const n = workoutIds.length;
    if (n === 0) return;
    const fromPos = fromModule < n ? fromModule : (ROTATE_AT_END ? fromModule % n : -1);
    const toPos = toModule < n ? toModule : (ROTATE_AT_END ? toModule % n : -1);
    if (fromPos < 0 || toPos < 0 || fromPos === toPos) return;
    const next = [...workoutIds];
    const [moved] = next.splice(fromPos, 1);
    next.splice(toPos, 0, moved);
    try {
      await updateDoc(doc(db, 'playbooks', playbookId), { workoutIds: next, updatedAt: serverTimestamp() });
    } catch (e) {
      console.error('[PlaybookSchedulePanel] workout reorder error:', e);
    }
  }, [workoutIds, playbookId]);

  const hoverModule = useCallback((fromIdx: number, ty: number) => {
    const from = moduleLayouts.current[fromIdx];
    if (!from) return;
    const centerY = from.y + from.h / 2 + ty;
    let target: number | null = null;
    for (const [k, r] of Object.entries(moduleLayouts.current)) {
      if (centerY >= r.y && centerY < r.y + r.h) { target = Number(k); break; }
    }
    setDragOverIdx(target);
  }, []);

  const finishDrag = useCallback((fromIdx: number, ty: number) => {
    const from = moduleLayouts.current[fromIdx];
    if (!from) { setDragFromIdx(null); setDragOverIdx(null); return; }
    const centerY = from.y + from.h / 2 + ty;
    let target = fromIdx;
    for (const [k, r] of Object.entries(moduleLayouts.current)) {
      if (centerY >= r.y && centerY < r.y + r.h) { target = Number(k); break; }
    }
    moveWorkout(fromIdx, target);
  }, [moveWorkout]);

  const sortedDays = days;

  const timesValid = sortedDays.length > 0
    && sortedDays.every((d) => !!dayConfigs[d]?.time && parseDuration(dayConfigs[d]?.duration ?? '') !== null);
  const canBook = hasMember && timesValid && !booking;

  const book = useCallback(async () => {
    if (!canBook) return;
    setBooking(true);
    setError(null);
    setResults(null);
    try {
      const daySettings = sortedDays.map((d) => ({
        dayOfWeek: d,
        startTime: dayConfigs[d]!.time as string,
        sessionKind: dayConfigs[d]!.kind,
        durationMinutes: parseDuration(dayConfigs[d]!.duration) as number,
      }));
      const fn = httpsCallable(functions, 'bookPlaybookSession');
      const call = fn({
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
      });
      const res = await Promise.race([
        call,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Booking timed out — check your connection and try again')), BOOKING_TIMEOUT_MS);
        }),
      ]);
      const data = (res as { data: { results: BookResult[] } }).data;
      setResults(data.results || []);
    } catch (e: any) {
      console.error('[PlaybookSchedulePanel] booking error:', e);
      setError(e?.message || 'Booking failed');
    } finally {
      setBooking(false);
    }
  }, [canBook, playbookId, sortedDays, dayConfigs, timezone, recordingEnabled, horizonWeeks, weeklyCap]);

  const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
  const windowsValid = windows.length > 0 && windows.every(
    (w) => w.days.length > 0 && timeRe.test(w.startTime) && timeRe.test(w.endTime) && w.startTime < w.endTime,
  );

  const bookingUrl = useMemo(() => {
    if (!linkToken) return null;
    const origin =
      Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://goarrive.fit';
    return `${origin}/book/${linkToken}`;
  }, [linkToken]);

  const updateWindow = useCallback((i: number, patch: Partial<BookingWindowRow>) => {
    setWindows((prev) => prev.map((w, idx) => (idx === i ? { ...w, ...patch } : w)));
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
        windows,
        timezone,
        locations: locations.map((l) => l.trim()).filter(Boolean),
      });
      const data = res.data as { token: string };
      setLinkToken(data.token);
    } catch (e: any) {
      console.error('[PlaybookSchedulePanel] booking link error:', e);
      setLinkError(e?.message || 'Could not create booking link');
    } finally {
      setLinkBusy(false);
    }
  }, [windowsValid, linkBusy, playbookId, windows, timezone, locations]);

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

  const dragTileStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dragTY.value }],
  }));

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
        runOnJS(finishDrag)(moduleIdx, e.translationY);
        dragTY.value = 0;
        dragActiveIdx.value = -1;
      })
      .onFinalize(() => {
        dragTY.value = 0;
        dragActiveIdx.value = -1;
      });
    return (
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            s.workoutTile,
            isDragging && dragTileStyle,
            isDragging && { zIndex: 10, elevation: 10, borderColor: '#A78BFA', borderWidth: 1 },
          ]}
        >
          <WorkoutMosaic thumbs={workoutThumbs[wid] ?? []} width={TILE_W} height={TILE_H} />
          <View style={s.workoutTileNameBar}>
            <Text style={s.workoutTileText} numberOfLines={1}>
              {workoutNames[wid] || 'Workout'}
            </Text>
            <Text style={s.workoutTileHint}>hold + drag</Text>
          </View>
        </Animated.View>
      </GestureDetector>
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
              <View style={s.memberPicker}>
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
              </View>
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
                onValueChange={setRecordingEnabled}
                trackColor={{ false: '#4A5568', true: '#A78BFA' }}
                thumbColor="#F0F4F8"
              />
            </View>

            <View style={s.stepperRow}>
              <Text style={s.switchLabel}>Book ahead</Text>
              <View style={s.stepper}>
                <Pressable style={s.stepBtn} onPress={() => setHorizonWeeks((w) => Math.max(2, w - 1))}>
                  <Text style={s.stepBtnText}>−</Text>
                </Pressable>
                <Text style={s.stepValue}>{horizonWeeks} wks</Text>
                <Pressable style={s.stepBtn} onPress={() => setHorizonWeeks((w) => Math.min(8, w + 1))}>
                  <Text style={s.stepBtnText}>+</Text>
                </Pressable>
              </View>
            </View>

            <View style={s.stepperRow}>
              <Text style={s.switchLabel}>Weekly session cap</Text>
              <View style={s.stepper}>
                <Pressable
                  style={s.stepBtn}
                  onPress={() => setWeeklyCap((c) => (c === null || c <= 1 ? null : c - 1))}
                >
                  <Text style={s.stepBtnText}>−</Text>
                </Pressable>
                <Text style={s.stepValue}>{weeklyCap === null ? 'Off' : weeklyCap}</Text>
                <Pressable
                  style={s.stepBtn}
                  onPress={() => setWeeklyCap((c) => Math.min(7, (c ?? 0) + 1))}
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
            {windows.map((w, i) => (
              <View key={i} style={s.windowRow}>
                <View style={s.windowDays}>
                  {DAY_SHORT_LABELS.map((label, d) => (
                    <Pressable
                      key={label}
                      style={[s.miniDayChip, w.days.includes(d) && s.dayChipActive]}
                      onPress={() => updateWindow(i, {
                        days: w.days.includes(d)
                          ? w.days.filter((x) => x !== d)
                          : [...w.days, d].sort((a, b) => a - b),
                      })}
                    >
                      <Text style={[s.miniDayChipText, w.days.includes(d) && s.dayChipTextActive]}>
                        {label[0]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  style={[s.timeInput, !timeRe.test(w.startTime) && s.inputBad]}
                  value={w.startTime}
                  onChangeText={(v) => updateWindow(i, { startTime: v })}
                  placeholder="09:00"
                  placeholderTextColor="#4A5568"
                  autoCapitalize="none"
                />
                <Text style={s.windowDash}>–</Text>
                <TextInput
                  style={[s.timeInput, !timeRe.test(w.endTime) && s.inputBad]}
                  value={w.endTime}
                  onChangeText={(v) => updateWindow(i, { endTime: v })}
                  placeholder="12:00"
                  placeholderTextColor="#4A5568"
                  autoCapitalize="none"
                />
                <Pressable
                  style={s.windowRemove}
                  onPress={() => setWindows((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Text style={s.windowRemoveText}>×</Text>
                </Pressable>
              </View>
            ))}
            <Pressable
              style={s.addWindowBtn}
              onPress={() => setWindows((prev) => [...prev, { days: [1], startTime: '09:00', endTime: '12:00' }])}
            >
              <Text style={s.addWindowText}>+ Add availability window</Text>
            </Pressable>

            <Text style={s.sectionLabel}>Locations</Text>
            <Text style={s.hint}>
              Optional — where sessions can happen (e.g. Condo gym, Hotel). The member picks one when booking.
            </Text>
            {locations.map((loc, i) => (
              <View key={i} style={s.windowRow}>
                <TextInput
                  style={[s.timeInput, { flex: 1, width: undefined, textAlign: 'left' }]}
                  value={loc}
                  onChangeText={(v) => { setLocations((prev) => prev.map((x, idx) => (idx === i ? v : x))); setLinkError(null); }}
                  placeholder="Condo gym"
                  placeholderTextColor="#4A5568"
                  maxLength={80}
                />
                <Pressable
                  style={s.windowRemove}
                  onPress={() => setLocations((prev) => prev.filter((_, idx) => idx !== i))}
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
            {windows.length > 0 && (
              <Pressable
                style={[s.btn, { backgroundColor: windowsValid && !linkBusy ? '#1E2A3A' : '#161D29', borderWidth: 1, borderColor: '#A78BFA', marginTop: 10 }]}
                onPress={createLink}
                disabled={!windowsValid || linkBusy}
              >
                <Text style={{ color: '#A78BFA', fontWeight: '700', fontFamily: FH }}>
                  {linkBusy ? 'Saving…' : linkToken ? 'Update Availability' : 'Create Booking Link'}
                </Text>
              </Pressable>
            )}
            {linkError && <Text style={s.error}>{linkError}</Text>}
            {bookingUrl && (
              <View style={s.linkBox}>
                <Text style={s.linkUrl} numberOfLines={1}>{bookingUrl}</Text>
                <Pressable style={s.copyBtn} onPress={copyLink}>
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
                  {bookedCount} session{bookedCount === 1 ? '' : 's'} booked
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
                  {booking ? 'Booking…' : 'Book Sessions'}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
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
  windowDays: {
    flexDirection: 'row',
    gap: 4,
  },
  miniDayChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#0E1117',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniDayChipText: {
    color: '#8A95A3',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FB,
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
