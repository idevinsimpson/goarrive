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
 *   - Responsive grid with max card size (~160px) and 4:5 aspect ratio
 *   - Name overlay on transparent gradient at bottom of card
 *   - Workout cards show mosaic of movement GIF thumbnails
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
  useWindowDimensions,
} from 'react-native';
import {
  collection,
  query,
  where,
  orderBy,
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
import MovementDetail from '../../components/MovementDetail';
import MovementForm from '../../components/MovementForm';
import WorkoutDetail from '../../components/WorkoutDetail';
import WorkoutForm from '../../components/WorkoutForm';

// ── Constants ──────────────────────────────────────────────────────────────
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

type BuildType = 'Plans' | 'Movements' | 'Workouts' | 'Playbooks';
const TYPES: BuildType[] = ['Plans', 'Movements', 'Workouts', 'Playbooks'];

// ── Grid layout constants ──────────────────────────────────────────────────
const GRID_PADDING = 16;       // padding on left/right of the grid
const GRID_GAP = 12;           // gap between cards
const MAX_CARD_WIDTH = 160;    // max card width in px
const CARD_ASPECT = 4 / 5;     // 4:5 width:height ratio → height = width / (4/5) = width * 1.25

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

// ── Responsive grid hook ─────────────────────────────────────────────────
function useGridLayout() {
  const { width } = useWindowDimensions();
  const availableWidth = width - GRID_PADDING * 2;
  // Calculate how many columns fit with max card width
  // cols = floor((availableWidth + gap) / (maxCardWidth + gap))
  const cols = Math.max(2, Math.floor((availableWidth + GRID_GAP) / (MAX_CARD_WIDTH + GRID_GAP)));
  // Actual card width: distribute evenly
  const cardWidth = (availableWidth - GRID_GAP * (cols - 1)) / cols;
  const cardHeight = cardWidth / CARD_ASPECT; // 4:5 → taller than wide
  return { cols, cardWidth, cardHeight };
}

// ── Workout Mosaic Thumbnail ─────────────────────────────────────────────
/** Shows a mini-grid of movement GIF thumbnails inside a workout card */
function WorkoutMosaic({ thumbs, width, height }: { thumbs: string[]; width: number; height: number }) {
  if (!thumbs || thumbs.length === 0) return null;

  // Calculate mini-grid: aim for ~4-5 across
  const miniGap = 2;
  const miniCols = thumbs.length <= 2 ? thumbs.length : thumbs.length <= 4 ? 2 : Math.min(4, Math.ceil(Math.sqrt(thumbs.length)));
  const miniWidth = (width - miniGap * (miniCols - 1)) / miniCols;
  const miniHeight = miniWidth / CARD_ASPECT; // keep 4:5

  return (
    <View style={{
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: miniGap,
      padding: miniGap,
      width,
      height,
      overflow: 'hidden',
      backgroundColor: '#0E1117',
    }}>
      {thumbs.slice(0, 16).map((url, i) => (
        <Image
          key={i}
          source={{ uri: url }}
          style={{
            width: miniWidth,
            height: miniHeight,
            borderRadius: 3,
          }}
          resizeMode="cover"
        />
      ))}
    </View>
  );
}

function BuildScreenInner() {
  const { user, claims } = useAuth();
  const coachId = claims?.coachId ?? user?.uid ?? '';
  const { cols, cardWidth, cardHeight } = useGridLayout();
  
  // ── State ──────────────────────────────────────────────────────────────
  const [items, setItems] = useState<BuildItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState<BuildType | 'All'>('All');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isPlusOpen, setIsPlusOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showArchived, setShowArchived] = useState(false);
  
  // Folders
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);
  const [showFolderCreate, setShowFolderCreate] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Modals
  const [selectedMovement, setSelectedMovement] = useState<any | null>(null);
  const [editMovement, setEditMovement] = useState<any | null>(null);
  const [isMovementFormOpen, setIsMovementFormOpen] = useState(false);
  const [selectedWorkout, setSelectedWorkout] = useState<any | null>(null);
  const [editWorkout, setEditWorkout] = useState<any | null>(null);
  const [isWorkoutFormOpen, setIsWorkoutFormOpen] = useState(false);

  // Plans & Playbooks
  const [showPlanCreate, setShowPlanCreate] = useState(false);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanWeeks, setNewPlanWeeks] = useState('4');
  const [newPlanDesc, setNewPlanDesc] = useState('');
  const [showPlaybookCreate, setShowPlaybookCreate] = useState(false);
  const [newPlaybookName, setNewPlaybookName] = useState('');
  const [newPlaybookDesc, setNewPlaybookDesc] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<any | null>(null);
  const [selectedPlaybook, setSelectedPlaybook] = useState<any | null>(null);

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
          const otherItems = prev.filter(i => i.type !== 'Workouts' && i.type !== 'Folder');
          return [...otherItems, ...workoutItems].sort((a, b) => 
            (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
          );
        });
        workoutsLoaded = true;
        if (movementsLoaded && workoutsLoaded) setLoading(false);
        else setLoading(false);
      },
      (err) => {
        console.error('[Build] Workouts listener error:', err);
        workoutsLoaded = true;
        setLoading(false);
      },
    );

    // Folders listener
    const foldersQuery = query(
      collection(db, 'build_folders'),
      where('coachId', '==', coachId),
    );
    const unsubFolders = onSnapshot(
      foldersQuery,
      (snap) => {
        const folderItems: BuildItem[] = snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          type: 'Folder' as any,
          name: d.data().name || 'Untitled Folder',
          isArchived: false,
        } as BuildItem));
        setItems(prev => {
          const otherItems = prev.filter(i => i.type !== 'Folder');
          return [...otherItems, ...folderItems].sort((a, b) => 
            (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
          );
        });
      },
      (err) => console.error('[Build] Folders listener error:', err),
    );

    // Plans listener
    const plansQuery = query(collection(db, 'plans'), where('coachId', '==', coachId));
    const unsubPlans = onSnapshot(
      plansQuery,
      (snap) => {
        const planItems: BuildItem[] = snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          type: 'Plans' as BuildType,
          name: d.data().name || 'Untitled Plan',
        } as BuildItem));
        setItems(prev => {
          const otherItems = prev.filter(i => i.type !== 'Plans');
          return [...otherItems, ...planItems].sort((a, b) =>
            (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
          );
        });
      },
      (err) => console.error('[Build] Plans listener error:', err),
    );

    // Playbooks listener
    const playbooksQuery = query(collection(db, 'playbooks'), where('coachId', '==', coachId));
    const unsubPlaybooks = onSnapshot(
      playbooksQuery,
      (snap) => {
        const playbookItems: BuildItem[] = snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          type: 'Playbooks' as BuildType,
          name: d.data().name || 'Untitled Playbook',
        } as BuildItem));
        setItems(prev => {
          const otherItems = prev.filter(i => i.type !== 'Playbooks');
          return [...otherItems, ...playbookItems].sort((a, b) =>
            (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)
          );
        });
      },
      (err) => console.error('[Build] Playbooks listener error:', err),
    );

    return () => {
      unsubMovements();
      unsubWorkouts();
      unsubFolders();
      unsubPlans();
      unsubPlaybooks();
    };
  }, [coachId]);

  // ── Folder helpers ─────────────────────────────────────────────────────
  const enterFolder = useCallback((folder: BuildItem) => {
    setFolderStack(prev => [...prev, { id: folder.id, name: folder.name }]);
    setCurrentFolderId(folder.id);
  }, []);

  const goBackFolder = useCallback(() => {
    setFolderStack(prev => {
      const next = prev.slice(0, -1);
      setCurrentFolderId(next.length > 0 ? next[next.length - 1].id : null);
      return next;
    });
  }, []);

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    try {
      await addDoc(collection(db, 'build_folders'), {
        coachId,
        tenantId,
        name,
        parentId: currentFolderId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewFolderName('');
      setShowFolderCreate(false);
    } catch (e) {
      console.error('[Build] Create folder error:', e);
    }
  }, [coachId, tenantId, currentFolderId, newFolderName]);

  // ── Plan & Playbook creation ─────────────────────────────────────────
  const createPlan = useCallback(async () => {
    const name = newPlanName.trim();
    if (!name) return;
    try {
      await addDoc(collection(db, 'plans'), {
        coachId,
        tenantId,
        name,
        description: newPlanDesc.trim(),
        weeks: parseInt(newPlanWeeks) || 4,
        workoutIds: [],
        isArchived: false,
        parentId: currentFolderId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewPlanName(''); setNewPlanDesc(''); setNewPlanWeeks('4');
      setShowPlanCreate(false);
    } catch (e) { console.error('[Build] Create plan error:', e); }
  }, [coachId, tenantId, currentFolderId, newPlanName, newPlanDesc, newPlanWeeks]);

  const createPlaybook = useCallback(async () => {
    const name = newPlaybookName.trim();
    if (!name) return;
    try {
      await addDoc(collection(db, 'playbooks'), {
        coachId,
        tenantId,
        name,
        description: newPlaybookDesc.trim(),
        workoutIds: [],
        isArchived: false,
        parentId: currentFolderId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setNewPlaybookName(''); setNewPlaybookDesc('');
      setShowPlaybookCreate(false);
    } catch (e) { console.error('[Build] Create playbook error:', e); }
  }, [coachId, tenantId, currentFolderId, newPlaybookName, newPlaybookDesc]);

  // ── Filtering ──────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    let list = items;
    // Client-side archive filter
    list = list.filter(i => !!i.isArchived === showArchived);
    // Folder navigation: show items in current folder
    if (currentFolderId) {
      list = list.filter(i => i.parentId === currentFolderId || (i.type === 'Folder' && i.parentId === currentFolderId));
    } else if (!search.trim()) {
      // At root: show items without parentId + top-level folders
      list = list.filter(i => !i.parentId);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(i => i.name?.toLowerCase().includes(q));
    }
    if (activeType !== 'All') {
      list = list.filter(i => i.type === activeType || i.type === 'Folder');
    }
    // Sort: folders first, then by date
    list.sort((a, b) => {
      if (a.type === 'Folder' && b.type !== 'Folder') return -1;
      if (a.type !== 'Folder' && b.type === 'Folder') return 1;
      return (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0);
    });
    return list;
  }, [items, search, activeType, showArchived, currentFolderId]);

  // ── Render Helpers ─────────────────────────────────────────────────────
  const renderItem = ({ item }: { item: BuildItem }) => {
    // Folder card
    if (item.type === 'Folder') {
      if (viewMode === 'grid') {
        return (
          <Pressable
            style={{
              width: cardWidth,
              height: cardHeight,
              borderRadius: 10,
              overflow: 'hidden',
              backgroundColor: '#1A2332',
              marginBottom: GRID_GAP,
            }}
            onPress={() => enterFolder(item)}
          >
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <Icon name="folder" size={36} color="#F5A623" />
            </View>
            {/* Name overlay */}
            <View style={styles.nameOverlay}>
              <Text style={styles.nameText} numberOfLines={1}>{item.name}</Text>
            </View>
          </Pressable>
        );
      }
      return (
        <Pressable style={s.listItem} onPress={() => enterFolder(item)}>
          <View style={[s.listMedia, { backgroundColor: '#1A2332' }]}>
            <View style={s.listPlaceholder}>
              <Icon name="folder" size={20} color="#F5A623" />
            </View>
          </View>
          <View style={s.listContent}>
            <Text style={s.listName}>{item.name}</Text>
            <Text style={s.listSub}>Folder</Text>
          </View>
          <Icon name="chevron-right" size={20} color="#4A5568" />
        </Pressable>
      );
    }

    if (viewMode === 'grid') {
      const isMovement = item.type === 'Movements';
      const isPlan = item.type === 'Plans';
      const isPlaybook = item.type === 'Playbooks';
      const isWorkout = item.type === 'Workouts';
      const iconName = isPlan ? 'plan' : isPlaybook ? 'playbook' : isMovement ? 'movements' : 'workouts';
      const iconColor = isPlan ? '#60A5FA' : isPlaybook ? '#A78BFA' : '#4A5568';

      // Determine if this is a workout with multiple movement thumbnails
      const hasMosaic = isWorkout && item.coverThumbs && item.coverThumbs.length > 1;
      const hasSingleThumb = item.thumbnailUrl || item.mediaUrl || (item.coverThumbs && item.coverThumbs.length === 1);
      const singleThumbUri = item.thumbnailUrl || item.mediaUrl || (item.coverThumbs && item.coverThumbs.length > 0 ? item.coverThumbs[0] : null);

      return (
        <Pressable
          style={{
            width: cardWidth,
            height: cardHeight,
            borderRadius: 10,
            overflow: 'hidden',
            backgroundColor: '#0E1117',
            marginBottom: GRID_GAP,
          }}
          onPress={() => {
            if (isMovement) setSelectedMovement(item);
            else if (isPlan) setSelectedPlan(item);
            else if (isPlaybook) setSelectedPlaybook(item);
            else setSelectedWorkout(item);
          }}
        >
          {/* Media area — fills entire card */}
          {hasMosaic ? (
            <WorkoutMosaic
              thumbs={item.coverThumbs!}
              width={cardWidth}
              height={cardHeight}
            />
          ) : singleThumbUri ? (
            <Image
              source={{ uri: singleThumbUri }}
              style={{ width: cardWidth, height: cardHeight }}
              resizeMode="cover"
            />
          ) : (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <Icon name={iconName} size={32} color={iconColor} />
            </View>
          )}

          {/* Name overlay — transparent gradient at bottom */}
          <View style={styles.nameOverlay}>
            <Text style={styles.nameText} numberOfLines={1}>{item.name}</Text>
          </View>
        </Pressable>
      );
    }

    // List view
    return (
      <Pressable 
        style={s.listItem}
        onPress={() => {
          if (item.type === 'Movements') setSelectedMovement(item);
          else if (item.type === 'Plans') setSelectedPlan(item);
          else if (item.type === 'Playbooks') setSelectedPlaybook(item);
          else setSelectedWorkout(item);
        }}
      >
        <View style={s.listMedia}>
          {item.thumbnailUrl || item.mediaUrl ? (
            <Image source={{ uri: item.thumbnailUrl || item.mediaUrl }} style={s.listImage} />
          ) : (
            <View style={s.listPlaceholder}>
              <Icon name={item.type === 'Plans' ? 'plan' : item.type === 'Playbooks' ? 'playbook' : item.type === 'Movements' ? 'movements' : 'workouts'} size={20} color={item.type === 'Plans' ? '#60A5FA' : item.type === 'Playbooks' ? '#A78BFA' : '#4A5568'} />
            </View>
          )}
        </View>
        <View style={s.listContent}>
          <Text style={s.listName}>{item.name}</Text>
          <Text style={s.listSub}>{item.type.slice(0, -1)}</Text>
        </View>
        <Icon name="chevron-right" size={20} color="#4A5568" />
      </Pressable>
    );
  };

  return (
    <View style={s.root}>
      <AppHeader />

      {/* Folder breadcrumb */}
      {folderStack.length > 0 && (
        <View style={s.breadcrumb}>
          <Pressable onPress={() => { setCurrentFolderId(null); setFolderStack([]); }}>
            <Text style={s.breadcrumbText}>Build</Text>
          </Pressable>
          {folderStack.map((f, i) => (
            <React.Fragment key={f.id}>
              <Text style={s.breadcrumbSep}>/</Text>
              <Pressable onPress={() => {
                const next = folderStack.slice(0, i + 1);
                setFolderStack(next);
                setCurrentFolderId(f.id);
              }}>
                <Text style={[s.breadcrumbText, i === folderStack.length - 1 && { color: '#F5A623' }]}>
                  {f.name}
                </Text>
              </Pressable>
            </React.Fragment>
          ))}
          <Pressable onPress={goBackFolder} style={s.breadcrumbBack}>
            <Icon name="arrow-left" size={14} color="#8A95A3" />
            <Text style={s.breadcrumbBackText}>Back</Text>
          </Pressable>
        </View>
      )}

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
          numColumns={viewMode === 'grid' ? cols : 1}
          key={viewMode === 'grid' ? `grid-${cols}` : 'list'}
          contentContainerStyle={{
            paddingHorizontal: GRID_PADDING,
            paddingTop: GRID_PADDING,
            paddingBottom: 100,
          }}
          columnWrapperStyle={viewMode === 'grid' ? {
            gap: GRID_GAP,
            marginBottom: 0,
          } : undefined}
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
            <Pressable style={s.plusMenuItem} onPress={() => { setIsPlusOpen(false); setShowPlanCreate(true); }}>
              <Icon name="plan" size={20} color="#60A5FA" />
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
            <Pressable style={s.plusMenuItem} onPress={() => { setIsPlusOpen(false); setShowPlaybookCreate(true); }}>
              <Icon name="playbook" size={20} color="#A78BFA" />
              <Text style={s.plusMenuItemText}>Playbook</Text>
            </Pressable>
            <Pressable 
              style={s.plusMenuItem} 
              onPress={() => {
                setIsPlusOpen(false);
                setShowFolderCreate(true);
              }}
            >
              <Icon name="folder" size={20} color="#F5A623" />
              <Text style={s.plusMenuItemText}>Folder</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Folder Create Modal */}
      <Modal transparent visible={showFolderCreate} animationType="fade" onRequestClose={() => setShowFolderCreate(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setShowFolderCreate(false)}>
          <View style={s.plusMenu} onStartShouldSetResponder={() => true}>
            <Text style={s.plusMenuTitle}>New Folder</Text>
            <TextInput
              style={s.folderInput}
              placeholder="Folder name..."
              placeholderTextColor="#4A5568"
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
              onSubmitEditing={createFolder}
            />
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Pressable
                style={[s.folderBtn, { backgroundColor: '#1E2A3A' }]}
                onPress={() => { setShowFolderCreate(false); setNewFolderName(''); }}
              >
                <Text style={{ color: '#8A95A3', fontWeight: '600', fontFamily: FB }}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.folderBtn, { backgroundColor: '#F5A623', flex: 1 }]}
                onPress={createFolder}
              >
                <Text style={{ color: '#0E1117', fontWeight: '700', fontFamily: FH }}>Create</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Plan Create Modal */}
      <Modal transparent visible={showPlanCreate} animationType="fade" onRequestClose={() => setShowPlanCreate(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setShowPlanCreate(false)}>
          <View style={s.plusMenu} onStartShouldSetResponder={() => true}>
            <Text style={s.plusMenuTitle}>New Plan</Text>
            <TextInput
              style={s.folderInput}
              placeholder="Plan name..."
              placeholderTextColor="#4A5568"
              value={newPlanName}
              onChangeText={setNewPlanName}
              autoFocus
            />
            <TextInput
              style={[s.folderInput, { marginTop: 10 }]}
              placeholder="Description (optional)"
              placeholderTextColor="#4A5568"
              value={newPlanDesc}
              onChangeText={setNewPlanDesc}
              multiline
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 8 }}>
              <Text style={{ color: '#8A95A3', fontSize: 14, fontFamily: FB }}>Weeks:</Text>
              <TextInput
                style={[s.folderInput, { flex: 1 }]}
                placeholder="4"
                placeholderTextColor="#4A5568"
                value={newPlanWeeks}
                onChangeText={setNewPlanWeeks}
                keyboardType="numeric"
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Pressable
                style={[s.folderBtn, { backgroundColor: '#1E2A3A' }]}
                onPress={() => { setShowPlanCreate(false); setNewPlanName(''); setNewPlanDesc(''); setNewPlanWeeks('4'); }}
              >
                <Text style={{ color: '#8A95A3', fontWeight: '600', fontFamily: FB }}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.folderBtn, { backgroundColor: '#60A5FA', flex: 1 }]}
                onPress={createPlan}
              >
                <Text style={{ color: '#0E1117', fontWeight: '700', fontFamily: FH }}>Create Plan</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Playbook Create Modal */}
      <Modal transparent visible={showPlaybookCreate} animationType="fade" onRequestClose={() => setShowPlaybookCreate(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setShowPlaybookCreate(false)}>
          <View style={s.plusMenu} onStartShouldSetResponder={() => true}>
            <Text style={s.plusMenuTitle}>New Playbook</Text>
            <TextInput
              style={s.folderInput}
              placeholder="Playbook name..."
              placeholderTextColor="#4A5568"
              value={newPlaybookName}
              onChangeText={setNewPlaybookName}
              autoFocus
            />
            <TextInput
              style={[s.folderInput, { marginTop: 10 }]}
              placeholder="Description (optional)"
              placeholderTextColor="#4A5568"
              value={newPlaybookDesc}
              onChangeText={setNewPlaybookDesc}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Pressable
                style={[s.folderBtn, { backgroundColor: '#1E2A3A' }]}
                onPress={() => { setShowPlaybookCreate(false); setNewPlaybookName(''); setNewPlaybookDesc(''); }}
              >
                <Text style={{ color: '#8A95A3', fontWeight: '600', fontFamily: FB }}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[s.folderBtn, { backgroundColor: '#A78BFA', flex: 1 }]}
                onPress={createPlaybook}
              >
                <Text style={{ color: '#0E1117', fontWeight: '700', fontFamily: FH }}>Create Playbook</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Plan Detail Modal */}
      <Modal transparent visible={!!selectedPlan} animationType="slide" onRequestClose={() => setSelectedPlan(null)}>
        <View style={s.modalBackdrop}>
          <View style={[s.plusMenu, { maxHeight: '80%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={[s.plusMenuTitle, { marginBottom: 0, color: '#60A5FA' }]}>{selectedPlan?.name}</Text>
              <Pressable onPress={() => setSelectedPlan(null)}>
                <Icon name="close" size={22} color="#8A95A3" />
              </Pressable>
            </View>
            {selectedPlan?.description ? (
              <Text style={{ color: '#8A95A3', fontSize: 14, fontFamily: FB, marginBottom: 12 }}>{selectedPlan.description}</Text>
            ) : null}
            <View style={{ flexDirection: 'row', gap: 16, marginBottom: 16 }}>
              <View style={{ backgroundColor: '#1E2A3A', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Text style={{ color: '#60A5FA', fontSize: 20, fontWeight: '700', fontFamily: FH }}>{selectedPlan?.weeks || 4}</Text>
                <Text style={{ color: '#4A5568', fontSize: 11, fontFamily: FB }}>Weeks</Text>
              </View>
              <View style={{ backgroundColor: '#1E2A3A', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}>
                <Text style={{ color: '#F5A623', fontSize: 20, fontWeight: '700', fontFamily: FH }}>{selectedPlan?.workoutIds?.length || 0}</Text>
                <Text style={{ color: '#4A5568', fontSize: 11, fontFamily: FB }}>Workouts</Text>
              </View>
            </View>
            <Text style={{ color: '#4A5568', fontSize: 12, fontFamily: FB, textAlign: 'center', marginTop: 8 }}>
              Drag workouts here to build your plan schedule. Coming soon.
            </Text>
          </View>
        </View>
      </Modal>

      {/* Playbook Detail Modal */}
      <Modal transparent visible={!!selectedPlaybook} animationType="slide" onRequestClose={() => setSelectedPlaybook(null)}>
        <View style={s.modalBackdrop}>
          <View style={[s.plusMenu, { maxHeight: '80%' }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <Text style={[s.plusMenuTitle, { marginBottom: 0, color: '#A78BFA' }]}>{selectedPlaybook?.name}</Text>
              <Pressable onPress={() => setSelectedPlaybook(null)}>
                <Icon name="close" size={22} color="#8A95A3" />
              </Pressable>
            </View>
            {selectedPlaybook?.description ? (
              <Text style={{ color: '#8A95A3', fontSize: 14, fontFamily: FB, marginBottom: 12 }}>{selectedPlaybook.description}</Text>
            ) : null}
            <View style={{ backgroundColor: '#1E2A3A', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, alignSelf: 'flex-start', marginBottom: 16 }}>
              <Text style={{ color: '#A78BFA', fontSize: 20, fontWeight: '700', fontFamily: FH }}>{selectedPlaybook?.workoutIds?.length || 0}</Text>
              <Text style={{ color: '#4A5568', fontSize: 11, fontFamily: FB }}>Workouts</Text>
            </View>
            <Text style={{ color: '#4A5568', fontSize: 12, fontFamily: FB, textAlign: 'center', marginTop: 8 }}>
              Add workouts to this playbook to create a reusable template library. Coming soon.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Name overlay styles (shared across all card types) ───────────────────
const styles = StyleSheet.create({
  nameOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: 'rgba(14, 17, 23, 0.65)',
  },
  nameText: {
    color: '#F0F4F8',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold',
  },
});

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
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
    flexWrap: 'wrap',
    gap: 4,
  },
  breadcrumbText: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    fontWeight: '600',
  },
  breadcrumbSep: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FB,
    marginHorizontal: 2,
  },
  breadcrumbBack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  breadcrumbBackText: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    fontWeight: '600',
  },
  folderInput: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 14,
    color: '#F0F4F8',
    fontSize: 16,
    fontFamily: FB,
  },
  folderBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
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
