/**
 * GoArrive Service Worker
 *
 * Provides offline support and asset caching for the PWA.
 * Compatible with Safari, Chrome, Firefox, and Edge.
 *
 * Also handles FCM background push notifications so members receive
 * native browser notifications when their coach shares or updates their plan,
 * even when the app tab is not open.
 */

const CACHE_VERSION = '20260323-160000';
const CACHE_NAME = `goarrive-${CACHE_VERSION}`;
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
];

// Install event: cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  self.skipWaiting(); // Activate immediately on deploy
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Failed to cache some assets:', err);
      });
    })
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
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

  // For HTML pages, use network-first strategy (try network, fallback to cache)
  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful responses
          if (response.ok) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache if network fails
          return caches.match(request).then((cached) => {
            if (cached) {
              console.log('[SW] Serving from cache:', request.url);
              return cached;
            }
            // Return a basic offline page if available
            return caches.match('/index.html');
          });
        })
    );
    return;
  }

  // For other assets (JS, CSS, images), use network-first strategy to ensure fresh deploys
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
          console.warn('[SW] No cache for:', request.url);
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

// ─── FCM Push Notification Handling ─────────────────────────────────────────
// Receives background push messages sent by Firebase Cloud Messaging and
// displays them as native browser notifications when the app tab is not active.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { notification: { title: 'GoArrive', body: event.data.text() } };
  }
  const notif = payload.notification || {};
  const notificationTitle = notif.title || 'GoArrive';
  const notificationOptions = {
    body: notif.body || '',
    icon: notif.icon || '/icons/icon-192.png',
    badge: notif.badge || '/icons/icon-192.png',
    // Store the deep-link URL in notification data for the click handler
    data: { link: (payload.webpush && payload.webpush.fcmOptions && payload.webpush.fcmOptions.link) || '/my-plan' },
  };
  event.waitUntil(
    self.registration.showNotification(notificationTitle, notificationOptions)
  );
});

// When a notification is clicked, open the app at the target URL
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.link) || '/my-plan';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a tab is already open at the target URL, focus it
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new tab
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

console.log('[SW] Service worker loaded');
