import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import type { PoseEstimator } from './adapter';
import { CountPanel, LabBanner, LabButton, PRIVACY_LINE, Row, labStyles, stateColor } from './LabParts';
import { MovementSession, type SessionSnapshot } from './session';
import { labDemoScene } from './synthetic';
import type { Pose } from './types';
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
 * switching source stops every camera track.
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
  const streamRef = useRef<MediaStream | null>(null);
  const estimatorRef = useRef<PoseEstimator | null>(null);
  const rafRef = useRef<number | null>(null);
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

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }, []);

  const stopCamera = useCallback(() => {
    stopLoop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [stopLoop]);

  useEffect(
    () => () => {
      stopCamera();
      estimatorRef.current?.close();
      estimatorRef.current = null;
    },
    [stopCamera],
  );

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

  const startCamera = useCallback(async () => {
    stopCamera();
    session.reset();
    setStreamGaps(0);
    setSnap(session.snapshot);
    setMessage(null);
    setStatus('starting');
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setMessage('This browser cannot open a camera here (it needs HTTPS or localhost).');
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setStatus('denied');
      setMessage(
        name === 'NotAllowedError'
          ? 'Camera permission was refused. You can still count by hand.'
          : `The camera could not start (${name ?? 'unknown error'}). You can still count by hand.`,
      );
      return;
    }
    streamRef.current = stream;
    const video = videoRef.current!;
    video.srcObject = stream;
    await video.play().catch(() => undefined);

    try {
      if (!estimatorRef.current) {
        setMessage('Loading the pose model…');
        estimatorRef.current = await createMediaPipeEstimator({ maxPoses: 3, delegate: requestedDelegate() });
      }
      setEngine(estimatorRef.current.engine);
      setMessage(null);
    } catch (e) {
      stopCamera();
      setStatus('error');
      setMessage(`The pose model could not load: ${(e as Error)?.message ?? String(e)}`);
      return;
    }
    setStatus('camera');

    let lastVideoTime = -1;
    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);
      const v = videoRef.current;
      const est = estimatorRef.current;
      if (!v || !est || v.readyState < 2 || v.currentTime === lastVideoTime) return;
      lastVideoTime = v.currentTime;
      const canvas = canvasRef.current;
      if (canvas && (canvas.width !== v.videoWidth || canvas.height !== v.videoHeight)) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
      }
      const frame = est.estimate(v, now);
      onFrame(session.update(frame), frame.poses);
      tick(now);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [onFrame, session, stopCamera, tick]);

  const startSynthetic = useCallback(() => {
    stopCamera();
    session.reset();
    setStreamGaps(0);
    setSnap(session.snapshot);
    setMessage(null);
    setEngine('synthetic scene (scripted landmarks, no camera)');
    setStatus('synthetic');
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 640;
      canvas.height = 480;
    }
    const start = performance.now();
    const loop = (now: number) => {
      rafRef.current = requestAnimationFrame(loop);
      const t = now - start;
      const poses = labDemoScene(t);
      onFrame(session.update({ timestampMs: t, poses, aspect: 640 / 480 }), poses);
      tick(now);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [onFrame, session, stopCamera, tick]);

  const stop = useCallback(() => {
    stopCamera();
    setStatus('idle');
    setPeople(0);
    canvasRef.current?.getContext('2d')?.clearRect(0, 0, 9999, 9999);
  }, [stopCamera]);

  const switchToManual = useCallback(() => {
    stopCamera();
    setSnap(session.useManual());
    setStatus('manual');
  }, [session, stopCamera]);

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
