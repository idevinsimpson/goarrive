/**
 * NATIVE-INTEGRATOR-1 (INT-01). THE WEB BUILD INSTALLS NOTHING.
 *
 * iOS and Android get src/crashContainment.native.ts, which wraps React
 * Native's global error handler. react-native-web has no `ErrorUtils`, and a
 * web crash keeps behaving exactly as it always has (react-native-web unmounts
 * to a blank page and a reload recovers), so this module exists only so
 * `app/_layout.tsx` can import the same path on every platform.
 */
export function installCrashContainment(_options?: unknown): boolean {
  return false;
}
