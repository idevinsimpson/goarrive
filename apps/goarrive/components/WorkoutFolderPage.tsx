/**
 * WorkoutFolderPage — Folder-based Workout Editor
 *
 * v3 — Comprehensive bug-fix + feature update:
 *   - Quick controls rendered as portal overlay (no z-index clipping)
 *   - Tap-outside properly dismisses all overlays
 *   - Auto-save with dirty flag prevents onSnapshot overwrite
 *   - Block control bar stretches left: trash | rounds ±  | prep ± | demo toggle
 *   - Green "Saved ✓" indicator
 *   - "Move to..." in three-dots menu
 *   - Demo removed from Add Block (only Movement + Water Break)
 *   - Intro/Outro remain workout-level settings in three-dots menu
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Image,
  Modal,
  Platform,
  useWindowDimensions,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Share,
  Switch,
} from 'react-native';
import ModalSheet from './ModalSheet';
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  onSnapshot,
  arrayUnion,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, storage, functions } from '../lib/firebase';
import {
  generateMovementPrescriptionVoice,
  prescriptionCacheKey,
} from '../utils/generateMovementPrescriptionVoice';
import { isImageUrl, imageExtFromMime } from '../utils/mediaKind';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { Icon } from './Icon';
import WorkoutPlayer from './WorkoutPlayer';
import WorkoutIntroAnnouncementModal, { type IntroAnnouncementSaveFields } from './WorkoutIntroAnnouncementModal';
import { buildDefaultIntroScript } from '../utils/workoutIntroAnnouncement';
import VideoCropModal, { CropValues } from './VideoCropModal';
import { FB, FH } from '../lib/theme';
import { CONTENT_BOTTOM_CLEARANCE } from '../lib/tabBarStyle';
import PosterThumb from './PosterThumb';
import DraggableFlatList, { ScaleDecorator, RenderItemParams as DragRenderItemParams } from 'react-native-draggable-flatlist';
import {
  filterMovements,
  rankByPrimaryMuscle,
  EQUIPMENT_FILTER_OPTIONS,
  MUSCLE_GROUP_FILTER_OPTIONS,
  DIFFICULTY_FILTER_OPTIONS,
} from '../hooks/useMovementFilters';


// ── Fonts ───────────────────────────────────────────────────────────────────

// ── Grid constants ─────────────────────────────────────────────────────────
const GRID_PADDING = 16;
const GRID_GAP = 8;
const LIBRARY_MAX_CARD = 240;
const MAX_CARD_WIDTH = Math.round(LIBRARY_MAX_CARD / 2); // 120px — half the library size
const CARD_ASPECT = 4 / 5;

// ── Block types & colors ───────────────────────────────────────────────────
const NO_MOVEMENT_BLOCKS = ['Transition', 'Water Break', 'Follow-Along Video'];
const BLOCK_COLORS: Record<string, string> = {
  'Warm-Up': '#F59E0B', 'Circuit': '#34D399', 'Superset': '#F59E0B',
  'Interval': '#818CF8', 'Strength': '#7DD3FC', 'Timed': '#A78BFA',
  'AMRAP': '#34D399', 'EMOM': '#34D399', 'Cool-Down': '#60A5FA',
  'Rest': '#4A5568',
  'Transition': '#94A3B8', 'Water Break': '#38BDF8', 'Follow-Along Video': '#22D3EE',
  'Tabata': '#34D399',
};
const isTabata = (block: any): boolean =>
  Array.isArray(block?.movements) && block.movements.length === 1;
const DEFAULT_ROUNDS = 3;
const DEFAULT_DURATION_SEC = 40;
const DEFAULT_REST_SEC = 20;
const DEFAULT_PREP_SEC = 20; // prep defaults to rest time
const DEFAULT_DEMO_DURATION_SEC = 20;

// Helper: strip undefined values from objects (Firestore rejects undefined)
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

// Block types available when adding a new block.
//   'movement'             → opens Movement picker, creates Circuit block w/ that movement
//   'follow-along'         → opens Follow-Along asset picker, creates Follow-Along Video block
//   'Water Break'          → adds a Water Break block directly
const ADD_BLOCK_OPTIONS = [
  { type: 'movement', label: 'Movement', icon: 'movements', color: '#F0F4F8' },
  { type: 'follow-along', label: 'Follow-Along Video', icon: 'video', color: '#22D3EE' },
  { type: 'Water Break', label: 'Water Break', icon: 'droplet', color: '#38BDF8' },
];

// ── Types ───────────────────────────────────────────────────────────────────
interface BlockMovement {
  movementId: string;
  movementName: string;
  displayName?: string; // overrides movementName for this block only
  hidden?: boolean; // hides movement from member workout
  sets?: number;
  reps?: string;
  weight?: string;
  durationSec?: number;
  restSec?: number;
  notes?: string;
  thumbnailUrl?: string;
  posterUrl?: string;
  swapSides?: boolean;
  swapMode?: 'split' | 'duplicate';
  swapWindowSec?: number;
  // Per-workout voice clip that speaks the coach's prescribed weight/reps
  // (e.g. "Cable Curls. 75 pounds, 15 reps."). Cleared when weight + reps go
  // blank. Cache key is the hash of (name, weight, reps) so the watcher
  // detects "prescription changed → regenerate."
  prescriptionVoiceUrl?: string;
  prescriptionVoiceCacheKey?: string;
}

interface WorkoutBlock {
  type: string;
  label: string;
  rounds?: number;
  restBetweenRoundsSec?: number;
  restBetweenMovementsSec?: number;
  durationSec?: number;
  instructionText?: string;
  firstMovementPrepSec?: number;
  showDemo?: boolean;
  demoDurationSec?: number;
  showGrabEquipment?: boolean;
  grabEquipmentDurationSec?: number;
  grabEquipmentText?: string;
  grabEquipmentImageUrl?: string;
  beginningRestSec?: number;
  blockPreSequence?: ('demo' | 'grabEquipment')[];
  circuitStartRestSec?: number; // legacy compat
  movements: BlockMovement[];
  videoUrl?: string;
  videoStoragePath?: string;
  videoDurationSec?: number;
  soundEnabled?: boolean;
  cropScale?: number;
  cropTranslateX?: number;
  cropTranslateY?: number;
  cropFrameWidth?: number;
  cropFrameHeight?: number;
}

interface MovementOption {
  id: string;
  name: string;
  category: string;
  equipment?: string;
  muscleGroups?: string[];
  primaryMuscles?: string[];
  secondaryMuscles?: string[];
  difficulty?: string;
  thumbnailUrl?: string | null;
  posterUrl?: string | null;
  mediaUrl?: string | null;
  videoUrl?: string | null;
  swapSides?: boolean;
  swapMode?: 'split' | 'duplicate';
  swapWindowSec?: number;
}

interface FollowAlongOption {
  id: string;
  name: string;
  videoUrl?: string | null;
  videoStoragePath?: string | null;
  videoDurationSec?: number;
  thumbnailUrl?: string | null;
  thumbnailImageUrl?: string | null;
  soundEnabled?: boolean;
  cropScale?: number;
  cropTranslateX?: number;
  cropTranslateY?: number;
  cropFrameWidth?: number;
  cropFrameHeight?: number;
}

// ── Duration calculator ─────────────────────────────────────────────────────
function calcDurationMin(blocks: WorkoutBlock[]): number {
  let totalSec = 0;
  for (const block of blocks) {
    if (NO_MOVEMENT_BLOCKS.includes(block.type)) {
      totalSec += block.durationSec ?? 10;
      continue;
    }
    const rounds = block.rounds ?? DEFAULT_ROUNDS;
    const prepSec = block.firstMovementPrepSec ?? DEFAULT_REST_SEC;
    const demoSec = block.showDemo ? (block.demoDurationSec ?? DEFAULT_DEMO_DURATION_SEC) : 0;
    let blockSec = 0;
    for (const m of block.movements ?? []) {
      const sets = m.sets ?? 1;
      const durPerSet = m.durationSec ?? DEFAULT_DURATION_SEC;
      const restPerSet = m.restSec ?? DEFAULT_REST_SEC;
      blockSec += sets * (durPerSet + restPerSet);
    }
    const restBetween = block.restBetweenRoundsSec ?? 0;
    totalSec += demoSec + rounds * (prepSec + blockSec) + (rounds > 1 ? (rounds - 1) * restBetween : 0);
  }
  return Math.ceil(totalSec / 60);
}

// ── Category inferrer ───────────────────────────────────────────────────────
function inferCategory(movementCategories: string[]): string {
  if (movementCategories.length === 0) return '';
  const counts: Record<string, number> = {};
  for (const cat of movementCategories) {
    const base = cat.split(' ')[0];
    counts[base] = (counts[base] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 1) return sorted[0][0] + ' Body';
  if (sorted[0][0] === 'Upper' && sorted[1]?.[0] === 'Lower') return 'Full Body';
  if (sorted[0][0] === 'Lower' && sorted[1]?.[0] === 'Upper') return 'Full Body';
  return sorted[0][0] + ' Body';
}

// ── Share settings types ────────────────────────────────────────────────────
type ShareVisibility = 'restricted' | 'anyone_with_link' | 'anyone_with_link_signin_required';
const VALID_VISIBILITIES: ShareVisibility[] = ['restricted', 'anyone_with_link', 'anyone_with_link_signin_required'];
function normalizeVisibility(v: unknown): ShareVisibility {
  return VALID_VISIBILITIES.includes(v as ShareVisibility) ? (v as ShareVisibility) : 'anyone_with_link';
}

interface ShareSettingsState {
  visibility: ShareVisibility;
  expiresAt: number | null;
  resolvedCount: number;
  lastResolvedAt: number | null;
}

// ── Props ───────────────────────────────────────────────────────────────────
interface WorkoutFolderPageProps {
  workoutId: string;
  coachId: string;
  tenantId: string;
  onBack: () => void;
  onOpenMovement?: (movement: any) => void;
  onDuplicated?: (newWorkoutId: string) => void;
}

// Renders the 256px thumb.png for an equipment default.png URL, falling back
// to the full image if the thumb doesn't exist yet.
function EquipThumbImage({ url, style }: { url: string; style: any }) {
  const [failed, setFailed] = useState(false);
  const thumb = url.includes('default.png') ? url.replace('default.png', 'thumb.png') : url;
  return (
    <Image
      source={{ uri: failed ? url : thumb }}
      style={style}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

export default function WorkoutFolderPage({
  workoutId,
  coachId,
  tenantId,
  onBack,
  onOpenMovement,
  onDuplicated,
}: WorkoutFolderPageProps) {
  const { width: screenWidth } = useWindowDimensions();

  // ── Grid layout (HALF the Build library card size) ──────────────────────
  const availableWidth = screenWidth - GRID_PADDING * 2;
  const cols = Math.max(2, Math.floor((availableWidth + GRID_GAP) / (MAX_CARD_WIDTH + GRID_GAP)));
  const rawCardWidth = (availableWidth - GRID_GAP * (cols - 1)) / cols;
  const cardWidth = Math.min(rawCardWidth, MAX_CARD_WIDTH);
  const cardHeight = cardWidth / CARD_ASPECT;

  // ── State ─────────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [workoutName, setWorkoutName] = useState('');
  const [workoutDescription, setWorkoutDescription] = useState('');
  const [blocks, setBlocks] = useState<WorkoutBlock[]>([]);
  const [originalData, setOriginalData] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [equipImgStatus, setEquipImgStatus] = useState<Record<number, 'generating' | 'done' | 'error' | 'choosing' | 'saving'>>({});
  const [equipImgError, setEquipImgError] = useState<Record<number, string>>({});
  const [equipImgChoices, setEquipImgChoices] = useState<Record<number, string[]>>({});
  const [equipImgSlug, setEquipImgSlug] = useState<Record<number, string>>({});
  const [equipHistoryOpenIdx, setEquipHistoryOpenIdx] = useState<number | null>(null);
  const [equipHistory, setEquipHistory] = useState<{ id: string; text: string; imageUrl: string | null }[]>([]);
  const [equipHistoryLoading, setEquipHistoryLoading] = useState(false);
  const [equipLibraryOpenIdx, setEquipLibraryOpenIdx] = useState<number | null>(null);
  const [equipLibrary, setEquipLibrary] = useState<{ slug: string; label: string; imageUrl: string; thumbUrl?: string; createdBy?: string | null }[] | null>(null);
  const [equipLibraryLoading, setEquipLibraryLoading] = useState(false);
  const [equipLibraryError, setEquipLibraryError] = useState<string | null>(null);
  const [equipLibFilterText, setEquipLibFilterText] = useState('');
  const [equipLibShowFilter, setEquipLibShowFilter] = useState(false);
  const [equipLibIsEditMode, setEquipLibIsEditMode] = useState(false);
  const [equipLibOrder, setEquipLibOrder] = useState<string[]>([]);
  const [equipLibCustomNames, setEquipLibCustomNames] = useState<Record<string, string>>({});
  const [equipLibRenaming, setEquipLibRenaming] = useState<Record<string, string>>({});
  const equipLibSettingsLoadedRef = useRef(false);
  const [viewMode, setViewMode] = useState<'icon' | 'list'>('icon');

  // Intro / Outro — workout-level fields
  const [introVideoUrl, setIntroVideoUrl] = useState<string | null>(null);
  const [introGifUrl, setIntroGifUrl] = useState<string | null>(null);
  const [outroVideoUrl, setOutroVideoUrl] = useState<string | null>(null);
  const [outroGifUrl, setOutroGifUrl] = useState<string | null>(null);
  const [ioUploading, setIoUploading] = useState<'intro' | 'outro' | null>(null);
  const [ioUploadProgress, setIoUploadProgress] = useState(0);
  // Intro/Outro crop state
  const [introCrop, setIntroCrop] = useState<CropValues>({ cropScale: 1, cropTranslateX: 0, cropTranslateY: 0, cropFrameWidth: 0, cropFrameHeight: 0 });
  const [outroCrop, setOutroCrop] = useState<CropValues>({ cropScale: 1, cropTranslateX: 0, cropTranslateY: 0, cropFrameWidth: 0, cropFrameHeight: 0 });
  // After upload: open crop modal with the freshly uploaded URL
  const [cropTarget, setCropTarget] = useState<{ target: 'intro' | 'outro'; videoUrl: string } | null>(null);

  // ── Intro/Outro video upload handler ──────────────────────────────────────
  const pickAndUploadIntroOutro = useCallback(async (target: 'intro' | 'outro') => {
    try {
      // On native, request permission; on web, browser handles file picker natively
      if (Platform.OS !== 'web') {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Permission Needed', 'Please allow access to your photo library to upload videos or photos.');
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        allowsEditing: false,
        quality: 0.8,
        videoMaxDuration: 30,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const isImage = asset.type !== 'video';
      setIoUploading(target);
      setIoUploadProgress(0);

      // Upload media to Firebase Storage
      const ext = isImage ? imageExtFromMime(asset.mimeType) : 'mp4';
      const fileName = `workouts/${coachId}/${target}/${workoutId}_${Date.now()}.${ext}`;

      let blob: Blob;
      if (Platform.OS === 'web' && asset.uri.startsWith('blob:')) {
        // On web, expo-image-picker returns a blob: URL — fetch it directly
        const response = await fetch(asset.uri);
        blob = await response.blob();
      } else if (Platform.OS === 'web' && asset.uri.startsWith('data:')) {
        // Data URI — convert to blob
        const response = await fetch(asset.uri);
        blob = await response.blob();
      } else {
        const response = await fetch(asset.uri);
        blob = await response.blob();
      }

      const contentType = blob.type || asset.mimeType || (isImage ? 'image/jpeg' : 'video/mp4');
      const storageRef = ref(storage, fileName);
      const uploadTask = uploadBytesResumable(storageRef, blob, { contentType });

      const videoUrl = await new Promise<string>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => setIoUploadProgress(snapshot.bytesTransferred / snapshot.totalBytes),
          (error) => {
            console.error(`[WorkoutFolder] ${target} upload state error:`, error?.message ?? error);
            reject(error);
          },
          async () => {
            try {
              const url = await getDownloadURL(uploadTask.snapshot.ref);
              resolve(url);
            } catch (e) {
              reject(e);
            }
          },
        );
      });

      // Use media URL as thumbnail placeholder
      const gifUrl = videoUrl;

      // Save to Firestore (images reuse the existing *VideoUrl fields;
      // display code branches on the URL's file extension)
      const updates = target === 'intro'
        ? { introVideoUrl: videoUrl, introGifUrl: gifUrl }
        : { outroVideoUrl: videoUrl, outroGifUrl: gifUrl };
      await updateDoc(doc(db, 'workouts', workoutId), { ...updates, updatedAt: serverTimestamp() });
      if (target === 'intro') {
        setIntroVideoUrl(videoUrl);
        setIntroGifUrl(gifUrl);
      } else {
        setOutroVideoUrl(videoUrl);
        setOutroGifUrl(gifUrl);
      }

      // Immediately open crop modal for freshly uploaded videos.
      // Photos skip the crop step — the crop modal is video-only.
      if (!isImage) setCropTarget({ target, videoUrl });
    } catch (err: any) {
      console.error(`[WorkoutFolder] ${target} upload error:`, err?.message ?? err);
      if (Platform.OS === 'web') {
        window.alert(`Upload failed: ${err?.message || 'Unknown error'}. Please try again.`);
      } else {
        Alert.alert('Upload Failed', `Could not upload the ${target} video. Please try again.`);
      }
    } finally {
      setIoUploading(null);
      setIoUploadProgress(0);
    }
  }, [coachId, workoutId]);

  // Movement library
  const [availableMovements, setAvailableMovements] = useState<MovementOption[]>([]);
  const [movementsLoaded, setMovementsLoaded] = useState(false);

  // UI state — overlay controls
  const [expandedMovKey, setExpandedMovKey] = useState<string | null>(null); // "blockIdx-movIdx"
  const [expandedBlockIdx, setExpandedBlockIdx] = useState<number | null>(null);
  const [blockOverlayIndex, setBlockOverlayIndex] = useState<number | null>(null);
  const [showAddBlockMenu, setShowAddBlockMenu] = useState(false);
  const [addBlockAtIndex, setAddBlockAtIndex] = useState<number | null>(null);
  const [showMovementPicker, setShowMovementPicker] = useState(false);
  const [movementPickerBlockIdx, setMovementPickerBlockIdx] = useState<number | null>(null);
  const [movementSearch, setMovementSearch] = useState('');
  const [pickerEquipmentFilter, setPickerEquipmentFilter] = useState('All');
  const [pickerMuscleGroupFilter, setPickerMuscleGroupFilter] = useState('All');
  const [pickerDifficultyFilter, setPickerDifficultyFilter] = useState('All');
  const [showMovementPickerFilters, setShowMovementPickerFilters] = useState(false);
  const [showFollowAlongPicker, setShowFollowAlongPicker] = useState(false);
  /** Insert position remembered when opening the picker — null = append. */
  const [followAlongPickerInsertAt, setFollowAlongPickerInsertAt] = useState<number | null>(null);
  const [followAlongSearch, setFollowAlongSearch] = useState('');
  const [availableFollowAlongs, setAvailableFollowAlongs] = useState<FollowAlongOption[]>([]);
  const [followAlongsLoaded, setFollowAlongsLoaded] = useState(false);
  const [showTitleMenu, setShowTitleMenu] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [showDescriptionEdit, setShowDescriptionEdit] = useState(false);
  const [restDurationSeconds, setRestDurationSeconds] = useState(30);
  const [showIntroOutroPage, setShowIntroOutroPage] = useState(false);
  const [showMusicModal, setShowMusicModal] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(false);
  const [musicStyle, setMusicStyle] = useState('workout');
  const [musicVolume, setMusicVolume] = useState(0.35);
  // Intro announcement (spoken welcome) — workout-level fields
  const [showIntroAnnouncement, setShowIntroAnnouncement] = useState(false);
  const [introAnnouncementEnabled, setIntroAnnouncementEnabled] = useState(true);
  const [introAnnouncementText, setIntroAnnouncementText] = useState('');
  const [showMoveTo, setShowMoveTo] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDuplicateConfirm, setShowDuplicateConfirm] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [shareLoading, setShareLoading] = useState(false);
  const [activeShareId, setActiveShareId] = useState<string | null>(null);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareSettings, setShareSettings] = useState<ShareSettingsState>({
    visibility: 'anyone_with_link',
    expiresAt: null,
    resolvedCount: 0,
    lastResolvedAt: null,
  });
  const [shareSettingsSaving, setShareSettingsSaving] = useState(false);
  const [moveToSearch, setMoveToSearch] = useState('');
  const [movePlaybooks, setMovePlaybooks] = useState<any[]>([]);
  const [moveToBusyId, setMoveToBusyId] = useState<string | null>(null);

  // Load the coach's playbooks when the Move-to page opens.
  useEffect(() => {
    if (!showMoveTo || !coachId) return;
    getDocs(query(collection(db, 'playbooks'), where('coachId', '==', coachId)))
      .then(snap => {
        const pbs = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as any))
          .filter(pb => !pb.isArchived)
          .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        setMovePlaybooks(pbs);
      })
      .catch(e => console.error('[WorkoutFolder] Load playbooks error:', e));
  }, [showMoveTo, coachId]);

  // Membership lives in the playbook's workoutIds array (ordered, deduped by
  // arrayUnion) — never parentId, since a workout can be in many playbooks.
  const addToPlaybook = useCallback(async (pb: any) => {
    if (moveToBusyId) return;
    setMoveToBusyId(pb.id);
    try {
      await updateDoc(doc(db, 'playbooks', pb.id), {
        workoutIds: arrayUnion(workoutId),
        updatedAt: serverTimestamp(),
      });
      setMovePlaybooks(prev => prev.map(p =>
        p.id === pb.id
          ? { ...p, workoutIds: Array.from(new Set([...(p.workoutIds ?? []), workoutId])) }
          : p,
      ));
    } catch (e) {
      console.error('[WorkoutFolder] Add to playbook error:', e);
    } finally {
      setMoveToBusyId(null);
    }
  }, [workoutId, moveToBusyId]);
  const [editingNameKey, setEditingNameKey] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');
  // Reorder: long-press to pick up, tap another slot to drop
  const [reorderSource, setReorderSource] = useState<{ blockIdx: number; movIdx: number } | null>(null);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false); // prevents onSnapshot from overwriting local edits
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deletedRef = useRef(false); // set true after deleteDoc to prevent unmount re-save
  const blocksRef = useRef<WorkoutBlock[]>(blocks);
  const nameRef = useRef(workoutName);

  // Keep refs in sync
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  useEffect(() => { nameRef.current = workoutName; }, [workoutName]);

  // ── Stable workout prop for WorkoutPlayer (avoid re-flatten on every render) ──
  const previewWorkout = useMemo(() => ({
    ...originalData,
    id: workoutId,
    name: workoutName,
    description: workoutDescription,
    blocks,
  }), [originalData, workoutId, workoutName, workoutDescription, blocks]);
  const closePreview = useCallback(() => setShowPreview(false), []);

  // ── Intro announcement (spoken welcome) ───────────────────────────────────
  // Default script mirrors what the player generates for members — same
  // builder function, muscles sourced from the movement library.
  const introAnnouncementDefaultScript = useMemo(() => {
    const musclesByMovementId: Record<string, string[]> = {};
    for (const m of availableMovements) {
      if (m.primaryMuscles && m.primaryMuscles.length > 0) musclesByMovementId[m.id] = m.primaryMuscles;
    }
    return buildDefaultIntroScript({ name: workoutName, blocks }, musclesByMovementId);
  }, [availableMovements, workoutName, blocks]);

  const saveIntroAnnouncement = useCallback(async (fields: IntroAnnouncementSaveFields) => {
    await updateDoc(doc(db, 'workouts', workoutId), {
      ...fields,
      updatedAt: serverTimestamp(),
    });
    setIntroAnnouncementEnabled(fields.introAnnouncementEnabled);
    setIntroAnnouncementText(fields.introAnnouncementText);
  }, [workoutId]);

  // ── Dismiss all overlays ─────────────────────────────────────────────────
  const dismissAll = useCallback(() => {
    setExpandedMovKey(null);
    setExpandedBlockIdx(null);
    setShowAddBlockMenu(false);
    setShowTitleMenu(false);
    setEditingNameKey(null);
    setReorderSource(null);
  }, []);

  // ── Active share token lookup ────────────────────────────────────────────
  useEffect(() => {
    if (!workoutId || !coachId) return;
    const q = query(
      collection(db, 'shareTokens'),
      where('workoutId', '==', workoutId),
      where('createdBy', '==', coachId),
      where('revokedAt', '==', null),
    );
    getDocs(q).then((snap) => {
      if (snap.empty) {
        setActiveShareId(null);
        return;
      }
      const docSnap = snap.docs[0];
      const data = docSnap.data() as Record<string, any>;
      setActiveShareId(docSnap.id);
      setShareSettings({
        visibility: normalizeVisibility(data.visibility),
        expiresAt: data.expiresAt?.toMillis?.() ?? null,
        resolvedCount: data.resolvedCount ?? 0,
        lastResolvedAt: data.lastResolvedAt?.toMillis?.() ?? null,
      });
    }).catch(() => {});
  }, [workoutId, coachId]);

  function buildShareUrl(shareId: string): string {
    const origin =
      Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'https://goarrive.fit';
    return `${origin}/share/${shareId}`;
  }

  async function copyShareLinkToClipboard(shareUrl: string) {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(shareUrl);
      if (typeof window !== 'undefined') {
        window.alert('Link copied to clipboard.');
      }
    } else {
      try {
        await Share.share({ message: shareUrl });
      } catch {
        Alert.alert('Share Link', shareUrl);
      }
    }
  }

  // Open the Share Settings modal. If no token exists yet, create one with
  // the default visibility ("anyone with the link") so coaches get a working
  // link in one click.
  async function handleOpenShareSettings() {
    setShareLoading(true);
    try {
      type CreateResult = {
        shareId: string;
        alreadyExists: boolean;
        visibility?: ShareVisibility;
        expiresAt?: number | null;
        resolvedCount?: number;
        lastResolvedAt?: number | null;
      };
      const createFn = httpsCallable<{ workoutId: string }, CreateResult>(functions, 'createShareToken');
      const result = await createFn({ workoutId });
      const data = result.data;
      setActiveShareId(data.shareId);
      setShareSettings({
        visibility: normalizeVisibility(data.visibility),
        expiresAt: data.expiresAt ?? null,
        resolvedCount: data.resolvedCount ?? 0,
        lastResolvedAt: data.lastResolvedAt ?? null,
      });
      setShareModalOpen(true);
    } catch (err: any) {
      console.error('[WorkoutFolder] Share link error:', err);
      Alert.alert('Error', err?.message || 'Failed to create share link.');
    } finally {
      setShareLoading(false);
    }
  }

  async function saveShareSettings(patch: Partial<Pick<ShareSettingsState, 'visibility' | 'expiresAt'>>) {
    const next = { ...shareSettings, ...patch };
    setShareSettings(next);
    setShareSettingsSaving(true);
    try {
      const updateFn = httpsCallable<
        { workoutId: string; visibility?: ShareVisibility; expiresAt?: number | null },
        { updated: number; shareId?: string }
      >(functions, 'updateShareToken');
      await updateFn({
        workoutId,
        visibility: next.visibility,
        expiresAt: next.expiresAt,
      });
    } catch (err: any) {
      console.error('[WorkoutFolder] Update share settings error:', err);
      Alert.alert('Error', err?.message || 'Failed to update share settings.');
    } finally {
      setShareSettingsSaving(false);
    }
  }

  async function performRevoke() {
    setShareLoading(true);
    try {
      const revokeFn = httpsCallable<{ workoutId: string }, { revoked: number }>(functions, 'revokeShareToken');
      await revokeFn({ workoutId });
      setActiveShareId(null);
      setShareModalOpen(false);
      setShareSettings({
        visibility: 'anyone_with_link',
        expiresAt: null,
        resolvedCount: 0,
        lastResolvedAt: null,
      });
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert('The share link has been revoked.');
      } else {
        Alert.alert('Link Revoked', 'The share link has been revoked.');
      }
    } catch (err: any) {
      console.error('[WorkoutFolder] Revoke error:', err);
      const msg = err?.message || 'Failed to revoke share link.';
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert(`Error: ${msg}`);
      } else {
        Alert.alert('Error', msg);
      }
    } finally {
      setShareLoading(false);
    }
  }

  function handleRevokeLink() {
    // react-native-web's Alert.alert only renders the message — its buttons
    // array is silently dropped. Use window.confirm on web so the destructive
    // action actually requires confirmation.
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const confirmed = window.confirm(
        'Revoke Share Link\n\nAnyone with the current link will no longer be able to access this workout. You can create a new link later.',
      );
      if (confirmed) performRevoke();
      return;
    }
    Alert.alert(
      'Revoke Share Link',
      'Anyone with the current link will no longer be able to access this workout. You can create a new link later.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revoke', style: 'destructive', onPress: performRevoke },
      ],
    );
  }

  // ── Load workout data ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!workoutId) return;
    const unsub = onSnapshot(doc(db, 'workouts', workoutId), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        // Only update from Firestore if we don't have pending local edits
        if (!dirtyRef.current) {
          setWorkoutName(data.name ?? 'Untitled Workout');
          setWorkoutDescription(data.description ?? '');
          const rawBlocks = (data.blocks ?? []).filter(
            (b: any) => b.type !== 'Intro' && b.type !== 'Outro' && b.type !== 'Demo'
          );
          setBlocks(
            rawBlocks.map((b: any) => {
              const out: WorkoutBlock = {
                type: b.type ?? 'Circuit',
                label: b.label ?? '',
                rounds: b.rounds ?? DEFAULT_ROUNDS,
                restBetweenRoundsSec: b.restBetweenRoundsSec ?? 0,
                restBetweenMovementsSec: b.restBetweenMovementsSec ?? 0,
                durationSec: b.durationSec ?? undefined,
                instructionText: b.instructionText ?? undefined,
                firstMovementPrepSec: b.firstMovementPrepSec ?? DEFAULT_REST_SEC,
                showDemo: b.showDemo ?? false,
                demoDurationSec: b.demoDurationSec ?? DEFAULT_DEMO_DURATION_SEC,
                showGrabEquipment: b.showGrabEquipment ?? false,
                grabEquipmentDurationSec: b.grabEquipmentDurationSec ?? undefined,
                grabEquipmentText: b.grabEquipmentText ?? '',
                grabEquipmentImageUrl: b.grabEquipmentImageUrl ?? undefined,
                beginningRestSec: b.beginningRestSec ?? b.circuitStartRestSec ?? undefined,
                blockPreSequence: b.blockPreSequence ?? undefined,
                circuitStartRestSec: b.circuitStartRestSec ?? undefined,
                movements: (b.movements ?? []).map((m: any) => ({
                  movementId: m.movementId ?? '',
                  movementName: m.movementName ?? '',
                  displayName: m.displayName ?? undefined,
                  hidden: m.hidden ?? undefined,
                  sets: m.sets ?? undefined,
                  reps: m.reps ?? undefined,
                  weight: m.weight ?? undefined,
                  durationSec: m.durationSec ?? undefined,
                  restSec: m.restSec ?? undefined,
                  notes: m.notes ?? '',
                  thumbnailUrl: m.thumbnailUrl ?? undefined,
                  posterUrl: m.posterUrl ?? undefined,
                  swapSides: m.swapSides ?? undefined,
                  swapMode: m.swapMode ?? undefined,
                  swapWindowSec: m.swapWindowSec ?? undefined,
                })),
              };
              if (b.type === 'Follow-Along Video') {
                out.videoUrl = b.videoUrl;
                out.videoStoragePath = b.videoStoragePath;
                out.videoDurationSec = b.videoDurationSec;
                out.soundEnabled = b.soundEnabled ?? true;
                out.cropScale = b.cropScale ?? 1;
                out.cropTranslateX = b.cropTranslateX ?? 0;
                out.cropTranslateY = b.cropTranslateY ?? 0;
                out.cropFrameWidth = b.cropFrameWidth;
                out.cropFrameHeight = b.cropFrameHeight;
              }
              return out;
            }),
          );
        }
        setRestDurationSeconds(data.restDurationSeconds ?? 30);
        setIntroVideoUrl(data.introVideoUrl ?? null);
        setIntroGifUrl(data.introGifUrl ?? null);
        setIntroAnnouncementEnabled(data.introAnnouncementEnabled ?? true);
        setIntroAnnouncementText(data.introAnnouncementText ?? '');
        setOutroVideoUrl(data.outroVideoUrl ?? null);
        setOutroGifUrl(data.outroGifUrl ?? null);
        setMusicEnabled(data.workoutMusicEnabled ?? false);
        setMusicStyle(data.workoutMusicStyle ?? 'workout');
        setMusicVolume(typeof data.workoutMusicVolume === 'number' ? data.workoutMusicVolume : 0.35);
        setIntroCrop({
          cropScale: data.introCropScale ?? 1,
          cropTranslateX: data.introCropTranslateX ?? 0,
          cropTranslateY: data.introCropTranslateY ?? 0,
          cropFrameWidth: data.introCropFrameWidth ?? 0,
          cropFrameHeight: data.introCropFrameHeight ?? 0,
        });
        setOutroCrop({
          cropScale: data.outroCropScale ?? 1,
          cropTranslateX: data.outroCropTranslateX ?? 0,
          cropTranslateY: data.outroCropTranslateY ?? 0,
          cropFrameWidth: data.outroCropFrameWidth ?? 0,
          cropFrameHeight: data.outroCropFrameHeight ?? 0,
        });
        setOriginalData(data);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [workoutId]);

  // ── Load movement library ─────────────────────────────────────────────────
  // Live snapshot subscription for movement library — replaces one-shot getDocs.
  // Both coach and global queries share coachMap/globalMap so either snapshot
  // can trigger a re-merge without waiting for the other.
  useEffect(() => {
    if (!coachId) return;

    const coachMap = new Map<string, MovementOption>();
    const globalMap = new Map<string, MovementOption>();

    const toOption = (id: string, d: Record<string, any>): MovementOption => ({
      id,
      name: d.name ?? '',
      category: d.category ?? '',
      equipment: d.equipment ?? undefined,
      muscleGroups: d.muscleGroups ?? undefined,
      primaryMuscles: d.primaryMuscles ?? undefined,
      secondaryMuscles: d.secondaryMuscles ?? undefined,
      difficulty: d.difficulty ?? undefined,
      thumbnailUrl: d.thumbnailUrl ?? null,
      posterUrl: d.posterUrl ?? d.thumbnailImageUrl ?? null,
      mediaUrl: d.mediaUrl ?? null,
      videoUrl: d.videoUrl ?? null,
      swapSides: d.swapSides ?? false,
      swapMode: d.swapMode ?? undefined,
      swapWindowSec: d.swapWindowSec ?? undefined,
    });

    const mergeAndSet = () => {
      // Coach wins on dedupe; build coach list first, then append non-duplicate globals
      const seen = new Set<string>();
      const deduped: MovementOption[] = [];
      coachMap.forEach((m) => { if (!seen.has(m.id)) { seen.add(m.id); deduped.push(m); } });
      globalMap.forEach((m) => { if (!seen.has(m.id)) { seen.add(m.id); deduped.push(m); } });
      deduped.sort((a, b) => a.name.localeCompare(b.name));
      setAvailableMovements(deduped);
      setMovementsLoaded(true);
    };

    const coachQ = query(collection(db, 'movements'), where('coachId', '==', coachId));
    const globalQ = query(collection(db, 'movements'), where('isGlobal', '==', true));

    const unsubCoach = onSnapshot(coachQ, (snap) => {
      coachMap.clear();
      snap.forEach((d) => {
        const data = d.data();
        if (!data.isArchived) coachMap.set(d.id, toOption(d.id, data));
      });
      mergeAndSet();
    }, (err) => console.error('[WorkoutFolder] Coach movements snapshot error:', err));

    const unsubGlobal = onSnapshot(globalQ, (snap) => {
      globalMap.clear();
      snap.forEach((d) => {
        const data = d.data();
        if (!data.isArchived) globalMap.set(d.id, toOption(d.id, data));
      });
      mergeAndSet();
    }, (err) => console.error('[WorkoutFolder] Global movements snapshot error:', err));

    return () => {
      unsubCoach();
      unsubGlobal();
    };
  }, [coachId]);

  // ── Load follow-along library ─────────────────────────────────────────────
  const loadFollowAlongs = useCallback(async () => {
    if (followAlongsLoaded || !coachId) return;
    try {
      const q = query(collection(db, 'followAlongVideos'), where('coachId', '==', coachId));
      const snap = await getDocs(q);
      const list: FollowAlongOption[] = [];
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data.isArchived) return;
        list.push({
          id: d.id,
          name: data.name ?? 'Untitled Follow-Along',
          videoUrl: data.videoUrl ?? null,
          videoStoragePath: data.videoStoragePath ?? null,
          videoDurationSec: data.videoDurationSec ?? 0,
          thumbnailUrl: data.thumbnailUrl ?? null,
          thumbnailImageUrl: data.thumbnailImageUrl ?? null,
          soundEnabled: data.soundEnabled ?? true,
          cropScale: data.cropScale ?? 1,
          cropTranslateX: data.cropTranslateX ?? 0,
          cropTranslateY: data.cropTranslateY ?? 0,
          cropFrameWidth: data.cropFrameWidth ?? 0,
          cropFrameHeight: data.cropFrameHeight ?? 0,
        });
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setAvailableFollowAlongs(list);
      setFollowAlongsLoaded(true);
    } catch (err: any) {
      console.error('[WorkoutFolder] Load follow-alongs error:', err?.message ?? err);
    }
  }, [coachId, followAlongsLoaded]);

  // ── Enrich block movements with thumbnailUrl ─────────────────────────────
  useEffect(() => {
    if (!movementsLoaded || availableMovements.length === 0 || blocks.length === 0) return;
    let changed = false;
    const enriched = blocks.map((b) => ({
      ...b,
      movements: b.movements.map((m) => {
        if (m.thumbnailUrl && m.posterUrl) return m;
        const found = availableMovements.find((am) => am.id === m.movementId);
        if (found && (found.thumbnailUrl || found.mediaUrl || found.posterUrl)) {
          changed = true;
          return {
            ...m,
            thumbnailUrl: m.thumbnailUrl ?? found.thumbnailUrl ?? found.mediaUrl ?? undefined,
            posterUrl: m.posterUrl ?? found.posterUrl ?? undefined,
          };
        }
        return m;
      }),
    }));
    if (changed) setBlocks(enriched);
  }, [movementsLoaded, availableMovements]);

  // ── Prescription voice generation (debounced) ────────────────────────────
  // Watches block-movement weight/reps. When the prescription cache key drifts
  // from the stored one, regenerate the per-build TTS clip and write the URL +
  // key back onto the block-movement so the player can prefer it over the
  // base name-only voice clip.
  const prescriptionGenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (blocks.length === 0) return;
    if (prescriptionGenTimerRef.current) clearTimeout(prescriptionGenTimerRef.current);
    prescriptionGenTimerRef.current = setTimeout(() => {
      const targets: Array<{
        blockIdx: number;
        movIdx: number;
        movementId: string;
        movementName: string;
        weight: string;
        reps: string;
        expectedKey: string;
      }> = [];
      const clears: Array<{ blockIdx: number; movIdx: number }> = [];
      blocks.forEach((b, bi) => {
        b.movements.forEach((m, mi) => {
          const w = (m.weight || '').trim();
          const r = (m.reps || '').trim();
          if (!w && !r) {
            if (m.prescriptionVoiceUrl || m.prescriptionVoiceCacheKey) {
              clears.push({ blockIdx: bi, movIdx: mi });
            }
            return;
          }
          if (!m.movementId || !m.movementName) return;
          const expected = prescriptionCacheKey(m.movementName, w, r);
          if (m.prescriptionVoiceCacheKey !== expected || !m.prescriptionVoiceUrl) {
            targets.push({
              blockIdx: bi,
              movIdx: mi,
              movementId: m.movementId,
              movementName: m.movementName,
              weight: w,
              reps: r,
              expectedKey: expected,
            });
          }
        });
      });

      if (clears.length > 0) {
        setBlocks((prev) => {
          const next = prev.map((b) => ({ ...b, movements: [...b.movements] }));
          clears.forEach(({ blockIdx, movIdx }) => {
            const blk = next[blockIdx];
            if (!blk) return;
            const mv = blk.movements[movIdx];
            if (!mv) return;
            blk.movements[movIdx] = {
              ...mv,
              prescriptionVoiceUrl: undefined,
              prescriptionVoiceCacheKey: undefined,
            };
          });
          return next;
        });
      }

      targets.forEach(async (t) => {
        try {
          const res = await generateMovementPrescriptionVoice(
            t.movementId,
            t.movementName,
            t.weight,
            t.reps,
          );
          if (!res.url) return;
          setBlocks((prev) => {
            const blk = prev[t.blockIdx];
            if (!blk) return prev;
            const mv = blk.movements[t.movIdx];
            if (!mv) return prev;
            // Re-check the current weight/reps still match — user may have edited
            // again while the TTS call was in flight.
            const curW = (mv.weight || '').trim();
            const curR = (mv.reps || '').trim();
            if (curW !== t.weight || curR !== t.reps) return prev;
            if (mv.prescriptionVoiceCacheKey === res.cacheKey) return prev;
            const next = prev.map((b) => ({ ...b, movements: [...b.movements] }));
            next[t.blockIdx].movements[t.movIdx] = {
              ...mv,
              prescriptionVoiceUrl: res.url ?? undefined,
              prescriptionVoiceCacheKey: res.cacheKey,
            };
            return next;
          });
        } catch (err: any) {
          console.warn('[WorkoutFolder] prescription voice gen failed', {
            movementId: t.movementId, message: err?.message,
          });
        }
      });
    }, 1500);

    return () => {
      if (prescriptionGenTimerRef.current) clearTimeout(prescriptionGenTimerRef.current);
    };
  }, [blocks]);

  // ── Auto-save (debounced) ─────────────────────────────────────────────────
  const autoSave = useCallback(async (newBlocks: WorkoutBlock[], newName?: string) => {
    dirtyRef.current = true;
    setSaveStatus('saving');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        setSaving(true);
        const cleanBlocks = newBlocks.map((b) => {
          const clean: any = {
            type: b.type,
            label: b.label,
            rounds: b.rounds ?? DEFAULT_ROUNDS,
            restBetweenRoundsSec: b.restBetweenRoundsSec ?? 0,
            restBetweenMovementsSec: b.restBetweenMovementsSec ?? 0,
            durationSec: b.durationSec ?? undefined,
            instructionText: b.instructionText ?? undefined,
            firstMovementPrepSec: b.firstMovementPrepSec ?? DEFAULT_REST_SEC,
            showDemo: b.showDemo ?? false,
            demoDurationSec: b.demoDurationSec ?? DEFAULT_DEMO_DURATION_SEC,
            movements: (b.movements ?? []).map((m) => ({
              movementId: m.movementId,
              movementName: m.movementName,
              displayName: m.displayName ?? undefined,
              hidden: m.hidden ?? undefined,
              sets: m.sets ?? undefined,
              reps: m.reps ?? undefined,
              weight: m.weight ?? undefined,
              durationSec: m.durationSec ?? undefined,
              restSec: m.restSec ?? undefined,
              notes: m.notes ?? '',
              thumbnailUrl: m.thumbnailUrl ?? undefined,
              posterUrl: m.posterUrl ?? undefined,
              swapSides: m.swapSides ?? undefined,
              swapMode: m.swapMode ?? undefined,
              swapWindowSec: m.swapWindowSec ?? undefined,
              prescriptionVoiceUrl: m.prescriptionVoiceUrl ?? undefined,
              prescriptionVoiceCacheKey: m.prescriptionVoiceCacheKey ?? undefined,
            })),
          };
          if (b.showDemo != null) clean.showDemo = b.showDemo;
          if (b.demoDurationSec != null && b.demoDurationSec > 0) clean.demoDurationSec = b.demoDurationSec;
          if (b.showGrabEquipment) {
            clean.showGrabEquipment = true;
            if (b.grabEquipmentDurationSec) clean.grabEquipmentDurationSec = b.grabEquipmentDurationSec;
            if (b.grabEquipmentText) clean.grabEquipmentText = b.grabEquipmentText;
            if (b.grabEquipmentImageUrl) clean.grabEquipmentImageUrl = b.grabEquipmentImageUrl;
          }
          if (b.blockPreSequence) clean.blockPreSequence = b.blockPreSequence;
          if (b.beginningRestSec != null && b.beginningRestSec > 0) {
            clean.beginningRestSec = b.beginningRestSec;
            clean.circuitStartRestSec = b.beginningRestSec; // backwards compat
          }
          if (b.type === 'Follow-Along Video') {
            clean.videoUrl = b.videoUrl ?? undefined;
            clean.videoStoragePath = b.videoStoragePath ?? undefined;
            clean.videoDurationSec = b.videoDurationSec ?? undefined;
            clean.soundEnabled = b.soundEnabled ?? true;
            clean.cropScale = b.cropScale ?? 1;
            clean.cropTranslateX = b.cropTranslateX ?? 0;
            clean.cropTranslateY = b.cropTranslateY ?? 0;
            clean.cropFrameWidth = b.cropFrameWidth ?? undefined;
            clean.cropFrameHeight = b.cropFrameHeight ?? undefined;
          }
          return clean;
        });

        const coverThumbs: string[] = [];
        for (const b of cleanBlocks) {
          for (const m of b.movements ?? []) {
            if (m.thumbnailUrl && coverThumbs.length < 16) coverThumbs.push(m.thumbnailUrl);
          }
        }

        const allCategories: string[] = [];
        for (const b of cleanBlocks) {
          for (const m of b.movements ?? []) {
            const mov = availableMovements.find(am => am.id === m.movementId);
            if (mov?.category) allCategories.push(mov.category);
          }
        }
        const inferredCategory = inferCategory(allCategories);
        const inferredDuration = calcDurationMin(newBlocks);

        const updatePayload: any = {
          blocks: cleanBlocks,
          coverThumbs,
          estimatedDurationMin: inferredDuration,
          updatedAt: serverTimestamp(),
        };
        if (inferredCategory) updatePayload.category = inferredCategory;
        if (newName !== undefined) updatePayload.name = newName;

        await updateDoc(doc(db, 'workouts', workoutId), stripUndefined(updatePayload));
        setSaveStatus('saved');
        // Clear dirty flag after successful save so onSnapshot can update again
        dirtyRef.current = false;
        // Reset saved indicator after 3 seconds
        savedTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3000);
      } catch (err: any) {
        console.error('[WorkoutFolder] Auto-save error:', err?.message ?? err);
        setSaveStatus('idle');
        dirtyRef.current = false;
      } finally {
        setSaving(false);
      }
    }, 800); // reduced from 1500ms for snappier saves
  }, [workoutId, availableMovements]);

  // ── Flush save (immediate, no debounce) ─────────────────────────────────
  const flushSave = useCallback(async () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (!dirtyRef.current) return;
    try {
      const currentBlocks = blocksRef.current;
      const cleanBlocks = currentBlocks.map((b) => {
        const clean: any = {
          type: b.type, label: b.label,
          rounds: b.rounds ?? DEFAULT_ROUNDS,
          restBetweenRoundsSec: b.restBetweenRoundsSec ?? 0,
          restBetweenMovementsSec: b.restBetweenMovementsSec ?? 0,
          durationSec: b.durationSec ?? undefined,
          instructionText: b.instructionText ?? undefined,
          firstMovementPrepSec: b.firstMovementPrepSec ?? DEFAULT_REST_SEC,
          showDemo: b.showDemo ?? false,
          demoDurationSec: b.demoDurationSec ?? DEFAULT_DEMO_DURATION_SEC,
          movements: (b.movements ?? []).map((m) => ({
            movementId: m.movementId, movementName: m.movementName,
            sets: m.sets ?? undefined, reps: m.reps ?? undefined,
            weight: m.weight ?? undefined,
            durationSec: m.durationSec ?? undefined, restSec: m.restSec ?? undefined,
            notes: m.notes ?? '', thumbnailUrl: m.thumbnailUrl ?? undefined,
            posterUrl: m.posterUrl ?? undefined,
            swapSides: m.swapSides ?? undefined,
            swapMode: m.swapMode ?? undefined,
            swapWindowSec: m.swapWindowSec ?? undefined,
            prescriptionVoiceUrl: m.prescriptionVoiceUrl ?? undefined,
            prescriptionVoiceCacheKey: m.prescriptionVoiceCacheKey ?? undefined,
          })),
        };
        if (b.showGrabEquipment) {
          clean.showGrabEquipment = true;
          if (b.grabEquipmentDurationSec) clean.grabEquipmentDurationSec = b.grabEquipmentDurationSec;
          if (b.grabEquipmentText) clean.grabEquipmentText = b.grabEquipmentText;
          if (b.grabEquipmentImageUrl) clean.grabEquipmentImageUrl = b.grabEquipmentImageUrl;
        }
        if (b.blockPreSequence) clean.blockPreSequence = b.blockPreSequence;
        if (b.beginningRestSec != null && b.beginningRestSec > 0) {
          clean.beginningRestSec = b.beginningRestSec;
          clean.circuitStartRestSec = b.beginningRestSec;
        }
        if (b.type === 'Follow-Along Video') {
          clean.videoUrl = b.videoUrl ?? undefined;
          clean.videoStoragePath = b.videoStoragePath ?? undefined;
          clean.videoDurationSec = b.videoDurationSec ?? undefined;
          clean.soundEnabled = b.soundEnabled ?? true;
          clean.cropScale = b.cropScale ?? 1;
          clean.cropTranslateX = b.cropTranslateX ?? 0;
          clean.cropTranslateY = b.cropTranslateY ?? 0;
          clean.cropFrameWidth = b.cropFrameWidth ?? undefined;
          clean.cropFrameHeight = b.cropFrameHeight ?? undefined;
        }
        return clean;
      });
      const coverThumbs: string[] = [];
      for (const b of cleanBlocks) {
        for (const m of b.movements ?? []) {
          if (m.thumbnailUrl && coverThumbs.length < 16) coverThumbs.push(m.thumbnailUrl);
        }
      }
      const updatePayload: any = {
        blocks: cleanBlocks, coverThumbs,
        estimatedDurationMin: calcDurationMin(currentBlocks),
        name: nameRef.current,
        updatedAt: serverTimestamp(),
      };
      await updateDoc(doc(db, 'workouts', workoutId), stripUndefined(updatePayload));
      dirtyRef.current = false;
    } catch (err: any) {
      console.error('[WorkoutFolder] Flush save error:', err?.message ?? err);
    }
  }, [workoutId]);

  // Flush save on unmount — also auto-deletes empty workouts for ANY exit path
  // (tab switch, browser back, etc. — not just the in-app back button)
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

      // Already deleted via handleBack or confirmDeleteWorkout — skip
      if (deletedRef.current) return;

      // Auto-delete empty workouts regardless of how the user exited
      const currentBlocks = blocksRef.current;
      const totalMovs = currentBlocks.reduce(
        (sum, b) => sum + ((b.movements ?? []).length), 0,
      );
      const hasFollowAlongVideo = currentBlocks.some(
        (b) => b.type === 'Follow-Along Video' && !!b.videoUrl,
      );
      if (totalMovs === 0 && !hasFollowAlongVideo) {
        deleteDoc(doc(db, 'workouts', workoutId)).catch((e) => console.error('[WorkoutFolder] Unmount auto-delete error:', e));
        return;
      }

      // Non-empty workout with pending edits — fire-and-forget save
      if (dirtyRef.current) {
        const cleanBlocks = currentBlocks.map((b) => {
          const c: any = {
            type: b.type, label: b.label,
            rounds: b.rounds ?? DEFAULT_ROUNDS,
            restBetweenRoundsSec: b.restBetweenRoundsSec ?? 0,
            restBetweenMovementsSec: b.restBetweenMovementsSec ?? 0,
            durationSec: b.durationSec ?? undefined,
            instructionText: b.instructionText ?? undefined,
            firstMovementPrepSec: b.firstMovementPrepSec ?? DEFAULT_REST_SEC,
            showDemo: b.showDemo ?? false,
            demoDurationSec: b.demoDurationSec ?? DEFAULT_DEMO_DURATION_SEC,
            movements: (b.movements ?? []).map((m) => ({
              movementId: m.movementId, movementName: m.movementName,
              sets: m.sets ?? undefined, reps: m.reps ?? undefined,
              weight: m.weight ?? undefined,
              durationSec: m.durationSec ?? undefined, restSec: m.restSec ?? undefined,
              notes: m.notes ?? '', thumbnailUrl: m.thumbnailUrl ?? undefined,
              posterUrl: m.posterUrl ?? undefined,
              swapSides: m.swapSides ?? undefined,
              swapMode: m.swapMode ?? undefined,
              swapWindowSec: m.swapWindowSec ?? undefined,
              prescriptionVoiceUrl: m.prescriptionVoiceUrl ?? undefined,
              prescriptionVoiceCacheKey: m.prescriptionVoiceCacheKey ?? undefined,
            })),
          };
          if (b.type === 'Follow-Along Video') {
            c.videoUrl = b.videoUrl ?? undefined;
            c.videoStoragePath = b.videoStoragePath ?? undefined;
            c.videoDurationSec = b.videoDurationSec ?? undefined;
            c.soundEnabled = b.soundEnabled ?? true;
            c.cropScale = b.cropScale ?? 1;
            c.cropTranslateX = b.cropTranslateX ?? 0;
            c.cropTranslateY = b.cropTranslateY ?? 0;
            c.cropFrameWidth = b.cropFrameWidth ?? undefined;
            c.cropFrameHeight = b.cropFrameHeight ?? undefined;
          }
          return c;
        });
        const coverThumbs: string[] = [];
        for (const b of cleanBlocks) {
          for (const m of b.movements ?? []) {
            if (m.thumbnailUrl && coverThumbs.length < 16) coverThumbs.push(m.thumbnailUrl);
          }
        }
        updateDoc(doc(db, 'workouts', workoutId), stripUndefined({
          blocks: cleanBlocks, coverThumbs,
          estimatedDurationMin: calcDurationMin(currentBlocks),
          name: nameRef.current,
          updatedAt: serverTimestamp(),
        })).catch(() => {});
      }
    };
  }, [workoutId]);

  // ── Empty workout check ──────────────────────────────────────────────────
  // A workout is "empty" if it has zero movements across all blocks AND
  // no intro/outro videos. Default scaffold blocks with empty movement
  // arrays don't count as real content.
  const isWorkoutEmpty = useCallback((): boolean => {
    const totalMovs = blocksRef.current.reduce(
      (sum, b) => sum + (b.movements?.length ?? 0), 0,
    );
    if (totalMovs > 0) return false;
    if (introVideoUrl || outroVideoUrl) return false;
    const hasFollowAlongVideo = blocksRef.current.some(
      (b) => b.type === 'Follow-Along Video' && !!b.videoUrl,
    );
    if (hasFollowAlongVideo) return false;
    return true;
  }, [introVideoUrl, outroVideoUrl]);

  // ── Back handler (auto-deletes empty workouts) ──────────────────────────
  const handleBack = useCallback(async () => {
    // Cancel any pending debounced save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    if (isWorkoutEmpty()) {
      // Silently remove the empty shell — no confirmation needed
      try {
        deletedRef.current = true;
        await deleteDoc(doc(db, 'workouts', workoutId));
      } catch (e) {
        console.error('[WorkoutFolder] Auto-delete empty workout error:', e);
        deletedRef.current = false;
      }
    } else {
      await flushSave();
    }
    onBack();
  }, [workoutId, isWorkoutEmpty, flushSave, onBack]);

  // ── Delete workout (confirmed) ──────────────────────────────────────────
  const confirmDeleteWorkout = useCallback(async () => {
    try {
      deletedRef.current = true;
      await deleteDoc(doc(db, 'workouts', workoutId));
      // Navigate back immediately — component unmount handles Modal cleanup
      onBack();
    } catch (e) {
      console.error('[WorkoutFolder] Delete workout error:', e);
      deletedRef.current = false;
    }
  }, [workoutId, onBack]);

  // ── Duplicate workout ──────────────────────────────────────────────────
  // "Copy of <name>" prefix with collision dedupe — "(2)", "(3)", … if needed.
  // Re-uses movement references by ID; doesn't carry share tokens, assignments,
  // isShared flag, or cached GIFs (those regenerate on first save/play).
  const confirmDuplicateWorkout = useCallback(async () => {
    if (duplicating) return;
    try {
      setDuplicating(true);
      // Flush any in-flight edits so we copy the latest state from Firestore.
      await flushSave();

      const fullSnap = await getDoc(doc(db, 'workouts', workoutId));
      if (!fullSnap.exists()) {
        throw new Error('Workout not found');
      }
      const original = fullSnap.data() as any;
      const originalName = (original.name ?? 'Untitled Workout').trim();

      // Find a unique "Copy of …" name for this coach.
      const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
      const existingSnap = await getDocs(
        query(collection(db, 'workouts'), where('coachId', '==', coachId)),
      );
      const existingNames = new Set<string>();
      existingSnap.docs.forEach((d) => {
        const n = (d.data() as any)?.name;
        if (typeof n === 'string') existingNames.add(norm(n));
      });
      let candidate = `Copy of ${originalName}`;
      if (existingNames.has(norm(candidate))) {
        let n = 2;
        while (existingNames.has(norm(`Copy of ${originalName} (${n})`))) n++;
        candidate = `Copy of ${originalName} (${n})`;
      }

      // Deep-clone blocks so nested arrays/objects aren't shared with the source doc.
      const clonedBlocks = original.blocks ? JSON.parse(JSON.stringify(original.blocks)) : [];

      const payload: any = {
        name: candidate,
        description: original.description ?? '',
        coachId,
        tenantId,
        blocks: clonedBlocks,
        coverThumbs: Array.isArray(original.coverThumbs) ? [...original.coverThumbs] : [],
        estimatedDurationMin: original.estimatedDurationMin ?? null,
        category: original.category ?? undefined,
        // Intro / Outro: keep source videos so the duplicate looks identical,
        // but reset GIF caches — the player regenerates them on first play.
        introVideoUrl: original.introVideoUrl ?? null,
        introGifUrl: null,
        outroVideoUrl: original.outroVideoUrl ?? null,
        outroGifUrl: null,
        introCropScale: original.introCropScale ?? 1,
        introCropTranslateX: original.introCropTranslateX ?? 0,
        introCropTranslateY: original.introCropTranslateY ?? 0,
        outroCropScale: original.outroCropScale ?? 1,
        outroCropTranslateX: original.outroCropTranslateX ?? 0,
        outroCropTranslateY: original.outroCropTranslateY ?? 0,
        isArchived: false,
        isTemplate: original.isTemplate ?? false,
        // Never inherit sharing — duplicate starts private; coach can re-share if they want.
        isShared: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      const newRef = await addDoc(collection(db, 'workouts'), stripUndefined(payload));

      setShowDuplicateConfirm(false);
      // Navigate the coach directly into the new workout.
      // The parent (build.tsx) swaps openWorkoutId, which unmounts this
      // instance and mounts a fresh one with the new id.
      if (onDuplicated) {
        onDuplicated(newRef.id);
      }
    } catch (e: any) {
      console.error('[WorkoutFolder] Duplicate workout error:', e?.message ?? e);
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.alert('Could not duplicate workout. Please try again.');
      } else {
        Alert.alert('Error', 'Could not duplicate workout. Please try again.');
      }
    } finally {
      setDuplicating(false);
    }
  }, [duplicating, flushSave, workoutId, coachId, tenantId, onDuplicated]);

  // ── Block operations ──────────────────────────────────────────────────────
  const updateBlocks = useCallback((newBlocks: WorkoutBlock[]) => {
    setBlocks(newBlocks);
    autoSave(newBlocks);
  }, [autoSave]);

  const addBlock = useCallback((type: string, atIndex?: number) => {
    const isSpecial = NO_MOVEMENT_BLOCKS.includes(type);
    const newBlock: WorkoutBlock = {
      type,
      label: type === 'Water Break' ? '💧 Water Break' : type === 'Transition' ? '→ Transition' : type,
      rounds: isSpecial ? undefined : DEFAULT_ROUNDS,
      durationSec: isSpecial ? (type === 'Water Break' ? 30 : 10) : undefined,
      firstMovementPrepSec: isSpecial ? undefined : DEFAULT_REST_SEC,
      showDemo: false,
      demoDurationSec: DEFAULT_DEMO_DURATION_SEC,
      showGrabEquipment: false,
      beginningRestSec: undefined,
      movements: [],
    };
    const newBlocks = [...blocks];
    if (atIndex !== undefined && atIndex >= 0) {
      newBlocks.splice(atIndex, 0, newBlock);
    } else {
      newBlocks.push(newBlock);
    }
    updateBlocks(newBlocks);
    return newBlocks.length - 1;
  }, [blocks, updateBlocks]);

  /** Insert a Follow-Along Video block populated from a `followAlongVideos` asset. */
  const addFollowAlongBlock = useCallback((asset: FollowAlongOption, atIndex?: number) => {
    const newBlock: WorkoutBlock = {
      type: 'Follow-Along Video',
      label: asset.name || 'Follow-Along Video',
      durationSec: asset.videoDurationSec ?? 0,
      videoUrl: asset.videoUrl ?? undefined,
      videoStoragePath: asset.videoStoragePath ?? undefined,
      videoDurationSec: asset.videoDurationSec ?? 0,
      soundEnabled: asset.soundEnabled ?? true,
      cropScale: asset.cropScale ?? 1,
      cropTranslateX: asset.cropTranslateX ?? 0,
      cropTranslateY: asset.cropTranslateY ?? 0,
      cropFrameWidth: asset.cropFrameWidth ?? 0,
      cropFrameHeight: asset.cropFrameHeight ?? 0,
      movements: [],
    };
    const newBlocks = [...blocks];
    if (atIndex !== undefined && atIndex >= 0) newBlocks.splice(atIndex, 0, newBlock);
    else newBlocks.push(newBlock);
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  const removeBlock = useCallback((blockIdx: number) => {
    const newBlocks = blocks.filter((_, i) => i !== blockIdx);
    updateBlocks(newBlocks);
    setExpandedBlockIdx(null);
    setExpandedMovKey(null);
  }, [blocks, updateBlocks]);

  const updateBlockRounds = useCallback((blockIdx: number, delta: number) => {
    const newBlocks = [...blocks];
    const current = newBlocks[blockIdx].rounds ?? DEFAULT_ROUNDS;
    newBlocks[blockIdx].rounds = Math.max(1, current + delta);
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  const updateBlockPrepTime = useCallback((blockIdx: number, delta: number) => {
    const newBlocks = [...blocks];
    const current = newBlocks[blockIdx].firstMovementPrepSec ?? DEFAULT_REST_SEC;
    newBlocks[blockIdx].firstMovementPrepSec = Math.max(0, current + delta);
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  const toggleBlockDemo = useCallback((blockIdx: number) => {
    const newBlocks = [...blocks];
    newBlocks[blockIdx].showDemo = !newBlocks[blockIdx].showDemo;
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  const updateBlockField = useCallback((blockIdx: number, field: string, value: any) => {
    const newBlocks = [...blocks];
    (newBlocks[blockIdx] as any)[field] = value;
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  // ── Grab Equipment input history (equipmentInputHistory collection) ──────
  const slugifyEquipText = (text: string): string =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

  const upsertEquipHistory = useCallback(async (text: string, imageUrl?: string) => {
    const trimmed = text.trim();
    if (!coachId || !trimmed) return;
    const slug = slugifyEquipText(trimmed);
    if (!slug) return;
    try {
      const payload: Record<string, any> = { coachId, text: trimmed, updatedAt: serverTimestamp() };
      if (imageUrl !== undefined) payload.imageUrl = imageUrl;
      await setDoc(doc(db, 'equipmentInputHistory', `${coachId}_${slug}`), payload, { merge: true });
    } catch (err) {
      console.warn('[WorkoutFolder] equipmentInputHistory upsert failed', err);
    }
  }, [coachId]);

  const toggleEquipHistory = useCallback(async (blockIdx: number) => {
    if (equipHistoryOpenIdx === blockIdx) { setEquipHistoryOpenIdx(null); return; }
    setEquipHistoryOpenIdx(blockIdx);
    setEquipHistoryLoading(true);
    try {
      const snap = await getDocs(query(collection(db, 'equipmentInputHistory'), where('coachId', '==', coachId)));
      const entries = snap.docs
        .map(d => {
          const data = d.data();
          return {
            id: d.id,
            text: (data.text as string) ?? '',
            imageUrl: (data.imageUrl as string | null) ?? null,
            updatedAtMs: data.updatedAt?.toMillis?.() ?? 0,
          };
        })
        .filter(e => e.text)
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
        .map(({ id, text, imageUrl }) => ({ id, text, imageUrl }));
      setEquipHistory(entries);
    } catch (err) {
      console.warn('[WorkoutFolder] equipmentInputHistory load failed', err);
      setEquipHistory([]);
    } finally {
      setEquipHistoryLoading(false);
    }
  }, [coachId, equipHistoryOpenIdx]);

  const applyEquipHistoryEntry = useCallback((blockIdx: number, entry: { text: string; imageUrl: string | null }) => {
    const newBlocks = [...blocks];
    (newBlocks[blockIdx] as any).grabEquipmentText = entry.text;
    if (entry.imageUrl) (newBlocks[blockIdx] as any).grabEquipmentImageUrl = entry.imageUrl;
    updateBlocks(newBlocks);
    setEquipHistoryOpenIdx(null);
  }, [blocks, updateBlocks]);

  const deleteEquipHistoryEntry = useCallback(async (entryId: string) => {
    setEquipHistory(prev => prev.filter(e => e.id !== entryId));
    try {
      await deleteDoc(doc(db, 'equipmentInputHistory', entryId));
    } catch (err) {
      console.warn('[WorkoutFolder] equipmentInputHistory delete failed', err);
    }
  }, []);

  // ── Grab Equipment shared image library ──────────────────────────────────
  const listEquipImagesFn = httpsCallable<
    Record<string, never>,
    { images: { slug: string; label: string; imageUrl: string; thumbUrl?: string; createdBy?: string | null }[] }
  >(functions, 'listEquipmentImages');

  const deleteEquipImageFn = httpsCallable<{ equipmentSlug: string }, { ok: boolean; scope?: 'platform' | 'hidden' }>(
    functions, 'deleteEquipmentImage');

  const removeLibrarySlugLocally = useCallback((slug: string) => {
    setEquipLibrary(prev => (prev ?? []).filter(i => i.slug !== slug));
  }, []);

  const handleDeleteLibraryImage = useCallback((item: { slug: string; label: string }, mode: 'platform' | 'hide') => {
    const doAction = async () => {
      removeLibrarySlugLocally(item.slug);
      try {
        await deleteEquipImageFn({ equipmentSlug: item.slug });
      } catch (err) {
        console.warn('[WorkoutFolder] deleteEquipmentImage failed', err);
      }
    };
    const msg = mode === 'platform'
      ? 'This will permanently delete it. Visible to all coaches.'
      : 'This will hide it from your library. Only hidden for you — other coaches still see it.';
    const confirmLabel = mode === 'platform' ? 'Delete' : 'Remove';
    if (Platform.OS === 'web') {
      if (window.confirm(`Delete?\n${msg}`)) doAction();
    } else {
      Alert.alert('Delete?', msg, [
        { text: 'Cancel', style: 'cancel' },
        { text: confirmLabel, style: 'destructive', onPress: doAction },
      ]);
    }
  }, [deleteEquipImageFn, removeLibrarySlugLocally]);

  const openEquipLibrary = useCallback(async (blockIdx: number) => {
    setEquipLibraryOpenIdx(blockIdx);
    setEquipLibraryError(null);
    setEquipLibraryLoading(true);
    setEquipLibShowFilter(false);
    setEquipLibFilterText('');
    setEquipLibIsEditMode(false);
    setEquipLibRenaming({});
    try {
      const settingsPromise = equipLibSettingsLoadedRef.current
        ? Promise.resolve(null)
        : getDoc(doc(db, 'equipmentLibrarySettings', coachId));
      const [imagesResult, settingsSnap] = await Promise.all([listEquipImagesFn({}), settingsPromise]);
      setEquipLibrary(imagesResult.data.images ?? []);
      if (settingsSnap !== null) {
        if (settingsSnap.exists()) {
          const data = settingsSnap.data() as { order?: string[]; customNames?: Record<string, string> };
          setEquipLibOrder(data.order ?? []);
          setEquipLibCustomNames(data.customNames ?? {});
        } else {
          setEquipLibOrder([]);
          setEquipLibCustomNames({});
        }
        equipLibSettingsLoadedRef.current = true;
      }
    } catch (err: any) {
      console.warn('[WorkoutFolder] listEquipmentImages failed', err);
      setEquipLibraryError(String(err?.details ?? err?.message ?? 'Failed to load library'));
      setEquipLibrary([]);
    } finally {
      setEquipLibraryLoading(false);
    }
  }, [listEquipImagesFn, coachId]);

  const selectLibraryImage = useCallback((blockIdx: number, item: { slug: string; label: string; imageUrl: string }) => {
    const newBlocks = [...blocks];
    const currentText = (newBlocks[blockIdx].grabEquipmentText ?? '').trim();
    const text = currentText || item.label;
    (newBlocks[blockIdx] as any).grabEquipmentText = text;
    (newBlocks[blockIdx] as any).grabEquipmentImageUrl = item.imageUrl;
    updateBlocks(newBlocks);
    setEquipLibraryOpenIdx(null);
    upsertEquipHistory(text, item.imageUrl);
  }, [blocks, updateBlocks, upsertEquipHistory]);

  const closeBlockOverlay = useCallback(() => {
    if (blockOverlayIndex != null) {
      const t = blocks[blockOverlayIndex]?.grabEquipmentText;
      if (t?.trim()) upsertEquipHistory(t);
    }
    setEquipHistoryOpenIdx(null);
    setEquipLibraryOpenIdx(null);
    setBlockOverlayIndex(null);
  }, [blockOverlayIndex, blocks, upsertEquipHistory]);

  const closeEquipLibrary = useCallback(() => {
    setEquipLibraryOpenIdx(null);
    setEquipLibShowFilter(false);
    setEquipLibFilterText('');
    setEquipLibIsEditMode(false);
    setEquipLibRenaming({});
  }, []);

  const saveEquipLibOrder = useCallback(async (slugs: string[]) => {
    setEquipLibOrder(slugs);
    try {
      await setDoc(doc(db, 'equipmentLibrarySettings', coachId), { order: slugs }, { merge: true });
    } catch (err) {
      console.warn('[WorkoutFolder] saveEquipLibOrder failed', err);
    }
  }, [coachId]);

  const saveEquipLibCustomName = useCallback(async (slug: string, name: string) => {
    const trimmed = name.trim();
    setEquipLibCustomNames(prev => ({ ...prev, [slug]: trimmed }));
    try {
      await setDoc(doc(db, 'equipmentLibrarySettings', coachId), { customNames: { [slug]: trimmed } }, { merge: true });
    } catch (err) {
      console.warn('[WorkoutFolder] saveEquipLibCustomName failed', err);
    }
  }, [coachId]);

  // ── Grab Equipment image generation ──────────────────────────────────────
  const generateEquipImgFn = httpsCallable<
    { grabEquipmentText: string; forceRegenerate?: boolean },
    { imageUrl?: string; choices?: string[]; equipmentSlug?: string }
  >(functions, 'generateEquipmentImage', { timeout: 270000 });

  const saveEquipImgChoiceFn = httpsCallable<
    { equipmentSlug: string; choiceIndex: number },
    { imageUrl: string }
  >(functions, 'saveEquipmentImageChoice');

  const triggerEquipmentImageGen = useCallback(async (blockIdx: number, text: string, forceRegenerate = false) => {
    if (!text.trim()) return;
    setEquipImgStatus(prev => ({ ...prev, [blockIdx]: 'generating' }));
    setEquipImgError(prev => { const next = { ...prev }; delete next[blockIdx]; return next; });
    setEquipImgChoices(prev => { const next = { ...prev }; delete next[blockIdx]; return next; });
    try {
      const result = await generateEquipImgFn({ grabEquipmentText: text.trim(), forceRegenerate });
      if (result.data.imageUrl) {
        // Default cached — apply directly
        const newBlocks = [...blocks];
        (newBlocks[blockIdx] as any).grabEquipmentImageUrl = result.data.imageUrl;
        updateBlocks(newBlocks);
        setEquipImgStatus(prev => ({ ...prev, [blockIdx]: 'done' }));
        upsertEquipHistory(text, result.data.imageUrl);
      } else if (result.data.choices?.length) {
        // 3 variants returned — show picker
        setEquipImgChoices(prev => ({ ...prev, [blockIdx]: result.data.choices! }));
        setEquipImgSlug(prev => ({ ...prev, [blockIdx]: result.data.equipmentSlug ?? '' }));
        setEquipImgStatus(prev => ({ ...prev, [blockIdx]: 'choosing' }));
      } else {
        throw new Error('Unexpected response from generateEquipmentImage');
      }
    } catch (err: any) {
      console.warn('[WorkoutFolder] generateEquipmentImage failed', err);
      const msg = err?.details ?? err?.message ?? 'Unknown error';
      setEquipImgError(prev => ({ ...prev, [blockIdx]: String(msg) }));
      setEquipImgStatus(prev => ({ ...prev, [blockIdx]: 'error' }));
    }
  }, [blocks, generateEquipImgFn, updateBlocks, upsertEquipHistory]);

  const selectEquipmentImageChoice = useCallback(async (blockIdx: number, choiceIndex: number) => {
    const slug = equipImgSlug[blockIdx];
    if (!slug) return;
    setEquipImgStatus(prev => ({ ...prev, [blockIdx]: 'saving' }));
    try {
      const result = await saveEquipImgChoiceFn({ equipmentSlug: slug, choiceIndex });
      const newBlocks = [...blocks];
      (newBlocks[blockIdx] as any).grabEquipmentImageUrl = result.data.imageUrl;
      updateBlocks(newBlocks);
      setEquipImgChoices(prev => { const next = { ...prev }; delete next[blockIdx]; return next; });
      setEquipImgStatus(prev => ({ ...prev, [blockIdx]: 'done' }));
      upsertEquipHistory(blocks[blockIdx]?.grabEquipmentText ?? '', result.data.imageUrl);
    } catch (err: any) {
      console.warn('[WorkoutFolder] saveEquipmentImageChoice failed', err);
      const msg = err?.details ?? err?.message ?? 'Unknown error';
      setEquipImgError(prev => ({ ...prev, [blockIdx]: String(msg) }));
      setEquipImgStatus(prev => ({ ...prev, [blockIdx]: 'choosing' }));
    }
  }, [blocks, equipImgSlug, saveEquipImgChoiceFn, updateBlocks, upsertEquipHistory]);

  // ── Equipment library display (order + custom names + filter) ────────────
  const displayedLibrary = useMemo(() => {
    const images = equipLibrary ?? [];
    let ordered = [...images];
    if (equipLibOrder.length > 0) {
      const orderMap = new Map(equipLibOrder.map((slug, i) => [slug, i]));
      ordered.sort((a, b) => {
        const ai = orderMap.has(a.slug) ? orderMap.get(a.slug)! : 9999;
        const bi2 = orderMap.has(b.slug) ? orderMap.get(b.slug)! : 9999;
        return ai - bi2;
      });
    }
    return ordered.map(item => ({
      ...item,
      displayLabel: equipLibCustomNames[item.slug] ?? item.label,
    }));
  }, [equipLibrary, equipLibOrder, equipLibCustomNames]);

  // Client-side filter — fast now; add server-side search if the shared library grows into the hundreds
  const filteredLibrary = useMemo(() => {
    if (!equipLibFilterText.trim()) return displayedLibrary;
    const lower = equipLibFilterText.toLowerCase();
    return displayedLibrary.filter(item => item.displayLabel.toLowerCase().includes(lower));
  }, [displayedLibrary, equipLibFilterText]);

  // ── Movement operations ───────────────────────────────────────────────────
  const addMovementToBlock = useCallback((blockIdx: number, movement: MovementOption) => {
    const newBlocks = [...blocks];
    const next: BlockMovement = {
      movementId: movement.id,
      movementName: movement.name,
      durationSec: DEFAULT_DURATION_SEC,
      restSec: DEFAULT_REST_SEC,
      sets: 1,
      thumbnailUrl: movement.thumbnailUrl ?? movement.mediaUrl ?? undefined,
      posterUrl: movement.posterUrl ?? undefined,
    };
    next.swapSides = movement.swapSides ?? false;
    next.swapMode = movement.swapMode ?? 'split';
    next.swapWindowSec = movement.swapWindowSec ?? 5;
    newBlocks[blockIdx].movements.push(next);
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  const removeMovementFromBlock = useCallback((blockIdx: number, movIdx: number) => {
    const newBlocks = [...blocks];
    newBlocks[blockIdx].movements.splice(movIdx, 1);
    updateBlocks(newBlocks);
    setExpandedMovKey(null);
  }, [blocks, updateBlocks]);

  const updateMovementDuration = useCallback((blockIdx: number, movIdx: number, delta: number) => {
    const newBlocks = [...blocks];
    const mov = newBlocks[blockIdx].movements[movIdx];
    mov.durationSec = Math.max(5, (mov.durationSec ?? DEFAULT_DURATION_SEC) + delta);
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  const updateMovementRest = useCallback((blockIdx: number, movIdx: number, delta: number) => {
    const newBlocks = [...blocks];
    const mov = newBlocks[blockIdx].movements[movIdx];
    mov.restSec = Math.max(0, (mov.restSec ?? DEFAULT_REST_SEC) + delta);
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  const updateMovementReps = useCallback((blockIdx: number, movIdx: number, reps: string) => {
    const newBlocks = [...blocks];
    newBlocks[blockIdx].movements[movIdx].reps = reps;
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  const updateMovementWeight = useCallback((blockIdx: number, movIdx: number, weight: string) => {
    const newBlocks = [...blocks];
    newBlocks[blockIdx].movements[movIdx].weight = weight;
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  const updateMovementDisplayName = useCallback((blockIdx: number, movIdx: number, name: string) => {
    const newBlocks = [...blocks];
    newBlocks[blockIdx].movements[movIdx].displayName = name || undefined;
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  const toggleMovementVisibility = useCallback((blockIdx: number, movIdx: number) => {
    const newBlocks = [...blocks];
    const mov = newBlocks[blockIdx].movements[movIdx];
    mov.hidden = !mov.hidden;
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  const updateMovementSwapMode = useCallback((blockIdx: number, movIdx: number, mode: 'split' | 'duplicate') => {
    const newBlocks = [...blocks];
    const mov = newBlocks[blockIdx].movements[movIdx];
    const lib = availableMovements.find((m) => m.id === mov.movementId);
    if (!(mov.swapSides || lib?.swapSides)) return;
    mov.swapSides = true; // persist override on block
    mov.swapMode = mode;
    if (mov.swapWindowSec == null) mov.swapWindowSec = lib?.swapWindowSec ?? 5;
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks, availableMovements]);

  const updateMovementSwapWindow = useCallback((blockIdx: number, movIdx: number, delta: number) => {
    const newBlocks = [...blocks];
    const mov = newBlocks[blockIdx].movements[movIdx];
    const lib = availableMovements.find((m) => m.id === mov.movementId);
    if (!(mov.swapSides || lib?.swapSides)) return;
    mov.swapSides = true;
    if (mov.swapMode == null) mov.swapMode = lib?.swapMode ?? 'split';
    const current = mov.swapWindowSec ?? lib?.swapWindowSec ?? 5;
    mov.swapWindowSec = Math.max(0, Math.min(15, current + delta));
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks, availableMovements]);

  // ── Reorder: move a movement within the same block ──────────────────────
  const reorderMovement = useCallback((blockIdx: number, fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    const newBlocks = [...blocks];
    const movs = [...newBlocks[blockIdx].movements];
    const [moved] = movs.splice(fromIdx, 1);
    movs.splice(toIdx, 0, moved);
    newBlocks[blockIdx] = { ...newBlocks[blockIdx], movements: movs };
    updateBlocks(newBlocks);
  }, [blocks, updateBlocks]);

  // ── Intro/Outro save ─────────────────────────────────────────────────────
  const saveIntroOutro = useCallback(async (updates: {
    introVideoUrl?: string | null;
    introGifUrl?: string | null;
    outroVideoUrl?: string | null;
    outroGifUrl?: string | null;
  }) => {
    try {
      setSaving(true);
      await updateDoc(doc(db, 'workouts', workoutId), {
        ...updates,
        updatedAt: serverTimestamp(),
      });
      if (updates.introVideoUrl !== undefined) setIntroVideoUrl(updates.introVideoUrl);
      if (updates.introGifUrl !== undefined) setIntroGifUrl(updates.introGifUrl);
      if (updates.outroVideoUrl !== undefined) setOutroVideoUrl(updates.outroVideoUrl);
      if (updates.outroGifUrl !== undefined) setOutroGifUrl(updates.outroGifUrl);
    } catch (err: any) {
      console.error('[WorkoutFolder] Save intro/outro error:', err?.message ?? err);
    } finally {
      setSaving(false);
    }
  }, [workoutId]);

  // ── Workout music save ───────────────────────────────────────────────────
  const saveWorkoutMusic = useCallback(async (updates: {
    workoutMusicEnabled?: boolean;
    workoutMusicStyle?: string;
    workoutMusicVolume?: number;
  }) => {
    if (updates.workoutMusicEnabled !== undefined) setMusicEnabled(updates.workoutMusicEnabled);
    if (updates.workoutMusicStyle !== undefined) setMusicStyle(updates.workoutMusicStyle);
    if (updates.workoutMusicVolume !== undefined) setMusicVolume(updates.workoutMusicVolume);
    try {
      setSaving(true);
      await updateDoc(doc(db, 'workouts', workoutId), {
        ...updates,
        updatedAt: serverTimestamp(),
      });
    } catch (err: any) {
      console.error('[WorkoutFolder] Save workout music error:', err?.message ?? err);
    } finally {
      setSaving(false);
    }
  }, [workoutId]);

  // ── Crop done handler — saves crop values to Firestore ─────────────────
  const handleCropDone = useCallback(async (crop: CropValues) => {
    if (!cropTarget) return;
    const prefix = cropTarget.target === 'intro' ? 'intro' : 'outro';
    const updates: Record<string, number> = {
      [`${prefix}CropScale`]: crop.cropScale,
      [`${prefix}CropTranslateX`]: crop.cropTranslateX,
      [`${prefix}CropTranslateY`]: crop.cropTranslateY,
    };
    try {
      await updateDoc(doc(db, 'workouts', workoutId), { ...updates, updatedAt: serverTimestamp() });
      if (cropTarget.target === 'intro') setIntroCrop(crop);
      else setOutroCrop(crop);
    } catch (err: any) {
      console.error('[WorkoutFolder] Save crop error:', err?.message ?? err);
      Alert.alert('Save Failed', 'Could not save crop settings. Please try again.');
    }
    setCropTarget(null);
  }, [cropTarget, workoutId]);

  // ── Filtered movements for picker ─────────────────────────────────────────
  const filteredMovements = useMemo((): MovementOption[] => {
    const f = filterMovements(availableMovements as any[], {
      search: movementSearch,
      equipment: pickerEquipmentFilter,
      muscleGroup: pickerMuscleGroupFilter,
      difficulty: pickerDifficultyFilter,
    });
    return rankByPrimaryMuscle(f, pickerMuscleGroupFilter) as MovementOption[];
  }, [availableMovements, movementSearch, pickerEquipmentFilter, pickerMuscleGroupFilter, pickerDifficultyFilter]);

  // ── Filtered follow-alongs for picker ─────────────────────────────────────
  const filteredFollowAlongs = useMemo(() => {
    if (!followAlongSearch.trim()) return availableFollowAlongs;
    const q = followAlongSearch.toLowerCase();
    return availableFollowAlongs.filter(f => f.name.toLowerCase().includes(q));
  }, [availableFollowAlongs, followAlongSearch]);

  // ── Auto-inferred metadata ────────────────────────────────────────────────
  const autoDuration = useMemo(() => calcDurationMin(blocks), [blocks]);
  const totalMovements = useMemo(() => blocks.reduce((sum, b) => sum + b.movements.length, 0), [blocks]);

  // ── Title save ────────────────────────────────────────────────────────────
  const saveTitle = useCallback(async () => {
    setEditingTitle(false);
    if (workoutName.trim()) {
      autoSave(blocks, workoutName.trim());
    }
  }, [workoutName, blocks, autoSave]);

  // ── Description save ──────────────────────────────────────────────────────
  const saveDescription = useCallback(async () => {
    setShowDescriptionEdit(false);
    try {
      await updateDoc(doc(db, 'workouts', workoutId), {
        description: workoutDescription.trim(),
        updatedAt: serverTimestamp(),
      });
    } catch (err: any) {
      console.error('[WorkoutFolder] Save description error:', err);
    }
  }, [workoutId, workoutDescription]);

  // ── Rest duration save ────────────────────────────────────────────────────
  const saveRestDuration = useCallback(async (val: number) => {
    try {
      await updateDoc(doc(db, 'workouts', workoutId), {
        restDurationSeconds: val,
        updatedAt: serverTimestamp(),
      });
    } catch (err: any) {
      console.error('[WorkoutFolder] Save rest duration error:', err);
    }
  }, [workoutId]);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={st.root}>
        <View style={st.centered}>
          <ActivityIndicator size="large" color="#F5A623" />
        </View>
      </View>
    );
  }

  // ── Intro/Outro Asset Page ────────────────────────────────────────────────
  if (showIntroOutroPage) {
    return (
      <View style={st.root}>
        <View style={st.header}>
          <Pressable onPress={() => setShowIntroOutroPage(false)} style={st.backBtn}>
            <Icon name="arrow-left" size={20} color="#F0F4F8" />
          </Pressable>
          <View style={st.breadcrumb}>
            <Pressable onPress={() => setShowIntroOutroPage(false)}>
              <Text style={st.breadcrumbRoot}>{workoutName}</Text>
            </Pressable>
            <Text style={st.breadcrumbSep}>/</Text>
            <Text style={st.titleText}>Intro / Outro</Text>
          </View>
        </View>
        <ScrollView
          style={st.scrollArea}
          contentContainerStyle={{ paddingHorizontal: GRID_PADDING, paddingBottom: CONTENT_BOTTOM_CLEARANCE }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={st.ioSectionTitle}>Intro Video</Text>
          <Text style={st.ioSectionDesc}>
            Plays full-screen for ~10 seconds at the start of the workout. Upload a video or photo in iPhone Pro Max ratio.
          </Text>
          <View style={st.ioAssetRow}>
            {introGifUrl ? (
              <View style={st.ioAssetCard}>
                <Image source={{ uri: introGifUrl }} style={st.ioAssetImage} resizeMode="cover" />
                <View style={st.ioAssetOverlay}>
                  <Text style={st.ioAssetLabel}>Intro</Text>
                </View>
                <Pressable
                  style={st.ioRemoveBtn}
                  onPress={(e) => { e.stopPropagation(); saveIntroOutro({ introVideoUrl: null, introGifUrl: null }); }}
                >
                  <Icon name="close" size={14} color="#EF4444" />
                </Pressable>
                {!isImageUrl(introVideoUrl) && (
                  <Pressable
                    style={st.ioCropBtn}
                    onPress={() => setCropTarget({ target: 'intro', videoUrl: introVideoUrl! })}
                  >
                    <Icon name="crop" size={14} color="#F5A623" />
                    <Text style={st.ioCropBtnText}>Crop</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <Pressable style={st.ioUploadCard} onPress={() => pickAndUploadIntroOutro('intro')} disabled={ioUploading === 'intro'}>
                {ioUploading === 'intro' ? (
                  <>
                    <ActivityIndicator size="small" color="#F5A623" />
                    <Text style={st.ioUploadText}>{Math.round(ioUploadProgress * 100)}%</Text>
                  </>
                ) : (
                  <>
                    <Icon name="plus" size={28} color="#F5A623" />
                    <Text style={st.ioUploadText}>Upload Intro</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>

          <Text style={[st.ioSectionTitle, { marginTop: 32 }]}>Outro Video</Text>
          <Text style={st.ioSectionDesc}>
            Plays full-screen for ~10 seconds at the end of the workout. Upload a video or photo in iPhone Pro Max ratio.
          </Text>
          <View style={st.ioAssetRow}>
            {outroGifUrl ? (
              <View style={st.ioAssetCard}>
                <Image source={{ uri: outroGifUrl }} style={st.ioAssetImage} resizeMode="cover" />
                <View style={st.ioAssetOverlay}>
                  <Text style={st.ioAssetLabel}>Outro</Text>
                </View>
                <Pressable
                  style={st.ioRemoveBtn}
                  onPress={(e) => { e.stopPropagation(); saveIntroOutro({ outroVideoUrl: null, outroGifUrl: null }); }}
                >
                  <Icon name="close" size={14} color="#EF4444" />
                </Pressable>
                {!isImageUrl(outroVideoUrl) && (
                  <Pressable
                    style={st.ioCropBtn}
                    onPress={() => setCropTarget({ target: 'outro', videoUrl: outroVideoUrl! })}
                  >
                    <Icon name="crop" size={14} color="#F5A623" />
                    <Text style={st.ioCropBtnText}>Crop</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <Pressable style={st.ioUploadCard} onPress={() => pickAndUploadIntroOutro('outro')} disabled={ioUploading === 'outro'}>
                {ioUploading === 'outro' ? (
                  <>
                    <ActivityIndicator size="small" color="#F5A623" />
                    <Text style={st.ioUploadText}>{Math.round(ioUploadProgress * 100)}%</Text>
                  </>
                ) : (
                  <>
                    <Icon name="plus" size={28} color="#F5A623" />
                    <Text style={st.ioUploadText}>Upload Outro</Text>
                  </>
                )}
              </Pressable>
            )}
          </View>

          <View style={st.ioInfoBox}>
            <Icon name="info" size={16} color="#8A95A3" />
            <Text style={st.ioInfoText}>
              Intro and outro videos are automatically added to every workout playback.
              The GIF thumbnail is shown here; the full video plays during the workout.
            </Text>
          </View>
        </ScrollView>

        {/* Crop modal — opens after upload or when tapping Crop button */}
        <VideoCropModal
          visible={!!cropTarget}
          videoUri={cropTarget?.videoUrl ?? ''}
          initialCrop={cropTarget?.target === 'intro' ? introCrop : outroCrop}
          frameAspect={9 / 19.5}
          onDone={handleCropDone}
          onCancel={() => setCropTarget(null)}
        />
      </View>
    );
  }

  // ── Move-to page ─────────────────────────────────────────────────────────
  if (showMoveTo) {
    return (
      <View style={st.root}>
        <View style={st.header}>
          <Pressable onPress={() => setShowMoveTo(false)} style={st.backBtn}>
            <Icon name="arrow-left" size={20} color="#F0F4F8" />
          </Pressable>
          <View style={st.breadcrumb}>
            <Text style={st.titleText}>Move to...</Text>
          </View>
        </View>
        <View style={{ paddingHorizontal: GRID_PADDING, paddingTop: 12 }}>
          <View style={st.moveToSearchBar}>
            <Icon name="search" size={16} color="#4A5568" />
            <TextInput
              style={st.moveToSearchInput}
              value={moveToSearch}
              onChangeText={setMoveToSearch}
              placeholder="Search folders & playbooks..."
              placeholderTextColor="#4A5568"
              autoFocus
            />
          </View>
        </View>
        <ScrollView style={st.scrollArea} contentContainerStyle={{ paddingHorizontal: GRID_PADDING, paddingBottom: CONTENT_BOTTOM_CLEARANCE }}>
          <Text style={st.moveToSectionTitle}>Folders</Text>
          <View style={st.moveToEmpty}>
            <Text style={st.moveToEmptyText}>No folders yet</Text>
          </View>
          <Pressable style={st.moveToCreateBtn} onPress={() => console.log('[WorkoutFolder] Create folder — not yet wired')}>
            <Icon name="plus" size={16} color="#F5A623" />
            <Text style={st.moveToCreateText}>Create Folder</Text>
          </Pressable>

          <Text style={[st.moveToSectionTitle, { marginTop: 24 }]}>Playbooks</Text>
          {(() => {
            const q = moveToSearch.trim().toLowerCase();
            const visible = q
              ? movePlaybooks.filter(pb => (pb.name || '').toLowerCase().includes(q))
              : movePlaybooks;
            if (visible.length === 0) {
              return (
                <View style={st.moveToEmpty}>
                  <Text style={st.moveToEmptyText}>No playbooks yet</Text>
                </View>
              );
            }
            return visible.map(pb => {
              const alreadyIn = Array.isArray(pb.workoutIds) && pb.workoutIds.includes(workoutId);
              return (
                <Pressable
                  key={pb.id}
                  style={[st.moveToCreateBtn, { justifyContent: 'flex-start', borderStyle: 'solid', borderColor: '#2A3340', marginBottom: 8 }]}
                  onPress={() => addToPlaybook(pb)}
                  disabled={alreadyIn || moveToBusyId === pb.id}
                >
                  <Icon name="playbook" size={16} color="#A78BFA" />
                  <Text style={[st.moveToCreateText, { color: '#F0F4F8', flex: 1 }]} numberOfLines={1}>
                    {pb.name || 'Untitled Playbook'}
                  </Text>
                  {moveToBusyId === pb.id ? (
                    <ActivityIndicator size="small" color="#A78BFA" />
                  ) : alreadyIn ? (
                    <Text style={[st.moveToCreateText, { color: '#34D399' }]}>Added ✓</Text>
                  ) : (
                    <Icon name="plus" size={16} color="#A78BFA" />
                  )}
                </Pressable>
              );
            });
          })()}
        </ScrollView>
      </View>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // ── MAIN RENDER ─────────────────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════════════
  return (
    <View style={st.root}>
      {/* ── Header / Breadcrumb ──────────────────────────────────────────── */}
      <View style={st.header}>
        <Pressable onPress={handleBack} style={st.backBtn}>
          <Icon name="arrow-left" size={20} color="#F0F4F8" />
        </Pressable>

        <View style={st.breadcrumb}>
          <Pressable onPress={handleBack}>
            <Text style={st.breadcrumbRoot}>Build</Text>
          </Pressable>
          <Text style={st.breadcrumbSep}>/</Text>
          {editingTitle ? (
            <TextInput
              style={st.titleInput}
              value={workoutName}
              onChangeText={setWorkoutName}
              onBlur={saveTitle}
              onSubmitEditing={saveTitle}
              autoFocus
              selectTextOnFocus
            />
          ) : (
            <Pressable onPress={() => setEditingTitle(true)}>
              <Text style={st.titleText} numberOfLines={1}>{workoutName}</Text>
            </Pressable>
          )}
        </View>

        {/* Save status indicator */}
        {saveStatus === 'saving' && (
          <View style={st.savingBadge}>
            <ActivityIndicator size="small" color="#F5A623" />
          </View>
        )}
        {saveStatus === 'saved' && (
          <View style={st.savedBadge}>
            <Icon name="check" size={12} color="#34D399" />
            <Text style={st.savedText}>Saved</Text>
          </View>
        )}

        {/* Preview button */}
        <Pressable
          onPress={async () => { await flushSave(); setShowPreview(true); }}
          style={st.previewBtn}
        >
          <Icon name="eye" size={16} color="#FBBF24" />
          <Text style={st.previewBtnText}>Preview</Text>
        </Pressable>

        {/* Three-dots menu */}
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            setShowTitleMenu(!showTitleMenu);
          }}
          style={st.menuBtn}
        >
          <Icon name="more-vertical" size={20} color="#8A95A3" />
        </Pressable>

        {/* View mode toggle */}
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            setViewMode(viewMode === 'icon' ? 'list' : 'icon');
          }}
          style={st.viewToggle}
        >
          <Icon name={viewMode === 'icon' ? 'list' : 'grid'} size={18} color="#8A95A3" />
        </Pressable>
      </View>

      {/* ── Subtitle: auto-inferred metadata ─────────────────────────────── */}
      <View style={st.metaRow}>
        <Text style={st.metaText}>~{autoDuration} min</Text>
        <Text style={st.metaDot}>·</Text>
        <Text style={st.metaText}>{blocks.length} blocks</Text>
        <Text style={st.metaDot}>·</Text>
        <Text style={st.metaText}>{totalMovements} movements</Text>
        {(introVideoUrl || outroVideoUrl) && (
          <>
            <Text style={st.metaDot}>·</Text>
            <Text style={[st.metaText, { color: '#F472B6' }]}>
              {introVideoUrl && outroVideoUrl ? 'Intro + Outro' :
               introVideoUrl ? 'Intro' : 'Outro'}
            </Text>
          </>
        )}
      </View>

      {/* ── Title menu dropdown ──────────────────────────────────────────── */}
      {showTitleMenu && (
        <Pressable
          style={st.menuOverlay}
          onPress={(e) => { e.stopPropagation(); setShowTitleMenu(false); }}
        >
          <View style={st.menuDropdown} onStartShouldSetResponder={() => true}>
            <Pressable
              style={st.menuItem}
              onPress={() => {
                setShowTitleMenu(false);
                handleOpenShareSettings();
              }}
              disabled={shareLoading}
            >
              {shareLoading ? (
                <ActivityIndicator size={16} color="#6EBB7A" />
              ) : (
                <Icon name="share" size={16} color="#6EBB7A" />
              )}
              <Text style={[st.menuItemText, { color: '#6EBB7A' }]}>
                {activeShareId ? 'Share Settings' : 'Share Workout Link'}
              </Text>
            </Pressable>
            <View style={st.menuDivider} />
            <Pressable
              style={st.menuItem}
              onPress={() => { setShowTitleMenu(false); setShowDescriptionEdit(true); }}
            >
              <Icon name="edit" size={16} color="#8A95A3" />
              <Text style={st.menuItemText}>Edit Description</Text>
            </Pressable>
            <Pressable
              style={st.menuItem}
              onPress={() => { setShowTitleMenu(false); setEditingTitle(true); }}
            >
              <Icon name="edit" size={16} color="#8A95A3" />
              <Text style={st.menuItemText}>Rename Workout</Text>
            </Pressable>
            <Pressable
              style={st.menuItem}
              onPress={() => { setShowTitleMenu(false); setShowDuplicateConfirm(true); }}
            >
              <Icon name="copy" size={16} color="#8A95A3" />
              <Text style={st.menuItemText}>Duplicate Workout</Text>
            </Pressable>
            <View style={st.menuDivider} />
            <Pressable
              style={st.menuItem}
              onPress={() => { setShowTitleMenu(false); setShowIntroOutroPage(true); }}
            >
              <Icon name="play" size={16} color="#F472B6" />
              <Text style={st.menuItemText}>Edit Intro / Outro</Text>
            </Pressable>
            <Pressable
              style={st.menuItem}
              onPress={() => { setShowTitleMenu(false); setShowMusicModal(true); }}
            >
              <Icon name="music" size={16} color="#A78BFA" />
              <Text style={st.menuItemText}>Workout Music</Text>
            </Pressable>
            <Pressable
              style={st.menuItem}
              onPress={() => { setShowTitleMenu(false); setShowIntroAnnouncement(true); }}
            >
              <Icon name="sparkle" size={16} color="#FBBF24" />
              <Text style={st.menuItemText}>Intro Announcement</Text>
            </Pressable>
            <View style={st.menuDivider} />
            <Pressable
              style={st.menuItem}
              onPress={() => { setShowTitleMenu(false); setShowMoveTo(true); }}
            >
              <Icon name="arrow-right" size={16} color="#8A95A3" />
              <Text style={st.menuItemText}>Move to...</Text>
            </Pressable>
            <View style={st.menuDivider} />
            <Pressable
              style={st.menuItem}
              onPress={(e) => {
                e.stopPropagation();
                console.log('[WorkoutFolder] Delete menu item tapped — setting showDeleteConfirm=true');
                setShowTitleMenu(false);
                setShowDeleteConfirm(true);
              }}
            >
              <Icon name="trash-2" size={16} color="#EF4444" />
              <Text style={[st.menuItemText, { color: '#EF4444' }]}>Delete Workout</Text>
            </Pressable>
          </View>
        </Pressable>
      )}

      {/* ── Main content: blocks ─────────────────────────────────────────── */}
      <ScrollView
        style={st.scrollArea}
        contentContainerStyle={{ paddingHorizontal: GRID_PADDING, paddingBottom: 280 }}
        showsVerticalScrollIndicator={false}
        onScrollBeginDrag={dismissAll}
      >
        <Pressable onPress={dismissAll} style={{ flex: 1 }}>
        {blocks.length === 0 ? (
          <View style={st.emptyState}>
            <Pressable
              style={st.addFirstBlock}
              onPress={() => {
                setAddBlockAtIndex(0);
                setShowAddBlockMenu(true);
              }}
            >
              <View style={st.emptyPlus}>
                <Icon name="plus" size={32} color="#F5A623" />
              </View>
              <Text style={st.emptyText}>Add your first block</Text>
            </Pressable>
          </View>
        ) : (
          blocks.map((block, blockIdx) => {
            const displayType = isTabata(block) ? 'Tabata' : block.type;
            const blockColor = BLOCK_COLORS[displayType] || '#4A5568';
            const isSpecial = NO_MOVEMENT_BLOCKS.includes(block.type);
            const isBlockExpanded = expandedBlockIdx === blockIdx;
            const hasNoMovements = !isSpecial && block.movements.length === 0;

            return (
              <React.Fragment key={blockIdx}>
                {/* ── Block container ──────────────────────────────────── */}
                <View
                  style={[
                    st.blockContainer,
                    {
                      borderColor: blockColor,
                      borderWidth: isBlockExpanded ? 2 : 1,
                      opacity: isBlockExpanded ? 1 : 0.95,
                    },
                  ]}
                >
                  {/* Special block (Water Break, Transition, Follow-Along Video) */}
                  {isSpecial ? (
                    <Pressable
                      style={st.specialBlock}
                      onPress={(e) => {
                        e.stopPropagation();
                        setExpandedBlockIdx(isBlockExpanded ? null : blockIdx);
                        setExpandedMovKey(null);
                      }}
                    >
                      <View style={[st.specialIcon, { backgroundColor: blockColor + '20' }]}>
                        {block.type === 'Follow-Along Video' ? (
                          <Icon name="video" size={20} color={blockColor} />
                        ) : (
                          <Text style={{ fontSize: 20 }}>
                            {block.type === 'Water Break' ? '💧' :
                             block.type === 'Transition' ? '→' : '•'}
                          </Text>
                        )}
                      </View>
                      <Text style={[st.specialLabel, { color: blockColor }]}>{block.label}</Text>
                      {block.type === 'Follow-Along Video' ? (
                        <Text style={st.specialDuration}>
                          {(() => {
                            const d = block.videoDurationSec ?? block.durationSec ?? 0;
                            const mm = Math.floor(d / 60);
                            const ss = Math.round(d % 60);
                            return `${mm}:${String(ss).padStart(2, '0')}`;
                          })()}
                          {block.soundEnabled === false ? '  🔇' : '  🔊'}
                        </Text>
                      ) : (
                        block.durationSec !== undefined && (
                          <Text style={st.specialDuration}>{block.durationSec}s</Text>
                        )
                      )}
                      {isBlockExpanded && block.type === 'Water Break' && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <Text style={st.overlaySectionHint}>Duration</Text>
                          <TouchableOpacity
                            style={st.stepperBtn}
                            onPress={(e) => { e.stopPropagation(); updateBlockField(blockIdx, 'durationSec', Math.max(5, (block.durationSec ?? 30) - 5)); }}
                          >
                            <Text style={st.stepperBtnText}>−</Text>
                          </TouchableOpacity>
                          <Text style={st.stepperValue}>{block.durationSec ?? 30}s</Text>
                          <TouchableOpacity
                            style={st.stepperBtn}
                            onPress={(e) => { e.stopPropagation(); updateBlockField(blockIdx, 'durationSec', (block.durationSec ?? 30) + 5); }}
                          >
                            <Text style={st.stepperBtnText}>+</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      {isBlockExpanded && (
                        <Pressable
                          style={st.trashBtn}
                          onPress={(e) => { e.stopPropagation(); removeBlock(blockIdx); }}
                        >
                          <Icon name="trash-2" size={16} color="#EF4444" />
                        </Pressable>
                      )}
                    </Pressable>
                  ) : hasNoMovements ? (
                    /* ── Empty block — prompt to add first movement ── */
                    <View style={st.emptyBlockContainer}>
                      <Pressable
                        style={st.emptyBlockCard}
                        onPress={(e) => {
                          e.stopPropagation();
                          setMovementPickerBlockIdx(blockIdx);
                          setShowMovementPicker(true);
                          setMovementSearch('');
                        }}
                      >
                        <Icon name="plus" size={24} color="#F5A623" />
                        <Text style={st.emptyBlockText}>Add Movement</Text>
                      </Pressable>
                      <Pressable
                        style={st.trashBtn}
                        onPress={(e) => { e.stopPropagation(); removeBlock(blockIdx); }}
                      >
                        <Icon name="trash-2" size={16} color="#EF4444" />
                      </Pressable>
                    </View>
                  ) : viewMode === 'icon' ? (
                    /* ── Icon view: movement cards in grid (HALF SIZE) ──────── */
                    <View style={st.blockGrid}>
                      {block.movements.map((mov, movIdx) => {
                        const movKey = `${blockIdx}-${movIdx}`;
                        const isMovExpanded = expandedMovKey === movKey;
                        const thumbUri = mov.thumbnailUrl;
                        const isReorderSource = reorderSource?.blockIdx === blockIdx && reorderSource?.movIdx === movIdx;
                        const isReorderTarget = reorderSource !== null && reorderSource.blockIdx === blockIdx && !isReorderSource;

                        return (
                          <View key={movKey} style={{ width: cardWidth, position: 'relative' }}>
                            {/* Red X remove button — hangs off top-right corner */}
                            {isMovExpanded && !reorderSource && (
                              <Pressable
                                style={st.removeXBtn}
                                onPress={(e) => {
                                  e.stopPropagation();
                                  removeMovementFromBlock(blockIdx, movIdx);
                                }}
                              >
                                <Icon name="close" size={10} color="#fff" />
                              </Pressable>
                            )}
                            <Pressable
                              style={[
                                st.movCard,
                                {
                                  width: cardWidth,
                                  height: cardHeight,
                                  borderColor: isReorderSource ? '#38BDF8' : isMovExpanded ? '#F5A623' : isReorderTarget ? 'rgba(56,189,248,0.4)' : 'transparent',
                                  borderWidth: isReorderSource ? 2 : isMovExpanded ? 2 : isReorderTarget ? 1 : 0,
                                  opacity: mov.hidden ? 0.4 : isReorderSource ? 0.6 : 1,
                                  // Suppress iOS Safari native long-press context menu so hold-to-reorder fires
                                  ...({ WebkitTouchCallout: 'none', userSelect: 'none' } as any),
                                },
                              ]}
                              onPress={(e) => {
                                e.stopPropagation();
                                // If we're in reorder mode, tap = drop here
                                if (reorderSource) {
                                  if (reorderSource.blockIdx === blockIdx) {
                                    reorderMovement(blockIdx, reorderSource.movIdx, movIdx);
                                  }
                                  setReorderSource(null);
                                  return;
                                }
                                if (isMovExpanded) {
                                  setExpandedMovKey(null);
                                  setEditingNameKey(null);
                                } else {
                                  setExpandedMovKey(movKey);
                                  setExpandedBlockIdx(null);
                                  setEditingNameKey(null);
                                }
                              }}
                              onLongPress={(e) => {
                                e.stopPropagation();
                                setExpandedMovKey(null);
                                setEditingNameKey(null);
                                setReorderSource({ blockIdx, movIdx });
                              }}
                            >
                              {/* Poster (static) → GIF (lazy swap on intersection) */}
                              <PosterThumb
                                posterUrl={mov.posterUrl}
                                gifUrl={thumbUri}
                                containerStyle={{ width: '100%', height: '100%' }}
                                resizeMode="cover"
                              />

                              {/* Hidden badge (shown when controls are closed and movement is hidden) — tap to unhide */}
                              {!isMovExpanded && mov.hidden && (
                                <Pressable
                                  style={st.hiddenBadge}
                                  onPress={(e) => {
                                    e.stopPropagation();
                                    toggleMovementVisibility(blockIdx, movIdx);
                                  }}
                                  {...(Platform.OS === 'web' ? {
                                    onClick: (e: any) => { e.stopPropagation(); },
                                  } : {})}
                                >
                                  <Icon name="eye-off" size={10} color="#fff" />
                                </Pressable>
                              )}

                              {/* Reorder indicator (shown on picked-up card) */}
                              {isReorderSource && (
                                <View style={[st.reorderIndicator, { userSelect: 'none' } as any]}>
                                  <Text style={st.reorderText} selectable={false}>Tap to place</Text>
                                </View>
                              )}

                              {/* Name overlay (shown when controls are closed) */}
                              {!isMovExpanded && !isReorderSource && (
                                <View style={st.nameOverlay}>
                                  <Text style={st.nameText} numberOfLines={1}>
                                    {mov.displayName || mov.movementName}
                                  </Text>
                                </View>
                              )}

                              {/* ── In-card overlay controls ── */}
                              {isMovExpanded && (
                                <View
                                  style={st.ovOverlay}
                                  {...(Platform.OS === 'web' ? {
                                    onClick: (e: any) => { e.stopPropagation(); },
                                  } : {
                                    onStartShouldSetResponder: () => true,
                                    onResponderTerminationRequest: () => false,
                                  })}
                                >
                                  {/* Rest/Prep — top row */}
                                  <View style={st.ovRow}>
                                    <Icon name="hourglass" size={10} color="#38BDF8" />
                                    <Pressable style={st.ovBtn} onPress={(e) => { e.stopPropagation(); updateMovementRest(blockIdx, movIdx, -5); }}>
                                      <Text style={st.ovBtnText}>−</Text>
                                    </Pressable>
                                    <Text style={st.ovVal}>{mov.restSec ?? DEFAULT_REST_SEC}s</Text>
                                    <Pressable style={st.ovBtn} onPress={(e) => { e.stopPropagation(); updateMovementRest(blockIdx, movIdx, 5); }}>
                                      <Text style={st.ovBtnText}>+</Text>
                                    </Pressable>
                                  </View>

                                  {/* Duration — second row */}
                                  <View style={st.ovRow}>
                                    <Icon name="flame" size={10} color="#F59E0B" />
                                    <Pressable style={st.ovBtn} onPress={(e) => { e.stopPropagation(); updateMovementDuration(blockIdx, movIdx, -5); }}>
                                      <Text style={st.ovBtnText}>−</Text>
                                    </Pressable>
                                    <Text style={st.ovVal}>{mov.durationSec ?? DEFAULT_DURATION_SEC}s</Text>
                                    <Pressable style={st.ovBtn} onPress={(e) => { e.stopPropagation(); updateMovementDuration(blockIdx, movIdx, 5); }}>
                                      <Text style={st.ovBtnText}>+</Text>
                                    </Pressable>
                                  </View>

                                  {/* Reps + Weight — third row (optional) */}
                                  <View style={st.ovRow}>
                                    <Text style={st.ovSmLabel}>reps</Text>
                                    <TextInput
                                      style={st.ovInput}
                                      value={mov.reps ?? ''}
                                      onChangeText={(t) => updateMovementReps(blockIdx, movIdx, t)}
                                      placeholder="—"
                                      placeholderTextColor="#4A5568"
                                      keyboardType="numeric"
                                    />
                                    <Text style={st.ovSmLabel}>lbs</Text>
                                    <TextInput
                                      style={st.ovInput}
                                      value={mov.weight ?? ''}
                                      onChangeText={(t) => updateMovementWeight(blockIdx, movIdx, t)}
                                      placeholder="—"
                                      placeholderTextColor="#4A5568"
                                      keyboardType="numeric"
                                    />
                                  </View>

                                  {/* Swap Sides — single toggle pill cycles split↔full, leaves room for ± window */}
                                  {(() => {
                                    const libMov = availableMovements.find((m) => m.id === mov.movementId);
                                    const effSwap = mov.swapSides ?? libMov?.swapSides ?? false;
                                    if (!effSwap) return null;
                                    const effMode = mov.swapMode ?? libMov?.swapMode ?? 'split';
                                    const effWindow = mov.swapWindowSec ?? libMov?.swapWindowSec ?? 5;
                                    return (
                                      <View style={st.swapRowCompact}>
                                        <Icon name="swap" size={10} color="#A78BFA" />
                                        <Pressable
                                          style={st.swapTogglePill}
                                          onPress={(e) => {
                                            e.stopPropagation();
                                            updateMovementSwapMode(blockIdx, movIdx, effMode === 'split' ? 'duplicate' : 'split');
                                          }}
                                        >
                                          <Text style={st.swapTogglePillText}>{effMode === 'split' ? '½' : '2×'}</Text>
                                        </Pressable>
                                        <Pressable style={st.ovBtn} onPress={(e) => { e.stopPropagation(); updateMovementSwapWindow(blockIdx, movIdx, -1); }}>
                                          <Text style={st.ovBtnText}>−</Text>
                                        </Pressable>
                                        <Text style={st.ovVal}>{effWindow}s</Text>
                                        <Pressable style={st.ovBtn} onPress={(e) => { e.stopPropagation(); updateMovementSwapWindow(blockIdx, movIdx, 1); }}>
                                          <Text style={st.ovBtnText}>+</Text>
                                        </Pressable>
                                      </View>
                                    );
                                  })()}

                                  {/* Bottom row: three-dots (details) + eye toggle (visibility) */}
                                  <View style={st.ovBottomRow}>
                                    <Pressable
                                      style={st.ovIconBtn}
                                      onPress={(e) => {
                                        e.stopPropagation();
                                        if (onOpenMovement) {
                                          const movData = availableMovements.find(m => m.id === mov.movementId);
                                          const payload = movData ?? {
                                            id: mov.movementId,
                                            name: mov.displayName || mov.movementName,
                                            category: '',
                                            thumbnailUrl: mov.thumbnailUrl ?? null,
                                            mediaUrl: null,
                                          };
                                          onOpenMovement(payload);
                                        }
                                      }}
                                    >
                                      <Icon name="more-horizontal" size={12} color="#8A95A3" />
                                    </Pressable>
                                    <Pressable
                                      style={st.ovIconBtn}
                                      onPress={(e) => {
                                        e.stopPropagation();
                                        toggleMovementVisibility(blockIdx, movIdx);
                                        if (!mov.hidden) {
                                          setExpandedMovKey(null);
                                          setEditingNameKey(null);
                                        }
                                      }}
                                    >
                                      <Icon
                                        name={mov.hidden ? 'eye-off' : 'eye'}
                                        size={12}
                                        color={mov.hidden ? '#4A5568' : '#34D399'}
                                      />
                                    </Pressable>
                                  </View>

                                  {/* Editable name at bottom */}
                                  {editingNameKey === movKey ? (
                                    <TextInput
                                      style={st.ovNameInput}
                                      value={editingNameValue}
                                      onChangeText={setEditingNameValue}
                                      onBlur={() => {
                                        updateMovementDisplayName(blockIdx, movIdx, editingNameValue);
                                        setEditingNameKey(null);
                                      }}
                                      onSubmitEditing={() => {
                                        updateMovementDisplayName(blockIdx, movIdx, editingNameValue);
                                        setEditingNameKey(null);
                                      }}
                                      autoFocus
                                      selectTextOnFocus
                                      placeholderTextColor="#4A5568"
                                      placeholder={mov.movementName}
                                    />
                                  ) : (
                                    <Pressable
                                      onPress={(e) => {
                                        e.stopPropagation();
                                        setEditingNameKey(movKey);
                                        setEditingNameValue(mov.displayName || mov.movementName);
                                      }}
                                    >
                                      <Text style={st.ovNameText} numberOfLines={1}>
                                        {mov.displayName || mov.movementName}
                                      </Text>
                                    </Pressable>
                                  )}
                                </View>
                              )}
                            </Pressable>
                          </View>
                        );
                      })}

                      {/* Add movement to this block */}
                      <Pressable
                        style={[st.addMovCard, { width: cardWidth, height: cardHeight }]}
                        onPress={(e) => {
                          e.stopPropagation();
                          setMovementPickerBlockIdx(blockIdx);
                          setShowMovementPicker(true);
                          setMovementSearch('');
                        }}
                      >
                        <Icon name="plus" size={18} color="#4A5568" />
                      </Pressable>
                    </View>
                  ) : (
                    /* ── List view: movement rows ───────────────────────── */
                    <View style={st.blockList}>
                      {block.movements.map((mov, movIdx) => {
                        const movKey = `${blockIdx}-${movIdx}`;
                        const isMovExpanded = expandedMovKey === movKey;
                        const thumbUri = mov.thumbnailUrl;

                        return (
                          <View key={movKey}>
                            <Pressable
                              style={[
                                st.listRow,
                                isMovExpanded && { backgroundColor: 'rgba(245, 166, 35, 0.08)' },
                              ]}
                              onPress={(e) => {
                                e.stopPropagation();
                                if (isMovExpanded) {
                                  setExpandedMovKey(null);
                                } else {
                                  setExpandedMovKey(movKey);
                                  setExpandedBlockIdx(null);
                                }
                              }}
                            >
                              <View style={st.listThumb}>
                                <PosterThumb
                                  posterUrl={mov.posterUrl}
                                  gifUrl={thumbUri}
                                  containerStyle={st.listThumbImg}
                                  resizeMode="cover"
                                />
                              </View>
                              <Text style={st.listMovName} numberOfLines={1}>{mov.movementName}</Text>
                            </Pressable>

                            {/* Quick controls in list view — compact inline */}
                            {isMovExpanded && (
                              <View style={st.listQuickControls} onStartShouldSetResponder={() => true}>
                                <View style={st.ovRow}>
                                  <Icon name="hourglass" size={10} color="#38BDF8" />
                                  <Pressable style={st.ovBtn} onPress={() => updateMovementRest(blockIdx, movIdx, -5)}>
                                    <Text style={st.ovBtnText}>−</Text>
                                  </Pressable>
                                  <Text style={st.ovVal}>{mov.restSec ?? DEFAULT_REST_SEC}s</Text>
                                  <Pressable style={st.ovBtn} onPress={() => updateMovementRest(blockIdx, movIdx, 5)}>
                                    <Text style={st.ovBtnText}>+</Text>
                                  </Pressable>
                                  <View style={{ width: 6 }} />
                                  <Icon name="flame" size={10} color="#F59E0B" />
                                  <Pressable style={st.ovBtn} onPress={() => updateMovementDuration(blockIdx, movIdx, -5)}>
                                    <Text style={st.ovBtnText}>−</Text>
                                  </Pressable>
                                  <Text style={st.ovVal}>{mov.durationSec ?? DEFAULT_DURATION_SEC}s</Text>
                                  <Pressable style={st.ovBtn} onPress={() => updateMovementDuration(blockIdx, movIdx, 5)}>
                                    <Text style={st.ovBtnText}>+</Text>
                                  </Pressable>
                                  <View style={{ width: 6 }} />
                                  <Text style={st.ovSmLabel}>reps</Text>
                                  <TextInput
                                    style={[st.ovInput, { minWidth: 28 }]}
                                    value={mov.reps ?? ''}
                                    onChangeText={(t) => updateMovementReps(blockIdx, movIdx, t)}
                                    placeholder="—"
                                    placeholderTextColor="#4A5568"
                                    keyboardType="default"
                                  />
                                  <View style={{ width: 6 }} />
                                  <Pressable style={st.ovIconBtn} onPress={(e) => { e.stopPropagation(); }}>
                                    <Icon name="more-horizontal" size={12} color="#8A95A3" />
                                  </Pressable>
                                  <Pressable style={st.ovIconBtn} onPress={(e) => { e.stopPropagation(); removeMovementFromBlock(blockIdx, movIdx); }}>
                                    <Icon name="trash-2" size={12} color="#EF4444" />
                                  </Pressable>
                                </View>
                                {(() => {
                                  const libMov = availableMovements.find((m) => m.id === mov.movementId);
                                  const effSwap = mov.swapSides ?? libMov?.swapSides ?? false;
                                  if (!effSwap) return null;
                                  const effMode = mov.swapMode ?? libMov?.swapMode ?? 'split';
                                  const effWindow = mov.swapWindowSec ?? libMov?.swapWindowSec ?? 5;
                                  return (
                                    <View style={st.swapPanelInline}>
                                      <Icon name="swap" size={10} color="#A78BFA" />
                                      <Text style={st.swapHeaderText}>SWAP</Text>
                                      <Pressable
                                        style={[st.swapSegBtn, effMode === 'split' && st.swapSegBtnActive]}
                                        onPress={(e) => { e.stopPropagation(); updateMovementSwapMode(blockIdx, movIdx, 'split'); }}
                                      >
                                        <Text style={[st.swapSegBtnText, effMode === 'split' && st.swapSegBtnTextActive]}>Split</Text>
                                      </Pressable>
                                      <Pressable
                                        style={[st.swapSegBtn, effMode === 'duplicate' && st.swapSegBtnActive]}
                                        onPress={(e) => { e.stopPropagation(); updateMovementSwapMode(blockIdx, movIdx, 'duplicate'); }}
                                      >
                                        <Text style={[st.swapSegBtnText, effMode === 'duplicate' && st.swapSegBtnTextActive]}>Full</Text>
                                      </Pressable>
                                      <View style={{ width: 6 }} />
                                      <Text style={st.ovSmLabel}>window</Text>
                                      <Pressable style={st.ovBtn} onPress={(e) => { e.stopPropagation(); updateMovementSwapWindow(blockIdx, movIdx, -1); }}>
                                        <Text style={st.ovBtnText}>−</Text>
                                      </Pressable>
                                      <Text style={st.ovVal}>{effWindow}s</Text>
                                      <Pressable style={st.ovBtn} onPress={(e) => { e.stopPropagation(); updateMovementSwapWindow(blockIdx, movIdx, 1); }}>
                                        <Text style={st.ovBtnText}>+</Text>
                                      </Pressable>
                                    </View>
                                  );
                                })()}
                              </View>
                            )}
                          </View>
                        );
                      })}
                      {/* Add movement row in list view */}
                      <Pressable
                        style={st.addMovRow}
                        onPress={(e) => {
                          e.stopPropagation();
                          setMovementPickerBlockIdx(blockIdx);
                          setShowMovementPicker(true);
                          setMovementSearch('');
                        }}
                      >
                        <Icon name="plus" size={14} color="#4A5568" />
                        <Text style={st.addMovRowText}>Add Movement</Text>
                      </Pressable>
                    </View>
                  )}

                  {/* ── Block control bar — rounds badge opens overlay ── */}
                  {!isSpecial && !hasNoMovements && (
                    <View style={st.blockControlBar}>
                      <Pressable
                        style={[st.roundsBadge, { borderColor: blockColor }]}
                        onPress={(e) => { e.stopPropagation(); setBlockOverlayIndex(blockIdx); }}
                      >
                        <Text style={[st.roundsText, { color: blockColor }]}>
                          {block.rounds ?? DEFAULT_ROUNDS}×
                        </Text>
                      </Pressable>
                      {block.showDemo && (
                        <View style={{ backgroundColor: 'rgba(251,191,36,0.15)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 9, color: '#FBBF24', fontFamily: FB }}>DEMO</Text>
                        </View>
                      )}
                      {block.showGrabEquipment && (
                        <View style={{ backgroundColor: 'rgba(251,146,60,0.15)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 2 }}>
                          <Text style={{ fontSize: 9, color: '#FB923C', fontFamily: FB }}>EQUIP</Text>
                        </View>
                      )}
                      {(block.beginningRestSec ?? 0) > 0 && (
                        <Text style={{ fontSize: 11, color: '#8A95A3', fontFamily: FB }}>{block.beginningRestSec}s</Text>
                      )}
                    </View>
                  )}
                </View>

                {/* ── Between-block "+" ──────────────────────────────────── */}
                {isBlockExpanded && (
                  <Pressable
                    style={st.betweenPlus}
                    onPress={(e) => {
                      e.stopPropagation();
                      setAddBlockAtIndex(blockIdx + 1);
                      setShowAddBlockMenu(true);
                    }}
                  >
                    <View style={st.betweenPlusCircle}>
                      <Icon name="plus" size={14} color="#F5A623" />
                    </View>
                  </Pressable>
                )}
              </React.Fragment>
            );
          })
        )}

        {/* ── Add block at end ──────────────────────────────────────────── */}
        {blocks.length > 0 && (
          <Pressable
            style={st.addBlockEnd}
            onPress={(e) => {
              e.stopPropagation();
              setAddBlockAtIndex(blocks.length);
              setShowAddBlockMenu(true);
            }}
          >
            <Icon name="plus" size={20} color="#4A5568" />
            <Text style={st.addBlockEndText}>Add Block</Text>
          </Pressable>
        )}
        </Pressable>
      </ScrollView>

      {/* ── Add Block Menu (modal) — only 2 options: Movement, Water Break ── */}
      <Modal transparent visible={showAddBlockMenu} animationType="fade" onRequestClose={() => setShowAddBlockMenu(false)}>
        <Pressable style={st.modalBackdrop} onPress={() => setShowAddBlockMenu(false)}>
          <View style={st.addBlockSheet} onStartShouldSetResponder={() => true}>
            <Text style={st.addBlockTitle}>Add Block</Text>
            {ADD_BLOCK_OPTIONS.map((opt) => (
              <Pressable
                key={opt.type}
                style={st.addBlockOption}
                onPress={() => {
                  setShowAddBlockMenu(false);
                  if (opt.type === 'movement') {
                    const newIdx = addBlock('Circuit', addBlockAtIndex ?? undefined);
                    setMovementPickerBlockIdx(newIdx);
                    setShowMovementPicker(true);
                    setMovementSearch('');
                    setAddBlockAtIndex(null);
                  } else if (opt.type === 'follow-along') {
                    // Open Follow-Along asset picker; we'll create the block on selection,
                    // so that picking creates a real block populated from the asset.
                    setFollowAlongPickerInsertAt(addBlockAtIndex);
                    setShowFollowAlongPicker(true);
                    setFollowAlongSearch('');
                    if (!followAlongsLoaded) loadFollowAlongs();
                    // intentionally do NOT clear addBlockAtIndex here — picker owns it.
                  } else {
                    addBlock(opt.type, addBlockAtIndex ?? undefined);
                    setAddBlockAtIndex(null);
                  }
                }}
              >
                <View style={[st.addBlockIcon, { backgroundColor: opt.color + '20' }]}>
                  <Icon name={opt.icon as any} size={20} color={opt.color} />
                </View>
                <Text style={st.addBlockOptionText}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* ── Movement Picker Modal ───────────────────────────────────────── */}
      <ModalSheet
        visible={showMovementPicker}
        onClose={() => {
          setShowMovementPicker(false);
          setMovementPickerBlockIdx(null);
          setMovementSearch('');
          setPickerEquipmentFilter('All');
          setPickerMuscleGroupFilter('All');
          setPickerDifficultyFilter('All');
          setShowMovementPickerFilters(false);
        }}
        maxHeightPct={0.8}
        sheetBg="#1E2A3A"
        backdropColor="rgba(0,0,0,0.7)"
        borderRadius={24}
      >
            <View style={st.pickerHeader}>
              <Text style={st.pickerTitle}>Add Movement</Text>
              <Pressable onPress={() => {
                setShowMovementPicker(false);
                setMovementPickerBlockIdx(null);
                setMovementSearch('');
                setPickerEquipmentFilter('All');
                setPickerMuscleGroupFilter('All');
                setPickerDifficultyFilter('All');
                setShowMovementPickerFilters(false);
              }}>
                <Icon name="close" size={20} color="#8A95A3" />
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
              <View style={[st.pickerSearch, { flex: 1, marginHorizontal: 0 }]}>
                <Icon name="search" size={16} color="#4A5568" />
                <TextInput
                  style={st.pickerSearchInput}
                  value={movementSearch}
                  onChangeText={setMovementSearch}
                  placeholder="Search movements..."
                  placeholderTextColor="#4A5568"
                  autoFocus
                />
              </View>
              <Pressable
                onPress={() => setShowMovementPickerFilters(v => !v)}
                style={{ padding: 8, borderRadius: 8, backgroundColor: showMovementPickerFilters ? '#F5A62320' : 'transparent' }}
              >
                <Icon name="filter" size={18} color={showMovementPickerFilters ? '#F5A623' : '#8A95A3'} />
              </Pressable>
            </View>
            {showMovementPickerFilters && (
              <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 6 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {EQUIPMENT_FILTER_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt}
                      onPress={() => setPickerEquipmentFilter(opt)}
                      style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: pickerEquipmentFilter === opt ? '#F5A623' : '#2A3A4A' }}
                    >
                      <Text style={{ fontSize: 12, color: pickerEquipmentFilter === opt ? '#0E1117' : '#8A95A3', fontWeight: pickerEquipmentFilter === opt ? '700' : '400' }}>{opt}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {MUSCLE_GROUP_FILTER_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt}
                      onPress={() => setPickerMuscleGroupFilter(opt)}
                      style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: pickerMuscleGroupFilter === opt ? '#F5A623' : '#2A3A4A' }}
                    >
                      <Text style={{ fontSize: 12, color: pickerMuscleGroupFilter === opt ? '#0E1117' : '#8A95A3', fontWeight: pickerMuscleGroupFilter === opt ? '700' : '400' }}>{opt}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {DIFFICULTY_FILTER_OPTIONS.map((opt) => (
                    <Pressable
                      key={opt}
                      onPress={() => setPickerDifficultyFilter(opt)}
                      style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: pickerDifficultyFilter === opt ? '#F5A623' : '#2A3A4A' }}
                    >
                      <Text style={{ fontSize: 12, color: pickerDifficultyFilter === opt ? '#0E1117' : '#8A95A3', fontWeight: pickerDifficultyFilter === opt ? '700' : '400' }}>{opt}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}
            <ScrollView style={{ flex: 1 }} contentContainerStyle={st.pickerList} keyboardShouldPersistTaps="handled">
              {filteredMovements.map((mov) => (
                <Pressable
                  key={mov.id}
                  style={st.pickerItem}
                  onPress={() => {
                    if (movementPickerBlockIdx !== null) {
                      addMovementToBlock(movementPickerBlockIdx, mov);
                    }
                    setShowMovementPicker(false);
                    setMovementPickerBlockIdx(null);
                  }}
                >
                  <View style={st.pickerThumb}>
                    <PosterThumb
                      posterUrl={mov.posterUrl}
                      gifUrl={mov.thumbnailUrl || mov.mediaUrl}
                      containerStyle={st.pickerThumbImg}
                      resizeMode="cover"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.pickerItemName}>{mov.name}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {mov.category ? <Text style={st.pickerItemCat}>{mov.category}</Text> : null}
                      {!mov.videoUrl && (
                        <View style={st.videoNeededPill}>
                          <Text style={st.videoNeededText}>Video needed</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <Icon name="plus" size={18} color="#F5A623" />
                </Pressable>
              ))}
              {filteredMovements.length === 0 && (
                <Text style={st.pickerEmpty}>No movements found</Text>
              )}
            </ScrollView>
      </ModalSheet>

      {/* ── Follow-Along Asset Picker Modal ────────────────────────────── */}
      <ModalSheet
        visible={showFollowAlongPicker}
        onClose={() => {
          setShowFollowAlongPicker(false);
          setFollowAlongPickerInsertAt(null);
          setAddBlockAtIndex(null);
        }}
        maxHeightPct={0.8}
        sheetBg="#1E2A3A"
        backdropColor="rgba(0,0,0,0.7)"
        borderRadius={24}
      >
        <View style={st.pickerHeader}>
          <Text style={st.pickerTitle}>Add Follow-Along Video</Text>
          <Pressable onPress={() => {
            setShowFollowAlongPicker(false);
            setFollowAlongPickerInsertAt(null);
            setAddBlockAtIndex(null);
          }}>
            <Icon name="close" size={20} color="#8A95A3" />
          </Pressable>
        </View>
        <View style={st.pickerSearch}>
          <Icon name="search" size={16} color="#4A5568" />
          <TextInput
            style={st.pickerSearchInput}
            value={followAlongSearch}
            onChangeText={setFollowAlongSearch}
            placeholder="Search follow-along videos..."
            placeholderTextColor="#4A5568"
            autoFocus
          />
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={st.pickerList} keyboardShouldPersistTaps="handled">
          {filteredFollowAlongs.map((fa) => (
            <Pressable
              key={fa.id}
              style={st.pickerItem}
              onPress={() => {
                addFollowAlongBlock(fa, followAlongPickerInsertAt ?? undefined);
                setShowFollowAlongPicker(false);
                setFollowAlongPickerInsertAt(null);
                setAddBlockAtIndex(null);
              }}
            >
              <View style={st.pickerThumb}>
                {fa.thumbnailUrl || fa.thumbnailImageUrl ? (
                  <Image source={{ uri: fa.thumbnailUrl || fa.thumbnailImageUrl || '' }} style={st.pickerThumbImg} resizeMode="cover" />
                ) : (
                  <View style={st.pickerThumbPlaceholder}>
                    <Icon name="video" size={16} color="#22D3EE" />
                  </View>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.pickerItemName}>{fa.name}</Text>
                {typeof fa.videoDurationSec === 'number' && fa.videoDurationSec > 0 ? (
                  <Text style={st.pickerItemCat}>
                    {Math.floor(fa.videoDurationSec / 60)}:{String(Math.round(fa.videoDurationSec % 60)).padStart(2, '0')}
                  </Text>
                ) : null}
              </View>
              <Icon name="plus" size={18} color="#22D3EE" />
            </Pressable>
          ))}
          {filteredFollowAlongs.length === 0 && (
            <Text style={st.pickerEmpty}>
              {followAlongsLoaded
                ? 'No follow-along videos yet. Upload one from the Build tab.'
                : 'Loading…'}
            </Text>
          )}
        </ScrollView>
      </ModalSheet>

      {/* ── Description Edit Modal ───────────────────────────────────────── */}
      <Modal transparent visible={showDescriptionEdit} animationType="fade" onRequestClose={() => setShowDescriptionEdit(false)}>
        <Pressable style={st.modalBackdrop} onPress={() => setShowDescriptionEdit(false)}>
          <View style={st.descSheet} onStartShouldSetResponder={() => true}>
            <Text style={st.descTitle}>Workout Description</Text>
            <TextInput
              style={st.descInput}
              value={workoutDescription}
              onChangeText={setWorkoutDescription}
              placeholder="Brief overview of this workout..."
              placeholderTextColor="#4A5568"
              multiline
              numberOfLines={4}
              autoFocus
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#1E2A3A' }}>
              <Text style={{ color: '#8A95A3', fontSize: 14, fontFamily: FB }}>Rest between blocks</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <TouchableOpacity
                  style={st.stepperBtn}
                  onPress={() => { const v = Math.max(5, restDurationSeconds - 5); setRestDurationSeconds(v); saveRestDuration(v); }}
                >
                  <Text style={st.stepperBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={st.stepperValue}>{restDurationSeconds}s</Text>
                <TouchableOpacity
                  style={st.stepperBtn}
                  onPress={() => { const v = restDurationSeconds + 5; setRestDurationSeconds(v); saveRestDuration(v); }}
                >
                  <Text style={st.stepperBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Pressable style={[st.descBtn, { backgroundColor: '#1E2A3A' }]} onPress={() => setShowDescriptionEdit(false)}>
                <Text style={{ color: '#8A95A3', fontWeight: '600', fontFamily: FB }}>Cancel</Text>
              </Pressable>
              <Pressable style={[st.descBtn, { backgroundColor: '#F5A623', flex: 1 }]} onPress={saveDescription}>
                <Text style={{ color: '#0E1117', fontWeight: '700', fontFamily: FH }}>Save</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* ── Block Settings Overlay ──────────────────────────────────────── */}
      <Modal visible={blockOverlayIndex != null} transparent animationType="slide" onRequestClose={closeBlockOverlay}>
        {(() => {
          const bi = blockOverlayIndex ?? 0;
          const block = blocks[bi];
          if (blockOverlayIndex == null || !block) return null;
          const blockColor = BLOCK_COLORS[isTabata(block) ? 'Tabata' : block.type] || '#4A5568';
          return (
            <Pressable style={st.modalBackdrop} onPress={closeBlockOverlay}>
              <Pressable style={st.overlaySheet} onPress={(e) => e.stopPropagation()}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#F0F4F8', fontFamily: FH }}>
                    {isTabata(block) ? 'Tabata' : (block.label || block.type)} Settings
                  </Text>
                  <TouchableOpacity onPress={closeBlockOverlay} hitSlop={8}>
                    <Icon name="x" size={22} color="#8A95A3" />
                  </TouchableOpacity>
                </View>
                <ScrollView style={{ paddingHorizontal: 20 }} contentContainerStyle={{ paddingBottom: 40, gap: 20 }}>

                  {/* 1. Demo Preview */}
                  <View style={st.overlaySection}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={st.overlaySectionTitle}>Demo Preview</Text>
                        <Text style={st.overlaySectionHint}>Play the first movement video before the block starts</Text>
                      </View>
                      <Pressable
                        style={[st.overlayToggle, block.showDemo && st.overlayToggleActive]}
                        onPress={() => updateBlockField(bi, 'showDemo', !block.showDemo)}
                      >
                        <View style={[st.overlayToggleKnob, block.showDemo && st.overlayToggleKnobActive]} />
                      </Pressable>
                    </View>
                    {block.showDemo && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 }}>
                        <Text style={st.overlaySectionHint}>Duration</Text>
                        <TouchableOpacity
                          style={st.stepperBtn}
                          onPress={() => updateBlockField(bi, 'demoDurationSec', Math.max(5, (block.demoDurationSec ?? 10) - 5))}
                        >
                          <Text style={st.stepperBtnText}>−</Text>
                        </TouchableOpacity>
                        <Text style={st.stepperValue}>{block.demoDurationSec ?? 10}s</Text>
                        <TouchableOpacity
                          style={st.stepperBtn}
                          onPress={() => updateBlockField(bi, 'demoDurationSec', (block.demoDurationSec ?? 10) + 5)}
                        >
                          <Text style={st.stepperBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  {/* 2. Grab Equipment */}
                  <View style={st.overlaySection}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1 }}>
                        <Text style={st.overlaySectionTitle}>Grab Equipment</Text>
                        <Text style={st.overlaySectionHint}>Give members time to get their equipment ready</Text>
                      </View>
                      <Pressable
                        style={[st.overlayToggle, block.showGrabEquipment && st.overlayToggleActive]}
                        onPress={() => updateBlockField(bi, 'showGrabEquipment', !block.showGrabEquipment)}
                      >
                        <View style={[st.overlayToggleKnob, block.showGrabEquipment && st.overlayToggleKnobActive]} />
                      </Pressable>
                    </View>
                    {block.showGrabEquipment && (
                      <View style={{ gap: 10, marginTop: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <Text style={st.overlaySectionHint}>Duration</Text>
                          <TouchableOpacity
                            style={st.stepperBtn}
                            onPress={() => updateBlockField(bi, 'grabEquipmentDurationSec', Math.max(5, (block.grabEquipmentDurationSec ?? 15) - 5))}
                          >
                            <Text style={st.stepperBtnText}>−</Text>
                          </TouchableOpacity>
                          <Text style={st.stepperValue}>{block.grabEquipmentDurationSec ?? 15}s</Text>
                          <TouchableOpacity
                            style={st.stepperBtn}
                            onPress={() => updateBlockField(bi, 'grabEquipmentDurationSec', (block.grabEquipmentDurationSec ?? 15) + 5)}
                          >
                            <Text style={st.stepperBtnText}>+</Text>
                          </TouchableOpacity>
                        </View>
                        <View>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                            <TextInput
                              style={[st.overlayTextInput, { flex: 1 }]}
                              value={block.grabEquipmentText ?? ''}
                              onChangeText={(t) => updateBlockField(bi, 'grabEquipmentText', t)}
                              onBlur={() => upsertEquipHistory(block.grabEquipmentText ?? '')}
                              placeholder="e.g. Grab a pair of dumbbells"
                              placeholderTextColor="#4A5568"
                            />
                            <TouchableOpacity
                              onPress={() => toggleEquipHistory(bi)}
                              hitSlop={8}
                              style={{
                                width: 40,
                                height: 40,
                                borderRadius: 10,
                                backgroundColor: equipHistoryOpenIdx === bi ? '#7C3AED' : '#1E2A3A',
                                alignItems: 'center' as const,
                                justifyContent: 'center' as const,
                              }}
                            >
                              <Icon name="clock" size={18} color={equipHistoryOpenIdx === bi ? '#F0F4F8' : '#8A95A3'} />
                            </TouchableOpacity>
                          </View>
                          {equipHistoryOpenIdx === bi && (
                            <View style={{
                              marginTop: 6,
                              backgroundColor: '#1E2A3A',
                              borderRadius: 10,
                              borderWidth: 1,
                              borderColor: '#2A3347',
                              maxHeight: 220,
                              overflow: 'hidden' as const,
                            }}>
                              {equipHistoryLoading ? (
                                <View style={{ padding: 14, alignItems: 'center' as const }}>
                                  <ActivityIndicator size="small" color="#A0AEC0" />
                                </View>
                              ) : equipHistory.length === 0 ? (
                                <Text style={{ color: '#8A95A3', fontSize: 13, fontFamily: FB, padding: 14 }}>
                                  No past equipment inputs yet
                                </Text>
                              ) : (
                                <ScrollView style={{ maxHeight: 220 }} nestedScrollEnabled>
                                  {equipHistory.map((entry, idx) => (
                                    <TouchableOpacity
                                      key={idx}
                                      onPress={() => applyEquipHistoryEntry(bi, entry)}
                                      style={{
                                        flexDirection: 'row' as const,
                                        alignItems: 'center' as const,
                                        gap: 10,
                                        paddingVertical: 10,
                                        paddingHorizontal: 12,
                                        borderTopWidth: idx === 0 ? 0 : 1,
                                        borderTopColor: '#2A3347',
                                      }}
                                    >
                                      {entry.imageUrl ? (
                                        <EquipThumbImage url={entry.imageUrl} style={{ width: 32, height: 32, borderRadius: 6 }} />
                                      ) : (
                                        <View style={{ width: 32, height: 32, borderRadius: 6, backgroundColor: '#2A3347' }} />
                                      )}
                                      <Text style={{ color: '#F0F4F8', fontSize: 14, fontFamily: FB, flex: 1 }} numberOfLines={1}>
                                        {entry.text}
                                      </Text>
                                      <TouchableOpacity
                                        onPress={(e: any) => { e?.stopPropagation?.(); deleteEquipHistoryEntry(entry.id); }}
                                        hitSlop={8}
                                        style={{ padding: 4 }}
                                      >
                                        <Icon name="trash-2" size={14} color="#8A95A3" />
                                      </TouchableOpacity>
                                    </TouchableOpacity>
                                  ))}
                                </ScrollView>
                              )}
                            </View>
                          )}
                        </View>
                        {/* Generate AI equipment image — 3-choice picker */}
                        <View style={{ marginTop: 8 }}>
                          {equipImgStatus[bi] === 'choosing' || equipImgStatus[bi] === 'saving' ? (
                            <View>
                              <Text style={{ color: '#A0AEC0', fontSize: 13, fontFamily: FB, marginBottom: 8 }}>
                                Tap the best image for this equipment
                              </Text>
                              <View style={{ flexDirection: 'row' as const, gap: 8 }}>
                                {(equipImgChoices[bi] ?? []).map((url, idx) => (
                                  <TouchableOpacity
                                    key={idx}
                                    disabled={equipImgStatus[bi] === 'saving'}
                                    onPress={() => selectEquipmentImageChoice(bi, idx)}
                                    style={{
                                      flex: 1,
                                      borderRadius: 10,
                                      borderWidth: 2,
                                      borderColor: '#7C3AED',
                                      overflow: 'hidden' as const,
                                      opacity: equipImgStatus[bi] === 'saving' ? 0.6 : 1,
                                    }}
                                  >
                                    <Image
                                      source={{ uri: url }}
                                      style={{ width: '100%' as any, aspectRatio: 1 }}
                                      resizeMode="cover"
                                    />
                                  </TouchableOpacity>
                                ))}
                              </View>
                              {equipImgStatus[bi] === 'saving' ? (
                                <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginTop: 8 }}>
                                  <ActivityIndicator size="small" color="#A0AEC0" />
                                  <Text style={{ color: '#A0AEC0', fontSize: 12, fontFamily: FB }}>Saving…</Text>
                                </View>
                              ) : (
                                <TouchableOpacity
                                  style={{ marginTop: 10, alignSelf: 'center' as const }}
                                  onPress={() => triggerEquipmentImageGen(bi, block.grabEquipmentText ?? '', true)}
                                >
                                  <Text style={{ color: '#A0AEC0', fontSize: 13, fontFamily: FB, textDecorationLine: 'underline' as const }}>
                                    Regenerate
                                  </Text>
                                </TouchableOpacity>
                              )}
                              {equipImgError[bi] ? (
                                <Text style={{ color: '#F87171', fontSize: 12, fontFamily: FB, marginTop: 6 }}>
                                  {equipImgError[bi]}
                                </Text>
                              ) : null}
                            </View>
                          ) : (
                            <View>
                              <TouchableOpacity
                                style={{
                                  backgroundColor: '#7C3AED',
                                  borderRadius: 10,
                                  paddingVertical: 13,
                                  paddingHorizontal: 16,
                                  flexDirection: 'row' as const,
                                  alignItems: 'center' as const,
                                  justifyContent: 'center' as const,
                                  gap: 8,
                                  opacity: equipImgStatus[bi] === 'generating' ? 0.6 : 1,
                                }}
                                disabled={equipImgStatus[bi] === 'generating'}
                                onPress={() => openEquipLibrary(bi)}
                              >
                                {equipImgStatus[bi] === 'generating' ? (
                                  <>
                                    <ActivityIndicator size="small" color="#F0F4F8" />
                                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#F0F4F8', fontFamily: FH }}>
                                      Generating…
                                    </Text>
                                  </>
                                ) : (
                                  <Text style={{ fontSize: 15, fontWeight: '700', color: '#F0F4F8', fontFamily: FH }}>
                                    {block.grabEquipmentImageUrl ? 'Change image' : 'Add an image'}
                                  </Text>
                                )}
                              </TouchableOpacity>
                              {block.grabEquipmentImageUrl && equipImgStatus[bi] !== 'generating' ? (
                                <View style={{ flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, marginTop: 8 }}>
                                  <Image
                                    source={{ uri: block.grabEquipmentImageUrl }}
                                    style={{ width: 48, height: 48, borderRadius: 6 }}
                                  />
                                  <Text style={{ color: '#4ADE80', fontSize: 13, fontFamily: FB, flex: 1 }}>
                                    Image saved
                                  </Text>
                                </View>
                              ) : null}
                              {equipImgStatus[bi] === 'error' && equipImgError[bi] ? (
                                <Text style={{ color: '#F87171', fontSize: 12, fontFamily: FB, marginTop: 6 }}>
                                  {equipImgError[bi]}
                                </Text>
                              ) : null}
                            </View>
                          )}
                        </View>
                      </View>
                    )}
                  </View>

                  {/* 3. Order (only when both Demo and Grab are ON) */}
                  {block.showDemo && block.showGrabEquipment && (
                    <View style={st.overlaySection}>
                      <Text style={st.overlaySectionTitle}>Order</Text>
                      <Text style={st.overlaySectionHint}>What plays first before the block starts?</Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                        <TouchableOpacity
                          style={[st.orderPill, (block.blockPreSequence?.[0] ?? 'demo') === 'demo' && st.orderPillActive]}
                          onPress={() => updateBlockField(bi, 'blockPreSequence', ['demo', 'grabEquipment'])}
                        >
                          <Text style={[st.orderPillText, (block.blockPreSequence?.[0] ?? 'demo') === 'demo' && st.orderPillTextActive]}>Demo first</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[st.orderPill, block.blockPreSequence?.[0] === 'grabEquipment' && st.orderPillActive]}
                          onPress={() => updateBlockField(bi, 'blockPreSequence', ['grabEquipment', 'demo'])}
                        >
                          <Text style={[st.orderPillText, block.blockPreSequence?.[0] === 'grabEquipment' && st.orderPillTextActive]}>Equipment first</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {/* 4. Beginning Rest */}
                  <View style={st.overlaySection}>
                    <Text style={st.overlaySectionTitle}>Beginning Rest</Text>
                    <Text style={st.overlaySectionHint}>Prep time before first movement, first round only</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
                      <TouchableOpacity
                        style={st.stepperBtn}
                        onPress={() => updateBlockField(bi, 'beginningRestSec', Math.max(0, (block.beginningRestSec ?? 0) - 5))}
                      >
                        <Text style={st.stepperBtnText}>−</Text>
                      </TouchableOpacity>
                      <Text style={st.stepperValue}>{block.beginningRestSec ?? 0}s</Text>
                      <TouchableOpacity
                        style={st.stepperBtn}
                        onPress={() => updateBlockField(bi, 'beginningRestSec', (block.beginningRestSec ?? 0) + 5)}
                      >
                        <Text style={st.stepperBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* 5. Rounds */}
                  <View style={st.overlaySection}>
                    <Text style={st.overlaySectionTitle}>Rounds</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
                      <TouchableOpacity
                        style={st.stepperBtn}
                        onPress={() => updateBlockField(bi, 'rounds', Math.max(1, (block.rounds ?? DEFAULT_ROUNDS) - 1))}
                      >
                        <Text style={st.stepperBtnText}>−</Text>
                      </TouchableOpacity>
                      <Text style={st.stepperValue}>{block.rounds ?? DEFAULT_ROUNDS}</Text>
                      <TouchableOpacity
                        style={st.stepperBtn}
                        onPress={() => updateBlockField(bi, 'rounds', (block.rounds ?? DEFAULT_ROUNDS) + 1)}
                      >
                        <Text style={st.stepperBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* 6. Rest Between Rounds */}
                  <View style={st.overlaySection}>
                    <Text style={st.overlaySectionTitle}>Rest Between Rounds</Text>
                    <Text style={st.overlaySectionHint}>Rest after completing all movements in a round</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
                      <TouchableOpacity
                        style={st.stepperBtn}
                        onPress={() => updateBlockField(bi, 'restBetweenRoundsSec', Math.max(0, (block.restBetweenRoundsSec ?? DEFAULT_REST_SEC) - 5))}
                      >
                        <Text style={st.stepperBtnText}>−</Text>
                      </TouchableOpacity>
                      <Text style={st.stepperValue}>{block.restBetweenRoundsSec ?? DEFAULT_REST_SEC}s</Text>
                      <TouchableOpacity
                        style={st.stepperBtn}
                        onPress={() => updateBlockField(bi, 'restBetweenRoundsSec', (block.restBetweenRoundsSec ?? DEFAULT_REST_SEC) + 5)}
                      >
                        <Text style={st.stepperBtnText}>+</Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  {/* 7. Transition Rest (Circuit/Superset only) */}
                  {(block.type === 'Circuit' || block.type === 'Superset') && (
                    <View style={st.overlaySection}>
                      <Text style={st.overlaySectionTitle}>Transition Rest</Text>
                      <Text style={st.overlaySectionHint}>Rest between movements within a round</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 }}>
                        <TouchableOpacity
                          style={st.stepperBtn}
                          onPress={() => updateBlockField(bi, 'restBetweenMovementsSec', Math.max(0, (block.restBetweenMovementsSec ?? 0) - 5))}
                        >
                          <Text style={st.stepperBtnText}>−</Text>
                        </TouchableOpacity>
                        <Text style={st.stepperValue}>{block.restBetweenMovementsSec ?? 0}s</Text>
                        <TouchableOpacity
                          style={st.stepperBtn}
                          onPress={() => updateBlockField(bi, 'restBetweenMovementsSec', (block.restBetweenMovementsSec ?? 0) + 5)}
                        >
                          <Text style={st.stepperBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}

                  {/* 8. Delete Block */}
                  <View style={[st.overlaySection, { borderTopWidth: 1, borderTopColor: '#2A3347', paddingTop: 20 }]}>
                    <TouchableOpacity
                      style={st.deleteBlockBtn}
                      onPress={() => {
                        if (Platform.OS === 'web') {
                          if (window.confirm('Delete "' + (isTabata(block) ? 'Tabata' : (block.label || block.type)) + '" block? This cannot be undone.')) {
                            const idx = bi;
                            setBlockOverlayIndex(null);
                            removeBlock(idx);
                          }
                        } else {
                          Alert.alert(
                            'Delete Block',
                            'Delete "' + (isTabata(block) ? 'Tabata' : (block.label || block.type)) + '" block? This cannot be undone.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              { text: 'Delete', style: 'destructive', onPress: () => { setBlockOverlayIndex(null); removeBlock(bi); } },
                            ]
                          );
                        }
                      }}
                    >
                      <Icon name="trash-2" size={16} color="#EF4444" />
                      <Text style={st.deleteBlockBtnText}>Delete Block</Text>
                    </TouchableOpacity>
                  </View>

                </ScrollView>

                {/* ── Equipment image library modal (shared across all coaches) ── */}
                <Modal
                  visible={equipLibraryOpenIdx === bi}
                  transparent
                  animationType="fade"
                  onRequestClose={closeEquipLibrary}
                >
                  <Pressable style={st.modalBackdrop} onPress={closeEquipLibrary}>
                    <Pressable style={st.overlaySheet} onPress={(e) => e.stopPropagation()}>
                      {/* Header row */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8, gap: 8 }}>
                        <Text style={{ fontSize: 18, fontWeight: '700', color: '#F0F4F8', fontFamily: FH, flex: 1 }}>
                          Equipment Library
                        </Text>
                        <TouchableOpacity
                          onPress={() => { setEquipLibShowFilter(f => !f); if (equipLibShowFilter) setEquipLibFilterText(''); }}
                          hitSlop={8}
                          style={{ padding: 4 }}
                        >
                          <Icon name="filter" size={20} color={equipLibShowFilter ? '#7C3AED' : '#8A95A3'} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setEquipLibIsEditMode(e => !e)}
                          hitSlop={8}
                          style={{ padding: 4 }}
                        >
                          <Icon name="edit" size={20} color={equipLibIsEditMode ? '#7C3AED' : '#8A95A3'} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={closeEquipLibrary} hitSlop={8} style={{ padding: 4 }}>
                          <Icon name="x" size={22} color="#8A95A3" />
                        </TouchableOpacity>
                      </View>

                      {/* Filter input */}
                      {equipLibShowFilter && (
                        <View style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
                          <TextInput
                            value={equipLibFilterText}
                            onChangeText={setEquipLibFilterText}
                            placeholder="Filter by label..."
                            placeholderTextColor="#5A6478"
                            autoFocus
                            style={{
                              backgroundColor: '#0E1117',
                              borderRadius: 8,
                              borderWidth: 1,
                              borderColor: '#2A3347',
                              color: '#F0F4F8',
                              fontSize: 14,
                              fontFamily: FB,
                              paddingHorizontal: 12,
                              paddingVertical: 8,
                            }}
                          />
                        </View>
                      )}

                      {/* Generate AI image button */}
                      <TouchableOpacity
                        style={{
                          marginHorizontal: 20,
                          marginBottom: 12,
                          backgroundColor: '#7C3AED',
                          borderRadius: 10,
                          paddingVertical: 12,
                          alignItems: 'center' as const,
                          opacity: !block.grabEquipmentText?.trim() ? 0.6 : 1,
                        }}
                        disabled={!block.grabEquipmentText?.trim()}
                        onPress={() => {
                          closeEquipLibrary();
                          triggerEquipmentImageGen(bi, block.grabEquipmentText ?? '');
                        }}
                      >
                        <Text style={{ fontSize: 15, fontWeight: '700', color: '#F0F4F8', fontFamily: FH }}>
                          Generate AI image
                        </Text>
                      </TouchableOpacity>

                      {equipLibraryLoading ? (
                        <View style={{ padding: 30, alignItems: 'center' as const }}>
                          <ActivityIndicator size="large" color="#7C3AED" />
                        </View>
                      ) : equipLibraryError ? (
                        <Text style={{ color: '#F87171', fontSize: 13, fontFamily: FB, paddingHorizontal: 20, paddingBottom: 20 }}>
                          {equipLibraryError}
                        </Text>
                      ) : filteredLibrary.length === 0 ? (
                        <Text style={{ color: '#8A95A3', fontSize: 14, fontFamily: FB, paddingHorizontal: 20, paddingBottom: 20 }}>
                          {(equipLibrary?.length ?? 0) === 0
                            ? 'No equipment images yet. Generate the first one!'
                            : 'No results match your filter.'}
                        </Text>
                      ) : equipLibIsEditMode ? (
                        /* Edit mode — DraggableFlatList for reorder */
                        <DraggableFlatList
                          data={filteredLibrary}
                          keyExtractor={(item) => item.slug}
                          onDragEnd={({ data }) => saveEquipLibOrder(data.map(i => i.slug))}
                          style={{ flex: 1 }}
                          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                          renderItem={({ item, drag, isActive }: DragRenderItemParams<typeof filteredLibrary[0]>) => {
                            const isOwner = !!item.createdBy && item.createdBy === coachId;
                            const affMode: 'platform' | 'hide' = isOwner ? 'platform' : 'hide';
                            const isRenaming = equipLibRenaming[item.slug] !== undefined;
                            const renameText = isRenaming ? equipLibRenaming[item.slug] : item.displayLabel;
                            return (
                              <ScaleDecorator>
                                <View style={{
                                  flexDirection: 'row' as const,
                                  alignItems: 'center' as const,
                                  backgroundColor: isActive ? '#2A3347' : '#1E2A3A',
                                  borderRadius: 10,
                                  borderWidth: 1,
                                  borderColor: '#2A3347',
                                  marginBottom: 8,
                                  overflow: 'hidden' as const,
                                }}>
                                  {/* Drag handle */}
                                  <TouchableOpacity onLongPress={drag} delayLongPress={150} style={{ padding: 12 }}>
                                    <Icon name="more-horizontal" size={18} color="#5A6478" />
                                  </TouchableOpacity>
                                  {/* Thumbnail */}
                                  <Image
                                    source={{ uri: item.thumbUrl ?? item.imageUrl }}
                                    style={{ width: 48, height: 48, borderRadius: 6 }}
                                    resizeMode="cover"
                                  />
                                  {/* Label / rename input */}
                                  <View style={{ flex: 1, paddingHorizontal: 10 }}>
                                    {isRenaming ? (
                                      <TextInput
                                        value={renameText}
                                        onChangeText={(t) => setEquipLibRenaming(prev => ({ ...prev, [item.slug]: t }))}
                                        onBlur={() => {
                                          const name = (equipLibRenaming[item.slug] ?? '').trim();
                                          if (name) saveEquipLibCustomName(item.slug, name);
                                          setEquipLibRenaming(prev => { const n = { ...prev }; delete n[item.slug]; return n; });
                                        }}
                                        onSubmitEditing={() => {
                                          const name = (equipLibRenaming[item.slug] ?? '').trim();
                                          if (name) saveEquipLibCustomName(item.slug, name);
                                          setEquipLibRenaming(prev => { const n = { ...prev }; delete n[item.slug]; return n; });
                                        }}
                                        autoFocus
                                        style={{
                                          color: '#F0F4F8',
                                          fontSize: 13,
                                          fontFamily: FB,
                                          borderBottomWidth: 1,
                                          borderBottomColor: '#7C3AED',
                                          paddingVertical: 2,
                                        }}
                                      />
                                    ) : (
                                      <TouchableOpacity onPress={() => setEquipLibRenaming(prev => ({ ...prev, [item.slug]: item.displayLabel }))}>
                                        <Text style={{ color: '#F0F4F8', fontSize: 13, fontFamily: FB }} numberOfLines={2}>
                                          {item.displayLabel}
                                        </Text>
                                      </TouchableOpacity>
                                    )}
                                  </View>
                                  {/* Trash */}
                                  <TouchableOpacity
                                    onPress={() => handleDeleteLibraryImage({ slug: item.slug, label: item.displayLabel }, affMode)}
                                    hitSlop={8}
                                    style={{ padding: 12 }}
                                  >
                                    <Icon name="trash-2" size={18} color={isOwner ? '#F87171' : '#CBD5E1'} />
                                  </TouchableOpacity>
                                </View>
                              </ScaleDecorator>
                            );
                          }}
                        />
                      ) : (
                        /* View mode — 3-column grid */
                        <ScrollView style={{ paddingHorizontal: 20 }} contentContainerStyle={{ paddingBottom: 40 }}>
                          <View style={{ flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10 }}>
                            {filteredLibrary.map((item) => (
                              <TouchableOpacity
                                key={item.slug}
                                onPress={() => selectLibraryImage(bi, item)}
                                style={{
                                  width: '31%' as any,
                                  borderRadius: 10,
                                  borderWidth: 1,
                                  borderColor: '#2A3347',
                                  backgroundColor: '#1E2A3A',
                                  overflow: 'hidden' as const,
                                }}
                              >
                                <Image
                                  source={{ uri: item.thumbUrl ?? item.imageUrl }}
                                  style={{ width: '100%' as any, aspectRatio: 1 }}
                                  resizeMode="cover"
                                />
                                <Text
                                  style={{ color: '#F0F4F8', fontSize: 10, lineHeight: 13, fontFamily: FB, padding: 6, textTransform: 'capitalize' as const }}
                                  numberOfLines={2}
                                  ellipsizeMode="tail"
                                >
                                  {item.displayLabel}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                        </ScrollView>
                      )}
                    </Pressable>
                  </Pressable>
                </Modal>
              </Pressable>
            </Pressable>
          );
        })()}
      </Modal>

      {/* Workout preview — conditionally rendered so state resets on each open */}
      {showPreview && (
        <WorkoutPlayer
          visible
          workout={previewWorkout}
          onClose={closePreview}
          onComplete={closePreview}
          isPreview
        />
      )}

      {/* ── Intro Announcement settings ── */}
      <WorkoutIntroAnnouncementModal
        visible={showIntroAnnouncement}
        onClose={() => setShowIntroAnnouncement(false)}
        workoutId={workoutId}
        defaultScript={introAnnouncementDefaultScript}
        enabled={introAnnouncementEnabled}
        text={introAnnouncementText}
        onSave={saveIntroAnnouncement}
      />

      {/* ── Delete Workout Confirmation — uses <Modal> portal like description edit ── */}
      <Modal transparent visible={showDeleteConfirm} animationType="fade" onRequestClose={() => setShowDeleteConfirm(false)}>
        <Pressable style={st.modalBackdrop} onPress={() => setShowDeleteConfirm(false)}>
          <View style={[st.descSheet, { backgroundColor: '#1E2A3A' }]} onStartShouldSetResponder={() => true}>
            <Text style={[st.descTitle, { color: '#EF4444' }]}>Delete Workout</Text>
            <Text style={{ color: '#CBD5E1', fontSize: 14, fontFamily: FB, lineHeight: 20, marginTop: 8 }}>
              Are you sure you want to permanently delete{' '}
              <Text style={{ fontWeight: '700', color: '#F0F4F8' }}>{workoutName}</Text>?
              {'\n\n'}This action cannot be undone.
            </Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Pressable style={[st.descBtn, { backgroundColor: '#0E1117' }]} onPress={() => setShowDeleteConfirm(false)}>
                <Text style={{ color: '#8A95A3', fontWeight: '600', fontFamily: FB }}>Cancel</Text>
              </Pressable>
              <Pressable style={[st.descBtn, { backgroundColor: '#EF4444', flex: 1 }]} onPress={confirmDeleteWorkout}>
                <Text style={{ color: '#FFFFFF', fontWeight: '700', fontFamily: FH }}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* ── Duplicate Workout Confirmation ───────────────────────────────── */}
      <Modal transparent visible={showDuplicateConfirm} animationType="fade" onRequestClose={() => { if (!duplicating) setShowDuplicateConfirm(false); }}>
        <Pressable style={st.modalBackdrop} onPress={() => { if (!duplicating) setShowDuplicateConfirm(false); }}>
          <View style={[st.descSheet, { backgroundColor: '#1E2A3A' }]} onStartShouldSetResponder={() => true}>
            <Text style={[st.descTitle, { color: '#6EBB7A' }]}>Duplicate Workout</Text>
            <Text style={{ color: '#CBD5E1', fontSize: 14, fontFamily: FB, lineHeight: 20, marginTop: 8 }}>
              Make a copy of{' '}
              <Text style={{ fontWeight: '700', color: '#F0F4F8' }}>{workoutName}</Text>?
              {'\n\n'}The duplicate will be saved as{' '}
              <Text style={{ fontWeight: '700', color: '#F0F4F8' }}>{`"Copy of ${workoutName}"`}</Text>
              {' '}and open it for you to edit.
            </Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 16 }}>
              <Pressable style={[st.descBtn, { backgroundColor: '#0E1117' }]} onPress={() => setShowDuplicateConfirm(false)} disabled={duplicating}>
                <Text style={{ color: '#8A95A3', fontWeight: '600', fontFamily: FB }}>Cancel</Text>
              </Pressable>
              <Pressable style={[st.descBtn, { backgroundColor: '#6EBB7A', flex: 1, opacity: duplicating ? 0.7 : 1 }]} onPress={confirmDuplicateWorkout} disabled={duplicating}>
                {duplicating ? (
                  <ActivityIndicator size={18} color="#FFFFFF" />
                ) : (
                  <Text style={{ color: '#FFFFFF', fontWeight: '700', fontFamily: FH }}>Duplicate</Text>
                )}
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* ── Share Settings Modal ────────────────────────────────────────── */}
      <Modal
        visible={shareModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setShareModalOpen(false)}
      >
        <View style={st.shareModalOverlay}>
          <View style={st.shareModalCard}>
            <View style={st.shareModalHeader}>
              <Text style={st.shareModalTitle}>Share Settings</Text>
              <TouchableOpacity onPress={() => setShareModalOpen(false)}>
                <Icon name="x" size={20} color="#8A95A3" />
              </TouchableOpacity>
            </View>

            <Text style={st.shareModalSectionLabel}>Who can view this workout</Text>
            <View style={st.shareModalOptions}>
              {VISIBILITY_OPTIONS.map((opt) => {
                const active = shareSettings.visibility === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[st.shareModalOption, active && st.shareModalOptionActive]}
                    onPress={() => saveShareSettings({ visibility: opt.value })}
                    disabled={shareSettingsSaving}
                  >
                    <View style={[st.shareModalRadio, active && st.shareModalRadioActive]}>
                      {active ? <View style={st.shareModalRadioDot} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={st.shareModalOptionTitle}>{opt.label}</Text>
                      <Text style={st.shareModalOptionDesc}>{opt.description}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={st.shareModalSectionLabel}>Link expires</Text>
            <View style={st.shareModalChipRow}>
              {EXPIRY_PRESETS.map((preset) => {
                const active = sameExpiry(shareSettings.expiresAt, preset.ms);
                return (
                  <TouchableOpacity
                    key={preset.label}
                    style={[st.shareModalChip, active && st.shareModalChipActive]}
                    onPress={() =>
                      saveShareSettings({
                        expiresAt: preset.ms === null ? null : Date.now() + preset.ms,
                      })
                    }
                    disabled={shareSettingsSaving}
                  >
                    <Text style={[st.shareModalChipText, active && st.shareModalChipTextActive]}>
                      {preset.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {shareSettings.expiresAt ? (
              <Text style={st.shareModalHint}>
                Expires {new Date(shareSettings.expiresAt).toLocaleString()}
              </Text>
            ) : null}

            <View style={st.shareModalStatsRow}>
              <Icon name="eye" size={14} color="#8A95A3" />
              <Text style={st.shareModalStatsText}>
                {shareSettings.resolvedCount === 0
                  ? 'Not opened yet'
                  : `Opened ${shareSettings.resolvedCount} time${shareSettings.resolvedCount === 1 ? '' : 's'}${
                      shareSettings.lastResolvedAt ? ` · Last ${formatRelativeTime(shareSettings.lastResolvedAt)}` : ''
                    }`}
              </Text>
            </View>

            <View style={st.shareModalButtonRow}>
              <TouchableOpacity
                style={st.shareModalPrimaryBtn}
                onPress={() => activeShareId && copyShareLinkToClipboard(buildShareUrl(activeShareId))}
                disabled={!activeShareId || shareSettingsSaving}
              >
                <Icon name="link" size={16} color="#0E1117" />
                <Text style={st.shareModalPrimaryBtnText}>Copy Link</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={st.shareModalDangerBtn}
                onPress={handleRevokeLink}
                disabled={!activeShareId || shareLoading}
              >
                <Icon name="x-circle" size={16} color="#EF4444" />
                <Text style={st.shareModalDangerBtnText}>Revoke Link</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Workout Music Modal ─────────────────────────────────────────── */}
      <Modal
        visible={showMusicModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMusicModal(false)}
      >
        <View style={st.shareModalOverlay}>
          <View style={st.shareModalCard}>
            <View style={st.shareModalHeader}>
              <Text style={st.shareModalTitle}>Workout Music</Text>
              <TouchableOpacity onPress={() => setShowMusicModal(false)}>
                <Icon name="x" size={20} color="#8A95A3" />
              </TouchableOpacity>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={st.shareModalOptionTitle}>Background music</Text>
                <Text style={st.shareModalOptionDesc}>
                  AI-generated music plays softly under coach audio during playback
                </Text>
              </View>
              <Switch
                value={musicEnabled}
                onValueChange={(v) => saveWorkoutMusic({ workoutMusicEnabled: v })}
                trackColor={{ false: '#2A3441', true: '#6EBB7A' }}
                thumbColor="#F5F7FA"
              />
            </View>

            <Text style={st.shareModalSectionLabel}>Music style</Text>
            <View style={st.shareModalChipRow}>
              {MUSIC_STYLE_OPTIONS.map((opt) => {
                const active = musicStyle === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[st.shareModalChip, active && st.shareModalChipActive]}
                    onPress={() => saveWorkoutMusic({ workoutMusicStyle: opt.value })}
                    disabled={!musicEnabled}
                  >
                    <Text
                      style={[
                        st.shareModalChipText,
                        active && st.shareModalChipTextActive,
                        !musicEnabled && { opacity: 0.4 },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={st.shareModalSectionLabel}>Music volume</Text>
            <View style={st.shareModalChipRow}>
              {MUSIC_VOLUME_OPTIONS.map((opt) => {
                const active = Math.abs(musicVolume - opt.value) < 0.01;
                return (
                  <TouchableOpacity
                    key={opt.label}
                    style={[st.shareModalChip, active && st.shareModalChipActive]}
                    onPress={() => saveWorkoutMusic({ workoutMusicVolume: opt.value })}
                    disabled={!musicEnabled}
                  >
                    <Text
                      style={[
                        st.shareModalChipText,
                        active && st.shareModalChipTextActive,
                        !musicEnabled && { opacity: 0.4 },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Workout Music constants ──────────────────────────────────────────────────
const MUSIC_VOLUME_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0.2, label: 'Quiet' },
  { value: 0.35, label: 'Soft' },
  { value: 0.55, label: 'Medium' },
  { value: 0.8, label: 'Loud' },
];

const MUSIC_STYLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'workout', label: 'Workout' },
  { value: 'edm', label: 'EDM' },
  { value: 'hiphop', label: 'Hip-Hop' },
  { value: 'chill', label: 'Chill' },
  { value: 'rock', label: 'Rock' },
  { value: 'focus', label: 'Focus' },
];

// ── Share Settings constants & helpers ──────────────────────────────────────
const VISIBILITY_OPTIONS: Array<{ value: ShareVisibility; label: string; description: string }> = [
  {
    value: 'anyone_with_link',
    label: 'Anyone with the link',
    description: 'No sign-in needed. Best for previewing or sharing with prospects.',
  },
  {
    value: 'anyone_with_link_signin_required',
    label: 'Anyone with the link, sign-in required',
    description: 'Viewer must create an account or sign in to play.',
  },
  {
    value: 'restricted',
    label: 'Restricted',
    description: 'The share link is disabled. Only your assigned members can play.',
  },
];

const EXPIRY_PRESETS: Array<{ label: string; ms: number | null }> = [
  { label: 'Never', ms: null },
  { label: '1 day', ms: 24 * 60 * 60 * 1000 },
  { label: '7 days', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
];

function sameExpiry(currentExpiresAt: number | null, presetMs: number | null): boolean {
  if (presetMs === null) return currentExpiresAt === null;
  if (currentExpiresAt === null) return false;
  // Within 24h of preset → treat as the same preset (covers existing tokens that were set with this preset).
  return Math.abs(currentExpiresAt - (Date.now() + presetMs)) < 24 * 60 * 60 * 1000;
}

function formatRelativeTime(ms: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(ms).toLocaleDateString();
}

// ── Styles ───────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E1117' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  backBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(251,191,36,0.12)',
  },
  previewBtnText: {
    fontSize: 13,
    color: '#FBBF24',
    fontWeight: '600',
    fontFamily: FB,
  },
  breadcrumb: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    overflow: 'hidden',
  },
  breadcrumbRoot: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
    fontWeight: '600',
  },
  breadcrumbSep: {
    fontSize: 14,
    color: '#4A5568',
    fontFamily: FB,
  },
  titleText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    maxWidth: 200,
  },
  titleInput: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    borderBottomWidth: 1,
    borderBottomColor: '#F5A623',
    paddingVertical: 2,
    minWidth: 120,
  },
  savingBadge: {
    paddingHorizontal: 8,
  },
  savedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(52, 211, 153, 0.1)',
    borderRadius: 6,
  },
  savedText: {
    fontSize: 11,
    color: '#34D399',
    fontFamily: FB,
    fontWeight: '700',
  },
  menuBtn: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewToggle: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1E2A3A',
    borderRadius: 8,
  },

  // Meta row
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 6,
  },
  metaText: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
  metaDot: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
  },

  // Title menu
  menuOverlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    zIndex: 100,
  },
  menuDropdown: {
    position: 'absolute',
    top: 56,
    right: 56,
    backgroundColor: '#1E2A3A',
    borderRadius: 12,
    padding: 8,
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 101,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  menuItemText: {
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '500',
  },
  menuDivider: {
    height: 1,
    backgroundColor: '#2A3544',
    marginVertical: 4,
    marginHorizontal: 8,
  },

  // Scroll area
  scrollArea: {
    flex: 1,
  },

  // Empty state (no blocks at all)
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
  },
  addFirstBlock: {
    alignItems: 'center',
    gap: 12,
  },
  emptyPlus: {
    width: 80,
    height: 80,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#F5A623',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
  },

  // Empty block (block exists but has no movements yet)
  emptyBlockContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  emptyBlockCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 24,
    borderWidth: 1,
    borderColor: '#F5A623',
    borderStyle: 'dashed',
    borderRadius: 10,
    backgroundColor: 'rgba(245, 166, 35, 0.05)',
  },
  emptyBlockText: {
    fontSize: 14,
    color: '#F5A623',
    fontFamily: FB,
    fontWeight: '600',
  },

  // Block container
  blockContainer: {
    borderRadius: 12,
    marginBottom: 8,
    padding: GRID_PADDING,
    backgroundColor: 'rgba(30, 42, 58, 0.3)',
  },

  // Special blocks
  specialBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  specialIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  specialLabel: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
    flex: 1,
  },
  specialDuration: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
  trashBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Block grid (icon view)
  blockGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_GAP,
  },

  // Movement card (HALF SIZE)
  movCard: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#0E1117',
    position: 'relative',
  },
  movPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A2332',
  },
  placeholderLogoFrame: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0E1117',
    overflow: 'hidden',
  },
  placeholderLogo: {
    width: '100%',
    height: '100%',
  },
  nameOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 4,
    paddingVertical: 3,
    backgroundColor: 'rgba(14, 17, 23, 0.65)',
  },
  nameText: {
    color: '#F0F4F8',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: FH,
  },

  // Add movement card (dashed outline)
  addMovCard: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A3544',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },

  // In-card overlay — absolute positioned over the movement card
  ovOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(14, 17, 23, 0.82)',
    borderRadius: 8,
    padding: 4,
    justifyContent: 'center',
    gap: 3,
  },
  ovRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  ovBtn: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 4,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ovBtnText: {
    fontSize: 11,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '700',
    lineHeight: 13,
  },
  ovVal: {
    fontSize: 10,
    color: '#F5A623',
    fontFamily: FH,
    fontWeight: '700',
    minWidth: 22,
    textAlign: 'center',
  },
  ovSmLabel: {
    fontSize: 8,
    color: '#8A95A3',
    fontFamily: FB,
    fontWeight: '600',
  },
  ovInput: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 1,
    color: '#F0F4F8',
    fontSize: Platform.OS === 'web' ? 16 : 9,
    fontFamily: FB,
    minWidth: 28,
    textAlign: 'center' as const,
    height: 20,
  },
  ovBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 1,
  },
  ovIconBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapPanel: {
    marginTop: 4,
    paddingVertical: 4,
    paddingHorizontal: 4,
    backgroundColor: 'rgba(167,139,250,0.10)',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.25)',
    gap: 3,
  },
  swapHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swapHeaderText: {
    fontSize: 9,
    color: '#A78BFA',
    fontFamily: FH,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  swapSegmented: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swapSegBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.25)',
  },
  swapSegBtnActive: {
    backgroundColor: 'rgba(167,139,250,0.35)',
    borderColor: '#A78BFA',
  },
  swapSegBtnText: {
    fontSize: 10,
    color: '#8A95A3',
    fontFamily: FB,
    fontWeight: '700',
  },
  swapSegBtnTextActive: {
    color: '#F0F4F8',
  },
  swapModeDesc: {
    fontSize: 8,
    color: '#8A95A3',
    fontFamily: FB,
    textAlign: 'center',
  },
  swapPanelInline: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(167,139,250,0.20)',
  },
  swapRowCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    marginTop: 1,
  },
  swapPillTiny: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(167,139,250,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.30)',
    minWidth: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapPillTinyActive: {
    backgroundColor: 'rgba(167,139,250,0.40)',
    borderColor: '#A78BFA',
  },
  swapPillTinyText: {
    fontSize: 10,
    color: '#8A95A3',
    fontFamily: FB,
    fontWeight: '700',
    lineHeight: 12,
  },
  swapPillTinyTextActive: {
    color: '#F0F4F8',
  },
  swapTogglePill: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: 'rgba(167,139,250,0.30)',
    borderWidth: 1,
    borderColor: '#A78BFA',
    minWidth: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapTogglePillText: {
    fontSize: 10,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '700',
    lineHeight: 12,
  },
  removeXBtn: {
    position: 'absolute',
    top: -6,
    right: -6,
    zIndex: 20,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#EF4444',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  hiddenBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  reorderIndicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(56, 189, 248, 0.25)',
    borderRadius: 8,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  reorderText: {
    fontSize: 9,
    color: '#38BDF8',
    fontFamily: FB,
    fontWeight: '700' as const,
  },
  ovNameText: {
    fontSize: 8,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
    paddingHorizontal: 2,
    marginTop: 1,
  },
  ovNameInput: {
    fontSize: 8,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '600' as const,
    textAlign: 'center' as const,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 1,
    marginTop: 1,
    height: 16,
  },

  // Block control bar — sits at bottom of block, stretches left when expanded
  blockControlBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    marginTop: 8,
    alignSelf: 'flex-end',
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  roundsText: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: FH,
  },
  bcTrash: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bcDivider: {
    width: 1,
    height: 18,
    backgroundColor: '#2A3544',
    marginHorizontal: 1,
  },
  bcBtn: {
    backgroundColor: '#0E1117',
    borderRadius: 5,
    width: 26,
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  bcBtnText: {
    fontSize: 13,
    color: '#F0F4F8',
    fontFamily: FH,
    fontWeight: '700',
  },
  bcValue: {
    fontSize: 13,
    color: '#F5A623',
    fontFamily: FH,
    fontWeight: '700',
    minWidth: 22,
    textAlign: 'center',
  },
  bcDemoBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4A5568',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bcDemoBtnOn: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
  },

  // Between-block plus
  betweenPlus: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  betweenPlusCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F5A623',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Add block at end
  addBlockEnd: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 16,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#2A3544',
    borderStyle: 'dashed',
    borderRadius: 12,
  },
  addBlockEndText: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FB,
    fontWeight: '600',
  },

  // Block list (list view)
  blockList: {
    gap: 2,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  listThumb: {
    width: 40,
    height: 50,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#1A2332',
  },
  listThumbImg: {
    width: '100%',
    height: '100%',
  },
  listThumbPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  listMovName: {
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '600',
    flex: 1,
  },
  listQuickControls: {
    backgroundColor: '#1E2A3A',
    borderRadius: 8,
    padding: 10,
    marginBottom: 4,
  },
  addMovRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A3544',
    borderStyle: 'dashed',
    marginTop: 4,
  },
  addMovRowText: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
    fontWeight: '600',
  },

  // Add block modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  addBlockSheet: {
    backgroundColor: '#1E2A3A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  addBlockTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 16,
  },
  addBlockOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
  },
  addBlockIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  addBlockOptionText: {
    fontSize: 15,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '600',
  },

  // pickerBackdrop + pickerSheet styles removed — now handled by ModalSheet
  pickerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    paddingBottom: 12,
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  pickerSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1117',
    borderRadius: 10,
    marginHorizontal: 20,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  pickerSearchInput: {
    flex: 1,
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    paddingVertical: 0,
  },
  pickerList: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 40,
  },
  pickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#0E1117',
  },
  pickerThumb: {
    width: 40,
    height: 50,
    borderRadius: 6,
    overflow: 'hidden',
    backgroundColor: '#0E1117',
  },
  pickerThumbImg: {
    width: '100%',
    height: '100%',
  },
  pickerThumbPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerItemName: {
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '600',
  },
  pickerItemCat: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },
  pickerEmpty: {
    fontSize: 14,
    color: '#4A5568',
    fontFamily: FB,
    textAlign: 'center',
    paddingVertical: 40,
  },
  videoNeededPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#2A3340',
  },
  videoNeededText: {
    fontSize: 9,
    color: '#8A95A3',
    fontFamily: FB,
    fontWeight: '600',
  },

  // Description modal
  descSheet: {
    backgroundColor: '#1E2A3A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  descTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 16,
  },
  descInput: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 14,
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    minHeight: 100,
    textAlignVertical: 'top',
  },
  descBtn: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Intro / Outro asset page styles ─────────────────────────────────────
  ioSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginTop: 24,
    marginBottom: 6,
  },
  ioSectionDesc: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    marginBottom: 16,
    lineHeight: 18,
  },
  ioAssetRow: {
    flexDirection: 'row',
    gap: 12,
  },
  ioAssetCard: {
    width: 140,
    height: 250,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1A2332',
    position: 'relative',
  },
  ioAssetImage: {
    width: '100%',
    height: '100%',
  },
  ioAssetOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: 'rgba(14, 17, 23, 0.65)',
  },
  ioAssetLabel: {
    color: '#F472B6',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FH,
  },
  ioRemoveBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 2,
  },
  ioCropBtn: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(14, 17, 23, 0.75)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    zIndex: 2,
  },
  ioCropBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FH,
  },
  ioUploadCard: {
    width: 140,
    height: 250,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#F5A623',
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(245, 166, 35, 0.05)',
  },
  ioUploadText: {
    fontSize: 13,
    color: '#F5A623',
    fontFamily: FB,
    fontWeight: '600',
  },
  ioInfoBox: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 32,
    padding: 14,
    backgroundColor: 'rgba(30, 42, 58, 0.5)',
    borderRadius: 10,
    alignItems: 'flex-start',
  },
  ioInfoText: {
    flex: 1,
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    lineHeight: 18,
  },

  // ── Move-to page styles ─────────────────────────────────────────────────
  moveToSearchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E2A3A',
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 40,
    gap: 8,
  },
  moveToSearchInput: {
    flex: 1,
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    paddingVertical: 0,
  },
  moveToSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#8A95A3',
    fontFamily: FH,
    marginTop: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  moveToEmpty: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  moveToEmptyText: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FB,
  },
  moveToCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#F5A623',
    borderStyle: 'dashed',
    borderRadius: 10,
    justifyContent: 'center',
  },
  moveToCreateText: {
    fontSize: 13,
    color: '#F5A623',
    fontFamily: FB,
    fontWeight: '600',
  },

  // ── Block settings overlay ──────────────────────────────────────────
  roundsBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  overlaySheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    flex: 1,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    borderBottomWidth: 0,
  },
  overlaySection: {
    gap: 4,
  },
  overlaySectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  overlaySectionHint: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
  overlayToggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2A3347',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  overlayToggleActive: {
    backgroundColor: 'rgba(167,139,250,0.3)',
  },
  overlayToggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#4A5568',
  },
  overlayToggleKnobActive: {
    backgroundColor: '#A78BFA',
    alignSelf: 'flex-end' as const,
  },
  stepperBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#1E2A3A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  stepperValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    minWidth: 44,
    textAlign: 'center',
  },
  overlayTextInput: {
    backgroundColor: '#161B22',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  orderPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1E2A3A',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  orderPillActive: {
    backgroundColor: 'rgba(167,139,250,0.2)',
    borderColor: '#A78BFA',
  },
  orderPillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
  },
  orderPillTextActive: {
    color: '#A78BFA',
  },
  deleteBlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(239,68,68,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.3)',
  },
  deleteBlockBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#EF4444',
    fontFamily: FB,
  },

  // ── Share Settings modal ──────────────────────────────────────────────
  shareModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  shareModalCard: {
    width: '100%',
    maxWidth: 460,
    backgroundColor: '#0E1117',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A3347',
    padding: 20,
    gap: 14,
  },
  shareModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shareModalTitle: {
    color: '#E6EDF3',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FH,
  },
  shareModalSectionLabel: {
    color: '#8A95A3',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FB,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  shareModalOptions: {
    gap: 8,
  },
  shareModalOption: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A3347',
    backgroundColor: '#161B22',
  },
  shareModalOptionActive: {
    borderColor: '#F5A623',
    backgroundColor: 'rgba(245,166,35,0.06)',
  },
  shareModalRadio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#2A3347',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  shareModalRadioActive: {
    borderColor: '#F5A623',
  },
  shareModalRadioDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#F5A623',
  },
  shareModalOptionTitle: {
    color: '#E6EDF3',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FB,
  },
  shareModalOptionDesc: {
    color: '#8A95A3',
    fontSize: 12,
    fontFamily: FB,
    marginTop: 2,
    lineHeight: 16,
  },
  shareModalChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  shareModalChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2A3347',
    backgroundColor: '#161B22',
  },
  shareModalChipActive: {
    borderColor: '#F5A623',
    backgroundColor: 'rgba(245,166,35,0.1)',
  },
  shareModalChipText: {
    color: '#8A95A3',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FB,
  },
  shareModalChipTextActive: {
    color: '#F5A623',
  },
  shareModalHint: {
    color: '#8A95A3',
    fontSize: 12,
    fontFamily: FB,
  },
  shareModalStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#2A3347',
  },
  shareModalStatsText: {
    color: '#8A95A3',
    fontSize: 12,
    fontFamily: FB,
  },
  shareModalButtonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 6,
  },
  shareModalPrimaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F5A623',
    borderRadius: 10,
    paddingVertical: 12,
  },
  shareModalPrimaryBtnText: {
    color: '#0E1117',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
  },
  shareModalDangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EF4444',
    backgroundColor: 'transparent',
  },
  shareModalDangerBtnText: {
    color: '#EF4444',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FB,
  },
});
