/**
 * WorkoutForm — Canvas-First Block Builder (Phase 2 + Bug Fixes + Improvements)
 *
 * Opens to a blank canvas where coaches add blocks immediately.
 * Metadata (name, description, category, difficulty, tags, duration,
 * template toggle) lives behind a Details sheet — not the primary view.
 *
 * Block types: Warm-Up, Circuit, Superset, Interval, Strength, Timed,
 * AMRAP, EMOM, Cool-Down, Rest, Intro, Outro, Demo, Transition, Water Break.
 *
 * Between-block "+" buttons let coaches insert water breaks, transitions,
 * or new blocks between existing ones.
 *
 * Defaults per spec: 3 rounds, 40s work, 20s rest/prep.
 *
 * Bug fixes:
 *  - Alert.alert → web-compatible showAlert helper
 *  - Added coaching cues/notes field per movement (expandable)
 *  - Success toast after save
 *  - Block numbering uses sequential counter per type
 *  - Demo added to NO_MOVEMENT_BLOCKS
 *  - Block picker modal closes on Escape key
 *
 * Improvements:
 *  1. Block duplication (long-press menu or duplicate button)
 *  2. Global timing overrides (header button)
 *  3. Extra first-movement prep time per block
 *  4. Movement drag between blocks (move up/down within block)
 *  5. Block merge/combine via between-block inserter
 *  6. Coaching cues per movement (inline expandable)
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  Image,
} from 'react-native';
import DraggableFlatList, {
  ScaleDecorator,
  RenderItemParams,
} from 'react-native-draggable-flatlist';
import { db } from '../lib/firebase';
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
} from 'firebase/firestore';
import { Icon } from './Icon';
import { useWorkoutTemplates, WorkoutTemplate } from '../hooks/useWorkoutTemplates';
import { calculateAdjustedRest } from '../hooks/useRestAutoAdjust';
import { FB, FH } from '../lib/theme';

// ── Web-compatible alert helper ──────────────────────────────────────────
function showAlert(title: string, message?: string) {
  if (Platform.OS === 'web') {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

// ── Toast state (simple banner) ──────────────────────────────────────────
let _toastTimeout: ReturnType<typeof setTimeout> | null = null;

// ── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES = [
  'Upper Body', 'Lower Body', 'Full Body', 'Core',
  'Cardio', 'Mobility', 'Recovery',
];
const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'];
const TAG_PRESETS = [
  'strength', 'hypertrophy', 'endurance', 'HIIT', 'circuit',
  'warm-up', 'cool-down', '15min', '30min', '45min', '60min',
];

// Block types: exercise blocks + special blocks
const EXERCISE_BLOCK_TYPES = [
  'Warm-Up', 'Circuit', 'Superset', 'Interval', 'Strength',
  'Timed', 'AMRAP', 'EMOM', 'Cool-Down', 'Rest',
];
const SPECIAL_BLOCK_TYPES = [
  'Intro', 'Outro', 'Demo', 'Transition', 'Water Break', 'Grab Equipment',
];
const ALL_BLOCK_TYPES = [...EXERCISE_BLOCK_TYPES, ...SPECIAL_BLOCK_TYPES];

// Special blocks that don't contain movements (Demo added — was missing)
const NO_MOVEMENT_BLOCKS = ['Intro', 'Outro', 'Demo', 'Transition', 'Water Break', 'Grab Equipment'];

// Quick-insert types for between-block "+" buttons
const QUICK_INSERT_TYPES = ['Water Break', 'Transition', 'Rest'];

// Block types that support circuit start rest override
const CIRCUIT_TYPE_BLOCKS = ['Circuit', 'Superset', 'AMRAP', 'EMOM'];

// Default timing per spec
const DEFAULT_ROUNDS = 3;
const DEFAULT_DURATION_SEC = 40;
const DEFAULT_REST_SEC = 20;

// Color coding for block types
const BLOCK_COLORS: Record<string, string> = {
  'Warm-Up': '#F59E0B',
  'Circuit': '#34D399',
  'Superset': '#F59E0B',
  'Interval': '#818CF8',
  'Strength': '#7DD3FC',
  'Timed': '#A78BFA',
  'AMRAP': '#34D399',
  'EMOM': '#34D399',
  'Cool-Down': '#60A5FA',
  'Rest': '#4A5568',
  'Intro': '#F472B6',
  'Outro': '#F472B6',
  'Demo': '#FBBF24',
  'Transition': '#94A3B8',
  'Water Break': '#38BDF8',
  'Grab Equipment': '#FB923C',
};

// ── Helper: auto-calculate duration from blocks ──────────────────────────
function calcDurationMin(blocks: WorkoutBlock[]): number {
  let totalSec = 0;
  for (const block of blocks) {
    if (NO_MOVEMENT_BLOCKS.includes(block.type)) {
      totalSec += block.durationSec ?? 10;
      continue;
    }
    const rounds = block.rounds ?? DEFAULT_ROUNDS;
    const firstMovePrepSec = block.firstMovementPrepSec ?? 0;
    let blockSec = 0;
    for (const m of block.movements ?? []) {
      const sets = m.sets ?? 1;
      const durPerSet = m.durationSec ?? DEFAULT_DURATION_SEC;
      const restPerSet = m.restSec ?? DEFAULT_REST_SEC;
      blockSec += sets * (durPerSet + restPerSet);
    }
    const restBetween = block.restBetweenRoundsSec ?? 0;
    totalSec += rounds * (blockSec + firstMovePrepSec) + (rounds > 1 ? (rounds - 1) * restBetween : 0);
  }
  return Math.ceil(totalSec / 60);
}

// ── Helper: generate sequential block label ──────────────────────────────
function generateBlockLabel(type: string, existingBlocks: WorkoutBlock[]): string {
  if (type === 'Water Break') return '💧 Water Break';
  if (type === 'Transition') return '→ Transition';
  if (type === 'Grab Equipment') return 'Grab Equipment';
  // Count how many blocks of this type already exist
  const count = existingBlocks.filter(b => b.type === type).length + 1;
  return `${type} ${count}`;
}

// ── Types ────────────────────────────────────────────────────────────────────
interface BlockMovement {
  movementId: string;
  movementName: string;
  sets?: number;
  reps?: string;
  durationSec?: number;
  restSec?: number;
  notes?: string;
  thumbnailUrl?: string;
  showOnPreview?: boolean;
}

interface WorkoutBlock {
  type: string;
  label: string;
  rounds?: number;
  restBetweenRoundsSec?: number;
  restBetweenMovementsSec?: number;
  durationSec?: number;
  instructionText?: string;
  firstMovementPrepSec?: number; // extra prep time before first movement
  circuitStartRestSec?: number; // rest before first movement, first round only (circuit-type blocks)
  movements: BlockMovement[];
}

interface MovementOption {
  id: string;
  name: string;
  category: string;
  thumbnailUrl?: string | null;
  mediaUrl?: string | null;
  videoUrl?: string | null;
}

// ── Props ────────────────────────────────────────────────────────────────────
interface WorkoutFormProps {
  visible: boolean;
  onClose: () => void;
  coachId: string;
  tenantId: string;
  editWorkout?: any | null;
  sessionDurationMin?: number | null;
}

export default function WorkoutForm({
  visible,
  onClose,
  coachId,
  tenantId,
  editWorkout,
  sessionDurationMin,
}: WorkoutFormProps) {
  const isEdit = !!editWorkout && !!editWorkout.id;

  // ── Form state ─────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [estimatedDurationMin, setEstimatedDurationMin] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [customTag, setCustomTag] = useState('');
  const [isTemplate, setIsTemplate] = useState(false);
  const [blocks, setBlocks] = useState<WorkoutBlock[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // ── UI state ──────────────────────────────────────────────────────────
  const [showDetails, setShowDetails] = useState(false);
  const [showBlockTypePicker, setShowBlockTypePicker] = useState(false);
  const [insertAtIndex, setInsertAtIndex] = useState<number | null>(null);
  const [expandedBlock, setExpandedBlock] = useState<number | null>(null);
  const [expandedMovement, setExpandedMovement] = useState<string | null>(null); // "blockIdx-movIdx"
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showGlobalTiming, setShowGlobalTiming] = useState(false);

  // ── Global timing overrides ──────────────────────────────────────────
  const [globalWorkSec, setGlobalWorkSec] = useState(String(DEFAULT_DURATION_SEC));
  const [globalRestSec, setGlobalRestSec] = useState(String(DEFAULT_REST_SEC));
  const [globalRounds, setGlobalRounds] = useState(String(DEFAULT_ROUNDS));
  const [globalPrepSec, setGlobalPrepSec] = useState('0');

  // ── Template picker state ──────────────────────────────────────────────
  const {
    templates, filteredTemplates, loading: templatesLoading, error: templatesError,
    loadTemplates, renameTemplate, deleteTemplate, toggleShareTemplate,
    categoryFilter, setCategoryFilter, tagFilter, setTagFilter,
    availableCategories, availableTags,
  } = useWorkoutTemplates(coachId);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // ── Movement picker state ──────────────────────────────────────────────
  const [availableMovements, setAvailableMovements] = useState<MovementOption[]>([]);
  const [movementsLoaded, setMovementsLoaded] = useState(false);
  const [addingMovementToBlock, setAddingMovementToBlock] = useState<number | null>(null);
  const [movementSearch, setMovementSearch] = useState('');
  const [movementCategoryFilter, setMovementCategoryFilter] = useState<string | null>(null);

  // ── Toast helper ──────────────────────────────────────────────────────
  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    if (_toastTimeout) clearTimeout(_toastTimeout);
    _toastTimeout = setTimeout(() => setToastMessage(null), 3000);
  }, []);

  // ── Keyboard handler for Escape to close modals ──────────────────────
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showBlockTypePicker) {
          setShowBlockTypePicker(false);
          setInsertAtIndex(null);
        } else if (showDetails) {
          setShowDetails(false);
        } else if (showTemplatePicker) {
          setShowTemplatePicker(false);
        } else if (showGlobalTiming) {
          setShowGlobalTiming(false);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [showBlockTypePicker, showDetails, showTemplatePicker, showGlobalTiming]);

  // ── Load available movements ──────────────────────────────────────────
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
          list.push({ id: d.id, name: cd.name ?? '', category: cd.category ?? '', mediaUrl: cd.mediaUrl ?? null, videoUrl: cd.videoUrl ?? null });
        }
      });
      globalSnap.docs.forEach((d) => {
        const gd = d.data();
        if (!seen.has(d.id) && !gd.isArchived) {
          seen.add(d.id);
          list.push({ id: d.id, name: gd.name ?? '', category: gd.category ?? '', mediaUrl: gd.mediaUrl ?? null, videoUrl: gd.videoUrl ?? null });
        }
      });
      list.sort((a, b) => a.name.localeCompare(b.name));
      setAvailableMovements(list);
      setMovementsLoaded(true);
    } catch (err: any) {
      console.error('[WorkoutForm] Load movements error:', err?.message ?? err);
      showAlert('Could not load movements', 'Please close and try again.');
    }
  }, [coachId, movementsLoaded]);

  useEffect(() => {
    if (visible) setMovementsLoaded(false);
  }, [visible]);

  const handleOpenMovementPicker = useCallback((blockIndex: number) => {
    setAddingMovementToBlock(blockIndex);
    if (!movementsLoaded) loadMovements();
  }, [movementsLoaded, loadMovements]);

  // ── Pre-populate on edit ───────────────────────────────────────────────
  useEffect(() => {
    if (editWorkout) {
      setName(editWorkout.name ?? '');
      setDescription(editWorkout.description ?? '');
      setCategory(editWorkout.category ?? '');
      setDifficulty(editWorkout.difficulty ?? '');
      setEstimatedDurationMin(editWorkout.estimatedDurationMin ? String(editWorkout.estimatedDurationMin) : '');
      setSelectedTags(editWorkout.tags ?? []);
      setIsTemplate(editWorkout.isTemplate ?? false);
      setBlocks(
        (editWorkout.blocks ?? []).map((b: any) => ({
          type: b.type ?? 'Circuit',
          label: b.label ?? '',
          rounds: b.rounds ?? DEFAULT_ROUNDS,
          restBetweenRoundsSec: b.restBetweenRoundsSec ?? 0,
          restBetweenMovementsSec: b.restBetweenMovementsSec ?? 0,
          durationSec: b.durationSec ?? undefined,
          instructionText: b.instructionText ?? undefined,
          firstMovementPrepSec: b.firstMovementPrepSec ?? 0,
          circuitStartRestSec: b.circuitStartRestSec ?? undefined,
          movements: (b.movements ?? []).map((m: any) => ({
            movementId: m.movementId ?? '',
            movementName: m.movementName ?? '',
            sets: m.sets ?? undefined,
            reps: m.reps ?? undefined,
            durationSec: m.durationSec ?? undefined,
            restSec: m.restSec ?? undefined,
            notes: m.notes ?? '',
            showOnPreview: m.showOnPreview,
          })),
        })),
      );
    } else {
      resetForm();
    }
  }, [editWorkout]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setCategory('');
    setDifficulty('');
    setEstimatedDurationMin('');
    setSelectedTags([]);
    setCustomTag('');
    setIsTemplate(false);
    setBlocks([]);
    setAddingMovementToBlock(null);
    setMovementSearch('');
    setShowDetails(false);
    setExpandedBlock(null);
    setExpandedMovement(null);
    setShowGlobalTiming(false);
  };

  // ── Auto-calculated duration ──────────────────────────────────────────
  const autoDurationMin = useMemo(() => calcDurationMin(blocks), [blocks]);

  // ── Template loader ──────────────────────────────────────────────────
  const loadFromTemplate = (t: WorkoutTemplate) => {
    setName(t.name + ' (Copy)');
    setDescription(t.description);
    setCategory(t.category);
    setDifficulty(t.difficulty);
    setEstimatedDurationMin(t.estimatedDurationMin ? String(t.estimatedDurationMin) : '');
    setSelectedTags(t.tags || []);
    setBlocks(t.blocks || []);
    setIsTemplate(false);
    setShowTemplatePicker(false);
  };

  // ── Tag helpers ────────────────────────────────────────────────────────
  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  };
  const addCustomTag = () => {
    const trimmed = customTag.trim().toLowerCase();
    if (trimmed && !selectedTags.includes(trimmed)) setSelectedTags((prev) => [...prev, trimmed]);
    setCustomTag('');
  };

  // ── Block helpers ──────────────────────────────────────────────────────
  const addBlock = (type: string, atIndex?: number | null) => {
    // Demo block placement rule: should be placed before a multi-movement exercise block
    if (type === 'Demo') {
      const targetIndex = atIndex != null ? atIndex : blocks.length;
      const nextBlock = blocks[targetIndex];
      if (!nextBlock || NO_MOVEMENT_BLOCKS.includes(nextBlock.type)) {
        showAlert('Demo Placement', 'Demo blocks should be placed before an exercise block (Circuit, Superset, etc.) to preview its movements.');
      }
    }
    const isSpecial = NO_MOVEMENT_BLOCKS.includes(type);
    const newBlock: WorkoutBlock = {
      type,
      label: generateBlockLabel(type, blocks),
      rounds: isSpecial ? 1 : DEFAULT_ROUNDS,
      restBetweenRoundsSec: 0,
      restBetweenMovementsSec: 0,
      durationSec: isSpecial ? (type === 'Water Break' ? 30 : (type === 'Transition' || type === 'Grab Equipment') ? 15 : 10) : undefined,
      firstMovementPrepSec: 0,
      movements: [],
    };
    if (atIndex != null && atIndex >= 0 && atIndex <= blocks.length) {
      setBlocks((prev) => [...prev.slice(0, atIndex), newBlock, ...prev.slice(atIndex)]);
    } else {
      setBlocks((prev) => [...prev, newBlock]);
    }
    setShowBlockTypePicker(false);
    setInsertAtIndex(null);
  };

  const removeBlock = (index: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
    if (expandedBlock === index) setExpandedBlock(null);
  };

  // ── IMPROVEMENT: Duplicate block ──────────────────────────────────────
  const duplicateBlock = (index: number) => {
    setBlocks((prev) => {
      const original = prev[index];
      const clone: WorkoutBlock = {
        ...original,
        label: generateBlockLabel(original.type, prev),
        movements: original.movements.map(m => ({ ...m })),
      };
      return [...prev.slice(0, index + 1), clone, ...prev.slice(index + 1)];
    });
    showToast('Block duplicated');
  };

  // ── IMPROVEMENT: Merge two adjacent blocks ────────────────────────────
  const mergeBlocks = (indexA: number, indexB: number) => {
    setBlocks((prev) => {
      if (indexA < 0 || indexB >= prev.length) return prev;
      const a = prev[indexA];
      const b = prev[indexB];
      // Can only merge exercise blocks
      if (NO_MOVEMENT_BLOCKS.includes(a.type) || NO_MOVEMENT_BLOCKS.includes(b.type)) {
        showAlert('Cannot Merge', 'Special blocks (Water Break, Transition, etc.) cannot be merged.');
        return prev;
      }
      const merged: WorkoutBlock = {
        ...a,
        label: `${a.label} + ${b.label}`,
        movements: [...a.movements, ...b.movements],
      };
      const newBlocks = [...prev];
      newBlocks.splice(indexA, 2, merged);
      return newBlocks;
    });
    showToast('Blocks merged');
  };

  // ── IMPROVEMENT: Move movement within block (up/down) ─────────────────
  const moveMovementInBlock = (blockIndex: number, movIndex: number, direction: 'up' | 'down') => {
    setBlocks((prev) =>
      prev.map((b, i) => {
        if (i !== blockIndex) return b;
        const movs = [...b.movements];
        const targetIdx = direction === 'up' ? movIndex - 1 : movIndex + 1;
        if (targetIdx < 0 || targetIdx >= movs.length) return b;
        [movs[movIndex], movs[targetIdx]] = [movs[targetIdx], movs[movIndex]];
        return { ...b, movements: movs };
      }),
    );
  };

  // ── IMPROVEMENT: Move movement between blocks ─────────────────────────
  const moveMovementToBlock = (fromBlock: number, movIndex: number, toBlock: number) => {
    setBlocks((prev) => {
      const src = prev[fromBlock];
      const dst = prev[toBlock];
      if (!src || !dst || NO_MOVEMENT_BLOCKS.includes(dst.type)) return prev;
      const movement = src.movements[movIndex];
      if (!movement) return prev;
      return prev.map((b, i) => {
        if (i === fromBlock) return { ...b, movements: b.movements.filter((_, mi) => mi !== movIndex) };
        if (i === toBlock) return { ...b, movements: [...b.movements, movement] };
        return b;
      });
    });
    showToast('Movement moved');
  };

  // ── IMPROVEMENT: Apply global timing to all exercise blocks ───────────
  const applyGlobalTiming = () => {
    const work = parseInt(globalWorkSec, 10) || DEFAULT_DURATION_SEC;
    const rest = parseInt(globalRestSec, 10) || DEFAULT_REST_SEC;
    const rounds = parseInt(globalRounds, 10) || DEFAULT_ROUNDS;
    const prep = parseInt(globalPrepSec, 10) || 0;

    setBlocks((prev) =>
      prev.map((b) => {
        if (NO_MOVEMENT_BLOCKS.includes(b.type)) return b;
        return {
          ...b,
          rounds,
          firstMovementPrepSec: prep,
          movements: b.movements.map((m) => ({
            ...m,
            durationSec: work,
            restSec: rest,
          })),
        };
      }),
    );
    setShowGlobalTiming(false);
    showToast('Global timing applied to all blocks');
  };

  const onDragEnd = ({ data }: { data: WorkoutBlock[] }) => setBlocks(data);

  const updateBlockField = (index: number, field: string, value: any) => {
    setBlocks((prev) => prev.map((b, i) => (i === index ? { ...b, [field]: value } : b)));
  };

  const addMovementToBlock = (blockIndex: number, movement: MovementOption) => {
    setBlocks((prev) =>
      prev.map((b, i) =>
        i === blockIndex
          ? {
              ...b,
              movements: [
                ...b.movements,
                {
                  movementId: movement.id,
                  movementName: movement.name,
                  sets: 3,
                  reps: '10',
                  durationSec: DEFAULT_DURATION_SEC,
                  restSec: DEFAULT_REST_SEC,
                  notes: '',
                  thumbnailUrl: movement.mediaUrl || movement.videoUrl || undefined,
                },
              ],
            }
          : b,
      ),
    );
    setAddingMovementToBlock(null);
    setMovementSearch('');
  };

  const removeMovementFromBlock = (blockIndex: number, movementIndex: number) => {
    setBlocks((prev) =>
      prev.map((b, i) =>
        i === blockIndex
          ? { ...b, movements: b.movements.filter((_, mi) => mi !== movementIndex) }
          : b,
      ),
    );
  };

  const updateMovementField = (blockIndex: number, movementIndex: number, field: string, value: any) => {
    setBlocks((prev) =>
      prev.map((b, i) =>
        i === blockIndex
          ? { ...b, movements: b.movements.map((m, mi) => (mi === movementIndex ? { ...m, [field]: value } : m)) }
          : b,
      ),
    );
  };

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!name.trim()) {
      showAlert('Name Required', 'Tap the workout name at the top to add a name.');
      return;
    }
    setSubmitting(true);
    try {
      const cleanBlocks = blocks.map((b) => {
        const clean: any = {
          type: b.type,
          label: b.label,
          rounds: b.rounds ?? DEFAULT_ROUNDS,
          restBetweenRoundsSec: b.restBetweenRoundsSec ?? 0,
        };
        if (b.restBetweenMovementsSec) clean.restBetweenMovementsSec = b.restBetweenMovementsSec;
        if (b.durationSec) clean.durationSec = b.durationSec;
        if (b.instructionText) clean.instructionText = b.instructionText;
        if (b.firstMovementPrepSec) clean.firstMovementPrepSec = b.firstMovementPrepSec;
        if (b.circuitStartRestSec) clean.circuitStartRestSec = b.circuitStartRestSec;
        clean.movements = (b.movements ?? []).map((m) => {
          const cm: any = { movementId: m.movementId, movementName: m.movementName };
          if (m.sets) cm.sets = m.sets;
          if (m.reps) cm.reps = m.reps;
          if (m.durationSec) cm.durationSec = m.durationSec;
          if (m.restSec) cm.restSec = m.restSec;
          if (m.notes) cm.notes = m.notes;
          if (m.showOnPreview === false) cm.showOnPreview = false;
          return cm;
        });
        return clean;
      });

      // Build coverThumbs
      const coverThumbs: string[] = [];
      const seenMoveIds = new Set<string>();
      for (const b of cleanBlocks) {
        for (const m of b.movements ?? []) {
          if (m.movementId && !seenMoveIds.has(m.movementId)) {
            seenMoveIds.add(m.movementId);
            const mv = availableMovements.find((am) => am.id === m.movementId);
            const thumb = mv?.thumbnailUrl || mv?.mediaUrl || mv?.videoUrl || null;
            if (thumb) coverThumbs.push(thumb);
          }
          if (coverThumbs.length >= 16) break;
        }
        if (coverThumbs.length >= 16) break;
      }

      const payload: any = {
        name: name.trim(),
        description: description.trim(),
        category,
        difficulty,
        estimatedDurationMin: estimatedDurationMin ? parseInt(estimatedDurationMin, 10) : (autoDurationMin > 0 ? autoDurationMin : null),
        tags: selectedTags,
        isTemplate,
        blocks: cleanBlocks,
        coverThumbs,
        updatedAt: serverTimestamp(),
      };

      if (isEdit) {
        await updateDoc(doc(db, 'workouts', editWorkout.id), payload);
      } else {
        await addDoc(collection(db, 'workouts'), {
          ...payload,
          coachId,
          tenantId,
          isArchived: false,
          createdAt: serverTimestamp(),
        });
      }
      showToast(isEdit ? 'Workout saved!' : 'Workout created!');
      // Small delay so toast is visible before closing
      setTimeout(() => {
        resetForm();
        onClose();
      }, 600);
    } catch (error) {
      console.error('[WorkoutForm] Save error:', error);
      showAlert('Error', 'Could not save workout. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Filtered movements for picker ──────────────────────────────────────
  const movementCategories = useMemo(() => {
    const cats = new Set<string>();
    availableMovements.forEach(m => { if (m.category) cats.add(m.category); });
    return Array.from(cats).sort();
  }, [availableMovements]);

  const filteredMovements = useMemo(() => {
    let list = availableMovements;
    if (movementCategoryFilter) {
      list = list.filter(m => m.category === movementCategoryFilter);
    }
    if (movementSearch.trim()) {
      const q = movementSearch.toLowerCase();
      list = list.filter(m => m.name.toLowerCase().includes(q));
    }
    return list;
  }, [availableMovements, movementSearch, movementCategoryFilter]);

  // ── Block color helper ────────────────────────────────────────────────
  const blockColor = (type: string) => BLOCK_COLORS[type] || '#7DD3FC';

  // ── Find adjacent exercise blocks for merge ───────────────────────────
  const canMergeAbove = (bi: number) => {
    if (bi <= 0) return false;
    return !NO_MOVEMENT_BLOCKS.includes(blocks[bi].type) && !NO_MOVEMENT_BLOCKS.includes(blocks[bi - 1].type);
  };

  // ── Find adjacent exercise blocks for movement transfer ───────────────
  const getAdjacentExerciseBlocks = (bi: number) => {
    const result: { index: number; label: string }[] = [];
    for (let i = 0; i < blocks.length; i++) {
      if (i !== bi && !NO_MOVEMENT_BLOCKS.includes(blocks[i].type)) {
        result.push({ index: i, label: blocks[i].label });
      }
    }
    return result;
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <>
    <Modal visible={visible} animationType="slide" transparent>
      <View style={s.overlay}>
        <View style={s.sheet}>
          {/* Handle */}
          <View style={s.handle} />

          {/* Header — Canvas-first: name inline, details behind gear */}
          <View style={s.header}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <TextInput
                style={s.nameInput}
                value={name}
                onChangeText={setName}
                placeholder="Workout name..."
                placeholderTextColor="#4A5568"
                maxLength={60}
              />
              {autoDurationMin > 0 && (
                <Text style={s.durationHint}>
                  ~{autoDurationMin} min · {blocks.length} block{blocks.length !== 1 ? 's' : ''}
                  {sessionDurationMin != null && sessionDurationMin > 0 && (
                    <Text style={{ color: Math.abs(autoDurationMin - sessionDurationMin) > 10 ? '#F59E0B' : '#34D399' }}>
                      {' '}(Session: {sessionDurationMin}m)
                    </Text>
                  )}
                </Text>
              )}
              {autoDurationMin === 0 && blocks.length > 0 && (
                <Text style={s.durationHint}>{blocks.length} block{blocks.length !== 1 ? 's' : ''}</Text>
              )}
            </View>
            {/* Global timing button */}
            {blocks.length > 0 && (
              <TouchableOpacity
                onPress={() => setShowGlobalTiming(true)}
                style={s.headerBtn}
                hitSlop={4}
              >
                <Icon name="clock" size={18} color="#8A95A3" />
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => setShowDetails(true)}
              style={s.headerBtn}
              hitSlop={4}
            >
              <Icon name="settings" size={20} color="#8A95A3" />
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={s.headerBtn} hitSlop={4}>
              <Icon name="close" size={22} color="#8A95A3" />
            </TouchableOpacity>
          </View>

          {/* ── Canvas: Block List ─────────────────────────────────── */}
          <ScrollView
            style={s.body}
            contentContainerStyle={s.canvasContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Empty state */}
            {blocks.length === 0 && (
              <View style={s.emptyState}>
                <Icon name="layers" size={48} color="#2A3347" />
                <Text style={s.emptyTitle}>Start building</Text>
                <Text style={s.emptyHint}>
                  Add your first block to begin. Drag to reorder.
                </Text>
                <View style={s.emptyActions}>
                  {!isEdit && (
                    <TouchableOpacity
                      style={s.templateBtn}
                      onPress={() => { loadTemplates(); setShowTemplatePicker(true); }}
                    >
                      <Icon name="copy" size={14} color="#F5A623" />
                      <Text style={s.templateBtnText}>From Template</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}

            {/* Draggable block list with between-block inserters */}
            <DraggableFlatList
              data={blocks}
              keyExtractor={(_, index) => `block-${index}`}
              onDragEnd={onDragEnd}
              scrollEnabled={false}
              containerStyle={{ gap: 0 }}
              renderItem={({ item: block, drag, isActive, getIndex }: RenderItemParams<WorkoutBlock>) => {
                const bi = getIndex() ?? 0;
                const color = blockColor(block.type);
                const isSpecial = NO_MOVEMENT_BLOCKS.includes(block.type);
                const isExpanded = expandedBlock === bi;

                return (
                  <ScaleDecorator>
                    <View>
                      {/* Between-block inserter ABOVE this block (except first) */}
                      {bi > 0 && (
                        <View style={s.inserterRow}>
                          <View style={s.inserterLine} />
                          <TouchableOpacity
                            style={s.inserterBtn}
                            onPress={() => { setInsertAtIndex(bi); setShowBlockTypePicker(true); }}
                          >
                            <Icon name="add" size={14} color="#4A5568" />
                          </TouchableOpacity>
                          {/* Quick-insert chips */}
                          {QUICK_INSERT_TYPES.map((qt) => (
                            <TouchableOpacity
                              key={qt}
                              style={s.quickInsertChip}
                              onPress={() => addBlock(qt, bi)}
                            >
                              <Text style={[s.quickInsertText, { color: blockColor(qt) }]}>
                                {qt === 'Water Break' ? '💧' : qt === 'Transition' ? '→' : '⏸'}
                              </Text>
                            </TouchableOpacity>
                          ))}
                          {/* Merge button if both blocks are exercise blocks */}
                          {canMergeAbove(bi) && (
                            <TouchableOpacity
                              style={s.quickInsertChip}
                              onPress={() => mergeBlocks(bi - 1, bi)}
                            >
                              <Text style={[s.quickInsertText, { color: '#A78BFA' }]}>⊕</Text>
                            </TouchableOpacity>
                          )}
                          <View style={s.inserterLine} />
                        </View>
                      )}

                      {/* Block card */}
                      <View style={[
                        s.blockCard,
                        { borderLeftColor: color, borderLeftWidth: 3 },
                        isActive && s.blockCardDragging,
                      ]}>
                        {/* Block header */}
                        <View style={s.blockHeader}>
                          <Pressable onLongPress={drag} style={s.dragHandle}>
                            <Icon name="more-vertical" size={18} color={isActive ? '#F5A623' : '#4A5568'} />
                          </Pressable>
                          <View style={[s.blockTypeBadge, { backgroundColor: `${color}22` }]}>
                            <Text style={[s.blockTypeBadgeText, { color }]}>{block.type}</Text>
                          </View>
                          <TextInput
                            style={[s.blockLabelInput, { flex: 1 }]}
                            value={block.label}
                            onChangeText={(t) => updateBlockField(bi, 'label', t)}
                            placeholder="Block label..."
                            placeholderTextColor="#4A5568"
                          />
                          {/* Rounds badge (tap to change) */}
                          {!isSpecial && (
                            <TouchableOpacity
                              style={[s.roundsBadge, { borderColor: color }]}
                              onPress={() => setExpandedBlock(isExpanded ? null : bi)}
                            >
                              <Text style={[s.roundsBadgeText, { color }]}>
                                {block.rounds ?? DEFAULT_ROUNDS}×
                              </Text>
                            </TouchableOpacity>
                          )}
                          {/* Duplicate button */}
                          <Pressable onPress={() => duplicateBlock(bi)} hitSlop={6} style={{ marginLeft: 4 }}>
                            <Icon name="copy" size={14} color="#4A5568" />
                          </Pressable>
                          <Pressable onPress={() => removeBlock(bi)} hitSlop={6} style={{ marginLeft: 4 }}>
                            <Icon name="close" size={16} color="#EF4444" />
                          </Pressable>
                        </View>

                        {/* Expanded settings */}
                        {isExpanded && !isSpecial && (
                          <View style={s.blockSettingsRow}>
                            <View style={s.blockSettingItem}>
                              <Text style={s.blockSettingLabel}>Rounds</Text>
                              <TextInput
                                style={s.blockSettingInput}
                                value={String(block.rounds ?? DEFAULT_ROUNDS)}
                                onChangeText={(t) => updateBlockField(bi, 'rounds', parseInt(t.replace(/[^0-9]/g, ''), 10) || 1)}
                                keyboardType="number-pad"
                                maxLength={2}
                              />
                            </View>
                            <View style={s.blockSettingItem}>
                              <Text style={s.blockSettingLabel}>Rest Between</Text>
                              <TextInput
                                style={s.blockSettingInput}
                                value={String(block.restBetweenRoundsSec ?? 0)}
                                onChangeText={(t) => updateBlockField(bi, 'restBetweenRoundsSec', parseInt(t.replace(/[^0-9]/g, ''), 10) || 0)}
                                keyboardType="number-pad"
                                maxLength={3}
                                placeholder="sec"
                                placeholderTextColor="#4A5568"
                              />
                            </View>
                            {(block.type === 'Superset' || block.type === 'Circuit') && (
                              <View style={s.blockSettingItem}>
                                <Text style={s.blockSettingLabel}>Transition</Text>
                                <TextInput
                                  style={s.blockSettingInput}
                                  value={String(block.restBetweenMovementsSec ?? 0)}
                                  onChangeText={(t) => updateBlockField(bi, 'restBetweenMovementsSec', parseInt(t.replace(/[^0-9]/g, ''), 10) || 0)}
                                  keyboardType="number-pad"
                                  maxLength={3}
                                  placeholder="sec"
                                  placeholderTextColor="#4A5568"
                                />
                              </View>
                            )}
                            {/* First movement prep time */}
                            <View style={s.blockSettingItem}>
                              <Text style={s.blockSettingLabel}>Prep Time</Text>
                              <TextInput
                                style={s.blockSettingInput}
                                value={String(block.firstMovementPrepSec ?? 0)}
                                onChangeText={(t) => updateBlockField(bi, 'firstMovementPrepSec', parseInt(t.replace(/[^0-9]/g, ''), 10) || 0)}
                                keyboardType="number-pad"
                                maxLength={3}
                                placeholder="sec"
                                placeholderTextColor="#4A5568"
                              />
                            </View>
                            {/* Circuit start rest override — first round, first movement only */}
                            {CIRCUIT_TYPE_BLOCKS.includes(block.type) && (
                              <View style={s.blockSettingItem}>
                                <Text style={s.blockSettingLabel}>Start Rest</Text>
                                <TextInput
                                  style={s.blockSettingInput}
                                  value={String(block.circuitStartRestSec ?? 0)}
                                  onChangeText={(t) => updateBlockField(bi, 'circuitStartRestSec', parseInt(t.replace(/[^0-9]/g, ''), 10) || 0)}
                                  keyboardType="number-pad"
                                  maxLength={3}
                                  placeholder="sec"
                                  placeholderTextColor="#4A5568"
                                />
                                <Text style={s.blockSettingHint}>1st round only</Text>
                              </View>
                            )}
                          </View>
                        )}

                        {/* Special block: duration + instruction */}
                        {isSpecial && (
                          <View style={s.specialBlockContent}>
                            <View style={s.blockSettingItem}>
                              <Text style={s.blockSettingLabel}>Duration (sec)</Text>
                              <TextInput
                                style={s.blockSettingInput}
                                value={String(block.durationSec ?? 10)}
                                onChangeText={(t) => updateBlockField(bi, 'durationSec', parseInt(t.replace(/[^0-9]/g, ''), 10) || 10)}
                                keyboardType="number-pad"
                                maxLength={3}
                              />
                            </View>
                            {(block.type === 'Transition' || block.type === 'Demo' || block.type === 'Grab Equipment') && (
                              <TextInput
                                style={s.instructionInput}
                                value={block.instructionText ?? ''}
                                onChangeText={(t) => updateBlockField(bi, 'instructionText', t)}
                                placeholder="Instruction text..."
                                placeholderTextColor="#4A5568"
                                multiline
                              />
                            )}
                          </View>
                        )}

                        {/* Movements in this block (only for exercise blocks) */}
                        {!isSpecial && (
                          <>
                            {block.movements.map((mov, mi) => {
                              const movKey = `${bi}-${mi}`;
                              const isMovExpanded = expandedMovement === movKey;
                              const adjacentBlocks = getAdjacentExerciseBlocks(bi);

                              return (
                                <View key={mi} style={s.movementRow}>
                                  <View style={s.movementMainRow}>
                                    {mov.thumbnailUrl && (
                                      <Image
                                        source={{ uri: mov.thumbnailUrl }}
                                        style={s.movementThumbImg}
                                      />
                                    )}
                                    <View style={s.movementInfo}>
                                      <Text style={s.movementName} numberOfLines={1}>
                                        {mov.movementName}
                                      </Text>
                                      <View style={s.movementFields}>
                                        <TextInput
                                          style={s.movementFieldInput}
                                          value={String(mov.sets ?? '')}
                                          onChangeText={(t) => updateMovementField(bi, mi, 'sets', parseInt(t.replace(/[^0-9]/g, ''), 10) || undefined)}
                                          placeholder="Sets"
                                          placeholderTextColor="#4A5568"
                                          keyboardType="number-pad"
                                          maxLength={2}
                                        />
                                        <Text style={s.movementFieldSep}>×</Text>
                                        <TextInput
                                          style={s.movementFieldInput}
                                          value={mov.reps ?? ''}
                                          onChangeText={(t) => updateMovementField(bi, mi, 'reps', t)}
                                          placeholder="Reps"
                                          placeholderTextColor="#4A5568"
                                        />
                                        <Text style={s.movementFieldSep}>|</Text>
                                        <TextInput
                                          style={s.movementFieldInput}
                                          value={mov.durationSec ? String(mov.durationSec) : ''}
                                          onChangeText={(t) => updateMovementField(bi, mi, 'durationSec', parseInt(t.replace(/[^0-9]/g, ''), 10) || undefined)}
                                          placeholder={`${DEFAULT_DURATION_SEC}s`}
                                          placeholderTextColor="#4A5568"
                                          keyboardType="number-pad"
                                          maxLength={3}
                                        />
                                        <Text style={s.movementFieldSep}>|</Text>
                                        <TextInput
                                          style={[s.movementFieldInput, !mov.restSec && s.movementFieldAutoRest]}
                                          value={mov.restSec ? String(mov.restSec) : ''}
                                          onChangeText={(t) => updateMovementField(bi, mi, 'restSec', parseInt(t.replace(/[^0-9]/g, ''), 10) || undefined)}
                                          placeholder={`${calculateAdjustedRest(mov, block, difficulty || 'Intermediate')}s`}
                                          placeholderTextColor="#6B7280"
                                          keyboardType="number-pad"
                                          maxLength={3}
                                        />
                                      </View>
                                    </View>
                                    {/* Movement actions */}
                                    <View style={s.movementActions}>
                                      <Pressable
                                        onPress={() => updateMovementField(bi, mi, 'showOnPreview', mov.showOnPreview === false ? true : false)}
                                        hitSlop={4}
                                      >
                                        <Icon
                                          name={mov.showOnPreview === false ? 'eye-off' : 'eye'}
                                          size={14}
                                          color={mov.showOnPreview === false ? '#4A5568' : '#8A95A3'}
                                        />
                                      </Pressable>
                                      <Pressable onPress={() => setExpandedMovement(isMovExpanded ? null : movKey)} hitSlop={4}>
                                        <Icon name={isMovExpanded ? 'chevron-up' : 'chevron-down'} size={14} color="#4A5568" />
                                      </Pressable>
                                      <Pressable onPress={() => removeMovementFromBlock(bi, mi)} hitSlop={4}>
                                        <Icon name="close" size={14} color="#EF4444" />
                                      </Pressable>
                                    </View>
                                  </View>

                                  {/* Expanded: coaching cues + move controls */}
                                  {isMovExpanded && (
                                    <View style={s.movementExpanded}>
                                      <TextInput
                                        style={s.coachingCuesInput}
                                        value={mov.notes ?? ''}
                                        onChangeText={(t) => updateMovementField(bi, mi, 'notes', t)}
                                        placeholder="Coaching cues..."
                                        placeholderTextColor="#4A5568"
                                        multiline
                                      />
                                      <View style={s.movementMoveRow}>
                                        {mi > 0 && (
                                          <Pressable style={s.moveMoveBtn} onPress={() => moveMovementInBlock(bi, mi, 'up')}>
                                            <Icon name="arrow-up" size={12} color="#7DD3FC" />
                                            <Text style={s.moveMoveBtnText}>Up</Text>
                                          </Pressable>
                                        )}
                                        {mi < block.movements.length - 1 && (
                                          <Pressable style={s.moveMoveBtn} onPress={() => moveMovementInBlock(bi, mi, 'down')}>
                                            <Icon name="arrow-down" size={12} color="#7DD3FC" />
                                            <Text style={s.moveMoveBtnText}>Down</Text>
                                          </Pressable>
                                        )}
                                        {adjacentBlocks.length > 0 && (
                                          adjacentBlocks.slice(0, 3).map((ab) => (
                                            <Pressable key={ab.index} style={s.moveMoveBtn} onPress={() => moveMovementToBlock(bi, mi, ab.index)}>
                                              <Icon name="arrow-right" size={12} color="#A78BFA" />
                                              <Text style={s.moveMoveBtnText} numberOfLines={1}>→ {ab.label}</Text>
                                            </Pressable>
                                          ))
                                        )}
                                      </View>
                                    </View>
                                  )}
                                </View>
                              );
                            })}

                            {/* Add movement picker */}
                            {addingMovementToBlock === bi ? (
                              <View style={s.movementPicker}>
                                <TextInput
                                  style={s.movementSearchInput}
                                  value={movementSearch}
                                  onChangeText={setMovementSearch}
                                  placeholder="Search movements..."
                                  placeholderTextColor="#4A5568"
                                  autoFocus
                                />
                                {movementCategories.length > 1 && (
                                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 34, marginBottom: 6 }}>
                                    <Pressable
                                      style={[s.catChip, !movementCategoryFilter && s.catChipActive]}
                                      onPress={() => setMovementCategoryFilter(null)}
                                    >
                                      <Text style={[s.catChipText, !movementCategoryFilter && s.catChipTextActive]}>All</Text>
                                    </Pressable>
                                    {movementCategories.map(cat => (
                                      <Pressable
                                        key={cat}
                                        style={[s.catChip, movementCategoryFilter === cat && s.catChipActive]}
                                        onPress={() => setMovementCategoryFilter(prev => prev === cat ? null : cat)}
                                      >
                                        <Text style={[s.catChipText, movementCategoryFilter === cat && s.catChipTextActive]}>{cat}</Text>
                                      </Pressable>
                                    ))}
                                  </ScrollView>
                                )}
                                <ScrollView style={s.movementPickerList} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                                  {filteredMovements.length === 0 ? (
                                    <Text style={s.movementPickerEmpty}>
                                      {availableMovements.length === 0 ? 'No movements yet. Create some first.' : 'No matches.'}
                                    </Text>
                                  ) : (
                                    filteredMovements.slice(0, 20).map((m) => (
                                      <Pressable key={m.id} style={s.movementPickerItem} onPress={() => addMovementToBlock(bi, m)}>
                                        <View style={s.movementThumb}>
                                          <Icon name={m.mediaUrl || m.videoUrl ? 'play' : 'activity'} size={14} color={m.mediaUrl || m.videoUrl ? '#F5A623' : '#4A5568'} />
                                        </View>
                                        <View style={{ flex: 1 }}>
                                          <Text style={s.movementPickerName}>{m.name}</Text>
                                          {m.category ? <Text style={s.movementPickerCat}>{m.category}</Text> : null}
                                        </View>
                                      </Pressable>
                                    ))
                                  )}
                                </ScrollView>
                                <Pressable style={s.movementPickerCancel} onPress={() => { setAddingMovementToBlock(null); setMovementSearch(''); }}>
                                  <Text style={s.movementPickerCancelText}>Cancel</Text>
                                </Pressable>
                              </View>
                            ) : (
                              <Pressable style={s.addMovementBtn} onPress={() => handleOpenMovementPicker(bi)}>
                                <Icon name="add" size={14} color="#7DD3FC" />
                                <Text style={s.addMovementBtnText}>Add Movement</Text>
                              </Pressable>
                            )}
                          </>
                        )}
                      </View>
                    </View>
                  </ScaleDecorator>
                );
              }}
            />

            {/* Bottom inserter — between last block and the add button */}
            {blocks.length > 0 && (
              <View style={s.inserterRow}>
                <View style={s.inserterLine} />
                <TouchableOpacity
                  style={s.inserterBtn}
                  onPress={() => { setInsertAtIndex(null); setShowBlockTypePicker(true); }}
                >
                  <Icon name="add" size={14} color="#4A5568" />
                </TouchableOpacity>
                {QUICK_INSERT_TYPES.map((qt) => (
                  <TouchableOpacity
                    key={qt}
                    style={s.quickInsertChip}
                    onPress={() => addBlock(qt, null)}
                  >
                    <Text style={[s.quickInsertText, { color: blockColor(qt) }]}>
                      {qt === 'Water Break' ? '💧' : qt === 'Transition' ? '→' : '⏸'}
                    </Text>
                  </TouchableOpacity>
                ))}
                <View style={s.inserterLine} />
              </View>
            )}

            {/* Main add block button */}
            <TouchableOpacity
              style={s.addBlockMainBtn}
              onPress={() => { setInsertAtIndex(null); setShowBlockTypePicker(true); }}
            >
              <Icon name="add" size={20} color="#F5A623" />
              <Text style={s.addBlockMainBtnText}>Add Block</Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>

          {/* Footer */}
          <View style={s.footer}>
            <TouchableOpacity style={s.cancelBtn} onPress={onClose}>
              <Text style={s.cancelBtnText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.saveBtn, submitting && s.saveBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              <Text style={s.saveBtnText}>
                {submitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Workout'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Toast banner */}
          {toastMessage && (
            <View style={s.toast}>
              <Text style={s.toastText}>{toastMessage}</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>

    {/* ── Block Type Picker Modal ──────────────────────────────────── */}
    <Modal visible={showBlockTypePicker} transparent animationType="fade">
      <Pressable style={s.pickerOverlay} onPress={() => { setShowBlockTypePicker(false); setInsertAtIndex(null); }}>
        <Pressable style={s.pickerSheet} onPress={(e) => e.stopPropagation()}>
          <Text style={s.pickerTitle}>Add Block</Text>
          <Text style={s.pickerSubtitle}>Exercise Blocks</Text>
          <View style={s.pickerGrid}>
            {EXERCISE_BLOCK_TYPES.map((type) => (
              <TouchableOpacity
                key={type}
                style={[s.pickerChip, { borderColor: blockColor(type) }]}
                onPress={() => addBlock(type, insertAtIndex)}
              >
                <View style={[s.pickerChipDot, { backgroundColor: blockColor(type) }]} />
                <Text style={[s.pickerChipText, { color: blockColor(type) }]}>{type}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.pickerSubtitle}>Special Blocks</Text>
          <View style={s.pickerGrid}>
            {SPECIAL_BLOCK_TYPES.map((type) => (
              <TouchableOpacity
                key={type}
                style={[s.pickerChip, { borderColor: blockColor(type) }]}
                onPress={() => addBlock(type, insertAtIndex)}
              >
                <View style={[s.pickerChipDot, { backgroundColor: blockColor(type) }]} />
                <Text style={[s.pickerChipText, { color: blockColor(type) }]}>{type}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>

    {/* ── Global Timing Modal ────────────────────────────────────── */}
    <Modal visible={showGlobalTiming} transparent animationType="fade">
      <Pressable style={s.pickerOverlay} onPress={() => setShowGlobalTiming(false)}>
        <Pressable style={s.pickerSheet} onPress={(e) => e.stopPropagation()}>
          <Text style={s.pickerTitle}>Global Timing</Text>
          <Text style={[s.pickerSubtitle, { marginTop: 0 }]}>Apply to all exercise blocks</Text>

          <View style={s.globalTimingGrid}>
            <View style={s.globalTimingItem}>
              <Text style={s.blockSettingLabel}>Work (sec)</Text>
              <TextInput
                style={s.blockSettingInput}
                value={globalWorkSec}
                onChangeText={setGlobalWorkSec}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
            <View style={s.globalTimingItem}>
              <Text style={s.blockSettingLabel}>Rest (sec)</Text>
              <TextInput
                style={s.blockSettingInput}
                value={globalRestSec}
                onChangeText={setGlobalRestSec}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
            <View style={s.globalTimingItem}>
              <Text style={s.blockSettingLabel}>Rounds</Text>
              <TextInput
                style={s.blockSettingInput}
                value={globalRounds}
                onChangeText={setGlobalRounds}
                keyboardType="number-pad"
                maxLength={2}
              />
            </View>
            <View style={s.globalTimingItem}>
              <Text style={s.blockSettingLabel}>Prep (sec)</Text>
              <TextInput
                style={s.blockSettingInput}
                value={globalPrepSec}
                onChangeText={setGlobalPrepSec}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
          </View>

          <TouchableOpacity style={[s.saveBtn, { marginTop: 16, alignSelf: 'stretch' }]} onPress={applyGlobalTiming}>
            <Text style={[s.saveBtnText, { textAlign: 'center' }]}>Apply to All Blocks</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>

    {/* ── Details Sheet Modal ─────────────────────────────────────── */}
    <Modal visible={showDetails} transparent animationType="slide">
      <View style={s.overlay}>
        <View style={s.detailsSheet}>
          <View style={s.handle} />
          <View style={s.header}>
            <Text style={s.headerTitle}>Workout Details</Text>
            <TouchableOpacity onPress={() => setShowDetails(false)} hitSlop={8}>
              <Icon name="close" size={22} color="#8A95A3" />
            </TouchableOpacity>
          </View>
          <ScrollView style={s.body} contentContainerStyle={s.detailsContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={s.label}>Description</Text>
            <TextInput style={[s.input, s.textArea]} value={description} onChangeText={setDescription} placeholder="Brief overview..." placeholderTextColor="#4A5568" multiline numberOfLines={3} />

            <Text style={s.label}>Category</Text>
            <View style={s.chipRow}>
              {CATEGORIES.map((cat) => (
                <Pressable key={cat} style={[s.chip, category === cat && s.chipActive]} onPress={() => setCategory(category === cat ? '' : cat)}>
                  <Text style={[s.chipText, category === cat && s.chipTextActive]}>{cat}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.label}>Difficulty</Text>
            <View style={s.chipRow}>
              {DIFFICULTIES.map((d) => (
                <Pressable key={d} style={[s.chip, difficulty === d && s.chipActive]} onPress={() => setDifficulty(difficulty === d ? '' : d)}>
                  <Text style={[s.chipText, difficulty === d && s.chipTextActive]}>{d}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={s.label}>Duration (min)</Text>
            <TextInput style={[s.input, s.shortInput]} value={estimatedDurationMin} onChangeText={(t) => setEstimatedDurationMin(t.replace(/[^0-9]/g, ''))} placeholder={autoDurationMin > 0 ? `Auto: ${autoDurationMin}` : 'e.g. 30'} placeholderTextColor="#4A5568" keyboardType="number-pad" maxLength={3} />

            <Text style={s.label}>Tags</Text>
            <View style={s.chipRow}>
              {TAG_PRESETS.map((tag) => (
                <Pressable key={tag} style={[s.chip, selectedTags.includes(tag) && s.chipActive]} onPress={() => toggleTag(tag)}>
                  <Text style={[s.chipText, selectedTags.includes(tag) && s.chipTextActive]}>{tag}</Text>
                </Pressable>
              ))}
            </View>
            <View style={s.customTagRow}>
              <TextInput style={[s.input, s.customTagInput]} value={customTag} onChangeText={setCustomTag} placeholder="Add custom tag..." placeholderTextColor="#4A5568" onSubmitEditing={addCustomTag} returnKeyType="done" />
              {customTag.trim().length > 0 && (
                <Pressable style={s.addTagBtn} onPress={addCustomTag}>
                  <Text style={s.addTagBtnText}>Add</Text>
                </Pressable>
              )}
            </View>
            {selectedTags.filter((t) => !TAG_PRESETS.includes(t)).length > 0 && (
              <View style={s.chipRow}>
                {selectedTags.filter((t) => !TAG_PRESETS.includes(t)).map((tag) => (
                  <Pressable key={tag} style={[s.chip, s.chipActive]} onPress={() => toggleTag(tag)}>
                    <Text style={[s.chipText, s.chipTextActive]}>{tag} ✕</Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Template toggle */}
            <View style={s.templateRow}>
              <View style={s.templateInfo}>
                <Text style={s.templateLabel}>Save as Template</Text>
                <Text style={s.templateHint}>Templates can be reused and assigned to multiple members</Text>
              </View>
              <Pressable style={[s.toggle, isTemplate && s.toggleActive]} onPress={() => setIsTemplate(!isTemplate)}>
                <View style={[s.toggleKnob, isTemplate && s.toggleKnobActive]} />
              </Pressable>
            </View>

            {/* Load from template */}
            {!isEdit && (
              <TouchableOpacity style={s.templateBtn} onPress={() => { loadTemplates(); setShowTemplatePicker(true); }}>
                <Icon name="copy" size={14} color="#F5A623" />
                <Text style={s.templateBtnText}>Load from Template</Text>
              </TouchableOpacity>
            )}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>

    {/* ── Template Picker Modal ───────────────────────────────────── */}
    <Modal visible={showTemplatePicker} transparent animationType="slide">
      <View style={s.overlay}>
        <View style={s.detailsSheet}>
          <View style={s.header}>
            <Text style={s.headerTitle}>Load from Template</Text>
            <TouchableOpacity onPress={() => setShowTemplatePicker(false)}>
              <Icon name="close" size={22} color="#8A95A3" />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {templatesLoading && <Text style={s.templatePickerHint}>Loading templates...</Text>}
            {templatesError && (
              <View style={{ alignItems: 'center', padding: 20 }}>
                <Text style={[s.templatePickerHint, { color: '#E53E3E' }]}>{templatesError}</Text>
                <TouchableOpacity onPress={loadTemplates} style={{ marginTop: 8 }}>
                  <Text style={{ color: '#F5A623', fontSize: 14, fontFamily: FB }}>Retry</Text>
                </TouchableOpacity>
              </View>
            )}
            {!templatesLoading && !templatesError && templates.length === 0 && (
              <View style={{ alignItems: 'center', padding: 30 }}>
                <Icon name="file-plus" size={40} color="#4A5568" />
                <Text style={[s.templatePickerHint, { marginTop: 12 }]}>No templates yet</Text>
              </View>
            )}
            {availableCategories.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8, maxHeight: 36, paddingHorizontal: 16 }}>
                {availableCategories.map((cat) => (
                  <TouchableOpacity key={cat} onPress={() => setCategoryFilter(cat)} style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: categoryFilter === cat ? '#F5A623' : '#1A1F2E', marginRight: 6, borderWidth: 1, borderColor: categoryFilter === cat ? '#F5A623' : '#252B3B' }}>
                    <Text style={{ fontSize: 12, fontFamily: FB, color: categoryFilter === cat ? '#0E1117' : '#8A95A3' }}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
            {filteredTemplates.map((t) => (
              <TouchableOpacity key={t.id} style={s.templatePickerItem} onPress={() => loadFromTemplate(t)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.templatePickerName}>{t.name}</Text>
                  <Text style={s.templatePickerMeta}>
                    {t.category || 'No category'} · {t.difficulty || 'Any'} · {t.blocks?.length ?? 0} blocks
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    overflow: "hidden" as const,
    borderTopRightRadius: 24,
    maxHeight: '95%',
    flex: 1,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    borderBottomWidth: 0,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#2A3347',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    flex: 1,
  },
  headerBtn: {
    padding: 8,
    marginLeft: 12,
  },
  nameInput: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    padding: 0,
  },
  durationHint: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
    marginTop: 2,
  },
  body: {
    flex: 1,
  },
  canvasContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },

  // ── Empty state ─────────────────────────────────────────────────────
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  emptyHint: {
    fontSize: 14,
    color: '#4A5568',
    fontFamily: FB,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  templateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F5A623',
    borderStyle: 'dashed',
    marginTop: 12,
  },
  templateBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FB,
  },

  // ── Between-block inserter ──────────────────────────────────────────
  inserterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 6,
  },
  inserterLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1E2A3A',
  },
  inserterBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#1E2A3A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickInsertChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  quickInsertText: {
    fontSize: 11,
    fontFamily: FB,
  },

  // ── Block card ──────────────────────────────────────────────────────
  blockCard: {
    backgroundColor: '#0E1117',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    padding: 12,
    gap: 8,
  },
  blockCardDragging: {
    borderColor: 'rgba(245,166,35,0.4)',
    shadowColor: '#F5A623',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 8,
  },
  dragHandle: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  blockTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  blockTypeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: FH,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  blockLabelInput: {
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
    padding: 0,
  },
  roundsBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  roundsBadgeText: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FH,
  },

  // ── Block settings ──────────────────────────────────────────────────
  blockSettingsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: '#1E2A3A',
    flexWrap: 'wrap',
  },
  blockSettingItem: {
    gap: 4,
  },
  blockSettingLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  blockSettingHint: {
    fontSize: 9,
    color: '#4A5568',
    fontFamily: FB,
    fontStyle: 'italic',
  },
  blockSettingInput: {
    backgroundColor: '#161B22',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
    borderWidth: 1,
    borderColor: '#2A3347',
    width: 60,
    textAlign: 'center',
  },

  // ── Special block content ───────────────────────────────────────────
  specialBlockContent: {
    gap: 8,
    paddingTop: 4,
  },
  instructionInput: {
    backgroundColor: '#161B22',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#F0F4F8',
    fontFamily: FB,
    borderWidth: 1,
    borderColor: '#2A3347',
    minHeight: 48,
    textAlignVertical: 'top',
  },

  // ── Movement rows ───────────────────────────────────────────────────
  movementRow: {
    backgroundColor: '#161B22',
    borderRadius: 8,
    padding: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  movementMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  movementThumbImg: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: '#0E1117',
  },
  movementInfo: {
    flex: 1,
    gap: 4,
  },
  movementName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  movementFields: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexWrap: 'wrap',
  },
  movementFieldInput: {
    backgroundColor: '#0E1117',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
    fontSize: 12,
    color: '#F0F4F8',
    fontFamily: FB,
    borderWidth: 1,
    borderColor: '#2A3347',
    width: 44,
    textAlign: 'center',
  },
  movementFieldAutoRest: {
    borderColor: '#2A3347',
    borderStyle: 'dashed' as const,
  },
  movementFieldSep: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
  },
  movementActions: {
    gap: 8,
    alignItems: 'center',
  },
  movementExpanded: {
    gap: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#2A3347',
  },
  coachingCuesInput: {
    backgroundColor: '#0E1117',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
    color: '#F0F4F8',
    fontFamily: FB,
    borderWidth: 1,
    borderColor: '#2A3347',
    minHeight: 36,
    textAlignVertical: 'top',
  },
  movementMoveRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  moveMoveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#0E1117',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  moveMoveBtnText: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
    maxWidth: 80,
  },
  addMovementBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.2)',
    borderStyle: 'dashed',
  },
  addMovementBtnText: {
    fontSize: 13,
    color: '#7DD3FC',
    fontFamily: FB,
    fontWeight: '500',
  },

  // ── Movement picker ─────────────────────────────────────────────────
  catChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#1E2A3A',
    borderRadius: 14,
    marginRight: 6,
  },
  catChipActive: {
    backgroundColor: '#F5A623',
  },
  catChipText: {
    fontSize: 11,
    color: '#8A95A3',
    fontWeight: '600',
  },
  catChipTextActive: {
    color: '#0E1117',
  },
  movementPicker: {
    backgroundColor: '#161B22',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A3347',
    padding: 10,
    gap: 8,
  },
  movementSearchInput: {
    backgroundColor: '#0E1117',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#F0F4F8',
    fontFamily: FB,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  movementPickerList: {
    maxHeight: 160,
  },
  movementPickerEmpty: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
    textAlign: 'center',
    paddingVertical: 12,
  },
  movementThumb: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: 'rgba(245,166,35,0.15)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginRight: 10,
  },
  movementPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  movementPickerName: {
    fontSize: 13,
    color: '#F0F4F8',
    fontFamily: FB,
    fontWeight: '500',
  },
  movementPickerCat: {
    fontSize: 11,
    color: '#4A5568',
    fontFamily: FB,
  },
  movementPickerCancel: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  movementPickerCancelText: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },

  // ── Add block main button ───────────────────────────────────────────
  addBlockMainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(245,166,35,0.3)',
    borderStyle: 'dashed',
    backgroundColor: 'rgba(245,166,35,0.04)',
    marginTop: 8,
  },
  addBlockMainBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
  },

  // ── Block type picker modal ─────────────────────────────────────────
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  pickerSheet: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 16,
    textAlign: 'center',
  },
  pickerSubtitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A5568',
    fontFamily: FB,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 12,
  },
  pickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pickerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#161B22',
    borderWidth: 1,
  },
  pickerChipDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  pickerChipText: {
    fontSize: 13,
    fontFamily: FB,
    fontWeight: '500',
  },

  // ── Global timing modal ─────────────────────────────────────────────
  globalTimingGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 16,
    justifyContent: 'center',
  },
  globalTimingItem: {
    alignItems: 'center',
    gap: 6,
  },

  // ── Details sheet ───────────────────────────────────────────────────
  detailsSheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    borderWidth: 1,
    borderColor: '#1E2A3A',
    borderBottomWidth: 0,
    flex: 1,
  },
  detailsContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#F0F4F8',
    fontFamily: FB,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  shortInput: {
    width: 120,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
  },
  chipTextActive: {
    color: '#F5A623',
    fontWeight: '600',
  },
  customTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  customTagInput: {
    flex: 1,
    marginTop: 0,
  },
  addTagBtn: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  addTagBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FB,
  },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: '#161B22',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  templateInfo: {
    flex: 1,
    marginRight: 12,
  },
  templateLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  templateHint: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
    marginTop: 2,
  },
  toggle: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2A3347',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleActive: {
    backgroundColor: 'rgba(167,139,250,0.3)',
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#4A5568',
  },
  toggleKnobActive: {
    backgroundColor: '#A78BFA',
    alignSelf: 'flex-end',
  },

  // ── Template picker ─────────────────────────────────────────────────
  templatePickerHint: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    textAlign: 'center',
    paddingVertical: 24,
  },
  templatePickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  templatePickerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E2E8F0',
    fontFamily: FH,
  },
  templatePickerMeta: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },

  // ── Footer ──────────────────────────────────────────────────────────
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#1E2A3A',
  },
  cancelBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  cancelBtnText: {
    fontSize: 15,
    color: '#8A95A3',
    fontFamily: FB,
  },
  saveBtn: {
    backgroundColor: '#F5A623',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 10,
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },

  // ── Toast ──────────────────────────────────────────────────────────
  toast: {
    position: 'absolute',
    bottom: 80,
    left: 20,
    right: 20,
    backgroundColor: '#34D399',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    zIndex: 999,
  },
  toastText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0E1117',
    fontFamily: FB,
  },
});
