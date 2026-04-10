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
} from 'react-native';
import ModalSheet from './ModalSheet';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  onSnapshot,
} from 'firebase/firestore';
import { db, storage } from '../lib/firebase';
import { ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';
import * as ImagePicker from 'expo-image-picker';
import { Icon } from './Icon';
import WorkoutPlayer from './WorkoutPlayer';
import { FB, FH } from '../lib/theme';


// ── Fonts ───────────────────────────────────────────────────────────────────

// ── Grid constants ─────────────────────────────────────────────────────────
const GRID_PADDING = 16;
const GRID_GAP = 8;
const LIBRARY_MAX_CARD = 240;
const MAX_CARD_WIDTH = Math.round(LIBRARY_MAX_CARD / 2); // 120px — half the library size
const CARD_ASPECT = 4 / 5;

// ── Block types & colors ───────────────────────────────────────────────────
const NO_MOVEMENT_BLOCKS = ['Transition', 'Water Break'];
const BLOCK_COLORS: Record<string, string> = {
  'Warm-Up': '#F59E0B', 'Circuit': '#34D399', 'Superset': '#F59E0B',
  'Interval': '#818CF8', 'Strength': '#7DD3FC', 'Timed': '#A78BFA',
  'AMRAP': '#34D399', 'EMOM': '#34D399', 'Cool-Down': '#60A5FA',
  'Rest': '#4A5568',
  'Transition': '#94A3B8', 'Water Break': '#38BDF8',
};
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

// Block types available when adding a new block — only 2 options now
const ADD_BLOCK_OPTIONS = [
  { type: 'movement', label: 'Movement', icon: 'movements', color: '#F0F4F8' },
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
  movements: BlockMovement[];
}

interface MovementOption {
  id: string;
  name: string;
  category: string;
  thumbnailUrl?: string | null;
  mediaUrl?: string | null;
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

// ── Props ───────────────────────────────────────────────────────────────────
interface WorkoutFolderPageProps {
  workoutId: string;
  coachId: string;
  tenantId: string;
  onBack: () => void;
  onOpenMovement?: (movement: any) => void;
}

export default function WorkoutFolderPage({
  workoutId,
  coachId,
  tenantId,
  onBack,
  onOpenMovement,
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
  const [viewMode, setViewMode] = useState<'icon' | 'list'>('icon');

  // Intro / Outro — workout-level fields
  const [introVideoUrl, setIntroVideoUrl] = useState<string | null>(null);
  const [introGifUrl, setIntroGifUrl] = useState<string | null>(null);
  const [outroVideoUrl, setOutroVideoUrl] = useState<string | null>(null);
  const [outroGifUrl, setOutroGifUrl] = useState<string | null>(null);
  const [ioUploading, setIoUploading] = useState<'intro' | 'outro' | null>(null);
  const [ioUploadProgress, setIoUploadProgress] = useState(0);

  // ── Intro/Outro video upload handler ──────────────────────────────────────
  const pickAndUploadIntroOutro = useCallback(async (target: 'intro' | 'outro') => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        // Alert not imported — use console + return
        console.warn('[WorkoutFolder] Media library permission not granted');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsEditing: false,
        quality: 0.8,
        videoMaxDuration: 30,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setIoUploading(target);
      setIoUploadProgress(0);

      // Upload video to Firebase Storage
      const fileName = `workouts/${coachId}/${target}/${workoutId}_${Date.now()}.mp4`;
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const storageRef = ref(storage, fileName);
      const uploadTask = uploadBytesResumable(storageRef, blob, { contentType: 'video/mp4' });

      const videoUrl = await new Promise<string>((resolve, reject) => {
        uploadTask.on(
          'state_changed',
          (snapshot) => setIoUploadProgress(snapshot.bytesTransferred / snapshot.totalBytes),
          (error) => { reject(error); },
          async () => { resolve(await getDownloadURL(uploadTask.snapshot.ref)); },
        );
      });

      // Upload thumbnail if available
      let gifUrl: string | null = null;
      if (asset.uri) {
        // Use video URL as both video and thumbnail placeholder
        // A proper GIF/thumbnail can be generated server-side later
        gifUrl = videoUrl;
      }

      // Save to Firestore
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
    } catch (err: any) {
      console.error(`[WorkoutFolder] ${target} upload error:`, err?.message ?? err);
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
  const [showAddBlockMenu, setShowAddBlockMenu] = useState(false);
  const [addBlockAtIndex, setAddBlockAtIndex] = useState<number | null>(null);
  const [showMovementPicker, setShowMovementPicker] = useState(false);
  const [movementPickerBlockIdx, setMovementPickerBlockIdx] = useState<number | null>(null);
  const [movementSearch, setMovementSearch] = useState('');
  const [showTitleMenu, setShowTitleMenu] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [showDescriptionEdit, setShowDescriptionEdit] = useState(false);
  const [showIntroOutroPage, setShowIntroOutroPage] = useState(false);
  const [showMoveTo, setShowMoveTo] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [moveToSearch, setMoveToSearch] = useState('');
  const [editingNameKey, setEditingNameKey] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');
  // Reorder: long-press to pick up, tap another slot to drop
  const [reorderSource, setReorderSource] = useState<{ blockIdx: number; movIdx: number } | null>(null);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false); // prevents onSnapshot from overwriting local edits
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocksRef = useRef<WorkoutBlock[]>(blocks);
  const nameRef = useRef(workoutName);

  // Keep refs in sync
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);
  useEffect(() => { nameRef.current = workoutName; }, [workoutName]);

  // ── Dismiss all overlays ─────────────────────────────────────────────────
  const dismissAll = useCallback(() => {
    setExpandedMovKey(null);
    setExpandedBlockIdx(null);
    setShowAddBlockMenu(false);
    setShowTitleMenu(false);
    setEditingNameKey(null);
    setReorderSource(null);
  }, []);

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
            rawBlocks.map((b: any) => ({
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
              })),
            })),
          );
        }
        setIntroVideoUrl(data.introVideoUrl ?? null);
        setIntroGifUrl(data.introGifUrl ?? null);
        setOutroVideoUrl(data.outroVideoUrl ?? null);
        setOutroGifUrl(data.outroGifUrl ?? null);
        setOriginalData(data);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [workoutId]);

  // ── Load movement library ─────────────────────────────────────────────────
  const loadMovements = useCallback(async () => {
    if (movementsLoaded || !coachId) return;
    try {
      const coachQ = query(collection(db, 'movements'), where('coachId', '==', coachId));
      const coachSnap = await getDocs(coachQ);
      const globalQ = query(collection(db, 'movements'), where('isGlobal', '==', true));
      const globalSnap = await getDocs(globalQ);

      const seen = new Set<string>();
      const list: MovementOption[] = [];
      coachSnap.docs.forEach((d) => {
        const cd = d.data();
        if (!seen.has(d.id) && !cd.isArchived) {
          seen.add(d.id);
          list.push({
            id: d.id,
            name: cd.name ?? '',
            category: cd.category ?? '',
            thumbnailUrl: cd.thumbnailUrl ?? null,
            mediaUrl: cd.mediaUrl ?? null,
          });
        }
      });
      globalSnap.docs.forEach((d) => {
        const gd = d.data();
        if (!seen.has(d.id) && !gd.isArchived) {
          seen.add(d.id);
          list.push({
            id: d.id,
            name: gd.name ?? '',
            category: gd.category ?? '',
            thumbnailUrl: gd.thumbnailUrl ?? null,
            mediaUrl: gd.mediaUrl ?? null,
          });
        }
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setAvailableMovements(list);
      setMovementsLoaded(true);
    } catch (err: any) {
      console.error('[WorkoutFolder] Load movements error:', err?.message ?? err);
    }
  }, [coachId, movementsLoaded]);

  useEffect(() => {
    if (!movementsLoaded && coachId) loadMovements();
  }, [coachId, movementsLoaded, loadMovements]);

  // ── Enrich block movements with thumbnailUrl ─────────────────────────────
  useEffect(() => {
    if (!movementsLoaded || availableMovements.length === 0 || blocks.length === 0) return;
    let changed = false;
    const enriched = blocks.map((b) => ({
      ...b,
      movements: b.movements.map((m) => {
        if (m.thumbnailUrl) return m;
        const found = availableMovements.find((am) => am.id === m.movementId);
        if (found && (found.thumbnailUrl || found.mediaUrl)) {
          changed = true;
          return { ...m, thumbnailUrl: found.thumbnailUrl ?? found.mediaUrl ?? undefined };
        }
        return m;
      }),
    }));
    if (changed) setBlocks(enriched);
  }, [movementsLoaded, availableMovements]);

  // ── Auto-save (debounced) ─────────────────────────────────────────────────
  const autoSave = useCallback(async (newBlocks: WorkoutBlock[], newName?: string) => {
    dirtyRef.current = true;
    setSaveStatus('saving');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

    saveTimeoutRef.current = setTimeout(async () => {
      try {
        setSaving(true);
        const cleanBlocks = newBlocks.map((b) => ({
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
          })),
        }));

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
      const cleanBlocks = currentBlocks.map((b) => ({
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
          durationSec: m.durationSec ?? undefined, restSec: m.restSec ?? undefined,
          notes: m.notes ?? '', thumbnailUrl: m.thumbnailUrl ?? undefined,
        })),
      }));
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

  // Flush save on unmount
  useEffect(() => {
    return () => {
      if (dirtyRef.current && saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        // Fire-and-forget save on unmount
        const currentBlocks = blocksRef.current;
        const cleanBlocks = currentBlocks.map((b) => ({
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
            durationSec: m.durationSec ?? undefined, restSec: m.restSec ?? undefined,
            notes: m.notes ?? '', thumbnailUrl: m.thumbnailUrl ?? undefined,
          })),
        }));
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

  // ── Movement operations ───────────────────────────────────────────────────
  const addMovementToBlock = useCallback((blockIdx: number, movement: MovementOption) => {
    const newBlocks = [...blocks];
    newBlocks[blockIdx].movements.push({
      movementId: movement.id,
      movementName: movement.name,
      durationSec: DEFAULT_DURATION_SEC,
      restSec: DEFAULT_REST_SEC,
      sets: 1,
      thumbnailUrl: movement.thumbnailUrl ?? movement.mediaUrl ?? undefined,
    });
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

  // ── Filtered movements for picker ─────────────────────────────────────────
  const filteredMovements = useMemo(() => {
    if (!movementSearch.trim()) return availableMovements;
    const q = movementSearch.toLowerCase();
    return availableMovements.filter(m => m.name.toLowerCase().includes(q));
  }, [availableMovements, movementSearch]);

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
          contentContainerStyle={{ paddingHorizontal: GRID_PADDING, paddingBottom: 80 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={st.ioSectionTitle}>Intro Video</Text>
          <Text style={st.ioSectionDesc}>
            Plays full-screen for ~10 seconds at the start of the workout. Upload a video in iPhone Pro Max ratio.
          </Text>
          <View style={st.ioAssetRow}>
            {introGifUrl ? (
              <Pressable style={st.ioAssetCard}>
                <Image source={{ uri: introGifUrl }} style={st.ioAssetImage} resizeMode="cover" />
                <View style={st.ioAssetOverlay}>
                  <Text style={st.ioAssetLabel}>Intro</Text>
                </View>
                <Pressable
                  style={st.ioRemoveBtn}
                  onPress={() => saveIntroOutro({ introVideoUrl: null, introGifUrl: null })}
                >
                  <Icon name="close" size={14} color="#EF4444" />
                </Pressable>
              </Pressable>
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
            Plays full-screen for ~10 seconds at the end of the workout. Upload a video in iPhone Pro Max ratio.
          </Text>
          <View style={st.ioAssetRow}>
            {outroGifUrl ? (
              <Pressable style={st.ioAssetCard}>
                <Image source={{ uri: outroGifUrl }} style={st.ioAssetImage} resizeMode="cover" />
                <View style={st.ioAssetOverlay}>
                  <Text style={st.ioAssetLabel}>Outro</Text>
                </View>
                <Pressable
                  style={st.ioRemoveBtn}
                  onPress={() => saveIntroOutro({ outroVideoUrl: null, outroGifUrl: null })}
                >
                  <Icon name="close" size={14} color="#EF4444" />
                </Pressable>
              </Pressable>
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
        <ScrollView style={st.scrollArea} contentContainerStyle={{ paddingHorizontal: GRID_PADDING, paddingBottom: 80 }}>
          <Text style={st.moveToSectionTitle}>Folders</Text>
          <View style={st.moveToEmpty}>
            <Text style={st.moveToEmptyText}>No folders yet</Text>
          </View>
          <Pressable style={st.moveToCreateBtn} onPress={() => console.log('[WorkoutFolder] Create folder — not yet wired')}>
            <Icon name="plus" size={16} color="#F5A623" />
            <Text style={st.moveToCreateText}>Create Folder</Text>
          </Pressable>

          <Text style={[st.moveToSectionTitle, { marginTop: 24 }]}>Playbooks</Text>
          <View style={st.moveToEmpty}>
            <Text style={st.moveToEmptyText}>No playbooks yet</Text>
          </View>
          <Pressable style={st.moveToCreateBtn} onPress={() => console.log('[WorkoutFolder] Create playbook — not yet wired')}>
            <Icon name="plus" size={16} color="#A78BFA" />
            <Text style={[st.moveToCreateText, { color: '#A78BFA' }]}>Create Playbook</Text>
          </Pressable>
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
        <Pressable onPress={async () => { await flushSave(); onBack(); }} style={st.backBtn}>
          <Icon name="arrow-left" size={20} color="#F0F4F8" />
        </Pressable>

        <View style={st.breadcrumb}>
          <Pressable onPress={async () => { await flushSave(); onBack(); }}>
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
            <View style={st.menuDivider} />
            <Pressable
              style={st.menuItem}
              onPress={() => { setShowTitleMenu(false); setShowIntroOutroPage(true); }}
            >
              <Icon name="play" size={16} color="#F472B6" />
              <Text style={st.menuItemText}>Edit Intro / Outro</Text>
            </Pressable>
            <View style={st.menuDivider} />
            <Pressable
              style={st.menuItem}
              onPress={() => { setShowTitleMenu(false); setShowMoveTo(true); }}
            >
              <Icon name="arrow-right" size={16} color="#8A95A3" />
              <Text style={st.menuItemText}>Move to...</Text>
            </Pressable>
          </View>
        </Pressable>
      )}

      {/* ── Main content: blocks ─────────────────────────────────────────── */}
      <ScrollView
        style={st.scrollArea}
        contentContainerStyle={{ paddingHorizontal: GRID_PADDING, paddingBottom: 120 }}
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
            const blockColor = BLOCK_COLORS[block.type] || '#4A5568';
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
                  {/* Special block (Water Break, Transition) */}
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
                        <Text style={{ fontSize: 20 }}>
                          {block.type === 'Water Break' ? '💧' :
                           block.type === 'Transition' ? '→' : '•'}
                        </Text>
                      </View>
                      <Text style={[st.specialLabel, { color: blockColor }]}>{block.label}</Text>
                      {block.durationSec !== undefined && (
                        <Text style={st.specialDuration}>{block.durationSec}s</Text>
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
                          if (!movementsLoaded) loadMovements();
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
                              {/* GIF thumbnail background */}
                              {thumbUri ? (
                                <Image
                                  source={{ uri: thumbUri }}
                                  style={{ width: '100%', height: '100%' }}
                                  resizeMode="cover"
                                />
                              ) : (
                                <View style={st.movPlaceholder}>
                                  <Icon name="movements" size={20} color="#4A5568" />
                                </View>
                              )}

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
                                <View style={st.reorderIndicator}>
                                  <Text style={st.reorderText}>Tap to place</Text>
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
                          if (!movementsLoaded) loadMovements();
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
                                {thumbUri ? (
                                  <Image source={{ uri: thumbUri }} style={st.listThumbImg} resizeMode="cover" />
                                ) : (
                                  <View style={st.listThumbPlaceholder}>
                                    <Icon name="movements" size={16} color="#4A5568" />
                                  </View>
                                )}
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
                          if (!movementsLoaded) loadMovements();
                        }}
                      >
                        <Icon name="plus" size={14} color="#4A5568" />
                        <Text style={st.addMovRowText}>Add Movement</Text>
                      </Pressable>
                    </View>
                  )}

                  {/* ── Block control bar (stretches left from bottom-right) ── */}
                  {!isSpecial && !hasNoMovements && (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        if (expandedBlockIdx === blockIdx) {
                          setExpandedBlockIdx(null);
                        } else {
                          setExpandedBlockIdx(blockIdx);
                          setExpandedMovKey(null);
                        }
                      }}
                    >
                      <View style={[st.blockControlBar, isBlockExpanded && st.blockControlBarExpanded]}>
                        {isBlockExpanded ? (
                          <>
                            {/* Trash */}
                            <Pressable
                              style={st.bcTrash}
                              onPress={(e) => { e.stopPropagation(); removeBlock(blockIdx); }}
                            >
                              <Icon name="trash-2" size={13} color="#EF4444" />
                            </Pressable>

                            <View style={st.bcDivider} />

                            {/* Rounds: − 3× + */}
                            <Pressable style={st.bcBtn} onPress={(e) => { e.stopPropagation(); updateBlockRounds(blockIdx, -1); }}>
                              <Text style={st.bcBtnText}>−</Text>
                            </Pressable>
                            <Text style={st.bcValue}>{block.rounds ?? DEFAULT_ROUNDS}×</Text>
                            <Pressable style={st.bcBtn} onPress={(e) => { e.stopPropagation(); updateBlockRounds(blockIdx, 1); }}>
                              <Text style={st.bcBtnText}>+</Text>
                            </Pressable>

                            <View style={st.bcDivider} />

                            {/* Prep: − 20s + */}
                            <Pressable style={st.bcBtn} onPress={(e) => { e.stopPropagation(); updateBlockPrepTime(blockIdx, -5); }}>
                              <Text style={st.bcBtnText}>−</Text>
                            </Pressable>
                            <Text style={st.bcValue}>{block.firstMovementPrepSec ?? DEFAULT_REST_SEC}s</Text>
                            <Pressable style={st.bcBtn} onPress={(e) => { e.stopPropagation(); updateBlockPrepTime(blockIdx, 5); }}>
                              <Text style={st.bcBtnText}>+</Text>
                            </Pressable>

                            <View style={st.bcDivider} />

                            {/* Demo toggle — eye icon */}
                            <Pressable
                              style={[st.bcDemoBtn, block.showDemo && st.bcDemoBtnOn]}
                              onPress={(e) => { e.stopPropagation(); toggleBlockDemo(blockIdx); }}
                            >
                              <Icon name="eye" size={13} color={block.showDemo ? '#0E1117' : '#4A5568'} />
                            </Pressable>
                          </>
                        ) : (
                          /* Collapsed: just show rounds badge */
                          <Text style={[st.roundsText, { color: blockColor }]}>
                            {block.rounds ?? DEFAULT_ROUNDS}×
                          </Text>
                        )}
                      </View>
                    </Pressable>
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
                    if (!movementsLoaded) loadMovements();
                  } else {
                    addBlock(opt.type, addBlockAtIndex ?? undefined);
                  }
                  setAddBlockAtIndex(null);
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
        onClose={() => { setShowMovementPicker(false); setMovementPickerBlockIdx(null); }}
        maxHeightPct={0.8}
        sheetBg="#1E2A3A"
        backdropColor="rgba(0,0,0,0.7)"
        borderRadius={24}
      >
            <View style={st.pickerHeader}>
              <Text style={st.pickerTitle}>Add Movement</Text>
              <Pressable onPress={() => { setShowMovementPicker(false); setMovementPickerBlockIdx(null); }}>
                <Icon name="close" size={20} color="#8A95A3" />
              </Pressable>
            </View>
            <View style={st.pickerSearch}>
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
            <ScrollView contentContainerStyle={st.pickerList} keyboardShouldPersistTaps="handled">
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
                    {mov.thumbnailUrl || mov.mediaUrl ? (
                      <Image source={{ uri: mov.thumbnailUrl || mov.mediaUrl || '' }} style={st.pickerThumbImg} resizeMode="cover" />
                    ) : (
                      <View style={st.pickerThumbPlaceholder}>
                        <Icon name="movements" size={16} color="#4A5568" />
                      </View>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={st.pickerItemName}>{mov.name}</Text>
                    {mov.category ? <Text style={st.pickerItemCat}>{mov.category}</Text> : null}
                  </View>
                  <Icon name="plus" size={18} color="#F5A623" />
                </Pressable>
              ))}
              {filteredMovements.length === 0 && (
                <Text style={st.pickerEmpty}>No movements found</Text>
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

      {/* Workout preview */}
      <WorkoutPlayer
        visible={showPreview}
        workout={{ id: workoutId, name: workoutName, description: workoutDescription, blocks, ...originalData }}
        onClose={() => setShowPreview(false)}
        onComplete={() => setShowPreview(false)}
        isPreview
      />
    </View>
  );
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
    gap: 4,
    marginTop: 8,
    paddingVertical: 5,
    paddingHorizontal: 8,
    backgroundColor: 'rgba(30, 42, 58, 0.6)',
    borderRadius: 10,
    alignSelf: 'flex-end',
  },
  blockControlBarExpanded: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    backgroundColor: '#1E2A3A',
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
    paddingBottom: 20,
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
});
