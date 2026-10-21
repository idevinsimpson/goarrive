import {
  crashRecordOf,
  persistCrash,
  type CrashRecord,
} from './crashRecords';
import { deviceKv, type DeviceKv } from './storage/kv';

/**
 * NATIVE-INTEGRATOR-1 (INT-01). THE APP'S LAST LINE ON A PHONE: RECORD, THEN
 * LET THE PLATFORM DO WHAT IT ALWAYS DID. (iOS and Android only; the web build
 * gets src/crashContainment.ts, which installs nothing.)
 *
 * Render errors are contained by the route `ErrorBoundary` exports
 * (src/ui/RouteErrorFallback.native.tsx). What reaches React Native's global
 * handler is everything else: a throw in a timer or an event callback, which RN
 * treats as fatal and which ends the process in a release build. Nothing can
 * make that survivable from here, and swallowing it would leave the app running
 * in an unknown state. So this module does exactly two things:
 *
 *   1. It wraps `ErrorUtils.getGlobalHandler()`: a scrubbed record of the
 *      error is written to the device (src/crashRecords.ts), and THEN the
 *      previous handler runs with the same arguments. A fatal error is never
 *      swallowed. Because the previous handler ends the process, the write is
 *      given a bounded moment (`PERSIST_GRACE_MS`) to land first; a write that
 *      hangs never holds the error back for longer.
 *   2. In a release build it turns on Hermes' rejection tracking, which React
 *      Native enables only in development, so an unhandled promise rejection
 *      is recorded instead of vanishing. It is recorded, not escalated: it was
 *      never fatal and does not become fatal here.
 *
 * The record is surfaced on the next launch in Build details (`app/health.tsx`).
 * Adopting a crash reporter is an owner decision; this keeps what one would
 * need and sends nothing anywhere.
 *
 * Imported first by `app/_layout.tsx`, so it installs before any other module
 * of the app runs.
 */

/** The longest a fatal error waits for its record to be written. */
export const PERSIST_GRACE_MS = 1500;

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = {
  getGlobalHandler(): GlobalHandler | undefined;
  setGlobalHandler(handler: GlobalHandler): void;
};
type HermesLike = {
  enablePromiseRejectionTracker?: (options: {
    allRejections: boolean;
    onUnhandled: (id: number, rejection: unknown) => void;
    onHandled: (id: number) => void;
  }) => void;
};
type GlobalLike = { ErrorUtils?: ErrorUtilsLike; HermesInternal?: HermesLike };

export type InstallOptions = {
  globalObject?: GlobalLike;
  platform?: string;
  /** A development build: RN already tracks rejections there (LogBox). */
  dev?: boolean;
  kv?: DeviceKv;
  graceMs?: number;
  /** Tests only: install again over a previous install. */
  force?: boolean;
};

let installed = false;

/**
 * Installs the wrapper once. Returns whether it installed. A no-op on web and
 * wherever `ErrorUtils` is missing.
 */
export function installCrashContainment(options: InstallOptions = {}): boolean {
  const platform = options.platform ?? 'native';
  if (platform === 'web') return false;
  if (installed && !options.force) return false;
  const g = options.globalObject ?? (globalThis as unknown as GlobalLike);
  const eu = g.ErrorUtils;
  if (!eu || typeof eu.getGlobalHandler !== 'function' || typeof eu.setGlobalHandler !== 'function') return false;
  const kv = options.kv ?? deviceKv;
  const graceMs = options.graceMs ?? PERSIST_GRACE_MS;
  const dev = options.dev ?? (typeof __DEV__ !== 'undefined' ? __DEV__ : false);
  const previous = eu.getGlobalHandler();

  let handling = false;
  const handler: GlobalHandler = (error, isFatal) => {
    if (handling) {
      // A second error while the first is still being written: pass it on at
      // once rather than recursing into the recorder.
      previous?.(error, isFatal);
      return;
    }
    let record: CrashRecord | null = null;
    try {
      record = crashRecordOf(error, isFatal ? 'fatal' : 'error');
    } catch {
      record = null;
    }
    if (!record) {
      previous?.(error, isFatal);
      return;
    }
    if (!isFatal) {
      void persistCrash(record, kv);
      previous?.(error, isFatal);
      return;
    }
    handling = true;
    let passed = false;
    const pass = () => {
      if (passed) return;
      passed = true;
      handling = false;
      previous?.(error, isFatal);
    };
    const timer = setTimeout(pass, graceMs);
    persistCrash(record, kv).then(
      () => {
        clearTimeout(timer);
        pass();
      },
      () => {
        clearTimeout(timer);
        pass();
      },
    );
  };
  eu.setGlobalHandler(handler);

  if (!dev) {
    try {
      g.HermesInternal?.enablePromiseRejectionTracker?.({
        allRejections: true,
        onUnhandled: (_id, rejection) => {
          try {
            void persistCrash(crashRecordOf(rejection, 'rejection'), kv);
          } catch {
            // Recording must never become an error of its own.
          }
        },
        onHandled: () => undefined,
      });
    } catch {
      // A runtime without the tracker keeps its own behaviour.
    }
  }
  installed = true;
  return true;
}

// Imported first by app/_layout.tsx (this file on iOS and Android): install on evaluation.
installCrashContainment();
