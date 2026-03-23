/**
 * My Plan — Member's view of their fitness plan.
 *
 * ARCHITECTURE: This is a thin wrapper around the coach's PlanView component.
 * It loads the SAME Firestore document the coach edits (member_plans/{memberDocId})
 * and renders PlanView with isCoach=false. This guarantees the member sees the
 * EXACT same layout, pricing, and data as the coach's "Member View" preview.
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
import { collection, query, where, getDocs, doc, getDoc, updateDoc, orderBy, limit, writeBatch } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { MemberPlanData, createDefaultPlan } from '../../lib/planTypes';

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

  useEffect(() => {
    if (user) fetchPlan();
  }, [user]);

  // ─── Load the SAME plan document the coach edits ──────────────────────────
  async function fetchPlan() {
    if (!user) return;
    setLoading(true);
    try {
      let planData: MemberPlanData | null = null;
      let resolvedDocId: string = '';

      // ── PRIMARY: Look up member doc ID, then load plan by that key ──
      // The coach saves to member_plans/{memberDocId}. We find our memberDocId
      // from the members collection, then load that exact document.
      const membersQuery = query(collection(db, 'members'), where('uid', '==', user.uid));
      const membersSnap = await getDocs(membersQuery);
      if (!membersSnap.empty) {
        const memberDocId = membersSnap.docs[0].id;
        console.log('[MyPlan] Found member doc:', memberDocId);
        const planDoc = await getDoc(doc(db, 'member_plans', memberDocId));
        if (planDoc.exists()) {
          resolvedDocId = memberDocId;
          planData = { id: planDoc.id, ...planDoc.data() } as MemberPlanData;
          console.log('[MyPlan] Loaded plan from member doc key:', memberDocId);
        }
      }

      // ── FALLBACK 1: Direct doc by uid ──
      if (!planData) {
        const planByUid = await getDoc(doc(db, 'member_plans', user.uid));
        if (planByUid.exists()) {
          resolvedDocId = user.uid;
          planData = { id: planByUid.id, ...planByUid.data() } as MemberPlanData;
          console.log('[MyPlan] Loaded plan from uid key:', user.uid);
        }
      }

      // ── FALLBACK 2: Query by memberId field ──
      if (!planData) {
        const plansQuery = query(collection(db, 'member_plans'), where('memberId', '==', user.uid));
        const snap = await getDocs(plansQuery);
        if (!snap.empty) {
          const best = snap.docs[0];
          resolvedDocId = best.id;
          planData = { id: best.id, ...best.data() } as MemberPlanData;
          console.log('[MyPlan] Loaded plan from memberId query:', best.id);
        }
      }

      if (planData) {
        // Merge with defaults to fill any missing fields (same as coach's page)
        const defaults = createDefaultPlan(
          planData.memberName || 'Member',
          resolvedDocId || user.uid,
          planData.coachId || ''
        );
        const merged: MemberPlanData = {
          ...defaults,
          ...planData,
          nutrition: { ...defaults.nutrition, ...(planData.nutrition || {}) },
          commitToSave: { ...defaults.commitToSave, ...(planData.commitToSave || {}) },
          phases: (planData.phases?.length) ? planData.phases : defaults.phases,
          weeklySchedule: (planData.weeklySchedule?.length) ? planData.weeklySchedule : defaults.weeklySchedule,
          sessionGuidanceProfiles: (planData.sessionGuidanceProfiles?.length) ? planData.sessionGuidanceProfiles : defaults.sessionGuidanceProfiles,
          memberName: planData.memberName || defaults.memberName,
        };
        planDocIdRef.current = resolvedDocId;
        setPlan(merged);
      } else {
        console.log('[MyPlan] No plan found for uid:', user.uid);
      }
    } catch (err) {
      console.error('[MyPlan] Error fetching plan:', err);
    } finally {
      setLoading(false);
    }
  }

  // ─── Handle changes from PlanView (member toggling CTS/Nutrition) ─────────
  const handlePlanChange = useCallback((updates: Partial<MemberPlanData>) => {
    setPlan(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };

      // Persist to Firestore (same document the coach edits)
      const docId = planDocIdRef.current || prev.id;
      if (docId) {
        try {
          updateDoc(doc(db, 'member_plans', docId), {
            ...updates,
            updatedAt: new Date(),
          }).catch(err => console.warn('[MyPlan] Save error:', err));
        } catch (err) {
          console.warn('[MyPlan] Save error:', err);
        }
      }

      return updated;
    });
  }, []);

  // ─── Accept plan handler ──────────────────────────────────────────────────
  // Navigates to payment selection page instead of writing status directly.
  // The plan status is updated to 'active' by the stripeWebhook Cloud Function
  // after checkout.session.completed fires.
  //
  // Guard: if the plan is already active or paid, skip the payment flow and
  // show an informational alert instead of navigating to payment-select.
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
    // Navigate to payment selection
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
          <Text style={{ fontSize: 48, marginBottom: 16 }}>{'\uD83D\uDCCB'}</Text>
          <Text style={st.emptyTitle}>No Plan Yet</Text>
          <Text style={st.emptyText}>
            Your coach hasn't created your fitness plan yet.{'\n'}
            Complete your intake to get started.
          </Text>
        </View>
      </View>
    );
  }

  // ─── Render: PlanView (isCoach=false) + Plan Acceptance ───────────────────
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
        {/* ── THE EXACT SAME PlanView the coach sees, with isCoach=false ── */}
        <PlanView
          plan={plan}
          isCoach={false}
          onChange={handlePlanChange}
          onAccept={handleAcceptPlan}
        />

        {/* Accept Plan is now rendered inside PlanView */}
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
  sectionLabel: {
    fontSize: 11, fontWeight: '700', color: '#5B9BD5',
    letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8,
  },
  darkCard: {
    backgroundColor: '#161B25', borderWidth: 1, borderColor: '#2A3347',
    borderRadius: 12, padding: 14,
  },
  subtitleText: { color: '#C5CDD8', fontSize: 14, lineHeight: 22 },
  badge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 16,
    borderWidth: 1, alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.4 },
  acceptBtn: {
    backgroundColor: '#6EBB7A',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 20,
  },
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
  acceptBtnText: {
    color: '#000',
    fontSize: 16,
    fontWeight: '700',
  },
});
