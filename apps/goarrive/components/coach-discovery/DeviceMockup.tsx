import React from 'react';
import {
  ImageSourcePropType,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import type { DiscoveryAccent } from '../../data/coachDiscoveryScenes';
import { AccessibleImage } from './AccessibleImage';
import { accentColor, accentSoft, discoveryColors, discoveryFonts } from './tokens';

interface DeviceMockupProps {
  title: string;
  caption?: string;
  variant?: 'phone' | 'laptop' | 'panel';
  accent?: DiscoveryAccent;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
  source?: ImageSourcePropType;
  webSource?: string;
  imageLabel?: string;
}

export function DeviceMockup({
  title,
  caption,
  variant = 'phone',
  accent = 'blue',
  style,
  compact = false,
  source,
  webSource,
  imageLabel,
}: DeviceMockupProps) {
  const color = accentColor(accent);
  const hasProductCapture = Boolean(source && webSource && imageLabel);
  return (
    <View
      accessibilityLabel={hasProductCapture ? undefined : `${title}. Approved demo screenshot placeholder.`}
      style={[
        styles.frame,
        variant === 'phone' && styles.phone,
        variant === 'laptop' && styles.laptop,
        variant === 'panel' && styles.panel,
        compact && styles.compact,
        style,
      ]}
    >
      <View style={styles.chrome}>
        {variant !== 'phone' && (
          <View style={styles.dots}>
            <View style={styles.dot} />
            <View style={styles.dot} />
            <View style={styles.dot} />
          </View>
        )}
        {variant === 'phone' && <View style={styles.island} />}
      </View>
      <View
        style={[
          styles.screen,
          hasProductCapture && styles.captureScreen,
          hasProductCapture && variant === 'phone' && styles.phoneCaptureScreen,
        ]}
      >
        {source && webSource && imageLabel ? (
          <AccessibleImage
            source={source}
            webSource={webSource}
            label={imageLabel}
            resizeMode="contain"
            style={[styles.productCapture, variant === 'phone' && styles.phoneProductCapture]}
          />
        ) : (
          <>
            <View style={[styles.screenGlow, { backgroundColor: accentSoft(accent) }]} />
            <View style={styles.slotLabel}>
              <View style={[styles.slotDot, { backgroundColor: color }]} />
              <Text style={[styles.slotText, { color }]}>APP SCREENSHOT SLOT</Text>
            </View>
            <Text style={styles.title}>{title}</Text>
            {!!caption && <Text style={styles.caption}>{caption}</Text>}
            <View style={styles.demoUi}>
              <View style={styles.uiRail}>
                <View style={[styles.uiRailItem, { backgroundColor: color }]} />
                <View style={styles.uiRailItem} />
                <View style={styles.uiRailItem} />
              </View>
              <View style={styles.uiBody}>
                <View style={[styles.uiHeadline, { width: '68%' }]} />
                <View style={[styles.uiLine, { width: '88%' }]} />
                <View style={[styles.uiLine, { width: '74%' }]} />
                <View style={styles.uiCards}>
                  <View style={[styles.uiCard, { borderColor: color }]} />
                  <View style={styles.uiCard} />
                </View>
              </View>
            </View>
            <Text style={styles.replaceText}>Replace with sanitized demo data capture</Text>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    backgroundColor: '#05070B',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
    elevation: 8,
  },
  phone: {
    width: 250,
    minHeight: 470,
    borderRadius: 34,
    padding: 7,
  },
  laptop: {
    width: '100%',
    maxWidth: 700,
    minHeight: 390,
    borderRadius: 18,
    padding: 7,
  },
  panel: {
    width: '100%',
    minHeight: 300,
    borderRadius: 22,
    padding: 6,
  },
  compact: {
    minHeight: 220,
  },
  chrome: {
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dots: {
    position: 'absolute',
    left: 10,
    flexDirection: 'row',
    gap: 5,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  island: {
    width: 70,
    height: 14,
    borderRadius: 8,
    backgroundColor: '#000',
  },
  screen: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: discoveryColors.backgroundAlt,
    padding: 18,
  },
  captureScreen: {
    padding: 0,
    backgroundColor: '#080B12',
  },
  phoneCaptureScreen: {
    minHeight: 430,
  },
  productCapture: {
    width: '100%',
    height: '100%',
  },
  phoneProductCapture: {
    height: 430,
  },
  screenGlow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    right: -80,
    top: -100,
    opacity: 0.8,
  },
  slotLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 14,
  },
  slotDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  slotText: {
    fontFamily: discoveryFonts.body,
    fontSize: 9,
    letterSpacing: 1.3,
    fontWeight: '700',
  },
  title: {
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '700',
  },
  caption: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
  },
  demoUi: {
    flex: 1,
    flexDirection: 'row',
    minHeight: 150,
    marginTop: 20,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.035)',
    borderWidth: 1,
    borderColor: discoveryColors.borderSoft,
  },
  uiRail: {
    width: 32,
    alignItems: 'center',
    paddingTop: 13,
    gap: 10,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  uiRailItem: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  uiBody: {
    flex: 1,
    padding: 15,
    gap: 8,
  },
  uiHeadline: {
    height: 9,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.34)',
    marginBottom: 4,
  },
  uiLine: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  uiCards: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  uiCard: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: discoveryColors.borderSoft,
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  replaceText: {
    color: discoveryColors.muted,
    fontFamily: discoveryFonts.body,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 10,
    textAlign: 'center',
  },
});
