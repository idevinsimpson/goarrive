/**
 * In-app-browser detection. iOS's Instagram / Facebook / TikTok WebViews are
 * non-persistent — Firebase's IndexedDB persistence writes there but is wiped
 * the next time the app is opened. From the member's point of view they were
 * "signed out again," and there is nothing the client can do to fix it
 * without leaving the WebView. The banner just tells them how.
 *
 * Called at render time on every route so the dismissal state has to survive
 * client-side navigation but reset on the next tab open — sessionStorage, not
 * localStorage. `sessionStorage` also happens to be per-WebView-session in
 * Instagram's shell, which is fine: leaving and coming back is exactly when
 * we want the banner again.
 */

// Common in-app WebView user-agent tokens. Instagram / Facebook cover the
// phone-test finding; TikTok / Snapchat / Twitter / Line / Messenger are
// added because they exhibit the same non-persistent behaviour.
const IN_APP_UA_PATTERN = /Instagram|FBAN|FBAV|FB_IAB|Messenger|Line\/|TikTok|Snapchat|Twitter/i;

export function isInAppBrowser(userAgent?: string): boolean {
  if (typeof userAgent === 'string') {
    return IN_APP_UA_PATTERN.test(userAgent);
  }
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent ?? '';
  return IN_APP_UA_PATTERN.test(ua);
}

const DISMISS_KEY = 'wsf.inAppBanner.dismissed';

export function isInAppBannerDismissed(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.sessionStorage?.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

export function dismissInAppBanner(): void {
  try {
    if (typeof window === 'undefined') return;
    window.sessionStorage?.setItem(DISMISS_KEY, '1');
  } catch {
    // Private-browsing / storage denied — banner will just show next render.
  }
}
