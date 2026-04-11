#!/usr/bin/env node
/**
 * One-time backfill script: regenerate thumbnails for movements that have
 * videoUrl but empty thumbnailUrl (caused by Firebase Storage CORS misconfiguration).
 *
 * This runs server-side using the Firebase Admin SDK. It does NOT generate GIFs
 * (that requires browser canvas APIs). Instead, it uses FFmpeg to extract a
 * first-frame JPEG and uploads it as the thumbnailUrl.
 *
 * Usage (from repo root):
 *   cd functions && node ../scripts/backfill-movement-thumbnails.js
 *
 * Note: The proper GIF will be generated when a coach next edits the movement
 * in the UI (the edit form auto-generates GIFs for movements without thumbnails).
 */

const admin = require('firebase-admin');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const sa = require('../.secrets/firebase-service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(sa),
  storageBucket: 'goarrive.firebasestorage.app',
});

const db = admin.firestore();
const bucket = admin.storage().bucket();

async function backfill() {
  // Find movements with videoUrl but no thumbnailUrl
  const snap = await db.collection('movements')
    .where('thumbnailUrl', '==', '')
    .get();

  const broken = snap.docs.filter(d => {
    const data = d.data();
    return data.videoUrl && data.videoUrl.trim() !== '';
  });

  console.log(`Found ${broken.length} movements with missing thumbnails`);

  for (const doc of broken) {
    const data = doc.data();
    const videoUrl = data.videoUrl;
    console.log(`\nProcessing: ${doc.id} (${data.name || 'unnamed'})`);
    console.log(`  videoUrl: ${videoUrl.slice(0, 80)}...`);

    try {
      // Download video to temp file
      const tmpDir = os.tmpdir();
      const tmpVideo = path.join(tmpDir, `${doc.id}.mp4`);
      const tmpThumb = path.join(tmpDir, `${doc.id}.jpg`);

      // Download using curl
      execSync(`curl -sL -o "${tmpVideo}" "${videoUrl}"`, { timeout: 30000 });

      // Extract first frame using ffmpeg
      execSync(
        `ffmpeg -y -i "${tmpVideo}" -vframes 1 -vf "scale=240:300:force_original_aspect_ratio=increase,crop=240:300" -q:v 2 "${tmpThumb}"`,
        { timeout: 15000, stdio: 'pipe' }
      );

      // Upload to Firebase Storage
      const destPath = `movements/${data.coachId}/thumbnails-img/${Date.now()}-${doc.id}.jpg`;
      await bucket.upload(tmpThumb, {
        destination: destPath,
        metadata: { contentType: 'image/jpeg' },
      });

      // Get public download URL
      const file = bucket.file(destPath);
      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: '2099-12-31',
      });

      // Or use the Firebase Storage download URL format
      const encodedPath = encodeURIComponent(destPath);
      // Get download token
      const [metadata] = await file.getMetadata();
      const token = metadata.metadata?.firebaseStorageDownloadTokens;
      const downloadUrl = token
        ? `https://firebasestorage.googleapis.com/v0/b/goarrive.firebasestorage.app/o/${encodedPath}?alt=media&token=${token}`
        : url;

      // Update Firestore
      await db.collection('movements').doc(doc.id).update({
        thumbnailUrl: downloadUrl,
        thumbnailImageUrl: downloadUrl,
      });

      console.log(`  ✓ Thumbnail uploaded and saved`);

      // Cleanup
      try { fs.unlinkSync(tmpVideo); } catch {}
      try { fs.unlinkSync(tmpThumb); } catch {}
    } catch (err) {
      console.error(`  ✗ Failed: ${err.message}`);
    }
  }

  console.log('\nDone!');
  process.exit(0);
}

backfill().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
