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
  writeBatch,
} from 'firebase/firestore';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import { AppHeader } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import MovementDetail from '../../components/MovementDetail';
import MovementForm from '../../components/MovementForm';
import WorkoutDetail from '../../components/WorkoutDetail';
import WorkoutForm from '../../components/WorkoutForm';
import WorkoutFolderPage from '../../components/WorkoutFolderPage';
import BulkMovementUpload from '../../components/BulkMovementUpload';
import FollowAlongVideoUploadSheet, { FollowAlongVideoPayload } from '../../components/FollowAlongVideoUploadSheet';
import FollowAlongVideoDetail from '../../components/FollowAlongVideoDetail';
import { usePreviewEngine } from '../../hooks/usePreviewEngine';
import { AnimatedPreviewTile, MosaicPreviewTile } from '../../components/AnimatedPreviewTile';
import {
  EQUIPMENT_FILTER_OPTIONS,
  MUSCLE_GROUP_FILTER_OPTIONS,
  DIFFICULTY_FILTER_OPTIONS,
} from '../../hooks/useMovementFilters';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, runOnJS } from 'react-native-reanimated';

// ── Constants ──────────────────────────────────────────────────────────────
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

type BuildType = 'Plans' | 'Movements' | 'Workouts' | 'Follow-Alongs' | 'Playbooks';
const TYPES: BuildType[] = ['Plans', 'Movements', 'Workouts', 'Follow-Alongs', 'Playbooks'];

// ── Grid layout constants ──────────────────────────────────────────────────
const GRID_PADDING = 16;       // padding on left/right of the grid
const GRID_GAP = 12;           // gap between cards
const MAX_CARD_WIDTH = 240;    // max card width in px — gives 4 cols on iPad, 2 on phone
const CARD_ASPECT = 4 / 5;     // 4:5 width:height ratio → height = width / (4/5) = width * 1.25

// ── Workout default constants (mirrors WorkoutFolderPage) ──────────────────
const DEFAULT_DURATION_SEC = 40;
const DEFAULT_REST_SEC = 20;
const DEFAULT_ROUNDS = 3;
const DEFAULT_DEMO_DURATION_SEC = 5;
const NO_MOVEMENT_BLOCKS = ['Water Break', 'Rest', 'Follow-Along Video'];

// Firestore rejects `undefined` values. Mirror the stripUndefined pattern
// from components/WorkoutFolderPage.tsx so writes from drag/drop never throw.
function stripUndefined(obj: any): any {
  if (Array.isArray(obj)) return obj.map(stripUndefined);
  if (obj && typeof obj === 'object' && !(obj instanceof Date)) {
    // Preserve Firestore FieldValue sentinels (serverTimestamp, etc.)
    if (obj._methodName || obj.type === 'AggregateField') return obj;
    const clean: any = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) clean[k] = stripUndefined(v);
    }
    return clean;
  }
  return obj;
}

// Compute coverThumbs from a workout's blocks — mirrors WorkoutFolderPage.
function computeCoverThumbs(blocks: any[]): string[] {
  const thumbs: string[] = [];
  for (const b of blocks ?? []) {
    for (const m of b?.movements ?? []) {
      if (m?.thumbnailUrl && thumbs.length < 16 && !thumbs.includes(m.thumbnailUrl)) {
        thumbs.push(m.thumbnailUrl);
      }
    }
  }
  return thumbs;
}

// Estimated workout duration in minutes — mirrors WorkoutFolderPage.calcDurationMin.
function calcDurationMin(blocks: any[]): number {
  let totalSec = 0;
  for (const block of blocks ?? []) {
    if (NO_MOVEMENT_BLOCKS.includes(block?.type)) {
      totalSec += block?.durationSec ?? 10;
      continue;
    }
    const rounds = block?.rounds ?? DEFAULT_ROUNDS;
    const prepSec = block?.firstMovementPrepSec ?? DEFAULT_REST_SEC;
    const demoSec = block?.showDemo ? (block?.demoDurationSec ?? DEFAULT_DEMO_DURATION_SEC) : 0;
    let blockSec = 0;
    for (const m of block?.movements ?? []) {
      const sets = m?.sets ?? 1;
      const durPerSet = m?.durationSec ?? DEFAULT_DURATION_SEC;
      const restPerSet = m?.restSec ?? DEFAULT_REST_SEC;
      blockSec += sets * (durPerSet + restPerSet);
    }
    const restBetween = block?.restBetweenRoundsSec ?? 0;
    totalSec += demoSec + rounds * (prepSec + blockSec) + (rounds > 1 ? (rounds - 1) * restBetween : 0);
  }
  return Math.ceil(totalSec / 60);
}

// Drop target eligibility: only Folders, Workouts, and Movements accept drops.
// Plans, Playbooks, and Follow-Alongs are pass-through tiles.
function isDropTarget(item: { type?: string } | null | undefined): boolean {
  if (!item) return false;
  return item.type === 'Folder' || item.type === 'Workouts' || item.type === 'Movements';
}

interface BuildItem {
  id: string;
  name: string;
  type: BuildType | 'Folder';
  category?: string;
  difficulty?: string;
  thumbnailUrl?: string;
  mediaUrl?: string;
  coverThumbs?: (string | { name: string })[];
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
  // Actual card width: distribute evenly, but never exceed MAX_CARD_WIDTH
  const rawCardWidth = (availableWidth - GRID_GAP * (cols - 1)) / cols;
  const cardWidth = Math.min(rawCardWidth, MAX_CARD_WIDTH);
  const cardHeight = cardWidth / CARD_ASPECT; // 4:5 → taller than wide
  return { cols, cardWidth, cardHeight };
}

// ── Workout Mosaic Thumbnail ─────────────────────────────────────────────
/** Shows a mini-library grid of movement GIF thumbnails inside a workout card.
 *  Designed to look like a small library you can glance at from the outside.
 *  Tight borders, distinct background, top-to-bottom left-to-right layout. */
const WORKOUT_CARD_BG = '#1A2332'; // Slightly lighter than page bg so cards stand out

function MosaicPlaceholderCell({ width, height, borderRadius, name }: { width: number; height: number; borderRadius: number; name?: string }) {
  // Friction-killer for coaches: when a movement has no video yet, show its
  // NAME big and bold in the mosaic cell instead of a generic logo, so the
  // workout's contents are readable straight from the Build page.
  const fontSize = Math.max(9, Math.min(22, Math.round(Math.min(width, height) * 0.18)));
  const lineHeight = Math.round(fontSize * 1.15);
  return (
    <View style={{ width, height, borderRadius, overflow: 'hidden', backgroundColor: '#0E1117', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 3 }}>
      <Text
        numberOfLines={4}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        style={{
          color: '#F0F4F8',
          fontSize,
          lineHeight,
          fontWeight: '700',
          textAlign: 'center',
          fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Bold',
        }}
      >
        {name || 'Movement'}
      </Text>
    </View>
  );
}

function WorkoutMosaic({ thumbs, width, height, isAnimating = false, scrollIdle = false }: { thumbs: (string | { name: string })[]; width: number; height: number; isAnimating?: boolean; scrollIdle?: boolean }) {
  const gap = 2; // tight gap between mini GIFs
  const inset = 6; // small padding inside the card
  const innerW = width - inset * 2;
  const innerH = height - inset * 2 - 28; // leave room for name overlay at bottom

  if (!thumbs || thumbs.length === 0) {
    // Empty workout — still show the distinct background with subtle icon
    return (
      <View style={{ width, height, backgroundColor: WORKOUT_CARD_BG, justifyContent: 'center', alignItems: 'center' }}>
        <Icon name="workouts" size={28} color="#2D3B4E" />
      </View>
    );
  }

  // Single movement — show it centered and larger (like a hero thumbnail)
  if (thumbs.length === 1) {
    const singleW = innerW * 0.6;
    const singleH = singleW * (5 / 4); // 4:5 aspect ratio
    const clampedH = Math.min(singleH, innerH * 0.75);
    const clampedW = clampedH * (4 / 5);
    return (
      <View style={{ width, height, backgroundColor: WORKOUT_CARD_BG, justifyContent: 'center', alignItems: 'center' }}>
        {typeof thumbs[0] === 'string' ? (
          <MosaicPreviewTile
            uri={thumbs[0]}
            width={clampedW}
            height={clampedH}
            parentIsAnimating={isAnimating}
            scrollIdle={scrollIdle}
            index={0}
            borderRadius={6}
          />
        ) : (
          <MosaicPlaceholderCell width={clampedW} height={clampedH} borderRadius={6} name={thumbs[0]?.name} />
        )}
      </View>
    );
  }

  // Multiple movements — dynamic grid: 2x2 → 3x3 → 4x4 (max 16)
  const maxShow = Math.min(thumbs.length, 16);
  const cols = maxShow <= 4 ? 2 : maxShow <= 9 ? 3 : 4;
  const rows = Math.ceil(maxShow / cols);
  const cellW = (innerW - gap * (cols - 1)) / cols;
  // 4:5 aspect ratio for each thumbnail (height = width * 5/4)
  const cellH = cellW * (5 / 4);
  // Clamp cell height so rows don't overflow the available inner height
  const maxCellH = (innerH - gap * (rows - 1)) / rows;
  const finalCellH = Math.min(cellH, maxCellH);
  const finalCellW = Math.min(cellW, finalCellH * (4 / 5)); // maintain 4:5 if clamped

  return (
    <View style={{ width, height, backgroundColor: WORKOUT_CARD_BG }}>
      <View style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap,
        padding: inset,
        paddingTop: inset + 2,
        width,
        overflow: 'hidden',
      }}>
        {thumbs.slice(0, maxShow).map((slot, i) => (
          typeof slot === 'string' ? (
            <MosaicPreviewTile
              key={i}
              uri={slot}
              width={finalCellW}
              height={finalCellH}
              parentIsAnimating={isAnimating}
              scrollIdle={scrollIdle}
              index={i}
              borderRadius={3}
            />
          ) : (
            <MosaicPlaceholderCell key={i} width={finalCellW} height={finalCellH} borderRadius={3} name={slot?.name} />
          )
        ))}
      </View>
    </View>
  );
}

function BuildScreenInner() {
  const { user, claims } = useAuth();
  const coachId = claims?.coachId ?? user?.uid ?? '';
  const { cols, cardWidth, cardHeight } = useGridLayout();

  // ── Preview Engine (scroll-aware animation scheduling) ─────────────────
  const previewEngine = usePreviewEngine();

  // ── State ──────────────────────────────────────────────────────────────
  const [items, setItems] = useState<BuildItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [activeType, setActiveType] = useState<BuildType | 'All'>('All');
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isPlusOpen, setIsPlusOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showArchived, setShowArchived] = useState(false);
  const [movEquipmentFilter, setMovEquipmentFilter] = useState('All');
  const [movMuscleGroupFilter, setMovMuscleGroupFilter] = useState('All');
  const [movDifficultyFilter, setMovDifficultyFilter] = useState('All');

  // Folders
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);
  const [showFolderCreate, setShowFolderCreate] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Modals
  const [selectedMovement, setSelectedMovement] = useState<any | null>(null);
  const [editMovement, setEditMovement] = useState<any | null>(null);
  const [isMovementFormOpen, setIsMovementFormOpen] = useState(false);
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [isFollowAlongOpen, setIsFollowAlongOpen] = useState(false);
  const [selectedFollowAlong, setSelectedFollowAlong] = useState<any | null>(null);
  const [selectedWorkout, setSelectedWorkout] = useState<any | null>(null);
  const [editWorkout, setEditWorkout] = useState<any | null>(null);
  const [isWorkoutFormOpen, setIsWorkoutFormOpen] = useState(false);

  // Workout folder page — replaces the old modal flow
  const [openWorkoutId, setOpenWorkoutId] = useState<string | null>(null);

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

  // ── Drag & Drop state ──────────────────────────────────────────────────
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const ghostScale = useSharedValue(1);
  const ghostOpacity = useSharedValue(0);
  const rootOffX = useSharedValue(0);
  const rootOffY = useSharedValue(0);
  const [dragItem, setDragItem] = useState<BuildItem | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dropModal, setDropModal] = useState<{ drag: BuildItem; target: BuildItem } | null>(null);
  const tileRefsMap = useRef(new Map<string, React.RefObject<View | null>>());
  const tileLayoutSnap = useRef(new Map<string, { x: number; y: number; w: number; h: number; item: BuildItem }>());
  const _dragItemRef = useRef<BuildItem | null>(null);
  const rootViewRef = useRef<View>(null);

  const ghostAnimStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: ghostX.value,
    top: ghostY.value,
    transform: [{ scale: ghostScale.value }],
    opacity: ghostOpacity.value,
    zIndex: 9999,
    pointerEvents: 'none' as const,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
    elevation: 12,
  }));

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
            (b.updatedAt?.seconds ?? b.createdAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? a.createdAt?.seconds ?? 0)
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
        const workoutItems: BuildItem[] = snap.docs.map(d => {
          const data = d.data();
          // Build coverThumbs from blocks if not already set
          let coverThumbs = data.coverThumbs ?? [];
          if ((!coverThumbs || coverThumbs.length === 0) && data.blocks && Array.isArray(data.blocks)) {
            const thumbs: string[] = [];
            for (const block of data.blocks) {
              if (block.movements && Array.isArray(block.movements)) {
                for (const mov of block.movements) {
                  const url = mov.thumbnailUrl || mov.gifUrl || null;
                  if (url && !thumbs.includes(url)) thumbs.push(url);
                }
              }
            }
            if (thumbs.length > 0) coverThumbs = thumbs;
          }
          return {
            id: d.id,
            ...data,
            coverThumbs,
            type: 'Workouts'
          } as BuildItem;
        });
        
        setItems(prev => {
          const otherItems = prev.filter(i => i.type !== 'Workouts' && i.type !== 'Folder');
          return [...otherItems, ...workoutItems].sort((a, b) => 
            (b.updatedAt?.seconds ?? b.createdAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? a.createdAt?.seconds ?? 0)
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
            (b.updatedAt?.seconds ?? b.createdAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? a.createdAt?.seconds ?? 0)
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
            (b.updatedAt?.seconds ?? b.createdAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? a.createdAt?.seconds ?? 0)
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
            (b.updatedAt?.seconds ?? b.createdAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? a.createdAt?.seconds ?? 0)
          );
        });
      },
      (err) => console.error('[Build] Playbooks listener error:', err),
    );

    // Follow-Along Videos listener (asset collection — like movements)
    const followAlongsQuery = query(
      collection(db, 'followAlongVideos'),
      where('coachId', '==', coachId),
    );
    const unsubFollowAlongs = onSnapshot(
      followAlongsQuery,
      (snap) => {
        const followAlongItems: BuildItem[] = snap.docs.map(d => ({
          id: d.id,
          ...d.data(),
          type: 'Follow-Alongs' as BuildType,
          name: d.data().name || 'Untitled Follow-Along',
        } as BuildItem));
        setItems(prev => {
          const otherItems = prev.filter(i => i.type !== 'Follow-Alongs');
          return [...otherItems, ...followAlongItems].sort((a, b) =>
            (b.updatedAt?.seconds ?? b.createdAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? a.createdAt?.seconds ?? 0)
          );
        });
      },
      (err) => console.error('[Build] Follow-Alongs listener error:', err),
    );

    return () => {
      unsubMovements();
      unsubWorkouts();
      unsubFolders();
      unsubPlans();
      unsubPlaybooks();
      unsubFollowAlongs();
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

  // ── Drag & Drop handlers (filteredItems-independent) ──────────────────
  const findTarget = useCallback((ax: number, ay: number): BuildItem | null => {
    let found: BuildItem | null = null;
    tileLayoutSnap.current.forEach(({ x, y, w, h, item: candidate }) => {
      // Only consider tiles that are actual drop targets. Plans / Playbooks /
      // Follow-Alongs are ignored so their tiles never highlight or accept a drop.
      if (!isDropTarget(candidate)) return;
      if (ax >= x && ax <= x + w && ay >= y && ay <= y + h) found = candidate;
    });
    return found;
  }, []);

  const updateHovered = useCallback((ax: number, ay: number) => {
    const target = findTarget(ax, ay);
    const nextId = target?.id ?? null;
    setHoveredId(prev => (prev === nextId ? prev : nextId));
  }, [findTarget]);

  const executeDrop = useCallback(async (ax: number, ay: number) => {
    const dragged = _dragItemRef.current;
    if (!dragged) return;
    const target = findTarget(ax, ay);
    if (!target || target.id === dragged.id) return;
    if (!isDropTarget(target)) return;

    if (target.type === 'Folder') {
      try {
        await updateDoc(doc(db, 'movements', dragged.id), stripUndefined({
          parentId: target.id,
          updatedAt: serverTimestamp(),
        }));
      } catch (e) { console.error('[Build] Drop into folder error:', e); }
    } else if (target.type === 'Workouts') {
      // Build the block movement with the same shape addMovementToBlock uses
      // in WorkoutFolderPage — including posterUrl and split-sided fields —
      // so a dropped movement plays back identically to a picker-added one.
      const blockMov: any = {
        movementId: dragged.id,
        movementName: dragged.name,
        durationSec: DEFAULT_DURATION_SEC,
        restSec: DEFAULT_REST_SEC,
        sets: 1,
        thumbnailUrl: dragged.thumbnailUrl ?? dragged.mediaUrl ?? undefined,
        posterUrl: dragged.posterUrl ?? dragged.thumbnailImageUrl ?? undefined,
      };
      if (dragged.swapSides) {
        blockMov.swapSides = true;
        blockMov.swapMode = dragged.swapMode ?? 'split';
        blockMov.swapWindowSec = dragged.swapWindowSec ?? 5;
      }
      const existingBlocks: any[] = Array.isArray(target.blocks) ? target.blocks : [];
      const updatedBlocks = existingBlocks.length > 0
        ? existingBlocks.map((b: any, i: number) =>
            i === 0 ? { ...b, movements: [...(b.movements ?? []), blockMov] } : b
          )
        : [{
            type: 'circuit',
            label: 'Block 1',
            rounds: DEFAULT_ROUNDS,
            firstMovementPrepSec: DEFAULT_REST_SEC,
            showDemo: false,
            demoDurationSec: DEFAULT_DEMO_DURATION_SEC,
            showGrabEquipment: false,
            movements: [blockMov],
          }];
      try {
        await updateDoc(doc(db, 'workouts', target.id), stripUndefined({
          blocks: updatedBlocks,
          coverThumbs: computeCoverThumbs(updatedBlocks),
          estimatedDurationMin: calcDurationMin(updatedBlocks),
          updatedAt: serverTimestamp(),
        }));
      } catch (e) { console.error('[Build] Drop into workout error:', e); }
    } else if (target.type === 'Movements') {
      setDropModal({ drag: dragged, target });
    }
  }, [findTarget]);

  const clearDragState = useCallback(() => {
    _dragItemRef.current = null;
    setDragItem(null);
    setHoveredId(null);
    tileLayoutSnap.current.clear();
  }, []);

  const createFolderFromDrop = useCallback(async () => {
    if (!dropModal) return;
    const { drag, target } = dropModal;
    setDropModal(null);
    try {
      // Atomic: folder create + both movement moves commit together, or
      // nothing does. Avoids the previous half-committed state where the
      // folder existed but only one movement had been reparented.
      const batch = writeBatch(db);
      const folderRef = doc(collection(db, 'build_folders'));
      batch.set(folderRef, stripUndefined({
        coachId,
        tenantId,
        name: `${drag.name} & ${target.name}`,
        parentId: currentFolderId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
      batch.update(doc(db, 'movements', drag.id), stripUndefined({
        parentId: folderRef.id,
        updatedAt: serverTimestamp(),
      }));
      batch.update(doc(db, 'movements', target.id), stripUndefined({
        parentId: folderRef.id,
        updatedAt: serverTimestamp(),
      }));
      await batch.commit();
    } catch (e) { console.error('[Build] Create folder from drop error:', e); }
  }, [dropModal, coachId, tenantId, currentFolderId]);

  const createWorkoutFromDrop = useCallback(async () => {
    if (!dropModal) return;
    const { drag, target } = dropModal;
    setDropModal(null);
    // Mirror addMovementToBlock in WorkoutFolderPage: posterUrl + split-sided
    // fields carry through so a workout created via drag-drop behaves the
    // same as one built with the picker.
    const toBlockMov = (m: BuildItem) => {
      const next: any = {
        movementId: m.id,
        movementName: m.name,
        durationSec: DEFAULT_DURATION_SEC,
        restSec: DEFAULT_REST_SEC,
        sets: 1,
        thumbnailUrl: m.thumbnailUrl ?? m.mediaUrl ?? undefined,
        posterUrl: m.posterUrl ?? m.thumbnailImageUrl ?? undefined,
      };
      if (m.swapSides) {
        next.swapSides = true;
        next.swapMode = m.swapMode ?? 'split';
        next.swapWindowSec = m.swapWindowSec ?? 5;
      }
      return next;
    };
    try {
      const blocks = [{
        type: 'circuit',
        label: 'Block 1',
        rounds: DEFAULT_ROUNDS,
        firstMovementPrepSec: DEFAULT_REST_SEC,
        showDemo: false,
        demoDurationSec: DEFAULT_DEMO_DURATION_SEC,
        showGrabEquipment: false,
        movements: [toBlockMov(drag), toBlockMov(target)],
      }];
      await addDoc(collection(db, 'workouts'), stripUndefined({
        coachId,
        tenantId,
        name: `${drag.name} & ${target.name}`,
        blocks,
        coverThumbs: computeCoverThumbs(blocks),
        estimatedDurationMin: calcDurationMin(blocks),
        isArchived: false,
        parentId: currentFolderId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
    } catch (e) { console.error('[Build] Create workout from drop error:', e); }
  }, [dropModal, coachId, tenantId, currentFolderId]);

  // ── Enrich workout coverThumbs from loaded movements ──────────────────
  // Movements in workout blocks may only store movementId without thumbnailUrl.
  // After both collections load, cross-reference to build coverThumbs.
  // Phase 4: lightweight list passed to MovementForm so its duplicate-name
  // check can match against already-loaded movements without a Firestore
  // round-trip. Excludes archived so the warning aligns with the visible
  // library.
  const existingMovementNames = useMemo(
    () =>
      items
        .filter((i: any) => i.type === 'Movements' && !i.isArchived)
        .map((i: any) => ({ id: i.id, name: i.name || '' })),
    [items],
  );

  const enrichedItems = useMemo(() => {
    const movementMap = new Map<string, string>();
    const movementNameMap = new Map<string, string>();
    for (const item of items) {
      if (item.type === 'Movements') {
        if (item.thumbnailUrl || item.mediaUrl) {
          movementMap.set(item.id, (item.thumbnailUrl || item.mediaUrl) as string);
        }
        if (item.name) movementNameMap.set(item.id, item.name as string);
      }
    }

    return items.map(item => {
      if (item.type !== 'Workouts') return item;
      if (!item.blocks || !Array.isArray(item.blocks)) return item;
      // Build a per-movement slot list: real URL for videoed, { name } for placeholder.
      // Dedupe URLs (don't repeat the same thumb), but keep every placeholder slot
      // so coaches can read the movement names of anything still needing video.
      const slots: (string | { name: string })[] = [];
      const seenUrls = new Set<string>();
      for (const block of item.blocks) {
        if (block.movements && Array.isArray(block.movements)) {
          for (const mov of block.movements) {
            const movId = mov.movementId || mov.id || null;
            const url = mov.thumbnailUrl || mov.gifUrl || (movId ? movementMap.get(movId) : null);
            if (url) {
              if (!seenUrls.has(url)) {
                seenUrls.add(url);
                slots.push(url);
              }
            } else {
              const name = mov.movementName || (movId ? movementNameMap.get(movId) : null) || mov.name || 'Movement';
              slots.push({ name });
            }
          }
        }
      }
      if (slots.length > 0) return { ...item, coverThumbs: slots };
      return item;
    });
  }, [items]);

  // ── Filtering ──────────────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    let list = enrichedItems;
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
    // Movement-specific filters (equipment / muscle group / difficulty)
    if (activeType === 'Movements') {
      if (movEquipmentFilter !== 'All') {
        list = list.filter(i => i.equipment === movEquipmentFilter);
      }
      if (movMuscleGroupFilter !== 'All') {
        list = list.filter(i =>
          (i.muscleGroups as string[] | undefined || []).some(
            (mg: string) => mg.toLowerCase() === movMuscleGroupFilter.toLowerCase(),
          ),
        );
      }
      if (movDifficultyFilter !== 'All') {
        list = list.filter(i =>
          (i.difficulty || '').toLowerCase() === movDifficultyFilter.toLowerCase(),
        );
      }
    }
    // Sort: folders first, then by date
    list.sort((a, b) => {
      if (a.type === 'Folder' && b.type !== 'Folder') return -1;
      if (a.type !== 'Folder' && b.type === 'Folder') return 1;
      return (b.updatedAt?.seconds ?? b.createdAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? a.createdAt?.seconds ?? 0);
    });
    return list;
  }, [enrichedItems, search, activeType, showArchived, currentFolderId, movEquipmentFilter, movMuscleGroupFilter, movDifficultyFilter]);

  // ── Drag & Drop handlers (require filteredItems) ───────────────────────
  const snapshotLayouts = useCallback(() => {
    const snap = tileLayoutSnap.current;
    snap.clear();
    tileRefsMap.current.forEach((ref, id) => {
      const candidate = filteredItems.find(i => i.id === id);
      if (!candidate) return;
      ref.current?.measure((_fx, _fy, width, height, px, py) => {
        snap.set(id, { x: px, y: py, w: width, h: height, item: candidate });
      });
    });
  }, [filteredItems]);

  const _startDragById = useCallback((id: string) => {
    const item = filteredItems.find(i => i.id === id) ?? null;
    _dragItemRef.current = item;
    setDragItem(item);
  }, [filteredItems]);

  // ── Render Helpers ─────────────────────────────────────────────────────
  const renderItem = ({ item }: { item: BuildItem }) => {
    // Folder card
    if (item.type === 'Folder') {
      // Register folder tiles with engine for budget tracking
      previewEngine.registerTile(item.id, 2);
      const folderAnimating = previewEngine.animatingIds.has(item.id);
      if (viewMode === 'grid') {
        // Register tile ref so folders participate in drop-target hit-testing.
        if (!tileRefsMap.current.has(item.id)) {
          tileRefsMap.current.set(item.id, React.createRef<View>());
        }
        const folderTileRef = tileRefsMap.current.get(item.id)!;
        return (
          <View
            ref={folderTileRef as any}
            style={{
              width: cardWidth,
              height: cardHeight,
              marginBottom: GRID_GAP,
            }}
          >
            <Pressable
              style={[StyleSheet.absoluteFill, {
                borderRadius: 10,
                overflow: 'hidden',
                backgroundColor: '#1A2332',
              }]}
              onPress={() => enterFolder(item)}
            >
              {item.coverThumbs && item.coverThumbs.length > 0 ? (
                <WorkoutMosaic
                  thumbs={item.coverThumbs}
                  width={cardWidth}
                  height={cardHeight}
                  isAnimating={folderAnimating}
                  scrollIdle={previewEngine.scrollState !== 'scrolling'}
                />
              ) : (
                <AnimatedPreviewTile
                  itemId={item.id}
                  uri={null}
                  width={cardWidth}
                  height={cardHeight}
                  isAnimating={false}
                  scrollIdle={previewEngine.scrollState !== 'scrolling'}
                  priority={2}
                  registerTile={previewEngine.registerTile}
                  borderRadius={10}
                  fallbackIcon={<Icon name="folder" size={36} color="#F5A623" />}
                />
              )}
              {/* Name overlay */}
              <View style={styles.nameOverlay}>
                <Text style={styles.nameText} numberOfLines={1}>{item.name}</Text>
              </View>
              {hoveredId === item.id && dragItem && dragItem.id !== item.id && (
                <View style={[StyleSheet.absoluteFill, { borderWidth: 2, borderColor: '#F5A623', borderRadius: 10 }]} pointerEvents="none" />
              )}
            </Pressable>
          </View>
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
      const isFollowAlong = item.type === 'Follow-Alongs';
      const iconName = isPlan ? 'plan' : isPlaybook ? 'playbook' : isMovement ? 'movements' : isFollowAlong ? 'video' : 'workouts';
      const iconColor = isPlan ? '#60A5FA' : isPlaybook ? '#A78BFA' : isFollowAlong ? '#22D3EE' : '#4A5568';

      // Prefer thumbnailUrl (GIF), then first-frame image, then low-quality GIF, then mediaUrl
      const singleThumbUri = item.thumbnailUrl || item.thumbnailImageUrl || item.gifLowUrl || item.mediaUrl || null;

      // Workout and playbook cards use the mosaic (mini-library) layout when they have coverThumbs
      const isWorkoutCard = isWorkout;
      const hasMosaic = (isWorkoutCard || isPlaybook) && (item.coverThumbs ?? []).length > 0;

      // Preview engine: register tile and check if promoted
      const tilePriority = isMovement ? 1 as const : 2 as const;
      previewEngine.registerTile(item.id, tilePriority);
      const tileAnimating = previewEngine.animatingIds.has(item.id);

      // Shared tile content (media + overlays)
      const tileMedia = (
        <>
          {(isWorkoutCard || hasMosaic) ? (
            <WorkoutMosaic
              thumbs={item.coverThumbs ?? []}
              width={cardWidth}
              height={cardHeight}
              isAnimating={tileAnimating}
              scrollIdle={previewEngine.scrollState !== 'scrolling'}
            />
          ) : singleThumbUri ? (
            <AnimatedPreviewTile
              itemId={item.id}
              uri={singleThumbUri}
              width={cardWidth}
              height={cardHeight}
              isAnimating={tileAnimating}
              scrollIdle={previewEngine.scrollState !== 'scrolling'}
              priority={tilePriority}
              registerTile={previewEngine.registerTile}
              borderRadius={10}
            />
          ) : (
            <AnimatedPreviewTile
              itemId={item.id}
              uri={null}
              width={cardWidth}
              height={cardHeight}
              isAnimating={false}
              scrollIdle={previewEngine.scrollState !== 'scrolling'}
              priority={tilePriority}
              registerTile={previewEngine.registerTile}
              borderRadius={10}
              fallbackIcon={isMovement ? (
                <Image
                  source={require('../../assets/goarrive-icon.png')}
                  style={styles.placeholderLogo}
                  resizeMode="cover"
                />
              ) : (
                <Icon name={iconName} size={32} color={iconColor} />
              )}
            />
          )}
          {/* Name overlay — transparent gradient at bottom */}
          <View style={[styles.nameOverlay, isWorkoutCard && { backgroundColor: 'rgba(26, 35, 50, 0.92)' }]}>
            <Text style={styles.nameText} numberOfLines={1}>{item.name}</Text>
          </View>
          {isMovement && !item.videoUrl && (
            <View style={styles.videoNeededPill}>
              <Text style={styles.videoNeededText}>Video needed</Text>
            </View>
          )}
          {/* Drop target highlight ring — only for drop-eligible tiles
              (Movements, Workouts, Folders). Plans / Playbooks / Follow-Alongs
              are not drop targets, so no hover ring appears on them. */}
          {hoveredId === item.id && dragItem && dragItem.id !== item.id && isDropTarget(item) && (
            <View
              style={[StyleSheet.absoluteFill, { borderWidth: 2, borderColor: '#F5A623', borderRadius: 10 }]}
              pointerEvents="none"
            />
          )}
        </>
      );

      // Movement tiles: wrap in GestureDetector for long-press drag
      if (isMovement) {
        if (!tileRefsMap.current.has(item.id)) {
          tileRefsMap.current.set(item.id, React.createRef<View>());
        }
        const tileRef = tileRefsMap.current.get(item.id)!;

        const dragGesture = Gesture.Pan()
          .activateAfterLongPress(600)
          .onStart((e) => {
            ghostX.value = e.absoluteX - cardWidth / 2 - rootOffX.value;
            ghostY.value = e.absoluteY - cardHeight / 2 - rootOffY.value;
            ghostScale.value = withSpring(1.08, { damping: 15, stiffness: 200 });
            ghostOpacity.value = withSpring(1);
            runOnJS(snapshotLayouts)();
            runOnJS(_startDragById)(item.id);
          })
          .onUpdate((e) => {
            ghostX.value = e.absoluteX - cardWidth / 2 - rootOffX.value;
            ghostY.value = e.absoluteY - cardHeight / 2 - rootOffY.value;
            runOnJS(updateHovered)(e.absoluteX, e.absoluteY);
          })
          .onEnd((e) => {
            runOnJS(executeDrop)(e.absoluteX, e.absoluteY);
          })
          .onFinalize(() => {
            ghostScale.value = withSpring(1, { damping: 20 });
            ghostOpacity.value = withSpring(0);
            runOnJS(clearDragState)();
          });

        return (
          <GestureDetector gesture={dragGesture}>
            <View
              ref={tileRef as any}
              style={{
                width: cardWidth,
                height: cardHeight,
                marginBottom: GRID_GAP,
                opacity: dragItem?.id === item.id ? 0.35 : 1,
              }}
            >
              <Pressable
                style={[StyleSheet.absoluteFill, {
                  borderRadius: 10,
                  overflow: 'hidden',
                  backgroundColor: '#0E1117',
                }]}
                onPress={() => setSelectedMovement(item)}
              >
                {tileMedia}
              </Pressable>
            </View>
          </GestureDetector>
        );
      }

      // Non-movement tiles: workout tiles register refs so they participate in
      // drop-target hit-testing. Plans / Playbooks / Follow-Alongs still render
      // as Pressables but findTarget skips them (see isDropTarget).
      const needsDropRef = isDropTarget(item);
      if (needsDropRef && !tileRefsMap.current.has(item.id)) {
        tileRefsMap.current.set(item.id, React.createRef<View>());
      }
      const nonMovTileRef = needsDropRef ? tileRefsMap.current.get(item.id) : null;
      return (
        <View
          ref={nonMovTileRef as any}
          style={{
            width: cardWidth,
            height: cardHeight,
            marginBottom: GRID_GAP,
          }}
        >
          <Pressable
            style={[StyleSheet.absoluteFill, {
              borderRadius: 10,
              overflow: 'hidden',
              backgroundColor: (isWorkoutCard || hasMosaic) ? WORKOUT_CARD_BG : '#0E1117',
            }]}
            onPress={() => {
              if (isPlan) setSelectedPlan(item);
              else if (isPlaybook) setSelectedPlaybook(item);
              else if (isFollowAlong) setSelectedFollowAlong(item);
              else setOpenWorkoutId(item.id);
            }}
          >
            {tileMedia}
          </Pressable>
        </View>
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
          else if (item.type === 'Follow-Alongs') setSelectedFollowAlong(item);
          else setOpenWorkoutId(item.id);
        }}
      >
        <View style={s.listMedia}>
          {(item.thumbnailUrl || item.thumbnailImageUrl || item.gifLowUrl || item.mediaUrl) ? (
            <Image
              source={{ uri: previewEngine.scrollState !== 'scrolling' ? (item.thumbnailUrl || item.thumbnailImageUrl || item.gifLowUrl || item.mediaUrl) : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' }}
              style={[s.listImage, { backgroundColor: '#151B28' }]}
            />
          ) : item.type === 'Movements' ? (
            <View style={[s.listPlaceholder, { backgroundColor: '#0E1117' }]}>
              <Image
                source={require('../../assets/goarrive-icon.png')}
                style={styles.placeholderLogo}
                resizeMode="cover"
              />
            </View>
          ) : (
            <View style={s.listPlaceholder}>
              <Icon name={item.type === 'Plans' ? 'plan' : item.type === 'Playbooks' ? 'playbook' : item.type === 'Follow-Alongs' ? 'video' : 'workouts'} size={20} color={item.type === 'Plans' ? '#60A5FA' : item.type === 'Playbooks' ? '#A78BFA' : item.type === 'Follow-Alongs' ? '#22D3EE' : '#4A5568'} />
            </View>
          )}
        </View>
        <View style={s.listContent}>
          <Text style={s.listName}>{item.name}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={s.listSub}>{item.type.slice(0, -1)}</Text>
            {item.type === 'Movements' && !item.videoUrl && (
              <View style={{ paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4, backgroundColor: '#2A3340' }}>
                <Text style={styles.videoNeededText}>Video needed</Text>
              </View>
            )}
          </View>
        </View>
        <Icon name="chevron-right" size={20} color="#4A5568" />
      </Pressable>
    );
  };

  // ── Workout folder page ─────────────────────────────────────────────────
  if (openWorkoutId) {
    return (
      <View style={s.root}>
        <AppHeader />
        <WorkoutFolderPage
          workoutId={openWorkoutId}
          coachId={coachId}
          tenantId={tenantId}
          onBack={() => setOpenWorkoutId(null)}
          onOpenMovement={(m: any) => setSelectedMovement(m)}
          onDuplicated={(newId: string) => setOpenWorkoutId(newId)}
        />
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
          backLabel="Back to Workout"
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
          existingMovements={existingMovementNames}
        />
      </View>
    );
  }

  return (
    <View
      ref={rootViewRef}
      style={s.root}
      onLayout={() => {
        rootViewRef.current?.measure((_fx, _fy, _w, _h, px, py) => {
          rootOffX.value = px;
          rootOffY.value = py;
        });
      }}
    >
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.filterRow}
            contentContainerStyle={s.filterRowContent}
          >
            {['All', ...TYPES].map((type) => (
              <Pressable
                key={type}
                style={[s.filterChip, activeType === type && s.filterChipActive]}
                onPress={() => {
                  setActiveType(type as any);
                  if (type !== 'Movements') {
                    setMovEquipmentFilter('All');
                    setMovMuscleGroupFilter('All');
                    setMovDifficultyFilter('All');
                  }
                }}
              >
                <Text style={[s.filterChipText, activeType === type && s.filterChipTextActive]}>
                  {type}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {activeType === 'Movements' && (
            <>
              <Text style={s.filterTitle}>Equipment</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={s.filterRowContent}>
                {EQUIPMENT_FILTER_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt}
                    style={[s.filterChip, movEquipmentFilter === opt && s.filterChipActive]}
                    onPress={() => setMovEquipmentFilter(opt)}
                  >
                    <Text style={[s.filterChipText, movEquipmentFilter === opt && s.filterChipTextActive]}>{opt}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={s.filterTitle}>Muscle Group</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={s.filterRowContent}>
                {MUSCLE_GROUP_FILTER_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt}
                    style={[s.filterChip, movMuscleGroupFilter === opt && s.filterChipActive]}
                    onPress={() => setMovMuscleGroupFilter(opt)}
                  >
                    <Text style={[s.filterChipText, movMuscleGroupFilter === opt && s.filterChipTextActive]}>{opt}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              <Text style={s.filterTitle}>Difficulty</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterRow} contentContainerStyle={s.filterRowContent}>
                {DIFFICULTY_FILTER_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt}
                    style={[s.filterChip, movDifficultyFilter === opt && s.filterChipActive]}
                    onPress={() => setMovDifficultyFilter(opt)}
                  >
                    <Text style={[s.filterChipText, movDifficultyFilter === opt && s.filterChipTextActive]}>{opt}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          )}

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

      {/* Debug overlay removed — was temporary scroll/animation state banner */}

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
          extraData={previewEngine.animatingIds}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={() => setLoading(true)} tintColor="#F5A623" />
          }
          onScroll={previewEngine.onScroll}
          scrollEventThrottle={16}
          onViewableItemsChanged={previewEngine.onViewableItemsChanged}
          viewabilityConfig={previewEngine.viewabilityConfig}
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
        backLabel={openWorkoutId ? 'Back to Workout' : undefined}
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
        existingMovements={existingMovementNames}
      />

      <BulkMovementUpload
        visible={isBulkUploadOpen}
        onClose={() => setIsBulkUploadOpen(false)}
        coachId={coachId}
        tenantId={tenantId}
      />

      <FollowAlongVideoUploadSheet
        visible={isFollowAlongOpen}
        coachId={coachId}
        tenantId={tenantId}
        onClose={() => setIsFollowAlongOpen(false)}
        onUploaded={(_payload: FollowAlongVideoPayload) => {
          // Sheet writes the followAlongVideos asset doc itself.
          // Stay on Build library — the asset appears via the listener.
          setIsFollowAlongOpen(false);
        }}
      />

      <FollowAlongVideoDetail
        visible={!!selectedFollowAlong}
        followAlong={selectedFollowAlong}
        onClose={() => setSelectedFollowAlong(null)}
        onArchive={async (m) => {
          try {
            await updateDoc(doc(db, 'followAlongVideos', m.id), { isArchived: !m.isArchived });
            setSelectedFollowAlong(null);
          } catch (e) { console.error('Archive follow-along error:', e); }
        }}
      />

      {/* WorkoutDetail and WorkoutForm modals removed — replaced by WorkoutFolderPage */}

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
                setIsBulkUploadOpen(true);
              }}
            >
              <Icon name="movements" size={20} color="#22C55E" />
              <Text style={s.plusMenuItemText}>Bulk Upload Movements</Text>
            </Pressable>
            <Pressable 
              style={s.plusMenuItem} 
              onPress={async () => {
                setIsPlusOpen(false);
                try {
                  // Create an empty workout in Firestore and navigate into it
                  const newWorkoutRef = await addDoc(collection(db, 'workouts'), {
                     name: 'Untitled Workout',
                     description: '',
                     coachId,
                     tenantId,
                     blocks: [
                       {
                         type: 'Circuit',
                         label: 'Circuit',
                         rounds: 3,
                         restBetweenRoundsSec: 0,
                         restBetweenMovementsSec: 0,
                         firstMovementPrepSec: 20,
                         showDemo: false,
                         demoDurationSec: 20,
                         movements: [],
                       },
                     ],
                     coverThumbs: [],
                     introVideoUrl: null,
                     introGifUrl: null,
                     outroVideoUrl: null,
                     outroGifUrl: null,
                     isArchived: false,
                     isTemplate: false,
                     createdAt: serverTimestamp(),
                     updatedAt: serverTimestamp(),
                   });
                  setOpenWorkoutId(newWorkoutRef.id);
                } catch (e) {
                  console.error('Create workout error:', e);
                }
              }}
            >
              <Icon name="workouts" size={20} color="#F0F4F8" />
              <Text style={s.plusMenuItemText}>Workout</Text>
            </Pressable>
            <Pressable
              style={s.plusMenuItem}
              onPress={() => {
                setIsPlusOpen(false);
                setIsFollowAlongOpen(true);
              }}
            >
              <Icon name="video" size={20} color="#22D3EE" />
              <Text style={s.plusMenuItemText}>Follow-Along Video</Text>
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

      {/* Drop action modal: Movement dropped on another Movement */}
      <Modal transparent visible={!!dropModal} animationType="fade" onRequestClose={() => setDropModal(null)}>
        <Pressable style={s.modalBackdrop} onPress={() => setDropModal(null)}>
          <View style={s.plusMenu} onStartShouldSetResponder={() => true}>
            <Text style={s.plusMenuTitle}>Combine Movements</Text>
            <Text style={{ color: '#8A95A3', fontSize: 13, fontFamily: FB, marginBottom: 20, textAlign: 'center' }}>
              {dropModal?.drag.name} + {dropModal?.target.name}
            </Text>
            <Pressable
              style={[s.plusMenuItem, { backgroundColor: '#1E2A3A', borderRadius: 10, paddingVertical: 14, marginBottom: 10 }]}
              onPress={createFolderFromDrop}
            >
              <Icon name="folder" size={22} color="#F5A623" />
              <Text style={[s.plusMenuItemText, { fontSize: 15 }]}>Create Folder</Text>
            </Pressable>
            <Pressable
              style={[s.plusMenuItem, { backgroundColor: '#1E2A3A', borderRadius: 10, paddingVertical: 14 }]}
              onPress={createWorkoutFromDrop}
            >
              <Icon name="workouts" size={22} color="#60A5FA" />
              <Text style={[s.plusMenuItemText, { fontSize: 15 }]}>Create Workout</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Drag ghost tile — floats above everything during drag */}
      <Reanimated.View style={[ghostAnimStyle, { width: cardWidth, height: cardHeight, borderRadius: 10 }]} pointerEvents="none">
        {dragItem && (
          <View style={{ flex: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: '#0E1117' }}>
            {(dragItem.thumbnailUrl || dragItem.mediaUrl) ? (
              <Image
                source={{ uri: (dragItem.thumbnailUrl || dragItem.mediaUrl)! }}
                style={{ width: cardWidth, height: cardHeight, borderRadius: 10 }}
                resizeMode="cover"
              />
            ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Image source={require('../../assets/goarrive-icon.png')} style={styles.placeholderLogo} resizeMode="cover" />
              </View>
            )}
            <View style={styles.nameOverlay}>
              <Text style={styles.nameText} numberOfLines={1}>{dragItem.name}</Text>
            </View>
          </View>
        )}
      </Reanimated.View>
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
  videoNeededPill: {
    position: 'absolute',
    top: 6,
    right: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#2A3340',
  },
  videoNeededText: {
    fontSize: 8,
    color: '#8A95A3',
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-SemiBold',
  },
  placeholderLogo: {
    width: '100%',
    height: '100%',
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
    flexGrow: 0,
    flexShrink: 0,
    marginBottom: 16,
  },
  filterRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#1E2A3A',
    borderRadius: 20,
    alignSelf: 'flex-start',
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
