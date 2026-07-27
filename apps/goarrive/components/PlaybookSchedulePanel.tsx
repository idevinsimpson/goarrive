/**
 * PlaybookSchedulePanel — dead-simple scheduling inside the playbook drill-in.
 *
 * Coach picks day(s), a start time, session kind, and a repeat setting; the
 * bookPlaybookSession Cloud Function does the heavy lifting (transactional
 * member-level overlap guard + per-playbook weekly cap) and reports back
 * per-occurrence results. Shows the playbook TITLE only — never workout
 * names or sequence details.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from 'react-native';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useRouter } from 'expo-router';
import { db, functions } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import {
  DAY_SHORT_LABELS,
  PLAYBOOK_SESSION_KIND_LABELS,
  PlaybookRepeatFrequency,
  PlaybookSessionKind,
} from '../lib/schedulingTypes';

const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const DURATIONS = [30, 45, 60];
const TIME_PRESETS = ['06:00', '07:00', '09:00', '12:00', '17:00', '18:30'];

interface BookResult {
  date: string;
  status: 'booked' | 'conflict' | 'cap_reached';
  reason?: string;
}

interface PlaybookDocLite {
  name?: string;
  assignedMemberId?: string | null;
  assignedMemberName?: string | null;
  memberIds?: string[];
  sessionKind?: PlaybookSessionKind;
  recordingEnabled?: boolean;
  sessionDurationMinutes?: number;
  weeklySessionCap?: number | null;
  timezone?: string;
  scheduleDaysOfWeek?: number[];
  scheduleStartTime?: string;
  repeatFrequency?: PlaybookRepeatFrequency;
  repeatHorizonWeeks?: number;
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
  const router = useRouter();
  const [playbook, setPlaybook] = useState<PlaybookDocLite | null>(null);
  const [upcomingSessions, setUpcomingSessions] = useState<any[]>([]);

  const [days, setDays] = useState<number[]>([]);
  const [startTime, setStartTime] = useState('07:00');
  const [duration, setDuration] = useState(45);
  const [sessionKind, setSessionKind] = useState<PlaybookSessionKind>('coach_review');
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [repeatFrequency, setRepeatFrequency] = useState<PlaybookRepeatFrequency>('weekly');
  const [horizonWeeks, setHorizonWeeks] = useState(4);
  const [weeklyCap, setWeeklyCap] = useState<number | null>(null);
  const [booking, setBooking] = useState(false);
  const [results, setResults] = useState<BookResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Live playbook doc — pre-fills the form from previously saved settings.
  useEffect(() => {
    if (!visible || !playbookId || !effectiveUid) return;
    const unsub = onSnapshot(
      doc(db, 'playbooks', playbookId),
      (snap) => {
        const data = (snap.data() || {}) as PlaybookDocLite;
        setPlaybook(data);
        if (data.scheduleDaysOfWeek?.length) setDays(data.scheduleDaysOfWeek);
        if (data.scheduleStartTime) setStartTime(data.scheduleStartTime);
        if (data.sessionDurationMinutes) setDuration(data.sessionDurationMinutes);
        if (data.sessionKind) setSessionKind(data.sessionKind);
        if (data.recordingEnabled !== undefined) setRecordingEnabled(data.recordingEnabled !== false);
        if (data.repeatFrequency) setRepeatFrequency(data.repeatFrequency);
        if (data.repeatHorizonWeeks) setHorizonWeeks(data.repeatHorizonWeeks);
        if (data.weeklySessionCap !== undefined) setWeeklyCap(data.weeklySessionCap ?? null);
      },
      (err) => console.error('[PlaybookSchedulePanel] playbook listener error:', err),
    );
    return unsub;
  }, [visible, playbookId, effectiveUid]);

  // Upcoming/live session instances for this playbook — powers the View
  // (live-view split screen) entry point. Equality-only filters avoid a new
  // composite index; sort + status filter happen client-side (small list).
  useEffect(() => {
    if (!visible || !playbookId || !effectiveUid) return;
    const q = query(
      collection(db, 'session_instances'),
      where('coachId', '==', effectiveUid),
      where('playbookId', '==', playbookId),
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const today = new Date().toISOString().slice(0, 10);
        const rows = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as any) }))
          .filter(
            (r) =>
              (r.status === 'scheduled' || r.status === 'allocated' || r.status === 'in_progress')
              && r.scheduledDate >= today,
          )
          .sort((a, b) =>
            `${a.scheduledDate} ${a.scheduledStartTime}`.localeCompare(
              `${b.scheduledDate} ${b.scheduledStartTime}`,
            ),
          )
          .slice(0, 10);
        setUpcomingSessions(rows);
      },
      (err) => console.error('[PlaybookSchedulePanel] sessions listener error:', err),
    );
    return unsub;
  }, [visible, playbookId, effectiveUid]);

  const openLiveView = useCallback(
    (instanceId: string) => {
      onClose();
      router.push(`/live-view/${instanceId}` as any);
    },
    [onClose, router],
  );

  const memberName = playbook?.assignedMemberName || null;
  const hasMember = !!(playbook?.assignedMemberId || playbook?.memberIds?.length);
  const timezone = useMemo(
    () => playbook?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    [playbook?.timezone],
  );

  const toggleDay = useCallback((d: number) => {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
    setResults(null);
  }, []);

  const timeValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(startTime);
  const canBook = hasMember && days.length > 0 && timeValid && !booking;

  const book = useCallback(async () => {
    if (!canBook) return;
    setBooking(true);
    setError(null);
    setResults(null);
    try {
      const fn = httpsCallable(functions, 'bookPlaybookSession');
      const res = await fn({
        playbookId,
        daysOfWeek: days,
        startTime,
        timezone,
        durationMinutes: duration,
        sessionKind,
        recordingEnabled,
        repeatFrequency,
        repeatHorizonWeeks: horizonWeeks,
        weeklySessionCap: weeklyCap,
      });
      const data = res.data as { results: BookResult[] };
      setResults(data.results || []);
    } catch (e: any) {
      console.error('[PlaybookSchedulePanel] booking error:', e);
      setError(e?.message || 'Booking failed');
    } finally {
      setBooking(false);
    }
  }, [canBook, playbookId, days, startTime, timezone, duration, sessionKind, recordingEnabled, repeatFrequency, horizonWeeks, weeklyCap]);

  const bookedCount = results?.filter((r) => r.status === 'booked').length ?? 0;
  const problems = results?.filter((r) => r.status !== 'booked') ?? [];

  return (
    <Modal transparent visible={visible} animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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

            <Text style={s.sectionLabel}>Start Time</Text>
            <View style={s.chipRow}>
              {TIME_PRESETS.map((t) => (
                <Pressable
                  key={t}
                  style={[s.chip, startTime === t && s.chipActive]}
                  onPress={() => { setStartTime(t); setResults(null); }}
                >
                  <Text style={[s.chipText, startTime === t && s.chipTextActive]}>{t}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={[s.input, !timeValid && { borderColor: '#E5484D', borderWidth: 1 }]}
              value={startTime}
              onChangeText={(v) => { setStartTime(v); setResults(null); }}
              placeholder="HH:mm"
              placeholderTextColor="#4A5568"
              autoCapitalize="none"
            />
            <Text style={s.hint}>Member timezone: {timezone}</Text>

            <Text style={s.sectionLabel}>Duration</Text>
            <View style={s.chipRow}>
              {DURATIONS.map((d) => (
                <Pressable
                  key={d}
                  style={[s.chip, duration === d && s.chipActive]}
                  onPress={() => setDuration(d)}
                >
                  <Text style={[s.chipText, duration === d && s.chipTextActive]}>{d} min</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.sectionLabel}>Session Kind</Text>
            <View style={s.chipRow}>
              {(Object.keys(PLAYBOOK_SESSION_KIND_LABELS) as PlaybookSessionKind[]).map((k) => (
                <Pressable
                  key={k}
                  style={[s.chip, sessionKind === k && s.chipActive]}
                  onPress={() => setSessionKind(k)}
                >
                  <Text style={[s.chipText, sessionKind === k && s.chipTextActive]}>
                    {PLAYBOOK_SESSION_KIND_LABELS[k]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.hint}>
              {sessionKind === 'coach_guided'
                ? 'Runs live in your own Zoom room.'
                : 'Member trains in a hosted room; you review afterward.'}
            </Text>

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

            {upcomingSessions.length > 0 && (
              <>
                <Text style={s.sectionLabel}>Upcoming Sessions</Text>
                {upcomingSessions.map((inst) => (
                  <View key={inst.id} style={s.sessionRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.sessionRowDate}>
                        {inst.scheduledDate} · {inst.scheduledStartTime}
                      </Text>
                      <Text style={s.sessionRowMeta} numberOfLines={1}>
                        {inst.memberName || 'Member'}
                        {inst.status === 'in_progress' ? '  ·  LIVE' : ''}
                      </Text>
                    </View>
                    <Pressable style={s.viewBtn} onPress={() => openLiveView(inst.id)}>
                      <Text style={s.viewBtnText}>View</Text>
                    </Pressable>
                  </View>
                ))}
              </>
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
  input: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 12,
    color: '#F0F4F8',
    fontSize: 15,
    fontFamily: FB,
    marginTop: 8,
    width: 120,
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
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0E1117',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  sessionRowDate: {
    color: '#F0F4F8',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FH,
  },
  sessionRowMeta: {
    color: '#8A95A3',
    fontSize: 12,
    fontFamily: FB,
    marginTop: 2,
  },
  viewBtn: {
    backgroundColor: '#A78BFA',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  viewBtnText: {
    color: '#0E1117',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FH,
  },
});
