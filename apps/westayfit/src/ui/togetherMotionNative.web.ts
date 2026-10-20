/**
 * NATIVE-MOTION-1 — the web build's stand-in for togetherMotionNative.tsx.
 *
 * Metro resolves this file for the web platform, so the web bundle never
 * carries the native driver, its sampled timeline or its views. TogetherCompletion
 * calls these only on iOS/Android (every call site is behind `Platform.OS !==
 * 'web'`), so on the web none of them runs and the web runtime is unchanged:
 * the web keeps playing `runTogetherMotion` from togetherMotion.ts.
 *
 * If one were ever reached on the web, it would fail safe: building a run
 * throws (TogetherCompletion settles on that), starting one is a no-op whose
 * stop settles, and the layer renders nothing.
 */
import { memo } from 'react';

import type { NativeTogetherRun, TogetherGeometry } from './togetherMotionNative';

export type { NativeTogetherRun, TogetherGeometry } from './togetherMotionNative';

export function createNativeTogetherRun(_geom: TogetherGeometry): NativeTogetherRun {
  throw new Error('The native Together motion does not run on the web.');
}

export function startTogetherNativeMotion(opts: {
  run: NativeTogetherRun;
  from: number;
  to: number;
  onRatio: (ratio: number) => void;
  onSettled: () => void;
}): (finish: boolean) => void {
  return (finish) => {
    if (!finish) return;
    opts.onRatio(opts.to);
    opts.onSettled();
  };
}

// The same shape as the native export (a memoised component), rendering nothing.
export const TogetherNativeLayer = memo(function TogetherNativeLayer(_props: { run: NativeTogetherRun }) {
  return null;
});
