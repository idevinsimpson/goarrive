import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { Icon } from '../Icon';
import { BLUE, GREEN, MUTED, FG, FH, FB } from '../../lib/theme';
import { type ScheduleState } from '../../hooks/useScheduleState';
import { timeToMinutes } from './constants';

interface Props {
  state: ScheduleState;
  memberId: string;
  handleDragDrop: (slotId: string, newDay: number, newMinutes: number) => void;
}

export function CalendarView({ state, memberId, handleDragDrop }: Props) {
  const { allCoachSlots, showCalendarView, setShowCalendarView, selectedDuration, dragPreview, dragSlot, setDragSlot } = state;

  if (!allCoachSlots.length) return null;
  // Compute hour range from all slots
  let minHour = 24, maxHour = 0;
  for (const slot of allCoachSlots) {
    const mins = timeToMinutes(slot.startTime || '06:00');
    const endMins = mins + (slot.durationMinutes || 30);
    minHour = Math.min(minHour, Math.floor(mins / 60));
    maxHour = Math.max(maxHour, Math.ceil(endMins / 60));
  }
  if (minHour >= maxHour) { minHour = 5; maxHour = 21; }
  minHour = Math.max(0, minHour - 1);
  maxHour = Math.min(24, maxHour + 1);
  const hours = Array.from({ length: maxHour - minHour }, (_, i) => minHour + i);
  const HOUR_HEIGHT = 32;
  return (
    <View style={{ paddingHorizontal: 16, marginBottom: 8 }}>
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
        onPress={() => setShowCalendarView(!showCalendarView)}
      >
        <Icon name={showCalendarView ? 'chevron-down' : 'chevron-right'} size={14} color={BLUE} />
        <Text style={{ fontSize: 12, color: BLUE, fontFamily: FH }}>Weekly Calendar (All Members)</Text>
      </TouchableOpacity>
      {showCalendarView && (() => {
        return (
        <View style={{ marginTop: 8, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}>
          {/* Header row */}
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: 30, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center' }}>
              <Text style={{ fontSize: 8, color: MUTED, fontFamily: FH }}> </Text>
            </View>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <View key={day} style={{ flex: 1, paddingVertical: 4, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.05)' }}>
                <Text style={{ fontSize: 9, color: MUTED, fontFamily: FH }}>{day}</Text>
              </View>
            ))}
          </View>
          {/* Time grid */}
          <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
            <View style={{ flexDirection: 'row', height: hours.length * HOUR_HEIGHT }}>
              {/* Time axis */}
              <View style={{ width: 30 }}>
                {hours.map(h => (
                  <View key={h} style={{ height: HOUR_HEIGHT, justifyContent: 'flex-start', paddingTop: 1, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)' }}>
                    <Text style={{ fontSize: 7, color: MUTED, fontFamily: FB, textAlign: 'right', paddingRight: 3 }}>
                      {h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`}
                    </Text>
                  </View>
                ))}
              </View>
              {/* Day columns */}
              {[1, 2, 3, 4, 5, 6, 0].map((dayIdx) => {
                const daySlots = allCoachSlots.filter(cs => cs.dayOfWeek === dayIdx);
                return (
                  <View key={dayIdx} style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.04)', position: 'relative' }}>
                    {/* Hour grid lines */}
                    {hours.map(h => (
                      <View key={h} style={{ position: 'absolute', top: (h - minHour) * HOUR_HEIGHT, left: 0, right: 0, height: 1, backgroundColor: 'rgba(255,255,255,0.04)' }} />
                    ))}
                    {/* Drag-and-drop preview */}
                    {dragPreview && dragPreview.day === dayIdx && (
                      <View style={{ position: 'absolute', top: ((dragPreview.min / 60) - minHour) * HOUR_HEIGHT, left: 0, right: 0, height: Math.max(12, (selectedDuration / 60) * HOUR_HEIGHT), backgroundColor: 'rgba(91,155,213,0.3)', borderRadius: 2, borderWidth: 1, borderColor: BLUE, borderStyle: 'dashed' }} />
                    )}
                    {/* Slot blocks */}
                    {daySlots.map((slot: any) => {
                      const mins = timeToMinutes(slot.startTime || '06:00');
                      const top = ((mins / 60) - minHour) * HOUR_HEIGHT;
                      const height = Math.max(12, ((slot.durationMinutes || 30) / 60) * HOUR_HEIGHT);
                      const isCurrentMember = slot.memberId === memberId;
                      const isDragging = dragSlot?.id === slot.id;
                      const phaseColors: Record<string, string> = { coach_guided: GREEN, shared_guidance: BLUE, self_guided: '#FFC000' };
                      const borderColor = phaseColors[slot.guidancePhase] || MUTED;
                      return (
                        <TouchableOpacity
                          key={slot.id}
                          activeOpacity={0.7}
                          delayLongPress={400}
                          onLongPress={() => {
                            if (isCurrentMember) {
                              setDragSlot({ id: slot.id, startY: 0, startDay: dayIdx, startMin: mins });
                              Alert.alert(
                                'Move Slot',
                                `Drag ${slot.memberName}'s ${slot.startTime} slot to a new time.\n\nSelect a new time:`,
                                [
                                  { text: 'Cancel', style: 'cancel', onPress: () => setDragSlot(null) },
                                  { text: '30 min earlier', onPress: () => handleDragDrop(slot.id, dayIdx, Math.max(0, mins - 30)) },
                                  { text: '30 min later', onPress: () => handleDragDrop(slot.id, dayIdx, Math.min(1410, mins + 30)) },
                                  { text: '1 hour earlier', onPress: () => handleDragDrop(slot.id, dayIdx, Math.max(0, mins - 60)) },
                                  { text: '1 hour later', onPress: () => handleDragDrop(slot.id, dayIdx, Math.min(1410, mins + 60)) },
                                ]
                              );
                            }
                          }}
                          style={{ position: 'absolute', top, left: 1, right: 1, height, backgroundColor: isDragging ? 'rgba(91,155,213,0.4)' : isCurrentMember ? 'rgba(91,155,213,0.2)' : 'rgba(255,255,255,0.06)', borderRadius: 2, borderLeftWidth: 2, borderLeftColor: borderColor, padding: 1, overflow: 'hidden' }}
                        >
                          <Text style={{ fontSize: 6, color: isCurrentMember ? BLUE : MUTED, fontFamily: FH }} numberOfLines={1}>
                            {slot.startTime?.slice(0, 5)}
                          </Text>
                          <Text style={{ fontSize: 6, color: isCurrentMember ? FG : MUTED, fontFamily: FB }} numberOfLines={1}>
                            {slot.memberName?.split(' ')[0] || '?'}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
            </View>
          </ScrollView>
        </View>
        );
      })()}
    </View>
  );
}
