/**
 * WorkoutForm — Create / Edit workout modal
 *
 * Captures workout metadata: name, description, category, difficulty,
 * estimated duration, tags, isTemplate toggle. Includes block builder
 * for adding workout blocks with movement references.
 *
 * Writes coachId + tenantId on creation. Edit mode pre-populates all
 * fields and uses updateDoc.
 *
 * Follows GoArrive design system: #0E1117 bg, #F5A623 gold accent,
 * Space Grotesk headings, DM Sans body.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { Icon } from './Icon';
import { useWorkoutTemplates, WorkoutTemplate } from '../hooks/useWorkoutTemplates';

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

// ── Constants ────────────────────────────────────────────────────────────────
const CATEGORIES = [
  'Upper Body',
  'Lower Body',
  'Full Body',
  'Core',
  'Cardio',
  'Mobility',
  'Recovery',
];

const DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'];

const TAG_PRESETS = [
  'strength',
  'hypertrophy',
  'endurance',
  'HIIT',
  'circuit',
  'warm-up',
  'cool-down',
  '15min',
  '30min',
  '45min',
  '60min',
];

const BLOCK_TYPES = [
  'Warm-Up',
  'Circuit',
  'Superset',
  'Interval',
  'Strength',
  'Timed',
  'AMRAP',
  'EMOM',
  'Cool-Down',
  'Rest',
];

// ── Types ────────────────────────────────────────────────────────────────────
interface BlockMovement {
  movementId: string;
  movementName: string;
  sets?: number;
  reps?: string;
  durationSec?: number;
  restSec?: number;
  notes?: string;
}

interface WorkoutBlock {
  type: string;
  label: string;
  rounds?: number;
  restBetweenRoundsSec?: number;
  restBetweenMovementsSec?: number;
  movements: BlockMovement[];
}

interface MovementOption {
  id: string;
  name: string;
  category: string;
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
}

export default function WorkoutForm({
  visible,
  onClose,
  coachId,
  tenantId,
  editWorkout,
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

  // ── Template picker state ──────────────────────────────────────────────
  const {
    templates, loading: templatesLoading, error: templatesError,
    loadTemplates, renameTemplate, deleteTemplate, toggleShareTemplate,
  } = useWorkoutTemplates(coachId);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);

  // ── Movement picker state ──────────────────────────────────────────────
  const [availableMovements, setAvailableMovements] = useState<MovementOption[]>([]);
  const [movementsLoaded, setMovementsLoaded] = useState(false);
  const [addingMovementToBlock, setAddingMovementToBlock] = useState<number | null>(null);
  const [movementSearch, setMovementSearch] = useState('');

  // ── Load available movements for block builder ─────────────────────────
  const loadMovements = useCallback(async () => {
    if (movementsLoaded || !coachId) return;
    try {
      // Load coach-scoped movements
      const coachQ = query(
        collection(db, 'movements'),
        where('coachId', '==', coachId),
        where('isArchived', '==', false),
        orderBy('name', 'asc'),
      );
      const coachSnap = await getDocs(coachQ);

      // Load global movements
      const globalQ = query(
        collection(db, 'movements'),
        where('isGlobal', '==', true),
        where('isArchived', '==', false),
        orderBy('name', 'asc'),
      );
      const globalSnap = await getDocs(globalQ);

      const seen = new Set<string>();
      const list: MovementOption[] = [];

      coachSnap.docs.forEach((d) => {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          const cd = d.data();
          list.push({ id: d.id, name: cd.name ?? '', category: cd.category ?? '', mediaUrl: cd.mediaUrl ?? null, videoUrl: cd.videoUrl ?? null });
        }
      });
      globalSnap.docs.forEach((d) => {
        if (!seen.has(d.id)) {
          seen.add(d.id);
          const gd = d.data();
          list.push({ id: d.id, name: gd.name ?? '', category: gd.category ?? '', mediaUrl: gd.mediaUrl ?? null, videoUrl: gd.videoUrl ?? null });
        }
      });

      setAvailableMovements(list);
      setMovementsLoaded(true);
    } catch (err) {
      console.error('[WorkoutForm] Load movements error:', err);
    }
  }, [coachId, movementsLoaded]);

  // Suggestion 9: Lazy-load movements only when user first taps "Add Movement"
  // (removed eager load on visible — now triggered by handleOpenMovementPicker)
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
      setEstimatedDurationMin(
        editWorkout.estimatedDurationMin
          ? String(editWorkout.estimatedDurationMin)
          : '',
      );
      setSelectedTags(editWorkout.tags ?? []);
      setIsTemplate(editWorkout.isTemplate ?? false);
      setBlocks(
        (editWorkout.blocks ?? []).map((b: any) => ({
          type: b.type ?? 'Circuit',
          label: b.label ?? '',
          rounds: b.rounds ?? 1,
          restBetweenRoundsSec: b.restBetweenRoundsSec ?? 0,
          movements: (b.movements ?? []).map((m: any) => ({
            movementId: m.movementId ?? '',
            movementName: m.movementName ?? '',
            sets: m.sets ?? undefined,
            reps: m.reps ?? undefined,
            durationSec: m.durationSec ?? undefined,
            restSec: m.restSec ?? undefined,
            notes: m.notes ?? undefined,
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
  };

  // ── Template loader ──────────────────────────────────────────────────
  const loadFromTemplate = (t: WorkoutTemplate) => {
    setName(t.name + ' (Copy)');
    setDescription(t.description);
    setCategory(t.category);
    setDifficulty(t.difficulty);
    setEstimatedDurationMin(t.estimatedDurationMin ? String(t.estimatedDurationMin) : '');
    setSelectedTags(t.tags || []);
    setBlocks(t.blocks || []);
    setIsTemplate(false); // Copy is not a template by default
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
    if (trimmed && !selectedTags.includes(trimmed)) {
      setSelectedTags((prev) => [...prev, trimmed]);
    }
    setCustomTag('');
  };

  // ── Block helpers ──────────────────────────────────────────────────────
  const addBlock = (type: string) => {
    setBlocks((prev) => [
      ...prev,
      {
        type,
        label: `${type} ${prev.length + 1}`,
        rounds: 1,
        restBetweenRoundsSec: 0,
        movements: [],
      },
    ]);
  };

  const removeBlock = (index: number) => {
    setBlocks((prev) => prev.filter((_, i) => i !== index));
  };

  const onDragEnd = ({ data }: { data: WorkoutBlock[] }) => {
    setBlocks(data);
  };

  const updateBlockField = (index: number, field: string, value: any) => {
    setBlocks((prev) =>
      prev.map((b, i) => (i === index ? { ...b, [field]: value } : b)),
    );
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

  const updateMovementField = (
    blockIndex: number,
    movementIndex: number,
    field: string,
    value: any,
  ) => {
    setBlocks((prev) =>
      prev.map((b, i) =>
        i === blockIndex
          ? {
              ...b,
              movements: b.movements.map((m, mi) =>
                mi === movementIndex ? { ...m, [field]: value } : m,
              ),
            }
          : b,
      ),
    );
  };

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a workout name.');
      return;
    }

    setSubmitting(true);
    try {
      // Clean blocks for Firestore (remove undefined values)
      const cleanBlocks = blocks.map((b) => ({
        type: b.type,
        label: b.label,
        rounds: b.rounds ?? 1,
        restBetweenRoundsSec: b.restBetweenRoundsSec ?? 0,
        movements: b.movements.map((m) => {
          const clean: any = {
            movementId: m.movementId,
            movementName: m.movementName,
          };
          if (m.sets) clean.sets = m.sets;
          if (m.reps) clean.reps = m.reps;
          if (m.durationSec) clean.durationSec = m.durationSec;
          if (m.restSec) clean.restSec = m.restSec;
          if (m.notes) clean.notes = m.notes;
          return clean;
        }),
      }));

      if (isEdit) {
        await updateDoc(doc(db, 'workouts', editWorkout.id), {
          name: name.trim(),
          description: description.trim(),
          category,
          difficulty,
          estimatedDurationMin: estimatedDurationMin
            ? parseInt(estimatedDurationMin, 10)
            : null,
          tags: selectedTags,
          isTemplate,
          blocks: cleanBlocks,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, 'workouts'), {
          name: name.trim(),
          description: description.trim(),
          category,
          difficulty,
          estimatedDurationMin: estimatedDurationMin
            ? parseInt(estimatedDurationMin, 10)
            : null,
          tags: selectedTags,
          isTemplate,
          blocks: cleanBlocks,
          coachId,
          tenantId,
          isArchived: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      resetForm();
      onClose();
    } catch (error) {
      console.error('[WorkoutForm] Save error:', error);
      Alert.alert('Error', 'Could not save workout. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Filtered movements for picker ──────────────────────────────────────
  const filteredMovements = movementSearch.trim()
    ? availableMovements.filter((m) =>
        m.name.toLowerCase().includes(movementSearch.toLowerCase()),
      )
    : availableMovements;

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={s.overlay}>
        <View style={s.sheet}>
          {/* Handle */}
          <View style={s.handle} />

          {/* Header */}
          <View style={s.header}>
            <Text style={s.headerTitle}>
              {isEdit ? 'Edit Workout' : 'New Workout'}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon name="close" size={22} color="#8A95A3" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={s.body}
            contentContainerStyle={s.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Workout Name */}
            <Text style={s.label}>
              Workout Name <Text style={s.required}>*</Text>
            </Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Upper Body Power Day"
              placeholderTextColor="#4A5568"
            />

            {/* Description */}
            <Text style={s.label}>Description</Text>
            <TextInput
              style={[s.input, s.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Brief overview of the workout..."
              placeholderTextColor="#4A5568"
              multiline
              numberOfLines={3}
            />

            {/* Category */}
            <Text style={s.label}>Category</Text>
            <View style={s.chipRow}>
              {CATEGORIES.map((cat) => {
                const active = category === cat;
                return (
                  <Pressable
                    key={cat}
                    style={[s.chip, active && s.chipActive]}
                    onPress={() => setCategory(active ? '' : cat)}
                  >
                    <Text style={[s.chipText, active && s.chipTextActive]}>
                      {cat}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Difficulty */}
            <Text style={s.label}>Difficulty</Text>
            <View style={s.chipRow}>
              {DIFFICULTIES.map((d) => {
                const active = difficulty === d;
                return (
                  <Pressable
                    key={d}
                    style={[s.chip, active && s.chipActive]}
                    onPress={() => setDifficulty(active ? '' : d)}
                  >
                    <Text style={[s.chipText, active && s.chipTextActive]}>
                      {d}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Estimated Duration */}
            <Text style={s.label}>Estimated Duration (minutes)</Text>
            <TextInput
              style={[s.input, s.shortInput]}
              value={estimatedDurationMin}
              onChangeText={(t) =>
                setEstimatedDurationMin(t.replace(/[^0-9]/g, ''))
              }
              placeholder="e.g. 30"
              placeholderTextColor="#4A5568"
              keyboardType="number-pad"
              maxLength={3}
            />

            {/* Load from Template button */}
            {!isEdit && (
              <TouchableOpacity
                style={s.loadTemplateBtn}
                onPress={() => {
                  loadTemplates();
                  setShowTemplatePicker(true);
                }}
              >
                <Icon name="copy" size={16} color="#F5A623" />
                <Text style={s.loadTemplateBtnText}>Load from Template</Text>
              </TouchableOpacity>
            )}

            {/* Template toggle (suggestion 6) */}
            <View style={s.templateRow}>
              <View style={s.templateInfo}>
                <Text style={s.templateLabel}>Save as Template</Text>
                <Text style={s.templateHint}>
                  Templates can be reused and assigned to multiple members
                </Text>
              </View>
              <Pressable
                style={[s.toggle, isTemplate && s.toggleActive]}
                onPress={() => setIsTemplate(!isTemplate)}
              >
                <View
                  style={[s.toggleKnob, isTemplate && s.toggleKnobActive]}
                />
              </Pressable>
            </View>

            {/* Tags */}
            <Text style={s.label}>Tags</Text>
            <View style={s.chipRow}>
              {TAG_PRESETS.map((tag) => {
                const active = selectedTags.includes(tag);
                return (
                  <Pressable
                    key={tag}
                    style={[s.chip, active && s.chipActive]}
                    onPress={() => toggleTag(tag)}
                  >
                    <Text style={[s.chipText, active && s.chipTextActive]}>
                      {tag}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {/* Custom tag input */}
            <View style={s.customTagRow}>
              <TextInput
                style={[s.input, s.customTagInput]}
                value={customTag}
                onChangeText={setCustomTag}
                placeholder="Add custom tag..."
                placeholderTextColor="#4A5568"
                onSubmitEditing={addCustomTag}
                returnKeyType="done"
              />
              {customTag.trim().length > 0 && (
                <Pressable style={s.addTagBtn} onPress={addCustomTag}>
                  <Text style={s.addTagBtnText}>Add</Text>
                </Pressable>
              )}
            </View>
            {/* Show selected custom tags (not in presets) */}
            {selectedTags.filter((t) => !TAG_PRESETS.includes(t)).length >
              0 && (
              <View style={s.chipRow}>
                {selectedTags
                  .filter((t) => !TAG_PRESETS.includes(t))
                  .map((tag) => (
                    <Pressable
                      key={tag}
                      style={[s.chip, s.chipActive]}
                      onPress={() => toggleTag(tag)}
                    >
                      <Text style={[s.chipText, s.chipTextActive]}>
                        {tag} ✕
                      </Text>
                    </Pressable>
                  ))}
              </View>
            )}

            {/* ── Block Builder (suggestion 3) ──────────────────────────── */}
            <View style={s.blockSection}>
              <Text style={s.blockSectionTitle}>
                Workout Blocks ({blocks.length})
              </Text>
              <Text style={s.blockSectionHint}>
                Add blocks to structure the workout. Each block can contain
                movements from your library.
              </Text>

              {/* Draggable block list */}
              <DraggableFlatList
                data={blocks}
                keyExtractor={(_, index) => `block-${index}`}
                onDragEnd={onDragEnd}
                scrollEnabled={false}
                containerStyle={{ gap: 12 }}
                renderItem={({ item: block, drag, isActive, getIndex }: RenderItemParams<WorkoutBlock>) => {
                  const bi = getIndex() ?? 0;
                  return (
                    <ScaleDecorator>
                      <View style={[s.blockCard, isActive && s.blockCardDragging]}>
                        {/* Block header */}
                        <View style={s.blockHeader}>
                          {/* Drag handle */}
                          <Pressable onLongPress={drag} style={s.dragHandle}>
                            <Icon name="more-vertical" size={18} color={isActive ? '#F5A623' : '#4A5568'} />
                          </Pressable>
                          <View style={s.blockIndexCircle}>
                            <Text style={s.blockIndexText}>{bi + 1}</Text>
                          </View>
                          <View style={s.blockHeaderInfo}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              <View style={[
                                s.blockTypeBadge,
                                block.type === 'Superset' && s.blockTypeBadgeSuperset,
                                block.type === 'Circuit' && s.blockTypeBadgeCircuit,
                                block.type === 'AMRAP' && s.blockTypeBadgeCircuit,
                              ]}>
                                <Text style={[
                                  s.blockTypeBadgeText,
                                  block.type === 'Superset' && { color: '#F59E0B' },
                                  (block.type === 'Circuit' || block.type === 'AMRAP') && { color: '#34D399' },
                                ]}>{block.type}</Text>
                              </View>
                              {block.type === 'Superset' && block.movements.length >= 2 && (
                                <Text style={s.blockPatternHint}>
                                  {block.movements.map((_, i) => `A${i + 1}`).join(' ↔ ')}
                                </Text>
                              )}
                              {block.type === 'Circuit' && block.movements.length >= 2 && (
                                <Text style={s.blockPatternHint}>
                                  {block.movements.length} movements → {block.rounds ?? 1}x
                                </Text>
                              )}
                            </View>
                            <TextInput
                              style={s.blockLabelInput}
                              value={block.label}
                              onChangeText={(t) => updateBlockField(bi, 'label', t)}
                              placeholder="Block label..."
                              placeholderTextColor="#4A5568"
                            />
                          </View>
                          <Pressable
                            onPress={() => removeBlock(bi)}
                            hitSlop={6}
                          >
                            <Icon name="close" size={16} color="#EF4444" />
                          </Pressable>
                        </View>

                        {/* Block settings row */}
                        <View style={s.blockSettingsRow}>
                          <View style={s.blockSettingItem}>
                            <Text style={s.blockSettingLabel}>Rounds</Text>
                            <TextInput
                              style={s.blockSettingInput}
                              value={String(block.rounds ?? 1)}
                              onChangeText={(t) =>
                                updateBlockField(
                                  bi,
                                  'rounds',
                                  parseInt(t.replace(/[^0-9]/g, ''), 10) || 1,
                                )
                              }
                              keyboardType="number-pad"
                              maxLength={2}
                            />
                          </View>
                          <View style={s.blockSettingItem}>
                            <Text style={s.blockSettingLabel}>Rest (sec)</Text>
                            <TextInput
                              style={s.blockSettingInput}
                              value={String(block.restBetweenRoundsSec ?? 0)}
                              onChangeText={(t) =>
                                updateBlockField(
                                  bi,
                                  'restBetweenRoundsSec',
                                  parseInt(t.replace(/[^0-9]/g, ''), 10) || 0,
                                )
                              }
                              keyboardType="number-pad"
                              maxLength={3}
                            />
                          </View>
                          {(block.type === 'Superset' || block.type === 'Circuit') && (
                            <View style={s.blockSettingItem}>
                              <Text style={s.blockSettingLabel}>Transition (sec)</Text>
                              <TextInput
                                style={s.blockSettingInput}
                                value={String(block.restBetweenMovementsSec ?? 0)}
                                onChangeText={(t) =>
                                  updateBlockField(
                                    bi,
                                    'restBetweenMovementsSec',
                                    parseInt(t.replace(/[^0-9]/g, ''), 10) || 0,
                                  )
                                }
                                keyboardType="number-pad"
                                maxLength={3}
                                placeholder="0"
                                placeholderTextColor="#4A5568"
                              />
                            </View>
                          )}
                        </View>

                        {/* Movements in this block */}
                        {block.movements.map((mov, mi) => (
                          <View key={mi} style={s.movementRow}>
                            <View style={s.movementInfo}>
                              <Text style={s.movementName} numberOfLines={1}>
                                {mov.movementName}
                              </Text>
                              <View style={s.movementFields}>
                                <TextInput
                                  style={s.movementFieldInput}
                                  value={String(mov.sets ?? '')}
                                  onChangeText={(t) =>
                                    updateMovementField(
                                      bi,
                                      mi,
                                      'sets',
                                      parseInt(t.replace(/[^0-9]/g, ''), 10) || undefined,
                                    )
                                  }
                                  placeholder="Sets"
                                  placeholderTextColor="#4A5568"
                                  keyboardType="number-pad"
                                  maxLength={2}
                                />
                                <Text style={s.movementFieldSep}>×</Text>
                                <TextInput
                                  style={s.movementFieldInput}
                                  value={mov.reps ?? ''}
                                  onChangeText={(t) =>
                                    updateMovementField(bi, mi, 'reps', t)
                                  }
                                  placeholder="Reps"
                                  placeholderTextColor="#4A5568"
                                />
                              </View>
                              {/* Duration + Rest row */}
                              <View style={s.movementFields}>
                                <TextInput
                                  style={s.movementFieldInput}
                                  value={mov.durationSec ? String(mov.durationSec) : ''}
                                  onChangeText={(t) =>
                                    updateMovementField(
                                      bi,
                                      mi,
                                      'durationSec',
                                      parseInt(t.replace(/[^0-9]/g, ''), 10) || undefined,
                                    )
                                  }
                                  placeholder="Dur (s)"
                                  placeholderTextColor="#4A5568"
                                  keyboardType="number-pad"
                                  maxLength={3}
                                />
                                <Text style={s.movementFieldSep}>|</Text>
                                <TextInput
                                  style={s.movementFieldInput}
                                  value={mov.restSec ? String(mov.restSec) : ''}
                                  onChangeText={(t) =>
                                    updateMovementField(
                                      bi,
                                      mi,
                                      'restSec',
                                      parseInt(t.replace(/[^0-9]/g, ''), 10) || undefined,
                                    )
                                  }
                                  placeholder="Rest (s)"
                                  placeholderTextColor="#4A5568"
                                  keyboardType="number-pad"
                                  maxLength={3}
                                />
                              </View>
                              {/* Notes */}
                              <TextInput
                                style={[s.movementFieldInput, { width: '100%', marginTop: 4 }]}
                                value={mov.notes ?? ''}
                                onChangeText={(t) =>
                                  updateMovementField(bi, mi, 'notes', t)
                                }
                                placeholder="Coaching cues..."
                                placeholderTextColor="#4A5568"
                              />
                            </View>
                            <Pressable
                              onPress={() => removeMovementFromBlock(bi, mi)}
                              hitSlop={6}
                            >
                              <Icon name="close" size={14} color="#EF4444" />
                            </Pressable>
                          </View>
                        ))}

                        {/* Add movement to block */}
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
                            <ScrollView
                              style={s.movementPickerList}
                              nestedScrollEnabled
                              keyboardShouldPersistTaps="handled"
                            >
                              {filteredMovements.length === 0 ? (
                                <Text style={s.movementPickerEmpty}>
                                  {availableMovements.length === 0
                                    ? 'No movements in library. Create movements first.'
                                    : 'No movements match your search.'}
                                </Text>
                              ) : (
                                filteredMovements.slice(0, 20).map((m) => (
                                  <Pressable
                                    key={m.id}
                                    style={s.movementPickerItem}
                                    onPress={() => addMovementToBlock(bi, m)}
                                  >
                                    {/* Suggestion 3: Media thumbnail */}
                                    {(m.mediaUrl || m.videoUrl) ? (
                                      <View style={s.movementThumb}>
                                        <Icon name="play" size={14} color="#F5A623" />
                                      </View>
                                    ) : (
                                      <View style={[s.movementThumb, { backgroundColor: '#1A1F2B' }]}>
                                        <Icon name="activity" size={14} color="#4A5568" />
                                      </View>
                                    )}
                                    <View style={{ flex: 1 }}>
                                      <Text style={s.movementPickerName}>
                                        {m.name}
                                      </Text>
                                      {m.category ? (
                                        <Text style={s.movementPickerCat}>
                                          {m.category}
                                        </Text>
                                      ) : null}
                                    </View>
                                  </Pressable>
                                ))
                              )}
                            </ScrollView>
                            <Pressable
                              style={s.movementPickerCancel}
                              onPress={() => {
                                setAddingMovementToBlock(null);
                                setMovementSearch('');
                              }}
                            >
                              <Text style={s.movementPickerCancelText}>Cancel</Text>
                            </Pressable>
                          </View>
                        ) : (
                          <Pressable
                            style={s.addMovementBtn}
                            onPress={() => handleOpenMovementPicker(bi)}
                          >
                            <Icon name="add" size={14} color="#7DD3FC" />
                            <Text style={s.addMovementBtnText}>Add Movement</Text>
                          </Pressable>
                        )}
                      </View>
                    </ScaleDecorator>
                  );
                }}
              />

              {/* Add block type selector */}
              <Text style={s.addBlockLabel}>Add Block</Text>
              <View style={s.chipRow}>
                {BLOCK_TYPES.map((type) => (
                  <Pressable
                    key={type}
                    style={s.blockTypeChip}
                    onPress={() => addBlock(type)}
                  >
                    <Icon name="add" size={12} color="#7DD3FC" />
                    <Text style={s.blockTypeChipText}>{type}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Spacer for keyboard */}
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
                {submitting
                  ? 'Saving...'
                  : isEdit
                  ? 'Save Changes'
                  : 'Create Workout'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>

      {/* Template picker modal */}
      <Modal visible={showTemplatePicker} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={[s.container, { maxHeight: 500 }]}>
            <View style={s.header}>
              <Text style={s.title}>Load from Template</Text>
              <TouchableOpacity onPress={() => setShowTemplatePicker(false)}>
                <Icon name="x" size={22} color="#8A95A3" />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }}>
              {templatesLoading && (
                <Text style={s.templatePickerHint}>Loading templates...</Text>
              )}
              {templatesError && (
                <View style={{ alignItems: 'center', padding: 20 }}>
                  <Icon name="alert-circle" size={32} color="#E53E3E" />
                  <Text style={[s.templatePickerHint, { color: '#E53E3E' }]}>
                    {templatesError}
                  </Text>
                  <TouchableOpacity onPress={loadTemplates} style={{ marginTop: 8 }}>
                    <Text style={{ color: '#F5A623', fontSize: 14, fontFamily: FB }}>Retry</Text>
                  </TouchableOpacity>
                </View>
              )}
              {!templatesLoading && !templatesError && templates.length === 0 && (
                <View style={{ alignItems: 'center', padding: 30 }}>
                  <Icon name="file-plus" size={40} color="#4A5568" />
                  <Text style={[s.templatePickerHint, { marginTop: 12 }]}>
                    No templates yet
                  </Text>
                  <Text style={[s.templatePickerMeta, { textAlign: 'center', marginTop: 4 }]}>
                    Create a workout and toggle "Save as Template" to build your library.
                  </Text>
                </View>
              )}
              {templates.map((t) => (
                <View key={t.id} style={s.templatePickerItem}>
                  <TouchableOpacity
                    style={{ flex: 1 }}
                    onPress={() => loadFromTemplate(t)}
                  >
                    <Text style={s.templatePickerName}>{t.name}</Text>
                    <Text style={s.templatePickerMeta}>
                      {t.category || 'No category'} · {t.difficulty || 'No difficulty'}
                      {t.blocks?.length ? ` · ${t.blocks.length} block${t.blocks.length !== 1 ? 's' : ''}` : ''}
                      {t.isShared ? ' · Shared' : ''}
                    </Text>
                  </TouchableOpacity>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <TouchableOpacity
                      onPress={() => {
                        const newName = Platform.OS === 'web'
                          ? window.prompt('Rename template:', t.name)
                          : null;
                        if (newName) renameTemplate(t.id, newName);
                        else if (Platform.OS !== 'web') {
                          Alert.prompt?.('Rename', 'Enter new name:', (name: string) => {
                            if (name) renameTemplate(t.id, name);
                          }, 'plain-text', t.name);
                        }
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name="edit-2" size={16} color="#8A95A3" />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => toggleShareTemplate(t.id, !t.isShared)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name={t.isShared ? 'globe' : 'lock'} size={16} color={t.isShared ? '#F5A623' : '#8A95A3'} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        if (Platform.OS === 'web') {
                          if (window.confirm(`Delete template "${t.name}"?`)) deleteTemplate(t.id);
                        } else {
                          Alert.alert('Delete Template', `Delete "${t.name}"?`, [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Delete', style: 'destructive', onPress: () => deleteTemplate(t.id) },
                          ]);
                        }
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Icon name="trash-2" size={16} color="#E53E3E" />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
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
    borderTopRightRadius: 24,
    maxHeight: '92%',
    borderWidth: 1,
    borderColor: '#1E2A3A',
    borderBottomWidth: 0,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#2A3347',
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
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
  required: {
    color: '#F5A623',
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

  // ── Template toggle ──────────────────────────────────────────────────
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

  // ── Block Builder ────────────────────────────────────────────────────
  blockSection: {
    marginTop: 24,
    gap: 12,
  },
  blockSectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  blockSectionHint: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FB,
    lineHeight: 18,
  },
  blockCard: {
    backgroundColor: '#0E1117',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    padding: 14,
    gap: 10,
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
    gap: 10,
  },
  blockIndexCircle: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: 'rgba(125,211,252,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockIndexText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#7DD3FC',
    fontFamily: FH,
  },
  blockHeaderInfo: {
    flex: 1,
    gap: 2,
  },
  blockType: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7DD3FC',
    fontFamily: FH,
  },
  blockTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(125,211,252,0.15)',
  },
  blockTypeBadgeSuperset: {
    backgroundColor: 'rgba(245,158,11,0.15)',
  },
  blockTypeBadgeCircuit: {
    backgroundColor: 'rgba(52,211,153,0.15)',
  },
  blockTypeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#7DD3FC',
    fontFamily: FH,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  blockPatternHint: {
    fontSize: 11,
    color: '#94A3B8',
    fontFamily: FB,
  },
  blockLabelInput: {
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
    padding: 0,
  },
  blockActions: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  blockSettingsRow: {
    flexDirection: 'row',
    gap: 16,
    paddingTop: 4,
  },
  blockSettingItem: {
    gap: 4,
  },
  blockSettingLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#4A5568',
    fontFamily: FB,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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

  // ── Movement rows within blocks ──────────────────────────────────────
  movementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#161B22',
    borderRadius: 8,
    padding: 10,
    gap: 8,
    borderWidth: 1,
    borderColor: '#2A3347',
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
  },
  movementFieldInput: {
    backgroundColor: '#0E1117',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 13,
    color: '#F0F4F8',
    fontFamily: FB,
    borderWidth: 1,
    borderColor: '#2A3347',
    width: 50,
    textAlign: 'center',
  },
  movementFieldSep: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FB,
  },
  addMovementBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
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

  // ── Movement picker ──────────────────────────────────────────────────
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

  // ── Add block chips ──────────────────────────────────────────────────
  addBlockLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 8,
  },
  blockTypeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.2)',
  },
  blockTypeChipText: {
    fontSize: 12,
    color: '#7DD3FC',
    fontFamily: FB,
  },

  // ── Footer ───────────────────────────────────────────────────────────
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
  // ── Load from Template button ───────────────────────────────────────
  loadTemplateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#F5A623',
    borderStyle: 'dashed',
    marginBottom: 16,
  },
  loadTemplateBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FB,
  },
  // ── Template picker modal ─────────────────────────────────────────
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
    paddingHorizontal: 4,
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
});
