// ─── Workout Video Render Trigger ────────────────────────────────────────────
// Gen 2 Firestore trigger that fires when a workout's renderedVideo.status is
// set to 'pending' OR when the blocks array changes. Enqueues a Cloud Tasks
// task pointing to the Cloud Run service (RENDER_JOB_URL).
//
// ME-RV-01: RENDER_TASK_QUEUE must be provisioned in Cloud Tasks before use.
//           Default queue name: render-workout-video
// ME-RV-02: RENDER_JOB_URL must be set to the Cloud Run service URL after the
//           Cloud Run service is deployed. Placeholder is defined below.
// ME-RV-03: RENDER_TASK_INVOKER_SA should be set to the SA with run.invoker
//           on the Cloud Run service. Defaults to the App Engine default SA.
// ─────────────────────────────────────────────────────────────────────────────

import * as admin from 'firebase-admin';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { CloudTasksClient } from '@google-cloud/tasks';

// Placeholder — fill in after Cloud Run service is deployed.
const RENDER_JOB_URL = process.env.RENDER_JOB_URL || 'https://PLACEHOLDER.run.app/render';

const RENDER_TASK_QUEUE = process.env.RENDER_TASK_QUEUE || 'render-workout-video';
const RENDER_TASK_LOCATION = process.env.RENDER_TASK_LOCATION || 'us-central1';

let _tasksClient: CloudTasksClient | null = null;
function getTasksClient(): CloudTasksClient {
  if (!_tasksClient) _tasksClient = new CloudTasksClient();
  return _tasksClient;
}

/** Hash blocks array to detect changes between before/after. */
function hashBlocks(blocks: unknown[]): string {
  return JSON.stringify(blocks || []).length.toString(36) +
    '-' + (JSON.stringify(blocks || []).slice(0, 200));
}

export const renderWorkoutVideo = onDocumentUpdated(
  { document: 'workouts/{workoutId}', region: 'us-central1' },
  async (event) => {
    const workoutId = event.params.workoutId;
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!after) return;

    const pendingTriggered = after.renderedVideo?.status === 'pending';
    const blocksChanged = hashBlocks(before?.blocks) !== hashBlocks(after?.blocks);

    if (!pendingTriggered && !blocksChanged) return;

    const currentVersion = (after.renderedVideo?.version ?? 0) as number;
    const nextVersion = currentVersion + 1;

    console.log(`[renderWorkoutVideo] Triggering render for ${workoutId} v${nextVersion} — pending=${pendingTriggered} blocksChanged=${blocksChanged}`);

    const db = admin.firestore();

    // Mark as rendering
    await db.collection('workouts').doc(workoutId).update({
      'renderedVideo.status': 'rendering',
      'renderedVideo.version': nextVersion,
      'renderedVideo.updatedAt': FieldValue.serverTimestamp(),
    });

    // Enqueue Cloud Tasks task
    const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    if (!project) {
      console.error('[renderWorkoutVideo] GCLOUD_PROJECT not set — cannot enqueue task');
      await db.collection('workouts').doc(workoutId).update({
        'renderedVideo.status': 'failed',
        'renderedVideo.error': 'GCLOUD_PROJECT env not set',
        'renderedVideo.updatedAt': FieldValue.serverTimestamp(),
      });
      return;
    }

    const payload = { workoutId, version: nextVersion };

    try {
      const client = getTasksClient();
      const queuePath = client.queuePath(project, RENDER_TASK_LOCATION, RENDER_TASK_QUEUE);
      const sa = process.env.RENDER_TASK_INVOKER_SA || `${project}@appspot.gserviceaccount.com`;

      await client.createTask({
        parent: queuePath,
        task: {
          httpRequest: {
            httpMethod: 'POST',
            url: RENDER_JOB_URL,
            headers: { 'Content-Type': 'application/json' },
            body: Buffer.from(JSON.stringify(payload)).toString('base64'),
            oidcToken: { serviceAccountEmail: sa, audience: RENDER_JOB_URL },
          },
        },
      });

      console.log(`[renderWorkoutVideo] Enqueued render task to Cloud Run service for ${workoutId} v${nextVersion}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[renderWorkoutVideo] Failed to enqueue task for ${workoutId}:`, msg);
      await db.collection('workouts').doc(workoutId).update({
        'renderedVideo.status': 'failed',
        'renderedVideo.error': msg,
        'renderedVideo.updatedAt': FieldValue.serverTimestamp(),
      });
    }
  }
);
