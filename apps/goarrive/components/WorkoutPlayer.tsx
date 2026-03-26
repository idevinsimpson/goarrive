/**
 * WorkoutPlayer — Full-screen workout execution engine
 *
 * Enhanced with:
 * - Movement name + coaching cues display
 * - Next-up preview bar
 * - Rest period handling between movements
 * - Swap sides support (L/R indicator)
 * - Progress bar (movements completed / total)
 * - Completion screen before triggering onComplete
 * - Distinct audio cues per phase transition
 * - Haptic feedback (light countdown, medium transition, heavy start, success complete)
 * - Wake lock to prevent screen sleep
 * - Landscape tablet layout
 * - Rep-based mode (Done button instead of timer)
 * - Media playback (video/image) with prefetching
 * - Mute toggle
 *
 * Decomposed into hooks: useWorkoutFlatten, useWorkoutTimer, useMediaPrefetch
 * Follows GoArrive design system: #0E1117 bg, #F5A623 gold accent.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  Dimensions,
  Image,
  useWindowDimensions,
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
  const [flatOverride, setFlatOverride] = useState<any[] | null>(null);
  const flatMovements = flatOverride || flatFromBlocks;

  const timer = useWorkoutTimer({ flatMovements });

  const {
    phase, currentIndex, timeLeft, swapSide, isPaused,
    current, next, total, isRepBased, progressPct,
    handleStart, handlePauseResume, handleSkip, handleRepDone,
  } = timer;

  useWakeLock(phase !== 'ready' && phase !== 'complete');
  useMediaPrefetch(flatMovements, currentIndex, phase === 'work' || phase === 'countdown');

  //  // ── TTS for movement names (Suggestion 1) ──────────────────────
  const { isTTSAvailable } = useWorkoutTTS({ phase, current, next, isMuted: isAudioMuted() });

  // ── Movement swap (Suggestion 7) ─────────────────────────────
  const {
    showSwap, alternatives, loadingAlts,
    openSwap, closeSwap, swapMovement, getSwapLog,
  } = useMovementSwap(flatMovements, currentIndex, setFlatOverride);

  // ── Landscape detection for tablets ─────────────────────────────────
  const { width: winW, height: winH } = useWindowDimensions();
  const isLandscape = winW > winH;
  const isTablet = Math.min(winW, winH) >= 600;

    // ── Audio mute toggle ─────────────────────────────────────────────
  const [audioMuted, setAudioMutedState] = useState(isAudioMuted());
  const toggleMute = () => {
    const n = !audioMuted;
    setAudioMutedState(n);
    setAudioMuted(n);
  };

  // TTS unavailable visual indicator (Risk 4)
  const showTTSWarning = !isTTSAvailable && !audioMuted;

  // ── Format time ───────────────────────────────────────────────────────
  const formatTime = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}`;
  };

  const handleFinish = () => {
    // Pass swap log to parent before completing
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
        {/* Header */}
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

        {/* Progress bar */}
        <View style={st.progressBar}>
          <View style={[st.progressFill, { width: `${progressPct}%` }]} />
        </View>

        {/* ── READY state ─────────────────────────────────────── */}
        {phase === 'ready' && (
          <View style={st.centerContent}>
            <Icon name="workouts" size={64} color="#F5A623" />
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

            {/* ── WORK state ──────────────────────────────────── */}
        {phase === 'work' && current && (
          <View style={[
            st.centerContent,
            isLandscape && isTablet && { flexDirection: 'row', alignItems: 'flex-start', paddingTop: 24 },
          ]}>
            {/* Left column in landscape: media + cues */}
            {isLandscape && isTablet ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                {current.videoUrl ? (
                  <View style={[st.mediaWrap, { width: 320, height: 240 }]}>
                    <MovementVideoControls
                      uri={current.videoUrl}
                      posterUri={current.thumbnailUrl || undefined}
                      height={240}
                      autoPlay={!isPaused}
                      showControls={isPaused}
                    />
                  </View>
                ) : current.thumbnailUrl ? (
                  <View style={[st.mediaWrap, { width: 320, height: 240 }]}>
                    <Image
                      source={{ uri: current.thumbnailUrl }}
                      style={st.mediaThumbnail}
                      resizeMode="contain"
                    />
                  </View>
                ) : null}
                {current.coachingCues && current.coachingCues !== current.description ? (
                  <View style={[st.cuesBox, { maxWidth: 320 }]}>
                    <Text style={st.cuesBoxLabel}>COACHING CUES</Text>
                    <Text style={st.cuesBoxText} numberOfLines={5}>{current.coachingCues}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Right column (or full column in portrait) */}
            <View style={isLandscape && isTablet ? { flex: 1, alignItems: 'center', justifyContent: 'center' } : undefined}>
            <Text style={st.blockLabel}>{current.blockName}</Text>

            {/* Movement media — muted looping video or thumbnail (portrait only) */}
            {!(isLandscape && isTablet) && (current.videoUrl ? (
              <View style={st.mediaWrap}>
                <MovementVideoControls
                  uri={current.videoUrl}
                  posterUri={current.thumbnailUrl || undefined}
                  height={200}
                  autoPlay={!isPaused}
                  showControls={isPaused}
                />
              </View>
            ) : current.thumbnailUrl ? (
              <View style={st.mediaWrap}>
                <Image
                  source={{ uri: current.thumbnailUrl }}
                  style={st.mediaThumbnail}
                  resizeMode="contain"
                />
              </View>
            ) : null)}

            <Text style={[st.movementName, isLandscape && isTablet && { fontSize: 36 }]}>{current.name}</Text>
            {current.swapSides && (
              <View style={st.sideBadge}>
                <Text style={st.sideBadgeText}>
                  {swapSide === 'L' ? 'LEFT SIDE' : 'RIGHT SIDE'}
                </Text>
              </View>
            )}
            {current.description ? (
              <Text style={st.cues} numberOfLines={2}>{current.description}</Text>
            ) : null}
            {/* Show coaching cues in portrait only (landscape shows them in left column) */}
            {!(isLandscape && isTablet) && current.coachingCues && current.coachingCues !== current.description ? (
              <View style={st.cuesBox}>
                <Text style={st.cuesBoxLabel}>COACHING CUES</Text>
                <Text style={st.cuesBoxText} numberOfLines={3}>{current.coachingCues}</Text>
              </View>
            ) : null}
            {current.reps ? (
              <Text style={st.repsText}>{current.reps} reps</Text>
            ) : null}

            {isRepBased ? (
              /* Rep-based mode: large Done button instead of timer */
              <>
                <TouchableOpacity style={st.repDoneBtn} onPress={handleRepDone}>
                  <Icon name="check" size={36} color="#0E1117" />
                  <Text style={st.repDoneBtnText}>Done</Text>
                </TouchableOpacity>
                <TouchableOpacity style={st.skipBtn} onPress={handleSkip}>
                  <Icon name="skip-forward" size={24} color="#F5A623" />
                  <Text style={st.skipText}>Skip</Text>
                </TouchableOpacity>
              </>
            ) : (
              /* Timer-based mode: countdown ring + pause/skip */
              <>
                <View style={st.timerRing}>
                  <Text style={st.timerNum}>{formatTime(timeLeft)}</Text>
                  <Text style={st.timerSub}>seconds</Text>
                </View>
                <View style={st.controls}>
                  <TouchableOpacity style={st.controlBtn} onPress={handlePauseResume}>
                    <Icon name={isPaused ? 'play' : 'pause'} size={32} color="#0E1117" />
                  </TouchableOpacity>
                  <TouchableOpacity style={st.skipBtn} onPress={handleSkip}>
                    <Icon name="skip-forward" size={24} color="#F5A623" />
                    <Text style={st.skipText}>Skip</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Swap movement button */}
            {phase === 'work' && (
              <TouchableOpacity style={st.swapBtn} onPress={openSwap}>
                <Icon name="refresh-cw" size={16} color="#F5A623" />
                <Text style={st.swapBtnText}>Swap Movement</Text>
              </TouchableOpacity>
            )}

            {/* Next up preview */}
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
            </View>{/* Close portrait/right column wrapper */}
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
            {alternatives.map((alt) => (
              <TouchableOpacity
                key={alt.id}
                style={st.swapItem}
                onPress={() => swapMovement(alt)}
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

  // Center content area
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },

  // Ready
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
  mediaWrap: {
    width: Math.min(SCREEN_W * 0.6, 240),
    height: Math.min(SCREEN_W * 0.45, 180),
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.04)',
    marginBottom: 12,
    alignSelf: 'center',
  },
  mediaVideo: {
    width: '100%',
    height: '100%',
  },
  mediaThumbnail: {
    width: '100%',
    height: '100%',
  },
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
  cuesBox: {
    backgroundColor: 'rgba(245,166,35,0.08)',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginTop: 4,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.15)',
    maxWidth: '90%',
  },
  cuesBoxLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    letterSpacing: 1,
    marginBottom: 4,
  },
  cuesBoxText: {
    fontSize: 13,
    color: '#C8CED6',
    fontFamily: FB,
    lineHeight: 18,
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

  // Controls
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
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 20,
    alignItems: 'center',
    width: '100%',
    maxWidth: 320,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
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
    height: 44,
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
  // ── Swap button ─────────────────────────────────────────────────
  swapBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2A3347',
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
});
