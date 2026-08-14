"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashRenderSource = hashRenderSource;
exports.isValidRenderRequestIdentity = isValidRenderRequestIdentity;
exports.isCurrentRenderRequest = isCurrentRenderRequest;
exports.decodeSegmentId = decodeSegmentId;
exports.flattenWorkout = flattenWorkout;
exports.buildBlockOffsets = buildBlockOffsets;
exports.buildRenderStorageLocation = buildRenderStorageLocation;
exports.buildReadyRenderedVideoMeta = buildReadyRenderedVideoMeta;
const crypto_1 = require("crypto");
const SPECIAL_BLOCK_TYPES = new Set([
    'Intro',
    'Outro',
    'Demo',
    'Transition',
    'Water Break',
    'Grab Equipment',
    'Follow-Along Video',
]);
const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm|avi|mkv)(\?.*)?$/i;
const SOURCE_HASH_RE = /^[a-f0-9]{64}$/;
function canonicalize(value) {
    if (Array.isArray(value))
        return value.map(canonicalize);
    if (value && typeof value === 'object') {
        const record = value;
        return Object.keys(record)
            .sort()
            .reduce((result, key) => {
            const item = record[key];
            if (item !== undefined)
                result[key] = canonicalize(item);
            return result;
        }, {});
    }
    return value;
}
/** Hash every workout field consumed by the render pipeline. */
function hashRenderSource(workout) {
    var _a;
    const source = canonicalize({
        blocks: workout.blocks || [],
        introVideoUrl: workout.introVideoUrl || null,
        outroVideoUrl: workout.outroVideoUrl || null,
        restDurationSeconds: (_a = workout.restDurationSeconds) !== null && _a !== void 0 ? _a : null,
    });
    return (0, crypto_1.createHash)('sha256').update(JSON.stringify(source)).digest('hex');
}
function isValidRenderRequestIdentity(identity) {
    return Number.isSafeInteger(identity.version) &&
        identity.version > 0 &&
        SOURCE_HASH_RE.test(identity.sourceHash);
}
function isCurrentRenderRequest(workout, identity) {
    if (!isValidRenderRequestIdentity(identity))
        return false;
    const renderedVideo = workout.renderedVideo;
    return (renderedVideo === null || renderedVideo === void 0 ? void 0 : renderedVideo.version) === identity.version &&
        (renderedVideo === null || renderedVideo === void 0 ? void 0 : renderedVideo.sourceHash) === identity.sourceHash &&
        hashRenderSource(workout) === identity.sourceHash;
}
function encodeIdentity(identity) {
    return `segment:${Buffer.from(JSON.stringify(identity), 'utf8').toString('base64url')}`;
}
/** Reverse a renderer-emitted segment id without relying on delimiters in IDs. */
function decodeSegmentId(blockId) {
    if (!blockId.startsWith('segment:'))
        return null;
    try {
        const parsed = JSON.parse(Buffer.from(blockId.slice('segment:'.length), 'base64url').toString('utf8'));
        if (!parsed.workoutId || !parsed.parentBlockId || !parsed.phase)
            return null;
        if (!Number.isInteger(parsed.blockIndex) || !Number.isInteger(parsed.segmentIndex))
            return null;
        return parsed;
    }
    catch (_a) {
        return null;
    }
}
/** Flatten a workout into deterministic, globally unique render segments. */
function flattenWorkout(workout, workoutId) {
    if (!workoutId)
        throw new Error('workoutId is required for segment identity');
    const blocks = workout.blocks || [];
    const segments = [];
    const workoutRestDur = workout.restDurationSeconds || 30;
    const append = (segment, context) => {
        const identity = Object.assign(Object.assign({ workoutId }, context), { segmentIndex: segments.length });
        segments.push(Object.assign(Object.assign(Object.assign({}, segment), identity), { blockId: encodeIdentity(identity) }));
    };
    if (workout.introVideoUrl) {
        append({
            type: 'video',
            label: 'Intro',
            url: workout.introVideoUrl,
            durationSec: 10,
        }, { parentBlockId: '$intro', blockIndex: -1, phase: 'intro' });
    }
    blocks.forEach((block, blockIndex) => {
        const blockType = block.type || 'Circuit';
        const parentBlockId = block.id || `block-${blockIndex}`;
        const movements = block.movements || [];
        if (blockType === 'Follow-Along Video') {
            append({
                type: 'video',
                label: (block.label || block.name || 'Follow-Along'),
                url: block.videoUrl || '',
                durationSec: (block.videoDurationSec || block.durationSec || 60),
            }, { parentBlockId, blockIndex, phase: 'follow-along' });
            return;
        }
        if (blockType === 'Water Break' || blockType === 'Rest') {
            append({
                type: 'rest',
                label: (block.label || block.name || 'Rest'),
                durationSec: (block.durationSec || workoutRestDur),
            }, { parentBlockId, blockIndex, phase: 'block-rest' });
            return;
        }
        if (SPECIAL_BLOCK_TYPES.has(blockType)) {
            append(block.videoUrl
                ? {
                    type: 'video',
                    label: blockType,
                    url: block.videoUrl,
                    durationSec: (block.durationSec || 10),
                }
                : {
                    type: 'rest',
                    label: blockType,
                    durationSec: (block.durationSec || 15),
                }, { parentBlockId, blockIndex, phase: 'special' });
            return;
        }
        movements.forEach((movement, movementIndex) => {
            const movementId = movement.id || `movement-${movementIndex}`;
            const videoUrl = (movement.videoUrl || movement.mediaUrl || '');
            const workDuration = (movement.duration || movement.durationSec || movement.workSec || 30);
            const restAfter = (movement.restAfter || movement.restSec || 0);
            const label = (movement.name || 'Movement');
            const context = {
                parentBlockId,
                blockIndex,
                movementId,
                movementIndex,
                phase: 'work',
            };
            if (videoUrl && VIDEO_EXTENSIONS.test(videoUrl)) {
                append({ type: 'video', label, url: videoUrl, durationSec: workDuration }, context);
            }
            else if (movement.thumbnailUrl || movement.posterUrl) {
                append({
                    type: 'image',
                    label,
                    url: (movement.thumbnailUrl || movement.posterUrl),
                    durationSec: workDuration,
                }, context);
            }
            else {
                append({ type: 'rest', label, durationSec: workDuration }, context);
            }
            if (restAfter > 0) {
                append({ type: 'rest', label: 'Rest', durationSec: restAfter }, {
                    parentBlockId,
                    blockIndex,
                    movementId,
                    movementIndex,
                    phase: 'movement-rest',
                });
            }
        });
        if (block.restDurationSeconds > 0) {
            append({
                type: 'rest',
                label: 'Rest',
                durationSec: block.restDurationSeconds,
            }, { parentBlockId, blockIndex, phase: 'block-rest' });
        }
    });
    if (workout.outroVideoUrl) {
        append({
            type: 'video',
            label: 'Outro',
            url: workout.outroVideoUrl,
            durationSec: 10,
        }, { parentBlockId: '$outro', blockIndex: blocks.length, phase: 'outro' });
    }
    return segments;
}
function buildBlockOffsets(segments) {
    const offsets = [];
    let offsetMs = 0;
    for (const segment of segments) {
        const durationMs = Math.round(segment.durationSec * 1000);
        if (durationMs <= 0)
            continue;
        offsets.push({
            blockId: segment.blockId,
            parentBlockId: segment.parentBlockId,
            blockIndex: segment.blockIndex,
            phase: segment.phase,
            segmentIndex: segment.segmentIndex,
            movementId: segment.movementId,
            movementIndex: segment.movementIndex,
            startMs: offsetMs,
            endMs: offsetMs + durationMs,
        });
        offsetMs += durationMs;
    }
    return offsets;
}
function buildRenderStorageLocation(bucketName, workoutId, identity) {
    if (!bucketName)
        throw new Error('bucketName is required');
    if (!workoutId)
        throw new Error('workoutId is required');
    if (!isValidRenderRequestIdentity(identity))
        throw new Error('invalid render request identity');
    const workoutKey = encodeURIComponent(workoutId);
    const storageObject = `rendered-videos/${workoutKey}/v${identity.version}/${identity.sourceHash}.mp4`;
    return { storageObject, storagePath: `gs://${bucketName}/${storageObject}` };
}
function buildReadyRenderedVideoMeta(bucketName, workoutId, identity, emittedSegments) {
    const location = buildRenderStorageLocation(bucketName, workoutId, identity);
    const blocks = buildBlockOffsets(emittedSegments);
    const durationMs = blocks.length > 0 ? blocks[blocks.length - 1].endMs : 0;
    return {
        status: 'ready',
        storagePath: location.storagePath,
        durationMs,
        version: identity.version,
        sourceHash: identity.sourceHash,
        blocks,
    };
}
//# sourceMappingURL=renderContract.js.map