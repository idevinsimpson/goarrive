/**
 * useOfflineVideoCache — Pre-cache movement demo videos for offline playback
 *
 * Uses expo-file-system to download movement videos to the device cache
 * directory before a workout starts. This ensures reliable playback in
 * gym environments with poor connectivity.
 *
 * Features:
 *   - Downloads videos in background when workout is loaded
 *   - Returns cached URI for each video URL
 *   - Skips already-cached files
 *   - Reports download progress
 *   - Handles web platform gracefully (no-op, uses original URLs)
 *
 * Usage:
 *   const { getCachedUri, progress, cacheVideos } = useOfflineVideoCache();
 *   cacheVideos(videoUrls);
 *   const localUri = getCachedUri(remoteUrl);
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { Platform } from 'react-native';

// Lazy import for expo-file-system (not available on web)
let FileSystem: any = null;
if (Platform.OS !== 'web') {
  try {
    FileSystem = require('expo-file-system');
  } catch {
    // expo-file-system not installed
  }
}

interface CacheEntry {
  localUri: string;
  status: 'pending' | 'downloading' | 'cached' | 'error';
  lastAccessed: number;
  sizeBytes: number;
}

// Max cache size: 500MB
const MAX_CACHE_BYTES = 500 * 1024 * 1024;

export function useOfflineVideoCache() {
  const [cache, setCache] = useState<Record<string, CacheEntry>>({});
  const [progress, setProgress] = useState({ total: 0, completed: 0 });
  const [isOffline, setIsOffline] = useState(false);
  const downloadingRef = useRef(false);

  // ── Network detection ─────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS === 'web') {
      // Web: use navigator.onLine
      const update = () => setIsOffline(!navigator.onLine);
      update();
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      return () => {
        window.removeEventListener('online', update);
        window.removeEventListener('offline', update);
      };
    } else {
      // Native: try @react-native-community/netinfo if available
      try {
        const NetInfo = require('@react-native-community/netinfo');
        const unsub = NetInfo.addEventListener((state: any) => {
          setIsOffline(!(state.isConnected ?? true));
        });
        return () => unsub();
      } catch {
        // NetInfo not installed — assume online
        setIsOffline(false);
      }
    }
  }, []);

  /**
   * Generate a deterministic cache filename from a URL
   */
  const getCacheKey = (url: string): string => {
    // Simple hash: use the last segment of the URL path + a hash of the full URL
    const segments = url.split('/');
    const filename = segments[segments.length - 1]?.split('?')[0] || 'video';
    const hash = url.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0);
    return `goarrive_cache_${Math.abs(hash)}_${filename}`;
  };

  /**
   * Get the cached local URI for a remote URL, or return the original URL
   */
  const getCachedUri = useCallback(
    (remoteUrl: string): string => {
      if (!remoteUrl || Platform.OS === 'web' || !FileSystem) return remoteUrl;
      const entry = cache[remoteUrl];
      if (entry?.status === 'cached') {
        // Update last accessed time for LRU tracking
        entry.lastAccessed = Date.now();
        return entry.localUri;
      }
      return remoteUrl; // Fallback to remote URL
    },
    [cache],
  );

  /**
   * Get total cache size in bytes
   */
  const getCacheSize = useCallback((): number => {
    return Object.values(cache).reduce(
      (total, entry) => total + (entry.status === 'cached' ? entry.sizeBytes : 0),
      0,
    );
  }, [cache]);

  /**
   * Evict least-recently-used entries until cache is under the size limit
   */
  const evictLRU = useCallback(async () => {
    if (Platform.OS === 'web' || !FileSystem) return;

    const entries = Object.entries(cache)
      .filter(([, v]) => v.status === 'cached')
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed); // oldest first

    let totalSize = entries.reduce((sum, [, v]) => sum + v.sizeBytes, 0);
    const toRemove: string[] = [];

    for (const [url, entry] of entries) {
      if (totalSize <= MAX_CACHE_BYTES) break;
      try {
        await FileSystem.deleteAsync(entry.localUri, { idempotent: true });
      } catch { /* ignore */ }
      totalSize -= entry.sizeBytes;
      toRemove.push(url);
    }

    if (toRemove.length > 0) {
      setCache((prev) => {
        const next = { ...prev };
        toRemove.forEach((url) => delete next[url]);
        return next;
      });
      console.info(`[useOfflineVideoCache] Evicted ${toRemove.length} LRU entries`);
    }
  }, [cache]);

  /**
   * Pre-cache a list of video URLs
   */
  const cacheVideos = useCallback(
    async (urls: string[]) => {
      if (Platform.OS === 'web' || !FileSystem || downloadingRef.current) return;
      if (!urls || urls.length === 0) return;

      // Skip download attempts when offline
      if (isOffline) {
        console.info('[useOfflineVideoCache] Offline — skipping download, using cached files');
        return;
      }

      // Filter to only valid URLs that aren't already cached
      const toDownload = urls.filter(
        (url) => url && !cache[url]?.localUri,
      );

      if (toDownload.length === 0) return;

      downloadingRef.current = true;
      setProgress({ total: toDownload.length, completed: 0 });

      const cacheDir = FileSystem.cacheDirectory + 'goarrive_videos/';

      // Ensure cache directory exists
      try {
        const dirInfo = await FileSystem.getInfoAsync(cacheDir);
        if (!dirInfo.exists) {
          await FileSystem.makeDirectoryAsync(cacheDir, { intermediates: true });
        }
      } catch {
        // Directory creation failed, continue with remote URLs
        downloadingRef.current = false;
        return;
      }

      let completed = 0;
      const newEntries: Record<string, CacheEntry> = {};

      for (const url of toDownload) {
        const filename = getCacheKey(url);
        const localUri = cacheDir + filename;

        try {
          // Check if already downloaded
          const fileInfo = await FileSystem.getInfoAsync(localUri);
          if (fileInfo.exists && fileInfo.size > 0) {
            newEntries[url] = { localUri, status: 'cached', lastAccessed: Date.now(), sizeBytes: fileInfo.size || 0 };
            completed++;
            setProgress({ total: toDownload.length, completed });
            continue;
          }

          // Download the file
          const result = await FileSystem.downloadAsync(url, localUri);
          if (result.status === 200) {
            // Get file size for cache tracking
            let sizeBytes = 0;
            try {
              const info = await FileSystem.getInfoAsync(result.uri);
              sizeBytes = info.size || 0;
            } catch { /* ignore */ }
            newEntries[url] = { localUri: result.uri, status: 'cached', lastAccessed: Date.now(), sizeBytes };
          } else {
            newEntries[url] = { localUri: url, status: 'error', lastAccessed: Date.now(), sizeBytes: 0 };
          }
        } catch (err) {
          console.warn('[useOfflineVideoCache] Download failed:', url, err);
          newEntries[url] = { localUri: url, status: 'error', lastAccessed: Date.now(), sizeBytes: 0 };
        }

        completed++;
        setProgress({ total: toDownload.length, completed });
      }

      setCache((prev) => ({ ...prev, ...newEntries }));
      downloadingRef.current = false;

      // Run LRU eviction if cache exceeds size limit
      const totalSize = Object.values({ ...cache, ...newEntries }).reduce(
        (sum, e) => sum + (e.status === 'cached' ? e.sizeBytes : 0), 0,
      );
      if (totalSize > MAX_CACHE_BYTES) {
        evictLRU();
      }
    },
    [cache],
  );

  /**
   * Clear all cached videos
   */
  const clearCache = useCallback(async () => {
    if (Platform.OS === 'web' || !FileSystem) return;
    try {
      const cacheDir = FileSystem.cacheDirectory + 'goarrive_videos/';
      await FileSystem.deleteAsync(cacheDir, { idempotent: true });
      setCache({});
      setProgress({ total: 0, completed: 0 });
    } catch (err) {
      console.warn('[useOfflineVideoCache] Clear failed:', err);
    }
  }, []);

  return {
    getCachedUri,
    cacheVideos,
    clearCache,
    evictLRU,
    getCacheSize,
    progress,
    isCaching: downloadingRef.current,
    isOffline,
  };
}
