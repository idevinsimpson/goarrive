/**
 * THE SYNTHETIC TEST SOURCE'S SHAPE, shared by support.ts (web) and
 * support.native.ts. Deliberately suffix-free, with no platform sibling: under
 * Metro's native resolution `./support` is support.native.ts itself, so a type
 * imported from there would be circular (TS2303) and native type-checking
 * would lose the hook's real shape. Types only; nothing here reaches a bundle.
 */
import type { CameraFailure } from './orchestrator';
import type { RawLandmark } from './visual';

/**
 * What a test installs on `window.__WSF_TEST_POSE__`: a scene from
 * milliseconds-since-start to raw BlazePose landmark lists (one per person),
 * an optional failure to raise at start, and `active` / `starts`, which the
 * controller keeps truthful so a test can see the camera was released.
 */
export interface TestPoseHook {
  scene: (tMs: number) => RawLandmark[][];
  fail?: CameraFailure;
  active?: boolean;
  starts?: number;
}
