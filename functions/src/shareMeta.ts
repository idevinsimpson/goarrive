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

import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { collectOgGroups, generateWorkoutOgImage } from './ogImage';

const BOT_UA_RE = /facebookexternalhit|twitterbot|slackbot|slack-imgproxy|linkedinbot|discordbot|whatsapp|telegrambot|applebot|pinterest|redditbot|skypeuripreview|embedly|iframely|vkshare|snapchat|googlebot|bingbot|yandex|baiduspider|duckduckbot|quora link preview|facebookcatalog|imessagebot|bot\b/i;

const SHARE_ID_RE = /^[a-f0-9]{32}$/;

// In-memory cache of the static app shell served to human browsers.
let shellCache: { html: string; fetchedAt: number } | null = null;
const SHELL_TTL_MS = 5 * 60 * 1000;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function metaHtml(opts: { title: string; description: string; imageUrl?: string | null; videoUrl?: string | null; url: string }): string {
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

async function fetchShell(host: string): Promise<string | null> {
  // /share-shell is an exact-path hosting rewrite to the static
  // /share/[shareId].html file, so it bypasses the /share/** function rewrite.
  const now = Date.now();
  if (shellCache && now - shellCache.fetchedAt < SHELL_TTL_MS) return shellCache.html;
  try {
    const resp = await fetch(`https://${host}/share-shell`);
    if (resp.ok) {
      const html = await resp.text();
      shellCache = { html, fetchedAt: now };
      return html;
    }
  } catch (err) {
    console.warn('[shareMeta] shell fetch failed:', err);
  }
  // Stale-on-error: a stale shell beats a broken share page.
  return shellCache?.html ?? null;
}

export const shareMeta = onRequest(
  { region: 'us-central1', memory: '512MiB', timeoutSeconds: 30, invoker: 'public' },
  async (req, res) => {
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
      } else {
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
      const tokenData = tokenSnap.exists ? tokenSnap.data()! : null;
      const expiresAt = tokenData?.expiresAt as admin.firestore.Timestamp | null | undefined;
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
      const workout = workoutSnap.data()!;

      let coachName: string = tokenData.coachName || '';
      if (!coachName) {
        const coachSnap = await db.collection('coaches').doc(tokenData.createdBy).get();
        const coachData = coachSnap.exists ? coachSnap.data()! : {};
        coachName = coachData.displayName || coachData.name || 'a GoArrive coach';
      }

      const { movementCount } = collectOgGroups(workout);
      const description = `Workout by ${coachName}${movementCount > 0 ? ` · ${movementCount} movement${movementCount === 1 ? '' : 's'}` : ''}`;

      let ogImageUrl: string | null = tokenData.ogImageUrl || null;
      if (!ogImageUrl) {
        // Lazy backfill for tokens minted before OG images existed.
        try {
          ogImageUrl = await generateWorkoutOgImage(shareId, workout);
        } catch (err) {
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
    } catch (err) {
      console.error('[shareMeta] error building crawler meta:', err);
      res.status(200).type('html').send(genericHtml);
    }
  },
);
