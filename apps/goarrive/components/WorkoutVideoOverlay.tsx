import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { watchVideoAdmission } from '../lib/videoAdmissionWatch';
import { loadZoomEmbedded } from '../lib/zoomEmbeddedLoader';
import { bounded, createZoomLease, videoCapability } from '../lib/zoomClientLifecycle';
import { watchZoomSelfView } from '../lib/zoomSelfView';
import { videoJoinError, VideoJoinStage } from '../lib/videoJoinError';

export default function WorkoutVideoOverlay({ sessionInstanceId, variant, joinLabel }: {
  sessionInstanceId: string; variant: 'pip' | 'pane'; autoStartCamera?: boolean; joinLabel?: string;
}) {
  const { user } = useAuth();
  const viewport = useWindowDimensions();
  // Magnify the entire SDK surface, including its native controls.
  const expandedScale = Math.max(0.5, Math.min(1.5, (viewport.width - 40) / 320, (viewport.height - 300) / 240));
  const [available, setAvailable] = useState(false);
  const [admission, setAdmission] = useState<{ recordingMode?: string; binding?: string }>({});
  const [phase, setPhase] = useState<'idle' | 'joining' | 'joined' | 'error'>('idle');
  const [error, setError] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [cameraOn, setCameraOn] = useState<boolean | null>(null);
  const selfView = useRef<ReturnType<typeof watchZoomSelfView> | null>(null);
  const [minimized, setMinimized] = useState(false);
  const sdkScale = minimized ? 0.45 : expandedScale;
  const autoCompactDone = useRef(false);
  const root = useRef<HTMLDivElement | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const lease = useRef<ReturnType<typeof createZoomLease> | null>(null);
  const close = useCallback(async () => {
    generation.current++; busy.current = false;
    selfView.current?.close(); selfView.current = null; setCameraOn(null);
    const previous = lease.current; lease.current = null;
    if (previous) { try { await previous.close(); } catch { /* local ownership still releases */ } }
  }, []);
  useEffect(() => {
    let binding: string | undefined;
    setAvailable(false); setAdmission({}); setPhase('idle'); setError(''); setMinimized(false); setPanelOpen(false);
    const deny = () => { setAdmission({}); setAvailable(false); setPhase('idle'); void close(); };
    if (!user || Platform.OS !== 'web') return () => { void close(); };
    const stop = watchVideoAdmission(
      () => bounded(httpsCallable<any, { enabled: boolean; binding?: string; recordingMode?: string; validForMs?: number }>(functions, 'getSessionVideoAvailability')({ sessionInstanceId })),
      ({ data }) => {
        if (binding && binding !== data.binding) { setPhase('idle'); void close(); }
        binding = data.binding; setAdmission({ binding: data.binding, recordingMode: data.recordingMode }); setAvailable(data.enabled);
        if (!data.enabled) deny();
      }, deny, 15000, 25000, value => value.data.validForMs ?? 0,
    );
    return () => { stop(); void close(); };
  }, [sessionInstanceId, user?.uid, close]);
  useEffect(() => { if (phase === 'joined' && !minimized) selfView.current?.refresh(); }, [phase, minimized, variant]);
  useEffect(() => {
    if (phase !== 'joined' || cameraOn !== true || variant !== 'pip' || autoCompactDone.current) return;
    // Camera-on is a UX trigger, not evidence of visible frames. Never starts media.
    const timer = setTimeout(() => { if (!autoCompactDone.current) { autoCompactDone.current = true; setMinimized(true); } }, 6000);
    return () => clearTimeout(timer);
  }, [phase, cameraOn, variant]);
  const join = async () => {
    if (busy.current || !available || !user) return;
    if (!videoCapability()) { setError('This browser cannot use live video. You can continue your workout.'); setPhase('error'); return; }
    setPanelOpen(true); autoCompactDone.current = false;
    const current = generation.current; busy.current = true; setPhase('joining'); setError(''); setMinimized(false);
    const isCurrent = () => current === generation.current;
    let owned: ReturnType<typeof createZoomLease> | null = null;
    let stage: VideoJoinStage = 'access';
    try {
      // Admission is rechecked before signing; no meeting is allocated by this request.
      const { data: config } = await bounded(httpsCallable<any, any>(functions, 'getEmbeddedSessionJoinConfig')({ sessionInstanceId, purpose: 'workout_video', ...(admission.recordingMode === 'cloud' ? { recordingConsentBinding: admission.binding } : {}) }));
      if (!isCurrent()) return;
      stage = 'download';
      const sdk = await loadZoomEmbedded();
      if (!isCurrent() || !root.current) return;
      let client: any;
      owned = createZoomLease(() => { client = sdk.createClient(); return { client, destroy: () => sdk.destroyClient() }; });
      lease.current = owned;
      stage = 'initialize';
      await owned.run(async active => {
        await client.init({ zoomAppRoot: root.current, language: 'en-US', patchJsMedia: true, leaveOnPageUnload: true, customize: { meetingInfo: [], video: { isResizable: false, viewSizes: { default: variant === 'pip' ? { width: 320, height: 240 } : { width: 640, height: 420 } } } } });
        if (!active() || !isCurrent()) return;
        stage = 'join';
        await client.join({ signature: config.signature, meetingNumber: config.meetingNumber, password: config.password || '', userName: config.userName || 'Member', userEmail: config.userEmail || '' });
      }, 60000);
      if (isCurrent() && !owned.cancelled && root.current) {
        selfView.current = watchZoomSelfView(client, root.current, setCameraOn);
        setPhase('joined');
      }
    } catch (failure) {
      if (owned) { try { await owned.close(); } catch {} if (lease.current === owned) lease.current = null; }
      if (isCurrent()) { setError(videoJoinError(stage, failure)); setPhase('error'); }
    } finally { if (isCurrent()) busy.current = false; }
  };
  if (!available || Platform.OS !== 'web') return null;
  const joined = phase === 'joined';
  const buttonStyle = { minHeight: 48, minWidth: 48, padding: 12, borderRadius: 10, backgroundColor: '#263244', alignItems: 'center' as const, justifyContent: 'center' as const };
  if (!panelOpen && phase === 'idle') return <Pressable accessibilityRole="button" accessibilityLabel="Open camera and microphone controls" style={buttonStyle} onPress={() => { setPanelOpen(true); if (admission.recordingMode !== 'cloud') void join(); }}><Text style={{ color: '#F5A623', fontSize: 20 }}>Camera</Text></Pressable>;
  return <View style={{ width: variant === 'pip' ? 320 * sdkScale + 12 : '100%', backgroundColor: '#151B26', borderRadius: 12, padding: 6 }}>
    <View style={{ width: variant === 'pip' ? 320 * sdkScale : '100%', height: joined || phase === 'joining' ? (variant === 'pip' ? 240 * sdkScale : 420) : 0 }}>
      <div ref={root} inert={minimized || undefined} style={{ display: 'block', width: variant === 'pip' ? 320 : '100%', height: joined || phase === 'joining' ? (variant === 'pip' ? 240 : 420) : 0, zoom: variant === 'pip' ? sdkScale : undefined }} />
      {joined && minimized && <Pressable accessibilityRole="button" accessibilityLabel="Expand live video and controls" onPress={() => { autoCompactDone.current = true; setMinimized(false); }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />}
    </View>
    {joined && <View style={{ gap: 6, paddingTop: 6 }}>
      {variant === 'pip' && <Pressable accessibilityRole="button" accessibilityLabel={minimized ? 'Expand live video and controls' : 'Make live video small'} style={buttonStyle} onPress={() => { autoCompactDone.current = true; setMinimized(value => !value); }}><Text style={{ color: '#F5A623' }}>{minimized ? 'Expand' : 'Small view'}</Text></Pressable>}
      {!minimized && <Pressable accessibilityRole="button" style={buttonStyle} onPress={() => selfView.current?.refresh()}><Text style={{ color: '#F5A623' }}>Refresh video view</Text></Pressable>}
    </View>}
    {phase !== 'joined' && <View style={{ gap: 10, padding: 8 }}>
      {admission.recordingMode === 'cloud' && <Text style={{ color: '#FCD34D' }}>Cloud recording: audio and video you share will be recorded. Joining may start recording.</Text>}
      {!!error && <Text accessibilityRole="alert" style={{ color: '#FCA5A5' }}>{error}</Text>}
      {phase === 'joining' ? <ActivityIndicator accessibilityLabel="Connecting video" /> : <Pressable accessibilityRole="button" style={buttonStyle} onPress={join}><Text style={{ color: '#F5A623', fontSize: 18 }}>{admission.recordingMode === 'cloud' ? 'Agree and join recorded video' : phase === 'error' ? 'Retry video' : joinLabel || 'Join video'}</Text></Pressable>}
      {phase === 'idle' && <Pressable accessibilityRole="button" style={buttonStyle} onPress={() => setPanelOpen(false)}><Text style={{ color: '#F0F4F8' }}>Continue without video</Text></Pressable>}
    </View>}
    {(phase === 'joining' || phase === 'joined') && <Pressable accessibilityRole="button" style={buttonStyle} onPress={() => { const stopping = close(); const current = generation.current; void stopping.then(() => { if (current === generation.current) { setPhase('idle'); setPanelOpen(false); } }); }}><Text style={{ color: '#F5A623' }}>{phase === 'joining' ? 'Cancel video connection' : 'Leave video'}</Text></Pressable>}
  </View>;
}
