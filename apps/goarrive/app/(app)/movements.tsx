/**
 * Movements screen — Coach Movement Library
 *
 * Lists all movements for the coach's tenant (coach-private + global).
 * Supports search by name, filter by category/equipment/muscle group,
 * tap to view details, create and edit movements.
 *
 * Wires in existing components:
 *   - MovementDetail (349 lines) — detail modal with edit/archive actions
 *   - MovementForm — creation and edit modal with full fields
 *
 * Firestore collection: movements
 * Query pattern: coachId-scoped + global, filtered by isArchived
 *
 * Uses FlatList for virtualized rendering at scale.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Image,
} from 'react-native';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import { AppHeader } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import MovementDetail, {
  MovementDetailData,
} from '../../components/MovementDetail';
import MovementForm from '../../components/MovementForm';
import ConfirmDialog from '../../components/ConfirmDialog';
import {
  useMovementFilters,
  CATEGORY_FILTER_OPTIONS,
  EQUIPMENT_FILTER_OPTIONS,
  MUSCLE_GROUP_FILTER_OPTIONS,
} from '../../hooks/useMovementFilters';

// ── Constants ──────────────────────────────────────────────────────────────
const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

/** Predefined category options for the filter chip row. */
const CATEGORIES = [
  'All',
  'Upper Body Push',
  'Upper Body Pull',
  'Lower Body Push',
  'Lower Body Pull',
  'Core',
  'Cardio',
  'Mobility',
];

/** Predefined equipment options for the filter chip row. */
const EQUIPMENT = [
  'All',
  'Bodyweight',
  'Dumbbell',
  'Barbell',
  'Kettlebell',
  'Band',
  'Cable',
  'Machine',
];

/** Predefined muscle group options for the filter chip row. */
const MUSCLE_GROUPS = [
  'All',
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Core',
  'Full Body',
];

// ── Coming Soon placeholder (non-admin) ──────────────────────────────────
function MovementsComingSoon() {
  return (
    <View style={s.root}>
      <AppHeader />
      <View style={s.centered}>
        <View style={s.emptyIconWrap}>
          <Text style={s.emptyIcon}>🎯</Text>
        </View>
        <Text style={s.emptyTitle}>Movements</Text>
        <View style={s.comingSoonBadge}>
          <Text style={s.comingSoonBadgeText}>COMING SOON</Text>
        </View>
        <Text style={s.emptyDesc}>
          The movement library is being built to support fast search, strong
          filtering, coaching cues, and intelligent reuse across your workouts.
        </Text>
        <Text style={s.hintText}>
          Stay tuned — this will power your entire workout system.
        </Text>
      </View>
    </View>
  );
}

// ── Component ──────────────────────────────────────────────────────────────
export default function MovementsScreen() {
  const { user, claims } = useAuth();
  const isAdmin = claims?.admin === true || claims?.role === 'platformAdmin';
  const isCoach = claims?.role === 'coach';
  const canAccessMovements = isAdmin || isCoach;
  const coachId = claims?.coachId ?? user?.uid ?? '';
  const tenantId = claims?.tenantId ?? '';

  // ── State ──────────────────────────────────────────────────────────────
  const [movements, setMovements] = useState<MovementDetailData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  // Suggestion 4: Use extracted filter hook instead of inline state
  const movementFilters = useMovementFilters(
    movements.filter((m) => (showArchived ? m.isArchived : !m.isArchived)),
  );
  const {
    searchText, setSearchText,
    categoryFilter: selectedCategory, setCategoryFilter: setSelectedCategory,
    equipmentFilter: selectedEquipment, setEquipmentFilter: setSelectedEquipment,
    muscleGroupFilter: selectedMuscleGroup, setMuscleGroupFilter: setSelectedMuscleGroup,
    filtered,
  } = movementFilters;

  // Detail modal
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedMovement, setSelectedMovement] =
    useState<MovementDetailData | null>(null);

  // Create/Edit modal
  const [formVisible, setFormVisible] = useState(false);
  const [editMovement, setEditMovement] = useState<MovementDetailData | null>(
    null,
  );

  // Confirm dialog (archive / restore)
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<() => void>(() => {});

  // ── Real-time movement listener ────────────────────────────────────────
  const mapDoc = useCallback((d: any): MovementDetailData => {
    const data = d.data();
    return {
      id: d.id,
      name: data.name ?? '',
      category: data.category ?? '',
      muscleGroups: data.muscleGroups ?? [],
      equipment: data.equipment ?? '',
      difficulty: data.difficulty ?? '',
      description: data.description ?? '',
      workSec: data.workSec ?? 30,
      restSec: data.restSec ?? 15,
      countdownSec: data.countdownSec ?? 3,
      swapSides: data.swapSides ?? false,
      swapMode: data.swapMode ?? 'split',
      swapWindowSec: data.swapWindowSec ?? 5,
      isGlobal: data.isGlobal ?? false,
      isArchived: data.isArchived ?? false,
      coachId: data.coachId ?? '',
      tenantId: data.tenantId,
      createdAt: data.createdAt,
      mediaUrl: data.mediaUrl ?? null,
      videoUrl: data.videoUrl ?? null,
      thumbnailUrl: data.thumbnailUrl ?? null,
    };
  }, []);

  useEffect(() => {
    if (!coachId) return;

    const coachQ = query(
      collection(db, 'movements'),
      where('coachId', '==', coachId),
      orderBy('createdAt', 'desc'),
    );
    const globalQ = query(
      collection(db, 'movements'),
      where('isGlobal', '==', true),
      orderBy('createdAt', 'desc'),
    );

    let coachDocs: MovementDetailData[] = [];
    let globalDocs: MovementDetailData[] = [];
    let firstCoach = true;
    let firstGlobal = true;

    const merge = () => {
      const seen = new Set<string>();
      const merged: MovementDetailData[] = [];
      for (const m of coachDocs) {
        if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
      }
      for (const m of globalDocs) {
        if (!seen.has(m.id)) { seen.add(m.id); merged.push(m); }
      }
      setMovements(merged);
      setLoading(false);
      setRefreshing(false);
    };

    const unsubCoach = onSnapshot(coachQ, (snap) => {
      coachDocs = snap.docs.map(mapDoc);
      if (firstCoach) { firstCoach = false; }
      merge();
    }, (err) => {
      console.error('[Movements] Coach listener error:', err);
      setLoading(false);
    });

    const unsubGlobal = onSnapshot(globalQ, (snap) => {
      globalDocs = snap.docs.map(mapDoc);
      if (firstGlobal) { firstGlobal = false; }
      merge();
    }, (err) => {
      console.error('[Movements] Global listener error:', err);
      setLoading(false);
    });

    return () => {
      unsubCoach();
      unsubGlobal();
    };
  }, [coachId, mapDoc]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Real-time listener will auto-update; just reset the flag after a short delay
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleOpenDetail = (m: MovementDetailData) => {
    setSelectedMovement(m);
    setDetailVisible(true);
  };

  const handleEdit = (m: MovementDetailData) => {
    setDetailVisible(false);
    setEditMovement(m);
    setFormVisible(true);
  };

  const handleArchiveRequest = (m: MovementDetailData) => {
    setDetailVisible(false);
    const action = m.isArchived ? 'Restore' : 'Archive';
    setConfirmTitle(`${action} Movement`);
    setConfirmMessage(
      m.isArchived
        ? `Restore "${m.name}" back to your active library?`
        : `Archive "${m.name}"? It will be hidden from your library but can be restored later.`,
    );
    setConfirmAction(() => async () => {
      try {
        await updateDoc(doc(db, 'movements', m.id), {
          isArchived: !m.isArchived,
          updatedAt: serverTimestamp(),
        });
        // onSnapshot will auto-refresh the list
      } catch (err) {
        console.error('[Movements] Archive error:', err);
        Alert.alert('Error', `Could not ${action.toLowerCase()} movement.`);
      }
      setConfirmVisible(false);
    });
    setConfirmVisible(true);
  };

  const handleFormClose = () => {
    setFormVisible(false);
    setEditMovement(null);
    // onSnapshot will auto-refresh the list
  };

  const handleCreateNew = () => {
    setEditMovement(null);
    setFormVisible(true);
  };

  // Toggle global flag (admin only)
  const handleToggleGlobal = (m: MovementDetailData) => {
    setDetailVisible(false);
    const action = m.isGlobal ? 'Remove from Global' : 'Make Global';
    setConfirmTitle(`${action}`);
    setConfirmMessage(
      m.isGlobal
        ? `Remove "${m.name}" from the global library? Coaches will only see it if it belongs to them.`
        : `Make "${m.name}" available to all coaches in the global library?`,
    );
    setConfirmAction(() => async () => {
      try {
        await updateDoc(doc(db, 'movements', m.id), {
          isGlobal: !m.isGlobal,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error('[Movements] Toggle global error:', err);
        Alert.alert('Error', `Could not ${action.toLowerCase()} movement.`);
      }
      setConfirmVisible(false);
    });
    setConfirmVisible(true);
  };

  // ── Render item for FlatList ───────────────────────────────────────────
  const renderItem = ({ item: m }: { item: MovementDetailData }) => {
    const thumb = m.thumbnailUrl || m.mediaUrl || m.videoUrl;
    return (
    <Pressable style={s.card} onPress={() => handleOpenDetail(m)}>
      <View style={s.cardRow}>
        {thumb ? (
          <Image
            source={{ uri: thumb }}
            style={s.cardThumb}
            resizeMode="cover"
          />
        ) : (
          <View style={s.cardThumbPlaceholder}>
            <Icon name="fitness" size={20} color="#4A5568" />
          </View>
        )}
        <View style={s.cardContent}>
      <View style={s.cardTop}>
        <Text style={s.cardName} numberOfLines={1}>
          {m.name}
        </Text>
        <Icon name="chevron-right" size={18} color="#4A5568" />
      </View>
      <View style={s.cardBadgeRow}>
        {m.category ? (
          <View style={s.cardBadge}>
            <Text style={s.cardBadgeText}>{m.category}</Text>
          </View>
        ) : null}
        {m.equipment ? (
          <View style={s.cardBadge}>
            <Text style={s.cardBadgeText}>{m.equipment}</Text>
          </View>
        ) : null}
        {m.difficulty ? (
          <View style={s.cardBadge}>
            <Text style={s.cardBadgeText}>{m.difficulty}</Text>
          </View>
        ) : null}
        {m.isGlobal && (
          <View style={[s.cardBadge, s.globalBadge]}>
            <Text style={[s.cardBadgeText, { color: '#F5A623' }]}>Global</Text>
          </View>
        )}
      </View>
      {m.muscleGroups.length > 0 && (
        <Text style={s.cardMuscles} numberOfLines={1}>
          {m.muscleGroups.join(' · ')}
        </Text>
      )}
        </View>
      </View>
    </Pressable>
    );
  };

  const keyExtractor = (item: MovementDetailData) => item.id;

  // ── Render ───────────────────────────────────────────────────────────────
  // Non-admin sees Coming Soon
  if (!canAccessMovements) return <MovementsComingSoon />;

  return (
    <View style={s.root}>
      <AppHeader />

      {/* Toolbar: Search + Create button */}
      <View style={s.toolbar}>
        <View style={s.searchWrap}>
          <Icon name="search" size={18} color="#4A5568" />
          <TextInput
            style={s.searchInput}
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search movements..."
            placeholderTextColor="#4A5568"
          />
          {searchText.length > 0 && (
            <Pressable onPress={() => setSearchText('')} hitSlop={8}>
              <Icon name="close" size={16} color="#4A5568" />
            </Pressable>
          )}
        </View>
        <Pressable style={s.createBtn} onPress={handleCreateNew}>
          <Text style={s.createBtnText}>+ New</Text>
        </Pressable>
      </View>

      {/* Filter chips: Category */}
      <View style={s.filterSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chipScroll}
        >
          {(CATEGORY_FILTER_OPTIONS as readonly string[]).map((cat) => {
            const active = selectedCategory === cat;
            return (
              <Pressable
                key={cat}
                style={[s.chip, active && s.chipActive]}
                onPress={() => setSelectedCategory(cat)}
              >
                <Text style={[s.chipText, active && s.chipTextActive]}>
                  {cat}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Filter chips: Equipment */}
      <View style={s.filterSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chipScroll}
        >
          {(EQUIPMENT_FILTER_OPTIONS as readonly string[]).map((eq) => {
            const active = selectedEquipment === eq;
            return (
              <Pressable
                key={eq}
                style={[s.chip, active && s.chipActive]}
                onPress={() => setSelectedEquipment(eq)}
              >
                <Text style={[s.chipText, active && s.chipTextActive]}>
                  {eq}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Filter chips: Muscle Group */}
      <View style={s.filterSection}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.chipScroll}
        >
          {(MUSCLE_GROUP_FILTER_OPTIONS as readonly string[]).map((mg) => {
            const active = selectedMuscleGroup === mg;
            return (
              <Pressable
                key={mg}
                style={[s.chip, active && s.chipActive]}
                onPress={() => setSelectedMuscleGroup(mg)}
              >
                <Text style={[s.chipText, active && s.chipTextActive]}>
                  {mg}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Archive toggle + count */}
      <View style={s.toggleRow}>
        <Text style={s.countText}>
          {filtered.length} movement{filtered.length !== 1 ? 's' : ''}
        </Text>
        <Pressable
          style={[s.toggleBtn, showArchived && s.toggleBtnActive]}
          onPress={() => setShowArchived(!showArchived)}
        >
          <Icon
            name="archive"
            size={14}
            color={showArchived ? '#F5A623' : '#4A5568'}
          />
          <Text
            style={[
              s.toggleBtnText,
              showArchived && s.toggleBtnTextActive,
            ]}
          >
            {showArchived ? 'Archived' : 'Show Archived'}
          </Text>
        </Pressable>
      </View>

      {/* Movement list (FlatList for virtualization) */}
      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#F5A623" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.centered}>
          <View style={s.emptyIconWrap}>
            <Text style={s.emptyIcon}>{showArchived ? '📦' : '🎯'}</Text>
          </View>
          <Text style={s.emptyTitle}>
            {showArchived
              ? 'No Archived Movements'
              : searchText ||
                selectedCategory !== 'All' ||
                selectedEquipment !== 'All' ||
                selectedMuscleGroup !== 'All'
              ? 'No Movements Found'
              : 'No Movements Yet'}
          </Text>
          <Text style={s.emptyDesc}>
            {showArchived
              ? 'Archived movements will appear here.'
              : searchText ||
                selectedCategory !== 'All' ||
                selectedEquipment !== 'All' ||
                selectedMuscleGroup !== 'All'
              ? 'Try adjusting your search or filters.'
              : 'Tap "+ New" to create your first movement.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={s.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#F5A623"
            />
          }
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      )}

      {/* ── Modals ──────────────────────────────────────────────────────── */}

      {/* Movement Detail modal */}
      <MovementDetail
        visible={detailVisible}
        movement={selectedMovement}
        onClose={() => setDetailVisible(false)}
        onEdit={handleEdit}
        onArchive={handleArchiveRequest}
        isAdmin={isAdmin}
        onToggleGlobal={handleToggleGlobal}
      />

      {/* Movement Form modal (create + edit) */}
      <MovementForm
        visible={formVisible}
        onClose={handleFormClose}
        coachId={coachId}
        tenantId={tenantId}
        editMovement={editMovement}
      />

      {/* Confirm Dialog for archive/restore */}
      <ConfirmDialog
        visible={confirmVisible}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel="Confirm"
        variant="danger"
        onConfirm={confirmAction}
        onCancel={() => setConfirmVisible(false)}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },

  // Toolbar
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161B22',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
    borderWidth: 1,
    borderColor: '#2A3347',
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
    padding: 0,
  },
  createBtn: {
    backgroundColor: '#F5A623',
    paddingHorizontal: 16,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },

  // Filter chips
  filterSection: {
    paddingTop: 10,
  },
  chipScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  chipActive: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderColor: 'rgba(245,166,35,0.3)',
  },
  chipText: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
  chipTextActive: {
    color: '#F5A623',
    fontWeight: '600',
  },

  // Toggle row
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  countText: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  toggleBtnActive: {
    backgroundColor: 'rgba(245,166,35,0.08)',
  },
  toggleBtnText: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
  },
  toggleBtnTextActive: {
    color: '#F5A623',
  },

  // Centered states (loading, empty)
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 12,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: 'rgba(245,166,35,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyIcon: {
    fontSize: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    textAlign: 'center',
  },
  emptyDesc: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Movement list
  listContent: {
    padding: 16,
    gap: 10,
  },
  card: {
    backgroundColor: '#161B22',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2A3347',
    gap: 8,
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cardThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#1A2035',
  },
  cardThumbPlaceholder: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#1A2035',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  cardContent: {
    flex: 1,
    gap: 6,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
    flex: 1,
    marginRight: 8,
  },
  cardBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  cardBadge: {
    backgroundColor: '#1A2035',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  globalBadge: {
    borderColor: 'rgba(245,166,35,0.2)',
    backgroundColor: 'rgba(245,166,35,0.08)',
  },
  cardBadgeText: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
  },
  cardMuscles: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
  },
  comingSoonBadge: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  comingSoonBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    letterSpacing: 1.5,
  },
  hintText: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FB,
    textAlign: 'center',
    lineHeight: 20,
  },
});
