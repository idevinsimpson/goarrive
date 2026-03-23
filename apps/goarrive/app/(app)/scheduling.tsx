/**
 * scheduling.tsx — Coach Scheduling Command Center
 *
 * Operational dashboard for the GoArrive scheduling backbone.
 * Shows Zoom room pool, recurring member slots, upcoming session instances,
 * allocation status, and action buttons for managing the schedule.
 *
 * Design: KW-style Command Center — high-signal cards, clear statuses,
 * readable lists, obvious calls to action, minimal clutter.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
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
  orderBy,
  onSnapshot,
  getDocs,
  Timestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../../lib/firebase';
import {
  DAY_SHORT_LABELS,
  formatTime,
  type ZoomRoom,
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
const MUTED = '#6B7280';
const TEXT = '#E5E7EB';
const WHITE = '#FFFFFF';

// ── Status badge colors ──────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  active: GREEN,
  inactive: MUTED,
  maintenance: AMBER,
  scheduled: GOLD,
  allocated: GREEN,
  allocation_failed: RED,
  in_progress: '#3B82F6',
  completed: GREEN,
  missed: RED,
  cancelled: MUTED,
  rescheduled: AMBER,
  paused: AMBER,
};

export default function SchedulingScreen() {
  const { user, claims } = useAuth();
  const router = useRouter();
  const coachId = claims?.coachId || user?.uid || '';

  // ── State ────────────────────────────────────────────────────────────────
  const [rooms, setRooms] = useState<ZoomRoom[]>([]);
  const [slots, setSlots] = useState<RecurringSlot[]>([]);
  const [instances, setInstances] = useState<SessionInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [allocating, setAllocating] = useState(false);
  const [showAddRoom, setShowAddRoom] = useState(false);
  const [newRoomLabel, setNewRoomLabel] = useState('');
  const [newRoomEmail, setNewRoomEmail] = useState('');
  const [addingRoom, setAddingRoom] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'rooms' | 'slots' | 'sessions'>('overview');

  // ── Load data ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!coachId) return;

    const unsubRooms = onSnapshot(
      query(collection(db, 'zoom_rooms'), where('coachId', '==', coachId)),
      (snap) => {
        setRooms(snap.docs.map(d => ({ id: d.id, ...d.data() } as ZoomRoom)));
      }
    );

    const unsubSlots = onSnapshot(
      query(collection(db, 'recurring_slots'), where('coachId', '==', coachId)),
      (snap) => {
        setSlots(snap.docs.map(d => ({ id: d.id, ...d.data() } as RecurringSlot)));
      }
    );

    // Load upcoming instances (next 28 days)
    const today = new Date().toISOString().split('T')[0];
    const unsubInstances = onSnapshot(
      query(
        collection(db, 'session_instances'),
        where('coachId', '==', coachId),
        where('scheduledDate', '>=', today),
      ),
      (snap) => {
        const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as SessionInstance));
        all.sort((a, b) => {
          const dc = a.scheduledDate.localeCompare(b.scheduledDate);
          if (dc !== 0) return dc;
          return a.scheduledStartTime.localeCompare(b.scheduledStartTime);
        });
        setInstances(all);
        setLoading(false);
      }
    );

    return () => {
      unsubRooms();
      unsubSlots();
      unsubInstances();
    };
  }, [coachId]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleAddRoom = useCallback(async () => {
    if (!newRoomLabel.trim() || !newRoomEmail.trim()) return;
    setAddingRoom(true);
    try {
      const fn = httpsCallable(functions, 'manageZoomRoom');
      await fn({ action: 'add', roomData: { label: newRoomLabel.trim(), zoomAccountEmail: newRoomEmail.trim() } });
      setNewRoomLabel('');
      setNewRoomEmail('');
      setShowAddRoom(false);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to add room');
    }
    setAddingRoom(false);
  }, [newRoomLabel, newRoomEmail]);

  const handleToggleRoom = useCallback(async (room: ZoomRoom) => {
    try {
      const fn = httpsCallable(functions, 'manageZoomRoom');
      await fn({
        action: room.status === 'active' ? 'deactivate' : 'activate',
        roomId: room.id,
      });
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update room');
    }
  }, []);

  const handleAllocateAll = useCallback(async () => {
    setAllocating(true);
    try {
      const fn = httpsCallable(functions, 'allocateAllPendingInstances');
      const result = await fn({});
      const data = result.data as any;
      Alert.alert(
        'Allocation Complete',
        `${data.allocated} allocated, ${data.failed} failed out of ${data.total} pending`
      );
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

  // ── Computed stats ───────────────────────────────────────────────────────
  const activeRooms = rooms.filter(r => r.status === 'active');
  const activeSlots = slots.filter(s => s.status === 'active');
  const pendingInstances = instances.filter(i => i.status === 'scheduled');
  const allocatedInstances = instances.filter(i => i.status === 'allocated');
  const failedInstances = instances.filter(i => i.status === 'allocation_failed');
  const todayStr = new Date().toISOString().split('T')[0];
  const todaySessions = instances.filter(i => i.scheduledDate === todayStr && i.status !== 'cancelled');

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
            <Icon name="back" size={22} color={TEXT} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.pageTitle}>Scheduling Command Center</Text>
            <Text style={s.subtitle}>Manage rooms, slots, and sessions</Text>
          </View>
          <View style={s.betaBadge}>
            <Text style={s.betaText}>BETA</Text>
          </View>
        </View>

        {/* Tab Bar */}
        <View style={s.tabBar}>
          {(['overview', 'rooms', 'slots', 'sessions'] as const).map(tab => (
            <TouchableOpacity
              key={tab}
              style={[s.tab, activeTab === tab && s.tabActive]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <View>
            {/* Summary Cards */}
            <View style={s.cardRow}>
              <View style={s.statCard}>
                <Text style={s.statNumber}>{activeRooms.length}</Text>
                <Text style={s.statLabel}>Active Rooms</Text>
              </View>
              <View style={s.statCard}>
                <Text style={s.statNumber}>{activeSlots.length}</Text>
                <Text style={s.statLabel}>Active Slots</Text>
              </View>
              <View style={s.statCard}>
                <Text style={[s.statNumber, { color: pendingInstances.length > 0 ? AMBER : GREEN }]}>
                  {pendingInstances.length}
                </Text>
                <Text style={s.statLabel}>Pending</Text>
              </View>
              <View style={s.statCard}>
                <Text style={[s.statNumber, { color: failedInstances.length > 0 ? RED : GREEN }]}>
                  {failedInstances.length}
                </Text>
                <Text style={s.statLabel}>Failed</Text>
              </View>
            </View>

            {/* Today's Sessions */}
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Today's Sessions ({todaySessions.length})</Text>
            </View>
            {todaySessions.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.emptyText}>No sessions scheduled for today.</Text>
              </View>
            ) : (
              todaySessions.map(inst => (
                <View key={inst.id} style={s.sessionCard}>
                  <View style={s.sessionRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.sessionMember}>{inst.memberName}</Text>
                      <Text style={s.sessionTime}>
                        {formatTime(inst.scheduledStartTime)} – {formatTime(inst.scheduledEndTime)}
                      </Text>
                    </View>
                    <StatusBadge status={inst.status} />
                  </View>
                  {inst.zoomRoomLabel && (
                    <Text style={s.roomLabel}>🖥 {inst.zoomRoomLabel}</Text>
                  )}
                  {inst.zoomJoinUrl && (
                    <Text style={s.zoomLink} numberOfLines={1}>🔗 {inst.zoomJoinUrl}</Text>
                  )}
                </View>
              ))
            )}

            {/* Quick Actions */}
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Quick Actions</Text>
            </View>
            <View style={s.actionRow}>
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: GOLD }]}
                onPress={handleAllocateAll}
                disabled={allocating || pendingInstances.length === 0}
              >
                {allocating ? (
                  <ActivityIndicator size="small" color={BG} />
                ) : (
                  <Text style={s.actionBtnText}>
                    Allocate All ({pendingInstances.length})
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: '#1E2A3A' }]}
                onPress={() => setShowAddRoom(true)}
              >
                <Text style={[s.actionBtnText, { color: TEXT }]}>+ Add Room</Text>
              </TouchableOpacity>
            </View>

            {/* Needs Attention */}
            {failedInstances.length > 0 && (
              <View>
                <View style={s.sectionHeader}>
                  <Text style={[s.sectionTitle, { color: RED }]}>⚠ Needs Attention</Text>
                </View>
                {failedInstances.map(inst => (
                  <View key={inst.id} style={[s.sessionCard, { borderLeftColor: RED, borderLeftWidth: 3 }]}>
                    <View style={s.sessionRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.sessionMember}>{inst.memberName}</Text>
                        <Text style={s.sessionTime}>
                          {inst.scheduledDate} · {formatTime(inst.scheduledStartTime)}
                        </Text>
                        <Text style={[s.roomLabel, { color: RED }]}>
                          {inst.allocationFailReason || 'Allocation failed'}
                        </Text>
                      </View>
                      <StatusBadge status={inst.status} />
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Rooms Tab */}
        {activeTab === 'rooms' && (
          <View>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Zoom Room Pool ({rooms.length})</Text>
              <TouchableOpacity onPress={() => setShowAddRoom(true)}>
                <Text style={s.addLink}>+ Add Room</Text>
              </TouchableOpacity>
            </View>
            {rooms.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.emptyText}>No Zoom rooms configured yet.</Text>
                <Text style={[s.emptyText, { marginTop: 4 }]}>
                  Add your Zoom account(s) to start scheduling sessions.
                </Text>
                <TouchableOpacity
                  style={[s.actionBtn, { backgroundColor: GOLD, marginTop: 12, alignSelf: 'center' }]}
                  onPress={() => setShowAddRoom(true)}
                >
                  <Text style={s.actionBtnText}>+ Add Your First Room</Text>
                </TouchableOpacity>
              </View>
            ) : (
              rooms.map(room => (
                <View key={room.id} style={s.roomCard}>
                  <View style={s.sessionRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.sessionMember}>{room.label}</Text>
                      <Text style={s.sessionTime}>{room.zoomAccountEmail}</Text>
                    </View>
                    <TouchableOpacity
                      style={[s.statusToggle, { backgroundColor: room.status === 'active' ? GREEN + '20' : MUTED + '20' }]}
                      onPress={() => handleToggleRoom(room)}
                    >
                      <Text style={[s.statusToggleText, { color: room.status === 'active' ? GREEN : MUTED }]}>
                        {room.status === 'active' ? 'Active' : 'Inactive'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={s.roomLabel}>Max concurrent: {room.maxConcurrentMeetings}</Text>
                </View>
              ))
            )}
          </View>
        )}

        {/* Slots Tab */}
        {activeTab === 'slots' && (
          <View>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Recurring Slots ({slots.length})</Text>
            </View>
            {slots.length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.emptyText}>No recurring slots created yet.</Text>
                <Text style={[s.emptyText, { marginTop: 4 }]}>
                  Assign recurring time slots to members from their Member Hub.
                </Text>
              </View>
            ) : (
              slots.map(slot => (
                <View key={slot.id} style={s.roomCard}>
                  <View style={s.sessionRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.sessionMember}>{slot.memberName}</Text>
                      <Text style={s.sessionTime}>
                        {DAY_SHORT_LABELS[slot.dayOfWeek]} · {formatTime(slot.startTime)} · {slot.durationMinutes}min
                      </Text>
                      <Text style={s.roomLabel}>
                        {slot.recurrencePattern === 'biweekly' ? 'Every 2 weeks' : 'Weekly'} · {slot.timezone}
                      </Text>
                    </View>
                    <StatusBadge status={slot.status} />
                  </View>
                </View>
              ))
            )}
          </View>
        )}

        {/* Sessions Tab */}
        {activeTab === 'sessions' && (
          <View>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Upcoming Sessions ({instances.filter(i => i.status !== 'cancelled').length})</Text>
            </View>
            {instances.filter(i => i.status !== 'cancelled').length === 0 ? (
              <View style={s.emptyCard}>
                <Text style={s.emptyText}>No upcoming sessions.</Text>
              </View>
            ) : (
              instances
                .filter(i => i.status !== 'cancelled')
                .map(inst => (
                  <View key={inst.id} style={s.sessionCard}>
                    <View style={s.sessionRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.sessionMember}>{inst.memberName}</Text>
                        <Text style={s.sessionTime}>
                          {inst.scheduledDate} · {formatTime(inst.scheduledStartTime)} – {formatTime(inst.scheduledEndTime)}
                        </Text>
                        {inst.zoomRoomLabel && (
                          <Text style={s.roomLabel}>🖥 {inst.zoomRoomLabel}</Text>
                        )}
                        {inst.rescheduledFrom && (
                          <Text style={[s.roomLabel, { color: AMBER }]}>
                            Rescheduled from {inst.rescheduledFrom}
                          </Text>
                        )}
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        <StatusBadge status={inst.status} />
                        {(inst.status === 'scheduled' || inst.status === 'allocated') && (
                          <TouchableOpacity
                            onPress={() => handleCancelInstance(inst.id)}
                            style={s.cancelBtn}
                          >
                            <Text style={s.cancelBtnText}>Cancel</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  </View>
                ))
            )}
          </View>
        )}
      </ScrollView>

      {/* Add Room Modal */}
      <Modal visible={showAddRoom} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Add Zoom Room</Text>
              <TouchableOpacity onPress={() => setShowAddRoom(false)}>
                <Icon name="close" size={22} color={TEXT} />
              </TouchableOpacity>
            </View>
            <Text style={s.fieldLabel}>Room Label</Text>
            <TextInput
              style={s.input}
              value={newRoomLabel}
              onChangeText={setNewRoomLabel}
              placeholder="e.g., Zoom Room A"
              placeholderTextColor={MUTED}
            />
            <Text style={s.fieldLabel}>Zoom Account Email</Text>
            <TextInput
              style={s.input}
              value={newRoomEmail}
              onChangeText={setNewRoomEmail}
              placeholder="e.g., zoom1@goarrive.fit"
              placeholderTextColor={MUTED}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: GOLD, marginTop: 16 }]}
              onPress={handleAddRoom}
              disabled={addingRoom || !newRoomLabel.trim() || !newRoomEmail.trim()}
            >
              {addingRoom ? (
                <ActivityIndicator size="small" color={BG} />
              ) : (
                <Text style={s.actionBtnText}>Add Room</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Status Badge Component ───────────────────────────────────────────────────
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

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 100 },

  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, gap: 10 },
  backBtn: { padding: 6 },
  pageTitle: { color: WHITE, fontSize: 20, fontWeight: '700', fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined },
  subtitle: { color: MUTED, fontSize: 13, marginTop: 2, fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined },
  betaBadge: { backgroundColor: GOLD + '20', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  betaText: { color: GOLD, fontSize: 10, fontWeight: '700', letterSpacing: 1 },

  tabBar: { flexDirection: 'row', marginBottom: 16, gap: 4 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 8, backgroundColor: CARD_BG },
  tabActive: { backgroundColor: GOLD + '20' },
  tabText: { color: MUTED, fontSize: 13, fontWeight: '600', fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined },
  tabTextActive: { color: GOLD },

  cardRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: CARD_BG, borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: BORDER },
  statNumber: { color: WHITE, fontSize: 24, fontWeight: '700' },
  statLabel: { color: MUTED, fontSize: 11, marginTop: 4, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 8 },
  sectionTitle: { color: WHITE, fontSize: 16, fontWeight: '700', fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined },
  addLink: { color: GOLD, fontSize: 14, fontWeight: '600' },

  emptyCard: { backgroundColor: CARD_BG, borderRadius: 10, padding: 20, borderWidth: 1, borderColor: BORDER, marginBottom: 12 },
  emptyText: { color: MUTED, fontSize: 14, textAlign: 'center' },

  sessionCard: { backgroundColor: CARD_BG, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 8 },
  sessionRow: { flexDirection: 'row', alignItems: 'center' },
  sessionMember: { color: WHITE, fontSize: 15, fontWeight: '600', fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined },
  sessionTime: { color: MUTED, fontSize: 13, marginTop: 2 },
  roomLabel: { color: MUTED, fontSize: 12, marginTop: 4 },
  zoomLink: { color: '#3B82F6', fontSize: 12, marginTop: 4 },

  roomCard: { backgroundColor: CARD_BG, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: BORDER, marginBottom: 8 },
  statusToggle: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  statusToggleText: { fontSize: 12, fontWeight: '700' },

  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  actionBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  actionBtnText: { color: BG, fontSize: 14, fontWeight: '700', fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined },

  cancelBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, backgroundColor: RED + '20' },
  cancelBtnText: { color: RED, fontSize: 11, fontWeight: '600' },

  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, gap: 5 },
  badgeDot: { width: 6, height: 6, borderRadius: 3 },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: CARD_BG, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: WHITE, fontSize: 18, fontWeight: '700', fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined },
  fieldLabel: { color: MUTED, fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    backgroundColor: BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 8,
    padding: 12,
    color: WHITE,
    fontSize: 16,
    fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : undefined,
  },
});
