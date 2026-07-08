// ─── Workout share-link OG video ─────────────────────────────────────────────
// Generates a 5-second looping mp4 preview for a shared workout: movement clips
// tiled in a grid on a dark background, sized for og:video (1080x1350, 4:5).
// Falls back gracefully — movements with no videoUrl use their static thumbnail
// as a 5-second still. Uploaded to og-images/{shareId}-v1.mp4, URL written to
// shareTokens/{shareId}.ogVideoUrl.
// ─────────────────────────────────────────────────────────────────────────────

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { collectOgGroups } from './ogImage';

const execFileAsync = promisify(execFile);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegBin: string = require('ffmpeg-static');

const OUT_W = 1080;
const OUT_H = 1350; // 4:5 portrait
const CLIP_DURATION = 5;
const TILE_GAP = 10;
const MAX_TILES = 9;
const BG_HEX = '0F1117';

const SPECIAL_BLOCK_TYPES = new Set([
  'Intro', 'Outro', 'Demo', 'Transition', 'Water Break', 'Grab Equipment', 'Follow-Along Video',
]);

function colsForCount(n: number): number {
  if (n <= 4) return 2;
  return 3;
}

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    }).on('error', (e) => { try { fs.unlinkSync(dest); } catch { /* ok */ } reject(e); });
  });
}

// isGif: ffmpeg treats animated GIFs as a video demuxer (not still image).
// isImage: true only for static jpg/png — use -loop 1 -framerate 24 -t N.
// isGif: use -stream_loop -1 -t N (no -loop/-framerate).
// isVideo: use -ss 0 -t N (no looping flags).
interface TileInput { filePath: string; type: 'video' | 'gif' | 'image' }

async function fetchTile(mv: any, idx: number, tmpDir: string): Promise<TileInput | null> {
  // Prefer mp4 video, then animated gif, then static thumbnail
  const videoUrl: string | null = mv?.videoUrl || null;
  const gifUrl: string | null = mv?.gifUrl || null;
  const imgUrl: string | null = mv?.thumbnailUrl || mv?.posterUrl || null;

  if (videoUrl) {
    const dest = path.join(tmpDir, `t${idx}.mp4`);
    try { await download(videoUrl, dest); return { filePath: dest, type: 'video' }; } catch { /* fall */ }
  }
  if (gifUrl) {
    const dest = path.join(tmpDir, `t${idx}.gif`);
    try { await download(gifUrl, dest); return { filePath: dest, type: 'gif' }; } catch { /* fall */ }
  }
  if (imgUrl) {
    const ext = (imgUrl.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
    const dest = path.join(tmpDir, `t${idx}.${ext}`);
    try {
      await download(imgUrl, dest);
      // GIF URLs can land in thumbnailUrl too
      return { filePath: dest, type: ext === 'gif' ? 'gif' : 'image' };
    } catch { /* skip */ }
  }
  return null;
}

export async function generateWorkoutOgVideo(
  shareId: string,
  workout: Record<string, any>,
): Promise<string | null> {
  const { groups } = collectOgGroups(workout);
  if (groups.length === 0) return null;

  // Re-walk blocks to collect raw movement objects (need videoUrl/thumbnailUrl)
  const blocks: any[] = Array.isArray(workout.blocks) ? workout.blocks : [];
  const rawMovements: any[] = [];
  for (const block of blocks) {
    if (SPECIAL_BLOCK_TYPES.has(block?.type || '')) continue;
    const mvs = (Array.isArray(block.movements) ? block.movements : [])
      .filter((mv: any) => mv && mv.showOnPreview !== false);
    rawMovements.push(...mvs);
  }
  const tileMvs = rawMovements.slice(0, MAX_TILES);
  if (tileMvs.length === 0) return null;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `ogv-${shareId.slice(0, 8)}-`));
  try {
    const tiles = (await Promise.all(tileMvs.map((mv, i) => fetchTile(mv, i, tmpDir))))
      .filter((t): t is TileInput => t !== null);
    if (tiles.length === 0) return null;

    const cols = colsForCount(tiles.length);
    const rows = Math.ceil(tiles.length / cols);
    const tileW = Math.floor((OUT_W - TILE_GAP * (cols + 1)) / cols);
    const tileH = Math.floor((OUT_H - TILE_GAP * (rows + 1)) / rows);

    // Build ffmpeg args
    const args: string[] = ['-y'];
    for (const tile of tiles) {
      if (tile.type === 'image') {
        // Static jpg/png: loop as still for CLIP_DURATION seconds
        args.push('-loop', '1', '-framerate', '24', '-t', String(CLIP_DURATION), '-i', tile.filePath);
      } else if (tile.type === 'gif') {
        // Animated GIF: loop for CLIP_DURATION seconds
        args.push('-stream_loop', '-1', '-t', String(CLIP_DURATION), '-i', tile.filePath);
      } else {
        // mp4: trim to CLIP_DURATION
        args.push('-ss', '0', '-t', String(CLIP_DURATION), '-i', tile.filePath);
      }
    }

    // filter_complex: scale each input, then xstack into grid
    const scaleParts: string[] = [];
    const scaleOuts: string[] = [];
    for (let i = 0; i < tiles.length; i++) {
      const out = `s${i}`;
      scaleParts.push(
        `[${i}:v]scale=${tileW}:${tileH}:force_original_aspect_ratio=decrease,` +
        `pad=${tileW}:${tileH}:(ow-iw)/2:(oh-ih)/2:color=0x${BG_HEX},` +
        `setpts=PTS-STARTPTS,fps=24[${out}]`
      );
      scaleOuts.push(`[${out}]`);
    }

    const xstackLayout = tiles.map((_, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      return `${TILE_GAP + col * (tileW + TILE_GAP)}_${TILE_GAP + row * (tileH + TILE_GAP)}`;
    }).join('|');

    const gridW = TILE_GAP + cols * (tileW + TILE_GAP);
    const gridH = TILE_GAP + rows * (tileH + TILE_GAP);

    scaleParts.push(
      `${scaleOuts.join('')}xstack=inputs=${tiles.length}:layout=${xstackLayout}:fill=0x${BG_HEX}[grid]`,
      `color=c=0x${BG_HEX}:s=${OUT_W}x${OUT_H}:r=24[bg]`,
      `[bg][grid]overlay=${Math.floor((OUT_W - gridW) / 2)}:${Math.floor((OUT_H - gridH) / 2)}[out]`,
    );

    const outPath = path.join(tmpDir, 'out.mp4');
    args.push(
      '-filter_complex', scaleParts.join(';'),
      '-map', '[out]',
      '-t', String(CLIP_DURATION),
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-an',
      outPath,
    );

    await execFileAsync(ffmpegBin, args, { timeout: 300_000 });

    // Upload
    const bucket = admin.storage().bucket();
    const storageDest = `og-images/${shareId}-v1.mp4`;
    await bucket.upload(outPath, {
      destination: storageDest,
      metadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=31536000' },
    });
    const [url] = await bucket.file(storageDest).getSignedUrl({ action: 'read', expires: '2035-01-01' });

    await admin.firestore().collection('shareTokens').doc(shareId).update({ ogVideoUrl: url });
    return url;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}
