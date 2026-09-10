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
import { collection, query, where, getDocs, doc, getDoc, updateDoc, orderBy, limit, writeBatch, onSnapshot, serverTimestamp } from 'firebase/firestore';
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
  const [intakeSubmitted, setIntakeSubmitted] = useState(false);
  const planDocIdRef = useRef<string>('');
  // Pass B live-view refs: raw base plan doc, the presented scenario doc, and
  // the scenario listener's teardown + the id it is currently pointed at.
  const basePlanRef = useRef<MemberPlanData | null>(null);
  const scenarioRef = useRef<Scenario | null>(null);
  const scenarioUnsubRef = useRef<(() => void) | null>(null);
  const currentScenarioIdRef = useRef<string | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (user) {
      fetchNotifications();
      fetchIntakeStatus();
    }
  }, [user]);

  async function fetchIntakeStatus() {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, 'members', user.uid));
      if (snap.exists() && snap.data().intakeSubmissionId) {
        setIntakeSubmitted(true);
      }
    } catch (err) {
      console.warn('[MyPlan] Could not check intake status:', err);
    }
  }

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

  // ─── LIVE subscription to the SAME plan document the coach edits ──────────
  // Pass B: the member's plan view is live. The coach's edits and any switch of
  // the presented scenario land on this screen in real time, with no refresh —
  // this is the "screen-share illusion" half that runs for authenticated
  // members. The document resolution below is the one-shot part (it answers
  // "which plan doc is mine?"); everything after it is a snapshot listener.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let planUnsub: (() => void) | null = null;

    (async () => {
      setLoading(true);
      const resolvedDocId = await resolvePlanDocId();
      if (cancelled) return;
      if (!resolvedDocId) {
        console.log('[MyPlan] No plan found for uid:', user.uid);
        setLoading(false);
        return;
      }
      planDocIdRef.current = resolvedDocId;

      planUnsub = onSnapshot(
        doc(db, 'member_plans', resolvedDocId),
        (snap) => {
          if (cancelled) return;
          if (!snap.exists()) {
            setLoading(false);
            return;
          }
          const base = { id: snap.id, ...snap.data() } as MemberPlanData;
          basePlanRef.current = base;
          // Re-point the scenario listener only when the presented scenario
          // actually changes — an unchanged id keeps the existing listener so
          // rapid coach-side edits don't churn subscriptions.
          syncScenarioSubscription(resolvedDocId, base.presentedScenarioId ?? null);
          composePlan();
          setLoading(false);
        },
        (err) => {
          console.warn('[MyPlan] Plan subscription error:', err);
          setLoading(false);
        }
      );
    })();

    return () => {
      cancelled = true;
      if (planUnsub) planUnsub();
      if (scenarioUnsubRef.current) {
        scenarioUnsubRef.current();
        scenarioUnsubRef.current = null;
      }
      currentScenarioIdRef.current = null;
    };
  }, [user]);

  // ─── Resolve which member_plans document belongs to this member ───────────
  // Unchanged resolution order from the pre-Pass-B one-shot loader: member doc
  // key first (what the coach writes to), then uid key, then a memberId query.
  async function resolvePlanDocId(): Promise<string> {
    if (!user) return '';
    try {
      const membersQuery = query(collection(db, 'members'), where('uid', '==', user.uid));
      const membersSnap = await getDocs(membersQuery);
      if (!membersSnap.empty) {
        const memberDocId = membersSnap.docs[0].id;
        const planDoc = await getDoc(doc(db, 'member_plans', memberDocId));
        if (planDoc.exists()) return memberDocId;
      }

      const planByUid = await getDoc(doc(db, 'member_plans', user.uid));
      if (planByUid.exists()) return user.uid;

      const plansQuery = query(collection(db, 'member_plans'), where('memberId', '==', user.uid));
      const snap = await getDocs(plansQuery);
      if (!snap.empty) return snap.docs[0].id;
    } catch (err) {
      console.error('[MyPlan] Error resolving plan doc:', err);
    }
    return '';
  }

  // ─── Presented-scenario listener, re-pointed only on a real id change ─────
  // Members may read ONLY the presented scenario (Firestore rules enforce it);
  // any error here falls back to the base plan rather than blanking the screen.
  function syncScenarioSubscription(docId: string, scenarioId: string | null) {
    if (scenarioId === currentScenarioIdRef.current) return;
    if (scenarioUnsubRef.current) {
      scenarioUnsubRef.current();
      scenarioUnsubRef.current = null;
    }
    currentScenarioIdRef.current = scenarioId;
    scenarioRef.current = null;

    if (!scenarioId) {
      composePlan();
      return;
    }

    scenarioUnsubRef.current = onSnapshot(
      doc(db, 'member_plans', docId, 'scenarios', scenarioId),
      (snap) => {
        scenarioRef.current = snap.exists() ? (snap.data() as Scenario) : null;
        composePlan();
      },
      (err) => {
        console.warn('[MyPlan] Could not load presented scenario, falling back to base plan:', err);
        scenarioRef.current = null;
        composePlan();
      }
    );
  }

  // ─── Compose what the member sees: base plan + presented scenario overlay ──
  // The base plan always supplies billing/lifecycle fields; the scenario
  // supplies presentation content. Defaults fill anything absent, exactly as
  // the coach's page does, so both surfaces render from the same shape.
  function composePlan() {
    const base = basePlanRef.current;
    if (!base || !user) return;

    let planData: MemberPlanData = base;
    if (base.presentedScenarioId && scenarioRef.current) {
      planData = { ...base, ...scenarioRef.current, id: base.id } as MemberPlanData;
    }

    const defaults = createDefaultPlan(
      planData.memberName || 'Member',
      planDocIdRef.current || user.uid,
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
    setPlan(merged);
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
    // Accept-freeze: write acceptedScenarioId + acceptedAt BEFORE navigating.
    // createCheckoutSession reads acceptedScenarioId to deterministically know
    // which scenario the member is enrolling in. Await the write; only navigate
    // once it's committed, so payment-select can't race the freeze.
    try {
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
          {intakeSubmitted ? (
            <>
              <Text style={st.emptyTitle}>Plan on the Way</Text>
              <Text style={st.emptyText}>
                Your intake is complete! Your coach is building your plan.{'\n'}
                You'll be notified when it's ready.
              </Text>
            </>
          ) : (
            <>
              <Text style={st.emptyTitle}>No Plan Yet</Text>
              <Text style={st.emptyText}>
                Your coach hasn't created your fitness plan yet.{'\n'}
                Complete your intake to get started.
              </Text>
            </>
          )}
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
