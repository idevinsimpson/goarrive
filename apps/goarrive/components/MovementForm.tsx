/**
 * MovementForm — Create or edit a movement
 *
 * Full-field form covering all MovementDetailData properties.
 * Supports both create (addDoc) and edit (updateDoc) modes.
 *
 * Props:
 *   - visible: boolean
 *   - onClose: () => void — called after save or cancel
 *   - coachId: string — required for Firestore writes
 *   - tenantId: string — required for Firestore writes
 *   - editMovement?: MovementDetailData — if provided, opens in edit mode
 *
 * Firestore collection: movements
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { db } from '../lib/firebase';
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { Icon } from './Icon';
import { MovementDetailData } from './MovementDetail';

// ── Constants ──────────────────────────────────────────────────────────────
const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const CATEGORY_OPTIONS = [
  'Upper Body Push',
  'Upper Body Pull',
  'Lower Body Push',
  'Lower Body Pull',
  'Core',
  'Cardio',
  'Mobility',
];

const EQUIPMENT_OPTIONS = [
  'Bodyweight',
  'Dumbbell',
  'Barbell',
  'Kettlebell',
  'Band',
  'Cable',
  'Machine',
];

const DIFFICULTY_OPTIONS = ['Beginner', 'Intermediate', 'Advanced'];

const MUSCLE_GROUP_OPTIONS = [
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Core',
  'Full Body',
];

// ── Types ──────────────────────────────────────────────────────────────────
interface MovementFormProps {
  visible: boolean;
  onClose: () => void;
  coachId: string;
  tenantId: string;
  editMovement?: MovementDetailData | null;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function MovementForm({
  visible,
  onClose,
  coachId,
  tenantId,
  editMovement,
}: MovementFormProps) {
  const isEdit = !!editMovement;

  // ── Form state ─────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [equipment, setEquipment] = useState('');
  const [difficulty, setDifficulty] = useState('');
  const [description, setDescription] = useState('');
  const [muscleGroups, setMuscleGroups] = useState<string[]>([]);
  const [workSec, setWorkSec] = useState('30');
  const [restSec, setRestSec] = useState('15');
  const [countdownSec, setCountdownSec] = useState('3');
  const [swapSides, setSwapSides] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // ── Pre-populate on edit ───────────────────────────────────────────────
  useEffect(() => {
    if (editMovement) {
      setName(editMovement.name || '');
      setCategory(editMovement.category || '');
      setEquipment(editMovement.equipment || '');
      setDifficulty(editMovement.difficulty || '');
      setDescription(editMovement.description || '');
      setMuscleGroups(editMovement.muscleGroups || []);
      setWorkSec(String(editMovement.workSec ?? 30));
      setRestSec(String(editMovement.restSec ?? 15));
      setCountdownSec(String(editMovement.countdownSec ?? 3));
      setSwapSides(editMovement.swapSides ?? false);
      setVideoUrl((editMovement as any).videoUrl || editMovement.mediaUrl || '');
    } else {
      resetForm();
    }
  }, [editMovement, visible]);

  const resetForm = () => {
    setName('');
    setCategory('');
    setEquipment('');
    setDifficulty('');
    setDescription('');
    setMuscleGroups([]);
    setWorkSec('30');
    setRestSec('15');
    setCountdownSec('3');
    setSwapSides(false);
    setVideoUrl('');
  };

  // ── Muscle group toggle ────────────────────────────────────────────────
  const toggleMuscleGroup = (mg: string) => {
    setMuscleGroups((prev) =>
      prev.includes(mg) ? prev.filter((g) => g !== mg) : [...prev, mg],
    );
  };

  // ── Submit ─────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'Please enter a movement name.');
      return;
    }
    if (!category) {
      Alert.alert('Error', 'Please select a category.');
      return;
    }

    setSubmitting(true);
    try {
      const data: Record<string, any> = {
        name: name.trim(),
        category,
        equipment,
        difficulty,
        description: description.trim(),
        muscleGroups,
        workSec: parseInt(workSec, 10) || 30,
        restSec: parseInt(restSec, 10) || 15,
        countdownSec: parseInt(countdownSec, 10) || 3,
        swapSides,
        swapMode: 'split' as const,
        swapWindowSec: 5,
        videoUrl: videoUrl.trim(),
        updatedAt: serverTimestamp(),
      };

      if (isEdit && editMovement) {
        // Edit mode — update existing document
        await updateDoc(doc(db, 'movements', editMovement.id), data);
      } else {
        // Create mode — add new document with ownership fields
        await addDoc(collection(db, 'movements'), {
          ...data,
          coachId,
          tenantId,
          isGlobal: false,
          isArchived: false,
          createdAt: serverTimestamp(),
        });
      }

      resetForm();
      onClose();
    } catch (error) {
      console.error('[MovementForm] Save error:', error);
      Alert.alert('Error', `Could not ${isEdit ? 'update' : 'create'} movement.`);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View style={st.overlay}>
        <View style={st.sheet}>
          {/* Header */}
          <View style={st.header}>
            <Text style={st.headerTitle}>
              {isEdit ? 'Edit Movement' : 'New Movement'}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Icon name="close" size={24} color="#8A95A3" />
            </Pressable>
          </View>

          <ScrollView
            style={st.scroll}
            contentContainerStyle={st.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Movement Name */}
            <Text style={st.label}>Movement Name *</Text>
            <TextInput
              style={st.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Back Squat"
              placeholderTextColor="#4A5568"
            />

            {/* Category — Picker chips */}
            <Text style={st.label}>Category *</Text>
            <View style={st.chipRow}>
              {CATEGORY_OPTIONS.map((opt) => {
                const active = category === opt;
                return (
                  <Pressable
                    key={opt}
                    style={[st.chip, active && st.chipActive]}
                    onPress={() => setCategory(opt)}
                  >
                    <Text style={[st.chipText, active && st.chipTextActive]}>
                      {opt}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Equipment — Picker chips */}
            <Text style={st.label}>Equipment</Text>
            <View style={st.chipRow}>
              {EQUIPMENT_OPTIONS.map((opt) => {
                const active = equipment === opt;
                return (
                  <Pressable
                    key={opt}
                    style={[st.chip, active && st.chipActive]}
                    onPress={() => setEquipment(active ? '' : opt)}
                  >
                    <Text style={[st.chipText, active && st.chipTextActive]}>
                      {opt}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Difficulty — Picker chips */}
            <Text style={st.label}>Difficulty</Text>
            <View style={st.chipRow}>
              {DIFFICULTY_OPTIONS.map((opt) => {
                const active = difficulty === opt;
                return (
                  <Pressable
                    key={opt}
                    style={[st.chip, active && st.chipActive]}
                    onPress={() => setDifficulty(active ? '' : opt)}
                  >
                    <Text style={[st.chipText, active && st.chipTextActive]}>
                      {opt}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Muscle Groups — Multi-select chips */}
            <Text style={st.label}>Muscle Groups</Text>
            <View style={st.chipRow}>
              {MUSCLE_GROUP_OPTIONS.map((mg) => {
                const active = muscleGroups.includes(mg);
                return (
                  <Pressable
                    key={mg}
                    style={[st.chip, active && st.chipActive]}
                    onPress={() => toggleMuscleGroup(mg)}
                  >
                    <Text style={[st.chipText, active && st.chipTextActive]}>
                      {mg}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Description */}
            <Text style={st.label}>Description</Text>
            <TextInput
              style={[st.input, st.textArea]}
              value={description}
              onChangeText={setDescription}
              placeholder="Coaching cues, notes, or instructions..."
              placeholderTextColor="#4A5568"
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {/* Timer Defaults */}
            <Text style={st.sectionTitle}>Timer Defaults</Text>
            <View style={st.timerRow}>
              <View style={st.timerField}>
                <Text style={st.timerLabel}>Work (sec)</Text>
                <TextInput
                  style={st.timerInput}
                  value={workSec}
                  onChangeText={setWorkSec}
                  keyboardType="numeric"
                  placeholder="30"
                  placeholderTextColor="#4A5568"
                />
              </View>
              <View style={st.timerField}>
                <Text style={st.timerLabel}>Rest (sec)</Text>
                <TextInput
                  style={st.timerInput}
                  value={restSec}
                  onChangeText={setRestSec}
                  keyboardType="numeric"
                  placeholder="15"
                  placeholderTextColor="#4A5568"
                />
              </View>
              <View style={st.timerField}>
                <Text style={st.timerLabel}>Countdown</Text>
                <TextInput
                  style={st.timerInput}
                  value={countdownSec}
                  onChangeText={setCountdownSec}
                  keyboardType="numeric"
                  placeholder="3"
                  placeholderTextColor="#4A5568"
                />
              </View>
            </View>

            {/* Swap Sides toggle */}
            <Pressable
              style={st.toggleRow}
              onPress={() => setSwapSides(!swapSides)}
            >
              <View>
                <Text style={st.toggleLabel}>Swap Sides</Text>
                <Text style={st.toggleHint}>
                  Automatically split work time for left/right sides
                </Text>
              </View>
              <View
                style={[st.toggleTrack, swapSides && st.toggleTrackActive]}
              >
                <View
                  style={[st.toggleThumb, swapSides && st.toggleThumbActive]}
                />
              </View>
            </Pressable>

            {/* Video URL */}
            <Text style={st.label}>Video URL (Optional)</Text>
            <TextInput
              style={st.input}
              value={videoUrl}
              onChangeText={setVideoUrl}
              placeholder="Link to movement demo video..."
              placeholderTextColor="#4A5568"
              autoCapitalize="none"
              keyboardType="url"
            />
          </ScrollView>

          {/* Footer buttons */}
          <View style={st.footer}>
            <Pressable style={st.cancelBtn} onPress={onClose}>
              <Text style={st.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[st.saveBtn, submitting && st.saveBtnDisabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              <Text style={st.saveBtnText}>
                {submitting
                  ? isEdit
                    ? 'Saving...'
                    : 'Creating...'
                  : isEdit
                  ? 'Save Changes'
                  : 'Create Movement'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#0E1117',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '90%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 16, default: 16 }),
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    gap: 16,
  },

  // Labels
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FH,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginTop: 4,
  },

  // Inputs
  input: {
    backgroundColor: '#161B22',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#F0F4F8',
    fontSize: 14,
    fontFamily: FB,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },

  // Chip selectors
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
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
  chipTextActive: {
    color: '#F5A623',
    fontWeight: '600',
  },

  // Timer row
  timerRow: {
    flexDirection: 'row',
    gap: 12,
  },
  timerField: {
    flex: 1,
    gap: 4,
  },
  timerLabel: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
  },
  timerInput: {
    backgroundColor: '#161B22',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#F0F4F8',
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FH,
    textAlign: 'center',
    borderWidth: 1,
    borderColor: '#2A3347',
  },

  // Toggle
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#161B22',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  toggleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FB,
  },
  toggleHint: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FB,
    marginTop: 2,
  },
  toggleTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#2A3347',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleTrackActive: {
    backgroundColor: 'rgba(245,166,35,0.3)',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#4A5568',
  },
  toggleThumbActive: {
    backgroundColor: '#F5A623',
    alignSelf: 'flex-end',
  },

  // Footer
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#2A3347',
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
  },
  saveBtn: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: '#F5A623',
  },
  saveBtnDisabled: {
    opacity: 0.5,
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
});
