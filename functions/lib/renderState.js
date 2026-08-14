"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claimRenderRequest = claimRenderRequest;
exports.commitReadyRenderIfCurrent = commitReadyRenderIfCurrent;
exports.commitFailedRenderIfCurrent = commitFailedRenderIfCurrent;
const firestore_1 = require("firebase-admin/firestore");
const renderContract_1 = require("./renderContract");
function currentVersion(workout) {
    const renderedVideo = workout.renderedVideo;
    const value = renderedVideo === null || renderedVideo === void 0 ? void 0 : renderedVideo.version;
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
/** Atomically claim the latest source snapshot and assign its render version. */
async function claimRenderRequest(db, workoutRef, expectedSourceHash) {
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(workoutRef);
        if (!snapshot.exists)
            return null;
        const workout = snapshot.data();
        const liveSourceHash = (0, renderContract_1.hashRenderSource)(workout);
        if (liveSourceHash !== expectedSourceHash)
            return null;
        const renderedVideo = workout.renderedVideo;
        const explicitlyPending = (renderedVideo === null || renderedVideo === void 0 ? void 0 : renderedVideo.status) === 'pending';
        const sourceNeedsRender = (renderedVideo === null || renderedVideo === void 0 ? void 0 : renderedVideo.sourceHash) !== liveSourceHash;
        if (!explicitlyPending && !sourceNeedsRender)
            return null;
        const identity = {
            version: currentVersion(workout) + 1,
            sourceHash: liveSourceHash,
        };
        transaction.update(workoutRef, {
            'renderedVideo.status': 'rendering',
            'renderedVideo.version': identity.version,
            'renderedVideo.sourceHash': identity.sourceHash,
            'renderedVideo.error': firestore_1.FieldValue.delete(),
            'renderedVideo.updatedAt': firestore_1.FieldValue.serverTimestamp(),
        });
        return identity;
    });
}
/** Commit ready metadata only while both version and source hash still match. */
async function commitReadyRenderIfCurrent(db, workoutRef, identity, metadata) {
    if (metadata.version !== identity.version || metadata.sourceHash !== identity.sourceHash) {
        throw new Error('render metadata identity does not match request');
    }
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(workoutRef);
        const workout = snapshot.data();
        if (!snapshot.exists || !workout || !(0, renderContract_1.isCurrentRenderRequest)(workout, identity))
            return false;
        transaction.update(workoutRef, {
            renderedVideo: Object.assign(Object.assign({}, metadata), { renderedAt: firestore_1.FieldValue.serverTimestamp(), updatedAt: firestore_1.FieldValue.serverTimestamp() }),
        });
        return true;
    });
}
/** Mark failure only if this exact request is still current. */
async function commitFailedRenderIfCurrent(db, workoutRef, identity, error) {
    return db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(workoutRef);
        const workout = snapshot.data();
        if (!snapshot.exists || !workout || !(0, renderContract_1.isCurrentRenderRequest)(workout, identity))
            return false;
        transaction.update(workoutRef, {
            'renderedVideo.status': 'failed',
            'renderedVideo.error': error.slice(0, 500),
            'renderedVideo.updatedAt': firestore_1.FieldValue.serverTimestamp(),
        });
        return true;
    });
}
//# sourceMappingURL=renderState.js.map