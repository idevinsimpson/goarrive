/**
 * FunnelHero — canonical hero section matching jv.goarrive.fit
 *
 * Full-width 3:4 coach photo with gradient overlay + coach name,
 * headline, subheadline, green-circle bullet points, green CTA button.
 * Shared by builder preview and public funnel page.
 */
import React from 'react';
import { View, Text, Image, StyleSheet, Platform } from 'react-native';
import { Icon } from '../../Icon';

const PAGE_BG = '#0A0C12';
const GREEN = '#7BA05B';
const GREEN_20 = 'rgba(123,160,91,0.20)';

interface Props {
  headline: string;
  subheadline: string;
  bullets: string[];
  photoUrl: string;
  coachName: string;
}

export function FunnelHero({
  headline,
  subheadline,
  bullets,
  photoUrl,
  coachName,
}: Props) {
  const initials = coachName
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <View style={s.wrap}>
      {/* Logo */}
      <Text style={s.logo}>G➲A</Text>

      {/* Hero image with gradient + coach name overlay */}
      <View style={s.imageWrap}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={s.heroImage} />
        ) : (
          <View style={[s.heroImage, s.imagePlaceholder]}>
            <Icon name="camera" size={48} color="#2A2E3A" />
            <Text style={s.placeholderText}>Add your photo</Text>
          </View>
        )}
        {/* Bottom gradient overlay */}
        <View style={s.gradientOverlay} />
        {/* Coach name */}
        <View style={s.nameOverlay}>
          <Text style={s.coachLabel}>Your Coach</Text>
          <Text style={s.coachName}>{coachName || 'Coach Name'}</Text>
        </View>
      </View>

      {/* Headline */}
      <Text style={s.headline}>{headline}</Text>

      {/* Subheadline */}
      <Text style={s.subheadline}>{subheadline}</Text>

      {/* Bullets */}
      <View style={s.bullets}>
        {bullets.map((b, i) => (
          <View key={i} style={s.bulletRow}>
            <View style={s.checkCircle}>
              <Icon name="check" size={12} color={GREEN} />
            </View>
            <Text style={s.bulletText}>{b}</Text>
          </View>
        ))}
      </View>

      {/* CTA */}
      <View style={s.cta}>
        <Text style={s.ctaText}>Build My Plan</Text>
        <Icon name="arrow-right" size={18} color="#FFF" />
      </View>
      <Text style={s.micro}>Takes 2 minutes. No commitment required.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
  },

  logo: {
    fontSize: 20,
    fontWeight: '800',
    color: '#E8EAF0',
    letterSpacing: 0.5,
    marginBottom: 24,
  },

  // Hero image
  imageWrap: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#12141C',
    marginBottom: 24,
    position: 'relative',
  },
  heroImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  imagePlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  placeholderText: {
    fontSize: 14,
    color: '#3A4558',
    fontWeight: '500',
  },
  gradientOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
    ...(Platform.OS === 'web'
      ? ({
          background:
            'linear-gradient(to top, rgba(10,12,18,0.8), transparent)',
        } as any)
      : { backgroundColor: 'rgba(10,12,18,0.45)' }),
  },
  nameOverlay: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    right: 16,
  },
  coachLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: GREEN,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  coachName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // Headline
  headline: {
    fontSize: 28,
    fontWeight: '700',
    color: '#E8EAF0',
    lineHeight: 34,
    marginBottom: 12,
  },

  // Subheadline
  subheadline: {
    fontSize: 15,
    color: '#9498A8',
    lineHeight: 23,
    marginBottom: 20,
  },

  // Bullets
  bullets: { gap: 12, marginBottom: 24 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: GREEN_20,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  bulletText: { fontSize: 14, color: '#C8CCD6', flex: 1, lineHeight: 20 },

  // CTA
  cta: {
    backgroundColor: GREEN,
    borderRadius: 12,
    paddingVertical: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  ctaText: { fontSize: 16, fontWeight: '600', color: '#FFF' },
  micro: { fontSize: 12, color: '#7A7F94', textAlign: 'center' },
});
