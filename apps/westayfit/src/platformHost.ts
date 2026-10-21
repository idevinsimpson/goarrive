/**
 * The browser hostname, when there is one.
 *
 * React Native defines `window` (it aliases the global object) but no
 * `window.location`. In a native DEVELOPMENT session @expo/metro-runtime
 * installs a location pointing at the Metro server; in a production-mode
 * native bundle (release build, `expo export`) there is none, and code that
 * read `window.location.hostname` after only a `typeof window` check threw at
 * module load. This returns the hostname only where a location object exists.
 *
 * It does NOT tell web from native — a native dev build has a location too.
 * Decide platform with `Platform.OS`.
 */
export function currentWebHostname(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const location = (window as { location?: { hostname?: unknown } }).location;
  if (!location || typeof location.hostname !== 'string') return undefined;
  return location.hostname;
}
