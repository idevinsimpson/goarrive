/**
 * FunnelTestimonials — canonical testimonials section matching jv.goarrive.fit
 *
 * Dark bg, gradient divider, italic quotes, green author names.
 * Shared by builder preview and public funnel page.
 */
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Testimonial } from '../../../lib/funnelDefaults';

interface Props {
  testimonials: Testimonial[];
}

export function FunnelTestimonials({ testimonials }: Props) {
  if (!testimonials.length) return null;

  return (
    <View style={s.wrap}>
      <View style={s.divider} />

      <Text style={s.heading}>Real people. Real results.</Text>
      <Text style={s.subtitle}>
        Hear from members who train with GoArrive.
      </Text>

      {testimonials.map((t, i) => (
        <View key={i} style={s.quoteWrap}>
          <Text style={s.quoteIcon}>{'\u201C'}</Text>
          <Text style={s.quote}>{t.text}</Text>
          <Text style={s.author}>— {t.name}</Text>
        </View>
      ))}
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
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#7A7F94',
    marginBottom: 24,
  },
  quoteWrap: {
    marginBottom: 20,
  },
  quoteIcon: {
    fontSize: 32,
    color: 'rgba(123,160,91,0.25)',
    fontWeight: '700',
    lineHeight: 32,
    marginBottom: 2,
  },
  quote: {
    fontSize: 15,
    color: '#C8CCD6',
    lineHeight: 23,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  author: {
    fontSize: 14,
    color: '#7BA05B',
    fontWeight: '500',
  },
});
