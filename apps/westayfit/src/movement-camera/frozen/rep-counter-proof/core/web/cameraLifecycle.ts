import type { PoseEstimator } from '../adapter';
import type { PoseFrame } from '../types';

export type CameraFailureStage = 'permission' | 'playback' | 'model' | 'inference' | 'ended';

interface CameraCallbacks {
  onLoading(): void;
  onReady(engine: string): void;
  onFrame(frame: PoseFrame, video: HTMLVideoElement, now: number): void;
  onError(stage: CameraFailureStage, error: unknown): void;
}

interface CameraDependencies {
  getVideo(): HTMLVideoElement | null;
  getUserMedia(): Promise<MediaStream>;
  createEstimator(): Promise<PoseEstimator>;
  requestFrame(callback: FrameRequestCallback): number;
  cancelFrame(id: number): void;
}

interface Run {
  stream?: MediaStream;
  video?: HTMLVideoElement;
  estimator?: PoseEstimator;
  frameId?: number;
  removeListeners?: () => void;
  onError: CameraCallbacks['onError'];
}

/**
 * One owner for a camera or synthetic loop. Each start gets its own run;
 * Stop invalidates it before releasing anything. Permission and model loads
 * cannot be cancelled by their APIs, so a late result releases only itself.
 * An obsolete continuation never touches the active video, UI or frame loop.
 */
export class MovementCameraLifecycle {
  private current: Run | null = null;

  constructor(private readonly dependencies: CameraDependencies) {}

  get active(): boolean {
    return this.current !== null;
  }

  async startCamera(callbacks: CameraCallbacks): Promise<void> {
    const run = this.begin(callbacks.onError);
    let stage: CameraFailureStage = 'permission';
    try {
      const stream = await this.dependencies.getUserMedia();
      if (!this.owns(run)) {
        stopTracks(stream);
        return;
      }
      run.stream = stream;
      stage = 'playback';
      const video = this.dependencies.getVideo();
      if (!video) throw new Error('The camera view is no longer available.');
      run.video = video;

      const tracks = stream.getVideoTracks();
      const onEnded = () => this.fail(run, 'ended', new Error('The camera stream ended.'));
      const onVideoError = () => this.fail(run, 'playback', video.error);
      run.removeListeners = () => {
        for (const track of tracks) track.removeEventListener('ended', onEnded);
        video.removeEventListener('error', onVideoError);
      };
      for (const track of tracks) track.addEventListener('ended', onEnded);
      video.addEventListener('error', onVideoError);
      if (tracks.length === 0 || tracks.some((track) => track.readyState === 'ended')) {
        onEnded();
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (!this.owns(run)) return;

      stage = 'model';
      callbacks.onLoading();
      if (!this.owns(run)) return;
      const estimator = await this.dependencies.createEstimator();
      if (!this.owns(run)) {
        closeEstimator(estimator);
        return;
      }
      run.estimator = estimator;
      callbacks.onReady(estimator.engine);
      if (!this.owns(run)) return;

      let lastVideoTime = -1;
      this.schedule(run, (now) => {
        if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
        lastVideoTime = video.currentTime;
        const frame = estimator.estimate(video, now);
        if (this.owns(run)) callbacks.onFrame(frame, video, now);
      });
    } catch (error) {
      this.fail(run, stage, error);
    }
  }

  startSynthetic(onFrame: (now: number) => void, onError: CameraCallbacks['onError']): void {
    this.schedule(this.begin(onError), onFrame);
  }

  /** Also used by source changes, page suspension and route cleanup. */
  stop(): void {
    const run = this.current;
    this.current = null;
    if (!run) return;
    if (run.frameId !== undefined) this.dependencies.cancelFrame(run.frameId);
    run.removeListeners?.();
    if (run.video && run.video.srcObject === run.stream) {
      // Do not clear a video that a newer run has already attached to.
      try { run.video.pause(); } catch { /* Release the stream even if playback cleanup fails. */ }
      run.video.srcObject = null;
    }
    if (run.stream) stopTracks(run.stream);
    if (run.estimator) closeEstimator(run.estimator);
  }

  private begin(onError: CameraCallbacks['onError']): Run {
    this.stop();
    const run: Run = { onError };
    this.current = run;
    return run;
  }

  private owns(run: Run): boolean {
    return this.current === run;
  }

  private fail(run: Run, stage: CameraFailureStage, error: unknown): void {
    if (!this.owns(run)) return;
    this.stop();
    run.onError(stage, error);
  }

  private schedule(run: Run, onFrame: (now: number) => void): void {
    if (!this.owns(run)) return;
    run.frameId = this.dependencies.requestFrame((now) => {
      run.frameId = undefined;
      if (!this.owns(run)) return;
      try {
        onFrame(now);
      } catch (error) {
        this.fail(run, 'inference', error);
        return;
      }
      this.schedule(run, onFrame);
    });
  }
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try { track.stop(); } catch { /* One failed track must not prevent the others from stopping. */ }
  }
}

function closeEstimator(estimator: PoseEstimator): void {
  try { estimator.close(); } catch { /* Camera cleanup must still finish if the engine rejects close. */ }
}
