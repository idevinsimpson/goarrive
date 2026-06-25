/**
 * Join in app (beta) — Zoom Meeting SDK Client View
 *
 * Beta entry point, separate from the primary "Join Session" button which still
 * uses Linking.openURL(inst.zoomJoinUrl). This route joins the member into the
 * Zoom meeting in-app via the Web Meeting SDK Client View (ZoomMtg).
 *
 * Client View (ZoomMtg) is used instead of Component View (ZoomMtgEmbedded)
 * because Component View is desktop-only and cannot send camera/mic from iOS
 * Safari. Client View renders Zoom's prebuilt fullscreen UI into #zmmtg-root
 * and supports iOS Safari camera + microphone.
 *
 * Phase 1 (participant/member beta):
 *   - Web proof first. Native shows a placeholder until the dev-client lands.
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Redirect } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useAuth } from '../../lib/AuthContext';
import { db, functions } from '../../lib/firebase';
import { SessionInstance } from '../../lib/schedulingTypes';
import WorkoutPlayer from '../../components/WorkoutPlayer';

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

// Zoom Web Meeting SDK (Client View) — loaded via CDN at runtime so we don't
// bloat the Expo Web bundle. Keep in sync with docs/ZOOM_MEETING_SDK_SETUP.md.
const ZOOM_SDK_VERSION = '3.11.2';
const ZOOM_SDK_BASE = `https://source.zoom.us/${ZOOM_SDK_VERSION}`;

// Path A demo workout (Phase 2 prototype). Minimal inline workout so the
// player has something to tick through while the Zoom session runs underneath.
const DEMO_WORKOUT = {
  name: 'Path A Demo',
  difficulty: 'Intermediate',
  blocks: [
    {
      type: 'Circuit',
      label: 'Warm-up',
      rounds: 1,
      restBetweenSec: 5,
      movements: [
        { movementName: 'Standing Mobility', duration: 20 },
        { movementName: 'Bodyweight Squat', duration: 20 },
        { movementName: 'Light Stretch', duration: 20 },
      ],
    },
  ],
};

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

async function loadZoomClientView(): Promise<any> {
  ensureStylesheet(`${ZOOM_SDK_BASE}/css/bootstrap.css`);
  ensureStylesheet(`${ZOOM_SDK_BASE}/css/react-select.css`);
  await ensureScript(`${ZOOM_SDK_BASE}/lib/vendor/react.min.js`);
  await ensureScript(`${ZOOM_SDK_BASE}/lib/vendor/react-dom.min.js`);
  await ensureScript(`${ZOOM_SDK_BASE}/lib/vendor/redux.min.js`);
  await ensureScript(`${ZOOM_SDK_BASE}/lib/vendor/redux-thunk.min.js`);
  await ensureScript(`${ZOOM_SDK_BASE}/lib/vendor/lodash.min.js`);
  // Client View main bundle (not embedded)
  await ensureScript(`${ZOOM_SDK_BASE}/zoom-meeting-${ZOOM_SDK_VERSION}.min.js`);
  const ZoomMtg = (globalThis as any).ZoomMtg;
  if (!ZoomMtg) throw new Error('ZoomMtg not available after load');
  ZoomMtg.setZoomJSLib(ZOOM_SDK_BASE, '/av');
  ZoomMtg.preLoadWasm();
  ZoomMtg.prepareWebSDK();
  return ZoomMtg;
}

// ── Screen ───────────────────────────────────────────────────────────────────

export default function JoinBetaScreen() {
  const insets = useSafeAreaInsets();
  const { sessionInstanceId } = useLocalSearchParams<{ sessionInstanceId: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [phase, setPhase] = useState<
    'loading' | 'ready' | 'joining' | 'in-meeting' | 'error' | 'unsupported'
  >('loading');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [inst, setInst] = useState<SessionInstance | null>(null);
  const [joinConfig, setJoinConfig] = useState<JoinConfig | null>(null);
  // Path A overlay: once we're in the meeting, surface the workout player on
  // top of the Zoom UI. The Zoom mic/cam/recording continue underneath.
  // While the overlay is visible we hide #zmmtg-root (same content, no
  // z-index battle needed). Toggling lets the member drop back to bare Zoom.
  const [showWorkoutOverlay, setShowWorkoutOverlay] = useState(false);

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

  // 2. Toggle #zmmtg-root visibility while the WorkoutPlayer overlay is up.
  //    Hiding Zoom's fullscreen root eliminates z-index conflicts — the
  //    WorkoutPlayer Modal (a React Native Web portal appended to body) is
  //    the only fixed layer visible while the overlay is active.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const STYLE_ID = 'zoom-root-hidden';
    let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (showWorkoutOverlay && phase === 'in-meeting') {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = STYLE_ID;
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = '#zmmtg-root { display: none !important; }';
    } else {
      styleEl?.remove();
    }
    return () => {
      document.getElementById(STYLE_ID)?.remove();
    };
  }, [showWorkoutOverlay, phase]);

  // 3. Join the meeting once we have config (web only for now)
  const handleJoin = useCallback(async () => {
    if (!joinConfig) return;
    if (Platform.OS !== 'web') {
      setPhase('unsupported');
      return;
    }

    // iOS Safari requires getUserMedia() to be called inside the user-gesture
    // activation window. The Zoom SDK load → init → join chain takes seconds,
    // which is well past Safari's gesture timeout — so its own camera/mic
    // calls silently fail and the green dot never lights up.
    //
    // Pre-warm here, synchronously with the click: prompt for + grant
    // permission, then stop the tracks so Zoom can claim the devices. Once
    // browser-level permission is granted, Zoom's later calls succeed without
    // needing a fresh gesture. Failures are non-fatal.
    let prewarmStream: MediaStream | null = null;
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        prewarmStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
      }
    } catch (prewarmErr) {
      console.warn('[JoinBeta] camera/mic pre-warm failed:', prewarmErr);
    }

    setPhase('joining');
    try {
      const ZoomMtg = await loadZoomClientView();

      // Release the pre-warm tracks before Zoom claims the devices.
      // Permission stays granted at the browser level once stopped.
      if (prewarmStream) {
        try {
          prewarmStream.getTracks().forEach((t) => t.stop());
        } catch {}
        prewarmStream = null;
      }

      const leaveUrl =
        typeof window !== 'undefined'
          ? `${window.location.origin}/(member)/my-sessions`
          : '/';

      await new Promise<void>((resolve, reject) => {
        ZoomMtg.init({
          leaveUrl,
          success: () => {
            ZoomMtg.join({
              signature: joinConfig.signature,
              sdkKey: joinConfig.sdkKey,
              meetingNumber: joinConfig.meetingNumber,
              // Client View uses passWord (capital W)
              passWord: joinConfig.password || '',
              userName: joinConfig.userName || 'Member',
              userEmail: joinConfig.userEmail || '',
              // Pass ZAK when the server promoted us to host (role=1). Zoom
              // needs this to recognize a host and auto-start cloud recording.
              ...(joinConfig.zak ? { zak: joinConfig.zak } : {}),
              success: () => resolve(),
              error: (e: any) => reject(e),
            });
          },
          error: (e: any) => reject(e),
        });
      });

      setPhase('in-meeting');
      // Surface the workout player on top once the meeting is live.
      setShowWorkoutOverlay(true);
    } catch (err: any) {
      console.error('[JoinBeta] Zoom join failed:', err);
      if (prewarmStream) {
        try {
          prewarmStream.getTracks().forEach((t) => t.stop());
        } catch {}
      }
      setErrorMsg(
        err?.reason || err?.message || 'The in-app join failed. Try the browser fallback.',
      );
      setPhase('error');
    }
  }, [joinConfig]);

  // 4. Cleanup on unmount
  useEffect(() => {
    return () => {
      try {
        (globalThis as any).ZoomMtg?.leaveMeeting?.({});
      } catch {}
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
      <ScrollView contentContainerStyle={[s.scrollContent, { paddingTop: Math.max(Platform.OS === 'web' ? 24 : 48, insets.top) }]}>
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

        {phase === 'in-meeting' && !showWorkoutOverlay && (
          <Pressable style={[s.primaryBtn, { marginTop: 12 }]} onPress={() => setShowWorkoutOverlay(true)}>
            <Text style={s.primaryBtnText}>Show workout overlay</Text>
          </Pressable>
        )}
      </ScrollView>

      {/* Path A: workout player overlays Zoom while audio/video/recording
          continue underneath. #zmmtg-root is hidden while this is visible
          (see useEffect above) — no z-index competition needed. */}
      <WorkoutPlayer
        visible={phase === 'in-meeting' && showWorkoutOverlay}
        workout={DEMO_WORKOUT}
        onClose={() => setShowWorkoutOverlay(false)}
        onComplete={() => setShowWorkoutOverlay(false)}
      />
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
});
