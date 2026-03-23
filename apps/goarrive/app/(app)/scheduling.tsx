/**
 * scheduling.tsx — Coach Scheduling Workspace
 *
 * Simplified, session-centric view for coaches. Uses the plan-phase
 * terminology: Coach Guided, Shared Guidance, Self Guided.
 *
 * Shows upcoming sessions grouped by day, with guidance phase badges,
 * Zoom links, and quick actions. Backend room/pool management is
 * relocated to admin-only surfaces.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Alert,
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
  type RecurringSlot,
  type SessionInstance,
} from '../../lib/schedulingTypes';

// ── Colors ───────────────────────────────────────────────────────────────────
const BG = '#0E1117';
const CARD_BG = '#161B22';
const BORDER = '#1E2A3A';
const GOLD = '#F5A623';
const GREEN = '#34D399';
const RED = '#EF4444';
const AMBER = '#F59E0B';
const BLUE = '#3B82F6';
const MUTED = '#6B7280';
const TEXT_CLR = '#E5E7EB';
const WHITE = '#FFFFFF';
const FONT = Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined;

// ── Phase labels & colors ────────────────────────────────────────────────────
const PHASE_DISPLAY: Record<string, { label: string; color: string; icon: string }> = {
  coach_guided:    { label: 'Coach Guided',    color: GREEN,  icon: 'user' },
  shared_guidance: { label: 'Shared Guidance', color: GOLD,   icon: 'users' },
  self_guided:     { label: 'Self Guided',     color: BLUE,   icon: 'zap' },
};

const SESSION_TYPE_LABELS: Record<string, string> = {
  strength: 'Strength',
  cardio: 'Cardio',
  flexibility: 'Flexibility',
  hiit: 'HIIT',
  recovery: 'Recovery',
  check_in: 'Check-in',
  custom: 'Custom',
};

// ── Status badge colors ──────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  active: GREEN,
  scheduled: GOLD,
  allocated: GREEN,
  allocation_failed: RED,
  in_progress: BLUE,
  completed: GREEN,
  missed: RED,
  cancelled: MUTED,
  paused: AMBER,
};

export default function SchedulingScreen() {
  const { user, claims } = useAuth();
  const router = useRouter();
  const coachId = claims?.coachId || user?.uid || '';

  // ── State ────────────────────────────────────────────────────────────────
  const [slots, setSlots] = useState<RecurringSlot[]>([]);
  const [instances, setInstances] = useState<SessionInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [allocating, setAllocating] = useState(false);
  const [activeTab, setActiveTab] = useState<'schedule' | 'members' | 'alerts'>('schedule');

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
  const handleAllocateAll = useCallback(async () => {
    setAllocating(true);
    try {
      const fn = httpsCallable(functions, 'allocateAllPendingInstances');
      const result = await fn({});
      const data = result.data as any;
      Alert.alert('Done', `${data.allocated} sessions allocated, ${data.failed} need attention.`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Allocation failed');
    }
    setAllocating(false);
  }, []);

  const handleCancelInstance = useCallback(async (instanceId: string) => {
    try {
      const fn = httpsCallable(functions, 'cancelInstance');
      await fn({ instanceId });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to cancel');
    }
  }, []);

  const handleToggleCoachJoining = useCallback(async (inst: SessionInstance) => {
    // Toggle coachJoining for a Shared Guidance session
    // This would update the instance and optionally set as default
    Alert.alert(
      inst.coachJoining ? 'Switch to Self Guided?' : 'Join this session?',
      inst.coachJoining
        ? 'This session will use a shared room instead of your personal Zoom.'
        : 'You\'ll join this session live using your personal Zoom.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Just this one',
          onPress: async () => {
            try {
              const fn = httpsCallable(functions, 'allocateSessionInstance');
              // For now, we'd need a toggleCoachJoining function — stub the alert
              Alert.alert('Coming soon', 'Per-session toggle will be available in the next update.');
            } catch (e) {}
          },
        },
        {
          text: 'Make default',
          onPress: () => {
            Alert.alert('Coming soon', 'Default toggle per session type/day will be available in the next update.');
          },
        },
      ]
    );
  }, []);

  // ── Computed ──────────────────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowStr = tomorrowDate.toISOString().split('T')[0];

  const todaySessions = instances.filter(i => i.scheduledDate === todayStr && i.status !== 'cancelled');
  const tomorrowSessions = instances.filter(i => i.scheduledDate === tomorrowStr && i.status !== 'cancelled');
  const upcomingSessions = instances.filter(i => i.scheduledDate > tomorrowStr && i.status !== 'cancelled');
  const pendingInstances = instances.filter(i => i.status === 'scheduled');
  const failedInstances = instances.filter(i => i.status === 'allocation_failed');
  const activeSlots = slots.filter(s => s.status === 'active');

  // Group slots by member
  const memberSlots = new Map<string, RecurringSlot[]>();
  activeSlots.forEach(slot => {
    const key = slot.memberId;
    if (!memberSlots.has(key)) memberSlots.set(key, []);
    memberSlots.get(key)!.push(slot);
  });

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
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Icon name="back" size={22} color={TEXT_CLR} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.pageTitle}>My Schedule</Text>
            <Text style={s.subtitle}>
              {todaySessions.length} session{todaySessions.length !== 1 ? 's' : ''} today
              {failedInstances.length > 0 ? ` · ${failedInstances.length} need attention` : ''}
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
            { key: 'alerts' as const, label: `Alerts${failedInstances.length > 0 ? ` (${failedInstances.length})` : ''}` },
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
            {/* Phase Legend */}
            <View style={s.legendRow}>
              {Object.entries(PHASE_DISPLAY).map(([key, val]) => (
                <View key={key} style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: val.color }]} />
                  <Text style={s.legendText}>{val.label}</Text>
                </View>
              ))}
            </View>

            {/* Pending allocation bar */}
            {pendingInstances.length > 0 && (
              <TouchableOpacity
                style={s.allocateBar}
                onPress={handleAllocateAll}
                disabled={allocating}
              >
                {allocating ? (
                  <ActivityIndicator size="small" color={BG} />
                ) : (
                  <Text style={s.allocateBarText}>
                    Assign Zoom rooms to {pendingInstances.length} pending session{pendingInstances.length !== 1 ? 's' : ''}
                  </Text>
                )}
              </TouchableOpacity>
            )}

            {/* Today */}
            <SectionHeader title="Today" count={todaySessions.length} />
            {todaySessions.length === 0 ? (
              <EmptyCard text="No sessions today. Enjoy the rest!" />
            ) : (
              todaySessions.map(inst => (
                <SessionCard
                  key={inst.id}
                  inst={inst}
                  onCancel={handleCancelInstance}
                  onToggleCoachJoining={handleToggleCoachJoining}
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
                  onCancel={handleCancelInstance}
                  onToggleCoachJoining={handleToggleCoachJoining}
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
                    onCancel={handleCancelInstance}
                    onToggleCoachJoining={handleToggleCoachJoining}
                    showDate
                  />
                ))}
                {upcomingSessions.length > 20 && (
                  <Text style={s.moreText}>+ {upcomingSessions.length - 20} more sessions</Text>
                )}
              </>
            )}

            {/* Empty state for entire schedule */}
            {instances.filter(i => i.status !== 'cancelled').length === 0 && (
              <View style={s.emptyHero}>
                <Icon name="calendar" size={48} color={MUTED} />
                <Text style={s.emptyHeroTitle}>No sessions scheduled yet</Text>
                <Text style={s.emptyHeroSub}>
                  Assign recurring time slots to your members from their Member Hub to get started.
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
                    const sessionLabel = SESSION_TYPE_LABELS[slot.sessionType || ''] || slot.sessionType || '';
                    return (
                      <View key={slot.id} style={s.slotRow}>
                        <View style={[s.phaseDot, { backgroundColor: phase.color }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.slotText}>
                            {DAY_SHORT_LABELS[slot.dayOfWeek]} · {formatTime(slot.startTime)} · {slot.durationMinutes}min
                          </Text>
                          <Text style={s.slotMeta}>
                            {phase.label}{sessionLabel ? ` · ${sessionLabel}` : ''} · {slot.recurrencePattern === 'biweekly' ? 'Every 2 weeks' : 'Weekly'}
                          </Text>
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
            <SectionHeader title="Needs Attention" count={failedInstances.length} />
            {failedInstances.length === 0 ? (
              <EmptyCard text="All clear! No scheduling issues right now." />
            ) : (
              failedInstances.map(inst => {
                const phase = PHASE_DISPLAY[inst.guidancePhase || ''] || null;
                return (
                  <View key={inst.id} style={[s.sessionCardBase, { borderLeftColor: RED, borderLeftWidth: 3 }]}>
                    <View style={s.sessionRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.sessionMember}>{inst.memberName}</Text>
                        <Text style={s.sessionTime}>
                          {inst.scheduledDate} · {formatTime(inst.scheduledStartTime)}
                        </Text>
                        {phase && (
                          <Text style={[s.phaseLabel, { color: phase.color }]}>{phase.label}</Text>
                        )}
                        <Text style={[s.alertReason]}>
                          {inst.allocationFailReason || 'Room allocation failed'}
                        </Text>
                      </View>
                      <StatusBadge status={inst.status} />
                    </View>
                    <View style={s.alertActions}>
                      <TouchableOpacity
                        style={s.retryBtn}
                        onPress={async () => {
                          try {
                            const fn = httpsCallable(functions, 'allocateSessionInstance');
                            const result = await fn({ instanceId: inst.id });
                            const data = result.data as any;
                            if (data.success) {
                              Alert.alert('Success', 'Room allocated!');
                            } else {
                              Alert.alert('Still failing', data.reason || 'Try adding more rooms.');
                            }
                          } catch (e: any) {
                            Alert.alert('Error', e.message);
                          }
                        }}
                      >
                        <Text style={s.retryBtnText}>Retry</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.cancelSmBtn}
                        onPress={() => handleCancelInstance(inst.id)}
                      >
                        <Text style={s.cancelSmBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}
      </ScrollView>
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
  const color = STATUS_COLORS[status] || MUTED;
  return (
    <View style={[s.badge, { backgroundColor: color + '20' }]}>
      <View style={[s.badgeDot, { backgroundColor: color }]} />
      <Text style={[s.badgeText, { color }]}>
        {status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
      </Text>
    </View>
  );
}

function SessionCard({
  inst,
  onCancel,
  onToggleCoachJoining,
  showDate,
}: {
  inst: SessionInstance;
  onCancel: (id: string) => void;
  onToggleCoachJoining: (inst: SessionInstance) => void;
  showDate?: boolean;
}) {
  const phase = PHASE_DISPLAY[inst.guidancePhase || ''] || null;
  const sessionLabel = SESSION_TYPE_LABELS[inst.sessionType || ''] || '';
  const isSharedGuidance = inst.guidancePhase === 'shared_guidance';

  return (
    <View style={s.sessionCardBase}>
      <View style={s.sessionRow}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={s.sessionMember}>{inst.memberName}</Text>
            {phase && (
              <View style={[s.phaseBadge, { backgroundColor: phase.color + '18' }]}>
                <Text style={[s.phaseBadgeText, { color: phase.color }]}>{phase.label}</Text>
              </View>
            )}
          </View>
          <Text style={s.sessionTime}>
            {showDate ? `${inst.scheduledDate} · ` : ''}
            {formatTime(inst.scheduledStartTime)} – {formatTime(inst.scheduledEndTime)}
            {sessionLabel ? ` · ${sessionLabel}` : ''}
          </Text>
          {inst.zoomRoomLabel && (
            <Text style={s.roomLabel}>{inst.zoomRoomLabel}</Text>
          )}
          {inst.zoomJoinUrl && (
            <Text style={s.zoomLink} numberOfLines={1}>{inst.zoomJoinUrl}</Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 6 }}>
          <StatusBadge status={inst.status} />
          {(inst.status === 'scheduled' || inst.status === 'allocated') && (
            <TouchableOpacity onPress={() => onCancel(inst.id)} style={s.cancelSmBtn}>
              <Text style={s.cancelSmBtnText}>Cancel</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Shared Guidance toggle */}
      {isSharedGuidance && (inst.status === 'scheduled' || inst.status === 'allocated') && (
        <TouchableOpacity
          style={s.coachToggle}
          onPress={() => onToggleCoachJoining(inst)}
        >
          <View style={[s.toggleDot, inst.coachJoining ? s.toggleDotOn : s.toggleDotOff]} />
          <Text style={s.toggleText}>
            {inst.coachJoining ? 'You\'re joining live' : 'Member on their own'}
          </Text>
          <Text style={s.toggleHint}>tap to change</Text>
        </TouchableOpacity>
      )}
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
  backBtn: { padding: 6 },
  pageTitle: { color: WHITE, fontSize: 20, fontWeight: '700', fontFamily: FONT },
  subtitle: { color: MUTED, fontSize: 13, marginTop: 2, fontFamily: FONT },
  betaBadge: { backgroundColor: GOLD + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  betaText: { color: GOLD, fontSize: 10, fontWeight: '700', letterSpacing: 1 },

  tabBar: { flexDirection: 'row', marginBottom: 16, gap: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: CARD_BG },
  tabActive: { backgroundColor: GOLD + '20' },
  tabText: { color: MUTED, fontSize: 13, fontWeight: '600', fontFamily: FONT },
  tabTextActive: { color: GOLD },

  legendRow: { flexDirection: 'row', gap: 16, marginBottom: 14, paddingHorizontal: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { color: MUTED, fontSize: 11, fontWeight: '600', fontFamily: FONT },

  allocateBar: {
    backgroundColor: GOLD,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 16,
  },
  allocateBarText: { color: BG, fontSize: 14, fontWeight: '700', fontFamily: FONT },

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
  roomLabel: { color: MUTED, fontSize: 12, marginTop: 4 },
  zoomLink: { color: BLUE, fontSize: 12, marginTop: 4 },

  phaseBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  phaseBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  phaseLabel: { fontSize: 12, fontWeight: '600', marginTop: 3 },

  memberCard: { backgroundColor: CARD_BG, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 10 },
  memberName: { color: WHITE, fontSize: 16, fontWeight: '700', marginBottom: 8, fontFamily: FONT },
  slotRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6, borderTopWidth: 1, borderTopColor: BORDER },
  phaseDot: { width: 8, height: 8, borderRadius: 4 },
  slotText: { color: TEXT_CLR, fontSize: 14, fontFamily: FONT },
  slotMeta: { color: MUTED, fontSize: 12, marginTop: 2, fontFamily: FONT },

  alertReason: { color: RED, fontSize: 12, marginTop: 4, fontStyle: 'italic' },
  alertActions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  retryBtn: { backgroundColor: GOLD + '20', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 6 },
  retryBtnText: { color: GOLD, fontSize: 12, fontWeight: '700' },

  cancelSmBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: RED + '20' },
  cancelSmBtnText: { color: RED, fontSize: 11, fontWeight: '600' },

  coachToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  toggleDot: { width: 10, height: 10, borderRadius: 5 },
  toggleDotOn: { backgroundColor: GREEN },
  toggleDotOff: { backgroundColor: MUTED },
  toggleText: { color: TEXT_CLR, fontSize: 12, fontWeight: '600', flex: 1, fontFamily: FONT },
  toggleHint: { color: MUTED, fontSize: 10, fontStyle: 'italic' },

  moreText: { color: MUTED, fontSize: 13, textAlign: 'center', paddingVertical: 12 },

  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, gap: 5 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
});
