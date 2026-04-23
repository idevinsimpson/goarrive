/**
 * Join in app (beta) — embedded Zoom Meeting SDK Client View
 *
 * Beta entry point, separate from the primary "Join Session" button which still
 * uses Linking.openURL(inst.zoomJoinUrl). This route joins the member into the
 * Zoom meeting in-app via the Web Meeting SDK embedded client.
 *
 * Phase 1 (participant/member beta):
 *   - Web proof first. Native shows a placeholder until the dev-client lands.
 *   - role is always 0 (participant). No coach host-start UI yet.
 *   - If anything goes wrong, we show a "Join in browser instead" fallback
 *     that reuses the existing zoomJoinUrl flow.
 *
 * Staging prerequisite: ZOOM_MEETING_SDK_KEY / ZOOM_MEETING_SDK_SECRET secrets
 * must be set and a Meeting SDK Marketplace app must exist. See
 * docs/ZOOM_MEETING_SDK_SETUP.md.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Platform,
  Linking,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter, Redirect } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../../lib/AuthContext';
import { db, functions } from '../../lib/firebase';
import { SessionInstance } from '../../lib/schedulingTypes';

const BG = '#0E1117';
const CARD_BG = '#151B26';
const BORDER = '#2A3347';
const GOLD = '#F5A623';
const RED = '#E05252';
const BLUE = '#4A90D9';
const TEXT_PRIMARY = '#F0F4F8';
const TEXT_SECONDARY = '#A0AEC0';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

// Zoom Web Meeting SDK (embedded / Client View) — loaded via CDN at runtime so
// we don't bloat the Expo Web bundle. Keep in sync with the SDK version docs
// in docs/ZOOM_MEETING_SDK_SETUP.md. Pin to a fixed 3.x release for stability.
const ZOOM_SDK_VERSION = '3.11.2';
const ZOOM_SDK_BASE = `https://source.zoom.us/${ZOOM_SDK_VERSION}`;

type JoinConfig = {
  meetingNumber: string;
  signature: string;
  sdkKey: string;
  userName: string;
  userEmail: string;
  password: string;
  role: 0 | 1;
  zak: string | null;
};

// ── Dynamic CDN loader (web only) ────────────────────────────────────────────

function ensureScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('no document'));
    const existing = document.querySelector(`script[data-zoom-src="${src}"]`);
    if (existing) {
      if ((existing as any).dataset.loaded === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`Failed: ${src}`)));
      return;
    }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.dataset.zoomSrc = src;
    el.onload = () => {
      el.dataset.loaded = '1';
      resolve();
    };
    el.onerror = () => reject(new Error(`Failed: ${src}`));
    document.head.appendChild(el);
  });
}

function ensureStylesheet(href: string): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`link[data-zoom-href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.dataset.zoomHref = href;
  document.head.appendChild(link);
}

async function loadZoomEmbedded(): Promise<any> {
  // Zoom ships a CommonJS bundle under zoom-meeting-embedded. The UMD build
  // attaches ZoomMtgEmbedded to window.
  ensureStylesheet(`${ZOOM_SDK_BASE}/css/bootstrap.css`);
  ensureStylesheet(`${ZOOM_SDK_BASE}/css/react-select.css`);
  await ensureScript(`${ZOOM_SDK_BASE}/lib/vendor/react.min.js`);
  await ensureScript(`${ZOOM_SDK_BASE}/lib/vendor/react-dom.min.js`);
  await ensureScript(`${ZOOM_SDK_BASE}/lib/vendor/redux.min.js`);
  await ensureScript(`${ZOOM_SDK_BASE}/lib/vendor/redux-thunk.min.js`);
  await ensureScript(`${ZOOM_SDK_BASE}/lib/vendor/lodash.min.js`);
  await ensureScript(`${ZOOM_SDK_BASE}/zoom-meeting-embedded-${ZOOM_SDK_VERSION}.min.js`);
  const ZoomMtgEmbedded = (globalThis as any).ZoomMtgEmbedded;
  if (!ZoomMtgEmbedded) throw new Error('ZoomMtgEmbedded not available after load');
  return ZoomMtgEmbedded;
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function JoinBetaScreen() {
  const { sessionInstanceId } = useLocalSearchParams<{ sessionInstanceId: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [phase, setPhase] = useState<
    'loading' | 'ready' | 'joining' | 'in-meeting' | 'error' | 'unsupported'
  >('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [inst, setInst] = useState<SessionInstance | null>(null);
  const [joinConfig, setJoinConfig] = useState<JoinConfig | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<any>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(member)/my-sessions');
  }, [router]);

  const fallbackToBrowser = useCallback(async () => {
    if (!inst?.zoomJoinUrl) return;
    try {
      await Linking.openURL(inst.zoomJoinUrl);
    } catch {
      // no-op; user can copy link
    }
  }, [inst?.zoomJoinUrl]);

  // 1. Fetch instance + callable config
  useEffect(() => {
    if (authLoading) return;
    if (!user) return; // Redirect handled below
    if (!sessionInstanceId) {
      setErrorMsg('Missing session ID.');
      setPhase('error');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'session_instances', sessionInstanceId));
        if (cancelled) return;
        if (!snap.exists()) {
          setErrorMsg("We couldn't find that session.");
          setPhase('error');
          return;
        }
        const data = { id: snap.id, ...snap.data() } as SessionInstance;
        setInst(data);

        const getConfig = httpsCallable<{ sessionInstanceId: string }, JoinConfig>(
          functions,
          'getEmbeddedSessionJoinConfig',
        );
        const res = await getConfig({ sessionInstanceId });
        if (cancelled) return;
        setJoinConfig(res.data);
        setPhase('ready');
      } catch (err: any) {
        if (cancelled) return;
        console.error('[JoinBeta] setup error:', err);
        const msg =
          err?.message ||
          'We could not prepare the in-app join. You can still join in your browser.';
        setErrorMsg(msg);
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, user, sessionInstanceId]);

  // 2. Join the meeting once we have config (web only for now)
  const handleJoin = useCallback(async () => {
    if (!joinConfig) return;
    if (Platform.OS !== 'web') {
      setPhase('unsupported');
      return;
    }
    setPhase('joining');
    try {
      const ZoomMtgEmbedded = await loadZoomEmbedded();
      const client = ZoomMtgEmbedded.createClient();
      clientRef.current = client;
      const root = containerRef.current;
      if (!root) throw new Error('Join container not mounted');

      await client.init({
        zoomAppRoot: root,
        language: 'en-US',
        patchJsMedia: true,
        customize: {
          video: {
            isResizable: true,
            viewSizes: { default: { width: 1000, height: 600 } },
          },
          meetingInfo: ['topic', 'host', 'participant', 'dc'],
        },
      });

      await client.join({
        sdkKey: joinConfig.sdkKey,
        signature: joinConfig.signature,
        meetingNumber: joinConfig.meetingNumber,
        password: joinConfig.password || '',
        userName: joinConfig.userName || 'Member',
        userEmail: joinConfig.userEmail || '',
        // zak omitted for role=0 (participant). Host-start will pass zak later.
      });

      setPhase('in-meeting');
    } catch (err: any) {
      console.error('[JoinBeta] Zoom join failed:', err);
      setErrorMsg(
        err?.reason || err?.message || 'The in-app join failed. Try the browser fallback.',
      );
      setPhase('error');
    }
  }, [joinConfig]);

  // 3. Cleanup on unmount
  useEffect(() => {
    return () => {
      const client = clientRef.current;
      if (client) {
        try {
          client.leaveMeeting?.();
        } catch {}
        try {
          (globalThis as any).ZoomMtgEmbedded?.destroyClient?.();
        } catch {}
      }
    };
  }, []);

  // ── Render guards ──────────────────────────────────────────────────────────
  if (authLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={GOLD} />
      </View>
    );
  }
  if (!user) {
    return <Redirect href="/(auth)/login" />;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={s.scrollContent}>
        <View style={s.header}>
          <Pressable onPress={goBack} style={s.backBtn} hitSlop={12}>
            <Text style={s.backBtnText}>← Back</Text>
          </Pressable>
          <View style={s.betaBadge}>
            <Text style={s.betaBadgeText}>Beta</Text>
          </View>
        </View>

        <Text style={s.title}>Join in app</Text>
        <Text style={s.subtitle}>
          An embedded, in-app way to join your session. Still in beta — if anything
          doesn&apos;t work, you can always join in your browser.
        </Text>

        {phase === 'loading' && (
          <View style={s.card}>
            <ActivityIndicator color={GOLD} />
            <Text style={s.cardText}>Preparing your session…</Text>
          </View>
        )}

        {phase === 'ready' && (
          <View style={s.card}>
            <Text style={s.cardLabel}>Ready to join</Text>
            {inst?.scheduledDate && (
              <Text style={s.cardSub}>
                {inst.scheduledDate} · {inst.scheduledStartTime}–{inst.scheduledEndTime}
              </Text>
            )}
            {Platform.OS === 'web' ? (
              <Pressable style={s.primaryBtn} onPress={handleJoin}>
                <Text style={s.primaryBtnText}>Start in-app join</Text>
              </Pressable>
            ) : (
              <View style={s.infoBox}>
                <Text style={s.infoText}>
                  In-app join on mobile is coming soon. For now, please use the
                  primary &ldquo;Join Session&rdquo; button or open the browser.
                </Text>
              </View>
            )}
            {inst?.zoomJoinUrl && (
              <Pressable style={s.secondaryBtn} onPress={fallbackToBrowser}>
                <Text style={s.secondaryBtnText}>Join in browser instead</Text>
              </Pressable>
            )}
          </View>
        )}

        {phase === 'joining' && (
          <View style={s.card}>
            <ActivityIndicator color={GOLD} />
            <Text style={s.cardText}>Connecting to your session…</Text>
          </View>
        )}

        {phase === 'unsupported' && (
          <View style={s.card}>
            <Text style={s.cardLabel}>Not supported on this device yet</Text>
            <Text style={s.cardSub}>
              In-app join is web-only during beta. Please use the primary Join
              Session button or open the browser.
            </Text>
            {inst?.zoomJoinUrl && (
              <Pressable style={s.primaryBtn} onPress={fallbackToBrowser}>
                <Text style={s.primaryBtnText}>Join in browser</Text>
              </Pressable>
            )}
          </View>
        )}

        {phase === 'error' && (
          <View style={[s.card, { borderColor: RED }]}>
            <Text style={[s.cardLabel, { color: RED }]}>
              Couldn&apos;t start the in-app join
            </Text>
            {errorMsg ? <Text style={s.cardSub}>{errorMsg}</Text> : null}
            {inst?.zoomJoinUrl && (
              <Pressable style={s.primaryBtn} onPress={fallbackToBrowser}>
                <Text style={s.primaryBtnText}>Join in browser</Text>
              </Pressable>
            )}
            <Pressable style={s.secondaryBtn} onPress={goBack}>
              <Text style={s.secondaryBtnText}>Back to sessions</Text>
            </Pressable>
          </View>
        )}

        {/* Zoom Meeting SDK renders inside this div (web only). */}
        {Platform.OS === 'web' && (
          <View style={s.zoomWrap}>
            <div
              ref={containerRef as any}
              id="zoom-meeting-sdk-root"
              style={{
                width: '100%',
                minHeight: phase === 'in-meeting' ? 640 : 0,
                display: phase === 'in-meeting' ? 'block' : 'none',
              }}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  center: { flex: 1, backgroundColor: BG, justifyContent: 'center', alignItems: 'center' },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'web' ? 24 : 48,
    paddingBottom: 40,
    maxWidth: 780,
    width: '100%',
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  backBtn: { paddingVertical: 6, paddingRight: 12 },
  backBtnText: { color: TEXT_SECONDARY, fontSize: 14, fontFamily: FB },
  betaBadge: {
    backgroundColor: 'rgba(74,144,217,0.15)',
    borderColor: BLUE,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  betaBadgeText: {
    color: BLUE,
    fontSize: 11,
    fontFamily: FH,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  title: { color: TEXT_PRIMARY, fontSize: 26, fontFamily: FH, fontWeight: '700', marginBottom: 6 },
  subtitle: { color: TEXT_SECONDARY, fontSize: 14, fontFamily: FB, marginBottom: 20, lineHeight: 20 },
  card: {
    backgroundColor: CARD_BG,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 14,
    padding: 20,
    gap: 12,
    marginBottom: 16,
  },
  cardLabel: { color: TEXT_PRIMARY, fontSize: 16, fontFamily: FH, fontWeight: '700' },
  cardSub: { color: TEXT_SECONDARY, fontSize: 14, fontFamily: FB, lineHeight: 20 },
  cardText: { color: TEXT_SECONDARY, fontSize: 14, fontFamily: FB, marginTop: 6 },
  infoBox: {
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderColor: 'rgba(245,166,35,0.3)',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  infoText: { color: GOLD, fontSize: 13, fontFamily: FB, lineHeight: 19 },
  primaryBtn: {
    backgroundColor: GOLD,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#0E1117', fontSize: 15, fontFamily: FH, fontWeight: '700' },
  secondaryBtn: {
    backgroundColor: 'transparent',
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: 'center',
  },
  secondaryBtnText: { color: TEXT_PRIMARY, fontSize: 14, fontFamily: FH, fontWeight: '600' },
  zoomWrap: {
    width: '100%',
    marginTop: 8,
  },
});
