#!/usr/bin/env node
/**
 * generate_sw.js — Generate a service worker for GoArrive PWA
 *
 * Scans the dist/ directory and creates a service-worker.js that
 * pre-caches static assets for offline support.
 *
 * Compatible with Safari, Chrome, Firefox, and Edge.
 * Run after `expo export --platform web` and before `firebase deploy`.
 */
const fs = require('fs');
const path = require('path');

const DIST_DIR = path.join(__dirname, '..', 'apps', 'goarrive', 'dist');
const SW_PATH = path.join(DIST_DIR, 'service-worker.js');
const CACHE_NAME = 'goarrive-v1-' + Date.now();

// Recursively list all files in a directory
function listFiles(dir, base = '') {
  const entries = [];
  if (!fs.existsSync(dir)) return entries;
  for (const item of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, item);
    const relPath = base ? `${base}/${item}` : item;
    if (fs.statSync(fullPath).isDirectory()) {
      entries.push(...listFiles(fullPath, relPath));
    } else {
      entries.push('/' + relPath);
    }
  }
  return entries;
}

function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.log('[generate_sw] dist/ not found — skipping SW generation');
    return;
  }

  const files = listFiles(DIST_DIR).filter(
    (f) => !f.endsWith('service-worker.js') && !f.includes('.map')
  );

  const sw = `/**
 * GoArrive Service Worker — auto-generated
 * 
 * Provides offline support and asset caching for the PWA.
 * Compatible with Safari, Chrome, Firefox, and Edge.
 */

const CACHE_NAME = '${CACHE_NAME}';
const PRE_CACHE = ${JSON.stringify(files, null, 2)};

// Install event: cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      // Try to cache all files, but don't fail if some are missing
      return Promise.all(
        PRE_CACHE.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Failed to cache', url, err);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    )
  );
  self.clients.claim();
});

// Fetch event: serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }

  // Skip Firebase and external API requests (always fetch from network)
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('google.com')
  ) {
    return;
  }

  // For HTML pages and JS bundles, use network-first strategy
  // JS bundles must be network-first because Metro/Expo can reuse filenames
  // across builds, and cache-first would serve stale code indefinitely.
  const isHtml = request.headers.get('accept')?.includes('text/html');
  const isJsBundle = url.pathname.endsWith('.js');
  if (isHtml || isJsBundle) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            if (cached) {
              console.log('[SW] Serving from cache:', request.url);
              return cached;
            }
            if (isHtml) return caches.match('/index.html');
            return undefined;
          });
        })
    );
    return;
  }

  // For other assets (images, fonts, CSS), use cache-first strategy
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch((err) => {
          console.warn('[SW] Fetch failed for:', request.url, err);
        });
    })
  );
});

// Handle messages from the app
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

console.log('[SW] Service worker loaded');
`;

  fs.writeFileSync(SW_PATH, sw);
  console.log(`[generate_sw] Created service-worker.js with ${files.length} pre-cached files`);
}

main();
