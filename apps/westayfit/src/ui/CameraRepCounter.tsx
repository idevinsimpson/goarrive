/**
 * THE CAMERA SQUAT COUNTER — the full-screen camera a squat "Start moving"
 * opens straight into (MOVE-CAMERA-NATIVE-PORT-1, frozen camera-squat
 * reference `camera-count.tsx`).
 *
 * What a member sees, in order: plain step-back guidance while they are
 * found; "Stand tall — getting ready" once they are; an automatic 3-2-1 that
 * starts only on a stable full-body view and cancels if they step out; then a
 * large live count that starts at 0 (the GO baseline), one Finish, and a
 * brief "Step back into view" if they are lost for a moment. Finish freezes
 * the estimate and releases the camera; the number goes to Adjust and then to
 * the EXISTING review. Nothing here contributes anything.
 *
 * RELEASED ON EVERY WAY OUT: Finish, Close, Count by hand, Escape, a hidden
 * page or an unmount stop the source (tracks stopped, model closed). A hidden
 * page banks what was counted and shows "Camera paused"; nothing is invented.
 *
 * NO FRAME LEAVES THE DEVICE. Frames become landmarks in memory and are
 * dropped. No recording, no storage, no upload.
 */
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RepCounterController, type RepCounterView } from '../movement-camera/controller';
import { ACQUIRING, cameraCue, stepCountdown, type CountdownState } from '../movement-camera/flow';
import type { CameraFailure } from '../movement-camera/orchestrator';
import { CameraSkeletonOverlay } from './CameraSkeletonOverlay';
import { NAVY, PROGRESS_GREEN } from './kit';

export interface CameraRepCounterProps {
  showFigure: boolean;
  reducedMotion: boolean;
  onClose: () => void;
  onManual: () => void;
  onFinish: (estimatedReps: number) => void;
}

/** The reference polls the countdown every 100 ms on performance.now(). */
const COUNTDOWN_TICK_MS = 100;

export function CameraRepCounter(props: CameraRepCounterProps) {
  const { showFigure, reducedMotion } = props;
  const insets = useSafeAreaInsets();
  // The reference's clamp(112px, 34vw, 156px) and clamp(120px, 38vw, 170px).
  const vw = Math.min(useWindowDimensions().width, 430);
  const countSize = Math.max(112, Math.min(156, 0.34 * vw));
  const countdownSize = Math.max(120, Math.min(170, 0.38 * vw));

  const [ctl] = useState(() => new RepCounterController());
  const [view, setView] = useState<RepCounterView>(() => ctl.snapshot);
  const [countdown, setCountdown] = useState<{ state: CountdownState; display: number | null }>({
    state: ACQUIRING,
    display: null,
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const doneRef = useRef(false);
  const propsRef = useRef(props);
  propsRef.current = props;

  const start = useCallback(() => {
    if (doneRef.current) return;
    setCountdown({ state: ACQUIRING, display: null });
    void ctl.startCamera(videoRef.current);
  }, [ctl]);

  // Start on arrival; release everything on the way out.
  useEffect(() => {
    const unsubscribe = ctl.subscribe(setView);
    start();
    return () => {
      doneRef.current = true;
      unsubscribe();
      ctl.dispose();
    };
  }, [ctl, start]);

  // THE AUTOMATIC 3-2-1. Starts only from ready; any readiness loss resets it;
  // at GO the controller's beginSet() decides, and a refusal returns to acquiring.
  useEffect(() => {
    const id = setInterval(() => {
      setCountdown((cd) => {
        const snap = ctl.snapshot;
        let state = cd.state;
        if (state.phase === 'counting' && snap.phase !== 'counting' && snap.phase !== 'finished') state = ACQUIRING;
        const step = stepCountdown(state, snap.readyForCountdown, performance.now());
        let next = step.state;
        if (step.go && !ctl.beginSet()) next = ACQUIRING;
        if (next === cd.state && step.display === cd.display) return cd;
        return { state: next, display: step.display };
      });
    }, COUNTDOWN_TICK_MS);
    return () => clearInterval(id);
  }, [ctl]);

  const leave = useCallback(
    (how: 'close' | 'manual') => {
      if (doneRef.current) return;
      doneRef.current = true;
      ctl.dispose();
      if (how === 'close') propsRef.current.onClose();
      else propsRef.current.onManual();
    },
    [ctl],
  );

  const finish = useCallback(() => {
    if (doneRef.current) return;
    const est = ctl.finishSet();
    doneRef.current = true;
    ctl.dispose();
    propsRef.current.onFinish(est.estimatedReps);
  }, [ctl]);

  // Escape closes, and focus starts on Close.
  const closeRef = useRef<View>(null);
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    (closeRef.current as unknown as HTMLElement | null)?.focus?.();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      leave('close');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [leave]);

  const status = view.camera;
  const live = status === 'live';
  const counting = view.phase === 'counting';
  const failed = status === 'failed';
  const paused = status === 'paused';
  const cue = cameraCue({
    status,
    countingNow: counting,
    countdown: countdown.display,
    locked: view.locked,
    fullBody: view.fullBodyVisible,
  });
  const phase = !live ? status : counting ? 'counting' : countdown.display !== null ? 'countdown' : 'acquiring';
  const figure =
    showFigure && live && view.keypoints ? (
      <CameraSkeletonOverlay subject={view.keypoints} visual={view.visual} aspect={view.aspect} />
    ) : null;

  return (
    <View
      style={[st.screen, Platform.OS === 'web' ? (st.fixed as object) : null]}
      testID="wsf-camera-screen"
      {...({
        role: 'dialog',
        'aria-modal': true,
        'aria-label': 'Squat camera counter',
        dataSet: { phase, figure: showFigure ? 'on' : 'off', armed: view.armed ? 'true' : 'false' },
      } as Record<string, unknown>)}
    >
      {Platform.OS === 'web'
        ? createElement('video', {
            ref: (v: HTMLVideoElement | null) => {
              videoRef.current = v;
            },
            muted: true,
            playsInline: true,
            'aria-hidden': true,
            'data-testid': 'wsf-camera-video',
            style: videoStyle,
          })
        : null}
      {figure}
      <View style={st.shade} pointerEvents="none" />

      <View style={[st.top, { paddingTop: Math.max(12, insets.top) }]}>
        <Pressable
          ref={closeRef}
          onPress={() => leave('close')}
          accessibilityRole="button"
          accessibilityLabel="Close camera"
          style={st.close}
          testID="wsf-camera-close"
        >
          <View style={st.cross} aria-hidden>
            <View style={[st.stroke, st.strokeA]} />
            <View style={[st.stroke, st.strokeB]} />
          </View>
        </Pressable>
        <View style={st.labelWrap}>
          <Text style={st.label}>Squats</Text>
        </View>
        <View style={st.topSpacer} />
      </View>

      <View style={st.center} {...({ 'aria-live': 'polite' } as Record<string, unknown>)}>
        {failed ? (
          <FailurePanel failure={view.failure} onRetry={start} onManual={() => leave('manual')} />
        ) : paused ? (
          <View style={st.panel} testID="wsf-camera-paused" {...({ role: 'alert' } as Record<string, unknown>)}>
            <Text style={st.panelTitle}>Camera paused</Text>
            <Text style={st.panelBody}>
              {counting || view.setReps > 0 ? `${view.setReps} squats kept so far.` : 'Nothing was counted while paused.'}
            </Text>
            <Pressable onPress={start} accessibilityRole="button" style={st.primary} testID="wsf-camera-resume">
              <Text style={st.primaryText}>Resume camera</Text>
            </Pressable>
            <Pressable onPress={() => leave('manual')} accessibilityRole="button" style={st.secondary} testID="wsf-camera-manual">
              <Text style={st.secondaryText}>Enter reps manually</Text>
            </Pressable>
          </View>
        ) : counting ? (
          <View style={st.countWrap}>
            <Text style={[st.count, { fontSize: countSize, lineHeight: countSize * 1.07 }]} testID="wsf-camera-count">
              {String(view.setReps)}
            </Text>
            <Text style={st.unit}>SQUATS</Text>
          </View>
        ) : countdown.display !== null ? (
          <Text
            key={`cd${countdown.display}`}
            style={[
              st.countdown,
              { fontSize: countdownSize, lineHeight: countdownSize * 1.07 },
              reducedMotion ? null : (st.pop as object),
            ]}
            testID="wsf-camera-countdown"
          >
            {String(countdown.display)}
          </Text>
        ) : null}
        {cue ? (
          <View style={st.cue}>
            <Text style={st.cueText} testID="wsf-camera-cue">
              {cue}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={[st.bottom, { paddingBottom: Math.max(16, insets.bottom) }]}>
        {counting && live ? (
          <Pressable onPress={finish} accessibilityRole="button" style={st.finish} testID="wsf-camera-finish">
            <Text style={st.finishText}>Finish</Text>
          </Pressable>
        ) : null}
        {!counting && !failed && !paused ? (
          <Pressable onPress={() => leave('manual')} accessibilityRole="button" style={st.link} testID="wsf-camera-by-hand">
            <Text style={st.linkText}>Count by hand instead</Text>
          </Pressable>
        ) : null}
        <Text style={st.note}>Camera estimate on this device · nothing is recorded</Text>
      </View>
    </View>
  );
}

function FailurePanel({
  failure,
  onRetry,
  onManual,
}: {
  failure: CameraFailure | null;
  onRetry: () => void;
  onManual: () => void;
}) {
  if (failure === 'playback') {
    return (
      <View style={st.panel} testID="wsf-camera-failed" {...({ role: 'alert', dataSet: { failure } } as Record<string, unknown>)}>
        <Text style={st.panelTitle}>Tap to start the camera</Text>
        <Text style={st.panelBody}>Your browser needs one tap before the camera can start.</Text>
        <Pressable onPress={onRetry} accessibilityRole="button" style={st.primary} testID="wsf-camera-start">
          <Text style={st.primaryText}>Start camera</Text>
        </Pressable>
        <Pressable onPress={onManual} accessibilityRole="button" style={st.secondary} testID="wsf-camera-manual">
          <Text style={st.secondaryText}>Enter reps manually</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={st.panel} testID="wsf-camera-failed" {...({ role: 'alert', dataSet: { failure: failure ?? 'unsupported' } } as Record<string, unknown>)}>
      <Text style={st.panelTitle}>Camera isn’t available</Text>
      <Text style={st.panelBody}>You can still enter your squats by hand.</Text>
      <Pressable onPress={onManual} accessibilityRole="button" style={st.primary} testID="wsf-camera-manual">
        <Text style={st.primaryText}>Enter reps manually</Text>
      </Pressable>
    </View>
  );
}

const CAM_BG = '#050d18';
const CAM_FG = '#F6F9FD';
const CHIP = 'rgba(5,13,24,.55)';

const videoStyle = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  transform: 'scaleX(-1)',
  pointerEvents: 'none',
} as const;

const st = StyleSheet.create({
  screen: {
    flex: 1,
    width: '100%',
    maxWidth: 430,
    alignSelf: 'center',
    overflow: 'hidden',
    backgroundColor: CAM_BG,
    zIndex: 140,
  },
  fixed: { position: 'fixed', top: 0, bottom: 0, left: 0, right: 0, marginHorizontal: 'auto', height: '100dvh' } as never,
  shade: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    ...({
      backgroundImage:
        'linear-gradient(to bottom, rgba(5,13,24,.62), transparent 20%, transparent 62%, rgba(5,13,24,.78))',
    } as object),
  },
  top: {
    zIndex: 3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  close: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: CHIP,
    alignItems: 'center',
    justifyContent: 'center',
    ...({ backdropFilter: 'blur(6px)' } as object),
  },
  cross: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  stroke: { position: 'absolute', width: 20, height: 2.5, borderRadius: 2, backgroundColor: CAM_FG },
  strokeA: { transform: [{ rotate: '45deg' }] },
  strokeB: { transform: [{ rotate: '-45deg' }] },
  labelWrap: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, backgroundColor: CHIP },
  label: { color: CAM_FG, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  topSpacer: { width: 48, height: 48 },
  center: { zIndex: 3, flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 22 },
  countWrap: { alignItems: 'center' },
  count: {
    color: CAM_FG,
    fontSize: 140,
    lineHeight: 150,
    fontWeight: '800',
    letterSpacing: -8,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(0,0,0,.55)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 24,
  },
  unit: { color: PROGRESS_GREEN, fontSize: 18, fontWeight: '800', letterSpacing: 2.5, marginTop: 6 },
  countdown: {
    color: PROGRESS_GREEN,
    fontSize: 150,
    lineHeight: 160,
    fontWeight: '800',
    textShadowColor: 'rgba(0,0,0,.55)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 24,
  },
  pop: { animationName: { '0%': { transform: 'scale(1.35)', opacity: 0 }, '30%': { opacity: 1 }, '100%': { transform: 'scale(1)' } }, animationDuration: '900ms', animationTimingFunction: 'ease-out' } as never,
  cue: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(5,13,24,.66)',
    ...({ backdropFilter: 'blur(6px)' } as object),
  },
  cueText: { color: CAM_FG, fontSize: 16, fontWeight: '700' },
  bottom: { zIndex: 3, paddingTop: 10, paddingHorizontal: 18, gap: 8, alignItems: 'stretch' },
  finish: {
    minHeight: 58,
    borderRadius: 999,
    backgroundColor: PROGRESS_GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 10 },
  },
  finishText: { color: NAVY, fontSize: 18, fontWeight: '800' },
  link: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  linkText: { color: CAM_FG, fontSize: 14, textDecorationLine: 'underline' },
  note: { color: 'rgba(246,249,253,.72)', fontSize: 11, textAlign: 'center' },
  panel: { width: '100%', maxWidth: 320, padding: 20, borderRadius: 22, backgroundColor: 'rgba(9,27,48,.88)', gap: 10 },
  panelTitle: { color: CAM_FG, fontSize: 19, fontWeight: '800' },
  panelBody: { color: '#ADC0D7', fontSize: 14, lineHeight: 20 },
  primary: { minHeight: 52, borderRadius: 999, backgroundColor: PROGRESS_GREEN, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: NAVY, fontSize: 16, fontWeight: '800' },
  secondary: {
    minHeight: 52,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(246,249,253,.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: CAM_FG, fontSize: 16, fontWeight: '800' },
});
