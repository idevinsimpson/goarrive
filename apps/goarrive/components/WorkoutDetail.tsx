/**
 * WorkoutDetail — Workout detail bottom sheet
 *
 * Shows workout info, blocks, metadata badges, and action buttons.
 * Supports: assign to member, edit, archive/restore, duplicate.
 *
 * Props are fully typed via WorkoutDetailData interface.
 * Legacy workouts missing fields are handled gracefully with defaults.
 *
 * Follows GoArrive design system: #0E1117 bg, #F5A623 gold accent,
 * Space Grotesk headings, DM Sans body.
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
  Alert,
} from 'react-native';
import { db } from '../lib/firebase';
import { doc, onSnapshot, updateDoc, addDoc, collection, Timestamp } from 'firebase/firestore';
import { Icon } from './Icon';
import AssignWorkoutModal from './AssignWorkoutModal';
import { useAuth } from '../lib/AuthContext';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

// ── Typed workout data interface (suggestion 9) ─────────────────────────────
export interface WorkoutDetailData {
  id: string;
  name: string;
  description?: string;
  category?: string;
  difficulty?: string;
  estimatedDurationMin?: number | null;
  tags?: string[];
  blocks?: any[];
  coachId?: string;
  tenantId?: string;
  isTemplate?: boolean;
  isShared?: boolean;
  isArchived?: boolean;
  createdAt?: any;
  updatedAt?: any;
}

interface WorkoutDetailProps {
  workout: WorkoutDetailData;
  onClose: () => void;
  onEdit?: (workout: WorkoutDetailData) => void;
  onArchive?: (workout: WorkoutDetailData) => void;
  onDuplicate?: (workout: WorkoutDetailData) => void;
}

export default function WorkoutDetail({
  workout,
  onClose,
  onEdit,
  onArchive,
  onDuplicate,
}: WorkoutDetailProps) {
  const { user, claims } = useAuth();
  const coachId = claims?.coachId ?? user?.uid ?? '';
  const tenantId = claims?.tenantId ?? '';

  const [currentWorkout, setCurrentWorkout] = useState<WorkoutDetailData>(workout);
  const [showAssignModal, setShowAssignModal] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'workouts', workout.id), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setCurrentWorkout({
          id: snapshot.id,
          name: data.name ?? '',
          description: data.description ?? '',
          category: data.category ?? '',
          difficulty: data.difficulty ?? '',
          estimatedDurationMin: data.estimatedDurationMin ?? null,
          tags: data.tags ?? [],
          blocks: data.blocks ?? [],
          coachId: data.coachId ?? '',
          tenantId: data.tenantId ?? '',
          isTemplate: data.isTemplate ?? false,
          isShared: data.isShared ?? false,
          isArchived: data.isArchived ?? false,
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
        });
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
      // Snapshot workout data at assignment time for versioning
      const workoutSnapshot = {
        name: currentWorkout.name ?? '',
        description: currentWorkout.description ?? '',
        category: currentWorkout.category ?? '',
        difficulty: currentWorkout.difficulty ?? '',
        estimatedDurationMin: currentWorkout.estimatedDurationMin ?? null,
        blocks: currentWorkout.blocks ?? [],
        tags: currentWorkout.tags ?? [],
      };
      await addDoc(collection(db, 'workout_assignments'), {
        memberId,
        coachId,
        tenantId,
        workoutId: currentWorkout.id,
        workoutName,
        scheduledFor: Timestamp.fromDate(scheduledFor),
        status: 'scheduled',
        createdAt: Timestamp.now(),
        workoutSnapshot,
      });
    } catch (err) {
      console.error('Failed to assign workout:', err);
    }
  }

  const blockCount = currentWorkout.blocks?.length ?? 0;
  const isArchived = currentWorkout.isArchived ?? false;
  const isTemplate = currentWorkout.isTemplate ?? false;
  const isShared = currentWorkout.isShared ?? false;
  const isAdmin = claims?.role === 'platformAdmin' || claims?.admin === true;
  const category = currentWorkout.category ?? '';
  const difficulty = currentWorkout.difficulty ?? '';
  const duration = currentWorkout.estimatedDurationMin;
  const tags = currentWorkout.tags ?? [];

  // Check if this is a legacy workout missing key fields (suggestion 10)
  const isLegacy = !category && !difficulty && !duration;

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
              <View style={styles.headerBadgeRow}>
                <Text style={styles.subtitle}>
                  {blockCount} block{blockCount !== 1 ? 's' : ''}
                </Text>
                {isTemplate && (
                  <View style={styles.templateBadge}>
                    <Text style={styles.templateBadgeText}>TEMPLATE</Text>
                  </View>
                )}
                {isShared && (
                  <View style={[styles.templateBadge, { backgroundColor: 'rgba(110,187,122,0.15)', borderColor: 'rgba(110,187,122,0.3)' }]}>
                    <Text style={[styles.templateBadgeText, { color: '#6EBB7A' }]}>SHARED</Text>
                  </View>
                )}
                {isArchived && (
                  <View style={styles.archivedBadge}>
                    <Text style={styles.archivedBadgeText}>ARCHIVED</Text>
                  </View>
                )}
                {isLegacy && (
                  <View style={styles.legacyBadge}>
                    <Text style={styles.legacyBadgeText}>NEEDS UPDATE</Text>
                  </View>
                )}
              </View>
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
            {/* Metadata badges row */}
            {(category || difficulty || duration) && (
              <View style={styles.section}>
                <View style={styles.metaBadgeRow}>
                  {category ? (
                    <View style={styles.metaBadge}>
                      <Text style={styles.metaBadgeText}>{category}</Text>
                    </View>
                  ) : null}
                  {difficulty ? (
                    <View style={styles.metaBadge}>
                      <Text style={styles.metaBadgeText}>{difficulty}</Text>
                    </View>
                  ) : null}
                  {duration ? (
                    <View style={styles.metaBadge}>
                      <Text style={styles.metaBadgeText}>{duration} min</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            )}

            {/* Tags */}
            {tags.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Tags</Text>
                <View style={styles.tagRow}>
                  {tags.map((tag, i) => (
                    <View key={i} style={styles.tagChip}>
                      <Text style={styles.tagChipText}>{tag}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Description */}
            {currentWorkout.description ? (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Description</Text>
                <Text style={styles.descText}>{currentWorkout.description}</Text>
              </View>
            ) : null}

            {/* Legacy notice (suggestion 10) */}
            {isLegacy && (
              <View style={styles.section}>
                <View style={styles.legacyNotice}>
                  <Icon name="info" size={16} color="#F5A623" />
                  <Text style={styles.legacyNoticeText}>
                    This workout was created before the latest update. Tap "Edit"
                    to add category, difficulty, and duration.
                  </Text>
                </View>
              </View>
            )}

            {/* Blocks */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>
                Workout Blocks ({blockCount})
              </Text>
              {blockCount > 0 ? (
                (currentWorkout.blocks ?? []).map((block: any, index: number) => (
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

          {/* Footer — Action buttons */}
          <View style={styles.footer}>
            {/* Row 1: Edit + Archive + Duplicate */}
            <View style={styles.actionRow}>
              {onEdit && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => onEdit(currentWorkout)}
                >
                  <Icon name="edit" size={16} color="#F5A623" />
                  <Text style={styles.actionBtnText}>Edit</Text>
                </TouchableOpacity>
              )}
              {onDuplicate && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => onDuplicate(currentWorkout)}
                >
                  <Icon name="document" size={16} color="#7DD3FC" />
                  <Text style={[styles.actionBtnText, { color: '#7DD3FC' }]}>
                    Duplicate
                  </Text>
                </TouchableOpacity>
              )}
              {onArchive && (
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => onArchive(currentWorkout)}
                >
                  <Icon
                    name="archive"
                    size={16}
                    color={isArchived ? '#6EBB7A' : '#8A95A3'}
                  />
                  <Text
                    style={[
                      styles.actionBtnText,
                      { color: isArchived ? '#6EBB7A' : '#8A95A3' },
                    ]}
                  >
                    {isArchived ? 'Restore' : 'Archive'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Admin: Share to Marketplace toggle */}
            {isAdmin && (
              <TouchableOpacity
                style={[styles.actionBtn, { marginBottom: 8, alignSelf: 'flex-start' }]}
                onPress={() => {
                  const action = isShared ? 'remove from' : 'share to';
                  Alert.alert(
                    isShared ? 'Remove from Marketplace' : 'Share to Marketplace',
                    `Are you sure you want to ${action} the template marketplace?`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: isShared ? 'Remove' : 'Share',
                        style: isShared ? 'destructive' : 'default',
                        onPress: async () => {
                          try {
                            await updateDoc(doc(db, 'workouts', currentWorkout.id), {
                              isShared: !isShared,
                            });
                          } catch (err) {
                            console.error('[WorkoutDetail] Toggle isShared error:', err);
                            Alert.alert('Error', 'Failed to update sharing status.');
                          }
                        },
                      },
                    ],
                  );
                }}
              >
                <Icon
                  name={isShared ? 'close' : 'share'}
                  size={16}
                  color={isShared ? '#EF4444' : '#6EBB7A'}
                />
                <Text
                  style={[
                    styles.actionBtnText,
                    { color: isShared ? '#EF4444' : '#6EBB7A' },
                  ]}
                >
                  {isShared ? 'Remove from Marketplace' : 'Share to Marketplace'}
                </Text>
              </TouchableOpacity>
            )}

            {/* Row 2: Assign to Member */}
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
    gap: 4,
  },
  headerBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
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
  templateBadge: {
    backgroundColor: 'rgba(167,139,250,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(167,139,250,0.3)',
  },
  templateBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#A78BFA',
    fontFamily: FONT_HEADING,
    letterSpacing: 0.8,
  },
  archivedBadge: {
    backgroundColor: 'rgba(138,149,163,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(138,149,163,0.3)',
  },
  archivedBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#8A95A3',
    fontFamily: FONT_HEADING,
    letterSpacing: 0.8,
  },
  legacyBadge: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  legacyBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
    letterSpacing: 0.8,
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
  metaBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaBadge: {
    backgroundColor: '#1A2035',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  metaBadgeText: {
    fontSize: 12,
    color: '#C0C8D4',
    fontFamily: FONT_BODY,
    fontWeight: '500',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagChip: {
    backgroundColor: 'rgba(125,211,252,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.2)',
  },
  tagChipText: {
    fontSize: 11,
    color: '#7DD3FC',
    fontFamily: FONT_BODY,
  },
  descText: {
    fontSize: 14,
    color: '#C0C8D4',
    fontFamily: FONT_BODY,
    lineHeight: 20,
  },
  legacyNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(245,166,35,0.06)',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.15)',
  },
  legacyNoticeText: {
    flex: 1,
    fontSize: 13,
    color: '#F5A623',
    fontFamily: FONT_BODY,
    lineHeight: 18,
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
    gap: 10,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#161B22',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FONT_BODY,
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
