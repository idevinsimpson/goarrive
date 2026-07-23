// ── Workout Mosaic Thumbnail ─────────────────────────────────────────────
/** Shows a mini-library grid of movement thumbnails inside a workout card.
 *  Designed to look like a small library you can glance at from the outside.
 *  Tight borders, distinct background, top-to-bottom left-to-right layout.
 *  Shared by the Build grid and the playbook scheduling panel. */
import React from 'react';
import { Platform, Text, View } from 'react-native';
import { Icon } from './Icon';
import { MosaicPreviewTile } from './AnimatedPreviewTile';

export const WORKOUT_CARD_BG = '#1A2332'; // Slightly lighter than page bg so cards stand out

export function MosaicPlaceholderCell({ width, height, borderRadius, name }: { width: number; height: number; borderRadius: number; name?: string }) {
  // Friction-killer for coaches: when a movement has no video yet, show its
  // NAME big and bold in the mosaic cell instead of a generic logo, so the
  // workout's contents are readable straight from the Build page.
  const fontSize = Math.max(9, Math.min(22, Math.round(Math.min(width, height) * 0.18)));
  const lineHeight = Math.round(fontSize * 1.15);
  return (
    <View style={{ width, height, borderRadius, overflow: 'hidden', backgroundColor: '#0E1117', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4, paddingVertical: 3 }}>
      <Text
        numberOfLines={4}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        style={{
          color: '#F0F4F8',
          fontSize,
          lineHeight,
          fontWeight: '700',
          textAlign: 'center',
          fontFamily: Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Bold',
        }}
      >
        {name || 'Movement'}
      </Text>
    </View>
  );
}

export function WorkoutMosaic({ thumbs, width, height, isAnimating = false, scrollIdle = false, reserveNameSpace = true }: { thumbs: (string | { name: string })[]; width: number; height: number; isAnimating?: boolean; scrollIdle?: boolean; reserveNameSpace?: boolean }) {
  const gap = 2; // tight gap between mini GIFs
  const inset = 6; // small padding inside the card
  const innerW = width - inset * 2;
  const innerH = height - inset * 2 - (reserveNameSpace ? 28 : 0); // leave room for name overlay at bottom

  if (!thumbs || thumbs.length === 0) {
    // Empty workout — still show the distinct background with subtle icon
    return (
      <View style={{ width, height, backgroundColor: WORKOUT_CARD_BG, justifyContent: 'center', alignItems: 'center' }}>
        <Icon name="workouts" size={28} color="#2D3B4E" />
      </View>
    );
  }

  // Single movement — show it centered and larger (like a hero thumbnail)
  if (thumbs.length === 1) {
    const singleW = innerW * 0.6;
    const singleH = singleW * (5 / 4); // 4:5 aspect ratio
    const clampedH = Math.min(singleH, innerH * 0.75);
    const clampedW = clampedH * (4 / 5);
    return (
      <View style={{ width, height, backgroundColor: WORKOUT_CARD_BG, justifyContent: 'center', alignItems: 'center' }}>
        {typeof thumbs[0] === 'string' ? (
          <MosaicPreviewTile
            uri={thumbs[0]}
            width={clampedW}
            height={clampedH}
            parentIsAnimating={isAnimating}
            scrollIdle={scrollIdle}
            index={0}
            borderRadius={6}
          />
        ) : (
          <MosaicPlaceholderCell width={clampedW} height={clampedH} borderRadius={6} name={thumbs[0]?.name} />
        )}
      </View>
    );
  }

  // Multiple movements — dynamic grid: 2x2 → 3x3 → 4x4 (max 16)
  const maxShow = Math.min(thumbs.length, 16);
  const cols = maxShow <= 4 ? 2 : maxShow <= 9 ? 3 : 4;
  const rows = Math.ceil(maxShow / cols);
  const cellW = (innerW - gap * (cols - 1)) / cols;
  // 4:5 aspect ratio for each thumbnail (height = width * 5/4)
  const cellH = cellW * (5 / 4);
  // Clamp cell height so rows don't overflow the available inner height
  const maxCellH = (innerH - gap * (rows - 1)) / rows;
  const finalCellH = Math.min(cellH, maxCellH);
  const finalCellW = Math.min(cellW, finalCellH * (4 / 5)); // maintain 4:5 if clamped

  return (
    <View style={{ width, height, backgroundColor: WORKOUT_CARD_BG }}>
      <View style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap,
        padding: inset,
        paddingTop: inset + 2,
        width,
        overflow: 'hidden',
      }}>
        {thumbs.slice(0, maxShow).map((slot, i) => (
          typeof slot === 'string' ? (
            <MosaicPreviewTile
              key={i}
              uri={slot}
              width={finalCellW}
              height={finalCellH}
              parentIsAnimating={isAnimating}
              scrollIdle={scrollIdle}
              index={i}
              borderRadius={3}
            />
          ) : (
            <MosaicPlaceholderCell key={i} width={finalCellW} height={finalCellH} borderRadius={3} name={slot?.name} />
          )
        ))}
      </View>
    </View>
  );
}
