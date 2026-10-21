import type { CrashSite } from './crashHarnessSites';

/**
 * NATIVE-INTEGRATOR-1 (INT-01). THE WEB BUILD HAS NO INJECTED-THROW HARNESS.
 *
 * iOS and Android get src/crashHarness.native.ts. The route boundaries are
 * native only, so a fault injected on web would only blank the page; every
 * export here is inert, and none of the harness ships in the web bundle.
 */
export type { CrashSite };

export function crashHarnessEnabled(): boolean {
  return false;
}

export function isCrashSiteArmed(_site: CrashSite): boolean {
  return false;
}

export function disarmAllCrashSites(): void {}

export function injectedRenderFault(_site: CrashSite): void {}

export function fireAsyncCrashFaults(): void {}
