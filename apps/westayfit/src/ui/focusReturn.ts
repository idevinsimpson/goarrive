import { useNavigation } from 'expo-router';
import { useEffect, type RefObject } from 'react';
import { Platform } from 'react-native';

/**
 * FOCUS GOES BACK TO WHERE THE MEMBER WAS.
 *
 * WHY THIS EXISTS. MOVE is a sheet over the tab the member is on, and the
 * contribution flow is a screen pushed over it. Both are removed from the
 * document when they close, and the browser does what it always does when
 * the focused element disappears: it drops focus onto `body`. Measured on
 * every exit (#474 `5824650143`): a keyboard or screen-reader member who
 * opened MOVE, or "Already moved?", and came back was put at the top of the
 * document with no idea where they had been. The tab and its scroll were kept
 * — the navigator never unmounts a visited tab — but the member's place in it
 * was not.
 *
 * WHAT IT DOES. When one of those two flows covers the member tabs, the
 * control that opened it is noted: where focus actually was inside the tabs,
 * which is also where a pointer press lands on web. When the tabs are
 * uncovered again, focus is put back on that control — or on the same control
 * found again by its testID, if the screen rebuilt it — without scrolling, so
 * the offset the tab kept stays exactly as it was.
 *
 * WHEN THERE IS NOTHING TO GO BACK TO. A flow opened cold (a link, a reload)
 * had no opener; a flow that replaced the tabs took its opener with it. Then
 * the landed screen's level-1 heading takes focus, and failing that the
 * current tab's own link: a named place a member can orient from. Never
 * `body`.
 *
 * WHAT IT NEVER DOES.
 *   · It never takes focus the member has already placed: it acts only while
 *     focus is nowhere (on `body`, on a node that has gone, or on one that is
 *     no longer shown).
 *   · It never moves focus on an ordinary page load or a tab switch. Only the
 *     two flows arm it: Settings, Goal Setup, Start a community and Join keep
 *     the browser's default, deliberately, until they are measured.
 *   · Nothing happens off the web, where the platform owns focus.
 */

/** The root-stack routes whose closing returns focus. */
const FLOW_ROUTES = new Set(['move/index', 'contribute/[goalId]']);
/** The same two flows, as addresses: a page loaded here is a cold arrival. */
const FLOW_PATH = /^\/(move\/?$|contribute\/)/;

export type Opener = { node: HTMLElement | null; testId: string | null };

type Fallback = { selector: string; afterMs?: number };

const onWeb = (): boolean => Platform.OS === 'web' && typeof document !== 'undefined';

function shown(el: Element | null | undefined): el is HTMLElement {
  return Boolean(el && el.isConnected && (el as HTMLElement).getClientRects().length > 0);
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * WHERE THE MEMBER'S ATTENTION WAS, per container. Focus is the answer on
 * web, where keyboard and pointer activation both focus the control; the
 * pointer is kept as well for a browser that does not focus a pressed control
 * (Safari), and whichever is more recent wins.
 */
type Trail = { focus: { el: HTMLElement; at: number } | null; pointer: { el: HTMLElement; at: number } | null };

function followAttention(root: () => HTMLElement | null): { trail: Trail; stop: () => void } {
  const trail: Trail = { focus: null, pointer: null };
  const onFocus = (e: FocusEvent) => {
    const r = root();
    const t = e.target as HTMLElement | null;
    if (r && t && t !== document.body && r.contains(t)) trail.focus = { el: t, at: performance.now() };
  };
  const onPointer = (e: PointerEvent) => {
    const r = root();
    const t = (e.target as Element | null)?.closest?.(FOCUSABLE) as HTMLElement | null;
    if (r && t && r.contains(t)) trail.pointer = { el: t, at: performance.now() };
  };
  document.addEventListener('focusin', onFocus, true);
  document.addEventListener('pointerdown', onPointer, true);
  return {
    trail,
    stop: () => {
      document.removeEventListener('focusin', onFocus, true);
      document.removeEventListener('pointerdown', onPointer, true);
    },
  };
}

function openerFrom(root: HTMLElement | null, trail: Trail): Opener {
  const active = document.activeElement as HTMLElement | null;
  const candidates: Array<{ el: HTMLElement; at: number }> = [];
  if (root && active && active !== document.body && root.contains(active)) {
    candidates.push({ el: active, at: trail.focus?.el === active ? trail.focus.at : 0 });
  } else if (trail.focus) {
    candidates.push(trail.focus);
  }
  // A press that did not move focus (a tap in Safari) is still the member's
  // latest act, and beats a control that was merely left focused earlier.
  if (trail.pointer) candidates.push(trail.pointer);
  const node = candidates.sort((a, b) => b.at - a.at)[0]?.el ?? null;
  return { node, testId: node?.getAttribute('data-testid') ?? null };
}

/**
 * Focus is "nowhere": on `body`, on a node that has left the document, or on
 * one that is no longer shown. Focus on something visible inside the
 * container is the member's own, and is left alone.
 */
function focusIsLost(root: HTMLElement): 'lost' | 'member' | 'elsewhere' {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body || a === document.documentElement || !shown(a)) return 'lost';
  return root.contains(a) ? 'member' : 'elsewhere';
}

/**
 * How long a known opener is waited for before the fallback is used: a
 * screen that is rebuilding the control (a refreshed community) shows it a
 * moment after the flow has gone.
 */
const OPENER_GRACE_MS = 1_500;

function target(root: HTMLElement, opener: Opener | null, fallbacks: Fallback[], elapsed: number): HTMLElement | null {
  if (opener?.node && root.contains(opener.node) && shown(opener.node)) return opener.node;
  if (opener?.testId) {
    const again = Array.from(root.querySelectorAll(`[data-testid="${CSS.escape(opener.testId)}"]`)).find(shown);
    if (again) return again as HTMLElement;
  }
  if ((opener?.node || opener?.testId) && elapsed < OPENER_GRACE_MS) return null;
  for (const f of fallbacks) {
    if (f.afterMs && elapsed < f.afterMs) continue;
    const el = Array.from(root.querySelectorAll(f.selector)).find(shown) as HTMLElement | undefined;
    if (el) {
      // A heading is not focusable until it is told it may be, and -1 keeps
      // it out of the Tab order: it can hold focus, not collect it.
      if (!el.matches(FOCUSABLE) && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      return el;
    }
  }
  return null;
}

/** How long to wait for somewhere to put focus, and to watch it once put. */
const SEEK_MS = 5_000;
const WATCH_MS = 3_000;
/** How many times a landing that is then taken away is made again. */
const MAX_RELANDS = 3;

/**
 * Put focus back once the closing flow has actually left: while its own
 * control is still shown, focus is "elsewhere" and this waits. It keeps
 * watching after it lands, because a screen that refreshes on return (the
 * community re-reads its goals) can rebuild or drop the control a moment
 * later; when that takes focus away again, the search starts over, with the
 * same waits, so the opener found again, the heading, or the tab.
 */
export function returnFocusSoon(
  root: () => HTMLElement | null,
  opener: Opener | null,
  fallbacks: Fallback[],
): () => void {
  if (!onWeb()) return () => {};
  let since = performance.now();
  let landedAt: number | null = null;
  let relands = 0;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const now = performance.now();
    const r = root();
    if (r) {
      const where = focusIsLost(r);
      if (where === 'member' && landedAt === null) return; // the member got there first
      if (where === 'lost') {
        if (landedAt !== null) {
          if (relands >= MAX_RELANDS) return;
          relands += 1;
          landedAt = null;
          since = now;
        }
        const el = target(r, opener, fallbacks, now - since);
        if (el) {
          el.focus({ preventScroll: true });
          if (document.activeElement === el) landedAt = now;
        }
      }
    }
    const until = landedAt === null ? since + SEEK_MS : landedAt + WATCH_MS;
    if (now < until) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    stopped = true;
  };
}

/** The tabs' fallbacks: the landed screen's heading, then the current tab. */
const TAB_FALLBACKS: Fallback[] = [
  { selector: 'h1, [role="heading"][aria-level="1"]' },
  // Late, so a screen still loading its heading gets the chance to show it.
  { selector: '[data-testid^="wsf-member-tab-"][data-current="true"]', afterMs: 2_500 },
];

/**
 * ARMED ACROSS MOUNTS, because a flow can replace the tabs rather than cover
 * them (Progress's own "Start moving" does), and the tabs that come back are a
 * new instance with no memory of the old one.
 */
let armed: Opener | null = null;
let tabsHaveMounted = false;

/**
 * For a flow that leaves by REPLACING itself with a member destination rather
 * than going back to what it covered: MOVE's Close when there is nothing
 * beneath it (a cold `/move`, or one that replaced the tabs). The opener, if
 * there was one, went with the tabs it was in, so the landed screen's heading
 * takes focus.
 */
export function armTabsFocusReturn(): void {
  if (!onWeb()) return;
  armed = armed ?? { node: null, testId: null };
}

/**
 * The page was loaded at one of the two flows (a link, a reload). A kiosk
 * session is not a member arrival and never counts, whatever its path.
 */
function loadedAtFlow(): boolean {
  const entry = performance.getEntriesByType?.('navigation')?.[0] as PerformanceNavigationTiming | undefined;
  try {
    const url = new URL(entry?.name ?? window.location.href);
    return FLOW_PATH.test(url.pathname) && !url.searchParams.has('kiosk');
  } catch {
    return false;
  }
}

/**
 * The member tabs' half. Called once, by the tab layout, with the element
 * that holds the whole shell (top bar, screens and bar).
 */
export function useTabsFocusReturn(container: RefObject<unknown>): void {
  const navigation = useNavigation();
  useEffect(() => {
    if (!onWeb()) return;
    const root = () => (container.current as HTMLElement | null) ?? null;
    const attention = followAttention(root);
    let cancel: () => void = () => {};
    const coveringFlow = (): boolean => {
      const s = navigation.getState();
      const top = s?.routes?.[s.index ?? 0]?.name;
      return Boolean(top && FLOW_ROUTES.has(top));
    };
    /*
      WHAT LAST COVERED THE TABS, and not only what first did: a contribution
      can be opened from another flow (Goal Setup's receipt), and it is the
      contribution that closes onto the tabs. Its opener went with the flow
      beneath it, so the landed screen's heading takes focus.
    */
    let lastCovering: string | null = null;
    const offState = navigation.addListener('state', () => {
      if (navigation.isFocused()) return;
      const s = navigation.getState();
      lastCovering = s?.routes?.[s.index ?? 0]?.name ?? null;
    });
    const offBlur = navigation.addListener('blur', () => {
      // Whatever was still being restored is behind the new flow now.
      cancel();
      lastCovering = null;
      armed = coveringFlow() ? openerFrom(root(), attention.trail) : null;
    });
    const offFocus = navigation.addListener('focus', () => {
      const opener =
        armed ?? (lastCovering && FLOW_ROUTES.has(lastCovering) ? { node: null, testId: null } : null);
      armed = null;
      lastCovering = null;
      if (!opener) return;
      cancel();
      cancel = returnFocusSoon(root, opener, TAB_FALLBACKS);
    });

    // Mounting: after a flow that replaced the tabs, or at the end of a cold
    // arrival. Anything else is an ordinary load and moves nothing.
    if (armed) {
      const opener = armed;
      armed = null;
      cancel = returnFocusSoon(root, opener, TAB_FALLBACKS);
    } else if (!tabsHaveMounted && loadedAtFlow()) {
      cancel = returnFocusSoon(root, null, TAB_FALLBACKS);
    }
    tabsHaveMounted = true;

    return () => {
      cancel();
      offState();
      offBlur();
      offFocus();
      attention.stop();
    };
  }, [container, navigation]);
}

/**
 * The MOVE sheet's half: a goal chosen in the sheet opens the contribution
 * flow over it, and Back returns to the sheet. Focus goes back to that choice,
 * or to the sheet's Close.
 */
export function useSheetFocusReturn(container: RefObject<unknown>): void {
  const navigation = useNavigation();
  useEffect(() => {
    if (!onWeb()) return;
    const root = () => (container.current as HTMLElement | null) ?? null;
    const attention = followAttention(root);
    let opener: Opener | null = null;
    let cancel: () => void = () => {};
    const offBlur = navigation.addListener('blur', () => {
      cancel();
      opener = openerFrom(root(), attention.trail);
    });
    const offFocus = navigation.addListener('focus', () => {
      if (!opener) return;
      const o = opener;
      opener = null;
      cancel();
      cancel = returnFocusSoon(root, o, [{ selector: '[data-testid="wsf-move-close"]' }]);
    });
    return () => {
      cancel();
      offBlur();
      offFocus();
      attention.stop();
    };
  }, [container, navigation]);
}
