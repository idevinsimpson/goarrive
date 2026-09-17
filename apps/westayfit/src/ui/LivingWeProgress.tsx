import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';

import { monogramFillGreen, monogramUnfilledOnDark, monogramUnfilledOnLight } from './brandAssets';
import { heightFractionForFill, LIVING_WE_ASPECT } from './livingWeCalibration';
import { fillRatio, percentLabel, totalOfTargetLabel } from './progressFormat';
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
 *   - it animates only from the previous confirmed state to the next; a fresh
 *     mount renders the current state at once, with no replay from zero
 *   - reduced motion renders each state instantly
 *   - it is never a spinner and never moves without a confirmed change
 *
 * It carries the numbers as its accessibility label; the surrounding screen
 * always prints them as text too, so meaning never depends on the shape.
 */
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
  surface?: 'light' | 'dark';
  /** The previously CONFIRMED total to animate from. Null renders at once. */
  animateFrom?: number | null;
  testID?: string;
}) {
  const height = Math.round(width / LIVING_WE_ASPECT);
  const reducedMotion = useReducedMotion();
  const ratio = fillRatio(completed, target);
  const clipPx = heightFractionForFill(ratio) * height;

  // Start where the previous confirmed state was (or at the current state on
  // a fresh mount), then move to the current state. Never from zero unless
  // the previous confirmed total really was zero.
  const startPx =
    animateFrom == null ? clipPx : heightFractionForFill(fillRatio(animateFrom, target)) * height;
  const anim = useRef(new Animated.Value(startPx)).current;
  const lastTarget = useRef(startPx);

  useEffect(() => {
    if (lastTarget.current === clipPx) return;
    lastTarget.current = clipPx;
    if (reducedMotion) {
      anim.setValue(clipPx);
      return;
    }
    Animated.timing(anim, { toValue: clipPx, duration: 700, useNativeDriver: false }).start();
  }, [anim, clipPx, reducedMotion]);

  const unfilled = surface === 'dark' ? monogramUnfilledOnDark : monogramUnfilledOnLight;
  const label = `${totalOfTargetLabel(completed, target, unit)}, ${percentLabel(completed, target)} filled`;

  return (
    <View
      style={{ width, height }}
      accessibilityRole="image"
      accessibilityLabel={label}
      testID={testID}
      {...({ 'data-fill-ratio': ratio.toFixed(4) } as Record<string, unknown>)}
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
