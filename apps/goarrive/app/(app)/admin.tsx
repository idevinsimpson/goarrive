/**
 * Admin screen — Platform Operations Dashboard
 *
 * Only visible to users with role === 'platformAdmin' or admin === true.
 * Prompt 4: Full operations control tower with:
 *   1. Provider Health (Zoom, Email, SMS, Push)
 *   2. Scheduling Operations (rooms, allocation, pending, failures)
 *   3. Session Event Log (filterable, drillable)
 *   4. Recording Visibility (ready, processing, missing, failed)
 *   5. Reminder & Notification Stats
 *   6. Dead-Letter Queue (retry, resolve)
 *   7. Registered Coaches + Invite
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, TouchableOpacity,
  StyleSheet, Platform, ActivityIndicator, Share, Linking, Alert,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../lib/AuthContext';
import { router } from 'expo-router';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  collection,
  getDocs,
  orderBy,
  query,
  where,
  onSnapshot,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { db, functions } from '../../lib/firebase';
import type {
  SessionInstance,
  ZoomRoom,
  SystemHealth,
  DeadLetterItem,
  SessionEvent,
} from '../../lib/schedulingTypes';
import {
  formatTime,
  formatDateShort,
  SESSION_EVENT_TYPE_LABELS,
  SESSION_EVENT_SOURCE_LABELS,
  deriveRecordingStatus,
  deriveAttendanceOutcome,
} from '../../lib/schedulingTypes';

const FONT_HEADING = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const BG = '#0E1117';
const CARD_BG = '#1A2035';
const BORDER = '#2A3347';
const GOLD = '#F5A623';
const GREEN = '#6EBB7A';
const RED = '#E05252';
const AMBER = '#F59E0B';
const BLUE = '#5B9BD5';
const MUTED = '#8A95A3';
const TEXT_CLR = '#F0F4F8';
const FG = '#F0F4F8';
const CARD = '#1A2035';
const PURPLE = '#A78BFA';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';
const FH = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Medium';

interface CoachRow { uid: string; name: string; email: string; createdAt?: number; stripeReady?: boolean; }

interface PendingInvite { id: string; email: string; displayName: string; status: string; createdAt?: any; expiresAt?: number; }

interface CoachMember {
  id: string;
  name: string;
  email: string;
  phone?: string;
  isArchived?: boolean;
  planId?: string;
  planStatus?: string;
  checkoutStatus?: string;
  contractMonths?: number;
  displayMonthlyPrice?: number;
}

/** Copy text to clipboard (web + native) */
const copyToClipboard = async (text: string) => {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
};

type AdminTab = 'operations' | 'events' | 'recordings' | 'deadletter' | 'cts_billing' | 'analytics' | 'coaches';

export default function AdminScreen() {
  const { user, claims, adminCoachOverride, setAdminCoachOverride } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('operations');

  // Coach invite state
  const [coachName, setCoachName] = useState('');
  const [coachEmail, setCoachEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteeName, setInviteeName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [loadingCoaches, setLoadingCoaches] = useState(true);

  // Scheduling operations state
  const [rooms, setRooms] = useState<ZoomRoom[]>([]);
  const [failedInstances, setFailedInstances] = useState<SessionInstance[]>([]);
  const [pendingInstances, setPendingInstances] = useState<SessionInstance[]>([]);
  const [allocatedInstances, setAllocatedInstances] = useState<SessionInstance[]>([]);
  const [completedInstances, setCompletedInstances] = useState<SessionInstance[]>([]);
  const [skipRequestedInstances, setSkipRequestedInstances] = useState<SessionInstance[]>([]);
  const [bulkApproving, setBulkApproving] = useState(false);
  const [allocating, setAllocating] = useState(false);
  const [loadingOps, setLoadingOps] = useState(true);

  // Provider health
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  // Session events
  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventFilter, setEventFilter] = useState<string>('all');

  // Dead letter
  const [deadLetterItems, setDeadLetterItems] = useState<DeadLetterItem[]>([]);
  const [loadingDL, setLoadingDL] = useState(false);
  const [retryingDL, setRetryingDL] = useState<string | null>(null);

  // CTS billing monitoring
  const [allCtsFees, setAllCtsFees] = useState<any[]>([]);
  const [loadingCts, setLoadingCts] = useState(false);
  const [ctsDeadLetters, setCtsDeadLetters] = useState<DeadLetterItem[]>([]);

  // Coach member drill-down state
  const [expandedCoachId, setExpandedCoachId] = useState<string | null>(null);
  const [coachMembers, setCoachMembers] = useState<CoachMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Pending invites state
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);

  // Stripe connected account data
  const [stripeData, setStripeData] = useState<any>(null);
  const [loadingStripe, setLoadingStripe] = useState(false);
  const [settingProfitShare, setSettingProfitShare] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [reconcileResults, setReconcileResults] = useState<any>(null);

  const isAdmin = claims?.admin === true || claims?.role === 'platformAdmin';

  // ── Load coaches ──────────────────────────────────────────────────────────
  const fetchCoaches = useCallback(async () => {
    setLoadingCoaches(true);
    try {
      const dbRef = getFirestore();
      let q = query(collection(dbRef, 'coaches'), orderBy('createdAt', 'desc'));
      let snap = await getDocs(q);

      // One-time seed: if no coaches docs exist and we haven't seeded yet this session
      if (snap.empty && !(window as any).__coachesSeeded) {
        try {
          const seedFn = httpsCallable(getFunctions(), 'seedMissingCoachDocs');
          await seedFn({});
          (window as any).__coachesSeeded = true;
          snap = await getDocs(q);
        } catch (seedErr) {
          console.warn('[admin] seedMissingCoachDocs failed', seedErr);
          (window as any).__coachesSeeded = true; // Don't retry on failure
        }
      }

      const rows: CoachRow[] = [];
      snap.forEach((doc) => {
        const d = doc.data();
        rows.push({ uid: doc.id, name: d.name ?? '\u2014', email: d.email ?? '\u2014', createdAt: d.createdAt });
      });

      // Fetch Stripe onboarding status for each coach
      try {
        const stripeSnap = await getDocs(collection(dbRef, 'coachStripeAccounts'));
        const stripeMap: Record<string, boolean> = {};
        stripeSnap.forEach((doc) => {
          const sd = doc.data();
          stripeMap[doc.id] = sd.chargesEnabled === true;
        });
        rows.forEach(r => { r.stripeReady = stripeMap[r.uid] ?? false; });
      } catch (err) {
        console.warn('[admin] Failed to load Stripe accounts', err);
      }

      setCoaches(rows);
    } catch (err) { console.warn('[admin] Failed to load coaches', err); }
    finally { setLoadingCoaches(false); }
  }, []);

  // ── Load coach members (drill-down) — uses server-side Cloud Function ──
  const fetchCoachMembers = useCallback(async (coachUid: string) => {
    setLoadingMembers(true);
    try {
      const fn = httpsCallable(getFunctions(), 'adminGetCoachData');
      const result = await fn({ coachUid });
      const data = result.data as { members: CoachMember[] };
      setCoachMembers(data.members ?? []);
    } catch (err) {
      console.warn('[admin] Failed to load coach members', err);
      // Fallback to client-side query if Cloud Function fails
      try {
        const dbRef = getFirestore();
        const mQ = query(collection(dbRef, 'members'), where('coachId', '==', coachUid));
        const mSnap = await getDocs(mQ);
        const pQ = query(collection(dbRef, 'member_plans'), where('coachId', '==', coachUid), limit(200));
        const pSnap = await getDocs(pQ);
        const planMap: Record<string, any> = {};
        pSnap.docs.forEach(d => {
          const dd = d.data();
          planMap[dd.memberId ?? d.id] = { id: d.id, ...dd };
        });
        const memberList: CoachMember[] = mSnap.docs.map(d => {
          const dd = d.data();
          const plan = planMap[d.id];
          return {
            id: d.id,
            name: dd.name || dd.displayName || `${dd.firstName ?? ''} ${dd.lastName ?? ''}`.trim() || 'Unknown',
            email: dd.email ?? '',
            phone: dd.phone ?? '',
            isArchived: dd.isArchived ?? false,
            planId: plan?.id,
            planStatus: plan?.status ?? 'no plan',
            checkoutStatus: plan?.checkoutStatus,
            contractMonths: plan?.contractMonths,
            displayMonthlyPrice: plan?.pricingResult?.displayMonthlyPrice,
          };
        });
        setCoachMembers(memberList);
      } catch (fallbackErr) {
        console.warn('[admin] Fallback query also failed', fallbackErr);
        setCoachMembers([]);
      }
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  // ── Fetch Stripe connected account data ──────────────────────────────────
  const fetchStripeData = useCallback(async (coachUid: string) => {
    setLoadingStripe(true);
    setStripeData(null);
    try {
      const fn = httpsCallable(getFunctions(), 'getConnectedAccountData');
      const result = await fn({ coachId: coachUid });
      setStripeData(result.data);
    } catch (err: any) {
      console.warn('[admin] Stripe data fetch failed:', err.message);
      setStripeData({ error: err.message });
    } finally {
      setLoadingStripe(false);
    }
  }, []);

  // ── Set Profit Share Start Date ──────────────────────────────────────────
  const handleSetProfitShareStart = useCallback(async (coachId: string, coachName: string) => {
    const dateStr = Platform.OS === 'web'
      ? window.prompt(`Set profit share start date for ${coachName} (YYYY-MM-DD):`)
      : null;
    if (!dateStr) return;
    setSettingProfitShare(true);
    try {
      const fn = httpsCallable(getFunctions(), 'setProfitShareStartDate');
      await fn({ coachId, startDate: dateStr });
      if (Platform.OS === 'web') {
        alert(`Profit share start date set to ${dateStr} for ${coachName}`);
      }
    } catch (err: any) {
      const msg = err.message || 'Failed to set profit share start date';
      if (Platform.OS === 'web') alert(msg);
      else Alert.alert('Error', msg);
    } finally {
      setSettingProfitShare(false);
    }
  }, []);

  // ── Reconcile connected account payments ─────────────────────────────────
  const handleReconcile = useCallback(async () => {
    if (!confirm('Run payment reconciliation? This will check all connected accounts for missed webhook events.')) return;
    setReconciling(true);
    setReconcileResults(null);
    try {
      const fn = httpsCallable(getFunctions(), 'reconcileConnectedAccountPayments');
      const result = await fn({});
      setReconcileResults(result.data);
      alert('Reconciliation complete. Check results below.');
    } catch (err: any) {
      alert('Reconciliation failed: ' + (err.message || 'Unknown error'));
    } finally {
      setReconciling(false);
    }
  }, []);

  // ── Load system health ────────────────────────────────────────────────────
  const fetchHealth = useCallback(async () => {
    setLoadingHealth(true);
    try {
      const fn = httpsCallable(functions, 'getSystemHealth');
      const result = await fn({});
      setSystemHealth(result.data as SystemHealth);
    } catch (err: any) {
      console.warn('[admin] Health check failed:', err.message);
    }
    setLoadingHealth(false);
  }, []);

  // ── Load session events ───────────────────────────────────────────────────
  const fetchEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const fn = httpsCallable(functions, 'getSessionEventLog');
      const params: any = { limit: 100 };
      if (eventFilter !== 'all') params.eventType = eventFilter;
      const result = await fn(params);
      setSessionEvents((result.data as any[]) || []);
    } catch (err: any) {
      console.warn('[admin] Event log fetch failed:', err.message);
    }
    setLoadingEvents(false);
  }, [eventFilter]);

  // ── Load dead letter ──────────────────────────────────────────────────────
  const fetchDeadLetter = useCallback(async () => {
    setLoadingDL(true);
    try {
      const fn = httpsCallable(functions, 'getDeadLetterItems');
      const result = await fn({ limit: 50 });
      setDeadLetterItems((result.data as DeadLetterItem[]) || []);
    } catch (err: any) {
      console.warn('[admin] Dead letter fetch failed:', err.message);
    }
    setLoadingDL(false);
  }, []);

  // ── Load pending coach invites ──────────────────────────────────────────
  const fetchPendingInvites = useCallback(async () => {
    setLoadingInvites(true);
    try {
      const dbRef = getFirestore();
      const q = query(collection(dbRef, 'coachInvites'), where('status', '==', 'pending'));
      const snap = await getDocs(q);
      const invites: PendingInvite[] = snap.docs.map(d => {
        const data = d.data();
        return {
          id: d.id,
          email: data.email ?? '',
          displayName: data.displayName ?? '',
          status: data.status ?? 'pending',
          createdAt: data.createdAt,
          expiresAt: data.expiresAt,
        };
      });
      setPendingInvites(invites);
    } catch (err) {
      console.warn('[admin] Failed to load pending invites', err);
    } finally {
      setLoadingInvites(false);
    }
  }, []);

  // ── Auto-upgrade admin role if needed ────────────────────────────────────
  useEffect(() => {
    if (!isAdmin || !user) return;
    if (claims?.admin === true && claims?.role !== 'platformAdmin') {
      const upgradeFn = httpsCallable(getFunctions(), 'setAdminRole');
      upgradeFn({ targetUid: user.uid })
        .then(() => console.log('[admin] Role upgraded to platformAdmin — sign out and back in for full effect'))
        .catch((err: any) => console.warn('[admin] Auto-upgrade failed', err));
    }
  }, [isAdmin, user, claims]);

  // ── Load scheduling operations data ───────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    fetchCoaches();
    fetchPendingInvites();
    fetchHealth();

    let opsLoaded = 0;
    const checkOps = () => { opsLoaded++; if (opsLoaded >= 5) setLoadingOps(false); };

    const unsubRooms = onSnapshot(
      collection(db, 'zoom_rooms'),
      (snap) => { setRooms(snap.docs.map(d => ({ id: d.id, ...d.data() } as ZoomRoom))); checkOps(); },
      () => checkOps()
    );

    const unsubFailed = onSnapshot(
      query(collection(db, 'session_instances'), where('status', '==', 'allocation_failed')),
      (snap) => { setFailedInstances(snap.docs.map(d => ({ id: d.id, ...d.data() } as SessionInstance))); checkOps(); },
      () => checkOps()
    );

    const unsubPending = onSnapshot(
      query(collection(db, 'session_instances'), where('status', '==', 'scheduled')),
      (snap) => { setPendingInstances(snap.docs.map(d => ({ id: d.id, ...d.data() } as SessionInstance))); checkOps(); },
      () => checkOps()
    );

    const unsubAllocated = onSnapshot(
      query(collection(db, 'session_instances'), where('status', '==', 'allocated')),
      (snap) => { setAllocatedInstances(snap.docs.map(d => ({ id: d.id, ...d.data() } as SessionInstance))); checkOps(); },
      () => checkOps()
    );

    const unsubCompleted = onSnapshot(
      query(collection(db, 'session_instances'), where('status', '==', 'completed')),
      (snap) => { setCompletedInstances(snap.docs.map(d => ({ id: d.id, ...d.data() } as SessionInstance))); checkOps(); },
      () => checkOps()
    );

    const unsubSkipRequested = onSnapshot(
      query(collection(db, 'session_instances'), where('status', '==', 'skip_requested')),
      (snap) => { setSkipRequestedInstances(snap.docs.map(d => ({ id: d.id, ...d.data() } as SessionInstance))); },
      () => {}
    );

    return () => { unsubRooms(); unsubFailed(); unsubPending(); unsubAllocated(); unsubCompleted(); unsubSkipRequested(); };
  }, [isAdmin, fetchCoaches, fetchPendingInvites, fetchHealth]);

  // ── Load CTS billing data ──────────────────────────────────────────────
  const fetchCtsBilling = useCallback(async () => {
    setLoadingCts(true);
    try {
      const dbRef = getFirestore();
      const feesQ = query(
        collection(dbRef, 'ctsAccountabilityFees'),
        orderBy('createdAt', 'desc'),
        limit(200)
      );
      const feesSnap = await getDocs(feesQ);
      setAllCtsFees(feesSnap.docs.map(d => ({ id: d.id, ...d.data() })));

      // CTS-related dead letters
      const dlQ = query(
        collection(dbRef, 'dead_letter'),
        where('type', '==', 'cts_accountability_fee'),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
      const dlSnap = await getDocs(dlQ);
      setCtsDeadLetters(dlSnap.docs.map(d => ({ id: d.id, ...d.data() } as DeadLetterItem)));
    } catch (err) {
      console.warn('[admin] Failed to load CTS billing data', err);
    } finally {
      setLoadingCts(false);
    }
  }, []);

  // Load tab-specific data
  useEffect(() => {
    if (activeTab === 'events') fetchEvents();
    if (activeTab === 'deadletter') fetchDeadLetter();
    if (activeTab === 'cts_billing') fetchCtsBilling();
  }, [activeTab, fetchEvents, fetchDeadLetter, fetchCtsBilling]);

  // ── Coach invite handlers ─────────────────────────────────────────────────
  async function handleGenerateInvite() {
    if (!coachName.trim() || !coachEmail.trim()) { setError('Please enter both name and email.'); return; }
    setInviting(true); setError(null); setInviteUrl(null);
    try {
      const auth = getAuth();
      if (auth.currentUser) await auth.currentUser.getIdToken(true);
      const fns = getFunctions();
      const inviteCoach = httpsCallable<
        { email: string; displayName: string },
        { inviteUrl: string; token: string; expiresAt: number }
      >(fns, 'inviteCoach');
      const res = await inviteCoach({ email: coachEmail.trim(), displayName: coachName.trim() });
      setInviteUrl(res.data.inviteUrl);
      setInviteeName(coachName.trim());
      setCoachName(''); setCoachEmail('');
      fetchCoaches();
      fetchPendingInvites();
    } catch (err: any) {
      const msg = err?.message?.includes('already-exists') ? 'A user with this email already exists.'
        : err?.message?.includes('permission-denied') ? 'Admin access required. Please sign out and back in, then try again.'
        : err?.message ?? 'Failed to generate invite link.';
      setError(msg);
    } finally { setInviting(false); }
  }

  function handleShareEmail() {
    if (!inviteUrl) return;
    const subject = encodeURIComponent('Your GoArrive Coach Invitation');
    const body = encodeURIComponent(
      `Hi ${inviteeName || 'Coach'},\n\nYou have been invited to join GoArrive as a coach!\n\nClick the link below to create your account:\n${inviteUrl}\n\nThis link expires in 7 days.\n\nWelcome to the team!\n\u2014 GoArrive`
    );
    Linking.openURL(`mailto:?subject=${subject}&body=${body}`);
  }

  function handleShareText() {
    if (!inviteUrl) return;
    if (Platform.OS === 'web') {
      if ((navigator as any).share) {
        (navigator as any).share({ title: 'GoArrive Coach Invitation', text: `You have been invited to join GoArrive as a coach! Create your account: ${inviteUrl}`, url: inviteUrl }).catch(() => {});
      } else {
        (navigator as any).clipboard?.writeText(inviteUrl).then(() => alert('Invite link copied to clipboard!'));
      }
    } else {
      Share.share({ message: `You have been invited to join GoArrive as a coach! Create your account here: ${inviteUrl}`, url: inviteUrl });
    }
  }

  function handleCopyLink() {
    if (!inviteUrl || Platform.OS !== 'web') return;
    (navigator as any).clipboard?.writeText(inviteUrl).then(() => alert('Invite link copied!'));
  }

  // ── Scheduling operations handlers ────────────────────────────────────────
  const handleAllocateAll = useCallback(async () => {
    setAllocating(true);
    try {
      const fn = httpsCallable(functions, 'allocateAllPendingInstances');
      const result = await fn({});
      const data = result.data as any;
      Alert.alert('Allocation Complete', `${data.allocated || 0} allocated, ${data.failed || 0} failed.`);
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Allocation failed');
    }
    setAllocating(false);
  }, []);

  const handleRetryInstance = useCallback(async (instanceId: string) => {
    try {
      const fn = httpsCallable(functions, 'allocateSessionInstance');
      const result = await fn({ instanceId });
      const data = result.data as any;
      if (data.success) {
        Alert.alert('Success', 'Room allocated successfully.');
      } else {
        Alert.alert('Still Failing', data.reason || 'Check room availability.');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  }, []);

  const handleRetryDeadLetter = useCallback(async (dlId: string) => {
    setRetryingDL(dlId);
    try {
      const fn = httpsCallable(functions, 'retryDeadLetter');
      await fn({ deadLetterId: dlId });
      Alert.alert('Success', 'Dead letter item retried successfully.');
      fetchDeadLetter();
    } catch (err: any) {
      Alert.alert('Retry Failed', err.message || 'Could not retry.');
    }
    setRetryingDL(null);
  }, [fetchDeadLetter]);

  // ── Recording stats ───────────────────────────────────────────────────────
  const recordingStats = useMemo(() => {
    const allSessions = [...allocatedInstances, ...completedInstances];
    const stats = { ready: 0, processing: 0, pending: 0, missing: 0, notExpected: 0 };
    allSessions.forEach(inst => {
      const rs = deriveRecordingStatus(inst);
      if (rs === 'ready') stats.ready++;
      else if (rs === 'processing') stats.processing++;
      else if (rs === 'pending') stats.pending++;
      else if (rs === 'missing') stats.missing++;
      else stats.notExpected++;
    });
    return stats;
  }, [allocatedInstances, completedInstances]);

  // ── Attendance stats ──────────────────────────────────────────────────────
  const attendanceStats = useMemo(() => {
    const allSessions = [...allocatedInstances, ...completedInstances];
    const stats = { completed: 0, started: 0, joined: 0, missed: 0, canceled: 0, unknown: 0 };
    allSessions.forEach(inst => {
      const ao = deriveAttendanceOutcome(inst);
      if (ao === 'completed') stats.completed++;
      else if (ao === 'started') stats.started++;
      else if (ao === 'joined') stats.joined++;
      else if (ao === 'missed') stats.missed++;
      else if (ao === 'canceled') stats.canceled++;
      else stats.unknown++;
    });
    return stats;
  }, [allocatedInstances, completedInstances]);

  if (!isAdmin) {
    return (
      <View style={s.root}>
        <View style={s.centered}>
          <Icon name="lock-closed-outline" size={40} color="#4A5568" />
          <Text style={s.lockedText}>Admin access required</Text>
        </View>
      </View>
    );
  }

  const activeRooms = rooms.filter(r => r.status === 'active');
  const inactiveRooms = rooms.filter(r => r.status !== 'active');

  // ── Tab bar ───────────────────────────────────────────────────────────────
  const tabs: { key: AdminTab; label: string; icon: string }[] = [
    { key: 'operations', label: 'Operations', icon: 'pulse-outline' },
    { key: 'events', label: 'Event Log', icon: 'list-outline' },
    { key: 'recordings', label: 'Recordings', icon: 'videocam-outline' },
    { key: 'deadletter', label: 'Failures', icon: 'alert-circle-outline' },
    { key: 'cts_billing', label: 'CTS Billing', icon: 'cash-outline' },
    { key: 'analytics', label: 'Analytics', icon: 'bar-chart-outline' },
    { key: 'coaches', label: 'Coaches', icon: 'people-outline' },
  ];

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.title}>Operations Center</Text>
      <Text style={s.subtitle}>Platform administration and session operations</Text>

      {/* ── Tab Bar ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tabBar} contentContainerStyle={s.tabBarContent}>
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[s.tab, activeTab === tab.key && s.tabActive]}
            onPress={() => setActiveTab(tab.key)}
          >
            <Icon name={tab.icon as any} size={16} color={activeTab === tab.key ? GOLD : MUTED} />
            <Text style={[s.tabText, activeTab === tab.key && s.tabTextActive]}>{tab.label}</Text>
            {tab.key === 'deadletter' && deadLetterItems.length > 0 && (
              <View style={s.badge}><Text style={s.badgeText}>{deadLetterItems.length}</Text></View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ══════════════════════════════════════════════════════════════════════
         TAB: OPERATIONS
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'operations' && (
        <>
          {/* ── Top Stats ── */}
          <View style={s.statsRow}>
            <View style={s.statCard}>
              <Text style={[s.statValue, { color: GREEN }]}>{activeRooms.length}</Text>
              <Text style={s.statLabel}>Active Rooms</Text>
            </View>
            <View style={s.statCard}>
              <Text style={[s.statValue, { color: pendingInstances.length > 0 ? AMBER : GREEN }]}>
                {pendingInstances.length}
              </Text>
              <Text style={s.statLabel}>Pending</Text>
            </View>
            <View style={s.statCard}>
              <Text style={[s.statValue, { color: allocatedInstances.length > 0 ? BLUE : MUTED }]}>
                {allocatedInstances.length}
              </Text>
              <Text style={s.statLabel}>Allocated</Text>
            </View>
            <View style={s.statCard}>
              <Text style={[s.statValue, { color: failedInstances.length > 0 ? RED : GREEN }]}>
                {failedInstances.length}
              </Text>
              <Text style={s.statLabel}>Failed</Text>
            </View>
          </View>

          {/* ── Provider Health ── */}
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardTitle}>Provider Health</Text>
              <TouchableOpacity onPress={fetchHealth} disabled={loadingHealth}>
                {loadingHealth ? <ActivityIndicator size="small" color={GOLD} /> :
                  <Icon name="refresh-outline" size={18} color={GOLD} />}
              </TouchableOpacity>
            </View>
            {systemHealth ? (
              <>
                {/* Zoom */}
                <View style={s.providerRow}>
                  <View style={[s.modeBadge, { backgroundColor: systemHealth.zoom.mode === 'live' ? GREEN + '20' : AMBER + '20' }]}>
                    <Text style={[s.modeBadgeText, { color: systemHealth.zoom.mode === 'live' ? GREEN : AMBER }]}>
                      {systemHealth.zoom.mode === 'live' ? 'LIVE' : 'MOCK'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.providerName}>Zoom</Text>
                    <Text style={s.providerDetail}>{systemHealth.zoom.name}</Text>
                  </View>
                  {systemHealth.zoom.apiReachable !== null && (
                    <View style={[s.statusPill, { backgroundColor: systemHealth.zoom.apiReachable ? GREEN + '20' : RED + '20' }]}>
                      <Text style={{ fontSize: 10, color: systemHealth.zoom.apiReachable ? GREEN : RED, fontFamily: FONT_BODY }}>
                        {systemHealth.zoom.apiReachable ? 'API OK' : 'API Error'}
                      </Text>
                    </View>
                  )}
                </View>
                {/* Zoom credentials */}
                <View style={s.credRow}>
                  {Object.entries(systemHealth.zoom.credentials).map(([key, present]) => (
                    <View key={key} style={s.credItem}>
                      <Icon name={present ? 'checkmark-circle' : 'close-circle'} size={12} color={present ? GREEN : RED} />
                      <Text style={s.credText}>{key}</Text>
                    </View>
                  ))}
                </View>

                {/* Email */}
                <View style={s.providerRow}>
                  <View style={[s.modeBadge, { backgroundColor: systemHealth.notifications.email.mode === 'live' ? GREEN + '20' : AMBER + '20' }]}>
                    <Text style={[s.modeBadgeText, { color: systemHealth.notifications.email.mode === 'live' ? GREEN : AMBER }]}>
                      {systemHealth.notifications.email.mode === 'live' ? 'LIVE' : 'MOCK'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.providerName}>Email</Text>
                    <Text style={s.providerDetail}>{systemHealth.notifications.email.name}</Text>
                  </View>
                </View>

                {/* SMS */}
                <View style={s.providerRow}>
                  <View style={[s.modeBadge, { backgroundColor: systemHealth.notifications.sms.mode === 'live' ? GREEN + '20' : AMBER + '20' }]}>
                    <Text style={[s.modeBadgeText, { color: systemHealth.notifications.sms.mode === 'live' ? GREEN : AMBER }]}>
                      {systemHealth.notifications.sms.mode === 'live' ? 'LIVE' : 'MOCK'}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.providerName}>SMS</Text>
                    <Text style={s.providerDetail}>{systemHealth.notifications.sms.name}</Text>
                  </View>
                </View>

                {/* Push */}
                <View style={s.providerRow}>
                  <View style={[s.modeBadge, { backgroundColor: AMBER + '20' }]}>
                    <Text style={[s.modeBadgeText, { color: AMBER }]}>MOCK</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.providerName}>Push</Text>
                    <Text style={s.providerDetail}>{systemHealth.notifications.push.name}</Text>
                  </View>
                </View>

                {/* ME Items */}
                {systemHealth.zoom.mode === 'mock' && (
                  <View style={s.meBox}>
                    <Text style={s.meTitle}>ME Items Required</Text>
                    <Text style={s.meText}>Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET in Firebase secrets to enable live Zoom.</Text>
                    {!systemHealth.zoom.credentials.webhookSecret && (
                      <Text style={s.meText}>Set ZOOM_WEBHOOK_SECRET for webhook signature verification.</Text>
                    )}
                    <Text style={s.meText}>Set EMAIL_API_KEY (Resend) for live email delivery.</Text>
                    <Text style={s.meText}>Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER for live SMS.</Text>
                  </View>
                )}
              </>
            ) : loadingHealth ? (
              <ActivityIndicator color={GOLD} style={{ marginVertical: 12 }} />
            ) : (
              <Text style={s.emptyText}>Health check not loaded.</Text>
            )}
          </View>

          {/* ── Reminder & Notification Stats ── */}
          {systemHealth && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Reminders & Notifications (Today)</Text>
              <View style={s.healthRow}>
                <View style={s.healthItem}>
                  <Text style={[s.healthValue, { color: BLUE }]}>{systemHealth.reminderStats.scheduled}</Text>
                  <Text style={s.healthLabel}>Scheduled</Text>
                </View>
                <View style={s.healthItem}>
                  <Text style={[s.healthValue, { color: GREEN }]}>{systemHealth.reminderStats.sent}</Text>
                  <Text style={s.healthLabel}>Sent</Text>
                </View>
                <View style={s.healthItem}>
                  <Text style={[s.healthValue, { color: systemHealth.reminderStats.failed > 0 ? RED : MUTED }]}>{systemHealth.reminderStats.failed}</Text>
                  <Text style={s.healthLabel}>Failed</Text>
                </View>
                <View style={s.healthItem}>
                  <Text style={[s.healthValue, { color: MUTED }]}>{systemHealth.reminderStats.skipped}</Text>
                  <Text style={s.healthLabel}>Skipped</Text>
                </View>
              </View>
              <View style={[s.healthRow, { marginTop: 8 }]}>
                <View style={s.healthItem}>
                  <Text style={[s.healthValue, { color: BLUE }]}>{systemHealth.notificationStats.pending}</Text>
                  <Text style={s.healthLabel}>Notif Pending</Text>
                </View>
                <View style={s.healthItem}>
                  <Text style={[s.healthValue, { color: GREEN }]}>{systemHealth.notificationStats.sent}</Text>
                  <Text style={s.healthLabel}>Notif Sent</Text>
                </View>
                <View style={s.healthItem}>
                  <Text style={[s.healthValue, { color: systemHealth.notificationStats.failed > 0 ? RED : MUTED }]}>{systemHealth.notificationStats.failed}</Text>
                  <Text style={s.healthLabel}>Notif Failed</Text>
                </View>
                <View style={s.healthItem}>
                  <Text style={[s.healthValue, { color: systemHealth.deadLetterCount > 0 ? RED : GREEN }]}>{systemHealth.deadLetterCount}</Text>
                  <Text style={s.healthLabel}>Dead Letters</Text>
                </View>
              </View>
            </View>
          )}

          {/* ── Attendance Summary ── */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Attendance Summary</Text>
            <View style={s.healthRow}>
              <View style={s.healthItem}>
                <Text style={[s.healthValue, { color: GREEN }]}>{attendanceStats.completed}</Text>
                <Text style={s.healthLabel}>Completed</Text>
              </View>
              <View style={s.healthItem}>
                <Text style={[s.healthValue, { color: BLUE }]}>{attendanceStats.started}</Text>
                <Text style={s.healthLabel}>Started</Text>
              </View>
              <View style={s.healthItem}>
                <Text style={[s.healthValue, { color: attendanceStats.missed > 0 ? RED : MUTED }]}>{attendanceStats.missed}</Text>
                <Text style={s.healthLabel}>Missed</Text>
              </View>
              <View style={s.healthItem}>
                <Text style={[s.healthValue, { color: MUTED }]}>{attendanceStats.unknown}</Text>
                <Text style={s.healthLabel}>Unknown</Text>
              </View>
            </View>
          </View>

          {/* ── Allocate All Pending ── */}
          {pendingInstances.length > 0 && (
            <TouchableOpacity style={s.allocateBar} onPress={handleAllocateAll} disabled={allocating}>
              {allocating ? <ActivityIndicator size="small" color={BG} /> : (
                <Text style={s.allocateBarText}>
                  Allocate rooms for {pendingInstances.length} pending session{pendingInstances.length !== 1 ? 's' : ''}
                </Text>
              )}
            </TouchableOpacity>
          )}

          {/* ── Room Pool ── */}
          {!loadingOps && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Shared Hosted Resources</Text>
              <Text style={s.cardSub}>
                {activeRooms.length} active · {inactiveRooms.length} inactive · {rooms.length} total
              </Text>
              {rooms.length === 0 ? (
                <Text style={s.emptyText}>No rooms configured. Add Zoom rooms to enable session hosting.</Text>
              ) : (
                rooms.slice(0, 10).map(room => (
                  <View key={room.id} style={s.roomRow}>
                    <View style={[s.statusDot, { backgroundColor: room.status === 'active' ? GREEN : room.status === 'maintenance' ? AMBER : MUTED }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.roomName}>{room.label || room.id}</Text>
                      <Text style={s.roomMeta}>
                        {room.status === 'active' ? 'Active' : room.status === 'maintenance' ? 'Maintenance' : 'Inactive'} · {room.zoomAccountEmail || 'No email'}
                      </Text>
                    </View>
                  </View>
                ))
              )}
              {rooms.length > 10 && <Text style={s.moreText}>+ {rooms.length - 10} more rooms</Text>}
            </View>
          )}

          {/* ── Allocation Failures ── */}
          {!loadingOps && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Allocation Failures</Text>
              <Text style={s.cardSub}>
                {failedInstances.length === 0
                  ? 'All clear — no failures.'
                  : `${failedInstances.length} session${failedInstances.length !== 1 ? 's' : ''} need attention`}
              </Text>
              {failedInstances.map(inst => (
                <View key={inst.id} style={s.failRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.failMember}>{inst.memberName || 'Unknown'}</Text>
                    <Text style={s.failMeta}>
                      {inst.scheduledDate} · {inst.scheduledStartTime} · Attempts: {inst.allocationAttempts || 0}
                    </Text>
                    <Text style={s.failReason}>{inst.allocationFailReason || 'No rooms available'}</Text>
                  </View>
                  <TouchableOpacity style={s.retryBtn} onPress={() => handleRetryInstance(inst.id)}>
                    <Text style={s.retryBtnText}>Retry</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* ── Pending Skip Requests (Bulk Approval) ── */}
          {skipRequestedInstances.length > 0 && (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.cardTitle}>Pending Skip Requests ({skipRequestedInstances.length})</Text>
                <TouchableOpacity
                  style={[s.retryBtn, { backgroundColor: '#1E40AF', paddingHorizontal: 12 }]}
                  onPress={async () => {
                    setBulkApproving(true);
                    try {
                      const fn = httpsCallable(functions, 'updateRecurringSlot');
                      let approved = 0;
                      for (const inst of skipRequestedInstances) {
                        try {
                          await fn({
                            slotId: inst.recurringSlotId,
                            action: 'approve_skip_request',
                            instanceId: inst.id,
                          });
                          approved++;
                        } catch (err) {
                          console.error(`Failed to approve skip for ${inst.id}:`, err);
                        }
                      }
                      Alert.alert('Bulk Approve', `Approved ${approved} of ${skipRequestedInstances.length} skip requests.`);
                    } catch (err: any) {
                      Alert.alert('Error', err.message || 'Bulk approval failed');
                    } finally {
                      setBulkApproving(false);
                    }
                  }}
                  disabled={bulkApproving}
                >
                  {bulkApproving
                    ? <ActivityIndicator size="small" color="#FFF" />
                    : <Text style={[s.retryBtnText, { color: '#FFF' }]}>Approve All</Text>
                  }
                </TouchableOpacity>
              </View>
              {skipRequestedInstances.map(inst => (
                <View key={inst.id} style={[s.failRow, { borderLeftColor: '#F59E0B' }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.failId}>{(inst as any).memberName || inst.memberId}</Text>
                    <Text style={s.failReason}>
                      {(inst as any).skipCategory ? `[${(inst as any).skipCategory}] ` : ''}
                      {(inst as any).skipReason || 'No reason given'}
                    </Text>
                    <Text style={{ fontSize: 9, color: MUTED, fontFamily: FONT_BODY }}>
                      {inst.scheduledDate} at {(inst as any).scheduledTime || '—'}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TouchableOpacity
                      style={[s.retryBtn, { backgroundColor: '#16A34A' }]}
                      onPress={async () => {
                        try {
                          const fn = httpsCallable(functions, 'updateRecurringSlot');
                          await fn({
                            slotId: inst.recurringSlotId,
                            action: 'approve_skip_request',
                            instanceId: inst.id,
                          });
                        } catch (err: any) {
                          Alert.alert('Error', err.message || 'Failed to approve');
                        }
                      }}
                    >
                      <Text style={[s.retryBtnText, { color: '#FFF' }]}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.retryBtn, { backgroundColor: '#DC2626' }]}
                      onPress={async () => {
                        try {
                          const fn = httpsCallable(functions, 'updateRecurringSlot');
                          await fn({
                            slotId: inst.recurringSlotId,
                            action: 'deny_skip_request',
                            instanceId: inst.id,
                          });
                        } catch (err: any) {
                          Alert.alert('Error', err.message || 'Failed to deny');
                        }
                      }}
                    >
                      <Text style={[s.retryBtnText, { color: '#FFF' }]}>Deny</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
         TAB: EVENT LOG
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'events' && (
        <>
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardTitle}>Session Event Log</Text>
              <TouchableOpacity onPress={fetchEvents} disabled={loadingEvents}>
                {loadingEvents ? <ActivityIndicator size="small" color={GOLD} /> :
                  <Icon name="refresh-outline" size={18} color={GOLD} />}
              </TouchableOpacity>
            </View>

            {/* Filter chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {['all', 'meeting_created', 'meeting_started', 'meeting_ended', 'participant_joined', 'recording_completed', 'session_cancelled', 'session_rescheduled', 'meeting_creation_failed'].map(f => (
                  <TouchableOpacity
                    key={f}
                    style={[s.filterChip, eventFilter === f && s.filterChipActive]}
                    onPress={() => setEventFilter(f)}
                  >
                    <Text style={[s.filterChipText, eventFilter === f && s.filterChipTextActive]}>
                      {f === 'all' ? 'All' : (SESSION_EVENT_TYPE_LABELS[f] || f)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {loadingEvents ? (
              <ActivityIndicator color={GOLD} style={{ marginVertical: 16 }} />
            ) : sessionEvents.length === 0 ? (
              <Text style={s.emptyText}>No events found.</Text>
            ) : (
              sessionEvents.slice(0, 50).map((evt: any, i: number) => (
                <View key={evt.id || i} style={s.eventRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={[s.modeBadge, { backgroundColor: evt.providerMode === 'live' ? GREEN + '20' : AMBER + '20', paddingHorizontal: 6, paddingVertical: 2 }]}>
                        <Text style={{ fontSize: 9, color: evt.providerMode === 'live' ? GREEN : AMBER, fontFamily: FONT_BODY, fontWeight: '600' }}>
                          {evt.providerMode?.toUpperCase() || '?'}
                        </Text>
                      </View>
                      <Text style={s.eventType}>{SESSION_EVENT_TYPE_LABELS[evt.eventType] || evt.eventType}</Text>
                    </View>
                    <Text style={s.eventMeta}>
                      {SESSION_EVENT_SOURCE_LABELS[evt.source] || evt.source} · {evt.occurrenceId?.slice(0, 12)}...
                    </Text>
                    {evt.payload?.error && <Text style={s.eventError}>{evt.payload.error}</Text>}
                  </View>
                  <Text style={s.eventTime}>
                    {evt.timestamp?.toDate ? new Date(evt.timestamp.toDate()).toLocaleString() :
                     evt.timestamp?._seconds ? new Date(evt.timestamp._seconds * 1000).toLocaleString() : '—'}
                  </Text>
                </View>
              ))
            )}
          </View>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
         TAB: RECORDINGS
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'recordings' && (
        <>
          <View style={s.card}>
            <Text style={s.cardTitle}>Recording Status Overview</Text>
            <View style={s.healthRow}>
              <View style={s.healthItem}>
                <Text style={[s.healthValue, { color: GREEN }]}>{recordingStats.ready}</Text>
                <Text style={s.healthLabel}>Ready</Text>
              </View>
              <View style={s.healthItem}>
                <Text style={[s.healthValue, { color: BLUE }]}>{recordingStats.processing}</Text>
                <Text style={s.healthLabel}>Processing</Text>
              </View>
              <View style={s.healthItem}>
                <Text style={[s.healthValue, { color: AMBER }]}>{recordingStats.pending}</Text>
                <Text style={s.healthLabel}>Pending</Text>
              </View>
              <View style={s.healthItem}>
                <Text style={[s.healthValue, { color: recordingStats.missing > 0 ? RED : MUTED }]}>{recordingStats.missing}</Text>
                <Text style={s.healthLabel}>Missing</Text>
              </View>
            </View>
          </View>

          {/* Sessions with recordings */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Sessions with Recordings</Text>
            {[...completedInstances, ...allocatedInstances]
              .filter(inst => deriveRecordingStatus(inst) === 'ready')
              .slice(0, 20)
              .map(inst => (
                <View key={inst.id} style={s.eventRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.failMember}>{inst.memberName || 'Unknown'}</Text>
                    <Text style={s.failMeta}>{inst.scheduledDate} · {inst.scheduledStartTime}</Text>
                    {inst.recordings && inst.recordings.length > 0 && (
                      <View>
                        <Text style={[s.failMeta, { color: GREEN }]}>
                          {inst.recordings.length} file{inst.recordings.length !== 1 ? 's' : ''} · {inst.recordings.map((r: any) => r.fileType).join(', ')}
                        </Text>
                        {inst.recordings.map((rec: any, ri: number) => (
                          <Pressable
                            key={ri}
                            onPress={() => {
                              const url = rec.playUrl || rec.downloadUrl;
                              if (url) Linking.openURL(url);
                            }}
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 }}
                          >
                            <Text style={{ fontSize: 10, color: BLUE, fontFamily: FONT_BODY, textDecorationLine: 'underline' }} numberOfLines={1}>
                              {rec.playUrl ? 'Play' : 'Download'} {rec.fileType || `Recording ${ri + 1}`}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    {inst.zoomRecordingUrl && !inst.recordings?.length && (
                      <Pressable onPress={() => Linking.openURL(inst.zoomRecordingUrl!)} style={{ paddingVertical: 2 }}>
                        <Text style={{ fontSize: 10, color: BLUE, fontFamily: FONT_BODY, textDecorationLine: 'underline' }}>View Recording</Text>
                      </Pressable>
                    )}
                    {(inst as any).transcriptionUrl && (
                      <Pressable onPress={() => Linking.openURL((inst as any).transcriptionUrl)} style={{ paddingVertical: 2, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <Text style={{ fontSize: 10, color: BLUE, fontFamily: FONT_BODY, textDecorationLine: 'underline' }}>View Transcript</Text>
                        {(inst as any).transcriptionStatus && (
                          <Text style={{ fontSize: 9, color: MUTED, fontFamily: FONT_BODY }}>({(inst as any).transcriptionStatus})</Text>
                        )}
                      </Pressable>
                    )}
                  </View>
                  <View style={[s.statusPill, { backgroundColor: GREEN + '20' }]}>
                    <Text style={{ fontSize: 10, color: GREEN, fontFamily: FONT_BODY }}>Ready</Text>
                  </View>
                </View>
              ))}
            {[...completedInstances, ...allocatedInstances].filter(inst => deriveRecordingStatus(inst) === 'ready').length === 0 && (
              <Text style={s.emptyText}>No recordings ready yet.</Text>
            )}
          </View>

          {/* Sessions pending recording */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Awaiting Recordings</Text>
            {[...completedInstances]
              .filter(inst => deriveRecordingStatus(inst) === 'pending')
              .slice(0, 20)
              .map(inst => (
                <View key={inst.id} style={s.eventRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.failMember}>{inst.memberName || 'Unknown'}</Text>
                    <Text style={s.failMeta}>{inst.scheduledDate} · {inst.scheduledStartTime}</Text>
                  </View>
                  <View style={[s.statusPill, { backgroundColor: AMBER + '20' }]}>
                    <Text style={{ fontSize: 10, color: AMBER, fontFamily: FONT_BODY }}>Pending</Text>
                  </View>
                </View>
              ))}
            {completedInstances.filter(inst => deriveRecordingStatus(inst) === 'pending').length === 0 && (
              <Text style={s.emptyText}>No sessions awaiting recordings.</Text>
            )}
          </View>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
         TAB: DEAD LETTER / FAILURES
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'deadletter' && (
        <>
          <View style={s.card}>
            <View style={s.cardHeader}>
              <Text style={s.cardTitle}>Dead-Letter Queue</Text>
              <TouchableOpacity onPress={fetchDeadLetter} disabled={loadingDL}>
                {loadingDL ? <ActivityIndicator size="small" color={GOLD} /> :
                  <Icon name="refresh-outline" size={18} color={GOLD} />}
              </TouchableOpacity>
            </View>
            <Text style={s.cardSub}>
              {deadLetterItems.length === 0
                ? 'All clear — no unresolved failures.'
                : `${deadLetterItems.length} unresolved item${deadLetterItems.length !== 1 ? 's' : ''}`}
            </Text>

            {loadingDL ? (
              <ActivityIndicator color={GOLD} style={{ marginVertical: 16 }} />
            ) : (
              deadLetterItems.map((dl: any) => (
                <View key={dl.id} style={s.dlRow}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Icon name="alert-circle" size={14} color={RED} />
                      <Text style={s.dlType}>{dl.type?.replace(/_/g, ' ') || 'Unknown'}</Text>
                    </View>
                    <Text style={s.dlError} numberOfLines={2}>{dl.error || 'No error details'}</Text>
                    <Text style={s.dlMeta}>
                      Source: {dl.sourceCollection || '—'} · Retries: {dl.retryCount || 0}
                    </Text>
                    {dl.lastRetryError && (
                      <Text style={[s.dlError, { marginTop: 2 }]}>Last retry: {dl.lastRetryError}</Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={s.retryBtn}
                    onPress={() => handleRetryDeadLetter(dl.id)}
                    disabled={retryingDL === dl.id}
                  >
                    {retryingDL === dl.id ? (
                      <ActivityIndicator size="small" color={GOLD} />
                    ) : (
                      <Text style={s.retryBtnText}>Retry</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
         TAB: CTS BILLING
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'cts_billing' && (
        <>
          <View style={s.cardHeader}>
            <Text style={s.sectionTitle}>CTS Accountability Fees</Text>
            <TouchableOpacity onPress={fetchCtsBilling} disabled={loadingCts}>
              {loadingCts ? <ActivityIndicator size="small" color={GOLD} /> :
                <Icon name="refresh-outline" size={18} color={GOLD} />}
            </TouchableOpacity>
          </View>
          <Text style={s.sectionSub}>All missed session fees across the platform</Text>

          {loadingCts ? (
            <ActivityIndicator color={GOLD} style={{ marginTop: 20 }} />
          ) : (
            <>
              {/* Summary stats */}
              <View style={s.statsRow}>
                <View style={s.statCard}>
                  <Text style={[s.statValue, { color: RED }]}>
                    {allCtsFees.filter(f => !f.waived && f.status !== 'waived').length}
                  </Text>
                  <Text style={s.statLabel}>Charged</Text>
                </View>
                <View style={s.statCard}>
                  <Text style={[s.statValue, { color: GREEN }]}>
                    {allCtsFees.filter(f => f.waived || f.status === 'waived').length}
                  </Text>
                  <Text style={s.statLabel}>Waived</Text>
                </View>
                <View style={s.statCard}>
                  <Text style={[s.statValue, { color: AMBER }]}>
                    {ctsDeadLetters.length}
                  </Text>
                  <Text style={s.statLabel}>Failed</Text>
                </View>
                <View style={s.statCard}>
                  <Text style={[s.statValue, { color: BLUE }]}>
                    ${Math.round(allCtsFees.reduce((sum: number, f: any) => sum + (f.feeCents || 0), 0) / 100)}
                  </Text>
                  <Text style={s.statLabel}>Total Fees</Text>
                </View>
              </View>

              {/* Recent fees list */}
              <View style={s.card}>
                <Text style={s.cardTitle}>Recent Fees</Text>
                {allCtsFees.length === 0 ? (
                  <Text style={{ color: MUTED, fontSize: 12, marginTop: 8 }}>No CTS accountability fees recorded yet.</Text>
                ) : (
                  allCtsFees.slice(0, 50).map((fee: any) => (
                    <View key={fee.id} style={{
                      flexDirection: 'row', alignItems: 'center', gap: 10,
                      paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER + '44',
                    }}>
                      <View style={{
                        width: 8, height: 8, borderRadius: 4,
                        backgroundColor: fee.waived || fee.status === 'waived' ? GREEN : RED,
                      }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: TEXT_CLR, fontSize: 13, fontWeight: '600', fontFamily: FONT_BODY }}>
                          {fee.memberName || fee.memberId?.slice(0, 8) || 'Unknown'}
                        </Text>
                        <Text style={{ color: MUTED, fontSize: 11, fontFamily: FONT_BODY }}>
                          {fee.scheduledDate || 'N/A'}
                          {fee.scheduledStartTime ? ` at ${fee.scheduledStartTime}` : ''}
                          {' \u00B7 $'}{Math.round((fee.feeCents || 0) / 100)}
                          {fee.waived || fee.status === 'waived' ? ' \u00B7 Waived' : ''}
                          {fee.stripeInvoiceId ? ` \u00B7 ${fee.stripeInvoiceId.slice(0, 12)}...` : ''}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>

              {/* CTS Dead Letters */}
              {ctsDeadLetters.length > 0 && (
                <View style={s.card}>
                  <Text style={[s.cardTitle, { color: RED }]}>Failed CTS Charges</Text>
                  <Text style={{ color: MUTED, fontSize: 11, marginBottom: 8 }}>
                    These charges failed and were sent to the dead letter queue
                  </Text>
                  {ctsDeadLetters.map((dl: any) => (
                    <View key={dl.id} style={{
                      flexDirection: 'row', alignItems: 'center', gap: 10,
                      paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: BORDER + '44',
                    }}>
                      <Icon name="alert-circle" size={16} color={RED} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: TEXT_CLR, fontSize: 12, fontFamily: FONT_BODY }}>
                          {dl.payload?.memberId?.slice(0, 8) || 'Unknown'}
                        </Text>
                        <Text style={{ color: MUTED, fontSize: 10, fontFamily: FONT_BODY }}>
                          {dl.error || 'Unknown error'}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
         TAB: ANALYTICS
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'analytics' && (
        <AnalyticsDashboard />
      )}

      {/* ══════════════════════════════════════════════════════════════════════
         TAB: COACHES
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'coaches' && (
        <>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View>
              <Text style={s.sectionTitle}>Registered Coaches</Text>
              <Text style={s.sectionSub}>All coaches on the platform.</Text>
            </View>
            <TouchableOpacity
              style={[s.viewAsCoachBtn, { backgroundColor: RED + '20' }]}
              onPress={handleReconcile}
              disabled={reconciling}
              activeOpacity={0.7}
            >
              <Icon name="sync-outline" size={14} color={RED} />
              <Text style={[s.viewAsCoachBtnText, { color: RED }]}>
                {reconciling ? 'Reconciling...' : 'Reconcile Payments'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Reconciliation Results */}
          {reconcileResults && (
            <View style={{ backgroundColor: '#0E1117', borderRadius: 8, padding: 12, marginBottom: 12 }}>
              <Text style={{ color: GOLD, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>Reconciliation Results</Text>
              {reconcileResults.results?.map((r: any, i: number) => (
                <View key={i} style={{ marginBottom: 6 }}>
                  <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '600' }}>{r.coachName}</Text>
                  <Text style={{ color: GREEN, fontSize: 11 }}>Sessions reconciled: {r.sessionsReconciled}</Text>
                  <Text style={{ color: GREEN, fontSize: 11 }}>Invoices reconciled: {r.invoicesReconciled}</Text>
                  {r.errors?.length > 0 && (
                    <Text style={{ color: RED, fontSize: 11 }}>Errors: {r.errors.join(', ')}</Text>
                  )}
                </View>
              ))}
            </View>
          )}

          {loadingCoaches ? (
            <ActivityIndicator color={GOLD} style={{ marginVertical: 16 }} />
          ) : coaches.length === 0 ? (
            <Text style={s.emptyText}>No coaches registered yet.</Text>
          ) : (
            <View style={s.coachList}>
              {coaches.map((c, i) => (
                <View key={c.uid}>
                  <TouchableOpacity
                    style={[s.coachRow, i === coaches.length - 1 && !expandedCoachId && s.coachRowLast]}
                    onPress={() => {
                      if (expandedCoachId === c.uid) {
                        setExpandedCoachId(null);
                        setCoachMembers([]);
                      } else {
                        setExpandedCoachId(c.uid);
                        fetchCoachMembers(c.uid);
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <View style={s.avatar}><Text style={s.avatarInitial}>{(c.name?.[0] ?? '?').toUpperCase()}</Text></View>
                    <View style={s.coachInfo}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={s.coachName}>{c.name}</Text>
                        <View style={[s.statusDot, { backgroundColor: c.stripeReady ? GREEN : RED }]} />
                      </View>
                      <Text style={s.coachEmail}>{c.email}</Text>
                      {c.createdAt ? <Text style={s.coachDate}>Joined {new Date(c.createdAt).toLocaleDateString()}</Text> : null}
                    </View>
                    <Icon name={expandedCoachId === c.uid ? 'chevron-down' : 'chevron-right'} size={16} color={MUTED} />
                  </TouchableOpacity>

                  {/* Expanded member list */}
                  {expandedCoachId === c.uid && (
                    <View style={s.memberSection}>
                      {/* Action buttons row */}
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
                        <TouchableOpacity
                          style={s.viewAsCoachBtn}
                          onPress={() => {
                            setAdminCoachOverride(c.uid, c.name);
                            router.push('/(app)/dashboard');
                          }}
                          activeOpacity={0.7}
                        >
                          <Icon name="eye-outline" size={14} color={GOLD} />
                          <Text style={s.viewAsCoachBtnText}>View as {c.name.split(' ')[0]}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[s.viewAsCoachBtn, { backgroundColor: '#5B9BD5' + '20' }]}
                          onPress={() => handleSetProfitShareStart(c.uid, c.name)}
                          disabled={settingProfitShare}
                          activeOpacity={0.7}
                        >
                          <Icon name="calendar-outline" size={14} color="#5B9BD5" />
                          <Text style={[s.viewAsCoachBtnText, { color: '#5B9BD5' }]}>
                            {settingProfitShare ? 'Setting...' : 'Set Profit Share Start'}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[s.viewAsCoachBtn, { backgroundColor: GREEN + '20' }]}
                          onPress={() => fetchStripeData(c.uid)}
                          disabled={loadingStripe}
                          activeOpacity={0.7}
                        >
                          <Icon name="card-outline" size={14} color={GREEN} />
                          <Text style={[s.viewAsCoachBtnText, { color: GREEN }]}>
                            {loadingStripe ? 'Loading...' : 'View Stripe Data'}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      {/* Stripe Data Panel */}
                      {stripeData && expandedCoachId === c.uid && (
                        <View style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                          {stripeData.error ? (
                            <Text style={{ color: RED, fontSize: 12 }}>Error: {stripeData.error}</Text>
                          ) : (
                            <View style={{ backgroundColor: '#0E1117', borderRadius: 8, padding: 12 }}>
                              <Text style={{ color: GOLD, fontSize: 13, fontWeight: '700', marginBottom: 8 }}>Stripe Connected Account</Text>
                              <Text style={{ color: MUTED, fontSize: 11, marginBottom: 4 }}>Account: {stripeData.stripeAccountId}</Text>
                              
                              {/* Balance */}
                              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '600', marginTop: 8, marginBottom: 4 }}>Balance</Text>
                              {stripeData.balance?.available?.map((b: any, i: number) => (
                                <Text key={i} style={{ color: GREEN, fontSize: 11 }}>Available: ${(b.amount / 100).toFixed(2)} {b.currency?.toUpperCase()}</Text>
                              ))}
                              {stripeData.balance?.pending?.map((b: any, i: number) => (
                                <Text key={i} style={{ color: MUTED, fontSize: 11 }}>Pending: ${(b.amount / 100).toFixed(2)} {b.currency?.toUpperCase()}</Text>
                              ))}

                              {/* Customers */}
                              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '600', marginTop: 10, marginBottom: 4 }}>Customers ({stripeData.customers?.length ?? 0})</Text>
                              {stripeData.customers?.map((cust: any) => (
                                <Text key={cust.id} style={{ color: MUTED, fontSize: 11 }}>{cust.name} — {cust.email}</Text>
                              ))}

                              {/* Subscriptions */}
                              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '600', marginTop: 10, marginBottom: 4 }}>Subscriptions ({stripeData.subscriptions?.length ?? 0})</Text>
                              {stripeData.subscriptions?.map((sub: any) => (
                                <View key={sub.id} style={{ marginBottom: 4 }}>
                                  <Text style={{ color: MUTED, fontSize: 11 }}>
                                    {sub.id} — {sub.status} — ${sub.items?.[0]?.amount ? (sub.items[0].amount / 100).toFixed(2) : '?'}/{sub.items?.[0]?.interval ?? 'month'}
                                  </Text>
                                  <Text style={{ color: MUTED, fontSize: 10 }}>Customer: {sub.customer}</Text>
                                </View>
                              ))}

                              {/* Recent Invoices */}
                              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '600', marginTop: 10, marginBottom: 4 }}>Recent Invoices ({stripeData.invoices?.length ?? 0})</Text>
                              {stripeData.invoices?.map((inv: any) => (
                                <Text key={inv.id} style={{ color: MUTED, fontSize: 11 }}>
                                  {inv.id} — ${(inv.amountPaid / 100).toFixed(2)} — {inv.status} — {new Date(inv.created * 1000).toLocaleDateString()}
                                </Text>
                              ))}

                              {/* Recent Charges */}
                              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '600', marginTop: 10, marginBottom: 4 }}>Recent Charges ({stripeData.charges?.length ?? 0})</Text>
                              {stripeData.charges?.map((ch: any) => (
                                <View key={ch.id} style={{ marginBottom: 2 }}>
                                  <Text style={{ color: MUTED, fontSize: 11 }}>
                                    ${(ch.amount / 100).toFixed(2)} — {ch.status}{ch.refunded ? ' (REFUNDED)' : ''} — {new Date(ch.created * 1000).toLocaleDateString()}
                                  </Text>
                                  {ch.applicationFeeAmount != null && (
                                    <Text style={{ color: GOLD, fontSize: 10 }}>G➲A Fee: ${(ch.applicationFeeAmount / 100).toFixed(2)}</Text>
                                  )}
                                </View>
                              ))}
                            </View>
                          )}
                        </View>
                      )}
                      {loadingMembers ? (
                        <ActivityIndicator color={GOLD} style={{ marginVertical: 12 }} />
                      ) : coachMembers.length === 0 ? (
                        <Text style={[s.emptyText, { paddingHorizontal: 16, paddingVertical: 8 }]}>No members yet.</Text>
                      ) : (
                        coachMembers.map((m) => {
                          const statusColor = m.checkoutStatus === 'paid' ? GREEN
                            : m.checkoutStatus === 'pending' ? AMBER
                            : m.planStatus === 'sent' ? BLUE
                            : MUTED;
                          const statusLabel = m.checkoutStatus === 'paid' ? 'Paid'
                            : m.checkoutStatus === 'pending' ? 'Pending'
                            : m.planStatus === 'sent' ? 'Plan Sent'
                            : m.planStatus === 'draft' ? 'Draft'
                            : m.planStatus ?? 'No Plan';
                          return (
                            <TouchableOpacity
                              key={m.id}
                              style={s.memberRow}
                              onPress={() => {
                                if (m.planId) {
                                  router.push(`/(app)/member-plan/${m.id}`);
                                }
                              }}
                              activeOpacity={m.planId ? 0.7 : 1}
                            >
                              <View style={{ flex: 1 }}>
                                <Text style={s.failMember}>
                                  {m.name}{m.isArchived ? ' (archived)' : ''}
                                </Text>
                                <Text style={s.failMeta}>{m.email}</Text>
                                {m.displayMonthlyPrice != null && (
                                  <Text style={s.failMeta}>
                                    ${Math.round(m.displayMonthlyPrice)}/mo · {m.contractMonths ?? '?'} months
                                  </Text>
                                )}
                              </View>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                {m.planId && (
                                  <TouchableOpacity
                                    onPress={async () => {
                                      const url = `https://goarrive.web.app/shared-plan/${m.id}`;
                                      await copyToClipboard(url);
                                      if (Platform.OS === 'web') {
                                        alert('Plan link copied!');
                                      } else {
                                        Alert.alert('Copied', 'Plan link copied to clipboard.');
                                      }
                                    }}
                                    activeOpacity={0.7}
                                    style={{ padding: 4 }}
                                  >
                                    <Icon name="link-outline" size={14} color={BLUE} />
                                  </TouchableOpacity>
                                )}
                                <View style={[s.statusPill, { backgroundColor: statusColor + '20' }]}>
                                  <Text style={{ fontSize: 10, color: statusColor, fontFamily: FONT_BODY, fontWeight: '600' }}>
                                    {statusLabel}
                                  </Text>
                                </View>
                              </View>
                            </TouchableOpacity>
                          );
                        })
                      )}
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}

          {/* ── Pending Invites ── */}
          {pendingInvites.length > 0 && (
            <>
              <View style={s.divider} />
              <Text style={s.sectionTitle}>Pending Invites</Text>
              <Text style={s.sectionSub}>Coaches who have been invited but haven't activated yet.</Text>
              <View style={s.coachList}>
                {pendingInvites.map((inv) => {
                  const isExpired = inv.expiresAt ? inv.expiresAt < Date.now() : false;
                  return (
                    <View key={inv.id} style={s.coachRow}>
                      <View style={s.avatar}><Text style={s.avatarInitial}>{(inv.displayName?.[0] ?? '?').toUpperCase()}</Text></View>
                      <View style={s.coachInfo}>
                        <Text style={s.coachName}>{inv.displayName || 'Unnamed'}</Text>
                        <Text style={s.coachEmail}>{inv.email}</Text>
                        <Text style={[s.coachDate, isExpired && { color: RED }]}>
                          {isExpired ? 'Expired' : 'Pending activation'}
                        </Text>
                      </View>
                      <View style={[s.statusPill, { backgroundColor: isExpired ? RED + '20' : AMBER + '20' }]}>
                        <Text style={[s.statusPillText, { color: isExpired ? RED : AMBER }]}>
                          {isExpired ? 'Expired' : 'Pending'}
                        </Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </>
          )}

          {/* ── Invite a Coach ── */}
          <View style={s.divider} />
          <Text style={s.sectionTitle}>Invite a Coach</Text>
          <Text style={s.sectionSub}>
            Enter the coach's name and email to generate a secure invite link.
          </Text>

          {inviteUrl ? (
            <View style={s.card}>
              <View style={s.successHeader}>
                <Icon name="checkmark-circle" size={22} color={GREEN} />
                <Text style={s.successTitle}>Invite Link Ready!</Text>
              </View>
              <Text style={s.successBody}>Share this link with your coach. It expires in 7 days and can only be used once.</Text>
              <View style={s.linkBox}><Text style={s.linkText} numberOfLines={2} selectable>{inviteUrl}</Text></View>
              <View style={s.shareRow}>
                <Pressable style={s.shareBtn} onPress={handleShareEmail}>
                  <Icon name="mail-outline" size={18} color={TEXT_CLR} />
                  <Text style={s.shareBtnText}>Email</Text>
                </Pressable>
                <Pressable style={s.shareBtn} onPress={handleShareText}>
                  <Icon name="chatbubble-outline" size={18} color={TEXT_CLR} />
                  <Text style={s.shareBtnText}>Text / Share</Text>
                </Pressable>
              </View>
              {Platform.OS === 'web' && (
                <Pressable style={s.copyBtn} onPress={handleCopyLink}>
                  <Icon name="copy-outline" size={16} color={GOLD} />
                  <Text style={s.copyBtnText}>Copy Link</Text>
                </Pressable>
              )}
              <Pressable style={s.newInviteBtn} onPress={() => { setInviteUrl(null); setError(null); }}>
                <Text style={s.newInviteBtnText}>+ Invite Another Coach</Text>
              </Pressable>
            </View>
          ) : (
            <View style={s.card}>
              <View style={s.fieldWrap}>
                <Text style={s.label}>Full Name</Text>
                <TextInput style={s.input} placeholder="Jane Smith" placeholderTextColor="#4A5568" value={coachName} onChangeText={setCoachName} autoCapitalize="words" autoCorrect={false} editable={!inviting} />
              </View>
              <View style={s.fieldWrap}>
                <Text style={s.label}>Email</Text>
                <TextInput style={s.input} placeholder="coach@example.com" placeholderTextColor="#4A5568" value={coachEmail} onChangeText={setCoachEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} editable={!inviting} />
              </View>
              {error ? (
                <View style={s.errorBanner}>
                  <Icon name="alert-circle-outline" size={16} color={RED} />
                  <Text style={s.errorText}>{error}</Text>
                </View>
              ) : null}
              <Pressable style={[s.inviteBtn, inviting && s.inviteBtnDisabled]} onPress={handleGenerateInvite} disabled={inviting}>
                {inviting ? <ActivityIndicator color={BG} size="small" /> : (
                  <>
                    <Icon name="link-outline" size={18} color={BG} />
                    <Text style={s.inviteBtnText}>Generate Invite Link</Text>
                  </>
                )}
              </Pressable>
            </View>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ─── Analytics Dashboard (Item 10) ──────────────────────────────────────────

function AnalyticsDashboard() {
  const [loading, setLoading] = useState(true);
  const [skipAnalyticsRange, setSkipAnalyticsRange] = useState<'30' | '90' | 'month' | 'year'>('90');
  const [allInstances, setAllInstances] = useState<any[]>([]);
  const [stats, setStats] = useState<{
    totalSessions: number;
    completed: number;
    missed: number;
    cancelled: number;
    rescheduled: number;
    skipped: number;
    attendanceRate: number;
    coachStats: { coachId: string; coachName: string; total: number; completed: number; missed: number; attendanceRate: number; memberCount: number }[];
    templateUsage: { name: string; count: number }[];
    skipByCategory: { category: string; count: number }[];
    skipByMember: { memberId: string; memberName: string; count: number }[];
    skipByWeekday: { day: string; count: number }[];
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Fetch all session instances from the last 90 days
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 90);
        const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}-${String(cutoff.getDate()).padStart(2, '0')}`;

        const instQ = query(
          collection(db, 'session_instances'),
          where('scheduledDate', '>=', cutoffStr),
          limit(5000),
        );
        const instSnap = await getDocs(instQ);
        const instances = instSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));

        const totalSessions = instances.length;
        const completed = instances.filter((i: any) => i.status === 'completed').length;
        const missed = instances.filter((i: any) => i.status === 'missed').length;
        const cancelled = instances.filter((i: any) => i.status === 'cancelled').length;
        const rescheduled = instances.filter((i: any) => i.status === 'rescheduled').length;
        const skipped = instances.filter((i: any) => i.status === 'skipped').length;
        const attendanceRate = (completed + missed) > 0 ? Math.round((completed / (completed + missed)) * 100) : 0;

        // Coach-level stats
        const coachMap: Record<string, { total: number; completed: number; missed: number; members: Set<string> }> = {};
        for (const inst of instances) {
          const cid = inst.coachId || 'unknown';
          if (!coachMap[cid]) coachMap[cid] = { total: 0, completed: 0, missed: 0, members: new Set() };
          coachMap[cid].total++;
          if (inst.status === 'completed') coachMap[cid].completed++;
          if (inst.status === 'missed') coachMap[cid].missed++;
          if (inst.memberId) coachMap[cid].members.add(inst.memberId);
        }

        // Fetch coach names
        const coachSnap = await getDocs(collection(db, 'coaches'));
        const coachNames: Record<string, string> = {};
        coachSnap.docs.forEach(d => {
          const data = d.data();
          coachNames[d.id] = data.displayName || data.name || d.id;
        });

        const coachStats = Object.entries(coachMap).map(([cid, s]) => ({
          coachId: cid,
          coachName: coachNames[cid] || cid,
          total: s.total,
          completed: s.completed,
          missed: s.missed,
          attendanceRate: (s.completed + s.missed) > 0 ? Math.round((s.completed / (s.completed + s.missed)) * 100) : 0,
          memberCount: s.members.size,
        })).sort((a, b) => b.total - a.total);

        // Template usage
        const tmplSnap = await getDocs(collection(db, 'shared_templates'));
        const tmplUsage: Record<string, number> = {};
        tmplSnap.docs.forEach(d => {
          const data = d.data();
          const name = data.name || 'Unnamed';
          tmplUsage[name] = (tmplUsage[name] || 0) + 1;
        });
        const templateUsage = Object.entries(tmplUsage).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);

        // Skip analytics: by category, by member, by weekday
        const skippedInstances = instances.filter((i: any) => i.status === 'skipped' || i.status === 'skip_requested');
        const catMap: Record<string, number> = {};
        const memberSkipMap: Record<string, { name: string; count: number }> = {};
        const weekdayMap: Record<string, number> = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        for (const si of skippedInstances) {
          const cat = si.skipCategory || 'Other';
          catMap[cat] = (catMap[cat] || 0) + 1;
          const mid = si.memberId || 'unknown';
          if (!memberSkipMap[mid]) memberSkipMap[mid] = { name: si.memberName || mid, count: 0 };
          memberSkipMap[mid].count++;
          if (si.scheduledDate) {
            const [y, m, d] = si.scheduledDate.split('-').map(Number);
            const dt = new Date(y, m - 1, d);
            const dayName = dayNames[dt.getDay()];
            weekdayMap[dayName] = (weekdayMap[dayName] || 0) + 1;
          }
        }
        const skipByCategory = Object.entries(catMap).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
        const skipByMember = Object.entries(memberSkipMap).map(([memberId, v]) => ({ memberId, memberName: v.name, count: v.count })).sort((a, b) => b.count - a.count).slice(0, 10);
        const skipByWeekday = dayNames.map(day => ({ day, count: weekdayMap[day] }));

        setAllInstances(instances);
        setStats({ totalSessions, completed, missed, cancelled, rescheduled, skipped, attendanceRate, coachStats, templateUsage, skipByCategory, skipByMember, skipByWeekday });
      } catch (err) {
        console.error('[Analytics] fetch error:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <View style={{ padding: 20, alignItems: 'center' }}>
        <ActivityIndicator size="large" color={GOLD} />
        <Text style={{ color: MUTED, fontFamily: FB, marginTop: 8 }}>Loading analytics...</Text>
      </View>
    );
  }

  if (!stats) {
    return <Text style={{ color: RED, fontFamily: FB, padding: 20 }}>Failed to load analytics data.</Text>;
  }

  return (
    <View>
      <Text style={s.sectionTitle}>Session Analytics</Text>
      <Text style={s.sectionSub}>Last 90 days across all coaches and members</Text>

      {/* Summary cards */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Total Sessions', value: stats.totalSessions, color: GOLD },
          { label: 'Completed', value: stats.completed, color: GREEN },
          { label: 'Missed', value: stats.missed, color: RED },
          { label: 'Cancelled', value: stats.cancelled, color: MUTED },
          { label: 'Rescheduled', value: stats.rescheduled, color: BLUE },
          { label: 'Skipped', value: stats.skipped, color: '#FFC000' },
          { label: 'Attendance Rate', value: `${stats.attendanceRate}%`, color: stats.attendanceRate >= 80 ? GREEN : stats.attendanceRate >= 60 ? GOLD : RED },
        ].map((card, i) => (
          <View key={i} style={{ flex: 1, minWidth: 100, backgroundColor: card.color + '10', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: card.color + '20' }}>
            <Text style={{ fontSize: 22, color: card.color, fontFamily: FH }}>{card.value}</Text>
            <Text style={{ fontSize: 10, color: MUTED, fontFamily: FB, marginTop: 2 }}>{card.label}</Text>
          </View>
        ))}
      </View>

      {/* Coach performance table */}
      <Text style={[s.sectionTitle, { fontSize: 16, marginTop: 8 }]}>Coach Performance</Text>
      <View style={{ backgroundColor: CARD + '80', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', padding: 8, backgroundColor: 'rgba(255,255,255,0.05)' }}>
          <Text style={{ flex: 2, fontSize: 10, color: MUTED, fontFamily: FH }}>Coach</Text>
          <Text style={{ flex: 1, fontSize: 10, color: MUTED, fontFamily: FH, textAlign: 'center' }}>Members</Text>
          <Text style={{ flex: 1, fontSize: 10, color: MUTED, fontFamily: FH, textAlign: 'center' }}>Sessions</Text>
          <Text style={{ flex: 1, fontSize: 10, color: MUTED, fontFamily: FH, textAlign: 'center' }}>Attend %</Text>
        </View>
        {stats.coachStats.map((cs, i) => (
          <View key={cs.coachId} style={{ flexDirection: 'row', padding: 8, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.05)' }}>
            <Text style={{ flex: 2, fontSize: 12, color: FG, fontFamily: FB }} numberOfLines={1}>{cs.coachName}</Text>
            <Text style={{ flex: 1, fontSize: 12, color: MUTED, fontFamily: FB, textAlign: 'center' }}>{cs.memberCount}</Text>
            <Text style={{ flex: 1, fontSize: 12, color: MUTED, fontFamily: FB, textAlign: 'center' }}>{cs.total}</Text>
            <Text style={{ flex: 1, fontSize: 12, color: cs.attendanceRate >= 80 ? GREEN : cs.attendanceRate >= 60 ? GOLD : RED, fontFamily: FH, textAlign: 'center' }}>{cs.attendanceRate}%</Text>
          </View>
        ))}
      </View>

      {/* Skip Analytics */}
      {(stats.skipByCategory.length > 0 || stats.skipByMember.length > 0) && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
            <Text style={[s.sectionTitle, { fontSize: 16 }]}>Skip Analytics</Text>
            <Pressable
              onPress={() => {
                // Build CSV from filtered skip data
                const now = new Date();
                let cutoff: string;
                if (skipAnalyticsRange === '30') {
                  const d = new Date(); d.setDate(d.getDate() - 30);
                  cutoff = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                } else if (skipAnalyticsRange === '90') {
                  const d = new Date(); d.setDate(d.getDate() - 90);
                  cutoff = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
                } else if (skipAnalyticsRange === 'month') {
                  cutoff = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
                } else {
                  cutoff = `${now.getFullYear()}-01-01`;
                }
                const filtered = allInstances.filter(i => (i.status === 'skipped' || i.status === 'skip_requested') && i.scheduledDate >= cutoff);
                const csvRows = ['Date,Member,Category,Reason,Status'];
                for (const si of filtered) {
                  const date = si.scheduledDate || '';
                  const member = (si.memberName || si.memberId || '').replace(/,/g, ' ');
                  const cat = (si.skipCategory || 'Other').replace(/,/g, ' ');
                  const reason = (si.skipReason || '').replace(/,/g, ' ').replace(/\n/g, ' ');
                  const status = si.status || '';
                  csvRows.push(`${date},${member},${cat},${reason},${status}`);
                }
                const csvContent = csvRows.join('\n');
                if (Platform.OS === 'web') {
                  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `skip-analytics-${skipAnalyticsRange}.csv`;
                  a.click();
                  URL.revokeObjectURL(url);
                } else {
                  Alert.alert('Export', 'CSV export is available on web only.');
                }
              }}
              style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.08)' }}
            >
              <Text style={{ fontSize: 10, color: MUTED, fontFamily: FB }}>Export CSV</Text>
            </Pressable>
          </View>

          {/* Time filter pills */}
          <View style={{ flexDirection: 'row', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {([['30', 'Last 30 days'], ['90', 'Last 90 days'], ['month', 'This month'], ['year', 'This year']] as const).map(([key, label]) => (
              <Pressable
                key={key}
                onPress={() => setSkipAnalyticsRange(key)}
                style={{
                  paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12,
                  backgroundColor: skipAnalyticsRange === key ? BLUE : 'rgba(255,255,255,0.06)',
                }}
              >
                <Text style={{ fontSize: 10, color: skipAnalyticsRange === key ? '#FFF' : MUTED, fontFamily: FB }}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <Text style={{ fontSize: 11, color: MUTED, fontFamily: FB, marginBottom: 8 }}>Patterns from {(() => {
            const now = new Date();
            let cutoff: string;
            if (skipAnalyticsRange === '30') {
              const d = new Date(); d.setDate(d.getDate() - 30);
              cutoff = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            } else if (skipAnalyticsRange === '90') {
              const d = new Date(); d.setDate(d.getDate() - 90);
              cutoff = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            } else if (skipAnalyticsRange === 'month') {
              cutoff = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
            } else {
              cutoff = `${now.getFullYear()}-01-01`;
            }
            return allInstances.filter(i => (i.status === 'skipped' || i.status === 'skip_requested') && i.scheduledDate >= cutoff).length;
          })()} skipped sessions</Text>

          {(() => {
            // Compute filtered skip data based on selected time range
            const now = new Date();
            let cutoff: string;
            if (skipAnalyticsRange === '30') {
              const d = new Date(); d.setDate(d.getDate() - 30);
              cutoff = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            } else if (skipAnalyticsRange === '90') {
              const d = new Date(); d.setDate(d.getDate() - 90);
              cutoff = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
            } else if (skipAnalyticsRange === 'month') {
              cutoff = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
            } else {
              cutoff = `${now.getFullYear()}-01-01`;
            }
            const filtered = allInstances.filter(i => (i.status === 'skipped' || i.status === 'skip_requested') && i.scheduledDate >= cutoff);
            const catMap: Record<string, number> = {};
            const memberMap: Record<string, { name: string; count: number }> = {};
            const weekdayMap: Record<string, number> = { Sun: 0, Mon: 0, Tue: 0, Wed: 0, Thu: 0, Fri: 0, Sat: 0 };
            const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            for (const si of filtered) {
              const cat = si.skipCategory || 'Other';
              catMap[cat] = (catMap[cat] || 0) + 1;
              const mid = si.memberId || 'unknown';
              if (!memberMap[mid]) memberMap[mid] = { name: si.memberName || mid, count: 0 };
              memberMap[mid].count++;
              if (si.scheduledDate) {
                const [y, m, d] = si.scheduledDate.split('-').map(Number);
                const dt = new Date(y, m - 1, d);
                weekdayMap[dayNames[dt.getDay()]] = (weekdayMap[dayNames[dt.getDay()]] || 0) + 1;
              }
            }
            const fCat = Object.entries(catMap).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
            const fMember = Object.entries(memberMap).map(([memberId, v]) => ({ memberId, memberName: v.name, count: v.count })).sort((a, b) => b.count - a.count).slice(0, 10);
            const fWeekday = dayNames.map(day => ({ day, count: weekdayMap[day] }));

            return (
              <>
                {/* By Category */}
                {fCat.length > 0 && (
                  <View style={{ backgroundColor: CARD + '80', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
                    <View style={{ padding: 8, backgroundColor: 'rgba(255,255,255,0.05)' }}>
                      <Text style={{ fontSize: 11, color: MUTED, fontFamily: FH }}>By Category</Text>
                    </View>
                    {fCat.map((c, i) => {
                      const catColors: Record<string, string> = { Holiday: '#4CAF50', Vacation: '#2196F3', Illness: '#FF5722', 'Coach Unavailable': '#FF9800', Other: MUTED };
                      const barColor = catColors[c.category] || MUTED;
                      const maxCount = fCat[0]?.count || 1;
                      return (
                        <View key={i} style={{ padding: 8, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                            <Text style={{ fontSize: 12, color: FG, fontFamily: FB }}>{c.category}</Text>
                            <Text style={{ fontSize: 12, color: barColor, fontFamily: FH }}>{c.count}</Text>
                          </View>
                          <View style={{ height: 4, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 2 }}>
                            <View style={{ height: 4, backgroundColor: barColor, borderRadius: 2, width: `${Math.round((c.count / maxCount) * 100)}%` }} />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}

                {/* By Weekday */}
                <View style={{ backgroundColor: CARD + '80', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
                  <View style={{ padding: 8, backgroundColor: 'rgba(255,255,255,0.05)' }}>
                    <Text style={{ fontSize: 11, color: MUTED, fontFamily: FH }}>By Weekday</Text>
                  </View>
                  <View style={{ flexDirection: 'row', padding: 8, gap: 4 }}>
                    {fWeekday.map((w, i) => {
                      const maxW = Math.max(...fWeekday.map(x => x.count), 1);
                      const barH = Math.max(4, Math.round((w.count / maxW) * 40));
                      return (
                        <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                          <View style={{ height: 40, justifyContent: 'flex-end', width: '100%', alignItems: 'center' }}>
                            <View style={{ height: barH, width: '70%', backgroundColor: w.count > 0 ? '#FFC000' : 'rgba(255,255,255,0.05)', borderRadius: 2 }} />
                          </View>
                          <Text style={{ fontSize: 9, color: MUTED, fontFamily: FB, marginTop: 4 }}>{w.day}</Text>
                          <Text style={{ fontSize: 9, color: FG, fontFamily: FH }}>{w.count}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>

                {/* Top Skip Members */}
                {fMember.length > 0 && (
                  <View style={{ backgroundColor: CARD + '80', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
                    <View style={{ padding: 8, backgroundColor: 'rgba(255,255,255,0.05)' }}>
                      <Text style={{ fontSize: 11, color: MUTED, fontFamily: FH }}>Top Members by Skip Count</Text>
                    </View>
                    {fMember.map((m, i) => (
                      <View key={m.memberId} style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 8, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                        <Text style={{ fontSize: 12, color: FG, fontFamily: FB }} numberOfLines={1}>{m.memberName}</Text>
                        <Text style={{ fontSize: 12, color: m.count >= 5 ? RED : m.count >= 3 ? '#FFC000' : MUTED, fontFamily: FH }}>{m.count} skips</Text>
                      </View>
                    ))}
                  </View>
                )}
              </>
            );
          })()}
        </>
      )}

      {/* Template usage */}
      {stats.templateUsage.length > 0 && (
        <>
          <Text style={[s.sectionTitle, { fontSize: 16, marginTop: 8 }]}>Shared Template Usage</Text>
          <View style={{ backgroundColor: CARD + '80', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
            {stats.templateUsage.map((t, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 8, borderTopWidth: i > 0 ? 1 : 0, borderTopColor: 'rgba(255,255,255,0.05)' }}>
                <Text style={{ fontSize: 12, color: FG, fontFamily: FB }}>{t.name}</Text>
                <Text style={{ fontSize: 12, color: BLUE, fontFamily: FH }}>{t.count} shared</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { padding: 16, paddingTop: Platform.select({ web: 60, default: 16 }), gap: 12, paddingBottom: 100 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 80 },
  lockedText: { fontSize: 16, color: '#4A5568', fontFamily: FONT_BODY },
  title: { fontSize: 24, fontWeight: '700', color: TEXT_CLR, fontFamily: FONT_HEADING },
  subtitle: { fontSize: 14, color: MUTED, fontFamily: FONT_BODY, marginBottom: 4 },

  // Tab bar
  tabBar: { marginBottom: 4 },
  tabBarContent: { gap: 6 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER },
  tabActive: { borderColor: GOLD, backgroundColor: GOLD + '10' },
  tabText: { fontSize: 13, color: MUTED, fontFamily: FONT_BODY, fontWeight: '500' },
  tabTextActive: { color: GOLD },
  badge: { backgroundColor: RED, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1, marginLeft: 2 },
  badgeText: { fontSize: 10, color: '#fff', fontWeight: '700', fontFamily: FONT_BODY },

  // Stats
  statsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  statCard: { flex: 1, minWidth: 70, backgroundColor: CARD_BG, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: BORDER, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 22, fontWeight: '700', color: GOLD, fontFamily: FONT_HEADING },
  statLabel: { fontSize: 10, color: MUTED, fontFamily: FONT_BODY, textAlign: 'center' },

  divider: { height: 1, backgroundColor: BORDER, marginVertical: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: TEXT_CLR, fontFamily: FONT_HEADING },
  sectionSub: { fontSize: 13, color: MUTED, fontFamily: FONT_BODY, lineHeight: 18, marginBottom: 4 },
  emptyText: { fontSize: 13, color: '#4A5568', fontFamily: FONT_BODY, fontStyle: 'italic', marginVertical: 8 },

  // Allocate bar
  allocateBar: { backgroundColor: GOLD, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 4 },
  allocateBarText: { color: BG, fontSize: 14, fontWeight: '700', fontFamily: FONT_HEADING },

  // Cards
  card: { backgroundColor: CARD_BG, borderRadius: 14, padding: 16, gap: 10, borderWidth: 1, borderColor: BORDER },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 15, fontWeight: '700', color: TEXT_CLR, fontFamily: FONT_HEADING },
  cardSub: { fontSize: 12, color: MUTED, fontFamily: FONT_BODY },

  // Provider health
  providerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: BORDER },
  providerName: { fontSize: 13, fontWeight: '600', color: TEXT_CLR, fontFamily: FONT_BODY },
  providerDetail: { fontSize: 11, color: MUTED, fontFamily: FONT_BODY },
  modeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  modeBadgeText: { fontSize: 10, fontWeight: '700', fontFamily: FONT_BODY },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  credRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 4 },
  credItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  credText: { fontSize: 10, color: MUTED, fontFamily: FONT_BODY },
  meBox: { backgroundColor: AMBER + '08', borderWidth: 1, borderColor: AMBER + '30', borderRadius: 10, padding: 12, gap: 4 },
  meTitle: { fontSize: 12, fontWeight: '700', color: AMBER, fontFamily: FONT_HEADING },
  meText: { fontSize: 11, color: MUTED, fontFamily: FONT_BODY, lineHeight: 16 },

  // Room pool
  roomRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: BORDER },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  roomName: { fontSize: 13, fontWeight: '600', color: TEXT_CLR, fontFamily: FONT_BODY },
  roomMeta: { fontSize: 11, color: MUTED, fontFamily: FONT_BODY, marginTop: 1 },
  moreText: { color: MUTED, fontSize: 12, textAlign: 'center', marginTop: 6 },

  // Failure rows
  failRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: BORDER },
  failMember: { fontSize: 13, fontWeight: '600', color: TEXT_CLR, fontFamily: FONT_BODY },
  failMeta: { fontSize: 11, color: MUTED, fontFamily: FONT_BODY, marginTop: 1 },
  failReason: { fontSize: 11, color: RED, fontFamily: FONT_BODY, fontStyle: 'italic', marginTop: 2 },
  retryBtn: { backgroundColor: GOLD + '20', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
  retryBtnText: { color: GOLD, fontSize: 12, fontWeight: '700', fontFamily: FONT_BODY },

  // Health
  healthRow: { flexDirection: 'row', gap: 8 },
  healthItem: { flex: 1, alignItems: 'center', gap: 2 },
  healthValue: { fontSize: 16, fontWeight: '700', color: TEXT_CLR, fontFamily: FONT_HEADING },
  healthLabel: { fontSize: 10, color: MUTED, fontFamily: FONT_BODY, textAlign: 'center' },

  // Event log
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: BORDER },
  eventType: { fontSize: 13, fontWeight: '600', color: TEXT_CLR, fontFamily: FONT_BODY },
  eventMeta: { fontSize: 11, color: MUTED, fontFamily: FONT_BODY, marginTop: 1 },
  eventError: { fontSize: 11, color: RED, fontFamily: FONT_BODY, fontStyle: 'italic', marginTop: 2 },
  eventTime: { fontSize: 10, color: MUTED, fontFamily: FONT_BODY, textAlign: 'right', minWidth: 80 },
  filterChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: CARD_BG, borderWidth: 1, borderColor: BORDER },
  filterChipActive: { borderColor: GOLD, backgroundColor: GOLD + '15' },
  filterChipText: { fontSize: 11, color: MUTED, fontFamily: FONT_BODY },
  filterChipTextActive: { color: GOLD },

  // Dead letter
  dlRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: BORDER },
  dlType: { fontSize: 13, fontWeight: '600', color: TEXT_CLR, fontFamily: FONT_BODY, textTransform: 'capitalize' },
  dlError: { fontSize: 11, color: RED, fontFamily: FONT_BODY, marginTop: 2 },
  dlMeta: { fontSize: 10, color: MUTED, fontFamily: FONT_BODY, marginTop: 2 },

  // Coaches
  coachList: { backgroundColor: CARD_BG, borderRadius: 14, borderWidth: 1, borderColor: BORDER, overflow: 'hidden' },
  coachRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: BORDER },
  coachRowLast: { borderBottomWidth: 0 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: BORDER, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 15, fontWeight: '700', color: GOLD, fontFamily: FONT_HEADING },
  coachInfo: { flex: 1, gap: 2 },
  coachName: { fontSize: 14, fontWeight: '600', color: TEXT_CLR, fontFamily: FONT_HEADING },
  coachEmail: { fontSize: 12, color: MUTED, fontFamily: FONT_BODY },
  coachDate: { fontSize: 11, color: '#4A5568', fontFamily: FONT_BODY },
  memberSection: { backgroundColor: BG, borderTopWidth: 1, borderTopColor: BORDER },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  viewAsCoachBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginHorizontal: 16, marginTop: 8, backgroundColor: GOLD + '15', borderRadius: 8, borderWidth: 1, borderColor: GOLD + '30' },
  viewAsCoachBtnText: { fontSize: 12, fontWeight: '600', color: GOLD, fontFamily: FONT_BODY },

  // Invite
  fieldWrap: { gap: 6 },
  label: { fontSize: 13, fontWeight: '500', color: MUTED, fontFamily: FONT_BODY },
  input: { backgroundColor: BG, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: TEXT_CLR, fontFamily: FONT_BODY, borderWidth: 1, borderColor: BORDER },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10, backgroundColor: 'rgba(224,82,82,0.08)', borderWidth: 1, borderColor: 'rgba(224,82,82,0.2)' },
  errorText: { flex: 1, fontSize: 13, color: RED, fontFamily: FONT_BODY, lineHeight: 18 },
  inviteBtn: { backgroundColor: GOLD, borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 2 },
  inviteBtnDisabled: { opacity: 0.6 },
  inviteBtnText: { fontSize: 15, fontWeight: '700', color: BG, fontFamily: FONT_HEADING },
  successHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  successTitle: { fontSize: 16, fontWeight: '700', color: GREEN, fontFamily: FONT_HEADING },
  successBody: { fontSize: 13, color: MUTED, fontFamily: FONT_BODY, lineHeight: 18 },
  linkBox: { backgroundColor: BG, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: BORDER },
  linkText: { fontSize: 12, color: '#7DD3FC', fontFamily: FONT_BODY, lineHeight: 18 },
  shareRow: { flexDirection: 'row', gap: 10 },
  shareBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: BORDER, borderRadius: 10, paddingVertical: 12 },
  shareBtnText: { fontSize: 14, fontWeight: '600', color: TEXT_CLR, fontFamily: FONT_HEADING },
  copyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  copyBtnText: { fontSize: 13, color: GOLD, fontFamily: FONT_BODY, fontWeight: '500' },
  newInviteBtn: { alignItems: 'center', paddingVertical: 10 },
  newInviteBtnText: { fontSize: 14, color: GOLD, fontFamily: FONT_BODY, fontWeight: '500' },
});
