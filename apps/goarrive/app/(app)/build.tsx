/**
 * Build screen — Unified Creative Workspace
 *
 * Combines Plans, Movements, Workouts, and Playbooks into one visual workspace.
 * Replaces separate Workouts and Movements tabs.
 *
 * Features:
 *   - Unified Search & Filter
 *   - Folder-First Organization
 *   - Multi-action Plus Button
 *   - Grid/List Toggle
 *   - Batch Operations
 */
import React, { useState, useEffect, useCallback, useRef, useMemo, Component, ErrorInfo } from 'react';
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
  Dimensions,
  Image,
  Modal,
} from 'react-native';
import {
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import { AppHeader } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import MovementDetail from '../../components/MovementDetail';
import MovementForm from '../../components/MovementForm';
import WorkoutDetail from '../../components/WorkoutDetail';
import WorkoutForm from '../../components/WorkoutForm';

// ── Constants ──────────────────────────────────────────────────────────────
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

type BuildType = 'Plans' | 'Movements' | 'Workouts' | 'Playbooks';
const TYPES: BuildType[] = ['Plans', 'Movements', 'Workouts', 'Playbooks'];

interface BuildItem {
  id: string;
  name: string;
  type: BuildType | 'Folder';
  category?: string;
  difficulty?: string;
  thumbnailUrl?: string;
  mediaUrl?: string;
  coverThumbs?: string[];
  isArchived: boolean;
  createdAt: any;
  updatedAt: any;
  parentId?: string; // For folder hierarchy
  [key: string]: any;
}

// ── Error Boundary ──────────────────────────────────────────────────────
class BuildErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: '' };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Build screen error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0E1117', justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Text style={{ color: '#EF4444', fontSize: 18, fontWeight: '700', marginBottom: 12 }}>Something went wrong</Text>
          <Text style={{ color: '#8A95A3', fontSize: 13, textAlign: 'center', marginBottom: 20 }}>{this.state.error}</Text>
          <Pressable
            onPress={() => this.setState({ hasError: false, error: '' })}
            style={{ backgroundColor: '#F5A623', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }}
          >
            <Text style={{ color: '#0E1117', fontWeight: '700' }}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function BuildScreenWrapper() {
  return (
    <BuildErrorBoundary>
      <BuildScreenInner />
    </BuildErrorBoundary>
  );
}

function BuildScreenInner() {
  const { user, claims } = useAuth();
  const coachId = claims?.coachId ?? user?.uid ?? '';
  
  // ── State ──────────────────────────────────────────────────────────────
  const [items, setItems] = useState<BuildItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState<BuildType | 'All'>('All');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isPlusOpen, setIsPlusOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showArchived, setShowArchived] = useState(false);
  
  // Modals
  const [selectedMovement, setSelectedMovement] = useState<any | null>(null);
  const [editMovement, setEditMovement] = useState<any | null>(null);
  const [isMovementFormOpen, setIsMovementFormOpen] = useState(false);
  const [selectedWorkout, setSelectedWorkout] = useState<any | null>(null);
  const [editWorkout, setEditWorkout] = useState<any | null>(null);
  const [isWorkoutFormOpen, setIsWorkoutFormOpen] = useState(false);

  const tenantId = claims?.tenantId ?? '';

  // ── Data Fetching ──────────────────────────────────────────────────────
  // NOTE: We intentionally do NOT filter isArchived in the Firestore query
  // to avoid requiring a composite index (coachId + isArchived + createdAt).
  // Instead we fetch all docs for this coach and filter client-side.
  // This keeps the query simple (single-field index only) and resilient.
  useEffect(() => {
    if (!coachId) return;

    setLoading(true);
    let movementsLoaded = false;
    let workoutsLoaded = false;
    
    const movementsQuery = query(
      collection(db, 'movements'),
      where('coachId', '==', coachId),
      orderBy('createdAt', 'desc')
    );

    const workoutsQuery = query(
      collection(db, 'workouts'),
      where('coachId', '==', coachId),
      orderBy('createdAt', 'desc')
    );

    const unsubMovements = onSnapshot(
      movementsQuery,
      (snap) => {
        const movementItems: BuildItem[] = snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          type: 'Movements'
        } as BuildItem));
        
        setItems(prev => {
          const otherItems = prev.filter(i => i.type !== 'Movements');
          return [...otherItems, ...movementItems].sort((a, b) => 
            (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
          );
        });
        movementsLoaded = true;
        if (movementsLoaded && workoutsLoaded) setLoading(false);
        else setLoading(false); // Don't block on the other query
      },
      (err) => {
        console.error('[Build] Movements listener error:', err);
        movementsLoaded = true;
        setLoading(false);
      },
    );

    const unsubWorkouts = onSnapshot(
      workoutsQuery,
      (snap) => {
        const workoutItems: BuildItem[] = snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          type: 'Workouts'
        } as BuildItem));
        
        setItems(prev => {
          const otherItems = prev.filter(i => i.type !== 'Workouts');
          return [...otherItems, ...workoutItems].sort((a, b) => 
            (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
          );
        });
        workoutsLoaded = true;
        if (movementsLoaded && workoutsLoaded) setLoading(false);
        else setLoading(false); // Don't block on the other query
      },
      (err) => {
        console.error('[Build] Workouts listener error:', err);
        workoutsLoaded = true;
        setLoading(false);
      },
    );

    return () => {
      unsubMovements();
      unsubWorkouts();
    };
  }, [coachId]);

  // ── Filtering ──────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    let list = items;
    // Client-side archive filter (replaces Firestore compound query)
    list = list.filter(i => !!i.isArchived === showArchived);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i => i.name?.toLowerCase().includes(q));
    }
    if (activeType !== 'All') {
      list = list.filter(i => i.type === activeType);
    }
    return list;
  }, [items, search, activeType, showArchived]);

  // ── Render Helpers ─────────────────────────────────────────────────────
  const renderItem = ({ item }: { item: BuildItem }) => {
    if (viewMode === 'grid') {
      const isMovement = item.type === 'Movements';
      return (
        <Pressable 
          style={[s.gridCard, isMovement ? s.movementCard : s.workoutCard]}
          onPress={() => {
            if (isMovement) setSelectedMovement(item);
            else setSelectedWorkout(item);
          }}
        >
          <View style={s.cardMedia}>
            {item.thumbnailUrl || item.mediaUrl ? (
              <Image source={{ uri: item.thumbnailUrl || item.mediaUrl }} style={s.cardImage} />
            ) : item.coverThumbs && item.coverThumbs.length > 0 ? (
              <Image source={{ uri: item.coverThumbs[0] }} style={s.cardImage} />
            ) : (
              <View style={s.mediaPlaceholder}>
                <Icon name={isMovement ? 'movements' : 'workouts'} size={32} color="#1E2A3A" />
              </View>
            )}
            <View style={s.typeBadge}>
              <Text style={s.typeBadgeText}>{item.type.slice(0, -1)}</Text>
            </View>
          </View>
          <View style={s.cardInfo}>
            <Text style={s.cardName} numberOfLines={1}>{item.name}</Text>
            <Text style={s.cardSub}>{item.category || 'No Category'}</Text>
          </View>
        </Pressable>
      );
    }

    return (
      <Pressable 
        style={s.listItem}
        onPress={() => {
          if (item.type === 'Movements') setSelectedMovement(item);
          else setSelectedWorkout(item);
        }}
      >
        <View style={s.listMedia}>
          {item.thumbnailUrl || item.mediaUrl ? (
            <Image source={{ uri: item.thumbnailUrl || item.mediaUrl }} style={s.listImage} />
          ) : (
            <View style={s.listPlaceholder}>
              <Icon name={item.type === 'Movements' ? 'movements' : 'workouts'} size={20} color="#4A5568" />
            </View>
          )}
        </View>
        <View style={s.listContent}>
          <Text style={s.listName}>{item.name}</Text>
          <Text style={s.listSub}>{item.type} • {item.category || 'Uncategorized'}</Text>
        </View>
        <Icon name="chevron-right" size={20} color="#4A5568" />
      </Pressable>
    );
  };

  return (
    <View style={s.root}>
      <AppHeader />

      <View style={s.toolbar}>
        <View style={s.searchWrap}>
          <Icon name="search" size={18} color="#8A95A3" style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            placeholder="Search Build..."
            placeholderTextColor="#4A5568"
            value={search}
            onChangeText={setSearch}
            clearButtonMode="while-editing"
          />
        </View>

        <Pressable
          style={[s.toolBtn, isFilterOpen && s.toolBtnActive]}
          onPress={() => setIsFilterOpen(!isFilterOpen)}
        >
          <Icon name="filter" size={20} color={isFilterOpen ? '#F5A623' : '#F0F4F8'} />
        </Pressable>

        <Pressable
          style={s.plusBtn}
          onPress={() => setIsPlusOpen(true)}
        >
          <Icon name="plus" size={24} color="#0E1117" />
        </Pressable>
      </View>

      {isFilterOpen && (
        <View style={s.filterPanel}>
          <Text style={s.filterTitle}>Filter by Type</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow}>
            {['All', ...TYPES].map((type) => (
              <Pressable
                key={type}
                style={[s.filterChip, activeType === type && s.filterChipActive]}
                onPress={() => setActiveType(type as any)}
              >
                <Text style={[s.filterChipText, activeType === type && s.filterChipTextActive]}>
                  {type}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          
          <View style={s.filterActions}>
            <Pressable 
              style={s.filterActionBtn}
              onPress={() => setShowArchived(!showArchived)}
            >
              <Icon name="archive" size={16} color={showArchived ? '#F5A623' : '#8A95A3'} />
              <Text style={[s.filterActionText, showArchived && { color: '#F5A623' }]}>
                {showArchived ? 'Showing Archived' : 'Show Archived'}
              </Text>
            </Pressable>
            
            <Pressable 
              style={s.filterActionBtn}
              onPress={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
            >
              <Icon name={viewMode === 'grid' ? 'list' : 'grid'} size={16} color="#8A95A3" />
              <Text style={s.filterActionText}>
                {viewMode === 'grid' ? 'List View' : 'Grid View'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {loading ? (
        <View style={s.centered}>
          <ActivityIndicator size="large" color="#F5A623" />
        </View>
      ) : filteredItems.length > 0 ? (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          numColumns={viewMode === 'grid' ? 2 : 1}
          key={viewMode}
          contentContainerStyle={s.listPadding}
          columnWrapperStyle={viewMode === 'grid' ? s.columnWrapper : undefined}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => setLoading(true)} tintColor="#F5A623" />
          }
        />
      ) : (
        <View style={s.centered}>
          <Icon name="build" size={48} color="#1E2A3A" />
          <Text style={s.emptyTitle}>Nothing Found</Text>
          <Text style={s.emptyDesc}>
            Try adjusting your search or filters.
          </Text>
        </View>
      )}

      <MovementDetail
        visible={!!selectedMovement}
        movement={selectedMovement}
        onClose={() => setSelectedMovement(null)}
        onEdit={(m: any) => {
          setEditMovement(m);
          setSelectedMovement(null);
          setIsMovementFormOpen(true);
        }}
        onArchive={async (m: any) => {
          try {
            await updateDoc(doc(db, 'movements', m.id), { isArchived: !m.isArchived });
            setSelectedMovement(null);
          } catch (e) { console.error('Archive movement error:', e); }
        }}
      />
      
      <MovementForm
        visible={isMovementFormOpen}
        onClose={() => {
          setIsMovementFormOpen(false);
          setEditMovement(null);
        }}
        coachId={coachId}
        tenantId={tenantId}
        editMovement={editMovement}
      />

      {selectedWorkout && (
        <WorkoutDetail
          workout={selectedWorkout}
          onClose={() => setSelectedWorkout(null)}
          onEdit={(w: any) => {
            setEditWorkout(w);
            setSelectedWorkout(null);
            setIsWorkoutFormOpen(true);
          }}
        />
      )}

      <WorkoutForm
        visible={isWorkoutFormOpen}
        onClose={() => {
          setIsWorkoutFormOpen(false);
          setEditWorkout(null);
        }}
        coachId={coachId}
        tenantId={tenantId}
        editWorkout={editWorkout}
      />

      <Modal transparent visible={isPlusOpen} animationType="fade" onRequestClose={() => setIsPlusOpen(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setIsPlusOpen(false)}>
          <View style={s.plusMenu}>
            <Text style={s.plusMenuTitle}>Create New</Text>
            <Pressable style={s.plusMenuItem} onPress={() => setIsPlusOpen(false)}>
              <Icon name="plan" size={20} color="#F0F4F8" />
              <Text style={s.plusMenuItemText}>Plan</Text>
            </Pressable>
            <Pressable 
              style={s.plusMenuItem} 
              onPress={() => {
                setIsPlusOpen(false);
                setEditMovement(null);
                setIsMovementFormOpen(true);
              }}
            >
              <Icon name="movements" size={20} color="#F0F4F8" />
              <Text style={s.plusMenuItemText}>Movement</Text>
            </Pressable>
            <Pressable 
              style={s.plusMenuItem} 
              onPress={() => {
                setIsPlusOpen(false);
                setEditWorkout(null);
                setIsWorkoutFormOpen(true);
              }}
            >
              <Icon name="workouts" size={20} color="#F0F4F8" />
              <Text style={s.plusMenuItemText}>Workout</Text>
            </Pressable>
            <Pressable style={s.plusMenuItem} onPress={() => setIsPlusOpen(false)}>
              <Icon name="playbook" size={20} color="#F0F4F8" />
              <Text style={s.plusMenuItemText}>Playbook</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    zIndex: 10,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E2A3A',
    borderRadius: 10,
    height: 44,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: '#F0F4F8',
    fontSize: 15,
    fontFamily: FB,
    paddingVertical: 0,
  },
  toolBtn: {
    width: 44,
    height: 44,
    backgroundColor: '#1E2A3A',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  toolBtnActive: {
    backgroundColor: 'rgba(245, 166, 35, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245, 166, 35, 0.3)',
  },
  plusBtn: {
    width: 44,
    height: 44,
    backgroundColor: '#F5A623',
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#F5A623',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  filterPanel: {
    backgroundColor: '#0E1117',
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  filterTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#4A5568',
    letterSpacing: 1,
    marginBottom: 12,
    fontFamily: FH,
    textTransform: 'uppercase',
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1E2A3A',
    borderRadius: 20,
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#F5A623',
  },
  filterChipText: {
    color: '#8A95A3',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FB,
  },
  filterChipTextActive: {
    color: '#0E1117',
  },
  filterActions: {
    flexDirection: 'row',
    gap: 16,
  },
  filterActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  filterActionText: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    fontWeight: '600',
  },
  listPadding: {
    padding: 16,
    paddingBottom: 100,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  gridCard: {
    width: (Dimensions.get('window').width - 48) / 2,
    backgroundColor: '#1E2A3A',
    borderRadius: 12,
    overflow: 'hidden',
  },
  cardMedia: {
    aspectRatio: 1,
    backgroundColor: '#0E1117',
    position: 'relative',
  },
  movementCard: {
  },
  cardImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  mediaPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  typeBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(14, 17, 23, 0.8)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  typeBadgeText: {
    color: '#F5A623',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: FH,
    textTransform: 'uppercase',
  },
  cardInfo: {
    padding: 12,
  },
  cardName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 2,
  },
  cardSub: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E2A3A',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
  },
  listMedia: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#0E1117',
    marginRight: 16,
    overflow: 'hidden',
  },
  listImage: {
    width: '100%',
    height: '100%',
  },
  listPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listContent: {
    flex: 1,
  },
  listName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 2,
  },
  listSub: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginTop: 16,
    marginBottom: 8,
  },
  emptyDesc: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
    textAlign: 'center',
    lineHeight: 20,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  plusMenu: {
    backgroundColor: '#1E2A3A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  plusMenuTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 20,
  },
  plusMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 16,
  },
  plusMenuItemText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
});
