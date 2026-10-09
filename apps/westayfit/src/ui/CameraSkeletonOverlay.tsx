/**
 * THE BODY GUIDE OVERLAY — the tracked member's stick figure over the camera.
 *
 * Drawn from `figureGeometry` (src/movement-camera/figure.ts): rounded lines
 * in the confirmed green #91CB7D over a soft navy under-stroke, a head ring,
 * both arms and legs. Mirrored like the self-view; the data is not. On native
 * nothing is drawn (the camera never opens there).
 */
import { createElement } from 'react';
import { Platform } from 'react-native';

import { figureGeometry } from '../movement-camera/figure';
import type { Pose, VisualPose } from '../movement-camera/types';
import { PROGRESS_GREEN } from './kit';

export function CameraSkeletonOverlay({
  subject,
  visual,
  aspect,
}: {
  subject: Pose;
  visual: VisualPose | null;
  aspect: number;
}) {
  if (Platform.OS !== 'web') return null;
  const g = figureGeometry(subject, visual, aspect);
  const path = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const layer = (stroke: string, width: number, key: string) =>
    createElement(
      'g',
      { key, fill: 'none', stroke, strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round' },
      ...g.lines.map((l, i) => createElement('path', { key: `l${i}`, d: path(l) })),
      g.head ? createElement('circle', { key: 'head', cx: g.head.cx, cy: g.head.cy, r: g.head.r }) : null,
    );
  return createElement(
    'svg',
    {
      viewBox: `0 0 ${g.width} ${g.height}`,
      preserveAspectRatio: 'xMidYMid slice',
      'aria-hidden': true,
      'data-testid': 'wsf-camera-figure',
      'data-lines': g.lines.length,
      'data-head': g.head ? 'ring' : 'none',
      style: figureStyle,
    },
    layer('rgba(11, 31, 58, .55)', 22, 'under'),
    layer(PROGRESS_GREEN, 11, 'line'),
  );
}

const figureStyle = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  transform: 'scaleX(-1)',
  pointerEvents: 'none',
  zIndex: 1,
} as const;
