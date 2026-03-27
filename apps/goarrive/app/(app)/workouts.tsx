/**
 * Workouts screen — Coach Workout Library
 *
 * Admin-gated: platformAdmin sees the full workout library page;
 * non-admins see a Coming Soon placeholder.
 *
 * Lists all workouts for the coach. Supports search by name,
 * filter by category/difficulty, template toggle, collapsible filters,
 * tap to view details, create/edit/duplicate/archive workouts.
 *
 * Wires in existing components:
 *   - WorkoutDetail — detail modal with edit/archive/duplicate/assign
 *   - WorkoutForm — creation and edit modal with block builder
 *
 * Firestore collection: workouts, workout_assignments
 * Query pattern: coachId-scoped, filtered by isArchived
 *
 * Suggestions implemented:
 *   5. Duplicate workout
 *   6. Template marking + filter
 *   7. Collapsible filter section
 *   8. Workout usage analytics (assignment count)
 *   9. Typed WorkoutDetail props (via WorkoutDetailData import)
 *  10. Legacy workout badge for workouts missing key fields
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
  const [showArchived, setShowArchived] = useState(false);
  const [showTemplatesOnly, setShowTemplatesOnly] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(true);

  // Detail modal
  const [detailVisible, setDetailVisible] = useState(false);
  const [selectedWorkout, setSelectedWorkout] = useState<WorkoutData | null>(
    null,
  );

  // Create/Edit modal
  const [formVisible, setFormVisible] = useState(false);
  const [editWorkout, setEditWorkout] = useState<WorkoutData | null>(null);

  // Confirm dialog (archive / restore)
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<() => void>(() => {});

  // Assignment counts for usage analytics (suggestion 8)
  const [assignmentCounts, setAssignmentCounts] = useState<
    Record<string, number>
  >({});

  // Template marketplace
  const [showMarketplace, setShowMarketplace] = useState(false);

  // Coach calendar view (Suggestion 3)
  const [showCalendar, setShowCalendar] = useState(false);

  // Preview player state
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewWorkout, setPreviewWorkout] = useState<WorkoutData | null>(null);

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

      // Load assignment counts (suggestion 8)
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
    }, (err) => {
      console.error('[Workouts] Listener error:', err);
      setLoading(false);
    });

    return () => unsub();
  }, [coachId, mapWorkoutDoc]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    // Real-time listener will auto-update; just reset the flag after a short delay
    setTimeout(() => setRefreshing(false), 1000);
  }, []);

  // ── Filter logic ───────────────────────────────────────────────────────
  const filtered = workouts.filter((w) => {
    // Archive filter
    if (showArchived && !w.isArchived) return false;
    if (!showArchived && w.isArchived) return false;

    // Template filter (suggestion 6)
    if (showTemplatesOnly && !w.isTemplate) return false;

    // Search
    if (
      searchText &&
      !w.name.toLowerCase().includes(searchText.toLowerCase())
    )
      return false;

    // Category
    if (
      selectedCategory !== 'All' &&
      w.category.toLowerCase() !== selectedCategory.toLowerCase()
    )
      return false;

    // Difficulty
    if (
      selectedDifficulty !== 'All' &&
      w.difficulty.toLowerCase() !== selectedDifficulty.toLowerCase()
    )
      return false;

    return true;
  });

  // Apply sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'alpha') return a.name.localeCompare(b.name);
    if (sortBy === 'most_used') return (assignmentCounts[b.id] ?? 0) - (assignmentCounts[a.id] ?? 0);
    // newest (default) — already ordered by createdAt desc from Firestore
    return 0;
  });

  const archivedCount = workouts.filter((w) => w.isArchived).length;
  const templateCount = workouts.filter(
    (w) => w.isTemplate && !w.isArchived,
  ).length;
  const activeFilterCount =
    (selectedCategory !== 'All' ? 1 : 0) +
    (selectedDifficulty !== 'All' ? 1 : 0) +
    (showTemplatesOnly ? 1 : 0);

  // ── Handlers ───────────────────────────────────────────────────────────
  const handleOpenDetail = (w: WorkoutData) => {
    setSelectedWorkout(w);
    setDetailVisible(true);
  };

  const handleEdit = (w: WorkoutDetailData) => {
    setDetailVisible(false);
    setEditWorkout(w as WorkoutData);
    setFormVisible(true);
  };

  const handleArchiveRequest = (w: WorkoutDetailData) => {
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

  // ── Duplicate-and-tweak (suggestion 5) ─────────────────────────────────
  const handleDuplicate = (w: WorkoutDetailData) => {
    setDetailVisible(false);
    // Pre-populate the form with the workout data but as a new workout
    setEditWorkout({
      ...w,
      id: '', // empty id signals "create new" to the form
      name: `${w.name} (Copy)`,
      isTemplate: false,
      isArchived: false,
    } as WorkoutData);
    setFormVisible(true);
  };

  // ── Sort options (suggestion 6) ───────────────────────────────────────
  const [sortBy, setSortBy] = useState<'newest' | 'alpha' | 'most_used'>('newest');
  const SORT_OPTIONS: { key: 'newest' | 'alpha' | 'most_used'; label: string }[] = [
    { key: 'newest', label: 'Newest' },
    { key: 'alpha', label: 'A-Z' },
    { key: 'most_used', label: 'Most Used' },
  ];

  const handleFormClose = () => {
    setFormVisible(false);
    setEditWorkout(null);
    // onSnapshot handles updates automatically
  };

  const handleCreateNew = () => {
    setEditWorkout(null);
    setFormVisible(true);
  };

  // ── Check if workout is legacy (suggestion 10) ────────────────────────
  const isLegacy = (w: WorkoutData) =>
    !w.category && !w.difficulty && !w.estimatedDurationMin;

  // ── Preview handler ───────────────────────────────────────────────────
  const handlePreview = (w: WorkoutData) => {
    setPreviewWorkout(w);
    setPreviewVisible(true);
  };

  // ── Render item for FlatList ───────────────────────────────────────────
  const renderItem = ({ item: w }: { item: WorkoutData }) => {
    const count = assignmentCounts[w.id] ?? 0;
    const legacy = isLegacy(w);

    return (
      <Pressable style={s.card} onPress={() => handleOpenDetail(w)}>
        <View style={s.cardTop}>
          <View style={s.cardNameRow}>
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
          <View style={s.cardActions}>
            <Pressable
              style={s.previewBtn}
              onPress={(e) => {
                e.stopPropagation();
                handlePreview(w);
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Icon name="play" size={14} color="#F5A623" />
            </Pressable>
            <Icon name="chevron-right" size={18} color="#4A5568" />
          </View>
        </View>
        {w.description ? (
          <Text style={s.cardDesc} numberOfLines={2}>
            {w.description}
          </Text>
        ) : null}
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
          {w.estimatedDurationMin ? (
            <View style={s.cardBadge}>
              <Text style={s.cardBadgeText}>
                {w.estimatedDurationMin} min
              </Text>
            </View>
          ) : null}
          <View style={s.cardBadge}>
            <Text style={s.cardBadgeText}>
              {w.blocks.length} block{w.blocks.length !== 1 ? 's' : ''}
            </Text>
          </View>
          {/* Usage analytics (suggestion 8) */}
          {count > 0 && (
            <View style={s.assignBadge}>
              <Text style={s.assignBadgeText}>
                Assigned {count}×
              </Text>
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

  const keyExtractor = (item: WorkoutData) => item.id;

  // ── Render ─────────────────────────────────────────────────────────────
  // Non-admin sees Coming Soon
  if (!canAccessWorkouts) return <WorkoutsComingSoon />;

  return (
    <View style={s.root}>
      <AppHeader />

      {/* Toolbar: Search + Create button */}
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
        <Pressable style={s.browseBtn} onPress={() => setShowCalendar(true)}>
          <Icon name="calendar" size={14} color="#F5A623" />
        </Pressable>
        <Pressable style={s.browseBtn} onPress={() => setShowMarketplace(true)}>
          <Icon name="grid" size={14} color="#F5A623" />
        </Pressable>
        <Pressable style={s.createBtn} onPress={handleCreateNew}>
          <Text style={s.createBtnText}>+ New</Text>
        </Pressable>
      </View>

      {/* Collapsible filter section (suggestion 7) */}
      <Pressable
        style={s.filterToggleRow}
        onPress={() => setFiltersExpanded(!filtersExpanded)}
      >
        <Text style={s.filterToggleText}>
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </Text>
        <Icon
          name={filtersExpanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color="#8A95A3"
        />
      </Pressable>

      {filtersExpanded && (
        <View style={s.filterSection}>
          {/* Category chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.chipScroll}
          >
            {CATEGORIES.map((cat) => {
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

          {/* Difficulty chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[s.chipScroll, { marginTop: 8 }]}
          >
            {DIFFICULTIES.map((d) => {
              const active = selectedDifficulty === d;
              return (
                <Pressable
                  key={d}
                  style={[s.chip, active && s.chipActive]}
                  onPress={() => setSelectedDifficulty(d)}
                >
                  <Text style={[s.chipText, active && s.chipTextActive]}>
                    {d}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Sort row */}
      <View style={s.sortRow}>
        <Text style={s.sortLabel}>Sort:</Text>
        {SORT_OPTIONS.map((opt) => {
          const active = sortBy === opt.key;
          return (
            <Pressable
              key={opt.key}
              style={[s.sortChip, active && s.sortChipActive]}
              onPress={() => setSortBy(opt.key)}
            >
              <Text style={[s.sortChipText, active && s.sortChipTextActive]}>
                {opt.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Toggle row: count + archive + template toggles */}
      <View style={s.toggleRow}>
        <Text style={s.countText}>
          {sorted.length} workout{sorted.length !== 1 ? 's' : ''}
        </Text>
        <View style={s.toggleGroup}>
          {/* Template toggle (suggestion 6) */}
          {templateCount > 0 && (
            <Pressable
              style={[s.toggleBtn, showTemplatesOnly && s.toggleBtnActive]}
              onPress={() => setShowTemplatesOnly(!showTemplatesOnly)}
            >
              <Text
                style={[
                  s.toggleBtnText,
                  showTemplatesOnly && s.toggleBtnTextActive,
                ]}
              >
                Templates ({templateCount})
              </Text>
            </Pressable>
          )}
          {/* Archive toggle */}
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
        </View>
      </View>

      {/* Loading */}
      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#F5A623" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={s.centered}>
          <View style={s.emptyIconWrap}>
            <Icon name="workouts" size={28} color="#F5A623" />
          </View>
          <Text style={s.emptyTitle}>
            {showArchived
              ? 'No Archived Workouts'
              : showTemplatesOnly
              ? 'No Templates'
              : searchText || selectedCategory !== 'All' || selectedDifficulty !== 'All'
              ? 'No Matching Workouts'
              : 'No Workouts Yet'}
          </Text>
          <Text style={s.emptyDesc}>
            {showArchived
              ? 'Archived workouts will appear here.'
              : showTemplatesOnly
              ? 'Mark a workout as a template to see it here.'
              : searchText || selectedCategory !== 'All' || selectedDifficulty !== 'All'
              ? 'Try adjusting your search or filters.'
              : 'Tap "+ New" to create your first workout.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={sorted}
          renderItem={renderItem}
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

      {/* Template Marketplace */}
      <WorkoutTemplateMarketplace
        visible={showMarketplace}
        coachId={coachId}
        tenantId={tenantId}
        onClose={() => setShowMarketplace(false)}
      />

      {/* Coach Workout Calendar (Suggestion 3) */}
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
  browseBtn: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
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

  // Collapsible filter toggle (suggestion 7)
  filterToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  filterToggleText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Filter chips
  filterSection: {
    paddingTop: 4,
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

  // Sort row
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  sortLabel: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
    marginRight: 2,
  },
  sortChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  sortChipActive: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderColor: 'rgba(245,166,35,0.3)',
  },
  sortChipText: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
  },
  sortChipTextActive: {
    color: '#F5A623',
    fontWeight: '600',
  },

  // Toggle row
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  toggleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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

  // Workout list
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
  cardDesc: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    lineHeight: 18,
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
  cardActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  previewBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
