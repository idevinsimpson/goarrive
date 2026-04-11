/**
 * AnimatedPreviewTile — Viewport-aware media tile for the Build library.
 *
 * Visual states for each tile:
 *   1. SCROLLING  — blank pixel, hidden (performance: stop GIF decoding)
 *   2. IDLE, not promoted — show thumbnail/poster at full opacity (stable resting state)
 *   3. IDLE, promoted (isAnimating) — show GIF with crossfade animation
 *   4. No URI — show dark placeholder with optional fallback icon
 *
 * On web, GIF <img> elements auto-play. The ONLY reliable way to stop a GIF
 * is to swap its src to a non-animated image. We swap to a 1×1 blank pixel
 * during scroll, and restore the real URI when idle.
 *
 * DO NOT make tiles go dark/blank when idle. The resting state must always
 * show the thumbnail so the grid looks intentional and premium.
 */
import React, { useEffect, useRef, useCallback, memo } from 'react';
import { View, Image, Animated, StyleSheet, Platform } from 'react-native';
import { SIZE_THRESHOLDS, BUDGET, type TilePriority } from '../hooks/usePreviewEngine';

const CROSSFADE_DURATION_MS = 250;
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

// 1×1 transparent GIF — used as a "blank" source to kill GIF decoding on web
const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// ── Standalone preview tile (movement cards, folder cards) ──────────────────

interface AnimatedPreviewTileProps {
  itemId: string;
  uri: string | null | undefined;
  width: number;
  height: number;
  isAnimating: boolean;
  /** Whether scroll is idle — tiles show thumbnail when idle, blank when scrolling */
  scrollIdle: boolean;
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
  scrollIdle,
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

  if (itemId !== prevItemId.current) {
    // New item assigned to this cell — fade in from zero
    fadeAnim.setValue(0);
  } else if (isAnimating && !prevAnimating.current) {
    // Same item re-promoted — was already visible at opacity 1, keep it there
    fadeAnim.setValue(1);
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

  const hasUri = !!uri;

  if (Platform.OS === 'web') {
    // Scrolling: blank pixel (stop GIF decoding for performance)
    // Idle, not promoted: real URI (auto-plays but stable resting state)
    // Idle, promoted: real URI with crossfade
    const effectiveSrc = (!scrollIdle && !isAnimating) ? BLANK_GIF : (hasUri ? uri! : BLANK_GIF);
    // Show image at full opacity when idle (even if not promoted), animate crossfade when promoted
    const imgOpacity = isAnimating ? fadeAnim : (scrollIdle && hasUri ? 1 : 0);

    return (
      <View style={{ width, height, borderRadius, overflow: 'hidden' }}>
        <View style={[styles.placeholder, StyleSheet.absoluteFill, { borderRadius }]}>
          {fallbackIcon || null}
        </View>
        {hasUri && (
          <Animated.Image
            source={{ uri: effectiveSrc }}
            style={[
              StyleSheet.absoluteFill,
              { borderRadius, opacity: imgOpacity },
            ]}
            resizeMode="cover"
            onLoad={isAnimating ? onGifLoad : undefined}
          />
        )}
      </View>
    );
  }

  // Native: show image when idle, hide during scroll
  const shouldShow = (isAnimating || scrollIdle) && hasUri;
  return (
    <View style={{ width, height, borderRadius, overflow: 'hidden' }}>
      <View style={[styles.placeholder, StyleSheet.absoluteFill, { borderRadius }]}>
        {fallbackIcon || null}
      </View>
      {shouldShow && (
        <Animated.Image
          source={{ uri: uri! }}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius, opacity: isAnimating ? fadeAnim : 1 },
          ]}
          resizeMode="cover"
          onLoad={isAnimating ? onGifLoad : undefined}
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

  // Sub-72px: show image when idle, blank when scrolling
  if (shortestSide < SIZE_THRESHOLDS.stillOnly) {
    if (Platform.OS === 'web') {
      const effectiveSrc = scrollIdle ? uri : BLANK_GIF;
      return (
        <Image
          source={{ uri: effectiveSrc }}
          style={{ width, height, borderRadius, backgroundColor: '#151B28' }}
          resizeMode="cover"
        />
      );
    }
    // Native: conditional render
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

  // ≥72px: engine-controlled with crossfade
  const isPromoted = parentIsAnimating && index < BUDGET.maxMiniPreviewsPerFolder;

  return (
    <MosaicCrossfadeTile
      uri={uri}
      width={width}
      height={height}
      isPromoted={isPromoted}
      scrollIdle={scrollIdle}
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
  scrollIdle: boolean;
  borderRadius: number;
}

const MosaicCrossfadeTile = memo(function MosaicCrossfadeTile({
  uri,
  width,
  height,
  isPromoted,
  scrollIdle,
  borderRadius,
}: MosaicCrossfadeTileProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const prevPromoted = useRef(false);

  if (isPromoted && !prevPromoted.current) {
    // Image was already visible at opacity 1 (idle state) — keep it visible
    fadeAnim.setValue(1);
  }
  prevPromoted.current = isPromoted;

  const onGifLoad = useCallback(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: CROSSFADE_DURATION_MS,
      useNativeDriver: USE_NATIVE_DRIVER,
    }).start();
  }, [fadeAnim]);

  if (Platform.OS === 'web') {
    // Scrolling: blank pixel. Idle: show image (promoted gets crossfade, non-promoted gets full opacity)
    const effectiveSrc = (!scrollIdle && !isPromoted) ? BLANK_GIF : uri;
    const imgOpacity = isPromoted ? fadeAnim : (scrollIdle ? 1 : 0);

    return (
      <View style={{ width, height, borderRadius, overflow: 'hidden' }}>
        <View style={[styles.miniPlaceholder, StyleSheet.absoluteFill, { borderRadius }]} />
        <Animated.Image
          source={{ uri: effectiveSrc }}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius, opacity: imgOpacity },
          ]}
          resizeMode="cover"
          onLoad={isPromoted ? onGifLoad : undefined}
        />
      </View>
    );
  }

  // Native: show when idle or promoted
  const shouldShow = isPromoted || scrollIdle;
  return (
    <View style={{ width, height, borderRadius, overflow: 'hidden' }}>
      <View style={[styles.miniPlaceholder, StyleSheet.absoluteFill, { borderRadius }]} />
      {shouldShow && (
        <Animated.Image
          source={{ uri }}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius, opacity: isPromoted ? fadeAnim : 1 },
          ]}
          resizeMode="cover"
          onLoad={isPromoted ? onGifLoad : undefined}
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
