/**
 * AnimatedPreviewTile — Viewport-aware media tile for the Build library.
 *
 * Every tile respects scroll state. No GIF is ever visible during active scroll.
 *
 * Rendering modes for ≥72px tiles (engine-controlled):
 *   - Scrolling: placeholder only (GIF unmounted, zero decode)
 *   - Idle + promoted: GIF crossfades in over placeholder (250ms on first frame)
 *   - Idle + not promoted: placeholder (over budget)
 *
 * Rendering modes for sub-72px tiles (mosaic mini-tiles):
 *   - Scrolling: placeholder (dark bg, no GIF mounted)
 *   - Idle: GIF mounted (shows movement pose; animates at tiny size, acceptable)
 *
 * On demotion / scroll start: GIF unmounts instantly, placeholder visible.
 */
import React, { useEffect, useRef, useCallback, memo } from 'react';
import { View, Image, Animated, StyleSheet, Platform } from 'react-native';
import { SIZE_THRESHOLDS, BUDGET, type TilePriority } from '../hooks/usePreviewEngine';

const CROSSFADE_DURATION_MS = 250;
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

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
  // Register with engine
  useEffect(() => {
    registerTile(itemId, priority);
  }, [itemId, priority, registerTile]);

  // Crossfade opacity
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const prevAnimating = useRef(false);
  const prevItemId = useRef(itemId);

  // Reset fade when promotion starts or cell is recycled
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

  const shortestSide = Math.min(width, height);

  // ALL tiles ≥72px: layered crossfade, engine-controlled
  // Sub-72px standalone tiles are rare in practice (list view uses raw Image),
  // but if they occur, treat them the same — engine controls visibility.
  const shouldShowGif = isAnimating && !!uri;

  return (
    <View style={{ width, height, borderRadius, overflow: 'hidden' }}>
      {/* Base layer: placeholder (always rendered) */}
      <View style={[styles.placeholder, StyleSheet.absoluteFill, { borderRadius }]}>
        {fallbackIcon || null}
      </View>

      {/* Top layer: GIF, only mounted when promoted, fades in on first frame */}
      {shouldShowGif && (
        <Animated.Image
          source={{ uri: uri! }}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius, opacity: shortestSide < SIZE_THRESHOLDS.stillOnly ? 1 : fadeAnim },
          ]}
          resizeMode="cover"
          onLoad={shortestSide >= SIZE_THRESHOLDS.stillOnly ? onGifLoad : undefined}
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
  /** Is the parent folder/workout card promoted to animating? */
  parentIsAnimating: boolean;
  /** Is the scroll state idle? (controls sub-72px tile visibility) */
  scrollIdle: boolean;
  /** Index of this tile within the mosaic (0-based) */
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

  // Sub-72px tiles: show GIF ONLY when scroll is idle.
  // During scroll → placeholder (no GIF mounted, no animation visible).
  // When idle → mount GIF (shows movement pose; tiny animation acceptable at rest).
  if (shortestSide < SIZE_THRESHOLDS.stillOnly) {
    if (scrollIdle) {
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

  // ≥72px tiles: engine-controlled with crossfade
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
