/**
 * AnimatedPreviewTile — Viewport-aware media tile for the Build library.
 *
 * Three rendering states:
 *   1. Poster (always-on) — sub-72px tiles always show the thumbnail image as a
 *      static poster. Decode cost is trivial at that size and the movement pose
 *      is visible immediately. No blank rectangles.
 *   2. Placeholder — tiles ≥72px that are NOT promoted show a solid bg placeholder.
 *      The <Image> is unmounted to prevent GIF decode during scroll.
 *   3. Animated — tiles ≥72px that ARE promoted mount the <Image> (GIF auto-plays).
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

  const shortestSide = Math.min(width, height);

  // Sub-72px tiles: always show image as poster — decode cost is trivial at this
  // size and the user sees the actual movement pose instead of a blank rectangle.
  if (shortestSide < SIZE_THRESHOLDS.stillOnly && uri) {
    return (
      <Image
        source={{ uri }}
        style={{ width, height, borderRadius }}
        resizeMode="cover"
      />
    );
  }

  // ≥72px tiles: only mount <Image> when the engine has promoted this tile.
  // Keeps GIF decode off during scroll for larger (more expensive) tiles.
  if (isAnimating && uri) {
    return (
      <Image
        source={{ uri }}
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

  // Sub-72px tiles: always show the image as a static poster regardless of
  // scroll state or promotion. At this size the decode cost is negligible and
  // the user sees the actual movement pose instead of a blank mini-rectangle.
  if (shortestSide < SIZE_THRESHOLDS.stillOnly) {
    return (
      <Image
        source={{ uri }}
        style={{ width, height, borderRadius }}
        resizeMode="cover"
      />
    );
  }

  // ≥72px tiles: only mount when parent is promoted AND within per-folder cap.
  if (parentIsAnimating && index < BUDGET.maxMiniPreviewsPerFolder) {
    return (
      <Image
        source={{ uri }}
        style={{ width, height, borderRadius }}
        resizeMode="cover"
      />
    );
  }

  // ≥72px but not promoted — placeholder (prevents GIF decode during scroll)
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
