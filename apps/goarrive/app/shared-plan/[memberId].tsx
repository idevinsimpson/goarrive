/**
 * Shared Plan — Public-facing plan viewer
 * Accessible at /shared-plan/[memberId]?token=[shareToken]
 *
 * Uses a live onSnapshot subscription to sharedPlanViews/{shareToken} —
 * the token-keyed projection mirror maintained by Cloud Functions triggers.
 * No authentication required. The unguessable shareToken is the access credential.
 *
 * Deprecated path (getSharedPlan CF) remains live for legacy links during staging.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { MemberPlanData } from '../../lib/planTypes';
import { PlanView } from '../(app)/member-plan/[memberId]';

export default function SharedPlanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { memberId, token } = useLocalSearchParams<{ memberId: string; token?: string }>();
  const [plan, setPlan] = useState<MemberPlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError('This link is missing a required access token. Please ask your coach to re-share your plan.');
      setLoading(false);
      return;
    }

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
  }, [token]);

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
      <PlanView
        plan={plan}
        isCoach={false}
        onChange={() => {}}
        onAccept={handleAccept}
      />
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
