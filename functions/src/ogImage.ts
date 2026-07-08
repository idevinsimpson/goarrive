// ─── Workout share-link OG images ────────────────────────────────────────────
// Composes a 1200x1600 portrait Open Graph preview image for a shared workout,
// mirroring the WorkoutPlayer "ready" phase: logo top, movement thumbnails
// (4:5 portrait tiles) grouped by block with round badges. Consecutive
// single-movement ("Tabata") blocks merge into one group, broken by special
// blocks (Water Break etc.) exactly like the player. No title text — og:title
// carries the workout name in the unfurl. Uploaded to Storage at
// og-images/{shareId}-v2.jpg and recorded on the shareTokens doc as ogImageUrl.
//
// Text is rendered via SVG layers composited by sharp (sharp has no native
// text API). Fonts come from the runtime's fontconfig; we request generic
// sans-serif so it degrades gracefully.
// ─────────────────────────────────────────────────────────────────────────────

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// Mirrors apps/goarrive/hooks/useWorkoutFlatten.ts SPECIAL_BLOCK_TYPES —
// blocks that carry no movements and are excluded from the preview grid.
// Specials also break tabata runs: tabata blocks only merge when consecutive
// in the original block order with no special block between them.
const SPECIAL_BLOCK_TYPES = new Set([
  'Intro', 'Outro', 'Demo', 'Transition', 'Water Break', 'Grab Equipment', 'Follow-Along Video',
]);

const CANVAS_W = 1200;
const CANVAS_H = 1600;
const MARGIN_X = 60;
const CONTENT_W = CANVAS_W - MARGIN_X * 2;
const GRID_TOP = 170;
const GRID_BOTTOM = CANVAS_H - 60;
const TILE_GAP = 14;
const GROUP_LABEL_H = 48;
const COLUMNS = 4;
const MAX_TILES = 16;
const MAX_GROUPS = 5;
// App-wide movement image aspect: 4:5 portrait (height = width * 1.25).
const TILE_H_PER_W = 1.25;

const COLORS = {
  background: '#0F1117',
  surface: '#1A1D27',
  text: '#E8EAF0',
  muted: '#7A7F94',
  gold: '#F5A623',
  badge: '#7BA7D4',
};

interface OgTile {
  imageUrl: string | null;
  extraCount?: number;
  /** Per-tile rounds label (tabata tiles keep their own "8x"). */
  roundsLabel?: string;
}

interface OgGroup {
  label: string;
  rounds: number;
  tiles: OgTile[];
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tileImageUrl(mv: any): string | null {
  if (mv && typeof mv.thumbnailUrl === 'string' && mv.thumbnailUrl) return mv.thumbnailUrl;
  if (mv && typeof mv.posterUrl === 'string' && mv.posterUrl) return mv.posterUrl;
  return null;
}

/** Extracts preview groups (block label + rounds + movement thumbnails) from a workout doc. */
export function collectOgGroups(workout: Record<string, any>): { groups: OgGroup[]; movementCount: number } {
  const blocks: any[] = Array.isArray(workout.blocks) ? workout.blocks : [];
  // Mirrors WorkoutPlayer ready phase: a "tabata" block has exactly one movement.
  const isTabataBlock = (b: any) => Array.isArray(b?.movements) && b.movements.length === 1;

  let movementCount = 0;
  const allGroups: OgGroup[] = [];
  let tabataRun: any[] = [];

  const flushTabataRun = () => {
    if (tabataRun.length === 0) return;
    const tiles: OgTile[] = [];
    for (const blk of tabataRun) {
      const mv = blk.movements[0];
      if (!mv) continue;
      const rounds = Number(blk.rounds ?? blk.sets ?? 1) || 1;
      tiles.push({ imageUrl: tileImageUrl(mv), roundsLabel: rounds > 1 ? `${rounds}x` : undefined });
    }
    tabataRun = [];
    if (tiles.length === 0) return;
    movementCount += tiles.length;
    allGroups.push({ label: 'Tabata', rounds: 1, tiles });
  };

  for (const block of blocks) {
    if (SPECIAL_BLOCK_TYPES.has(block?.type || '')) {
      // Specials break tabata runs — blocks on opposite sides of a Water Break
      // do not merge, even though the special itself renders nothing.
      flushTabataRun();
      continue;
    }
    if (isTabataBlock(block)) {
      tabataRun.push(block);
      continue;
    }
    flushTabataRun();
    const movements = (Array.isArray(block.movements) ? block.movements : [])
      .filter((mv: any) => mv && mv.showOnPreview !== false);
    if (movements.length === 0) continue;
    movementCount += movements.length;
    allGroups.push({
      label: String(block.label || block.name || block.type || 'Block'),
      rounds: Number(block.rounds ?? block.sets ?? 1) || 1,
      tiles: movements.map((mv: any) => ({ imageUrl: tileImageUrl(mv) })),
    });
  }
  flushTabataRun();

  // Cap groups and total tiles; fold the overflow into a trailing "+N" tile.
  const groups = allGroups.slice(0, MAX_GROUPS);
  let shown = 0;
  let budgetLeft = MAX_TILES;
  for (const g of groups) {
    g.tiles = g.tiles.slice(0, budgetLeft);
    budgetLeft -= g.tiles.length;
    shown += g.tiles.length;
  }
  const groupsShown = groups.filter((g) => g.tiles.length > 0);
  const hidden = movementCount - shown;
  if (hidden > 0 && groupsShown.length > 0) {
    const last = groupsShown[groupsShown.length - 1];
    if (shown >= MAX_TILES) last.tiles[last.tiles.length - 1] = { imageUrl: null, extraCount: hidden + 1 };
    else last.tiles.push({ imageUrl: null, extraCount: hidden });
  }
  return { groups: groupsShown, movementCount };
}

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch {
    return null;
  }
}

function loadLogo(): Buffer | null {
  const candidates = [
    path.join(__dirname, '..', 'assets', 'goarrive-logo.png'),
    path.join(__dirname, '..', '..', 'assets', 'goarrive-logo.png'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p);
    } catch { /* keep trying */ }
  }
  return null;
}

/**
 * Composes the 1200x1600 portrait OG JPEG for a workout. Returns the buffer.
 * Throws on composition failure — callers treat OG images as best-effort.
 */
export async function composeWorkoutOgImage(workout: Record<string, any>): Promise<Buffer> {
  // Dynamic require keeps cold starts lean for the many functions in this
  // codebase that never touch sharp (same pattern as onMovementMediaUploaded).
  const sharp = require('sharp');

  const { groups } = collectOgGroups(workout);

  // ── Layout: fit every group (label row + 4:5 tile rows) into the grid band ─
  const maxGroupTiles = groups.reduce((m, g) => Math.max(m, g.tiles.length), 0);
  const effCols = Math.max(2, Math.min(COLUMNS, maxGroupTiles));
  const rowsPerGroup = groups.map((g) => Math.ceil(g.tiles.length / effCols));
  const totalRows = rowsPerGroup.reduce((a, b) => a + b, 0) || 0;
  const availH = GRID_BOTTOM - GRID_TOP;
  const fixedH = groups.length * GROUP_LABEL_H + totalRows * TILE_GAP;
  const maxTileW = Math.floor((CONTENT_W - (effCols - 1) * TILE_GAP) / effCols);
  let tileH = totalRows > 0
    ? Math.min(
        Math.floor((availH - fixedH) / totalRows),
        Math.floor(maxTileW * TILE_H_PER_W),
        560,
      )
    : 0;
  tileH = totalRows > 0 ? Math.max(120, tileH) : 0;
  const tileW = Math.round(tileH / TILE_H_PER_W);

  // Center the whole grid band vertically when content is short.
  const usedH = fixedH + totalRows * tileH;
  const gridTop = GRID_TOP + Math.max(0, Math.floor((availH - usedH) / 2));

  // ── Fetch thumbnails in parallel ─────────────────────────────────────────
  const allTiles = groups.flatMap((g) => g.tiles);
  const buffers = await Promise.all(
    allTiles.map((t) => (t.imageUrl && !t.extraCount ? fetchImage(t.imageUrl) : Promise.resolve(null)))
  );

  const composites: any[] = [];
  const svgParts: string[] = [];

  // ── Logo ─────────────────────────────────────────────────────────────────
  const logoBuf = loadLogo();
  if (logoBuf) {
    const logo = await sharp(logoBuf)
      .resize({ height: 72, width: 520, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer();
    const meta = await sharp(logo).metadata();
    composites.push({
      input: logo,
      top: Math.round((GRID_TOP - (meta.height || 72)) / 2),
      left: Math.round((CANVAS_W - (meta.width || 520)) / 2),
    });
  } else {
    svgParts.push(
      `<text x="${CANVAS_W / 2}" y="${Math.round(GRID_TOP / 2) + 16}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="44" fill="${COLORS.text}">G<tspan fill="${COLORS.gold}">➲</tspan>A</text>`
    );
  }

  // ── Groups: badge + label row, then tile grid (rows centered) ────────────
  let y = gridTop;
  let tileIdx = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const firstRowCols = Math.min(g.tiles.length, effCols);
    const rowW = firstRowCols * (tileW + TILE_GAP) - TILE_GAP;
    const startX = Math.round((CANVAS_W - rowW) / 2);
    const badgeCy = y + GROUP_LABEL_H / 2 - 5;
    svgParts.push(
      `<circle cx="${startX + 16}" cy="${badgeCy}" r="16" fill="${COLORS.badge}"/>`,
      `<text x="${startX + 16}" y="${badgeCy + 6}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="18" fill="${COLORS.background}">${gi + 1}</text>`,
      `<text x="${startX + 44}" y="${badgeCy + 8}" font-family="sans-serif" font-weight="600" font-size="24" fill="${COLORS.text}">${escapeXml(g.label.slice(0, 48))}</text>`
    );
    if (g.rounds > 1) {
      const labelWidthGuess = startX + 44 + Math.min(g.label.length, 48) * 13.5;
      svgParts.push(
        `<text x="${Math.round(labelWidthGuess) + 12}" y="${badgeCy + 8}" font-family="sans-serif" font-weight="600" font-size="21" fill="${COLORS.gold}">${g.rounds}x</text>`
      );
    }
    y += GROUP_LABEL_H;

    for (let mi = 0; mi < g.tiles.length; mi++) {
      const col = mi % effCols;
      const row = Math.floor(mi / effCols);
      const x = startX + col * (tileW + TILE_GAP);
      const ty = y + row * (tileH + TILE_GAP);
      const tile = g.tiles[mi];
      const buf = buffers[tileIdx++];

      if (tile.extraCount) {
        svgParts.push(
          `<rect x="${x}" y="${ty}" width="${tileW}" height="${tileH}" rx="12" fill="${COLORS.surface}"/>`,
          `<text x="${x + tileW / 2}" y="${ty + tileH / 2 + 12}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="${Math.min(40, Math.round(tileH / 4))}" fill="${COLORS.muted}">+${tile.extraCount}</text>`
        );
        continue;
      }

      let drewImage = false;
      if (buf) {
        try {
          const resized = await sharp(buf)
            .resize(tileW, tileH, { fit: 'cover' })
            .jpeg({ quality: 82 })
            .toBuffer();
          composites.push({ input: resized, top: ty, left: x });
          drewImage = true;
        } catch { /* fall through to placeholder */ }
      }
      if (!drewImage) {
        svgParts.push(`<rect x="${x}" y="${ty}" width="${tileW}" height="${tileH}" rx="12" fill="${COLORS.surface}"/>`);
      }

      if (tile.roundsLabel) {
        const pillW = 24 + tile.roundsLabel.length * 13;
        const pillH = 32;
        const px = x + 10;
        const py = ty + tileH - pillH - 10;
        svgParts.push(
          `<rect x="${px}" y="${py}" width="${pillW}" height="${pillH}" rx="8" fill="#0F1117" fill-opacity="0.78"/>`,
          `<text x="${px + pillW / 2}" y="${py + 22}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="19" fill="${COLORS.gold}">${escapeXml(tile.roundsLabel)}</text>`
        );
      }
    }
    y += rowsPerGroup[gi] * (tileH + TILE_GAP);
  }

  const svgOverlay = Buffer.from(
    `<svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">${svgParts.join('')}</svg>`
  );

  return sharp({
    create: { width: CANVAS_W, height: CANVAS_H, channels: 3, background: COLORS.background },
  })
    .composite([...composites, { input: svgOverlay, top: 0, left: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer();
}

/**
 * Generates the OG image for a share token, uploads it to Storage, and stores
 * ogImageUrl on the shareTokens doc. Returns the public URL, or null if the
 * workout has nothing to render. Throws on hard failures — callers must treat
 * this as best-effort (a share link without an OG image still works).
 */
export async function generateWorkoutOgImage(
  shareId: string,
  workout: Record<string, any>,
): Promise<string | null> {
  const jpeg = await composeWorkoutOgImage(workout);
  const bucket = admin.storage().bucket();
  // "-v2" versions the object name so crawler caches (Slack/iMessage) bust
  // cleanly when the composer layout changes.
  const storagePath = `og-images/${shareId}-v2.jpg`;
  const file = bucket.file(storagePath);
  await file.save(jpeg, {
    metadata: { contentType: 'image/jpeg', cacheControl: 'public, max-age=86400' },
  });
  // The bucket has Uniform Bucket-Level Access — makePublic() throws. Public
  // read is granted via storage.rules (og-images match block); the Firebase
  // download URL respects rules and needs no object ACLs.
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media`;
  await admin.firestore().collection('shareTokens').doc(shareId).update({ ogImageUrl: url });
  return url;
}
