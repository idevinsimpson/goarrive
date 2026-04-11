/**
 * FunnelFeatures — canonical "What you'll get" section matching jv.goarrive.fit
 *
 * Dark cards with icon containers, horizontal layout.
 * Shared by builder preview and public funnel page.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Icon } from '../../Icon';

const GREEN = '#7BA05B';
const GREEN_10 = 'rgba(123,160,91,0.10)';

const FEATURES = [
  {
    icon: 'clipboard' as const,
    title: 'Custom Workout Plan',
    desc: 'Workouts designed for your goals, equipment, and schedule — not a generic template.',
  },
  {
    icon: 'message-circle' as const,
    title: '1-on-1 Coaching',
    desc: 'Direct access to your coach for guidance, form checks, and real accountability.',
  },
  {
    icon: 'play-circle' as const,
    title: 'Guided Video Workouts',
    desc: 'Follow along with every rep, every set — timed and ready to go in the app.',
  },
];

export function FunnelFeatures() {
  return (
    <View style={s.wrap}>
      <View style={s.divider} />

      <Text style={s.heading}>What you'll get</Text>
      <Text style={s.subtitle}>
        Everything you need to finally see real results.
      </Text>

      <View style={s.cards}>
        {FEATURES.map((f, i) => (
          <View key={i} style={s.card}>
            <View style={s.iconWrap}>
              <Icon name={f.icon} size={20} color={GREEN} />
            </View>
            <View style={s.cardText}>
              <Text style={s.cardTitle}>{f.title}</Text>
              <Text style={s.cardDesc}>{f.desc}</Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingTop: 48,
    paddingBottom: 32,
    position: 'relative',
  },
  divider: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    height: 1,
    backgroundColor: '#2A2E3A',
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: '#E8EAF0',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#7A7F94',
    marginBottom: 32,
  },
  cards: { gap: 16 },
  card: {
    flexDirection: 'row',
    gap: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#12141C',
    borderWidth: 1,
    borderColor: '#1E2130',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: GREEN_10,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  cardText: { flex: 1 },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E8EAF0',
    marginBottom: 4,
  },
  cardDesc: {
    fontSize: 12,
    color: '#7A7F94',
    lineHeight: 18,
  },
});
