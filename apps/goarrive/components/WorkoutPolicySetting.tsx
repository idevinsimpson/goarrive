import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

type Policy = 'carry_forward' | 'scheduled';
export default function WorkoutPolicySetting({ playbookId, policy, disabled = false }: { playbookId: string; policy?: string; disabled?: boolean }) {
  const saved = policy === 'scheduled' ? 'scheduled' : 'carry_forward';
  const [choice, setChoice] = useState<Policy>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(() => { generation.current++; setChoice(saved); setBusy(false); setError(''); return () => { generation.current++; }; }, [playbookId, saved]);
  async function save() {
    if (busy || disabled) return;
    const current = generation.current;
    setBusy(true); setError('');
    try { await httpsCallable(functions, 'setPlaybookWorkoutPolicy')({ playbookId, policy: choice }); }
    catch { if (current === generation.current) setError('Unable to save the workout setting. Please try again.'); }
    finally { if (current === generation.current) setBusy(false); }
  }
  return <View style={{ paddingVertical: 18, gap: 12 }}>
    <Text style={{ color: '#F0F4F8', fontWeight: '600' }}>Missed or unfinished workouts</Text>
    {([['carry_forward', 'Carry unfinished workouts forward'], ['scheduled', 'Follow the scheduled workout']] as const).map(([value, label]) =>
      <Pressable key={value} accessibilityRole="radio" aria-checked={choice === value} accessibilityState={{ checked: choice === value, disabled: busy || disabled }} disabled={busy || disabled} onPress={() => setChoice(value)} style={{ padding: 12, borderWidth: 1, borderColor: choice === value ? '#A78BFA' : '#4A5568', borderRadius: 8 }}>
        <Text style={{ color: '#F0F4F8' }}>{choice === value ? '● ' : '○ '}{label}</Text>
      </Pressable>)}
    <Text style={{ color: '#8A95A3' }}>{choice === 'scheduled'
      ? 'Each occurrence gets a workout in schedule order, even if an earlier workout is missed. Rescheduling keeps its workout. Cancelled sessions keep their place. New earlier bookings can reorder future unopened assignments.'
      : 'The next session repeats the unfinished workout. Completing it advances the Playbook.'}</Text>
    <Text style={{ color: '#8A95A3' }}>Changes apply to sessions more than five minutes away that have not been opened. Pinned, started and completed workouts stay unchanged. Scheduled mode snapshots the current workout order; switch back and save, then enable it again to use a changed order.</Text>
    {!!error && <Text accessibilityRole="alert" style={{ color: '#FCA5A5' }}>{error}</Text>}
    <Pressable accessibilityRole="button" disabled={busy || disabled || choice === saved} onPress={save} style={{ padding: 12, opacity: busy || disabled || choice === saved ? 0.5 : 1 }}>
      <Text style={{ color: '#A78BFA' }}>{busy ? 'Saving workout setting…' : 'Save workout setting'}</Text>
    </Pressable>
  </View>;
}
