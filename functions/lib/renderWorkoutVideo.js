"use strict";
// Firestore trigger for the private Cloud Run render service.
//
// A source change or explicit `renderedVideo.status = "pending"` atomically
// claims one {version, sourceHash} identity before a Cloud Tasks HTTP request
// is created. Cloud Tasks uses a Google-signed OIDC token whose audience is
// the Cloud Run service origin. See docs/render-workout-video-service.md.
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
const tasks_1 = require("@google-cloud/tasks");
const firestore_1 = require("firebase-functions/v2/firestore");
const renderContract_1 = require("./renderContract");
const renderServiceTarget_1 = require("./renderServiceTarget");
const renderState_1 = require("./renderState");
const RENDER_TASK_QUEUE = process.env.RENDER_TASK_QUEUE || 'render-workout-video';
const RENDER_TASK_LOCATION = process.env.RENDER_TASK_LOCATION || 'us-central1';
let tasksClient = null;
function getTasksClient() {
    if (!tasksClient)
        tasksClient = new tasks_1.CloudTasksClient();
    return tasksClient;
}
exports.renderWorkoutVideo = (0, firestore_1.onDocumentUpdated)({ document: 'workouts/{workoutId}', region: 'us-central1' }, async (event) => {
    var _a, _b;
    const workoutId = event.params.workoutId;
    const before = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const after = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
    if (!after)
        return;
    const beforeRenderedVideo = before === null || before === void 0 ? void 0 : before.renderedVideo;
    const afterRenderedVideo = after.renderedVideo;
    const explicitlyPending = (afterRenderedVideo === null || afterRenderedVideo === void 0 ? void 0 : afterRenderedVideo.status) === 'pending' &&
        (beforeRenderedVideo === null || beforeRenderedVideo === void 0 ? void 0 : beforeRenderedVideo.status) !== 'pending';
    const sourceHash = (0, renderContract_1.hashRenderSource)(after);
    const sourceChanged = !before || (0, renderContract_1.hashRenderSource)(before) !== sourceHash;
    if (!explicitlyPending && !sourceChanged)
        return;
    const db = admin.firestore();
    const workoutRef = db.collection('workouts').doc(workoutId);
    const identity = await (0, renderState_1.claimRenderRequest)(db, workoutRef, sourceHash);
    if (!identity) {
        console.log(`[renderWorkoutVideo] Superseded or duplicate event skipped for ${workoutId}`);
        return;
    }
    try {
        const project = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT;
        if (!project)
            throw new Error('GCLOUD_PROJECT is required');
        const invokerServiceAccount = process.env.RENDER_TASK_INVOKER_SA;
        if (!invokerServiceAccount)
            throw new Error('RENDER_TASK_INVOKER_SA is required');
        const service = (0, renderServiceTarget_1.parseRenderServiceTarget)(process.env.RENDER_SERVICE_URL);
        const client = getTasksClient();
        const queuePath = client.queuePath(project, RENDER_TASK_LOCATION, RENDER_TASK_QUEUE);
        const payload = Object.assign({ workoutId }, identity);
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
        console.log(`[renderWorkoutVideo] Enqueued ${workoutId} v${identity.version} ` +
            `source=${identity.sourceHash.slice(0, 12)}`);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[renderWorkoutVideo] Failed to enqueue ${workoutId}:`, message);
        await (0, renderState_1.commitFailedRenderIfCurrent)(db, workoutRef, identity, message);
    }
});
//# sourceMappingURL=renderWorkoutVideo.js.map