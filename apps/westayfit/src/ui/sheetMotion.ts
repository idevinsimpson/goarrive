import { useNavigation } from 'expo-router';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { Platform } from 'react-native';

/**
 * APP-FEEL-PARITY-1. HOW A MEMBER SHEET COMES AND GOES, AND WHAT IT HOLDS.
 *
 * Two sheets in the member app are presented over the mounted tab the member
 * was on: MOVE's resolver (`app/move/index.tsx`) and, when MOVE hands straight
 * to one goal or a chooser row is pressed, the contribution flow itself
 * (`app/contribute/[goalId].tsx`, move mode). Both answer to the reference
 * (Lovable `e15b9fa0…` at frozen product `a15a610e`, styles.css
 * "MOTION-FEEL-1" and ui.tsx `Sheet`):
 *
 *   · the sheet travels in: translateY(28px) and transparent → rest, 240 ms,
 *     cubic-bezier(.22,1,.36,1); the scrim fades in with it;
 *   · it travels out: → translateY(28px) and transparent, 180 ms,
 *     cubic-bezier(.4,0,1,1), and the navigation happens when that ends;
 *   · a member who asked for reduced motion gets no travel and no wait;
 *   · focus enters the sheet and cannot leave it by Tab while it is in front.
 *
 * WEB ONLY, AND WHY CSS. On the web the native stack does not animate at all:
 * the `animation` option is a native-platform option, so both sheets simply
 * appeared and vanished. The keyframes are a stylesheet keyed on `data-*`
 * attributes (react-native-web's `dataSet`), so no animation state lives in
 * React and a screen that re-renders mid-flight does not restart its entry.
 * Native keeps the stack's own `slide_from_bottom`.
 */

export const SHEET_IN_MS = 240;
export const SHEET_OUT_MS = 180;

const onWeb = (): boolean => Platform.OS === 'web' && typeof document !== 'undefined';

const CSS = `
@keyframes wsf-sheet-in { from { transform: translateY(28px); opacity: 0; } }
@keyframes wsf-sheet-out { to { transform: translateY(28px); opacity: 0; } }
@keyframes wsf-scrim-in { from { opacity: 0; } }
@keyframes wsf-scrim-out { to { opacity: 0; } }
[data-wsf-sheet-panel="in"] { animation: wsf-sheet-in ${SHEET_IN_MS}ms cubic-bezier(.22,1,.36,1); }
[data-wsf-sheet-panel="out"] { animation: wsf-sheet-out ${SHEET_OUT_MS}ms cubic-bezier(.4,0,1,1) forwards; pointer-events: none; }
[data-wsf-sheet-scrim="in"] { animation: wsf-scrim-in ${SHEET_IN_MS}ms ease-out; }
[data-wsf-sheet-scrim="out"] { animation: wsf-scrim-out ${SHEET_OUT_MS}ms cubic-bezier(.4,0,1,1) forwards; }
@media (prefers-reduced-motion: reduce) {
  [data-wsf-sheet-panel], [data-wsf-sheet-scrim] { animation: none !important; }
}
`;

/** Installs the keyframes once per document. */
export function ensureSheetMotionCss(): void {
  if (!onWeb() || document.getElementById('wsf-sheet-motion')) return;
  const style = document.createElement('style');
  style.id = 'wsf-sheet-motion';
  style.textContent = CSS;
  document.head.appendChild(style);
}

/**
 * A HAND-OFF IS NOT A NEW ENTRY. When MOVE's resolver finds one open goal it
 * replaces itself with that goal's flow. The member's sheet is already up and
 * the context already dimmed; fading the scrim in again from nothing would
 * flash the tab behind at full brightness for a frame. The resolver marks the
 * hand-off, and the flow it hands to takes the panel's entry without a second
 * scrim fade.
 */
let handoff = false;
export function markSheetHandoff(): void {
  handoff = true;
}
export function takeSheetHandoff(): boolean {
  const was = handoff;
  handoff = false;
  return was;
}

/**
 * ONE EXIT, AND ONLY WHILE THIS SHEET IS STILL THE SCREEN IN FRONT.
 *
 * The 180 ms exit is a window in which the world can move under the sheet,
 * and an uncancelled timer would then navigate a SECOND time (Director #482
 * `5834554381`). Each case is closed here, for both sheets:
 *   · the browser's Back (or anything else) removes the sheet during the
 *     exit: the screen unmounts and the pending exit is cancelled with it;
 *   · something is presented OVER the sheet during the exit: it blurs, the
 *     exit is abandoned and the sheet is usable again underneath;
 *   · the timer fires but the sheet is no longer in front: it does nothing;
 *   · a second Close, Escape or scrim press during the exit: ignored.
 * During the exit the scrim still takes presses (they land on Close, which
 * is ignored), so the tab behind cannot be operated -- MOVE cannot be
 * reopened -- until the sheet is really gone and the tab is uninert.
 *
 * `leaving()` lets a screen that has work in flight (the resolver's reads)
 * see that the member has already chosen to leave, so it does not navigate
 * somewhere else in the meantime.
 */
export function useSheetExit(reducedMotion: boolean): {
  phase: SheetPhase;
  exit: (go: () => void) => void;
  leaving: () => boolean;
} {
  const navigation = useNavigation();
  const [phase, setPhase] = useState<SheetPhase>(() => {
    ensureSheetMotionCss();
    return 'in';
  });
  const closing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const off = navigation.addListener('blur', () => {
      if (timer.current === null) return;
      clearTimeout(timer.current);
      timer.current = null;
      closing.current = false;
      setPhase('rest');
    });
    return () => {
      off();
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [navigation]);
  const exit = (go: () => void) => {
    if (closing.current) return;
    closing.current = true;
    if (reducedMotion || !onWeb()) {
      go();
      return;
    }
    setPhase('out');
    timer.current = setTimeout(() => {
      timer.current = null;
      if (!navigation.isFocused()) return;
      go();
    }, SHEET_OUT_MS);
  };
  return { phase, exit, leaving: () => closing.current };
}

/** The `dataSet` a sheet's panel and scrim carry for their phase. */
export type SheetPhase = 'in' | 'rest' | 'out';
export function sheetData(part: 'panel' | 'scrim', phase: SheetPhase): Record<string, unknown> {
  const key = part === 'panel' ? 'wsfSheetPanel' : 'wsfSheetScrim';
  return { dataSet: { [key]: phase } };
}

const FOCUSABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"]';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (n) =>
      !n.hasAttribute('disabled') &&
      n.getAttribute('aria-disabled') !== 'true' &&
      n.tabIndex >= 0 &&
      n.getClientRects().length > 0,
  );
}

/**
 * FOCUS ENTERS THE SHEET, AND STAYS IN IT WHILE IT IS IN FRONT.
 *
 * On open, focus goes to the sheet's first control, unless the member has
 * already put it inside. Tab and Shift+Tab then wrap at the sheet's edges, as
 * the reference's `Sheet` does. The tab behind is `inert` as well (the tab
 * layout does that, `focusReturn.ts`); the wrap is what keeps focus off the
 * browser's own chrome and anything the root layout draws outside the tabs.
 *
 * "In front" is the navigator's answer, not a guess: a contribution opened
 * from MOVE's chooser sits over the chooser, and while it does the chooser's
 * listener stands aside.
 */
export function useSheetFocusContainment(
  panel: RefObject<unknown>,
  enabled = true,
  stage: string | null = null,
): void {
  const navigation = useNavigation();
  const panelEl = () => (panel.current as HTMLElement | null) ?? null;
  /*
    F2 (W7 Check 36; Director #482 `5835326729`). Everything here answers to
    the dialog PANEL, never to the sheet's outer root: the root also holds the
    scrim, and handing the root in made the scrim the first "focusable"
    descendant -- measured: focus entered on the scrim, and the scrim was a
    Tab stop outside the panel. The panel's first control is its visible,
    named Close.
  */
  useEffect(() => {
    if (!onWeb() || !enabled) return;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const el = panelEl();
        if (!el || el.contains(document.activeElement)) return;
        focusables(el)[0]?.focus({ preventScroll: true });
      });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !navigation.isFocused()) return;
      const el = panelEl();
      if (!el) return;
      const nodes = focusables(el);
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (!active || !el.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, navigation, enabled]);

  /*
    A STEP THAT REPLACES THE ONE THE MEMBER WAS ON. The flow swaps its steps
    in place (count → review → pending / unknown → receipt), and the control
    the member pressed goes with the step it was on, so the browser drops
    focus onto BODY -- measured on every step change. When that happens, and
    only then, focus goes to the new step's level-1 heading (made focusable
    for the purpose), else to the panel's first control. Focus the member
    has placed on a live control in the panel is never moved.
  */
  const firstStage = useRef(true);
  useEffect(() => {
    if (!onWeb() || !enabled || stage === null) return;
    if (firstStage.current) {
      firstStage.current = false;
      return;
    }
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const el = panelEl();
        if (!el || !navigation.isFocused()) return;
        const active = document.activeElement as HTMLElement | null;
        const lost =
          !active ||
          active === document.body ||
          !active.isConnected ||
          !el.contains(active) ||
          active.getClientRects().length === 0;
        if (!lost) return;
        const heading = Array.from(
          el.querySelectorAll<HTMLElement>('[role="heading"][aria-level="1"], h1'),
        ).find((h) => h.getClientRects().length > 0);
        if (heading) {
          if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
          return;
        }
        focusables(el)[0]?.focus({ preventScroll: true });
      });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, enabled, navigation]);
}

/**
 * The props that keep a scrim a pointer target and nothing else. On the web
 * react-native-web's `Pressable` renders `tabindex="0"` unless it is given a
 * `tabIndex` (`focusable={false}` does not reach it -- measured, F2), so the
 * scrim is told -1 outright and hidden from assistive technology: Close is
 * the named, reachable way out.
 */
export const SCRIM_PROPS = { tabIndex: -1, 'aria-hidden': true } as Record<string, unknown>;

/** Sets or clears `inert` on a web element; nothing elsewhere. */
export function setInert(el: HTMLElement | null, on: boolean): void {
  if (!el) return;
  if (on) el.setAttribute('inert', '');
  else el.removeAttribute('inert');
}
