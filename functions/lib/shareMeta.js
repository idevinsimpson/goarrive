"use strict";
// ─── shareMeta — crawler-aware serving for /share/{shareId} ──────────────────
// Hosting rewrites /share/** here. Link-preview crawlers get a minimal HTML
// document with Open Graph / Twitter meta (title, coach + movement count,
// generated OG image). Human browsers get the exact static app shell that
// hosting used to serve directly (fetched from the /share-shell rewrite and
// cached in memory), so the SPA share page behaves exactly as before.
//
// Teaser philosophy: crawlers only ever see workout name, coach name, and
// movement count — never the full workout. Revoked/expired/restricted tokens
// get generic meta with no image.
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
exports.shareMeta = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const ogImage_1 = require("./ogImage");
const BOT_UA_RE = /facebookexternalhit|twitterbot|slackbot|slack-imgproxy|linkedinbot|discordbot|whatsapp|telegrambot|applebot|pinterest|redditbot|skypeuripreview|embedly|iframely|vkshare|snapchat|googlebot|bingbot|yandex|baiduspider|duckduckbot|quora link preview|facebookcatalog|imessagebot|bot\b/i;
const SHARE_ID_RE = /^[a-f0-9]{32}$/;
// In-memory cache of the static app shell served to human browsers.
let shellCache = null;
const SHELL_TTL_MS = 5 * 60 * 1000;
function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function metaHtml(opts) {
    const title = escapeHtml(opts.title);
    const description = escapeHtml(opts.description);
    const image = opts.imageUrl
        ? `\n    <meta property="og:image" content="${escapeHtml(opts.imageUrl)}" />\n    <meta property="og:image:width" content="1200" />\n    <meta property="og:image:height" content="2000" />\n    <meta name="twitter:image" content="${escapeHtml(opts.imageUrl)}" />`
        : '';
    const video = opts.videoUrl
        ? `\n    <meta property="og:video" content="${escapeHtml(opts.videoUrl)}" />\n    <meta property="og:video:secure_url" content="${escapeHtml(opts.videoUrl)}" />\n    <meta property="og:video:type" content="video/mp4" />\n    <meta property="og:video:width" content="1080" />\n    <meta property="og:video:height" content="1350" />`
        : '';
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="GoArrive" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${escapeHtml(opts.url)}" />
    <meta name="twitter:card" content="${opts.imageUrl ? 'summary_large_image' : 'summary'}" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />${image}${video}
  </head>
  <body></body>
</html>`;
}
async function fetchShell(host) {
    var _a;
    // /share-shell is an exact-path hosting rewrite to the static
    // /share/[shareId].html file, so it bypasses the /share/** function rewrite.
    const now = Date.now();
    if (shellCache && now - shellCache.fetchedAt < SHELL_TTL_MS)
        return shellCache.html;
    try {
        const resp = await fetch(`https://${host}/share-shell`);
        if (resp.ok) {
            const html = await resp.text();
            shellCache = { html, fetchedAt: now };
            return html;
        }
    }
    catch (err) {
        console.warn('[shareMeta] shell fetch failed:', err);
    }
    // Stale-on-error: a stale shell beats a broken share page.
    return (_a = shellCache === null || shellCache === void 0 ? void 0 : shellCache.html) !== null && _a !== void 0 ? _a : null;
}
exports.shareMeta = (0, https_1.onRequest)({ region: 'us-central1', memory: '512MiB', timeoutSeconds: 30, invoker: 'public' }, async (req, res) => {
    const host = req.get('x-forwarded-host') || req.get('host') || 'goarrive.fit';
    const segments = req.path.split('/').filter(Boolean);
    const shareId = segments[segments.length - 1] || '';
    const pageUrl = `https://${host}/share/${shareId}`;
    const isBot = BOT_UA_RE.test(req.get('user-agent') || '');
    // ── Humans: serve the static app shell unchanged ─────────────────────
    if (!isBot) {
        const shell = await fetchShell(host);
        if (shell) {
            res.status(200).set('Cache-Control', 'public, max-age=0, must-revalidate').type('html').send(shell);
        }
        else {
            // Last resort — should effectively never happen (function fetching
            // its own hosting site). Send the client to the app root.
            res.redirect(302, '/');
        }
        return;
    }
    // ── Crawlers: minimal HTML with OG meta ──────────────────────────────
    res.set('Cache-Control', 'public, max-age=300');
    const genericHtml = metaHtml({
        title: 'GoArrive Workout',
        description: 'A workout shared on GoArrive.',
        url: pageUrl,
    });
    if (!SHARE_ID_RE.test(shareId)) {
        res.status(200).type('html').send(genericHtml);
        return;
    }
    try {
        const db = admin.firestore();
        const tokenSnap = await db.collection('shareTokens').doc(shareId).get();
        const tokenData = tokenSnap.exists ? tokenSnap.data() : null;
        const expiresAt = tokenData === null || tokenData === void 0 ? void 0 : tokenData.expiresAt;
        const invalid = !tokenData
            || !!tokenData.revokedAt
            || (expiresAt ? expiresAt.toMillis() < Date.now() : false)
            || tokenData.visibility === 'restricted';
        if (invalid) {
            res.status(200).type('html').send(genericHtml);
            return;
        }
        const workoutSnap = await db.collection('workouts').doc(tokenData.workoutId).get();
        if (!workoutSnap.exists) {
            res.status(200).type('html').send(genericHtml);
            return;
        }
        const workout = workoutSnap.data();
        let coachName = tokenData.coachName || '';
        if (!coachName) {
            const coachSnap = await db.collection('coaches').doc(tokenData.createdBy).get();
            const coachData = coachSnap.exists ? coachSnap.data() : {};
            coachName = coachData.displayName || coachData.name || 'a GoArrive coach';
        }
        const { movementCount } = (0, ogImage_1.collectOgGroups)(workout);
        const description = `Workout by ${coachName}${movementCount > 0 ? ` · ${movementCount} movement${movementCount === 1 ? '' : 's'}` : ''}`;
        let ogImageUrl = tokenData.ogImageUrl || null;
        if (!ogImageUrl) {
            // Lazy backfill for tokens minted before OG images existed.
            try {
                ogImageUrl = await (0, ogImage_1.generateWorkoutOgImage)(shareId, workout);
            }
            catch (err) {
                console.warn('[shareMeta] lazy OG image generation failed:', err);
            }
        }
        res.status(200).type('html').send(metaHtml({
            title: workout.name || 'Workout',
            description,
            imageUrl: ogImageUrl,
            videoUrl: typeof tokenData.ogVideoUrl === 'string' ? tokenData.ogVideoUrl : null,
            url: pageUrl,
        }));
    }
    catch (err) {
        console.error('[shareMeta] error building crawler meta:', err);
        res.status(200).type('html').send(genericHtml);
    }
});
//# sourceMappingURL=shareMeta.js.map