/**
 * THE BODY GUIDE OVERLAY, NATIVE (react-native-svg). Metro picks this file
 * over CameraSkeletonOverlay.tsx on native; same props, same drawing.
 *
 * Drawn from the same `figureGeometry` as web: rounded lines in the confirmed
 * green #91CB7D over a soft navy under-stroke, both arms (shoulder → elbow →
 * wrist), the torso and legs, and a ring around the head (no head dot). The
 * same viewBox and `xMidYMid slice` crop as web, which matches the native
 * preview's aspect-fill (iOS resizeAspectFill, Android FILL_CENTER).
 *
 * MIRRORED FOR DISPLAY ONLY: the front-camera preview is shown mirrored, so
 * the drawing is flipped with scaleX(-1) to sit on the member. The landmark
 * data stays unmirrored. Drawing only — nothing here is read by counting.
 */
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { figureGeometry } from '../movement-camera/figure';
import type { Pose, VisualPose } from '../movement-camera/types';
import { NAVY, PROGRESS_GREEN } from './kit';

export function CameraSkeletonOverlay({
  subject,
  visual,
  aspect,
}: {
  subject: Pose;
  visual: VisualPose | null;
  aspect: number;
}) {
  const g = figureGeometry(subject, visual, aspect);
  const path = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const layer = (stroke: string, opacity: number, width: number, key: string) => (
    <G key={key} fill="none" stroke={stroke} strokeOpacity={opacity} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {g.lines.map((l, i) => (
        <Path key={`l${i}`} d={path(l)} />
      ))}
      {g.head ? <Circle key="head" cx={g.head.cx} cy={g.head.cy} r={g.head.r} /> : null}
    </G>
  );
  return (
    <View
      style={st.mirror}
      testID="wsf-camera-figure"
      aria-hidden
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${g.width} ${g.height}`} preserveAspectRatio="xMidYMid slice">
        {layer(NAVY, 0.55, 22, 'under')}
        {layer(PROGRESS_GREEN, 1, 11, 'line')}
      </Svg>
    </View>
  );
}

const st = StyleSheet.create({
  // Display-only mirror, like the web overlay's `transform: scaleX(-1)`.
  mirror: { ...StyleSheet.absoluteFillObject, zIndex: 1, pointerEvents: 'none', transform: [{ scaleX: -1 }] },
});
