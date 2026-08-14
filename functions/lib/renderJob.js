"use strict";
// ─── Workout Video Render Service ─────────────────────────────────────────────
// Cloud Run service entry point. Receives a POST from Cloud Tasks with:
//   { workoutId: string, version: number, sourceHash: string }
//
// Auth: the private Cloud Run service validates Cloud Tasks' Google-signed
// OIDC token and run.invoker IAM before this container receives the request.
// See docs/render-workout-video-service.md.
//
// Runs the rendering pipeline using FFmpeg, uploads the result to Cloud
// Storage, and writes the final status back to the workout's renderedVideo
// field in Firestore using a transaction to guard against stale writes.
//
// This file is compiled to lib/renderJob.js and is the CMD of the
// docker/renderWorkoutVideo.Dockerfile container.
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
exports.server = void 0;
const http = __importStar(require("http"));
const https = __importStar(require("https"));
const admin = __importStar(require("firebase-admin"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const renderContract_1 = require("./renderContract");
const renderState_1 = require("./renderState");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegBin = require('ffmpeg-static');
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
// ── Config ────────────────────────────────────────────────────────────────────
const BUCKET_NAME = process.env.STORAGE_BUCKET || 'goarrive.firebasestorage.app';
const PORT = parseInt(process.env.PORT || '8080', 10);
const CANVAS_W = 720;
const CANVAS_H = 1440;
const TIMER_H = 160;
const MOVEMENT_H = 1280;
// ── Firebase init ─────────────────────────────────────────────────────────────
if (!admin.apps.length) {
    admin.initializeApp();
}
const db = admin.firestore();
const bucket = admin.storage().bucket(BUCKET_NAME);
async function downloadUrl(url, destPath) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(destPath);
        proto.get(url, (res) => {
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                file.close();
                try {
                    fs.unlinkSync(destPath);
                }
                catch (_a) { }
                return downloadUrl(res.headers.location, destPath).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                file.close();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            const ct = res.headers['content-type'] || '';
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                let finalPath = destPath;
                if (ct.includes('gif') && !destPath.endsWith('.gif')) {
                    finalPath = destPath.replace(/\.\w+$/, '.gif');
                    fs.renameSync(destPath, finalPath);
                }
                resolve({ path: finalPath, contentType: ct });
            });
            file.on('error', reject);
        }).on('error', reject);
    });
}
function fmtTime(totalSec) {
    const sec = Math.max(0, Math.floor(totalSec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function fmtAssTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.00`;
}
function generateAss(durationSec, totalWorkoutStr, type, label) {
    const lines = [
        '[Script Info]',
        'ScriptType: v4.00+',
        `PlayResX: ${CANVAS_W}`,
        `PlayResY: ${CANVAS_H}`,
        'Collisions: Normal',
        '',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        'Style: Timer,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,2,0,8,10,10,56,1',
        '',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ];
    for (let sec = 0; sec < Math.ceil(durationSec); sec++) {
        const start = fmtAssTime(sec);
        const end = fmtAssTime(Math.min(sec + 1, durationSec));
        let text;
        if (type === 'rest') {
            const remaining = Math.max(0, durationSec - sec);
            const lbl = (label || 'REST').replace(/,/g, '').slice(0, 15).toUpperCase();
            text = `${lbl}  ${fmtTime(remaining)}`;
        }
        else {
            text = `${fmtTime(sec)} / ${totalWorkoutStr}`;
        }
        lines.push(`Dialogue: 0,${start},${end},Timer,,0,0,0,,${text}`);
    }
    return lines.join('\n');
}
// ── Block flattening ──────────────────────────────────────────────────────────
// ── FFmpeg ────────────────────────────────────────────────────────────────────
function buildSegmentArgs(seg, assPath, outputPath) {
    const dur = seg.durationSec;
    const assEsc = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');
    if (seg.type === 'video') {
        const filter = [
            `[0:v]format=yuv420p,scale=${CANVAS_W}:${MOVEMENT_H}:force_original_aspect_ratio=decrease,pad=${CANVAS_W}:${MOVEMENT_H}:(ow-iw)/2:(oh-ih)/2:black,setpts=PTS-STARTPTS[mv]`,
            `color=c=#1a1a1a:s=${CANVAS_W}x${TIMER_H}:r=30,format=yuv420p[band]`,
            `[band][mv]vstack=inputs=2[canvas]`,
            `[canvas]subtitles=${assEsc}[out]`,
        ].join(';');
        return ['-y', '-i', seg._localPath, '-filter_complex', filter, '-map', '[out]', '-t', String(dur), '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', outputPath];
    }
    if (seg.type === 'image') {
        const filter = [
            `[0:v]format=yuv420p,scale=${CANVAS_W}:${MOVEMENT_H}:force_original_aspect_ratio=decrease,pad=${CANVAS_W}:${MOVEMENT_H}:(ow-iw)/2:(oh-ih)/2:black[mv]`,
            `color=c=#1a1a1a:s=${CANVAS_W}x${TIMER_H}:r=30,format=yuv420p[band]`,
            `[band][mv]vstack=inputs=2[canvas]`,
            `[canvas]subtitles=${assEsc}[out]`,
        ].join(';');
        const inputArgs = seg._isGif
            ? ['-stream_loop', '-1', '-t', String(dur), '-i', seg._localPath]
            : ['-loop', '1', '-framerate', '30', '-t', String(dur), '-i', seg._localPath];
        return ['-y', ...inputArgs, '-filter_complex', filter, '-map', '[out]', '-t', String(dur), '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', '-r', '30', outputPath];
    }
    // Rest
    const filter = [
        `color=c=#2a2a2a:s=${CANVAS_W}x${MOVEMENT_H}:r=30,format=yuv420p[mv]`,
        `color=c=#1a1a1a:s=${CANVAS_W}x${TIMER_H}:r=30,format=yuv420p[band]`,
        `[band][mv]vstack=inputs=2[canvas]`,
        `[canvas]subtitles=${assEsc}[out]`,
    ].join(';');
    return ['-y', '-filter_complex', filter, '-map', '[out]', '-t', String(dur), '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', outputPath];
}
// ── Offset map builder ────────────────────────────────────────────────────────
// ── Render pipeline ───────────────────────────────────────────────────────────
class StaleRenderError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StaleRenderError';
    }
}
async function renderWorkout(workoutId, identity) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `goarrive-render-${workoutId.slice(0, 8)}-`));
    const workoutRef = db.collection('workouts').doc(workoutId);
    try {
        const doc = await workoutRef.get();
        if (!doc.exists)
            throw new Error(`Workout ${workoutId} not found`);
        const workout = doc.data();
        if (!(0, renderContract_1.isCurrentRenderRequest)(workout, identity)) {
            throw new StaleRenderError(`Render request is no longer current for ${workoutId}`);
        }
        const segments = (0, renderContract_1.flattenWorkout)(workout, workoutId);
        const totalDurSec = segments.reduce((sum, s) => sum + s.durationSec, 0);
        const totalStr = fmtTime(totalDurSec);
        // Download media
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.type === 'rest' || !seg.url)
                continue;
            const ext = seg.type === 'image' ? 'jpg' : 'mp4';
            const localPath = path.join(tmpDir, `block-${i}.${ext}`);
            try {
                const result = await downloadUrl(seg.url, localPath);
                seg._localPath = result.path;
                seg._isGif = result.contentType.includes('gif');
            }
            catch (err) {
                console.warn(`[renderJob] Download failed for segment ${i}: ${err.message} — degrading to rest`);
                seg.type = 'rest';
            }
        }
        // Render segments
        const blockOutputs = [];
        const emittedSegments = [];
        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (seg.durationSec <= 0)
                continue;
            const assPath = path.join(tmpDir, `timer-${i}.ass`);
            fs.writeFileSync(assPath, generateAss(seg.durationSec, totalStr, seg.type, seg.label));
            const outPath = path.join(tmpDir, `out-${i}.mp4`);
            try {
                await execFileAsync(ffmpegBin, buildSegmentArgs(seg, assPath, outPath), { timeout: 300000 });
                blockOutputs.push(outPath);
                emittedSegments.push(seg);
            }
            catch (err) {
                // Degrade to rest
                const restSeg = Object.assign(Object.assign({}, seg), { type: 'rest', _localPath: undefined, _isGif: undefined });
                fs.writeFileSync(assPath, generateAss(seg.durationSec, totalStr, 'rest', seg.label));
                try {
                    await execFileAsync(ffmpegBin, buildSegmentArgs(restSeg, assPath, outPath), { timeout: 120000 });
                    blockOutputs.push(outPath);
                    emittedSegments.push(restSeg);
                }
                catch (err2) {
                    console.error(`[renderJob] Segment ${i} failed even as rest:`, err2.message.slice(0, 200));
                }
            }
        }
        if (blockOutputs.length === 0)
            throw new Error('No segments rendered');
        // Concat
        const concatPath = path.join(tmpDir, 'concat.txt');
        fs.writeFileSync(concatPath, blockOutputs.map((p) => `file '${p}'`).join('\n'));
        const concatOut = path.join(tmpDir, 'concat-raw.mp4');
        await execFileAsync(ffmpegBin, ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', concatOut], { timeout: 600000 });
        // Faststart
        const finalOut = path.join(tmpDir, 'final.mp4');
        await execFileAsync(ffmpegBin, ['-y', '-i', concatOut, '-c', 'copy', '-movflags', '+faststart', finalOut], { timeout: 300000 });
        // Avoid uploading an artifact for a request superseded during FFmpeg work.
        const beforeUpload = await workoutRef.get();
        const latestWorkout = beforeUpload.data();
        if (!beforeUpload.exists || !latestWorkout || !(0, renderContract_1.isCurrentRenderRequest)(latestWorkout, identity)) {
            throw new StaleRenderError(`Render request was superseded before upload for ${workoutId}`);
        }
        const location = (0, renderContract_1.buildRenderStorageLocation)(BUCKET_NAME, workoutId, identity);
        await bucket.upload(finalOut, {
            destination: location.storageObject,
            metadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=31536000, immutable' },
        });
        // Only emitted segments participate in offsets and duration. A segment
        // omitted after both FFmpeg attempts must not leave a phantom timeline gap.
        return (0, renderContract_1.buildReadyRenderedVideoMeta)(BUCKET_NAME, workoutId, identity, emittedSegments);
    }
    finally {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch (_a) { }
    }
}
// ── HTTP server for Cloud Run service ─────────────────────────────────────────
exports.server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
        res.writeHead(405);
        res.end('Method not allowed');
        return;
    }
    let body = '';
    let bodyRejected = false;
    req.on('data', (chunk) => {
        if (bodyRejected)
            return;
        body += chunk;
        if (body.length > 65536) {
            bodyRejected = true;
            res.writeHead(413);
            res.end('Request body too large');
        }
    });
    req.on('end', async () => {
        if (bodyRejected)
            return;
        let workoutId;
        let identity;
        try {
            const payload = JSON.parse(body);
            workoutId = payload.workoutId;
            identity = { version: payload.version, sourceHash: payload.sourceHash };
            if (typeof workoutId !== 'string' || !workoutId)
                throw new Error('workoutId required');
            if (!(0, renderContract_1.isValidRenderRequestIdentity)(identity)) {
                throw new Error('positive integer version and 64-character sourceHash required');
            }
        }
        catch (err) {
            res.writeHead(400);
            res.end(`Bad request: ${err.message}`);
            return;
        }
        const workoutRef = db.collection('workouts').doc(workoutId);
        console.log(`[renderJob] Starting render workout=${workoutId} ` +
            `version=${identity.version} source=${identity.sourceHash.slice(0, 12)}`);
        try {
            const result = await renderWorkout(workoutId, identity);
            const committed = await (0, renderState_1.commitReadyRenderIfCurrent)(db, workoutRef, identity, result);
            if (!committed)
                throw new StaleRenderError(`Completion superseded for ${workoutId}`);
            console.log(`[renderJob] Done — ${workoutId} v${result.version} at ${result.storagePath}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, workoutId, version: identity.version, skipped: false }));
        }
        catch (err) {
            if (err instanceof StaleRenderError) {
                console.log(`[STALE-RENDER] ${err.message}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, workoutId, version: identity.version, skipped: true }));
                return;
            }
            const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
            console.error(`[renderJob] Failed for ${workoutId}:`, msg);
            const failureCommitted = await (0, renderState_1.commitFailedRenderIfCurrent)(db, workoutRef, identity, msg).catch(() => false);
            if (!failureCommitted) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, workoutId, version: identity.version, skipped: true }));
                return;
            }
            res.writeHead(500);
            res.end(`Render failed: ${msg}`);
        }
    });
});
if (require.main === module) {
    exports.server.listen(PORT, () => {
        console.log(`[renderJob] Server listening on port ${PORT}`);
    });
}
//# sourceMappingURL=renderJob.js.map