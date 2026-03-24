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
const PURPLE = '#A78BFA';

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

type AdminTab = 'operations' | 'events' | 'recordings' | 'deadletter' | 'coaches';

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

  // Coach member drill-down state
  const [expandedCoachId, setExpandedCoachId] = useState<string | null>(null);
  const [coachMembers, setCoachMembers] = useState<CoachMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Pending invites state
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);

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

    return () => { unsubRooms(); unsubFailed(); unsubPending(); unsubAllocated(); unsubCompleted(); };
  }, [isAdmin, fetchCoaches, fetchPendingInvites, fetchHealth]);

  // Load tab-specific data
  useEffect(() => {
    if (activeTab === 'events') fetchEvents();
    if (activeTab === 'deadletter') fetchDeadLetter();
  }, [activeTab, fetchEvents, fetchDeadLetter]);

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
                      <Text style={[s.failMeta, { color: GREEN }]}>
                        {inst.recordings.length} file{inst.recordings.length !== 1 ? 's' : ''} · {inst.recordings.map(r => r.fileType).join(', ')}
                      </Text>
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
         TAB: COACHES
         ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'coaches' && (
        <>
          <Text style={s.sectionTitle}>Registered Coaches</Text>
          <Text style={s.sectionSub}>All coaches on the platform.</Text>

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
                      {/* View as Coach button */}
                      <TouchableOpacity
                        style={s.viewAsCoachBtn}
                        onPress={() => {
                          setAdminCoachOverride(c.uid);
                          router.push('/(app)/dashboard');
                        }}
                        activeOpacity={0.7}
                      >
                        <Icon name="eye-outline" size={14} color={GOLD} />
                        <Text style={s.viewAsCoachBtnText}>View as {c.name.split(' ')[0]}</Text>
                      </TouchableOpacity>
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
