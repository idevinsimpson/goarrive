"use strict";
// ─── Workout Video Render Trigger ────────────────────────────────────────────
// Gen 2 Firestore trigger that fires when a workout's renderedVideo.status is
// set to 'pending' OR when the blocks array changes. Enqueues a Cloud Tasks
// task pointing to the Cloud Run render job (RENDER_JOB_URL).
//
// ME-RV-01: RENDER_TASK_QUEUE must be provisioned in Cloud Tasks before use.
//           Default queue name: render-workout-video
// ME-RV-02: RENDER_JOB_URL must be set to the Cloud Run job URL after the
//           Cloud Run service is deployed. Placeholder is defined below.
// ME-RV-03: RENDER_TASK_INVOKER_SA should be set to the SA with run.invoker
//           on the Cloud Run job. Defaults to the App Engine default SA.
// ─────────────────────────────────────────────────────────────────────────────
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderWorkoutVideo = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const tasks_1 = require("@google-cloud/tasks");
// Placeholder — fill in after Cloud Run job is deployed.
const RENDER_JOB_URL = process.env.RENDER_JOB_URL || 'https://PLACEHOLDER.run.app/render';
const RENDER_TASK_QUEUE = process.env.RENDER_TASK_QUEUE || 'render-workout-video';
const RENDER_TASK_LOCATION = process.env.RENDER_TASK_LOCATION || 'us-central1';
let _tasksClient = null;
function getTasksClient() {
    if (!_tasksClient)
        _tasksClient = new tasks_1.CloudTasksClient();
    return _tasksClient;
}
/** Hash blocks array to detect changes between before/after. */
function hashBlocks(blocks) {
    return JSON.stringify(blocks || []).length.toString(36) +
        '-' + (JSON.stringify(blocks || []).slice(0, 200));
}
exports.renderWorkoutVideo = (0, firestore_1.onDocumentUpdated)({ document: 'workouts/{workoutId}', region: 'us-central1' }, async (event) => {
    var _a, _b, _c, _d, _e;
    const workoutId = event.params.workoutId;
    const before = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const after = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
    if (!after)
        return;
    const pendingTriggered = ((_c = after.renderedVideo) === null || _c === void 0 ? void 0 : _c.status) === 'pending';
    const blocksChanged = hashBlocks(before === null || before === void 0 ? void 0 : before.blocks) !== hashBlocks(after === null || after === void 0 ? void 0 : after.blocks);
    if (!pendingTriggered && !blocksChanged)
        return;
    const currentVersion = ((_e = (_d = after.renderedVideo) === null || _d === void 0 ? void 0 : _d.version) !== null && _e !== void 0 ? _e : 0);
    const nextVersion = currentVersion + 1;
    console.log(`[renderWorkoutVideo] Triggering render for ${workoutId} v${nextVersion} — pending=${pendingTriggered} blocksChanged=${blocksChanged}`);
    const db = admin.firestore();
    // Mark as rendering
    await db.collection('workouts').doc(workoutId).update({
        'renderedVideo.status': 'rendering',
        'renderedVideo.version': nextVersion,
        'renderedVideo.updatedAt': firestore_2.FieldValue.serverTimestamp(),
    });
    // Enqueue Cloud Tasks task
    const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
    if (!project) {
        console.error('[renderWorkoutVideo] GCLOUD_PROJECT not set — cannot enqueue task');
        await db.collection('workouts').doc(workoutId).update({
            'renderedVideo.status': 'failed',
            'renderedVideo.error': 'GCLOUD_PROJECT env not set',
            'renderedVideo.updatedAt': firestore_2.FieldValue.serverTimestamp(),
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
        console.log(`[renderWorkoutVideo] Enqueued render task for ${workoutId} v${nextVersion}`);
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[renderWorkoutVideo] Failed to enqueue task for ${workoutId}:`, msg);
        await db.collection('workouts').doc(workoutId).update({
            'renderedVideo.status': 'failed',
            'renderedVideo.error': msg,
            'renderedVideo.updatedAt': firestore_2.FieldValue.serverTimestamp(),
        });
    }
});
//# sourceMappingURL=renderWorkoutVideo.js.map