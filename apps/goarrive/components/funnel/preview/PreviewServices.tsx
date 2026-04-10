import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const SERVICES = [
  { icon: '📋', title: 'Custom Workout Plan', desc: 'Personalized programming designed for your goals and schedule.' },
  { icon: '💬', title: '1-on-1 Coaching', desc: 'Direct access to your coach for guidance, feedback, and accountability.' },
  { icon: '🎬', title: 'Guided Video Workouts', desc: 'Follow along with video demonstrations for every movement.' },
];

export function PreviewServices() {
  return (
    <View style={s.wrap}>
      <Text style={s.heading}>What you'll get</Text>
      <View style={s.cards}>
        {SERVICES.map((svc, i) => (
          <View key={i} style={s.card}>
            <Text style={s.icon}>{svc.icon}</Text>
            <Text style={s.title}>{svc.title}</Text>
            <Text style={s.desc}>{svc.desc}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingVertical: 24 },
  heading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 14,
    textAlign: 'center',
  },
  cards: { gap: 10 },
  card: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  icon: { fontSize: 22, marginBottom: 6 },
  title: { fontSize: 14, fontWeight: '700', color: '#1A1A2E', marginBottom: 4 },
  desc: { fontSize: 12, color: '#6B7280', lineHeight: 17 },
});
