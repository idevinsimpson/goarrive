import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { GROWTH_PATHWAYS, PROGRAM_TERMS_NOTE } from '../../data/coachDiscoveryScenes';
import { discoveryColors, discoveryFonts } from './tokens';

export function GrowthPathways({ isMobile }: { isMobile: boolean }) {
  return (
    <View style={styles.wrap}>
      <View style={[styles.grid, !isMobile && styles.gridWide]}>
        {GROWTH_PATHWAYS.map((path, index) => {
          const planned = path.label.startsWith('PLANNED');
          return (
            <View key={path.title} style={[styles.card, isMobile && styles.cardMobile, planned && styles.plannedCard]}>
              <View style={styles.numberRow}>
                <Text style={styles.number}>{String(index + 1).padStart(2, '0')}</Text>
                <Text style={[styles.label, planned && styles.plannedLabel]}>{path.label}</Text>
              </View>
              <Text style={styles.title}>{path.title}</Text>
              <Text style={styles.detail}>{path.detail}</Text>
            </View>
          );
        })}
      </View>
      <Text style={styles.note}>{PROGRAM_TERMS_NOTE}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    gap: 16,
  },
  grid: {
    gap: 12,
  },
  gridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  card: {
    flexBasis: '46%',
    minHeight: 210,
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: discoveryColors.borderSoft,
    backgroundColor: discoveryColors.surface,
  },
  cardMobile: {
    flexBasis: 'auto',
  },
  plannedCard: {
    borderStyle: 'dashed',
    borderColor: 'rgba(245,166,35,0.48)',
    backgroundColor: 'rgba(245,166,35,0.05)',
  },
  numberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  number: {
    color: discoveryColors.gold,
    fontFamily: discoveryFonts.heading,
    fontSize: 13,
    fontWeight: '700',
  },
  label: {
    color: discoveryColors.gold,
    fontFamily: discoveryFonts.body,
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 1,
    fontWeight: '700',
    textAlign: 'right',
  },
  plannedLabel: {
    color: discoveryColors.textSoft,
    maxWidth: 150,
  },
  title: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '700',
    marginTop: 28,
  },
  detail: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
  },
  note: {
    color: discoveryColors.muted,
    fontFamily: discoveryFonts.body,
    fontSize: 11,
    lineHeight: 17,
  },
});
