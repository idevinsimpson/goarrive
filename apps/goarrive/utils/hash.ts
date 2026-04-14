/**
 * Simple deterministic hash for cache keys.
 * Same text always produces the same hex string.
 */
export function createHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + c;
    hash |= 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
