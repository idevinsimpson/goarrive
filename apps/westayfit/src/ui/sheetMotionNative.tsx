import { useNavigation } from 'expo-router';
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, type ComponentProps } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  View,
  type GestureResponderHandlers,
  type PanResponderInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { claimNativeSheetExit, SHEET_IN_MS, SHEET_OUT_MS, type SheetPhase } from './sheetMotion';
import type { ReducedMotionPreference } from './useReducedMotion';

/**
 * MO-02 — A MEMBER SHEET ON iOS AND ANDROID COMES AND GOES THE WAY IT DOES ON
 * THE WEB.
 *
 * The web plays the reference's sheet motion as CSS keyframes keyed on
 * `dataSet` (src/ui/sheetMotion.ts). Native has no stylesheet, and the stack's
 * own `slide_from_bottom` moved the whole screen -- the scrim with it, as one
 * dark block -- and left at once on Close. So the stack now presents the sheet
 * without travel (`animation: 'none'`, app/_layout.tsx) and the sheet plays the
 * same numbers itself, with core Animated on the native driver:
 *
 *   · in:  the scrim fades 0 → 1 over 240 ms, ease-out, IN PLACE (it never
 *          moves); the panel rises 28 pt and fades in over 240 ms,
 *          cubic-bezier(.22,1,.36,1) (`side`: from 32 pt to the right);
 *   · out: both reverse over 180 ms, cubic-bezier(.4,0,1,1); `useSheetExit`
 *          navigates when that ends (while these parts are mounted they claim
 *          their screen, so its exit waits for them on native), and the panel
 *          takes no presses meanwhile;
 *   · a hand-off (MOVE replacing itself with one goal's flow): the scrim is
 *          already up, so it mounts at full opacity and does not fade again.
 *
 * REDUCED MOTION, AND A PREFERENCE NOT YET HEARD. A member who asked for
 * reduced motion gets no travel at all: the sheet is simply there, and Close
 * navigates at once. On a phone the preference answers asynchronously, and an
 * unread preference is never permission to move: until this mount has heard it
 * the sheet holds at its starting point and does not travel. It travels only
 * once the answer says it may; if no answer comes within
 * SHEET_PREFERENCE_WAIT_MS, or reading it failed, it appears at rest with no
 * travel. A cached `true` (useReducedMotionPreference seeds `reduced`) puts it
 * at rest from the first frame.
 *
 * Reduced motion turned on mid-flight ends the motion at once: at rest during
 * the entry, gone during the exit. Blurred mid-exit (something presented over
 * the sheet: `useSheetExit` sets `rest`), the sheet is back at rest. An entry
 * overtaken while it runs is stopped where it is: a Close inside its 240 ms
 * leaves from that point, and a re-run of the same phase (React StrictMode's
 * development double-invoke, or a preference re-read) finishes it. Unmounting
 * stops whatever is running.
 *
 * WEB. Metro resolves sheetMotionNative.web.ts there instead: the hook returns
 * null and the wrappers render the screen's own Pressable and View with the
 * props they are given, so the web keeps its CSS motion and its DOM. Vitest
 * does not apply platform extensions and loads this file for web tests too, so
 * it answers the same way when Platform.OS is 'web'.
 */

export type SheetPart = 'panel' | 'scrim' | 'side';
export type SheetMotionOptions = { preference: ReducedMotionPreference; handoff?: boolean };

/** The panel's rise (the web's translateY(28px)). */
export const SHEET_RISE_PX = 28;
/** The side panel's travel (the web's translateX(32px)). */
export const SIDE_SHIFT_PX = 32;
/** The panel's entry: cubic-bezier(.22,1,.36,1). */
export const SHEET_IN_EASING = [0.22, 1, 0.36, 1] as const;
/** The scrim's entry: CSS `ease-out`, cubic-bezier(0, 0, .58, 1). */
export const SCRIM_IN_EASING = [0, 0, 0.58, 1] as const;
/** Every part's exit: cubic-bezier(.4,0,1,1). */
export const SHEET_OUT_EASING = [0.4, 0, 1, 1] as const;
/** How long a sheet holds, unseen, for a reduced-motion preference not yet heard. */
export const SHEET_PREFERENCE_WAIT_MS = 150;

type AnimatedSheetStyle = {
  opacity: Animated.Value;
  transform?: Array<{ translateY: Animated.AnimatedInterpolation<number> } | { translateX: Animated.AnimatedInterpolation<number> }>;
};

/**
 * The animated style for one part of a sheet in `phase`; null on the web.
 * `progress` runs 0 (the starting point: transparent, shifted) → 1 (rest).
 */
export function useNativeSheetMotion(
  part: SheetPart,
  phase: SheetPhase,
  { preference, handoff = false }: SheetMotionOptions,
): AnimatedSheetStyle | null {
  const native = Platform.OS !== 'web';
  const { reduced, known, failed } = preference;
  const navigation = useNavigation();

  // This screen's exit is seen on native, so `useSheetExit` waits for it.
  useEffect(() => (native ? claimNativeSheetExit(navigation) : undefined), [native, navigation]);

  const progressRef = useRef<Animated.Value | null>(null);
  // Whether the entry has been decided (played, or skipped for no travel).
  const entryDecided = useRef(false);
  if (progressRef.current === null) {
    // A hand-off's scrim is already up: at rest, and it does not fade again.
    const handedOff = part === 'scrim' && handoff;
    entryDecided.current = handedOff;
    progressRef.current = new Animated.Value(handedOff ? 1 : 0);
  }
  const progress = progressRef.current;
  const running = useRef<Animated.CompositeAnimation | null>(null);
  // An entry stopped part-way by its effect's cleanup, not yet resumed or overtaken.
  const interrupted = useRef(false);

  const stop = () => {
    running.current?.stop();
    running.current = null;
  };
  const jump = (to: 0 | 1) => {
    stop();
    progress.setValue(to);
  };
  const play = (to: 0 | 1) => {
    stop();
    const [x1, y1, x2, y2] = to === 0 ? SHEET_OUT_EASING : part === 'scrim' ? SCRIM_IN_EASING : SHEET_IN_EASING;
    const run = Animated.timing(progress, {
      toValue: to,
      duration: to === 1 ? SHEET_IN_MS : SHEET_OUT_MS,
      easing: Easing.bezier(x1, y1, x2, y2),
      useNativeDriver: true,
    });
    running.current = run;
    run.start(({ finished }) => {
      if (finished && running.current === run) running.current = null;
    });
  };

  // The entry belongs to the effect that starts it. Overtaken while it runs
  // (a new phase or preference, React StrictMode's development re-run, or an
  // unmount), it is STOPPED WHERE IT IS and marked interrupted; it is never
  // snapped to rest, so a Close inside the 240 ms leaves from that point
  // rather than jumping to rest first (RV12-634-F2). The next run decides:
  // 'out' leaves from there, 'rest' or reduced motion puts it at rest, and the
  // same phase finishes the entry, so it is never left part-way with a
  // transparent panel and a scrim swallowing taps (RV10-634-N1).
  const enter = () => {
    interrupted.current = false;
    play(1);
    return () => {
      if (running.current === null) return;
      stop();
      interrupted.current = true;
    };
  };

  // A layout effect, so the first painted frame is already at the starting point.
  useLayoutEffect(() => {
    if (!native) return;
    if (phase === 'out') {
      // `useSheetExit` sets 'out' only when it waits, which it does only once
      // the preference allowed travel. It leaves from wherever the sheet is,
      // an interrupted entry included. Reduced motion turned on during the
      // exit ends it at once.
      interrupted.current = false;
      if (reduced) jump(0);
      else play(0);
      return;
    }
    if (phase === 'rest') {
      entryDecided.current = true;
      interrupted.current = false;
      jump(1);
      return;
    }
    if (entryDecided.current) {
      if (reduced) {
        // Reduced motion asked for during the entry: end it at rest.
        interrupted.current = false;
        jump(1);
        return;
      }
      // An entry this mount stopped part-way: finish it from there.
      if (interrupted.current) return enter();
      return;
    }
    if (reduced || failed) {
      entryDecided.current = true;
      jump(1);
      return;
    }
    // Not heard yet: hold at the starting point (the deadline below bounds it).
    if (!known) return;
    entryDecided.current = true;
    return enter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, phase, reduced, known, failed]);

  // A preference that never answers: at rest, without travel.
  useEffect(() => {
    if (!native || known || failed || reduced) return;
    // An answer, or reduced motion, before then re-runs this and clears it.
    const t = setTimeout(() => {
      entryDecided.current = true;
      jump(1);
    }, SHEET_PREFERENCE_WAIT_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [native, known, failed, reduced]);

  // Nothing outlives the sheet.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => stop(), []);

  const style = useMemo<AnimatedSheetStyle>(() => {
    if (part === 'scrim') return { opacity: progress };
    const shift = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [part === 'side' ? SIDE_SHIFT_PX : SHEET_RISE_PX, 0],
    });
    return { opacity: progress, transform: [part === 'side' ? { translateX: shift } : { translateY: shift }] };
  }, [part, progress]);

  return native ? style : null;
}

type SheetMotionProps = {
  /** The sheet's phase, from `useSheetExit`. */
  phase: SheetPhase;
  /** The screen's useReducedMotionPreference(), shared by its parts. */
  preference: ReducedMotionPreference;
  /** The scrim is already up (a MOVE hand-off): it starts at full opacity. */
  handoff?: boolean;
};

export type SheetScrimProps = Omit<ComponentProps<typeof Pressable>, 'style'> & {
  style?: StyleProp<ViewStyle>;
} & SheetMotionProps;

export type SheetPanelProps = ComponentProps<typeof View> & SheetMotionProps & { part?: 'panel' | 'side' };

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * A sheet's scrim. Takes the screen's own Pressable props unchanged; on iOS
 * and Android it fades in place, and on the web it is that Pressable.
 */
export const SheetScrim = forwardRef<View, SheetScrimProps>(function SheetScrim(
  { phase, preference, handoff, style, ...rest },
  ref,
) {
  const motion = useNativeSheetMotion('scrim', phase, { preference, handoff });
  if (motion === null) return <Pressable ref={ref} style={style} {...rest} />;
  return <AnimatedPressable ref={ref} {...rest} style={[style, motion]} />;
});

/**
 * A sheet's panel (or, `part="side"`, a side panel). Takes the screen's own
 * View props unchanged; on iOS and Android it rises and fades, takes no
 * presses while it leaves, and on the web it is that View.
 */
export const SheetPanel = forwardRef<View, SheetPanelProps>(function SheetPanel(
  { phase, preference, handoff, part = 'panel', style, ...rest },
  ref,
) {
  const motion = useNativeSheetMotion(part, phase, { preference, handoff });
  if (motion === null) return <View ref={ref} style={style} {...rest} />;
  return (
    <Animated.View
      ref={ref}
      {...rest}
      style={[style, motion]}
      pointerEvents={phase === 'out' ? 'none' : rest.pointerEvents}
    />
  );
});

/**
 * MO-03 (W14-5) — A SIDE PANEL SWIPES AWAY TO THE RIGHT, on iOS and Android.
 *
 * Settings comes in from the right; a member can send it back the same way.
 * A drag that is clearly rightward claims the gesture: past 16 pt, and more
 * than twice as far across as down, so the panel's own vertical scrolling is
 * never taken. On release, a drag past 60 pt, or a fast rightward flick past
 * 30 pt, closes the panel through the screen's own Close -- the same 180 ms
 * exit, the same guards. The flick's floor is above a switch's slide (24 pt
 * or less), so flicking one of the panel's switches never closes it
 * (RV12-634-F3). The panel does not follow the finger. The web has no such
 * gesture: there (and in the web build's stub) this returns no handlers at all.
 */
export const SIDE_SWIPE_CLOSE_PT = 60;
/** A rightward flick, in points per millisecond. */
export const SIDE_FLICK_VX = 0.5;
/** How far a flick must travel to close: past a switch's slide (24 pt or less). */
export const SIDE_FLICK_MIN_PT = 30;
/** How far a rightward drag goes before the panel claims it. */
export const SIDE_SWIPE_CLAIM_PT = 16;

/** Whether a move is the side panel's swipe: rightward, and more than twice as far across as down. */
export function sideSwipeClaims(g: { dx: number; dy: number }): boolean {
  return g.dx > SIDE_SWIPE_CLAIM_PT && g.dx > Math.abs(g.dy) * 2;
}

/** Whether a released swipe closes the side panel: far enough, or flicked past a switch's slide. */
export function sideSwipeCloses(g: { dx: number; vx: number }): boolean {
  return g.dx > SIDE_SWIPE_CLOSE_PT || (g.dx > SIDE_FLICK_MIN_PT && g.vx > SIDE_FLICK_VX);
}

const NO_HANDLERS: GestureResponderHandlers = Object.freeze({});

/** The side panel's swipe-to-close handlers (native), or none (web). */
export function useSideSwipeToClose(close: () => void): GestureResponderHandlers {
  const closeRef = useRef(close);
  closeRef.current = close;
  const responder = useRef<PanResponderInstance | null>(null);
  if (responder.current === null) {
    responder.current = PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => sideSwipeClaims(g),
      onPanResponderRelease: (_e, g) => {
        if (sideSwipeCloses(g)) closeRef.current();
      },
      onPanResponderTerminationRequest: () => true,
    });
  }
  return Platform.OS !== 'web' ? responder.current.panHandlers : NO_HANDLERS;
}

// Names the native wrappers (and marks this module in a native export; the web
// export must not carry them: tests/web-bundle-native-motion.test.ts).
SheetScrim.displayName = 'wsf-sheet-motion-native-scrim';
SheetPanel.displayName = 'wsf-sheet-motion-native-panel';
