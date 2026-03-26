/**
 * WorkoutSessionSummary — Post-workout session summary screen (Suggestion 8)
 *
 * Shown between workout completion and the journal entry. Displays:
 *   - Total time elapsed
 *   - Movements completed
 *   - Blocks completed
 *   - Movements skipped (if any)
 *   - Personal best indicators (future)
 *   - Motivational message
 *
 * Bridges the gap between "I finished" and "let me reflect."
 * Creates a signature moment of accomplishment.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Icon } from './Icon';

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

interface SessionStats {
  /** Total elapsed time in seconds */
  totalTimeSec: number;
  /** Number of movements completed */
  movementsCompleted: number;
  /** Total movements in the workout */
  totalMovements: number;
  /** Number of movements skipped */
  movementsSkipped: number;
  /** Number of blocks in the workout */
  blocksCompleted: number;
  /** Workout name */
  workoutName: string;
}

interface WorkoutSessionSummaryProps {
  visible: boolean;
  stats: SessionStats;
  onContinueToJournal: () => void;
  onSkipJournal: () => void;
}

const MOTIVATIONAL_MESSAGES = [
  'You showed up. That matters.',
  'Another one in the books.',
  'Consistency builds champions.',
  'Your coach will love seeing this.',
  'Stronger than yesterday.',
  'The work speaks for itself.',
];

function getMotivationalMessage(): string {
  return MOTIVATIONAL_MESSAGES[Math.floor(Math.random() * MOTIVATIONAL_MESSAGES.length)];
}

function formatDuration(totalSec: number): string {
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export default function WorkoutSessionSummary({
  visible,
  stats,
  onContinueToJournal,
  onSkipJournal,
}: WorkoutSessionSummaryProps) {
  const completionPct =
    stats.totalMovements > 0
      ? Math.round((stats.movementsCompleted / stats.totalMovements) * 100)
      : 100;

  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <View style={st.container}>
        {/* Celebration header */}
        <View style={st.celebrationArea}>
          <View style={st.checkCircle}>
            <Icon name="check" size={40} color="#0E1117" />
          </View>
          <Text style={st.title}>Workout Complete!</Text>
          <Text style={st.workoutName}>{stats.workoutName}</Text>
          <Text style={st.motivational}>{getMotivationalMessage()}</Text>
        </View>

        {/* Stats grid */}
        <View style={st.statsGrid}>
          <View style={st.statBox}>
            <Icon name="clock" size={22} color="#F5A623" />
            <Text style={st.statValue}>{formatDuration(stats.totalTimeSec)}</Text>
            <Text style={st.statLabel}>Duration</Text>
          </View>

          <View style={st.statBox}>
            <Icon name="activity" size={22} color="#F5A623" />
            <Text style={st.statValue}>{stats.movementsCompleted}</Text>
            <Text style={st.statLabel}>Movements</Text>
          </View>

          <View style={st.statBox}>
            <Icon name="layers" size={22} color="#F5A623" />
            <Text style={st.statValue}>{stats.blocksCompleted}</Text>
            <Text style={st.statLabel}>Blocks</Text>
          </View>

          <View style={st.statBox}>
            <Icon name="percent" size={22} color={completionPct === 100 ? '#6EBB7A' : '#F5A623'} />
            <Text style={st.statValue}>{completionPct}%</Text>
            <Text style={st.statLabel}>Completed</Text>
          </View>
        </View>

        {/* Skipped indicator */}
        {stats.movementsSkipped > 0 && (
          <View style={st.skippedRow}>
            <Icon name="skip-forward" size={14} color="#8A95A3" />
            <Text style={st.skippedText}>
              {stats.movementsSkipped} movement{stats.movementsSkipped !== 1 ? 's' : ''} skipped
            </Text>
          </View>
        )}

        {/* Actions */}
        <View style={st.actions}>
          <TouchableOpacity
            style={st.journalBtn}
            onPress={onContinueToJournal}
            activeOpacity={0.8}
          >
            <Icon name="edit-3" size={18} color="#0E1117" />
            <Text style={st.journalBtnText}>Reflect on Your Workout</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={st.skipBtn}
            onPress={onSkipJournal}
            activeOpacity={0.7}
          >
            <Text style={st.skipBtnText}>Skip for Now</Text>
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
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  celebrationArea: {
    alignItems: 'center',
    marginBottom: 36,
  },
  checkCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F5A623',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: '#F0F4F8',
    fontFamily: FH,
    marginBottom: 6,
  },
  workoutName: {
    fontSize: 16,
    color: '#8A95A3',
    fontFamily: FB,
    marginBottom: 12,
  },
  motivational: {
    fontSize: 15,
    color: '#F5A623',
    fontFamily: FB,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 12,
    marginBottom: 20,
    maxWidth: 340,
  },
  statBox: {
    width: 150,
    backgroundColor: '#111827',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1E2A3A',
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  statLabel: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
  },
  skippedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 24,
  },
  skippedText: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
  },
  actions: {
    width: '100%',
    maxWidth: 340,
    gap: 12,
    marginTop: 12,
  },
  journalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5A623',
    borderRadius: 14,
    paddingVertical: 16,
    gap: 8,
  },
  journalBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },
  skipBtn: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipBtnText: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
  },
});
