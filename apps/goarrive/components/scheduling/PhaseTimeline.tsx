import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Icon } from '../Icon';
import { type Phase, resolvePhaseColor } from '../../lib/planTypes';
import { GOLD } from '../../lib/theme';
import { s, SCREEN_W } from './styles';

interface Props {
  planPhases: Phase[] | null;
  totalWeeks: number;
  onNavigateToPlan?: () => void;
}

export function PhaseTimeline({ planPhases, totalWeeks, onNavigateToPlan }: Props) {
  if (!planPhases || planPhases.length === 0) return null;
  const barWidth = SCREEN_W - 80;
  return (
    <View style={s.timelineWrap}>
      <View style={s.timelineHeader}>
        <Text style={s.timelineTitleText}>Plan Phase Timeline</Text>
        <TouchableOpacity
          style={s.editPlanBtn}
          onPress={onNavigateToPlan}
        >
          <Icon name="edit" size={12} color={GOLD} />
          <Text style={s.editPlanBtnText}>Edit Plan</Text>
        </TouchableOpacity>
      </View>
      <View style={s.timelineBar}>
        {planPhases.map((phase, idx) => {
          const pct = totalWeeks > 0 ? (phase.weeks / totalWeeks) : (1 / planPhases.length);
          const color = resolvePhaseColor(phase.intensity);
          return (
            <View
              key={idx}
              style={[
                s.timelineSegment,
                {
                  width: Math.max(pct * barWidth, 30),
                  backgroundColor: color.bar,
                  borderTopLeftRadius: idx === 0 ? 6 : 0,
                  borderBottomLeftRadius: idx === 0 ? 6 : 0,
                  borderTopRightRadius: idx === planPhases.length - 1 ? 6 : 0,
                  borderBottomRightRadius: idx === planPhases.length - 1 ? 6 : 0,
                },
              ]}
            >
              <Text style={s.timelineSegText} numberOfLines={1}>
                {phase.weeks}w
              </Text>
            </View>
          );
        })}
      </View>
      <View style={s.timelineLegend}>
        {planPhases.map((phase, idx) => {
          const color = resolvePhaseColor(phase.intensity);
          return (
            <View key={idx} style={s.legendItem}>
              <View style={[s.legendDot, { backgroundColor: color.bar }]} />
              <Text style={s.legendText}>{phase.name}: {phase.weeks}w</Text>
            </View>
          );
        })}
        <Text style={[s.legendText, { marginLeft: 'auto' }]}>{totalWeeks} weeks total</Text>
      </View>
    </View>
  );
}
