/**
 * HiddenFromCoachTag — small badge shown to an impersonating admin on
 * settings sections the coach cannot see (coaches/{coachId}.hiddenSettings).
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { FB } from '../lib/theme';

export function HiddenFromCoachTag() {
  return (
    <View style={s.tag}>
      <Text style={s.text}>Hidden from coach</Text>
    </View>
  );
}

const s = StyleSheet.create({
  tag: {
    backgroundColor: 'rgba(224,82,82,0.12)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(224,82,82,0.3)',
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 10,
    fontWeight: '600',
    color: '#E05252',
    fontFamily: FB,
  },
});
