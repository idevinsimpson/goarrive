/**
 * THE CAMERA CONTROLLER, NATIVE (iOS/Android). Metro picks this file over
 * controller.ts on native; the web bundle never sees it. Same public API as
 * controller.ts, so CameraRepCounter.tsx drives both the same way.
 *
 * THE SOURCE is the local Expo module `modules/wsf-pose-camera`: a native view
 * that owns the front camera and runs MediaPipe PoseLandmarker in memory (same
 * model and settings as engine.ts). Its raw landmarks go through
 * nativeEngine.ts (`mapPerson`, ms timestamps, duplicate drop) into the
 * UNCHANGED RepCounterOrchestrator and frozen session.
 *
 * LIFECYCLE — the frozen web lifecycle's rules, reproduced (its <video>/rAF
 * loop cannot run here):
 *  - One owner per run. Every start takes a new run token; the native view is
 *    opened with that token and stamps it on every event. An event, or a
 *    permission answer, that arrives for an older run is ignored: a late
 *    result releases only itself.
 *  - Stop releases everything: the binding goes inactive, so the native view
 *    stops the camera and closes the model, on Finish, Close, Count by hand,
 *    pause and unmount (dispose).
 *  - Pause on AppState leaving 'active' (home, lock screen, call, Siri,
 *    Control Center) and on a native interruption. Banked set reps are kept;
 *    the member taps "Resume camera" to start a fresh run.
 *    EXCEPT while the OS permission prompt is up: the iOS alert makes the app
 *    'inactive' and the Android dialog pauses the activity ('background'), so
 *    AppState is ignored until the answer arrives. If the app really went to
 *    the background meanwhile, the opened camera is interrupted natively
 *    (iOS session interruption; CameraX follows the activity lifecycle).
 *
 * PRIVACY: frames stay in native memory; only landmark numbers arrive here,
 * and this code never stores or sends them. The camera never requests audio.
 * The native MediaPipe SDKs send Google usage telemetry (no frames, images or
 * landmarks; per-platform list in nativeCameraGate.ts), so the counter stays
 * off until the owner decides. Defence in depth: besides the support probe,
 * startCamera itself refuses (the 'unsupported' failure, manual entry) while
 * NATIVE_CAMERA_TELEMETRY_APPROVED is false, so no second mount of the camera
 * screen can show the permission prompt or create a landmarker.
 *
 * ERRORS: a listener that throws never escapes a native event handler (it
 * fails the run closed), and a native side that only sends frames the
 * adapter rejects (no timestampUnit, no size) fails the run after
 * MAX_INVALID_STREAK of them instead of looking "live" forever.
 */
import { AppState } from 'react-native';

import {
  loadWsfPoseCameraModule,
  type CameraErrorPayload,
  type CameraInterruptedPayload,
  type CameraReadyPayload,
  type PoseEventPayload,
  type WsfPoseCameraNativeModule,
} from '../../modules/wsf-pose-camera';
import { NATIVE_CAMERA_TELEMETRY_APPROVED } from './nativeCameraGate';
import { NativeFrameGate, type NativeCameraBinding, type NativeCameraHost } from './nativeEngine';
import {
  RepCounterOrchestrator,
  type CameraFailure,
  type OrchestratorOptions,
  type RepCounterSnapshot,
  type RepSetResult,
} from './orchestrator';
import type { VisualPose } from './types';
import { visualFor } from './visual';

/** What the native sides open: the front camera at 640x480 (4:3), unmirrored analysis, no audio. */
export const REQUESTED_CAMERA = { facingMode: 'user', width: 640, height: 480, frameRate: 30 } as const;

export type RepCounterView = RepCounterSnapshot & { visual: VisualPose | null };

/**
 * Consecutive rejected ('invalid') pose events after which the run fails: about 1 s at 30 fps.
 * Duplicate and older frames are ordinary drops and do not count; any accepted frame resets it.
 */
export const MAX_INVALID_STREAK = 30;

type AppStateStatusLike = string;
export interface AppStateLike {
  currentState?: AppStateStatusLike | null;
  addEventListener(type: 'change', listener: (state: AppStateStatusLike) => void): { remove(): void };
}

export interface RepCounterControllerOptions extends OrchestratorOptions {
  /** Test seam: the native module (default: the linked one, or null without it). */
  nativeModule?: WsfPoseCameraNativeModule | null;
  /** Test seam: AppState (default: react-native's). */
  appState?: AppStateLike;
  /** Auto-pause when the app leaves the foreground. Default true. */
  pauseOnHide?: boolean;
}

type Listener = (s: RepCounterView) => void;
type BindingListener = (b: NativeCameraBinding) => void;

interface Run {
  token: number;
  gate: NativeFrameGate;
  /** True while waiting for the OS permission answer (AppState is ignored then). */
  asking: boolean;
  /** Permission granted while the app was not active: open the camera on the next 'active'. */
  awaitingActive: boolean;
  ready: boolean;
  /** Pose events rejected as invalid in a row (see MAX_INVALID_STREAK). */
  invalidStreak: number;
}

const STAGES: ReadonlySet<CameraFailure> = new Set(['permission', 'model', 'inference', 'ended']);
const AWAY = new Set(['background', 'inactive']);

export class RepCounterController implements NativeCameraHost {
  private readonly orch: RepCounterOrchestrator;
  private readonly listeners = new Set<Listener>();
  private readonly bindingListeners = new Set<BindingListener>();
  private readonly native: WsfPoseCameraNativeModule | null;
  private readonly appState: AppStateLike | null;
  private readonly removeAppState: () => void;
  private run: Run | null = null;
  private nextToken = 1;
  private binding: NativeCameraBinding = { active: false, runId: 0 };
  private lastStats: NativeFrameGate['stats'] = { accepted: 0, invalid: 0, duplicate: 0, outOfOrder: 0 };
  private disposed = false;
  private readonly listening: boolean;

  constructor(opts: RepCounterControllerOptions = {}) {
    this.orch = new RepCounterOrchestrator(opts);
    this.native = opts.nativeModule === undefined ? loadWsfPoseCameraModule() : opts.nativeModule;
    this.appState = opts.appState ?? (AppState as unknown as AppStateLike);
    this.listening = (opts.pauseOnHide ?? true) && !!this.appState;
    const sub = this.listening ? this.appState!.addEventListener('change', (s) => this.onAppState(s)) : null;
    this.removeAppState = () => sub?.remove();
  }

  private onAppState(state: string): void {
    const run = this.run;
    if (state === 'active') {
      if (run?.awaitingActive) {
        run.awaitingActive = false;
        this.setBinding({ active: true, runId: run.token });
        this.emit();
      }
      return;
    }
    // The OS permission prompt makes the app inactive (iOS) or paused (Android); a granted
    // run waiting to come back has no camera open yet. Anything else pauses.
    if (run && (run.asking || run.awaitingActive)) return;
    this.pause();
  }

  get snapshot(): RepCounterView {
    return { ...this.orch.snapshot(), visual: visualFor(this.orch.subjectPose()) };
  }

  /** Whether a run currently owns the camera (permission pending, opening, or live). */
  get active(): boolean {
    return this.run !== null;
  }

  /** Frames accepted and dropped by the current (or last) run — for a dev-only HUD and the device proof. */
  get frameStats(): Readonly<NativeFrameGate['stats']> {
    return { ...(this.run ? this.run.gate.stats : this.lastStats) };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => { this.listeners.delete(fn); };
  }

  /** The native preview subscribes here to learn when to open (and for which run) or release the camera. */
  subscribeBinding(fn: BindingListener): () => void {
    this.bindingListeners.add(fn);
    fn(this.binding);
    return () => { this.bindingListeners.delete(fn); };
  }

  /**
   * Every listener gets the snapshot even if another throws. A throw (rendering) never escapes a
   * native event handler: as the web lifecycle does, it ends the open run (released, failure
   * panel with manual entry). That failure is emitted once more; the run is already gone then,
   * so a listener that throws again cannot loop.
   */
  private emit(): void {
    const s = this.snapshot;
    let threw = false;
    for (const fn of [...this.listeners]) {
      try {
        fn(s);
      } catch {
        threw = true;
      }
    }
    if (threw && this.run) this.fail(this.run, 'inference');
  }

  private setBinding(next: NativeCameraBinding) {
    if (next.active === this.binding.active && next.runId === this.binding.runId) return;
    this.binding = next;
    for (const fn of this.bindingListeners) fn(next);
  }

  private begin(): Run {
    this.release();
    const run: Run = { token: this.nextToken++, gate: new NativeFrameGate(), asking: true, awaitingActive: false, ready: false, invalidStreak: 0 };
    this.run = run;
    return run;
  }

  private owns(run: Run): boolean { return this.run === run; }

  private current(runId: unknown): Run | null {
    return this.run && this.run.token === runId ? this.run : null;
  }

  /** Invalidates the run first, then releases the camera (the view sees active: false). */
  private release(): void {
    const run = this.run;
    this.run = null;
    if (run) this.lastStats = { ...run.gate.stats };
    this.setBinding({ active: false, runId: run ? run.token : this.binding.runId });
  }

  private fail(run: Run, failure: CameraFailure): void {
    if (!this.owns(run)) return;
    this.release();
    this.orch.setCamera('failed', failure);
    this.emit();
  }

  /** Same signature as web; there is no <video> on native, so the argument is ignored. */
  async startCamera(_video?: unknown): Promise<void> {
    if (this.disposed) return;
    if (this.appState?.currentState && AWAY.has(this.appState.currentState)) return;
    this.orch.beginRun();
    const mod = this.native;
    // The telemetry gate, again: never ask for the camera (nor create a landmarker) while it is off.
    if (!NATIVE_CAMERA_TELEMETRY_APPROVED || !mod || typeof mod.requestCameraPermissionAsync !== 'function') {
      this.release();
      this.orch.setCamera('failed', 'unsupported'); this.emit(); return;
    }
    const run = this.begin();
    this.orch.setCamera('starting'); this.emit();
    let granted = false;
    try {
      granted = (await mod.requestCameraPermissionAsync())?.granted === true;
    } catch {
      granted = false;
    }
    if (!this.owns(run)) return; // stopped, paused or restarted while the OS was asking
    run.asking = false;
    if (!granted) { this.fail(run, 'permission'); return; }
    this.orch.setCamera('loadingModel');
    if (this.listening && this.appState?.currentState && AWAY.has(this.appState.currentState)) {
      // Granted while not in the foreground (Android delivers the answer just before onResume):
      // open the camera on the next 'active', never while away.
      run.awaitingActive = true;
      this.emit();
      return;
    }
    this.setBinding({ active: true, runId: run.token });
    this.emit();
  }

  // ── Native view events (each carries the run it belongs to) ────────────────

  handleReady(payload: CameraReadyPayload): void {
    const run = this.current(payload?.runId);
    if (!run || run.ready) return;
    run.ready = true;
    this.orch.setCamera('live'); this.emit();
  }

  handlePose(payload: PoseEventPayload): void {
    const run = this.current(payload?.runId);
    if (!run || !run.ready) return;
    const r = run.gate.accept(payload);
    if (!r.ok) {
      if (r.drop === 'invalid') {
        run.invalidStreak += 1;
        // A native side that only sends unusable frames would otherwise look "live" forever.
        if (run.invalidStreak >= MAX_INVALID_STREAK) this.fail(run, 'inference');
      }
      return;
    }
    run.invalidStreak = 0;
    try {
      this.orch.onFrame(r.frame);
    } catch {
      // As the web lifecycle does: a throw while counting ends the run (camera released,
      // failure panel with manual entry), never an uncaught error. A throw while rendering is
      // handled the same way inside emit().
      this.fail(run, 'inference');
      return;
    }
    this.emit();
  }

  handleError(payload: CameraErrorPayload): void {
    const run = this.current(payload?.runId);
    if (!run) return;
    // Native 'playback' means the camera could not be opened (no front camera, the simulator,
    // configuration). The web 'playback' panel is the browser's tap-to-start case, so native
    // maps it to the generic "Camera isn't available" panel.
    const stage = payload.stage as CameraFailure;
    this.fail(run, STAGES.has(stage) ? stage : 'ended');
  }

  handleInterrupted(payload: CameraInterruptedPayload): void {
    if (!this.current(payload?.runId)) return;
    this.pause();
  }

  // ── Same public API as controller.ts ──────────────────────────────────────

  /** Releases the camera and model. Banked set reps are kept. */
  stopCamera(): void {
    this.release();
    this.orch.setCamera('off'); this.emit();
  }

  private pause(): void {
    if (!this.run) return;
    this.release();
    this.orch.setCamera('paused'); this.emit();
  }

  beginSet(): boolean { const ok = this.orch.beginSet(); this.emit(); return ok; }
  finishSet(): RepSetResult { const r = this.orch.finishSet(); this.emit(); return r; }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.removeAppState();
    this.orch.setCamera('off');
    this.listeners.clear();
    this.bindingListeners.clear();
  }
}
