/**
 * Member session page — /live-session/{sessionInstanceId} (Phase 3b).
 *
 * One page, three time-driven states for a booked playbook session:
 *  1. PRE-SESSION: live countdown to start + session info + self-service
 *     Reschedule (slot picker fed by getPlaybookRescheduleSlots — the same
 *     server engine as the public booking page) and Cancel. Both respect the
 *     skip auto-approval window enforced by rescheduleInstance/cancelInstance.
 *  2. LIVE (5-min early-join grace): the normal WorkoutPlayer experience for
 *     the session's workout, resolved server-side by getSessionWorkout
 *     (pinnedWorkoutId, else playbook next-in-sequence).
 *  3. RECORDED sessions (recordingEnabled) gate the player behind an in-app
 *     Zoom join (SessionZoomTile) that stays as a PiP tile during playback.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter, Redirect } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../../lib/AuthContext';
import { db, functions } from '../../lib/firebase';
import { SessionInstance } from '../../lib/schedulingTypes';
import WorkoutPlayer from '../../components/WorkoutPlayer';
import SessionZoomTile from '../../components/SessionZoomTile';
import { BG, CARD, BORDER, FG, MUTED, GOLD, GREEN, RED, FH, FB } from '../../lib/theme';

const EARLY_JOIN_GRACE_MS = 5 * 60 * 1000;

interface Slot {
  date: string;
  startTime: string;
  startUtcMillis: number;
  capReached: boolean;
}

function friendlyTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function friendlyDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

/** Start/end millis for the session — UTC timestamps when present (playbook
 * bookings always write them), else the wall-clock fields in device time. */
function sessionWindowMs(inst: SessionInstance): { startMs: number; endMs: number } {
  const startTs: any = (inst as any).startUtc;
  const endTs: any = (inst as any).endUtc;
  if (startTs?.toMillis) {
    const startMs = startTs.toMillis();
    const endMs = endTs?.toMillis
      ? endTs.toMillis()
      : startMs + (inst.durationMinutes || 45) * 60 * 1000;
    return { startMs, endMs };
  }
  const [y, m, d] = inst.scheduledDate.split('-').map(Number);
  const [h, min] = (inst.scheduledStartTime || '00:00').split(':').map(Number);
  const startMs = new Date(y, m - 1, d, h, min).getTime();
  return { startMs, endMs: startMs + (inst.durationMinutes || 45) * 60 * 1000 };
}

function formatInTimezone(ms: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleString();
  }
}

function confirmDialog(title: string, message: string, onConfirm: () => void) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
  } else {
    Alert.alert(title, message, [
      { text: 'Keep Session', style: 'cancel' },
      { text: 'Confirm', style: 'destructive', onPress: onConfirm },
    ]);
  }
}

const CANCELABLE_STATUSES = ['scheduled', 'allocated', 'allocation_failed'];

export default function LiveSessionScreen() {
  const { sessionInstanceId } = useLocalSearchParams<{ sessionInstanceId: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [inst, setInst] = useState<SessionInstance | null>(null);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());

  const [workout, setWorkout] = useState<any | null>(null);
  const [workoutLoaded, setWorkoutLoaded] = useState(false);
  const [coachName, setCoachName] = useState<string | null>(null);

  const [zoomJoined, setZoomJoined] = useState(false);
  const [zoomSkipped, setZoomSkipped] = useState(false);
  const [playerVisible, setPlayerVisible] = useState(false);
  const [workoutDone, setWorkoutDone] = useState(false);

  const [showReschedule, setShowReschedule] = useState(false);
  const [actionError, setActionError] = useState('');
  const [cancelling, setCancelling] = useState(false);

  // Live session doc — status flips (allocation, cancellation) arrive in
  // real time so the page reacts without a refresh.
  useEffect(() => {
    if (authLoading || !user || !sessionInstanceId) return;
    const unsub = onSnapshot(
      doc(db, 'session_instances', sessionInstanceId),
      (snap) => {
        setLoading(false);
        if (!snap.exists()) {
          setLoadError("We couldn't find that session.");
          return;
        }
        setInst({ id: snap.id, ...snap.data() } as SessionInstance);
      },
      (err) => {
        console.error('[LiveSession] snapshot error:', err);
        setLoading(false);
        setLoadError('Unable to load this session right now.');
      },
    );
    return () => unsub();
  }, [authLoading, user, sessionInstanceId]);

  // Ticking clock for the countdown + state transitions.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Server-resolved workout + coach name (members can't read those docs).
  useEffect(() => {
    if (!user || !sessionInstanceId || workoutLoaded) return;
    if (!inst) return;
    let cancelled = false;
    (async () => {
      try {
        const fn = httpsCallable<{ sessionInstanceId: string }, { workout: any | null; coachName: string | null }>(
          functions,
          'getSessionWorkout',
        );
        const res = await fn({ sessionInstanceId });
        if (cancelled) return;
        setWorkout(res.data.workout);
        setCoachName(res.data.coachName);
        setWorkoutLoaded(true);
      } catch (err) {
        console.error('[LiveSession] getSessionWorkout failed:', err);
        if (!cancelled) setWorkoutLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [user, sessionInstanceId, inst, workoutLoaded]);

  const window_ = useMemo(() => (inst ? sessionWindowMs(inst) : null), [inst]);

  const handleCancel = useCallback(() => {
    if (!inst) return;
    confirmDialog(
      'Cancel Session',
      `Cancel your ${friendlyDate(inst.scheduledDate)} session at ${friendlyTime(inst.scheduledStartTime)}?`,
      async () => {
        setCancelling(true);
        setActionError('');
        try {
          const fn = httpsCallable(functions, 'cancelInstance');
          await fn({ instanceId: inst.id });
        } catch (err: any) {
          setActionError(err?.message || 'Unable to cancel — please try again or contact your coach.');
        } finally {
          setCancelling(false);
        }
      },
    );
  }, [inst]);

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (authLoading || loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }
  if (!user) return <Redirect href="/(auth)/login" />;
  if (loadError || !inst || !window_) {
    return (
      <View style={s.center}>
        <Text style={s.errorTitle}>Session unavailable</Text>
        <Text style={s.errorBody}>{loadError || 'Something went wrong.'}</Text>
        <Pressable style={s.secondaryBtn} onPress={() => router.replace('/(member)/my-sessions')}>
          <Text style={s.secondaryBtnText}>Back to My Sessions</Text>
        </Pressable>
      </View>
    );
  }

  const { startMs, endMs } = window_;
  const title = inst.playbookTitle || 'Your Session';
  const whenLine = formatInTimezone(startMs, inst.timezone);

  const isCancelled = inst.status === 'cancelled';
  const isDoneStatus = ['completed', 'missed', 'skipped'].includes(inst.status);
  const isPre = now < startMs - EARLY_JOIN_GRACE_MS;
  const isLive = now >= startMs - EARLY_JOIN_GRACE_MS && now <= endMs;

  // ── Terminal states ────────────────────────────────────────────────────────
  if (isCancelled) {
    return (
      <TerminalCard
        title="Session cancelled"
        body={`${title} — ${whenLine} was cancelled.`}
        router={router}
      />
    );
  }
  if (isDoneStatus || (!isPre && !isLive) || workoutDone) {
    return (
      <TerminalCard
        title={workoutDone || inst.status === 'completed' ? 'Session complete — great work!' : 'This session has ended'}
        body={`${title} — ${whenLine}`}
        router={router}
      />
    );
  }

  // ── PRE-SESSION: countdown + reschedule/cancel ─────────────────────────────
  if (isPre) {
    const diff = Math.max(0, startMs - now);
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff % 86400000) / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    const secs = Math.floor((diff % 60000) / 1000);
    const canAct = CANCELABLE_STATUSES.includes(inst.status);
    return (
      <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={s.page}>
        <View style={s.card}>
          <Text style={s.kicker}>Upcoming session</Text>
          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>
            {whenLine} ({inst.timezone})
            {coachName ? ` · with Coach ${coachName}` : ''}
          </Text>

          <View style={s.countdownRow}>
            {days > 0 && <CountUnit value={days} label={days === 1 ? 'day' : 'days'} />}
            <CountUnit value={hours} label="hrs" />
            <CountUnit value={mins} label="min" />
            <CountUnit value={secs} label="sec" />
          </View>
          <Text style={s.countdownHint}>Your session page goes live 5 minutes before start.</Text>

          {actionError !== '' && <Text style={s.actionError}>{actionError}</Text>}

          {canAct && (
            <>
              <Pressable style={s.secondaryBtn} onPress={() => { setActionError(''); setShowReschedule(true); }}>
                <Text style={s.secondaryBtnText}>Reschedule</Text>
              </Pressable>
              <Pressable style={s.dangerBtn} onPress={handleCancel} disabled={cancelling}>
                <Text style={s.dangerBtnText}>{cancelling ? 'Cancelling…' : 'Cancel Session'}</Text>
              </Pressable>
            </>
          )}
          <Pressable style={s.ghostBtn} onPress={() => router.replace('/(member)/my-sessions')}>
            <Text style={s.ghostBtnText}>Back to My Sessions</Text>
          </Pressable>
        </View>

        {showReschedule && (
          <RescheduleSlotModal
            inst={inst}
            onClose={() => setShowReschedule(false)}
            onDone={() => setShowReschedule(false)}
          />
        )}
      </ScrollView>
    );
  }

  // ── LIVE ───────────────────────────────────────────────────────────────────
  const needsZoomGate = inst.recordingEnabled === true && !zoomJoined && !zoomSkipped;
  const zoomActive = inst.recordingEnabled === true && zoomJoined;

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView contentContainerStyle={s.page}>
        <View style={s.card}>
          <Text style={s.kicker}>Live now</Text>
          <Text style={s.title}>{title}</Text>
          <Text style={s.subtitle}>
            {whenLine} ({inst.timezone})
            {coachName ? ` · with Coach ${coachName}` : ''}
          </Text>

          {inst.recordingEnabled === true && (
            <SessionZoomTile
              sessionInstanceId={inst.id}
              zoomJoinUrl={inst.zoomJoinUrl || null}
              pip={playerVisible}
              onJoined={() => setZoomJoined(true)}
              onSkip={() => setZoomSkipped(true)}
            />
          )}

          {!needsZoomGate && !workoutLoaded && (
            <View style={s.innerCard}>
              <ActivityIndicator color={GOLD} />
              <Text style={s.innerCardText}>Loading your workout…</Text>
            </View>
          )}

          {!needsZoomGate && workoutLoaded && !workout && (
            <View style={s.innerCard}>
              <Text style={s.innerCardTitle}>Workout not assigned yet</Text>
              <Text style={s.innerCardText}>
                Your coach hasn&apos;t assigned the workout for this session yet.
                Hang tight — it will appear here as soon as it&apos;s ready.
              </Text>
            </View>
          )}

          {!needsZoomGate && workout && !playerVisible && (
            <View style={s.innerCard}>
              <Text style={s.innerCardTitle}>
                {inst.recordingEnabled === true ? 'Step 2 — Start your workout' : 'Ready to go'}
              </Text>
              <Text style={s.innerCardText}>{workout.name || 'Your workout is ready.'}</Text>
              <Pressable style={s.primaryBtn} onPress={() => setPlayerVisible(true)}>
                <Text style={s.primaryBtnText}>Start Workout</Text>
              </Pressable>
            </View>
          )}

          <Pressable style={s.ghostBtn} onPress={() => router.replace('/(member)/my-sessions')}>
            <Text style={s.ghostBtnText}>Back to My Sessions</Text>
          </Pressable>
        </View>
      </ScrollView>

      {workout && playerVisible && (
        <WorkoutPlayer
          visible={playerVisible}
          workout={workout}
          onClose={() => setPlayerVisible(false)}
          onComplete={() => {
            setPlayerVisible(false);
            setWorkoutDone(true);
          }}
        />
      )}
      {/* zoomActive keeps the PiP tile mounted during playback via pip prop */}
      {zoomActive && null}
    </View>
  );
}

// ── Countdown unit ───────────────────────────────────────────────────────────

function CountUnit({ value, label }: { value: number; label: string }) {
  return (
    <View style={s.countUnit}>
      <Text style={s.countValue}>{String(value).padStart(2, '0')}</Text>
      <Text style={s.countLabel}>{label}</Text>
    </View>
  );
}

// ── Terminal card ────────────────────────────────────────────────────────────

function TerminalCard({ title, body, router }: { title: string; body: string; router: any }) {
  return (
    <View style={s.center}>
      <View style={s.card}>
        <Text style={s.title}>{title}</Text>
        <Text style={s.subtitle}>{body}</Text>
        <Pressable style={s.primaryBtn} onPress={() => router.replace('/(member)/my-sessions')}>
          <Text style={s.primaryBtnText}>Back to My Sessions</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Reschedule slot-picker modal ─────────────────────────────────────────────
// Same data + selection model as the public booking page: pick an open day,
// pick a time, confirm. Server recomputes availability and rescheduleInstance
// enforces the skip auto-approval window.

function RescheduleSlotModal({
  inst,
  onClose,
  onDone,
}: {
  inst: SessionInstance;
  onClose: () => void;
  onDone: () => void;
}) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [timezone, setTimezone] = useState(inst.timezone);
  const [loadErr, setLoadErr] = useState('');
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fn = httpsCallable<{ instanceId: string }, {
          playbookTitle: string; timezone: string; durationMinutes: number; slots: Slot[];
        }>(functions, 'getPlaybookRescheduleSlots');
        const res = await fn({ instanceId: inst.id });
        if (cancelled) return;
        setSlots(res.data.slots.filter((x) => !x.capReached));
        setTimezone(res.data.timezone);
      } catch (err: any) {
        console.error('[LiveSession] getPlaybookRescheduleSlots failed:', err);
        if (!cancelled) {
          setLoadErr(err?.message || 'Unable to load available times.');
          setSlots([]);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [inst.id]);

  const byDate = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const sl of slots || []) {
      if (!map.has(sl.date)) map.set(sl.date, []);
      map.get(sl.date)!.push(sl);
    }
    return map;
  }, [slots]);

  const confirm = useCallback(async () => {
    if (!selected || saving) return;
    setSaving(true);
    setSaveErr('');
    try {
      const fn = httpsCallable(functions, 'rescheduleInstance');
      await fn({ instanceId: inst.id, newDate: selected.date, newStartTime: selected.startTime });
      onDone();
    } catch (err: any) {
      setSaveErr(err?.message || 'Unable to reschedule — that time may have just been taken.');
    } finally {
      setSaving(false);
    }
  }, [selected, saving, inst.id, onDone]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalOverlay}>
        <View style={s.modalSheet}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Reschedule</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={s.modalClose}>✕</Text>
            </Pressable>
          </View>
          <Text style={s.modalSub}>Times shown in {timezone}</Text>

          {slots === null && (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator color={GOLD} />
            </View>
          )}

          {slots !== null && loadErr !== '' && <Text style={s.actionError}>{loadErr}</Text>}
          {slots !== null && loadErr === '' && byDate.size === 0 && (
            <Text style={s.modalSub}>No open times in the next few weeks. Check back soon.</Text>
          )}

          <ScrollView style={{ maxHeight: 420 }}>
            {!selectedDate && [...byDate.keys()].map((dateStr) => (
              <Pressable key={dateStr} style={s.dayRow} onPress={() => { setSelectedDate(dateStr); setSelected(null); }}>
                <Text style={s.dayRowText}>{friendlyDate(dateStr)}</Text>
                <Text style={s.dayRowCount}>{byDate.get(dateStr)!.length} times ›</Text>
              </Pressable>
            ))}

            {selectedDate && (
              <>
                <Pressable style={s.backRow} onPress={() => { setSelectedDate(null); setSelected(null); setSaveErr(''); }}>
                  <Text style={s.backRowText}>‹ All days</Text>
                </Pressable>
                <Text style={s.dayHeading}>{friendlyDate(selectedDate)}</Text>
                <View style={s.slotWrap}>
                  {(byDate.get(selectedDate) || []).map((slot) => {
                    const isSel = selected?.startUtcMillis === slot.startUtcMillis;
                    return (
                      <Pressable
                        key={slot.startUtcMillis}
                        style={[s.slotChip, isSel && s.slotChipSel]}
                        onPress={() => { setSelected(slot); setSaveErr(''); }}
                      >
                        <Text style={[s.slotChipText, isSel && s.slotChipTextSel]}>
                          {friendlyTime(slot.startTime)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            )}
          </ScrollView>

          {saveErr !== '' && <Text style={s.actionError}>{saveErr}</Text>}

          <Pressable
            style={[s.primaryBtn, (!selected || saving) && s.primaryBtnDisabled]}
            disabled={!selected || saving}
            onPress={confirm}
          >
            <Text style={s.primaryBtnText}>
              {saving
                ? 'Rescheduling…'
                : selected
                  ? `Move to ${friendlyDate(selected.date)} · ${friendlyTime(selected.startTime)}`
                  : 'Select a time'}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  page: {
    minHeight: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: BG,
  },
  center: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 20,
    padding: 24,
    gap: 12,
  },
  kicker: {
    color: GREEN,
    fontSize: 12,
    fontFamily: FB,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: { color: FG, fontSize: 24, fontFamily: FH, fontWeight: '700' },
  subtitle: { color: MUTED, fontSize: 14, fontFamily: FB, lineHeight: 20 },
  countdownRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginVertical: 12,
  },
  countUnit: {
    backgroundColor: BG,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    minWidth: 64,
  },
  countValue: { color: GOLD, fontSize: 28, fontFamily: FH, fontWeight: '700' },
  countLabel: { color: MUTED, fontSize: 11, fontFamily: FB, marginTop: 2 },
  countdownHint: { color: MUTED, fontSize: 12, fontFamily: FB, textAlign: 'center' },
  innerCard: {
    backgroundColor: BG,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
    gap: 10,
  },
  innerCardTitle: { color: FG, fontSize: 16, fontFamily: FH, fontWeight: '700' },
  innerCardText: { color: MUTED, fontSize: 14, fontFamily: FB, lineHeight: 20 },
  primaryBtn: {
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#0E1117', fontSize: 15, fontFamily: FH, fontWeight: '700' },
  secondaryBtn: {
    backgroundColor: 'transparent',
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryBtnText: { color: FG, fontSize: 14, fontFamily: FH, fontWeight: '600' },
  dangerBtn: {
    backgroundColor: 'transparent',
    borderColor: RED,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  dangerBtnText: { color: RED, fontSize: 14, fontFamily: FH, fontWeight: '600' },
  ghostBtn: { paddingVertical: 10, alignItems: 'center' },
  ghostBtnText: { color: MUTED, fontSize: 13, fontFamily: FB },
  actionError: { color: RED, fontSize: 13, fontFamily: FB, lineHeight: 19 },
  errorTitle: { color: FG, fontSize: 20, fontFamily: FH, fontWeight: '700', marginBottom: 8 },
  errorBody: { color: MUTED, fontSize: 14, fontFamily: FB, marginBottom: 16, textAlign: 'center' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
    ...(Platform.OS === 'web' ? { justifyContent: 'center', alignItems: 'center' } : {}),
  },
  modalSheet: {
    backgroundColor: CARD,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    gap: 10,
    width: '100%',
    ...(Platform.OS === 'web' ? { maxWidth: 480, borderRadius: 20 } : {}),
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: { color: FG, fontSize: 18, fontFamily: FH, fontWeight: '700' },
  modalClose: { color: MUTED, fontSize: 18 },
  modalSub: { color: MUTED, fontSize: 13, fontFamily: FB },
  dayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomColor: BORDER,
    borderBottomWidth: 1,
  },
  dayRowText: { color: FG, fontSize: 15, fontFamily: FB, fontWeight: '600' },
  dayRowCount: { color: MUTED, fontSize: 13, fontFamily: FB },
  backRow: { paddingVertical: 8 },
  backRowText: { color: GOLD, fontSize: 14, fontFamily: FB, fontWeight: '600' },
  dayHeading: { color: FG, fontSize: 16, fontFamily: FH, fontWeight: '700', marginBottom: 8 },
  slotWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slotChip: {
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 14,
    backgroundColor: BG,
  },
  slotChipSel: { borderColor: GOLD, backgroundColor: 'rgba(245,166,35,0.12)' },
  slotChipText: { color: FG, fontSize: 14, fontFamily: FB },
  slotChipTextSel: { color: GOLD, fontWeight: '700' },
});
