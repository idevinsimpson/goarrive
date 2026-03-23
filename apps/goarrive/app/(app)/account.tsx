/**
 * Account screen — User profile, Stripe Connect, Zoom connection, and sign-out
 *
 * Overlays on top of the main app layout.
 * Shows user info and provides a sign-out button.
 * Prompt 5: Adds coach personal Zoom connection panel.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
  TextInput,
  Alert,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../lib/AuthContext';
import StripeConnectPanel from '../../components/StripeConnectPanel';
import {
  doc,
  getDoc,
  setDoc,
  Timestamp,
} from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { CoachZoomConnection } from '../../lib/schedulingTypes';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const GOLD = '#F5A623';
const GREEN = '#48BB78';
const RED = '#E05252';
const BORDER = '#2A3347';
const CARD_BG = '#1A2035';
const TEXT_PRIMARY = '#F0F4F8';
const TEXT_SECONDARY = '#8A95A3';
const TEXT_MUTED = '#718096';

interface Props {
  onClose?: () => void;
}

export default function AccountScreen({ onClose }: Props) {
  const { user, claims, signOut } = useAuth();

  const displayName = user?.displayName ?? user?.email ?? 'User';
  const initials = displayName
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  async function handleSignOut() {
    await signOut();
  }

  const isCoach = claims?.role === 'coach' || claims?.role === 'admin';
  const coachId = claims?.coachId || user?.uid;

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={onClose} hitSlop={8}>
          <Icon name="arrow-left" size={24} color="#8A95A3" />
        </Pressable>
        <Text style={s.headerTitle}>Account</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.content}>
        {/* Avatar */}
        <View style={s.avatarWrap}>
          <View style={s.avatar}>
            <Text style={s.avatarText}>{initials}</Text>
          </View>
          <Text style={s.name}>{displayName}</Text>
          <Text style={s.email}>{user?.email ?? '—'}</Text>
        </View>

        {/* Stripe Connect — coaches only */}
        {isCoach && coachId && (
          <StripeConnectPanel coachId={coachId} />
        )}

        {/* Personal Zoom Connection — coaches only */}
        {isCoach && coachId && (
          <CoachZoomPanel coachId={coachId} />
        )}

        {/* Sign out */}
        <Pressable style={s.signOutBtn} onPress={handleSignOut}>
          <Icon name="logout" size={18} color="#E05252" />
          <Text style={s.signOutText}>Sign Out</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// ─── Coach Zoom Connection Panel ────────────────────────────────────────────

function CoachZoomPanel({ coachId }: { coachId: string }) {
  const [connection, setConnection] = useState<CoachZoomConnection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [emailInput, setEmailInput] = useState('');

  const fetchConnection = useCallback(async () => {
    try {
      const docRef = doc(db, 'coach_zoom_connections', coachId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        setConnection({ coachId, ...snap.data() } as CoachZoomConnection);
        setEmailInput(snap.data().zoomEmail || '');
      } else {
        setConnection(null);
        setEmailInput('');
      }
    } catch (err) {
      console.error('[CoachZoomPanel] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [coachId]);

  useEffect(() => { fetchConnection(); }, [fetchConnection]);

  async function handleConnect() {
    if (!emailInput.trim()) {
      Alert.alert('Zoom Email Required', 'Please enter the email address associated with your Zoom account.');
      return;
    }
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.trim())) {
      Alert.alert('Invalid Email', 'Please enter a valid email address.');
      return;
    }
    // Skip if email unchanged and already connected
    if (connection?.connected && connection?.zoomEmail === emailInput.trim()) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const docRef = doc(db, 'coach_zoom_connections', coachId);
      await setDoc(docRef, {
        coachId,
        zoomEmail: emailInput.trim(),
        connected: true,
        connectedAt: Timestamp.now(),
        lastVerifiedAt: Timestamp.now(),
        status: 'connected',
      }, { merge: true });
      await fetchConnection();
      setEditing(false);
    } catch (err: any) {
      Alert.alert('Connection Failed', 'Unable to save your Zoom connection. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    Alert.alert(
      'Disconnect Zoom',
      'This will remove your personal Zoom connection. Your Fully Guided sessions will need to be updated.',
      [
        { text: 'Keep Connected', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const docRef = doc(db, 'coach_zoom_connections', coachId);
              await setDoc(docRef, {
                coachId,
                connected: false,
                status: 'disconnected',
                zoomEmail: connection?.zoomEmail || '',
              }, { merge: true });
              await fetchConnection();
              setEditing(false);
            } catch (err: any) {
              Alert.alert('Error', 'Unable to disconnect. Please try again.');
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={zs.panel}>
        <ActivityIndicator size="small" color={GOLD} />
      </View>
    );
  }

  const isConnected = connection?.connected && connection?.status === 'connected';

  return (
    <View style={zs.panel}>
      {/* Header */}
      <View style={zs.panelHeader}>
        <View style={zs.panelTitleRow}>
          <Icon name="video" size={18} color={isConnected ? GREEN : TEXT_MUTED} />
          <Text style={zs.panelTitle}>Personal Zoom</Text>
        </View>
        <View style={[zs.statusDot, { backgroundColor: isConnected ? GREEN : TEXT_MUTED }]} />
      </View>

      {/* Status */}
      <Text style={zs.statusText}>
        {isConnected
          ? 'Connected — your Fully Guided sessions will use your personal Zoom.'
          : 'Not connected — connect your Zoom to host Fully Guided sessions.'}
      </Text>

      {/* Connected state */}
      {isConnected && !editing && (
        <View style={zs.connectedInfo}>
          <View style={zs.infoRow}>
            <Text style={zs.infoLabel}>Zoom Email</Text>
            <Text style={zs.infoValue}>{connection?.zoomEmail || '—'}</Text>
          </View>
          <View style={zs.actionRow}>
            <Pressable style={zs.editBtn} onPress={() => { setEditing(true); setEmailInput(connection?.zoomEmail || ''); }}>
              <Icon name="edit" size={14} color={GOLD} />
              <Text style={zs.editBtnText}>Update</Text>
            </Pressable>
            <Pressable style={zs.disconnectBtn} onPress={handleDisconnect}>
              <Icon name="close" size={14} color={RED} />
              <Text style={zs.disconnectBtnText}>Disconnect</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Edit / Connect form */}
      {(!isConnected || editing) && (
        <View style={zs.form}>
          <Text style={zs.inputLabel}>Zoom Account Email</Text>
          <TextInput
            style={zs.input}
            placeholder="your@zoom-email.com"
            placeholderTextColor={TEXT_MUTED}
            value={emailInput}
            onChangeText={setEmailInput}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={zs.hint}>
            Enter the email address associated with your Zoom account. This will be used to host your Fully Guided (Phase 1) sessions.
          </Text>
          <View style={zs.formActions}>
            <Pressable
              style={[zs.connectBtn, saving && { opacity: 0.6 }]}
              onPress={handleConnect}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Icon name="video" size={16} color="#FFF" />
                  <Text style={zs.connectBtnText}>
                    {isConnected ? 'Update Connection' : 'Connect Zoom'}
                  </Text>
                </>
              )}
            </Pressable>
            {editing && (
              <Pressable style={zs.cancelBtn} onPress={() => setEditing(false)}>
                <Text style={zs.cancelBtnText}>Cancel</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {/* Mock mode notice */}
      <View style={zs.mockNotice}>
        <Icon name="shield" size={12} color={TEXT_MUTED} />
        <Text style={zs.mockText}>
          Zoom integration is in setup mode. Your connection details are saved and will activate when live credentials are configured.
        </Text>
      </View>
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 56, web: 16, default: 16 }),
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 12,
    alignItems: 'center',
  },
  avatarWrap: {
    alignItems: 'center',
    gap: 8,
    marginVertical: 16,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1A2035',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#F5A623',
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
  },
  name: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  email: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1A2035',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  cardLabel: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
  cardValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(224,82,82,0.08)',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(224,82,82,0.2)',
    marginTop: 16,
  },
  signOutText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#E05252',
    fontFamily: FONT_BODY,
  },
});

// ─── Zoom Panel Styles ──────────────────────────────────────────────────────

const zs = StyleSheet.create({
  panel: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: CARD_BG,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 10,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  panelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  panelTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: TEXT_PRIMARY,
    fontFamily: FONT_HEADING,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: 13,
    color: TEXT_SECONDARY,
    fontFamily: FONT_BODY,
    lineHeight: 18,
  },
  connectedInfo: {
    gap: 10,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  infoLabel: {
    fontSize: 13,
    color: TEXT_MUTED,
    fontFamily: FONT_BODY,
  },
  infoValue: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT_PRIMARY,
    fontFamily: FONT_BODY,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
  },
  editBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: GOLD,
    fontFamily: FONT_BODY,
  },
  disconnectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(224,82,82,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(224,82,82,0.2)',
  },
  disconnectBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: RED,
    fontFamily: FONT_BODY,
  },
  form: {
    gap: 8,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: TEXT_MUTED,
    fontFamily: FONT_HEADING,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#0E1117',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: TEXT_PRIMARY,
    fontFamily: FONT_BODY,
  },
  hint: {
    fontSize: 12,
    color: TEXT_MUTED,
    fontFamily: FONT_BODY,
    lineHeight: 16,
  },
  formActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  connectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: GREEN,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    flex: 1,
  },
  connectBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFF',
    fontFamily: FONT_BODY,
  },
  cancelBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: BORDER,
  },
  cancelBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT_SECONDARY,
    fontFamily: FONT_BODY,
  },
  mockNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  mockText: {
    fontSize: 11,
    color: TEXT_MUTED,
    fontFamily: FONT_BODY,
    lineHeight: 15,
    flex: 1,
  },
});
