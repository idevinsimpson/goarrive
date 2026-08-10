import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DiscoverySceneMeta } from '../../data/coachDiscoveryScenes';
import { accentColor, discoveryColors, discoveryFonts } from './tokens';

interface ProgressIndicatorProps {
  current: number;
  total: number;
  scene: DiscoverySceneMeta;
  isMobile: boolean;
}

export function ProgressIndicator({ current, total, scene, isMobile }: ProgressIndicatorProps) {
  const insets = useSafeAreaInsets();
  const progress = Math.max(0, Math.min(1, current / total));
  return (
    <View
      pointerEvents="none"
      accessibilityLabel={`Scene ${current} of ${total}. ${scene.actLabel}.`}
      style={[
        styles.wrap,
        isMobile ? styles.wrapMobile : styles.wrapDesktop,
        Platform.OS === 'web' && ({ position: 'fixed' } as any),
        isMobile && Platform.OS === 'web' && ({ paddingTop: 'max(9px, env(safe-area-inset-top, 0px))' } as any),
        isMobile && Platform.OS !== 'web' && { paddingTop: Math.max(9, insets.top + 6) },
      ]}
    >
      <View style={[styles.copy, isMobile && styles.copyMobile]}>
        <Text style={[styles.number, { color: accentColor(scene.accent) }]}>
          {String(current).padStart(2, '0')}
        </Text>
        <Text style={styles.total}>/ {String(total).padStart(2, '0')}</Text>
        {!isMobile && <Text style={styles.act}>{scene.actLabel}</Text>}
      </View>
      <View style={[styles.track, isMobile ? styles.trackMobile : styles.trackDesktop]}>
        <View
          style={[
            styles.fill,
            isMobile ? { width: `${progress * 100}%` } : { height: `${progress * 100}%` },
            { backgroundColor: accentColor(scene.accent) },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    zIndex: 1000,
  },
  wrapMobile: {
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 9,
    paddingHorizontal: 14,
    paddingBottom: 8,
    backgroundColor: 'rgba(8,11,18,0.82)',
    borderBottomWidth: 1,
    borderBottomColor: discoveryColors.borderSoft,
  },
  wrapDesktop: {
    top: '50%',
    right: 22,
    width: 78,
    transform: [{ translateY: -110 }],
    alignItems: 'flex-end',
  },
  copy: {
    alignItems: 'flex-end',
    gap: 2,
  },
  copyMobile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 7,
  },
  number: {
    fontFamily: discoveryFonts.heading,
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '700',
  },
  total: {
    color: discoveryColors.muted,
    fontFamily: discoveryFonts.body,
    fontSize: 9,
    lineHeight: 12,
  },
  act: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 9,
    lineHeight: 13,
    textAlign: 'right',
    marginTop: 5,
    maxWidth: 72,
  },
  track: {
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  trackMobile: {
    width: '100%',
    height: 2,
    borderRadius: 1,
  },
  trackDesktop: {
    width: 2,
    height: 130,
    marginTop: 14,
    borderRadius: 1,
  },
  fill: {
    borderRadius: 1,
  },
});
