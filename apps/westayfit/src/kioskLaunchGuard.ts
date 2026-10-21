/**
 * THE KIOSK LAUNCH GUARD (ST-05, native only).
 *
 * A phone acting as a kiosk can be killed by the OS mid-session — during
 * verify-email, or on /contribute?kiosk=1 — and relaunched into member Home
 * still signed in as the visitor who walked up. The durable kiosk-session
 * marker (src/kioskSession.ts) records that a session is open; this guard
 * reads it at launch and sends the device back to that kiosk's start screen.
 * The start screen already does the rest when it comes into focus: it resets
 * the handoffs (src/handoffArming.ts), signs out whoever it finds, and clears
 * the marker once nobody is signed in. An unresolved attempt is left alone;
 * it belongs to the account that made it.
 *
 * NEVER HOME FIRST. Until the launch decision has been made and acted on,
 * `useKioskLaunchGuard` (and `useKioskLaunchHolding`, for any other component)
 * answers `holding: true`, so the shell can keep member screens from showing
 * or starting. `router.replace` needs the root navigator MOUNTED: hold back
 * or cover what is inside it (the member tabs), not the navigator itself.
 *
 * FAILS CLOSED TO "NO REDIRECT" only where it must: on web (a closed tab ends
 * its session; holding is false from the start), with no marker, or when the
 * marker cannot be read or kept. The guard never throws, including when the
 * navigation refuses the replace; the hold ends either way, so a device is
 * never left on a blank screen.
 */
import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { useWsfAuth } from './auth';
import { kioskSessionReady, kioskStartRoute, readKioskSession } from './kioskSession';
import { HAS_SYNC_STORAGE } from './storage/syncRead';

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
// Whether this launch's decision has been made and acted on. Nothing to
// decide on web, where no marker is ever kept.
let decided = HAS_SYNC_STORAGE;
const decidedListeners = new Set<() => void>();

function markDecided(): void {
  if (decided) return;
  decided = true;
  for (const l of [...decidedListeners]) l();
}

function subscribeDecided(listener: () => void): () => void {
  decidedListeners.add(listener);
  return () => {
    decidedListeners.delete(listener);
  };
}

/** For tests: forget that the guard ran in this module instance. */
export function resetKioskLaunchGuardForTests(): void {
  guardRan = false;
  decided = HAS_SYNC_STORAGE;
}

/** Whether this launch's kiosk decision is still being made (false on web). Not a hook. */
export function isKioskLaunchHolding(): boolean {
  return !decided;
}

/**
 * True until this launch's kiosk decision has been made and acted on (false
 * from the start on web). Readable from any component; it does not run the
 * guard (`useKioskLaunchGuard` does).
 */
export function useKioskLaunchHolding(): boolean {
  return !useSyncExternalStore(subscribeDecided, () => decided, () => true);
}

/**
 * Mount once at the root (W12-1). After auth has answered, asks
 * `kioskLaunchRoute` once per process and replaces to it — unless the
 * device is already on that kiosk's start screen. Returns `holding`
 * (`useKioskLaunchHolding`): true until that is done.
 */
export function useKioskLaunchGuard(): boolean {
  const { ready } = useWsfAuth();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  pathRef.current = pathname;
  const holding = useKioskLaunchHolding();
  useEffect(() => {
    if (!ready || guardRan) return;
    guardRan = true;
    void kioskLaunchRoute().then((route) => {
      try {
        if (route && pathRef.current !== route) router.replace(route as never);
      } catch {
        // The navigation refused (not mounted yet, say). Nothing to throw to:
        // the start screen is not reached, and the hold still ends below.
      }
      markDecided();
    });
  }, [ready]);
  return holding;
}
