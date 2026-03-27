/**
 * useSeamlessLoop — Eliminates the pause/gap at video loop transitions (web only)
 *
 * HTML5 `<video loop>` has a noticeable stutter when seeking back to the
 * beginning. This hook uses a dual-video swap technique:
 *
 *   1. Find the primary `<video>` element inside the container
 *   2. Create a hidden clone pre-loaded and paused at time 0
 *   3. When the primary nears its end (~150ms before), swap:
 *      - Play the clone, show it
 *      - Hide the primary, pause it, seek to 0
 *   4. Alternate back and forth indefinitely
 *
 * On native platforms (iOS/Android), this hook is a no-op — expo-av's
 * built-in loop works fine there.
 */
import { useEffect, RefObject } from 'react';
import { Platform, View } from 'react-native';

/** How many milliseconds before the end to trigger the swap */
const SWAP_LEAD_MS = 0.15; // seconds

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

    // Wait for the DOM to settle after React render
    const initTimeout = setTimeout(() => {
      const container = containerRef.current as any;
      if (!container) return;

      // Get the underlying DOM node
      // react-native-web stores it in various ways depending on version
      const domNode: HTMLElement | null =
        container._nativeTag ||
        container.getNode?.() ||
        container;

      if (!domNode || typeof domNode.querySelector !== 'function') return;

      const primaryVideo = domNode.querySelector('video') as HTMLVideoElement | null;
      if (!primaryVideo) return;

      // Don't set up if video has no source
      if (!primaryVideo.src && !primaryVideo.querySelector('source')) return;

      // Create the clone video element
      const clone = document.createElement('video');
      clone.src = primaryVideo.src || videoUri;
      clone.muted = true;
      clone.playsInline = true;
      clone.preload = 'auto';
      clone.currentTime = 0;

      // Match the primary video's computed styles
      clone.style.cssText = primaryVideo.style.cssText;
      clone.style.position = 'absolute';
      clone.style.top = '0';
      clone.style.left = '0';
      clone.style.width = '100%';
      clone.style.height = '100%';
      clone.style.objectFit = 'cover';
      clone.style.opacity = '0';
      clone.style.pointerEvents = 'none';
      clone.style.zIndex = '0';

      // Apply crop transforms to clone
      const hasCrop = cropScale !== 1 || cropTranslateX !== 0 || cropTranslateY !== 0;
      if (hasCrop) {
        clone.style.transform = `scale(${cropScale}) translate(${cropTranslateX}px, ${cropTranslateY}px)`;
      }

      // Insert clone as sibling of the primary video's parent container
      // The primary video is inside a div (expo-av wrapper), so we insert
      // the clone into the same parent
      const videoParent = primaryVideo.parentElement;
      if (!videoParent) return;
      videoParent.style.position = 'relative';
      videoParent.appendChild(clone);

      // Ensure primary video also has proper z-index
      primaryVideo.style.position = 'relative';
      primaryVideo.style.zIndex = '1';

      // Disable native loop on primary — we handle looping ourselves
      primaryVideo.loop = false;

      let isSwapping = false;
      let activeVideo = primaryVideo;
      let standbyVideo = clone;

      const swap = () => {
        if (isSwapping) return;
        isSwapping = true;

        // Play the standby (it's already at time 0 and preloaded)
        standbyVideo.play().then(() => {
          // Show standby, hide active
          standbyVideo.style.opacity = '1';
          standbyVideo.style.zIndex = '1';
          activeVideo.style.opacity = '0';
          activeVideo.style.zIndex = '0';

          // Reset the now-hidden video
          activeVideo.pause();
          activeVideo.currentTime = 0;

          // Swap roles
          const temp = activeVideo;
          activeVideo = standbyVideo;
          standbyVideo = temp;

          isSwapping = false;
        }).catch(() => {
          // If play fails (e.g., autoplay blocked), fall back to native behavior
          isSwapping = false;
          primaryVideo.loop = true;
        });
      };

      // Use timeupdate to detect when near end
      const onTimeUpdate = (e: Event) => {
        const video = e.target as HTMLVideoElement;
        if (
          video.duration > 0 &&
          video.duration - video.currentTime <= SWAP_LEAD_MS &&
          !isSwapping
        ) {
          swap();
        }
      };

      primaryVideo.addEventListener('timeupdate', onTimeUpdate);
      clone.addEventListener('timeupdate', onTimeUpdate);

      // Also handle the 'ended' event as a fallback
      const onEnded = (e: Event) => {
        if (!isSwapping) {
          swap();
        }
      };

      primaryVideo.addEventListener('ended', onEnded);
      clone.addEventListener('ended', onEnded);

      // Cleanup
      return () => {
        primaryVideo.removeEventListener('timeupdate', onTimeUpdate);
        primaryVideo.removeEventListener('ended', onEnded);
        clone.removeEventListener('timeupdate', onTimeUpdate);
        clone.removeEventListener('ended', onEnded);
        primaryVideo.loop = true; // Restore native loop
        clone.pause();
        clone.remove();
      };
    }, 500); // Wait 500ms for expo-av to fully mount the video element

    return () => clearTimeout(initTimeout);
  }, [videoUri, cropScale, cropTranslateX, cropTranslateY]);
}
