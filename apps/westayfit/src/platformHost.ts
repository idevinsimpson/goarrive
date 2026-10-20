/**
 * The page hostname, when there is one.
 *
 * React Native defines `window` (it aliases the global object) but has no
 * `window.location`. Code that checked `typeof window !== 'undefined'` and then
 * read `window.location.hostname` therefore threw at module load on a phone,
 * before any screen rendered. Every caller that needs the browser host asks
 * here instead: it returns the hostname only where a real browser location
 * exists, and undefined everywhere else (native, SSR, tests without a DOM).
 */
export function currentWebHostname(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const location = (window as { location?: { hostname?: unknown } }).location;
  if (!location || typeof location.hostname !== 'string') return undefined;
  return location.hostname;
}

/** True when a browser location exists, i.e. this is web, not native or SSR. */
export function hasWebLocation(): boolean {
  return currentWebHostname() !== undefined;
}
