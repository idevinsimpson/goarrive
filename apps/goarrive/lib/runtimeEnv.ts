/**
 * runtimeEnv — Detect non-production runtime contexts for diagnostic-only UI.
 *
 * Staging and production share the same Firebase project (goarrive), so we
 * gate dev-only UI on hostname instead of project ID. The staging channel
 * URL pattern is `goarrive--<channel>-<hash>.web.app`. Localhost / __DEV__
 * also count so the panel is visible during local development.
 */
export function isStagingHost(): boolean {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return true;
  if (typeof window === 'undefined') return false;
  const host = window.location?.hostname || '';
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  // Firebase Hosting preview channels: goarrive--<channel>-<hash>.web.app
  if (host.includes('--')) return true;
  if (host.includes('staging')) return true;
  return false;
}
