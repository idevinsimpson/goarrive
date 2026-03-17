/**
 * WorkoutDetail — Workout detail bottom sheet
 *
 * Shows workout info, blocks, and allows assigning to a member.
 *
 * Fixes applied (Week 1 hardening):
 *   - Replace "Coming Soon" alert with real AssignWorkoutModal
 *   - Match GoArrive design system (dark bg, gold accents, DM Sans / Space Grotesk)
 */
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Platform,
} from 'react-native';
import { db } from '../lib/firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { Icon } from './Icon';
import AssignWorkoutModal from './AssignWorkoutModal';
import { useAuth } from '../lib/AuthContext';
import { addDoc, collection, Timestamp } from 'firebase/firestore';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

interface WorkoutDetailProps {
  workout: any;
  onClose: () => void;
}

export default function WorkoutDetail({ workout, onClose }: WorkoutDetailProps) {
  const { user, claims } = useAuth();
  const coachId = claims?.coachId ?? user?.uid ?? '';
  const tenantId = claims?.tenantId ?? '';

  const [currentWorkout, setCurrentWorkout] = useState(workout);
  const [showAssignModal, setShowAssignModal] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'workouts', workout.id), (snapshot) => {
      if (snapshot.exists()) {
        setCurrentWorkout({ id: snapshot.id, ...snapshot.data() });
      }
    });
    return () => unsubscribe();
  }, [workout.id]);

  async function handleAssign(
    _workoutId: string,
    workoutName: string,
    scheduledFor: Date,
    memberId: string,
  ) {
    try {
      await addDoc(collection(db, 'workout_assignments'), {
        memberId,
        coachId,
        tenantId,
        workoutId: currentWorkout.id,
        workoutName,
        scheduledFor: Timestamp.fromDate(scheduledFor),
        status: 'scheduled',
        createdAt: Timestamp.now(),
      });
    } catch (err) {
      console.error('Failed to assign workout:', err);
    }
  }

  const blockCount = currentWorkout.blocks?.length ?? 0;

  return (
    <Modal visible={true} animationType="slide" transparent={true}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          {/* Drag handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.iconWrap}>
              <Icon name="workouts" size={20} color="#7DD3FC" />
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.title} numberOfLines={1}>
                {currentWorkout.name}
              </Text>
              <Text style={styles.subtitle}>
                {blockCount} block{blockCount !== 1 ? 's' : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={8}>
              <Icon name="close" size={22} color="#8A95A3" />
            </TouchableOpacity>
          </View>

          {/* Scrollable body */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {/* Description */}
            {currentWorkout.description ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Description</Text>
                <Text style={styles.descText}>{currentWorkout.description}</Text>
              </View>
            ) : null}

            {/* Blocks */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>
                Workout Blocks ({blockCount})
              </Text>
              {blockCount > 0 ? (
                currentWorkout.blocks.map((block: any, index: number) => (
                  <View key={index} style={styles.blockCard}>
                    <View style={styles.blockIndex}>
                      <Text style={styles.blockIndexText}>{index + 1}</Text>
                    </View>
                    <View style={styles.blockInfo}>
                      <Text style={styles.blockTitle}>
                        {block.type || 'Block'} {index + 1}
                      </Text>
                      <Text style={styles.blockSub}>
                        {block.movements?.length ?? 0} movement
                        {(block.movements?.length ?? 0) !== 1 ? 's' : ''}
                      </Text>
                    </View>
                  </View>
                ))
              ) : (
                <View style={styles.emptyBlocks}>
                  <Text style={styles.emptyBlocksText}>
                    No blocks added to this workout yet.
                  </Text>
                </View>
              )}
            </View>

            <View style={{ height: 20 }} />
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={styles.assignBtn}
              onPress={() => setShowAssignModal(true)}
            >
              <Icon name="person" size={18} color="#0E1117" />
              <Text style={styles.assignBtnText}>Assign to Member</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Assign Workout Modal */}
      <AssignWorkoutModal
        visible={showAssignModal}
        memberName=""
        coachId={coachId}
        preselectedWorkoutId={currentWorkout.id}
        preselectedWorkoutName={currentWorkout.name}
        onClose={() => setShowAssignModal(false)}
        onAssign={async (workoutId, workoutName, scheduledFor, memberId) => {
          await handleAssign(workoutId, workoutName, scheduledFor, memberId ?? '');
          setShowAssignModal(false);
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '90%',
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
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(125,211,252,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  subtitle: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FONT_BODY,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingTop: 4,
  },
  section: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
    gap: 10,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A5568',
    fontFamily: FONT_BODY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  descText: {
    fontSize: 14,
    color: '#C0C8D4',
    fontFamily: FONT_BODY,
    lineHeight: 20,
  },
  blockCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0E1117',
    borderRadius: 10,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  blockIndex: {
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
    fontFamily: FONT_HEADING,
  },
  blockInfo: {
    flex: 1,
    gap: 2,
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  blockSub: {
    fontSize: 12,
    color: '#4A5568',
    fontFamily: FONT_BODY,
  },
  emptyBlocks: {
    paddingVertical: 20,
    alignItems: 'center',
    backgroundColor: '#0E1117',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1E2A3A',
  },
  emptyBlocksText: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FONT_BODY,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#1E2A3A',
  },
  assignBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 14,
    gap: 8,
  },
  assignBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FONT_HEADING,
  },
});
