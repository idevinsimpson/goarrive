import * as admin from 'firebase-admin';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  buildRenderStorageLocation,
  isValidRenderRequestIdentity,
  PersistedRenderedVideoMeta,
  RenderedSegmentOffset,
} from './renderContract';

export const RENDERED_VIDEO_SIGNED_URL_TTL_MS = 15 * 60 * 1000;

export interface ResolveRenderedVideoInput {
  workoutId: string;
  assignmentId?: string;
  sessionInstanceId?: string;
}

export interface ResolvedRenderedVideoMeta extends PersistedRenderedVideoMeta {
  url: string;
  expiresAt: number;
}

interface ResolverAuth {
  uid: string;
  token: Record<string, unknown>;
}

interface ResolveRenderedVideoRequest {
  auth?: ResolverAuth;
  data: unknown;
}

export interface RenderedVideoResolverDependencies {
  bucketName: string;
  loadWorkout: (workoutId: string) => Promise<Record<string, unknown> | null>;
  loadAssignment: (assignmentId: string) => Promise<Record<string, unknown> | null>;
  loadSessionInstance: (sessionInstanceId: string) => Promise<Record<string, unknown> | null>;
  loadPlaybook: (playbookId: string) => Promise<Record<string, unknown> | null>;
  signReadUrl: (storageObject: string, expiresAt: number) => Promise<string>;
  now: () => number;
}

function requiredDocumentId(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.includes('/')) {
    throw new HttpsError('invalid-argument', `${field} must be a valid document ID`);
  }
  return value;
}

function optionalDocumentId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredDocumentId(value, field);
}

export function parseResolveRenderedVideoInput(value: unknown): ResolveRenderedVideoInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpsError('invalid-argument', 'Request data is required');
  }
  const data = value as Record<string, unknown>;
  const input = {
    workoutId: requiredDocumentId(data.workoutId, 'workoutId'),
    assignmentId: optionalDocumentId(data.assignmentId, 'assignmentId'),
    sessionInstanceId: optionalDocumentId(data.sessionInstanceId, 'sessionInstanceId'),
  };
  if (input.assignmentId && input.sessionInstanceId) {
    throw new HttpsError(
      'invalid-argument',
      'Provide at most one of assignmentId or sessionInstanceId',
    );
  }
  return input;
}

function isAdmin(token: Record<string, unknown>): boolean {
  return token.role === 'platformAdmin' || token.admin === true || token.platformAdmin === true;
}

function isCoach(token: Record<string, unknown>): boolean {
  return token.role === 'coach';
}

function directlyCanReadWorkout(
  auth: ResolverAuth,
  workout: Record<string, unknown>,
): boolean {
  if (isAdmin(auth.token)) return true;
  const coachId = workout.coachId;
  if (typeof coachId === 'string' &&
      (auth.uid === coachId || (isCoach(auth.token) && auth.token.coachId === coachId))) {
    return true;
  }
  return workout.isShared === true && isCoach(auth.token);
}

function selectedPlaybookWorkoutId(playbook: Record<string, unknown>): string | null {
  const workoutIds = Array.isArray(playbook.workoutIds)
    ? playbook.workoutIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : [];
  if (workoutIds.length === 0) return null;
  const rawIndex = playbook.nextWorkoutIndex;
  const index = Number.isInteger(rawIndex) ? rawIndex as number : 0;
  return workoutIds[((index % workoutIds.length) + workoutIds.length) % workoutIds.length];
}

async function hasAssignmentAccess(
  auth: ResolverAuth,
  input: ResolveRenderedVideoInput,
  workout: Record<string, unknown>,
  dependencies: RenderedVideoResolverDependencies,
): Promise<boolean> {
  if (!input.assignmentId) return false;
  const assignment = await dependencies.loadAssignment(input.assignmentId);
  if (!assignment || typeof workout.coachId !== 'string' || workout.coachId.length === 0) {
    return false;
  }
  return assignment.memberId === auth.uid &&
    assignment.workoutId === input.workoutId &&
    assignment.coachId === workout.coachId;
}

async function hasSessionAccess(
  auth: ResolverAuth,
  input: ResolveRenderedVideoInput,
  workout: Record<string, unknown>,
  dependencies: RenderedVideoResolverDependencies,
): Promise<boolean> {
  if (!input.sessionInstanceId) return false;
  const session = await dependencies.loadSessionInstance(input.sessionInstanceId);
  if (!session || session.memberId !== auth.uid ||
      typeof workout.coachId !== 'string' || workout.coachId.length === 0 ||
      session.coachId !== workout.coachId) {
    return false;
  }

  if (typeof session.pinnedWorkoutId === 'string' && session.pinnedWorkoutId.length > 0) {
    return session.pinnedWorkoutId === input.workoutId;
  }
  if (typeof session.playbookId !== 'string' || session.playbookId.length === 0) return false;
  const playbook = await dependencies.loadPlaybook(session.playbookId);
  if (!playbook) return false;
  if (playbook.coachId !== workout.coachId) return false;
  return selectedPlaybookWorkoutId(playbook) === input.workoutId;
}

const RENDERED_VIDEO_PHASES = new Set([
  'intro',
  'outro',
  'follow-along',
  'special',
  'work',
  'movement-rest',
  'block-rest',
]);

function isRenderedSegmentOffset(value: unknown): value is RenderedSegmentOffset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  return typeof block.blockId === 'string' && block.blockId.length > 0 &&
    typeof block.parentBlockId === 'string' && block.parentBlockId.length > 0 &&
    Number.isInteger(block.blockIndex) &&
    typeof block.phase === 'string' && RENDERED_VIDEO_PHASES.has(block.phase) &&
    Number.isInteger(block.segmentIndex) &&
    Number.isFinite(block.startMs) && Number.isFinite(block.endMs) &&
    (block.startMs as number) >= 0 && (block.endMs as number) > (block.startMs as number) &&
    (block.movementId === undefined || typeof block.movementId === 'string') &&
    (block.movementIndex === undefined || Number.isInteger(block.movementIndex));
}

function copyRenderedSegmentOffset(block: RenderedSegmentOffset): RenderedSegmentOffset {
  return {
    blockId: block.blockId,
    parentBlockId: block.parentBlockId,
    blockIndex: block.blockIndex,
    phase: block.phase,
    segmentIndex: block.segmentIndex,
    ...(block.movementId === undefined ? {} : { movementId: block.movementId }),
    ...(block.movementIndex === undefined ? {} : { movementIndex: block.movementIndex }),
    startMs: block.startMs,
    endMs: block.endMs,
  };
}

/**
 * Validate and copy the durable metadata before signing anything. The exact
 * storage location is reconstructed from trusted identity fields, so a
 * corrupted or user-controlled path can never select another object/bucket.
 */
export function validatedReadyMetadata(
  bucketName: string,
  workoutId: string,
  workout: Record<string, unknown>,
): { metadata: PersistedRenderedVideoMeta; storageObject: string } {
  const renderedVideo = workout.renderedVideo;
  if (!renderedVideo || typeof renderedVideo !== 'object' || Array.isArray(renderedVideo)) {
    throw new HttpsError('failed-precondition', 'Rendered video is not ready');
  }
  const raw = renderedVideo as Record<string, unknown>;
  if (raw.status !== 'ready') {
    throw new HttpsError('failed-precondition', 'Rendered video is not ready');
  }
  const identity = { version: raw.version as number, sourceHash: raw.sourceHash as string };
  if (!isValidRenderRequestIdentity(identity) ||
      typeof raw.durationMs !== 'number' || !Number.isFinite(raw.durationMs) || raw.durationMs < 0 ||
      !Array.isArray(raw.blocks) || !raw.blocks.every(isRenderedSegmentOffset)) {
    throw new HttpsError('data-loss', 'Stored rendered video metadata is invalid');
  }
  const blocks = raw.blocks as RenderedSegmentOffset[];
  const blockIds = new Set<string>();
  let previousEnd = 0;
  for (const block of blocks) {
    if (blockIds.has(block.blockId) || block.startMs < previousEnd || block.endMs > raw.durationMs) {
      throw new HttpsError('data-loss', 'Stored rendered video timeline is invalid');
    }
    blockIds.add(block.blockId);
    previousEnd = block.endMs;
  }

  let location;
  try {
    location = buildRenderStorageLocation(bucketName, workoutId, identity);
  } catch {
    throw new HttpsError('data-loss', 'Stored rendered video metadata is invalid');
  }
  if (raw.storagePath !== location.storagePath) {
    throw new HttpsError('data-loss', 'Stored rendered video path does not match its identity');
  }

  return {
    metadata: {
      status: 'ready',
      storagePath: location.storagePath,
      durationMs: raw.durationMs,
      version: identity.version,
      sourceHash: identity.sourceHash,
      blocks: blocks.map(copyRenderedSegmentOffset),
    },
    storageObject: location.storageObject,
  };
}

export async function resolveRenderedVideoForCaller(
  request: ResolveRenderedVideoRequest,
  dependencies: RenderedVideoResolverDependencies,
): Promise<ResolvedRenderedVideoMeta> {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Sign in required');
  }
  const input = parseResolveRenderedVideoInput(request.data);
  const workout = await dependencies.loadWorkout(input.workoutId);
  if (!workout) throw new HttpsError('not-found', 'Workout not found');

  const authorized = directlyCanReadWorkout(request.auth, workout) ||
    await hasAssignmentAccess(request.auth, input, workout, dependencies) ||
    await hasSessionAccess(request.auth, input, workout, dependencies);
  if (!authorized) {
    throw new HttpsError('permission-denied', 'You cannot access this rendered workout');
  }

  const { metadata, storageObject } = validatedReadyMetadata(
    dependencies.bucketName,
    input.workoutId,
    workout,
  );
  const expiresAt = dependencies.now() + RENDERED_VIDEO_SIGNED_URL_TTL_MS;
  const url = await dependencies.signReadUrl(storageObject, expiresAt);
  if (!url.startsWith('https://')) {
    throw new HttpsError('internal', 'Rendered video signer returned an invalid URL');
  }
  return { ...metadata, url, expiresAt };
}

function defaultDependencies(): RenderedVideoResolverDependencies {
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const load = async (collection: string, id: string): Promise<Record<string, unknown> | null> => {
    const snapshot = await db.collection(collection).doc(id).get();
    return snapshot.exists ? snapshot.data() as Record<string, unknown> : null;
  };
  return {
    bucketName: bucket.name,
    loadWorkout: (id) => load('workouts', id),
    loadAssignment: (id) => load('workout_assignments', id),
    loadSessionInstance: (id) => load('session_instances', id),
    loadPlaybook: (id) => load('playbooks', id),
    signReadUrl: async (storageObject, expiresAt) => {
      const [url] = await bucket.file(storageObject).getSignedUrl({
        action: 'read',
        expires: new Date(expiresAt),
        version: 'v4',
      });
      return url;
    },
    now: Date.now,
  };
}

export const resolveRenderedWorkoutVideo = onCall(
  { region: 'us-central1', invoker: 'public' },
  async (request) => resolveRenderedVideoForCaller(
    {
      auth: request.auth ? {
        uid: request.auth.uid,
        token: request.auth.token as Record<string, unknown>,
      } : undefined,
      data: request.data,
    },
    defaultDependencies(),
  ),
);
