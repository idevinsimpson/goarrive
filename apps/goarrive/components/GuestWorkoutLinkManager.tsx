import React, { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, View, Text, Pressable, Platform } from 'react-native';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../lib/firebase';
import GuestWorkoutLinkControls from './GuestWorkoutLinkControls';

export default function GuestWorkoutLinkManager({ playbookId, onClose }: { playbookId: string; onClose(): void }) {
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]), [selected, setSelected] = useState('');
  const [available, setAvailable] = useState(false), [error, setError] = useState(''), [link, setLink] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    let active = true;
    const current = ++generation.current; setAvailable(false); setLink(''); setSelected(''); setMembers([]); setError('');
    void (async () => {
      try {
        const plan = (await getDoc(doc(db, 'playbooks', playbookId))).data();
        const ids = Array.isArray(plan?.memberIds) ? plan.memberIds.filter((id: unknown): id is string => typeof id === 'string').slice(0, 100) : [];
        const rows = await Promise.all(ids.map(async (id: string) => { const member = (await getDoc(doc(db, 'members', id))).data(); return { id, name: member?.name || member?.displayName || 'Member' }; }));
        if (current !== generation.current) return;
        setMembers(rows); setSelected(rows[0]?.id || '');
        try { const result = await httpsCallable(functions, 'getGuestWorkoutAccess')({}); if (active) setAvailable((result.data as any)?.canIssue === true); } catch { /* issuance stays closed; revoke remains available */ }
      } catch { if (current === generation.current) setError('Could not load member assignments.'); }
    })();
    const hide = () => { generation.current++; setLink(''); };
    const visibility = () => { if (document.hidden) hide(); };
    if (Platform.OS === 'web') { window.addEventListener('pagehide', hide); document.addEventListener('visibilitychange', visibility); }
    return () => { active = false; generation.current++; if (Platform.OS === 'web') { window.removeEventListener('pagehide', hide); document.removeEventListener('visibilitychange', visibility); } };
  }, [playbookId]);
  const confirm = async (action: 'replace' | 'revoke') => {
    const current = generation.current; setLink(''); const data = { playbookId, memberId: selected };
    if (action === 'revoke') await httpsCallable(functions, 'revokeGuestWorkoutLink')(data);
    else {
      const result = await httpsCallable(functions, 'issueGuestWorkoutLink')({ ...data, confirmed: true, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
      const value = result.data as any;
      if (typeof value?.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.token)) throw new Error('Unavailable');
      if (current === generation.current) setLink('https://goarrive.fit/guest-workout#key=' + value.token);
    }
  };
  const close = () => { generation.current++; setLink(''); onClose(); };
  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <View style={{ flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,.6)' }}>
      <ScrollView style={{ maxHeight: '90%', backgroundColor: 'white', padding: 20 }}>
        <Text accessibilityRole="header">Guest workout links</Text>
        <Text>Select one assigned member. A guest link expires in 24 hours and anyone holding it can view the eligible supported workout.</Text>
        <Text>Guest playback currently supports only simple Strength prescriptions. Other formats remain unavailable.</Text>
        {members.map(member => <Pressable key={member.id} accessibilityRole="radio" accessibilityState={{ selected: selected === member.id }} onPress={() => { generation.current++; setSelected(member.id); setLink(''); }}><Text>{selected === member.id ? 'Selected: ' : ''}{member.name}</Text></Pressable>)}
        {!members.length && <Text>No assigned members available.</Text>}
        {selected && <GuestWorkoutLinkControls assignmentKey={playbookId + ':' + selected} memberLabel={members.find(m => m.id === selected)?.name || 'this member'} available={available} canRevoke onConfirm={confirm} />}
        {!!link && <><Text>This link is shown once. Closing this panel clears it.</Text><Text selectable>{link}</Text></>}
        {!!error && <Text accessibilityRole="alert">{error}</Text>}
        <Pressable accessibilityRole="button" onPress={close}><Text>Close guest links</Text></Pressable>
      </ScrollView>
    </View>
  </Modal>;
}
