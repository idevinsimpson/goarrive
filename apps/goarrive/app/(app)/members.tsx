/**
 * Members screen — GoArrive Member Roster
 *
 * Slice 1, Week 4: Full CRUD for coach's client roster.
 *   - List members with search and filter (active / archived)
 *   - Add new members via MemberForm modal
 *   - Edit existing members
 *   - Archive / restore members (soft delete) with undo toast (BP-S)
 *   - View member details via MemberDetail modal
 *   - Pull-to-refresh
 *   - Form validation follows BP-R pattern
 *
 * Firestore collection: members
 * Schema: id, name, email, phone, notes, coachId, tenantId, isArchived, createdAt, updatedAt
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { AppHeader } from '../../components/AppHeader';
import {
  collection,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  query,
  where,
  orderBy,
  Timestamp,
  serverTimestamp,
} from 'firebase/firestore';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import MemberForm, {
  MemberFormData,
  EMPTY_MEMBER,
} from '../../components/MemberForm';
import MemberDetail from '../../components/MemberDetail';
type MemberDetailData = any;
import ConfirmDialog from '../../components/ConfirmDialog';
import UndoToast from '../../components/UndoToast';
import ListSkeleton from '../../components/ListSkeleton';
import AssignWorkoutModal from '../../components/AssignWorkoutModal';

// ── Types ──────────────────────────────────────────────────────────────────

interface MemberListItem {
  id: string;
  name: string;
  email: string;
  phone: string;
  notes: string;
  coachId: string;
  tenantId: string;
  isArchived: boolean;
  createdAt: any;
  updatedAt: any;
}

/** Assignment count + today flag per member (NEXT-A, NEXT-D) */
interface MemberAssignmentMeta {
  total: number;
  hasToday: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function MembersScreen() {
  const { user, claims } = useAuth();
  const coachId = claims?.coachId ?? user?.uid ?? '';
  const tenantId = claims?.tenantId ?? '';

  // ── State ────────────────────────────────────────────────────────────
  const [members, setMembers] = useState<MemberListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'name'>('newest');
  const [showArchived, setShowArchived] = useState(false);

  // Form modal state
  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [editingMember, setEditingMember] = useState<MemberFormData | undefined>();
  const [editingId, setEditingId] = useState<string | null>(null);

  // Detail modal state
  const [showDetail, setShowDetail] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberDetailData | null>(null);

  // Confirm dialog state
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<() => void>(() => {});
  const [confirmDestructive, setConfirmDestructive] = useState(false);

  // Undo toast state (BP-S)
  const [undoVisible, setUndoVisible] = useState(false);
  const [undoTarget, setUndoTarget] = useState<{ id: string; name: string } | null>(null);

  // Assign workout modal state
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTarget, setAssignTarget] = useState<MemberDetailData | null>(null);
  const [assignmentRefresh, setAssignmentRefresh] = useState(0);

  // NEXT-A / NEXT-D: assignment counts + today flag per member
  const [assignMeta, setAssignMeta] = useState<Record<string, MemberAssignmentMeta>>({});

  // ── Load members ─────────────────────────────────────────────────────

  /** Build a YYYY-MM-DD string for today in local time */
  function todayDateStr(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const loadMembers = useCallback(async () => {
    try {
      const q = query(
        collection(db, 'members'),
        where('coachId', '==', coachId),
        orderBy('createdAt', 'desc'),
      );
      const snap = await getDocs(q);
      const memberList = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: data.name || data.displayName || (data.firstName ? `${data.firstName} ${data.lastName || ''}`.trim() : '') || '',
          email: data.email ?? '',
          phone: data.phone ?? '',
          notes: data.notes ?? '',
          coachId: data.coachId ?? '',
          tenantId: data.tenantId ?? '',
          isArchived: data.isArchived ?? false,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        };
      });
      setMembers(memberList);

      // NEXT-A / NEXT-D: Load assignment counts + today flag
      try {
        const aQ = query(
          collection(db, 'workout_assignments'),
          where('coachId', '==', coachId),
        );
        const aSnap = await getDocs(aQ);
        const todayStr = todayDateStr();
        const meta: Record<string, MemberAssignmentMeta> = {};
        aSnap.docs.forEach((aDoc) => {
          const ad = aDoc.data();
          const mid = ad.memberId ?? '';
          if (!meta[mid]) meta[mid] = { total: 0, hasToday: false };
          meta[mid].total += 1;
          // Check if scheduledFor matches today
          const sf = ad.scheduledFor;
          if (sf) {
            const sfDate = sf.toDate ? sf.toDate() : new Date(sf);
            const sfStr = `${sfDate.getFullYear()}-${String(sfDate.getMonth() + 1).padStart(2, '0')}-${String(sfDate.getDate()).padStart(2, '0')}`;
            if (sfStr === todayStr) meta[mid].hasToday = true;
          }
        });
        setAssignMeta(meta);
      } catch (metaErr) {
        console.error('Failed to load assignment meta:', metaErr);
      }
    } catch (err) {
      console.error('Failed to load members:', err);
    } finally {
      setLoading(false);
    }
  }, [coachId]);

  useEffect(() => {
    if (coachId) loadMembers();
  }, [coachId, loadMembers]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadMembers();
    setRefreshing(false);
  }, [loadMembers]);

  // ── CRUD handlers ────────────────────────────────────────────────────

  async function handleSaveMember(data: MemberFormData) {
    if (formMode === 'edit' && editingId) {
      await updateDoc(doc(db, 'members', editingId), {
        name: data.name.trim(),
        email: data.email.trim().toLowerCase(),
        phone: data.phone.trim(),
        notes: data.notes.trim(),
        updatedAt: Timestamp.now(),
      });
    } else {
      await addDoc(collection(db, 'members'), {
        coachId,
        tenantId,
        name: data.name.trim(),
        email: data.email.trim().toLowerCase(),
        phone: data.phone.trim(),
        notes: data.notes.trim(),
        isArchived: false,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
    }
    await loadMembers();
  }

  function openAddForm() {
    setFormMode('add');
    setEditingMember(undefined);
    setEditingId(null);
    setShowForm(true);
  }

  function openEditForm(m: MemberDetailData) {
    setFormMode('edit');
    setEditingId(m.id);
    setEditingMember({
      name: m.name,
      email: m.email,
      phone: m.phone,
      notes: m.notes,
    });
    setShowDetail(false);
    setShowForm(true);
  }

  function openDetail(m: MemberListItem) {
    setSelectedMember({
      id: m.id,
      name: m.name,
      email: m.email,
      phone: m.phone,
      notes: m.notes,
      coachId: m.coachId,
      tenantId: m.tenantId,
      isArchived: m.isArchived,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    });
    setShowDetail(true);
  }

  function handleArchiveRequest(m: MemberDetailData) {
    const isArchived = m.isArchived;
    setConfirmTitle(isArchived ? 'Restore Member' : 'Archive Member');
    setConfirmMessage(
      isArchived
        ? `Restore "${m.name}" to your active roster?`
        : `Archive "${m.name}"? You can restore them later.`,
    );
    setConfirmDestructive(!isArchived);
    setConfirmAction(() => async () => {
      await updateDoc(doc(db, 'members', m.id), {
        isArchived: !isArchived,
        updatedAt: Timestamp.now(),
      });
      // Show undo toast only for archive actions (not restore) — BP-S
      if (!isArchived) {
        setUndoTarget({ id: m.id, name: m.name });
        setUndoVisible(true);
      }
      setShowDetail(false);
      setSelectedMember(null);
      await loadMembers();
    });
    setConfirmVisible(true);
  }

  async function handleDuplicate(m: MemberDetailData) {
    await addDoc(collection(db, 'members'), {
      coachId,
      tenantId,
      name: `${m.name} (Copy)`,
      email: m.email,
      phone: m.phone,
      notes: m.notes,
      isArchived: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
    setShowDetail(false);
    setSelectedMember(null);
    await loadMembers();
  }

  function handleAssignWorkout(m: MemberDetailData) {
    setAssignTarget(m);
    setShowAssignModal(true);
  }

  async function handleAssignComplete(
    workoutId: string,
    workoutName: string,
    scheduledFor: Date,
  ) {
    if (!assignTarget) return;
    try {
      await addDoc(collection(db, 'workout_assignments'), {
        memberId: assignTarget.id,
        coachId,
        tenantId,
        workoutId,
        workoutName,
        scheduledFor: Timestamp.fromDate(scheduledFor),
        status: 'scheduled',
        createdAt: Timestamp.now(),
      });
      setShowAssignModal(false);
      setAssignTarget(null);
      // Trigger refresh of AssignedWorkoutsList in MemberDetail
      setAssignmentRefresh((prev) => prev + 1);
    } catch (err) {
      console.error('Failed to assign workout:', err);
      if (Platform.OS === 'web') {
        window.alert('Failed to assign workout. Please try again.');
      } else {
        Alert.alert('Error', 'Failed to assign workout. Please try again.');
      }
    }
  }

  async function handleUndoArchive() {
    if (!undoTarget) return;
    await updateDoc(doc(db, 'members', undoTarget.id), {
      isArchived: false,
      updatedAt: Timestamp.now(),
    });
    setUndoVisible(false);
    setUndoTarget(null);
    await loadMembers();
  }

  // ── Filtering ────────────────────────────────────────────────────────

  const filtered = members
    .filter((m) => {
      if (showArchived ? !m.isArchived : m.isArchived) return false;
      if (search) {
        const q = search.toLowerCase();
        if (
          !m.name.toLowerCase().includes(q) &&
          !m.email.toLowerCase().includes(q) &&
          !m.phone.includes(q)
        ) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      const aTime = a.createdAt?.toDate?.() ?? new Date(a.createdAt ?? 0);
      const bTime = b.createdAt?.toDate?.() ?? new Date(b.createdAt ?? 0);
      return sortBy === 'oldest'
        ? aTime.getTime() - bTime.getTime()
        : bTime.getTime() - aTime.getTime();
    });

  const SORT_OPTIONS: Array<{ key: typeof sortBy; label: string; icon: string }> = [
    { key: 'newest', label: 'Newest', icon: 'chevron-down' },
    { key: 'oldest', label: 'Oldest', icon: 'chevron-down' },
    { key: 'name', label: 'Name A–Z', icon: 'sort' },
  ];

  // ── Helpers ──────────────────────────────────────────────────────────

  function getInitials(name: string): string {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('');
  }

  function formatDate(ts: any): string {
    if (!ts) return '';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <View style={styles.root}>
      {/* Header — uses AppHeader for logo + avatar + safe-area */}
      <AppHeader />

      {/* Screen title row */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>Members</Text>
        <Pressable style={styles.addBtn} onPress={openAddForm}>
          <Icon name="add" size={20} color="#0E1117" />
          <Text style={styles.addBtnText}>Add</Text>
        </Pressable>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Icon name="search" size={16} color="#4A5568" />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, email, or phone…"
            placeholderTextColor="#4A5568"
            autoCorrect={false}
            autoCapitalize="none"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Icon name="x-circle" size={16} color="#4A5568" />
            </Pressable>
          )}
        </View>
      </View>

      {/* Sort + Active / Archived toggle */}
      <View style={styles.sortRow}>
        {SORT_OPTIONS.map((opt) => (
          <Pressable
            key={opt.key}
            style={[styles.sortChip, sortBy === opt.key && styles.sortChipActive]}
            onPress={() => setSortBy(opt.key)}
          >
            <Icon
              name={opt.icon as any}
              size={12}
              color={sortBy === opt.key ? '#F5A623' : '#4A5568'}
            />
            <Text
              style={[
                styles.sortChipText,
                sortBy === opt.key && styles.sortChipTextActive,
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Active / Archived toggle */}
      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggleBtn, !showArchived && styles.toggleBtnActive]}
          onPress={() => setShowArchived(false)}
        >
          <Text
            style={[
              styles.toggleBtnText,
              !showArchived && styles.toggleBtnTextActive,
            ]}
          >
            Active ({members.filter((m) => !m.isArchived).length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.toggleBtn, showArchived && styles.toggleBtnActive]}
          onPress={() => setShowArchived(true)}
        >
          <Text
            style={[
              styles.toggleBtnText,
              showArchived && styles.toggleBtnTextActive,
            ]}
          >
            Archived ({members.filter((m) => m.isArchived).length})
          </Text>
        </Pressable>
      </View>

      {/* Member list */}
      {loading ? (
        <ListSkeleton count={5} />
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#F5A623"
              colors={['#F5A623']}
            />
          }
        >
          {filtered.length === 0 && (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyIconWrap}>
                <Icon
                  name="members"
                  size={48}
                  color="#2A3040"
                />
              </View>
              <Text style={styles.emptyTitle}>
                {showArchived ? 'No archived members' : 'No members yet'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {showArchived
                  ? 'Members you archive will appear here for easy recovery.'
                  : search
                    ? 'Try a different search term to find your member.'
                    : 'Add your first member to start building your coaching roster.'}
              </Text>
              {!showArchived && !search && (
                <Pressable style={styles.emptyCta} onPress={openAddForm}>
                  <Icon name="person" size={18} color="#F5A623" />
                  <Text style={styles.emptyCtaText}>Add Member</Text>
                </Pressable>
              )}
            </View>
          )}

          {filtered.map((m) => {
            const meta = assignMeta[m.id];
            const assignCount = meta?.total ?? 0;
            const hasToday = meta?.hasToday ?? false;
            return (
              <Pressable
                key={m.id}
                style={[styles.card, hasToday && styles.cardToday]}
                onPress={() => openDetail(m)}
              >
                <View style={styles.cardRow}>
                  {/* Avatar */}
                  <View style={[styles.cardAvatar, hasToday && styles.cardAvatarToday]}>
                    <Text style={styles.cardAvatarText}>
                      {getInitials(m.name)}
                    </Text>
                  </View>

                  {/* Info */}
                  <View style={styles.cardInfo}>
                    <View style={styles.cardNameRow}>
                      <Text style={styles.cardName} numberOfLines={1}>
                        {m.name}
                      </Text>
                      {m.isArchived && (
                        <View style={styles.archivedBadge}>
                          <Text style={styles.archivedBadgeText}>Archived</Text>
                        </View>
                      )}
                      {/* NEXT-A: Assignment count badge */}
                      {assignCount > 0 && !m.isArchived && (
                        <View style={styles.assignBadge}>
                          <Icon name="workouts" size={10} color="#F5A623" />
                          <Text style={styles.assignBadgeText}>{assignCount}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.cardEmail} numberOfLines={1}>
                      {m.email}
                    </Text>
                    {/* NEXT-D: Today indicator */}
                    {hasToday && !m.isArchived ? (
                      <View style={styles.todayRow}>
                        <Icon name="calendar" size={12} color="#6EBB7A" />
                        <Text style={styles.todayText}>Workout today</Text>
                      </View>
                    ) : m.phone ? (
                      <Text style={styles.cardPhone} numberOfLines={1}>
                        {m.phone}
                      </Text>
                    ) : null}
                  </View>

                  {/* Date */}
                  <Text style={styles.cardDate}>{formatDate(m.createdAt)}</Text>
                </View>
              </Pressable>
            );
          })}

          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* Modals */}
      <MemberForm
        visible={showForm}
        onClose={() => setShowForm(false)}
        onSave={handleSaveMember}
        initialData={editingMember}
        mode={formMode}
      />

      {showDetail && (
        <MemberDetail
          member={selectedMember}
          onClose={() => {
            setShowDetail(false);
            setSelectedMember(null);
          }}
          onEdit={openEditForm}
          onArchive={handleArchiveRequest}
        />
      )}

      <ConfirmDialog
        visible={confirmVisible}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel={confirmDestructive ? 'Archive' : 'Restore'}
        variant={confirmDestructive ? 'destructive' : 'default'}
        onConfirm={() => {
          confirmAction();
          setConfirmVisible(false);
        }}
        onCancel={() => setConfirmVisible(false)}
      />

      {/* Undo toast (BP-S) */}
      <UndoToast
        visible={undoVisible}
        message={`"${undoTarget?.name ?? ''}" archived`}
        onUndo={handleUndoArchive}
        onDismiss={() => { setUndoVisible(false); setUndoTarget(null); }}
      />

      {/* Assign Workout modal */}
      <AssignWorkoutModal
        visible={showAssignModal}
        memberName={assignTarget?.name ?? ''}
        coachId={coachId}
        onClose={() => {
          setShowAssignModal(false);
          setAssignTarget(null);
        }}
        onAssign={handleAssignComplete}
      />
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5A623',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 4,
  },
  addBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FONT_HEADING,
  },
  searchRow: {
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#F0F4F8',
    fontFamily: FONT_BODY,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
  },
  sortRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 6,
    marginBottom: 8,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  sortChipActive: {
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: 'rgba(245,166,35,0.2)',
  },
  sortChipText: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FONT_BODY,
  },
  sortChipTextActive: {
    color: '#F5A623',
    fontWeight: '600',
  },
  toggleRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 12,
  },
  toggleBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  toggleBtnActive: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderColor: 'rgba(245,166,35,0.3)',
  },
  toggleBtnText: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
  toggleBtnTextActive: {
    color: '#F5A623',
    fontWeight: '600',
  },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#4A5568',
    fontFamily: FONT_BODY,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 20,
  },
  emptyWrap: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 10,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#8A95A3',
    fontFamily: FONT_HEADING,
  },
  emptySubtitle: {
    fontSize: 15,
    color: '#4A5568',
    fontFamily: FONT_BODY,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 22,
  },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(245,166,35,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  emptyCtaText: {
    fontSize: 15,
    color: '#F5A623',
    fontFamily: FONT_HEADING,
    fontWeight: '700',
  },
  card: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    padding: 14,
    marginBottom: 8,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(245,166,35,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  cardAvatarText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
  },
  cardInfo: {
    flex: 1,
  },
  cardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
    flex: 1,
  },
  archivedBadge: {
    backgroundColor: 'rgba(224,82,82,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  archivedBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#E05252',
    fontFamily: FONT_HEADING,
    textTransform: 'uppercase',
  },
  cardEmail: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    marginTop: 2,
  },
  cardPhone: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FONT_BODY,
    marginTop: 1,
  },
  cardDate: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FONT_BODY,
    marginLeft: 8,
  },
  // NEXT-A: Assignment count badge
  assignBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(245,166,35,0.1)',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
  },
  assignBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
  },
  // NEXT-D: Today indicator
  cardToday: {
    borderColor: 'rgba(110,187,122,0.25)',
  },
  cardAvatarToday: {
    borderWidth: 2,
    borderColor: '#6EBB7A',
  },
  todayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  todayText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6EBB7A',
    fontFamily: FONT_BODY,
  },
});
