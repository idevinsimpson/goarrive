/**
 * SwapLogDisplay — Shows movement swaps made during a workout
 *
 * Renders in the coach review queue when a workout_log contains
 * movementSwaps. Helps the coach understand what the member changed
 * and why, so they can adjust future programming.
 *
 * Props:
 *   swaps — array of swap log entries from the workout_log
 */
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Icon } from './Icon';
import { FB, FH } from '../lib/theme';

interface SwapEntry {
  originalName: string;
  originalId?: string;
  swappedName: string;
  swappedId: string;
  category: string;
  reason?: string;
  timestamp: number;
}

interface SwapLogDisplayProps {
  swaps: SwapEntry[];
}

export default function SwapLogDisplay({ swaps }: SwapLogDisplayProps) {
  if (!swaps || swaps.length === 0) return null;

  return (
    <View style={st.container}>
      <View style={st.header}>
        <Icon name="repeat" size={14} color="#F5A623" />
        <Text style={st.title}>
          Movement Swaps ({swaps.length})
        </Text>
      </View>

      {swaps.map((swap, i) => (
        <View key={`${swap.swappedId}-${i}`} style={st.swapRow}>
          <View style={st.swapNames}>
            <Text style={st.originalName} numberOfLines={1}>
              {swap.originalName}
            </Text>
            <Icon name="arrow-right" size={12} color="#8A95A3" />
            <Text style={st.swappedName} numberOfLines={1}>
              {swap.swappedName}
            </Text>
          </View>
          <Text style={st.category}>{swap.category}</Text>
          {swap.reason ? (
            <Text style={st.reason}>"{swap.reason}"</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    backgroundColor: '#1A1F2E',
    borderRadius: 8,
    padding: 12,
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#F5A623',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FH,
  },
  swapRow: {
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#252B3B',
  },
  swapNames: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  originalName: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    textDecorationLine: 'line-through',
    flex: 1,
  },
  swappedName: {
    fontSize: 13,
    color: '#E2E8F0',
    fontFamily: FB,
    fontWeight: '600',
    flex: 1,
  },
  category: {
    fontSize: 11,
    color: '#6B7280',
    fontFamily: FB,
    marginTop: 2,
  },
  reason: {
    fontSize: 11,
    color: '#9CA3AF',
    fontFamily: FB,
    fontStyle: 'italic',
    marginTop: 2,
  },
});
