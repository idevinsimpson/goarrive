import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../../lib/AuthContext';
import { functions } from '../../lib/firebase';
import type { SessionInstance } from '../../lib/schedulingTypes';
import { memberSessionState, selectMemberSessions } from '../../lib/memberPlaybookSessions';
import { workoutReturnPath } from '../../lib/workoutReturnPath';
import { BG, CARD, FG, MUTED, GOLD } from '../../lib/theme';

type Result = { title: string; sessions: SessionInstance[]; serverNow: number };

export default function MemberPlaybookLink() {
  const { playbookId } = useLocalSearchParams<{ playbookId: string }>();
  const { user, loading } = useAuth();
  const router = useRouter();
  const destination = typeof playbookId === 'string' ? workoutReturnPath(`/playbook/${playbookId}`) : null;
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0);
  const identity = `${user?.uid || ''}/${playbookId}`;
  const [loadedIdentity, setLoadedIdentity] = useState('');
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);
  const generation = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let stopped = false;
    let busy = false;
    generation.current++;
    openingRef.current = false;
    setResult(null); setError(''); setLoadedIdentity(''); setOpening(false);
    if (loading || !user || !destination) return;
    async function refresh() {
      if (busy || stopped) return;
      busy = true;
      try {
        const response = await httpsCallable<{ playbookId: string }, Result>(functions, 'getMemberPlaybookSessions')({ playbookId });
        if (stopped) return;
        offset.current = response.data.serverNow - Date.now();
        setNow(response.data.serverNow); setResult(response.data); setError(''); setLoadedIdentity(identity);
      } catch (e: any) {
        if (!stopped) {
          setResult(null); setLoadedIdentity(identity);
          setError(e?.code === 'functions/permission-denied' ? 'This Playbook is not assigned to your account. Sign in with the account your coach invited, or contact your coach.' : 'Unable to load your schedule. Please try again.');
        }
      } finally { busy = false; }
    }
    void refresh();
    const timer = setInterval(refresh, 30000);
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void refresh(); });
    const focus = () => { void refresh(); };
    if (typeof window !== 'undefined') window.addEventListener('focus', focus);
    return () => { stopped = true; generation.current++; clearInterval(timer); subscription.remove(); if (typeof window !== 'undefined') window.removeEventListener('focus', focus); };
  }, [identity, loading, destination, retry]);

  async function open(id: string) {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    const current = generation.current;
    try {
      // Revalidate assignment and schedule at the click, including cancellation
      // since the last refresh. The existing player performs its own ownership
      // and time checks; this read never pins or advances a workout.
      const response = await httpsCallable<{ playbookId: string }, Result>(functions, 'getMemberPlaybookSessions')({ playbookId });
      if (current !== generation.current) return;
      setResult(response.data); setNow(response.data.serverNow);
      offset.current = response.data.serverNow - Date.now();
      const session = response.data.sessions.find(s => s.id === id);
      if (session && memberSessionState(session, response.data.serverNow) === 'active') router.push(`/live-session/${id}` as any);
      else setError('Your schedule changed. Please check the sessions below.');
    } catch { if (current === generation.current) { setResult(null); setError('Unable to confirm this session. Please refresh your schedule.'); } }
    finally { if (current === generation.current) { openingRef.current = false; setOpening(false); } }
  }

  if (!destination) return <Text>Invalid Playbook link.</Text>;
  if (loading) return <ActivityIndicator accessibilityLabel="Loading account" />;
  if (!user) return <Redirect href={{ pathname: '/(auth)/login', params: { returnTo: destination } }} />;
  const visible = loadedIdentity === identity ? result : null;
  const groups = visible ? selectMemberSessions(visible.sessions, now) : null;
  function card(session: SessionInstance) {
    const state = memberSessionState(session, now);
    return <View key={session.id} style={{ backgroundColor: CARD, padding: 20, marginVertical: 8, borderRadius: 12 }}>
      <Text style={{ color: FG }}>{session.scheduledDate} · {session.scheduledStartTime}–{session.scheduledEndTime} ({session.timezone})</Text>
      <Text style={{ color: MUTED, marginVertical: 10 }}>{state === 'upcoming' ? 'Opens 5 minutes before your session' : state === 'active' ? 'Ready for your workout' : state === 'completed' ? 'Workout completed' : `Session ${state}`}</Text>
      {state === 'active' && <Pressable accessibilityRole="button" disabled={opening} onPress={() => open(session.id)} style={{ padding: 12, backgroundColor: GOLD, borderRadius: 8 }}><Text>{opening ? 'Checking session…' : 'Open current workout'}</Text></Pressable>}
    </View>;
  }
  return <ScrollView style={{ flex: 1, backgroundColor: BG }} contentContainerStyle={{ padding: 24, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
    <Text style={{ color: FG, fontSize: 26, marginBottom: 12 }}>{visible?.title || 'Your Playbook'}</Text>
    <Text style={{ color: MUTED, marginBottom: 16 }}>Keep this link. Your scheduled workouts appear here as your schedule changes.</Text>
    {loadedIdentity !== identity && <ActivityIndicator accessibilityLabel="Loading schedule" />}
    {!!error && loadedIdentity === identity && <Text accessibilityRole="alert" style={{ color: GOLD }}>{error}</Text>}
    {!!error && loadedIdentity === identity && <Pressable accessibilityRole="button" onPress={() => router.push({ pathname: '/(auth)/login', params: { returnTo: destination } })} style={{ paddingVertical: 16 }}><Text style={{ color: GOLD }}>Sign in with another account</Text></Pressable>}
    {groups && <>
      <Text style={{ color: FG }}>{groups.active.length > 1 ? 'More than one session is ready. Choose your session.' : groups.active.length ? 'Current session' : 'No current session'}</Text>
      {groups.active.map(card)}
      {!!groups.today.length && <Text style={{ color: FG, marginTop: 16 }}>Today</Text>}{groups.today.map(card)}
      {!!groups.next.length && <Text style={{ color: FG, marginTop: 16 }}>Next session</Text>}{groups.next.map(card)}
      {!groups.active.length && !groups.today.length && !groups.next.length && <Text style={{ color: MUTED, marginVertical: 16 }}>No scheduled session is available. Contact your coach to arrange your next workout.</Text>}
    </>}
    <Pressable accessibilityRole="button" onPress={() => setRetry(v => v + 1)} style={{ paddingVertical: 20 }}><Text style={{ color: GOLD }}>Refresh schedule</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => router.push('/(member)/my-sessions')}><Text style={{ color: GOLD }}>My Sessions</Text></Pressable>
  </ScrollView>;
}
