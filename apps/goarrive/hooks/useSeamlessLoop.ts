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
 *      ~100ms of its end, instantly swap: show the clone (already at 0),
 *      hide the active, reset it to 0
 *   4. Alternate back and forth indefinitely
 *
 * The clone is pre-played then immediately paused at time 0 so the browser
 * has already decoded the first frames — this eliminates the async delay
 * that caused the remaining stutter in the previous timeupdate-based approach.
 *
 * On native platforms (iOS/Android), this hook is a no-op — expo-av's
 * built-in loop works fine there.
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

    // Wait for the DOM to settle after React render
    const initTimeout = setTimeout(() => {
      if (destroyed) return;

      const container = containerRef.current as any;
      if (!container) return;

      // Get the underlying DOM node
      const domNode: HTMLElement | null =
        container._nativeTag ||
        container.getNode?.() ||
        container;

      if (!domNode || typeof domNode.querySelector !== 'function') return;

      const primaryVideo = domNode.querySelector('video') as HTMLVideoElement | null;
      if (!primaryVideo) return;

      // Don't set up if video has no source
      if (!primaryVideo.src && !primaryVideo.querySelector('source')) return;

      // Find the video's immediate parent (expo-av wrapper div)
      const videoParent = primaryVideo.parentElement;
      if (!videoParent) return;

      // Create the clone video element
      const clone = document.createElement('video');
      clone.src = primaryVideo.src || videoUri;
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
      clone.style.zIndex = '2'; // Above primary video but below poster

      // Apply crop transforms to clone to match primary
      const hasCrop = cropScale !== 1 || cropTranslateX !== 0 || cropTranslateY !== 0;
      if (hasCrop) {
        clone.style.transform = `scale(${cropScale}) translate(${cropTranslateX}px, ${cropTranslateY}px)`;
      }

      // Insert clone into the video parent
      // expo-av DOM: <div (outer)> → <div (ExponentVideo wrapper)> → <video>
      // The poster Image is a sibling of ExponentVideo wrapper in the outer div.
      // We insert the clone INSIDE the ExponentVideo wrapper (videoParent) so it
      // doesn't interfere with the poster Image's z-stacking.
      videoParent.style.position = 'relative';
      videoParent.appendChild(clone);

      // Disable native loop on primary — we handle looping ourselves
      primaryVideo.loop = false;

      // Pre-warm the clone: play briefly then pause at 0
      // This forces the browser to decode the first frames
      const preWarm = () => {
        clone.currentTime = 0;
        const playPromise = clone.play();
        if (playPromise) {
          playPromise.then(() => {
            // Immediately pause after the browser starts decoding
            requestAnimationFrame(() => {
              clone.pause();
              clone.currentTime = 0;
            });
          }).catch(() => {
            // Autoplay blocked — fall back to native loop
            primaryVideo.loop = true;
          });
        }
      };

      // Wait for clone to have enough data before pre-warming
      clone.addEventListener('canplay', preWarm, { once: true });
      clone.load();

      let isSwapping = false;
      let activeVideo = primaryVideo;
      let standbyVideo = clone;

      const swap = () => {
        if (isSwapping || destroyed) return;
        isSwapping = true;

        // The standby is already at time 0 with first frames decoded
        const playPromise = standbyVideo.play();
        if (!playPromise) {
          isSwapping = false;
          return;
        }

        playPromise.then(() => {
          if (destroyed) return;

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
          // If play fails, fall back to native loop
          isSwapping = false;
          primaryVideo.loop = true;
        });
      };

      // RAF polling loop — checks every frame for precise swap timing
      const poll = () => {
        if (destroyed) return;

        if (
          activeVideo.duration > 0 &&
          !activeVideo.paused &&
          activeVideo.duration - activeVideo.currentTime <= SWAP_LEAD_SEC &&
          !isSwapping
        ) {
          swap();
        }

        rafId = requestAnimationFrame(poll);
      };

      // Also handle 'ended' as a safety net
      const onEnded = () => {
        if (!isSwapping && !destroyed) {
          swap();
        }
      };

      primaryVideo.addEventListener('ended', onEnded);
      clone.addEventListener('ended', onEnded);

      // Start polling
      rafId = requestAnimationFrame(poll);

      // Cleanup
      return () => {
        destroyed = true;
        if (rafId !== null) cancelAnimationFrame(rafId);
        primaryVideo.removeEventListener('ended', onEnded);
        clone.removeEventListener('ended', onEnded);
        primaryVideo.loop = true; // Restore native loop
        primaryVideo.style.opacity = '1';
        clone.pause();
        clone.remove();
      };
    }, 500); // Wait 500ms for expo-av to fully mount the video element

    return () => {
      destroyed = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      clearTimeout(initTimeout);
    };
  }, [videoUri, cropScale, cropTranslateX, cropTranslateY]);
}
