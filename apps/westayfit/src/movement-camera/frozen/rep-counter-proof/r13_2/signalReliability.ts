// R13.2 local-only replay runner, view cue and copyable signal-reliability analysis (comparison only).
// View cue = apparent shoulder/hip width ÷ torso length of the SELECTED skeleton → frontness 0..1.
// It describes camera projection only — never identity. Plain numbers only in copied text.
import type { TraceOp } from '../replay/traceOps';
import { MIN_VIS, SkeletonFeatureAdapter, type FrameIn } from '../r13_1/skeletonFeatures';
import { NaturalSquatCounterR13_2, R132_REVISION, type R132Cycle, type R132Event } from './naturalCounterR13_2';

/** width/torso at or below SIDE_W → 0 (side); at or above FRONT_W → 1 (front); linear between. */
export const SIDE_W = 0.15, FRONT_W = 0.5;

export function viewCue(j: (number | null)[] | null | undefined): number | null {
  if (!Array.isArray(j) || j.length !== 27) return null;
  const p = (i: number) => {
    const x = j[i * 3], y = j[i * 3 + 1], v = j[i * 3 + 2];
    return typeof x === 'number' && typeof y === 'number' && typeof v === 'number' && Number.isFinite(x) && Number.isFinite(y) && v >= MIN_VIS ? { x, y } : null;
  };
  const ls = p(1), rs = p(2), lh = p(3), rh = p(4);
  const torsos: number[] = [];
  if (ls && lh) torsos.push(Math.hypot(ls.x - lh.x, ls.y - lh.y));
  if (rs && rh) torsos.push(Math.hypot(rs.x - rh.x, rs.y - rh.y));
  if (!torsos.length) return null;
  const torso = torsos.reduce((a, b) => a + b, 0) / torsos.length;
  if (!(torso > 1e-3)) return null;
  const widths: number[] = [];
  if (ls && rs) widths.push(Math.abs(ls.x - rs.x));
  if (lh && rh) widths.push(Math.abs(lh.x - rh.x));
  if (!widths.length) return null;
  const r = Math.max(...widths) / torso;
  return Math.max(0, Math.min(1, (r - SIDE_W) / (FRONT_W - SIDE_W)));
}

export interface SignalReliabilityAnalysis {
  revision: string; t0: number | null; reps: number; feeds: number; alignedFeeds: number;
  cycles: R132Cycle[]; events: R132Event[];
  totals: { reps: number; counted: number; notDeep: number; downBrief: number; rebottom: number; interrupted: number; minRep: number; geometry: number };
}

export function runR132(ops: readonly TraceOp[], frames: readonly FrameIn[] | null): SignalReliabilityAnalysis {
  const byT = new Map<number, FrameIn>();
  if (frames) for (const f of frames) if (f && typeof f.t === 'number' && Number.isFinite(f.t)) byT.set(f.t, f);
  const c = new NaturalSquatCounterR13_2();
  const ad = new SkeletonFeatureAdapter();
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
    revision: R132_REVISION, t0, reps, feeds, alignedFeeds: aligned, cycles: c.cycles, events: c.events,
    totals: { reps, counted: reps, notDeep: n('partial'), downBrief: 0, rebottom: c.cycles.reduce((a, x) => a + x.rebottoms, 0), interrupted: n('voided'), minRep: n('minRep'), geometry: n('geometry') },
  };
}

const rel = (t: number | null, t0: number | null) => (t === null || t0 === null ? 'n/a' : `${((t - t0) / 1000).toFixed(2)}s`);
const view = (f: number | null) => (f === null ? 'view n/a' : `view ${f >= 0.66 ? 'front' : f <= 0.33 ? 'side' : 'turned'} ${f.toFixed(2)}`);

export function signalReliabilityText(id: string, totals: Record<string, number | null>, a: SignalReliabilityAnalysis, opts: { all?: boolean } = {}): string {
  const lines = [
    `Signal-reliability analysis — replay ${id}`,
    'r13.2 re-run locally on the recorded selected-skeleton numbers. Comparison only, not live, not camera truth; owner count is not used.',
    `Totals: ${Object.entries(totals).map(([k, v]) => `${k}=${v ?? 'n/a'}`).join(' · ')}`,
    `Inputs: ${a.feeds} feeds, ${a.alignedFeeds} with a usable selected skeleton. View: 0=side … 1=front (projection only).`,
  ];
  const by = (o: string) => a.cycles.filter((c) => c.outcome === o).length;
  lines.push(`Cycles: ${a.cycles.length} · counted ${by('counted')} · partial ${by('partial')} · aborted ${by('aborted')} · voided ${by('voided')} · geometry ${by('geometry')} · minRep ${by('minRep')}`);
  const keep = opts.all ? a.cycles : a.cycles.filter((c) => c.outcome !== 'aborted');
  if (!opts.all && keep.length !== a.cycles.length) lines.push(`(${a.cycles.length - keep.length} tiny aborted dips hidden)`);
  keep.slice(0, 200).forEach((c, i) => {
    const w = c.bottom ? `weights d${c.bottom.weights.depth.toFixed(2)} p${c.bottom.weights.pelvis.toFixed(2)} k${c.bottom.weights.knee.toFixed(2)}` : 'weights n/a';
    const b = c.bottom ? `bottom@${rel(c.bottom.t, a.t0)} reached ${c.bottom.reached.join('+') || 'none'} votes ${c.bottom.votes.join('+') || 'none'}/${c.bottom.avail.join('+') || 'none'}${c.bottom.fallback ? ' (one-signal fallback)' : ''}` : 'no bottom';
    const tp = c.top ? `top@${rel(c.top.t, a.t0)} via ${c.top.via} votes ${c.top.votes.join('+') || 'composite'}/${c.top.avail.join('+') || 'none'}` : 'no top';
    lines.push(`#${i + 1} ${rel(c.tStart, a.t0)}–${rel(c.tEnd, a.t0)} ${c.outcome.toUpperCase()}${c.resync ? ' [resync cycle]' : ''} · ${view(c.front)} · signals ${c.signalsSeen.join('+') || 'none'} · depth Δ${c.depthRange.toFixed(2)} · pelvis ${c.pelvisDropTorso === null ? 'n/a' : `${c.pelvisDropTorso.toFixed(2)} torso`} · knee ${c.kneeFlexDeg === null ? 'n/a' : `${c.kneeFlexDeg}°`} · lean max ${c.maxLean === null ? 'n/a' : `${c.maxLean}°`}`);
    lines.push(`   ${w} · ${b} · ${tp}`);
    lines.push(`   hesitations ${c.hesitations} · rebottoms ${c.rebottoms} · contradictions ${c.contradictions} · side switches ${c.sideSwitches}${c.reason ? ` · reason: ${c.reason}` : ''}${c.hingeEvidence && c.outcome !== 'geometry' ? ` · ${c.hingeEvidence}` : ''}`);
  });
  const occ = a.events.filter((e) => e.kind !== 'outOfOrder' && e.kind !== 'rep');
  lines.push('Occlusion/resync events:');
  if (!occ.length) lines.push('  none');
  for (const e of occ.slice(0, 100)) lines.push(`  ${rel(e.t, a.t0)} ${e.kind}${e.detail ? ` (${e.detail})` : ''}`);
  return lines.join('\n');
}
