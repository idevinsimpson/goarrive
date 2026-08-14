import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import type { ResolvedRenderedVideoMeta } from './renderedVideoOffsetMap';

export interface ResolveRenderedVideoPlaybackInput {
  workoutId: string;
  assignmentId?: string;
  sessionInstanceId?: string;
}

export interface ResolvedRenderedVideoPlaybackMeta extends ResolvedRenderedVideoMeta {
  expiresAt: number;
}

/**
 * Resolve durable rendered-video metadata immediately before activating the
 * continuous-video hook. Callers keep this response in memory only and call
 * again after `expiresAt`; signed URLs must never be written to Firestore.
 */
export async function resolveRenderedVideoForPlayback(
  input: ResolveRenderedVideoPlaybackInput,
): Promise<ResolvedRenderedVideoPlaybackMeta> {
  const resolve = httpsCallable<
    ResolveRenderedVideoPlaybackInput,
    ResolvedRenderedVideoPlaybackMeta
  >(functions, 'resolveRenderedWorkoutVideo');
  const response = await resolve(input);
  return response.data;
}
