/**
 * AnimatedPreviewTile — Viewport-aware media tile for the Build library.
 *
 * Renders either a placeholder (solid bg) or the animated GIF based on
 * whether the preview engine has promoted this tile to 'animating'.
 *
 * Key rule: the <Image> element is ONLY mounted when promoted. This is the
 * only reliable way to prevent GIF decode on web (where <img> auto-animates).
 * Unmounting the Image when demoted frees decode buffers and memory.
 */
import React, { useEffect, memo } from 'react';
import { View, Image, StyleSheet } from 'react-native';
import { SIZE_THRESHOLDS, BUDGET, type TilePriority } from '../hooks/usePreviewEngine';

// ── Standalone preview tile (movement cards, folder cards) ──────────────────

interface AnimatedPreviewTileProps {
  /** Unique item ID (must match FlatList keyExtractor) */
  itemId: string;
  /** Animated GIF URL (thumbnailUrl) */
  uri: string | null | undefined;
  /** Tile width in px */
  width: number;
  /** Tile height in px */
  height: number;
  /** Whether the engine has promoted this tile to animate */
  isAnimating: boolean;
  /** Priority for this tile (1=standalone, 2=folder, 3=mini) */
  priority: TilePriority;
  /** Register callback from engine */
  registerTile: (id: string, priority: TilePriority) => void;
  /** Border radius */
  borderRadius?: number;
  /** Fallback icon to show in placeholder */
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
  // Register this tile's priority with the engine on mount / priority change
  useEffect(() => {
    registerTile(itemId, priority);
  }, [itemId, priority, registerTile]);

  // Size gate: below threshold → never animate, always placeholder
  const shortestSide = Math.min(width, height);
  const sizeAllowsAnimation = shortestSide >= SIZE_THRESHOLDS.stillOnly;
  const shouldMount = isAnimating && sizeAllowsAnimation && !!uri;

  if (shouldMount) {
    return (
      <Image
        source={{ uri: uri! }}
        style={{ width, height, borderRadius }}
        resizeMode="cover"
      />
    );
  }

  // Placeholder — no Image mounted, zero decode cost
  return (
    <View style={[styles.placeholder, { width, height, borderRadius }]}>
      {fallbackIcon || null}
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
  /** Index of this tile within the mosaic (0-based) */
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

  // Gate 1: parent must be promoted
  // Gate 2: tile must be above stillOnly size threshold (72px)
  // Gate 3: tile index must be within per-folder cap
  const shouldMount =
    parentIsAnimating &&
    shortestSide >= SIZE_THRESHOLDS.stillOnly &&
    index < BUDGET.maxMiniPreviewsPerFolder;

  if (shouldMount) {
    return (
      <Image
        source={{ uri }}
        style={{ width, height, borderRadius }}
        resizeMode="cover"
      />
    );
  }

  // Not promoted — show placeholder. No Image mounted = no GIF decode.
  return (
    <View style={[styles.miniPlaceholder, { width, height, borderRadius }]} />
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
