"""
inject_pwa_meta.py — Post-build PWA enhancements for GoArrive

Injects into dist/index.html:
  1. PWA meta tags (viewport, theme-color, apple-mobile-web-app-capable)
  2. Web app manifest link
  3. Google Fonts preconnect + stylesheet links (Space Grotesk, DM Sans)
  4. CSS overrides for fixed header/tab-bar positioning on web
  5. Safari-specific fixes and error handling
  6. Modal scroll fixes for iOS Safari PWA

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
    <!-- PWA Meta Tags -->
    <meta name="theme-color" content="#0E1117" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="GoArrive" />
    <!-- Safari-specific viewport: ensure proper scaling and safe area handling -->
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, shrink-to-fit=no" />
    <link rel="manifest" href="/manifest.json" />
    <link rel="icon" type="image/png" href="/icon-192.png" />
    <link rel="apple-touch-icon" href="/icon-192.png" />

    <!-- Google Fonts -->
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />

    <!-- PWA CSS overrides -->
    <style>
      /* ═══════════════════════════════════════════════════════════════════
         1. BASE LAYOUT — Safari fix: ensure body and html take full viewport
         ═══════════════════════════════════════════════════════════════════ */
      html, body { 
        width: 100%; 
        height: 100%; 
        margin: 0; 
        padding: 0; 
        overflow: hidden; 
        background: #0E1117;
        -webkit-user-select: none;
        user-select: none;
      }
      
      #root { 
        width: 100%; 
        height: 100%; 
        display: flex;
        flex-direction: column;
        min-height: 100% !important;
        min-width: 100% !important;
      }
      
      /* Safari fix: override Expo's problematic min-height: 0px on flex containers */
      #root > div {
        min-height: auto !important;
        min-width: auto !important;
      }
      
      .css-175oi2r {
        min-height: auto !important;
        min-width: auto !important;
      }
      
      body { 
        -webkit-tap-highlight-color: transparent; 
        /* Prevent pull-to-refresh on mobile Chrome */
        overscroll-behavior-y: contain;
        /* Safari: prevent zooming on input focus */
        font-size: 16px;
      }

      /* ═══════════════════════════════════════════════════════════════════
         2. TAB SCREEN SCROLL FIX
         Expo tab navigator renders each screen in a position:absolute
         full-viewport container (r-1p0dtai r-1d2f490 r-u8s1d r-zchlnj r-ipm5af).
         Inside it, React Native Web creates ScrollViews (r-agouwx = overflow-y:auto).
         Without height constraints, they expand to content height and nothing scrolls.
         
         NOTE: Modals do NOT have r-u8s1d, so this rule does NOT affect them.
         ═══════════════════════════════════════════════════════════════════ */

      /* Outer ScrollView: constrain to available height (viewport minus ~53px tab bar) */
      .r-1p0dtai.r-1d2f490.r-u8s1d.r-zchlnj.r-ipm5af .r-agouwx {
        height: calc(100dvh - 53px) !important;
        max-height: calc(100dvh - 53px) !important;
        flex: 0 0 calc(100dvh - 53px) !important;
        overflow-y: auto !important;
        -webkit-overflow-scrolling: touch !important;
      }

      /* Inner ScrollView (direct child of outer): grow to natural content height */
      .r-1p0dtai.r-1d2f490.r-u8s1d.r-zchlnj.r-ipm5af .r-agouwx > .r-agouwx {
        flex: 0 0 auto !important;
        height: auto !important;
        max-height: none !important;
        overflow-y: visible !important;
      }

      /* ═══════════════════════════════════════════════════════════════════
         3. MODAL SCROLL FIX — iOS Safari PWA
         React Native Web modals use [role="dialog"][aria-modal="true"].
         Their ScrollViews need momentum scrolling on iOS Safari.

         IMPORTANT: Do NOT override height/max-height/flex here.
         Those are set by component inline styles (e.g. flex:1 on
         ScrollViews, maxHeight:'80%' on sheets). Overriding them
         with !important breaks scroll containment — the ScrollView
         expands to content height and gets clipped by the parent.
         ═══════════════════════════════════════════════════════════════════ */

      /* Modal ScrollViews: enable iOS momentum scrolling only */
      [role="dialog"] .r-agouwx,
      [aria-modal="true"] .r-agouwx {
        -webkit-overflow-scrolling: touch !important;
      }

      /* Ensure the modal overlay itself supports momentum scrolling */
      [role="dialog"] {
        -webkit-overflow-scrolling: touch !important;
      }

      /* ═══════════════════════════════════════════════════════════════════
         4. TAB BAR FIXES
         ═══════════════════════════════════════════════════════════════════ */
      
      /* Fix tab bar label clipping: Expo renders label containers with overflow:hidden
         and a fixed height that doesn't account for the full tab item height.
         Force the label containers to be visible. */
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

      /* ═══════════════════════════════════════════════════════════════════
         5. SAFE AREA & MISC
         ═══════════════════════════════════════════════════════════════════ */
      
      /* Safari: fix for position:fixed elements with safe-area-inset */
      @supports (padding: max(0px)) {
        body {
          padding-left: max(0px, env(safe-area-inset-left));
          padding-right: max(0px, env(safe-area-inset-right));
          padding-top: max(0px, env(safe-area-inset-top));
          padding-bottom: max(0px, env(safe-area-inset-bottom));
        }
      }
      
      /* Fallback message for when JS fails to load */
      #app-error {
        display: none;
        width: 100%;
        height: 100%;
        background: #0E1117;
        color: #FFFFFF;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 16px;
        padding: 20px;
        box-sizing: border-box;
        overflow: auto;
        align-items: center;
        justify-content: center;
        flex-direction: column;
        text-align: center;
      }
      
      #app-error.visible {
        display: flex;
      }
    </style>
"""

# ── Body injection (error handlers, fallback message) ────────────────────────
BODY_INJECT = """
    <!-- Fallback error message if JS fails to load -->
    <div id="app-error">
      <div style="max-width: 300px;">
        <h2>Unable to Load App</h2>
        <p>The app failed to load. Please try:</p>
        <ul style="text-align: left;">
          <li>Refreshing the page</li>
          <li>Clearing Safari cache (Settings > Safari > Clear History and Website Data)</li>
          <li>Checking your internet connection</li>
        </ul>
        <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #F5A623; color: #000; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">
          Try Again
        </button>
      </div>
    </div>

    <script>
      // Set a timeout to show error message if app doesn't load
      var appLoadTimeout = setTimeout(function() {
        var errorDiv = document.getElementById('app-error');
        if (errorDiv && !document.querySelector('[role="application"]')) {
          errorDiv.classList.add('visible');
          console.error('[App] Failed to load within 10 seconds');
        }
      }, 10000);
      
      // Global error handlers to catch any JS errors
      window.addEventListener('error', function(event) {
        console.error('[Global Error]', event.error);
        clearTimeout(appLoadTimeout);
        var errorDiv = document.getElementById('app-error');
        if (errorDiv) {
          errorDiv.classList.add('visible');
          errorDiv.innerHTML = '<div style="max-width: 300px;"><h2>App Error</h2><p>' + (event.error?.message || 'An error occurred') + '</p><button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #F5A623; color: #000; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">Reload</button></div>';
        }
      });
      
      window.addEventListener('unhandledrejection', function(event) {
        console.error('[Unhandled Promise Rejection]', event.reason);
      });
      
      // Clear error timeout when app successfully loads
      document.addEventListener('DOMContentLoaded', function() {
        clearTimeout(appLoadTimeout);
      });
      
      // Service Worker registration - DISABLED for Safari compatibility
      console.log('[SW] Service Worker registration disabled for Safari compatibility');
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

    print('[inject_pwa_meta] Done — injected PWA meta, fonts, Safari fixes, modal scroll fixes, and error handling.')


if __name__ == '__main__':
    main()
