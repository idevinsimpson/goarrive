"use strict";
// ─── Workout share-link OG video ─────────────────────────────────────────────
// Generates a 5-second looping mp4 preview: uses the v4 static OG image as the
// background (logo, group labels, badges all preserved) and overlays animated
// movement clips at the exact tile positions. The result looks like the static
// preview but with animated tiles where the still thumbnails were.
// Uploaded to og-images/{shareId}-v1.mp4, URL written to shareTokens/{shareId}.
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
exports.generateWorkoutOgVideo = generateWorkoutOgVideo;
const admin = __importStar(require("firebase-admin"));
const fs = __importStar(require("fs"));
const https = __importStar(require("https"));
const http = __importStar(require("http"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const ogImage_1 = require("./ogImage");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const sharp = require('sharp');
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegBin = require('ffmpeg-static');
// Canvas constants must match ogImage.ts exactly.
const CANVAS_W = 1200;
const CANVAS_H = 2000;
const MARGIN_X = 60;
const CONTENT_W = CANVAS_W - MARGIN_X * 2;
const GRID_TOP = 300;
const GRID_BOTTOM = CANVAS_H - 60;
const TILE_GAP = 16;
const GROUP_LABEL_H = 140;
const TILE_H_PER_W = 1.25;
const MAX_TILE_H = 700;
const CLIP_DURATION = 5;
const MAX_TILES = 16;
const PLAY_BTN_R = 160;
const PLAY_BTN_OPACITY = 0.45; // slightly more transparent than the static image (was 0.6)
const SPECIAL_BLOCK_TYPES = new Set([
    'Intro', 'Outro', 'Demo', 'Transition', 'Water Break', 'Grab Equipment', 'Follow-Along Video',
]);
function computeLayout(groups) {
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
    const { cols, tileW, tileH, rowsPerGroup } = best;
    const totalRows = rowsPerGroup.reduce((a, b) => a + b, 0);
    const gridW = cols * (tileW + TILE_GAP) - TILE_GAP;
    const startX = Math.max(MARGIN_X, Math.round((CANVAS_W - gridW) / 2));
    const usedH = groups.length * GROUP_LABEL_H + totalRows * TILE_GAP + totalRows * tileH;
    let gridTop = GRID_TOP + Math.max(0, Math.floor((availH - usedH) / 2));
    const tilePositions = [];
    for (let gi = 0; gi < groups.length; gi++) {
        gridTop += GROUP_LABEL_H; // skip badge/label row
        const tiles = groups[gi].tiles;
        for (let ti = 0; ti < tiles.length; ti++) {
            const col = ti % cols;
            const row = Math.floor(ti / cols);
            tilePositions.push({
                x: startX + col * (tileW + TILE_GAP),
                y: gridTop + row * (tileH + TILE_GAP),
                w: tileW,
                h: tileH,
            });
        }
        gridTop += rowsPerGroup[gi] * (tileH + TILE_GAP);
    }
    return { cols, tileW, tileH, rowsPerGroup, tilePositions };
}
function download(url, dest) {
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
        }).on('error', (e) => { try {
            fs.unlinkSync(dest);
        }
        catch ( /* ok */_a) { /* ok */ } reject(e); });
    });
}
async function fetchTile(mv, idx, tmpDir) {
    const videoUrl = (mv === null || mv === void 0 ? void 0 : mv.videoUrl) || null;
    const gifUrl = (mv === null || mv === void 0 ? void 0 : mv.gifUrl) || null;
    const imgUrl = (mv === null || mv === void 0 ? void 0 : mv.thumbnailUrl) || (mv === null || mv === void 0 ? void 0 : mv.posterUrl) || null;
    if (videoUrl) {
        const dest = path.join(tmpDir, `t${idx}.mp4`);
        try {
            await download(videoUrl, dest);
            return { filePath: dest, type: 'video' };
        }
        catch ( /* fall */_a) { /* fall */ }
    }
    if (gifUrl) {
        const dest = path.join(tmpDir, `t${idx}.gif`);
        try {
            await download(gifUrl, dest);
            return { filePath: dest, type: 'gif' };
        }
        catch ( /* fall */_b) { /* fall */ }
    }
    if (imgUrl) {
        const ext = (imgUrl.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
        const dest = path.join(tmpDir, `t${idx}.${ext}`);
        try {
            await download(imgUrl, dest);
            return { filePath: dest, type: ext === 'gif' ? 'gif' : 'image' };
        }
        catch ( /* skip */_c) { /* skip */ }
    }
    return null;
}
async function generateWorkoutOgVideo(shareId, workout) {
    var _a;
    const { groups } = (0, ogImage_1.collectOgGroups)(workout);
    if (groups.length === 0)
        return null;
    // Re-walk blocks to collect raw movement objects (need videoUrl/gifUrl/thumbnailUrl)
    const blocks = Array.isArray(workout.blocks) ? workout.blocks : [];
    const rawMovements = [];
    for (const block of blocks) {
        if (SPECIAL_BLOCK_TYPES.has((block === null || block === void 0 ? void 0 : block.type) || ''))
            continue;
        const mvs = (Array.isArray(block.movements) ? block.movements : [])
            .filter((mv) => mv && mv.showOnPreview !== false);
        rawMovements.push(...mvs);
    }
    const tileMvs = rawMovements.slice(0, MAX_TILES);
    if (tileMvs.length === 0)
        return null;
    // Get the layout — tile positions match the v4 static image exactly.
    const layout = computeLayout(groups);
    const positions = layout.tilePositions.slice(0, tileMvs.length);
    // Fetch the v4 static image to use as background.
    const db = admin.firestore();
    const tokenSnap = await db.collection('shareTokens').doc(shareId).get();
    const bgUrl = tokenSnap.exists ? ((_a = tokenSnap.data()) === null || _a === void 0 ? void 0 : _a.ogImageUrl) || null : null;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `ogv-${shareId.slice(0, 8)}-`));
    try {
        // Download background image
        let bgPath = null;
        if (bgUrl) {
            const dest = path.join(tmpDir, 'bg.jpg');
            try {
                await download(bgUrl, dest);
                bgPath = dest;
            }
            catch ( /* no bg, use dark fill */_b) { /* no bg, use dark fill */ }
        }
        // Download movement tile inputs
        const tiles = (await Promise.all(tileMvs.map((mv, i) => fetchTile(mv, i, tmpDir))))
            .filter((t) => t !== null)
            .slice(0, positions.length);
        if (tiles.length === 0)
            return null;
        // Generate play button PNG (transparent RGBA, centered overlay)
        const pbDiam = PLAY_BTN_R * 2 + 4;
        const pcx = PLAY_BTN_R + 2;
        const pcy = PLAY_BTN_R + 2;
        const playSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pbDiam}" height="${pbDiam}">` +
            `<g opacity="${PLAY_BTN_OPACITY}">` +
            `<circle cx="${pcx}" cy="${pcy}" r="${PLAY_BTN_R}" fill="#FFFFFF"/>` +
            `<path d="M ${pcx - 44} ${pcy - 84} L ${pcx + 100} ${pcy} L ${pcx - 44} ${pcy + 84} Z" fill="#0F1117"/>` +
            `</g></svg>`;
        const playBtnPath = path.join(tmpDir, 'playbtn.png');
        await sharp(Buffer.from(playSvg)).png().toFile(playBtnPath);
        // Build ffmpeg args
        const args = ['-y'];
        // Input 0: background (static image looped for CLIP_DURATION)
        if (bgPath) {
            args.push('-loop', '1', '-framerate', '24', '-t', String(CLIP_DURATION), '-i', bgPath);
        }
        else {
            // No background image — generate a plain dark canvas
            args.push('-f', 'lavfi', '-i', `color=c=0x0F1117:s=${CANVAS_W}x${CANVAS_H}:r=24:d=${CLIP_DURATION}`);
        }
        // Inputs 1..N: movement clips
        for (const tile of tiles) {
            if (tile.type === 'image') {
                args.push('-loop', '1', '-framerate', '24', '-t', String(CLIP_DURATION), '-i', tile.filePath);
            }
            else if (tile.type === 'gif') {
                args.push('-stream_loop', '-1', '-t', String(CLIP_DURATION), '-i', tile.filePath);
            }
            else {
                args.push('-ss', '0', '-t', String(CLIP_DURATION), '-i', tile.filePath);
            }
        }
        // Input N+1: play button PNG (static, looped)
        args.push('-loop', '1', '-framerate', '24', '-t', String(CLIP_DURATION), '-i', playBtnPath);
        // Build filter_complex:
        // - Scale background to CANVAS_W x CANVAS_H
        // - Convert each tile to yuv420p and scale to exact tile dims
        // - Chain overlays at computed positions
        const filterParts = [];
        // Scale background to canvas; force yuv420p (GIF inputs are bgra)
        filterParts.push(`[0:v]format=yuv420p,scale=${CANVAS_W}:${CANVAS_H},setpts=PTS-STARTPTS,fps=24[bg0]`);
        // Chain overlays: bg0 → overlay tile 1 → overlay tile 2 → ...
        for (let i = 0; i < tiles.length; i++) {
            const pos = positions[i];
            const scaleLabel = `[s${i}]`;
            // format=yuv420p first — GIFs are bgra; scale to exact tile dims
            filterParts.push(`[${i + 1}:v]format=yuv420p,scale=${pos.w}:${pos.h},setpts=PTS-STARTPTS,fps=24${scaleLabel}`);
            const prevLabel = i === 0 ? '[bg0]' : `[v${i - 1}]`;
            filterParts.push(`${prevLabel}${scaleLabel}overlay=${pos.x}:${pos.y}:shortest=1[v${i}]`);
        }
        // Play button: keep RGBA so alpha blends correctly over tile composites
        const pbInput = tiles.length + 1;
        const preFinalLabel = tiles.length > 0 ? `[v${tiles.length - 1}]` : '[bg0]';
        filterParts.push(`[${pbInput}:v]format=rgba[pb]`);
        filterParts.push(`${preFinalLabel}[pb]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:format=auto[vfinal]`);
        const finalLabel = '[vfinal]';
        const outPath = path.join(tmpDir, 'out.mp4');
        args.push('-filter_complex', filterParts.join(';'), '-map', finalLabel, '-t', String(CLIP_DURATION), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', outPath);
        await execFileAsync(ffmpegBin, args, { timeout: 300000 });
        // Upload to Storage
        const bucket = admin.storage().bucket();
        const storageDest = `og-images/${shareId}-v1.mp4`;
        await bucket.upload(outPath, {
            destination: storageDest,
            metadata: { contentType: 'video/mp4', cacheControl: 'public, max-age=31536000' },
        });
        const [url] = await bucket.file(storageDest).getSignedUrl({ action: 'read', expires: '2035-01-01' });
        await db.collection('shareTokens').doc(shareId).update({ ogVideoUrl: url });
        return url;
    }
    finally {
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
        catch ( /* best-effort */_c) { /* best-effort */ }
    }
}
//# sourceMappingURL=ogVideo.js.map