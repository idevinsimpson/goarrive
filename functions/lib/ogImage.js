"use strict";
// ─── Workout share-link OG images ────────────────────────────────────────────
// Composes a 1290x2796 (iPhone-screen) portrait Open Graph preview image for a
// shared workout, mirroring the WorkoutPlayer "ready" phase: logo top, movement
// thumbnails (4:5 portrait tiles) in segment groups. All blocks between special
// blocks (Water Break etc.) merge into ONE segment group whose label joins the
// block kinds it contains ("Tabata + Superset"); rounds render as per-tile gold
// Nx pills. Column count is chosen per workout to maximize tile size. No title
// text — og:title carries the workout name in the unfurl.
// Uploaded to Storage at og-images/{shareId}-v5.jpg and recorded on the
// shareTokens doc.
//
// Text is rendered via SVG layers composited by sharp (sharp has no native
// text API). Fonts come from the runtime's fontconfig; we request generic
// sans-serif so it degrades gracefully.
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
exports.OG_IMAGE_VERSION = void 0;
exports.collectOgGroups = collectOgGroups;
exports.composeWorkoutOgImage = composeWorkoutOgImage;
exports.generateWorkoutOgImage = generateWorkoutOgImage;
const admin = __importStar(require("firebase-admin"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// Mirrors apps/goarrive/hooks/useWorkoutFlatten.ts SPECIAL_BLOCK_TYPES —
// blocks that carry no movements and are excluded from the preview grid.
// Specials delimit segments: every movement block between two specials
// belongs to the same group.
const SPECIAL_BLOCK_TYPES = new Set([
    'Intro', 'Outro', 'Demo', 'Transition', 'Water Break', 'Grab Equipment', 'Follow-Along Video',
]);
// iPhone screen dimensions (1290x2796) so the image fills the screen edge to
// edge when opened full-screen — no letterboxing.
// Bump when the composer layout changes: versions the Storage object name so
// crawler caches bust, and marks stored ogImageUrl values stale so existing
// share tokens regenerate on next resolve.
exports.OG_IMAGE_VERSION = 'v5';
const CANVAS_W = 1290;
const CANVAS_H = 2796;
const MARGIN_X = 60;
const CONTENT_W = CANVAS_W - MARGIN_X * 2;
const GRID_TOP = 300;
const GRID_BOTTOM = CANVAS_H - 60;
const TILE_GAP = 16;
const GROUP_LABEL_H = 140;
const MAX_TILES = 16;
const MAX_GROUPS = 5;
const MAX_TILE_H = 700;
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
function escapeXml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
function tileImageUrl(mv) {
    if (mv && typeof mv.thumbnailUrl === 'string' && mv.thumbnailUrl)
        return mv.thumbnailUrl;
    if (mv && typeof mv.posterUrl === 'string' && mv.posterUrl)
        return mv.posterUrl;
    return null;
}
/**
 * Extracts preview groups from a workout doc. One group per special-delimited
 * segment: all movement blocks between Water Breaks (etc.) merge into a single
 * group labelled by the unique block kinds it contains, in order —
 * 1 movement = Tabata, 2 = Superset, 3+ = Circuit ("Tabata + Superset").
 * Block rounds survive as per-tile roundsLabel pills.
 */
function collectOgGroups(workout) {
    var _a, _b;
    const blocks = Array.isArray(workout.blocks) ? workout.blocks : [];
    let movementCount = 0;
    const allGroups = [];
    let segKinds = [];
    let segTiles = [];
    const flushSegment = () => {
        if (segTiles.length > 0) {
            const kinds = [];
            for (const k of segKinds)
                if (!kinds.includes(k))
                    kinds.push(k);
            allGroups.push({ label: kinds.join(' + ') || 'Block', tiles: segTiles });
        }
        segKinds = [];
        segTiles = [];
    };
    for (const block of blocks) {
        if (SPECIAL_BLOCK_TYPES.has((block === null || block === void 0 ? void 0 : block.type) || '')) {
            flushSegment();
            continue;
        }
        const movements = (Array.isArray(block.movements) ? block.movements : [])
            .filter((mv) => mv && mv.showOnPreview !== false);
        if (movements.length === 0)
            continue;
        const kind = movements.length === 1 ? 'Tabata' : movements.length === 2 ? 'Superset' : 'Circuit';
        const rounds = Number((_b = (_a = block.rounds) !== null && _a !== void 0 ? _a : block.sets) !== null && _b !== void 0 ? _b : 1) || 1;
        const roundsLabel = rounds > 1 ? `${rounds}x` : undefined;
        movementCount += movements.length;
        segKinds.push(kind);
        for (const mv of movements) {
            segTiles.push({ imageUrl: tileImageUrl(mv), roundsLabel });
        }
    }
    flushSegment();
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
        if (shown >= MAX_TILES)
            last.tiles[last.tiles.length - 1] = { imageUrl: null, extraCount: hidden + 1 };
        else
            last.tiles.push({ imageUrl: null, extraCount: hidden });
    }
    return { groups: groupsShown, movementCount };
}
/**
 * Picks the column count (2–4) that maximizes tile size for this set of
 * groups: fewer columns widen tiles but add rows (height-constrained);
 * more columns shrink width. Evaluates each and keeps the biggest tile.
 */
function pickLayout(groups) {
    const availH = GRID_BOTTOM - GRID_TOP;
    let best = { cols: 3, tileW: 0, tileH: 0, rowsPerGroup: groups.map(() => 0) };
    for (const cols of [2, 3, 4]) {
        const rowsPerGroup = groups.map((g) => Math.ceil(g.tiles.length / cols));
        const totalRows = rowsPerGroup.reduce((a, b) => a + b, 0);
        if (totalRows === 0)
            continue;
        const fixedH = groups.length * GROUP_LABEL_H + totalRows * TILE_GAP;
        const maxTileW = Math.floor((CONTENT_W - (cols - 1) * TILE_GAP) / cols);
        let tileH = Math.min(Math.floor((availH - fixedH) / totalRows), Math.floor(maxTileW * TILE_H_PER_W), MAX_TILE_H);
        tileH = Math.max(120, tileH);
        const tileW = Math.round(tileH / TILE_H_PER_W);
        if (tileW > best.tileW)
            best = { cols, tileW, tileH, rowsPerGroup };
    }
    return best;
}
async function fetchImage(url) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 6000);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!resp.ok)
            return null;
        return Buffer.from(await resp.arrayBuffer());
    }
    catch (_a) {
        return null;
    }
}
function loadLogo() {
    const candidates = [
        path.join(__dirname, '..', 'assets', 'goarrive-logo.png'),
        path.join(__dirname, '..', '..', 'assets', 'goarrive-logo.png'),
    ];
    for (const p of candidates) {
        try {
            if (fs.existsSync(p))
                return fs.readFileSync(p);
        }
        catch ( /* keep trying */_a) { /* keep trying */ }
    }
    return null;
}
/**
 * Composes the 1290x2796 portrait OG JPEG for a workout. Returns the buffer.
 * Throws on composition failure — callers treat OG images as best-effort.
 */
async function composeWorkoutOgImage(workout) {
    // Dynamic require keeps cold starts lean for the many functions in this
    // codebase that never touch sharp (same pattern as onMovementMediaUploaded).
    const sharp = require('sharp');
    const { groups } = collectOgGroups(workout);
    // ── Layout: shared left edge, full-width grid, best-fit column count ─────
    const { cols, tileW, tileH, rowsPerGroup } = pickLayout(groups);
    const totalRows = rowsPerGroup.reduce((a, b) => a + b, 0);
    const availH = GRID_BOTTOM - GRID_TOP;
    const fixedH = groups.length * GROUP_LABEL_H + totalRows * TILE_GAP;
    // Every group starts at the same startX — no per-group indentation.
    const gridW = cols * (tileW + TILE_GAP) - TILE_GAP;
    const startX = Math.max(MARGIN_X, Math.round((CANVAS_W - gridW) / 2));
    // Center the whole grid band vertically when content is short.
    const usedH = fixedH + totalRows * tileH;
    const gridTop = GRID_TOP + Math.max(0, Math.floor((availH - usedH) / 2));
    // ── Fetch thumbnails in parallel ─────────────────────────────────────────
    const allTiles = groups.flatMap((g) => g.tiles);
    const buffers = await Promise.all(allTiles.map((t) => (t.imageUrl && !t.extraCount ? fetchImage(t.imageUrl) : Promise.resolve(null))));
    const composites = [];
    const svgParts = [];
    // ── Logo ─────────────────────────────────────────────────────────────────
    const logoBuf = loadLogo();
    if (logoBuf) {
        const logo = await sharp(logoBuf)
            .resize({ height: 224, width: 1000, fit: 'inside' })
            .png()
            .toBuffer();
        const meta = await sharp(logo).metadata();
        composites.push({
            input: logo,
            top: Math.round((GRID_TOP - (meta.height || 224)) / 2),
            left: Math.round((CANVAS_W - (meta.width || 1000)) / 2),
        });
    }
    else {
        svgParts.push(`<text x="${CANVAS_W / 2}" y="${Math.round(GRID_TOP / 2) + 42}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="120" fill="${COLORS.text}">G<tspan fill="${COLORS.gold}">➲</tspan>A</text>`);
    }
    // ── Groups: badge + label row, then full-width tile grid ─────────────────
    let y = gridTop;
    let tileIdx = 0;
    for (let gi = 0; gi < groups.length; gi++) {
        const g = groups[gi];
        const badgeCy = y + GROUP_LABEL_H / 2 - 8;
        svgParts.push(`<circle cx="${startX + 48}" cy="${badgeCy}" r="48" fill="${COLORS.badge}"/>`, `<text x="${startX + 48}" y="${badgeCy + 19}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="54" fill="${COLORS.background}">${gi + 1}</text>`, `<text x="${startX + 124}" y="${badgeCy + 26}" font-family="sans-serif" font-weight="600" font-size="72" fill="${COLORS.text}">${escapeXml(g.label.slice(0, 26))}</text>`);
        y += GROUP_LABEL_H;
        for (let mi = 0; mi < g.tiles.length; mi++) {
            const col = mi % cols;
            const row = Math.floor(mi / cols);
            const x = startX + col * (tileW + TILE_GAP);
            const ty = y + row * (tileH + TILE_GAP);
            const tile = g.tiles[mi];
            const buf = buffers[tileIdx++];
            if (tile.extraCount) {
                svgParts.push(`<rect x="${x}" y="${ty}" width="${tileW}" height="${tileH}" rx="12" fill="${COLORS.surface}"/>`, `<text x="${x + tileW / 2}" y="${ty + tileH / 2 + 12}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="${Math.min(40, Math.round(tileH / 4))}" fill="${COLORS.muted}">+${tile.extraCount}</text>`);
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
                }
                catch ( /* fall through to placeholder */_a) { /* fall through to placeholder */ }
            }
            if (!drewImage) {
                svgParts.push(`<rect x="${x}" y="${ty}" width="${tileW}" height="${tileH}" rx="12" fill="${COLORS.surface}"/>`);
            }
            if (tile.roundsLabel) {
                const pillW = 24 + tile.roundsLabel.length * 13;
                const pillH = 32;
                const px = x + 10;
                const py = ty + tileH - pillH - 10;
                svgParts.push(`<rect x="${px}" y="${py}" width="${pillW}" height="${pillH}" rx="8" fill="#0F1117" fill-opacity="0.78"/>`, `<text x="${px + pillW / 2}" y="${py + 22}" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="19" fill="${COLORS.gold}">${escapeXml(tile.roundsLabel)}</text>`);
            }
        }
        y += rowsPerGroup[gi] * (tileH + TILE_GAP);
    }
    const svgOverlay = Buffer.from(`<svg width="${CANVAS_W}" height="${CANVAS_H}" xmlns="http://www.w3.org/2000/svg">${svgParts.join('')}</svg>`);
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
async function generateWorkoutOgImage(shareId, workout) {
    const jpeg = await composeWorkoutOgImage(workout);
    const bucket = admin.storage().bucket();
    const storagePath = `og-images/${shareId}-${exports.OG_IMAGE_VERSION}.jpg`;
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
//# sourceMappingURL=ogImage.js.map