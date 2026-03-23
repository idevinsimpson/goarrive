/**
 * Admin screen — Platform admin tools
 *
 * Only visible to users with role === 'platformAdmin' or admin === true.
 * Sections:
 *   1. Registered Coaches + Invite a Coach
 *   2. Scheduling Operations — Room pool, allocation health, failures
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView, TouchableOpacity,
  StyleSheet, Platform, ActivityIndicator, Share, Linking, Alert,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../lib/AuthContext';
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
} from 'firebase/firestore';
import { db, functions } from '../../lib/firebase';
import type { SessionInstance, ZoomRoom } from '../../lib/schedulingTypes';

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

interface CoachRow { uid: string; name: string; email: string; createdAt?: number; }

export default function AdminScreen() {
  const { user, claims } = useAuth();
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
  const [allocating, setAllocating] = useState(false);
  const [loadingOps, setLoadingOps] = useState(true);

  const isAdmin = claims?.admin === true || claims?.role === 'platformAdmin';

  // ── Load coaches ──────────────────────────────────────────────────────────
  const fetchCoaches = useCallback(async () => {
    setLoadingCoaches(true);
    try {
      const dbRef = getFirestore();
      const q = query(collection(dbRef, 'coaches'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const rows: CoachRow[] = [];
      snap.forEach((doc) => {
        const d = doc.data();
        rows.push({ uid: doc.id, name: d.name ?? '\u2014', email: d.email ?? '\u2014', createdAt: d.createdAt });
      });
      setCoaches(rows);
    } catch (err) { console.warn('[admin] Failed to load coaches', err); }
    finally { setLoadingCoaches(false); }
  }, []);

  // ── Load scheduling operations data ───────────────────────────────────────
  useEffect(() => {
    if (!isAdmin) return;
    fetchCoaches();

    let opsLoaded = 0;
    const checkOps = () => { opsLoaded++; if (opsLoaded >= 3) setLoadingOps(false); };

    // Zoom rooms
    const unsubRooms = onSnapshot(
      collection(db, 'zoom_rooms'),
      (snap) => {
        setRooms(snap.docs.map(d => ({ id: d.id, ...d.data() } as ZoomRoom)));
        checkOps();
      },
      () => checkOps()
    );

    // Failed instances (allocation_failed)
    const unsubFailed = onSnapshot(
      query(collection(db, 'session_instances'), where('status', '==', 'allocation_failed')),
      (snap) => {
        setFailedInstances(snap.docs.map(d => ({ id: d.id, ...d.data() } as SessionInstance)));
        checkOps();
      },
      () => checkOps()
    );

    // Pending instances (scheduled, not yet allocated)
    const unsubPending = onSnapshot(
      query(collection(db, 'session_instances'), where('status', '==', 'scheduled')),
      (snap) => {
        setPendingInstances(snap.docs.map(d => ({ id: d.id, ...d.data() } as SessionInstance)));
        checkOps();
      },
      () => checkOps()
    );

    return () => { unsubRooms(); unsubFailed(); unsubPending(); };
  }, [isAdmin, fetchCoaches]);

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

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.title}>Admin Panel</Text>
      <Text style={s.subtitle}>Platform administration tools</Text>

      {/* ── Stats ── */}
      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statValue}>{coaches.length}</Text>
          <Text style={s.statLabel}>Coaches</Text>
        </View>
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
          <Text style={[s.statValue, { color: failedInstances.length > 0 ? RED : GREEN }]}>
            {failedInstances.length}
          </Text>
          <Text style={s.statLabel}>Failed</Text>
        </View>
      </View>

      {/* ══════════════════════════════════════════════════════════════════════
         SCHEDULING OPERATIONS
         ══════════════════════════════════════════════════════════════════════ */}
      <View style={s.divider} />
      <Text style={s.sectionTitle}>Scheduling Operations</Text>
      <Text style={s.sectionSub}>Room pool management, allocation health, and failure resolution.</Text>

      {loadingOps ? (
        <ActivityIndicator color={GOLD} style={{ marginVertical: 16 }} />
      ) : (
        <>
          {/* Allocate all pending */}
          {pendingInstances.length > 0 && (
            <TouchableOpacity
              style={s.allocateBar}
              onPress={handleAllocateAll}
              disabled={allocating}
            >
              {allocating ? (
                <ActivityIndicator size="small" color={BG} />
              ) : (
                <Text style={s.allocateBarText}>
                  Allocate rooms for {pendingInstances.length} pending session{pendingInstances.length !== 1 ? 's' : ''}
                </Text>
              )}
            </TouchableOpacity>
          )}

          {/* Room Pool */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Room Pool</Text>
            <Text style={s.cardSub}>
              {activeRooms.length} active · {inactiveRooms.length} inactive · {rooms.length} total
            </Text>
            {rooms.length === 0 ? (
              <Text style={s.emptyText}>No rooms configured. Add Zoom rooms to enable session hosting.</Text>
            ) : (
              rooms.slice(0, 10).map(room => (
                <View key={room.id} style={s.roomRow}>
                  <View style={[s.statusDot, { backgroundColor: room.status === 'active' ? GREEN : MUTED }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.roomName}>{room.label || room.id}</Text>
                    <Text style={s.roomMeta}>
                      {room.status === 'active' ? 'Active' : room.status} · Capacity: {room.maxConcurrent || 1}
                    </Text>
                  </View>
                </View>
              ))
            )}
            {rooms.length > 10 && (
              <Text style={s.moreText}>+ {rooms.length - 10} more rooms</Text>
            )}
          </View>

          {/* Allocation Failures */}
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
                    {inst.scheduledDate} · {inst.scheduledStartTime} · Coach: {inst.coachId?.slice(0, 8)}...
                  </Text>
                  <Text style={s.failReason}>{inst.allocationFailReason || 'No rooms available'}</Text>
                </View>
                <TouchableOpacity
                  style={s.retryBtn}
                  onPress={() => handleRetryInstance(inst.id)}
                >
                  <Text style={s.retryBtnText}>Retry</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          {/* Allocation Health */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Allocation Health</Text>
            <View style={s.healthRow}>
              <View style={s.healthItem}>
                <Text style={[s.healthValue, { color: GREEN }]}>{pendingInstances.length === 0 && failedInstances.length === 0 ? 'Healthy' : 'Attention'}</Text>
                <Text style={s.healthLabel}>Status</Text>
              </View>
              <View style={s.healthItem}>
                <Text style={s.healthValue}>{pendingInstances.length}</Text>
                <Text style={s.healthLabel}>Awaiting Allocation</Text>
              </View>
              <View style={s.healthItem}>
                <Text style={[s.healthValue, { color: failedInstances.length > 0 ? RED : GREEN }]}>{failedInstances.length}</Text>
                <Text style={s.healthLabel}>Failed</Text>
              </View>
            </View>
          </View>

          {/* Zoom Provider Mode */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Zoom Provider</Text>
            <View style={s.healthRow}>
              <View style={s.healthItem}>
                <Text style={[s.healthValue, { color: AMBER }]}>Mock</Text>
                <Text style={s.healthLabel}>Current Mode</Text>
              </View>
              <View style={s.healthItem}>
                <Text style={s.healthValue}>S2S OAuth</Text>
                <Text style={s.healthLabel}>Auth Type</Text>
              </View>
            </View>
            <Text style={[s.cardSub, { marginTop: 8 }]}>
              Set ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, and ZOOM_CLIENT_SECRET in Firebase config to enable live Zoom meetings. Until then, mock meetings are created for testing.
            </Text>
          </View>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
         COACHES
         ══════════════════════════════════════════════════════════════════════ */}
      <View style={s.divider} />
      <Text style={s.sectionTitle}>Registered Coaches</Text>
      <Text style={s.sectionSub}>All coaches on the platform.</Text>

      {loadingCoaches ? (
        <ActivityIndicator color={GOLD} style={{ marginVertical: 16 }} />
      ) : coaches.length === 0 ? (
        <Text style={s.emptyText}>No coaches registered yet.</Text>
      ) : (
        <View style={s.coachList}>
          {coaches.map((c, i) => (
            <View key={c.uid} style={[s.coachRow, i === coaches.length - 1 && s.coachRowLast]}>
              <View style={s.avatar}><Text style={s.avatarInitial}>{(c.name?.[0] ?? '?').toUpperCase()}</Text></View>
              <View style={s.coachInfo}>
                <Text style={s.coachName}>{c.name}</Text>
                <Text style={s.coachEmail}>{c.email}</Text>
                {c.createdAt ? <Text style={s.coachDate}>Joined {new Date(c.createdAt).toLocaleDateString()}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* ── Invite a Coach ── */}
      <View style={s.divider} />
      <Text style={s.sectionTitle}>Invite a Coach</Text>
      <Text style={s.sectionSub}>
        Enter the coach's name and email to generate a secure invite link. They will use it to create their account and will automatically be set up as a coach.
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
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  content: { padding: 16, paddingTop: Platform.select({ web: 60, default: 16 }), gap: 12, paddingBottom: 100 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 80 },
  lockedText: { fontSize: 16, color: '#4A5568', fontFamily: FONT_BODY },
  title: { fontSize: 24, fontWeight: '700', color: TEXT_CLR, fontFamily: FONT_HEADING },
  subtitle: { fontSize: 14, color: MUTED, fontFamily: FONT_BODY, marginBottom: 8 },

  statsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  statCard: { flex: 1, minWidth: 70, backgroundColor: CARD_BG, borderRadius: 14, padding: 12, borderWidth: 1, borderColor: BORDER, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 22, fontWeight: '700', color: GOLD, fontFamily: FONT_HEADING },
  statLabel: { fontSize: 10, color: MUTED, fontFamily: FONT_BODY, textAlign: 'center' },

  divider: { height: 1, backgroundColor: BORDER, marginVertical: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: TEXT_CLR, fontFamily: FONT_HEADING },
  sectionSub: { fontSize: 13, color: MUTED, fontFamily: FONT_BODY, lineHeight: 18, marginBottom: 4 },
  emptyText: { fontSize: 13, color: '#4A5568', fontFamily: FONT_BODY, fontStyle: 'italic', marginVertical: 8 },

  // Allocate bar
  allocateBar: { backgroundColor: GOLD, borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginBottom: 8 },
  allocateBarText: { color: BG, fontSize: 14, fontWeight: '700', fontFamily: FONT_HEADING },

  // Cards
  card: { backgroundColor: CARD_BG, borderRadius: 14, padding: 16, gap: 10, borderWidth: 1, borderColor: BORDER },
  cardTitle: { fontSize: 15, fontWeight: '700', color: TEXT_CLR, fontFamily: FONT_HEADING },
  cardSub: { fontSize: 12, color: MUTED, fontFamily: FONT_BODY },

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
  healthRow: { flexDirection: 'row', gap: 12 },
  healthItem: { flex: 1, alignItems: 'center', gap: 2 },
  healthValue: { fontSize: 16, fontWeight: '700', color: TEXT_CLR, fontFamily: FONT_HEADING },
  healthLabel: { fontSize: 10, color: MUTED, fontFamily: FONT_BODY, textAlign: 'center' },

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
