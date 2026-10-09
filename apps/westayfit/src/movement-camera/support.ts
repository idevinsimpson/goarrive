/**
 * Whether the squat camera can run here, and the emulator-only synthetic test
 * source. Deliberately tiny and dependency-free: the contribute screen imports
 * THIS statically, and the camera screen, controller, frozen counter and
 * engine only lazily, so none of them is on any page's first load.
 */
import { Platform } from 'react-native';

import type { CameraFailure } from './orchestrator';
import type { RawLandmark } from './visual';

// ── The synthetic test source (emulator + loopback only) ─────────────────────

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

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

export function testPoseHook(
  emulatorFlag: string | undefined,
  win: { location?: { hostname?: string }; __WSF_TEST_POSE__?: unknown } | undefined,
): TestPoseHook | null {
  const flag = (emulatorFlag ?? '').trim().toLowerCase();
  if (flag !== '1' && flag !== 'true') return null;
  if (!win || !LOOPBACK.has(win.location?.hostname ?? '')) return null;
  const raw = win.__WSF_TEST_POSE__ as Partial<TestPoseHook> | undefined;
  if (!raw || typeof raw !== 'object' || typeof raw.scene !== 'function') return null;
  return raw as TestPoseHook;
}

export function pageTestPoseHook(): TestPoseHook | null {
  const win = typeof window === 'undefined' ? undefined : (window as unknown as Parameters<typeof testPoseHook>[1]);
  return testPoseHook(process.env.EXPO_PUBLIC_WSF_USE_EMULATORS, win);
}

/** Whether this runtime can run the counter at all. Native: no (fail closed). */
export function cameraCounterSupported(): boolean {
  if (pageTestPoseHook()) return true;
  return Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

