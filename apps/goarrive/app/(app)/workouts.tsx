/**
 * Workouts screen — Coach Workout Library
 *
 * Features:
 *   - Search, expandable filter panel (category/difficulty/tags/type)
 *   - List/grid view toggle (2-column grid)
 *   - Grid card auto-thumbnail collage from movement thumbnails
 *   - Auto-calculated estimated duration from block timings
 *   - Overflow menu per card (edit/preview/duplicate/archive)
 *   - Batch operations: multi-select with bulk archive/duplicate/re-categorize
 *   - Sort picker (Newest, A-Z, Most Used)
 *
 * Firestore collections: workouts, workout_assignments, movements
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
  Modal,
  Dimensions,
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
  addDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import { AppHeader } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import WorkoutDetail from '../../components/WorkoutDetail';
import type { WorkoutDetailData } from '../../components/WorkoutDetail';
import WorkoutForm from '../../components/WorkoutForm';
import ConfirmDialog from '../../components/ConfirmDialog';
import WorkoutTemplateMarketplace from '../../components/WorkoutTemplateMarketplace';
import CoachWorkoutCalendar from '../../components/CoachWorkoutCalendar';
import WorkoutPlayer from '../../components/WorkoutPlayer';

// ── Constants ──────────────────────────────────────────────────────────────
const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const CATEGORIES = [
  'All',
  'Upper Body',
  'Lower Body',
  'Full Body',
  'Core',
  'Cardio',
  'Mobility',
  'Recovery',
];

const DIFFICULTIES = ['All', 'Beginner', 'Intermediate', 'Advanced'];

const SORT_OPTIONS: { key: 'newest' | 'alpha' | 'most_used'; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'alpha', label: 'A-Z' },
  { key: 'most_used', label: 'Most Used' },
];

// ── Workout data type ──────────────────────────────────────────────────────
interface WorkoutData {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: string;
  estimatedDurationMin: number | null;
  tags: string[];
  blocks: any[];
  coachId: string;
  tenantId: string;
  isTemplate: boolean;
  isArchived: boolean;
  createdAt: any;
  updatedAt: any;
  assignmentCount?: number;
}

// ── Helper: auto-calculate duration from blocks ──────────────────────────
function calcDurationMin(blocks: any[]): number {
  let totalSec = 0;
  for (const block of blocks) {
    const rounds = block.rounds ?? 1;
    let blockSec = 0;
    for (const m of block.movements ?? []) {
      const sets = m.sets ?? 1;
      const durPerSet = m.durationSec ?? 0;
      const restPerSet = m.restSec ?? 0;
      blockSec += sets * (durPerSet + restPerSet);
    }
    const restBetween = block.restBetweenRoundsSec ?? 0;
    totalSec += rounds * blockSec + (rounds > 1 ? (rounds - 1) * restBetween : 0);
  }
  return Math.ceil(totalSec / 60);
}

// ── Helper: extract unique movement IDs from blocks ──────────────────────
function extractMovementIds(blocks: any[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    for (const m of block.movements ?? []) {
      if (m.movementId && !seen.has(m.movementId)) {
        seen.add(m.movementId);
        ids.push(m.movementId);
      }
    }
  }
  return ids;
}

// ── Coming Soon placeholder (non-admin) ──────────────────────────────────
function WorkoutsComingSoon() {
  return (
    <View style={s.root}>
      <AppHeader />
      <View style={s.centered}>
        <View style={s.emptyIconWrap}>
          <Text style={s.emptyIcon}>🏋️</Text>
        </View>
        <Text style={s.emptyTitle}>Workouts</Text>
        <View style={s.comingSoonBadge}>
          <Text style={s.comingSoonBadgeText}>COMING SOON</Text>
        </View>
        <Text style={s.emptyDesc}>
          The workout library is being re-imagined to support custom workout
          creation, movement libraries, and intelligent playlist rotation for
          your members.
        </Text>
        <Text style={s.hintText}>
          Stay tuned — this will be one of the most powerful features in
          GoArrive.
        </Text>
      </View>
    </View>
  );
}

// ── Overflow Menu Component ──────────────────────────────────────────────
function OverflowMenu({
  workout,
  onEdit,
  onArchive,
  onDuplicate,
  onPreview,
}: {
  workout: WorkoutData;
  onEdit: (w: WorkoutData) => void;
  onArchive: (w: WorkoutData) => void;
  onDuplicate: (w: WorkoutData) => void;
  onPreview: (w: WorkoutData) => void;
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
                onPress={() => { setOpen(false); onEdit(workout); }}
              >
                <Icon name="edit" size={16} color="#F0F4F8" />
                <Text style={s.menuItemText}>Edit</Text>
              </Pressable>
              <Pressable
                style={s.menuItem}
                onPress={() => { setOpen(false); onPreview(workout); }}
              >
                <Icon name="play" size={16} color="#F0F4F8" />
                <Text style={s.menuItemText}>Preview</Text>
              </Pressable>
              <Pressable
                style={s.menuItem}
                onPress={() => { setOpen(false); onDuplicate(workout); }}
              >
                <Icon name="copy" size={16} color="#F0F4F8" />
                <Text style={s.menuItemText}>Duplicate</Text>
              </Pressable>
              <Pressable
                style={s.menuItem}
                onPress={() => { setOpen(false); onArchive(workout); }}
              >
                <Icon name="archive" size={16} color="#F0F4F8" />
                <Text style={s.menuItemText}>
                  {workout.isArchived ? 'Restore' : 'Archive'}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      )}
    </>
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
  current: string;
  onSelect: (s: 'newest' | 'alpha' | 'most_used') => void;
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
              key={opt.key}
              style={[s.sortOption, current === opt.key && s.sortOptionActive]}
              onPress={() => {
                onSelect(opt.key);
                onClose();
              }}
            >
              <Text
                style={[
                  s.sortOptionText,
                  current === opt.key && s.sortOptionTextActive,
                ]}
              >
                {opt.label}
              </Text>
              {current === opt.key && (
                <Icon name="check" size={16} color="#F5A623" />
              )}
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

// ── Re-categorize Modal ──────────────────────────────────────────────────
function RecategorizeModal({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm: (category: string) => void;
}) {
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.menuBackdrop} onPress={onClose}>
        <View style={s.sortModal}>
          <Text style={s.sortModalTitle}>Set Category</Text>
          {CATEGORIES.filter((c) => c !== 'All').map((cat) => (
            <Pressable
              key={cat}
              style={s.sortOption}
              onPress={() => {
                onConfirm(cat);
                onClose();
              }}
            >
              <Text style={s.sortOptionText}>{cat}</Text>
            </Pressable>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

// ── Thumbnail Collage Component ──────────────────────────────────────────
function ThumbnailCollage({
  movementIds,
  thumbMap,
  width,
  height,
}: {
  movementIds: string[];
  thumbMap: Record<string, string>;
  width: number;
  height: number;
}) {
  // Collect available thumbnails (max 16, preserving order)
  const thumbs = movementIds
    .filter((id) => thumbMap[id])
    .map((id) => thumbMap[id])
    .slice(0, 16);

  if (thumbs.length === 0) {
    return (
      <View style={[{ width, height, backgroundColor: '#1A2035' }, s.collageEmpty]}>
        <Icon name="workouts" size={28} color="#2A3347" />
      </View>
    );
  }

  // Calculate grid: max 4 columns, rows fill based on count
  const cols = Math.min(thumbs.length, 4);
  const rows = Math.ceil(thumbs.length / cols);
  const cellW = width / cols;
  const cellH = height / rows;

  return (
    <View style={{ width, height, flexDirection: 'row', flexWrap: 'wrap', overflow: 'hidden' }}>
      {thumbs.map((uri, i) => (
        <Image
          key={`${uri}-${i}`}
          source={{ uri }}
          style={{ width: cellW, height: cellH }}
          resizeMode="cover"
        />
      ))}
    </View>
  );
}

// ── Component ──────────────────────────────────────────────────────────────
export default function WorkoutsScreen() {
  const { user, claims } = useAuth();
  const isAdmin = claims?.admin === true || claims?.role === 'platformAdmin';
  const isCoach = claims?.role === 'coach';
  const canAccessWorkouts = isAdmin || isCoach;
  const coachId = claims?.coachId ?? user?.uid ?? '';
  const tenantId = claims?.tenantId ?? '';

  // ── State ──────────────────────────────────────────────────────────────
  const [workouts, setWorkouts] = useState<WorkoutData[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [selectedDifficulty, setSelectedDifficulty] = useState('All');
  const [selectedTag, setSelectedTag] = useState('All');
  const [showArchived, setShowArchived] = useState(false);
  const [showTemplatesOnly, setShowTemplatesOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'newest' | 'alpha' | 'most_used'>('newest');

  // View mode: list or grid
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // Filter panel visibility
  const [filterOpen, setFilterOpen] = useState(false);

  // Sort picker visibility
  const [sortPickerOpen, setSortPickerOpen] = useState(false);

  // Detail modal
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedWorkout, setSelectedWorkout] = useState<WorkoutData | null>(null);

  // Create/Edit modal
  const [formVisible, setFormVisible] = useState(false);
  const [editWorkout, setEditWorkout] = useState<WorkoutData | null>(null);

  // Confirm dialog (archive / restore)
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<() => void>(() => {});

  // Assignment counts for usage analytics
  const [assignmentCounts, setAssignmentCounts] = useState<Record<string, number>>({});

  // Movement thumbnail map: movementId → thumbnailUrl
  const [thumbMap, setThumbMap] = useState<Record<string, string>>({});

  // Template marketplace (kept for component but button removed)
  const [showMarketplace, setShowMarketplace] = useState(false);

  // Coach calendar view (kept for component but button removed)
  const [showCalendar, setShowCalendar] = useState(false);

  // Preview player state
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewWorkout, setPreviewWorkout] = useState<WorkoutData | null>(null);

  // ── Batch operations state ─────────────────────────────────────────────
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [recategorizeVisible, setRecategorizeVisible] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(sorted.map((w) => w.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setBatchMode(false);
  };

  // ── Real-time workout listener ─────────────────────────────────────────
  const mapWorkoutDoc = useCallback((d: any): WorkoutData => {
    const data = d.data();
    return {
      id: d.id,
      name: data.name ?? '',
      description: data.description ?? '',
      category: data.category ?? '',
      difficulty: data.difficulty ?? '',
      estimatedDurationMin: data.estimatedDurationMin ?? null,
      tags: data.tags ?? [],
      blocks: data.blocks ?? [],
      coachId: data.coachId ?? '',
      tenantId: data.tenantId ?? '',
      isTemplate: data.isTemplate ?? false,
      isArchived: data.isArchived ?? false,
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  }, []);

  useEffect(() => {
    if (!coachId) return;

    const q = query(
      collection(db, 'workouts'),
      where('coachId', '==', coachId),
      orderBy('createdAt', 'desc'),
    );

    const unsub = onSnapshot(q, async (snap) => {
      const list = snap.docs.map(mapWorkoutDoc);
      setWorkouts(list);
      setLoading(false);
      setRefreshing(false);

      // Load assignment counts
      if (list.length > 0) {
        try {
          const assignQ = query(
            collection(db, 'workout_assignments'),
            where('coachId', '==', coachId),
          );
          const assignSnap = await getDocs(assignQ);
          const counts: Record<string, number> = {};
          assignSnap.docs.forEach((d) => {
            const wId = d.data().workoutId;
            if (wId) counts[wId] = (counts[wId] || 0) + 1;
          });
          setAssignmentCounts(counts);
        } catch (err) {
          console.error('[Workouts] Assignment count error:', err);
        }
      }

      // Load movement thumbnails for all referenced movements
      const allMoveIds = new Set<string>();
      list.forEach((w) => {
        extractMovementIds(w.blocks).forEach((id) => allMoveIds.add(id));
      });

      if (allMoveIds.size > 0) {
        try {
          // Firestore 'in' queries support max 30 items per query
          const idsArr = Array.from(allMoveIds);
          const newMap: Record<string, string> = {};
          for (let i = 0; i < idsArr.length; i += 30) {
            const batch = idsArr.slice(i, i + 30);
            const mQ = query(
              collection(db, 'movements'),
              where('__name__', 'in', batch),
            );
            const mSnap = await getDocs(mQ);
            mSnap.docs.forEach((md) => {
              const mData = md.data();
              const thumb = mData.thumbnailUrl || mData.mediaUrl || null;
              if (thumb) newMap[md.id] = thumb;
            });
          }
          setThumbMap((prev) => ({ ...prev, ...newMap }));
        } catch (err) {
          console.error('[Workouts] Thumbnail load error:', err);
        }
      }
    }, (err) => {
      console.error('[Workouts] Listener error:', err);
      setLoading(false);
    });

    return () => unsub();
  }, [coachId, mapWorkoutDoc]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  // ── Derived: unique tags across all workouts ───────────────────────────
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    workouts.forEach((w) => {
      w.tags.forEach((t) => tagSet.add(t));
    });
    return ['All', ...Array.from(tagSet).sort()];
  }, [workouts]);

  // ── Filter logic ───────────────────────────────────────────────────────
  const filtered = workouts.filter((w) => {
    if (showArchived && !w.isArchived) return false;
    if (!showArchived && w.isArchived) return false;
    if (showTemplatesOnly && !w.isTemplate) return false;
    if (searchText && !w.name.toLowerCase().includes(searchText.toLowerCase())) return false;
    if (selectedCategory !== 'All' && w.category.toLowerCase() !== selectedCategory.toLowerCase()) return false;
    if (selectedDifficulty !== 'All' && w.difficulty.toLowerCase() !== selectedDifficulty.toLowerCase()) return false;
    if (selectedTag !== 'All' && !w.tags.includes(selectedTag)) return false;
    return true;
  });

  // Apply sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'alpha') return a.name.localeCompare(b.name);
    if (sortBy === 'most_used') return (assignmentCounts[b.id] ?? 0) - (assignmentCounts[a.id] ?? 0);
    return 0;
  });

  const archivedCount = workouts.filter((w) => w.isArchived).length;
  const templateCount = workouts.filter((w) => w.isTemplate && !w.isArchived).length;
  const activeFilterCount =
    (selectedCategory !== 'All' ? 1 : 0) +
    (selectedDifficulty !== 'All' ? 1 : 0) +
    (selectedTag !== 'All' ? 1 : 0) +
    (showTemplatesOnly ? 1 : 0);

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleOpenDetail = (w: WorkoutData) => {
    if (batchMode) {
      toggleSelect(w.id);
      return;
    }
    setSelectedWorkout(w);
    setDetailVisible(true);
  };

  const handleEdit = (w: WorkoutDetailData) => {
    setDetailVisible(false);
    setEditWorkout(w as WorkoutData);
    setFormVisible(true);
  };

  const handleEditFromMenu = (w: WorkoutData) => {
    setEditWorkout(w);
    setFormVisible(true);
  };

  const handleArchiveRequest = (w: WorkoutDetailData | WorkoutData) => {
    setDetailVisible(false);
    const isArchived = w.isArchived ?? false;
    const action = isArchived ? 'Restore' : 'Archive';
    setConfirmTitle(`${action} Workout`);
    setConfirmMessage(
      isArchived
        ? `Restore "${w.name}" back to your active library?`
        : `Archive "${w.name}"? It will be hidden from your library but can be restored later.`,
    );
    setConfirmAction(() => async () => {
      try {
        await updateDoc(doc(db, 'workouts', w.id), {
          isArchived: !isArchived,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        console.error('[Workouts] Archive error:', err);
        Alert.alert('Error', `Could not ${action.toLowerCase()} workout.`);
      }
      setConfirmVisible(false);
    });
    setConfirmVisible(true);
  };

  const handleDuplicate = (w: WorkoutDetailData | WorkoutData) => {
    setDetailVisible(false);
    setEditWorkout({
      ...w,
      id: '',
      name: `${w.name} (Copy)`,
      isTemplate: false,
      isArchived: false,
    } as WorkoutData);
    setFormVisible(true);
  };

  const handleFormClose = () => {
    setFormVisible(false);
    setEditWorkout(null);
  };

  const handleCreateNew = () => {
    setEditWorkout(null);
    setFormVisible(true);
  };

  const isLegacy = (w: WorkoutData) =>
    !w.category && !w.difficulty && !w.estimatedDurationMin;

  const handlePreview = (w: WorkoutData) => {
    setPreviewWorkout(w);
    setPreviewVisible(true);
  };

  // Reset all filters
  const resetFilters = () => {
    setSelectedCategory('All');
    setSelectedDifficulty('All');
    setSelectedTag('All');
    setShowTemplatesOnly(false);
  };

  // ── Batch action handlers ──────────────────────────────────────────────
  const handleBatchArchive = () => {
    const count = selectedIds.size;
    if (count === 0) return;
    setConfirmTitle(`Archive ${count} Workout${count > 1 ? 's' : ''}`);
    setConfirmMessage(
      `Archive ${count} selected workout${count > 1 ? 's' : ''}? They can be restored later.`,
    );
    setConfirmAction(() => async () => {
      try {
        const batch = writeBatch(db);
        selectedIds.forEach((id) => {
          batch.update(doc(db, 'workouts', id), {
            isArchived: true,
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
        clearSelection();
      } catch (err) {
        console.error('[Workouts] Batch archive error:', err);
        Alert.alert('Error', 'Could not archive selected workouts.');
      }
      setConfirmVisible(false);
    });
    setConfirmVisible(true);
  };

  const handleBatchDuplicate = async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    try {
      const toDuplicate = workouts.filter((w) => selectedIds.has(w.id));
      for (const w of toDuplicate) {
        await addDoc(collection(db, 'workouts'), {
          name: `${w.name} (Copy)`,
          description: w.description,
          category: w.category,
          difficulty: w.difficulty,
          estimatedDurationMin: w.estimatedDurationMin,
          tags: w.tags,
          isTemplate: false,
          blocks: w.blocks,
          coachId,
          tenantId,
          isArchived: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      Alert.alert('Done', `Duplicated ${count} workout${count > 1 ? 's' : ''}.`);
      clearSelection();
    } catch (err) {
      console.error('[Workouts] Batch duplicate error:', err);
      Alert.alert('Error', 'Could not duplicate selected workouts.');
    }
  };

  const handleBatchRecategorize = async (category: string) => {
    const count = selectedIds.size;
    if (count === 0) return;
    try {
      const batch = writeBatch(db);
      selectedIds.forEach((id) => {
        batch.update(doc(db, 'workouts', id), {
          category,
          updatedAt: serverTimestamp(),
        });
      });
      await batch.commit();
      Alert.alert('Done', `Updated ${count} workout${count > 1 ? 's' : ''} to "${category}".`);
      clearSelection();
    } catch (err) {
      console.error('[Workouts] Batch recategorize error:', err);
      Alert.alert('Error', 'Could not update selected workouts.');
    }
  };

  // Current sort label
  const currentSortLabel =
    SORT_OPTIONS.find((o) => o.key === sortBy)?.label ?? 'Sort';

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

  // ── Helper: display duration (auto-calculated or manual) ──────────────
  const getDisplayDuration = (w: WorkoutData): number | null => {
    // If blocks have timing data, auto-calculate
    if (w.blocks.length > 0) {
      const auto = calcDurationMin(w.blocks);
      if (auto > 0) return auto;
    }
    // Fall back to manually entered value
    return w.estimatedDurationMin;
  };

  // ── Render item: List view ────────────────────────────────────────────
  const renderListItem = ({ item: w }: { item: WorkoutData }) => {
    const count = assignmentCounts[w.id] ?? 0;
    const legacy = isLegacy(w);
    const duration = getDisplayDuration(w);
    const isSelected = selectedIds.has(w.id);

    return (
      <Pressable
        style={[s.card, isSelected && s.cardSelected]}
        onPress={() => handleOpenDetail(w)}
        onLongPress={() => {
          if (!batchMode) {
            setBatchMode(true);
            setSelectedIds(new Set([w.id]));
          }
        }}
      >
        <View style={s.cardTop}>
          <View style={s.cardNameRow}>
            {batchMode && (
              <View style={[s.checkbox, isSelected && s.checkboxActive]}>
                {isSelected && <Icon name="check" size={12} color="#0E1117" />}
              </View>
            )}
            <Text style={s.cardName} numberOfLines={1}>
              {w.name}
            </Text>
            {w.isTemplate && (
              <View style={s.templateBadge}>
                <Text style={s.templateBadgeText}>TEMPLATE</Text>
              </View>
            )}
            {legacy && (
              <View style={s.legacyBadge}>
                <Text style={s.legacyBadgeText}>UPDATE</Text>
              </View>
            )}
          </View>
          {!batchMode && (
            <OverflowMenu
              workout={w}
              onEdit={handleEditFromMenu}
              onArchive={(wk) => handleArchiveRequest(wk)}
              onDuplicate={(wk) => handleDuplicate(wk)}
              onPreview={handlePreview}
            />
          )}
        </View>
        <View style={s.cardBadgeRow}>
          {w.category ? (
            <View style={s.cardBadge}>
              <Text style={s.cardBadgeText}>{w.category}</Text>
            </View>
          ) : null}
          {w.difficulty ? (
            <View style={s.cardBadge}>
              <Text style={s.cardBadgeText}>{w.difficulty}</Text>
            </View>
          ) : null}
          {duration ? (
            <View style={s.cardBadge}>
              <Text style={s.cardBadgeText}>{duration} min</Text>
            </View>
          ) : null}
          <View style={s.cardBadge}>
            <Text style={s.cardBadgeText}>
              {w.blocks.length} block{w.blocks.length !== 1 ? 's' : ''}
            </Text>
          </View>
          {count > 0 && (
            <View style={s.assignBadge}>
              <Text style={s.assignBadgeText}>Assigned {count}×</Text>
            </View>
          )}
        </View>
        {w.tags.length > 0 && (
          <Text style={s.cardTags} numberOfLines={1}>
            {w.tags.join(' · ')}
          </Text>
        )}
      </Pressable>
    );
  };

  // ── Render item: Grid view ────────────────────────────────────────────
  const renderGridItem = ({ item: w }: { item: WorkoutData }) => {
    const duration = getDisplayDuration(w);
    const moveIds = extractMovementIds(w.blocks);
    const isSelected = selectedIds.has(w.id);

    return (
      <Pressable
        style={[s.gridCard, isSelected && s.gridCardSelected]}
        onPress={() => handleOpenDetail(w)}
        onLongPress={() => {
          if (!batchMode) {
            setBatchMode(true);
            setSelectedIds(new Set([w.id]));
          }
        }}
      >
        {/* Thumbnail collage header */}
        <View style={s.gridHeader}>
          <ThumbnailCollage
            movementIds={moveIds}
            thumbMap={thumbMap}
            width={gridItemW}
            height={gridItemW * 0.65}
          />
          {/* Badges overlay */}
          <View style={s.gridBadgeOverlay}>
            <View style={s.gridBlockBadge}>
              <Text style={s.gridBlockBadgeText}>
                {w.blocks.length} block{w.blocks.length !== 1 ? 's' : ''}
              </Text>
            </View>
          </View>
          {w.isTemplate && (
            <View style={s.gridTemplateBadge}>
              <Text style={s.gridTemplateBadgeText}>TPL</Text>
            </View>
          )}
          {batchMode ? (
            <View style={s.gridCheckboxWrap}>
              <View style={[s.checkbox, isSelected && s.checkboxActive]}>
                {isSelected && <Icon name="check" size={12} color="#0E1117" />}
              </View>
            </View>
          ) : (
            <View style={s.gridOverflowWrap}>
              <OverflowMenu
                workout={w}
                onEdit={handleEditFromMenu}
                onArchive={(wk) => handleArchiveRequest(wk)}
                onDuplicate={(wk) => handleDuplicate(wk)}
                onPreview={handlePreview}
              />
            </View>
          )}
        </View>
        <View style={s.gridBody}>
          <Text style={s.gridName} numberOfLines={2}>
            {w.name}
          </Text>
          <View style={s.gridBadgeRow}>
            {w.category ? (
              <Text style={s.gridSub} numberOfLines={1}>
                {w.category}
              </Text>
            ) : null}
            {w.difficulty ? (
              <Text style={s.gridSub} numberOfLines={1}>
                {w.difficulty}
              </Text>
            ) : null}
          </View>
          {duration ? (
            <Text style={s.gridDuration}>{duration} min</Text>
          ) : null}
        </View>
      </Pressable>
    );
  };

  const keyExtractor = (item: WorkoutData) => item.id;

  // ── Render ─────────────────────────────────────────────────────────────
  if (!canAccessWorkouts) return <WorkoutsComingSoon />;

  return (
    <View style={s.root}>
      <AppHeader />

      {/* ── Batch action bar ── */}
      {batchMode && (
        <View style={s.batchBar}>
          <View style={s.batchLeft}>
            <Pressable onPress={clearSelection} hitSlop={8}>
              <Icon name="close" size={18} color="#F0F4F8" />
            </Pressable>
            <Text style={s.batchCount}>
              {selectedIds.size} selected
            </Text>
            <Pressable onPress={selectAll} hitSlop={8}>
              <Text style={s.batchSelectAll}>Select All</Text>
            </Pressable>
          </View>
          <View style={s.batchActions}>
            <Pressable
              style={s.batchActionBtn}
              onPress={() => setRecategorizeVisible(true)}
            >
              <Icon name="tag" size={14} color="#F5A623" />
              <Text style={s.batchActionText}>Category</Text>
            </Pressable>
            <Pressable style={s.batchActionBtn} onPress={handleBatchDuplicate}>
              <Icon name="copy" size={14} color="#F5A623" />
              <Text style={s.batchActionText}>Duplicate</Text>
            </Pressable>
            <Pressable style={s.batchActionBtn} onPress={handleBatchArchive}>
              <Icon name="archive" size={14} color="#F5A623" />
              <Text style={s.batchActionText}>Archive</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* ── Toolbar: Search + Filter icon + New button ── */}
      {!batchMode && (
        <View style={s.toolbar}>
          <View style={s.searchWrap}>
            <Icon name="search" size={18} color="#4A5568" />
            <TextInput
              style={s.searchInput}
              placeholder="Search workouts..."
              placeholderTextColor="#4A5568"
              value={searchText}
              onChangeText={setSearchText}
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
      )}

      {/* ── Expandable Filter Panel ── */}
      {filterOpen && !batchMode && (
        <ScrollView style={s.filterPanelScroll} contentContainerStyle={s.filterPanel}>
          {renderChipRow(
            'Category',
            CATEGORIES,
            selectedCategory,
            setSelectedCategory,
          )}
          {renderChipRow(
            'Difficulty',
            DIFFICULTIES,
            selectedDifficulty,
            setSelectedDifficulty,
          )}
          {/* Tags filter row — only show if tags exist */}
          {allTags.length > 1 &&
            renderChipRow('Tags', allTags, selectedTag, setSelectedTag)}
          {/* Template toggle inside filter panel */}
          {templateCount > 0 && (
            <View style={s.filterGroup}>
              <Text style={s.filterGroupLabel}>Type</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                <Pressable
                  style={[s.chip, !showTemplatesOnly && s.chipActive]}
                  onPress={() => setShowTemplatesOnly(false)}
                >
                  <Text style={[s.chipText, !showTemplatesOnly && s.chipTextActive]}>
                    All
                  </Text>
                </Pressable>
                <Pressable
                  style={[s.chip, showTemplatesOnly && s.chipActive]}
                  onPress={() => setShowTemplatesOnly(true)}
                >
                  <Text style={[s.chipText, showTemplatesOnly && s.chipTextActive]}>
                    Templates ({templateCount})
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
          {activeFilterCount > 0 && (
            <Pressable style={s.clearFiltersBtn} onPress={resetFilters}>
              <Text style={s.clearFiltersBtnText}>Clear All Filters</Text>
            </Pressable>
          )}
        </ScrollView>
      )}

      {/* ── Controls row: count, archive toggle, sort, view toggle ── */}
      {!batchMode && (
        <View style={s.controlsRow}>
          <Text style={s.countText}>
            {sorted.length} workout{sorted.length !== 1 ? 's' : ''}
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
                {archivedCount}
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
      )}

      {/* ── Workout list / grid ── */}
      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#F5A623" />
        </View>
      ) : sorted.length === 0 ? (
        <View style={s.centered}>
          <View style={s.emptyIconWrap}>
            <Icon name="workouts" size={28} color="#F5A623" />
          </View>
          <Text style={s.emptyTitle}>
            {showArchived
              ? 'No Archived Workouts'
              : showTemplatesOnly
              ? 'No Templates'
              : searchText || activeFilterCount > 0
              ? 'No Matching Workouts'
              : 'No Workouts Yet'}
          </Text>
          <Text style={s.emptyDesc}>
            {showArchived
              ? 'Archived workouts will appear here.'
              : showTemplatesOnly
              ? 'Mark a workout as a template to see it here.'
              : searchText || activeFilterCount > 0
              ? 'Try adjusting your search or filters.'
              : 'Tap "+" to create your first workout.'}
          </Text>
        </View>
      ) : viewMode === 'grid' ? (
        <FlatList
          key="grid"
          style={{ flex: 1 }}
          data={sorted}
          renderItem={renderGridItem}
          keyExtractor={keyExtractor}
          numColumns={2}
          columnWrapperStyle={s.gridRow}
          contentContainerStyle={s.gridContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#F5A623"
            />
          }
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={5}
        />
      ) : (
        <FlatList
          key="list"
          style={{ flex: 1 }}
          data={sorted}
          renderItem={renderListItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={s.listContent}
          initialNumToRender={15}
          maxToRenderPerBatch={10}
          windowSize={5}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#F5A623"
              colors={['#F5A623']}
            />
          }
        />
      )}

      {/* Workout Detail modal */}
      {detailVisible && selectedWorkout && (
        <WorkoutDetail
          workout={selectedWorkout as WorkoutDetailData}
          onClose={() => {
            setDetailVisible(false);
            setSelectedWorkout(null);
          }}
          onEdit={handleEdit}
          onArchive={handleArchiveRequest}
          onDuplicate={handleDuplicate}
        />
      )}

      {/* Workout Form modal */}
      <WorkoutForm
        visible={formVisible}
        onClose={handleFormClose}
        coachId={coachId}
        tenantId={tenantId}
        editWorkout={editWorkout}
      />

      {/* Template Marketplace (component kept, button removed from toolbar) */}
      <WorkoutTemplateMarketplace
        visible={showMarketplace}
        coachId={coachId}
        tenantId={tenantId}
        onClose={() => setShowMarketplace(false)}
      />

      {/* Coach Workout Calendar (component kept, button removed from toolbar) */}
      <CoachWorkoutCalendar
        coachId={coachId}
        visible={showCalendar}
        onClose={() => setShowCalendar(false)}
      />

      {/* Workout Preview Player */}
      {previewWorkout && previewVisible && (
        <WorkoutPlayer
          visible={previewVisible}
          workout={previewWorkout}
          onClose={() => {
            setPreviewVisible(false);
            setPreviewWorkout(null);
          }}
          onComplete={() => {
            setPreviewVisible(false);
            setPreviewWorkout(null);
          }}
        />
      )}

      {/* Sort Picker */}
      <SortPicker
        visible={sortPickerOpen}
        current={sortBy}
        onSelect={setSortBy}
        onClose={() => setSortPickerOpen(false)}
      />

      {/* Re-categorize Modal */}
      <RecategorizeModal
        visible={recategorizeVisible}
        onClose={() => setRecategorizeVisible(false)}
        onConfirm={handleBatchRecategorize}
      />

      {/* Confirm dialog */}
      <ConfirmDialog
        visible={confirmVisible}
        title={confirmTitle}
        message={confirmMessage}
        confirmLabel="Confirm"
        onConfirm={confirmAction}
        onCancel={() => setConfirmVisible(false)}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const GRID_GAP = 10;
const GRID_PAD = 16;
const GRID_COLS = 2;
const screenW = Dimensions.get('window').width;
const gridItemW = (screenW - GRID_PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },

  // ── Batch bar ──
  batchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#161B22',
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
  },
  batchLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  batchCount: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  batchSelectAll: {
    fontSize: 12,
    color: '#F5A623',
    fontWeight: '600',
    fontFamily: FB,
  },
  batchActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  batchActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.2)',
  },
  batchActionText: {
    fontSize: 11,
    color: '#F5A623',
    fontWeight: '600',
    fontFamily: FB,
  },

  // ── Checkbox ──
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: '#4A5568',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
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
  filterPanelScroll: {
    maxHeight: 320,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
  },
  filterPanel: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
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
    gap: 8,
    marginBottom: 10,
  },
  cardSelected: {
    borderColor: 'rgba(245,166,35,0.5)',
    backgroundColor: 'rgba(245,166,35,0.04)',
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 8,
    gap: 8,
  },
  cardName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
    flexShrink: 1,
  },
  templateBadge: {
    backgroundColor: 'rgba(167,139,250,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.3)',
  },
  templateBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#A78BFA',
    fontFamily: FH,
    letterSpacing: 0.8,
  },
  legacyBadge: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  legacyBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    letterSpacing: 0.8,
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
  cardBadgeText: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
  },
  assignBadge: {
    backgroundColor: 'rgba(110,187,122,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(110,187,122,0.25)',
  },
  assignBadgeText: {
    fontSize: 11,
    color: '#6EBB7A',
    fontFamily: FB,
  },
  cardTags: {
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
  gridCardSelected: {
    borderColor: 'rgba(245,166,35,0.5)',
    backgroundColor: 'rgba(245,166,35,0.04)',
  },
  gridHeader: {
    width: gridItemW,
    height: gridItemW * 0.65,
    backgroundColor: '#1A2035',
    position: 'relative',
    overflow: 'hidden',
  },
  collageEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridBadgeOverlay: {
    position: 'absolute',
    bottom: 6,
    left: 6,
  },
  gridBlockBadge: {
    backgroundColor: 'rgba(14,17,23,0.75)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  gridBlockBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FB,
  },
  gridTemplateBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(167,139,250,0.85)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  gridTemplateBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#FFF',
    fontFamily: FH,
    letterSpacing: 0.5,
  },
  gridOverflowWrap: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(14,17,23,0.7)',
    borderRadius: 6,
  },
  gridCheckboxWrap: {
    position: 'absolute',
    top: 6,
    right: 6,
  },
  gridBody: {
    padding: 10,
    gap: 4,
  },
  gridName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  gridBadgeRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  gridSub: {
    fontSize: 10,
    color: '#8A95A3',
    fontFamily: FB,
  },
  gridDuration: {
    fontSize: 10,
    color: '#4A5568',
    fontFamily: FB,
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
