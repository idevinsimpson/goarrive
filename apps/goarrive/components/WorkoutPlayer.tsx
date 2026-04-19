/**
 * WorkoutPlayer — Coach-in-your-pocket workout execution engine
 *
 * Phase 3 upgrade: Full special block rendering
 *   - Intro: full-screen cinematic welcome with logo + workout name
 *   - Outro: full-screen completion celebration
 *   - Demo: preview upcoming multi-movement block with thumbnails
 *   - Transition: instruction card with countdown
 *   - Water Break: hydration screen with countdown
 *   - Exercise: video playback with timer, controls, next-up bar
 *
 * Layout (WORK phase):
 *   - GoArrive logo centered at top (on black background)
 *   - Movement name (left) + countdown timer (right) on same row
 *   - Video in the middle with small side margins
 *   - Controls hidden by default — appear on video tap, auto-hide after 3s
 *   - NEXT UP bar at the bottom
 *
 * Decomposed into hooks: useWorkoutFlatten, useWorkoutTimer, useMediaPrefetch,
 * useMovementHydrate, useMovementSwap, usePlaybackSpeed
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  Dimensions,
  Image,
  TextInput,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import MovementVideoControls from './MovementVideoControls';
import { Icon } from './Icon';
import { useWakeLock } from '../lib/useWakeLock';
import { useWorkoutFlatten } from '../hooks/useWorkoutFlatten';
import { useWorkoutTimer } from '../hooks/useWorkoutTimer';
import { useMediaPrefetch } from '../hooks/useMediaPrefetch';
import { useMovementSwap } from '../hooks/useMovementSwap';
import { useMovementHydrate } from '../hooks/useMovementHydrate';
import { usePlaybackSpeed } from '../hooks/usePlaybackSpeed';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useWorkoutTTS } from '../hooks/useWorkoutTTS';
import { FB, FH } from '../lib/theme';

// ── Constants ───────────────────────────────────────────────────────────────
// How many seconds before a timed phase ends should the visual switch to the
// next timeline item. Aligns with the spoken "3, 2, 1" countdown cue at
// timeLeft === 3 so the screen and audio reveal together.
const REVEAL_LEAD_SECONDS = 3.5;

// ── Types ──────────────────────────────────────────────────────────────────
interface WorkoutPlayerProps {
  visible: boolean;
  workout: any;
  onClose: () => void;
  onComplete: () => void;
  onSwapLog?: (swaps: any[]) => void;
  isPreview?: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function WorkoutPlayer({
  visible,
  workout,
  onClose,
  onComplete,
  onSwapLog,
  isPreview = false,
}: WorkoutPlayerProps) {
  // ── Hooks ────────────────────────────────────────────────────────────
  const flatFromBlocks = useWorkoutFlatten(workout);
  const hydratedMovements = useMovementHydrate(flatFromBlocks);
  const [flatOverride, setFlatOverride] = useState<any[] | null>(null);
  const flatMovements = flatOverride || hydratedMovements;

  const timer = useWorkoutTimer({ flatMovements });

  const {
    phase, currentIndex, timeLeft, swapSide, isPaused,
    current, next, total, isRepBased, progressPct, isSpecialPhase,
    handleStart, handlePauseResume, handleSkip, handleRepDone,
  } = timer;

  useWakeLock(phase !== 'ready' && phase !== 'complete');
  useMediaPrefetch(
    flatMovements,
    currentIndex,
    phase === 'work',
    phase === 'rest',
    false,
    phase === 'ready',
  );

  // ── Offline resilience ─────────────────────────────
  const { isOffline, queueSize } = useNetworkStatus();

  // ── Mute toggle ───────────────────────────────────────
  const [isMuted, setIsMuted] = useState(false);

  // ── Voice coaching ────────────────────────────────────
  const { stopAllAudio } = useWorkoutTTS({
    phase,
    current,
    next,
    isMuted,
    isPaused,
    currentIndex,
    total,
    timeLeft,
    currentDuration: current?.duration ?? 0,
  });

  // ── Movement swap ─────────────────────────────
  const {
    showSwap, alternatives, loadingAlts,
    closeSwap, swapMovement, getSwapLog,
  } = useMovementSwap(flatMovements, currentIndex, setFlatOverride);
  const [swapReason, setSwapReason] = useState('');

  // ── Landscape / wide-screen detection ─────────────────────────────────
  const { width: winW, height: winH } = useWindowDimensions();
  const dimsValid = winW > 0 && winH > 0;
  const isLandscape = dimsValid ? winW > winH : false;
  const isTablet = dimsValid ? Math.min(winW, winH) >= 600 : false;
  // 9:16 player canvas — single source of truth for layout. The frame is the
  // largest 9:16 portrait rectangle that fits inside the viewport. Anything
  // outside the frame is the black `portraitLockOuter` backdrop (pillar-box on
  // landscape, letterbox on tall portrait). All slots — logo, title/timer,
  // media, next-up — live inside this frame so module positions stay locked
  // regardless of viewport ratio.
  const isWideScreen = dimsValid && winW > 500;
  let frameW = 0;
  let frameH = 0;
  if (dimsValid) {
    // Width-bound first (typical phone is taller than 9:16 → letterbox).
    frameW = isWideScreen ? Math.min(winW, winH * (9 / 16)) : winW;
    frameH = Math.min(winH, frameW * (16 / 9));
    // If the height clamp shrank us, also shrink width so frame stays 9:16.
    frameW = frameH * (9 / 16);
  }

  // Frame-relative scale. The whole player is treated as a single 9:16 video
  // composition: every internal module (logo, title, timer box, media,
  // next-up, fonts, gaps) is sized as a multiple of this scale so the entire
  // composition grows or shrinks together. Base width is a typical small
  // phone (360px) — at 360 the values match the original phone-tuned design;
  // on tablets/desktops the frame and everything inside scale up uniformly.
  const BASE_FRAME_W = 360;
  const frameScale = dimsValid && frameW > 0 ? frameW / BASE_FRAME_W : 1;
  const fs = (n: number) => n * frameScale;

  // Movement media is always rendered at a fixed 4:5 aspect ratio. We compute
  // the largest 4:5 box that fits inside the available media slot — width is
  // bounded by frameW (minus a small horizontal pad) and height is bounded by
  // the leftover frame height after the surrounding fixed slots take their
  // space. If vertical room is tight, the surrounding layout (logo / title /
  // next-up slots) is what flexes — the media stays exactly 4:5.
  // Slot heights and gaps are derived from frameScale so they grow with the
  // frame; without scaling, modules stay phone-sized inside a larger canvas.
  const SLOT_LOGO_H = fs(56);
  const SLOT_TITLE_H = fs(112);
  const SLOT_NEXTUP_H = fs(64);
  const SLOT_GAP_LOGO = fs(4); // logo → title row
  const SLOT_GAP_TITLE = fs(12); // title row → media (must always be visible)
  const SLOT_GAP_MEDIA = fs(12); // media → next-up (must always be visible)
  // Bottom pad accounts for iOS home indicator / PWA chrome — those are
  // physical safe-areas, not composition; keep raw px.
  const SLOT_BOTTOM_PAD = Platform.select({ ios: 24, android: 8, web: 8, default: 8 }) as number;
  const mediaAvailH = Math.max(
    180,
    (frameH || 600) - SLOT_LOGO_H - SLOT_GAP_LOGO - SLOT_TITLE_H - SLOT_GAP_TITLE
      - SLOT_GAP_MEDIA - SLOT_NEXTUP_H - SLOT_BOTTOM_PAD,
  );
  const mediaAvailW = Math.max(160, frameW || 360);
  let _mediaW = mediaAvailW;
  let _mediaH = _mediaW * (5 / 4);
  if (_mediaH > mediaAvailH) {
    _mediaH = mediaAvailH;
    _mediaW = _mediaH * (4 / 5);
  }
  const mediaInnerSize = { width: _mediaW, height: _mediaH };

  // ── Video ref ────────────────────────────────
  const videoRef = useRef<any>(null);

  // Track every mounted <Video> so we can imperatively pause/play them all on
  // isPaused changes. The declarative `shouldPlay` prop alone doesn't reliably
  // pause an already-playing expo-av Video on web, so this imperative mirror
  // is what actually stops the movement loop when the user taps Pause.
  const videosRef = useRef<Set<any>>(new Set());
  const isPausedRef = useRef(isPaused);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  const registerVideo = useCallback((el: any | null) => {
    if (!el) return;
    videosRef.current.add(el);
    // Freshly-mounted Videos default to playing; if we're paused right now
    // (e.g. Skip while paused swapped in a new video), pause it immediately.
    if (isPausedRef.current) el.pauseAsync?.().catch(() => {});
  }, []);

  // Detached from `phase` on purpose: the displayed video must not restart
  // when the timer rolls work→rest or rest→work. Playback state is driven by
  // the user's pause/resume only; the imperative mirror handles the toggle
  // reliably on web across every mounted Video (intro/outro/transition/
  // waterBreak/shared work-rest layers).
  useEffect(() => {
    for (const el of videosRef.current) {
      if (isPaused) el?.pauseAsync?.().catch(() => {});
      else el?.playAsync?.().catch(() => {});
    }
  }, [isPaused]);

  // ── Tap-to-show controls ──────────────────────────────
  const [showControls, setShowControls] = useState(false);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [videoReady, setVideoReady] = useState(false);

  // ── Playback speed ────────────────────────────
  const { speed } = usePlaybackSpeed(current?.id);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.setRateAsync?.(speed, true).catch(() => {});
  }, [speed, currentIndex, videoReady]);

  const handleVideoTap = useCallback(() => {
    setShowControls(prev => {
      const next = !prev;
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      if (next) {
        controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
      }
      return next;
    });
  }, []);

  // Reset the auto-hide timer so the overlay stays visible while the user is
  // actively interacting (e.g. repeated Skip taps). Phase/movement changes must
  // NOT force-hide the overlay — it should fade only when the user stops.
  const extendControlsTimer = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  const handleSkipFromOverlay = useCallback(() => {
    // Cancel any audio from the skipped-from state BEFORE advancing. This
    // stops the in-flight MP3/voice clip and clears pending deferred cues so
    // they don't overlap with the new skip target's audio.
    stopAllAudio();
    handleSkip();
    extendControlsTimer();
  }, [handleSkip, extendControlsTimer, stopAllAudio]);

  const handlePauseResumeFromOverlay = useCallback(() => {
    handlePauseResume();
    extendControlsTimer();
  }, [handlePauseResume, extendControlsTimer]);

  const handleRepDoneFromOverlay = useCallback(() => {
    handleRepDone();
    extendControlsTimer();
  }, [handleRepDone, extendControlsTimer]);

  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, []);

  // ── Format time ───────────────────────────────────────────────────────
  // Ceil so a fractional Skip pre-entry (e.g. timeLeft=3.5) still displays as
  // a clean integer countdown (4,3,2,1) instead of "3.5, 2.5, 1.5".
  const formatTime = (sec: number): string => {
    const total = Math.max(0, Math.ceil(sec));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}`;
  };

  // Dominant-digit timer sizing. Char-count tiers are scaled by frameScale so
  // the timer text grows with the player frame. Box is also scaled (see
  // scaledTimerBox below) so the box/font ratio stays the same on every size.
  const getTimerFontStyle = (
    text: string,
  ): { fontSize: number; lineHeight: number; letterSpacing: number } => {
    const len = (text || '').length;
    if (len <= 2) return { fontSize: fs(96), lineHeight: fs(96), letterSpacing: fs(-2) };
    if (len === 3) return { fontSize: fs(64), lineHeight: fs(68), letterSpacing: fs(-1) };
    return { fontSize: fs(48), lineHeight: fs(52), letterSpacing: 0 };
  };

  // Auto-shrink the movement-name font so any reasonable name fits the title
  // module. Tiers are scaled by frameScale so names grow with the frame.
  const getNameFontStyle = (text: string): { fontSize: number; lineHeight: number } => {
    const len = (text || '').length;
    if (len <= 12) return { fontSize: fs(40), lineHeight: fs(44) };
    if (len <= 20) return { fontSize: fs(32), lineHeight: fs(36) };
    if (len <= 32) return { fontSize: fs(26), lineHeight: fs(30) };
    if (len <= 48) return { fontSize: fs(22), lineHeight: fs(26) };
    return { fontSize: fs(18), lineHeight: fs(22) };
  };

  // Frame-derived dimensions for every module that lives inside the player
  // frame. Apply these inline as override styles so the StyleSheet baselines
  // (phone-tuned) are replaced by frame-relative pixel values.
  const scaledLogoImg = { width: fs(260), height: fs(52) };
  const scaledTimerBox = {
    width: fs(132),
    height: fs(112),
    borderRadius: fs(12),
  };
  const scaledNextUpBar = {
    borderRadius: fs(12),
    paddingVertical: fs(8),
    paddingHorizontal: fs(12),
    gap: fs(12),
  };
  const scaledNextUpLabelFs = fs(11);
  const scaledNextUpNameFs = fs(15);
  const scaledNextUpMetaFs = fs(11);
  const scaledNextUpThumb = { width: fs(40), height: fs(40), borderRadius: fs(8) };
  const scaledTitlePadH = fs(8);

  // Title-slot label fonts (scale with frame).
  const scaledLabels = {
    superset: fs(16),
    restPhase: fs(18),
    restNextName: fs(28),
    demoBlockTitle: fs(22),
    waterBreakLabel: fs(20),
    transitionInline: fs(13),
    phaseLabel: fs(16),
  };

  const handleFinish = () => {
    if (onSwapLog) {
      const swaps = getSwapLog();
      if (swaps.length > 0) onSwapLog(swaps);
    }
    onComplete();
  };

  // ── Count exercise steps for progress display ─────────────────────
  const exerciseSteps = flatMovements.filter(f => f.stepType === 'exercise');
  const exerciseIndex = exerciseSteps.indexOf(current as any);
  const exerciseTotal = exerciseSteps.length;

  // ── Single source of truth: which timeline item should be on screen now? ───
  // Reveal-ahead pattern: the displayed item == the "current upcoming work item."
  // It switches to the next timeline item at REVEAL_LEAD_SECONDS before the current
  // phase ends, then stays through any rest + the next item's content, until 3.5s
  // before that next item ends. Same rule covers movement→movement, movement→rest,
  // movement→water break, movement→demo, movement→grab equipment.
  //
  // Exception: swap-sides movements stay on the current movement during the L-side
  // lookahead (the R side of the same movement is coming next, not a new item).
  const { activeVideoUrl, activeThumbUrl } = useMemo<{
    activeVideoUrl: string | null;
    activeThumbUrl: string | null;
  }>(() => {
    if (!current) return { activeVideoUrl: null, activeThumbUrl: null };

    // Resolve a timeline item to a displayable {video, thumb} pair, falling back
    // to the next exercise's media if the item itself has none (e.g. waterBreak,
    // grabEquipment, transition often carry no media of their own).
    const pickAsset = (item: any, indexOfItem: number) => {
      if (!item) return { activeVideoUrl: null, activeThumbUrl: null };
      if (item.videoUrl || item.thumbnailUrl) {
        return {
          activeVideoUrl: item.videoUrl ?? null,
          activeThumbUrl: item.thumbnailUrl ?? null,
        };
      }
      for (let i = indexOfItem + 1; i < flatMovements.length; i++) {
        const m = flatMovements[i];
        if (m.stepType === 'exercise' && (m.videoUrl || m.thumbnailUrl)) {
          return { activeVideoUrl: m.videoUrl ?? null, activeThumbUrl: m.thumbnailUrl ?? null };
        }
      }
      return { activeVideoUrl: null, activeThumbUrl: null };
    };

    let displayItem: any = current;
    let displayIndex = currentIndex;

    const stayingOnSameMovement =
      phase === 'work' && current?.swapSides === true && swapSide === 'L';

    const isTimedRevealPhase =
      phase === 'work' || phase === 'transition' || phase === 'waterBreak'
      || phase === 'grabEquipment' || phase === 'demo';

    if (phase === 'rest' && next) {
      // Rest is the bridge between current and next; show next throughout.
      displayItem = next;
      displayIndex = currentIndex + 1;
    } else if (
      isTimedRevealPhase
      && !isRepBased
      && !stayingOnSameMovement
      && timeLeft > 0
      && timeLeft <= REVEAL_LEAD_SECONDS
      && next
    ) {
      // Last 3.5s of any timed phase: preview the next timeline item.
      displayItem = next;
      displayIndex = currentIndex + 1;
    }

    return pickAsset(displayItem, displayIndex);
  }, [phase, timeLeft, current, next, currentIndex, isRepBased, swapSide, flatMovements]);

  // ── Double-buffered video layers, with eager preload ─────────────────
  // We render up to two Video elements at once: the one being shown, and
  // the upcoming one mounted invisibly so it has time to fully decode
  // before the reveal point. When activeVideoUrl flips at the 3.5s mark,
  // the upcoming layer is already ready, so the visibility swap is
  // instantaneous — no poster flash, no waiting on load.
  //
  // displayedUrl is the layer that's actually painted on screen. It only
  // changes once a new layer reports ready, so the outgoing video keeps
  // playing visibly until the incoming one can take over without a gap.
  const preloadVideoUrl = useMemo<string | null>(() => {
    // Walk forward until we find an exercise video URL that differs from
    // the active one — that's what should be loading in the background.
    if (!activeVideoUrl) return null;
    let foundActive = false;
    for (let i = 0; i < flatMovements.length; i++) {
      const m = flatMovements[i];
      const url = m?.videoUrl;
      if (!url) continue;
      if (foundActive && url !== activeVideoUrl) return url;
      if (url === activeVideoUrl) foundActive = true;
    }
    return null;
  }, [activeVideoUrl, flatMovements]);

  const [videoLayers, setVideoLayers] = useState<Array<{ url: string; ready: boolean }>>([]);
  const [displayedUrl, setDisplayedUrl] = useState<string | null>(null);

  // Mount the active layer if not already in the stack.
  useEffect(() => {
    if (!activeVideoUrl) return;
    setVideoLayers((prev) => {
      if (prev.some((l) => l.url === activeVideoUrl)) return prev;
      return [...prev, { url: activeVideoUrl, ready: false }];
    });
  }, [activeVideoUrl]);

  // Mount the preload layer ahead of time so it's decoded by reveal.
  useEffect(() => {
    if (!preloadVideoUrl) return;
    setVideoLayers((prev) => {
      if (prev.some((l) => l.url === preloadVideoUrl)) return prev;
      return [...prev, { url: preloadVideoUrl, ready: false }];
    });
  }, [preloadVideoUrl]);

  const handleLayerReady = useCallback((url: string) => {
    setVideoLayers((prev) => prev.map((l) => (l.url === url ? { ...l, ready: true } : l)));
  }, []);

  // Promote the active layer to displayed as soon as it's ready. Until
  // then, displayedUrl holds the previous URL so the outgoing layer stays
  // visible. Initial mount: displayed flips from null → active on first ready.
  useEffect(() => {
    if (!activeVideoUrl) {
      setDisplayedUrl(null);
      return;
    }
    if (displayedUrl === activeVideoUrl) return;
    const activeLayer = videoLayers.find((l) => l.url === activeVideoUrl);
    if (activeLayer?.ready) setDisplayedUrl(activeVideoUrl);
  }, [activeVideoUrl, displayedUrl, videoLayers]);

  // Prune layers we no longer need: keep only active, preload, and the
  // currently displayed (in case displayed is briefly different from active
  // during a transition that's about to complete).
  useEffect(() => {
    setVideoLayers((prev) => {
      const keep = new Set<string>();
      if (activeVideoUrl) keep.add(activeVideoUrl);
      if (preloadVideoUrl) keep.add(preloadVideoUrl);
      if (displayedUrl) keep.add(displayedUrl);
      const next = prev.filter((l) => keep.has(l.url));
      return next.length === prev.length ? prev : next;
    });
  }, [activeVideoUrl, preloadVideoUrl, displayedUrl]);

  // videoReady drives the poster fallback — true once anything is on screen.
  useEffect(() => { setVideoReady(displayedUrl !== null); }, [displayedUrl]);

  // Stable {uri} object per URL so expo-av doesn't re-evaluate the source
  // on every render of the same layer.
  const sourceCacheRef = useRef<Map<string, { uri: string }>>(new Map());
  const getVideoSource = useCallback((url: string) => {
    let cached = sourceCacheRef.current.get(url);
    if (!cached) {
      cached = { uri: url };
      sourceCacheRef.current.set(url, cached);
    }
    return cached;
  }, []);

  // ── Shared header component ───────────────────────────────────────
  const renderHeader = (showProgress = true) => (
    <>
      <View style={st.header}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="close" size={28} color="#8A95A3" />
        </TouchableOpacity>
        <Text style={st.workoutName} numberOfLines={1}>
          {workout?.name ?? 'Workout'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          {isOffline && (
            <View style={st.offlineBadge}>
              <Icon name="wifi-off" size={12} color="#F59E0B" />
              <Text style={st.offlineBadgeText}>Offline{queueSize > 0 ? ` (${queueSize})` : ''}</Text>
            </View>
          )}
          <TouchableOpacity
            onPress={() => setIsMuted(m => !m)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Icon name={isMuted ? 'volume-x' : 'volume-2'} size={22} color={isMuted ? '#F59E0B' : '#8A95A3'} />
          </TouchableOpacity>
          {showProgress && (
            <Text style={st.progressText}>
              {currentIndex + 1}/{total}
            </Text>
          )}
        </View>
      </View>
      {showProgress && (
        <View style={st.progressBar}>
          <View style={[st.progressFill, { width: `${progressPct}%` }]} />
        </View>
      )}
    </>
  );

  // ── Shared next-up bar ────────────────────────────────────────────
  // Single-row layout so the bar is short and the media slot can be tall:
  //   [ NEXT UP | name + meta (flex) | thumb ]
  const renderNextUp = () => {
    if (!next) return null;
    const nextLabel = next.stepType === 'exercise' ? next.name
      : next.originalBlockType || next.name;
    return (
      <View style={[st.nextUpBar, scaledNextUpBar]}>
        <Text style={[st.nextUpLabel, { fontSize: scaledNextUpLabelFs }]}>NEXT UP</Text>
        <View style={st.nextUpInfo}>
          <Text style={[st.nextUpName, { fontSize: scaledNextUpNameFs }]} numberOfLines={1}>{nextLabel}</Text>
          <Text style={[st.nextUpMeta, { fontSize: scaledNextUpMetaFs }]} numberOfLines={1}>
            {next.blockName}{next.duration ? ` · ${next.duration}s` : ''}
          </Text>
        </View>
        {next.thumbnailUrl ? (
          <Image source={{ uri: next.thumbnailUrl }} style={[st.nextUpThumb, scaledNextUpThumb]} resizeMode="cover" />
        ) : (
          <View style={[st.nextUpThumb, scaledNextUpThumb, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A2035' }]}>
            <Icon name={
              next.stepType === 'waterBreak' ? 'droplet' :
              next.stepType === 'transition' ? 'arrow-right' :
              next.stepType === 'grabEquipment' ? 'briefcase' :
              next.stepType === 'demo' ? 'eye' :
              'play-circle'
            } size={Math.round(fs(20))} color="#3A4050" />
          </View>
        )}
      </View>
    );
  };

  // ── Shared slot helpers ──────────────────────────────────────────
  // Every "in-workout" phase (work, rest, transition, waterBreak, demo,
  // grabEquipment, swap) uses the same vertical structure so modules stay
  // in fixed positions across phase changes:
  //   header → logoSlot → titleTimerSlot → mediaSlot → nextUpSlot
  // Each slot has a stable height/flex; only the content inside changes.
  const renderLogoSlot = () => (
    <View style={[st.logoSlot, { height: SLOT_LOGO_H, marginBottom: SLOT_GAP_LOGO }]}>
      <Image
        source={require('../assets/logo.png')}
        style={[st.slotLogo, scaledLogoImg]}
        resizeMode="contain"
      />
    </View>
  );

  // Title/timer + next-up rows are width-matched to the media so the timer's
  // right edge and the title module's left edge sit flush with the media's
  // left/right edges respectively. Without this, the row spans full frame
  // width and the timer can overhang past the media on letterboxed phones.
  const renderTitleTimerSlot = (
    title: React.ReactNode,
    timer: React.ReactNode | null,
  ) => (
    <View style={[st.titleTimerSlot, { height: SLOT_TITLE_H, marginBottom: SLOT_GAP_TITLE, width: _mediaW }]}>
      <View style={[st.titleColumn, { height: SLOT_TITLE_H, paddingHorizontal: scaledTitlePadH }]}>{title}</View>
      {timer ? <View style={st.timerColumn}>{timer}</View> : null}
    </View>
  );

  const renderNextUpSlot = (content: React.ReactNode | null) => (
    <View style={[st.nextUpSlot, { height: SLOT_NEXTUP_H, marginTop: SLOT_GAP_MEDIA, width: _mediaW }]}>{content}</View>
  );

  // Timer box helpers — keep box and font scale in lockstep so the digit
  // never crops or floats on a larger frame. Used by every phase that shows
  // a countdown (work/rest/demo/transition/grabEquipment/waterBreak/swap/outro).
  const renderGoldTimer = (text: string) => (
    <View style={[st.goldTimerBox, scaledTimerBox]}>
      <Text style={[st.goldTimerText, getTimerFontStyle(text)]}>{text}</Text>
    </View>
  );
  const renderRestTimer = (text: string) => (
    <View style={[st.restTimerBox, scaledTimerBox]}>
      <Text style={[st.restTimerText, getTimerFontStyle(text)]}>{text}</Text>
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <View style={st.portraitLockOuter}>
      <View style={[st.container, dimsValid && { width: frameW, height: frameH, maxWidth: frameW }]}>
        {/* ── READY state — Block overview grid ─────────────────── */}
        {phase === 'ready' && (() => {
          const exerciseBlocks = (workout?.blocks || []).filter(
            (b: any) => !['Intro', 'Outro', 'Demo', 'Transition', 'Water Break', 'Grab Equipment'].includes(b.type || '')
          );
          return (
            <>
              {renderHeader(false)}
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 100 }}
                showsVerticalScrollIndicator={false}
              >
                {exerciseBlocks.map((block: any, bi: number) => {
                  const mvs = (block.movements || []).filter(
                    (mv: any) => mv.showOnPreview !== false
                  );
                  if (mvs.length === 0) return null;
                  const rounds = block.rounds ?? block.sets ?? 1;
                  const blockLabel = block.label || block.name || `Block ${bi + 1}`;
                  return (
                    <View key={bi} style={{ marginBottom: 16 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                        <View style={st.readyBlockBadge}>
                          <Text style={st.readyBlockBadgeText}>{bi + 1}</Text>
                        </View>
                        <Text style={st.readyBlockLabel}>{blockLabel}</Text>
                        {rounds > 1 && (
                          <Text style={st.readyBlockRounds}>{rounds}×</Text>
                        )}
                      </View>
                      <View style={st.readyThumbGrid}>
                        {mvs.map((mv: any, mi: number) => (
                          <View key={mi} style={st.readyThumbCell}>
                            {mv.thumbnailUrl ? (
                              <Image
                                source={{ uri: mv.thumbnailUrl }}
                                style={st.readyThumbImage}
                                resizeMode="cover"
                              />
                            ) : (
                              <View style={[st.readyThumbImage, { backgroundColor: '#1A2035', justifyContent: 'center', alignItems: 'center' }]}>
                                <Icon name="play-circle" size={20} color="#3A4050" />
                              </View>
                            )}
                            <Text style={st.readyThumbName} numberOfLines={1}>{mv.movementName || mv.name || 'Movement'}</Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              {/* Bottom: logo + play button */}
              <View style={st.readyFooter}>
                <Image
                  source={require('../assets/logo.png')}
                  style={{ width: 140, height: 46, marginBottom: 12 }}
                  resizeMode="contain"
                />
                <TouchableOpacity style={st.readyPlayBtn} onPress={handleStart}>
                  <Icon name="play" size={32} color="#0E1117" />
                </TouchableOpacity>
              </View>
            </>
          );
        })()}

        {/* ── INTRO — Full-screen cinematic welcome ────────────── */}
        {phase === 'intro' && current && (() => {
          // Use the intro block's own video, falling back to first exercise
          const firstExercise = flatMovements.find((f: any) => f.stepType === 'exercise');
          const introVideoUrl = current.videoUrl || firstExercise?.videoUrl;
          const introThumbUrl = firstExercise?.thumbnailUrl;
          return (
            <View style={st.introSplitContainer}>
              {/* Left: video panel */}
              <View style={st.introVideoPanel}>
                {introVideoUrl ? (
                  <Video
                    ref={registerVideo}
                    source={{ uri: introVideoUrl }}
                    resizeMode={ResizeMode.COVER}
                    isLooping
                    shouldPlay={!isPaused}
                    isMuted
                    style={StyleSheet.absoluteFillObject}
                    videoStyle={
                      Platform.OS === 'web'
                        ? ({ width: '100%', height: '100%', objectFit: 'cover' } as any)
                        : undefined
                    }
                  />
                ) : introThumbUrl ? (
                  <Image source={{ uri: introThumbUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
                ) : (
                  <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#1A2035' }]} />
                )}
              </View>
              {/* Right: branding panel */}
              <View style={st.introBrandPanel}>
                <Image
                  source={require('../assets/logo.png')}
                  style={st.introLogo}
                  resizeMode="contain"
                />
                <Text style={st.introBlockLabel}>
                  {current.name || current.label || 'WARM-UP & STRETCH'}
                </Text>
                {renderGoldTimer(String(Math.max(0, Math.ceil(timeLeft))))}
              </View>
            </View>
          );
        })()}

        {/* ── OUTRO — Cinematic completion ────────────────────── */}
        {phase === 'outro' && current && (
          <View style={st.introOutroContainer}>
            {current.videoUrl ? (
              <Video
                ref={registerVideo}
                source={{ uri: current.videoUrl }}
                resizeMode={ResizeMode.COVER}
                isLooping
                shouldPlay={!isPaused}
                isMuted
                style={StyleSheet.absoluteFillObject}
                videoStyle={
                  Platform.OS === 'web'
                    ? ({ width: '100%', height: '100%', objectFit: 'cover' } as any)
                    : undefined
                }
              />
            ) : null}
            <View style={[st.introOutroGradient, current.videoUrl && { backgroundColor: 'rgba(14,17,23,0.6)' }]}>
              <Image
                source={require('../assets/logo.png')}
                style={{ width: 280, height: 90, marginBottom: 16 }}
                resizeMode="contain"
              />
              <Text style={st.outroTitle}>WORKOUT</Text>
              {renderGoldTimer(String(Math.max(0, Math.ceil(timeLeft))))}
            </View>
          </View>
        )}

        {/* ── DEMO — Preview upcoming movements ───────────────── */}
        {phase === 'demo' && current && (() => {
          const demos = current.demoMovements || [];
          const cols = demos.length <= 4 ? 2 : 3;
          return (
            <View style={[st.workContainer, webSafeBottomStyle]}>
              {renderLogoSlot()}
              {renderTitleTimerSlot(
                <Text style={[st.demoBlockTitle, { fontSize: scaledLabels.demoBlockTitle }]} numberOfLines={2}>{current.name}</Text>,
                renderGoldTimer(String(Math.max(0, Math.ceil(timeLeft)))),
              )}
              <View style={st.mediaSlot}>
                <View style={[st.demoGrid, mediaInnerSize]}>
                  {demos.map((mv: any, i: number) => (
                    <View key={i} style={[st.demoGridCell, { width: `${Math.floor(100 / cols) - 2}%` as any }]}>
                      {mv.thumbnailUrl ? (
                        <Image source={{ uri: mv.thumbnailUrl }} style={st.demoGridImage} resizeMode="cover" />
                      ) : (
                        <View style={[st.demoGridImage, { backgroundColor: '#1A2035', justifyContent: 'center', alignItems: 'center' }]}>
                          <Icon name="play-circle" size={24} color="#3A4050" />
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </View>
              {renderNextUpSlot(null)}
            </View>
          );
        })()}

        {/* ── TRANSITION — Full-media with overlay text ───────── */}
        {phase === 'transition' && current && (
          <View style={[st.workContainer, webSafeBottomStyle]}>
            {renderLogoSlot()}
            {renderTitleTimerSlot(
              <>
                <Text style={[st.restPhaseLabel, { color: '#94A3B8', fontSize: scaledLabels.restPhase }]}>TRANSITION</Text>
                <Text style={[st.restNextName, { fontSize: scaledLabels.restNextName }]} numberOfLines={1}>{current.name}</Text>
                {(current.instructionText || current.description) ? (
                  <Text style={[st.transitionInstructionInline, { fontSize: scaledLabels.transitionInline }]} numberOfLines={1}>
                    {current.instructionText || current.description}
                  </Text>
                ) : null}
              </>,
              renderGoldTimer(formatTime(timeLeft)),
            )}
            <View style={st.mediaSlot}>
              <View style={[st.mediaInner, mediaInnerSize]}>
                {activeVideoUrl ? (
                  <Video
                    ref={registerVideo}
                    key={activeVideoUrl}
                    source={{ uri: activeVideoUrl }}
                    resizeMode={ResizeMode.COVER}
                    isLooping
                    shouldPlay={!isPaused}
                    isMuted
                    style={st.videoPlayer}
                    videoStyle={
                      Platform.OS === 'web'
                        ? ({ width: '100%', height: '100%', objectFit: 'cover' } as any)
                        : undefined
                    }
                  />
                ) : activeThumbUrl ? (
                  <Image source={{ uri: activeThumbUrl }} style={st.videoPlayer} resizeMode="cover" />
                ) : (
                  <View style={[st.videoPlayer, st.videoPlaceholder]}>
                    <Icon name="arrow-right" size={48} color="#3A4050" />
                  </View>
                )}
              </View>
            </View>
            {renderNextUpSlot(renderNextUp())}
          </View>
        )}

        {/* ── GRAB EQUIPMENT — Equipment preparation ─────────── */}
        {phase === 'grabEquipment' && current && (
          <View style={[st.workContainer, webSafeBottomStyle]}>
            {renderLogoSlot()}
            {renderTitleTimerSlot(
              <>
                <Text style={[st.restPhaseLabel, { color: '#FB923C', fontSize: scaledLabels.restPhase }]}>GRAB EQUIPMENT</Text>
                <Text style={[st.restNextName, { fontSize: scaledLabels.restNextName }]} numberOfLines={1}>{current.name}</Text>
                {current.instructionText || current.description ? (
                  <Text style={[st.transitionInstructionInline, { fontSize: scaledLabels.transitionInline }]} numberOfLines={1}>
                    {current.instructionText || current.description}
                  </Text>
                ) : null}
              </>,
              renderGoldTimer(formatTime(timeLeft)),
            )}
            <View style={st.mediaSlot}>
              <View style={[st.mediaInner, st.equipmentPanel, mediaInnerSize]}>
                <View style={[st.specialIconCircle, { backgroundColor: 'rgba(251,146,60,0.15)' }]}>
                  <Icon name="briefcase" size={48} color="#FB923C" />
                </View>
              </View>
            </View>
            {renderNextUpSlot(renderNextUp())}
          </View>
        )}

        {/* ── WATER BREAK — Hydration pause ───────────────────── */}
        {phase === 'waterBreak' && current && (
          <View style={[st.workContainer, webSafeBottomStyle]}>
            {renderLogoSlot()}
            {renderTitleTimerSlot(
              <Text style={[st.waterBreakLabel, { fontSize: scaledLabels.waterBreakLabel }]}>WATER BREAK</Text>,
              renderGoldTimer(formatTime(timeLeft)),
            )}
            <View style={st.mediaSlot}>
              <View style={[st.mediaInner, mediaInnerSize]}>
                {activeVideoUrl ? (
                  <Video
                    ref={registerVideo}
                    key={activeVideoUrl}
                    source={{ uri: activeVideoUrl }}
                    resizeMode={ResizeMode.COVER}
                    isLooping
                    shouldPlay={!isPaused}
                    isMuted
                    style={st.videoPlayer}
                    videoStyle={
                      Platform.OS === 'web'
                        ? ({ width: '100%', height: '100%', objectFit: 'cover' } as any)
                        : undefined
                    }
                  />
                ) : activeThumbUrl ? (
                  <Image source={{ uri: activeThumbUrl }} style={st.videoPlayer} resizeMode="cover" />
                ) : (
                  <View style={[st.videoPlayer, st.waterBreakPlaceholder]}>
                    <Icon name="droplet" size={64} color="#38BDF8" />
                  </View>
                )}
                {/* Blue tint overlay */}
                <View style={st.waterBreakVideoOverlay} />
                {/* WATER BREAK text overlay */}
                <View style={st.waterBreakTextOverlay}>
                  <Text style={st.waterBreakOverlayText}>WATER</Text>
                  <Text style={st.waterBreakOverlayText}>BREAK</Text>
                </View>
              </View>
            </View>
            {renderNextUpSlot(null)}
          </View>
        )}

        {/* ── WORK + REST — share one Video element so the asset persists ── */}
        {/* across the phase boundary. The rest UI overlays a REST label on   */}
        {/* the same video, which already shows the next item per activeVideoUrl. */}
        {(phase === 'work' || phase === 'rest') && current && (
          <View style={[st.workContainer, webSafeBottomStyle]}>
            {renderLogoSlot()}
            {phase === 'work'
              ? renderTitleTimerSlot(
                  <>
                    {current.supersetLabel && (
                      <Text style={[st.supersetLabel, { fontSize: scaledLabels.superset }]}>{current.supersetLabel}</Text>
                    )}
                    <Text
                      style={[st.workMovementName, getNameFontStyle(current.name)]}
                      numberOfLines={3}
                    >
                      {current.name}
                    </Text>
                  </>,
                  !isRepBased ? renderGoldTimer(formatTime(timeLeft)) : null,
                )
              : renderTitleTimerSlot(
                  <>
                    <Text style={[st.restPhaseLabel, { fontSize: scaledLabels.restPhase }]}>REST</Text>
                    {next && <Text style={[st.restNextName, { fontSize: scaledLabels.restNextName }]} numberOfLines={1}>Next: {next.name}</Text>}
                  </>,
                  renderRestTimer(formatTime(timeLeft)),
                )}

            {/* Shared media slot — Video stays mounted across work↔rest. */}
            <View style={st.mediaSlot}>
              {/* SPLIT label overlays the media so it never alters slot height */}
              {phase === 'work' && current.swapSides && (
                <View style={st.splitLabelOverlay} pointerEvents="none">
                  <Text style={st.splitText}>SPLIT</Text>
                  <Text style={st.splitSep}> | </Text>
                  <Text style={st.splitDuration}>5 sec</Text>
                  <Text style={st.splitArrows}> ⇄</Text>
                </View>
              )}
              <View style={[st.mediaInner, mediaInnerSize]}>
                {videoLayers.length > 0 ? (
                  <>
                    {videoLayers.map((layer) => {
                      // The displayed layer is fully visible. The preload
                      // layer stays at opacity 0 — loaded but invisible —
                      // until the reveal point flips activeVideoUrl to it,
                      // at which point displayedUrl promotes it instantly.
                      const isDisplayed = layer.url === displayedUrl;
                      const opacity = isDisplayed ? 1 : 0;
                      return (
                        <Video
                          key={layer.url}
                          ref={(el: any) => {
                            registerVideo(el);
                            if (isDisplayed) videoRef.current = el;
                          }}
                          source={getVideoSource(layer.url)}
                          resizeMode={ResizeMode.COVER}
                          isLooping
                          shouldPlay={!isPaused}
                          isMuted
                          style={[st.videoPlayer, st.videoLayer, { opacity } as any]}
                          videoStyle={
                            Platform.OS === 'web'
                              ? ({ width: '100%', height: '100%', objectFit: 'cover' } as any)
                              : undefined
                          }
                          onReadyForDisplay={() => handleLayerReady(layer.url)}
                        />
                      );
                    })}
                    {!displayedUrl && activeThumbUrl && (
                      <Image
                        source={{ uri: activeThumbUrl }}
                        style={st.posterFallback}
                        resizeMode="cover"
                      />
                    )}
                  </>
                ) : activeThumbUrl ? (
                  <Image
                    source={{ uri: activeThumbUrl }}
                    style={st.videoPlayer}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[st.videoPlayer, st.videoPlaceholder]}>
                    <Icon name="play-circle" size={48} color="#3A4050" />
                  </View>
                )}
              </View>
            </View>

            {/* Next-up slot — work shows next item, rest leaves it empty */}
            {/* (the rest layout already names the next item in the title slot). */}
            {renderNextUpSlot(phase === 'work' ? renderNextUp() : null)}
          </View>
        )}

        {/* ── SWAP state ──────────────────────────────────────── */}
        {phase === 'swap' && current && (
          <View style={[st.workContainer, webSafeBottomStyle]}>
            {renderLogoSlot()}
            {renderTitleTimerSlot(
              <>
                <Text style={[st.phaseLabel, { fontSize: scaledLabels.phaseLabel }]}>SWITCH SIDES</Text>
                <Text style={[st.restNextName, { fontSize: scaledLabels.restNextName }]} numberOfLines={1}>{current.name}</Text>
              </>,
              renderGoldTimer(String(Math.max(0, Math.ceil(timeLeft)))),
            )}
            <View style={st.mediaSlot}>
              <View style={[st.mediaInner, st.swapPanel, mediaInnerSize]}>
                <View style={st.sideBadge}>
                  <Text style={st.sideBadgeText}>RIGHT SIDE</Text>
                </View>
              </View>
            </View>
            {renderNextUpSlot(null)}
          </View>
        )}

        {/* ── COMPLETE state ──────────────────────────────────── */}
        {phase === 'complete' && (
          <>
            {renderHeader(false)}
            <View style={st.centerContent}>
              {isPreview && (
                <View style={st.previewBadge}>
                  <Icon name="eye" size={14} color="#F5A623" />
                  <Text style={st.previewBadgeText}>COACH PREVIEW</Text>
                </View>
              )}
              <Icon name="check-circle" size={72} color="#F5A623" />
              <Text style={st.completeTitle}>
                {isPreview ? 'Preview Complete' : 'Workout Complete!'}
              </Text>
              <Text style={st.completeMeta}>
                {exerciseTotal} movement{exerciseTotal !== 1 ? 's' : ''} finished
              </Text>
              <TouchableOpacity style={st.bigStartBtn} onPress={isPreview ? onClose : handleFinish}>
                <Text style={st.bigStartText}>{isPreview ? 'End Preview' : 'Continue'}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── Shared player-shell controls ─────────────────────── */}
        {/* The top header (close/title/mute/progress) lives INSIDE this   */}
        {/* overlay so playback is clean — it appears with pause/skip on   */}
        {/* tap and auto-hides 3s later. While paused the overlay sticks   */}
        {/* (controls + header stay visible) so the user can resume.       */}
        {phase !== 'ready' && phase !== 'complete' && !(showControls || isPaused) && (
          <TouchableOpacity
            style={st.sharedTapCatcher}
            onPress={handleVideoTap}
            activeOpacity={1}
          />
        )}

        {phase !== 'ready' && phase !== 'complete' && (showControls || isPaused) && (
          <View style={st.sharedControlsOverlay}>
            <TouchableOpacity
              style={st.sharedOverlayBackdrop}
              onPress={handleVideoTap}
              activeOpacity={1}
            />
            <View style={st.sharedOverlayHeader} pointerEvents="box-none">
              {renderHeader(true)}
            </View>
            <View style={st.sharedOverlayCenterStack} pointerEvents="box-none">
              {phase === 'work' && isRepBased ? (
                <TouchableOpacity style={st.sharedOverlayCenterBtn} onPress={handleRepDoneFromOverlay}>
                  <Icon name="check" size={32} color="#0E1117" />
                  <Text style={st.sharedOverlayDoneText}>Done</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={st.sharedOverlayCenterBtn} onPress={handlePauseResumeFromOverlay}>
                  <Icon name={isPaused ? 'play' : 'pause'} size={36} color="#0E1117" />
                </TouchableOpacity>
              )}
              <TouchableOpacity style={st.sharedOverlaySkipBtn} onPress={handleSkipFromOverlay}>
                <Icon name="skip-forward" size={18} color="#F5A623" />
                <Text style={st.sharedOverlaySkipText}>Skip</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
      </View>

      {/* Swap movement modal */}
      <Modal visible={showSwap} transparent animationType="slide">
        <View style={st.swapOverlay}>
          <View style={st.swapSheet}>
            <View style={st.swapHeader}>
              <Text style={st.swapTitle}>Swap Movement</Text>
              <TouchableOpacity onPress={closeSwap}>
                <Icon name="x" size={22} color="#8A95A3" />
              </TouchableOpacity>
            </View>
            {loadingAlts && (
              <Text style={st.swapHint}>Loading alternatives...</Text>
            )}
            {!loadingAlts && alternatives.length === 0 && (
              <Text style={st.swapHint}>No alternatives found for this category.</Text>
            )}
            <TextInput
              style={st.swapReasonInput}
              placeholder="Reason for swap (optional)"
              placeholderTextColor="#6B7280"
              value={swapReason}
              onChangeText={setSwapReason}
              maxLength={100}
            />
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
              {alternatives.map((alt) => (
                <TouchableOpacity
                  key={alt.id}
                  style={st.swapItem}
                  onPress={() => {
                    swapMovement(alt, swapReason.trim() || undefined);
                    setSwapReason('');
                  }}
                >
                  <Text style={st.swapItemName}>{alt.name}</Text>
                  <Text style={st.swapItemCat}>{alt.category}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const { width: SCREEN_W } = Dimensions.get('window');

const PORTRAIT_MAX_W = 430;

// On web (especially iOS PWA standalone), the viewport includes the home
// indicator and any browser chrome at the bottom. env(safe-area-inset-bottom)
// pushes the workContainer's bottom padding above that chrome so the next-up
// slot is never clipped. max() guarantees a minimum visual gap.
const webSafeBottomStyle: any = Platform.OS === 'web'
  ? { paddingBottom: 'max(8px, env(safe-area-inset-bottom, 8px))' }
  : null;

const st = StyleSheet.create({
  portraitLockOuter: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    backgroundColor: '#0E1117',
    width: '100%',
    maxWidth: PORTRAIT_MAX_W,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 44, android: 24, web: 8, default: 8 }),
    paddingBottom: 6,
  },
  workoutName: {
    flex: 1,
    textAlign: 'center',
    color: '#8A95A3',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FB,
    marginHorizontal: 12,
  },
  progressText: {
    color: '#F5A623',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
  },
  progressBar: {
    height: 3,
    backgroundColor: '#1A1E26',
    marginHorizontal: 20,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    backgroundColor: '#F5A623',
    borderRadius: 2,
  },

  // Center content area
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },

  // Ready
  readyLogo: { width: 180, height: 60, marginBottom: 16 },
  readyTitle: {
    fontSize: 28, fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    marginTop: 16, textAlign: 'center',
  },
  readyMeta: { fontSize: 15, color: '#8A95A3', fontFamily: FB, marginTop: 8 },
  bigStartBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: '#F5A623', paddingVertical: 18,
    paddingHorizontal: 48, borderRadius: 16, marginTop: 40,
  },
  bigStartText: { fontSize: 20, fontWeight: '700', color: '#0E1117', fontFamily: FH },

  // Ready — block overview grid
  readyBlockBadge: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: '#F5A623', justifyContent: 'center', alignItems: 'center',
    marginRight: 10,
  },
  readyBlockBadgeText: {
    fontSize: 14, fontWeight: '700', color: '#0E1117', fontFamily: FH,
  },
  readyBlockLabel: {
    fontSize: 18, fontWeight: '700', color: '#F0F4F8', fontFamily: FH, flex: 1,
  },
  readyBlockRounds: {
    fontSize: 14, fontWeight: '600', color: '#8A95A3', fontFamily: FH, marginLeft: 8,
  },
  readyThumbGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  readyThumbCell: {
    width: '30%' as any, marginBottom: 4,
  },
  readyThumbImage: {
    width: '100%' as any, aspectRatio: 4 / 5, borderRadius: 8,
  },
  readyThumbName: {
    fontSize: 11, color: '#8A95A3', fontFamily: FB, marginTop: 4, textAlign: 'center',
  },
  readyFooter: {
    position: 'absolute' as any, bottom: 0, left: 0, right: 0,
    alignItems: 'center', paddingBottom: Platform.select({ ios: 40, android: 24, web: 24, default: 24 }),
    paddingTop: 16,
    backgroundColor: 'rgba(14,17,23,0.92)',
  },
  readyPlayBtn: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#F5A623', justifyContent: 'center', alignItems: 'center',
  },

  // ── Intro / Outro ──────────────────────────────────────────────────
  introOutroContainer: {
    flex: 1,
    backgroundColor: '#0E1117',
    justifyContent: 'center',
    alignItems: 'center',
  },
  introOutroGradient: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  // Intro split-screen
  introSplitContainer: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#0E1117',
  },
  introVideoPanel: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  introBrandPanel: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: '#0E1117',
  },
  introLogo: { width: 160, height: 54, marginBottom: 20 },
  introBlockLabel: {
    fontSize: 20, fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    textAlign: 'center', marginBottom: 24, letterSpacing: 1,
  },
  introTitle: {
    fontSize: 36, fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    textAlign: 'center', marginBottom: 8,
  },
  introSubtitle: {
    fontSize: 18, fontWeight: '700', color: '#F5A623', fontFamily: FH,
    letterSpacing: 4, marginBottom: 32,
  },
  introTimerPill: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    paddingHorizontal: 24, paddingVertical: 8,
    borderRadius: 20, marginBottom: 16,
  },
  introTimerText: {
    fontSize: 24, fontWeight: '700', color: '#F5A623', fontFamily: FH,
  },
  outroTitle: {
    fontSize: 42, fontWeight: '900', color: '#FFFFFF', fontFamily: FH,
    textAlign: 'center', letterSpacing: 8, marginBottom: 24,
  },
  outroSubtitle: {
    fontSize: 18, color: '#8A95A3', fontFamily: FB,
    textAlign: 'center', marginBottom: 32,
  },

  // ── Special block shared styles ────────────────────────────────────
  specialContent: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 24,
  },
  specialIconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: 'rgba(251,191,36,0.15)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: 16,
  },
  specialPhaseLabel: {
    fontSize: 14, fontWeight: '700', color: '#FBBF24', fontFamily: FH,
    letterSpacing: 2, marginBottom: 8,
  },
  specialTitle: {
    fontSize: 24, fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    textAlign: 'center', marginBottom: 16,
  },
  specialTimerRow: {
    alignItems: 'center', marginTop: 'auto' as any, paddingBottom: 24,
  },
  specialTimerNum: {
    fontSize: 48, fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    marginBottom: 8,
  },

  // ── Demo block — thumbnail grid ─────────────────────────────────────
  demoTitleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', paddingHorizontal: 4, marginBottom: 16,
  },
  demoBlockTitle: {
    fontSize: 22, fontWeight: '700', color: '#F0F4F8', fontFamily: FH, textAlign: 'center',
  },
  demoGrid: {
    flex: 1, flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'center', gap: 8, width: '100%',
  },
  demoGridCell: {
    aspectRatio: 4 / 5,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#1A2035',
  },
  demoGridImage: {
    width: '100%', height: '100%',
  },

  // ── Transition block ───────────────────────────────────────────────
  transitionInstruction: {
    fontSize: 18, color: '#C9D1D9', fontFamily: FB,
    textAlign: 'center', lineHeight: 26,
    paddingHorizontal: 16, marginBottom: 24,
  },

  // ── Water Break block ──────────────────────────────────────────────
  waterBreakLabel: {
    fontSize: 20, fontWeight: '700', color: '#38BDF8', fontFamily: FH,
    letterSpacing: 2, textAlign: 'center',
  },
  waterBreakVideoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(56,189,248,0.25)',
  } as any,
  waterBreakTextOverlay: {
    position: 'absolute', bottom: 24, left: 0, right: 0,
    alignItems: 'center',
  } as any,
  waterBreakOverlayText: {
    fontSize: 48, fontWeight: '900', color: '#FFFFFF', fontFamily: FH,
    letterSpacing: 6, textAlign: 'center', opacity: 0.7,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  waterBreakPlaceholder: {
    backgroundColor: 'rgba(56,189,248,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  waterBreakPlaceholderText: {
    fontSize: 32, fontWeight: '900', color: '#FFFFFF', fontFamily: FH,
    letterSpacing: 4, textAlign: 'center',
  },

  // Phase labels
  phaseLabel: {
    fontSize: 16, fontWeight: '700', color: '#F5A623', fontFamily: FH,
    letterSpacing: 2, marginBottom: 16, textAlign: 'center',
  },
  blockLabel: {
    fontSize: 14, fontWeight: '600', color: '#8A95A3', fontFamily: FB,
    marginBottom: 8,
  },

  // ── In-workout shared frame ────────────────────────────────────────
  // Every active phase (work, rest, transition, waterBreak, demo,
  // grabEquipment, swap) uses this container. Vertical padding is tight
  // to push content up; bottom padding accounts for iOS home indicator
  // and PWA browser chrome so the next-up slot is never clipped.
  workContainer: {
    flex: 1, paddingHorizontal: 0, paddingTop: 0,
    paddingBottom: Platform.select({ ios: 24, android: 8, web: 8, default: 8 }),
    overflow: 'hidden',
  },

  // ── Fixed-position slots ───────────────────────────────────────────
  // Heights are stable across phases so logo / title / timer / media /
  // next-up never shift between work, rest, transition, etc.
  logoSlot: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
    marginBottom: 4, // SLOT_GAP_LOGO — gap to title row
  },
  slotLogo: { width: 260, height: 52 },
  // Title/timer row is locked to a fixed pixel height — NOT minHeight — so
  // the slot does not grow when content varies between phases (REST shows
  // 2 short lines, WORK can show superset + 2-line name + reps + cues). If
  // this height changed phase-to-phase the flex mediaSlot below would
  // shrink/grow with it and the centered media would visibly shift.
  // Title/timer row sits flush with the media's left/right edges. Title is a
  // fixed-height transparent module with centered text (Devin's "title module"
  // requirement). Timer pins to the right with a fixed minWidth.
  titleTimerSlot: {
    height: 112,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 0,
    marginBottom: 12, // SLOT_GAP_TITLE — gap to media (must always be visible)
    alignSelf: 'center',
  },
  titleColumn: {
    flex: 1, height: 112, marginRight: 4,
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 8, backgroundColor: 'transparent',
  },
  timerColumn: { justifyContent: 'center' },
  // Media slot — outer reserves the vertical space between the title row
  // and the next-up slot. The inner box (mediaInner) gets explicit pixel
  // width/height passed inline so the ratio is always exactly 4:5; this
  // avoids RN's ambiguous behavior when aspectRatio + percent dimensions
  // collide. Surrounding layout shrinks/grows around it, never the ratio.
  mediaSlot: {
    flex: 1,
    width: '100%',
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaInner: {
    overflow: 'hidden',
    backgroundColor: '#000000',
    borderRadius: 12,
    position: 'relative',
  },
  // Next-up row is also locked to a fixed pixel height. REST passes null
  // content (slot would be ~76px from minHeight) and WORK passes the next-up
  // bar (~92px). Locking the height stops the flex mediaSlot above from
  // shrinking on work, which is what was visibly shifting the media up.
  nextUpSlot: {
    height: 64,
    justifyContent: 'center',
    paddingTop: 0,
    marginTop: 12, // SLOT_GAP_MEDIA — gap from media (must always be visible)
    alignSelf: 'center',
  },
  splitLabelOverlay: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    zIndex: 5,
  } as any,
  equipmentPanel: {
    backgroundColor: 'rgba(251,146,60,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapPanel: {
    backgroundColor: 'rgba(245,166,35,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  transitionInstructionInline: {
    fontSize: 13, color: '#8A95A3', fontFamily: FB, marginTop: 2, textAlign: 'center',
  },

  // Legacy aliases (kept for any leftover references)
  workLogo: { width: 260, height: 72, alignSelf: 'center', marginBottom: 6 },
  nameTimerRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 8,
  },
  nameColumn: { flex: 1, marginRight: 12 },
  supersetLabel: {
    fontSize: 16, fontWeight: '700', color: '#F5A623', fontFamily: FH,
    letterSpacing: 1, marginBottom: 4, textAlign: 'center',
  },
  workMovementName: {
    fontWeight: '800', color: '#FFFFFF', fontFamily: FH, textAlign: 'center',
  },
  workReps: {
    fontSize: 18, fontWeight: '600', color: '#F5A623', fontFamily: FH,
    marginTop: 2, textAlign: 'center',
  },
  workCues: {
    fontSize: 13, color: '#8A95A3', fontFamily: FB, marginTop: 2, textAlign: 'center',
  },
  workTimer: {
    fontSize: 80, fontWeight: '700', color: '#FFFFFF', fontFamily: FH, lineHeight: 80,
  },
  // Gold timer box (used across all screens). Width and height are fixed so
  // the box never resizes when the digit count changes (9→10, 39→40, or when
  // formatTime flips from "59" to "1:00"). Font size is controlled by
  // getTimerFontStyle at the call site so 1–2 char values dominate the box
  // and 3+ char values (M:SS) shrink to fit cleanly.
  goldTimerBox: {
    backgroundColor: '#F5A623',
    width: 132,
    height: 112,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goldTimerText: {
    fontWeight: '800',
    color: '#0E1117',
    fontFamily: FH,
    textAlign: 'center',
  },
  // REST phase styles
  restPhaseLabel: {
    fontSize: 18, fontWeight: '700', color: '#8A95A3', fontFamily: FH,
    letterSpacing: 2, textAlign: 'center',
  },
  restNextName: {
    fontSize: 28, fontWeight: '800', color: '#F0F4F8', fontFamily: FH,
    marginTop: 2, textAlign: 'center',
  },
  restTimerBox: {
    backgroundColor: '#1A2035',
    width: 132,
    height: 112,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  restTimerText: {
    fontWeight: '800',
    color: '#FFFFFF',
    fontFamily: FH,
    textAlign: 'center',
  },
  sideBadgeRow: { alignItems: 'center', marginBottom: 4 },
  // SPLIT label
  splitLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  splitText: {
    fontSize: 14, fontWeight: '700', color: '#F5A623', fontFamily: FH, letterSpacing: 1,
  },
  splitSep: {
    fontSize: 14, color: '#6B7280', fontFamily: FB,
  },
  splitDuration: {
    fontSize: 14, color: '#8A95A3', fontFamily: FB,
  },
  splitArrows: {
    fontSize: 14, color: '#F5A623', fontFamily: FB,
  },

  // Video area — strict 4:5 portrait crop
  videoArea: {
    aspectRatio: 4 / 5, width: '100%', marginTop: 4,
    borderRadius: 0, overflow: 'hidden', backgroundColor: '#000000',
  },
  videoInner: { flex: 1, position: 'relative' },
  videoPlayer: { width: '100%', height: '100%' },
  videoLayer: { ...StyleSheet.absoluteFillObject } as any,
  videoPlaceholder: {
    justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A1E26',
  },
  posterFallback: {
    ...StyleSheet.absoluteFillObject, backgroundColor: '#000000',
  } as any,

  // ── Shared player-shell overlay ──────────────────────────────────────
  // Covers the whole player container so tap-anywhere + controls behave
  // identically across every active phase (work/rest/demo/intro/etc.).
  sharedTapCatcher: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent', zIndex: 90,
  } as any,
  sharedControlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 100,
  } as any,
  sharedOverlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
  } as any,
  sharedOverlayHeader: {
    position: 'absolute' as any,
    top: 0, left: 0, right: 0,
    zIndex: 110,
  },
  sharedOverlayCloseRow: {
    position: 'absolute' as any,
    top: Platform.select({ ios: 44, android: 20, web: 16, default: 16 }),
    left: 16,
  },
  sharedOverlayCenterStack: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center', gap: 18,
  } as any,
  sharedOverlayCenterBtn: {
    width: 84, height: 84, borderRadius: 42,
    backgroundColor: '#F5A623',
    justifyContent: 'center', alignItems: 'center',
  },
  sharedOverlayDoneText: {
    fontSize: 14, fontWeight: '700', color: '#0E1117', fontFamily: FH, marginTop: 2,
  },
  sharedOverlaySkipBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 20,
    borderRadius: 20, borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.5)',
  },
  sharedOverlaySkipText: {
    fontSize: 15, fontWeight: '600', color: '#F5A623', fontFamily: FH,
  },

  // Legacy styles
  movementName: {
    fontSize: 32, fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    textAlign: 'center', marginBottom: 8,
  },
  cues: {
    fontSize: 14, color: '#8A95A3', fontFamily: FB,
    textAlign: 'center', marginBottom: 8, lineHeight: 20,
  },
  repsText: {
    fontSize: 16, fontWeight: '600', color: '#F5A623', fontFamily: FH, marginBottom: 8,
  },
  sideBadge: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(245,166,35,0.3)',
    marginBottom: 12, alignSelf: 'center',
  },
  sideBadgeText: {
    fontSize: 14, fontWeight: '700', color: '#F5A623', fontFamily: FH, letterSpacing: 1,
  },

  // Timer
  timerRing: {
    width: Math.min(SCREEN_W * 0.55, 220),
    height: Math.min(SCREEN_W * 0.55, 220),
    borderRadius: Math.min(SCREEN_W * 0.55, 220) / 2,
    borderWidth: 6, borderColor: '#F5A623',
    justifyContent: 'center', alignItems: 'center',
    marginTop: 24, marginBottom: 24,
  },
  timerRingRest: { borderColor: '#2A3040' },
  timerNum: {
    fontSize: 64, fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
  },
  timerSub: {
    fontSize: 13, color: '#8A95A3', fontFamily: FB, marginTop: -4,
  },
  countdownNum: {
    fontSize: 96, fontWeight: '700', color: '#F5A623', fontFamily: FH,
  },
  upNextName: {
    fontSize: 22, fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    marginTop: 12, textAlign: 'center',
  },

  // Controls (REST phase)
  controls: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  controlBtn: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#F5A623', justifyContent: 'center', alignItems: 'center',
  },
  repDoneBtn: {
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: '#6EBB7A', justifyContent: 'center', alignItems: 'center',
    marginTop: 24, marginBottom: 16,
  },
  repDoneBtnText: {
    fontSize: 18, fontWeight: '700', color: '#0E1117', fontFamily: FH, marginTop: 4,
  },
  skipBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 12, paddingHorizontal: 16,
  },
  skipText: {
    fontSize: 14, fontWeight: '600', color: '#F5A623', fontFamily: FH,
  },

  // Next up — short horizontal row: [LABEL | name+meta (flex) | thumb]
  nextUpBar: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12,
    flexDirection: 'row', alignItems: 'center', width: '100%',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    alignSelf: 'center', gap: 12,
  },
  nextUpLabel: {
    fontSize: 11, fontWeight: '700', color: '#8A95A3', fontFamily: FH,
    letterSpacing: 1,
  },
  nextUpContent: {
    flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%',
  },
  nextUpThumb: { width: 40, height: 40, borderRadius: 8, backgroundColor: '#1A2035' },
  nextUpInfo: { flex: 1 },
  nextUpName: {
    fontSize: 15, fontWeight: '600', color: '#F0F4F8', fontFamily: FH,
  },
  nextUpMeta: {
    fontSize: 11, color: '#8A95A3', fontFamily: FB, marginTop: 1,
  },

  // Complete
  completeTitle: {
    fontSize: 28, fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    marginTop: 16, textAlign: 'center',
  },
  completeMeta: {
    fontSize: 15, color: '#8A95A3', fontFamily: FB, marginTop: 8,
  },

  // TTS warning
  ttsWarning: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
    backgroundColor: 'rgba(224,107,79,0.15)',
  },
  ttsWarningText: {
    fontSize: 10, color: '#E06B4F', fontFamily: FB, fontWeight: '600',
  },
  offlineBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8,
    backgroundColor: 'rgba(245,158,11,0.15)',
  },
  offlineBadgeText: {
    fontSize: 10, color: '#F59E0B', fontFamily: FB, fontWeight: '600',
  },

  // Swap modal
  swapOverlay: {
    flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.7)',
  },
  swapSheet: {
    backgroundColor: '#111827', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 20, maxHeight: '60%', overflow: 'hidden' as const,
  },
  swapHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  swapTitle: {
    fontSize: 18, fontWeight: '700', color: '#E2E8F0', fontFamily: FH,
  },
  swapHint: {
    fontSize: 13, color: '#8A95A3', fontFamily: FB,
    textAlign: 'center', paddingVertical: 20,
  },
  swapItem: {
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E2A3A',
  },
  swapItemName: {
    fontSize: 15, fontWeight: '600', color: '#E2E8F0', fontFamily: FH,
  },
  swapItemCat: {
    fontSize: 12, color: '#8A95A3', fontFamily: FB, marginTop: 2,
  },
  swapReasonInput: {
    backgroundColor: '#1A1F2E', borderRadius: 8, padding: 10,
    fontSize: 14, color: '#E2E8F0', fontFamily: FB, marginBottom: 8,
    borderWidth: 1, borderColor: '#252B3B',
  },

  // Preview badge
  previewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginBottom: 16,
  },
  previewBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    letterSpacing: 1,
  },
});
