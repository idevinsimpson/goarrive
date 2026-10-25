import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';

type Props = {
  assignmentKey: string;
  memberLabel: string;
  available?: boolean;
  onConfirm?: (action: 'replace' | 'revoke') => Promise<void>;
};

/** Draft controls. Production wiring stays unavailable until the private media
 * and server-owned assignment generation adapters pass independent review. */
export default function GuestWorkoutLinkControls({ assignmentKey, memberLabel, available = false, onConfirm }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    generation.current += 1; inFlight.current = false; setConfirmed(false); setBusy(false); setMessage('');
    return () => { generation.current += 1; };
  }, [assignmentKey, available]);
  const run = async (action: 'replace' | 'revoke') => {
    if (inFlight.current || !available || !onConfirm || (action === 'replace' && !confirmed)) return;
    const current = generation.current; inFlight.current = true; setBusy(true); setMessage('');
    try {
      await onConfirm(action);
      if (current === generation.current) { setConfirmed(false); setMessage(action === 'revoke' ? 'Guest access disabled.' : 'Link created. Copy it now; it cannot be retrieved later.'); }
    } catch {
      if (current === generation.current) setMessage('Could not update guest access. Please retry.');
    } finally { if (current === generation.current) { inFlight.current = false; setBusy(false); } }
  };
  return <View accessibilityLabel="Guest workout link controls">
    <Text>Workout link without sign-in</Text>
    <Text>The permanent Member Workout Link requires sign-in. A guest link is separate, expires within seven days, and is for {memberLabel} only.</Text>
    <Text>Anyone with the guest link can view the eligible workout. It cannot save completion or use video calls. Replacing it invalidates the previous link. Downloaded content cannot be recalled.</Text>
    {!available && <Text>Guest access is not available yet. Continue using the Member Workout Link.</Text>}
    <Pressable accessibilityRole="checkbox" aria-checked={confirmed} accessibilityState={{ checked: confirmed, disabled: !available || busy }} disabled={!available || busy} onPress={() => setConfirmed(v => !v)}>
      <Text>{confirmed ? '☑' : '☐'} I understand and want to create a guest link for this member.</Text>
    </Pressable>
    <Pressable accessibilityRole="button" disabled={!available || !confirmed || busy} accessibilityState={{ disabled: !available || !confirmed || busy }} onPress={() => run('replace')}><Text>Create or replace guest link</Text></Pressable>
    <Pressable accessibilityRole="button" disabled={!available || busy} accessibilityState={{ disabled: !available || busy }} onPress={() => run('revoke')}><Text>Disable guest access</Text></Pressable>
    {!!message && <Text accessibilityRole="alert">{message}</Text>}
  </View>;
}
