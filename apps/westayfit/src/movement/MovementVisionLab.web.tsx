import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { CountPanel, LabBanner, LabButton, PRIVACY_LINE, Row, labStyles, stateColor } from './LabParts';
import { MovementSession, type SessionSnapshot } from './session';
import { labDemoScene } from './synthetic';
import type { Pose } from './types';
import { MovementCameraLifecycle, type CameraFailureStage } from './web/cameraLifecycle';
import { createMediaPipeEstimator } from './web/mediapipe';
import { drawOverlay } from './web/overlay';

/**
 * THE WEB LAB. Two sources feed the same MovementSession:
 *
 *   camera    — getUserMedia self-view → MediaPipe PoseLandmarker, in this tab.
 *   synthetic — the scripted scene in synthetic.ts, no camera. For watching
 *               the lock and counter behave on known input; it proves
 *               nothing about real bodies and is labelled as such on screen.
 *
 * PRIVACY, MECHANICALLY: the video element's frames go to the estimator and
 * nowhere else. There is no canvas readback, no MediaRecorder, no network
 * call and no storage in this module (tests/movement-privacy.test.ts scans
 * src/movement for exactly those APIs). Stopping, leaving the route or
 * switching source stops every camera track. Hiding the page stops the run;
 * returning to it never opens the camera automatically.
 */

/** `?delegate=cpu` in the URL forces the CPU path (see createMediaPipeEstimator). */
function requestedDelegate(): 'GPU' | 'CPU' {
  try {
    return new URLSearchParams(window.location.search).get('delegate')?.toLowerCase() === 'cpu' ? 'CPU' : 'GPU';
  } catch {
    return 'GPU';
  }
}

type Status = 'idle' | 'starting' | 'camera' | 'synthetic' | 'denied' | 'error' | 'manual';

export function MovementVisionLab() {
  const sessionRef = useRef<MovementSession | null>(null);
  if (!sessionRef.current) sessionRef.current = new MovementSession();
  const session = sessionRef.current;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lifecycleRef = useRef<MovementCameraLifecycle | null>(null);
  if (!lifecycleRef.current) {
    lifecycleRef.current = new MovementCameraLifecycle({
      getVideo: () => videoRef.current,
      getUserMedia: () => navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      }),
      createEstimator: () => createMediaPipeEstimator({ maxPoses: 3, delegate: requestedDelegate() }),
      requestFrame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id),
    });
  }
  const lifecycle = lifecycleRef.current;
  const focusedRef = useRef(false);
  const debugRef = useRef(true);

  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const [engine, setEngine] = useState<string | null>(null);
  const [snap, setSnap] = useState<SessionSnapshot>(session.snapshot);
  const [fps, setFps] = useState(0);
  const [people, setPeople] = useState(0);
  const [streamGaps, setStreamGaps] = useState(0);
  const [debug, setDebug] = useState(true);
  const [flash, setFlash] = useState<string | null>(null);

  const clearLiveView = useCallback(() => {
    setPeople(0);
    setFps(0);
    setEngine(null);
    setFlash(null);
    // Keep the completed count visible without claiming a stopped camera is
    // still tracking. Starting either source resets the underlying session.
    setSnap({
      ...session.snapshot,
      lockState: 'searching', lockReason: null, phase: 'unknown',
      depth: null, event: null, subject: null, subjectBox: null,
      candidates: [], progress: 0, counting: false, frameIssue: null,
    });
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, 9999, 9999);
  }, [session]);

  const pauseRun = useCallback((reason: string) => {
    if (!lifecycle.active) return;
    lifecycle.stop();
    clearLiveView();
    setStatus('idle');
    setMessage(`${reason} Start again when you are ready.`);
  }, [clearLiveView, lifecycle]);

  // Stack navigation can leave this screen mounted under another route.
  // Losing focus must cancel just as completely as unmounting the screen.
  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    return () => {
      focusedRef.current = false;
      pauseRun('The run stopped when you left this screen.');
    };
  }, [pauseRun]));

  useEffect(() => {
    const pause = () => pauseRun('The run stopped when this page was hidden.');
    const visibilityChanged = () => {
      if (document.visibilityState === 'hidden') pause();
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    window.addEventListener('pagehide', pause);
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged);
      window.removeEventListener('pagehide', pause);
      lifecycle.stop();
    };
  }, [lifecycle, pauseRun]);

  const onFrame = useCallback(
    (s: SessionSnapshot, poses: Pose[]) => {
      setSnap(s);
      setPeople(poses.length);
      // A gap or out-of-order frame voided whatever was in progress; show it.
      if (s.frameIssue) setStreamGaps((n) => n + 1);
      if (s.event === 'rep') setFlash('+1');
      else if (s.event === 'partial') setFlash('Half rep, not counted');
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (ctx) {
        drawOverlay(ctx, s, poses, stateColor(s.lockState), { debug: debugRef.current });
      }
    },
    [],
  );

  /** A frame-rate meter that updates once a second. */
  const fpsMeter = useRef({ n: 0, since: 0 });
  const tick = useCallback((now: number) => {
    const m = fpsMeter.current;
    m.n += 1;
    if (now - m.since >= 1000) {
      setFps(Math.round((m.n * 1000) / (now - m.since)));
      m.n = 0;
      m.since = now;
    }
  }, []);

  const prepareSource = useCallback(() => {
    lifecycle.stop();
    session.reset();
    clearLiveView();
    setStreamGaps(0);
    fpsMeter.current = { n: 0, since: performance.now() };
    setMessage(null);
  }, [clearLiveView, lifecycle, session]);

  const onCameraError = useCallback((stage: CameraFailureStage, error: unknown) => {
    clearLiveView();
    const name = (error as { name?: string })?.name;
    const detail = (error as Error)?.message ?? String(error);
    setStatus(stage === 'permission' && name === 'NotAllowedError' ? 'denied' : 'error');
    const reason = stage === 'permission'
      ? name === 'NotAllowedError'
        ? 'Camera permission was refused.'
        : `The camera could not start (${name ?? 'unknown error'}).`
      : stage === 'playback'
        ? 'The camera preview could not play.'
        : stage === 'model'
          ? `The pose model could not load: ${detail}`
          : stage === 'ended'
            ? 'The camera stream ended.'
            : 'Movement tracking stopped because the pose engine failed.';
    setMessage(`${reason} You can still count by hand.`);
  }, [clearLiveView]);

  const startCamera = useCallback(async () => {
    if (!focusedRef.current || document.visibilityState === 'hidden') return;
    prepareSource();
    setStatus('starting');
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setMessage('This browser cannot open a camera here (it needs HTTPS or localhost).');
      return;
    }
    await lifecycle.startCamera({
      onLoading: () => setMessage('Loading the pose model…'),
      onReady: (engineName) => {
        setEngine(engineName);
        setMessage(null);
        setStatus('camera');
      },
      onFrame: (frame, video, now) => {
        const canvas = canvasRef.current;
        if (canvas && (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight)) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }
        onFrame(session.update(frame), frame.poses);
        tick(now);
      },
      onError: onCameraError,
    });
  }, [lifecycle, onCameraError, onFrame, prepareSource, session, tick]);

  const startSynthetic = useCallback(() => {
    if (!focusedRef.current || document.visibilityState === 'hidden') return;
    prepareSource();
    setEngine('synthetic scene (scripted landmarks, no camera)');
    setStatus('synthetic');
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 640;
      canvas.height = 480;
    }
    const start = performance.now();
    lifecycle.startSynthetic((now) => {
      const t = now - start;
      const poses = labDemoScene(t);
      onFrame(session.update({ timestampMs: t, poses, aspect: 640 / 480 }), poses);
      tick(now);
    }, onCameraError);
  }, [lifecycle, onCameraError, onFrame, prepareSource, session, tick]);

  const stop = useCallback(() => {
    lifecycle.stop();
    clearLiveView();
    setStatus('idle');
    setMessage(null);
  }, [clearLiveView, lifecycle]);

  const switchToManual = useCallback(() => {
    lifecycle.stop();
    clearLiveView();
    setSnap(session.useManual());
    setMessage(null);
    setStatus('manual');
  }, [clearLiveView, lifecycle, session]);

  const reset = useCallback(() => {
    const wasManual = session.snapshot.mode === 'manual';
    session.reset();
    setStreamGaps(0);
    setSnap(wasManual ? session.useManual() : session.snapshot);
    setFlash(null);
  }, [session]);

  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 900);
    return () => clearTimeout(id);
  }, [flash, snap.reps]);

  const live = status === 'camera' || status === 'synthetic' || status === 'starting';
  const manual = status === 'manual';

  return (
    <View style={labStyles.page}>
      <LabBanner />
      <ScrollView contentContainerStyle={labStyles.scroll}>
        <Text style={labStyles.note}>
          Squats only. Stand so your whole body, head to feet, is in the middle of the frame, and stand
          tall until tracking locks on you. Only the locked person is counted, and anyone else near you
          pauses counting.
        </Text>
        <Text testID="mv-privacy" style={labStyles.note}>
          {PRIVACY_LINE}
        </Text>

        <Row>
          <LabButton testID="mv-start-camera" tone="primary" label="Start camera" onPress={startCamera} />
          <LabButton testID="mv-start-synthetic" label="Synthetic scene" onPress={startSynthetic} />
          <LabButton testID="mv-stop" label="Stop" onPress={stop} disabled={!live} />
          <LabButton testID="mv-manual" label="Count by hand instead" onPress={switchToManual} disabled={manual} />
        </Row>

        {message && (
          <Text testID="mv-message" style={status === 'denied' || status === 'error' ? labStyles.error : labStyles.note}>
            {message}
          </Text>
        )}

        <View
          style={{
            width: '100%',
            maxWidth: 640,
            aspectRatio: 4 / 3,
            backgroundColor: '#111827',
            borderRadius: 12,
            overflow: 'hidden',
            display: manual ? 'none' : 'flex',
          }}
        >
          {/* Mirrored self-view; the overlay is mirrored with it, the data never is. */}
          <video
            ref={videoRef}
            data-testid="mv-video"
            playsInline
            muted
            autoPlay
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: 'scaleX(-1)',
              display: status === 'camera' || status === 'starting' ? 'block' : 'none',
            }}
          />
          <canvas
            ref={canvasRef}
            data-testid="mv-overlay"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: status === 'camera' ? 'scaleX(-1)' : undefined,
            }}
          />
          {status === 'synthetic' && (
            <Text style={{ position: 'absolute', left: 8, top: 8, color: '#fde68a', fontSize: 12, fontWeight: '700' }}>
              SYNTHETIC SCENE, NOT A CAMERA
            </Text>
          )}
          {flash && (
            <Text
              testID="mv-flash"
              style={{ position: 'absolute', right: 12, top: 8, color: '#ffffff', fontSize: 28, fontWeight: '800' }}
            >
              {flash}
            </Text>
          )}
        </View>

        <CountPanel snap={snap}>
          <Row>
            {manual ? (
              <>
                <LabButton testID="mv-plus" tone="primary" label="+1 squat" onPress={() => setSnap(session.tap(1))} />
                <LabButton testID="mv-minus" label="−1" onPress={() => setSnap(session.tap(-1))} />
              </>
            ) : null}
            <LabButton testID="mv-reset" label="Reset count" onPress={reset} />
            {!manual && (
              <LabButton
                testID="mv-debug"
                label={debug ? 'Hide debug overlay' : 'Show debug overlay'}
                onPress={() => {
                  debugRef.current = !debug;
                  setDebug(!debug);
                }}
              />
            )}
          </Row>
        </CountPanel>

        {debug && !manual && (
          <Text testID="mv-debug-readout" style={labStyles.mono}>
            {[
              `engine: ${engine ?? 'none yet'}`,
              `source: ${status}   fps: ${fps}   people detected: ${people}`,
              `lock: ${snap.lockState}${snap.lockReason ? ` (${snap.lockReason})` : ''}   progress: ${Math.round(snap.progress * 100)}%`,
              `phase: ${snap.phase}   depth: ${snap.depth === null ? 'n/a' : snap.depth.toFixed(2)}   counting: ${snap.counting}`,
              `half reps seen (not counted): ${snap.partials}`,
              `stream interruptions (rep in progress voided): ${streamGaps}${snap.frameIssue ? ` — now: ${snap.frameIssue}` : ''}`,
            ].join('\n')}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
