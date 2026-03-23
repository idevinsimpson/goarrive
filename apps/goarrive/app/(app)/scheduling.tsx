/**
 * scheduling.tsx — Coach Command Center
 *
 * Session-centered scheduling view for coaches. Shows upcoming sessions
 * grouped by day with guidance phase badges, hosting mode indicators,
 * and quick actions. No infrastructure language — that lives in admin.
 *
 * Views: List (default) and Calendar (week grid).
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
  Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { AppHeader } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import {
  collection,
  query,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../lib/firebase';
import {
  DAY_SHORT_LABELS,
  formatTime,
  formatDateShort,
  GUIDANCE_PHASE_LABELS,
  HOSTING_MODE_LABELS,
  SESSION_TYPE_LABELS,
  deriveRecordingStatus,
  deriveAttendanceOutcome,
  type RecurringSlot,
  type SessionInstance,
  type HostingMode,
  type RecordingStatus,
  type AttendanceOutcome,
} from '../../lib/schedulingTypes';

// ── Colors ───────────────────────────────────────────────────────────────────
const BG = '#0E1117';
const CARD_BG = '#161B22';
const BORDER = '#1E2A3A';
const GOLD = '#F5A623';
const GREEN = '#34D399';
const RED = '#EF4444';
const AMBER = '#F59E0B';
const BLUE = '#5B9BD5';
const MUTED = '#6B7280';
const TEXT_CLR = '#E5E7EB';
const WHITE = '#FFFFFF';
const FONT = Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined;

// ── Phase display (coach-facing) ────────────────────────────────────────────
const PHASE_DISPLAY: Record<string, { label: string; color: string }> = {
  coach_guided:    { label: 'Coach Guided',    color: GREEN },
  shared_guidance: { label: 'Shared Guidance', color: BLUE },
  self_guided:     { label: 'Self Guided',     color: GOLD },
};

// ── Recording status display ────────────────────────────────────────────────
const RECORDING_DISPLAY: Record<RecordingStatus, { label: string; color: string; icon: string }> = {
  not_expected: { label: 'N/A',        color: MUTED,  icon: 'remove-circle-outline' },
  pending:      { label: 'Pending',    color: AMBER,  icon: 'time-outline' },
  processing:   { label: 'Processing', color: BLUE,   icon: 'sync-outline' },
  ready:        { label: 'Ready',      color: GREEN,  icon: 'checkmark-circle-outline' },
  failed:       { label: 'Failed',     color: RED,    icon: 'alert-circle-outline' },
  missing:      { label: 'Missing',    color: RED,    icon: 'help-circle-outline' },
};

// ── Attendance outcome display ──────────────────────────────────────────────
const ATTENDANCE_DISPLAY: Record<AttendanceOutcome, { label: string; color: string }> = {
  completed: { label: 'Completed', color: GREEN },
  started:   { label: 'Started',   color: BLUE },
  joined:    { label: 'Joined',    color: BLUE },
  missed:    { label: 'Missed',    color: RED },
  canceled:  { label: 'Canceled',  color: MUTED },
  unknown:   { label: 'Unknown',   color: MUTED },
};

// ── Status display ──────────────────────────────────────────────────────────
const STATUS_DISPLAY: Record<string, { label: string; color: string }> = {
  scheduled:         { label: 'Upcoming',    color: GOLD },
  allocated:         { label: 'Ready',       color: GREEN },
  allocation_failed: { label: 'Needs Setup', color: AMBER },
  in_progress:       { label: 'Live',        color: GREEN },
  completed:         { label: 'Done',        color: MUTED },
  missed:            { label: 'Missed',      color: RED },
  cancelled:         { label: 'Cancelled',   color: MUTED },
  rescheduled:       { label: 'Moved',       color: BLUE },
  active:            { label: 'Active',      color: GREEN },
  paused:            { label: 'Paused',      color: AMBER },
};

export default function SchedulingScreen() {
  const { user, claims } = useAuth();
  const router = useRouter();
  const coachId = claims?.coachId || user?.uid || '';

  // ── State ────────────────────────────────────────────────────────────────
  const [slots, setSlots] = useState<RecurringSlot[]>([]);
  const [instances, setInstances] = useState<SessionInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'schedule' | 'members' | 'alerts'>('schedule');
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [selectedInstance, setSelectedInstance] = useState<SessionInstance | null>(null);
  const [calendarWeekOffset, setCalendarWeekOffset] = useState(0);

  // ── Load data ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!coachId) { setLoading(false); return; }

    let loadedCount = 0;
    const checkDone = () => { loadedCount++; if (loadedCount >= 2) setLoading(false); };

    const unsubSlots = onSnapshot(
      query(collection(db, 'recurring_slots'), where('coachId', '==', coachId)),
      (snap) => {
        setSlots(snap.docs.map(d => ({ id: d.id, ...d.data() } as RecurringSlot)));
        checkDone();
      },
      (err) => { console.warn('recurring_slots error:', err); checkDone(); }
    );

    const todayStr = new Date().toISOString().split('T')[0];
    const unsubInstances = onSnapshot(
      query(collection(db, 'session_instances'), where('coachId', '==', coachId)),
      (snap) => {
        const all = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as SessionInstance))
          .filter(i => i.scheduledDate >= todayStr);
        all.sort((a, b) => {
          const dc = a.scheduledDate.localeCompare(b.scheduledDate);
          return dc !== 0 ? dc : a.scheduledStartTime.localeCompare(b.scheduledStartTime);
        });
        setInstances(all);
        checkDone();
      },
      (err) => { console.warn('session_instances error:', err); checkDone(); }
    );

    return () => { unsubSlots(); unsubInstances(); };
  }, [coachId]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleCancelInstance = useCallback(async (instanceId: string) => {
    try {
      const fn = httpsCallable(functions, 'cancelInstance');
      await fn({ instanceId });
      setSelectedInstance(null);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to cancel');
    }
  }, []);

  // ── Computed ──────────────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toISOString().split('T')[0];

  const liveSessions = instances.filter(i => i.status !== 'cancelled');
  const todaySessions = liveSessions.filter(i => i.scheduledDate === todayStr);
  const tomorrowSessions = liveSessions.filter(i => i.scheduledDate === tomorrowStr);
  const upcomingSessions = liveSessions.filter(i => i.scheduledDate > tomorrowStr);
  const needsAttention = liveSessions.filter(i =>
    i.status === 'allocation_failed' || i.status === 'missed'
  );
  const activeSlots = slots.filter(s => s.status === 'active');

  // Coach-live sessions: sessions where the coach is expected to be present
  const coachLiveSessions = liveSessions.filter(i =>
    i.coachExpectedLive === true ||
    i.guidancePhase === 'coach_guided' ||
    (i.guidancePhase === 'shared_guidance' && i.coachJoining !== false)
  );
  const todayCoachLive = coachLiveSessions.filter(i => i.scheduledDate === todayStr);

  // Group slots by member
  const memberSlots = useMemo(() => {
    const map = new Map<string, RecurringSlot[]>();
    activeSlots.forEach(slot => {
      const key = slot.memberId;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(slot);
    });
    return map;
  }, [activeSlots]);

  // ── Calendar week data ────────────────────────────────────────────────────
  const calendarData = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + (calendarWeekOffset * 7));
    startOfWeek.setHours(0, 0, 0, 0);

    const days: { date: Date; dateStr: string; label: string; isToday: boolean }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      days.push({
        date: d,
        dateStr,
        label: DAY_SHORT_LABELS[d.getDay()],
        isToday: dateStr === todayStr,
      });
    }

    const weekInstances = new Map<string, SessionInstance[]>();
    days.forEach(day => {
      weekInstances.set(
        day.dateStr,
        liveSessions.filter(i => i.scheduledDate === day.dateStr)
      );
    });

    return { days, weekInstances };
  }, [liveSessions, calendarWeekOffset, todayStr]);

  // ── Hosting mode helper ──────────────────────────────────────────────────
  const getHostingLabel = (inst: SessionInstance): { label: string; color: string } => {
    const mode = inst.hostingMode || (inst.guidancePhase === 'coach_guided' ? 'coach_led' : 'hosted');
    if (mode === 'coach_led') return { label: 'Coach-led', color: GREEN };
    return { label: 'Hosted', color: BLUE };
  };

  if (loading) {
    return (
      <View style={s.container}>
        <AppHeader />
        <View style={s.center}>
          <ActivityIndicator size="large" color={GOLD} />
        </View>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <AppHeader />
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        {/* Header */}
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.pageTitle}>My Schedule</Text>
            <Text style={s.subtitle}>
              {todayCoachLive.length} live session{todayCoachLive.length !== 1 ? 's' : ''} today
              {todaySessions.length > todayCoachLive.length
                ? ` · ${todaySessions.length - todayCoachLive.length} hosted`
                : ''}
              {needsAttention.length > 0 ? ` · ${needsAttention.length} need attention` : ''}
            </Text>
          </View>
          <View style={s.betaBadge}>
            <Text style={s.betaText}>BETA</Text>
          </View>
        </View>

        {/* Tab Bar */}
        <View style={s.tabBar}>
          {([
            { key: 'schedule' as const, label: 'Schedule' },
            { key: 'members' as const, label: 'Members' },
            { key: 'alerts' as const, label: `Alerts${needsAttention.length > 0 ? ` (${needsAttention.length})` : ''}` },
          ]).map(tab => (
            <TouchableOpacity
              key={tab.key}
              style={[s.tab, activeTab === tab.key && s.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[s.tabText, activeTab === tab.key && s.tabTextActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ─── Schedule Tab ─── */}
        {activeTab === 'schedule' && (
          <View>
            {/* View Mode Toggle */}
            <View style={s.viewToggleRow}>
              <View style={s.legendRow}>
                {Object.entries(PHASE_DISPLAY).map(([key, val]) => (
                  <View key={key} style={s.legendItem}>
                    <View style={[s.legendDot, { backgroundColor: val.color }]} />
                    <Text style={s.legendText}>{val.label}</Text>
                  </View>
                ))}
              </View>
              <View style={s.viewToggle}>
                <TouchableOpacity
                  style={[s.viewBtn, viewMode === 'list' && s.viewBtnActive]}
                  onPress={() => setViewMode('list')}
                >
                  <Icon name="list" size={16} color={viewMode === 'list' ? GOLD : MUTED} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.viewBtn, viewMode === 'calendar' && s.viewBtnActive]}
                  onPress={() => setViewMode('calendar')}
                >
                  <Icon name="calendar" size={16} color={viewMode === 'calendar' ? GOLD : MUTED} />
                </TouchableOpacity>
              </View>
            </View>

            {/* ── List View ── */}
            {viewMode === 'list' && (
              <View>
                {/* Today */}
                <SectionHeader title="Today" count={todaySessions.length} />
                {todaySessions.length === 0 ? (
                  <EmptyCard text="No sessions today. Enjoy the rest!" />
                ) : (
                  todaySessions.map(inst => (
                    <SessionCard
                      key={inst.id}
                      inst={inst}
                      getHostingLabel={getHostingLabel}
                      onPress={() => setSelectedInstance(inst)}
                    />
                  ))
                )}

                {/* Tomorrow */}
                <SectionHeader title="Tomorrow" count={tomorrowSessions.length} />
                {tomorrowSessions.length === 0 ? (
                  <EmptyCard text="Nothing scheduled for tomorrow." />
                ) : (
                  tomorrowSessions.map(inst => (
                    <SessionCard
                      key={inst.id}
                      inst={inst}
                      getHostingLabel={getHostingLabel}
                      onPress={() => setSelectedInstance(inst)}
                    />
                  ))
                )}

                {/* Upcoming */}
                {upcomingSessions.length > 0 && (
                  <>
                    <SectionHeader title="Upcoming" count={upcomingSessions.length} />
                    {upcomingSessions.slice(0, 20).map(inst => (
                      <SessionCard
                        key={inst.id}
                        inst={inst}
                        getHostingLabel={getHostingLabel}
                        onPress={() => setSelectedInstance(inst)}
                        showDate
                      />
                    ))}
                    {upcomingSessions.length > 20 && (
                      <Text style={s.moreText}>+ {upcomingSessions.length - 20} more sessions</Text>
                    )}
                  </>
                )}

                {/* Empty state */}
                {liveSessions.length === 0 && (
                  <View style={s.emptyHero}>
                    <Icon name="calendar" size={48} color={MUTED} />
                    <Text style={s.emptyHeroTitle}>No sessions scheduled yet</Text>
                    <Text style={s.emptyHeroSub}>
                      Assign recurring time slots to your members{'\n'}from their Member Hub to get started.
                    </Text>
                    <TouchableOpacity
                      style={s.emptyHeroBtn}
                      onPress={() => router.push('/(app)/members' as any)}
                    >
                      <Text style={s.emptyHeroBtnText}>Go to Members</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* ── Calendar View ── */}
            {viewMode === 'calendar' && (
              <View>
                {/* Week navigation */}
                <View style={s.calNavRow}>
                  <TouchableOpacity onPress={() => setCalendarWeekOffset(o => o - 1)} style={s.calNavBtn}>
                    <Icon name="back" size={18} color={TEXT_CLR} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setCalendarWeekOffset(0)}>
                    <Text style={s.calNavLabel}>
                      {calendarWeekOffset === 0 ? 'This Week' :
                       calendarWeekOffset === 1 ? 'Next Week' :
                       calendarWeekOffset === -1 ? 'Last Week' :
                       `${calendarData.days[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${calendarData.days[6].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => setCalendarWeekOffset(o => o + 1)} style={s.calNavBtn}>
                    <Icon name="forward" size={18} color={TEXT_CLR} />
                  </TouchableOpacity>
                </View>

                {/* Day columns */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={s.calGrid}>
                    {calendarData.days.map(day => {
                      const daySessions = calendarData.weekInstances.get(day.dateStr) || [];
                      return (
                        <View key={day.dateStr} style={[s.calDayCol, day.isToday && s.calDayColToday]}>
                          <View style={[s.calDayHeader, day.isToday && s.calDayHeaderToday]}>
                            <Text style={[s.calDayLabel, day.isToday && s.calDayLabelToday]}>{day.label}</Text>
                            <Text style={[s.calDayNum, day.isToday && s.calDayNumToday]}>
                              {day.date.getDate()}
                            </Text>
                          </View>
                          {daySessions.length === 0 ? (
                            <Text style={s.calEmpty}>—</Text>
                          ) : (
                            daySessions.map(inst => {
                              const phase = PHASE_DISPLAY[inst.guidancePhase || ''];
                              const phaseColor = phase?.color || MUTED;
                              return (
                                <TouchableOpacity
                                  key={inst.id}
                                  style={[s.calSession, { borderLeftColor: phaseColor, borderLeftWidth: 3 }]}
                                  onPress={() => setSelectedInstance(inst)}
                                >
                                  <Text style={s.calSessionTime}>{formatTime(inst.scheduledStartTime)}</Text>
                                  <Text style={s.calSessionName} numberOfLines={1}>{inst.memberName}</Text>
                                  {inst.coachExpectedLive && (
                                    <View style={[s.calLiveDot, { backgroundColor: GREEN }]} />
                                  )}
                                </TouchableOpacity>
                              );
                            })
                          )}
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            )}
          </View>
        )}

        {/* ─── Members Tab ─── */}
        {activeTab === 'members' && (
          <View>
            <SectionHeader title="Member Schedules" count={memberSlots.size} />
            {memberSlots.size === 0 ? (
              <EmptyCard text="No recurring schedules set up yet. Assign time slots from the Member Hub." />
            ) : (
              Array.from(memberSlots.entries()).map(([memberId, mSlots]) => (
                <View key={memberId} style={s.memberCard}>
                  <Text style={s.memberName}>{mSlots[0]?.memberName || 'Member'}</Text>
                  {mSlots.map(slot => {
                    const phase = PHASE_DISPLAY[slot.guidancePhase || ''] || PHASE_DISPLAY.self_guided;
                    const sessionLabel = SESSION_TYPE_LABELS[slot.sessionType as keyof typeof SESSION_TYPE_LABELS] || slot.sessionType || '';
                    const hosting = slot.hostingMode === 'coach_led' ? 'Coach-led' : 'Hosted';
                    return (
                      <View key={slot.id} style={s.slotRow}>
                        <View style={[s.phaseDot, { backgroundColor: phase.color }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.slotText}>
                            {DAY_SHORT_LABELS[slot.dayOfWeek]} · {formatTime(slot.startTime)} · {slot.durationMinutes}min
                          </Text>
                          <Text style={s.slotMeta}>
                            {phase.label}{sessionLabel ? ` · ${sessionLabel}` : ''} · {hosting} · {slot.recurrencePattern === 'biweekly' ? 'Every 2 weeks' : 'Weekly'}
                          </Text>
                          {slot.guidancePhase === 'shared_guidance' && slot.liveCoachingDuration != null && (
                            <Text style={[s.slotMeta, { color: BLUE }]}>
                              Live window: {slot.liveCoachingDuration}min
                            </Text>
                          )}
                        </View>
                        <StatusBadge status={slot.status} />
                      </View>
                    );
                  })}
                </View>
              ))
            )}
          </View>
        )}

        {/* ─── Alerts Tab ─── */}
        {activeTab === 'alerts' && (
          <View>
            <SectionHeader title="Needs Attention" count={needsAttention.length} />
            {needsAttention.length === 0 ? (
              <EmptyCard text="All clear! No scheduling issues right now." />
            ) : (
              needsAttention.map(inst => {
                const phase = PHASE_DISPLAY[inst.guidancePhase || ''] || null;
                const isMissed = inst.status === 'missed';
                return (
                  <TouchableOpacity
                    key={inst.id}
                    style={s.alertCard}
                    onPress={() => setSelectedInstance(inst)}
                  >
                    <View style={s.sessionRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.sessionMember}>{inst.memberName}</Text>
                        <Text style={s.sessionTime}>
                          {formatDateShort(inst.scheduledDate)} · {formatTime(inst.scheduledStartTime)}
                        </Text>
                        {phase && (
                          <Text style={[s.phaseLabel, { color: phase.color }]}>{phase.label}</Text>
                        )}
                        <Text style={s.alertReason}>
                          {isMissed ? 'Member missed this session' : 'Session needs setup — check admin operations'}
                        </Text>
                      </View>
                      <StatusBadge status={inst.status} />
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        )}
      </ScrollView>

      {/* ─── Session Detail Modal ─── */}
      {selectedInstance && (
        <Modal
          visible={true}
          transparent
          animationType="slide"
          onRequestClose={() => setSelectedInstance(null)}
        >
          <View style={s.modalOverlay}>
            <View style={s.modalSheet}>
              <SessionDetailSheet
                inst={selectedInstance}
                getHostingLabel={getHostingLabel}
                onCancel={handleCancelInstance}
                onClose={() => setSelectedInstance(null)}
              />
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <View style={s.sectionHeader}>
      <Text style={s.sectionTitle}>{title}</Text>
      <Text style={s.sectionCount}>{count}</Text>
    </View>
  );
}

function EmptyCard({ text }: { text: string }) {
  return (
    <View style={s.emptyCard}>
      <Text style={s.emptyText}>{text}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const display = STATUS_DISPLAY[status] || { label: status, color: MUTED };
  return (
    <View style={[s.badge, { backgroundColor: display.color + '20' }]}>
      <View style={[s.badgeDot, { backgroundColor: display.color }]} />
      <Text style={[s.badgeText, { color: display.color }]}>{display.label}</Text>
    </View>
  );
}

function SessionCard({
  inst,
  getHostingLabel,
  onPress,
  showDate,
}: {
  inst: SessionInstance;
  getHostingLabel: (inst: SessionInstance) => { label: string; color: string };
  onPress: () => void;
  showDate?: boolean;
}) {
  const phase = PHASE_DISPLAY[inst.guidancePhase || ''] || null;
  const sessionLabel = SESSION_TYPE_LABELS[inst.sessionType as keyof typeof SESSION_TYPE_LABELS] || '';
  const hosting = getHostingLabel(inst);
  const isCoachLive = inst.coachExpectedLive === true ||
    inst.guidancePhase === 'coach_guided' ||
    (inst.guidancePhase === 'shared_guidance' && inst.coachJoining !== false);

  return (
    <TouchableOpacity style={s.sessionCardBase} onPress={onPress} activeOpacity={0.7}>
      <View style={s.sessionRow}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={s.sessionMember}>{inst.memberName}</Text>
            {phase && (
              <View style={[s.phaseBadge, { backgroundColor: phase.color + '18' }]}>
                <Text style={[s.phaseBadgeText, { color: phase.color }]}>{phase.label}</Text>
              </View>
            )}
          </View>
          <Text style={s.sessionTime}>
            {showDate ? `${formatDateShort(inst.scheduledDate)} · ` : ''}
            {formatTime(inst.scheduledStartTime)} – {formatTime(inst.scheduledEndTime)}
            {sessionLabel ? ` · ${sessionLabel}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <Text style={[s.hostingLabel, { color: hosting.color }]}>{hosting.label}</Text>
            {isCoachLive && (
              <View style={s.liveIndicator}>
                <View style={[s.liveDot, { backgroundColor: GREEN }]} />
                <Text style={s.liveText}>You're live</Text>
              </View>
            )}
            {inst.guidancePhase === 'shared_guidance' && inst.liveCoachingDuration != null && (
              <Text style={[s.liveWindow, { color: BLUE }]}>
                {inst.liveCoachingDuration}min window
              </Text>
            )}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <StatusBadge status={inst.status} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

function SessionDetailSheet({
  inst,
  getHostingLabel,
  onCancel,
  onClose,
}: {
  inst: SessionInstance;
  getHostingLabel: (inst: SessionInstance) => { label: string; color: string };
  onCancel: (id: string) => void;
  onClose: () => void;
}) {
  const phase = PHASE_DISPLAY[inst.guidancePhase || ''] || null;
  const sessionLabel = SESSION_TYPE_LABELS[inst.sessionType as keyof typeof SESSION_TYPE_LABELS] || inst.sessionType || '';
  const hosting = getHostingLabel(inst);
  const isCoachLive = inst.coachExpectedLive === true ||
    inst.guidancePhase === 'coach_guided' ||
    (inst.guidancePhase === 'shared_guidance' && inst.coachJoining !== false);
  const canCancel = inst.status === 'scheduled' || inst.status === 'allocated';

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
      {/* Close button */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Text style={s.modalTitle}>Session Details</Text>
        <TouchableOpacity onPress={onClose} style={{ padding: 6 }}>
          <Icon name="close" size={22} color={MUTED} />
        </TouchableOpacity>
      </View>

      {/* Member & date */}
      <Text style={s.detailMember}>{inst.memberName}</Text>
      <Text style={s.detailDate}>{formatDateShort(inst.scheduledDate)}</Text>
      <Text style={s.detailTime}>
        {formatTime(inst.scheduledStartTime)} – {formatTime(inst.scheduledEndTime)} · {inst.durationMinutes}min
      </Text>

      {/* Status */}
      <View style={{ marginTop: 16 }}>
        <StatusBadge status={inst.status} />
      </View>

      {/* Details grid */}
      <View style={s.detailGrid}>
        {phase && (
          <DetailRow label="Guidance Phase" value={phase.label} valueColor={phase.color} />
        )}
        {sessionLabel && (
          <DetailRow label="Session Type" value={sessionLabel} />
        )}
        <DetailRow label="Hosting" value={hosting.label} valueColor={hosting.color} />
        <DetailRow
          label="Coach Live"
          value={isCoachLive ? 'Yes — on your calendar' : 'No — member on their own'}
          valueColor={isCoachLive ? GREEN : MUTED}
        />
        {inst.guidancePhase === 'shared_guidance' && inst.liveCoachingStartMin != null && inst.liveCoachingEndMin != null && (
          <DetailRow
            label="Live Window"
            value={`Join at ${inst.liveCoachingStartMin}min, leave at ${inst.liveCoachingEndMin}min (${inst.liveCoachingDuration || 0}min)`}
            valueColor={BLUE}
          />
        )}
        {inst.commitToSaveEnabled && (
          <DetailRow label="Commit to Save" value="Active" valueColor={GREEN} />
        )}
      </View>

      {/* Provider mode */}
      {inst.zoomProviderMode && (
        <DetailRow
          label="Provider"
          value={inst.zoomProviderMode === 'live' ? 'Live Zoom' : 'Mock (Testing)'}
          valueColor={inst.zoomProviderMode === 'live' ? GREEN : AMBER}
        />
      )}
      {inst.zoomMeetingUuid && (
        <DetailRow label="Meeting UUID" value={inst.zoomMeetingUuid} />
      )}

      {/* Prompt 4: Attendance Outcome */}
      {(() => {
        const attendance = deriveAttendanceOutcome(inst);
        const attDisplay = ATTENDANCE_DISPLAY[attendance];
        return (
          <View style={s.detailSection}>
            <Text style={s.detailSectionLabel}>Attendance</Text>
            <DetailRow label="Outcome" value={attDisplay.label} valueColor={attDisplay.color} />
            {inst.actualStartTime && (
              <DetailRow label="Started" value={new Date(inst.actualStartTime).toLocaleTimeString()} />
            )}
            {inst.actualEndTime && (
              <DetailRow label="Ended" value={new Date(inst.actualEndTime).toLocaleTimeString()} />
            )}
            {inst.attendance && Object.keys(inst.attendance).length > 0 && (
              <View style={{ marginTop: 4 }}>
                <Text style={[s.detailSectionLabel, { fontSize: 11, marginBottom: 2 }]}>Participants</Text>
                {Object.entries(inst.attendance).map(([key, p]) => (
                  <View key={key} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                    <Text style={{ color: TEXT_CLR, fontSize: 12, fontFamily: FONT }}>{p.name || key}</Text>
                    <Text style={{ color: MUTED, fontSize: 11, fontFamily: FONT }}>
                      {p.joinTime ? new Date(p.joinTime).toLocaleTimeString() : ''}
                      {p.leaveTime ? ` – ${new Date(p.leaveTime).toLocaleTimeString()}` : ''}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        );
      })()}

      {/* Prompt 4: Recording Status */}
      {(() => {
        const recStatus = deriveRecordingStatus(inst);
        const recDisplay = RECORDING_DISPLAY[recStatus];
        return (
          <View style={s.detailSection}>
            <Text style={s.detailSectionLabel}>Recording</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <Icon name={recDisplay.icon as any} size={14} color={recDisplay.color} />
              <Text style={{ color: recDisplay.color, fontSize: 13, fontWeight: '600', fontFamily: FONT }}>
                {recDisplay.label}
              </Text>
            </View>
            {inst.recordingAvailable && inst.recordings && inst.recordings.length > 0 && (
              inst.recordings.map((rec: any, idx: number) => (
                <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
                  <Text style={{ color: TEXT_CLR, fontSize: 12, fontFamily: FONT }}>{rec.fileType}</Text>
                  <Text style={{ color: BLUE, fontSize: 12, fontFamily: FONT }}>{rec.status || 'available'}</Text>
                </View>
              ))
            )}
            {recStatus === 'pending' && (
              <Text style={{ color: MUTED, fontSize: 11, fontStyle: 'italic', marginTop: 2, fontFamily: FONT }}>
                Recording expected — waiting for Zoom to process.
              </Text>
            )}
            {recStatus === 'missing' && (
              <Text style={{ color: RED, fontSize: 11, fontStyle: 'italic', marginTop: 2, fontFamily: FONT }}>
                Recording not received. Check Zoom recording settings.
              </Text>
            )}
          </View>
        );
      })()}

      {/* Zoom link */}
      {inst.zoomJoinUrl && (
        <View style={s.detailSection}>
          <Text style={s.detailSectionLabel}>Meeting Link</Text>
          <Text style={s.zoomLink} numberOfLines={2}>{inst.zoomJoinUrl}</Text>
        </View>
      )}

      {/* Actions */}
      <View style={s.detailActions}>
        {canCancel && (
          <TouchableOpacity
            style={s.cancelBtn}
            onPress={() => {
              Alert.alert(
                'Cancel Session',
                `Cancel ${inst.memberName}'s session on ${formatDateShort(inst.scheduledDate)}?`,
                [
                  { text: 'Keep', style: 'cancel' },
                  { text: 'Cancel Session', style: 'destructive', onPress: () => onCancel(inst.id) },
                ]
              );
            }}
          >
            <Text style={s.cancelBtnText}>Cancel This Session</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={s.closeBtn} onPress={onClose}>
          <Text style={s.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function DetailRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={s.detailRow}>
      <Text style={s.detailLabel}>{label}</Text>
      <Text style={[s.detailValue, valueColor ? { color: valueColor } : {}]}>{value}</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 100 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  pageTitle: { color: WHITE, fontSize: 20, fontWeight: '700', fontFamily: FONT },
  subtitle: { color: MUTED, fontSize: 13, marginTop: 2, fontFamily: FONT },
  betaBadge: { backgroundColor: GOLD + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  betaText: { color: GOLD, fontSize: 10, fontWeight: '700', letterSpacing: 1 },

  tabBar: { flexDirection: 'row', marginBottom: 16, gap: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: CARD_BG },
  tabActive: { backgroundColor: GOLD + '20' },
  tabText: { color: MUTED, fontSize: 13, fontWeight: '600', fontFamily: FONT },
  tabTextActive: { color: GOLD },

  viewToggleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  viewToggle: { flexDirection: 'row', gap: 2, backgroundColor: CARD_BG, borderRadius: 6, padding: 2 },
  viewBtn: { padding: 8, borderRadius: 4 },
  viewBtnActive: { backgroundColor: GOLD + '20' },

  legendRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: MUTED, fontSize: 11, fontWeight: '600', fontFamily: FONT },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 12 },
  sectionTitle: { color: WHITE, fontSize: 16, fontWeight: '700', fontFamily: FONT },
  sectionCount: { color: MUTED, fontSize: 13, fontWeight: '600' },

  emptyCard: { backgroundColor: CARD_BG, borderRadius: 10, padding: 20, borderWidth: 1, borderColor: BORDER, marginBottom: 12 },
  emptyText: { color: MUTED, fontSize: 14, textAlign: 'center', fontFamily: FONT },

  emptyHero: { alignItems: 'center', paddingVertical: 40, gap: 12 },
  emptyHeroTitle: { color: WHITE, fontSize: 18, fontWeight: '700', fontFamily: FONT },
  emptyHeroSub: { color: MUTED, fontSize: 14, textAlign: 'center', maxWidth: 280, lineHeight: 20, fontFamily: FONT },
  emptyHeroBtn: { backgroundColor: GOLD, borderRadius: 8, paddingHorizontal: 24, paddingVertical: 12, marginTop: 8 },
  emptyHeroBtnText: { color: BG, fontSize: 14, fontWeight: '700', fontFamily: FONT },

  sessionCardBase: { backgroundColor: CARD_BG, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 8 },
  sessionRow: { flexDirection: 'row', alignItems: 'flex-start' },
  sessionMember: { color: WHITE, fontSize: 15, fontWeight: '600', fontFamily: FONT },
  sessionTime: { color: MUTED, fontSize: 13, marginTop: 3, fontFamily: FONT },
  hostingLabel: { fontSize: 12, fontWeight: '600' },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { color: GREEN, fontSize: 11, fontWeight: '600' },
  liveWindow: { fontSize: 11, fontWeight: '600' },

  phaseBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  phaseBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  phaseLabel: { fontSize: 12, fontWeight: '600', marginTop: 3 },

  memberCard: { backgroundColor: CARD_BG, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 10 },
  memberName: { color: WHITE, fontSize: 16, fontWeight: '700', marginBottom: 8, fontFamily: FONT },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: BORDER },
  phaseDot: { width: 8, height: 8, borderRadius: 4 },
  slotText: { color: TEXT_CLR, fontSize: 14, fontFamily: FONT },
  slotMeta: { color: MUTED, fontSize: 12, marginTop: 2, fontFamily: FONT },

  alertCard: { backgroundColor: CARD_BG, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 8, borderLeftColor: AMBER, borderLeftWidth: 3 },
  alertReason: { color: AMBER, fontSize: 12, marginTop: 4, fontStyle: 'italic' },

  moreText: { color: MUTED, fontSize: 13, textAlign: 'center', paddingVertical: 12 },

  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, gap: 5 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '600' },

  // ── Calendar styles ──
  calNavRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  calNavBtn: { padding: 8 },
  calNavLabel: { color: WHITE, fontSize: 15, fontWeight: '600', fontFamily: FONT },

  calGrid: { flexDirection: 'row', gap: 4 },
  calDayCol: { width: 110, minHeight: 200, backgroundColor: CARD_BG, borderRadius: 8, borderWidth: 1, borderColor: BORDER, padding: 6 },
  calDayColToday: { borderColor: GOLD + '60' },
  calDayHeader: { alignItems: 'center', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: BORDER, marginBottom: 6 },
  calDayHeaderToday: { borderBottomColor: GOLD },
  calDayLabel: { color: MUTED, fontSize: 11, fontWeight: '600' },
  calDayLabelToday: { color: GOLD },
  calDayNum: { color: TEXT_CLR, fontSize: 18, fontWeight: '700' },
  calDayNumToday: { color: GOLD },
  calEmpty: { color: MUTED, fontSize: 12, textAlign: 'center', marginTop: 20 },
  calSession: { backgroundColor: BG, borderRadius: 6, padding: 6, marginBottom: 4 },
  calSessionTime: { color: TEXT_CLR, fontSize: 10, fontWeight: '600' },
  calSessionName: { color: WHITE, fontSize: 11, fontWeight: '600', marginTop: 2 },
  calLiveDot: { width: 5, height: 5, borderRadius: 3, marginTop: 3 },

  // ── Modal styles ──
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: CARD_BG,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
    minHeight: 300,
    borderWidth: 1,
    borderColor: BORDER,
  },
  modalTitle: { color: WHITE, fontSize: 18, fontWeight: '700', fontFamily: FONT },

  detailMember: { color: WHITE, fontSize: 22, fontWeight: '700', fontFamily: FONT },
  detailDate: { color: GOLD, fontSize: 15, fontWeight: '600', marginTop: 4, fontFamily: FONT },
  detailTime: { color: TEXT_CLR, fontSize: 14, marginTop: 2, fontFamily: FONT },

  detailGrid: { marginTop: 20, gap: 12 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER },
  detailLabel: { color: MUTED, fontSize: 13, fontWeight: '600', fontFamily: FONT },
  detailValue: { color: TEXT_CLR, fontSize: 13, fontWeight: '600', fontFamily: FONT, textAlign: 'right', maxWidth: '55%' },

  detailSection: { marginTop: 16 },
  detailSectionLabel: { color: MUTED, fontSize: 12, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  zoomLink: { color: BLUE, fontSize: 13 },

  detailActions: { marginTop: 24, gap: 10 },
  cancelBtn: { backgroundColor: RED + '20', borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  cancelBtnText: { color: RED, fontSize: 14, fontWeight: '700', fontFamily: FONT },
  closeBtn: { backgroundColor: BORDER, borderRadius: 8, paddingVertical: 14, alignItems: 'center' },
  closeBtnText: { color: TEXT_CLR, fontSize: 14, fontWeight: '600', fontFamily: FONT },
});
