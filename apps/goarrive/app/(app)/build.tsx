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
  Share,
  Alert,
  type LayoutChangeEvent,
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
  arrayUnion,
  arrayRemove,
  getDocs,
  getDoc,
  deleteDoc,
  limit,
} from 'firebase/firestore';
import { useNavigation, router } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { ModuleGate } from '../../lib/useCoachModules';
import { db, functions } from '../../lib/firebase';
import { httpsCallable } from 'firebase/functions';
import { TAB_BAR_STYLE, CONTENT_BOTTOM_CLEARANCE } from '../../lib/tabBarStyle';
import { AppHeader } from '../../components/AppHeader';
import { Icon } from '../../components/Icon';
import MovementDetail from '../../components/MovementDetail';
import MovementForm from '../../components/MovementForm';
import MovementVariationModal from '../../components/MovementVariationModal';
import WorkoutDetail from '../../components/WorkoutDetail';
import WorkoutForm from '../../components/WorkoutForm';
import WorkoutFolderPage from '../../components/WorkoutFolderPage';
import BulkMovementUpload from '../../components/BulkMovementUpload';
import FollowAlongVideoUploadSheet, { FollowAlongVideoPayload } from '../../components/FollowAlongVideoUploadSheet';
import FollowAlongVideoDetail from '../../components/FollowAlongVideoDetail';
import PlaybookSchedulePanel from '../../components/PlaybookSchedulePanel';
import QuickAddMember from '../../components/QuickAddMember';
import { usePreviewEngine } from '../../hooks/usePreviewEngine';
import { AnimatedPreviewTile, MosaicPreviewTile } from '../../components/AnimatedPreviewTile';
import { WorkoutMosaic, MosaicPlaceholderCell, WORKOUT_CARD_BG } from '../../components/WorkoutMosaic';
import {
  EQUIPMENT_FILTER_OPTIONS,
  MUSCLE_GROUP_FILTER_OPTIONS,
  DIFFICULTY_FILTER_OPTIONS,
  rankByPrimaryMuscle,
} from '../../hooks/useMovementFilters';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import Reanimated, { useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ── Constants ──────────────────────────────────────────────────────────────
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

type BuildType = 'Plans' | 'Movements' | 'Workouts' | 'Follow-Alongs' | 'Playbooks';
const TYPES: BuildType[] = ['Plans', 'Movements', 'Workouts', 'Follow-Alongs', 'Playbooks'];

// Firestore collection backing each asset type — used by drag-and-drop
// reparenting so any asset can be dropped into a folder.
const COLLECTION_BY_TYPE: Record<BuildType, string> = {
  Plans: 'plans',
  Movements: 'movements',
  Workouts: 'workouts',
  'Follow-Alongs': 'followAlongVideos',
  Playbooks: 'playbooks',
};

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

// ── Drag auto-scroll + drop tray constants ─────────────────────────────────
const AUTO_SCROLL_MAX_PX = 15;       // max px scrolled per frame at edge proximity
const AUTO_SCROLL_BAND_PCT = 0.18;  // edge band = 18% of the list height (at top/bottom where scroll fires)
const AUTO_SCROLL_HOTSPOT_W = 96;   // right-column width that triggers page down-scroll (rest of bottom = tray targets)
const TRAY_SHOW_DELAY_MS = 200;      // delay before tray slides up — avoids flashing on accidental long presses
const TRAY_HEIGHT = 148;             // content height of the drop tray (excl. safe-area inset). Sized for 80×100 (4:5) mosaic + name + chrome.
const TRAY_SLIDE_DISTANCE = 220;     // translateY when hidden — guaranteed offscreen incl. inset
const TRAY_MAX_RECENTS = 8;          // wider recents list — user can horizontally scroll to reach later entries
const TRAY_NEW_FOLDER_KEY = 'tray:new';
const TRAY_NEW_PLAYBOOK_KEY = 'tray:new-playbook';
const TRAY_ARCHIVE_KEY = 'tray:archive';
const TRAY_CANCEL_KEY = 'tray:cancel';
// Horizontal-scroll edge band inside the tray. Drag pointer inside the tray
// zone but within this many px of the left/right edge triggers a horizontal
// scroll of the tray items so hidden targets slide into view.
const TRAY_HSCROLL_BAND = 64;
const TRAY_HSCROLL_MAX_PX = 14;
// Colors: folders = orange, playbooks = purple. Applied to tray chip borders,
// icons, and hover glow so the coach can tell them apart at a glance.
const FOLDER_ACCENT = '#F5A623';
const PLAYBOOK_ACCENT = '#A78BFA';

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

// Mirror addMovementToBlock in WorkoutFolderPage: posterUrl + split-sided
// fields carry through so drag/drop-created workouts play back identically
// to picker-built ones.
function toBlockMov(m: any) {
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
      let workPerSet = durPerSet;
      if (m?.swapSides) {
        const perSide = m?.swapMode === 'split' ? Math.max(1, Math.round(durPerSet / 2)) : durPerSet;
        const win = typeof m?.swapWindowSec === 'number' && m.swapWindowSec >= 0 && m.swapWindowSec <= 15 ? m.swapWindowSec : 5;
        workPerSet = perSide * 2 + win;
      }
      blockSec += sets * (workPerSet + restPerSet);
    }
    const restBetween = block?.restBetweenRoundsSec ?? 0;
    totalSec += demoSec + rounds * (prepSec + blockSec) + (rounds > 1 ? (rounds - 1) * restBetween : 0);
  }
  return Math.ceil(totalSec / 60);
}

// Drop target eligibility. Folders accept every asset type. A Movement
// dropped on a Workout appends to it. Playbooks are workouts-only — they
// reject movements, folders, plans, and other playbooks. Any other
// asset-on-asset drop opens the combine modal (create a folder containing both).
// A dragged folder can only land on another folder (nest); combine/append
// semantics don't apply to folder sources.
function isDropTarget(
  item: { type?: string } | null | undefined,
  dragged: { type?: string } | null | undefined,
): boolean {
  if (!item || !dragged) return false;
  if (dragged.type === 'Folder') return item.type === 'Folder';
  if (item.type === 'Playbooks') return dragged.type === 'Workouts';
  return true;
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
  folderPreview?: { id: string; name: string; thumbs: (string | { name: string })[] }[];
  sortSeconds?: number;
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
    <ModuleGate module="build">
      <BuildErrorBoundary>
        <BuildScreenInner />
      </BuildErrorBoundary>
    </ModuleGate>
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

// ── Folder Mosaic ────────────────────────────────────────────────────────
/** Folder card preview — a miniature of the folder's contents. Each cell is a
 *  tiny workout card rendered with STILL photos (posterUrl, never GIFs), so
 *  the folder reads as a shrunken version of the view you get by tapping in. */
type FolderPreviewEntry = {
  id: string;
  name: string;
  thumbs: (string | { name: string })[];
  // Playbook-inside-folder: mosaic-inside-mosaic. Each inner array is one
  // workout's stills (≤4). Per-workout titles are dropped at this size.
  playbookWorkouts?: (string | { name: string })[][];
};

function FolderMiniCard({ entry, width, height, scrollIdle }: { entry: FolderPreviewEntry; width: number; height: number; scrollIdle: boolean }) {
  const nameH = Math.max(12, Math.round(height * 0.16));
  const mediaH = height - nameH;
  const gap = 1;
  const inset = 2;
  const innerW = width - inset * 2;
  const innerH = mediaH - inset * 2;
  // Mirror WorkoutMosaic's dynamic grid exactly (2x2 → 3x3 → 4x4, max 16) so
  // the mini card reads as a zoomed-out version of the full workout icon.
  const thumbs = entry.thumbs.slice(0, 16);
  const cols = thumbs.length <= 1 ? 1 : thumbs.length <= 4 ? 2 : thumbs.length <= 9 ? 3 : 4;
  const rows = Math.ceil(Math.max(thumbs.length, 1) / cols);
  const cellW = (innerW - gap * (cols - 1)) / cols;
  const maxCellH = (innerH - gap * (rows - 1)) / rows;
  const cellH = Math.max(1, Math.min(cellW * (5 / 4), maxCellH));
  const finalCellW = Math.max(1, Math.min(cellW, cellH * (4 / 5)));
  // Playbook mini-card: up to 4 workout cells (2x2), each cell its own 2x2 of
  // ≤4 movement stills — mosaic inside mosaic. Playbook name label only.
  if (entry.playbookWorkouts && entry.playbookWorkouts.length > 0) {
    const wks = entry.playbookWorkouts.slice(0, 4);
    const wCols = wks.length <= 1 ? 1 : 2;
    const wRows = Math.ceil(wks.length / wCols);
    const wCellW = (innerW - gap * (wCols - 1)) / wCols;
    const wCellH = (innerH - gap * (wRows - 1)) / wRows;
    return (
      <View style={{ width, height, borderRadius: 5, overflow: 'hidden', backgroundColor: '#141024', borderWidth: StyleSheet.hairlineWidth, borderColor: '#4C3D8F' }}>
        <View style={{ width, height: mediaH, padding: inset, gap, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'center', overflow: 'hidden' }}>
          {wks.map((wThumbs, wi) => {
            const t = wThumbs.slice(0, 4);
            const tCols = t.length <= 1 ? 1 : 2;
            const tRows = Math.ceil(Math.max(t.length, 1) / tCols);
            const tGap = 1;
            const tW = (wCellW - 2 - tGap * (tCols - 1)) / tCols;
            const tH = (wCellH - 2 - tGap * (tRows - 1)) / tRows;
            return (
              <View key={wi} style={{ width: wCellW, height: wCellH, borderRadius: 3, overflow: 'hidden', backgroundColor: '#10151F', padding: 1, gap: tGap, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'center' }}>
                {t.length === 0 ? (
                  <Icon name="workouts" size={8} color="#2D3B4E" />
                ) : (
                  t.map((slot, i) =>
                    typeof slot === 'string' ? (
                      <MosaicPreviewTile key={i} uri={slot} width={Math.max(1, tW)} height={Math.max(1, tH)} parentIsAnimating={false} scrollIdle={scrollIdle} index={i} borderRadius={1} />
                    ) : (
                      <MosaicPlaceholderCell key={i} width={Math.max(1, tW)} height={Math.max(1, tH)} borderRadius={1} name={undefined} />
                    ),
                  )
                )}
              </View>
            );
          })}
        </View>
        <View style={{ height: nameH, justifyContent: 'center', paddingHorizontal: 3 }}>
          <Text numberOfLines={1} style={{ color: '#C4B5FD', fontSize: Math.max(7, Math.round(nameH * 0.58)), fontWeight: '600', fontFamily: FB }}>
            {entry.name}
          </Text>
        </View>
      </View>
    );
  }
  return (
    <View style={{ width, height, borderRadius: 5, overflow: 'hidden', backgroundColor: '#10151F' }}>
      <View style={{ width, height: mediaH, padding: inset, gap, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignContent: 'center', overflow: 'hidden' }}>
        {thumbs.length === 0 ? (
          <Icon name="workouts" size={14} color="#2D3B4E" />
        ) : (
          thumbs.map((slot, i) =>
            typeof slot === 'string' ? (
              <MosaicPreviewTile
                key={i}
                uri={slot}
                width={finalCellW}
                height={cellH}
                parentIsAnimating={false}
                scrollIdle={scrollIdle}
                index={i}
                borderRadius={2}
              />
            ) : (
              <MosaicPlaceholderCell key={i} width={finalCellW} height={cellH} borderRadius={2} name={slot?.name} />
            ),
          )
        )}
      </View>
      <View style={{ height: nameH, justifyContent: 'center', paddingHorizontal: 3 }}>
        <Text numberOfLines={1} style={{ color: '#B8C4D2', fontSize: Math.max(7, Math.round(nameH * 0.58)), fontWeight: '600', fontFamily: FB }}>
          {entry.name}
        </Text>
      </View>
    </View>
  );
}

function FolderMosaic({ previews, width, height, scrollIdle }: { previews: FolderPreviewEntry[]; width: number; height: number; scrollIdle: boolean }) {
  const gap = 4;
  const inset = 6;
  const innerW = width - inset * 2;
  const innerH = height - inset * 2 - 28; // leave room for name overlay at bottom
  const maxShow = Math.min(previews.length, 9);
  const cols = maxShow <= 1 ? 1 : maxShow <= 4 ? 2 : 3;
  const rows = Math.ceil(maxShow / cols);
  const cellW = (innerW - gap * (cols - 1)) / cols;
  const maxCellH = (innerH - gap * (rows - 1)) / rows;
  const cellH = Math.max(1, Math.min(cellW / CARD_ASPECT, maxCellH));
  const finalCellW = Math.max(1, Math.min(cellW, cellH * CARD_ASPECT));
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
        justifyContent: maxShow === 1 ? 'center' : 'flex-start',
      }}>
        {previews.slice(0, maxShow).map(p => (
          <FolderMiniCard key={p.id} entry={p} width={finalCellW} height={cellH} scrollIdle={scrollIdle} />
        ))}
      </View>
    </View>
  );
}

// Chip inside the bottom drop tray. Grows slightly when the drag pointer is
// over it so the drop target is unmistakable, and picks up an accent border.
function TrayChip({
  accent,
  hovered,
  onLayout,
  children,
}: {
  accent: string;
  hovered: boolean;
  onLayout: (e: LayoutChangeEvent) => void;
  children: React.ReactNode;
}) {
  const scale = useSharedValue(1);
  const lift = useSharedValue(0);
  useEffect(() => {
    scale.value = withSpring(hovered ? 1.16 : 1, { damping: 14, stiffness: 220 });
    lift.value = withSpring(hovered ? -4 : 0, { damping: 14, stiffness: 220 });
  }, [hovered, scale, lift]);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }, { scale: scale.value }],
  }));
  return (
    <Reanimated.View
      onLayout={onLayout}
      collapsable={false}
      style={[
        {
          width: 88,
          height: TRAY_HEIGHT - 24,
          backgroundColor: '#0E1117',
          borderRadius: 12,
          borderWidth: hovered ? 2 : 1,
          borderColor: hovered ? accent : '#1E2A3A',
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: 4,
        },
        animStyle,
        hovered && {
          shadowColor: accent,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.6,
          shadowRadius: 8,
          elevation: 8,
        },
      ]}
    >
      {children}
    </Reanimated.View>
  );
}

// Renders the tray chip body for existing folders / playbooks: the same
// FolderMosaic used in the main grid, sized to 4:5 (still images only —
// no GIFs/videos, since FolderMiniCard uses thumbs). Name label sits below.
// Falls back to an icon when the folder is empty.
const TRAY_MOSAIC_W = 80;
const TRAY_MOSAIC_H = TRAY_MOSAIC_W * (5 / 4); // 100px — matches 4:5 grid tiles
function TrayChipContents({ item, accent, isPlaybook }: { item: BuildItem; accent: string; isPlaybook: boolean }) {
  const previews = Array.isArray(item.folderPreview) ? item.folderPreview : [];
  const hasPreview = previews.length > 0;
  return (
    <View style={{ flex: 1, width: '100%', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
      <View style={{ width: TRAY_MOSAIC_W, height: TRAY_MOSAIC_H, borderRadius: 6, overflow: 'hidden', backgroundColor: '#0B0E14', borderWidth: 1, borderColor: accent + '55' }}>
        {hasPreview ? (
          <FolderMosaic previews={previews} width={TRAY_MOSAIC_W} height={TRAY_MOSAIC_H} scrollIdle={true} />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={isPlaybook ? 'playbook' : 'folder'} size={20} color={accent} />
          </View>
        )}
      </View>
      <Text style={{ color: '#F0F4F8', fontSize: 10, fontWeight: '700', textAlign: 'center' }} numberOfLines={1}>
        {item.name}
      </Text>
    </View>
  );
}

// Minimal thumbnail grid for a tray chip: 2×2 first-four thumbs (or 1 if only
// one). Uses inline Image tags rather than reusing FolderMosaic because that
// component targets full-size tiles with ~28px chrome, which doesn't fit an
// 80×44 chip preview.
function TrayChipMosaic({ previews, width, height }: { previews: any[]; width: number; height: number }) {
  const flatThumbs: string[] = [];
  for (const p of previews) {
    if (!p) continue;
    if (Array.isArray(p.thumbs)) {
      for (const t of p.thumbs) {
        if (typeof t === 'string' && flatThumbs.length < 4) flatThumbs.push(t);
      }
    }
    if (Array.isArray(p.playbookWorkouts)) {
      for (const w of p.playbookWorkouts) {
        if (Array.isArray(w)) for (const t of w) {
          if (typeof t === 'string' && flatThumbs.length < 4) flatThumbs.push(t);
        }
      }
    }
    if (flatThumbs.length >= 4) break;
  }
  if (flatThumbs.length === 0) return null;
  const cols = flatThumbs.length === 1 ? 1 : 2;
  const rows = flatThumbs.length <= 2 ? 1 : 2;
  const cellW = width / cols;
  const cellH = height / rows;
  return (
    <View style={{ width, height, flexDirection: 'row', flexWrap: 'wrap' }}>
      {flatThumbs.map((uri, i) => (
        <Image key={i} source={{ uri }} style={{ width: cellW, height: cellH }} resizeMode="cover" />
      ))}
    </View>
  );
}

function BuildScreenInner() {
  const { user, claims, effectiveUid } = useAuth();
  const coachId = effectiveUid || claims?.coachId || user?.uid || '';
  const { cols, cardWidth, cardHeight } = useGridLayout();

  // ── Preview Engine (scroll-aware animation scheduling) ─────────────────
  const previewEngine = usePreviewEngine();

  // ── State ──────────────────────────────────────────────────────────────
  const [items, setItems] = useState<BuildItem[]>([]);
  // Live items for drag callbacks (created once) — e.g. playbook reorder needs
  // the current workoutIds without re-creating executeDrop on every snapshot.
  const itemsRef = useRef<BuildItem[]>([]);
  itemsRef.current = items;
  const [variationBadges, setVariationBadges] = useState<Record<string, 'running' | 'ready'>>({});
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
  const [editingFolderTitle, setEditingFolderTitle] = useState(false);
  const [folderTitleDraft, setFolderTitleDraft] = useState('');
  // Refs so drag callbacks (created once) can see the live folder state
  const folderStackRef = useRef<{ id: string; name: string }[]>([]);
  folderStackRef.current = folderStack;
  const folderHeaderRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const folderHeaderRef = useRef<View>(null);

  // Playbook drill-in — same grid/header experience as folders, but membership
  // and order come from the playbook's workoutIds array (never parentId, since
  // one workout can live in many playbooks and order matters for rotation).
  const [currentPlaybook, setCurrentPlaybook] = useState<{ id: string; name: string } | null>(null);
  const [showPlaybookSchedule, setShowPlaybookSchedule] = useState(false);
  const [editingPlaybookTitle, setEditingPlaybookTitle] = useState(false);
  const [playbookTitleDraft, setPlaybookTitleDraft] = useState('');
  const [showPbMenu, setShowPbMenu] = useState(false);
  const [showPbDeleteConfirm, setShowPbDeleteConfirm] = useState(false);
  const [showPbDescEdit, setShowPbDescEdit] = useState(false);
  const [pbDescDraft, setPbDescDraft] = useState('');
  const [showPbMoveTo, setShowPbMoveTo] = useState(false);
  const [showPbManageMembers, setShowPbManageMembers] = useState(false);
  const [showPbRevokeConfirm, setShowPbRevokeConfirm] = useState(false);
  const [pbRevokeBusy, setPbRevokeBusy] = useState(false);
  const currentPlaybookRef = useRef<{ id: string; name: string } | null>(null);
  currentPlaybookRef.current = currentPlaybook;
  // A1: plus-button chooser sheets inside the playbook drill-in
  const [pbAddWorkoutOpen, setPbAddWorkoutOpen] = useState(false);
  const [pbAddMemberOpen, setPbAddMemberOpen] = useState(false);
  const [pbQuickAddOpen, setPbQuickAddOpen] = useState(false);

  // Modals
  const [selectedMovement, setSelectedMovement] = useState<any | null>(null);
  const [editMovement, setEditMovement] = useState<any | null>(null);
  const [isMovementFormOpen, setIsMovementFormOpen] = useState(false);
  // AI variation: source movement the coach is building a variation from
  const [variationSource, setVariationSource] = useState<any | null>(null);
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
  // Workout-on-workout combine → Create Playbook seeds both IDs here, then
  // the create modal collects title + member assignment before writing.
  const [playbookSeedWorkoutIds, setPlaybookSeedWorkoutIds] = useState<string[]>([]);
  const [pbMembers, setPbMembers] = useState<{ id: string; name: string; email: string }[]>([]);
  const [pbAssignMemberId, setPbAssignMemberId] = useState<string | null>(null);
  const [pbAddByEmail, setPbAddByEmail] = useState(false);
  const [pbNewMemberName, setPbNewMemberName] = useState('');
  const [pbNewMemberEmail, setPbNewMemberEmail] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<any | null>(null);

  const tenantId = claims?.tenantId ?? '';

  // ── Drag & Drop state ──────────────────────────────────────────────────
  const ghostX = useSharedValue(0);
  const ghostY = useSharedValue(0);
  const ghostScale = useSharedValue(1);
  const ghostOpacity = useSharedValue(0);
  const rootOffX = useSharedValue(0);
  const rootOffY = useSharedValue(0);
  // Tracks whether the drag pointer is currently over the tray zone. Held as a
  // ref (not state) so updateHovered doesn't cause a render every frame — we
  // only care about it to gate ghostScale/opacity spring transitions.
  const ghostOverTrayRef = useRef(false);
  const [dragItem, setDragItem] = useState<BuildItem | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoveredIdRef = useRef<string | null>(null);
  const [dropModal, setDropModal] = useState<{ drag: BuildItem; target: BuildItem } | null>(null);
  const tileRefsMap = useRef(new Map<string, React.RefObject<View | null>>());
  const tileLayoutSnap = useRef(new Map<string, { x: number; y: number; w: number; h: number; item: BuildItem }>());
  const _dragItemRef = useRef<BuildItem | null>(null);
  // Web: after a drag release, the browser synthesizes a click on the drag
  // source, which fires the tile's Pressable onPress (workouts then navigate
  // away via setOpenWorkoutId, making the drop look broken). Suppress presses
  // briefly after any real drag ends.
  const suppressPressUntilRef = useRef(0);
  const rootViewRef = useRef<View>(null);

  // ── Drag scroll tracking + edge auto-scroll ────────────────────────────
  const listRef = useRef<FlatList<BuildItem>>(null);
  const listContainerRef = useRef<View>(null);
  const scrollOffsetRef = useRef(0);            // live FlatList contentOffset.y
  const offsetAtSnapshotRef = useRef(0);        // offset when tile layouts were snapshotted
  const listWindowRef = useRef<{ top: number; height: number } | null>(null);
  const pointerYRef = useRef(0);
  const pointerXRef = useRef(0);
  const autoScrollRafRef = useRef<number | null>(null);
  const scrollLockCleanupRef = useRef<(() => void) | null>(null);

  // ── Bottom drop tray ───────────────────────────────────────────────────
  const insets = useSafeAreaInsets();
  const [trayVisible, setTrayVisible] = useState(false);
  const [trayMounted, setTrayMounted] = useState(false);
  const [dropToast, setDropToast] = useState<string | null>(null);
  const dropToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trayVisibleRef = useRef(false);
  // Measured absolute top of the tray row. iOS Safari's visual viewport can be
  // shorter than Dimensions.get('window').height (toolbar collapse), which
  // made the math-derived band miss and drops silently no-op. Prefer the
  // measured value; the math stays as fallback until layout resolves.
  const trayRowTopRef = useRef<number | null>(null);
  const trayRowRef = useRef<View>(null);
  const trayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trayTranslate = useSharedValue(TRAY_SLIDE_DISTANCE);
  // Horizontal ScrollView wrapping tray items so the drag can pan through more
  // recents than fit in one row.
  const trayScrollRef = useRef<ScrollView | null>(null);
  const trayScrollOffsetRef = useRef(0);
  const trayContentWidthRef = useRef(0);
  const trayViewportWidthRef = useRef(0);
  // Tray drop rects come from onLayout (relative to trayRow) + math for the
  // absolute position — NOT from async measure() calls, which raced the
  // tray's slide-up animation and left the snapshot empty on fast drops.
  const trayItemLayoutsRef = useRef(new Map<string, { x: number; y: number; w: number; h: number; item: BuildItem | null }>());
  const [recentDropFolderIds, setRecentDropFolderIds] = useState<string[]>([]);
  const [pendingFolderDropItem, setPendingFolderDropItem] = useState<BuildItem | null>(null);
  // Workout dropped on the tray "New Playbook" target — seeds the new playbook.
  const [pendingPlaybookDropItem, setPendingPlaybookDropItem] = useState<BuildItem | null>(null);
  // Movement dropped on the tray "New" target — chooser asks Folder vs Workout.
  const [trayDropChooserItem, setTrayDropChooserItem] = useState<BuildItem | null>(null);
  // Archive drop: confirmation modal + pending item.
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [pendingArchiveItem, setPendingArchiveItem] = useState<BuildItem | null>(null);
  // Cancel chip: fixed position (outside scroll), separate rect ref.
  const cancelChipRef = useRef<View>(null);
  const cancelChipAbsRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const navigation = useNavigation();

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
    // Clear stale items when the effective coach changes (e.g. admin View as Coach),
    // so a denied/failed listener can never leave another coach's library on screen.
    setItems([]);
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
          ...d.data({ serverTimestamps: 'estimate' }),
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
          const data = d.data({ serverTimestamps: 'estimate' });
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
          // Only replace workouts — folders live in their own listener; filtering
          // them out here wiped every folder whenever a workout doc changed.
          const otherItems = prev.filter(i => i.type !== 'Workouts');
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
          ...d.data({ serverTimestamps: 'estimate' }),
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
          ...d.data({ serverTimestamps: 'estimate' }),
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
          ...d.data({ serverTimestamps: 'estimate' }),
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
          ...d.data({ serverTimestamps: 'estimate' }),
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

  // ── AI remix job badges ────────────────────────────────────────────────
  // Background poller (pollMovementVariationJobs) keeps these jobs moving even
  // when the modal is closed; this listener surfaces their state on the cards.
  useEffect(() => {
    if (!coachId) return;
    setVariationBadges({});
    const jobsQuery = query(
      collection(db, 'movement_variation_jobs'),
      where('coachId', '==', coachId),
      where('status', 'in', ['running', 'succeeded']),
    );
    const unsub = onSnapshot(
      jobsQuery,
      (snap) => {
        const newest: Record<string, { state: 'running' | 'ready'; createdAt: number }> = {};
        snap.docs.forEach((d) => {
          const job = d.data() as any;
          const movId = job.sourceMovementId;
          if (!movId) return;
          const state: 'running' | 'ready' | null =
            job.status === 'running' ? 'running'
            : job.status === 'succeeded' && !job.finalizedVideoUrl ? 'ready'
            : null;
          if (!state) return;
          const createdAt = job.createdAt?.seconds ?? 0;
          if (!newest[movId] || createdAt > newest[movId].createdAt) {
            newest[movId] = { state, createdAt };
          }
        });
        const badges: Record<string, 'running' | 'ready'> = {};
        Object.entries(newest).forEach(([movId, v]) => { badges[movId] = v.state; });
        setVariationBadges(badges);
      },
      (err) => console.error('[Build] Variation jobs listener error:', err),
    );
    return unsub;
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

  const saveFolderTitle = useCallback(async () => {
    setEditingFolderTitle(false);
    const stack = folderStackRef.current;
    const current = stack[stack.length - 1];
    const name = folderTitleDraft.trim();
    if (!current || !name || name === current.name) return;
    try {
      await updateDoc(doc(db, 'build_folders', current.id), { name, updatedAt: serverTimestamp() });
      setFolderStack(prev => prev.map((f, i) => (i === prev.length - 1 ? { ...f, name } : f)));
    } catch (e) { console.error('[Build] Folder rename error:', e); }
  }, [folderTitleDraft]);

  // ── Playbook helpers ───────────────────────────────────────────────────
  const enterPlaybook = useCallback((pb: BuildItem) => {
    setCurrentPlaybook({ id: pb.id, name: pb.name });
  }, []);

  const exitPlaybook = useCallback(() => {
    setCurrentPlaybook(null);
    setShowPlaybookSchedule(false);
    setEditingPlaybookTitle(false);
    setShowPbMenu(false);
    setShowPbDeleteConfirm(false);
    setShowPbDescEdit(false);
    setShowPbMoveTo(false);
    setShowPbManageMembers(false);
    setShowPbRevokeConfirm(false);
  }, []);

  const savePlaybookTitle = useCallback(async () => {
    setEditingPlaybookTitle(false);
    const pb = currentPlaybookRef.current;
    const name = playbookTitleDraft.trim();
    if (!pb || !name || name === pb.name) return;
    try {
      await updateDoc(doc(db, 'playbooks', pb.id), { name, updatedAt: serverTimestamp() });
      setCurrentPlaybook(prev => (prev ? { ...prev, name } : prev));
    } catch (e) { console.error('[Build] Playbook rename error:', e); }
  }, [playbookTitleDraft]);

  // ── Playbook settings menu actions ─────────────────────────────────────
  const getCurrentPlaybookDoc = useCallback((): any => {
    const pb = currentPlaybookRef.current;
    if (!pb) return null;
    return itemsRef.current.find(i => i.type === 'Playbooks' && i.id === pb.id) ?? null;
  }, []);

  const duplicatePlaybook = useCallback(async () => {
    const pbDoc = getCurrentPlaybookDoc();
    if (!pbDoc || !coachId) return;
    try {
      // Members are intentionally not copied — a duplicate is a template, not a roster.
      await addDoc(collection(db, 'playbooks'), {
        coachId,
        name: `${pbDoc.name} (Copy)`,
        description: pbDoc.description || '',
        workoutIds: Array.isArray(pbDoc.workoutIds) ? pbDoc.workoutIds : [],
        parentId: pbDoc.parentId ?? null,
        memberIds: [],
        isArchived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (e) { console.error('[Build] Duplicate playbook error:', e); }
  }, [coachId, getCurrentPlaybookDoc]);

  const savePlaybookDescription = useCallback(async () => {
    const pb = currentPlaybookRef.current;
    setShowPbDescEdit(false);
    if (!pb) return;
    try {
      await updateDoc(doc(db, 'playbooks', pb.id), {
        description: pbDescDraft.trim(),
        updatedAt: serverTimestamp(),
      });
    } catch (e) { console.error('[Build] Playbook description error:', e); }
  }, [pbDescDraft]);

  // Live (unrevoked) booking token — created in the schedule panel.
  const fetchPbBookingToken = useCallback(async (): Promise<string | null> => {
    const pb = currentPlaybookRef.current;
    if (!pb || !coachId) return null;
    try {
      const snap = await getDocs(query(
        collection(db, 'playbook_booking_tokens'),
        where('coachId', '==', coachId),
        where('playbookId', '==', pb.id),
        where('revokedAt', '==', null),
        limit(1),
      ));
      return snap.empty ? null : snap.docs[0].id;
    } catch { return null; }
  }, [coachId]);

  const copyPbBookingLink = useCallback(async () => {
    const token = await fetchPbBookingToken();
    if (!token) { setShowPlaybookSchedule(true); return; }
    const origin = Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin : 'https://goarrive.fit';
    const url = `${origin}/book/${token}`;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      if (typeof window !== 'undefined') window.alert('Booking link copied to clipboard.');
    } else {
      try { await Share.share({ message: url }); } catch { Alert.alert('Booking Link', url); }
    }
  }, [fetchPbBookingToken]);

  const previewPbBookingPage = useCallback(async () => {
    const token = await fetchPbBookingToken();
    if (!token) { setShowPlaybookSchedule(true); return; }
    router.push(`/book/${token}?preview=1`);
  }, [fetchPbBookingToken]);

  const revokePbBookingLink = useCallback(async (regenerate: boolean) => {
    const pb = currentPlaybookRef.current;
    if (!pb || pbRevokeBusy) return;
    setPbRevokeBusy(true);
    try {
      const fn = httpsCallable<{ playbookId: string; regenerate: boolean }, { revoked: number; token: string | null }>(
        functions, 'revokePlaybookBookingLink',
      );
      const res = await fn({ playbookId: pb.id, regenerate });
      setShowPbRevokeConfirm(false);
      const { revoked, token } = res.data;
      if (regenerate && token) {
        const origin = Platform.OS === 'web' && typeof window !== 'undefined'
          ? window.location.origin : 'https://goarrive.fit';
        const url = `${origin}/book/${token}`;
        if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
          await navigator.clipboard.writeText(url);
          if (typeof window !== 'undefined') window.alert('Old link revoked. New booking link copied to clipboard.');
        } else {
          try { await Share.share({ message: url }); } catch { Alert.alert('New Booking Link', url); }
        }
      } else if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(revoked > 0 ? 'Booking link revoked.' : 'No active booking link to revoke.');
      }
    } catch (e) {
      console.error('[Build] Revoke booking link error:', e);
      setShowPbRevokeConfirm(false);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert('Could not revoke the booking link. Please try again.');
      } else {
        Alert.alert('Revoke Failed', 'Could not revoke the booking link. Please try again.');
      }
    } finally {
      setPbRevokeBusy(false);
    }
  }, [pbRevokeBusy]);

  const movePlaybookToFolder = useCallback(async (folderId: string | null) => {
    const pb = currentPlaybookRef.current;
    setShowPbMoveTo(false);
    if (!pb) return;
    try {
      await updateDoc(doc(db, 'playbooks', pb.id), {
        parentId: folderId,
        updatedAt: serverTimestamp(),
      });
    } catch (e) { console.error('[Build] Move playbook error:', e); }
  }, []);

  const toggleArchivePlaybook = useCallback(async () => {
    const pbDoc = getCurrentPlaybookDoc();
    const pb = currentPlaybookRef.current;
    if (!pbDoc || !pb) return;
    const next = !pbDoc.isArchived;
    try {
      await updateDoc(doc(db, 'playbooks', pb.id), { isArchived: next, updatedAt: serverTimestamp() });
      if (next) exitPlaybook();
    } catch (e) { console.error('[Build] Archive playbook error:', e); }
  }, [getCurrentPlaybookDoc, exitPlaybook]);

  const confirmDeletePlaybook = useCallback(async () => {
    const pb = currentPlaybookRef.current;
    setShowPbDeleteConfirm(false);
    if (!pb) return;
    try {
      // Best-effort: revoke live booking links + drop booking windows before
      // the playbook doc goes away (tokens/windows are server-write-only).
      try {
        const fn = httpsCallable(functions, 'revokePlaybookBookingLink');
        await fn({ playbookId: pb.id, regenerate: false, deleteWindows: true });
      } catch (e) { console.warn('[Build] Booking cleanup on delete failed:', e); }
      await deleteDoc(doc(db, 'playbooks', pb.id));
      exitPlaybook();
    } catch (e) { console.error('[Build] Delete playbook error:', e); }
  }, [exitPlaybook]);

  // The playbook drill-in is a focused workspace — the app tab bar stays
  // hidden for the whole visit, not just during drags.
  useEffect(() => {
    navigation.setOptions({
      tabBarStyle: currentPlaybook ? { ...TAB_BAR_STYLE, display: 'none' } : TAB_BAR_STYLE,
    });
  }, [currentPlaybook, navigation]);

  // Drop zone on the folder header: dragging an asset onto "Build / …" moves
  // it up one level — to the parent folder, or to the Build root at depth 1.
  // Inside a playbook, the same zone removes the workout from the playbook.
  const isOverFolderHeader = useCallback((ax: number, ay: number): boolean => {
    const rect = folderHeaderRectRef.current;
    if (!rect || (folderStackRef.current.length === 0 && !currentPlaybookRef.current)) return false;
    return ax >= rect.x && ax <= rect.x + rect.w && ay >= rect.y && ay <= rect.y + rect.h;
  }, []);

  const moveItemUpOneLevel = useCallback(async (dragged: BuildItem) => {
    const stack = folderStackRef.current;
    if (stack.length === 0) return;
    const parent = stack.length >= 2 ? stack[stack.length - 2] : null;
    try {
      const batch = writeBatch(db);
      const coll = dragged.type === 'Folder' ? 'build_folders' : COLLECTION_BY_TYPE[dragged.type];
      batch.update(doc(db, coll, dragged.id), stripUndefined({
        parentId: parent ? parent.id : null,
        updatedAt: serverTimestamp(),
      }));
      if (parent) batch.update(doc(db, 'build_folders', parent.id), { updatedAt: serverTimestamp() });
      await batch.commit();
    } catch (e) { console.error('[Build] Move up one level error:', e); }
  }, []);

  // ── Recent drop folders (bottom tray) ──────────────────────────────────
  // Persisted per-coach so the tray survives reloads. coachId here derives
  // from claims.coachId (impersonation-safe) — see useAuth() above.
  useEffect(() => {
    if (!coachId) return;
    AsyncStorage.getItem(`buildRecentDropFolders:${coachId}`)
      .then(raw => {
        if (!raw) return;
        try {
          const ids = JSON.parse(raw);
          if (Array.isArray(ids)) {
            setRecentDropFolderIds(ids.filter((x: any) => typeof x === 'string').slice(0, TRAY_MAX_RECENTS));
          }
        } catch {}
      })
      .catch(() => {});
  }, [coachId]);

  const recordRecentDropFolder = useCallback((folderId: string) => {
    setRecentDropFolderIds(prev => {
      const next = [folderId, ...prev.filter(id => id !== folderId)].slice(0, TRAY_MAX_RECENTS);
      if (coachId) {
        AsyncStorage.setItem(`buildRecentDropFolders:${coachId}`, JSON.stringify(next)).catch(() => {});
      }
      return next;
    });
  }, [coachId]);

  const createFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const pendingDrop = pendingFolderDropItem;
    try {
      const folderRef = await addDoc(collection(db, 'build_folders'), {
        coachId,
        tenantId,
        name,
        parentId: currentFolderId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      // Tray "New Folder" drop: nest the dragged item into the new folder.
      // Folder sources write to build_folders; assets use COLLECTION_BY_TYPE.
      if (pendingDrop) {
        const coll = pendingDrop.type === 'Folder' ? 'build_folders' : COLLECTION_BY_TYPE[pendingDrop.type];
        await updateDoc(doc(db, coll, pendingDrop.id), stripUndefined({
          parentId: folderRef.id,
          updatedAt: serverTimestamp(),
        }));
        recordRecentDropFolder(folderRef.id);
      }
      setNewFolderName('');
      setShowFolderCreate(false);
      setPendingFolderDropItem(null);
      // New folder sorts to the top of the grid — bring the user there so
      // they see what they just created instead of it vanishing off-screen.
      // animated:false — smooth scroll no-ops on iOS Safari.
      scrollOffsetRef.current = 0;
      requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: false }));
    } catch (e) {
      console.error('[Build] Create folder error:', e);
    }
  }, [coachId, tenantId, currentFolderId, newFolderName, pendingFolderDropItem, recordRecentDropFolder]);

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

  const resetPlaybookCreateState = useCallback(() => {
    setNewPlaybookName(''); setNewPlaybookDesc('');
    setShowPlaybookCreate(false);
    setPendingPlaybookDropItem(null);
    setPlaybookSeedWorkoutIds([]);
    setPbAssignMemberId(null);
    setPbAddByEmail(false);
    setPbNewMemberName(''); setPbNewMemberEmail('');
  }, []);

  // Load the coach's members whenever the create modal opens, for the
  // assignment picker. One-shot fetch — the list is small and modal-scoped.
  useEffect(() => {
    if ((!showPlaybookCreate && !currentPlaybook && !pbAddMemberOpen) || !coachId) return;
    getDocs(query(collection(db, 'members'), where('coachId', '==', coachId)))
      .then(snap => {
        setPbMembers(
          snap.docs
            .filter(d => !d.data().isArchived)
            .map(d => {
              const x = d.data();
              return {
                id: d.id,
                name: x.name || x.displayName || (x.firstName ? `${x.firstName} ${x.lastName || ''}`.trim() : '') || x.email || 'Unnamed',
                email: x.email || '',
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(e => console.error('[Build] Load members error:', e));
  }, [showPlaybookCreate, currentPlaybook, pbAddMemberOpen, coachId]);

  // A1/A2: playbook membership helpers — memberIds is the source of truth,
  // assignedMemberId/Name stay in sync for legacy single-member reads.
  const addMemberToPlaybook = useCallback(async (memberId: string) => {
    const pb = currentPlaybookRef.current;
    if (!pb || !memberId) return;
    try {
      const pbDoc = itemsRef.current.find(i => i.type === 'Playbooks' && i.id === pb.id);
      const existing: string[] = Array.isArray(pbDoc?.memberIds) && pbDoc!.memberIds.length
        ? pbDoc!.memberIds
        : (pbDoc?.assignedMemberId ? [pbDoc.assignedMemberId] : []);
      if (existing.includes(memberId)) return;
      const next = [...existing, memberId];
      const patch: any = { memberIds: next, updatedAt: serverTimestamp() };
      if (existing.length === 0) {
        let name = pbMembers.find(m => m.id === memberId)?.name || null;
        if (!name) {
          const snap = await getDoc(doc(db, 'members', memberId));
          name = (snap.data()?.name as string) || (snap.data()?.displayName as string) || null;
        }
        patch.assignedMemberId = memberId;
        patch.assignedMemberName = name;
      }
      await updateDoc(doc(db, 'playbooks', pb.id), patch);
    } catch (e) { console.error('[Build] Add member to playbook error:', e); }
  }, [pbMembers]);

  const removeMemberFromPlaybook = useCallback(async (memberId: string) => {
    const pb = currentPlaybookRef.current;
    if (!pb || !memberId) return;
    try {
      const pbDoc = itemsRef.current.find(i => i.type === 'Playbooks' && i.id === pb.id);
      const existing: string[] = Array.isArray(pbDoc?.memberIds) && pbDoc!.memberIds.length
        ? pbDoc!.memberIds
        : (pbDoc?.assignedMemberId ? [pbDoc.assignedMemberId] : []);
      const next = existing.filter(id => id !== memberId);
      const patch: any = { memberIds: next, updatedAt: serverTimestamp() };
      if (pbDoc?.assignedMemberId === memberId) {
        patch.assignedMemberId = next[0] ?? null;
        patch.assignedMemberName = next[0]
          ? (pbMembers.find(m => m.id === next[0])?.name ?? null)
          : null;
      }
      await updateDoc(doc(db, 'playbooks', pb.id), patch);
    } catch (e) { console.error('[Build] Remove member from playbook error:', e); }
  }, [pbMembers]);

  const addWorkoutToPlaybook = useCallback(async (workoutId: string) => {
    const pb = currentPlaybookRef.current;
    if (!pb || !workoutId) return;
    try {
      await updateDoc(doc(db, 'playbooks', pb.id), {
        workoutIds: arrayUnion(workoutId),
        updatedAt: serverTimestamp(),
      });
    } catch (e) { console.error('[Build] Add workout to playbook error:', e); }
  }, []);

  // A2: members at-a-glance on the playbook drill-in header
  const playbookMemberChips = useMemo(() => {
    if (!currentPlaybook) return [] as { id: string; name: string }[];
    const pbDoc = items.find(i => i.type === 'Playbooks' && i.id === currentPlaybook.id);
    const ids: string[] = Array.isArray(pbDoc?.memberIds) && pbDoc!.memberIds.length
      ? pbDoc!.memberIds
      : (pbDoc?.assignedMemberId ? [pbDoc.assignedMemberId] : []);
    return ids.map(id => ({
      id,
      name: pbMembers.find(m => m.id === id)?.name
        || (id === pbDoc?.assignedMemberId ? pbDoc?.assignedMemberName : null)
        || 'Member',
    }));
  }, [currentPlaybook, items, pbMembers]);

  const createPlaybook = useCallback(async () => {
    const name = newPlaybookName.trim();
    if (!name) return;
    const pendingDrop = pendingPlaybookDropItem;
    try {
      // Assignment: an existing member, or a brand-new one added by email.
      let assignedMemberId: string | null = pbAssignMemberId;
      let assignedMemberName: string | null =
        pbMembers.find(m => m.id === pbAssignMemberId)?.name ?? null;
      if (pbAddByEmail && pbNewMemberEmail.trim()) {
        const emailNorm = pbNewMemberEmail.trim().toLowerCase();
        const memberName = pbNewMemberName.trim() || emailNorm;
        const dupSnap = await getDocs(query(
          collection(db, 'members'),
          where('coachId', '==', coachId),
          where('email', '==', emailNorm),
        ));
        const active = dupSnap.docs.find(d => !d.data().isArchived);
        if (active) {
          assignedMemberId = active.id;
          assignedMemberName = active.data().name || memberName;
        } else {
          const memberRef = await addDoc(collection(db, 'members'), {
            coachId,
            tenantId,
            name: memberName,
            email: emailNorm,
            phone: '',
            notes: '',
            isArchived: false,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          assignedMemberId = memberRef.id;
          assignedMemberName = memberName;
        }
      }
      const seedIds = pendingDrop && pendingDrop.type === 'Workouts'
        ? [pendingDrop.id]
        : playbookSeedWorkoutIds;
      await addDoc(collection(db, 'playbooks'), {
        coachId,
        tenantId,
        name,
        description: newPlaybookDesc.trim(),
        workoutIds: seedIds,
        isArchived: false,
        parentId: currentFolderId || null,
        assignedMemberId: assignedMemberId || null,
        assignedMemberName: assignedMemberName || null,
        assignedAt: assignedMemberId ? serverTimestamp() : null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      resetPlaybookCreateState();
      scrollOffsetRef.current = 0;
      requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: false }));
    } catch (e) { console.error('[Build] Create playbook error:', e); }
  }, [coachId, tenantId, currentFolderId, newPlaybookName, newPlaybookDesc, pendingPlaybookDropItem, playbookSeedWorkoutIds, pbAssignMemberId, pbAddByEmail, pbNewMemberName, pbNewMemberEmail, pbMembers, resetPlaybookCreateState]);

  // ── Drag & Drop handlers (filteredItems-independent) ──────────────────
  // The grid sorts by updatedAt desc, so a drop target jumps to the top of
  // the list and vanishes from the user's viewport. Scroll them up so they
  // immediately see the result of the drop.
  const scrollListToTop = useCallback(() => {
    // After a drop, the Firestore listener fires and updates the items list.
    // Watch that update and scroll once it lands.
    let attempts = 0;
    const tryScroll = () => {
      // Give React time to commit the render. If the list is still scrolled
      // down after 50ms, jump to 0. Retry up to 10 times.
      requestAnimationFrame(() => {
        scrollOffsetRef.current = 0;
        // Direct DOM write first — RNW's scrollTo wrapper can be ignored by
        // Safari/WebKit; scrollTop assignment is the lowest-level primitive.
        try {
          const node: any = (listRef.current as any)?.getScrollableNode?.();
          if (node && typeof node.scrollTop === 'number') node.scrollTop = 0;
        } catch {}
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
        attempts++;
        // Firestore snapshot can take >1s; keep pinning to 0 for ~2.5s so a
        // late re-render can't leave the list scrolled down.
        if (attempts < 20) {
          setTimeout(tryScroll, 125);
        }
      });
    };
    tryScroll();
  }, []);

  const showDropToast = useCallback((msg: string) => {
    if (dropToastTimerRef.current) clearTimeout(dropToastTimerRef.current);
    setDropToast(msg);
    dropToastTimerRef.current = setTimeout(() => setDropToast(null), 2500);
  }, []);

  // Archive via tray drop: soft-archive the dragged item, re-parenting folder
  // children up one level first (spec default A).
  const confirmArchiveItem = useCallback(async () => {
    const item = pendingArchiveItem;
    setShowArchiveConfirm(false);
    setPendingArchiveItem(null);
    if (!item) return;
    try {
      if (item.type === 'Playbooks') {
        // Soft-only: revoke booking links then flag isArchived. No deleteDoc.
        try {
          const fn = httpsCallable(functions, 'revokePlaybookBookingLink');
          await fn({ playbookId: item.id, regenerate: false, deleteWindows: true });
        } catch (e) { console.warn('[Build] Booking cleanup on archive failed:', e); }
        await updateDoc(doc(db, 'playbooks', item.id), { isArchived: true, updatedAt: serverTimestamp() });
      } else if (item.type === 'Folder') {
        // Re-parent children up one level then flag the folder archived.
        const batch = writeBatch(db);
        const parentId = item.parentId ?? null;
        const childSnap = await Promise.all([
          getDocs(query(collection(db, 'movements'), where('parentId', '==', item.id))),
          getDocs(query(collection(db, 'workouts'), where('parentId', '==', item.id))),
          getDocs(query(collection(db, 'build_folders'), where('parentId', '==', item.id))),
          getDocs(query(collection(db, 'playbooks'), where('parentId', '==', item.id))),
        ]);
        for (const snap of childSnap) {
          for (const d of snap.docs) {
            batch.update(d.ref, { parentId, updatedAt: serverTimestamp() });
          }
        }
        batch.update(doc(db, 'build_folders', item.id), { isArchived: true, updatedAt: serverTimestamp() });
        await batch.commit();
      } else {
        const coll = COLLECTION_BY_TYPE[item.type as BuildType];
        await updateDoc(doc(db, coll, item.id), { isArchived: true, updatedAt: serverTimestamp() });
      }
      showDropToast(`Archived "${item.name}"`);
    } catch (e) { console.error('[Build] Archive item error:', e); }
  }, [pendingArchiveItem, showDropToast]);

  const dropItemIntoFolder = useCallback(async (dragged: BuildItem, folderId: string) => {
    // Folder-into-folder nest: reject self-drop and cycles (target folder
    // must not be a descendant of the dragged folder — walking the parent
    // chain up from the target hits the dragged id iff moving would create
    // a loop). Also no-op if already parented there.
    if (dragged.type === 'Folder') {
      if (dragged.id === folderId) return;
      if (dragged.parentId === folderId) {
        showDropToast(`Already in "${itemsRef.current.find(i => i.id === folderId)?.name ?? 'folder'}"`);
        return;
      }
      const folderById = new Map(
        itemsRef.current.filter(i => i.type === 'Folder').map(i => [i.id, i as BuildItem]),
      );
      let cursor: BuildItem | undefined = folderById.get(folderId);
      while (cursor) {
        if (cursor.id === dragged.id) {
          showDropToast(`Can't move "${dragged.name}" into its own subfolder`);
          return;
        }
        cursor = cursor.parentId ? folderById.get(cursor.parentId) : undefined;
      }
    }
    try {
      // Bump the folder's updatedAt too, so it resorts to the top of the
      // grid where the user is scrolled to see the result.
      const batch = writeBatch(db);
      const coll = dragged.type === 'Folder' ? 'build_folders' : COLLECTION_BY_TYPE[dragged.type];
      batch.update(doc(db, coll, dragged.id), stripUndefined({
        parentId: folderId,
        updatedAt: serverTimestamp(),
      }));
      batch.update(doc(db, 'build_folders', folderId), { updatedAt: serverTimestamp() });
      await batch.commit();
      recordRecentDropFolder(folderId);
      scrollListToTop();
    } catch (e) { console.error('[Build] Drop into folder error:', e); }
  }, [recordRecentDropFolder, scrollListToTop, showDropToast]);

  // Tray targets live OUTSIDE the FlatList and don't move with scroll. Their
  // absolute rects are deterministic: onLayout x/w within trayRow, plus the
  // tray's known bottom-anchored geometry. Anything in the tray band snaps
  // to the nearest target horizontally so near-miss drops still land.
  // item === null means the "New Folder" target.
  const findTrayTarget = useCallback((ax: number, ay: number): { key: string; item: BuildItem | null } | null => {
    if (!trayVisibleRef.current) return null;
    const windowH = Dimensions.get('window').height;
    // trayRow top = window bottom − bottom padding (inset + 12) − row height.
    // Prefer the measured absolute top (iOS visual-viewport safe); math fallback.
    const rowTop = trayRowTopRef.current ?? (windowH - (insets.bottom + 12) - (TRAY_HEIGHT - 24));
    if (ay < rowTop - 10) return null; // above the tray band (10px grace)
    // Cancel chip is pinned outside the scroll view — check via absolute rect.
    const cc = cancelChipAbsRectRef.current;
    if (cc && ax >= cc.x - 10 && ax <= cc.x + cc.w + 10 && ay >= cc.y - 10 && ay <= cc.y + cc.h + 10) {
      return { key: TRAY_CANCEL_KEY, item: null };
    }
    if (trayItemLayoutsRef.current.size === 0) return null;
    let best: { key: string; item: BuildItem | null } | null = null;
    let bestDist = Infinity;
    trayItemLayoutsRef.current.forEach(({ x, w, item }, key) => {
      // x is relative to the horizontal ScrollView content, so subtract the
      // live scroll offset to get the on-screen left edge.
      const left = 12 + x - trayScrollOffsetRef.current; // tray paddingHorizontal
      const dist = ax < left ? left - ax : ax > left + w ? ax - (left + w) : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = { key, item };
      }
    });
    return best && bestDist <= 40 ? best : null;
  }, [insets.bottom]);

  const findTarget = useCallback((ax: number, ay: number): BuildItem | null => {
    // snapshotLayouts captured absolute positions at drag start; edge
    // auto-scroll moves tiles up/down after that. Shift the snapshot rects
    // by the scroll delta instead of re-measuring every tile per frame.
    const scrollDelta = scrollOffsetRef.current - offsetAtSnapshotRef.current;
    let found: BuildItem | null = null;
    tileLayoutSnap.current.forEach(({ x, y, w, h, item: candidate }) => {
      // Only consider tiles that are actual drop targets for the item
      // currently being dragged (see isDropTarget).
      if (!isDropTarget(candidate, _dragItemRef.current)) return;
      const adjY = y - scrollDelta;
      if (ax >= x && ax <= x + w && ay >= adjY && ay <= adjY + h) found = candidate;
    });
    return found;
  }, []);

  const updateHovered = useCallback((ax: number, ay: number) => {
    pointerXRef.current = ax;
    pointerYRef.current = ay;
    // Header drop zone first, then tray targets, then tile snapshots.
    const nextId = isOverFolderHeader(ax, ay)
      ? '__parent__'
      : (findTrayTarget(ax, ay)?.key ?? findTarget(ax, ay)?.id ?? null);
    hoveredIdRef.current = nextId;
    setHoveredId(prev => (prev === nextId ? prev : nextId));

    // Ghost transitions: shrink + fade while the pointer is inside the tray
    // zone so the coach can see the folder/playbook chip underneath. Only
    // trigger springs on transitions — otherwise every frame restarts the
    // animation and it looks choppy.
    if (trayVisibleRef.current) {
      const windowH = Dimensions.get('window').height;
      const trayTop = trayRowTopRef.current ?? (windowH - TRAY_HEIGHT - insets.bottom);
      const overTray = ay >= trayTop - 6;
      if (overTray !== ghostOverTrayRef.current) {
        ghostOverTrayRef.current = overTray;
        if (overTray) {
          ghostScale.value = withSpring(0.55, { damping: 18, stiffness: 220 });
          ghostOpacity.value = withTiming(0.5, { duration: 160 });
        } else {
          ghostScale.value = withSpring(1.08, { damping: 15, stiffness: 200 });
          ghostOpacity.value = withTiming(1, { duration: 160 });
        }
      }
    }
  }, [findTarget, findTrayTarget, isOverFolderHeader, insets.bottom, ghostOpacity, ghostScale]);

  const executeDrop = useCallback(async (ax: number, ay: number) => {
    const dragged = _dragItemRef.current;
    if (!dragged) return;

    // Inside a playbook: drags only reorder workoutIds (drop on another
    // workout) or remove from the playbook (drop on the header). No
    // parentId writes, folder drops, or combine modals in this context.
    const pb = currentPlaybookRef.current;
    if (pb) {
      if (dragged.type !== 'Workouts') return;
      try {
        if (isOverFolderHeader(ax, ay)) {
          await updateDoc(doc(db, 'playbooks', pb.id), {
            workoutIds: arrayRemove(dragged.id),
            updatedAt: serverTimestamp(),
          });
          return;
        }
        const target = findTarget(ax, ay);
        if (!target || target.id === dragged.id || target.type !== 'Workouts') return;
        const pbDoc = itemsRef.current.find(i => i.type === 'Playbooks' && i.id === pb.id);
        const ids: string[] = Array.isArray(pbDoc?.workoutIds) ? [...pbDoc!.workoutIds] : [];
        const from = ids.indexOf(dragged.id);
        const to = ids.indexOf(target.id);
        if (from === -1 || to === -1 || from === to) return;
        ids.splice(from, 1);
        const ti = ids.indexOf(target.id);
        ids.splice(from < to ? ti + 1 : ti, 0, dragged.id);
        await updateDoc(doc(db, 'playbooks', pb.id), {
          workoutIds: ids,
          updatedAt: serverTimestamp(),
        });
      } catch (e) { console.error('[Build] Playbook drag error:', e); }
      return;
    }

    // Header "Build / …" zone: move the asset up one level.
    if (isOverFolderHeader(ax, ay)) {
      await moveItemUpOneLevel(dragged);
      return;
    }

    // Tray targets first — they float above the list.
    const tray = findTrayTarget(ax, ay);
    if (tray) {
      if (tray.key === TRAY_CANCEL_KEY) {
        // No-op: drag session ends normally, tray slides down via cleanup.
        return;
      } else if (tray.key === TRAY_ARCHIVE_KEY) {
        // Open archive confirmation modal — write happens on confirm, not here.
        setPendingArchiveItem(dragged);
        setShowArchiveConfirm(true);
        return;
      } else if (tray.item) {
        await dropItemIntoFolder(dragged, tray.item.id);
      } else if (tray.key === TRAY_NEW_PLAYBOOK_KEY) {
        // Tray "New Playbook" target (workouts only): open the create modal
        // seeded with the dragged workout.
        if (dragged.type === 'Workouts') {
          setPendingPlaybookDropItem(dragged);
          setShowPlaybookCreate(true);
        }
      } else {
        // Tray "New" target: ask Folder vs Workout, then run the matching flow.
        setTrayDropChooserItem(dragged);
      }
      return;
    }

    let target = findTarget(ax, ay);
    // Coordinate drift at gesture release can cause findTarget to miss by a few
    // pixels even when the orange-border hover was showing. Fall back to the
    // last hovered item id when the primary hit-test returns nothing.
    if (!target && hoveredIdRef.current && !hoveredIdRef.current.startsWith('tray:') && hoveredIdRef.current !== '__parent__') {
      target = tileLayoutSnap.current.get(hoveredIdRef.current)?.item ?? null;
    }
    if (!target || target.id === dragged.id) return;
    if (!isDropTarget(target, dragged)) return;

    // No-op when dropping an item onto the folder it already lives in.
    if (target.type === 'Folder' && target.id === dragged.parentId) {
      showDropToast(`Already in "${target.name}"`);
      return;
    }

    if (target.type === 'Folder') {
      await dropItemIntoFolder(dragged, target.id);
    } else if (target.type === 'Playbooks') {
      // Workouts-only membership — isDropTarget already rejects everything
      // else. arrayUnion dedupes if the workout is already in the playbook.
      if (dragged.type !== 'Workouts') return;
      try {
        await updateDoc(doc(db, 'playbooks', target.id), {
          workoutIds: arrayUnion(dragged.id),
          updatedAt: serverTimestamp(),
        });
        scrollListToTop();
      } catch (e) { console.error('[Build] Drop into playbook error:', e); }
    } else if (target.type === 'Workouts' && dragged.type === 'Movements') {
      const blockMov = toBlockMov(dragged);
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
        scrollListToTop();
      } catch (e) { console.error('[Build] Drop into workout error:', e); }
    } else {
      // Asset dropped onto another asset — combine them into a new folder
      // (or, for two movements, optionally a new workout).
      setDropModal({ drag: dragged, target });
    }
  }, [findTarget, findTrayTarget, dropItemIntoFolder, scrollListToTop, isOverFolderHeader, moveItemUpOneLevel, showDropToast]);

  const clearDragState = useCallback(() => {
    _dragItemRef.current = null;
    hoveredIdRef.current = null;
    setDragItem(null);
    setHoveredId(null);
    tileLayoutSnap.current.clear();
    // Reset tray-scroll and ghost-over-tray so the next drag starts fresh.
    trayScrollOffsetRef.current = 0;
    trayScrollRef.current?.scrollTo({ x: 0, animated: false });
    ghostOverTrayRef.current = false;
  }, []);

  // ── Page scroll lock during drag (web) ─────────────────────────────────
  // iOS Safari starts a native pan mid-drag and fires pointercancel, which
  // cancels the RNGH gesture and strands the ghost. Locking document scroll
  // for the drag's duration prevents the native pan from ever starting.
  const lockPageScroll = useCallback(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (scrollLockCleanupRef.current) return;
    const prevent = (e: TouchEvent) => e.preventDefault();
    document.addEventListener('touchmove', prevent, { passive: false });
    const body = document.body;
    const prevTouchAction = body.style.touchAction;
    const prevOverflow = body.style.overflow;
    body.style.touchAction = 'none';
    body.style.overflow = 'hidden';
    scrollLockCleanupRef.current = () => {
      document.removeEventListener('touchmove', prevent);
      body.style.touchAction = prevTouchAction;
      body.style.overflow = prevOverflow;
    };
  }, []);

  const unlockPageScroll = useCallback(() => {
    scrollLockCleanupRef.current?.();
    scrollLockCleanupRef.current = null;
  }, []);

  // ── Edge auto-scroll while dragging ────────────────────────────────────
  const stopAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current != null) {
      cancelAnimationFrame(autoScrollRafRef.current);
      autoScrollRafRef.current = null;
    }
  }, []);

  // measure() inside onLayout can report zeros on web; measureInWindow gives
  // viewport-relative coords that match the gesture's absoluteY. Re-measured
  // at every drag start so a stale/empty value can't disable the scroll bands.
  const measureListWindow = useCallback(() => {
    const node: any = listContainerRef.current;
    if (node?.measureInWindow) {
      node.measureInWindow((_x: number, y: number, _w: number, h: number) => {
        if (h > 0) listWindowRef.current = { top: y, height: h };
      });
    }
  }, []);

  // Direct DOM scroll node — bypasses RNW's scrollTo wrapper, which some
  // Safari/WebKit versions silently ignore during an active touch gesture.
  const getListScrollNode = useCallback((): any => {
    try {
      const node: any = (listRef.current as any)?.getScrollableNode?.();
      return node && typeof node.scrollTop === 'number' ? node : null;
    } catch { return null; }
  }, []);

  // On-device diagnostics for the auto-scroll loop: open /build?dragdebug=1
  // and a fixed overlay shows live pointer/band/scroll numbers during a drag.
  // DOM-only (web) so it can't disturb React state mid-gesture.
  const dragDebugEl = useCallback((): any => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
    if (!/[?&]dragdebug=1/.test(window.location.search)) return null;
    let el = document.getElementById('drag-debug-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'drag-debug-overlay';
      el.style.cssText =
        'position:fixed;top:70px;left:4px;right:4px;z-index:99999;pointer-events:none;' +
        'background:rgba(0,0,0,0.75);color:#0f0;font:10px monospace;padding:4px;white-space:pre;';
      document.body.appendChild(el);
    }
    return el;
  }, []);

  const startAutoScroll = useCallback(() => {
    stopAutoScroll();
    let frame = 0;
    const step = () => {
      frame++;
      let win = listWindowRef.current;
      if (!win || win.height <= 0) {
        // Measurement unavailable — fall back to the full window so the
        // edge bands still work rather than silently doing nothing.
        win = { top: 0, height: Dimensions.get('window').height };
      }
      const y = pointerYRef.current;
      const x = pointerXRef.current;
      const windowH = Dimensions.get('window').height;
      const windowW = Dimensions.get('window').width;
      let listBottom = win.top + win.height;
      // Keep the scroll band above the drop tray once it's visible.
      if (trayVisibleRef.current) {
        listBottom = Math.min(listBottom, windowH - TRAY_HEIGHT - insets.bottom);
      }
      const band = (listBottom - win.top) * AUTO_SCROLL_BAND_PCT;
      const trayTop = trayRowTopRef.current ?? (windowH - TRAY_HEIGHT - insets.bottom);
      const inRightHotspot = x > windowW - AUTO_SCROLL_HOTSPOT_W;
      const inTrayZone = trayVisibleRef.current && y >= trayTop;
      let delta = 0;
      // Scroll UP: full-width top band. Movement stays symmetric with the
      // right-column DOWN hotspot below — top is safe because the "back"
      // gesture doesn't live there.
      if (y < win.top + band) {
        const proximity = (win.top + band - y) / band;
        delta = -Math.min(1, proximity) * AUTO_SCROLL_MAX_PX;
      }
      // Scroll DOWN: bottom-right hotspot only. A right-edge column (≈90px)
      // that spans from the bottom edge band up. Anywhere else along the
      // bottom is either a tray target (chip) or empty tray gutter — those
      // shouldn't fight for the down-scroll gesture.
      else if (inRightHotspot && y > listBottom - band) {
        const proximity = Math.min(1, (y - (listBottom - band)) / band);
        delta = proximity * AUTO_SCROLL_MAX_PX;
      }
      const node = getListScrollNode();
      if (delta !== 0) {
        if (node) {
          const before = node.scrollTop;
          const max = Math.max(0, node.scrollHeight - node.clientHeight);
          const next = Math.min(max, Math.max(0, before + delta));
          node.scrollTop = next;
          // iOS WebKit can silently ignore scrollTop writes while a touch
          // gesture is active — fall back to RNW's scrollTo in that case.
          if (node.scrollTop === before && next !== before) {
            listRef.current?.scrollToOffset({ offset: next, animated: false });
          }
          scrollOffsetRef.current = next;
        } else {
          const next = Math.max(0, scrollOffsetRef.current + delta);
          scrollOffsetRef.current = next;
          listRef.current?.scrollToOffset({ offset: next, animated: false });
        }
      }

      // Horizontal tray scroll — only when pointer is over the tray zone AND
      // not in the right-column down-scroll hotspot (which already claims the
      // right edge for page-down). Drag toward left/right band of the tray
      // shifts recents into view so more targets become reachable.
      if (inTrayZone && !inRightHotspot) {
        const maxOffset = Math.max(0, trayContentWidthRef.current - trayViewportWidthRef.current);
        if (maxOffset > 0) {
          let hDelta = 0;
          const leftEdge = TRAY_HSCROLL_BAND;
          const rightEdge = windowW - AUTO_SCROLL_HOTSPOT_W - TRAY_HSCROLL_BAND;
          if (x < leftEdge) {
            hDelta = -Math.min(1, (leftEdge - x) / TRAY_HSCROLL_BAND) * TRAY_HSCROLL_MAX_PX;
          } else if (x > rightEdge) {
            const proximity = Math.min(1, (x - rightEdge) / TRAY_HSCROLL_BAND);
            hDelta = proximity * TRAY_HSCROLL_MAX_PX;
          }
          if (hDelta !== 0) {
            const nextOff = Math.min(maxOffset, Math.max(0, trayScrollOffsetRef.current + hDelta));
            if (nextOff !== trayScrollOffsetRef.current) {
              trayScrollOffsetRef.current = nextOff;
              trayScrollRef.current?.scrollTo({ x: nextOff, animated: false });
            }
          }
        }
      }
      const dbg = dragDebugEl();
      if (dbg) {
        dbg.textContent =
          `f=${frame} x=${Math.round(x)} y=${Math.round(y)}\n` +
          `winTop=${Math.round(win.top)} winH=${Math.round(win.height)} listBottom=${Math.round(listBottom)} band=${Math.round(band)}\n` +
          `tray=${trayVisibleRef.current ? 1 : 0} inTray=${inTrayZone ? 1 : 0} rightHot=${inRightHotspot ? 1 : 0} delta=${delta.toFixed(1)}\n` +
          `node=${node ? 1 : 0} scrollTop=${node ? Math.round(node.scrollTop) : -1} off=${Math.round(scrollOffsetRef.current)} trayOff=${Math.round(trayScrollOffsetRef.current)}`;
      }
      autoScrollRafRef.current = requestAnimationFrame(step);
    };
    autoScrollRafRef.current = requestAnimationFrame(step);
  }, [stopAutoScroll, insets.bottom, getListScrollNode, dragDebugEl]);

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
      batch.update(doc(db, COLLECTION_BY_TYPE[drag.type as BuildType], drag.id), stripUndefined({
        parentId: folderRef.id,
        updatedAt: serverTimestamp(),
      }));
      batch.update(doc(db, COLLECTION_BY_TYPE[target.type as BuildType], target.id), stripUndefined({
        parentId: folderRef.id,
        updatedAt: serverTimestamp(),
      }));
      await batch.commit();
      scrollListToTop();
    } catch (e) { console.error('[Build] Create folder from drop error:', e); }
  }, [dropModal, coachId, tenantId, currentFolderId, scrollListToTop]);

  const createWorkoutFromDrop = useCallback(async () => {
    if (!dropModal) return;
    const { drag, target } = dropModal;
    setDropModal(null);
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
      scrollListToTop();
    } catch (e) { console.error('[Build] Create workout from drop error:', e); }
  }, [dropModal, coachId, tenantId, currentFolderId, scrollListToTop]);

  // Workout dropped on workout → user chose Playbook: open the create modal
  // seeded with both workouts so the coach titles and assigns it before the
  // playbook is written.
  const createPlaybookFromDrop = useCallback(() => {
    if (!dropModal) return;
    const { drag, target } = dropModal;
    if (drag.type !== 'Workouts' || target.type !== 'Workouts') return;
    setDropModal(null);
    setPlaybookSeedWorkoutIds([drag.id, target.id]);
    setNewPlaybookName(`${drag.name} & ${target.name}`);
    setShowPlaybookCreate(true);
  }, [dropModal]);

  // Tray "New" drop → user chose Workout: create a one-movement workout.
  const createWorkoutFromTrayDrop = useCallback(async () => {
    const dragged = trayDropChooserItem;
    if (!dragged) return;
    setTrayDropChooserItem(null);
    try {
      const blocks = [{
        type: 'circuit',
        label: 'Block 1',
        rounds: DEFAULT_ROUNDS,
        firstMovementPrepSec: DEFAULT_REST_SEC,
        showDemo: false,
        demoDurationSec: DEFAULT_DEMO_DURATION_SEC,
        showGrabEquipment: false,
        movements: [toBlockMov(dragged)],
      }];
      await addDoc(collection(db, 'workouts'), stripUndefined({
        coachId,
        tenantId,
        name: `${dragged.name} Workout`,
        blocks,
        coverThumbs: computeCoverThumbs(blocks),
        estimatedDurationMin: calcDurationMin(blocks),
        isArchived: false,
        parentId: currentFolderId || null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }));
      scrollListToTop();
    } catch (e) { console.error('[Build] Create workout from tray drop error:', e); }
  }, [trayDropChooserItem, coachId, tenantId, currentFolderId, scrollListToTop]);

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
    const movementStillMap = new Map<string, string>();
    for (const item of items) {
      if (item.type === 'Movements') {
        if (item.thumbnailUrl || item.mediaUrl) {
          movementMap.set(item.id, (item.thumbnailUrl || item.mediaUrl) as string);
        }
        const still = item.posterUrl || item.thumbnailImageUrl;
        if (still) movementStillMap.set(item.id, still as string);
        if (item.name) movementNameMap.set(item.id, item.name as string);
      }
    }

    const withWorkouts = items.map(item => {
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

    // Folder previews: miniature of the folder's contents. Still photos
    // (posterUrl/thumbnailImageUrl) preferred; GIF only as a last resort so
    // movements without a poster frame aren't blank.
    const stillForBlockMov = (mov: any): string | null => {
      const movId = mov.movementId || mov.id || null;
      return (
        mov.posterUrl || mov.thumbnailImageUrl ||
        (movId ? movementStillMap.get(movId) : null) ||
        mov.thumbnailUrl || mov.gifUrl ||
        (movId ? movementMap.get(movId) : null) || null
      );
    };

    // Shared mini-card mapping for a workout inside a folder or playbook
    // preview — still photos preferred, name placeholder otherwise.
    const workoutPreviewEntry = (child: any): FolderPreviewEntry => {
      const thumbs: (string | { name: string })[] = [];
      const seen = new Set<string>();
      outer: for (const block of (child.blocks ?? [])) {
        for (const mov of (block?.movements ?? [])) {
          if (thumbs.length >= 16) break outer;
          const still = stillForBlockMov(mov);
          if (still) {
            if (!seen.has(still)) { seen.add(still); thumbs.push(still); }
          } else {
            thumbs.push({ name: mov.movementName || mov.name || 'Movement' });
          }
        }
      }
      return { id: child.id, name: child.name || 'Workout', thumbs };
    };

    const workoutsById = new Map<string, any>();
    for (const i of withWorkouts) {
      if (i.type === 'Workouts') workoutsById.set(i.id, i);
    }

    // Editing anything inside a folder must surface the folder in the grid
    // the same way editing a loose asset surfaces it. Firestore only bumps
    // the folder doc on create/drop, so compute an effective sort timestamp
    // client-side: the newest updatedAt anywhere in the folder's subtree.
    const childrenByParent = new Map<string, any[]>();
    for (const i of withWorkouts) {
      if (i.parentId) {
        const arr = childrenByParent.get(i.parentId) ?? [];
        arr.push(i);
        childrenByParent.set(i.parentId, arr);
      }
    }
    const effectiveCache = new Map<string, number>();
    const effectiveSeconds = (i: any): number => {
      const own = i.updatedAt?.seconds ?? i.createdAt?.seconds ?? 0;
      if (i.type !== 'Folder') return own;
      if (effectiveCache.has(i.id)) return effectiveCache.get(i.id)!;
      effectiveCache.set(i.id, own); // cycle guard for malformed parent chains
      let max = own;
      for (const c of childrenByParent.get(i.id) ?? []) max = Math.max(max, effectiveSeconds(c));
      effectiveCache.set(i.id, max);
      return max;
    };

    return withWorkouts.map(item => {
      // Playbook tiles render the same mini-library mosaic as folders, but
      // sourced from workoutIds (ordered) instead of parentId children.
      if (item.type === 'Playbooks') {
        const ids: string[] = Array.isArray(item.workoutIds) ? item.workoutIds : [];
        const children = ids
          .map(id => workoutsById.get(id))
          .filter(c => c && !c.isArchived)
          .slice(0, 9);
        if (children.length === 0) return item;
        return { ...item, folderPreview: children.map(workoutPreviewEntry) };
      }
      if (item.type !== 'Folder') return item;
      const sortSeconds = effectiveSeconds(item);
      const children = withWorkouts
        .filter(i => i.parentId === item.id && !i.isArchived && (i.type === 'Workouts' || i.type === 'Movements' || i.type === 'Follow-Alongs' || i.type === 'Playbooks'))
        .sort((a, b) => (b.updatedAt?.seconds ?? b.createdAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? a.createdAt?.seconds ?? 0))
        .slice(0, 9);
      if (children.length === 0) return { ...item, sortSeconds };
      const folderPreview = children.map(child => {
        if (child.type === 'Movements' || child.type === 'Follow-Alongs') {
          const still = (child.posterUrl || child.thumbnailImageUrl || child.thumbnailUrl || child.mediaUrl) as string | undefined;
          return { id: child.id, name: child.name || 'Movement', thumbs: still ? [still] : [{ name: child.name || 'Movement' }] };
        }
        if (child.type === 'Playbooks') {
          // Mosaic inside mosaic: each workout in the playbook contributes a
          // tiny cell of ≤4 stills; per-workout titles dropped at this size.
          const ids: string[] = Array.isArray(child.workoutIds) ? child.workoutIds : [];
          const playbookWorkouts = ids
            .map(id => workoutsById.get(id))
            .filter(w => w && !w.isArchived)
            .slice(0, 4)
            .map(w => workoutPreviewEntry(w).thumbs.slice(0, 4));
          return { id: child.id, name: child.name || 'Playbook', thumbs: [], playbookWorkouts };
        }
        return workoutPreviewEntry(child);
      });
      return { ...item, folderPreview, sortSeconds };
    });
  }, [items]);

  // ── Filtering ──────────────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    // Playbook view: ONLY the playbook's workouts, in workoutIds order —
    // the array is the source of truth for membership and sequence.
    if (currentPlaybook) {
      const pbDoc = enrichedItems.find(i => i.type === 'Playbooks' && i.id === currentPlaybook.id);
      const ids: string[] = Array.isArray(pbDoc?.workoutIds) ? pbDoc!.workoutIds : [];
      const workoutsById = new Map(
        enrichedItems.filter(i => i.type === 'Workouts' && !i.isArchived).map(i => [i.id, i]),
      );
      let list = ids.map(id => workoutsById.get(id)).filter(Boolean) as BuildItem[];
      if (search.trim()) {
        const q = search.toLowerCase();
        list = list.filter(i => i.name?.toLowerCase().includes(q));
      }
      return list;
    }
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
        const target = movMuscleGroupFilter.toLowerCase();
        list = list.filter(i =>
          [
            ...((i.muscleGroups as string[] | undefined) || []),
            ...((i as any).primaryMuscles || []),
            ...((i as any).secondaryMuscles || []),
          ].some((mg: string) => mg.toLowerCase() === target),
        );
      }
      if (movDifficultyFilter !== 'All') {
        list = list.filter(i =>
          (i.difficulty || '').toLowerCase() === movDifficultyFilter.toLowerCase(),
        );
      }
    }
    // Sort: everything mixed by most-recently-updated. Folders sort by
    // sortSeconds — the newest edit anywhere inside them — so editing a
    // folder's contents surfaces the folder like any other asset.
    list.sort((a, b) =>
      ((b as any).sortSeconds ?? b.updatedAt?.seconds ?? b.createdAt?.seconds ?? 0) -
      ((a as any).sortSeconds ?? a.updatedAt?.seconds ?? a.createdAt?.seconds ?? 0)
    );
    // Primary-muscle matches rank first; secondary-only matches sink
    if (activeType === 'Movements' && movMuscleGroupFilter !== 'All') {
      list = rankByPrimaryMuscle(list as any[], movMuscleGroupFilter) as typeof list;
    }
    return list;
  }, [enrichedItems, search, activeType, showArchived, currentFolderId, currentPlaybook, movEquipmentFilter, movMuscleGroupFilter, movDifficultyFilter]);

  // ── Drag & Drop handlers (require filteredItems) ───────────────────────
  const snapshotLayouts = useCallback(() => {
    const snap = tileLayoutSnap.current;
    snap.clear();
    offsetAtSnapshotRef.current = scrollOffsetRef.current;
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

  // ── Drop tray data + measurement ───────────────────────────────────────
  // Pull from enrichedItems so tray chips get folderPreview (mosaic thumbs).
  // items[] is the raw state; enrichedItems attaches folderPreview per folder
  // and playbook (see workoutPreviewEntry construction ~L2100). Without this
  // switch, chips fell back to the plain folder icon.
  const trayFolders = useMemo(
    () =>
      recentDropFolderIds
        .map(id => enrichedItems.find(i => (i.type === 'Folder' || i.type === 'Playbooks') && i.id === id))
        .filter(Boolean) as BuildItem[],
    [recentDropFolderIds, enrichedItems],
  );

  // Drop rects for tray items that left the tray — onLayout only fires for
  // mounted views, so removed folders would otherwise leave stale rects.
  useEffect(() => {
    const valid = new Set([TRAY_NEW_FOLDER_KEY, TRAY_NEW_PLAYBOOK_KEY, TRAY_ARCHIVE_KEY, ...trayFolders.map(f => `tray:${f.id}`)]);
    // TRAY_CANCEL_KEY is stored separately (cancelChipAbsRectRef), not in trayItemLayoutsRef.
    trayItemLayoutsRef.current.forEach((_v, k) => {
      if (!valid.has(k)) trayItemLayoutsRef.current.delete(k);
    });
  }, [trayFolders]);

  // Slide the tray up/down. Drop rects come from onLayout, which fires with
  // final layout coords immediately on mount — the slide animation is a
  // transform and doesn't affect them, so drops are valid right away.
  useEffect(() => {
    trayVisibleRef.current = trayVisible;
    if (trayVisible) {
      setTrayMounted(true);
      trayTranslate.value = withTiming(0, { duration: 200 });
      return;
    }
    trayTranslate.value = withTiming(TRAY_SLIDE_DISTANCE, { duration: 180 });
    trayItemLayoutsRef.current.clear();
    cancelChipAbsRectRef.current = null;
    const t = setTimeout(() => setTrayMounted(false), 200);
    return () => clearTimeout(t);
  }, [trayVisible, trayTranslate]);

  const trayAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: trayTranslate.value }],
  }));

  // ── Drag session lifecycle ─────────────────────────────────────────────
  const beginDragSession = useCallback((id: string, ax: number, ay: number) => {
    pointerXRef.current = ax;
    pointerYRef.current = ay;
    // Hide the tab bar for the drag's duration so the drop tray sits flush
    // at the bottom instead of behind/above the tabs.
    navigation.setOptions({ tabBarStyle: { ...TAB_BAR_STYLE, display: 'none' } });
    snapshotLayouts();
    measureListWindow();
    _startDragById(id);
    lockPageScroll();
    startAutoScroll();
    if (trayTimerRef.current) clearTimeout(trayTimerRef.current);
    // No folder tray inside a playbook — drags there only reorder or remove,
    // never reparent into folders.
    if (!currentPlaybookRef.current) {
      trayTimerRef.current = setTimeout(() => setTrayVisible(true), TRAY_SHOW_DELAY_MS);
    }
  }, [snapshotLayouts, measureListWindow, _startDragById, lockPageScroll, startAutoScroll, navigation]);

  // ALL teardown lives here — called from onFinalize, which fires on both
  // normal end and cancel (onEnd never fires when Safari cancels the pointer).
  const endDragSession = useCallback(() => {
    // Only suppress when a drag actually activated — onFinalize also fires on
    // plain taps (failed long-press), which must still open the item.
    if (_dragItemRef.current) suppressPressUntilRef.current = Date.now() + 500;
    stopAutoScroll();
    unlockPageScroll();
    // Inside a playbook the tab bar stays hidden after the drag too (A3).
    if (!currentPlaybookRef.current) {
      navigation.setOptions({ tabBarStyle: TAB_BAR_STYLE });
    }
    if (trayTimerRef.current) {
      clearTimeout(trayTimerRef.current);
      trayTimerRef.current = null;
    }
    setTrayVisible(false);
    clearDragState();
  }, [stopAutoScroll, unlockPageScroll, clearDragState, navigation]);

  // Belt-and-suspenders: never leave page scroll locked or a rAF loop
  // running if the screen unmounts mid-drag.
  useEffect(() => () => {
    stopAutoScroll();
    unlockPageScroll();
    navigation.setOptions({ tabBarStyle: TAB_BAR_STYLE });
    if (trayTimerRef.current) clearTimeout(trayTimerRef.current);
    if (dropToastTimerRef.current) clearTimeout(dropToastTimerRef.current);
  }, [stopAutoScroll, unlockPageScroll, navigation]);

  // Compose with previewEngine.onScroll — it ignores the event payload, but
  // the auto-scroll hit-testing needs the live contentOffset.
  const handleListScroll = useCallback((e: any) => {
    scrollOffsetRef.current = e?.nativeEvent?.contentOffset?.y ?? 0;
    previewEngine.onScroll(e);
  }, [previewEngine.onScroll]);

  // ── Render Helpers ─────────────────────────────────────────────────────
  // Record each tray item's rect (relative to trayRow) the moment layout
  // resolves — no async measure() race with the tray slide animation.
  const registerTrayLayout = useCallback((key: string, item: BuildItem | null) =>
    (e: LayoutChangeEvent) => {
      const { x, y, width, height } = e.nativeEvent.layout;
      trayItemLayoutsRef.current.set(key, { x, y, w: width, h: height, item });
    }, []);

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
        // Folders drag with the same long-press pan as other assets. Drop
        // semantics are constrained by isDropTarget (folder-on-folder nest
        // only) and dropItemIntoFolder (cycle guard).
        const folderDragGesture = Gesture.Pan()
          .activateAfterLongPress(600)
          .onStart((e) => {
            ghostX.value = e.absoluteX - cardWidth / 2 - rootOffX.value;
            ghostY.value = e.absoluteY - cardHeight / 2 - rootOffY.value;
            ghostScale.value = withSpring(1.08, { damping: 15, stiffness: 200 });
            ghostOpacity.value = withSpring(1);
            runOnJS(beginDragSession)(item.id, e.absoluteX, e.absoluteY);
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
            runOnJS(endDragSession)();
          });
        return (
          <GestureDetector gesture={folderDragGesture} touchAction="manipulation" userSelect="none">
          <View
            ref={folderTileRef as any}
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
                backgroundColor: '#1A2332',
              }]}
              onPress={() => {
                if (Date.now() < suppressPressUntilRef.current) return;
                enterFolder(item);
              }}
            >
              {item.folderPreview && item.folderPreview.length > 0 ? (
                <FolderMosaic
                  previews={item.folderPreview}
                  width={cardWidth}
                  height={cardHeight}
                  scrollIdle={previewEngine.scrollState !== 'scrolling'}
                />
              ) : item.coverThumbs && item.coverThumbs.length > 0 ? (
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
              {/* Name overlay — folder icon sits inline to the left of the title */}
              <View style={styles.nameOverlay}>
                <Icon name="folder" size={14} color="#F5A623" />
                <Text style={styles.nameText} numberOfLines={1}>{item.name}</Text>
              </View>
              {item.isArchived && showArchived && (
                <>
                  <View style={styles.archivedPill}>
                    <Text style={styles.archivedPillText}>Archived</Text>
                  </View>
                  <Pressable
                    style={styles.restoreBtn}
                    onPress={async (e) => {
                      e.stopPropagation();
                      try {
                        await updateDoc(doc(db, 'build_folders', item.id), { isArchived: false, updatedAt: serverTimestamp() });
                      } catch (err) { console.error('[Build] Restore folder error:', err); }
                    }}
                  >
                    <Text style={styles.restoreBtnText}>Restore</Text>
                  </Pressable>
                </>
              )}
              {hoveredId === item.id && dragItem && dragItem.id !== item.id && (
                <View style={[StyleSheet.absoluteFill, { borderWidth: 2, borderColor: '#F5A623', borderRadius: 10 }]} pointerEvents="none" />
              )}
            </Pressable>
          </View>
          </GestureDetector>
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

      // Workout and playbook cards use the mosaic (mini-library) layout when they have contents
      const isWorkoutCard = isWorkout;
      const hasMosaic = (isWorkoutCard || isPlaybook) &&
        ((item.coverThumbs ?? []).length > 0 || (item.folderPreview?.length ?? 0) > 0);

      // Preview engine: register tile and check if promoted
      const tilePriority = isMovement ? 1 as const : 2 as const;
      previewEngine.registerTile(item.id, tilePriority);
      const tileAnimating = previewEngine.animatingIds.has(item.id);

      // Shared tile content (media + overlays)
      const tileMedia = (
        <>
          {isPlaybook && (item.folderPreview?.length ?? 0) > 0 ? (
            <FolderMosaic
              previews={item.folderPreview!}
              width={cardWidth}
              height={cardHeight}
              scrollIdle={previewEngine.scrollState !== 'scrolling'}
            />
          ) : (isWorkoutCard || hasMosaic) ? (
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
          {/* Name overlay — type icon sits inline to the left of the title */}
          <View style={[styles.nameOverlay, isWorkoutCard && { backgroundColor: 'rgba(26, 35, 50, 0.92)' }]}>
            {isPlaybook && <Icon name="playbook" size={14} color="#A78BFA" />}
            {isWorkout && <Icon name="workouts" size={14} color="#7DD3FC" />}
            <Text style={styles.nameText} numberOfLines={1}>{item.name}</Text>
          </View>
          {item.isArchived && showArchived && (
            <>
              <View style={styles.archivedPill}>
                <Text style={styles.archivedPillText}>Archived</Text>
              </View>
              <Pressable
                style={styles.restoreBtn}
                onPress={async (e) => {
                  e.stopPropagation();
                  try {
                    const coll = item.type === 'Folder' ? 'build_folders' : COLLECTION_BY_TYPE[item.type as BuildType];
                    await updateDoc(doc(db, coll, item.id), { isArchived: false, updatedAt: serverTimestamp() });
                  } catch (err) { console.error('[Build] Restore error:', err); }
                }}
              >
                <Text style={styles.restoreBtnText}>Restore</Text>
              </Pressable>
            </>
          )}
          {isMovement && !item.videoUrl && !item.mediaUrl && !item.gifLoopUrl && !item.gifLowUrl && (
            <View style={styles.videoNeededPill}>
              <Text style={styles.videoNeededText}>Video needed</Text>
            </View>
          )}
          {isMovement && variationBadges[item.id] && (
            <View style={[styles.remixPill, variationBadges[item.id] === 'ready' && styles.remixPillReady]}>
              <Text style={[styles.remixPillText, variationBadges[item.id] === 'ready' && styles.remixPillTextReady]}>
                {variationBadges[item.id] === 'ready' ? 'Remix ready' : 'Remix in progress'}
              </Text>
            </View>
          )}
          {/* Drop indicator. Inside a playbook, reordering shows a directional
              insertion LINE at the edge where the dragged workout will land:
              dragging from a later position inserts BEFORE the target (left
              edge); from an earlier position inserts AFTER it (right edge) —
              mirrors executeDrop's splice logic. Elsewhere, the highlight
              ring marks tiles that accept the dragged item. */}
          {hoveredId === item.id && dragItem && dragItem.id !== item.id && (
            currentPlaybook ? (
              dragItem.type === 'Workouts' && item.type === 'Workouts' && (() => {
                const fromIdx = filteredItems.findIndex(i => i.id === dragItem.id);
                const toIdx = filteredItems.findIndex(i => i.id === item.id);
                const insertBefore = fromIdx > toIdx;
                return (
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute',
                      top: 6,
                      bottom: 6,
                      width: 3,
                      borderRadius: 2,
                      backgroundColor: '#F5A623',
                      ...(insertBefore ? { left: 0 } : { right: 0 }),
                    }}
                  />
                );
              })()
            ) : (
              isDropTarget(item, dragItem) && (
                <View
                  style={[StyleSheet.absoluteFill, { borderWidth: 2, borderColor: '#F5A623', borderRadius: 10 }]}
                  pointerEvents="none"
                />
              )
            )
          )}
        </>
      );

      // ALL asset tiles (movements, workouts, plans, playbooks, follow-alongs)
      // are draggable via long-press, and all register refs so drop-target
      // hit-testing (workouts/movements as targets of a movement drag) works.
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
            runOnJS(beginDragSession)(item.id, e.absoluteX, e.absoluteY);
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
            // Fires on both end AND cancel — the only reliable cleanup path
            // on iOS Safari, where pointercancel skips onEnd entirely.
            ghostScale.value = withSpring(1, { damping: 20 });
            ghostOpacity.value = withSpring(0);
            runOnJS(endDragSession)();
          });

      return (
        // touchAction: RNGH web defaults to 'none', which blocks touch
        // scrolling on every tile; 'manipulation' keeps scroll working
        // before the long-press activates while blocking double-tap zoom.
        // Once the drag activates, beginDragSession locks page scroll so
        // Safari can't start a native pan and pointercancel the gesture.
        // userSelect: web-only — stops the text-selection magnifier from
        // hijacking the long press.
        <GestureDetector gesture={dragGesture} touchAction="manipulation" userSelect="none">
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
                backgroundColor: (isWorkoutCard || hasMosaic) ? WORKOUT_CARD_BG : '#0E1117',
              }]}
              onPress={() => {
                if (Date.now() < suppressPressUntilRef.current) return;
                if (isMovement) setSelectedMovement(item);
                else if (isPlan) setSelectedPlan(item);
                else if (isPlaybook) enterPlaybook(item);
                else if (isFollowAlong) setSelectedFollowAlong(item);
                else setOpenWorkoutId(item.id);
              }}
            >
              {tileMedia}
            </Pressable>
          </View>
        </GestureDetector>
      );
    }

    // List view
    return (
      <Pressable
        style={s.listItem}
        onPress={() => {
          if (item.type === 'Movements') setSelectedMovement(item);
          else if (item.type === 'Plans') setSelectedPlan(item);
          else if (item.type === 'Playbooks') enterPlaybook(item);
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
            {item.type === 'Movements' && !item.videoUrl && !item.mediaUrl && !item.gifLoopUrl && !item.gifLowUrl && (
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
          onBuildVariation={(m: any) => {
            setSelectedMovement(null);
            setVariationSource(m);
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
        <MovementVariationModal
          visible={!!variationSource}
          sourceMovement={variationSource}
          coachId={coachId}
          tenantId={tenantId}
          onClose={() => setVariationSource(null)}
          onCreated={(movementId: string, movementData: Record<string, any>) => {
            const { createdAt, updatedAt, ...rest } = movementData;
            setSelectedMovement({ id: movementId, ...rest });
          }}
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

      {/* Folder / playbook header — mirrors the workout screen: back arrow,
          Build / crumbs, tappable title to rename. Also a drag drop-zone:
          dropping an asset here moves it up one level (folders) or removes
          the workout from the playbook. */}
      {(folderStack.length > 0 || currentPlaybook) && (
        <View
          ref={folderHeaderRef}
          onLayout={() => {
            folderHeaderRef.current?.measureInWindow((x, y, w, h) => {
              folderHeaderRectRef.current = { x, y, w, h };
            });
          }}
          style={[s.folderHeader, hoveredId === '__parent__' && s.folderHeaderHover]}
        >
          <Pressable onPress={currentPlaybook ? exitPlaybook : goBackFolder} style={s.folderBackBtn}>
            <Icon name="arrow-left" size={20} color="#F0F4F8" />
          </Pressable>
          <View style={s.folderCrumb}>
            <Pressable onPress={() => { setCurrentPlaybook(null); setCurrentFolderId(null); setFolderStack([]); }}>
              <Text style={s.folderCrumbRoot}>Build</Text>
            </Pressable>
            {/* Inside a playbook every folder in the stack is an ancestor
                crumb; in a folder the last entry is the editable title. */}
            {(currentPlaybook ? folderStack : folderStack.slice(0, -1)).map((f, i) => (
              <React.Fragment key={f.id}>
                <Text style={s.folderCrumbSep}>/</Text>
                <Pressable onPress={() => {
                  setCurrentPlaybook(null);
                  const next = folderStack.slice(0, i + 1);
                  setFolderStack(next);
                  setCurrentFolderId(f.id);
                }}>
                  <Text style={s.folderCrumbRoot} numberOfLines={1}>{f.name}</Text>
                </Pressable>
              </React.Fragment>
            ))}
            <Text style={s.folderCrumbSep}>/</Text>
            {currentPlaybook ? (
              editingPlaybookTitle ? (
                <TextInput
                  style={s.folderTitleInput}
                  value={playbookTitleDraft}
                  onChangeText={setPlaybookTitleDraft}
                  onBlur={savePlaybookTitle}
                  onSubmitEditing={savePlaybookTitle}
                  autoFocus
                  selectTextOnFocus
                />
              ) : (
                <Pressable onPress={() => {
                  setPlaybookTitleDraft(currentPlaybook.name);
                  setEditingPlaybookTitle(true);
                }}>
                  <Text style={[s.folderTitleText, { color: '#A78BFA' }]} numberOfLines={1}>
                    {currentPlaybook.name}
                  </Text>
                </Pressable>
              )
            ) : editingFolderTitle ? (
              <TextInput
                style={s.folderTitleInput}
                value={folderTitleDraft}
                onChangeText={setFolderTitleDraft}
                onBlur={saveFolderTitle}
                onSubmitEditing={saveFolderTitle}
                autoFocus
                selectTextOnFocus
              />
            ) : (
              <Pressable onPress={() => {
                setFolderTitleDraft(folderStack[folderStack.length - 1].name);
                setEditingFolderTitle(true);
              }}>
                <Text style={s.folderTitleText} numberOfLines={1}>
                  {folderStack[folderStack.length - 1].name}
                </Text>
              </Pressable>
            )}
          </View>
          {/* A2: member avatar chips — who's on this playbook, at a glance */}
          {currentPlaybook && playbookMemberChips.length > 0 && (
            <View style={s.memberChipRow}>
              {playbookMemberChips.slice(0, 4).map((m) => (
                <View key={m.id} style={s.memberChip}>
                  <Text style={s.memberChipText}>
                    {m.name.split(' ').map((p: string) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                  </Text>
                </View>
              ))}
              {playbookMemberChips.length > 4 && (
                <View style={s.memberChip}>
                  <Text style={s.memberChipText}>+{playbookMemberChips.length - 4}</Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {/* Inside a playbook the toolbar is just the plus button — search and
          filters don't apply to a short ordered workout sequence. */}
      <View style={[s.toolbar, currentPlaybook && { justifyContent: 'flex-end' }]}>
        {!currentPlaybook && (
          <>
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
          </>
        )}

        {currentPlaybook && (
          <Pressable
            style={[s.toolBtn, showPlaybookSchedule && s.toolBtnActive]}
            onPress={() => setShowPlaybookSchedule(true)}
          >
            <Icon name="calendar" size={20} color={showPlaybookSchedule ? '#F5A623' : '#F0F4F8'} />
          </Pressable>
        )}
        {currentPlaybook && (
          <Pressable
            style={[s.toolBtn, showPbMenu && s.toolBtnActive]}
            onPress={() => setShowPbMenu(v => !v)}
          >
            <Icon name="more-vertical" size={20} color={showPbMenu ? '#F5A623' : '#F0F4F8'} />
          </Pressable>
        )}
        <Pressable
          style={s.plusBtn}
          onPress={() => setIsPlusOpen(true)}
        >
          <Icon name="plus" size={24} color="#0E1117" />
        </Pressable>
      </View>

      {/* Playbook settings menu — mirrors the workout three-dot dropdown */}
      {currentPlaybook && showPbMenu && (
        <Pressable style={s.pbMenuOverlay} onPress={() => setShowPbMenu(false)}>
          <View style={s.pbMenuDropdown} onStartShouldSetResponder={() => true}>
            <Pressable
              style={s.pbMenuItem}
              onPress={() => { setShowPbMenu(false); copyPbBookingLink(); }}
            >
              <Icon name="share" size={16} color="#6EBB7A" />
              <Text style={[s.pbMenuItemText, { color: '#6EBB7A' }]}>Copy Booking Link</Text>
            </Pressable>
            <Pressable
              style={s.pbMenuItem}
              onPress={() => { setShowPbMenu(false); previewPbBookingPage(); }}
            >
              <Icon name="eye" size={16} color="#FBBF24" />
              <Text style={[s.pbMenuItemText, { color: '#FBBF24' }]}>Preview Booking Page</Text>
            </Pressable>
            <Pressable
              style={s.pbMenuItem}
              onPress={() => { setShowPbMenu(false); setShowPbRevokeConfirm(true); }}
            >
              <Icon name="block" size={16} color="#F5A623" />
              <Text style={[s.pbMenuItemText, { color: '#F5A623' }]}>Revoke Booking Link</Text>
            </Pressable>
            <View style={s.pbMenuDivider} />
            <Pressable
              style={s.pbMenuItem}
              onPress={() => {
                setShowPbMenu(false);
                setPlaybookTitleDraft(currentPlaybook.name);
                setEditingPlaybookTitle(true);
              }}
            >
              <Icon name="edit" size={16} color="#8A95A3" />
              <Text style={s.pbMenuItemText}>Rename Playbook</Text>
            </Pressable>
            <Pressable
              style={s.pbMenuItem}
              onPress={() => {
                setShowPbMenu(false);
                setPbDescDraft(getCurrentPlaybookDoc()?.description || '');
                setShowPbDescEdit(true);
              }}
            >
              <Icon name="edit" size={16} color="#8A95A3" />
              <Text style={s.pbMenuItemText}>Edit Description</Text>
            </Pressable>
            <Pressable
              style={s.pbMenuItem}
              onPress={() => { setShowPbMenu(false); duplicatePlaybook(); }}
            >
              <Icon name="copy" size={16} color="#8A95A3" />
              <Text style={s.pbMenuItemText}>Duplicate Playbook</Text>
            </Pressable>
            <Pressable
              style={s.pbMenuItem}
              onPress={() => { setShowPbMenu(false); setShowPbMoveTo(true); }}
            >
              <Icon name="arrow-right" size={16} color="#8A95A3" />
              <Text style={s.pbMenuItemText}>Move to Folder</Text>
            </Pressable>
            <Pressable
              style={s.pbMenuItem}
              onPress={() => { setShowPbMenu(false); setShowPbManageMembers(true); }}
            >
              <Icon name="members" size={16} color="#8A95A3" />
              <Text style={s.pbMenuItemText}>Manage Members</Text>
            </Pressable>
            <View style={s.pbMenuDivider} />
            <Pressable
              style={s.pbMenuItem}
              onPress={() => { setShowPbMenu(false); toggleArchivePlaybook(); }}
            >
              <Icon name="archive" size={16} color="#8A95A3" />
              <Text style={s.pbMenuItemText}>
                {items.find(i => i.type === 'Playbooks' && i.id === currentPlaybook.id)?.isArchived
                  ? 'Unarchive Playbook' : 'Archive Playbook'}
              </Text>
            </Pressable>
            <Pressable
              style={s.pbMenuItem}
              onPress={() => { setShowPbMenu(false); setShowPbDeleteConfirm(true); }}
            >
              <Icon name="trash-2" size={16} color="#EF4444" />
              <Text style={[s.pbMenuItemText, { color: '#EF4444' }]}>Delete Playbook</Text>
            </Pressable>
          </View>
        </Pressable>
      )}

      {/* Playbook delete confirm */}
      {currentPlaybook && (
        <Modal transparent visible={showPbDeleteConfirm} animationType="fade" onRequestClose={() => setShowPbDeleteConfirm(false)}>
          <Pressable style={s.pbConfirmBackdrop} onPress={() => setShowPbDeleteConfirm(false)}>
            <Pressable style={s.pbConfirmCard} onPress={(e) => e.stopPropagation()}>
              <Text style={s.pbConfirmTitle}>Delete Playbook?</Text>
              <Text style={s.pbConfirmBody}>
                "{currentPlaybook.name}" will be permanently deleted. The workouts inside it are not deleted.
              </Text>
              <View style={s.pbConfirmRow}>
                <Pressable style={s.pbConfirmCancel} onPress={() => setShowPbDeleteConfirm(false)}>
                  <Text style={s.pbConfirmCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={s.pbConfirmDelete} onPress={confirmDeletePlaybook}>
                  <Text style={s.pbConfirmDeleteText}>Delete</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Playbook description edit */}
      {currentPlaybook && (
        <Modal transparent visible={showPbDescEdit} animationType="fade" onRequestClose={() => setShowPbDescEdit(false)}>
          <Pressable style={s.pbConfirmBackdrop} onPress={() => setShowPbDescEdit(false)}>
            <Pressable style={s.pbConfirmCard} onPress={(e) => e.stopPropagation()}>
              <Text style={s.pbConfirmTitle}>Edit Description</Text>
              <TextInput
                style={s.pbDescInput}
                value={pbDescDraft}
                onChangeText={setPbDescDraft}
                placeholder="What is this playbook for?"
                placeholderTextColor="#4A5568"
                multiline
                autoFocus
              />
              <View style={s.pbConfirmRow}>
                <Pressable style={s.pbConfirmCancel} onPress={() => setShowPbDescEdit(false)}>
                  <Text style={s.pbConfirmCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={s.pbConfirmSave} onPress={savePlaybookDescription}>
                  <Text style={s.pbConfirmDeleteText}>Save</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Playbook revoke-booking-link confirm */}
      {currentPlaybook && (
        <Modal transparent visible={showPbRevokeConfirm} animationType="fade" onRequestClose={() => setShowPbRevokeConfirm(false)}>
          <Pressable style={s.pbConfirmBackdrop} onPress={() => !pbRevokeBusy && setShowPbRevokeConfirm(false)}>
            <Pressable style={s.pbConfirmCard} onPress={(e) => e.stopPropagation()}>
              <Text style={s.pbConfirmTitle}>Revoke Booking Link?</Text>
              <Text style={s.pbConfirmBody}>
                Anyone with the current link will no longer be able to book. Existing booked sessions are not affected.
              </Text>
              <View style={s.pbConfirmRow}>
                <Pressable style={s.pbConfirmCancel} onPress={() => setShowPbRevokeConfirm(false)} disabled={pbRevokeBusy}>
                  <Text style={s.pbConfirmCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={s.pbConfirmCancel} onPress={() => revokePbBookingLink(false)} disabled={pbRevokeBusy}>
                  <Text style={s.pbConfirmCancelText}>{pbRevokeBusy ? 'Working...' : 'Revoke Only'}</Text>
                </Pressable>
                <Pressable style={s.pbConfirmSave} onPress={() => revokePbBookingLink(true)} disabled={pbRevokeBusy}>
                  <Text style={s.pbConfirmDeleteText}>{pbRevokeBusy ? 'Working...' : 'Revoke + New Link'}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Playbook move-to-folder sheet */}
      {currentPlaybook && (
        <Modal transparent visible={showPbMoveTo} animationType="slide" onRequestClose={() => setShowPbMoveTo(false)}>
          <Pressable style={s.pbSheetBackdrop} onPress={() => setShowPbMoveTo(false)}>
            <Pressable style={s.pbSheet} onPress={(e) => e.stopPropagation()}>
              <Text style={s.pbSheetTitle}>Move to Folder</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                {(() => {
                  const pbDoc = items.find(i => i.type === 'Playbooks' && i.id === currentPlaybook.id);
                  const currentParent = pbDoc?.parentId || null;
                  const folders = items
                    .filter(i => (i.type as any) === 'Folder' && !i.isArchived)
                    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
                  return (
                    <>
                      <Pressable
                        style={s.pbSheetMemberRow}
                        onPress={() => movePlaybookToFolder(null)}
                        disabled={!currentParent}
                      >
                        <Icon name="build" size={16} color="#8A95A3" />
                        <Text style={[s.pbSheetMemberName, { flex: 1, marginLeft: 10 }]}>Build (top level)</Text>
                        <Text style={s.pbSheetMemberAdd}>{currentParent ? 'Move' : 'Current'}</Text>
                      </Pressable>
                      {folders.length === 0 && (
                        <Text style={s.pbSheetEmpty}>No folders yet — create one from the Build grid.</Text>
                      )}
                      {folders.map(f => (
                        <Pressable
                          key={f.id}
                          style={s.pbSheetMemberRow}
                          onPress={() => movePlaybookToFolder(f.id)}
                          disabled={currentParent === f.id}
                        >
                          <Icon name="plan" size={16} color="#60A5FA" />
                          <Text style={[s.pbSheetMemberName, { flex: 1, marginLeft: 10 }]} numberOfLines={1}>{f.name}</Text>
                          <Text style={s.pbSheetMemberAdd}>{currentParent === f.id ? 'Current' : 'Move'}</Text>
                        </Pressable>
                      ))}
                    </>
                  );
                })()}
              </ScrollView>
              <Pressable style={s.pbSheetDone} onPress={() => setShowPbMoveTo(false)}>
                <Text style={s.pbSheetDoneText}>Done</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Playbook manage-members sheet */}
      {currentPlaybook && (
        <Modal transparent visible={showPbManageMembers} animationType="slide" onRequestClose={() => setShowPbManageMembers(false)}>
          <Pressable style={s.pbSheetBackdrop} onPress={() => setShowPbManageMembers(false)}>
            <Pressable style={s.pbSheet} onPress={(e) => e.stopPropagation()}>
              <Text style={s.pbSheetTitle}>Members</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                {playbookMemberChips.length === 0 ? (
                  <Text style={s.pbSheetEmpty}>No members on this playbook yet.</Text>
                ) : (
                  playbookMemberChips.map(m => (
                    <View key={m.id} style={s.pbSheetMemberRow}>
                      <Text style={[s.pbSheetMemberName, { flex: 1 }]} numberOfLines={1}>{m.name}</Text>
                      <Pressable onPress={() => removeMemberFromPlaybook(m.id)}>
                        <Text style={[s.pbSheetMemberAdd, { color: '#EF4444' }]}>Remove</Text>
                      </Pressable>
                    </View>
                  ))
                )}
              </ScrollView>
              <Pressable
                style={[s.pbSheetDone, { backgroundColor: '#2A3544', marginTop: 10 }]}
                onPress={() => { setShowPbManageMembers(false); setPbAddMemberOpen(true); }}
              >
                <Text style={[s.pbSheetDoneText, { color: '#F0F4F8' }]}>Add Member</Text>
              </Pressable>
              <Pressable style={s.pbSheetDone} onPress={() => setShowPbManageMembers(false)}>
                <Text style={s.pbSheetDoneText}>Done</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Playbook scheduling — dead-simple panel over the drill-in */}
      {currentPlaybook && (
        <PlaybookSchedulePanel
          playbookId={currentPlaybook.id}
          visible={showPlaybookSchedule}
          onClose={() => setShowPlaybookSchedule(false)}
        />
      )}

      {/* A1: add-workout sheet — mosaic grid of every coach workout not
          already in this playbook; tap to add, sheet stays open for more. */}
      {currentPlaybook && (
        <Modal transparent visible={pbAddWorkoutOpen} animationType="slide" onRequestClose={() => setPbAddWorkoutOpen(false)}>
          <Pressable style={s.pbSheetBackdrop} onPress={() => setPbAddWorkoutOpen(false)}>
            <Pressable style={s.pbSheet} onPress={(e) => e.stopPropagation()}>
              <Text style={s.pbSheetTitle}>Add Workout</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={s.pbSheetGrid}>
                  {(() => {
                    const pbDoc = items.find(i => i.type === 'Playbooks' && i.id === currentPlaybook.id);
                    const inIds: string[] = Array.isArray(pbDoc?.workoutIds) ? pbDoc!.workoutIds : [];
                    const avail = items
                      .filter(i => i.type === 'Workouts' && !i.isArchived && !inIds.includes(i.id))
                      .sort((a, b) => (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0));
                    if (avail.length === 0) {
                      return <Text style={s.pbSheetEmpty}>All your workouts are already in this playbook.</Text>;
                    }
                    return avail.map(w => {
                      const thumbs = (Array.isArray(w.coverThumbs) && w.coverThumbs.length
                        ? w.coverThumbs
                        : [{ name: w.name }]) as (string | { name: string })[];
                      return (
                        <Pressable key={w.id} style={s.pbSheetTile} onPress={() => addWorkoutToPlaybook(w.id)}>
                          <View style={s.pbSheetTileMosaic}>
                            <WorkoutMosaic thumbs={thumbs} width={104} height={104} />
                          </View>
                          <Text style={s.pbSheetTileName} numberOfLines={1}>{w.name}</Text>
                        </Pressable>
                      );
                    });
                  })()}
                </View>
              </ScrollView>
              <Pressable style={s.pbSheetDone} onPress={() => setPbAddWorkoutOpen(false)}>
                <Text style={s.pbSheetDoneText}>Done</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* A1: add-member sheet — coach's member list, tap to add */}
      {currentPlaybook && (
        <Modal transparent visible={pbAddMemberOpen} animationType="slide" onRequestClose={() => setPbAddMemberOpen(false)}>
          <Pressable style={s.pbSheetBackdrop} onPress={() => setPbAddMemberOpen(false)}>
            <Pressable style={s.pbSheet} onPress={(e) => e.stopPropagation()}>
              <Text style={s.pbSheetTitle}>Add Member</Text>
              <ScrollView showsVerticalScrollIndicator={false}>
                {(() => {
                  const onIds = playbookMemberChips.map(c => c.id);
                  const avail = pbMembers.filter(m => !onIds.includes(m.id));
                  if (avail.length === 0) {
                    return <Text style={s.pbSheetEmpty}>All your members are already on this playbook.</Text>;
                  }
                  return avail.map(m => (
                    <Pressable
                      key={m.id}
                      style={s.pbSheetMemberRow}
                      onPress={() => { addMemberToPlaybook(m.id); setPbAddMemberOpen(false); }}
                    >
                      <Text style={s.pbSheetMemberName} numberOfLines={1}>{m.name}</Text>
                      <Text style={s.pbSheetMemberAdd}>Add</Text>
                    </Pressable>
                  ));
                })()}
              </ScrollView>
              <Pressable style={s.pbSheetDone} onPress={() => setPbAddMemberOpen(false)}>
                <Text style={s.pbSheetDoneText}>Done</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* A1: create member — existing intake form; new member joins the playbook */}
      {currentPlaybook && (
        <QuickAddMember
          visible={pbQuickAddOpen}
          onClose={() => setPbQuickAddOpen(false)}
          onSaved={(memberId) => { if (memberId) addMemberToPlaybook(memberId); }}
          coachId={coachId || ''}
          tenantId={tenantId}
        />
      )}

      {!currentPlaybook && isFilterOpen && (
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
        // Wrapper ref gives the drag session the list viewport's absolute
        // top/height for the edge auto-scroll bands.
        <View
          ref={listContainerRef}
          style={{ flex: 1 }}
          collapsable={false}
          onLayout={() => {
            requestAnimationFrame(measureListWindow);
          }}
        >
          <FlatList
            ref={listRef}
            data={filteredItems}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            numColumns={viewMode === 'grid' ? cols : 1}
            key={viewMode === 'grid' ? `grid-${cols}` : 'list'}
            contentContainerStyle={{
              paddingHorizontal: GRID_PADDING,
              paddingTop: GRID_PADDING,
              paddingBottom: CONTENT_BOTTOM_CLEARANCE,
            }}
            columnWrapperStyle={viewMode === 'grid' ? {
              gap: GRID_GAP,
              marginBottom: 0,
            } : undefined}
            extraData={previewEngine.animatingIds}
            refreshControl={
              <RefreshControl refreshing={loading} onRefresh={() => setLoading(true)} tintColor="#F5A623" />
            }
            onScroll={handleListScroll}
            scrollEventThrottle={16}
            scrollEnabled={!dragItem}
            onViewableItemsChanged={previewEngine.onViewableItemsChanged}
            viewabilityConfig={previewEngine.viewabilityConfig}
          />
        </View>
      ) : (
        <View style={s.centered}>
          <Icon name={currentPlaybook ? 'playbook' : 'build'} size={48} color="#1E2A3A" />
          <Text style={s.emptyTitle}>{currentPlaybook ? 'No Workouts Yet' : 'Nothing Found'}</Text>
          <Text style={s.emptyDesc}>
            {currentPlaybook
              ? 'Drag workouts onto this playbook from the Build grid to add them.'
              : 'Try adjusting your search or filters.'}
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
        onBuildVariation={(m: any) => {
          setSelectedMovement(null);
          setVariationSource(m);
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

      <MovementVariationModal
        visible={!!variationSource}
        sourceMovement={variationSource}
        coachId={coachId}
        tenantId={tenantId}
        onClose={() => setVariationSource(null)}
        onCreated={(movementId: string, movementData: Record<string, any>) => {
          const { createdAt, updatedAt, ...rest } = movementData;
          setSelectedMovement({ id: movementId, ...rest });
        }}
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
        parentId={currentFolderId || null}
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
            <Text style={s.plusMenuTitle}>{currentPlaybook ? 'Create or Add' : 'Create New'}</Text>
            {currentPlaybook && (
              <Pressable
                style={s.plusMenuItem}
                onPress={() => { setIsPlusOpen(false); setPbAddWorkoutOpen(true); }}
              >
                <Icon name="workouts" size={20} color="#A78BFA" />
                <Text style={s.plusMenuItemText}>Add Workout</Text>
              </Pressable>
            )}
            {!currentPlaybook && (
              <>
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
              </>
            )}
            <Pressable
              style={s.plusMenuItem}
              onPress={async () => {
                setIsPlusOpen(false);
                const pb = currentPlaybookRef.current;
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
                  // Inside a playbook: the new workout joins the sequence,
                  // then the coach lands straight in it to add movements.
                  if (pb) {
                    await updateDoc(doc(db, 'playbooks', pb.id), {
                      workoutIds: arrayUnion(newWorkoutRef.id),
                      updatedAt: serverTimestamp(),
                    });
                  }
                  setOpenWorkoutId(newWorkoutRef.id);
                } catch (e) {
                  console.error('Create workout error:', e);
                }
              }}
            >
              <Icon name="workouts" size={20} color="#F0F4F8" />
              <Text style={s.plusMenuItemText}>{currentPlaybook ? 'Create Workout' : 'Workout'}</Text>
            </Pressable>
            {currentPlaybook && (
              <>
                <Pressable
                  style={s.plusMenuItem}
                  onPress={() => { setIsPlusOpen(false); setPbAddMemberOpen(true); }}
                >
                  <Icon name="members" size={20} color="#A78BFA" />
                  <Text style={s.plusMenuItemText}>Add Member</Text>
                </Pressable>
                <Pressable
                  style={s.plusMenuItem}
                  onPress={() => { setIsPlusOpen(false); setPbQuickAddOpen(true); }}
                >
                  <Icon name="members" size={20} color="#22C55E" />
                  <Text style={s.plusMenuItemText}>Create Member</Text>
                </Pressable>
              </>
            )}
            {!currentPlaybook && (
              <>
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
              </>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* Folder Create Modal */}
      <Modal transparent visible={showFolderCreate} animationType="fade" onRequestClose={() => { setShowFolderCreate(false); setPendingFolderDropItem(null); }}>
        <Pressable style={s.modalBackdrop} onPress={() => { setShowFolderCreate(false); setPendingFolderDropItem(null); }}>
          <Pressable style={s.plusMenu} onPress={e => e.stopPropagation()}>
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
                onPress={() => { setShowFolderCreate(false); setNewFolderName(''); setPendingFolderDropItem(null); }}
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
          </Pressable>
        </Pressable>
      </Modal>

      {/* Plan Create Modal */}
      <Modal transparent visible={showPlanCreate} animationType="fade" onRequestClose={() => setShowPlanCreate(false)}>
        <Pressable style={s.modalBackdrop} onPress={() => setShowPlanCreate(false)}>
          <Pressable style={s.plusMenu} onPress={e => e.stopPropagation()}>
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
          </Pressable>
        </Pressable>
      </Modal>

      {/* Playbook Create Modal — title + description, then assignment: pick
          an existing member or add a new one by name + email. */}
      <Modal transparent visible={showPlaybookCreate} animationType="fade" onRequestClose={resetPlaybookCreateState}>
        <Pressable style={s.modalBackdrop} onPress={resetPlaybookCreateState}>
          <Pressable style={[s.plusMenu, { maxHeight: '85%' }]} onPress={e => e.stopPropagation()}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
              <Text style={[s.filterTitle, { marginTop: 16 }]}>Assign to Member</Text>
              {!pbAddByEmail && pbMembers.map(m => (
                <Pressable
                  key={m.id}
                  style={[s.plusMenuItem, pbAssignMemberId === m.id && { backgroundColor: '#1E2A3A', borderRadius: 8 }]}
                  onPress={() => setPbAssignMemberId(prev => (prev === m.id ? null : m.id))}
                >
                  <Icon name={pbAssignMemberId === m.id ? 'check' : 'members'} size={18} color={pbAssignMemberId === m.id ? '#A78BFA' : '#8A95A3'} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.plusMenuItemText} numberOfLines={1}>{m.name}</Text>
                    {!!m.email && <Text style={{ color: '#4A5568', fontSize: 12, fontFamily: FB }} numberOfLines={1}>{m.email}</Text>}
                  </View>
                </Pressable>
              ))}
              {!pbAddByEmail ? (
                <Pressable style={s.plusMenuItem} onPress={() => { setPbAddByEmail(true); setPbAssignMemberId(null); }}>
                  <Icon name="plus" size={18} color="#A78BFA" />
                  <Text style={[s.plusMenuItemText, { color: '#A78BFA' }]}>Add a member by email</Text>
                </Pressable>
              ) : (
                <>
                  <TextInput
                    style={[s.folderInput, { marginTop: 8 }]}
                    placeholder="Member name..."
                    placeholderTextColor="#4A5568"
                    value={pbNewMemberName}
                    onChangeText={setPbNewMemberName}
                  />
                  <TextInput
                    style={[s.folderInput, { marginTop: 10 }]}
                    placeholder="Member email address..."
                    placeholderTextColor="#4A5568"
                    value={pbNewMemberEmail}
                    onChangeText={setPbNewMemberEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                  <Pressable style={s.plusMenuItem} onPress={() => { setPbAddByEmail(false); setPbNewMemberName(''); setPbNewMemberEmail(''); }}>
                    <Icon name="members" size={18} color="#8A95A3" />
                    <Text style={[s.plusMenuItemText, { color: '#8A95A3' }]}>Pick an existing member instead</Text>
                  </Pressable>
                </>
              )}
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
                <Pressable
                  style={[s.folderBtn, { backgroundColor: '#1E2A3A' }]}
                  onPress={resetPlaybookCreateState}
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
            </ScrollView>
          </Pressable>
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

      {/* Drop action modal: Movement dropped on another Movement */}
      <Modal transparent visible={!!dropModal} animationType="fade" onRequestClose={() => setDropModal(null)}>
        <Pressable style={s.modalBackdrop} onPress={() => setDropModal(null)}>
          <View style={s.plusMenu} onStartShouldSetResponder={() => true}>
            <Text style={s.plusMenuTitle}>
              {dropModal?.drag.type === 'Movements' && dropModal?.target.type === 'Movements' ? 'Combine Movements' : 'Combine Items'}
            </Text>
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
            {/* New Workout only applies to two movements — other asset types
                can't become workout blocks. */}
            {dropModal?.drag.type === 'Movements' && dropModal?.target.type === 'Movements' && (
              <Pressable
                style={[s.plusMenuItem, { backgroundColor: '#1E2A3A', borderRadius: 10, paddingVertical: 14 }]}
                onPress={createWorkoutFromDrop}
              >
                <Icon name="workouts" size={22} color="#60A5FA" />
                <Text style={[s.plusMenuItemText, { fontSize: 15 }]}>Create Workout</Text>
              </Pressable>
            )}
            {/* New Playbook only applies to two workouts — playbooks are
                workouts-only membership. */}
            {dropModal?.drag.type === 'Workouts' && dropModal?.target.type === 'Workouts' && (
              <Pressable
                style={[s.plusMenuItem, { backgroundColor: '#1E2A3A', borderRadius: 10, paddingVertical: 14 }]}
                onPress={createPlaybookFromDrop}
              >
                <Icon name="playbook" size={22} color="#A78BFA" />
                <Text style={[s.plusMenuItemText, { fontSize: 15 }]}>Create Playbook</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* Tray "New" drop chooser: Folder or Workout */}
      <Modal transparent visible={!!trayDropChooserItem} animationType="fade" onRequestClose={() => setTrayDropChooserItem(null)}>
        <Pressable style={s.modalBackdrop} onPress={() => setTrayDropChooserItem(null)}>
          <View style={s.plusMenu} onStartShouldSetResponder={() => true}>
            <Text style={s.plusMenuTitle}>Add to New</Text>
            <Text style={{ color: '#8A95A3', fontSize: 13, fontFamily: FB, marginBottom: 20, textAlign: 'center' }}>
              {trayDropChooserItem?.name}
            </Text>
            <Pressable
              style={[s.plusMenuItem, { backgroundColor: '#1E2A3A', borderRadius: 10, paddingVertical: 14, marginBottom: 10 }]}
              onPress={() => {
                const item = trayDropChooserItem;
                setTrayDropChooserItem(null);
                if (item) {
                  setPendingFolderDropItem(item);
                  setShowFolderCreate(true);
                }
              }}
            >
              <Icon name="folder" size={22} color="#F5A623" />
              <Text style={[s.plusMenuItemText, { fontSize: 15 }]}>New Folder</Text>
            </Pressable>
            {/* New Workout only applies to a dragged movement — other asset
                types can't become a workout block. */}
            {trayDropChooserItem?.type === 'Movements' && (
              <Pressable
                style={[s.plusMenuItem, { backgroundColor: '#1E2A3A', borderRadius: 10, paddingVertical: 14 }]}
                onPress={createWorkoutFromTrayDrop}
              >
                <Icon name="workouts" size={22} color="#60A5FA" />
                <Text style={[s.plusMenuItemText, { fontSize: 15 }]}>New Workout</Text>
              </Pressable>
            )}
            {/* New Playbook only applies to a dragged workout — playbooks are
                workouts-only membership. */}
            {trayDropChooserItem?.type === 'Workouts' && (
              <Pressable
                style={[s.plusMenuItem, { backgroundColor: '#1E2A3A', borderRadius: 10, paddingVertical: 14 }]}
                onPress={() => {
                  const item = trayDropChooserItem;
                  setTrayDropChooserItem(null);
                  if (item) {
                    setPendingPlaybookDropItem(item);
                    setShowPlaybookCreate(true);
                  }
                }}
              >
                <Icon name="playbook" size={22} color="#A78BFA" />
                <Text style={[s.plusMenuItemText, { fontSize: 15 }]}>New Playbook</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* Bottom drop tray — Canva-style dock: recent drop folders + New Folder.
          pointerEvents none — the pan gesture owns the pointer; tray items are
          hit-tested by coordinates (findTrayTarget), not touch handlers. */}
      {trayMounted && (
        <Reanimated.View
          // height pinned so iOS Safari can't resolve the position:absolute +
          // bottom:0 container's intrinsic size to a viewport-relative value
          // (observed: tray stretched to ~540px on iPhone even though children
          // total ~196 + insets.bottom). overflow:hidden clips any residual
          // child stretch. Breakdown of the height: 20 paddingTop + 36
          // ScrollView paddingVertical + (TRAY_HEIGHT - 24 = 124) chip + 16
          // paddingBottom base + insets.bottom = 196 + insets.bottom.
          style={[
            s.tray,
            trayAnimStyle,
            {
              paddingBottom: insets.bottom + 16,
              height: 20 + 36 + (TRAY_HEIGHT - 24) + 16 + insets.bottom,
              overflow: 'hidden',
            },
          ]}
          pointerEvents="none"
        >
          <ScrollView
            ref={trayScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEnabled={false} // drag session drives horizontal scroll via ref
            // paddingVertical: 18 gives the hover pop (scale 1.16 + translateY -4 + 8px accent glow)
            // room to render without being sliced by RN Web's overflow-y: hidden default.
            // flexGrow:0 stops RN Web's ScrollView outer from taking flex:1 in
            // the tray, which paired with position:absolute parents can cascade
            // into a viewport-height stretch on iOS Safari.
            style={{ flexGrow: 0, flexShrink: 0 }}
            contentContainerStyle={{ paddingRight: AUTO_SCROLL_HOTSPOT_W + 12, paddingVertical: 18 }}
            onLayout={e => { trayViewportWidthRef.current = e.nativeEvent.layout.width; }}
            onContentSizeChange={w => { trayContentWidthRef.current = w; }}
          >
            <View
              ref={trayRowRef}
              style={s.trayRow}
              collapsable={false}
              onLayout={() => {
                // Measure after the slide-in settles so pageY reflects rest position.
                setTimeout(() => {
                  // Skip if the tray is already hiding — a mid-slide-down
                  // measurement would store a too-large top and break the
                  // next drag's tray drops.
                  if (!trayVisibleRef.current) return;
                  trayRowRef.current?.measureInWindow((_x, y) => {
                    if (!trayVisibleRef.current) return;
                    const windowH = Dimensions.get('window').height;
                    if (Number.isFinite(y) && y > 0 && y < windowH) trayRowTopRef.current = y;
                  });
                  // Measure the Cancel chip absolute position for hit-testing.
                  cancelChipRef.current?.measureInWindow((cx, cy, cw, ch) => {
                    if (Number.isFinite(cx) && cw > 0) {
                      cancelChipAbsRectRef.current = { x: cx, y: cy, w: cw, h: ch };
                    }
                  });
                }, 300);
              }}
            >
              {trayFolders.map(f => {
                const trayKey = `tray:${f.id}`;
                const isPlaybook = f.type === 'Playbooks';
                // Hide playbook chips in the tray unless the current drag is a
                // workout (playbooks are workouts-only membership).
                if (isPlaybook && dragItem?.type !== 'Workouts') return null;
                const accent = isPlaybook ? PLAYBOOK_ACCENT : FOLDER_ACCENT;
                const hovered = hoveredId === trayKey;
                return (
                  <TrayChip
                    key={trayKey}
                    accent={accent}
                    hovered={hovered}
                    onLayout={registerTrayLayout(trayKey, f)}
                  >
                    <TrayChipContents item={f} accent={accent} isPlaybook={isPlaybook} />
                  </TrayChip>
                );
              })}
              <TrayChip
                accent={FOLDER_ACCENT}
                hovered={hoveredId === TRAY_NEW_FOLDER_KEY}
                onLayout={registerTrayLayout(TRAY_NEW_FOLDER_KEY, null)}
              >
                <Icon name="plus" size={22} color={FOLDER_ACCENT} />
                <Text style={s.trayItemText} numberOfLines={1}>New Folder</Text>
              </TrayChip>
              {/* Playbooks are workouts-only, so the target only appears when a
                  workout is being dragged. */}
              {dragItem?.type === 'Workouts' && (
                <TrayChip
                  accent={PLAYBOOK_ACCENT}
                  hovered={hoveredId === TRAY_NEW_PLAYBOOK_KEY}
                  onLayout={registerTrayLayout(TRAY_NEW_PLAYBOOK_KEY, null)}
                >
                  <Icon name="playbook" size={22} color={PLAYBOOK_ACCENT} />
                  <Text style={s.trayItemText} numberOfLines={1}>New Playbook</Text>
                </TrayChip>
              )}
              {/* Archive chip — always visible during any drag. Red-outlined. */}
              <TrayChip
                accent="#E05252"
                hovered={hoveredId === TRAY_ARCHIVE_KEY}
                onLayout={registerTrayLayout(TRAY_ARCHIVE_KEY, null)}
              >
                <Icon name="archive" size={22} color="#E05252" />
                <Text style={[s.trayItemText, { color: '#E05252' }]} numberOfLines={1}>Archive</Text>
              </TrayChip>
            </View>
          </ScrollView>
          {/* Cancel chip — pinned to the far right, fixed position outside the
              horizontal ScrollView so it stays visible regardless of scroll.
              Replaces the old chevron-down affordance visually. The auto-scroll
              hotspot logic (pointer > windowW - AUTO_SCROLL_HOTSPOT_W) is purely
              coordinate-based and is unaffected by this visual change. */}
          {dragItem && (
            <View
              ref={cancelChipRef}
              pointerEvents="none"
              style={{
                position: 'absolute',
                right: 12,
                bottom: insets.bottom + 16 + 18,
                height: TRAY_HEIGHT - 24,
                width: AUTO_SCROLL_HOTSPOT_W - 16,
                borderRadius: 12,
                backgroundColor: '#0E1117',
                borderWidth: hoveredId === TRAY_CANCEL_KEY ? 2 : 1,
                borderColor: hoveredId === TRAY_CANCEL_KEY ? '#94A3B8' : '#2D3B4E',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 4,
                ...(hoveredId === TRAY_CANCEL_KEY ? {
                  shadowColor: '#94A3B8',
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.5,
                  shadowRadius: 6,
                  elevation: 6,
                } : {}),
              }}
            >
              <Icon name="close" size={20} color={hoveredId === TRAY_CANCEL_KEY ? '#94A3B8' : '#4A5568'} />
              <Text style={{ color: hoveredId === TRAY_CANCEL_KEY ? '#94A3B8' : '#4A5568', fontSize: 10, fontWeight: '700' }}>Cancel</Text>
            </View>
          )}
        </Reanimated.View>
      )}


      {/* Archive confirmation modal — triggered by dropping an item on the Archive tray chip */}
      <Modal transparent visible={showArchiveConfirm} animationType="fade" onRequestClose={() => { setShowArchiveConfirm(false); setPendingArchiveItem(null); }}>
        <Pressable style={s.pbConfirmBackdrop} onPress={() => { setShowArchiveConfirm(false); setPendingArchiveItem(null); }}>
          <Pressable style={s.pbConfirmCard} onPress={(e) => e.stopPropagation()}>
            <Text style={[s.pbConfirmTitle, { color: '#E05252' }]}>Archive {pendingArchiveItem?.name ? `"${pendingArchiveItem.name}"` : 'item'}?</Text>
            <Text style={s.pbConfirmBody}>You can restore it later from the Archived view.</Text>
            <View style={s.pbConfirmRow}>
              <Pressable style={s.pbConfirmCancel} onPress={() => { setShowArchiveConfirm(false); setPendingArchiveItem(null); }}>
                <Text style={s.pbConfirmCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={s.pbConfirmDelete} onPress={confirmArchiveItem}>
                <Text style={s.pbConfirmDeleteText}>Archive</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Drop rejected toast — shows briefly when a drop is silently blocked */}
      {dropToast && (
        <View pointerEvents="none" style={{
          position: 'absolute', bottom: 120 + insets.bottom, left: 24, right: 24,
          backgroundColor: 'rgba(30,42,58,0.95)', borderRadius: 10, paddingVertical: 10, paddingHorizontal: 16,
          borderWidth: 1, borderColor: '#F5A623', alignItems: 'center',
        }}>
          <Text style={{ color: '#F0F4F8', fontSize: 14, fontWeight: '600', textAlign: 'center' }}>{dropToast}</Text>
        </View>
      )}

      {/* Drag ghost tile — floats above everything during drag */}
      <Reanimated.View style={[ghostAnimStyle, { width: cardWidth, height: cardHeight, borderRadius: 10 }]} pointerEvents="none">
        {dragItem && (
          <View style={{ flex: 1, borderRadius: 10, overflow: 'hidden', backgroundColor: '#0E1117' }}>
            {(dragItem.thumbnailUrl || dragItem.thumbnailImageUrl || dragItem.gifLowUrl || dragItem.mediaUrl) ? (
              <Image
                source={{ uri: (dragItem.thumbnailUrl || dragItem.thumbnailImageUrl || dragItem.gifLowUrl || dragItem.mediaUrl)! }}
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  nameText: {
    color: '#F0F4F8',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold',
    flex: 1,
    minWidth: 0,
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
  remixPill: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(167,139,250,0.25)',
  },
  remixPillReady: {
    backgroundColor: 'rgba(52,211,153,0.25)',
  },
  remixPillText: {
    fontSize: 8,
    color: '#A78BFA',
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-SemiBold',
  },
  remixPillTextReady: {
    color: '#34D399',
  },
  archivedPill: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(224,82,82,0.18)',
  },
  archivedPillText: {
    fontSize: 8,
    color: '#E05252',
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-SemiBold',
  },
  restoreBtn: {
    position: 'absolute',
    bottom: 30,
    left: 8,
    right: 8,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: 'rgba(30,42,58,0.88)',
    borderWidth: 1,
    borderColor: '#94A3B8',
    alignItems: 'center',
  },
  restoreBtnText: {
    fontSize: 10,
    color: '#94A3B8',
    fontWeight: '700',
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
    position: 'relative',
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
  folderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  folderHeaderHover: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderBottomColor: '#F5A623',
  },
  folderBackBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  folderCrumb: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  folderCrumbRoot: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
    fontWeight: '600',
    maxWidth: 110,
  },
  folderCrumbSep: {
    fontSize: 14,
    color: '#4A5568',
    fontFamily: FB,
  },
  folderTitleText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    maxWidth: 200,
  },
  folderTitleInput: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    borderBottomWidth: 1,
    borderBottomColor: '#F5A623',
    paddingVertical: 2,
    minWidth: 120,
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
  tray: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0, // tab bar is hidden for the drag's duration, so the tray owns the bottom edge on all platforms
    backgroundColor: '#0E1117',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    paddingTop: 20,
    paddingHorizontal: 12,
    zIndex: 9000,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
  },
  trayRow: {
    flexDirection: 'row',
    gap: 10,
  },
  trayItem: {
    flex: 1,
    maxWidth: 110,
    height: TRAY_HEIGHT - 24,
    backgroundColor: '#1A2332',
    borderWidth: 1,
    borderColor: '#1E2A3A',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  trayItemHovered: {
    borderWidth: 2,
    borderColor: '#F5A623',
  },
  trayItemText: {
    color: '#F0F4F8',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: FB,
    textAlign: 'center',
  },
  memberChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 8,
  },
  memberChip: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#A78BFA',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -6,
    borderWidth: 1.5,
    borderColor: '#0E1117',
  },
  memberChipText: {
    color: '#0E1117',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: FH,
  },
  // Playbook settings menu (mirrors WorkoutFolderPage title menu)
  pbMenuOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 100,
  },
  pbMenuDropdown: {
    position: 'absolute',
    top: 168,
    right: 72,
    backgroundColor: '#1E2A3A',
    borderRadius: 12,
    padding: 8,
    minWidth: 220,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 101,
  },
  pbMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  pbMenuItemText: {
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '500',
  },
  pbMenuDivider: {
    height: 1,
    backgroundColor: '#2A3544',
    marginVertical: 4,
    marginHorizontal: 8,
  },
  pbConfirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  pbConfirmCard: {
    backgroundColor: '#1E2A3A',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 420,
  },
  pbConfirmTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 8,
  },
  pbConfirmBody: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
    lineHeight: 20,
    marginBottom: 16,
  },
  pbConfirmRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  pbConfirmCancel: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#2A3544',
  },
  pbConfirmCancelText: {
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '600',
  },
  pbConfirmDelete: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#EF4444',
  },
  pbConfirmSave: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#A78BFA',
  },
  pbConfirmDeleteText: {
    fontSize: 14,
    color: '#0E1117',
    fontFamily: FB,
    fontWeight: '700',
  },
  pbDescInput: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A3544',
    color: '#F0F4F8',
    fontFamily: FB,
    fontSize: 14,
    padding: 12,
    minHeight: 90,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  pbSheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  pbSheet: {
    backgroundColor: '#1E2A3A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    maxHeight: '80%',
  },
  pbSheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 12,
  },
  pbSheetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  pbSheetTile: {
    width: 104,
  },
  pbSheetTileMosaic: {
    width: 104,
    height: 104,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#0E1117',
  },
  pbSheetTileName: {
    color: '#F0F4F8',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: FB,
    marginTop: 4,
  },
  pbSheetEmpty: {
    color: '#8A95A3',
    fontSize: 13,
    fontFamily: FB,
    paddingVertical: 12,
  },
  pbSheetMemberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0E1117',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    gap: 8,
  },
  pbSheetMemberName: {
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    flex: 1,
  },
  pbSheetMemberAdd: {
    color: '#A78BFA',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FB,
  },
  pbSheetDone: {
    marginTop: 14,
    backgroundColor: '#A78BFA',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  pbSheetDoneText: {
    color: '#0E1117',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
  },
});
