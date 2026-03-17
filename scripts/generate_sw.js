#!/usr/bin/env node
/**
 * generate_sw.js — Generate a service worker for GoArrive PWA
 *
 * Scans the dist/ directory and creates a service-worker.js that
 * pre-caches all static assets for offline support.
 *
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

  const sw = `
// GoArrive Service Worker — auto-generated
const CACHE_NAME = '${CACHE_NAME}';
const PRE_CACHE = ${JSON.stringify(files, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRE_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    }).catch(() => caches.match('/index.html'))
  );
});
`.trim();

  fs.writeFileSync(SW_PATH, sw);
  console.log(`[generate_sw] Created service-worker.js with ${files.length} pre-cached files`);
}

main();
