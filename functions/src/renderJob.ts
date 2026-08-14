// ─── Workout Video Render Job ─────────────────────────────────────────────────
// Cloud Run job entry point. Receives a POST from Cloud Tasks with:
//   { workoutId: string, version: number }
//
// Runs the same rendering pipeline as scripts/renderWorkout.js using FFmpeg,
// uploads the result to Cloud Storage, and writes the final status back to
// the workout's renderedVideo field in Firestore.
//
// This file is compiled to dist/renderJob.js and is the CMD of the
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
import { FieldValue } from 'firebase-admin/firestore';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegBin: string = require('ffmpeg-static');

const execFileAsync = promisify(execFile);

// ── Config ────────────────────────────────────────────────────────────────────

const BUCKET_NAME = process.env.STORAGE_BUCKET || 'goarrive.firebasestorage.app';
const PORT = parseInt(process.env.PORT || '8080', 10);

const CANVAS_W = 720;
const CANVAS_H = 1440;
const TIMER_H = 160;
const MOVEMENT_H = 1280;

const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm|avi|mkv)(\?.*)?$/i;

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

function fmtTime(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtAssTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.00`;
}

function generateAss(
  durationSec: number,
  totalWorkoutStr: string,
  type: string,
  label: string
): string {
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
    let text: string;
    if (type === 'rest') {
      const remaining = Math.max(0, durationSec - sec);
      const lbl = (label || 'REST').replace(/,/g, '').slice(0, 15).toUpperCase();
      text = `${lbl}  ${fmtTime(remaining)}`;
    } else {
      text = `${fmtTime(sec)} / ${totalWorkoutStr}`;
    }
    lines.push(`Dialogue: 0,${start},${end},Timer,,0,0,0,,${text}`);
  }
  return lines.join('\n');
}

// ── Block flattening ──────────────────────────────────────────────────────────

interface Segment {
  type: 'video' | 'image' | 'rest';
  label: string;
  url?: string;
  durationSec: number;
  _localPath?: string;
  _isGif?: boolean;
  blockId?: string;
}

const SPECIAL_BLOCK_TYPES = new Set([
  'Intro', 'Outro', 'Demo', 'Transition', 'Water Break', 'Grab Equipment', 'Follow-Along Video',
]);

function flattenWorkout(workout: Record<string, unknown>): Segment[] {
  const blocks = (workout.blocks as Record<string, unknown>[]) || [];
  const segments: Segment[] = [];
  const workoutRestDur = (workout.restDurationSeconds as number) || 30;

  if (workout.introVideoUrl) {
    segments.push({ type: 'video', label: 'Intro', url: workout.introVideoUrl as string, durationSec: 10 });
  }

  for (const block of blocks) {
    const bType = (block.type as string) || 'Circuit';
    const movements = (block.movements as Record<string, unknown>[]) || [];

    if (bType === 'Follow-Along Video') {
      segments.push({
        type: 'video', label: (block.label || block.name || 'Follow-Along') as string,
        url: block.videoUrl as string || '',
        durationSec: (block.videoDurationSec || block.durationSec || 60) as number,
        blockId: block.id as string,
      });
      continue;
    }
    if (bType === 'Water Break' || bType === 'Rest') {
      segments.push({
        type: 'rest', label: (block.label || block.name || 'Rest') as string,
        durationSec: (block.durationSec || workoutRestDur) as number,
        blockId: block.id as string,
      });
      continue;
    }
    if (SPECIAL_BLOCK_TYPES.has(bType)) {
      if (block.videoUrl) {
        segments.push({ type: 'video', label: bType, url: block.videoUrl as string, durationSec: (block.durationSec || 10) as number, blockId: block.id as string });
      } else {
        segments.push({ type: 'rest', label: bType, durationSec: (block.durationSec || 15) as number, blockId: block.id as string });
      }
      continue;
    }

    for (const mv of movements) {
      const videoUrl = (mv.videoUrl || mv.mediaUrl || '') as string;
      const workDur = ((mv.duration || mv.durationSec || mv.workSec || 30) as number);
      const restAfter = ((mv.restAfter || mv.restSec || 0) as number);
      const mvLabel = (mv.name || 'Movement') as string;

      if (videoUrl && VIDEO_EXTENSIONS.test(videoUrl)) {
        segments.push({ type: 'video', label: mvLabel, url: videoUrl, durationSec: workDur, blockId: (block.id || bType) as string });
      } else if (mv.thumbnailUrl || mv.posterUrl) {
        segments.push({ type: 'image', label: mvLabel, url: (mv.thumbnailUrl || mv.posterUrl) as string, durationSec: workDur, blockId: (block.id || bType) as string });
      } else {
        segments.push({ type: 'rest', label: mvLabel, durationSec: workDur, blockId: (block.id || bType) as string });
      }
      if (restAfter > 0) {
        segments.push({ type: 'rest', label: 'Rest', durationSec: restAfter, blockId: (block.id || bType) as string });
      }
    }

    if ((block.restDurationSeconds as number) > 0) {
      segments.push({ type: 'rest', label: 'Rest', durationSec: block.restDurationSeconds as number, blockId: block.id as string });
    }
  }

  if (workout.outroVideoUrl) {
    segments.push({ type: 'video', label: 'Outro', url: workout.outroVideoUrl as string, durationSec: 10 });
  }

  return segments;
}

// ── FFmpeg ────────────────────────────────────────────────────────────────────

function buildSegmentArgs(seg: Segment, assPath: string, outputPath: string): string[] {
  const dur = seg.durationSec;
  const assEsc = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  if (seg.type === 'video') {
    const filter = [
      `[0:v]format=yuv420p,scale=${CANVAS_W}:${MOVEMENT_H}:force_original_aspect_ratio=decrease,pad=${CANVAS_W}:${MOVEMENT_H}:(ow-iw)/2:(oh-ih)/2:black,setpts=PTS-STARTPTS[mv]`,
      `color=c=#1a1a1a:s=${CANVAS_W}x${TIMER_H}:r=30,format=yuv420p[band]`,
      `[band][mv]vstack=inputs=2[canvas]`,
      `[canvas]subtitles=${assEsc}[out]`,
    ].join(';');
    return ['-y', '-i', seg._localPath!, '-filter_complex', filter, '-map', '[out]', '-t', String(dur), '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an', outputPath];
  }

  if (seg.type === 'image') {
    const filter = [
      `[0:v]format=yuv420p,scale=${CANVAS_W}:${MOVEMENT_H}:force_original_aspect_ratio=decrease,pad=${CANVAS_W}:${MOVEMENT_H}:(ow-iw)/2:(oh-ih)/2:black[mv]`,
      `color=c=#1a1a1a:s=${CANVAS_W}x${TIMER_H}:r=30,format=yuv420p[band]`,
      `[band][mv]vstack=inputs=2[canvas]`,
      `[canvas]subtitles=${assEsc}[out]`,
    ].join(';');
    const inputArgs = seg._isGif
      ? ['-stream_loop', '-1', '-t', String(dur), '-i', seg._localPath!]
      : ['-loop', '1', '-framerate', '30', '-t', String(dur), '-i', seg._localPath!];
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

// ── Render pipeline ───────────────────────────────────────────────────────────

interface RenderResult {
  url: string;
  durationMs: number;
  version: number;
  blocks: Array<{ blockId: string; startMs: number; endMs: number }>;
}

async function renderWorkout(workoutId: string, version: number): Promise<RenderResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `goarrive-render-${workoutId.slice(0, 8)}-`));

  try {
    const doc = await db.collection('workouts').doc(workoutId).get();
    if (!doc.exists) throw new Error(`Workout ${workoutId} not found`);
    const workout = doc.data() as Record<string, unknown>;

    const segments = flattenWorkout(workout);
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
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (seg.durationSec <= 0) continue;
      const assPath = path.join(tmpDir, `timer-${i}.ass`);
      fs.writeFileSync(assPath, generateAss(seg.durationSec, totalStr, seg.type, seg.label));
      const outPath = path.join(tmpDir, `out-${i}.mp4`);
      try {
        await execFileAsync(ffmpegBin, buildSegmentArgs(seg, assPath, outPath), { timeout: 300_000 });
        blockOutputs.push(outPath);
      } catch (err) {
        // Degrade to rest
        const restSeg: Segment = { type: 'rest', label: seg.label, durationSec: seg.durationSec };
        fs.writeFileSync(assPath, generateAss(seg.durationSec, totalStr, 'rest', seg.label));
        try {
          await execFileAsync(ffmpegBin, buildSegmentArgs(restSeg, assPath, outPath), { timeout: 120_000 });
          blockOutputs.push(outPath);
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

    // Upload
    const storagePath = `rendered-videos/${workoutId}/v${version}.mp4`;
    await bucket.upload(finalOut, { destination: storagePath, metadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=86400' } });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const [signedUrl] = await bucket.file(storagePath).getSignedUrl({ action: 'read', expires: expiresAt });

    // Build block offset map
    const blockOffsets: Array<{ blockId: string; startMs: number; endMs: number }> = [];
    let offsetMs = 0;
    for (const seg of segments) {
      const durMs = Math.round(seg.durationSec * 1000);
      blockOffsets.push({ blockId: seg.blockId || seg.label, startMs: offsetMs, endMs: offsetMs + durMs });
      offsetMs += durMs;
    }

    return { url: signedUrl, durationMs: Math.round(totalDurSec * 1000), version, blocks: blockOffsets };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

// ── HTTP server for Cloud Run ─────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405);
    res.end('Method not allowed');
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    let workoutId: string;
    let version: number;
    try {
      const payload = JSON.parse(body);
      workoutId = payload.workoutId;
      version = payload.version || 1;
      if (!workoutId) throw new Error('workoutId required');
    } catch (err) {
      res.writeHead(400);
      res.end(`Bad request: ${(err as Error).message}`);
      return;
    }

    console.log(`[renderJob] Starting render for workout=${workoutId} version=${version}`);

    try {
      const result = await renderWorkout(workoutId, version);

      await db.collection('workouts').doc(workoutId).update({
        renderedVideo: {
          status: 'ready',
          url: result.url,
          durationMs: result.durationMs,
          version: result.version,
          blocks: result.blocks,
          updatedAt: FieldValue.serverTimestamp(),
        },
      });

      console.log(`[renderJob] Done — ${workoutId} v${version} at ${result.url}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, workoutId, version }));
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      console.error(`[renderJob] Failed for ${workoutId}:`, msg);

      await db.collection('workouts').doc(workoutId).update({
        'renderedVideo.status': 'failed',
        'renderedVideo.error': msg,
        'renderedVideo.updatedAt': FieldValue.serverTimestamp(),
      }).catch(() => {});

      res.writeHead(500);
      res.end(`Render failed: ${msg}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[renderJob] Server listening on port ${PORT}`);
});
