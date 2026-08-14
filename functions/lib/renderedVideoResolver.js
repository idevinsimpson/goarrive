"use strict";
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
exports.resolveRenderedWorkoutVideo = exports.RENDERED_VIDEO_SIGNED_URL_TTL_MS = void 0;
exports.parseResolveRenderedVideoInput = parseResolveRenderedVideoInput;
exports.validatedReadyMetadata = validatedReadyMetadata;
exports.resolveRenderedVideoForCaller = resolveRenderedVideoForCaller;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const renderContract_1 = require("./renderContract");
exports.RENDERED_VIDEO_SIGNED_URL_TTL_MS = 15 * 60 * 1000;
function requiredDocumentId(value, field) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.includes('/')) {
        throw new https_1.HttpsError('invalid-argument', `${field} must be a valid document ID`);
    }
    return value;
}
function optionalDocumentId(value, field) {
    if (value === undefined || value === null)
        return undefined;
    return requiredDocumentId(value, field);
}
function parseResolveRenderedVideoInput(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new https_1.HttpsError('invalid-argument', 'Request data is required');
    }
    const data = value;
    const input = {
        workoutId: requiredDocumentId(data.workoutId, 'workoutId'),
        assignmentId: optionalDocumentId(data.assignmentId, 'assignmentId'),
        sessionInstanceId: optionalDocumentId(data.sessionInstanceId, 'sessionInstanceId'),
    };
    if (input.assignmentId && input.sessionInstanceId) {
        throw new https_1.HttpsError('invalid-argument', 'Provide at most one of assignmentId or sessionInstanceId');
    }
    return input;
}
function isAdmin(token) {
    return token.role === 'platformAdmin' || token.admin === true || token.platformAdmin === true;
}
function isCoach(token) {
    return token.role === 'coach';
}
function directlyCanReadWorkout(auth, workout) {
    if (isAdmin(auth.token))
        return true;
    const coachId = workout.coachId;
    if (typeof coachId === 'string' &&
        (auth.uid === coachId || (isCoach(auth.token) && auth.token.coachId === coachId))) {
        return true;
    }
    return workout.isShared === true && isCoach(auth.token);
}
function selectedPlaybookWorkoutId(playbook) {
    const workoutIds = Array.isArray(playbook.workoutIds)
        ? playbook.workoutIds.filter((value) => typeof value === 'string' && value.length > 0)
        : [];
    if (workoutIds.length === 0)
        return null;
    const rawIndex = playbook.nextWorkoutIndex;
    const index = Number.isInteger(rawIndex) ? rawIndex : 0;
    return workoutIds[((index % workoutIds.length) + workoutIds.length) % workoutIds.length];
}
async function hasAssignmentAccess(auth, input, workout, dependencies) {
    if (!input.assignmentId)
        return false;
    const assignment = await dependencies.loadAssignment(input.assignmentId);
    if (!assignment || typeof workout.coachId !== 'string' || workout.coachId.length === 0) {
        return false;
    }
    return assignment.memberId === auth.uid &&
        assignment.workoutId === input.workoutId &&
        assignment.coachId === workout.coachId;
}
async function hasSessionAccess(auth, input, workout, dependencies) {
    if (!input.sessionInstanceId)
        return false;
    const session = await dependencies.loadSessionInstance(input.sessionInstanceId);
    if (!session || session.memberId !== auth.uid ||
        typeof workout.coachId !== 'string' || workout.coachId.length === 0 ||
        session.coachId !== workout.coachId) {
        return false;
    }
    if (typeof session.pinnedWorkoutId === 'string' && session.pinnedWorkoutId.length > 0) {
        return session.pinnedWorkoutId === input.workoutId;
    }
    if (typeof session.playbookId !== 'string' || session.playbookId.length === 0)
        return false;
    const playbook = await dependencies.loadPlaybook(session.playbookId);
    if (!playbook)
        return false;
    if (playbook.coachId !== workout.coachId)
        return false;
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
function isRenderedSegmentOffset(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const block = value;
    return typeof block.blockId === 'string' && block.blockId.length > 0 &&
        typeof block.parentBlockId === 'string' && block.parentBlockId.length > 0 &&
        Number.isInteger(block.blockIndex) &&
        typeof block.phase === 'string' && RENDERED_VIDEO_PHASES.has(block.phase) &&
        Number.isInteger(block.segmentIndex) &&
        Number.isFinite(block.startMs) && Number.isFinite(block.endMs) &&
        block.startMs >= 0 && block.endMs > block.startMs &&
        (block.movementId === undefined || typeof block.movementId === 'string') &&
        (block.movementIndex === undefined || Number.isInteger(block.movementIndex));
}
function copyRenderedSegmentOffset(block) {
    return Object.assign(Object.assign(Object.assign({ blockId: block.blockId, parentBlockId: block.parentBlockId, blockIndex: block.blockIndex, phase: block.phase, segmentIndex: block.segmentIndex }, (block.movementId === undefined ? {} : { movementId: block.movementId })), (block.movementIndex === undefined ? {} : { movementIndex: block.movementIndex })), { startMs: block.startMs, endMs: block.endMs });
}
/**
 * Validate and copy the durable metadata before signing anything. The exact
 * storage location is reconstructed from trusted identity fields, so a
 * corrupted or user-controlled path can never select another object/bucket.
 */
function validatedReadyMetadata(bucketName, workoutId, workout) {
    const renderedVideo = workout.renderedVideo;
    if (!renderedVideo || typeof renderedVideo !== 'object' || Array.isArray(renderedVideo)) {
        throw new https_1.HttpsError('failed-precondition', 'Rendered video is not ready');
    }
    const raw = renderedVideo;
    if (raw.status !== 'ready') {
        throw new https_1.HttpsError('failed-precondition', 'Rendered video is not ready');
    }
    const identity = { version: raw.version, sourceHash: raw.sourceHash };
    if (!(0, renderContract_1.isValidRenderRequestIdentity)(identity) ||
        typeof raw.durationMs !== 'number' || !Number.isFinite(raw.durationMs) || raw.durationMs < 0 ||
        !Array.isArray(raw.blocks) || !raw.blocks.every(isRenderedSegmentOffset)) {
        throw new https_1.HttpsError('data-loss', 'Stored rendered video metadata is invalid');
    }
    const blocks = raw.blocks;
    const blockIds = new Set();
    let previousEnd = 0;
    for (const block of blocks) {
        if (blockIds.has(block.blockId) || block.startMs < previousEnd || block.endMs > raw.durationMs) {
            throw new https_1.HttpsError('data-loss', 'Stored rendered video timeline is invalid');
        }
        blockIds.add(block.blockId);
        previousEnd = block.endMs;
    }
    let location;
    try {
        location = (0, renderContract_1.buildRenderStorageLocation)(bucketName, workoutId, identity);
    }
    catch (_a) {
        throw new https_1.HttpsError('data-loss', 'Stored rendered video metadata is invalid');
    }
    if (raw.storagePath !== location.storagePath) {
        throw new https_1.HttpsError('data-loss', 'Stored rendered video path does not match its identity');
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
async function resolveRenderedVideoForCaller(request, dependencies) {
    var _a;
    if (!((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid)) {
        throw new https_1.HttpsError('unauthenticated', 'Sign in required');
    }
    const input = parseResolveRenderedVideoInput(request.data);
    const workout = await dependencies.loadWorkout(input.workoutId);
    if (!workout)
        throw new https_1.HttpsError('not-found', 'Workout not found');
    const authorized = directlyCanReadWorkout(request.auth, workout) ||
        await hasAssignmentAccess(request.auth, input, workout, dependencies) ||
        await hasSessionAccess(request.auth, input, workout, dependencies);
    if (!authorized) {
        throw new https_1.HttpsError('permission-denied', 'You cannot access this rendered workout');
    }
    const { metadata, storageObject } = validatedReadyMetadata(dependencies.bucketName, input.workoutId, workout);
    const expiresAt = dependencies.now() + exports.RENDERED_VIDEO_SIGNED_URL_TTL_MS;
    const url = await dependencies.signReadUrl(storageObject, expiresAt);
    if (!url.startsWith('https://')) {
        throw new https_1.HttpsError('internal', 'Rendered video signer returned an invalid URL');
    }
    return Object.assign(Object.assign({}, metadata), { url, expiresAt });
}
function defaultDependencies() {
    const db = admin.firestore();
    const bucket = admin.storage().bucket();
    const load = async (collection, id) => {
        const snapshot = await db.collection(collection).doc(id).get();
        return snapshot.exists ? snapshot.data() : null;
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
exports.resolveRenderedWorkoutVideo = (0, https_1.onCall)({ region: 'us-central1', invoker: 'public' }, async (request) => resolveRenderedVideoForCaller({
    auth: request.auth ? {
        uid: request.auth.uid,
        token: request.auth.token,
    } : undefined,
    data: request.data,
}, defaultDependencies()));
//# sourceMappingURL=renderedVideoResolver.js.map