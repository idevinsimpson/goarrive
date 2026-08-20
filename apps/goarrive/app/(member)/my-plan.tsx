/**
 * My Plan — Member's view of their fitness plan.
 *
 * ARCHITECTURE: Thin wrapper around PlanView (same component coach uses).
 * Uses live onSnapshot subscriptions so the member sees coach edits in real-time.
 * When a scenario is presented, overlays it onto the base plan reactively.
 *
 * One source of truth. One component. Identical output.
 */
import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  Platform, Pressable, Image, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { AppHeader } from '../../components/AppHeader';
import {
  collection, query, where, getDocs, doc, updateDoc,
  orderBy, limit, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { MemberPlanData, Scenario, createDefaultPlan } from '../../lib/planTypes';

// Import the SAME PlanView the coach uses
import { PlanView } from '../(app)/member-plan/[memberId]';

// ─── Design tokens ──────────────────────────────────────────────────────────
const ACCENT = '#6EBB7A';

interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
}

export default function MyPlan() {
  const { user } = useAuth();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<MemberPlanData | null>(null);
  const planDocIdRef = useRef<string>('');
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (user) fetchNotifications();
  }, [user]);

  async function fetchNotifications() {
    if (!user) return;
    try {
      const q = query(
        collection(db, 'notifications'),
        where('recipientId', '==', user.uid),
        where('read', '==', false),
        orderBy('createdAt', 'desc'),
        limit(5)
      );
      const snap = await getDocs(q);
      setNotifications(snap.docs.map(d => ({ id: d.id, ...d.data() } as Notification)));
    } catch (err) {
      console.warn('[MyPlan] Could not load notifications:', err);
    }
  }

  async function dismissNotification(notifId: string) {
    setNotifications(prev => prev.filter(n => n.id !== notifId));
    try {
      await updateDoc(doc(db, 'notifications', notifId), { read: true });
    } catch (err) {
      console.warn('[MyPlan] Could not mark notification as read:', err);
    }
  }

  // ─── Live subscription setup ───────────────────────────────────────────────
  useEffect(() => {
    if (!user) return;

    let unsubPlan: (() => void) | null = null;
    let unsubScenario: (() => void) | null = null;
    let resolvedDocId = '';
    let basePlan: MemberPlanData | null = null;

    function applyScenarioOverlay(base: MemberPlanData, scenData: Scenario | null): MemberPlanData {
      if (!scenData) return base;
      return { ...base, ...scenData, id: base.id } as MemberPlanData;
    }

    function mergeWithDefaults(planData: MemberPlanData, docId: string): MemberPlanData {
      const defaults = createDefaultPlan(
        planData.memberName || 'Member',
        docId || user!.uid,
        planData.coachId || ''
      );
      return {
        ...defaults,
        ...planData,
        nutrition: { ...defaults.nutrition, ...(planData.nutrition || {}) },
        commitToSave: { ...defaults.commitToSave, ...(planData.commitToSave || {}) },
        phases: (planData.phases?.length) ? planData.phases : defaults.phases,
        weeklySchedule: (planData.weeklySchedule?.length) ? planData.weeklySchedule : defaults.weeklySchedule,
        sessionGuidanceProfiles: (planData.sessionGuidanceProfiles?.length) ? planData.sessionGuidanceProfiles : defaults.sessionGuidanceProfiles,
        memberName: planData.memberName || defaults.memberName,
      };
    }

    function subscribePlan(docId: string) {
      resolvedDocId = docId;
      planDocIdRef.current = docId;

      unsubPlan = onSnapshot(
        doc(db, 'member_plans', docId),
        (snap) => {
          if (!snap.exists()) {
            setLoading(false);
            return;
          }

          const newBase = { id: snap.id, ...snap.data() } as MemberPlanData;
          basePlan = newBase;

          // Re-subscribe to scenario if presentedScenarioId changed
          if (newBase.presentedScenarioId) {
            if (unsubScenario) { unsubScenario(); unsubScenario = null; }
            unsubScenario = onSnapshot(
              doc(db, 'member_plans', docId, 'scenarios', newBase.presentedScenarioId),
              (scenSnap) => {
                const scenData = scenSnap.exists() ? (scenSnap.data() as Scenario) : null;
                const overlaid = applyScenarioOverlay(basePlan!, scenData);
                setPlan(mergeWithDefaults(overlaid, docId));
                setLoading(false);
              },
              (err) => {
                console.warn('[MyPlan] Scenario subscription error, falling back:', err);
                setPlan(mergeWithDefaults(basePlan!, docId));
                setLoading(false);
              }
            );
          } else {
            // No presented scenario — tear down any old scenario subscription
            if (unsubScenario) { unsubScenario(); unsubScenario = null; }
            setPlan(mergeWithDefaults(newBase, docId));
            setLoading(false);
          }
        },
        (err) => {
          console.error('[MyPlan] Plan subscription error:', err);
          setLoading(false);
        }
      );
    }

    // Find member's plan doc ID, then subscribe
    async function setup() {
      try {
        // PRIMARY: Look up member doc ID
        const membersSnap = await getDocs(query(collection(db, 'members'), where('uid', '==', user!.uid)));
        if (!membersSnap.empty) {
          subscribePlan(membersSnap.docs[0].id);
          return;
        }

        // FALLBACK 1: Direct doc by uid
        subscribePlan(user!.uid);
      } catch (err) {
        console.error('[MyPlan] Setup error:', err);
        setLoading(false);
      }
    }

    setup();

    return () => {
      if (unsubPlan) unsubPlan();
      if (unsubScenario) unsubScenario();
    };
  }, [user]);

  // ─── Handle changes from PlanView (member toggling CTS/Nutrition) ─────────
  const handlePlanChange = useCallback((updates: Partial<MemberPlanData>) => {
    setPlan(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      const docId = planDocIdRef.current || prev.id;
      if (docId) {
        updateDoc(doc(db, 'member_plans', docId), {
          ...updates,
          updatedAt: new Date(),
        }).catch(err => console.warn('[MyPlan] Save error:', err));
      }
      return updated;
    });
  }, []);

  // ─── Accept plan handler ──────────────────────────────────────────────────
  // Writes acceptedScenarioId to Firestore BEFORE routing to payment-select.
  // This ensures createCheckoutSession reads the correct scenario deterministically.
  async function handleAcceptPlan() {
    if (!user || !plan) return;
    const docId = planDocIdRef.current || plan.id;
    if (!docId) return;

    // Guard: already enrolled
    if (
      plan.status === 'active' ||
      (plan as any).checkoutStatus === 'paid' ||
      (plan as any).checkoutStatus === 'pay_in_full_paid'
    ) {
      Alert.alert(
        "You're Already Enrolled",
        'Your plan is active. If you have questions about your enrollment, contact your coach.',
        [{ text: 'OK' }]
      );
      return;
    }

    try {
      // Write acceptedScenarioId BEFORE navigating — createCheckoutSession reads this.
      // presentedScenarioId may be null (base plan) or a scenario ID.
      const acceptedScenarioId = (plan as any).presentedScenarioId ?? null;
      await updateDoc(doc(db, 'member_plans', docId), {
        acceptedScenarioId,
        acceptedAt: serverTimestamp(),
      });
    } catch (err) {
      console.error('[MyPlan] Could not write acceptedScenarioId:', err);
      Alert.alert('Error', 'Could not save your acceptance. Please try again.');
      return;
    }

    // Navigate to payment selection only after write resolves
    router.push(`/(member)/payment-select?planId=${docId}` as any);
  }

  // ─── Loading state ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={st.root}>
        <AppHeader />
        <View style={st.loadingContainer}>
          <ActivityIndicator size="large" color="#F5A623" />
        </View>
      </View>
    );
  }

  // ─── No plan state ────────────────────────────────────────────────────────
  if (!plan) {
    return (
      <View style={st.root}>
        <AppHeader />
        <View style={st.emptyContainer}>
          <Text style={{ fontSize: 48, marginBottom: 16 }}>📋</Text>
          <Text style={st.emptyTitle}>No Plan Yet</Text>
          <Text style={st.emptyText}>
            Your coach hasn't created your fitness plan yet.{'\n'}
            Complete your intake to get started.
          </Text>
        </View>
      </View>
    );
  }

  // ─── Render: PlanView (isCoach=false) + live data ─────────────────────────
  return (
    <View style={st.root}>
      <AppHeader />
      <View style={st.planBar}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image
            source={require('../../assets/goarrive-icon.png')}
            style={{ width: 28, height: 28, borderRadius: 6 }}
            resizeMode="contain"
          />
          <View style={[st.badge, { backgroundColor: 'rgba(110,187,122,0.12)', borderColor: 'rgba(110,187,122,0.25)' }]}>
            <Text style={[st.badgeText, { color: ACCENT }]}>Fitness Plan</Text>
          </View>
        </View>
      </View>
      {/* ── In-app notifications banner ── */}
      {notifications.map(notif => (
        <View key={notif.id} style={st.notifBanner}>
          <View style={{ flex: 1 }}>
            <Text style={st.notifTitle}>{notif.title}</Text>
            <Text style={st.notifBody}>{notif.body}</Text>
          </View>
          <Pressable onPress={() => dismissNotification(notif.id)} style={st.notifDismiss}>
            <Text style={{ color: '#A0AEC0', fontSize: 16 }}>✕</Text>
          </Pressable>
        </View>
      ))}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: Platform.OS === 'web' ? 100 : 24 }}
      >
        <PlanView
          plan={plan}
          isCoach={false}
          onChange={handlePlanChange}
          onAccept={handleAcceptPlan}
        />
      </ScrollView>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E1117', ...(Platform.OS === 'web' ? { height: '100vh' as any, maxHeight: '100vh' as any, overflow: 'hidden' as any } : {}) },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#F0F4F8', marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#A0AEC0', textAlign: 'center', lineHeight: 22 },
  planBar: {
    flexDirection: 'row', justifyContent: 'flex-start', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#2A3347',
  },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16,
    borderWidth: 1, alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4 },
  notifBanner: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: 'rgba(110,187,122,0.12)',
    borderLeftWidth: 3, borderLeftColor: '#6EBB7A',
    marginHorizontal: 16, marginTop: 8,
    borderRadius: 8, padding: 12, gap: 8,
  },
  notifTitle: { color: '#F0F4F8', fontSize: 13, fontWeight: '700', marginBottom: 2 },
  notifBody: { color: '#A0AEC0', fontSize: 12, lineHeight: 18 },
  notifDismiss: { padding: 4, marginTop: 2 },
});
