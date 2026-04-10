/**
 * AnimatedPreviewTile — Viewport-aware media tile for the Build library.
 *
 * Every tile respects scroll state. No GIF is ever visible during active scroll.
 * FlatList re-renders items via extraData={animatingIds} when engine state changes.
 */
import React, { useEffect, useRef, useCallback, memo } from 'react';
import { View, Image, Animated, StyleSheet, Platform } from 'react-native';
import { SIZE_THRESHOLDS, BUDGET, type TilePriority } from '../hooks/usePreviewEngine';

const CROSSFADE_DURATION_MS = 250;
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

// ── Debug: log every Image mount (temporary — remove after verification) ────
const __imgLog = (component: string, uri: string, scrollState: string, reason: string) => {
  console.log(`[IMG MOUNT] ${component} | scroll=${scrollState} | reason=${reason} | uri=${uri.slice(-40)}`);
};

// ── Standalone preview tile (movement cards, folder cards) ──────────────────

interface AnimatedPreviewTileProps {
  itemId: string;
  uri: string | null | undefined;
  width: number;
  height: number;
  isAnimating: boolean;
  priority: TilePriority;
  registerTile: (id: string, priority: TilePriority) => void;
  borderRadius?: number;
  fallbackIcon?: React.ReactNode;
}

const PLACEHOLDER_BG = '#1A2332';

export const AnimatedPreviewTile = memo(function AnimatedPreviewTile({
  itemId,
  uri,
  width,
  height,
  isAnimating,
  priority,
  registerTile,
  borderRadius = 0,
  fallbackIcon,
}: AnimatedPreviewTileProps) {
  useEffect(() => {
    registerTile(itemId, priority);
  }, [itemId, priority, registerTile]);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const prevAnimating = useRef(false);
  const prevItemId = useRef(itemId);

  if (
    (isAnimating && !prevAnimating.current) ||
    (itemId !== prevItemId.current)
  ) {
    fadeAnim.setValue(0);
  }
  prevAnimating.current = isAnimating;
  prevItemId.current = itemId;

  const onGifLoad = useCallback(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: CROSSFADE_DURATION_MS,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [fadeAnim]);

  const shouldShowGif = isAnimating && !!uri;

  // Debug: log when GIF mounts
  if (shouldShowGif) {
    __imgLog('AnimatedPreviewTile', uri!, isAnimating ? 'promoted' : 'NOT-promoted', `item=${itemId}`);
  }

  return (
    <View style={{ width, height, borderRadius, overflow: 'hidden' }}>
      <View style={[styles.placeholder, StyleSheet.absoluteFill, { borderRadius }]}>
        {fallbackIcon || null}
      </View>
      {shouldShowGif && (
        <Animated.Image
          source={{ uri: uri! }}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius, opacity: fadeAnim },
          ]}
          resizeMode="cover"
          onLoad={onGifLoad}
        />
      )}
    </View>
  );
});

// ── Mosaic mini-tile (inside folder/workout cards) ──────────────────────────

interface MosaicPreviewTileProps {
  uri: string;
  width: number;
  height: number;
  parentIsAnimating: boolean;
  scrollIdle: boolean;
  index: number;
  borderRadius?: number;
}

export const MosaicPreviewTile = memo(function MosaicPreviewTile({
  uri,
  width,
  height,
  parentIsAnimating,
  scrollIdle,
  index,
  borderRadius = 3,
}: MosaicPreviewTileProps) {
  const shortestSide = Math.min(width, height);

  // Sub-72px: show only when idle
  if (shortestSide < SIZE_THRESHOLDS.stillOnly) {
    if (scrollIdle) {
      __imgLog('MosaicPreviewTile(sub72)', uri, scrollIdle ? 'idle' : 'NOT-idle', `size=${shortestSide.toFixed(0)}`);
      return (
        <Image
          source={{ uri }}
          style={{ width, height, borderRadius }}
          resizeMode="cover"
        />
      );
    }
    return (
      <View style={[styles.miniPlaceholder, { width, height, borderRadius }]} />
    );
  }

  // ≥72px: engine-controlled with crossfade
  const isPromoted = parentIsAnimating && index < BUDGET.maxMiniPreviewsPerFolder;

  return (
    <MosaicCrossfadeTile
      uri={uri}
      width={width}
      height={height}
      isPromoted={isPromoted}
      borderRadius={borderRadius}
    />
  );
});

// ── Shared crossfade wrapper for ≥72px mosaic tiles ─────────────────────────

interface MosaicCrossfadeTileProps {
  uri: string;
  width: number;
  height: number;
  isPromoted: boolean;
  borderRadius: number;
}

const MosaicCrossfadeTile = memo(function MosaicCrossfadeTile({
  uri,
  width,
  height,
  isPromoted,
  borderRadius,
}: MosaicCrossfadeTileProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const prevPromoted = useRef(false);

  if (isPromoted && !prevPromoted.current) {
    fadeAnim.setValue(0);
  }
  prevPromoted.current = isPromoted;

  const onGifLoad = useCallback(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: CROSSFADE_DURATION_MS,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [fadeAnim]);

  if (isPromoted) {
    __imgLog('MosaicCrossfadeTile(72+)', uri, isPromoted ? 'promoted' : 'NOT-promoted', `size=72+`);
  }

  return (
    <View style={{ width, height, borderRadius, overflow: 'hidden' }}>
      <View style={[styles.miniPlaceholder, StyleSheet.absoluteFill, { borderRadius }]} />
      {isPromoted && (
        <Animated.Image
          source={{ uri }}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius, opacity: fadeAnim },
          ]}
          resizeMode="cover"
          onLoad={onGifLoad}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  placeholder: {
    backgroundColor: PLACEHOLDER_BG,
    justifyContent: 'center',
    alignItems: 'center',
  },
  miniPlaceholder: {
    backgroundColor: '#151B28',
  },
});
