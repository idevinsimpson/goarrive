/**
 * WorkoutPlayer — Coach-in-your-pocket workout execution engine
 *
 * Layout (WORK phase):
 *   - GoArrive logo centered at top (on black background)
 *   - Movement name (left) + countdown timer (right) on same row (on black)
 *   - Video in the middle with small side margins (contained, NOT full-screen)
 *   - Controls (pause, skip, swap) hidden by default — appear on video tap, auto-hide after 3s
 *   - NEXT UP bar at the bottom (below video, on black)
 *
 * Decomposed into hooks: useWorkoutFlatten, useWorkoutTimer, useMediaPrefetch, useMovementHydrate
 * Follows GoArrive design system: #0E1117 bg, #F5A623 gold accent.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
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
import { setAudioMuted, isAudioMuted } from '../lib/audioCues';
import { useWakeLock } from '../lib/useWakeLock';
import { useWorkoutFlatten } from '../hooks/useWorkoutFlatten';
import { useWorkoutTimer } from '../hooks/useWorkoutTimer';
import { useMediaPrefetch } from '../hooks/useMediaPrefetch';
import { useWorkoutTTS } from '../hooks/useWorkoutTTS';
import { useMovementSwap } from '../hooks/useMovementSwap';
import { useMovementHydrate } from '../hooks/useMovementHydrate';

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

// ── Types ──────────────────────────────────────────────────────────────────
interface WorkoutPlayerProps {
  visible: boolean;
  workout: any;
  onClose: () => void;
  onComplete: () => void;
  onSwapLog?: (swaps: any[]) => void;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function WorkoutPlayer({
  visible,
  workout,
  onClose,
  onComplete,
  onSwapLog,
}: WorkoutPlayerProps) {
  // ── Hooks ────────────────────────────────────────────────────────────
  const flatFromBlocks = useWorkoutFlatten(workout);
  const hydratedMovements = useMovementHydrate(flatFromBlocks);
  const [flatOverride, setFlatOverride] = useState<any[] | null>(null);
  const flatMovements = flatOverride || hydratedMovements;

  const timer = useWorkoutTimer({ flatMovements });

  const {
    phase, currentIndex, timeLeft, swapSide, isPaused,
    current, next, total, isRepBased, progressPct,
    handleStart, handlePauseResume, handleSkip, handleRepDone,
  } = timer;

  useWakeLock(phase !== 'ready' && phase !== 'complete');
  useMediaPrefetch(flatMovements, currentIndex, phase === 'work' || phase === 'countdown', phase === 'rest');

  // ── TTS for movement names ──────────────────────
  const { isTTSAvailable } = useWorkoutTTS({ phase, current, next, isMuted: isAudioMuted() });

  // ── Movement swap ─────────────────────────────
  const {
    showSwap, alternatives, loadingAlts,
    openSwap, closeSwap, swapMovement, getSwapLog,
  } = useMovementSwap(flatMovements, currentIndex, setFlatOverride);
  const [swapReason, setSwapReason] = useState('');

  // ── Landscape detection for tablets ─────────────────────────────────
  const { width: winW, height: winH } = useWindowDimensions();
  const dimsValid = winW > 0 && winH > 0;
  const isLandscape = dimsValid ? winW > winH : false;
  const isTablet = dimsValid ? Math.min(winW, winH) >= 600 : false;

  // ── Audio mute toggle ─────────────────────────────────────────────
  const [audioMuted, setAudioMutedState] = useState(isAudioMuted());
  const toggleMute = () => {
    const n = !audioMuted;
    setAudioMutedState(n);
    setAudioMuted(n);
  };

  // TTS unavailable visual indicator
  const showTTSWarning = !isTTSAvailable && !audioMuted;

  // ── Tap-to-show controls + header ──────────────────────────────────
  const [showControls, setShowControls] = useState(false);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [videoReady, setVideoReady] = useState(false);

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

  // Reset videoReady when movement changes
  useEffect(() => {
    setVideoReady(false);
  }, [currentIndex]);

  // Hide controls when movement changes
  useEffect(() => {
    setShowControls(false);
  }, [currentIndex]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, []);

  // ── Format time ───────────────────────────────────────────────────────
  const formatTime = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}`;
  };

  const handleFinish = () => {
    if (onSwapLog) {
      const swaps = getSwapLog();
      if (swaps.length > 0) onSwapLog(swaps);
    }
    onComplete();
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <View style={st.container}>
        {/* Header — hidden during WORK phase unless controls are showing */}
        {(phase !== 'work' || showControls) && (
          <View style={st.header}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Icon name="close" size={28} color="#8A95A3" />
            </TouchableOpacity>
            <Text style={st.workoutName} numberOfLines={1}>
              {workout?.name ?? 'Workout'}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              {showTTSWarning && (
                <View style={st.ttsWarning}>
                  <Icon name="alert-triangle" size={12} color="#E06B4F" />
                  <Text style={st.ttsWarningText}>No TTS</Text>
                </View>
              )}
              <TouchableOpacity onPress={toggleMute} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Icon name={audioMuted ? 'volume-x' : 'volume-2'} size={22} color="#8A95A3" />
              </TouchableOpacity>
              <Text style={st.progressText}>
                {currentIndex + 1}/{total}
              </Text>
            </View>
          </View>
        )}

        {/* Progress bar — hidden during WORK phase unless controls are showing */}
        {(phase !== 'work' || showControls) && (
          <View style={st.progressBar}>
            <View style={[st.progressFill, { width: `${progressPct}%` }]} />
          </View>
        )}

        {/* ── READY state ─────────────────────────────────────── */}
        {phase === 'ready' && (
          <View style={st.centerContent}>
            <Image
              source={require('../assets/logo.png')}
              style={st.readyLogo}
              resizeMode="contain"
            />
            <Text style={st.readyTitle}>{workout?.name ?? 'Workout'}</Text>
            <Text style={st.readyMeta}>
              {total} movement{total !== 1 ? 's' : ''} ·{' '}
              {workout?.blocks?.length ?? 0} block{(workout?.blocks?.length ?? 0) !== 1 ? 's' : ''}
            </Text>
            <TouchableOpacity style={st.bigStartBtn} onPress={handleStart}>
              <Icon name="play" size={36} color="#0E1117" />
              <Text style={st.bigStartText}>Start</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── COUNTDOWN state ─────────────────────────────────── */}
        {phase === 'countdown' && current && (
          <View style={st.centerContent}>
            <Text style={st.phaseLabel}>GET READY</Text>
            <Text style={st.countdownNum}>{timeLeft}</Text>
            <Text style={st.upNextName}>{current.name}</Text>
            {current.description ? (
              <Text style={st.cues} numberOfLines={2}>{current.description}</Text>
            ) : null}
          </View>
        )}

        {/* ── WORK state — Stacked layout ──────────────────── */}
        {phase === 'work' && current && (
          <View style={st.workContainer}>
            {/* GoArrive logo — centered above video */}
            <Image
              source={require('../assets/logo.png')}
              style={st.workLogo}
              resizeMode="contain"
            />

            {/* Movement name (left) + Timer (right) — above video */}
            <View style={st.nameTimerRow}>
              <View style={st.nameColumn}>
                <Text style={st.workMovementName} numberOfLines={2}>
                  {current.name}
                </Text>
                {current.reps ? (
                  <Text style={st.workReps}>{current.reps} reps</Text>
                ) : null}
              </View>
              {!isRepBased ? (
                <Text style={st.workTimer}>{formatTime(timeLeft)}</Text>
              ) : null}
            </View>

            {/* Side badge */}
            {current.swapSides && (
              <View style={st.sideBadgeRow}>
                <View style={st.sideBadge}>
                  <Text style={st.sideBadgeText}>
                    {swapSide === 'L' ? 'LEFT SIDE' : 'RIGHT SIDE'}
                  </Text>
                </View>
              </View>
            )}

            {/* Video — contained with small side margins */}
            <View style={st.videoArea}>
              <TouchableWithoutFeedback onPress={handleVideoTap}>
                <View style={st.videoInner}>
                  {current.videoUrl ? (
                    <>
                      <Video
                        source={{ uri: current.videoUrl }}
                        resizeMode={ResizeMode.CONTAIN}
                        isLooping
                        shouldPlay={!isPaused}
                        isMuted
                        style={st.videoPlayer}
                        videoStyle={
                          Platform.OS === 'web'
                            ? ({ width: '100%', height: '100%', objectFit: 'contain' } as any)
                            : undefined
                        }
                        onReadyForDisplay={() => setVideoReady(true)}
                      />
                      {/* GIF thumbnail shown until video is ready — prevents ratio jump */}
                      {!videoReady && current.thumbnailUrl && (
                        <Image
                          source={{ uri: current.thumbnailUrl }}
                          style={st.posterFallback}
                          resizeMode="contain"
                        />
                      )}
                    </>
                  ) : current.thumbnailUrl ? (
                    <Image
                      source={{ uri: current.thumbnailUrl }}
                      style={st.videoPlayer}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={[st.videoPlayer, st.videoPlaceholder]}>
                      <Icon name="play-circle" size={48} color="#3A4050" />
                    </View>
                  )}

                  {/* Transparent tap interceptor — always present, catches taps on web */}
                  <TouchableOpacity
                    style={st.tapInterceptor}
                    onPress={handleVideoTap}
                    activeOpacity={1}
                  />

                  {/* Controls overlay — only visible on tap */}
                  {showControls && (
                    <View style={st.controlsOverlay}>
                      {isRepBased ? (
                        <View style={st.overlayControls}>
                          <TouchableOpacity style={st.overlayDoneBtn} onPress={handleRepDone}>
                            <Icon name="check" size={28} color="#0E1117" />
                            <Text style={st.overlayDoneBtnText}>Done</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={st.overlaySkipBtn} onPress={handleSkip}>
                            <Icon name="skip-forward" size={20} color="#F5A623" />
                            <Text style={st.overlaySkipText}>Skip</Text>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        <View style={st.overlayControls}>
                          <TouchableOpacity style={st.overlayPauseBtn} onPress={handlePauseResume}>
                            <Icon name={isPaused ? 'play' : 'pause'} size={28} color="#0E1117" />
                          </TouchableOpacity>
                          <TouchableOpacity style={st.overlaySkipBtn} onPress={handleSkip}>
                            <Icon name="skip-forward" size={20} color="#F5A623" />
                            <Text style={st.overlaySkipText}>Skip</Text>
                          </TouchableOpacity>
                        </View>
                      )}
                      <TouchableOpacity style={st.overlaySwapBtn} onPress={openSwap}>
                        <Icon name="refresh-cw" size={14} color="#F5A623" />
                        <Text style={st.overlaySwapText}>Swap Movement</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              </TouchableWithoutFeedback>
            </View>

            {/* NEXT UP bar — below the video */}
            {next && (
              <View style={st.nextUpBar}>
                <Text style={st.nextUpLabel}>NEXT UP</Text>
                <View style={st.nextUpContent}>
                  {next.thumbnailUrl ? (
                    <Image
                      source={{ uri: next.thumbnailUrl }}
                      style={st.nextUpThumb}
                      resizeMode="cover"
                    />
                  ) : null}
                  <View style={st.nextUpInfo}>
                    <Text style={st.nextUpName} numberOfLines={1}>{next.name}</Text>
                    <Text style={st.nextUpMeta}>
                      {next.blockName}{next.duration ? ` · ${next.duration}s` : ''}
                    </Text>
                  </View>
                </View>
              </View>
            )}
          </View>
        )}

        {/* ── REST state ──────────────────────────────────────── */}
        {phase === 'rest' && (
          <View style={st.centerContent}>
            <Text style={st.phaseLabel}>REST</Text>
            <View style={[st.timerRing, st.timerRingRest]}>
              <Text style={st.timerNum}>{formatTime(timeLeft)}</Text>
            </View>

            {next && (
              <View style={st.nextUpBar}>
                <Text style={st.nextUpLabel}>NEXT UP</Text>
                <View style={st.nextUpContent}>
                  {next.thumbnailUrl ? (
                    <Image
                      source={{ uri: next.thumbnailUrl }}
                      style={st.nextUpThumb}
                      resizeMode="cover"
                    />
                  ) : null}
                  <View style={st.nextUpInfo}>
                    <Text style={st.nextUpName} numberOfLines={1}>{next.name}</Text>
                    <Text style={st.nextUpMeta}>
                      {next.blockName}{next.duration ? ` \u00b7 ${next.duration}s` : ''}
                    </Text>
                  </View>
                </View>
              </View>
            )}

            <TouchableOpacity style={st.skipBtn} onPress={handleSkip}>
              <Icon name="skip-forward" size={24} color="#F5A623" />
              <Text style={st.skipText}>Skip Rest</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── SWAP state ──────────────────────────────────────── */}
        {phase === 'swap' && current && (
          <View style={st.centerContent}>
            <Text style={st.phaseLabel}>SWITCH SIDES</Text>
            <View style={st.sideBadge}>
              <Text style={st.sideBadgeText}>RIGHT SIDE</Text>
            </View>
            <Text style={st.countdownNum}>{timeLeft}</Text>
            <Text style={st.movementName}>{current.name}</Text>
          </View>
        )}

        {/* ── COMPLETE state ──────────────────────────────────── */}
        {phase === 'complete' && (
          <View style={st.centerContent}>
            <Icon name="check-circle" size={72} color="#F5A623" />
            <Text style={st.completeTitle}>Workout Complete!</Text>
            <Text style={st.completeMeta}>
              {total} movement{total !== 1 ? 's' : ''} finished
            </Text>
            <TouchableOpacity style={st.bigStartBtn} onPress={handleFinish}>
              <Text style={st.bigStartText}>Continue</Text>
            </TouchableOpacity>
          </View>
        )}
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
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const { width: SCREEN_W } = Dimensions.get('window');

const st = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: Platform.select({ ios: 56, android: 44, web: 20, default: 20 }),
    paddingBottom: 12,
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

  // Center content area (used for ready, countdown, rest, swap, complete)
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },

  // Ready
  readyLogo: {
    width: 180,
    height: 60,
    marginBottom: 16,
  },
  readyTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginTop: 16,
    textAlign: 'center',
  },
  readyMeta: {
    fontSize: 15,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 8,
  },
  bigStartBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#F5A623',
    paddingVertical: 18,
    paddingHorizontal: 48,
    borderRadius: 16,
    marginTop: 40,
  },
  bigStartText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
  },

  // Phase labels
  phaseLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    letterSpacing: 2,
    marginBottom: 16,
  },
  blockLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#8A95A3',
    fontFamily: FB,
    marginBottom: 8,
  },

  // ── WORK phase — Stacked layout ────────────────────────────────────
  workContainer: {
    flex: 1,
    paddingHorizontal: 4,
    paddingTop: 8,
    paddingBottom: Platform.select({ ios: 34, android: 16, web: 16, default: 16 }),
  },
  workLogo: {
    width: 260,
    height: 72,
    alignSelf: 'center',
    marginBottom: 6,
  },
  nameTimerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    marginBottom: 8,
  },
  nameColumn: {
    flex: 1,
    marginRight: 12,
  },
  workMovementName: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: FH,
  },
  workReps: {
    fontSize: 17,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FH,
    marginTop: 2,
  },
  workTimer: {
    fontSize: 80,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: FH,
    lineHeight: 80,
  },
  sideBadgeRow: {
    alignItems: 'center',
    marginBottom: 4,
  },

  // Video area — contained with margins
  videoArea: {
    flex: 1,
    marginHorizontal: 0,
    marginTop: 4,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  videoInner: {
    flex: 1,
    position: 'relative',
  },
  videoPlayer: {
    width: '100%',
    height: '100%',
  },
  videoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A1E26',
  },
  posterFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
  } as any,

  // Transparent tap interceptor — always present above video
  tapInterceptor: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    zIndex: 5,
  } as any,

  // Controls overlay — appears on video tap
  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 15,
  } as any,
  overlayControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  overlayPauseBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F5A623',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayDoneBtn: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#6EBB7A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  overlayDoneBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
    marginTop: 2,
  },
  overlaySkipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  overlaySkipText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FH,
  },
  overlaySwapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.4)',
    marginTop: 16,
  },
  overlaySwapText: {
    fontSize: 13,
    color: '#F5A623',
    fontFamily: FB,
    fontWeight: '600',
  },

  // Legacy styles kept for other phases
  movementName: {
    fontSize: 32,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    textAlign: 'center',
    marginBottom: 8,
  },
  cues: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FB,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 20,
  },
  repsText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FH,
    marginBottom: 8,
  },
  sideBadge: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
    marginBottom: 12,
    alignSelf: 'center',
  },
  sideBadgeText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    letterSpacing: 1,
  },

  // Timer
  timerRing: {
    width: Math.min(SCREEN_W * 0.55, 220),
    height: Math.min(SCREEN_W * 0.55, 220),
    borderRadius: Math.min(SCREEN_W * 0.55, 220) / 2,
    borderWidth: 6,
    borderColor: '#F5A623',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 24,
  },
  timerRingRest: {
    borderColor: '#2A3040',
  },
  timerNum: {
    fontSize: 64,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  timerSub: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: -4,
  },
  countdownNum: {
    fontSize: 96,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
  },
  upNextName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginTop: 12,
    textAlign: 'center',
  },

  // Controls (used in REST phase)
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
  },
  controlBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F5A623',
    justifyContent: 'center',
    alignItems: 'center',
  },
  repDoneBtn: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#6EBB7A',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 24,
    marginBottom: 16,
  },
  repDoneBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
    marginTop: 4,
  },
  skipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  skipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F5A623',
    fontFamily: FH,
  },

  // Next up
  nextUpBar: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 10,
    alignItems: 'center',
    width: '100%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignSelf: 'center',
  },
  nextUpLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#8A95A3',
    fontFamily: FH,
    letterSpacing: 1,
    marginBottom: 4,
  },
  nextUpContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },
  nextUpThumb: {
    width: 44,
    height: 55,
    borderRadius: 8,
    backgroundColor: '#1A2035',
  },
  nextUpInfo: {
    flex: 1,
  },
  nextUpName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FH,
  },
  nextUpMeta: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },

  // Complete
  completeTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FH,
    marginTop: 16,
    textAlign: 'center',
  },
  completeMeta: {
    fontSize: 15,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 8,
  },
  // ── TTS warning ─────────────────────────────────────────────────
  ttsWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(224,107,79,0.15)',
  },
  ttsWarningText: {
    fontSize: 10,
    color: '#E06B4F',
    fontFamily: FB,
    fontWeight: '600',
  },
  // ── Swap button (legacy — kept for non-WORK phases) ─────────────
  swapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    marginTop: 8,
  },
  swapBtnText: {
    fontSize: 12,
    color: '#F5A623',
    fontFamily: FB,
    fontWeight: '600',
  },
  // ── Swap modal ──────────────────────────────────────────────────
  swapOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  swapSheet: {
    backgroundColor: '#111827',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '60%',
  },
  swapHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  swapTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#E2E8F0',
    fontFamily: FH,
  },
  swapHint: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FB,
    textAlign: 'center',
    paddingVertical: 20,
  },
  swapItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2A3A',
  },
  swapItemName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#E2E8F0',
    fontFamily: FH,
  },
  swapItemCat: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FB,
    marginTop: 2,
  },
  swapReasonInput: {
    backgroundColor: '#1A1F2E',
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: '#E2E8F0',
    fontFamily: FB,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#252B3B',
  },
});
