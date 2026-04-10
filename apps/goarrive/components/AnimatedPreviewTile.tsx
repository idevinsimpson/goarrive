/**
 * AnimatedPreviewTile — Viewport-aware media tile for the Build library.
 *
 * Strategy: On web, GIF `<img>` elements auto-play. The ONLY reliable way to
 * stop a GIF is to swap its `src` to a non-animated image. Unmounting the
 * element is NOT enough — browsers may keep the last decoded frame visible
 * in the compositor layer.
 *
 * So we keep the Image always mounted and swap `src` between the real GIF URL
 * and a transparent 1×1 pixel when the engine says "don't animate."
 */
import React, { useEffect, useRef, useCallback, memo } from 'react';
import { View, Image, Animated, StyleSheet, Platform } from 'react-native';
import { SIZE_THRESHOLDS, BUDGET, type TilePriority } from '../hooks/usePreviewEngine';

const CROSSFADE_DURATION_MS = 250;
const USE_NATIVE_DRIVER = Platform.OS !== 'web';

// 1×1 transparent GIF — used as a "blank" source to kill GIF decoding on web
const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// ── Debug: log every Image mount/src change (temporary) ────────────────────
const __imgLog = (component: string, active: boolean, scrollInfo: string, detail: string) => {
  console.log(`[IMG] ${component} | active=${active} | ${scrollInfo} | ${detail}`);
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

  const hasUri = !!uri;

  // Debug log on every render
  __imgLog('AnimatedPreviewTile', isAnimating, `hasUri=${hasUri}`, `item=${itemId}`);

  // On web: always mount the Image but swap src. On native: conditional mount.
  if (Platform.OS === 'web') {
    // Determine effective src: real URI when animating, blank pixel otherwise
    const effectiveSrc = (isAnimating && hasUri) ? uri! : BLANK_GIF;
    const showImage = isAnimating && hasUri;

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
              { borderRadius, opacity: showImage ? fadeAnim : 0 },
            ]}
            resizeMode="cover"
            onLoad={showImage ? onGifLoad : undefined}
          />
        )}
      </View>
    );
  }

  // Native: conditional mount (unmount truly removes the element)
  const shouldShowGif = isAnimating && hasUri;
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

  // Sub-72px: on web, always mount Image but swap src based on scroll state
  if (shortestSide < SIZE_THRESHOLDS.stillOnly) {
    if (Platform.OS === 'web') {
      const effectiveSrc = scrollIdle ? uri : BLANK_GIF;
      __imgLog('MosaicMini(sub72)', scrollIdle, `idle=${scrollIdle}`, `size=${shortestSide.toFixed(0)}`);
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

  __imgLog('MosaicCrossfade(72+)', isPromoted, `promoted=${isPromoted}`, `size=72+`);

  if (Platform.OS === 'web') {
    const effectiveSrc = isPromoted ? uri : BLANK_GIF;
    return (
      <View style={{ width, height, borderRadius, overflow: 'hidden' }}>
        <View style={[styles.miniPlaceholder, StyleSheet.absoluteFill, { borderRadius }]} />
        <Animated.Image
          source={{ uri: effectiveSrc }}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius, opacity: isPromoted ? fadeAnim : 0 },
          ]}
          resizeMode="cover"
          onLoad={isPromoted ? onGifLoad : undefined}
        />
      </View>
    );
  }

  // Native: conditional mount
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
