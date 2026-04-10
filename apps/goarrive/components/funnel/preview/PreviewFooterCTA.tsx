import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface Props {
  coachName: string;
}

export function PreviewFooterCTA({ coachName }: Props) {
  return (
    <View style={s.wrap}>
      <Text style={s.heading}>Ready to get started?</Text>
      <View style={s.cta}>
        <Text style={s.ctaText}>
          Get Started{coachName ? ` with ${coachName.split(' ')[0]}` : ''}
        </Text>
      </View>
      <Text style={s.micro}>No spam. No commitment.</Text>
      <Text style={s.powered}>Powered by GoArrive</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 32,
    alignItems: 'center',
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 14,
  },
  cta: {
    backgroundColor: '#F5A623',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 32,
    marginBottom: 8,
  },
  ctaText: { fontSize: 15, fontWeight: '700', color: '#FFF' },
  micro: { fontSize: 11, color: '#9CA3AF', marginBottom: 16 },
  powered: { fontSize: 10, color: '#D1D5DB', letterSpacing: 0.3 },
});
