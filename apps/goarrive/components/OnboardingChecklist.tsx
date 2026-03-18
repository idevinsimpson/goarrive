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
 * Disappears once all steps are done or the user dismisses it.
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
  sublabel: string;
  done: boolean;
}

const STEP_DEFS = [
  { label: 'Add a movement', sublabel: 'Build your exercise library' },
  { label: 'Create a workout', sublabel: 'Design your first program' },
  { label: 'Add a member', sublabel: 'Grow your coaching roster' },
  { label: 'Assign a workout', sublabel: 'Put your member to work' },
];

export default function OnboardingChecklist() {
  const { user, claims } = useAuth();
  const coachId = claims?.coachId ?? user?.uid ?? '';
  const [steps, setSteps] = useState<Step[]>(
    STEP_DEFS.map((d) => ({ ...d, done: false }))
  );
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
        getDocs(query(collection(db, 'workout_templates'), where('coachId', '==', coachId), limit(1))),
        getDocs(query(collection(db, 'members'), where('coachId', '==', coachId), limit(1))),
        getDocs(query(collection(db, 'workout_assignments'), where('coachId', '==', coachId), limit(1))),
      ]);
      setSteps(
        STEP_DEFS.map((d, i) => ({ ...d, done: !checks[i].empty }))
      );
    } catch (err) {
      console.error('[OnboardingChecklist] error:', err);
    } finally {
      setLoading(false);
    }
  }

  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;
  const pct = Math.round((doneCount / steps.length) * 100);

  if (dismissed || allDone) return null;

  if (loading) {
    return (
      <View style={s.card}>
        <View style={s.loadingRow}>
          <ActivityIndicator color="#F5A623" size="small" />
          <Text style={s.loadingText}>Checking your progress…</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.card}>
      {/* Header */}
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <Text style={s.title}>Getting Started</Text>
          <Text style={s.subtitle}>{doneCount} of {steps.length} steps complete</Text>
        </View>
        <Pressable onPress={() => setDismissed(true)} hitSlop={10} style={s.dismissBtn}>
          <Icon name="x" size={16} color="#4A5568" />
        </Pressable>
      </View>

      {/* Progress bar */}
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${pct}%` as any }]} />
      </View>

      {/* Steps */}
      <View style={s.stepList}>
        {steps.map((step, i) => (
          <View key={i} style={[s.stepRow, i < steps.length - 1 && s.stepRowBorder]}>
            {/* Step indicator */}
            <View style={[s.stepIndicator, step.done && s.stepIndicatorDone]}>
              {step.done ? (
                <Icon name="check" size={12} color="#0F1623" />
              ) : (
                <Text style={s.stepNumber}>{i + 1}</Text>
              )}
            </View>
            {/* Step text */}
            <View style={s.stepText}>
              <Text style={[s.stepLabel, step.done && s.stepLabelDone]}>
                {step.label}
              </Text>
              {!step.done && (
                <Text style={s.stepSublabel}>{step.sublabel}</Text>
              )}
            </View>
            {/* Done checkmark */}
            {step.done && (
              <Text style={s.doneTag}>Done</Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#131A27',
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    overflow: 'hidden',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
  },
  loadingText: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
  },
  headerLeft: {
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  subtitle: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
  dismissBtn: {
    padding: 4,
    marginTop: 2,
  },
  progressTrack: {
    height: 3,
    backgroundColor: '#1E2A3A',
    marginHorizontal: 16,
    borderRadius: 2,
    marginBottom: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#F5A623',
    borderRadius: 2,
  },
  stepList: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    marginTop: 8,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    gap: 12,
  },
  stepRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#1A2235',
  },
  stepIndicator: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#1A2235',
    borderWidth: 1.5,
    borderColor: '#2A3347',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepIndicatorDone: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
  },
  stepNumber: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5A6478',
    fontFamily: FONT_HEADING,
  },
  stepText: {
    flex: 1,
    gap: 1,
  },
  stepLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#D0D8E4',
    fontFamily: FONT_BODY,
  },
  stepLabelDone: {
    color: '#5A6478',
    textDecorationLine: 'line-through',
  },
  stepSublabel: {
    fontSize: 11,
    color: '#4A5568',
    fontFamily: FONT_BODY,
  },
  doneTag: {
    fontSize: 11,
    fontWeight: '600',
    color: '#6EBB7A',
    fontFamily: FONT_BODY,
    backgroundColor: 'rgba(110,187,122,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    overflow: 'hidden',
  },
});
