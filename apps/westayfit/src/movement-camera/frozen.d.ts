// Type surface for frozen.js. Describes only what the app reads from the frozen session
// (the reference's src/integration/rep-counter/frozen.d.ts, minus its Vite asset exports).
import type { Keypoint, Landmark, Pose, PoseFrame } from './frozen/rep-counter-proof/core/types';
import type { PoseEstimator } from './frozen/rep-counter-proof/core/adapter';

export type { Keypoint, Landmark, Pose, PoseFrame, PoseEstimator };

export interface FrozenSnapshot {
  reps: number;
  lockState: 'searching' | 'acquiring' | 'locked' | 'lost';
  lockReason: string | null;
  subject: Pose | null;
  armed: boolean;
  frameIssue: 'outOfOrder' | 'gap' | null;
  counting: boolean;
}
export interface FrozenSession {
  update(frame: PoseFrame): FrozenSnapshot;
  reset(): FrozenSnapshot;
  readonly snapshot: FrozenSnapshot;
}
export declare function makeSessionR1421(): FrozenSession;

export type CameraFailureStage = 'permission' | 'playback' | 'model' | 'inference' | 'ended';
export declare class MovementCameraLifecycle {
  constructor(dependencies: {
    getVideo(): HTMLVideoElement | null;
    getUserMedia(): Promise<MediaStream>;
    createEstimator(): Promise<PoseEstimator>;
    requestFrame(callback: FrameRequestCallback): number;
    cancelFrame(id: number): void;
  });
  readonly active: boolean;
  startCamera(callbacks: {
    onLoading(): void;
    onReady(engine: string): void;
    onFrame(frame: PoseFrame, video: HTMLVideoElement, now: number): void;
    onError(stage: CameraFailureStage, error: unknown): void;
  }): Promise<void>;
  startSynthetic(onFrame: (now: number) => void, onError: (stage: CameraFailureStage, error: unknown) => void): void;
  stop(): void;
}

export declare const KEYPOINTS: readonly Keypoint[];
