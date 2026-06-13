/**
 * backfill-movement-posters.js
 *
 * Generates and uploads static poster JPEGs for all movement docs that are
 * missing `posterUrl`. Idempotent — skips docs that already have posterUrl.
 *
 * Prerequisites:
 *   - Node 18+ with canvas package installed: npm install canvas
 *   - ffmpeg on PATH
 *   - Firebase service account key at GOOGLE_APPLICATION_CREDENTIALS or
 *     the maia-assistant SA key used by other backfill scripts
 *   - Firebase project ID in GCLOUD_PROJECT or FIREBASE_PROJECT env var
 *
 * Usage (from repo root on the VM):
 *   node scripts/backfill-movement-posters.js [--dry-run] [--limit 50]
 *
 * Options:
 *   --dry-run    Log what would be updated without writing to Firestore/Storage
 *   --limit N    Only process N docs (default: all)
 *   --coachId X  Only process movements belonging to this coachId
 *
 * DO NOT run this on your laptop — run on the VM with maia-assistant SA creds.
 * Expected time: ~2-5s per movement (ffmpeg frame extract + Storage upload).
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ── Parse CLI args ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIMIT_IDX = args.indexOf('--limit');
const LIMIT = LIMIT_IDX !== -1 ? parseInt(args[LIMIT_IDX + 1], 10) : Infinity;
const COACH_IDX = args.indexOf('--coachId');
const FILTER_COACH = COACH_IDX !== -1 ? args[COACH_IDX + 1] : null;

console.log(`[backfill-movement-posters] Starting${DRY_RUN ? ' DRY RUN' : ''} — limit=${LIMIT} coachId=${FILTER_COACH || 'all'}`);

// ── Firebase Admin ─────────────────────────────────────────────────────────
const admin = require('firebase-admin');
if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();
const storage = admin.storage();
const bucket = storage.bucket();

// ── JPEG quality ───────────────────────────────────────────────────────────
const POSTER_QUALITY = 2; // ffmpeg -q:v 2 ≈ 0.75 quality in browser terms
const POSTER_WIDTH = 240;
const POSTER_HEIGHT = 300;

/**
 * Download a URL to a temp file and return the temp path.
 */
function downloadToTemp(url, ext = 'mp4') {
  const tmp = path.join(os.tmpdir(), `goarrive-poster-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
  const result = spawnSync('curl', ['-sL', '-o', tmp, url], { timeout: 30000 });
  if (result.status !== 0) throw new Error(`curl failed: ${result.stderr?.toString()}`);
  return tmp;
}

/**
 * Extract the first frame of a video at the given path and return a JPEG buffer.
 * Applies a center-crop to 4:5 aspect ratio.
 */
function extractFirstFrame(videoPath) {
  const outPath = videoPath.replace(/\.\w+$/, '-poster.jpg');
  // vf: scale to fill 240×300 with cover-fit (crop from center), single frame at t=0
  const vf = `scale=${POSTER_WIDTH}:${POSTER_HEIGHT}:force_original_aspect_ratio=increase,crop=${POSTER_WIDTH}:${POSTER_HEIGHT}`;
  const result = spawnSync('ffmpeg', [
    '-y', '-ss', '0', '-i', videoPath,
    '-vf', vf,
    '-vframes', '1',
    '-q:v', String(POSTER_QUALITY),
    outPath,
  ], { timeout: 20000 });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr?.toString()?.slice(0, 200)}`);
  }
  const buf = fs.readFileSync(outPath);
  fs.unlinkSync(outPath);
  return buf;
}

/**
 * Upload a JPEG buffer to Firebase Storage and return a public download URL.
 */
async function uploadPoster(jpegBuffer, coachId) {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  const destPath = `movements/${coachId}/posters/${ts}-${rand}.jpg`;
  const file = bucket.file(destPath);
  await file.save(jpegBuffer, {
    metadata: {
      contentType: 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable',
    },
  });
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${destPath}`;
}

async function main() {
  // Query movements missing posterUrl
  let query = db.collection('movements');
  if (FILTER_COACH) query = query.where('coachId', '==', FILTER_COACH);

  const snap = await query.get();
  const docs = snap.docs.filter((d) => {
    const data = d.data();
    return !data.posterUrl && data.videoUrl;
  });

  console.log(`[backfill] Found ${docs.length} movements missing posterUrl (of ${snap.size} total)`);
  if (docs.length === 0) { console.log('[backfill] Nothing to do.'); return; }

  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const docSnap of docs) {
    if (processed >= LIMIT) break;
    const data = docSnap.data();
    const { videoUrl, coachId, name } = data;

    if (!videoUrl) { skipped++; continue; }

    console.log(`[backfill] Processing "${name}" (${docSnap.id}) coachId=${coachId}`);

    let videoPath = null;
    try {
      // Download video
      videoPath = downloadToTemp(videoUrl, 'mp4');

      // Extract first frame as JPEG
      const jpegBuffer = extractFirstFrame(videoPath);
      console.log(`  → Frame extracted (${(jpegBuffer.length / 1024).toFixed(1)} KB)`);

      if (!DRY_RUN) {
        // Upload to Storage
        const posterUrl = await uploadPoster(jpegBuffer, coachId || 'global');
        // Write back to Firestore
        await docSnap.ref.update({
          posterUrl,
          thumbnailImageUrl: data.thumbnailImageUrl || posterUrl,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`  → Written posterUrl: ${posterUrl.slice(0, 80)}...`);
      } else {
        console.log(`  → DRY RUN: would upload and write posterUrl`);
      }
      processed++;
    } catch (err) {
      console.error(`  → FAILED: ${err.message}`);
      failed++;
    } finally {
      if (videoPath && fs.existsSync(videoPath)) fs.unlinkSync(videoPath);
    }
  }

  console.log(`\n[backfill] Done. processed=${processed} skipped=${skipped} failed=${failed}`);
}

main().catch((err) => { console.error('[backfill] Fatal:', err); process.exit(1); });
