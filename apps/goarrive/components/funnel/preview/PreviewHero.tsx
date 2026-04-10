import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  headline: string;
  subheadline: string;
  bullets: string[];
}

export function PreviewHero({ headline, subheadline, bullets }: Props) {
  return (
    <View style={s.wrap}>
      <Text style={s.headline}>{headline}</Text>
      <Text style={s.subheadline}>{subheadline}</Text>
      <View style={s.bullets}>
        {bullets.map((b, i) => (
          <View key={i} style={s.bulletRow}>
            <Text style={s.check}>✓</Text>
            <Text style={s.bulletText}>{b}</Text>
          </View>
        ))}
      </View>
      <View style={s.cta}>
        <Text style={s.ctaText}>Build My Plan</Text>
      </View>
      <Text style={s.micro}>Takes 2 minutes. No commitment required.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 24 },
  headline: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1A1A2E',
    lineHeight: 28,
    marginBottom: 10,
  },
  subheadline: {
    fontSize: 13,
    color: '#4B5563',
    lineHeight: 19,
    marginBottom: 16,
  },
  bullets: { gap: 8, marginBottom: 20 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  check: { fontSize: 14, color: '#6EBB7A', fontWeight: '700', marginTop: 1 },
  bulletText: { fontSize: 13, color: '#374151', flex: 1, lineHeight: 18 },
  cta: {
    backgroundColor: '#F5A623',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  ctaText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  micro: { fontSize: 11, color: '#9CA3AF', textAlign: 'center' },
});
