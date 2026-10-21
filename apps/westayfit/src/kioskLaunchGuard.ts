/**
 * THE KIOSK LAUNCH GUARD (ST-05, native only).
 *
 * A phone acting as a kiosk can be killed by the OS mid-session — during
 * verify-email, or on /contribute?kiosk=1 — and relaunched into member Home
 * still signed in as the visitor who walked up. The durable kiosk-session
 * marker (src/kioskSession.ts) records that a session is open; this guard
 * reads it at launch and sends the device back to that kiosk's start screen.
 * The start screen already does the rest when it comes into focus: it signs
 * out whoever it finds and resets the handoffs (src/handoffArming.ts), which
 * clears the marker. An unresolved attempt is left alone; it belongs to the
 * account that made it.
 *
 * FAILS CLOSED TO "NO REDIRECT" only where it must: on web (a closed tab ends
 * its session), with no marker, or when the marker cannot be read or kept —
 * the guard never throws.
 */
import { router, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';

import { useWsfAuth } from './auth';
import { kioskSessionReady, kioskStartRoute, readKioskSession } from './kioskSession';

/**
 * Where a launch must go: the open kiosk session's start screen, or null (no
 * marker, or web — `readKioskSession` is null on web). Never rejects.
 */
export async function kioskLaunchRoute(): Promise<string | null> {
  try {
    await kioskSessionReady();
    const goalId = readKioskSession();
    return goalId ? kioskStartRoute(goalId) : null;
  } catch {
    return null;
  }
}

// Once per process: a launch is a process start, not every mount.
let guardRan = false;

/** For tests: forget that the guard ran in this module instance. */
export function resetKioskLaunchGuardForTests(): void {
  guardRan = false;
}

/**
 * Mount once at the root (W12-1). After auth has answered, asks
 * `kioskLaunchRoute` once per process and replaces to it — unless the
 * device is already on that kiosk's start screen.
 */
export function useKioskLaunchGuard(): void {
  const { ready } = useWsfAuth();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  useEffect(() => {
    if (!ready || guardRan) return;
    guardRan = true;
    void kioskLaunchRoute().then((route) => {
      if (!route) return;
      if (pathRef.current === route) return;
      router.replace(route as never);
    });
  }, [ready]);
}
