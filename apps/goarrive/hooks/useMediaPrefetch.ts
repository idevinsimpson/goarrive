/**
 * useMediaPrefetch — Prefetches upcoming movement media for smooth playback
 *
 * Extracted from WorkoutPlayer. Prefetches the next 1-3 movement clips
 * during active workout phases to reduce gym-network friction.
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
): void {
  const prefetchedUrls = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isActive) return;
    const upcoming = movements.slice(currentIndex + 1, currentIndex + 4);
    upcoming.forEach((m) => {
      const url = m.videoUrl || m.thumbnailUrl;
      if (url && !prefetchedUrls.current.has(url)) {
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
  }, [currentIndex, isActive, movements]);
}
