/**
 * Workouts screen — Coming Soon placeholder
 *
 * The workout library is being re-imagined. This placeholder replaces the
 * previous implementation until the new design is ready.
 */
import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { AppHeader } from '../../components/AppHeader';

const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

export default function WorkoutsScreen() {
  return (
    <View style={s.root}>
      <AppHeader />
      <View style={s.body}>
        <View style={s.iconWrap}>
          <Text style={s.icon}>🏋️</Text>
        </View>
        <Text style={s.title}>Workouts</Text>
        <View style={s.badge}>
          <Text style={s.badgeText}>COMING SOON</Text>
        </View>
        <Text style={s.desc}>
          The workout library is being re-imagined to support custom workout
          creation, movement libraries, and intelligent playlist rotation for
          your members.
        </Text>
        <Text style={s.hint}>
          Stay tuned — this will be one of the most powerful features in
          GoArrive.
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: 14,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: 'rgba(245,166,35,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  icon: {
    fontSize: 36,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    textAlign: 'center',
  },
  badge: {
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    letterSpacing: 1.5,
  },
  desc: {
    fontSize: 15,
    color: '#8A95A3',
    fontFamily: FB,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 4,
  },
  hint: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FB,
    textAlign: 'center',
    lineHeight: 20,
  },
});
