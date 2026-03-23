/**
 * Admin screen — Platform admin tools
 *
 * Only visible to users with role === 'platformAdmin' or admin === true.
 * Invite coaches via a shareable signup link (email or text).
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TextInput, Pressable, ScrollView,
  StyleSheet, Platform, ActivityIndicator, Share, Linking,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../lib/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';
import { getFirestore, collection, getDocs, orderBy, query } from 'firebase/firestore';

const FONT_HEADING = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

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

  const isAdmin = claims?.admin === true || claims?.role === 'platformAdmin';

  const fetchCoaches = useCallback(async () => {
    setLoadingCoaches(true);
    try {
      const db = getFirestore();
      const q = query(collection(db, 'coaches'), orderBy('createdAt', 'desc'));
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

  useEffect(() => { if (isAdmin) fetchCoaches(); }, [isAdmin, fetchCoaches]);

  async function handleGenerateInvite() {
    if (!coachName.trim() || !coachEmail.trim()) { setError('Please enter both name and email.'); return; }
    setInviting(true); setError(null); setInviteUrl(null);
    try {
      const auth = getAuth();
      if (auth.currentUser) await auth.currentUser.getIdToken(true);
      const functions = getFunctions();
      const inviteCoach = httpsCallable<
        { email: string; displayName: string },
        { inviteUrl: string; token: string; expiresAt: number }
      >(functions, 'inviteCoach');
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

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.title}>Admin Panel</Text>
      <Text style={s.subtitle}>Platform administration tools</Text>

      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statValue}>{coaches.length}</Text>
          <Text style={s.statLabel}>Coaches</Text>
        </View>
      </View>

      <View style={s.divider} />
      <Text style={s.sectionTitle}>Registered Coaches</Text>
      <Text style={s.sectionSub}>All coaches on the platform.</Text>

      {loadingCoaches ? (
        <ActivityIndicator color="#F5A623" style={{ marginVertical: 16 }} />
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

      <View style={s.divider} />
      <Text style={s.sectionTitle}>Invite a Coach</Text>
      <Text style={s.sectionSub}>
        Enter the coach's name and email to generate a secure invite link. They will use it to create their account and will automatically be set up as a coach.
      </Text>

      {inviteUrl ? (
        <View style={s.card}>
          <View style={s.successHeader}>
            <Icon name="checkmark-circle" size={22} color="#6EBB7A" />
            <Text style={s.successTitle}>Invite Link Ready!</Text>
          </View>
          <Text style={s.successBody}>Share this link with your coach. It expires in 7 days and can only be used once.</Text>
          <View style={s.linkBox}><Text style={s.linkText} numberOfLines={2} selectable>{inviteUrl}</Text></View>
          <View style={s.shareRow}>
            <Pressable style={s.shareBtn} onPress={handleShareEmail}>
              <Icon name="mail-outline" size={18} color="#F0F4F8" />
              <Text style={s.shareBtnText}>Email</Text>
            </Pressable>
            <Pressable style={s.shareBtn} onPress={handleShareText}>
              <Icon name="chatbubble-outline" size={18} color="#F0F4F8" />
              <Text style={s.shareBtnText}>Text / Share</Text>
            </Pressable>
          </View>
          {Platform.OS === 'web' && (
            <Pressable style={s.copyBtn} onPress={handleCopyLink}>
              <Icon name="copy-outline" size={16} color="#F5A623" />
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
              <Icon name="alert-circle-outline" size={16} color="#E05252" />
              <Text style={s.errorText}>{error}</Text>
            </View>
          ) : null}
          <Pressable style={[s.inviteBtn, inviting && s.inviteBtnDisabled]} onPress={handleGenerateInvite} disabled={inviting}>
            {inviting ? <ActivityIndicator color="#0E1117" size="small" /> : (
              <>
                <Icon name="link-outline" size={18} color="#0E1117" />
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
  root: { flex: 1, backgroundColor: '#0E1117' },
  content: { padding: 16, paddingTop: Platform.select({ web: 60, default: 16 }), gap: 12, paddingBottom: 100 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 80 },
  lockedText: { fontSize: 16, color: '#4A5568', fontFamily: FONT_BODY },
  title: { fontSize: 24, fontWeight: '700', color: '#F0F4F8', fontFamily: FONT_HEADING },
  subtitle: { fontSize: 14, color: '#8A95A3', fontFamily: FONT_BODY, marginBottom: 8 },
  statsRow: { flexDirection: 'row', gap: 12 },
  statCard: { flex: 1, backgroundColor: '#1A2035', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#2A3347', alignItems: 'center', gap: 4 },
  statValue: { fontSize: 28, fontWeight: '700', color: '#F5A623', fontFamily: FONT_HEADING },
  statLabel: { fontSize: 12, color: '#8A95A3', fontFamily: FONT_BODY },
  divider: { height: 1, backgroundColor: '#2A3347', marginVertical: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#F0F4F8', fontFamily: FONT_HEADING },
  sectionSub: { fontSize: 13, color: '#8A95A3', fontFamily: FONT_BODY, lineHeight: 18, marginBottom: 4 },
  emptyText: { fontSize: 13, color: '#4A5568', fontFamily: FONT_BODY, fontStyle: 'italic', marginVertical: 8 },
  coachList: { backgroundColor: '#1A2035', borderRadius: 14, borderWidth: 1, borderColor: '#2A3347', overflow: 'hidden' },
  coachRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: '#2A3347' },
  coachRowLast: { borderBottomWidth: 0 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2A3347', alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { fontSize: 15, fontWeight: '700', color: '#F5A623', fontFamily: FONT_HEADING },
  coachInfo: { flex: 1, gap: 2 },
  coachName: { fontSize: 14, fontWeight: '600', color: '#F0F4F8', fontFamily: FONT_HEADING },
  coachEmail: { fontSize: 12, color: '#8A95A3', fontFamily: FONT_BODY },
  coachDate: { fontSize: 11, color: '#4A5568', fontFamily: FONT_BODY },
  card: { backgroundColor: '#1A2035', borderRadius: 14, padding: 16, gap: 14, borderWidth: 1, borderColor: '#2A3347' },
  fieldWrap: { gap: 6 },
  label: { fontSize: 13, fontWeight: '500', color: '#8A95A3', fontFamily: FONT_BODY },
  input: { backgroundColor: '#0E1117', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#F0F4F8', fontFamily: FONT_BODY, borderWidth: 1, borderColor: '#2A3347' },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 10, backgroundColor: 'rgba(224,82,82,0.08)', borderWidth: 1, borderColor: 'rgba(224,82,82,0.2)' },
  errorText: { flex: 1, fontSize: 13, color: '#E05252', fontFamily: FONT_BODY, lineHeight: 18 },
  inviteBtn: { backgroundColor: '#F5A623', borderRadius: 12, paddingVertical: 14, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 2 },
  inviteBtnDisabled: { opacity: 0.6 },
  inviteBtnText: { fontSize: 15, fontWeight: '700', color: '#0E1117', fontFamily: FONT_HEADING },
  successHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  successTitle: { fontSize: 16, fontWeight: '700', color: '#6EBB7A', fontFamily: FONT_HEADING },
  successBody: { fontSize: 13, color: '#8A95A3', fontFamily: FONT_BODY, lineHeight: 18 },
  linkBox: { backgroundColor: '#0E1117', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#2A3347' },
  linkText: { fontSize: 12, color: '#7DD3FC', fontFamily: FONT_BODY, lineHeight: 18 },
  shareRow: { flexDirection: 'row', gap: 10 },
  shareBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#2A3347', borderRadius: 10, paddingVertical: 12 },
  shareBtnText: { fontSize: 14, fontWeight: '600', color: '#F0F4F8', fontFamily: FONT_HEADING },
  copyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  copyBtnText: { fontSize: 13, color: '#F5A623', fontFamily: FONT_BODY, fontWeight: '500' },
  newInviteBtn: { alignItems: 'center', paddingVertical: 10 },
  newInviteBtnText: { fontSize: 14, color: '#F5A623', fontFamily: FONT_BODY, fontWeight: '500' },
});
