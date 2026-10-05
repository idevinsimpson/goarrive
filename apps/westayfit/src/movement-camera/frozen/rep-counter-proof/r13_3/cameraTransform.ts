// R13.3 local-only replay runner + copyable camera-transform analysis (comparison only, never live).
// Reuses the r13.1 skeleton adapter and r13.2 view cue by import (both stay byte-identical) and adds only
// the visible ankle-centre y needed for the translation/scale-free hip-height signal. Plain numbers only.
import type { TraceOp } from '../replay/traceOps';
import { MIN_VIS, SkeletonFeatureAdapter, type FrameIn } from '../r13_1/skeletonFeatures';
import { SideStabilizer } from '../r13/sideStabilizer';
import { viewCue } from '../r13_2/signalReliability';
import { NaturalSquatCounterR13_3, R133_REVISION, type R133Cycle, type R133Event, type SkFeat3 } from './naturalCounterR13_3';

/** Mean y of the visible ankles of a trace frame (KEYPOINTS idx 7/8); null if none visible. Never synthesised. */
export function ankleY(j: (number | null)[] | null | undefined): number | null {
  if (!Array.isArray(j) || j.length !== 27) return null;
  const ys: number[] = [];
  for (const i of [7, 8]) {
    const y = j[i * 3 + 1], v = j[i * 3 + 2];
    if (typeof y === 'number' && Number.isFinite(y) && typeof v === 'number' && v >= MIN_VIS) ys.push(y);
  }
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
}

/** r13.1 adapter + ankle anchor. */
const yv = (j: (number | null)[], i: number): number | null => {
  const y = j[i * 3 + 1], v = j[i * 3 + 2];
  return typeof y === 'number' && Number.isFinite(y) && typeof v === 'number' && v >= MIN_VIS ? y : null;
};
/** r13.1 adapter + ankle anchor + per-leg hip-above-ankle height (separate L/R histories, offset carried on a
 *  side switch so a change of visible leg cannot create fake motion). */
export class SkeletonFeatureAdapterR133 {
  private ad = new SkeletonFeatureAdapter();
  private leg = new SideStabilizer({ alpha: 0.8, compatTol: 0.03 });
  reset() { this.ad.reset(); this.leg.reset(); }
  feat(f: FrameIn | null): SkFeat3 | null {
    const sk = this.ad.feat(f);
    if (!sk) { this.leg.reset(); return null; }
    const j = f!.joints as (number | null)[];
    const h = (hip: number, ank: number) => { const a = yv(j, ank), b = yv(j, hip); return a !== null && b !== null ? a - b : null; };
    return { ...sk, ankleY: ankleY(j), legHeight: this.leg.update(h(3, 7), h(4, 8)) };
  }
}

export interface CameraTransformAnalysis {
  revision: string; t0: number | null; reps: number; feeds: number; alignedFeeds: number;
  cycles: R133Cycle[]; events: R133Event[];
  totals: { reps: number; counted: number; notDeep: number; downBrief: number; rebottom: number; interrupted: number; minRep: number; geometry: number };
}

export function runR133(ops: readonly TraceOp[], frames: readonly FrameIn[] | null): CameraTransformAnalysis {
  const byT = new Map<number, FrameIn>();
  if (frames) for (const f of frames) if (f && typeof f.t === 'number' && Number.isFinite(f.t)) byT.set(f.t, f);
  const c = new NaturalSquatCounterR13_3();
  const ad = new SkeletonFeatureAdapterR133();
  let t0: number | null = null, feeds = 0, aligned = 0, reps = 0;
  for (const op of ops) {
    if (op.k === 'feed') {
      if (t0 === null) t0 = op.t;
      feeds += 1;
      const fr = byT.get(op.t) ?? null;
      const sk = op.depth === null ? (ad.reset(), null) : ad.feat(fr);
      if (sk) aligned += 1;
      if (c.update({ timestampMs: op.t, depth: op.depth, torso: op.torso, sk, front: sk ? viewCue(fr?.joints) : null }).event === 'rep') reps += 1;
    } else if (op.k === 'interrupt') { c.interrupt(); ad.reset(); }
    else if (op.k === 'reset') { c.reset(); ad.reset(); }
  }
  const n = (o: string) => c.cycles.filter((x) => x.outcome === o).length;
  return {
    revision: R133_REVISION, t0, reps, feeds, alignedFeeds: aligned, cycles: c.cycles, events: c.events,
    totals: { reps, counted: reps, notDeep: n('partial'), downBrief: 0, rebottom: c.cycles.reduce((a, x) => a + x.rebottoms, 0), interrupted: n('voided'), minRep: n('minRep'), geometry: n('geometry') },
  };
}

const rel = (t: number | null, t0: number | null) => (t === null || t0 === null ? 'n/a' : `${((t - t0) / 1000).toFixed(2)}s`);

export function cameraTransformText(id: string, totals: Record<string, number | null>, a: CameraTransformAnalysis, opts: { all?: boolean } = {}): string {
  const lines = [
    `Camera-transform analysis — replay ${id}`,
    'r13.3 re-run locally on the recorded selected-skeleton numbers. Comparison only, not live, not camera truth; owner count is not used.',
    `Totals: ${Object.entries(totals).map(([k, v]) => `${k}=${v ?? 'n/a'}`).join(' · ')}`,
    `Inputs: ${a.feeds} feeds, ${a.alignedFeeds} with a usable selected skeleton.`,
    'Signal groups: hip group = depth + hip-height-above-ankles (correlated, one group); knee group = knee flexion (independent). Transform = image scale vs calibration and ankle-anchor shift (camera/subject, not squat motion).',
  ];
  const by = (o: string) => a.cycles.filter((c) => c.outcome === o).length;
  lines.push(`Cycles: ${a.cycles.length} · counted ${by('counted')} · partial ${by('partial')} · aborted ${by('aborted')} · voided ${by('voided')} · geometry ${by('geometry')} · minRep ${by('minRep')} · with rebase ${a.cycles.filter((c) => c.rebases > 0).length}`);
  const keep = opts.all ? a.cycles : a.cycles.filter((c) => c.outcome !== 'aborted');
  if (!opts.all && keep.length !== a.cycles.length) lines.push(`(${a.cycles.length - keep.length} tiny aborted dips hidden)`);
  keep.slice(0, 200).forEach((c, i) => {
    const tf = c.transform ? `scale ×${c.transform.scale?.toFixed(2) ?? 'n/a'} · ankle shift ${c.transform.ankleShift === null ? 'n/a' : c.transform.ankleShift.toFixed(3)}` : 'transform n/a';
    const w = c.bottom ? `weights d${c.bottom.weights.depth.toFixed(2)} p${c.bottom.weights.pelvis.toFixed(2)} k${c.bottom.weights.knee.toFixed(2)}` : 'weights n/a';
    const b = c.bottom ? `bottom@${rel(c.bottom.t, a.t0)} votes ${c.bottom.votes.join('+') || 'none'}/${c.bottom.avail.join('+') || 'none'}` : 'no bottom';
    const tp = c.top ? `top@${rel(c.top.t, a.t0)} via ${c.top.via} votes ${c.top.votes.join('+') || 'composite'}/${c.top.avail.join('+') || 'none'}` : 'no top';
    lines.push(`#${i + 1} ${rel(c.tStart, a.t0)}–${rel(c.tEnd, a.t0)} ${c.outcome.toUpperCase()}${c.resync ? ' [resync cycle]' : ''} · depth Δ${c.depthRange.toFixed(2)} · hip-height drop ${c.pelvisDropTorso === null ? 'n/a' : `${c.pelvisDropTorso.toFixed(2)} torso`} · knee ${c.kneeFlexDeg === null ? 'n/a' : `${c.kneeFlexDeg}°`} · ${tf}`);
    lines.push(`   ${w} · ${b} · ${tp}`);
    lines.push(`   rebases ${c.rebases}${c.rebaseWhy ? ` (${c.rebaseWhy})` : ''} · rebottoms ${c.rebottoms} · contradictions ${c.contradictions}${c.reason ? ` · reason: ${c.reason}` : ''}`);
  });
  const ev = a.events.filter((e) => e.kind !== 'outOfOrder' && e.kind !== 'rep');
  lines.push('Rebase/occlusion events:');
  if (!ev.length) lines.push('  none');
  for (const e of ev.slice(0, 100)) lines.push(`  ${rel(e.t, a.t0)} ${e.kind}${e.detail ? ` (${e.detail})` : ''}`);
  return lines.join('\n');
}
