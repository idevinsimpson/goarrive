import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';

/**
 * NATIVE-INTEGRATOR-1 (INT-12, INT-04). A MEMBER SURFACE RE-READS WHEN THE
 * MEMBER COMES BACK TO THE APP.
 *
 * On a phone the JS context survives hours in the background and navigation
 * focus never fires on resume, so Home, Community Home and Progress kept
 * showing totals, membership and "Start moving" from whenever they last read.
 * This hook calls `onResume` when the app returns to the foreground:
 *
 *   - only from `background` (a real trip away). `inactive` alone (iOS
 *     Control Center, the app switcher peek, an incoming-call banner) is not a
 *     return and triggers nothing, so it cannot burst reads;
 *   - only after at least `minAwayMs` away (default 30 s), so flicking out and
 *     back costs nothing. A screen showing an error passes 0: any return is a
 *     reason to try again;
 *   - debounced: the call waits `RESUME_SETTLE_MS` after `active`, and going
 *     back to the background first cancels it;
 *   - only for the focused screen: it listens only while focused
 *     (`useFocusEffect`), so a screen covered by MOVE or another tab does not
 *     read on the member's behalf.
 *
 * react-native-web maps AppState onto `visibilitychange`, so a web tab hidden
 * for at least the same minimum refreshes the same way.
 *
 * What `onResume` does is the screen's own: each bumps the token its existing
 * focus-return path already uses, so a resume reads exactly what a return
 * reads, quietly, keeping what is on screen until the answer lands.
 */

export const RESUME_MIN_AWAY_MS = 30_000;
export const RESUME_SETTLE_MS = 400;

export type ResumeWatcherOptions = {
  onResume: () => void;
  /** Read at each return, so a screen can change it with its state. */
  minAwayMs: () => number;
  settleMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
};

/** The pure state machine behind the hook (also what the tests drive). */
export function createResumeWatcher(o: ResumeWatcherOptions): {
  onChange: (next: AppStateStatus) => void;
  dispose: () => void;
} {
  const now = o.now ?? Date.now;
  const schedule = o.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancel = o.cancel ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const settleMs = o.settleMs ?? RESUME_SETTLE_MS;
  let backgroundAt: number | null = null;
  let pending: unknown = null;
  const clear = () => {
    if (pending !== null) {
      cancel(pending);
      pending = null;
    }
  };
  return {
    onChange(next) {
      if (next === 'background') {
        if (backgroundAt === null) backgroundAt = now();
        clear();
        return;
      }
      // 'inactive' (and anything else) is not a return.
      if (next !== 'active' || backgroundAt === null) return;
      const away = now() - backgroundAt;
      backgroundAt = null;
      if (away < o.minAwayMs()) return;
      clear();
      pending = schedule(() => {
        pending = null;
        o.onResume();
      }, settleMs);
    },
    dispose() {
      clear();
      backgroundAt = null;
    },
  };
}

export function useResumeRefresh(onResume: () => void, options: { minAwayMs?: number } = {}): void {
  const latest = useRef({ onResume, minAwayMs: options.minAwayMs ?? RESUME_MIN_AWAY_MS });
  latest.current = { onResume, minAwayMs: options.minAwayMs ?? RESUME_MIN_AWAY_MS };
  useFocusEffect(
    useCallback(() => {
      const watcher = createResumeWatcher({
        onResume: () => latest.current.onResume(),
        minAwayMs: () => latest.current.minAwayMs,
      });
      // react-native-web returns nothing where AppState is unavailable (static rendering).
      const sub = AppState.addEventListener('change', watcher.onChange) as { remove: () => void } | undefined;
      return () => {
        sub?.remove();
        watcher.dispose();
      };
    }, []),
  );
}

/**
 * NATIVE-INTEGRATOR-1 (INT-12 case 5). WHETHER THE APP IS IN THE FOREGROUND
 * ON A PHONE: false while it is in the `background`, true otherwise
 * (`inactive`, Control Center or the app switcher, is still in front). A poll
 * gated on it sends nothing while the member is away and starts again when
 * they come back.
 *
 * Always true on web: a hidden tab keeps the behaviour it had (browsers
 * already throttle its timers), so nothing about the web build changes.
 */
export function useAppInForeground(platform: string = Platform.OS): boolean {
  const [foreground, setForeground] = useState(() => platform === 'web' || AppState.currentState !== 'background');
  useEffect(() => {
    if (platform === 'web') return undefined;
    setForeground(AppState.currentState !== 'background');
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => setForeground(next !== 'background')) as
      | { remove: () => void }
      | undefined;
    return () => sub?.remove();
  }, [platform]);
  return foreground;
}
