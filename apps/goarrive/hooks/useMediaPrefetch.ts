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
import { useEffect, useRef, useState } from 'react';
import { Platform, Image } from 'react-native';
import { getUpcomingMovements } from './mediaPrefetch.helpers';
import { isImageUrl } from '../utils/mediaKind';

// Pass-21 B: how long the speculative prefetch and next-movement preload
// wait after the player mounts before they're allowed to fire. Devin's
// device verdict on pass-21 A was that steady-state slowness was fixed
// but cold start still felt slow: grab-equipment image, first music, and
// first movement video were the three things he actually felt. Those
// three are handled elsewhere (Image render, useWorkoutMusic bootstrap,
// countdown/ready video preload) — the speculative fetches from this
// hook were competing with them for bandwidth right at the moment the
// first work phase kicked in. A 2.5s hold lets the critical three land
// first, then the speculative fetches proceed normally. Chose 2.5s not
// requestIdleCallback because Safari doesn't ship rIC; a fixed delay is
// portable and deterministic on the device we care about.
const SPECULATIVE_DELAY_MS = 2500;

interface PrefetchableMovement {
  videoUrl?: string;
  thumbnailUrl?: string;
}

export function useMediaPrefetch(
  movements: PrefetchableMovement[],
  currentIndex: number,
  isActive: boolean,
  isResting: boolean = false,
  isCountdown: boolean = false,
  isReady: boolean = false,
): void {
  const prefetchedUrls = useRef<Set<string>>(new Set());
  const preloadedVideos = useRef<Set<string>>(new Set());
  // Pending hidden <video> preload elements (web) and their timers, so we can
  // remove them from the DOM and cancel timeouts if the player unmounts
  // before loadeddata / the 30s safety timeout fires.
  const pendingPreloadsRef = useRef<Set<{ el: HTMLVideoElement; timers: ReturnType<typeof setTimeout>[] }>>(new Set());
  // <link rel=prefetch> elements appended to document.head, removed on unmount
  // so they don't accumulate for the lifetime of a long web session.
  const prefetchLinksRef = useRef<HTMLLinkElement[]>([]);
  // Pass-21 B: speculative fetches (standard prefetch, aggressive next-video
  // preload) hold until this flips true. See SPECULATIVE_DELAY_MS above for
  // motivation. Countdown/ready preload of the CURRENT first movement is
  // NOT gated by this — it's part of the critical three.
  const [speculativeAllowed, setSpeculativeAllowed] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSpeculativeAllowed(true), SPECULATIVE_DELAY_MS);
    return () => { try { clearTimeout(t); } catch {} };
  }, []);

  const preloadHiddenVideo = (videoUrl: string) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.src = videoUrl;
    video.style.position = 'absolute';
    video.style.width = '0';
    video.style.height = '0';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    document.body.appendChild(video);

    const pending = { el: video, timers: [] as ReturnType<typeof setTimeout>[] };
    pendingPreloadsRef.current.add(pending);

    const cleanup = () => {
      pending.timers.forEach(clearTimeout);
      pendingPreloadsRef.current.delete(pending);
      try { document.body.removeChild(video); } catch { /* already removed */ }
    };
    video.addEventListener('loadeddata', () => {
      // Keep element alive briefly so browser retains cache, then remove
      if (!pendingPreloadsRef.current.has(pending)) return; // unmounted
      pending.timers.push(setTimeout(cleanup, 5000));
    });
    // Safety timeout: remove after 30s regardless
    pending.timers.push(setTimeout(cleanup, 30000));
  };

  // On unmount, remove any still-pending hidden preload elements and cancel
  // their timers so nothing fires after the player is gone.
  useEffect(() => () => {
    pendingPreloadsRef.current.forEach(({ el, timers }) => {
      timers.forEach(clearTimeout);
      try { document.body.removeChild(el); } catch { /* already removed */ }
    });
    pendingPreloadsRef.current.clear();
    prefetchLinksRef.current.forEach((link) => {
      try { document.head.removeChild(link); } catch { /* already removed */ }
    });
    prefetchLinksRef.current = [];
  }, []);

  // ── Standard prefetch: link rel=prefetch for next 1-3 movements ──────
  // Pass-21 B: gated on speculativeAllowed so the first work phase doesn't
  // race the first movement <Video>'s own fetch. Re-fires when the flag
  // flips because it's in the dep array.
  useEffect(() => {
    if (!isActive && !isResting) return;
    if (!speculativeAllowed) return;
    // Clamp against list length so we never touch sparse/undefined entries
    // near the end of the workout.
    const upcoming = getUpcomingMovements(movements, currentIndex, 3);
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
            prefetchLinksRef.current.push(link);
          } else {
            Image.prefetch(url).catch(() => {});
          }
        }
      });
    });
  }, [currentIndex, isActive, isResting, movements, speculativeAllowed]);

  // ── Preload CURRENT movement video during countdown ─────────────────
  // When the countdown screen is showing, the member isn't watching video
  // yet, so we aggressively preload the current movement's video so it's
  // fully buffered by the time the work phase begins. This eliminates the
  // GIF poster flash. Also preloads the first movement during the ready phase.
  useEffect(() => {
    if (!isCountdown && !isReady) return;

    // During countdown, preload the current movement; during ready, preload the first
    const targetIndex = isReady ? 0 : currentIndex;
    const target = targetIndex < movements.length ? movements[targetIndex] : undefined;
    const videoUrl = target?.videoUrl;
    // Image media is covered by the standard prefetch above — a hidden
    // <video> element can't decode it and would just error out.
    if (!videoUrl || isImageUrl(videoUrl) || preloadedVideos.current.has(videoUrl)) return;

    preloadedVideos.current.add(videoUrl);

    if (Platform.OS === 'web') {
      preloadHiddenVideo(videoUrl);
    } else {
      fetch(videoUrl, { method: 'GET' }).catch(() => {});
    }
  }, [isCountdown, isReady, currentIndex, movements]);

  // ── Aggressive video preload during rest periods ─────────────────────
  // During rest (or while actively playing — we now reveal the next item
  // 3.5s before the current phase ends), fully buffer the next movement's
  // video. On web, we create a hidden <video> element with preload="auto"
  // which forces the browser to download the full file. On native, we use
  // fetch to warm the cache.
  //
  // Pass-21 B: also gated on speculativeAllowed. The first work phase used
  // to spawn a hidden preload for movement 1 the instant movement 0
  // started, doubling the bandwidth demand at the worst possible moment.
  useEffect(() => {
    if (!isResting && !isActive) return;
    if (!speculativeAllowed) return;

    const nextMovement = currentIndex + 1 < movements.length ? movements[currentIndex + 1] : undefined;
    const videoUrl = nextMovement?.videoUrl;
    if (!videoUrl || isImageUrl(videoUrl) || preloadedVideos.current.has(videoUrl)) return;

    preloadedVideos.current.add(videoUrl);

    if (Platform.OS === 'web') {
      // Create a hidden video element that forces full buffering
      preloadHiddenVideo(videoUrl);
    } else {
      // On native, use fetch to warm the HTTP cache
      // expo-av will benefit from the cached response
      fetch(videoUrl, { method: 'GET' }).catch(() => {});
    }
  }, [isResting, isActive, currentIndex, movements, speculativeAllowed]);
}
