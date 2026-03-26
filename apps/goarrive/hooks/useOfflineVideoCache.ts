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
import { useState, useCallback, useRef } from 'react';
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
}

export function useOfflineVideoCache() {
  const [cache, setCache] = useState<Record<string, CacheEntry>>({});
  const [progress, setProgress] = useState({ total: 0, completed: 0 });
  const downloadingRef = useRef(false);

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
      if (entry?.status === 'cached') return entry.localUri;
      return remoteUrl; // Fallback to remote URL
    },
    [cache],
  );

  /**
   * Pre-cache a list of video URLs
   */
  const cacheVideos = useCallback(
    async (urls: string[]) => {
      if (Platform.OS === 'web' || !FileSystem || downloadingRef.current) return;
      if (!urls || urls.length === 0) return;

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
            newEntries[url] = { localUri, status: 'cached' };
            completed++;
            setProgress({ total: toDownload.length, completed });
            continue;
          }

          // Download the file
          const result = await FileSystem.downloadAsync(url, localUri);
          if (result.status === 200) {
            newEntries[url] = { localUri: result.uri, status: 'cached' };
          } else {
            newEntries[url] = { localUri: url, status: 'error' };
          }
        } catch (err) {
          console.warn('[useOfflineVideoCache] Download failed:', url, err);
          newEntries[url] = { localUri: url, status: 'error' };
        }

        completed++;
        setProgress({ total: toDownload.length, completed });
      }

      setCache((prev) => ({ ...prev, ...newEntries }));
      downloadingRef.current = false;
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
    progress,
    isCaching: downloadingRef.current,
  };
}
