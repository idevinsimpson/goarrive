/**
 * Join in app (beta) — embedded Zoom Meeting SDK Component View
 *
 * Beta entry point, separate from the primary "Join Session" button which still
 * uses Linking.openURL(inst.zoomJoinUrl). This route joins the member into the
 * Zoom meeting in-app via the Web Meeting SDK embedded Component View
 * (ZoomMtgEmbedded). Component View renders into a contained <div>, so the
 * page is NOT taken over fullscreen and a workout overlay can sit on top
 * without hiding the Zoom video tile.
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

// Zoom Web Meeting SDK (embedded Component View) — loaded via CDN at runtime so
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

// ── Toolbar auto-click (default-on workaround) ───────────────────────────────

// Probe Zoom's rendered toolbar inside #zoom-meeting-sdk-root for a button
// whose aria-label loosely matches any of the given patterns. Returns the
// first match or null. Case-insensitive substring match handles language
// variants ("start video", "Start Video", "Start my video") and avoids
// false-positives like "stop video".
function findToolbarButton(
  root: ParentNode,
  includeAny: string[],
  excludeAny: string[] = [],
): HTMLElement | null {
  const buttons = root.querySelectorAll<HTMLElement>('[aria-label]');
  for (const el of Array.from(buttons)) {
    const raw = el.getAttribute('aria-label') || '';
    const label = raw.toLowerCase();
    if (excludeAny.some((bad) => label.includes(bad))) continue;
    if (includeAny.some((good) => label.includes(good))) return el;
  }
  return null;
}

// Click the start-video and join-audio/unmute buttons via DOM after join.
// Retries every 250ms for ~6s because the toolbar mounts asynchronously
// after client.join() resolves. Each button only clicks once (tracked via
// `videoClicked` / `audioClicked` flags) so we don't toggle the user off
// if Zoom re-renders during retries.
function autoStartMediaViaToolbar(log: (msg: string) => void): void {
  if (typeof document === 'undefined') return;
  let videoClicked = false;
  let audioClicked = false;
  let dumpedLabels = false;
  let attempts = 0;
  const MAX_ATTEMPTS = 32; // 32 × 250ms = 8s window

  const tick = () => {
    attempts += 1;
    const root =
      document.getElementById('zoom-meeting-sdk-root') || document.body;

    // On attempt 3 (toolbar has had time to mount), dump every aria-label
    // we can see inside the Zoom container so the debug overlay shows what
    // Zoom is actually rendering on this device. This makes the next test
    // self-diagnosing — we can see in the log exactly which label to match.
    if (!dumpedLabels && attempts === 3) {
      try {
        const labeled = root.querySelectorAll<HTMLElement>('[aria-label]');
        const labels = Array.from(labeled)
          .map((el) => el.getAttribute('aria-label'))
          .filter((l): l is string => !!l && l.trim().length > 0);
        log(`toolbar probe → ${labels.length} aria-labels found`);
        // Slice to avoid flooding the overlay; first 24 covers any toolbar.
        labels.slice(0, 24).forEach((l, i) => log(`  [${i}] "${l}"`));
        if (labels.length === 0) {
          // Fall back to dumping <button> elements without aria-label so
          // we can see if Zoom is using icon-only buttons.
          const buttons = root.querySelectorAll<HTMLElement>(
            'button, [role="button"]',
          );
          log(`fallback → ${buttons.length} button-like elements`);
          Array.from(buttons)
            .slice(0, 12)
            .forEach((b, i) => {
              const cls = (b.className || '').toString().slice(0, 60);
              const title = b.getAttribute('title') || '';
              log(`  btn[${i}] class="${cls}" title="${title}"`);
            });
        }
      } catch (err: any) {
        log(`toolbar probe failed: ${err?.message || err}`);
      }
      dumpedLabels = true;
    }

    if (!videoClicked) {
      const camBtn = findToolbarButton(
        root,
        [
          'start video',
          'start my video',
          'turn on camera',
          'start camera',
          'video on',
        ],
        ['stop video', 'stop my video', 'turn off camera'],
      );
      if (camBtn) {
        try {
          camBtn.click();
          videoClicked = true;
          const label = (camBtn.getAttribute('aria-label') || '').slice(0, 40);
          log(`auto-start camera → clicked "${label}" (attempt ${attempts})`);
        } catch (err: any) {
          log(`auto-start camera → click failed: ${err?.message || err}`);
        }
      }
    }

    if (!audioClicked) {
      const audBtn = findToolbarButton(
        root,
        [
          'join audio',
          'unmute',
          'turn on microphone',
          'audio on',
          'connect audio',
        ],
        ['mute my', 'mute microphone', 'turn off microphone'],
      );
      if (audBtn) {
        try {
          audBtn.click();
          audioClicked = true;
          const label = (audBtn.getAttribute('aria-label') || '').slice(0, 40);
          log(`auto-start mic → clicked "${label}" (attempt ${attempts})`);
        } catch (err: any) {
          log(`auto-start mic → click failed: ${err?.message || err}`);
        }
      }
    }

    if ((videoClicked && audioClicked) || attempts >= MAX_ATTEMPTS) {
      if (!videoClicked) log('auto-start camera → not found, user must tap');
      if (!audioClicked) log('auto-start mic → not found, user must tap');
      return;
    }
    setTimeout(tick, 250);
  };

  setTimeout(tick, 250);
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
  // On-screen breadcrumb log: surfaces each step in handleJoin so iOS Safari
  // users can read where the join flow stalls without a Web Inspector.
  const [debugLog, setDebugLog] = useState<string[]>([]);
  const appendLog = useCallback((line: string) => {
    const stamp = new Date().toISOString().slice(11, 23);
    setDebugLog((prev) => [...prev, `${stamp}  ${line}`]);
    console.log(`[JoinBeta] ${line}`);
  }, []);

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

    appendLog('handleJoin click received');

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
        appendLog('pre-warm getUserMedia → requesting');
        prewarmStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        appendLog('pre-warm getUserMedia → granted');
      }
    } catch (prewarmErr: any) {
      appendLog(`pre-warm getUserMedia → failed: ${prewarmErr?.message || prewarmErr}`);
      console.warn('[JoinBeta] camera/mic pre-warm failed:', prewarmErr);
    }

    setPhase('joining');
    try {
      appendLog('loadZoomEmbedded → scripts loading');
      const ZoomMtgEmbedded = await loadZoomEmbedded();
      appendLog('loadZoomEmbedded → scripts loaded');

      // Release the pre-warm tracks before Zoom claims the devices.
      // Permission stays granted at the browser level once stopped.
      if (prewarmStream) {
        try {
          prewarmStream.getTracks().forEach((t) => t.stop());
        } catch {}
        prewarmStream = null;
        appendLog('pre-warm tracks released');
      }

      const client = ZoomMtgEmbedded.createClient();
      clientRef.current = client;
      const root = containerRef.current;
      if (!root) throw new Error('Join container not mounted');

      appendLog('client.init → calling');
      await client.init({
        zoomAppRoot: root,
        language: 'en-US',
        patchJsMedia: true,
        // Strip down the prebuilt UI: cloud recording is server-managed and we
        // don't want invite / phone-call-out / report / screen share in a 1:1
        // coaching session. Member only needs mic, camera, and leave.
        disableInvite: true,
        disableCallOut: true,
        disableRecord: true,
        disableReport: true,
        screenShare: false,
        customize: {
          video: {
            isResizable: true,
            viewSizes: { default: { width: 1000, height: 600 } },
          },
          meetingInfo: ['topic'],
        },
      });
      appendLog('client.init → success');

      appendLog('client.join → calling');
      await client.join({
        sdkKey: joinConfig.sdkKey,
        signature: joinConfig.signature,
        meetingNumber: joinConfig.meetingNumber,
        password: joinConfig.password || '',
        userName: joinConfig.userName || 'Member',
        userEmail: joinConfig.userEmail || '',
        // Pass ZAK when the server promoted us to host (role=1). Zoom needs
        // this to recognize a host and auto-start cloud recording.
        ...(joinConfig.zak ? { zak: joinConfig.zak } : {}),
      });
      appendLog('client.join → success');

      // Zoom Web SDK has no public startVideo/startAudio API for self (confirmed
      // in embedded.d.ts + on-record from Tommy Gaessler at Zoom: "The Web SDK
      // does not support default video on"). Community-validated workaround:
      // after join resolves, locate Zoom's own toolbar buttons by aria-label
      // and dispatch a synthetic click. Pre-warm already granted persistent
      // mic/camera permission at the origin level, so this doesn't need a
      // fresh user-gesture round-trip.
      autoStartMediaViaToolbar(appendLog);

      setPhase('in-meeting');
    } catch (err: any) {
      appendLog(`zoom error: ${err?.reason || err?.message || JSON.stringify(err)}`);
      console.error('[JoinBeta] Zoom join failed:', err);
      setErrorMsg(
        err?.reason || err?.message || 'The in-app join failed. Try the browser fallback.',
      );
      setPhase('error');
    }
  }, [joinConfig, appendLog]);

  // 3. Hide the Zoom toolbar buttons we don't want in a coaching session.
  //    The init() disable* flags handle invite/callout/record/report. CSS
  //    handles the rest (chat, participants, reactions, AI Companion, apps,
  //    settings, more menu) by targeting Zoom's aria-labels — those are
  //    semantic and don't change across SDK minor versions like classnames do.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (typeof document === 'undefined') return;
    const STYLE_ID = 'zoom-toolbar-strip';
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #zoom-meeting-sdk-root [aria-label="Chat"],
      #zoom-meeting-sdk-root [aria-label="Open chat panel"],
      #zoom-meeting-sdk-root [aria-label="Participants"],
      #zoom-meeting-sdk-root [aria-label="Manage participants"],
      #zoom-meeting-sdk-root [aria-label="Open the participants list pane"],
      #zoom-meeting-sdk-root [aria-label="Reactions"],
      #zoom-meeting-sdk-root [aria-label="More meeting controls"],
      #zoom-meeting-sdk-root [aria-label="More"],
      #zoom-meeting-sdk-root [aria-label="Settings"],
      #zoom-meeting-sdk-root [aria-label="Apps"],
      #zoom-meeting-sdk-root [aria-label="Open Apps"],
      #zoom-meeting-sdk-root [aria-label="AI Companion"],
      #zoom-meeting-sdk-root [aria-label="Companion mode"],
      #zoom-meeting-sdk-root [aria-label*="Security"],
      #zoom-meeting-sdk-root [aria-label*="Encryption"],
      #zoom-meeting-sdk-root [aria-label*="Share Screen"],
      #zoom-meeting-sdk-root [aria-label*="Share screen"],
      #zoom-meeting-sdk-root [aria-label*="share screen"],
      #zoom-meeting-sdk-root [aria-label*="Share Content"],
      #zoom-meeting-sdk-root [aria-label*="Record"],
      #zoom-meeting-sdk-root [aria-label*="record"] {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  // 4. Cleanup on unmount
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
            {debugLog.length > 0 && (
              <View style={s.debugBox}>
                <Text style={s.debugTitle}>Debug log</Text>
                {debugLog.map((line, i) => (
                  <Text key={i} style={s.debugLine}>{line}</Text>
                ))}
              </View>
            )}
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
            {debugLog.length > 0 && (
              <View style={s.debugBox}>
                <Text style={s.debugTitle}>Debug log</Text>
                {debugLog.map((line, i) => (
                  <Text key={i} style={s.debugLine}>{line}</Text>
                ))}
              </View>
            )}
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

      {/* Persistent debug overlay — pinned to the top of the viewport so it
          stays readable on iOS Safari even after Zoom takes over the page
          area. A dedicated small Clear button (not the whole overlay) handles
          dismissal so accidental taps don't wipe the log mid-test. */}
      {phase === 'in-meeting' && debugLog.length > 0 && (
        <View
          style={[s.debugOverlay, { top: Math.max(8, insets.top + 4) }]}
          pointerEvents="box-none"
        >
          <View style={s.debugHeaderRow} pointerEvents="auto">
            <Text style={s.debugTitle}>Debug log</Text>
            <Pressable
              onPress={() => setDebugLog([])}
              style={s.debugClearBtn}
              hitSlop={10}
            >
              <Text style={s.debugClearText}>Clear</Text>
            </Pressable>
          </View>
          <ScrollView style={s.debugScroll} pointerEvents="auto">
            {debugLog.map((line, i) => (
              <Text key={i} style={s.debugLine}>{line}</Text>
            ))}
          </ScrollView>
        </View>
      )}
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
  debugBox: {
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 8,
    padding: 10,
    marginTop: 12,
    gap: 2,
  },
  debugTitle: {
    color: TEXT_SECONDARY,
    fontSize: 11,
    fontFamily: FH,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  debugLine: {
    color: TEXT_PRIMARY,
    fontSize: 11,
    fontFamily: Platform.OS === 'web' ? 'monospace' : FB,
    lineHeight: 16,
  },
  debugOverlay: {
    position: 'absolute',
    left: 8,
    right: 8,
    maxHeight: 340,
    backgroundColor: 'rgba(0,0,0,0.92)',
    borderColor: GOLD,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    zIndex: 9999,
    ...(Platform.OS === 'web' ? ({ position: 'fixed' } as any) : {}),
  },
  debugScroll: {
    maxHeight: 290,
  },
  debugHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  debugClearBtn: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(245,166,35,0.2)',
    borderColor: GOLD,
    borderWidth: 1,
    borderRadius: 6,
  },
  debugClearText: {
    color: GOLD,
    fontSize: 11,
    fontFamily: FH,
    fontWeight: '700',
  },
});
