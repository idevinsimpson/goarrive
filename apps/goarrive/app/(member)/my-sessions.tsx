/**
 * My Sessions — Member-facing session center
 *
 * Shows upcoming and past sessions, session detail with join flow,
 * and single-occurrence reschedule. Premium, calm, supportive copy.
 * No backend infrastructure language exposed.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Pressable,
  Modal,
  Alert,
  Linking,
  TextInput,
  RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { AppHeader } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../lib/firebase';
import {
  SessionInstance,
  formatTime,
  formatDateShort,
  GuidancePhase,
} from '../../lib/schedulingTypes';

// ─── Design tokens (match member home) ─────────────────────────────────────
const BG = '#0E1117';
const CARD_BG = '#151B26';
const BORDER = '#2A3347';
const GOLD = '#F5A623';
const GOLD_DIM = 'rgba(245,166,35,0.15)';
const GREEN = '#48BB78';
const GREEN_DIM = 'rgba(72,187,120,0.12)';
const RED = '#E05252';
const RED_DIM = 'rgba(224,82,82,0.10)';
const BLUE = '#4A90D9';
const TEXT_PRIMARY = '#F0F4F8';
const TEXT_SECONDARY = '#A0AEC0';
const TEXT_MUTED = '#718096';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

// ─── Member-facing labels (no backend language) ────────────────────────────
const PHASE_LABELS: Record<string, string> = {
  coach_guided: 'Fully Guided',
  shared_guidance: 'Blended',
  self_guided: 'Self-Reliant',
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  scheduled: { label: 'Upcoming', color: GOLD },
  allocated: { label: 'Ready', color: GREEN },
  in_progress: { label: 'In Progress', color: BLUE },
  completed: { label: 'Completed', color: GREEN },
  missed: { label: 'Missed', color: RED },
  cancelled: { label: 'Cancelled', color: TEXT_MUTED },
  rescheduled: { label: 'Rescheduled', color: GOLD },
  skipped: { label: 'Skipped', color: TEXT_MUTED },
  skip_requested: { label: 'Skip Pending', color: GOLD },
  allocation_failed: { label: 'Upcoming', color: GOLD }, // hide infra detail
};

const SKIP_CATEGORIES = ['Holiday', 'Vacation', 'Illness', 'Other'] as const;

const SESSION_TYPE_LABELS: Record<string, string> = {
  Strength: 'Strength Training',
  'Cardio + Mobility': 'Cardio & Mobility',
  Mix: 'Mixed Session',
  strength: 'Strength Training',
  cardio: 'Cardio',
  flexibility: 'Flexibility',
  hiit: 'HIIT',
  recovery: 'Recovery',
  check_in: 'Check-in',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isToday(dateStr: string): boolean {
  return dateStr === todayStr();
}

function isTomorrow(dateStr: string): boolean {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const tom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return dateStr === tom;
}

function friendlyDate(dateStr: string): string {
  if (isToday(dateStr)) return 'Today';
  if (isTomorrow(dateStr)) return 'Tomorrow';
  return formatDateShort(dateStr);
}

function canJoin(inst: SessionInstance): boolean {
  // Can join if allocated or in_progress and has a join URL
  return ['allocated', 'in_progress'].includes(inst.status) && !!inst.zoomJoinUrl;
}

function canReschedule(inst: SessionInstance): boolean {
  // Can reschedule if scheduled or allocated and in the future
  return ['scheduled', 'allocated', 'allocation_failed'].includes(inst.status) && inst.scheduledDate >= todayStr();
}

function canCancel(inst: SessionInstance): boolean {
  return ['scheduled', 'allocated', 'allocation_failed'].includes(inst.status) && inst.scheduledDate >= todayStr();
}

function canRequestSkip(inst: SessionInstance): boolean {
  return ['scheduled', 'allocated', 'allocation_failed'].includes(inst.status) && inst.scheduledDate >= todayStr();
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function MySessionsScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<SessionInstance | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);
  const [showSkipRequest, setShowSkipRequest] = useState(false);
  const [tab, setTab] = useState<'upcoming' | 'past' | 'calendar'>('upcoming');

  const fetchSessions = useCallback(async () => {
    if (!user) return;
    try {
      setError(null);
      const q = query(
        collection(db, 'session_instances'),
        where('memberId', '==', user.uid),
        orderBy('scheduledDate', 'asc'),
      );
      const snap = await getDocs(q);
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as SessionInstance));
      setSessions(items);
    } catch (err: any) {
      console.error('[MySessionsScreen] fetch error:', err);
      setError('Unable to load your sessions right now. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchSessions();
  }, [fetchSessions]);

  const today = todayStr();
  const upcoming = sessions.filter(
    (s) => s.scheduledDate >= today && !['cancelled', 'completed', 'missed', 'skipped'].includes(s.status)
  );
  const past = sessions.filter(
    (s) => s.scheduledDate < today || ['completed', 'missed', 'cancelled', 'skipped'].includes(s.status)
  ).reverse(); // most recent first

  const displayList = tab === 'upcoming' ? upcoming : past;

  // ─── Join handler ─────────────────────────────────────────────────────────
  async function handleJoin(inst: SessionInstance) {
    if (!inst.zoomJoinUrl) {
      Alert.alert('Not Ready Yet', 'Your session link will be available shortly before your session starts.');
      return;
    }
    try {
      await Linking.openURL(inst.zoomJoinUrl);
    } catch {
      Alert.alert('Unable to Open', 'Please copy the link and open it in your browser.');
    }
  }

  // ─── Join in app (beta) — routes to the embedded Zoom Meeting SDK flow ────
  // Primary Join handler above is untouched. This is a secondary entry point
  // gated to allocated/in-progress sessions only.
  function handleJoinInApp(inst: SessionInstance) {
    if (!canJoin(inst)) return;
    router.push(`/join/${inst.id}` as any);
  }

  // ─── Cancel handler ───────────────────────────────────────────────────────
  async function handleCancel(inst: SessionInstance) {
    Alert.alert(
      'Cancel Session',
      `Are you sure you want to cancel your ${friendlyDate(inst.scheduledDate)} session?`,
      [
        { text: 'Keep Session', style: 'cancel' },
        {
          text: 'Cancel Session',
          style: 'destructive',
          onPress: async () => {
            try {
              const cancelFn = httpsCallable(functions, 'cancelInstance');
              await cancelFn({ instanceId: inst.id });
              setSelectedSession(null);
              fetchSessions();
            } catch (err: any) {
              Alert.alert('Unable to Cancel', 'Please try again or contact your coach.');
            }
          },
        },
      ]
    );
  }

  // ─── Loading state ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={s.root}>
        <AppHeader />
        <View style={s.center}>
          <ActivityIndicator size="large" color={GOLD} />
          <Text style={s.loadingText}>Loading your sessions...</Text>
        </View>
      </View>
    );
  }

  // ─── Error state ──────────────────────────────────────────────────────────
  if (error) {
    return (
      <View style={s.root}>
        <AppHeader />
        <View style={s.center}>
          <Icon name="alert-circle" size={40} color={RED} />
          <Text style={s.errorText}>{error}</Text>
          <Pressable style={s.retryBtn} onPress={fetchSessions}>
            <Text style={s.retryBtnText}>Try Again</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <AppHeader />

      {/* Page title */}
      <View style={s.titleRow}>
        <Text style={s.pageTitle}>My Sessions</Text>
      </View>

      {/* Tab bar */}
      <View style={s.tabBar}>
        <Pressable
          style={[s.tabBtn, tab === 'upcoming' && s.tabBtnActive]}
          onPress={() => setTab('upcoming')}
        >
          <Text style={[s.tabText, tab === 'upcoming' && s.tabTextActive]}>
            Upcoming{upcoming.length > 0 ? ` (${upcoming.length})` : ''}
          </Text>
        </Pressable>
        <Pressable
          style={[s.tabBtn, tab === 'past' && s.tabBtnActive]}
          onPress={() => setTab('past')}
        >
          <Text style={[s.tabText, tab === 'past' && s.tabTextActive]}>
            Past{past.length > 0 ? ` (${past.length})` : ''}
          </Text>
        </Pressable>
        <Pressable
          style={[s.tabBtn, tab === 'calendar' && s.tabBtnActive]}
          onPress={() => setTab('calendar')}
        >
          <Text style={[s.tabText, tab === 'calendar' && s.tabTextActive]}>
            Calendar
          </Text>
        </Pressable>
      </View>

      {/* Calendar view */}
      {tab === 'calendar' && (
        <MemberCalendarView sessions={upcoming} onSelectSession={setSelectedSession} />
      )}

      {/* Session list */}
      {tab !== 'calendar' && <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={GOLD} />
        }
      >
        {displayList.length === 0 ? (
          <EmptyState tab={tab} />
        ) : (
          displayList.map((inst) => (
            <SessionCard
              key={inst.id}
              inst={inst}
              onPress={() => setSelectedSession(inst)}
              onJoin={() => handleJoin(inst)}
            />
          ))
        )}
        {/* Bottom padding for tab bar */}
        <View style={{ height: 100 }} />
      </ScrollView>}

      {/* Session detail modal */}
      {selectedSession && (
        <SessionDetailModal
          inst={selectedSession}
          onClose={() => setSelectedSession(null)}
          onJoin={() => handleJoin(selectedSession)}
          onJoinInApp={() => {
            setSelectedSession(null);
            handleJoinInApp(selectedSession);
          }}
          onCancel={() => handleCancel(selectedSession)}
          onReschedule={() => {
            setShowReschedule(true);
          }}
          onSkipRequest={() => {
            setShowSkipRequest(true);
          }}
        />
      )}

      {/* Reschedule modal */}
      {showReschedule && selectedSession && (
        <RescheduleModal
          inst={selectedSession}
          onClose={() => setShowReschedule(false)}
          onDone={() => {
            setShowReschedule(false);
            setSelectedSession(null);
            fetchSessions();
          }}
        />
      )}

      {/* Skip request modal */}
      {showSkipRequest && selectedSession && (
        <SkipRequestModal
          inst={selectedSession}
          onClose={() => setShowSkipRequest(false)}
          onDone={() => {
            setShowSkipRequest(false);
            setSelectedSession(null);
            fetchSessions();
          }}
        />
      )}
    </View>
  );
}

// ─── Member Calendar View (Item 3) ─────────────────────────────────────────

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOUR_START = 5;
const HOUR_END = 22;

function MemberCalendarView({
  sessions,
  onSelectSession,
}: {
  sessions: SessionInstance[];
  onSelectSession: (s: SessionInstance) => void;
}) {
  const [weekOffset, setWeekOffset] = useState(0);

  // Compute week dates based on offset
  const weekDays = React.useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + (weekOffset * 7));
    startOfWeek.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startOfWeek);
      d.setDate(startOfWeek.getDate() + i);
      const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      return { date: d, dateStr, dayName: DAYS_OF_WEEK[d.getDay()], dayNum: d.getDate(), isToday: dateStr === todayStr() };
    });
  }, [weekOffset]);

  // Filter sessions to this week
  const weekSessions = React.useMemo(() => {
    const startStr = weekDays[0].dateStr;
    const endStr = weekDays[6].dateStr;
    return sessions.filter(s => s.scheduledDate >= startStr && s.scheduledDate <= endStr);
  }, [sessions, weekDays]);

  // Group by date string
  const sessionsByDate: Record<string, SessionInstance[]> = {};
  for (const sess of weekSessions) {
    if (!sessionsByDate[sess.scheduledDate]) sessionsByDate[sess.scheduledDate] = [];
    sessionsByDate[sess.scheduledDate].push(sess);
  }

  // Week label
  const weekLabel = weekOffset === 0 ? 'This Week' :
    weekOffset === 1 ? 'Next Week' :
    weekOffset === -1 ? 'Last Week' :
    `${weekDays[0].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${weekDays[6].date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  const hourHeight = 40;
  const totalHeight = (HOUR_END - HOUR_START) * hourHeight;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }}>
      {/* Week navigation with arrows */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8 }}>
        <Pressable onPress={() => setWeekOffset(o => o - 1)} hitSlop={12} style={{ padding: 6 }}>
          <Icon name="chevron-left" size={22} color={TEXT_PRIMARY} />
        </Pressable>
        <Pressable onPress={() => setWeekOffset(0)}>
          <Text style={{ fontSize: 15, fontWeight: '600', color: TEXT_PRIMARY, fontFamily: FH }}>{weekLabel}</Text>
        </Pressable>
        <Pressable onPress={() => setWeekOffset(o => o + 1)} hitSlop={12} style={{ padding: 6 }}>
          <Icon name="chevron-right" size={22} color={TEXT_PRIMARY} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', paddingHorizontal: 4 }}>
        {/* Time axis */}
        <View style={{ width: 40, marginTop: 36 }}>
          {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => {
            const h = HOUR_START + i;
            const label = h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`;
            return (
              <View key={h} style={{ height: hourHeight, justifyContent: 'flex-start' }}>
                <Text style={{ fontSize: 9, color: TEXT_MUTED, fontFamily: FB, textAlign: 'right', paddingRight: 4 }}>{label}</Text>
              </View>
            );
          })}
        </View>
        {/* Day columns */}
        {weekDays.map((day) => {
          const daySessions = sessionsByDate[day.dateStr] || [];
          return (
            <View key={day.dateStr} style={{ flex: 1, marginHorizontal: 1 }}>
              <View style={{ alignItems: 'center', marginBottom: 4 }}>
                <Text style={{ fontSize: 10, color: day.isToday ? GOLD : TEXT_SECONDARY, fontFamily: FH }}>{day.dayName}</Text>
                <Text style={{ fontSize: 11, color: day.isToday ? GOLD : TEXT_MUTED, fontFamily: FH, fontWeight: day.isToday ? '700' : '400' }}>{day.dayNum}</Text>
              </View>
              <View style={{ height: totalHeight, backgroundColor: day.isToday ? 'rgba(245,166,35,0.04)' : 'rgba(255,255,255,0.02)', borderRadius: 4, position: 'relative' as any }}>
                {/* Hour grid lines */}
                {Array.from({ length: HOUR_END - HOUR_START }, (_, i) => (
                  <View key={i} style={{ position: 'absolute' as any, top: i * hourHeight, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.04)' }} />
                ))}
                {/* Session blocks */}
                {daySessions.map((sess) => {
                  const [hh, mm] = (sess.scheduledStartTime || '06:00').split(':').map(Number);
                  const [eh, em] = (sess.scheduledEndTime || '06:30').split(':').map(Number);
                  const startMin = hh * 60 + mm;
                  const endMin = eh * 60 + em;
                  const top = ((startMin - HOUR_START * 60) / 60) * hourHeight;
                  const height = Math.max(((endMin - startMin) / 60) * hourHeight, 16);
                  const statusInfo = STATUS_LABELS[sess.status] || { label: sess.status, color: TEXT_MUTED };
                  return (
                    <Pressable
                      key={sess.id}
                      style={{
                        position: 'absolute' as any,
                        top,
                        left: 1,
                        right: 1,
                        height,
                        backgroundColor: statusInfo.color + '25',
                        borderLeftWidth: 2,
                        borderLeftColor: statusInfo.color,
                        borderRadius: 3,
                        padding: 2,
                        overflow: 'hidden' as any,
                      }}
                      onPress={() => onSelectSession(sess)}
                    >
                      <Text style={{ fontSize: 8, color: statusInfo.color, fontFamily: FH }} numberOfLines={1}>
                        {formatTime(sess.scheduledStartTime)}
                      </Text>
                      <Text style={{ fontSize: 7, color: TEXT_SECONDARY, fontFamily: FB }} numberOfLines={1}>
                        {SESSION_TYPE_LABELS[sess.sessionType || ''] || sess.sessionType || 'Session'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

// ─── Empty State ────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: 'upcoming' | 'past' }) {
  return (
    <View style={s.emptyWrap}>
      <Icon name="calendar" size={48} color={TEXT_MUTED} />
      <Text style={s.emptyTitle}>
        {tab === 'upcoming' ? 'No upcoming sessions' : 'No past sessions'}
      </Text>
      <Text style={s.emptySubtitle}>
        {tab === 'upcoming'
          ? 'Your scheduled sessions will appear here. Your coach will set up your session rhythm.'
          : 'Your completed sessions will be listed here as you progress.'}
      </Text>
    </View>
  );
}

// ─── Session Card ───────────────────────────────────────────────────────────

function SessionCard({
  inst,
  onPress,
  onJoin,
}: {
  inst: SessionInstance;
  onPress: () => void;
  onJoin: () => void;
}) {
  const statusInfo = STATUS_LABELS[inst.status] || { label: inst.status, color: TEXT_MUTED };
  const sessionLabel = inst.sessionType
    ? SESSION_TYPE_LABELS[inst.sessionType] || inst.sessionType
    : 'Session';
  const phaseLabel = inst.guidancePhase ? PHASE_LABELS[inst.guidancePhase] : null;
  const showJoin = canJoin(inst);
  const isLive = inst.coachExpectedLive;

  return (
    <Pressable style={s.card} onPress={onPress}>
      <View style={s.cardHeader}>
        <View style={s.cardDateWrap}>
          <Text style={s.cardDate}>{friendlyDate(inst.scheduledDate)}</Text>
          <Text style={s.cardTime}>
            {formatTime(inst.scheduledStartTime)} – {formatTime(inst.scheduledEndTime)}
          </Text>
        </View>
        <View style={[s.statusBadge, { backgroundColor: statusInfo.color + '20' }]}>
          <Text style={[s.statusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
        </View>
      </View>

      <View style={s.cardBody}>
        <Text style={s.cardSessionType}>{sessionLabel}</Text>
        <View style={s.cardMeta}>
          {phaseLabel && (
            <View style={s.metaChip}>
              <Icon name="shield" size={12} color={TEXT_SECONDARY} />
              <Text style={s.metaText}>{phaseLabel}</Text>
            </View>
          )}
          {isLive && (
            <View style={[s.metaChip, { backgroundColor: GREEN_DIM }]}>
              <Icon name="video" size={12} color={GREEN} />
              <Text style={[s.metaText, { color: GREEN }]}>Coach Live</Text>
            </View>
          )}
          {inst.commitToSaveEnabled && (
            <View style={[s.metaChip, { backgroundColor: GOLD_DIM }]}>
              <Icon name="zap" size={12} color={GOLD} />
              <Text style={[s.metaText, { color: GOLD }]}>CTS</Text>
            </View>
          )}
        </View>
      </View>

      {showJoin && (
        <Pressable
          style={s.joinBtn}
          onPress={(e) => {
            e.stopPropagation?.();
            onJoin();
          }}
        >
          <Icon name="video" size={16} color="#FFF" />
          <Text style={s.joinBtnText}>Join Session</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

// ─── Session Detail Modal ───────────────────────────────────────────────────

function SessionDetailModal({
  inst,
  onClose,
  onJoin,
  onJoinInApp,
  onCancel,
  onReschedule,
  onSkipRequest,
}: {
  inst: SessionInstance;
  onClose: () => void;
  onJoin: () => void;
  onJoinInApp: () => void;
  onCancel: () => void;
  onReschedule: () => void;
  onSkipRequest: () => void;
}) {
  const statusInfo = STATUS_LABELS[inst.status] || { label: inst.status, color: TEXT_MUTED };
  const sessionLabel = inst.sessionType
    ? SESSION_TYPE_LABELS[inst.sessionType] || inst.sessionType
    : 'Session';
  const phaseLabel = inst.guidancePhase ? PHASE_LABELS[inst.guidancePhase] : null;
  const showJoin = canJoin(inst);
  const showReschedule = canReschedule(inst);
  const showCancel = canCancel(inst);
  const showSkipRequest = canRequestSkip(inst);
  const isSkipPending = inst.status === ('skip_requested' as any);

  // Coach live info for member
  const coachLiveInfo = inst.coachExpectedLive
    ? inst.guidancePhase === 'coach_guided'
      ? 'Your coach will be with you for the entire session.'
      : inst.liveCoachingDuration
        ? `Your coach will join for ${inst.liveCoachingDuration} minutes of this session.`
        : 'Your coach will join for part of this session.'
    : inst.guidancePhase === 'self_guided'
      ? 'This is your independent session. You\'ve got this!'
      : null;

  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <View style={s.modalSheet}>
          {/* Header */}
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Session Details</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Icon name="close" size={22} color={TEXT_SECONDARY} />
            </Pressable>
          </View>

          <ScrollView style={s.modalScroll} showsVerticalScrollIndicator={false}>
            {/* Date & time */}
            <View style={s.detailSection}>
              <View style={s.detailRow}>
                <Icon name="calendar" size={18} color={GOLD} />
                <Text style={s.detailLabel}>{friendlyDate(inst.scheduledDate)}</Text>
              </View>
              <View style={s.detailRow}>
                <Icon name="clock" size={18} color={GOLD} />
                <Text style={s.detailLabel}>
                  {formatTime(inst.scheduledStartTime)} – {formatTime(inst.scheduledEndTime)}
                  {inst.durationMinutes ? ` (${inst.durationMinutes} min)` : ''}
                </Text>
              </View>
            </View>

            {/* Session info */}
            <View style={s.detailSection}>
              <Text style={s.sectionLabel}>Session</Text>
              <Text style={s.detailValue}>{sessionLabel}</Text>
              {phaseLabel && (
                <View style={s.detailRow}>
                  <Icon name="shield" size={14} color={TEXT_SECONDARY} />
                  <Text style={s.detailSub}>{phaseLabel}</Text>
                </View>
              )}
            </View>

            {/* Status */}
            <View style={s.detailSection}>
              <Text style={s.sectionLabel}>Status</Text>
              <View style={[s.statusBadge, { backgroundColor: statusInfo.color + '20', alignSelf: 'flex-start' }]}>
                <Text style={[s.statusText, { color: statusInfo.color }]}>{statusInfo.label}</Text>
              </View>
            </View>

            {/* Coach live info */}
            {coachLiveInfo && (
              <View style={s.detailSection}>
                <Text style={s.sectionLabel}>Your Coach</Text>
                <View style={[s.infoCard, { backgroundColor: inst.coachExpectedLive ? GREEN_DIM : GOLD_DIM }]}>
                  <Icon
                    name={inst.coachExpectedLive ? 'video' : 'shield'}
                    size={16}
                    color={inst.coachExpectedLive ? GREEN : GOLD}
                  />
                  <Text style={[s.infoText, { color: inst.coachExpectedLive ? GREEN : GOLD }]}>
                    {coachLiveInfo}
                  </Text>
                </View>
              </View>
            )}

            {/* CTS awareness */}
            {inst.commitToSaveEnabled && (
              <View style={s.detailSection}>
                <View style={[s.infoCard, { backgroundColor: GOLD_DIM }]}>
                  <Icon name="zap" size={16} color={GOLD} />
                  <Text style={[s.infoText, { color: GOLD }]}>
                    Commit to Save is active for this session. Show up and save.
                  </Text>
                </View>
              </View>
            )}

            {/* Rescheduled from */}
            {inst.rescheduledFrom && (
              <View style={s.detailSection}>
                <Text style={s.detailSub}>Rescheduled from {inst.rescheduledFrom}</Text>
              </View>
            )}

            {/* Recording */}
            {inst.recordingAvailable && inst.recordings && inst.recordings.length > 0 && (
              <View style={s.detailSection}>
                <Text style={s.sectionLabel}>Recording</Text>
                <View style={[s.infoCard, { backgroundColor: GREEN_DIM }]}>
                  <Icon name="play-circle" size={16} color={GREEN} />
                  <Text style={[s.infoText, { color: GREEN }]}>
                    Your session recording is available.
                  </Text>
                </View>
                {inst.recordings.filter(r => r.playUrl).map((r, i) => (
                  <Pressable
                    key={i}
                    style={s.recordingLink}
                    onPress={() => r.playUrl && Linking.openURL(r.playUrl)}
                  >
                    <Icon name="play" size={14} color={BLUE} />
                    <Text style={[s.detailSub, { color: BLUE }]}>
                      Watch {r.fileType || 'Recording'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Skip pending notice */}
            {isSkipPending && (
              <View style={s.detailSection}>
                <View style={[s.infoCard, { backgroundColor: GOLD_DIM }]}>
                  <Icon name="clock" size={16} color={GOLD} />
                  <Text style={[s.infoText, { color: GOLD }]}>
                    Your skip request is pending coach approval.
                  </Text>
                </View>
              </View>
            )}

            {/* Actions */}
            <View style={s.actionSection}>
              {showJoin && (
                <Pressable style={s.primaryBtn} onPress={onJoin}>
                  <Icon name="video" size={18} color="#FFF" />
                  <Text style={s.primaryBtnText}>Join Session</Text>
                </Pressable>
              )}
              {showJoin && (
                <Pressable style={s.secondaryBtn} onPress={onJoinInApp}>
                  <Icon name="video" size={16} color={GOLD} />
                  <Text style={s.secondaryBtnText}>Join in app (beta)</Text>
                </Pressable>
              )}
              {showReschedule && (
                <Pressable style={s.secondaryBtn} onPress={onReschedule}>
                  <Icon name="calendar" size={16} color={GOLD} />
                  <Text style={s.secondaryBtnText}>Reschedule</Text>
                </Pressable>
              )}
              {showSkipRequest && !isSkipPending && (
                <Pressable style={s.secondaryBtn} onPress={onSkipRequest}>
                  <Icon name="skip-forward" size={16} color={GOLD} />
                  <Text style={s.secondaryBtnText}>Request Skip</Text>
                </Pressable>
              )}
              {showCancel && (
                <Pressable style={s.dangerBtn} onPress={onCancel}>
                  <Icon name="close" size={16} color={RED} />
                  <Text style={s.dangerBtnText}>Cancel Session</Text>
                </Pressable>
              )}
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Reschedule Modal ───────────────────────────────────────────────────────

function RescheduleModal({
  inst,
  onClose,
  onDone,
}: {
  inst: SessionInstance;
  onClose: () => void;
  onDone: () => void;
}) {
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit() {
    if (!newDate || !newTime) {
      setErr('Please enter both a new date and time.');
      return;
    }
    // Validate date format YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      setErr('Date must be in YYYY-MM-DD format (e.g. 2026-04-01).');
      return;
    }
    // Validate time format HH:mm
    if (!/^\d{2}:\d{2}$/.test(newTime)) {
      setErr('Time must be in HH:MM format (e.g. 06:00).');
      return;
    }
    // Must be in the future
    if (newDate < todayStr()) {
      setErr('The new date must be today or later.');
      return;
    }

    setSubmitting(true);
    setErr(null);
    try {
      const rescheduleFn = httpsCallable(functions, 'rescheduleInstance');
      await rescheduleFn({ instanceId: inst.id, newDate, newStartTime: newTime });
      onDone();
    } catch (e: any) {
      setErr(e.message || 'Unable to reschedule. Please try again or contact your coach.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible animationType="fade" transparent>
      <View style={s.modalOverlay}>
        <View style={[s.modalSheet, { maxHeight: 420 }]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Reschedule Session</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Icon name="close" size={22} color={TEXT_SECONDARY} />
            </Pressable>
          </View>

          <View style={s.rescheduleBody}>
            <Text style={s.rescheduleInfo}>
              Move your {friendlyDate(inst.scheduledDate)} session at {formatTime(inst.scheduledStartTime)} to a new date and time.
            </Text>

            <Text style={s.inputLabel}>New Date</Text>
            <TextInput
              style={s.input}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={TEXT_MUTED}
              value={newDate}
              onChangeText={setNewDate}
              keyboardType="default"
              autoCapitalize="none"
            />

            <Text style={s.inputLabel}>New Time</Text>
            <TextInput
              style={s.input}
              placeholder="HH:MM (24h, e.g. 06:00)"
              placeholderTextColor={TEXT_MUTED}
              value={newTime}
              onChangeText={setNewTime}
              keyboardType="default"
              autoCapitalize="none"
            />

            {err && <Text style={s.errText}>{err}</Text>}

            <Pressable
              style={[s.primaryBtn, submitting && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={s.primaryBtnText}>Confirm Reschedule</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Skip Request Modal (Member self-skip with coach approval) ─────────────

function SkipRequestModal({
  inst,
  onClose,
  onDone,
}: {
  inst: SessionInstance;
  onClose: () => void;
  onDone: () => void;
}) {
  const [selectedCategory, setSelectedCategory] = useState<string>('Holiday');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setErr(null);
    try {
      const skipFn = httpsCallable(functions, 'requestSkipInstance');
      await skipFn({
        instanceId: inst.id,
        skipCategory: selectedCategory,
        reason: reason.trim() || undefined,
      });
      onDone();
    } catch (e: any) {
      setErr(e.message || 'Unable to request skip. Please try again or contact your coach.');
    } finally {
      setSubmitting(false);
    }
  }

  const hasCTS = inst.commitToSaveEnabled;

  return (
    <Modal visible animationType="fade" transparent>
      <View style={s.modalOverlay}>
        <View style={[s.modalSheet, { maxHeight: 520 }]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Request Skip</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Icon name="close" size={22} color={TEXT_SECONDARY} />
            </Pressable>
          </View>

          <View style={s.rescheduleBody}>
            <Text style={s.rescheduleInfo}>
              Request to skip your {friendlyDate(inst.scheduledDate)} session at {formatTime(inst.scheduledStartTime)}. Your coach will review and approve.
            </Text>

            {hasCTS && (
              <View style={[s.infoCard, { backgroundColor: GOLD_DIM, marginBottom: 4 }]}>
                <Icon name="zap" size={16} color={GOLD} />
                <Text style={[s.infoText, { color: GOLD }]}>
                  Commit to Save is active. Your coach will determine if accountability fees apply.
                </Text>
              </View>
            )}

            <Text style={s.inputLabel}>Reason</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
              {SKIP_CATEGORIES.map((cat) => (
                <Pressable
                  key={cat}
                  style={[
                    s.skipCategoryBtn,
                    selectedCategory === cat && s.skipCategoryBtnActive,
                  ]}
                  onPress={() => setSelectedCategory(cat)}
                >
                  <Text style={[
                    s.skipCategoryText,
                    selectedCategory === cat && s.skipCategoryTextActive,
                  ]}>{cat}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.inputLabel}>Additional Details (optional)</Text>
            <TextInput
              style={[s.input, { minHeight: 60, textAlignVertical: 'top' }]}
              placeholder="Any details for your coach..."
              placeholderTextColor={TEXT_MUTED}
              value={reason}
              onChangeText={setReason}
              multiline
              autoCapitalize="sentences"
            />

            {err && <Text style={s.errText}>{err}</Text>}

            <Pressable
              style={[s.primaryBtn, submitting && { opacity: 0.6 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Text style={s.primaryBtnText}>Submit Skip Request</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText: { marginTop: 12, fontSize: 14, color: TEXT_SECONDARY, fontFamily: FB },
  errorText: { marginTop: 12, fontSize: 14, color: RED, fontFamily: FB, textAlign: 'center' },
  retryBtn: {
    marginTop: 16, paddingHorizontal: 24, paddingVertical: 10,
    backgroundColor: GOLD_DIM, borderRadius: 8, borderWidth: 1, borderColor: GOLD + '40',
  },
  retryBtnText: { fontSize: 14, fontWeight: '600', color: GOLD, fontFamily: FB },

  // Title
  titleRow: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  pageTitle: { fontSize: 22, fontWeight: '700', color: TEXT_PRIMARY, fontFamily: FH },

  // Tabs
  tabBar: {
    flexDirection: 'row', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 8,
  },
  tabBtn: {
    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
    backgroundColor: 'transparent', borderWidth: 1, borderColor: BORDER,
  },
  tabBtnActive: { backgroundColor: GOLD_DIM, borderColor: GOLD + '60' },
  tabText: { fontSize: 13, fontWeight: '600', color: TEXT_MUTED, fontFamily: FB },
  tabTextActive: { color: GOLD },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12 },

  // Empty
  emptyWrap: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: TEXT_SECONDARY, fontFamily: FH },
  emptySubtitle: { fontSize: 13, color: TEXT_MUTED, fontFamily: FB, textAlign: 'center', maxWidth: 280 },

  // Card
  card: {
    backgroundColor: CARD_BG, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: BORDER,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardDateWrap: { flex: 1 },
  cardDate: { fontSize: 15, fontWeight: '700', color: TEXT_PRIMARY, fontFamily: FH },
  cardTime: { fontSize: 13, color: TEXT_SECONDARY, fontFamily: FB, marginTop: 2 },
  cardBody: { marginTop: 10 },
  cardSessionType: { fontSize: 14, fontWeight: '600', color: TEXT_PRIMARY, fontFamily: FB },
  cardMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: BORDER, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  metaText: { fontSize: 11, fontWeight: '600', color: TEXT_SECONDARY, fontFamily: FB },

  // Status badge
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusText: { fontSize: 11, fontWeight: '700', fontFamily: FB },

  // Join button on card
  joinBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: GREEN, borderRadius: 8, paddingVertical: 10, marginTop: 12,
  },
  joinBtnText: { fontSize: 14, fontWeight: '700', color: '#FFF', fontFamily: FB },

  // Modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: BG, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    maxHeight: '85%', paddingBottom: Platform.select({ ios: 34, default: 16 }),
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: BORDER,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: TEXT_PRIMARY, fontFamily: FH },
  modalScroll: { paddingHorizontal: 16 },

  // Detail sections
  detailSection: { paddingTop: 16, gap: 6 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailLabel: { fontSize: 15, fontWeight: '600', color: TEXT_PRIMARY, fontFamily: FB },
  detailValue: { fontSize: 15, color: TEXT_PRIMARY, fontFamily: FB },
  detailSub: { fontSize: 13, color: TEXT_SECONDARY, fontFamily: FB },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: TEXT_MUTED, fontFamily: FH, textTransform: 'uppercase', letterSpacing: 0.5 },

  // Info card
  infoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 12, borderRadius: 10,
  },
  infoText: { fontSize: 13, fontWeight: '500', fontFamily: FB, flex: 1 },

  // Recording link
  recordingLink: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 6,
  },

  // Actions
  actionSection: { paddingTop: 20, gap: 10 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GREEN, borderRadius: 10, paddingVertical: 14,
  },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#FFF', fontFamily: FB },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: GOLD_DIM, borderRadius: 10, paddingVertical: 12,
    borderWidth: 1, borderColor: GOLD + '40',
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600', color: GOLD, fontFamily: FB },
  dangerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: RED_DIM, borderRadius: 10, paddingVertical: 12,
    borderWidth: 1, borderColor: RED + '30',
  },
  dangerBtnText: { fontSize: 14, fontWeight: '600', color: RED, fontFamily: FB },

  // Reschedule
  rescheduleBody: { padding: 16, gap: 12 },
  rescheduleInfo: { fontSize: 14, color: TEXT_SECONDARY, fontFamily: FB },
  inputLabel: { fontSize: 12, fontWeight: '700', color: TEXT_MUTED, fontFamily: FH, textTransform: 'uppercase' },
  input: {
    backgroundColor: CARD_BG, borderRadius: 8, borderWidth: 1, borderColor: BORDER,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: TEXT_PRIMARY, fontFamily: FB,
  },
  errText: { fontSize: 13, color: RED, fontFamily: FB },

  // Skip category buttons
  skipCategoryBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: BORDER, backgroundColor: 'transparent',
  },
  skipCategoryBtnActive: { backgroundColor: GOLD_DIM, borderColor: GOLD + '60' },
  skipCategoryText: { fontSize: 13, fontWeight: '600', color: TEXT_MUTED, fontFamily: FB },
  skipCategoryTextActive: { color: GOLD },
});
