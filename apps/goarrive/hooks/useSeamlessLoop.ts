/**
 * useSeamlessLoop — Eliminates the pause/gap at video loop transitions (web only)
 *
 * HTML5 `<video loop>` has a noticeable stutter when seeking back to the
 * beginning because the browser must decode from the nearest keyframe.
 *
 * This hook uses a dual-video crossfade technique with requestAnimationFrame
 * polling for frame-accurate swap timing:
 *
 *   1. Find the primary `<video>` element inside the container
 *   2. Create a hidden clone pre-loaded and paused at time 0
 *   3. Poll via requestAnimationFrame — when the active video is within
 *      ~80ms of its end, instantly swap: show the clone (already at 0),
 *      hide the active, reset it to 0
 *   4. Alternate back and forth indefinitely
 *
 * IMPORTANT: This hook is very careful not to break expo-av's rendering:
 *   - It waits until the primary video has actually started playing
 *   - It never touches the primary video's opacity until a swap happens
 *   - On cleanup, it fully restores the primary video's original state
 *
 * On native platforms (iOS/Android), this hook is a no-op.
 */
import { useEffect, RefObject } from 'react';
import { Platform, View } from 'react-native';

/** How many seconds before the end to trigger the swap */
const SWAP_LEAD_SEC = 0.08;

export function useSeamlessLoop(
  containerRef: RefObject<View | null>,
  videoUri: string,
  cropScale: number = 1,
  cropTranslateX: number = 0,
  cropTranslateY: number = 0,
) {
  useEffect(() => {
    // Only run on web
    if (Platform.OS !== 'web') return;

    let rafId: number | null = null;
    let destroyed = false;
    let clone: HTMLVideoElement | null = null;
    let primaryVideo: HTMLVideoElement | null = null;
    let initialized = false;

    // We delay initialization until the video is actually playing
    // to avoid interfering with expo-av's initial render
    const initTimeout = setTimeout(() => {
      if (destroyed) return;

      const container = containerRef.current as any;
      if (!container) return;

      const domNode: HTMLElement | null =
        container._nativeTag ||
        container.getNode?.() ||
        container;

      if (!domNode || typeof domNode.querySelector !== 'function') return;

      primaryVideo = domNode.querySelector('video') as HTMLVideoElement | null;
      if (!primaryVideo) return;

      // Don't set up if video has no source or no duration
      if (!primaryVideo.src && !primaryVideo.querySelector('source')) return;

      // Wait for the video to actually start playing before setting up the clone
      // This prevents the hook from interfering with expo-av's initial render
      const onPlaying = () => {
        if (destroyed || initialized) return;
        if (!primaryVideo) return;
        // Need a valid duration to set up the swap
        if (!primaryVideo.duration || primaryVideo.duration <= 0) return;

        initialized = true;
        setupClone(primaryVideo);
      };

      // If already playing, set up immediately
      if (!primaryVideo.paused && primaryVideo.duration > 0) {
        initialized = true;
        setupClone(primaryVideo);
      } else {
        // Wait for the video to start playing
        primaryVideo.addEventListener('playing', onPlaying);
        // Cleanup listener if destroyed before playing
        const cleanupListener = () => {
          primaryVideo?.removeEventListener('playing', onPlaying);
        };
        // Store for cleanup
        (containerRef as any).__cleanupListener = cleanupListener;
      }
    }, 300);

    function setupClone(primary: HTMLVideoElement) {
      if (destroyed) return;

      const videoParent = primary.parentElement;
      if (!videoParent) return;

      // Create the clone video element
      clone = document.createElement('video');
      clone.src = primary.src || videoUri;
      clone.muted = true;
      clone.playsInline = true;
      clone.preload = 'auto';

      // Style the clone to overlay the primary video exactly
      clone.style.position = 'absolute';
      clone.style.top = '0';
      clone.style.left = '0';
      clone.style.width = '100%';
      clone.style.height = '100%';
      clone.style.objectFit = 'cover';
      clone.style.opacity = '0';
      clone.style.pointerEvents = 'none';
      clone.style.zIndex = '2';

      // Apply crop transforms to clone to match primary
      const hasCrop = cropScale !== 1 || cropTranslateX !== 0 || cropTranslateY !== 0;
      if (hasCrop) {
        clone.style.transform = `scale(${cropScale}) translate(${cropTranslateX}px, ${cropTranslateY}px)`;
      }

      // Insert clone into the video parent
      videoParent.style.position = 'relative';
      videoParent.appendChild(clone);

      // Disable native loop on primary — we handle looping ourselves
      primary.loop = false;

      // IMPORTANT: Do NOT touch primary's opacity here.
      // It should remain at whatever expo-av set it to (visible).

      // Pre-warm the clone
      const preWarm = () => {
        if (!clone || destroyed) return;
        clone.currentTime = 0;
        const playPromise = clone.play();
        if (playPromise) {
          playPromise.then(() => {
            if (!clone || destroyed) return;
            requestAnimationFrame(() => {
              if (!clone || destroyed) return;
              clone.pause();
              clone.currentTime = 0;
            });
          }).catch(() => {
            // Autoplay blocked — fall back to native loop
            if (primary) primary.loop = true;
          });
        }
      };

      clone.addEventListener('canplay', preWarm, { once: true });
      clone.load();

      let isSwapping = false;
      let activeVideo = primary;
      let standbyVideo = clone;

      const swap = () => {
        if (isSwapping || destroyed || !clone) return;
        isSwapping = true;

        const playPromise = standbyVideo.play();
        if (!playPromise) {
          isSwapping = false;
          return;
        }

        playPromise.then(() => {
          if (destroyed || !clone) return;

          // Instant visual swap via opacity
          standbyVideo.style.opacity = '1';
          activeVideo.style.opacity = '0';

          // Pause and reset the now-hidden video
          activeVideo.pause();
          activeVideo.currentTime = 0;

          // Swap roles
          const temp = activeVideo;
          activeVideo = standbyVideo;
          standbyVideo = temp;

          isSwapping = false;
        }).catch(() => {
          isSwapping = false;
          if (primary) primary.loop = true;
        });
      };

      // RAF polling loop
      const poll = () => {
        if (destroyed) return;

        if (
          activeVideo &&
          activeVideo.duration > 0 &&
          !activeVideo.paused &&
          activeVideo.duration - activeVideo.currentTime <= SWAP_LEAD_SEC &&
          !isSwapping
        ) {
          swap();
        }

        rafId = requestAnimationFrame(poll);
      };

      // Safety net: handle 'ended' event
      const onEnded = () => {
        if (!isSwapping && !destroyed) {
          swap();
        }
      };

      primary.addEventListener('ended', onEnded);
      if (clone) clone.addEventListener('ended', onEnded);

      // Start polling
      rafId = requestAnimationFrame(poll);

      // Store onEnded for cleanup
      (containerRef as any).__onEnded = onEnded;
    }

    // Cleanup
    return () => {
      destroyed = true;
      clearTimeout(initTimeout);
      if (rafId !== null) cancelAnimationFrame(rafId);

      // Clean up playing listener
      if ((containerRef as any).__cleanupListener) {
        (containerRef as any).__cleanupListener();
        delete (containerRef as any).__cleanupListener;
      }

      const onEnded = (containerRef as any).__onEnded;

      if (primaryVideo) {
        primaryVideo.loop = true; // Restore native loop
        primaryVideo.style.opacity = '1'; // Ensure visible
        if (onEnded) primaryVideo.removeEventListener('ended', onEnded);
      }

      if (clone) {
        if (onEnded) clone.removeEventListener('ended', onEnded);
        clone.pause();
        clone.remove();
        clone = null;
      }

      delete (containerRef as any).__onEnded;
    };
  }, [videoUri, cropScale, cropTranslateX, cropTranslateY]);
}
