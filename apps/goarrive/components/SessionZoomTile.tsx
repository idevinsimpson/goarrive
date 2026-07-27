/**
 * SessionZoomTile — embedded Zoom Meeting SDK tile for the member session page.
 *
 * Recorded sessions gate the workout player behind an in-app Zoom join
 * (locked decision: the session is captured on Zoom cloud recording, so the
 * member must be in the meeting before the workout starts). This component
 * owns the full join lifecycle — CDN SDK load, getEmbeddedSessionJoinConfig,
 * client.init/join, camera+mic auto-start — and then floats as a
 * picture-in-picture tile above the WorkoutPlayer modal during playback.
 *
 * Web only (Meeting SDK Phase 1). Native renders a browser-join fallback.
 * The core join flow mirrors app/join/[sessionInstanceId].tsx (the beta
 * standalone join route), trimmed of its debug overlay.
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
} from 'react-native';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

const CARD_BG = '#151B26';
const BORDER = '#2A3347';
const GOLD = '#F5A623';
const RED = '#E05252';
const TEXT_PRIMARY = '#F0F4F8';
const TEXT_SECONDARY = '#A0AEC0';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

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

function findToolbarButton(
  root: ParentNode,
  includeAny: string[],
  excludeAny: string[] = [],
): HTMLElement | null {
  const buttons = root.querySelectorAll<HTMLElement>('[aria-label]');
  for (const el of Array.from(buttons)) {
    const label = (el.getAttribute('aria-label') || '').toLowerCase();
    if (excludeAny.some((bad) => label.includes(bad))) continue;
    if (includeAny.some((good) => label.includes(good))) return el;
  }
  return null;
}

// Zoom's Web SDK has no public startVideo/startAudio for self — click its
// toolbar buttons by aria-label after join (same workaround as the beta
// join route; validated on iOS Safari + desktop labels).
function autoStartMediaViaToolbar(rootId: string): void {
  if (typeof document === 'undefined') return;
  let videoClicked = false;
  let audioClicked = false;
  let attempts = 0;
  const MAX_ATTEMPTS = 32;

  const tick = () => {
    attempts += 1;
    const root = document.getElementById(rootId) || document.body;
    if (!videoClicked) {
      const camBtn = findToolbarButton(
        root,
        ['video off', 'start video', 'start my video', 'turn on camera', 'start camera'],
        ['video on', 'stop video', 'stop my video', 'turn off camera'],
      );
      if (camBtn) {
        try { camBtn.click(); videoClicked = true; } catch {}
      }
    }
    if (!audioClicked) {
      const audBtn = findToolbarButton(
        root,
        ['headphone', 'join audio', 'unmute', 'turn on microphone', 'connect audio'],
        ['mute meeting', 'mute my', 'mute microphone', 'turn off microphone'],
      );
      if (audBtn) {
        try { audBtn.click(); audioClicked = true; } catch {}
      }
    }
    if ((videoClicked && audioClicked) || attempts >= MAX_ATTEMPTS) return;
    setTimeout(tick, 250);
  };
  setTimeout(tick, 250);
}

const CONTAINER_ID = 'session-zoom-tile-root';

export type SessionZoomPhase = 'idle' | 'joining' | 'in-meeting' | 'error' | 'unsupported';

interface SessionZoomTileProps {
  sessionInstanceId: string;
  zoomJoinUrl?: string | null;
  /** Float as a small fixed tile above the workout player (web). */
  pip: boolean;
  onJoined: () => void;
  /** Continue without the in-app Zoom join (error/native escape hatch). */
  onSkip?: () => void;
}

export default function SessionZoomTile({
  sessionInstanceId,
  zoomJoinUrl,
  pip,
  onJoined,
  onSkip,
}: SessionZoomTileProps) {
  const [phase, setPhase] = useState<SessionZoomPhase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<any>(null);

  const fallbackToBrowser = useCallback(async () => {
    if (!zoomJoinUrl) return;
    try {
      await Linking.openURL(zoomJoinUrl);
    } catch {}
  }, [zoomJoinUrl]);

  const handleJoin = useCallback(async () => {
    if (Platform.OS !== 'web') {
      setPhase('unsupported');
      return;
    }
    // iOS Safari: getUserMedia must run inside the user-gesture window —
    // pre-warm permission before the multi-second SDK load chain.
    let prewarmStream: MediaStream | null = null;
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        prewarmStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      }
    } catch (err) {
      console.warn('[SessionZoomTile] camera/mic pre-warm failed:', err);
    }

    setPhase('joining');
    try {
      const getConfig = httpsCallable<{ sessionInstanceId: string }, JoinConfig>(
        functions,
        'getEmbeddedSessionJoinConfig',
      );
      const res = await getConfig({ sessionInstanceId });
      const joinConfig = res.data;

      const ZoomMtgEmbedded = await loadZoomEmbedded();
      if (prewarmStream) {
        try { prewarmStream.getTracks().forEach((t) => t.stop()); } catch {}
        prewarmStream = null;
      }

      const client = ZoomMtgEmbedded.createClient();
      clientRef.current = client;
      const root = containerRef.current;
      if (!root) throw new Error('Zoom container not mounted');

      await client.init({
        zoomAppRoot: root,
        language: 'en-US',
        patchJsMedia: true,
        disableInvite: true,
        disableCallOut: true,
        disableRecord: true,
        disableReport: true,
        screenShare: false,
        customize: {
          video: {
            isResizable: false,
            viewSizes: { default: { width: 320, height: 220 } },
          },
          meetingInfo: ['topic'],
        },
      });

      await client.join({
        sdkKey: joinConfig.sdkKey,
        signature: joinConfig.signature,
        meetingNumber: joinConfig.meetingNumber,
        password: joinConfig.password || '',
        userName: joinConfig.userName || 'Member',
        userEmail: joinConfig.userEmail || '',
        ...(joinConfig.zak ? { zak: joinConfig.zak } : {}),
      });

      autoStartMediaViaToolbar(CONTAINER_ID);
      setPhase('in-meeting');
      onJoined();
    } catch (err: any) {
      console.error('[SessionZoomTile] Zoom join failed:', err);
      if (prewarmStream) {
        try { prewarmStream.getTracks().forEach((t) => t.stop()); } catch {}
      }
      setErrorMsg(err?.reason || err?.message || 'The in-app join failed.');
      setPhase('error');
    }
  }, [sessionInstanceId, onJoined]);

  // Strip Zoom toolbar controls that don't belong in a coaching session.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const STYLE_ID = 'session-zoom-tile-toolbar-strip';
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${CONTAINER_ID} [aria-label="Chat"],
      #${CONTAINER_ID} [aria-label="Open chat panel"],
      #${CONTAINER_ID} [aria-label="Participants"],
      #${CONTAINER_ID} [aria-label="Manage participants"],
      #${CONTAINER_ID} [aria-label="Open the participants list pane"],
      #${CONTAINER_ID} [aria-label="Reactions"],
      #${CONTAINER_ID} [aria-label="More meeting controls"],
      #${CONTAINER_ID} [aria-label="More"],
      #${CONTAINER_ID} [aria-label="Settings"],
      #${CONTAINER_ID} [aria-label="Apps"],
      #${CONTAINER_ID} [aria-label="Open Apps"],
      #${CONTAINER_ID} [aria-label="AI Companion"],
      #${CONTAINER_ID} [aria-label="Companion mode"],
      #${CONTAINER_ID} [aria-label*="Security"],
      #${CONTAINER_ID} [aria-label*="Encryption"],
      #${CONTAINER_ID} [aria-label*="Share Screen"],
      #${CONTAINER_ID} [aria-label*="Share screen"],
      #${CONTAINER_ID} [aria-label*="share screen"],
      #${CONTAINER_ID} [aria-label*="Share Content"],
      #${CONTAINER_ID} [aria-label*="Record"],
      #${CONTAINER_ID} [aria-label*="record"] {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  useEffect(() => {
    return () => {
      const client = clientRef.current;
      if (client) {
        try { client.leaveMeeting?.(); } catch {}
        try { (globalThis as any).ZoomMtgEmbedded?.destroyClient?.(); } catch {}
      }
    };
  }, []);

  const inMeeting = phase === 'in-meeting';

  return (
    <>
      {phase === 'idle' && (
        <View style={s.card}>
          <Text style={s.cardLabel}>Step 1 — Start your session</Text>
          <Text style={s.cardSub}>
            This session is recorded for you and your coach. Join the session
            room first — your workout starts right after.
          </Text>
          {Platform.OS === 'web' ? (
            <Pressable style={s.primaryBtn} onPress={handleJoin}>
              <Text style={s.primaryBtnText}>Start Session</Text>
            </Pressable>
          ) : (
            <>
              <Text style={s.cardSub}>
                In-app session join is web-only for now. Join in your browser,
                then come back and continue to your workout.
              </Text>
              {!!zoomJoinUrl && (
                <Pressable style={s.primaryBtn} onPress={fallbackToBrowser}>
                  <Text style={s.primaryBtnText}>Join in browser</Text>
                </Pressable>
              )}
              {onSkip && (
                <Pressable style={s.secondaryBtn} onPress={onSkip}>
                  <Text style={s.secondaryBtnText}>Continue to workout</Text>
                </Pressable>
              )}
            </>
          )}
        </View>
      )}

      {phase === 'joining' && (
        <View style={s.card}>
          <ActivityIndicator color={GOLD} />
          <Text style={s.cardSub}>Connecting to your session room…</Text>
        </View>
      )}

      {phase === 'error' && (
        <View style={[s.card, { borderColor: RED }]}>
          <Text style={[s.cardLabel, { color: RED }]}>Couldn&apos;t start the session room</Text>
          {!!errorMsg && <Text style={s.cardSub}>{errorMsg}</Text>}
          <Pressable style={s.primaryBtn} onPress={handleJoin}>
            <Text style={s.primaryBtnText}>Try again</Text>
          </Pressable>
          {!!zoomJoinUrl && (
            <Pressable style={s.secondaryBtn} onPress={fallbackToBrowser}>
              <Text style={s.secondaryBtnText}>Join in browser instead</Text>
            </Pressable>
          )}
          {onSkip && (
            <Pressable style={s.secondaryBtn} onPress={onSkip}>
              <Text style={s.secondaryBtnText}>Continue to workout anyway</Text>
            </Pressable>
          )}
        </View>
      )}

      {phase === 'unsupported' && (
        <View style={s.card}>
          <Text style={s.cardLabel}>Not supported on this device yet</Text>
          {!!zoomJoinUrl && (
            <Pressable style={s.primaryBtn} onPress={fallbackToBrowser}>
              <Text style={s.primaryBtnText}>Join in browser</Text>
            </Pressable>
          )}
          {onSkip && (
            <Pressable style={s.secondaryBtn} onPress={onSkip}>
              <Text style={s.secondaryBtnText}>Continue to workout</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Zoom renders into this div. In PiP mode it floats fixed above the
          WorkoutPlayer modal (higher z-index than RN-web's modal layer). */}
      {Platform.OS === 'web' && (
        <div
          ref={containerRef as any}
          id={CONTAINER_ID}
          style={{
            display: inMeeting ? 'block' : 'none',
            ...(pip
              ? {
                  position: 'fixed' as const,
                  bottom: 16,
                  right: 16,
                  width: 320,
                  zIndex: 100000,
                  borderRadius: 12,
                  overflow: 'hidden',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
                }
              : {
                  width: '100%',
                  maxWidth: 480,
                  alignSelf: 'center' as const,
                  margin: '16px auto',
                }),
          }}
        />
      )}
    </>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: CARD_BG,
    borderColor: BORDER,
    borderWidth: 1,
    borderRadius: 14,
    padding: 20,
    gap: 12,
    marginBottom: 16,
    width: '100%',
  },
  cardLabel: { color: TEXT_PRIMARY, fontSize: 16, fontFamily: FH, fontWeight: '700' },
  cardSub: { color: TEXT_SECONDARY, fontSize: 14, fontFamily: FB, lineHeight: 20 },
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
