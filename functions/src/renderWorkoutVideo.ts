// Firestore trigger for the private Cloud Run render service.
//
// A source change or explicit `renderedVideo.status = "pending"` atomically
// claims one {version, sourceHash} identity before a Cloud Tasks HTTP request
// is created. Cloud Tasks uses a Google-signed OIDC token whose audience is
// the Cloud Run service origin. See docs/render-workout-video-service.md.

import * as admin from 'firebase-admin';
import { CloudTasksClient } from '@google-cloud/tasks';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { hashRenderSource } from './renderContract';
import { parseRenderServiceTarget } from './renderServiceTarget';
import {
  claimRenderRequest,
  commitFailedRenderIfCurrent,
} from './renderState';

const RENDER_TASK_QUEUE = process.env.RENDER_TASK_QUEUE || 'render-workout-video';
const RENDER_TASK_LOCATION = process.env.RENDER_TASK_LOCATION || 'us-central1';

let tasksClient: CloudTasksClient | null = null;
function getTasksClient(): CloudTasksClient {
  if (!tasksClient) tasksClient = new CloudTasksClient();
  return tasksClient;
}

export const renderWorkoutVideo = onDocumentUpdated(
  { document: 'workouts/{workoutId}', region: 'us-central1' },
  async (event) => {
    const workoutId = event.params.workoutId;
    const before = event.data?.before.data() as Record<string, unknown> | undefined;
    const after = event.data?.after.data() as Record<string, unknown> | undefined;
    if (!after) return;

    const beforeRenderedVideo = before?.renderedVideo as Record<string, unknown> | undefined;
    const afterRenderedVideo = after.renderedVideo as Record<string, unknown> | undefined;
    const explicitlyPending = afterRenderedVideo?.status === 'pending' &&
      beforeRenderedVideo?.status !== 'pending';
    const sourceHash = hashRenderSource(after);
    const sourceChanged = !before || hashRenderSource(before) !== sourceHash;
    if (!explicitlyPending && !sourceChanged) return;

    const db = admin.firestore();
    const workoutRef = db.collection('workouts').doc(workoutId);
    const identity = await claimRenderRequest(db, workoutRef, sourceHash);
    if (!identity) {
      console.log(`[renderWorkoutVideo] Superseded or duplicate event skipped for ${workoutId}`);
      return;
    }

    try {
      const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
      if (!project) throw new Error('GCLOUD_PROJECT is required');

      const invokerServiceAccount = process.env.RENDER_TASK_INVOKER_SA;
      if (!invokerServiceAccount) throw new Error('RENDER_TASK_INVOKER_SA is required');

      const service = parseRenderServiceTarget(process.env.RENDER_SERVICE_URL);
      const client = getTasksClient();
      const queuePath = client.queuePath(project, RENDER_TASK_LOCATION, RENDER_TASK_QUEUE);
      const payload = { workoutId, ...identity };

      await client.createTask({
        parent: queuePath,
        task: {
          httpRequest: {
            httpMethod: 'POST',
            url: service.targetUrl,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify(payload)).toString('base64'),
            oidcToken: {
              serviceAccountEmail: invokerServiceAccount,
              audience: service.audience,
            },
          },
        },
      });

      console.log(
        `[renderWorkoutVideo] Enqueued ${workoutId} v${identity.version} ` +
        `source=${identity.sourceHash.slice(0, 12)}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[renderWorkoutVideo] Failed to enqueue ${workoutId}:`, message);
      await commitFailedRenderIfCurrent(db, workoutRef, identity, message);
    }
  },
);
