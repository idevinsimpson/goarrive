import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Testimonial } from '../../../lib/funnelDefaults';

interface Props {
  testimonials: Testimonial[];
}

export function PreviewSocialProof({ testimonials }: Props) {
  if (!testimonials.length) return null;
  return (
    <View style={s.wrap}>
      <Text style={s.heading}>Real people. Real results.</Text>
      {testimonials.map((t, i) => (
        <View key={i} style={s.card}>
          <Text style={s.quote}>"{t.text}"</Text>
          <Text style={s.name}>— {t.name}</Text>
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    backgroundColor: '#F9FAFB',
  },
  heading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 14,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#FFF',
    borderRadius: 10,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  quote: { fontSize: 13, color: '#374151', lineHeight: 18, fontStyle: 'italic' },
  name: { fontSize: 12, color: '#6B7280', marginTop: 8, fontWeight: '600' },
});
