/**
 * OnboardingChecklist — Dashboard onboarding progress card
 *
 * Shows a checklist of setup steps for new coaches:
 *   1. Add your first movement
 *   2. Create a workout
 *   3. Add a member
 *   4. Assign a workout
 *
 * Checks Firestore for each step's completion and shows progress.
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Icon } from './Icon';
import { collection, getDocs, query, where, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

interface Step {
  label: string;
  done: boolean;
}

export default function OnboardingChecklist() {
  const { user, claims } = useAuth();
  const coachId = claims?.coachId ?? user?.uid ?? '';
  const [steps, setSteps] = useState<Step[]>([
    { label: 'Add your first movement', done: false },
    { label: 'Create a workout', done: false },
    { label: 'Add a member', done: false },
    { label: 'Assign a workout', done: false },
  ]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!coachId) return;
    checkSteps();
  }, [coachId]);

  async function checkSteps() {
    setLoading(true);
    try {
      const checks = await Promise.all([
        getDocs(query(collection(db, 'movements'), where('coachId', '==', coachId), limit(1))),
        getDocs(query(collection(db, 'workouts'), where('coachId', '==', coachId), limit(1))),
        getDocs(query(collection(db, 'members'), where('coachId', '==', coachId), limit(1))),
        getDocs(query(collection(db, 'workout_assignments'), where('coachId', '==', coachId), limit(1))),
      ]);
      setSteps([
        { label: 'Add your first movement', done: !checks[0].empty },
        { label: 'Create a workout', done: !checks[1].empty },
        { label: 'Add a member', done: !checks[2].empty },
        { label: 'Assign a workout', done: !checks[3].empty },
      ]);
    } catch (err) {
      console.error('[OnboardingChecklist] error:', err);
    } finally {
      setLoading(false);
    }
  }

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  if (dismissed || allDone) return null;

  if (loading) {
    return (
      <View style={s.card}>
        <ActivityIndicator color="#F5A623" size="small" />
      </View>
    );
  }

  return (
    <View style={s.card}>
      <View style={s.headerRow}>
        <Text style={s.title}>Getting Started</Text>
        <Pressable onPress={() => setDismissed(true)} hitSlop={8}>
          <Icon name="close" size={18} color="#8A95A3" />
        </Pressable>
      </View>
      <Text style={s.progress}>
        {doneCount} of {steps.length} complete
      </Text>
      <View style={s.progressBar}>
        <View
          style={[
            s.progressFill,
            { width: `${(doneCount / steps.length) * 100}%` },
          ]}
        />
      </View>
      <View style={s.stepList}>
        {steps.map((step, i) => (
          <View key={i} style={s.stepRow}>
            <Icon
              name={step.done ? 'check-circle' : 'circle'}
              size={18}
              color={step.done ? '#6EBB7A' : '#4A5568'}
            />
            <Text style={[s.stepLabel, step.done && s.stepDone]}>
              {step.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#1A2035',
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#2A3347',
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  progress: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
  progressBar: {
    height: 4,
    backgroundColor: '#2A3347',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#F5A623',
    borderRadius: 2,
  },
  stepList: {
    gap: 8,
    marginTop: 4,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stepLabel: {
    fontSize: 13,
    color: '#C0C8D4',
    fontFamily: FONT_BODY,
  },
  stepDone: {
    color: '#8A95A3',
    textDecorationLine: 'line-through',
  },
});
