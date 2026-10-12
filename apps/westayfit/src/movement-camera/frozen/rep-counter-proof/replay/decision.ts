// R10-REPLAY-1 — the ACTUAL evaluated rule decision for one fed sample (r10/r11 counters only).
// Captured inside the counter's own step BEFORE any run/peak state is cleared, so diagnostics show
// the lines and confirmation runs the rule really used, not static nominal lines.
import type { Reject, Stage } from '../r6/naturalCounter';

export interface RuleDecision {
  t: number;
  /** Raw depth fed (null = unusable sample, voids an unfinished cycle). */
  raw: number | null;
  /** Mean of the last N observed depths (null while the window is still filling). */
  mean: number | null;
  /** Dynamic 'lowered' line actually tested this sample. */
  lowered: number | null;
  /** Dynamic return line actually tested (only while rising), else null. */
  returnLine: number | null;
  /** Line a sample must be at/below to count as 'at the top' in ready/descending. */
  readyLine: number;
  /** Lowest-depth reference used by the lowered line. */
  base: number;
  /** Observed peak of the current cycle at decision time (before any reset). */
  peak: number;
  /** Confirmation runs AFTER this sample (bottom/top), before clearing. */
  bottomRun: number;
  topRun: number;
  stageBefore: Stage;
  stageAfter: Stage;
  /** Increments each time the counter leaves a confirmed top (ready → not top). */
  cycle: number;
  event: 'rep' | 'partial' | null;
  reject: Reject | null;
}

export const blankDecision = (t: number, stage: Stage, cycle: number, readyLine: number, base: number): RuleDecision => ({
  t, raw: null, mean: null, lowered: null, returnLine: null, readyLine, base, peak: 0, bottomRun: 0, topRun: 0,
  stageBefore: stage, stageAfter: stage, cycle, event: null, reject: null,
});
