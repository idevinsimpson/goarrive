/**
 * NATIVE-INTEGRATOR-1 (INT-01). The injected-throw harness's site names, shared
 * by the native harness (src/crashHarness.native.ts) and its inert web stub
 * (src/crashHarness.ts).
 */
export const CRASH_HARNESS_SITES = [
  'root-shell',
  'community-tab',
  'progress',
  'community-detail-origin',
  'timer',
  'rejection',
] as const;
export type CrashSite = (typeof CRASH_HARNESS_SITES)[number];
