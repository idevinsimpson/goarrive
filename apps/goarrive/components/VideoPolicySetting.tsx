import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

export default function VideoPolicySetting({ kind, id, policy }: { kind: 'playbook' | 'workout'; id: string; policy?: string }) {
  const fallback = kind === 'playbook' ? 'off' : 'inherit';
  const saved = ['on', 'off', ...(kind === 'workout' ? ['inherit'] : [])].includes(policy || '') ? policy! : fallback;
  const [choice, setChoice] = useState(saved); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const generation = useRef(0);
  const [rollout, setRollout] = useState(false);
  useEffect(() => {
    let alive = true;
    void httpsCallable<any, { enabled: boolean }>(functions, 'getWorkoutVideoRollout')({}).then(({ data }) => { if (alive) setRollout(data.enabled === true); }).catch(() => { if (alive) setRollout(false); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { generation.current++; setChoice(saved); setBusy(false); setError(''); return () => { generation.current++; }; }, [kind, id, saved]);
  const save = async () => {
    if (busy || !rollout) return; const current = generation.current; setBusy(true); setError('');
    try { await httpsCallable(functions, 'setWorkoutVideoPolicy')({ kind, id, policy: choice }); }
    catch { if (current === generation.current) setError('Video setting could not save. Please retry.'); }
    finally { if (current === generation.current) setBusy(false); }
  };
  if (!rollout) return <View style={{ paddingVertical: 16 }}><Text style={{ color: '#A0AEC0' }}>In-workout video is not available yet. Your workout works without video.</Text></View>;
  return <View style={{ paddingVertical: 16, gap: 10 }}>
    <Text style={{ color: '#F0F4F8', fontWeight: '600' }}>{kind === 'playbook' ? 'Default in-workout video' : 'Workout video override'}</Text>
    {(kind === 'workout' ? ['inherit', 'on', 'off'] : ['on', 'off']).map(value => <Pressable key={value} accessibilityRole="radio" aria-checked={choice === value} accessibilityState={{ checked: choice === value }} disabled={busy} onPress={() => setChoice(value)} style={{ borderWidth: 1, borderColor: choice === value ? '#A78BFA' : '#4A5568', padding: 12 }}>
      <Text style={{ color: '#F0F4F8' }}>{value === 'inherit' ? 'Use Playbook setting' : value === 'on' ? 'Allow member to opt in' : 'Off'}</Text>
    </Pressable>)}
    <Text style={{ color: '#A0AEC0' }}>{kind === 'playbook' ? 'This is the default; a workout can override it. ' : 'This setting applies wherever this workout is reused. '}Members choose whether to join video and use their camera or microphone. This does not turn on recording or create a meeting. Video requires an eligible scheduled session and an allocated room with recording off. Standalone and guest workouts have no video.</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: '#FCA5A5' }}>{error}</Text>}
    <Pressable accessibilityRole="button" disabled={busy || choice === saved} onPress={save}><Text style={{ color: '#A78BFA' }}>{busy ? 'Saving video setting…' : 'Save video setting'}</Text></Pressable>
  </View>;
}
