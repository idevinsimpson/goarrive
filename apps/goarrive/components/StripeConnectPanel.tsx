/**
 * StripeConnectPanel — Coach Stripe Connect status and onboarding UI
 *
 * Reads coachStripeAccounts/{coachId} from Firestore and displays:
 *   - Connection status (connected / not connected)
 *   - Onboarding status (pending / in_progress / complete / restricted)
 *   - chargesEnabled and payoutsEnabled flags
 *   - Action buttons: Connect Stripe / Resume Setup / Refresh Status / Disconnect
 *
 * The actual account creation, onboarding link generation, and disconnect are
 * server-side Cloud Function calls.
 *
 * ME-001: STRIPE_SECRET_KEY must be set in Cloud Functions environment before
 *         the createStripeConnectLink function can operate.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, ActivityIndicator, Platform, Alert, Modal,
} from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../lib/firebase';
import type { CoachStripeAccount } from '../lib/planTypes';
import { BG, BORDER, GOLD, MUTED } from '../lib/theme';


const PRIMARY = '#5B9BD5';
const ACCENT = '#6EBB7A';
const DANGER = '#E05252';
const CARD_BG = '#161B25';

interface Props {
  coachId: string;
}

export default function StripeConnectPanel({ coachId }: Props) {
  const [account, setAccount] = useState<CoachStripeAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  // ── Listen to coachStripeAccounts/{coachId} ──────────────────────────────
  useEffect(() => {
    if (!coachId) return;
    const ref = doc(db, 'coachStripeAccounts', coachId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        setLoading(false);
        if (snap.exists()) {
          setAccount(snap.data() as CoachStripeAccount);
        } else {
          setAccount(null);
        }
      },
      (err) => {
        setLoading(false);
        console.warn('[StripeConnectPanel] Firestore error:', err);
      }
    );
    return unsub;
  }, [coachId]);

  // ── Call Cloud Function to get onboarding / connect link ─────────────────
  const handleConnect = useCallback(async () => {
    setActionLoading(true);
    setError(null);
    try {
      const functions = getFunctions();
      const createLink = httpsCallable<{ coachId: string }, { url: string }>(
        functions,
        'createStripeConnectLink'
      );
      const result = await createLink({ coachId });
      const url = result.data?.url;
      if (url) {
        if (Platform.OS === 'web') {
          window.location.href = url;
        } else {
          const Linking = require('expo-linking');
          await Linking.openURL(url);
        }
      } else {
        setError('No onboarding URL returned. Check Cloud Function logs.');
      }
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('STRIPE_SECRET_KEY')) {
        setError('ME-001: STRIPE_SECRET_KEY is not configured in Cloud Functions.');
      } else if (msg.includes('not-found') || msg.includes('NOT_FOUND')) {
        setError('ME-001: createStripeConnectLink function is not deployed yet.');
      } else {
        setError(msg);
      }
    } finally {
      setActionLoading(false);
    }
  }, [coachId]);

  // ── Call Cloud Function to refresh status ────────────────────────────────
  const handleRefresh = useCallback(async () => {
    setActionLoading(true);
    setError(null);
    try {
      const functions = getFunctions();
      const refreshStatus = httpsCallable<{ coachId: string }, { success: boolean }>(
        functions,
        'refreshStripeAccountStatus'
      );
      await refreshStatus({ coachId });
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('not-found') || msg.includes('NOT_FOUND')) {
        setError('ME-001: refreshStripeAccountStatus function is not deployed yet.');
      } else {
        setError(msg);
      }
    } finally {
      setActionLoading(false);
    }
  }, [coachId]);

  // ── Disconnect: show confirmation first ──────────────────────────────────
  const handleDisconnectPress = useCallback(() => {
    if (Platform.OS === 'web') {
      // Web: use custom modal (window.confirm is blocked in some contexts)
      setShowDisconnectConfirm(true);
    } else {
      // Native: use Alert
      Alert.alert(
        'Disconnect Stripe Account',
        'This will permanently delete your Stripe Express account and remove all connection data. ' +
        'Any pending payouts must complete first.\n\nYou can reconnect with a new account afterwards.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Disconnect',
            style: 'destructive',
            onPress: performDisconnect,
          },
        ]
      );
    }
  }, []);

  const performDisconnect = useCallback(async () => {
    setShowDisconnectConfirm(false);
    setActionLoading(true);
    setError(null);
    try {
      const functions = getFunctions();
      const disconnect = httpsCallable<{ coachId: string }, { success: boolean; message: string }>(
        functions,
        'disconnectStripeAccount'
      );
      await disconnect({ coachId });
      // Firestore listener will clear account state automatically
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('outstanding balance') || msg.includes('failed-precondition')) {
        setError(
          'Your Stripe account has a pending balance. Wait for all payouts to complete, then try again.'
        );
      } else if (msg.includes('not-found') || msg.includes('NOT_FOUND')) {
        setError('ME-001: disconnectStripeAccount function is not deployed yet.');
      } else {
        setError(msg);
      }
    } finally {
      setActionLoading(false);
    }
  }, [coachId]);

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={card}>
        <ActivityIndicator size="small" color={PRIMARY} />
      </View>
    );
  }

  const isConnected = !!account?.stripeAccountId;
  const chargesEnabled = account?.chargesEnabled ?? false;
  const payoutsEnabled = account?.payoutsEnabled ?? false;
  // Treat as complete if charges AND payouts are enabled, regardless of stored status string
  const onboardingComplete = (chargesEnabled && payoutsEnabled) || account?.onboardingStatus === 'complete';
  const requirementsDue = account?.requirementsDue ?? [];

  const statusColor = !isConnected
    ? MUTED
    : onboardingComplete
    ? ACCENT
    : GOLD;

  const statusLabel = !isConnected
    ? 'Not connected'
    : onboardingComplete
    ? 'Active'
    : chargesEnabled || payoutsEnabled
    ? 'Restricted'
    : account?.onboardingStatus === 'in_progress'
    ? 'Setup in progress'
    : 'Pending setup';

  return (
    <View style={card}>
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(91,155,213,0.15)', alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 18 }}>{'💳'}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: '#FFF', fontSize: 15, fontWeight: '700' }}>Stripe Payments</Text>
          <Text style={{ color: MUTED, fontSize: 12, marginTop: 1 }}>Collect member payments directly</Text>
        </View>
        <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, backgroundColor: statusColor + '22', borderWidth: 1, borderColor: statusColor + '55' }}>
          <Text style={{ color: statusColor, fontSize: 11, fontWeight: '700' }}>{statusLabel}</Text>
        </View>
      </View>

      {/* Status rows */}
      {isConnected && (
        <View style={{ gap: 6, marginBottom: 14 }}>
          <StatusRow label="Account ID" value={account!.stripeAccountId} mono />
          <StatusRow label="Onboarding" value={account!.onboardingStatus} />
          <StatusRow label="Charges enabled" value={chargesEnabled ? 'Yes' : 'No'} ok={chargesEnabled} />
          <StatusRow label="Payouts enabled" value={payoutsEnabled ? 'Yes' : 'No'} ok={payoutsEnabled} />
          {requirementsDue.length > 0 && (
            <View style={{ marginTop: 4, padding: 8, backgroundColor: 'rgba(245,166,35,0.08)', borderRadius: 6, borderWidth: 1, borderColor: 'rgba(245,166,35,0.25)' }}>
              <Text style={{ color: GOLD, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>Action required</Text>
              {requirementsDue.map((req, i) => (
                <Text key={i} style={{ color: MUTED, fontSize: 11, lineHeight: 16 }}>{'\u2022 '}{req}</Text>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Error */}
      {error && (
        <View style={{ padding: 10, backgroundColor: 'rgba(224,82,82,0.08)', borderRadius: 8, borderWidth: 1, borderColor: 'rgba(224,82,82,0.25)', marginBottom: 12 }}>
          <Text style={{ color: DANGER, fontSize: 12, lineHeight: 18 }}>{error}</Text>
        </View>
      )}

      {/* Action buttons */}
      <View style={{ gap: 8 }}>
        {!isConnected && (
          <ActionButton
            label="Connect Stripe"
            icon="🔗"
            color={PRIMARY}
            loading={actionLoading}
            onPress={handleConnect}
          />
        )}
        {isConnected && !onboardingComplete && (
          <ActionButton
            label="Resume Setup"
            icon="▶"
            color={GOLD}
            loading={actionLoading}
            onPress={handleConnect}
          />
        )}
        {isConnected && (
          <ActionButton
            label="Refresh Status"
            icon="↻"
            color={MUTED}
            loading={actionLoading}
            onPress={handleRefresh}
          />
        )}
        {isConnected && (
          <ActionButton
            label="Disconnect Stripe"
            icon="✕"
            color={DANGER}
            loading={actionLoading}
            onPress={handleDisconnectPress}
          />
        )}
      </View>

      {/* Web disconnect confirmation modal */}
      {Platform.OS === 'web' && showDisconnectConfirm && (
        <Modal transparent animationType="fade" visible={showDisconnectConfirm}>
          <View style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.7)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}>
            <View style={{
              backgroundColor: '#1A2030',
              borderRadius: 14,
              padding: 24,
              maxWidth: 360,
              width: '100%',
              borderWidth: 1,
              borderColor: DANGER + '44',
            }}>
              <Text style={{ color: '#FFF', fontSize: 16, fontWeight: '700', marginBottom: 10 }}>
                Disconnect Stripe Account?
              </Text>
              <Text style={{ color: MUTED, fontSize: 13, lineHeight: 20, marginBottom: 20 }}>
                This will permanently delete your Stripe Express account and remove all connection data.
                Any pending payouts must complete first.{'\n\n'}
                You can reconnect with a new account afterwards.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable
                  onPress={() => setShowDisconnectConfirm(false)}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: BORDER,
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: MUTED, fontWeight: '600' }}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={performDisconnect}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 10,
                    backgroundColor: DANGER + '22',
                    borderWidth: 1,
                    borderColor: DANGER + '55',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ color: DANGER, fontWeight: '700' }}>Disconnect</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}

    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusRow({
  label, value, mono, ok,
}: { label: string; value: string; mono?: boolean; ok?: boolean }) {
  const valueColor = ok === true ? ACCENT : ok === false ? DANGER : MUTED;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ color: MUTED, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: valueColor, fontSize: 12, fontFamily: mono ? 'monospace' : undefined }}>
        {value}
      </Text>
    </View>
  );
}

function ActionButton({
  label, icon, color, loading, onPress,
}: { label: string; icon: string; color: string; loading: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 12,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: color + '55',
        backgroundColor: color + '11',
        opacity: loading ? 0.6 : 1,
      }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={color} />
      ) : (
        <>
          <Text style={{ fontSize: 14 }}>{icon}</Text>
          <Text style={{ color, fontSize: 14, fontWeight: '600' }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

const card: object = {
  width: '100%',
  maxWidth: 400,
  backgroundColor: CARD_BG,
  borderRadius: 14,
  padding: 16,
  borderWidth: 1,
  borderColor: BORDER,
};
