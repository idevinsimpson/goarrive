/**
 * THE CAMERA CONTROLLER: owns the camera and model lifecycle and feeds the
 * orchestrator (reference: Lovable e15b9fa0@1454357
 * src/integration/rep-counter/controller.ts, ported). It uses the FROZEN
 * camera lifecycle unchanged: one owner per run, a late permission or model
 * result releases only itself, and stop() releases tracks, video and model.
 *
 * PRIVACY: frames are processed in memory only; nothing is recorded, stored
 * or uploaded. The camera never requests audio.
 *
 * TWO SOURCES.
 *  - 'engine' (web): the front camera and the on-device pose engine
 *    (engine.ts), loaded lazily on the first start.
 *  - 'synthetic': scripted BlazePose-shaped landmarks from
 *    `window.__WSF_TEST_POSE__`, readable ONLY on an emulator build served
 *    from loopback (testPoseHook). It opens no camera. It proves the flow;
 *    it is not evidence that counting works on a real body.
 * Native has neither, so the counter is unsupported there and the existing
 * manual flow is all a member sees (fail closed).
 */
import { Platform } from 'react-native';

import { MovementCameraLifecycle, type CameraFailureStage, type PoseEstimator } from './frozen';
import {
  RepCounterOrchestrator,
  type CameraFailure,
  type OrchestratorOptions,
  type RepCounterSnapshot,
  type RepSetResult,
} from './orchestrator';
import type { VisualPose } from './types';
import { mapPerson, visualFor, type RawLandmark } from './visual';

export const REQUESTED_CAMERA = { facingMode: 'user', width: 640, height: 480, frameRate: 60 } as const;

export type RepCounterView = RepCounterSnapshot & { visual: VisualPose | null };

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

function pageTestPoseHook(): TestPoseHook | null {
  const win = typeof window === 'undefined' ? undefined : (window as unknown as Parameters<typeof testPoseHook>[1]);
  return testPoseHook(process.env.EXPO_PUBLIC_WSF_USE_EMULATORS, win);
}

/** Whether this runtime can run the counter at all. Native: no (fail closed). */
export function cameraCounterSupported(): boolean {
  if (pageTestPoseHook()) return true;
  return Platform.OS === 'web' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

// ── The controller ────────────────────────────────────────────────────────────

async function openCamera(): Promise<MediaStream> {
  const { facingMode, width, height, frameRate } = REQUESTED_CAMERA;
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode, width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: frameRate } },
    });
  } catch (e) {
    if ((e as { name?: string })?.name !== 'OverconstrainedError') throw e;
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode } });
  }
}

export interface RepCounterControllerOptions extends OrchestratorOptions {
  /** Test seams. */
  getUserMedia?: () => Promise<MediaStream>;
  createEstimator?: () => Promise<PoseEstimator>;
  testHook?: TestPoseHook | null;
  /** Auto-pause when the page is hidden / left. Default true. */
  pauseOnHide?: boolean;
}

type Listener = (s: RepCounterView) => void;

export class RepCounterController {
  private readonly orch: RepCounterOrchestrator;
  private readonly life: MovementCameraLifecycle;
  private readonly listeners = new Set<Listener>();
  private readonly hook: TestPoseHook | null;
  private video: HTMLVideoElement | null = null;
  private disposed = false;
  private readonly removeHide: () => void;

  constructor(opts: RepCounterControllerOptions = {}) {
    this.orch = new RepCounterOrchestrator(opts);
    this.hook = opts.testHook === undefined ? pageTestPoseHook() : opts.testHook;
    this.life = new MovementCameraLifecycle({
      getVideo: () => this.video,
      getUserMedia: opts.getUserMedia ?? openCamera,
      createEstimator: opts.createEstimator ?? (async () => (await import('./engine')).createPoseEstimator(3)),
      requestFrame: (cb) => requestAnimationFrame(cb),
      cancelFrame: (id) => cancelAnimationFrame(id),
    });
    const onHide = () => { if (document.visibilityState === 'hidden') this.pause(); };
    const onPageHide = () => this.pause();
    const listen = (opts.pauseOnHide ?? true) && typeof document !== 'undefined' && typeof window !== 'undefined';
    if (listen) {
      document.addEventListener('visibilitychange', onHide);
      window.addEventListener('pagehide', onPageHide);
    }
    this.removeHide = () => {
      if (!listen) return;
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }

  get snapshot(): RepCounterView {
    return { ...this.orch.snapshot(), visual: visualFor(this.orch.subjectPose()) };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => { this.listeners.delete(fn); };
  }

  private emit() { const s = this.snapshot; for (const fn of this.listeners) fn(s); }

  private syncHook() { if (this.hook) this.hook.active = this.life.active; }

  /** Attach a muted, playsInline <video> (null for the synthetic source) and start. */
  async startCamera(video: HTMLVideoElement | null): Promise<void> {
    if (this.disposed) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    this.orch.beginRun();
    if (this.hook) return this.startSynthetic(this.hook);
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia || !video) {
      this.orch.setCamera('failed', 'unsupported'); this.emit(); return;
    }
    video.muted = true; video.playsInline = true; video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
    this.video = video;
    this.orch.setCamera('starting'); this.emit();
    const started = this.life.startCamera({
      onLoading: () => { this.orch.setCamera('loadingModel'); this.emit(); },
      onReady: () => { this.orch.setCamera('live'); this.emit(); },
      onFrame: (frame) => { this.orch.onFrame(frame); this.emit(); },
      onError: (stage: CameraFailureStage) => { this.orch.setCamera('failed', stage); this.syncHook(); this.emit(); },
    });
    this.syncHook();
    await started;
    this.syncHook();
  }

  private startSynthetic(hook: TestPoseHook): void {
    this.orch.setCamera('starting'); this.emit();
    if (hook.fail) { this.orch.setCamera('failed', hook.fail); this.emit(); return; }
    hook.starts = (hook.starts ?? 0) + 1;
    let t0: number | null = null;
    this.orch.setCamera('live'); this.emit();
    this.life.startSynthetic(
      (now) => {
        if (t0 === null) t0 = now;
        const poses = hook.scene(now - t0).map((raw) => mapPerson(raw));
        this.orch.onFrame({ timestampMs: now, poses, aspect: 9 / 16 });
        this.emit();
      },
      (stage) => { this.orch.setCamera('failed', stage); this.syncHook(); this.emit(); },
    );
    this.syncHook();
  }

  /** Stops tracks and releases the model. Banked set reps are kept. */
  stopCamera(): void {
    this.life.stop();
    this.syncHook();
    this.orch.setCamera('off'); this.emit();
  }

  private pause(): void {
    if (!this.life.active) return;
    this.life.stop();
    this.syncHook();
    this.orch.setCamera('paused'); this.emit();
  }

  beginSet(): boolean { const ok = this.orch.beginSet(); this.emit(); return ok; }
  finishSet(): RepSetResult { const r = this.orch.finishSet(); this.emit(); return r; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.life.stop();
    this.syncHook();
    this.removeHide();
    this.orch.setCamera('off');
    this.listeners.clear();
    this.video = null;
  }
}
