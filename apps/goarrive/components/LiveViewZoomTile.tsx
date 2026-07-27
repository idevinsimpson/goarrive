/**
 * SessionZoomTile — embedded Zoom Meeting SDK Component View for live sessions.
 *
 * Reusable across the two playbook live-view surfaces:
 *   - variant="pip":  small corner tile the member sees while the WorkoutPlayer
 *     stays full-screen. Camera auto-starts after join so the coach can see them.
 *   - variant="pane": larger pane the coach sees in the live-view split screen,
 *     showing the member's camera feed.
 *
 * Join flow mirrors app/join/[sessionInstanceId].tsx (the standalone beta page):
 * getEmbeddedSessionJoinConfig callable → CDN-load Web Meeting SDK → init into a
 * local container → join → auto-start camera/mic via toolbar aria-label clicks
 * (the Web SDK has no public startVideo API for self). The standalone page is
 * intentionally left untouched — it remains the my-sessions beta entry point.
 *
 * Web only. On native the tile renders a placeholder (Meeting SDK for RN needs
 * a dev-client build; see docs/ZOOM_MEETING_SDK_SETUP.md "Future-only").
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, ActivityIndicator } from 'react-native';
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

// Keep in sync with app/join/[sessionInstanceId].tsx and
// docs/ZOOM_MEETING_SDK_SETUP.md. Pinned 3.x release.
const ZOOM_SDK_VERSION = '3.11.2';
const ZOOM_SDK_BASE = `https://source.zoom.us/${ZOOM_SDK_VERSION}`;

export type JoinConfig = {
  meetingNumber: string;
  signature: string;
  sdkKey: string;
  userName: string;
  userEmail: string;
  password: string;
  role: 0 | 1;
  zak: string | null;
};

// ── CDN loader (web only) ────────────────────────────────────────────────────

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

// ── Toolbar auto-click (Web SDK has no public self startVideo API) ──────────

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

function autoStartMediaViaToolbar(container: HTMLElement, startCamera: boolean): void {
  if (typeof document === 'undefined') return;
  let videoClicked = !startCamera;
  let audioClicked = false;
  let attempts = 0;
  const MAX_ATTEMPTS = 32; // 32 × 250ms = 8s window

  const tick = () => {
    attempts += 1;
    const root = container;

    if (!videoClicked) {
      const camBtn = findToolbarButton(
        root,
        ['video off', 'start video', 'start my video', 'turn on camera', 'start camera'],
        ['video on', 'stop video', 'stop my video', 'turn off camera'],
      );
      if (camBtn) {
        try {
          camBtn.click();
          videoClicked = true;
        } catch {}
      }
    }

    if (!audioClicked) {
      const audBtn = findToolbarButton(
        root,
        ['headphone', 'join audio', 'unmute', 'turn on microphone', 'connect audio'],
        ['mute meeting', 'mute my', 'mute microphone', 'turn off microphone'],
      );
      if (audBtn) {
        try {
          audBtn.click();
          audioClicked = true;
        } catch {}
      }
    }

    if ((videoClicked && audioClicked) || attempts >= MAX_ATTEMPTS) return;
    setTimeout(tick, 250);
  };

  setTimeout(tick, 250);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LiveViewZoomTile({
  sessionInstanceId,
  variant,
  autoStartCamera = true,
  joinLabel,
}: {
  sessionInstanceId: string;
  variant: 'pip' | 'pane';
  /** Auto-click Zoom's start-video button after join (member PiP default). */
  autoStartCamera?: boolean;
  joinLabel?: string;
}) {
  const [phase, setPhase] = useState<'idle' | 'joining' | 'in-meeting' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const clientRef = useRef<any>(null);

  // Leave the meeting when the tile unmounts so the participant doesn't
  // linger as a ghost in the room.
  useEffect(() => {
    return () => {
      const client = clientRef.current;
      if (client) {
        try {
          client.leaveMeeting?.();
        } catch {}
        clientRef.current = null;
      }
    };
  }, []);

  const handleJoin = useCallback(async () => {
    if (Platform.OS !== 'web') return;
    setPhase('joining');
    setErrorMsg('');

    // iOS Safari: getUserMedia must run inside the click's gesture window.
    // Pre-warm permission, then release tracks for Zoom to claim.
    let prewarmStream: MediaStream | null = null;
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        prewarmStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      }
    } catch (err) {
      console.warn('[SessionZoomTile] camera/mic pre-warm failed:', err);
    }

    try {
      const getConfig = httpsCallable<{ sessionInstanceId: string }, JoinConfig>(
        functions,
        'getEmbeddedSessionJoinConfig',
      );
      const [{ data: joinConfig }, ZoomMtgEmbedded] = await Promise.all([
        getConfig({ sessionInstanceId }),
        loadZoomEmbedded(),
      ]);

      if (prewarmStream) {
        try {
          prewarmStream.getTracks().forEach((t) => t.stop());
        } catch {}
        prewarmStream = null;
      }

      const root = containerRef.current;
      if (!root) throw new Error('Zoom container not mounted');

      const client = ZoomMtgEmbedded.createClient();
      clientRef.current = client;

      const size =
        variant === 'pip' ? { width: 210, height: 128 } : { width: 640, height: 420 };

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
          video: { isResizable: false, viewSizes: { default: size } },
          meetingInfo: [],
        },
      });

      await client.join({
        sdkKey: joinConfig.sdkKey,
        signature: joinConfig.signature,
        meetingNumber: joinConfig.meetingNumber,
        password: joinConfig.password || '',
        userName: joinConfig.userName || 'GoArrive',
        userEmail: joinConfig.userEmail || '',
        ...(joinConfig.zak ? { zak: joinConfig.zak } : {}),
      });

      autoStartMediaViaToolbar(root, autoStartCamera);
      setPhase('in-meeting');
    } catch (err: any) {
      if (prewarmStream) {
        try {
          prewarmStream.getTracks().forEach((t) => t.stop());
        } catch {}
      }
      console.error('[SessionZoomTile] join failed:', err);
      setErrorMsg(err?.reason || err?.message || 'Could not join the video session.');
      setPhase('error');
    }
  }, [sessionInstanceId, variant, autoStartCamera]);

  const isPip = variant === 'pip';

  if (Platform.OS !== 'web') {
    return (
      <View style={[s.frame, isPip ? s.framePip : s.framePane]}>
        <Text style={s.placeholderText}>Live video is available on web for now.</Text>
      </View>
    );
  }

  return (
    <View style={[s.frame, isPip ? s.framePip : s.framePane]}>
      {/* Zoom mounts its Component View into this div. */}
      <div
        ref={containerRef as any}
        style={{ width: '100%', height: '100%', overflow: 'hidden' }}
      />
      {phase !== 'in-meeting' && (
        <View style={s.overlay}>
          {phase === 'joining' ? (
            <>
              <ActivityIndicator color={GOLD} />
              <Text style={s.overlayText}>Connecting…</Text>
            </>
          ) : phase === 'error' ? (
            <>
              <Text style={s.errorText} numberOfLines={isPip ? 2 : 4}>
                {errorMsg}
              </Text>
              <Pressable style={s.joinBtn} onPress={handleJoin}>
                <Text style={s.joinBtnText}>Retry</Text>
              </Pressable>
            </>
          ) : (
            <Pressable style={s.joinBtn} onPress={handleJoin}>
              <Text style={s.joinBtnText}>
                {joinLabel || (isPip ? 'Turn Camera On' : 'Join Video')}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  frame: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    overflow: 'hidden',
  },
  framePip: {
    width: 214,
    height: 132,
  },
  framePane: {
    flex: 1,
    minHeight: 320,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 10,
    backgroundColor: 'rgba(14,17,23,0.85)',
  },
  overlayText: {
    color: TEXT_SECONDARY,
    fontFamily: FB,
    fontSize: 12,
  },
  errorText: {
    color: RED,
    fontFamily: FB,
    fontSize: 12,
    textAlign: 'center',
  },
  joinBtn: {
    backgroundColor: GOLD,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  joinBtnText: {
    color: '#0E1117',
    fontFamily: FH,
    fontSize: 13,
    fontWeight: '700',
  },
  placeholderText: {
    color: TEXT_SECONDARY,
    fontFamily: FB,
    fontSize: 12,
    textAlign: 'center',
    padding: 12,
  },
});
