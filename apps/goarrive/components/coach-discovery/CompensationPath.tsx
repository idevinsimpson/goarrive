import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COMPENSATION_TIERS, PROGRAM_TERMS_NOTE } from '../../data/coachDiscoveryScenes';
import { discoveryColors, discoveryFonts } from './tokens';

export function CompensationPath({ isMobile }: { isMobile: boolean }) {
  return (
    <View accessibilityLabel="Progressive compensation tiers" style={styles.wrap}>
      <View style={[styles.tiers, !isMobile && styles.tiersWide]}>
        {COMPENSATION_TIERS.map((tier, index) => (
          <View key={tier.range} style={[styles.card, index === 2 && styles.cardFeatured]}>
            <View style={styles.cardTop}>
              <Text style={styles.tierLabel}>TIER {index + 1}</Text>
              <Text style={styles.range}>{tier.range}</Text>
            </View>
            <View style={styles.shareRow}>
              <Text style={styles.percent}>{tier.coachShare}%</Text>
              <Text style={styles.shareLabel}>coach share</Text>
            </View>
            <View style={styles.bar}>
              <View style={[styles.barCoach, { width: `${tier.coachShare}%` }]} />
              <View style={[styles.barPlatform, { width: `${tier.goArriveShare}%` }]} />
            </View>
            <Text style={styles.platformShare}>{tier.goArriveShare}% GoArrive</Text>
          </View>
        ))}
      </View>
      <Text style={styles.qualifier}>{PROGRAM_TERMS_NOTE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    gap: 16,
  },
  tiers: {
    gap: 12,
  },
  tiersWide: {
    flexDirection: 'row',
  },
  card: {
    flex: 1,
    minHeight: 230,
    padding: 20,
    borderRadius: 20,
    backgroundColor: discoveryColors.surface,
    borderWidth: 1,
    borderColor: discoveryColors.borderSoft,
    justifyContent: 'space-between',
  },
  cardFeatured: {
    borderColor: 'rgba(245,166,35,0.5)',
    backgroundColor: '#19180F',
  },
  cardTop: {
    gap: 8,
  },
  tierLabel: {
    color: discoveryColors.gold,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  range: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
  },
  shareRow: {
    marginTop: 22,
  },
  percent: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 48,
    lineHeight: 52,
    fontWeight: '700',
    letterSpacing: -2,
  },
  shareLabel: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 12,
  },
  bar: {
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    flexDirection: 'row',
    marginTop: 18,
    backgroundColor: discoveryColors.backgroundAlt,
  },
  barCoach: {
    backgroundColor: discoveryColors.gold,
  },
  barPlatform: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  platformShare: {
    color: discoveryColors.muted,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    marginTop: 8,
    textAlign: 'right',
  },
  qualifier: {
    color: discoveryColors.muted,
    fontFamily: discoveryFonts.body,
    fontSize: 11,
    lineHeight: 17,
  },
});
