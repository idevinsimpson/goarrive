import type { SessionSnapshot } from '../session';
import type { Box, Keypoint, Pose } from '../types';

/**
 * The debug overlay: every detected person's box (grey), the tracked person's
 * box (state colour) and skeleton. Drawn in UNMIRRORED frame coordinates; the
 * canvas is mirrored by CSS together with the self-view video.
 */

const BONES: [Keypoint, Keypoint][] = [
  ['leftShoulder', 'rightShoulder'],
  ['leftShoulder', 'leftHip'],
  ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
];

function strokeBox(ctx: CanvasRenderingContext2D, b: Box, w: number, h: number) {
  const pad = 0.03;
  ctx.strokeRect((b.minX - pad) * w, (b.minY - pad) * h, (b.w + 2 * pad) * w, (b.h + 2 * pad) * h);
}

function drawSkeleton(ctx: CanvasRenderingContext2D, pose: Pose, w: number, h: number, color: string) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  for (const [a, b] of BONES) {
    const p = pose[a];
    const q = pose[b];
    if (!p || !q || p.visibility < 0.5 || q.visibility < 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(p.x * w, p.y * h);
    ctx.lineTo(q.x * w, q.y * h);
    ctx.stroke();
  }
  for (const p of Object.values(pose)) {
    if (!p || p.visibility < 0.5) continue;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  snap: SessionSnapshot,
  allPoses: Pose[],
  color: string,
  opts: { debug: boolean },
) {
  const { width: w, height: h } = ctx.canvas;
  ctx.clearRect(0, 0, w, h);
  if (!opts.debug) return;

  for (const p of allPoses) drawSkeleton(ctx, p, w, h, 'rgba(255,255,255,0.55)');
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(229,231,235,0.9)';
  for (const b of snap.candidates) strokeBox(ctx, b, w, h);
  ctx.setLineDash([]);

  // The movement zone (acquisition needs the body centre inside it).
  if (snap.lockState === 'searching' || snap.lockState === 'acquiring') {
    ctx.strokeStyle = 'rgba(253,230,138,0.7)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0.2 * w, 0.02 * h, 0.6 * w, 0.96 * h);
  }

  if (snap.subjectBox) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    strokeBox(ctx, snap.subjectBox, w, h);
  }
  if (snap.subject) drawSkeleton(ctx, snap.subject, w, h, color);
}
