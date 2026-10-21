import { configuredPublicOrigin } from '../publicOrigin';

/**
 * W12-13 (INT-08 preparation, ST-01). On a phone the origin is the one this
 * build names in EXPO_PUBLIC_WSF_PUBLIC_ORIGIN (`configuredPublicOrigin`), or
 * null. It never reads `window.location`: a release build has none, and a
 * development build's is the Metro server on the developer's machine, which a
 * QR code or a share link must never name. The web's twin is
 * `currentOrigin.ts`.
 */
export function currentOrigin(): string | null {
  return configuredPublicOrigin();
}
