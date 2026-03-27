/**
 * useMediaPrefetch — Prefetches upcoming movement media for smooth playback
 *
 * Extracted from WorkoutPlayer. Prefetches the next 1-3 movement clips
 * during active workout phases to reduce gym-network friction.
 *
 * Enhanced: During rest periods, aggressively prefetches the immediate next
 * movement's video using a hidden <video> preload (web) or expo-av preload
 * (native) so the video is fully buffered before the member transitions.
 */
import { useEffect, useRef } from 'react';
import { Platform, Image } from 'react-native';

interface PrefetchableMovement {
  videoUrl?: string;
  thumbnailUrl?: string;
}

export function useMediaPrefetch(
  movements: PrefetchableMovement[],
  currentIndex: number,
  isActive: boolean,
  isResting: boolean = false,
): void {
  const prefetchedUrls = useRef<Set<string>>(new Set());
  const preloadedVideos = useRef<Set<string>>(new Set());

  // ── Standard prefetch: link rel=prefetch for next 1-3 movements ──────
  useEffect(() => {
    if (!isActive && !isResting) return;
    const upcoming = movements.slice(currentIndex + 1, currentIndex + 4);
    upcoming.forEach((m) => {
      // Prefetch both videoUrl and thumbnailUrl separately
      const urls = [m.videoUrl, m.thumbnailUrl].filter(Boolean) as string[];
      urls.forEach((url) => {
        if (!prefetchedUrls.current.has(url)) {
          prefetchedUrls.current.add(url);
          if (Platform.OS === 'web') {
            const link = document.createElement('link');
            link.rel = 'prefetch';
            link.href = url;
            document.head.appendChild(link);
          } else {
            Image.prefetch(url).catch(() => {});
          }
        }
      });
    });
  }, [currentIndex, isActive, isResting, movements]);

  // ── Aggressive video preload during rest periods ─────────────────────
  // During rest, the member isn't watching video, so we use the bandwidth
  // to fully buffer the next movement's video. On web, we create a hidden
  // <video> element with preload="auto" which forces the browser to
  // download the full file. On native, we use fetch to warm the cache.
  useEffect(() => {
    if (!isResting) return;

    const nextMovement = movements[currentIndex + 1];
    const videoUrl = nextMovement?.videoUrl;
    if (!videoUrl || preloadedVideos.current.has(videoUrl)) return;

    preloadedVideos.current.add(videoUrl);

    if (Platform.OS === 'web') {
      // Create a hidden video element that forces full buffering
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.src = videoUrl;
      video.style.position = 'absolute';
      video.style.width = '0';
      video.style.height = '0';
      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
      document.body.appendChild(video);

      // Clean up after 30 seconds or when loaded
      const cleanup = () => {
        try { document.body.removeChild(video); } catch { /* already removed */ }
      };
      video.addEventListener('loadeddata', () => {
        // Keep element alive briefly so browser retains cache, then remove
        setTimeout(cleanup, 5000);
      });
      // Safety timeout: remove after 30s regardless
      setTimeout(cleanup, 30000);
    } else {
      // On native, use fetch to warm the HTTP cache
      // expo-av will benefit from the cached response
      fetch(videoUrl, { method: 'GET' }).catch(() => {});
    }
  }, [isResting, currentIndex, movements]);
}
