import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { loadZoomEmbedded } from '../lib/zoomEmbeddedLoader';
import { createZoomLease, videoCapability } from '../lib/zoomClientLifecycle';

export default function SessionZoomTile({ sessionInstanceId, variant, joinLabel }: {
  sessionInstanceId: string; variant: 'pip' | 'pane'; autoStartCamera?: boolean; joinLabel?: string;
}) {
  const { user } = useAuth();
  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'joining' | 'joined' | 'error'>('idle');
  const [error, setError] = useState('');
  const [minimized, setMinimized] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const lease = useRef<ReturnType<typeof createZoomLease> | null>(null);
  const close = useCallback(async () => {
    generation.current++; busy.current = false;
    const previous = lease.current; lease.current = null;
    if (previous) { try { await previous.close(); } catch { /* local ownership still releases */ } }
  }, []);
  useEffect(() => {
    let alive = true; let observation = 0;
    let binding: string | undefined;
    setAvailable(false); setPhase('idle'); setError(''); setMinimized(false);
    const refresh = async () => {
      if (!user || Platform.OS !== 'web') return;
      const request = ++observation;
      try {
        const { data } = await httpsCallable<any, { enabled: boolean; binding?: string }>(functions, 'getSessionVideoAvailability')({ sessionInstanceId });
        if (!alive || request !== observation) return;
        if (binding && binding !== data.binding) { setPhase('idle'); void close(); }
        binding = data.binding;
        setAvailable(data.enabled);
        if (!data.enabled) { setPhase('idle'); await close(); }
      } catch { if (alive && request === observation) { setAvailable(false); setPhase('idle'); await close(); } }
    };
    void refresh(); const timer = setInterval(() => { void refresh(); }, 15000);
    return () => { alive = false; clearInterval(timer); void close(); };
  }, [sessionInstanceId, user?.uid, close]);
  const join = async () => {
    if (busy.current || !available || !user) return;
    if (!videoCapability()) { setError('This browser cannot use live video. You can continue your workout.'); setPhase('error'); return; }
    const current = generation.current; busy.current = true; setPhase('joining'); setError(''); setMinimized(false);
    const isCurrent = () => current === generation.current;
    let owned: ReturnType<typeof createZoomLease> | null = null;
    try {
      // Admission is rechecked before signing; no meeting is allocated by this request.
      const { data: config } = await httpsCallable<any, any>(functions, 'getEmbeddedSessionJoinConfig')({ sessionInstanceId, purpose: 'workout_video' });
      if (!isCurrent()) return;
      const sdk = await loadZoomEmbedded();
      if (!isCurrent() || !root.current) return;
      let client: any;
      owned = createZoomLease(() => { client = sdk.createClient(); return { client, destroy: () => sdk.destroyClient() }; });
      lease.current = owned;
      await owned.run(async active => {
        await client.init({ zoomAppRoot: root.current, language: 'en-US', patchJsMedia: true, leaveOnPageUnload: true, customize: { meetingInfo: [], video: { isResizable: false, viewSizes: { default: variant === 'pip' ? { width: 320, height: 240 } : { width: 640, height: 420 } } } } });
        if (!active() || !isCurrent()) return;
        await client.join({ signature: config.signature, meetingNumber: config.meetingNumber, password: config.password || '', userName: config.userName || 'Member', userEmail: config.userEmail || '' });
      });
      if (isCurrent() && !owned.cancelled) setPhase('joined');
    } catch {
      if (owned) { try { await owned.close(); } catch {} if (lease.current === owned) lease.current = null; }
      if (isCurrent()) { setError('Video could not connect. Retry or continue your workout.'); setPhase('error'); }
    } finally { if (isCurrent()) busy.current = false; }
  };
  if (!available || Platform.OS !== 'web') return null;
  return <View style={{ width: variant === 'pip' ? minimized ? 170 : 330 : '100%', minHeight: minimized ? 0 : 120, backgroundColor: '#151B26', borderRadius: 10, padding: 6 }}>
    <div ref={root} style={{ display: minimized ? 'none' : 'block', width: '100%', height: phase === 'joined' || phase === 'joining' ? (variant === 'pip' ? 240 : 420) : 0 }} />
    {phase === 'joined' && variant === 'pip' && <View style={{ gap: 8, padding: 8 }}>
      {minimized && <Text style={{ color: '#F0F4F8' }}>Video connected</Text>}
      <Pressable accessibilityRole="button" onPress={() => setMinimized(value => !value)}><Text style={{ color: '#F5A623' }}>{minimized ? 'Show video controls' : 'Minimize video'}</Text></Pressable>
    </View>}
    {phase !== 'joined' && <View style={{ gap: 8, padding: 8 }}>
      <Text style={{ color: '#F0F4F8' }}>Optional live video</Text>
      <Text style={{ color: '#A0AEC0' }}>Choose your camera and microphone separately using Zoom's controls. Your workout works without video.</Text>
      {!!error && <Text accessibilityRole="alert" style={{ color: '#FCA5A5' }}>{error}</Text>}
      {phase === 'joining' ? <ActivityIndicator accessibilityLabel="Connecting video" /> : <Pressable accessibilityRole="button" onPress={join}><Text style={{ color: '#F5A623' }}>{phase === 'error' ? 'Retry video' : joinLabel || 'Join video'}</Text></Pressable>}
    </View>}
    {(phase === 'joining' || phase === 'joined') && <Pressable accessibilityRole="button" onPress={() => { const stopping = close(); const current = generation.current; void stopping.then(() => { if (current === generation.current) setPhase('idle'); }); }} style={{ padding: 8 }}><Text style={{ color: '#F5A623' }}>{phase === 'joining' ? 'Cancel video connection' : 'Leave video'}</Text></Pressable>}
  </View>;
}
