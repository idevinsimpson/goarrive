import { FieldValue } from 'firebase-admin/firestore';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import {
  hashRenderSource,
  isCurrentRenderRequest,
  PersistedRenderedVideoMeta,
  RenderRequestIdentity,
} from './renderContract';

function currentVersion(workout: Record<string, unknown>): number {
  const renderedVideo = workout.renderedVideo as Record<string, unknown> | undefined;
  const value = renderedVideo?.version;
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

/** Atomically claim the latest source snapshot and assign its render version. */
export async function claimRenderRequest(
  db: Firestore,
  workoutRef: DocumentReference,
  expectedSourceHash: string,
): Promise<RenderRequestIdentity | null> {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(workoutRef);
    if (!snapshot.exists) return null;
    const workout = snapshot.data() as Record<string, unknown>;
    const liveSourceHash = hashRenderSource(workout);
    if (liveSourceHash !== expectedSourceHash) return null;

    const renderedVideo = workout.renderedVideo as Record<string, unknown> | undefined;
    const explicitlyPending = renderedVideo?.status === 'pending';
    const sourceNeedsRender = renderedVideo?.sourceHash !== liveSourceHash;
    if (!explicitlyPending && !sourceNeedsRender) return null;

    const identity = {
      version: currentVersion(workout) + 1,
      sourceHash: liveSourceHash,
    };
    transaction.update(workoutRef, {
      'renderedVideo.status': 'rendering',
      'renderedVideo.version': identity.version,
      'renderedVideo.sourceHash': identity.sourceHash,
      'renderedVideo.error': FieldValue.delete(),
      'renderedVideo.updatedAt': FieldValue.serverTimestamp(),
    });
    return identity;
  });
}

/** Commit ready metadata only while both version and source hash still match. */
export async function commitReadyRenderIfCurrent(
  db: Firestore,
  workoutRef: DocumentReference,
  identity: RenderRequestIdentity,
  metadata: PersistedRenderedVideoMeta,
): Promise<boolean> {
  if (metadata.version !== identity.version || metadata.sourceHash !== identity.sourceHash) {
    throw new Error('render metadata identity does not match request');
  }

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(workoutRef);
    const workout = snapshot.data() as Record<string, unknown> | undefined;
    if (!snapshot.exists || !workout || !isCurrentRenderRequest(workout, identity)) return false;
    const renderedVideo = workout.renderedVideo as Record<string, unknown> | undefined;
    if (renderedVideo?.status === 'ready') return true;
    if (renderedVideo?.status !== 'rendering' && renderedVideo?.status !== 'failed') return false;
    transaction.update(workoutRef, {
      renderedVideo: {
        ...metadata,
        renderedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
    });
    return true;
  });
}

/** Mark failure only if this exact request is still current. */
export async function commitFailedRenderIfCurrent(
  db: Firestore,
  workoutRef: DocumentReference,
  identity: RenderRequestIdentity,
  error: string,
): Promise<boolean> {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(workoutRef);
    const workout = snapshot.data() as Record<string, unknown> | undefined;
    if (!snapshot.exists || !workout || !isCurrentRenderRequest(workout, identity)) return false;
    const renderedVideo = workout.renderedVideo as Record<string, unknown> | undefined;
    if (renderedVideo?.status !== 'rendering' && renderedVideo?.status !== 'failed') return false;
    transaction.update(workoutRef, {
      'renderedVideo.status': 'failed',
      'renderedVideo.error': error.slice(0, 500),
      'renderedVideo.updatedAt': FieldValue.serverTimestamp(),
    });
    return true;
  });
}
