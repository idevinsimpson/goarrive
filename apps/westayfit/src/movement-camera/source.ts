/**
 * WHERE CAMERA FRAMES COME FROM.
 *
 * A PoseSource turns "now" into one CameraFrame (counting poses plus their
 * visual-only points) and owns whatever it had to open to do that. Stopping it
 * releases everything: tracks stopped, model closed, nothing left running.
 *
 * Two sources exist:
 *
 *  - THE ON-DEVICE ENGINE (web): the camera and a pinned pose model. It is
 *    not in this build — it needs one approved dependency (#497 scope delta),
 *    and until it lands `enginePoseSourceFactory` is null, so the counter is
 *    UNSUPPORTED and the existing manual squat flow is all a member sees. That
 *    is fail-closed, not a hidden feature.
 *  - THE SYNTHETIC TEST SOURCE: scripted stick-figure poses, readable only on
 *    an emulator build served from loopback, exactly like the demo-media test
 *    catalog. It never opens a camera. It exists so the flow can be proven end
 *    to end; it is not evidence that counting works on real bodies.
 *
 * Neither records, stores or uploads a frame. A frame is read, turned into
 * landmarks in memory, and dropped.
 */
import type { CameraFrame } from './types';

export type CameraFailure = 'permission' | 'unsupported' | 'model' | 'playback' | 'ended';

export class CameraSourceError extends Error {
  constructor(readonly stage: CameraFailure) {
    super(`camera source failed: ${stage}`);
  }
}

export interface PoseSource {
  /** The camera stream to show behind the count, if this source uses a camera. */
  readonly stream: MediaStream | null;
  /** One frame for `nowMs`, or null when nothing new is available. */
  estimate(video: HTMLVideoElement | null, nowMs: number): CameraFrame | null;
  /** Release everything. Idempotent. */
  stop(): void;
}

export type PoseSourceFactory = () => Promise<PoseSource>;

/** The real on-device engine. Absent until its dependency is approved. */
export const enginePoseSourceFactory: PoseSourceFactory | null = null;

// ── The synthetic test source ───────────────────────────────────────────────

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * What a test installs on `window.__WSF_TEST_POSE__` (emulator + loopback only):
 * a scene function from milliseconds-since-start to poses, an optional failure
 * to raise at start, and an `active` flag the source keeps truthful so a test
 * can see that the camera was released.
 */
export interface TestPoseHook {
  scene: (tMs: number) => Pick<CameraFrame, 'poses' | 'visuals'>;
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

export function syntheticPoseSourceFactory(hook: TestPoseHook): PoseSourceFactory {
  return async () => {
    if (hook.fail) throw new CameraSourceError(hook.fail);
    let t0: number | null = null;
    let stopped = false;
    hook.active = true;
    hook.starts = (hook.starts ?? 0) + 1;
    return {
      stream: null,
      estimate(_video, nowMs) {
        if (stopped) return null;
        if (t0 === null) t0 = nowMs;
        const { poses, visuals } = hook.scene(nowMs - t0);
        return { timestampMs: nowMs, poses, visuals };
      },
      stop() {
        stopped = true;
        hook.active = false;
      },
    };
  };
}

/** The source this page may use, or null when the counter is unsupported here. */
export function poseSourceFactory(): PoseSourceFactory | null {
  const win =
    typeof window === 'undefined' ? undefined : (window as unknown as Parameters<typeof testPoseHook>[1]);
  const hook = testPoseHook(process.env.EXPO_PUBLIC_WSF_USE_EMULATORS, win);
  if (hook) return syntheticPoseSourceFactory(hook);
  return enginePoseSourceFactory;
}
