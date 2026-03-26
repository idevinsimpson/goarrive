/**
 * WorkoutPreview — Pre-start workout overview (Suggestion 3)
 *
 * Shows all movements, estimated duration, equipment needed, and block
 * structure so the member can prepare before starting. Sits between
 * tapping "Start" and the countdown phase.
 *
 * Reduces anxiety for new members and helps experienced members
 * prepare equipment ahead of time.
 *
 * Props:
 *   - visible: boolean
 *   - workout: the workout object with blocks/movements
 *   - onStart: () => void — launches the player
 *   - onClose: () => void — goes back
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  ScrollView,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Icon } from './Icon';
import { useOfflineVideoCache } from '../hooks/useOfflineVideoCache';

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

interface WorkoutPreviewProps {
  visible: boolean;
  workout: any;
  onStart: () => void;
  onClose: () => void;
}

/** Equipment checklist item with toggle */
function EquipmentCheckItem({ name }: { name: string }) {
  const [checked, setChecked] = useState(false);
  return (
    <TouchableOpacity
      style={st.checkItem}
      onPress={() => setChecked(!checked)}
      activeOpacity={0.7}
    >
      <View style={[st.checkBox, checked && st.checkBoxChecked]}>
        {checked && <Icon name="check" size={14} color="#0E1117" />}
      </View>
      <Text style={[st.checkLabel, checked && st.checkLabelChecked]}>{name}</Text>
    </TouchableOpacity>
  );
}

export default function WorkoutPreview({
  visible,
  workout,
  onStart,
  onClose,
}: WorkoutPreviewProps) {
  const { getCachedUri, cacheVideos, progress, isCaching } = useOfflineVideoCache();

  // Pre-cache all movement videos when preview opens
  useEffect(() => {
    if (!visible || !workout) return;
    const videoUrls: string[] = [];
    (workout.blocks || []).forEach((block: any) => {
      (block.movements || []).forEach((mv: any) => {
        const url = mv.videoUrl || mv.mediaUrl;
        if (url) videoUrls.push(url);
      });
    });
    if (videoUrls.length > 0) cacheVideos(videoUrls);
  }, [visible, workout]);

  if (!workout) return null;

  const blocks = workout.blocks || [];

  // Calculate estimated duration (accounts for block types)
  const estimatedMin = (() => {
    if (workout.estimatedDurationMin) return workout.estimatedDurationMin;
    let totalSec = 0;
    blocks.forEach((block: any) => {
      const rounds = block.rounds || block.sets || 1;
      const movements = block.movements || [];
      const blockType = (block.type || 'linear').toLowerCase();
      const roundRest = block.restBetweenRoundsSec ?? block.restBetweenSec ?? 15;
      const mvRest = block.restBetweenMovementsSec ?? 10;

      if (blockType === 'superset' || blockType === 'circuit') {
        // Superset/circuit: all movements per round, short rest between movements
        let roundSec = 0;
        movements.forEach((mv: any) => {
          roundSec += mv.duration || mv.workSec || 30;
          roundSec += mvRest;
        });
        totalSec += (roundSec + roundRest) * rounds;
      } else {
        // Linear: each movement × rounds sequentially
        movements.forEach((mv: any) => {
          const work = mv.duration || mv.workSec || 30;
          const rest = mv.restSec ?? roundRest;
          totalSec += (work + rest) * rounds;
        });
      }
    });
    return Math.ceil(totalSec / 60);
  })();

  // Collect unique equipment
  const equipment = new Set<string>();
  blocks.forEach((block: any) => {
    (block.movements || []).forEach((mv: any) => {
      if (mv.equipment) equipment.add(mv.equipment);
    });
  });

  // Count total movements
  let totalMovements = 0;
  blocks.forEach((block: any) => {
    totalMovements += (block.movements || []).length;
  });

  return (
    <Modal visible={visible} animationType="slide" transparent={false}>
      <View style={st.container}>
        {/* Header */}
        <View style={st.header}>
          <TouchableOpacity onPress={onClose} style={st.backBtn}>
            <Icon name="arrow-left" size={22} color="#F0F4F8" />
          </TouchableOpacity>
          <Text style={st.headerTitle}>Workout Preview</Text>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView style={st.scroll} contentContainerStyle={st.scrollContent}>
          {/* Workout name */}
          <Text style={st.workoutName}>{workout.name || 'Workout'}</Text>
          {workout.description ? (
            <Text style={st.workoutDesc}>{workout.description}</Text>
          ) : null}

          {/* Stats row */}
          <View style={st.statsRow}>
            <View style={st.statItem}>
              <Icon name="clock" size={18} color="#F5A623" />
              <Text style={st.statValue}>{estimatedMin} min</Text>
              <Text style={st.statLabel}>Duration</Text>
            </View>
            <View style={st.statDivider} />
            <View style={st.statItem}>
              <Icon name="activity" size={18} color="#F5A623" />
              <Text style={st.statValue}>{totalMovements}</Text>
              <Text style={st.statLabel}>Movements</Text>
            </View>
            <View style={st.statDivider} />
            <View style={st.statItem}>
              <Icon name="layers" size={18} color="#F5A623" />
              <Text style={st.statValue}>{blocks.length}</Text>
              <Text style={st.statLabel}>Blocks</Text>
            </View>
          </View>

          {/* Equipment checklist */}
          {equipment.size > 0 && (
            <View style={st.section}>
              <Text style={st.sectionTitle}>Equipment Checklist</Text>
              {Array.from(equipment).map((eq) => (
                <EquipmentCheckItem key={eq} name={eq} />
              ))}
            </View>
          )}

          {/* Block breakdown */}
          <View style={st.section}>
            <Text style={st.sectionTitle}>Block Breakdown</Text>
            {blocks.map((block: any, bi: number) => (
              <View key={bi} style={st.blockCard}>
                <View style={st.blockHeader}>
                  <Text style={st.blockName}>
                    {block.name || block.label || `Block ${bi + 1}`}
                  </Text>
                  <Text style={st.blockType}>
                    {block.type || 'Strength'}
                    {(block.rounds ?? block.sets ?? 1) > 1
                      ? ` · ${block.rounds ?? block.sets} rounds`
                      : ''}
                  </Text>
                </View>
                {(block.movements || []).map((mv: any, mi: number) => (
                  <View key={mi} style={st.movementRow}>
                    <View style={st.movementDot} />
                    <Text style={st.movementName}>{mv.name || mv.movementName || 'Movement'}</Text>
                    <Text style={st.movementMeta}>
                      {mv.reps
                        ? `${mv.sets ?? 1}×${mv.reps}`
                        : `${mv.duration || mv.workSec || 30}s`}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>

          {/* Start button */}
        <View style={st.footer}>
          {/* Video cache progress */}
          {isCaching && progress.total > 0 && (
            <View style={st.cacheProgress}>
              <ActivityIndicator size="small" color="#F5A623" />
              <Text style={st.cacheText}>
                Caching videos ({progress.completed}/{progress.total})
              </Text>
            </View>
          )}
          <TouchableOpacity style={st.startBtn} onPress={onStart} activeOpacity={0.8}>
            <Icon name="play" size={20} color="#0E1117" />
            <Text style={st.startBtnText}>Start Workout</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 40,
  },
  workoutName: {
    fontSize: 26,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 6,
  },
  workoutDesc: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
    lineHeight: 20,
    marginBottom: 20,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    backgroundColor: '#111827',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    padding: 16,
    marginBottom: 24,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
  },
  statDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#1E2A3A',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  statLabel: {
    fontSize: 11,
    color: '#8A95A3',
    fontFamily: FB,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FH,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    backgroundColor: '#1E2A3A',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 13,
    color: '#F0F4F8',
    fontFamily: FB,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#4A5568',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  checkBoxChecked: {
    backgroundColor: '#F5A623',
    borderColor: '#F5A623',
  },
  checkLabel: {
    fontSize: 15,
    color: '#F0F4F8',
    fontFamily: FB,
  },
  checkLabelChecked: {
    color: '#8A95A3',
    textDecorationLine: 'line-through',
  },
  blockCard: {
    backgroundColor: '#111827',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    padding: 14,
    marginBottom: 12,
  },
  blockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  blockName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  blockType: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
  movementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  movementDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F5A623',
    marginRight: 10,
  },
  movementName: {
    flex: 1,
    fontSize: 14,
    color: '#F0F4F8',
    fontFamily: FB,
  },
  movementMeta: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    marginLeft: 8,
  },
  footer: {
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
    borderTopWidth: 1,
    borderTopColor: '#1E2A3A',
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5A623',
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
  },
  startBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
  cacheProgress: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 10,
  },
  cacheText: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
});
