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

import * as http from 'http';
import * as https from 'https';
import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  buildReadyRenderedVideoMeta,
  buildRenderStorageLocation,
  flattenWorkout,
  isCurrentRenderRequest,
  isValidRenderRequestIdentity,
  PersistedRenderedVideoMeta,
  RenderRequestIdentity,
  Segment,
} from './renderContract';
import {
  commitFailedRenderIfCurrent,
  commitReadyRenderIfCurrent,
} from './renderState';
import { buildSegmentArgs, fmtTime, generateAss } from './renderFfmpeg';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegBin: string = require('ffmpeg-static');

const execFileAsync = promisify(execFile);

// ── Config ────────────────────────────────────────────────────────────────────

const BUCKET_NAME = process.env.STORAGE_BUCKET || 'goarrive.firebasestorage.app';
const PORT = parseInt(process.env.PORT || '8080', 10);

// ── Firebase init ─────────────────────────────────────────────────────────────

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const bucket = admin.storage().bucket(BUCKET_NAME);

// ── Helpers ───────────────────────────────────────────────────────────────────

interface DownloadResult { path: string; contentType: string }

async function downloadUrl(url: string, destPath: string): Promise<DownloadResult> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
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

// ── Offset map builder ────────────────────────────────────────────────────────

// ── Render pipeline ───────────────────────────────────────────────────────────

class StaleRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleRenderError';
  }
}

async function renderWorkout(
  workoutId: string,
  identity: RenderRequestIdentity,
): Promise<PersistedRenderedVideoMeta> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `goarrive-render-${workoutId.slice(0, 8)}-`));
  const workoutRef = db.collection('workouts').doc(workoutId);

  try {
    const doc = await workoutRef.get();
    if (!doc.exists) throw new Error(`Workout ${workoutId} not found`);
    const workout = doc.data() as Record<string, unknown>;
    if (!isCurrentRenderRequest(workout, identity)) {
      throw new StaleRenderError(`Render request is no longer current for ${workoutId}`);
    }

    const segments = flattenWorkout(workout, workoutId);
    const totalDurSec = segments.reduce((sum, s) => sum + s.durationSec, 0);
    const totalStr = fmtTime(totalDurSec);

    // Download media
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.type === 'rest' || !seg.url) continue;
      const ext = seg.type === 'image' ? 'jpg' : 'mp4';
      const localPath = path.join(tmpDir, `block-${i}.${ext}`);
      try {
        const result = await downloadUrl(seg.url, localPath);
        seg._localPath = result.path;
        seg._isGif = result.contentType.includes('gif');
      } catch (err) {
        console.warn(`[renderJob] Download failed for segment ${i}: ${(err as Error).message} — degrading to rest`);
        seg.type = 'rest';
      }
    }

    // Render segments
    const blockOutputs: string[] = [];
    const emittedSegments: Segment[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.durationSec <= 0) continue;
      const assPath = path.join(tmpDir, `timer-${i}.ass`);
      fs.writeFileSync(assPath, generateAss(seg.durationSec, totalStr, seg.type, seg.label));
      const outPath = path.join(tmpDir, `out-${i}.mp4`);
      try {
        await execFileAsync(ffmpegBin, buildSegmentArgs(seg, assPath, outPath), { timeout: 300_000 });
        blockOutputs.push(outPath);
        emittedSegments.push(seg);
      } catch (err) {
        // Degrade to rest
        const restSeg: Segment = { ...seg, type: 'rest', _localPath: undefined, _isGif: undefined };
        fs.writeFileSync(assPath, generateAss(seg.durationSec, totalStr, 'rest', seg.label));
        try {
          await execFileAsync(ffmpegBin, buildSegmentArgs(restSeg, assPath, outPath), { timeout: 120_000 });
          blockOutputs.push(outPath);
          emittedSegments.push(restSeg);
        } catch (err2) {
          console.error(`[renderJob] Segment ${i} failed even as rest:`, (err2 as Error).message.slice(0, 200));
        }
      }
    }

    if (blockOutputs.length === 0) throw new Error('No segments rendered');

    // Concat
    const concatPath = path.join(tmpDir, 'concat.txt');
    fs.writeFileSync(concatPath, blockOutputs.map((p) => `file '${p}'`).join('\n'));
    const concatOut = path.join(tmpDir, 'concat-raw.mp4');
    await execFileAsync(ffmpegBin, ['-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-c', 'copy', concatOut], { timeout: 600_000 });

    // Faststart
    const finalOut = path.join(tmpDir, 'final.mp4');
    await execFileAsync(ffmpegBin, ['-y', '-i', concatOut, '-c', 'copy', '-movflags', '+faststart', finalOut], { timeout: 300_000 });

    // Avoid uploading an artifact for a request superseded during FFmpeg work.
    const beforeUpload = await workoutRef.get();
    const latestWorkout = beforeUpload.data() as Record<string, unknown> | undefined;
    if (!beforeUpload.exists || !latestWorkout || !isCurrentRenderRequest(latestWorkout, identity)) {
      throw new StaleRenderError(`Render request was superseded before upload for ${workoutId}`);
    }

    const location = buildRenderStorageLocation(BUCKET_NAME, workoutId, identity);
    await bucket.upload(finalOut, {
      destination: location.storageObject,
      metadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=31536000, immutable' },
    });

    // Only emitted segments participate in offsets and duration. A segment
    // omitted after both FFmpeg attempts must not leave a phantom timeline gap.
    return buildReadyRenderedVideoMeta(BUCKET_NAME, workoutId, identity, emittedSegments);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ── HTTP server for Cloud Run service ─────────────────────────────────────────

export const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  let body = '';
  let bodyRejected = false;
  req.on('data', (chunk) => {
    if (bodyRejected) return;
    body += chunk;
    if (body.length > 65_536) {
      bodyRejected = true;
      res.writeHead(413);
      res.end('Request body too large');
    }
  });
  req.on('end', async () => {
    if (bodyRejected) return;
    let workoutId: string;
    let identity: RenderRequestIdentity;
    try {
      const payload = JSON.parse(body);
      workoutId = payload.workoutId;
      identity = { version: payload.version, sourceHash: payload.sourceHash };
      if (typeof workoutId !== 'string' || !workoutId) throw new Error('workoutId required');
      if (!isValidRenderRequestIdentity(identity)) {
        throw new Error('positive integer version and 64-character sourceHash required');
      }
    } catch (err) {
      res.writeHead(400);
      res.end(`Bad request: ${(err as Error).message}`);
      return;
    }

    const workoutRef = db.collection('workouts').doc(workoutId);
    console.log(
      `[renderJob] Starting render workout=${workoutId} ` +
      `version=${identity.version} source=${identity.sourceHash.slice(0, 12)}`,
    );

    try {
      const result = await renderWorkout(workoutId, identity);
      const committed = await commitReadyRenderIfCurrent(db, workoutRef, identity, result);
      if (!committed) throw new StaleRenderError(`Completion superseded for ${workoutId}`);

      console.log(`[renderJob] Done — ${workoutId} v${result.version} at ${result.storagePath}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, workoutId, version: identity.version, skipped: false }));
    } catch (err) {
      if (err instanceof StaleRenderError) {
        console.log(`[STALE-RENDER] ${err.message}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, workoutId, version: identity.version, skipped: true }));
        return;
      }

      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      console.error(`[renderJob] Failed for ${workoutId}:`, msg);

      const failureCommitted = await commitFailedRenderIfCurrent(
        db,
        workoutRef,
        identity,
        msg,
      ).catch(() => false);

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
  server.listen(PORT, () => {
    console.log(`[renderJob] Server listening on port ${PORT}`);
  });
}
