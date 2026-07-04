/**
 * ConfettiBurst — lightweight confetti animation with no external deps.
 *
 * Renders an absolute-fill, non-interactive overlay of falling/rotating
 * pieces in brand colors. Runs once on mount, then calls onDone.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';
import { BLUE, FG, GOLD, GREEN } from '../lib/theme';

const COLORS = [GOLD, GREEN, BLUE, FG, '#E8C468', '#8FD19A'];
const PIECE_COUNT = 42;

interface PieceSpec {
  left: number;
  size: number;
  color: string;
  delay: number;
  duration: number;
  drift: number;
  spin: number;
  isRound: boolean;
}

export default function ConfettiBurst({ onDone }: { onDone?: () => void }) {
  const { height } = Dimensions.get('window');
  const progress = useRef(new Animated.Value(0)).current;

  const pieces = useMemo<PieceSpec[]>(
    () =>
      Array.from({ length: PIECE_COUNT }, () => ({
        left: Math.random() * 100,
        size: 6 + Math.random() * 8,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        delay: Math.random() * 0.25,
        duration: 0.55 + Math.random() * 0.45,
        drift: (Math.random() - 0.5) * 120,
        spin: (Math.random() - 0.5) * 1080,
        isRound: Math.random() < 0.35,
      })),
    []
  );

  useEffect(() => {
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 2600,
      easing: Easing.linear,
      useNativeDriver: true,
    });
    anim.start(({ finished }) => {
      if (finished) onDone?.();
    });
    return () => anim.stop();
  }, [progress, onDone]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((p, i) => {
        const start = p.delay;
        const end = Math.min(1, p.delay + p.duration);
        const translateY = progress.interpolate({
          inputRange: [start, end],
          outputRange: [-40, height + 40],
          extrapolate: 'clamp',
        });
        const translateX = progress.interpolate({
          inputRange: [start, end],
          outputRange: [0, p.drift],
          extrapolate: 'clamp',
        });
        const rotate = progress.interpolate({
          inputRange: [start, end],
          outputRange: ['0deg', `${p.spin}deg`],
        });
        const opacity = progress.interpolate({
          inputRange: [start, end - 0.12, end],
          outputRange: [1, 1, 0],
          extrapolate: 'clamp',
        });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              top: 0,
              left: `${p.left}%` as any,
              width: p.size,
              height: p.isRound ? p.size : p.size * 1.8,
              borderRadius: p.isRound ? p.size / 2 : 2,
              backgroundColor: p.color,
              opacity,
              transform: [{ translateY }, { translateX }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}
