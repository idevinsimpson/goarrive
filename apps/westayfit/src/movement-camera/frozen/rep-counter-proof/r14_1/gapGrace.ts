// R14.1 transient measurement-gap grace — ONE pure decision shared by the live session and the
// replay simulation so both decide identically from the same lock/depth timeline.
// A null measurement sample may be SKIPPED (never synthesised, never fed, never counted) only when:
//  - the lock is still 'locked' with no reason (no ambiguity / loss),
//  - no interrupt/reset (lock loss, freshness gap, out-of-order, page hide → gap) happened since the
//    last observed sample,
//  - the sample is newer than the last observed sample and at most GAP_GRACE_MS after it.
// Otherwise the null is fed normally and the existing interrupt semantics void the partial.
export const GAP_GRACE_MS = 120;
export const R141_REVISION = 'r14.1-measurement-gap-grace-experimental';

export interface GapState { lastObsT: number | null; unsafe: boolean }
export const freshGap = (): GapState => ({ lastObsT: null, unsafe: true });

export function gapGraceOk(st: GapState, t: number, lock: string | null | undefined, reason: string | null | undefined, maxMs = GAP_GRACE_MS): boolean {
  return st.lastObsT !== null && !st.unsafe && lock === 'locked' && (reason === null || reason === undefined) && t > st.lastObsT && t - st.lastObsT <= maxMs;
}

export interface GraceRecord {
  /** Last observed sample before the gap. */
  fromT: number;
  /** Last skipped null sample. */
  toT: number;
  skipped: number;
  /** Counter stage when the gap began. */
  stage: string | null;
  /** Filled once the next observed evidence decides: 'completed' (rep counted), 'failed' (voided/rejected), 'idle' (no cycle in progress), 'open'. */
  outcome: 'completed' | 'failed' | 'idle' | 'open';
  /** First observed sample after the gap (null if none). */
  resumeT: number | null;
  /** Why the gap ended: observed data returned, or grace refused (too long/unsafe) → normal interrupt. */
  end: 'observed' | 'expired' | 'unsafe' | 'open';
}

/** Tracks graces and their outcomes from a stream of decisions (used live and in the sim). */
export class GraceLog {
  readonly graces: GraceRecord[] = [];
  private cur: GraceRecord | null = null;
  private watch: GraceRecord | null = null;
  skip(fromT: number, t: number, stage: string | null) {
    if (this.cur && this.cur.fromT === fromT) { this.cur.toT = t; this.cur.skipped += 1; return; }
    this.cur = { fromT, toT: t, skipped: 1, stage, outcome: 'open', resumeT: null, end: 'open' };
    this.graces.push(this.cur);
  }
  /** A null sample that was NOT graced (fed → interrupt). */
  refused(lockOk: boolean) {
    const g = this.cur ?? this.watch;
    if (this.cur) { this.cur.end = lockOk ? 'expired' : 'unsafe'; this.cur.outcome = this.cur.stage === 'ready' || this.cur.stage === 'unknown' ? 'idle' : 'failed'; }
    else if (g && g.outcome === 'open') g.outcome = 'failed';
    this.cur = null; this.watch = null;
  }
  interrupt() {
    if (this.cur) { this.cur.end = 'unsafe'; this.cur.outcome = this.cur.stage === 'ready' || this.cur.stage === 'unknown' ? 'idle' : 'failed'; }
    else if (this.watch && this.watch.outcome === 'open') this.watch.outcome = 'failed';
    this.cur = null; this.watch = null;
  }
  /** An observed feed with its counter result. */
  observed(t: number, event: string | null, reject: string | null, stage: string | null) {
    if (this.cur) {
      this.cur.end = 'observed'; this.cur.resumeT = t;
      if (this.cur.stage === 'ready' || this.cur.stage === 'unknown') this.cur.outcome = 'idle';
      else this.watch = this.cur;
      this.cur = null;
    }
    const w = this.watch;
    if (!w) return;
    if (event === 'rep') { w.outcome = 'completed'; this.watch = null; }
    else if (reject || event === 'partial') { w.outcome = 'failed'; this.watch = null; }
    else if (stage === 'ready' || stage === 'unknown') { w.outcome = 'failed'; this.watch = null; }
  }
}
