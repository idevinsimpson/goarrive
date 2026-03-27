/**
 * useSeamlessLoop — Reduces the pause/gap at video loop transitions (web only)
 *
 * Instead of the fragile dual-video swap technique, this uses a simple and
 * reliable approach: listen for the video approaching its end and seek back
 * to time 0 before the browser's native loop mechanism kicks in.
 *
 * This avoids the decode-from-keyframe delay that causes the visible stutter
 * with native `<video loop>`.
 *
 * On native platforms (iOS/Android), this hook is a no-op — expo-av's
 * built-in loop works fine there.
 */
import { useEffect, RefObject } from 'react';
import { Platform, View } from 'react-native';

/** How many seconds before the end to seek back to 0 */
const SEEK_LEAD_SEC = 0.15;

export function useSeamlessLoop(
  containerRef: RefObject<View | null>,
  videoUri: string,
  _cropScale: number = 1,
  _cropTranslateX: number = 0,
  _cropTranslateY: number = 0,
) {
  useEffect(() => {
    // Only run on web
    if (Platform.OS !== 'web') return;

    let destroyed = false;
    let rafId: number | null = null;
    let video: HTMLVideoElement | null = null;

    // Delay to let expo-av render the video element
    const initTimeout = setTimeout(() => {
      if (destroyed) return;

      const container = containerRef.current as any;
      if (!container) return;

      const domNode: HTMLElement | null =
        container._nativeTag ||
        container.getNode?.() ||
        container;

      if (!domNode || typeof domNode.querySelector !== 'function') return;

      video = domNode.querySelector('video') as HTMLVideoElement | null;
      if (!video) return;

      // Ensure native loop stays ON as our safety net
      video.loop = true;

      // RAF polling: when near the end, seek to 0
      const poll = () => {
        if (destroyed) return;

        if (
          video &&
          video.duration > 0 &&
          !video.paused &&
          video.duration - video.currentTime <= SEEK_LEAD_SEC
        ) {
          // Seek back to beginning before the native loop triggers
          video.currentTime = 0;
        }

        rafId = requestAnimationFrame(poll);
      };

      rafId = requestAnimationFrame(poll);
    }, 500);

    return () => {
      destroyed = true;
      clearTimeout(initTimeout);
      if (rafId !== null) cancelAnimationFrame(rafId);
      // Don't touch the video element on cleanup — leave it as expo-av expects
    };
  }, [videoUri]);
}
