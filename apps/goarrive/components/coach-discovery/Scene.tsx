import React, { ReactNode, useMemo, useState } from 'react';
import {
  Animated,
  LayoutChangeEvent,
  Platform,
  StyleProp,
  StyleSheet,
  Text,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import type { DiscoverySceneMeta } from '../../data/coachDiscoveryScenes';
import { accentColor, discoveryColors, discoveryFonts } from './tokens';

interface SceneProps {
  meta: DiscoverySceneMeta;
  scrollY: Animated.Value;
  viewportHeight: number;
  reducedMotion: boolean;
  presentationMode: boolean;
  onSceneLayout: (number: number, y: number) => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  minHeightMultiplier?: number;
}

export function Scene({
  meta,
  scrollY,
  viewportHeight,
  reducedMotion,
  presentationMode,
  onSceneLayout,
  children,
  style,
  contentStyle,
  minHeightMultiplier = 1,
}: SceneProps) {
  const [sceneY, setSceneY] = useState(0);
  const minHeight = Math.max(720, viewportHeight * minHeightMultiplier);

  const animationStyle = useMemo(() => {
    if (reducedMotion) return undefined;
    const opacity = scrollY.interpolate({
      inputRange: [sceneY - viewportHeight * 0.95, sceneY - viewportHeight * 0.5, sceneY + viewportHeight * 0.55],
      outputRange: [0.2, 1, 1],
      extrapolate: 'clamp',
    });
    const translateY = scrollY.interpolate({
      inputRange: [sceneY - viewportHeight, sceneY - viewportHeight * 0.5],
      outputRange: [28, 0],
      extrapolate: 'clamp',
    });
    return { opacity, transform: [{ translateY }] };
  }, [reducedMotion, sceneY, scrollY, viewportHeight]);

  const onLayout = (event: LayoutChangeEvent) => {
    const y = event.nativeEvent.layout.y;
    setSceneY(y);
    onSceneLayout(meta.number, y);
  };

  return (
    <View
      nativeID={`coach-discovery-scene-${meta.number}`}
      onLayout={onLayout}
      accessibilityLabel={`Scene ${meta.number} of 27. ${meta.headline.replace(/\n/g, ' ')}`}
      style={[
        styles.scene,
        { minHeight },
        presentationMode && Platform.OS === 'web' && ({ scrollSnapAlign: 'start' } as any),
        style,
      ]}
    >
      <Animated.View style={[styles.reveal, { minHeight }, animationStyle, contentStyle]}>{children}</Animated.View>
    </View>
  );
}

export function SceneHeading({
  meta,
  align = 'left',
  size = 'large',
  style,
}: {
  meta: DiscoverySceneMeta;
  align?: 'left' | 'center';
  size?: 'large' | 'medium';
  style?: StyleProp<TextStyle>;
}) {
  const headlineStyles = [
    styles.heading,
    size === 'medium' && styles.headingMedium,
    align === 'center' && styles.centerText,
    style,
  ];
  const flattenedHeadlineStyles = StyleSheet.flatten(headlineStyles) as TextStyle;
  const webHeadlineStyles = {
    ...flattenedHeadlineStyles,
    lineHeight: typeof flattenedHeadlineStyles?.lineHeight === 'number'
      ? `${flattenedHeadlineStyles.lineHeight}px`
      : flattenedHeadlineStyles?.lineHeight,
  };

  return (
    <View style={[styles.headingWrap, align === 'center' && styles.centered]}>
      <Text style={[styles.eyebrow, { color: accentColor(meta.accent) }]}>
        ACT {actNumber(meta.act)} · {meta.actLabel.toUpperCase()}
      </Text>
      {Platform.OS === 'web'
        ? React.createElement(
            meta.number === 1 ? 'h1' : 'h2',
            { style: webHeadlineStyles },
            meta.headline,
          )
        : <Text accessibilityRole="header" style={headlineStyles}>{meta.headline}</Text>}
    </View>
  );
}

export function SupportingText({
  children,
  align = 'left',
  style,
}: {
  children: ReactNode;
  align?: 'left' | 'center';
  style?: StyleProp<TextStyle>;
}) {
  return (
    <Text style={[styles.supporting, align === 'center' && styles.centerText, style]}>
      {children}
    </Text>
  );
}

function actNumber(act: DiscoverySceneMeta['act']) {
  return {
    calling: 1,
    tension: 2,
    answer: 3,
    member: 4,
    coach: 5,
    opportunity: 6,
    invitation: 7,
  }[act];
}

const styles = StyleSheet.create({
  scene: {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
    backgroundColor: discoveryColors.background,
  },
  reveal: {
    flexGrow: 1,
    flexShrink: 0,
    width: '100%',
  },
  headingWrap: {
    width: '100%',
    maxWidth: 760,
  },
  centered: {
    alignItems: 'center',
    alignSelf: 'center',
  },
  eyebrow: {
    fontFamily: discoveryFonts.body,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 1.8,
    fontWeight: '700',
    marginBottom: 16,
  },
  heading: {
    margin: 0,
    color: discoveryColors.text,
    fontFamily: discoveryFonts.heading,
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -1.7,
    fontWeight: '700',
  },
  headingMedium: {
    fontSize: 37,
    lineHeight: 42,
  },
  supporting: {
    color: discoveryColors.textSoft,
    fontFamily: discoveryFonts.body,
    fontSize: 17,
    lineHeight: 26,
    maxWidth: 620,
  },
  centerText: {
    textAlign: 'center',
  },
});
