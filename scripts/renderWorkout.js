/**
 * renderWorkout.js — Phase 2 continuous-video render pipeline
 *
 * Picks a real workout from Firestore, renders each block to a temp MP4
 * using FFmpeg, concatenates into one continuous video, and uploads to
 * Cloud Storage. Reports a signed URL on success.
 *
 * Usage:
 *   node scripts/renderWorkout.js [--workoutId <id>]
 *
 * Run from the repo root. Service account is read from .secrets/firebase-service-account.json.
 */

'use strict';

const admin = require('../functions/node_modules/firebase-admin');
const ffmpegBin = require('../functions/node_modules/ffmpeg-static');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// ── Config ────────────────────────────────────────────────────────────────
const SA_KEY_PATH = path.resolve(__dirname, '..', '.secrets', 'firebase-service-account.json');
const BUCKET_NAME = 'goarrive.firebasestorage.app';

// Canvas dimensions
const CANVAS_W = 720;
const CANVAS_H = 1440;
const TIMER_H = 160;
const MOVEMENT_H = 1280; // CANVAS_H - TIMER_H

// Duration constraints for workout selection (seconds)
const MIN_DURATION = 600;   // 10 min
const MAX_DURATION = 1800;  // 30 min

// ── CLI args ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const forceIdIdx = args.indexOf('--workoutId');
const forcedWorkoutId = forceIdIdx !== -1 ? args[forceIdIdx + 1] : null;

// ── Firebase init ─────────────────────────────────────────────────────────
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(fs.readFileSync(SA_KEY_PATH, 'utf8'));
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: BUCKET_NAME,
  });
}
const db = admin.firestore();
const bucket = admin.storage().bucket();

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Download a URL to destPath. Returns { path, contentType } where path may
 * differ from destPath if the extension needed to change (e.g., GIF detected).
 */
async function downloadUrl(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);
    proto.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        return downloadUrl(res.headers.location, destPath).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        return reject(new Error(`HTTP ${res.statusCode} for ${url.slice(0, 80)}`));
      }
      const ct = res.headers['content-type'] || '';
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        // Rename if content-type reveals a different format than the extension
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

/** Format seconds as MM:SS string */
function fmtTime(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Generate an ASS subtitle file for the timer band overlay.
 * For video/image: shows "MM:SS / totalStr" counting up.
 * For rest: shows label + "MM:SS" counting down.
 */
function generateAss(durationSec, totalWorkoutStr, type, label) {
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${CANVAS_W}`,
    `PlayResY: ${CANVAS_H}`,
    'Collisions: Normal',
    '',
    '[V4+ Styles]',
    // Name, Font, Size, PrimaryColor, SecondaryColor, OutlineColor, BackColor, Bold, Italic,
    // Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow,
    // Alignment, MarginL, MarginR, MarginV, Encoding
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    // Alignment 8 = top-center. MarginV = distance from top edge.
    // Center of 160px timer band = y=80. For 48px font, text top at ~56.
    'Style: Timer,Arial,48,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,2,0,8,10,10,56,1',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const totalStr = totalWorkoutStr;

  for (let sec = 0; sec < Math.ceil(durationSec); sec++) {
    const start = fmtAssTime(sec);
    const end = fmtAssTime(Math.min(sec + 1, durationSec));
    let text;
    if (type === 'rest') {
      const remaining = Math.max(0, durationSec - sec);
      const lbl = (label || 'REST').replace(/,/g, '').slice(0, 15).toUpperCase();
      text = `${lbl}  ${fmtTime(remaining)}`;
    } else {
      text = `${fmtTime(sec)} / ${totalStr}`;
    }
    lines.push(`Dialogue: 0,${start},${end},Timer,,0,0,0,,${text}`);
  }

  return lines.join('\n');
}

/** Format seconds as ASS timestamp H:MM:SS.xx */
function fmtAssTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.00`;
}

// ── Block flattening ──────────────────────────────────────────────────────

const SPECIAL_BLOCK_TYPES = new Set([
  'Intro', 'Outro', 'Demo', 'Transition', 'Water Break', 'Grab Equipment', 'Follow-Along Video',
]);

const VIDEO_EXTENSIONS = /\.(mp4|mov|m4v|webm|avi|mkv)(\?.*)?$/i;

/** Flatten workout doc into render segments [{type, label, url?, durationSec}] */
function flattenWorkout(workout) {
  const blocks = workout.blocks || [];
  const segments = [];
  const workoutRestDur = workout.restDurationSeconds || 30;

  if (workout.introVideoUrl) {
    segments.push({ type: 'video', label: 'Intro', url: workout.introVideoUrl, durationSec: 10 });
  }

  for (const block of blocks) {
    const bType = block.type || 'Circuit';

    if (bType === 'Follow-Along Video') {
      segments.push({
        type: 'video',
        label: block.label || block.name || 'Follow-Along',
        url: block.videoUrl || '',
        durationSec: block.videoDurationSec || block.durationSec || 60,
      });
      continue;
    }

    if (bType === 'Water Break' || bType === 'Rest') {
      segments.push({
        type: 'rest',
        label: block.label || block.name || 'Rest',
        durationSec: block.durationSec || workoutRestDur,
      });
      continue;
    }

    if (bType === 'Intro' || bType === 'Outro') {
      if (block.videoUrl) {
        segments.push({ type: 'video', label: bType, url: block.videoUrl, durationSec: block.durationSec || 10 });
      } else if (block.thumbnailUrl) {
        segments.push({ type: 'image', label: bType, url: block.thumbnailUrl, durationSec: block.durationSec || 10 });
      }
      continue;
    }

    if (SPECIAL_BLOCK_TYPES.has(bType)) {
      segments.push({
        type: 'rest',
        label: block.label || block.name || bType,
        durationSec: block.durationSec || 15,
      });
      continue;
    }

    // Exercise block — expand movements
    const movements = block.movements || [];
    for (const mv of movements) {
      const videoUrl = mv.videoUrl || mv.mediaUrl || '';
      const workDur = mv.duration || mv.durationSec || mv.workSec || 30;
      const restAfter = mv.restAfter || mv.restSec || 0;
      const mvLabel = mv.name || 'Movement';

      if (videoUrl && VIDEO_EXTENSIONS.test(videoUrl)) {
        segments.push({ type: 'video', label: mvLabel, url: videoUrl, durationSec: workDur });
      } else if (mv.thumbnailUrl || mv.posterUrl) {
        segments.push({ type: 'image', label: mvLabel, url: mv.thumbnailUrl || mv.posterUrl, durationSec: workDur });
      } else {
        segments.push({ type: 'rest', label: mvLabel, durationSec: workDur });
      }

      if (restAfter > 0) {
        segments.push({ type: 'rest', label: 'Rest', durationSec: restAfter });
      }
    }

    if (block.restDurationSeconds > 0) {
      segments.push({ type: 'rest', label: 'Rest', durationSec: block.restDurationSeconds });
    }
  }

  if (workout.outroVideoUrl) {
    segments.push({ type: 'video', label: 'Outro', url: workout.outroVideoUrl, durationSec: 10 });
  }

  return segments;
}

/** Pick best matching workout from Firestore. */
async function pickWorkout() {
  if (forcedWorkoutId) {
    const doc = await db.collection('workouts').doc(forcedWorkoutId).get();
    if (!doc.exists) throw new Error(`Workout ${forcedWorkoutId} not found`);
    return { id: doc.id, ...doc.data() };
  }

  const snap = await db.collection('workouts')
    .orderBy('updatedAt', 'desc')
    .limit(50)
    .get();

  let best = null;
  let bestScore = -1;
  let compromise = null;

  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.isArchived) continue;
    const segs = flattenWorkout(data);
    const totalDur = segs.reduce((sum, s) => sum + s.durationSec, 0);
    const hasVideo = segs.some((s) => s.type === 'video');
    const hasNonVideo = segs.some((s) => s.type === 'rest' || s.type === 'image');

    if (!hasVideo) continue;
    if (!compromise) compromise = { id: doc.id, ...data }; // any workout with video

    if (!hasNonVideo) continue;
    if (totalDur < MIN_DURATION || totalDur > MAX_DURATION) continue;

    const durationScore = 1 - Math.abs(totalDur - 1200) / 1200;
    const videoCount = segs.filter((s) => s.type === 'video').length;
    const score = durationScore + videoCount * 0.1;

    if (score > bestScore) {
      bestScore = score;
      best = { id: doc.id, ...data };
    }
  }

  if (best) return best;

  if (compromise) {
    console.warn('[renderWorkout] No workout meets ideal criteria — using best available (COMPROMISE)');
    return compromise;
  }

  throw new Error('No suitable workout found in Firestore');
}

// ── FFmpeg rendering ──────────────────────────────────────────────────────

/** Build FFmpeg args for a segment. assPath points to the generated ASS file. */
function buildSegmentArgs(seg, assPath, outputPath) {
  const dur = seg.durationSec;
  const assEsc = assPath.replace(/\\/g, '/').replace(/:/g, '\\:');

  if (seg.type === 'video') {
    const filter = [
      `[0:v]format=yuv420p,scale=${CANVAS_W}:${MOVEMENT_H}:force_original_aspect_ratio=decrease,` +
        `pad=${CANVAS_W}:${MOVEMENT_H}:(ow-iw)/2:(oh-ih)/2:black,setpts=PTS-STARTPTS[mv]`,
      `color=c=#1a1a1a:s=${CANVAS_W}x${TIMER_H}:r=30,format=yuv420p[band]`,
      `[band][mv]vstack=inputs=2[canvas]`,
      `[canvas]subtitles=${assEsc}[out]`,
    ].join(';');

    return [
      '-y', '-i', seg._localPath,
      '-filter_complex', filter,
      '-map', '[out]',
      '-t', String(dur),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an',
      outputPath,
    ];
  }

  if (seg.type === 'image') {
    const filter = [
      `[0:v]format=yuv420p,scale=${CANVAS_W}:${MOVEMENT_H}:force_original_aspect_ratio=decrease,` +
        `pad=${CANVAS_W}:${MOVEMENT_H}:(ow-iw)/2:(oh-ih)/2:black[mv]`,
      `color=c=#1a1a1a:s=${CANVAS_W}x${TIMER_H}:r=30[band]`,
      `[band][mv]vstack=inputs=2[canvas]`,
      `[canvas]subtitles=${assEsc}[out]`,
    ].join(';');

    if (seg._isGif) {
      // Animated GIF: stream_loop to fill duration, fps to normalize frame rate
      return [
        '-y',
        '-stream_loop', '-1', '-t', String(dur), '-i', seg._localPath,
        '-filter_complex', filter,
        '-map', '[out]',
        '-t', String(dur),
        '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an',
        '-r', '30',
        outputPath,
      ];
    }

    return [
      '-y',
      '-loop', '1', '-framerate', '30', '-t', String(dur), '-i', seg._localPath,
      '-filter_complex', filter,
      '-map', '[out]',
      '-t', String(dur),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an',
      outputPath,
    ];
  }

  // Rest block — pure lavfi source
  const filter = [
    `color=c=#2a2a2a:s=${CANVAS_W}x${MOVEMENT_H}:r=30,format=yuv420p[mv]`,
    `color=c=#1a1a1a:s=${CANVAS_W}x${TIMER_H}:r=30,format=yuv420p[band]`,
    `[band][mv]vstack=inputs=2[canvas]`,
    `[canvas]subtitles=${assEsc}[out]`,
  ].join(';');

  return [
    '-y',
    '-filter_complex', filter,
    '-map', '[out]',
    '-t', String(dur),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p', '-an',
    outputPath,
  ];
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const wallStart = Date.now();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goarrive-render-'));

  console.log('[renderWorkout] Picking workout from Firestore...');
  const workout = await pickWorkout();
  const workoutId = workout.id;
  const workoutName = workout.name || workout.title || workoutId;
  console.log(`[renderWorkout] Selected: ${workoutId} — "${workoutName}"`);

  const segments = flattenWorkout(workout);
  const totalDurSec = segments.reduce((sum, s) => sum + s.durationSec, 0);
  const totalStr = fmtTime(totalDurSec); // for timer display

  const videoSegs = segments.filter((s) => s.type === 'video').length;
  const imageSegs = segments.filter((s) => s.type === 'image').length;
  const restSegs = segments.filter((s) => s.type === 'rest').length;

  console.log(`[renderWorkout] ${segments.length} segments: ${videoSegs} video, ${imageSegs} image, ${restSegs} rest — total ${Math.floor(totalDurSec / 60)}m ${Math.round(totalDurSec % 60)}s`);

  // Download all media assets
  console.log('[renderWorkout] Downloading media...');
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'rest' || !seg.url) continue;

    const ext = seg.type === 'image' ? 'jpg' : 'mp4';
    const localPath = path.join(tmpDir, `block-${i}.${ext}`);
    try {
      const result = await downloadUrl(seg.url, localPath);
      seg._localPath = result.path;
      seg._contentType = result.contentType;
      // If this turned out to be a GIF, note it
      if (result.contentType && result.contentType.includes('gif')) {
        seg._isGif = true;
      }
    } catch (err) {
      console.warn(`[renderWorkout] Download failed for segment ${i} (${seg.label}): ${err.message} — degrading to rest`);
      seg.type = 'rest';
    }
  }

  // Render each segment
  console.log('[renderWorkout] Rendering segments...');
  const blockOutputs = [];
  const fallbacks = [];

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.durationSec <= 0) continue;

    // Generate ASS timer file for this segment
    const assPath = path.join(tmpDir, `timer-${i}.ass`);
    const assContent = generateAss(seg.durationSec, totalStr, seg.type, seg.label);
    fs.writeFileSync(assPath, assContent);

    const outPath = path.join(tmpDir, `out-${i}.mp4`);
    const ffArgs = buildSegmentArgs(seg, assPath, outPath);

    try {
      await execFileAsync(ffmpegBin, ffArgs, { timeout: 300_000 });
      blockOutputs.push(outPath);
      process.stdout.write(`  [${i + 1}/${segments.length}] ${seg.type.padEnd(5)} ${seg.label} (${seg.durationSec}s) ✓\n`);
    } catch (err) {
      const errMsg = (err.message || '').slice(0, 200);
      console.error(`[renderWorkout] FFmpeg failed on segment ${i} (${seg.label}): ${errMsg}`);
      // Try rest-block fallback
      const restSeg = { type: 'rest', label: seg.label, durationSec: seg.durationSec };
      const restAssContent = generateAss(seg.durationSec, totalStr, 'rest', seg.label);
      fs.writeFileSync(assPath, restAssContent);
      const restArgs = buildSegmentArgs(restSeg, assPath, outPath);
      try {
        await execFileAsync(ffmpegBin, restArgs, { timeout: 120_000 });
        blockOutputs.push(outPath);
        fallbacks.push(seg.label);
        process.stdout.write(`  [${i + 1}/${segments.length}] REST fallback for ${seg.label}\n`);
      } catch (err2) {
        console.error(`[renderWorkout] Rest fallback also failed for segment ${i}:`, (err2.message || '').slice(0, 200));
      }
    }
  }

  if (blockOutputs.length === 0) {
    throw new Error('No segments rendered successfully');
  }

  // Write concat list and concatenate
  const concatPath = path.join(tmpDir, 'concat.txt');
  fs.writeFileSync(concatPath, blockOutputs.map((p) => `file '${p}'`).join('\n'));

  const concatOut = path.join(tmpDir, 'concat-raw.mp4');
  console.log(`[renderWorkout] Concatenating ${blockOutputs.length} segments...`);
  await execFileAsync(ffmpegBin, [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
    '-c', 'copy', concatOut,
  ], { timeout: 600_000 });

  // Faststart pass
  const finalOut = path.join(tmpDir, 'final.mp4');
  console.log('[renderWorkout] Applying faststart...');
  await execFileAsync(ffmpegBin, [
    '-y', '-i', concatOut,
    '-c', 'copy', '-movflags', '+faststart', finalOut,
  ], { timeout: 300_000 });

  // Upload to Cloud Storage
  const storageDestPath = `rendered-videos/${workoutId}/v1.mp4`;
  console.log(`[renderWorkout] Uploading to gs://${BUCKET_NAME}/${storageDestPath}...`);
  await bucket.upload(finalOut, {
    destination: storageDestPath,
    metadata: {
      contentType: 'video/mp4',
      cacheControl: 'public, max-age=86400',
    },
  });

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const [signedUrl] = await bucket.file(storageDestPath).getSignedUrl({
    action: 'read',
    expires: expiresAt,
  });

  const fileSizeMb = (fs.statSync(finalOut).size / (1024 * 1024)).toFixed(2);
  const renderTimeSec = ((Date.now() - wallStart) / 1000).toFixed(1);

  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

  console.log('\n========== RENDER COMPLETE ==========');
  console.log(`Workout ID:      ${workoutId}`);
  console.log(`Workout name:    ${workoutName}`);
  console.log(`Blocks:          ${videoSegs} movement video + ${imageSegs} image + ${restSegs} rest`);
  console.log(`Total duration:  ${Math.floor(totalDurSec / 60)}m ${Math.round(totalDurSec % 60)}s`);
  console.log(`Render time:     ${renderTimeSec}s`);
  console.log(`File size:       ${fileSizeMb} MB`);
  console.log(`Signed URL:      ${signedUrl}`);
  if (fallbacks.length > 0) {
    console.log(`REST fallbacks:  ${fallbacks.join(', ')}`);
  }
  console.log('=====================================\n');

  return { workoutId, workoutName, signedUrl, fileSizeMb, renderTimeSec };
}

main().catch((err) => {
  console.error('[renderWorkout] Fatal error:', err.message || err);
  process.exit(1);
});
