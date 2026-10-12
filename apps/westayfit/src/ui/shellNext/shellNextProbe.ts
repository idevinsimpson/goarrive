/**
 * INSTRUMENTATION FOR THE SHELL PROTOTYPE. PROTOTYPE ONLY.
 *
 * WHY THIS EXISTS. The owner's finding is about things that are invisible in a
 * screenshot: whether tapping the tab you are already on reloads the page,
 * whether switching away and back throws your loaded state out, whether a tab
 * tap leaves a back-button trail. A capture cannot show any of that, and a
 * claim about it is worth nothing. So the prototype counts.
 *
 * Every prototype screen reports each of its own mounts, and the tab bar
 * reports every navigation it actually performs. A test reads the counters off
 * the page and asserts on numbers, so "reselect causes zero navigation and
 * zero remount" is measured on the running build rather than argued from the
 * source.
 *
 * NOTHING HERE IS A PRODUCTION SEAM. It writes to one property on the global
 * object, under the emulator gate that already hides the whole prototype, and
 * no production module imports it.
 */
export type ShellNextProbe = {
  /** How many times each screen has mounted, by screen id. */
  mounts: Record<string, number>;
  /** Every navigation the prototype chrome actually performed, in order. */
  navs: string[];
  /** Every tab press, whether or not it navigated — so a no-op is visible as
   *  a press with no matching nav rather than as an absence of evidence. */
  presses: string[];
};

const KEY = '__wsfShellNextProbe';

type ProbeHost = { [KEY]?: ShellNextProbe };

export function shellNextProbe(): ShellNextProbe {
  const host = globalThis as unknown as ProbeHost;
  const existing = host[KEY];
  if (existing) return existing;
  const fresh: ShellNextProbe = { mounts: {}, navs: [], presses: [] };
  host[KEY] = fresh;
  return fresh;
}

/** Called once per real mount. Returns this screen's mount ordinal, which the
 *  screen renders, so the count is readable in the DOM as well as on the
 *  global — a capture then carries its own proof. */
export function recordMount(id: string): number {
  const p = shellNextProbe();
  p.mounts[id] = (p.mounts[id] ?? 0) + 1;
  return p.mounts[id];
}

export function recordNav(href: string): void {
  shellNextProbe().navs.push(href);
}

export function recordPress(key: string): void {
  shellNextProbe().presses.push(key);
}
