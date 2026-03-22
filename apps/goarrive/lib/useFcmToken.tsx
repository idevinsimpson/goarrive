/**
 * useFcmToken.ts
 *
 * Exports two things:
 *
 *  1. `useFcmToken(uid)` — React hook that, on every mount, silently refreshes
 *     the FCM token in Firestore IF the user has already granted permission.
 *     It does NOT show the browser permission prompt on its own.
 *
 *  2. `FcmPermissionPrompt` — React Native component that renders a branded
 *     in-app banner explaining the benefit of push notifications.  Only shown
 *     when permission is 'default' (not yet decided).  The user taps "Allow"
 *     to trigger the browser prompt, or "Not now" to dismiss for this session.
 *
 * Usage:
 *   // In the member root layout — silently refreshes token if already granted:
 *   useFcmToken(uid);
 *
 *   // Somewhere visible to the member (e.g. home page, once per session):
 *   <FcmPermissionPrompt uid={uid} />
 *
 * VAPID key: BLjaLma-KbDtZtFp9WIACGyoPTDYsCkkyk_VeSVthPp5daFjqHEc70ZdMBdqCDIAuN8RtGeYLTSg_o5p_iyHrzU
 * Source: Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
 * Generated: Mar 14, 2026. Rotate via Firebase Console if ever compromised.
 */
import React, { useEffect, useState } from 'react';
import { Platform, View, Text, Pressable, StyleSheet } from 'react-native';
import { getMessaging, getToken } from 'firebase/messaging';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import app from './firebase';
import { db } from './firebase';

// ─── VAPID public key ─────────────────────────────────────────────────────────
const VAPID_KEY =
  'BLjaLma-KbDtZtFp9WIACGyoPTDYsCkkyk_VeSVthPp5daFjqHEc70ZdMBdqCDIAuN8RtGeYLTSg_o5p_iyHrzU';

// ─── Shared token registration helper ────────────────────────────────────────
async function _registerOrRefreshToken(uid: string): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const messaging = getMessaging(app);
    const currentToken = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: await navigator.serviceWorker.ready,
    });
    if (!currentToken) return;

    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    const storedToken: string | undefined = userSnap.exists()
      ? userSnap.data()?.fcmToken
      : undefined;

    if (currentToken !== storedToken) {
      await setDoc(userRef, { fcmToken: currentToken }, { merge: true });
      console.log('[useFcmToken] FCM token', storedToken ? 'refreshed' : 'registered', 'for', uid);
    } else {
      console.log('[useFcmToken] FCM token unchanged for', uid);
    }
  } catch (err) {
    console.warn('[useFcmToken] Could not register/refresh FCM token:', err);
  }
}

// ─── Hook: silently refreshes token on every launch if already granted ────────
export function useFcmToken(uid: string | null | undefined): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || !uid) return;
    // Only refresh — never prompt. Prompting is handled by FcmPermissionPrompt.
    _registerOrRefreshToken(uid);
  }, [uid]);
}

// ─── In-app permission prompt component ──────────────────────────────────────
/**
 * Renders a branded bottom banner asking the member to allow push notifications.
 * Only visible when:
 *   - Platform is web
 *   - Notifications API is supported
 *   - Permission is 'default' (not yet granted or denied)
 *   - The user has not dismissed the banner this session
 */
export function FcmPermissionPrompt({ uid }: { uid: string | null | undefined }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || !uid) return;
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'default') return;
    try {
      // Permanently hide after 3 lifetime dismissals
      const dismissCount = parseInt(localStorage.getItem('fcm_prompt_dismiss_count') ?? '0', 10);
      if (dismissCount >= 3) return;
      // Also hide for the rest of this session if already dismissed once today
      if (sessionStorage.getItem('fcm_prompt_dismissed') === '1') return;
    } catch (_) { /* storage unavailable */ }
    setVisible(true);
  }, [uid]);

  if (!visible) return null;

  async function handleAllow() {
    setVisible(false);
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted' && uid) {
        await _registerOrRefreshToken(uid);
      }
    } catch (err) {
      console.warn('[FcmPermissionPrompt] Permission request failed:', err);
    }
  }

  function handleDismiss() {
    setVisible(false);
    try {
      sessionStorage.setItem('fcm_prompt_dismissed', '1');
      const prev = parseInt(localStorage.getItem('fcm_prompt_dismiss_count') ?? '0', 10);
      localStorage.setItem('fcm_prompt_dismiss_count', String(prev + 1));
    } catch (_) { /* ignore */ }
  }

  return (
    <View style={styles.banner}>
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>🔔</Text>
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title}>Stay in the loop</Text>
        <Text style={styles.body}>
          Get notified when your coach updates your plan or shares new content.
        </Text>
      </View>
      <View style={styles.actions}>
        <Pressable style={styles.allowBtn} onPress={handleAllow}>
          <Text style={styles.allowText}>Allow</Text>
        </Pressable>
        <Pressable style={styles.dismissBtn} onPress={handleDismiss}>
          <Text style={styles.dismissText}>Not now</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1A1D24',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(245,166,35,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: { fontSize: 20 },
  textWrap: { flex: 1 },
  title: { color: '#FFF', fontSize: 14, fontWeight: '700', marginBottom: 2 },
  body: { color: 'rgba(255,255,255,0.55)', fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: 'column', gap: 6, alignItems: 'flex-end' },
  allowBtn: {
    backgroundColor: '#F5A623',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  allowText: { color: '#0E1117', fontSize: 13, fontWeight: '700' },
  dismissBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  dismissText: { color: 'rgba(255,255,255,0.4)', fontSize: 12 },
});
