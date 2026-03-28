/**
 * Movements screen — Coach Movement Library
 *
 * Lists all movements for the coach's tenant (coach-private + global).
 * Supports search by name, expandable filter panel (category/equipment/
 * muscle group/difficulty), list/grid view toggle, sorting, overflow menu
 * per card, tap to view details, create and edit movements.
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
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Modal,
  Dimensions,
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
  DIFFICULTY_FILTER_OPTIONS,
  SORT_OPTIONS,
  SortOption,
} from '../../hooks/useMovementFilters';

// ── Constants ──────────────────────────────────────────────────────────────
const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

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

// ── Overflow Menu Component ──────────────────────────────────────────────
function OverflowMenu({
  movement,
  onEdit,
  onArchive,
  onInfo,
}: {
  movement: MovementDetailData;
  onEdit: (m: MovementDetailData) => void;
  onArchive: (m: MovementDetailData) => void;
  onInfo: (m: MovementDetailData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 16 });
  const anchorRef = useRef<View>(null);

  const handleOpen = () => {
    if (anchorRef.current && Platform.OS === 'web') {
      (anchorRef.current as any).measureInWindow?.(
        (x: number, y: number, w: number, h: number) => {
          setMenuPos({ top: y + h + 4, right: Dimensions.get('window').width - x - w });
          setOpen(true);
        },
      );
    } else {
      setOpen(true);
    }
  };

  return (
    <>
      <Pressable
        ref={anchorRef}
        onPress={(e) => {
          e.stopPropagation?.();
          handleOpen();
        }}
        hitSlop={8}
        style={s.overflowBtn}
      >
        <Icon name="more-vertical" size={18} color="#8A95A3" />
      </Pressable>
      {open && (
        <Modal transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={s.menuBackdrop} onPress={() => setOpen(false)}>
            <View style={[s.menuPopup, { top: menuPos.top, right: menuPos.right }]}>
              <Pressable
                style={s.menuItem}
                onPress={() => { setOpen(false); onEdit(movement); }}
              >
                <Icon name="edit" size={16} color="#F0F4F8" />
                <Text style={s.menuItemText}>Edit</Text>
              </Pressable>
              <Pressable
                style={s.menuItem}
                onPress={() => { setOpen(false); onInfo(movement); }}
              >
                <Icon name="info" size={16} color="#F0F4F8" />
                <Text style={s.menuItemText}>See Info</Text>
              </Pressable>
              <Pressable
                style={s.menuItem}
                onPress={() => { setOpen(false); onArchive(movement); }}
              >
                <Icon name="archive" size={16} color="#F0F4F8" />
                <Text style={s.menuItemText}>
                  {movement.isArchived ? 'Restore' : 'Archive'}
                </Text>
              </Pressable>
              <Pressable style={[s.menuItem, { opacity: 0.4 }]} disabled>
                <Icon name="download" size={16} color="#4A5568" />
                <Text style={[s.menuItemText, { color: '#4A5568' }]}>
                  Download
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      )}
    </>
  );
}

// ── Info Modal Component ─────────────────────────────────────────────────
function InfoModal({
  visible,
  movement,
  onClose,
}: {
  visible: boolean;
  movement: MovementDetailData | null;
  onClose: () => void;
}) {
  if (!visible || !movement) return null;
  const createdDate = movement.createdAt?.seconds
    ? new Date(movement.createdAt.seconds * 1000).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'Unknown';
  const updatedDate = (movement as any).updatedAt?.seconds
    ? new Date((movement as any).updatedAt.seconds * 1000).toLocaleDateString(
        'en-US',
        { year: 'numeric', month: 'short', day: 'numeric' },
      )
    : null;

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.menuBackdrop} onPress={onClose}>
        <View style={s.infoModal}>
          <Text style={s.infoTitle}>Movement Info</Text>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Name</Text>
            <Text style={s.infoValue}>{movement.name}</Text>
          </View>
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Created</Text>
            <Text style={s.infoValue}>{createdDate}</Text>
          </View>
          {updatedDate && (
            <View style={s.infoRow}>
              <Text style={s.infoLabel}>Last Edited</Text>
              <Text style={s.infoValue}>{updatedDate}</Text>
            </View>
          )}
          <View style={s.infoRow}>
            <Text style={s.infoLabel}>Ownership</Text>
            <Text style={s.infoValue}>
              {movement.isGlobal ? 'Global Library' : 'Coach Private'}
            </Text>
          </View>
          <Pressable style={s.infoCloseBtn} onPress={onClose}>
            <Text style={s.infoCloseBtnText}>Close</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

// ── Sort Picker Modal ────────────────────────────────────────────────────
function SortPicker({
  visible,
  current,
  onSelect,
  onClose,
}: {
  visible: boolean;
  current: SortOption;
  onSelect: (s: SortOption) => void;
  onClose: () => void;
}) {
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.menuBackdrop} onPress={onClose}>
        <View style={s.sortModal}>
          <Text style={s.sortModalTitle}>Sort By</Text>
          {SORT_OPTIONS.map((opt) => (
            <Pressable
              key={opt.value}
              style={[s.sortOption, current === opt.value && s.sortOptionActive]}
              onPress={() => {
                onSelect(opt.value);
                onClose();
              }}
            >
              <Text
                style={[
                  s.sortOptionText,
                  current === opt.value && s.sortOptionTextActive,
                ]}
              >
                {opt.label}
              </Text>
              {current === opt.value && (
                <Icon name="check" size={16} color="#F5A623" />
              )}
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
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

  // View mode: list or grid
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // Filter panel visibility
  const [filterOpen, setFilterOpen] = useState(false);

  // Sort picker visibility
  const [sortPickerOpen, setSortPickerOpen] = useState(false);

  // Info modal
  const [infoVisible, setInfoVisible] = useState(false);
  const [infoMovement, setInfoMovement] = useState<MovementDetailData | null>(null);

  // Filters
  const movementFilters = useMovementFilters(
    movements.filter((m) => (showArchived ? m.isArchived : !m.isArchived)),
  );
  const {
    searchText,
    setSearchText,
    categoryFilter: selectedCategory,
    setCategoryFilter: setSelectedCategory,
    equipmentFilter: selectedEquipment,
    setEquipmentFilter: setSelectedEquipment,
    muscleGroupFilter: selectedMuscleGroup,
    setMuscleGroupFilter: setSelectedMuscleGroup,
    difficultyFilter: selectedDifficulty,
    setDifficultyFilter: setSelectedDifficulty,
    sortBy,
    setSortBy,
    filtered,
    resetFilters,
    activeFilterCount,
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
      updatedAt: data.updatedAt,
      mediaUrl: data.mediaUrl ?? null,
      videoUrl: data.videoUrl ?? null,
      thumbnailUrl: data.thumbnailUrl ?? null,
      cropScale: data.cropScale ?? 1,
      cropTranslateX: data.cropTranslateX ?? 0,
      cropTranslateY: data.cropTranslateY ?? 0,
    };
  }, []);

  useEffect(() => {
    if (!coachId) {
      console.warn('[Movements] No coachId — skipping listener.');
      setLoading(false);
      return;
    }

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
      merge();
    }, (err) => {
      console.error('[Movements] Coach listener error:', err.code, err.message);
      Alert.alert('Movement Load Error', `Coach query failed: ${err.code}`);
      setLoading(false);
    });

    const unsubGlobal = onSnapshot(globalQ, (snap) => {
      globalDocs = snap.docs.map(mapDoc);
      merge();
    }, (err) => {
      console.error('[Movements] Global listener error:', err.code, err.message);
      setLoading(false);
    });

    return () => {
      unsubCoach();
      unsubGlobal();
    };
  }, [coachId, mapDoc]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
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

  const handleEditFromMenu = (m: MovementDetailData) => {
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

  const handleShowInfo = (m: MovementDetailData) => {
    setInfoMovement(m);
    setInfoVisible(true);
  };

  // ── Filter chip row renderer ──────────────────────────────────────────
  const renderChipRow = (
    label: string,
    options: readonly string[],
    selected: string,
    onSelect: (v: string) => void,
  ) => (
    <View style={s.filterGroup}>
      <Text style={s.filterGroupLabel}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.chipScroll}
      >
        {options.map((opt) => {
          const active = selected === opt;
          return (
            <Pressable
              key={opt}
              style={[s.chip, active && s.chipActive]}
              onPress={() => onSelect(opt)}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  // ── Render item: List view ────────────────────────────────────────────
  const renderListItem = ({ item: m }: { item: MovementDetailData }) => {
    const thumb = m.thumbnailUrl || m.mediaUrl || null;
    return (
      <Pressable style={s.card} onPress={() => handleOpenDetail(m)}>
        <View style={s.cardRow}>
          {thumb ? (
            <View style={s.cardThumbWrap}>
              <View style={s.cardThumbShimmer}>
                <ActivityIndicator size="small" color="#2A3347" />
              </View>
              <Image
                source={{ uri: thumb }}
                style={[s.cardThumb, { position: 'absolute', top: 0, left: 0 }]}
                resizeMode="cover"
              />
            </View>
          ) : (
            <View style={s.cardThumbPlaceholder}>
              <Icon name="play" size={20} color="#4A5568" />
            </View>
          )}
          <View style={s.cardContent}>
            <View style={s.cardTop}>
              <Text style={s.cardName} numberOfLines={1}>
                {m.name}
              </Text>
              <OverflowMenu
                movement={m}
                onEdit={handleEditFromMenu}
                onArchive={handleArchiveRequest}
                onInfo={handleShowInfo}
              />
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
                  <Text style={[s.cardBadgeText, { color: '#F5A623' }]}>
                    Global
                  </Text>
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

  // ── Render item: Grid view ────────────────────────────────────────────
  const renderGridItem = ({ item: m }: { item: MovementDetailData }) => {
    const thumb = m.thumbnailUrl || m.mediaUrl || null;
    return (
      <Pressable style={s.gridCard} onPress={() => handleOpenDetail(m)}>
        {thumb ? (
          <View style={s.gridThumbWrap}>
            <View style={s.gridThumbShimmer}>
              <ActivityIndicator size="small" color="#2A3347" />
            </View>
            <Image
              source={{ uri: thumb }}
              style={[s.gridThumb, { position: 'absolute', top: 0, left: 0 }]}
              resizeMode="cover"
            />
          </View>
        ) : (
          <View style={s.gridThumbPlaceholder}>
            <Icon name="play" size={24} color="#4A5568" />
          </View>
        )}
        <Text style={s.gridName} numberOfLines={2}>
          {m.name}
        </Text>
        {m.equipment ? (
          <Text style={s.gridSub} numberOfLines={1}>
            {m.equipment}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  const keyExtractor = (item: MovementDetailData) => item.id;

  // Current sort label
  const currentSortLabel =
    SORT_OPTIONS.find((o) => o.value === sortBy)?.label ?? 'Sort';

  // ── Render ───────────────────────────────────────────────────────────────
  if (!canAccessMovements) return <MovementsComingSoon />;

  return (
    <View style={s.root}>
      <AppHeader />

      {/* ── Toolbar: Search + Filter icon + New button ── */}
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
        <Pressable
          style={[s.iconBtn, filterOpen && s.iconBtnActive]}
          onPress={() => setFilterOpen(!filterOpen)}
        >
          <Icon
            name="filter"
            size={20}
            color={activeFilterCount > 0 ? '#F5A623' : '#8A95A3'}
          />
          {activeFilterCount > 0 && (
            <View style={s.filterBadge}>
              <Text style={s.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </Pressable>
        <Pressable style={s.newBtn} onPress={handleCreateNew}>
          <Icon name="plus" size={18} color="#0E1117" />
        </Pressable>
      </View>

      {/* ── Expandable Filter Panel ── */}
      {filterOpen && (
        <View style={s.filterPanel}>
          {renderChipRow(
            'Category',
            CATEGORY_FILTER_OPTIONS,
            selectedCategory,
            setSelectedCategory,
          )}
          {renderChipRow(
            'Equipment',
            EQUIPMENT_FILTER_OPTIONS,
            selectedEquipment,
            setSelectedEquipment,
          )}
          {renderChipRow(
            'Muscle Group',
            MUSCLE_GROUP_FILTER_OPTIONS,
            selectedMuscleGroup,
            setSelectedMuscleGroup,
          )}
          {renderChipRow(
            'Difficulty',
            DIFFICULTY_FILTER_OPTIONS,
            selectedDifficulty,
            setSelectedDifficulty,
          )}
          {activeFilterCount > 0 && (
            <Pressable style={s.clearFiltersBtn} onPress={resetFilters}>
              <Text style={s.clearFiltersBtnText}>Clear All Filters</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* ── Controls row: count, archive toggle, sort, view toggle ── */}
      <View style={s.controlsRow}>
        <Text style={s.countText}>
          {filtered.length} movement{filtered.length !== 1 ? 's' : ''}
        </Text>

        <View style={s.controlsRight}>
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
              {showArchived ? 'Archived' : 'Archived'}
            </Text>
          </Pressable>

          <Pressable
            style={s.sortBtn}
            onPress={() => setSortPickerOpen(true)}
          >
            <Icon name="sort" size={14} color="#8A95A3" />
            <Text style={s.sortBtnText} numberOfLines={1}>
              {currentSortLabel}
            </Text>
          </Pressable>

          <Pressable
            style={s.viewToggle}
            onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
          >
            <Icon
              name={viewMode === 'list' ? 'grid' : 'list'}
              size={18}
              color="#8A95A3"
            />
          </Pressable>
        </View>
      </View>

      {/* ── Movement list / grid ── */}
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
              : searchText || activeFilterCount > 0
              ? 'No Movements Found'
              : 'No Movements Yet'}
          </Text>
          <Text style={s.emptyDesc}>
            {showArchived
              ? 'Archived movements will appear here.'
              : searchText || activeFilterCount > 0
              ? 'Try adjusting your search or filters.'
              : 'Tap "+" to create your first movement.'}
          </Text>
        </View>
      ) : viewMode === 'grid' ? (
        <FlatList
          key="grid"
          style={{ flex: 1 }}
          data={filtered}
          renderItem={renderGridItem}
          keyExtractor={keyExtractor}
          numColumns={3}
          columnWrapperStyle={s.gridRow}
          contentContainerStyle={s.gridContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#F5A623"
            />
          }
          initialNumToRender={18}
          maxToRenderPerBatch={12}
          windowSize={5}
        />
      ) : (
        <FlatList
          key="list"
          style={{ flex: 1 }}
          data={filtered}
          renderItem={renderListItem}
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

      {/* Sort Picker */}
      <SortPicker
        visible={sortPickerOpen}
        current={sortBy}
        onSelect={setSortBy}
        onClose={() => setSortPickerOpen(false)}
      />

      {/* Info Modal */}
      <InfoModal
        visible={infoVisible}
        movement={infoMovement}
        onClose={() => setInfoVisible(false)}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const GRID_GAP = 10;
const GRID_PAD = 16;
const GRID_COLS = 3;
const screenW = Dimensions.get('window').width;
const gridItemW = (screenW - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },

  // ── Toolbar ──
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
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
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#2A3347',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnActive: {
    borderColor: 'rgba(245,166,35,0.3)',
    backgroundColor: 'rgba(245,166,35,0.08)',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: '#F5A623',
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  filterBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
  newBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#F5A623',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Filter Panel ──
  filterPanel: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
  },
  filterGroup: {
    marginBottom: 10,
  },
  filterGroupLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FH,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  chipScroll: {
    gap: 6,
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
  clearFiltersBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(245,166,35,0.08)',
    marginTop: 4,
  },
  clearFiltersBtnText: {
    fontSize: 12,
    color: '#F5A623',
    fontWeight: '600',
    fontFamily: FB,
  },

  // ── Controls row ──
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  countText: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
  },
  controlsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  toggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  toggleBtnActive: {
    backgroundColor: 'rgba(245,166,35,0.08)',
  },
  toggleBtnText: {
    fontSize: 11,
    color: '#4A5568',
    fontFamily: FB,
  },
  toggleBtnTextActive: {
    color: '#F5A623',
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  sortBtnText: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
    maxWidth: 100,
  },
  viewToggle: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#2A3347',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── List view ──
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
    marginBottom: 10,
  },
  cardRow: {
    flexDirection: 'row',
    gap: 12,
  },
  cardThumbWrap: {
    width: 72,
    height: 90,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1A2035',
  },
  cardThumb: {
    width: 72,
    height: 90,
    borderRadius: 8,
    backgroundColor: '#1A2035',
  },
  cardThumbPlaceholder: {
    width: 72,
    height: 90,
    borderRadius: 8,
    backgroundColor: '#1A2035',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  cardThumbShimmer: {
    width: 72,
    height: 90,
    borderRadius: 8,
    backgroundColor: '#1A2035',
    alignItems: 'center',
    justifyContent: 'center',
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

  // ── Grid view ──
  gridContent: {
    padding: GRID_PAD,
  },
  gridRow: {
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  gridCard: {
    width: gridItemW,
    backgroundColor: '#161B22',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A3347',
    overflow: 'hidden',
  },
  gridThumbWrap: {
    width: gridItemW,
    height: gridItemW * 1.2,
    backgroundColor: '#1A2035',
  },
  gridThumb: {
    width: gridItemW,
    height: gridItemW * 1.2,
    backgroundColor: '#1A2035',
  },
  gridThumbPlaceholder: {
    width: gridItemW,
    height: gridItemW * 1.2,
    backgroundColor: '#1A2035',
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
  },
  gridThumbShimmer: {
    width: gridItemW,
    height: gridItemW * 1.2,
    backgroundColor: '#1A2035',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridName: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
    paddingHorizontal: 8,
    paddingTop: 8,
  },
  gridSub: {
    fontSize: 10,
    color: '#8A95A3',
    fontFamily: FB,
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 8,
  },

  // ── Overflow menu ──
  overflowBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuPopup: {
    position: 'absolute',
    backgroundColor: '#1E2530',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A3347',
    paddingVertical: 4,
    minWidth: 160,
    ...(Platform.OS === 'web' ? { boxShadow: '0 8px 24px rgba(0,0,0,0.4)' } : {}),
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  menuItemText: {
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
  },

  // ── Info modal ──
  infoModal: {
    backgroundColor: '#1E2530',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2A3347',
    padding: 24,
    width: 320,
    maxWidth: '90%' as any,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
  },
  infoLabel: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
  },
  infoValue: {
    fontSize: 13,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '600',
  },
  infoCloseBtn: {
    marginTop: 16,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(245,166,35,0.12)',
  },
  infoCloseBtnText: {
    fontSize: 14,
    color: '#F5A623',
    fontWeight: '600',
    fontFamily: FB,
  },

  // ── Sort picker modal ──
  sortModal: {
    backgroundColor: '#1E2530',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2A3347',
    padding: 16,
    width: 260,
    maxWidth: '90%' as any,
  },
  sortModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 12,
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  sortOptionActive: {
    backgroundColor: 'rgba(245,166,35,0.08)',
  },
  sortOptionText: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
  },
  sortOptionTextActive: {
    color: '#F5A623',
    fontWeight: '600',
  },

  // ── Centered states (loading, empty) ──
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
