/**
 * useWakeLock — Prevent screen sleep during workout playback
 *
 * Uses the Screen Wake Lock API on web browsers.
 * Silent no-op on platforms where the API is unavailable.
 *
 * Slice 1, Week 4, Loop 4 — Polish
 */
import { useEffect, useRef } from 'react';

export function useWakeLock(active: boolean): void {
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    if (!active) {
      // Release wake lock when not active
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      return;
    }

    // Request wake lock
    async function requestWakeLock() {
      try {
        if (
          typeof navigator !== 'undefined' &&
          'wakeLock' in navigator
        ) {
          wakeLockRef.current = await (navigator as any).wakeLock.request(
            'screen',
          );
        }
      } catch {
        // Wake lock request failed — browser may not support it or tab is not visible
      }
    }

    requestWakeLock();

    // Re-acquire wake lock when page becomes visible again
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && active) {
        requestWakeLock();
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
      if (typeof document !== 'undefined') {
        document.removeEventListener(
          'visibilitychange',
          handleVisibilityChange,
        );
      }
    };
  }, [active]);
}
