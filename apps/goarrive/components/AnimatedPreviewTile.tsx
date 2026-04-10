/**
 * AnimatedPreviewTile — Viewport-aware media tile for the Build library.
 *
 * Four rendering modes:
 *   1. Poster (always-on) — sub-72px tiles always show the thumbnail image.
 *      Decode cost is trivial at that size. No crossfade needed.
 *   2. Placeholder — tiles ≥72px that are NOT promoted show a solid bg.
 *      The GIF <Image> is unmounted to prevent decode during scroll.
 *   3. Crossfade-in — tiles ≥72px that just promoted: the GIF mounts on top
 *      of the placeholder with opacity 0, then fades to 1 over 250ms once
 *      the first frame is decoded (onLoad). Placeholder stays visible
 *      underneath until the GIF has real content to show.
 *   4. Animated — after crossfade completes, the GIF is fully opaque.
 *
 * On demotion (scroll resumes), the GIF unmounts instantly — no fade-out.
 * The user is actively scrolling so the snap is imperceptible, and we need
 * the decode to stop immediately for scroll performance.
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

  // Crossfade opacity — reset to 0 each time isAnimating becomes true,
  // and each time the item changes (FlatList cell recycling).
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

  // Fade in once the GIF's first frame is decoded
  const onGifLoad = useCallback(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: CROSSFADE_DURATION_MS,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [fadeAnim]);

  const shortestSide = Math.min(width, height);

  // Sub-72px: always show poster, no crossfade needed
  if (shortestSide < SIZE_THRESHOLDS.stillOnly && uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width, height, borderRadius }}
        resizeMode="cover"
      />
    );
  }

  // ≥72px: layered crossfade approach
  return (
    <View style={{ width, height, borderRadius, overflow: 'hidden' }}>
      {/* Base layer: placeholder (always rendered) */}
      <View style={[styles.placeholder, StyleSheet.absoluteFill, { borderRadius }]}>
        {fallbackIcon || null}
      </View>

      {/* Top layer: GIF, only mounted when promoted, fades in on first frame */}
      {isAnimating && uri && (
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

// ── Mosaic mini-tile (inside folder/workout cards) ──────────────────────────

interface MosaicPreviewTileProps {
  uri: string;
  width: number;
  height: number;
  parentIsAnimating: boolean;
  index: number;
  borderRadius?: number;
}

export const MosaicPreviewTile = memo(function MosaicPreviewTile({
  uri,
  width,
  height,
  parentIsAnimating,
  index,
  borderRadius = 3,
}: MosaicPreviewTileProps) {
  const shortestSide = Math.min(width, height);

  // Sub-72px: always show poster, no crossfade needed
  if (shortestSide < SIZE_THRESHOLDS.stillOnly) {
    return (
      <Image
        source={{ uri }}
        style={{ width, height, borderRadius }}
        resizeMode="cover"
      />
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

  // Reset fade on promotion start
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
      {/* Base: mini placeholder */}
      <View style={[styles.miniPlaceholder, StyleSheet.absoluteFill, { borderRadius }]} />

      {/* Top: GIF with crossfade */}
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
