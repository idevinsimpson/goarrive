import { Platform } from 'react-native';

/**
 * NATIVE-INTEGRATOR-1 (INT-01). AN INJECTED-THROW HARNESS, OFF UNLESS A BUILD
 * ASKS FOR IT.
 *
 * The INT-01 acceptance cases are run on release builds: a deliberate throw in
 * the Community tab, in Progress, in the root shell and in community detail
 * (a `window.location.origin` read, ST-01's shape), plus a throw in a timer and
 * an unhandled rejection. This is how such a build is made: set
 *
 *   EXPO_PUBLIC_WSF_CRASH_HARNESS=community-tab,progress,root-shell,community-detail-origin,timer,rejection
 *
 * (any subset) in the build's environment. Each named render site then throws
 * every time it renders until the tester presses "Remove injected fault" on the
 * contained error screen, and "Try again" re-renders it. `timer` and
 * `rejection` fire once, a few seconds after launch.
 *
 * It is inert on web, inert in a production build whatever the variable says
 * (and app.config.js refuses to build production with it set), and inert when
 * the variable is unset, which is every ordinary build. Unknown names are
 * ignored.
 */

export const CRASH_HARNESS_SITES = [
  'root-shell',
  'community-tab',
  'progress',
  'community-detail-origin',
  'timer',
  'rejection',
] as const;
export type CrashSite = (typeof CRASH_HARNESS_SITES)[number];

export function parseCrashHarness(
  raw: string | undefined,
  ctx: { platform: string; env: string | undefined },
): Set<CrashSite> {
  const out = new Set<CrashSite>();
  if (!raw || ctx.platform === 'web' || (ctx.env ?? '').trim() === 'production') return out;
  for (const part of raw.split(',')) {
    const name = part.trim() as CrashSite;
    if ((CRASH_HARNESS_SITES as readonly string[]).includes(name)) out.add(name);
  }
  return out;
}

// Read statically so the bundler inlines the build's value.
const configured = parseCrashHarness(process.env.EXPO_PUBLIC_WSF_CRASH_HARNESS, {
  platform: Platform.OS,
  env: process.env.EXPO_PUBLIC_WSF_ENV,
});
const armed = new Set<CrashSite>(configured);

/** True when this build was made with the harness on (some site configured). */
export function crashHarnessEnabled(): boolean {
  return configured.size > 0;
}

export function isCrashSiteArmed(site: CrashSite): boolean {
  return armed.has(site);
}

export function disarmAllCrashSites(): void {
  armed.clear();
}

/** Tests only: arm a site as if the build had named it. */
export function armCrashSiteForTest(site: CrashSite): void {
  armed.add(site);
}

type WindowLike = { window?: { location?: { origin?: unknown } } };

/**
 * Call during render. Throws while the site is armed. The community-detail
 * site performs the real read ST-01 performed: on a native release build
 * `window.location` does not exist and the read itself throws a TypeError; a
 * development build has Metro's `window.location`, so the harness throws in
 * its place.
 */
export function injectedRenderFault(site: CrashSite, globalObject: WindowLike = globalThis as WindowLike): void {
  if (!armed.has(site)) return;
  if (site === 'community-detail-origin') {
    const origin = (globalObject.window as { location: { origin: unknown } }).location.origin;
    throw new Error(`WSF injected render fault: community-detail-origin (read ${typeof origin})`);
  }
  throw new Error(`WSF injected render fault: ${site}`);
}

export const ASYNC_FAULT_DELAY_MS = 3000;

/** Fires the armed timer and rejection faults once, after a short delay. */
export function fireAsyncCrashFaults(
  schedule: (fn: () => void, ms: number) => unknown = (fn, ms) => setTimeout(fn, ms),
): void {
  if (armed.has('timer')) {
    armed.delete('timer');
    schedule(() => {
      throw new Error('WSF injected timer fault');
    }, ASYNC_FAULT_DELAY_MS);
  }
  if (armed.has('rejection')) {
    armed.delete('rejection');
    schedule(() => {
      void Promise.reject(new Error('WSF injected rejection'));
    }, ASYNC_FAULT_DELAY_MS);
  }
}
