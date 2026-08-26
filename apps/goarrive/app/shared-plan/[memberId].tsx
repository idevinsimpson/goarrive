/**
 * Shared Plan — Public-facing plan viewer
 * Accessible at /shared-plan/[memberId]?token=[shareToken]
 *
 * With ?token=: live onSnapshot subscription to sharedPlanViews/{shareToken} —
 * the token-keyed projection mirror maintained by Cloud Functions triggers.
 * No authentication required; the unguessable shareToken is the access credential.
 *
 * Without ?token= (legacy links): one-shot fetch via the getSharedPlan HTTPS
 * endpoint. Read-only, not live — this path stays around so already-shared
 * links keep working through the token migration window.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { MemberPlanData } from '../../lib/planTypes';
import { PlanView } from '../(app)/member-plan/[memberId]';

const GET_SHARED_PLAN_URL = 'https://us-central1-goarrive.cloudfunctions.net/getSharedPlan';

export default function SharedPlanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { memberId, token } = useLocalSearchParams<{ memberId: string; token?: string }>();
  const [plan, setPlan] = useState<MemberPlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!memberId) {
      setError('Plan link is missing a member id.');
      setLoading(false);
      return;
    }

    // ── Legacy path: no token → one-shot fetch via getSharedPlan HTTPS CF ──
    if (!token) {
      let cancelled = false;
      (async () => {
        try {
          const url = `${GET_SHARED_PLAN_URL}?memberId=${encodeURIComponent(memberId)}`;
          const resp = await fetch(url);
          if (cancelled) return;
          if (!resp.ok) {
            const body = await resp.json().catch(() => ({}));
            setError(body?.error || 'Plan not found.');
            setLoading(false);
            return;
          }
          const { plan: fetchedPlan } = await resp.json() as { plan: MemberPlanData };
          if (!fetchedPlan) {
            setError('Plan not found.');
          } else {
            setPlan(fetchedPlan);
            setError('');
          }
        } catch (err) {
          if (cancelled) return;
          console.error('[SharedPlan] getSharedPlan fetch error:', err);
          setError('Something went wrong loading this plan.');
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }

    // ── Token path: live subscription to sharedPlanViews/{shareToken} ──
    const projRef = doc(db, 'sharedPlanViews', token);
    const unsub = onSnapshot(
      projRef,
      (snap) => {
        if (!snap.exists()) {
          setError('Plan not found. Your coach may still be building it — check back soon.');
          setLoading(false);
          return;
        }
        const data = snap.data() as MemberPlanData;
        const allowedStatuses = ['presented', 'accepted', 'active', 'pending'];
        if (!allowedStatuses.includes(data.status || '')) {
          setError('This plan is still being built. Check back soon!');
          setLoading(false);
          return;
        }
        setPlan({ id: snap.id, ...data });
        setLoading(false);
        setError('');
      },
      (err) => {
        console.error('[SharedPlan] onSnapshot error:', err);
        setError('Something went wrong loading this plan.');
        setLoading(false);
      }
    );

    return () => unsub();
  }, [memberId, token]);

  const handleAccept = () => {
    // Member must sign in / claim before accepting.
    // Route to sign-in with a redirect back to /(member)/my-plan.
    router.push('/(auth)/sign-in' as any);
  };

  if (loading) {
    return (
      <View style={st.root}>
        <View style={st.header} />
        <View style={st.center}>
          <ActivityIndicator size="large" color="#F5A623" />
          <Text style={{ color: '#8A95A3', marginTop: 12, fontSize: 14 }}>Loading your fitness plan...</Text>
        </View>
      </View>
    );
  }

  if (error || !plan) {
    return (
      <View style={st.root}>
        <View style={[st.header, { paddingTop: Math.max(8, insets.top) }]} />
        <View style={st.center}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>📋</Text>
          <Text style={st.errorTitle}>{error || 'Plan not found'}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={st.root}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
        <PlanView
          plan={plan}
          isCoach={false}
          onChange={() => {}}
          onAccept={handleAccept}
        />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
    ...(Platform.OS === 'web' ? { height: '100vh' as any, maxHeight: '100vh' as any, overflow: 'hidden' as any } : {}),
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: '#F0F4F8', textAlign: 'center', lineHeight: 26 },
});
