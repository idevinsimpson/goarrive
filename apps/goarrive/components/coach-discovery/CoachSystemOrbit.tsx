import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SYSTEM_NODES } from '../../data/coachDiscoveryScenes';
import { AccessibleImage } from './AccessibleImage';
import { discoveryColors, discoveryFonts } from './tokens';

const NODE_POSITIONS = [
  { top: 2, left: '39%' },
  { top: '18%', right: 0 },
  { top: '48%', right: -2 },
  { bottom: 2, right: '20%' },
  { bottom: 2, left: '18%' },
  { top: '48%', left: -2 },
  { top: '18%', left: 0 },
] as const;

export function CoachSystemOrbit() {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Connected GoArrive system: coach, member, plan, workout, Zoom, review, and growth."
      style={styles.orbit}
    >
      <View style={styles.ringOuter} />
      <View style={styles.ringInner} />
      <View style={styles.center}>
        <AccessibleImage
          source={require('../../assets/logo.png')}
          webSource="/goarrive-logo.png"
          resizeMode="contain"
          label="GoArrive"
          style={styles.logo}
        />
        <Text style={styles.centerLabel}>COACHING{`\n`}OPERATING SYSTEM</Text>
      </View>
      {SYSTEM_NODES.map((node, index) => (
        <View key={node} style={[styles.node, NODE_POSITIONS[index] as any]}>
          <View style={styles.nodeDot} />
          <Text style={styles.nodeText}>{node}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  orbit: {
    width: 350,
    height: 350,
    maxWidth: '100%',
    alignSelf: 'center',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringOuter: {
    position: 'absolute',
    width: 290,
    height: 290,
    borderRadius: 145,
    borderWidth: 1,
    borderColor: 'rgba(91,155,213,0.34)',
  },
  ringInner: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 1,
    borderColor: 'rgba(110,187,122,0.16)',
  },
  center: {
    width: 168,
    height: 168,
    borderRadius: 84,
    backgroundColor: discoveryColors.surfaceElevated,
    borderWidth: 1,
    borderColor: 'rgba(91,155,213,0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    shadowColor: discoveryColors.blue,
    shadowOpacity: 0.24,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
  },
  logo: {
    width: 120,
    height: 34,
  },
  centerLabel: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 1.2,
    textAlign: 'center',
    marginTop: 8,
  },
  node: {
    position: 'absolute',
    minWidth: 78,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(14,20,34,0.94)',
    borderWidth: 1,
    borderColor: discoveryColors.borderSoft,
  },
  nodeDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: discoveryColors.blue,
  },
  nodeText: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.body,
    fontSize: 10,
    fontWeight: '600',
  },
});
