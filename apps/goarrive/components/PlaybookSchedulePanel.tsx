/**
 * PlaybookSchedulePanel — per-day schedule modules inside the playbook drill-in.
 *
 * Coach taps day pills (Sun–Sat); each selected day spawns its own module card
 * with an independent start time, duration, and session kind, plus the workout
 * landing on that day (thumbnail mosaic, draggable between modules to remap
 * which workout lands on which day). The bookPlaybookSession Cloud Function
 * does the heavy lifting (transactional member-level overlap guard +
 * per-playbook weekly cap) and reports back per-occurrence results.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image, Modal, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import DraggableFlatList, { RenderItemParams } from 'react-native-draggable-flatlist';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import {
  DAY_LABELS,
  DAY_SHORT_LABELS,
  PLAYBOOK_SESSION_KIND_LABELS,
  PlaybookDayModule,
  PlaybookRepeatFrequency,
  PlaybookSessionKind,
} from '../lib/schedulingTypes';

const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const DURATION_PRESETS = [30, 45, 60];
const TIME_PRESETS = ['06:00', '07:00', '09:00', '12:00', '17:00', '18:30'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const BOOKING_TIMEOUT_MS = 45000;

interface BookResult {
  date: string;
  status: 'booked' | 'conflict' | 'cap_reached';
  reason?: string;
}

interface WorkoutMeta {
  name?: string;
  thumbUrl?: string | null;
  estimatedDurationMin?: number | null;
}

interface DayModuleState {
  day: number;                  // 0-6
  startTime: string;            // free text, validated as HH:mm
  duration: string;             // free text, validated as 5-240 minutes
  sessionKind: PlaybookSessionKind;
  workoutId: string | null;
}

interface PlaybookDocLite {
  name?: string;
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
  scheduleDayModules?: PlaybookDayModule[];
  repeatFrequency?: PlaybookRepeatFrequency;
  repeatHorizonWeeks?: number;
}

function defaultModule(day: number, workoutId: string | null): DayModuleState {
  return { day, startTime: '07:00', duration: '45', sessionKind: 'coach_review', workoutId };
}

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
  const [workoutMeta, setWorkoutMeta] = useState<Record<string, WorkoutMeta>>({});

  const [modules, setModules] = useState<DayModuleState[]>([]);
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [repeatFrequency, setRepeatFrequency] = useState<PlaybookRepeatFrequency>('weekly');
  const [horizonWeeks, setHorizonWeeks] = useState(4);
  const [weeklyCap, setWeeklyCap] = useState<number | null>(null);
  const [booking, setBooking] = useState(false);
  const [results, setResults] = useState<BookResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hydrate from saved settings once per open — re-applying every snapshot
  // would stomp in-progress edits when booking writes the playbook doc.
  const hydratedRef = useRef(false);

  // Reset transient state every time the panel opens. The component stays
  // mounted behind the Modal, so without this a stuck `booking` (e.g. a fetch
  // that died while the PWA was backgrounded) persisted across close/reopen.
  useEffect(() => {
    if (visible) {
      setBooking(false);
      setError(null);
      setResults(null);
      hydratedRef.current = false;
    }
  }, [visible]);

  // Live playbook doc — pre-fills the form from previously saved settings.
  useEffect(() => {
    if (!visible || !playbookId || !effectiveUid) return;
    const unsub = onSnapshot(
      doc(db, 'playbooks', playbookId),
      (snap) => {
        const data = (snap.data() || {}) as PlaybookDocLite;
        setPlaybook(data);
        if (data.recordingEnabled !== undefined) setRecordingEnabled(data.recordingEnabled !== false);
        if (data.repeatFrequency) setRepeatFrequency(data.repeatFrequency);
        if (data.repeatHorizonWeeks) setHorizonWeeks(data.repeatHorizonWeeks);
        if (data.weeklySessionCap !== undefined) setWeeklyCap(data.weeklySessionCap ?? null);
        if (!hydratedRef.current) {
          hydratedRef.current = true;
          const workoutIds = Array.isArray(data.workoutIds) ? data.workoutIds : [];
          if (Array.isArray(data.scheduleDayModules) && data.scheduleDayModules.length > 0) {
            setModules(
              data.scheduleDayModules
                .filter((m) => typeof m.dayOfWeek === 'number')
                .map((m): DayModuleState => ({
                  day: m.dayOfWeek,
                  startTime: m.startTime || '07:00',
                  duration: String(m.durationMinutes || 45),
                  sessionKind: m.sessionKind === 'coach_guided' ? 'coach_guided' : 'coach_review',
                  workoutId: m.workoutId && workoutIds.includes(m.workoutId) ? m.workoutId : null,
                }))
                .sort((a, b) => a.day - b.day),
            );
          } else if (data.scheduleDaysOfWeek?.length) {
            // Legacy global settings → one identical module per saved day
            setModules(
              [...data.scheduleDaysOfWeek].sort().map((day, i): DayModuleState => ({
                day,
                startTime: data.scheduleStartTime || '07:00',
                duration: String(data.sessionDurationMinutes || 45),
                sessionKind: data.sessionKind === 'coach_guided' ? 'coach_guided' : 'coach_review',
                workoutId: workoutIds[i % Math.max(1, workoutIds.length)] ?? null,
              })),
            );
          }
        }
      },
      (err) => console.error('[PlaybookSchedulePanel] playbook listener error:', err),
    );
    return unsub;
  }, [visible, playbookId, effectiveUid]);

  // Workout mosaics: name + thumbnail + estimated duration for each playbook workout.
  const workoutIdsKey = (playbook?.workoutIds || []).join(',');
  useEffect(() => {
    if (!visible || !workoutIdsKey) return;
    const ids = workoutIdsKey.split(',');
    let cancelled = false;
    (async () => {
      const entries: [string, WorkoutMeta][] = [];
      await Promise.all(ids.map(async (id) => {
        try {
          const snap = await getDoc(doc(db, 'workouts', id));
          if (!snap.exists()) return;
          const w = snap.data() as any;
          entries.push([id, {
            name: w.name || w.title || 'Workout',
            thumbUrl: w.thumbnailUrl || w.thumbnailImageUrl || w.gifLowUrl || w.mediaUrl || null,
            estimatedDurationMin: typeof w.estimatedDurationMin === 'number' ? w.estimatedDurationMin : null,
          }]);
        } catch (err) {
          console.warn('[PlaybookSchedulePanel] workout meta load failed:', id, err);
        }
      }));
      if (!cancelled) setWorkoutMeta(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [visible, workoutIdsKey]);

  const memberName = playbook?.assignedMemberName || null;
  const hasMember = !!(playbook?.assignedMemberId || playbook?.memberIds?.length);
  const timezone = useMemo(
    () => playbook?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    [playbook?.timezone],
  );

  const toggleDay = useCallback((day: number) => {
    setResults(null);
    setModules((prev) => {
      if (prev.some((m) => m.day === day)) return prev.filter((m) => m.day !== day);
      const workoutIds = playbook?.workoutIds || [];
      const used = new Set(prev.map((m) => m.workoutId).filter(Boolean));
      const nextWorkout = workoutIds.find((id) => !used.has(id))
        ?? (workoutIds.length ? workoutIds[prev.length % workoutIds.length] : null);
      return [...prev, defaultModule(day, nextWorkout)].sort((a, b) => a.day - b.day);
    });
  }, [playbook?.workoutIds]);

  const updateModule = useCallback((day: number, patch: Partial<DayModuleState>) => {
    setResults(null);
    setModules((prev) => prev.map((m) => (m.day === day ? { ...m, ...patch } : m)));
  }, []);

  // Drag a mosaic between modules: days stay fixed in day order; the workout
  // assignments get the list-reorder permutation (same feel as the playbook
  // canvas reorder).
  const onMosaicDragEnd = useCallback(({ from, to }: { from: number; to: number }) => {
    if (from === to) return;
    setResults(null);
    setModules((prev) => {
      const ws = prev.map((m) => m.workoutId);
      const [moved] = ws.splice(from, 1);
      ws.splice(to, 0, moved);
      return prev.map((m, i) => ({ ...m, workoutId: ws[i] }));
    });
  }, []);

  const parseDuration = (v: string): number | null => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 5 && n <= 240 ? n : null;
  };

  const modulesValid = modules.length > 0
    && modules.every((m) => TIME_RE.test(m.startTime) && parseDuration(m.duration) !== null);
  const canBook = hasMember && modulesValid && !booking;

  const book = useCallback(async () => {
    if (!canBook) return;
    setBooking(true);
    setError(null);
    setResults(null);
    try {
      const fn = httpsCallable(functions, 'bookPlaybookSession');
      const dayModules = modules.map((m) => ({
        dayOfWeek: m.day,
        startTime: m.startTime,
        durationMinutes: parseDuration(m.duration) as number,
        sessionKind: m.sessionKind,
        workoutId: m.workoutId,
      }));
      const call = fn({
        playbookId,
        dayModules,
        // Legacy fields kept so older function revisions still book correctly
        daysOfWeek: dayModules.map((m) => m.dayOfWeek),
        startTime: dayModules[0].startTime,
        durationMinutes: dayModules[0].durationMinutes,
        sessionKind: dayModules[0].sessionKind,
        timezone,
        recordingEnabled,
        repeatFrequency,
        repeatHorizonWeeks: horizonWeeks,
        weeklySessionCap: weeklyCap,
      });
      // Hard client-side deadline: if the underlying request dies without
      // settling (e.g. iOS PWA suspended mid-flight), the footer must never
      // stay stuck on "Booking…".
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
  }, [canBook, playbookId, modules, timezone, recordingEnabled, repeatFrequency, horizonWeeks, weeklyCap]);

  const bookedCount = results?.filter((r) => r.status === 'booked').length ?? 0;
  const problems = results?.filter((r) => r.status !== 'booked') ?? [];

  const renderModule = useCallback(({ item: m, drag, isActive }: RenderItemParams<DayModuleState>) => {
    const meta = m.workoutId ? workoutMeta[m.workoutId] : undefined;
    const dur = parseDuration(m.duration);
    const timeOk = TIME_RE.test(m.startTime);
    return (
      <View style={[s.moduleCard, isActive && s.moduleCardActive]}>
        <View style={{ flex: 1 }}>
          <Text style={s.moduleDay}>{DAY_LABELS[m.day]}</Text>

          <Text style={s.moduleLabel}>Start Time</Text>
          <View style={s.chipRowTight}>
            {TIME_PRESETS.map((t) => (
              <Pressable
                key={t}
                style={[s.miniChip, m.startTime === t && s.chipActive]}
                onPress={() => updateModule(m.day, { startTime: t })}
              >
                <Text style={[s.miniChipText, m.startTime === t && s.chipTextActive]}>{t}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            style={[s.input, !timeOk && s.inputInvalid]}
            value={m.startTime}
            onChangeText={(v) => updateModule(m.day, { startTime: v })}
            placeholder="HH:mm"
            placeholderTextColor="#4A5568"
            autoCapitalize="none"
          />

          <Text style={s.moduleLabel}>Duration</Text>
          <View style={s.chipRowTight}>
            {DURATION_PRESETS.map((d) => (
              <Pressable
                key={d}
                style={[s.miniChip, dur === d && s.chipActive]}
                onPress={() => updateModule(m.day, { duration: String(d) })}
              >
                <Text style={[s.miniChipText, dur === d && s.chipTextActive]}>{d}</Text>
              </Pressable>
            ))}
            <TextInput
              style={[s.durationInput, dur === null && s.inputInvalid]}
              value={m.duration}
              onChangeText={(v) => updateModule(m.day, { duration: v.replace(/[^0-9]/g, '') })}
              keyboardType="numeric"
              placeholder="min"
              placeholderTextColor="#4A5568"
            />
            <Text style={s.moduleHint}>min</Text>
          </View>
          {meta?.estimatedDurationMin ? (
            <Text style={s.moduleHint}>Workout est. ~{meta.estimatedDurationMin} min</Text>
          ) : null}

          <Text style={s.moduleLabel}>Session</Text>
          <View style={s.chipRowTight}>
            {(Object.keys(PLAYBOOK_SESSION_KIND_LABELS) as PlaybookSessionKind[]).map((k) => (
              <Pressable
                key={k}
                style={[s.miniChip, m.sessionKind === k && s.chipActive]}
                onPress={() => updateModule(m.day, { sessionKind: k })}
              >
                <Text style={[s.miniChipText, m.sessionKind === k && s.chipTextActive]}>
                  {PLAYBOOK_SESSION_KIND_LABELS[k]}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Pressable
          style={s.mosaic}
          onLongPress={drag}
          delayLongPress={150}
          disabled={!m.workoutId}
        >
          {meta?.thumbUrl ? (
            <Image source={{ uri: meta.thumbUrl }} style={s.mosaicImage} resizeMode="cover" />
          ) : (
            <View style={[s.mosaicImage, s.mosaicEmpty]}>
              <Text style={s.mosaicEmptyText}>{m.workoutId ? '…' : 'No workout'}</Text>
            </View>
          )}
          <Text style={s.mosaicName} numberOfLines={2}>{meta?.name || (m.workoutId ? 'Workout' : '—')}</Text>
          {m.workoutId ? <Text style={s.mosaicHint}>hold to drag</Text> : null}
        </Pressable>
      </View>
    );
  }, [workoutMeta, updateModule]);

  const header = (
    <View>
      <Text style={s.title}>Schedule {playbook?.name || 'Playbook'}</Text>
      {hasMember ? (
        <Text style={s.subtitle}>Sessions for {memberName || 'assigned member'}</Text>
      ) : (
        <Text style={[s.subtitle, { color: '#F5A623' }]}>
          Assign a member to this playbook before scheduling.
        </Text>
      )}

      <Text style={s.sectionLabel}>Days</Text>
      <View style={s.chipRow}>
        {DAY_SHORT_LABELS.map((label, i) => {
          const active = modules.some((m) => m.day === i);
          return (
            <Pressable
              key={label}
              style={[s.dayChip, active && s.dayChipActive]}
              onPress={() => toggleDay(i)}
            >
              <Text style={[s.dayChipText, active && s.dayChipTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
      {modules.length === 0 ? (
        <Text style={s.hint}>Pick a day to set its time, duration, and workout.</Text>
      ) : (
        <Text style={s.hint}>Member timezone: {timezone}</Text>
      )}
    </View>
  );

  const footer = (
    <View>
      <View style={s.switchRow}>
        <Text style={s.switchLabel}>Record sessions</Text>
        <Switch
          value={recordingEnabled}
          onValueChange={setRecordingEnabled}
          trackColor={{ false: '#4A5568', true: '#A78BFA' }}
          thumbColor="#F0F4F8"
        />
      </View>

      <Text style={s.sectionLabel}>Repeat</Text>
      <View style={s.chipRow}>
        {([['weekly', 'Weekly'], ['every_2_weeks', 'Every 2 Weeks'], ['none', 'One Time']] as const).map(([v, label]) => (
          <Pressable
            key={v}
            style={[s.chip, repeatFrequency === v && s.chipActive]}
            onPress={() => setRepeatFrequency(v)}
          >
            <Text style={[s.chipText, repeatFrequency === v && s.chipTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {repeatFrequency !== 'none' && (
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
      )}

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
    </View>
  );

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <Pressable style={s.backdrop} onPress={onClose}>
          <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>
            <DraggableFlatList
              data={modules}
              keyExtractor={(m) => `day-${m.day}`}
              renderItem={renderModule}
              onDragEnd={onMosaicDragEnd}
              activationDistance={12}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={header}
              ListFooterComponent={footer}
            />
          </Pressable>
        </Pressable>
      </GestureHandlerRootView>
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
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  subtitle: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 4,
    marginBottom: 8,
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
  chipRowTight: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
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
  miniChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#0E1117',
    borderRadius: 14,
  },
  miniChipText: {
    color: '#8A95A3',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FB,
  },
  moduleCard: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: '#16202E',
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  moduleCardActive: {
    opacity: 0.9,
    borderColor: '#A78BFA',
    borderWidth: 1,
  },
  moduleDay: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  moduleLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#4A5568',
    letterSpacing: 1,
    marginTop: 10,
    marginBottom: 6,
    fontFamily: FH,
    textTransform: 'uppercase',
  },
  moduleHint: {
    color: '#4A5568',
    fontSize: 11,
    fontFamily: FB,
    marginTop: 4,
  },
  mosaic: {
    width: 96,
    alignItems: 'center',
  },
  mosaicImage: {
    width: 96,
    height: 120, // 4:5 like the workout thumbnail grid
    borderRadius: 10,
    backgroundColor: '#0E1117',
  },
  mosaicEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mosaicEmptyText: {
    color: '#4A5568',
    fontSize: 11,
    fontFamily: FB,
  },
  mosaicName: {
    color: '#8A95A3',
    fontSize: 11,
    fontFamily: FB,
    marginTop: 6,
    textAlign: 'center',
  },
  mosaicHint: {
    color: '#4A5568',
    fontSize: 9,
    fontFamily: FB,
    marginTop: 2,
  },
  input: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 10,
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    marginTop: 8,
    width: 100,
  },
  inputInvalid: {
    borderColor: '#E5484D',
    borderWidth: 1,
  },
  durationInput: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: '#F0F4F8',
    fontSize: 13,
    fontFamily: FB,
    width: 64,
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
