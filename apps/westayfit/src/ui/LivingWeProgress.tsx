import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';

import { monogramFillGreen, monogramUnfilledNavy, monogramUnfilledWhite } from './brandAssets';
import { heightFractionForFill, LIVING_WE_ASPECT } from './livingWeCalibration';
import { fillRatio, fillRatioAttribute, percentLabel, totalOfTargetLabel } from './progressFormat';
import { useReducedMotion } from './useReducedMotion';

/**
 * The progress WE: the owner-supplied monogram silhouette, filled with
 * confirmed-progress green in proportion to one goal's confirmed total.
 *
 * What it promises:
 *   - the fill is the TRUE ratio completed / target, clamped to full — the
 *     rounded percentage text never drives the shape
 *   - the green area, not merely the green height, matches that ratio: the
 *     clip height comes from the silhouette's area calibration table
 *   - the unfilled mark is the brand mark in the owner's own colourway (navy
 *     on light surfaces, white on the navy surface), so an empty WE reads as
 *     the brand, never as a disabled shape
 *   - it never moves without a confirmed change, and it is never a spinner
 *
 * Motion: there is no approved timing yet. The owner's motion references
 * (fill direction and timing) have not been supplied, so every state change
 * renders at once. The pieces a previous-confirmed → next-confirmed
 * transition needs are kept (`animateFrom`, the animated clip height and the
 * reduced-motion gate); `livingWeTransition()` is where a calibrated timing
 * would be introduced, and it returns null until one is approved.
 *
 * It carries the numbers as its accessibility label; the surrounding screen
 * always prints them as text too, so meaning never depends on the shape.
 */
export function livingWeTransition(): { durationMs: number } | null {
  return null;
}

export function LivingWeProgress({
  completed,
  target,
  unit,
  width = 220,
  surface = 'light',
  animateFrom = null,
  testID,
}: {
  completed: number;
  target: number;
  unit: string;
  width?: number;
  /** Which surface the mark sits on; picks the unfilled colourway. */
  surface?: 'light' | 'dark';
  /** The previously CONFIRMED total a future transition would start from. */
  animateFrom?: number | null;
  testID?: string;
}) {
  const height = Math.round(width / LIVING_WE_ASPECT);
  const reducedMotion = useReducedMotion();
  const ratio = fillRatio(completed, target);
  const clipPx = heightFractionForFill(ratio) * height;

  // Start where the previous confirmed state was (or at the current state on
  // a fresh mount). Never from zero unless the previous confirmed total
  // really was zero.
  const startPx =
    animateFrom == null ? clipPx : heightFractionForFill(fillRatio(animateFrom, target)) * height;
  const anim = useRef(new Animated.Value(startPx)).current;
  const lastTarget = useRef(startPx);

  useEffect(() => {
    if (lastTarget.current === clipPx) return;
    lastTarget.current = clipPx;
    const transition = livingWeTransition();
    if (reducedMotion || transition == null) {
      anim.setValue(clipPx);
      return;
    }
    Animated.timing(anim, {
      toValue: clipPx,
      duration: transition.durationMs,
      useNativeDriver: false,
    }).start();
  }, [anim, clipPx, reducedMotion]);

  const unfilled = surface === 'dark' ? monogramUnfilledWhite : monogramUnfilledNavy;
  const label = `${totalOfTargetLabel(completed, target, unit)}, ${percentLabel(completed, target)} filled`;

  // react-native-web maps dataSet to data-* attributes; the browser tests read
  // the fill ratio off data-fill-ratio. It is rounded DOWN so the DOM never
  // carries a literal full ratio before the target.
  return (
    <View
      style={{ width, height }}
      accessibilityRole="image"
      accessibilityLabel={label}
      testID={testID}
      {...({ dataSet: { 'fill-ratio': fillRatioAttribute(completed, target) } } as Record<string, unknown>)}
    >
      <Image source={unfilled} style={[styles.layer, { width, height }]} resizeMode="contain" />
      <Animated.View style={[styles.clip, { width, height: anim }]}>
        <Image
          source={monogramFillGreen}
          style={[styles.layer, { width, height }]}
          resizeMode="contain"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, bottom: 0 },
  clip: { position: 'absolute', left: 0, bottom: 0, overflow: 'hidden' },
});
