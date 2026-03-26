/**
 * PostWorkoutJournal — Glow / Grow post-workout reflection
 *
 * Design philosophy (from Product Research doc):
 * - Lightweight: 30 seconds max, not a burden
 * - Glow = what went well (celebration)
 * - Grow = what to improve (growth mindset)
 * - Optional energy/mood tap rating (1-5)
 * - Writes directly into the workout_log document
 * - Coach sees this in the review queue
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import Icon from './Icon';

// ─── Types ───────────────────────────────────────────
export interface JournalEntry {
  glow: string;
  grow: string;
  energyRating: number | null;
  moodRating: number | null;
}

interface PostWorkoutJournalProps {
  visible: boolean;
  workoutName: string;
  durationSeconds: number;
  onSubmit: (journal: JournalEntry) => void;
  onSkip: () => void;
}

// ─── Helpers ─────────────────────────────────────────
const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
};

const ENERGY_LABELS = ['Drained', 'Low', 'Steady', 'Strong', 'On Fire'];
const MOOD_LABELS = ['Rough', 'Meh', 'Okay', 'Good', 'Amazing'];

// ─── Component ───────────────────────────────────────
export default function PostWorkoutJournal({
  visible,
  workoutName,
  durationSeconds,
  onSubmit,
  onSkip,
}: PostWorkoutJournalProps) {
  const [glow, setGlow] = useState('');
  const [grow, setGrow] = useState('');
  const [energyRating, setEnergyRating] = useState<number | null>(null);
  const [moodRating, setMoodRating] = useState<number | null>(null);

  const handleSubmit = () => {
    onSubmit({ glow: glow.trim(), grow: grow.trim(), energyRating, moodRating });
    // Reset for next use
    setGlow('');
    setGrow('');
    setEnergyRating(null);
    setMoodRating(null);
  };

  const handleSkip = () => {
    onSkip();
    setGlow('');
    setGrow('');
    setEnergyRating(null);
    setMoodRating(null);
  };

  const renderRatingRow = (
    label: string,
    labels: string[],
    value: number | null,
    onSelect: (v: number) => void,
    icon: string,
  ) => (
    <View style={styles.ratingSection}>
      <View style={styles.ratingHeader}>
        <Icon name={icon} size={16} color="#F5A623" />
        <Text style={styles.ratingLabel}>{label}</Text>
        {value !== null && (
          <Text style={styles.ratingValue}>{labels[value - 1]}</Text>
        )}
      </View>
      <View style={styles.ratingRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <TouchableOpacity
            key={n}
            onPress={() => onSelect(n === value ? 0 : n)}
            style={[
              styles.ratingDot,
              value !== null && n <= value && styles.ratingDotActive,
            ]}
          >
            <Text
              style={[
                styles.ratingDotText,
                value !== null && n <= value && styles.ratingDotTextActive,
              ]}
            >
              {n}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Completion Banner */}
          <View style={styles.banner}>
            <Icon name="check-circle" size={48} color="#F5A623" />
            <Text style={styles.bannerTitle}>Workout Complete</Text>
            <Text style={styles.bannerSubtitle}>
              {workoutName} — {formatDuration(durationSeconds)}
            </Text>
          </View>

          {/* Glow */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionEmoji}>☀️</Text>
              <Text style={styles.sectionTitle}>Glow</Text>
            </View>
            <Text style={styles.sectionHint}>What went well today?</Text>
            <TextInput
              style={styles.textInput}
              value={glow}
              onChangeText={setGlow}
              placeholder="I crushed my push-ups..."
              placeholderTextColor="#555"
              multiline
              maxLength={500}
              textAlignVertical="top"
            />
          </View>

          {/* Grow */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionEmoji}>🌱</Text>
              <Text style={styles.sectionTitle}>Grow</Text>
            </View>
            <Text style={styles.sectionHint}>What do you want to improve?</Text>
            <TextInput
              style={styles.textInput}
              value={grow}
              onChangeText={setGrow}
              placeholder="Need to work on my form for..."
              placeholderTextColor="#555"
              multiline
              maxLength={500}
              textAlignVertical="top"
            />
          </View>

          {/* Energy Rating */}
          {renderRatingRow('Energy', ENERGY_LABELS, energyRating, (v) => setEnergyRating(v === 0 ? null : v), 'bolt')}

          {/* Mood Rating */}
          {renderRatingRow('Mood', MOOD_LABELS, moodRating, (v) => setMoodRating(v === 0 ? null : v), 'heart')}

          {/* Actions */}
          <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
            <Text style={styles.submitButtonText}>
              {glow || grow || energyRating || moodRating ? 'Save Reflection' : 'Save Without Reflection'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
            <Text style={styles.skipButtonText}>Skip</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Styles ──────────────────────────────────────────
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
  },
  banner: {
    alignItems: 'center',
    marginBottom: 32,
  },
  bannerTitle: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 28,
    color: '#FFFFFF',
    marginTop: 12,
  },
  bannerSubtitle: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    color: '#9CA3AF',
    marginTop: 4,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  sectionEmoji: {
    fontSize: 20,
    marginRight: 8,
  },
  sectionTitle: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 20,
    color: '#FFFFFF',
  },
  sectionHint: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#9CA3AF',
    marginBottom: 8,
  },
  textInput: {
    backgroundColor: '#1A1E26',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A2E36',
    color: '#FFFFFF',
    fontFamily: 'DMSans_400Regular',
    fontSize: 16,
    padding: 12,
    minHeight: 80,
    maxHeight: 120,
  },
  ratingSection: {
    marginBottom: 20,
  },
  ratingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  ratingLabel: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 16,
    color: '#FFFFFF',
    marginLeft: 8,
  },
  ratingValue: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#F5A623',
    marginLeft: 8,
  },
  ratingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  ratingDot: {
    width: 52,
    height: 44,
    borderRadius: 8,
    backgroundColor: '#1A1E26',
    borderWidth: 1,
    borderColor: '#2A2E36',
    justifyContent: 'center',
    alignItems: 'center',
  },
  ratingDotActive: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
  },
  ratingDotText: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 16,
    color: '#9CA3AF',
  },
  ratingDotTextActive: {
    color: '#0E1117',
  },
  submitButton: {
    backgroundColor: '#F5A623',
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 12,
  },
  submitButtonText: {
    fontFamily: 'SpaceGrotesk_700Bold',
    fontSize: 16,
    color: '#0E1117',
  },
  skipButton: {
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  skipButtonText: {
    fontFamily: 'DMSans_400Regular',
    fontSize: 14,
    color: '#9CA3AF',
  },
});
