#!/usr/bin/env python3
"""
inject_pwa_meta.py — Post-build PWA enhancements for GoArrive

Injects into dist/index.html:
  1. PWA meta tags (viewport, theme-color, apple-mobile-web-app-capable)
  2. Web app manifest link
  3. Google Fonts preconnect + stylesheet links (Space Grotesk, DM Sans)
  4. CSS overrides for fixed header/tab-bar positioning on web
  5. Service worker registration script

Run after `expo export --platform web` and before `firebase deploy`.
"""
import os
import sys

DIST_DIR = os.path.join(
    os.path.dirname(__file__), '..', 'apps', 'goarrive', 'dist'
)
INDEX = os.path.join(DIST_DIR, 'index.html')

# ── Manifest ─────────────────────────────────────────────────────────────────
MANIFEST = """{
  "name": "GoArrive",
  "short_name": "GoArrive",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0E1117",
  "theme_color": "#0E1117",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}"""

# ── Head injection ───────────────────────────────────────────────────────────
HEAD_INJECT = """
    <!-- PWA Meta -->
    <meta name="theme-color" content="#0E1117" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
    <link rel="manifest" href="/manifest.json" />

    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

    <!-- PWA CSS overrides -->
    <style>
      html, body, #root { height: 100%; overflow: hidden; background: #0E1117; }
      body { margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
      /* Prevent pull-to-refresh on mobile Chrome */
      body { overscroll-behavior-y: contain; }
      /* Fix tab bar label clipping: Expo renders label containers with overflow:hidden
         and a fixed height that doesn't account for the full tab item height.
         Force the label containers to be visible. */
      /* The tab bar outer container (position:fixed, bottom:0) */
      /* Force all children of the tab bar to not clip labels */
      [role="tablist"] > div > a > div:last-child,
      [role="tablist"] > div > div > a > div:last-child {
        overflow: visible !important;
        height: auto !important;
        min-height: 16px !important;
      }
      /* Ensure tab items have enough height for icon + label */
      [role="tablist"] > div > a,
      [role="tablist"] > div > div > a {
        height: 52px !important;
        min-height: 52px !important;
        padding-bottom: 6px !important;
        padding-top: 6px !important;
        overflow: visible !important;
      }
    </style>
"""

# ── Body injection (service worker registration) ────────────────────────────
BODY_INJECT = """
    <script>
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function() {
          navigator.serviceWorker.register('/service-worker.js')
            .then(function(reg) { console.log('[SW] registered', reg.scope); })
            .catch(function(err) { console.warn('[SW] registration failed', err); });
        });
      }
    </script>
"""


def main():
    if not os.path.isfile(INDEX):
        print(f'[inject_pwa_meta] index.html not found at {INDEX}')
        sys.exit(1)

    with open(INDEX, 'r') as f:
        html = f.read()

    # Inject into <head>
    html = html.replace('</head>', HEAD_INJECT + '\n  </head>', 1)

    # Inject before </body>
    html = html.replace('</body>', BODY_INJECT + '\n  </body>', 1)

    with open(INDEX, 'w') as f:
        f.write(html)

    # Write manifest.json
    manifest_path = os.path.join(DIST_DIR, 'manifest.json')
    with open(manifest_path, 'w') as f:
        f.write(MANIFEST)

    print('[inject_pwa_meta] Done — injected PWA meta, fonts, and SW registration.')


if __name__ == '__main__':
    main()
