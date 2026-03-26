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
 * - Countdown beeps (440Hz at 3-2-1, 880Hz at 0)
 * - Haptic feedback (light countdown, medium transition, heavy start, success complete)
 * - Wake lock to prevent screen sleep
 *
 * Follows GoArrive design system: #0E1117 bg, #F5A623 gold accent.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  Dimensions,
  Image,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { Icon } from './Icon';
import { playBeep } from '../lib/audioBeep';
import { hapticLight, hapticMedium, hapticHeavy, hapticSuccess } from '../lib/haptics';
import { useWakeLock } from '../lib/useWakeLock';

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
}

interface FlatMovement {
  name: string;
  duration: number; // seconds
  restAfter: number; // seconds
  blockName: string;
  blockIndex: number;
  movementIndex: number;
  swapSides: boolean;
  description?: string;
  sets?: number;
  reps?: string;
  /** MP4/video URL for looping demo */
  videoUrl?: string;
  /** Poster/thumbnail image URL */
  thumbnailUrl?: string;
}

type Phase = 'ready' | 'countdown' | 'work' | 'rest' | 'swap' | 'complete';

const COUNTDOWN_SECONDS = 3;

// ── Component ──────────────────────────────────────────────────────────────
export default function WorkoutPlayer({
  visible,
  workout,
  onClose,
  onComplete,
}: WorkoutPlayerProps) {
  // Flatten all blocks → movements into a linear sequence
  const flatMovements = useRef<FlatMovement[]>([]);

  const [phase, setPhase] = useState<Phase>('ready');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [swapSide, setSwapSide] = useState<'L' | 'R'>('L');
  const [isPaused, setIsPaused] = useState(false);

  useWakeLock(phase !== 'ready' && phase !== 'complete');

  // Prefetch next movement media (skill doc: prefetch next 1-3 clips)
  const prefetchedUrls = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (phase !== 'work' && phase !== 'countdown') return;
    const upcoming = flatMovements.current.slice(currentIndex + 1, currentIndex + 4);
    upcoming.forEach((m) => {
      const url = m.videoUrl || m.thumbnailUrl;
      if (url && !prefetchedUrls.current.has(url)) {
        prefetchedUrls.current.add(url);
        // Trigger browser/native cache by fetching the first bytes
        if (Platform.OS === 'web') {
          const link = document.createElement('link');
          link.rel = 'prefetch';
          link.href = url;
          document.head.appendChild(link);
        } else {
          Image.prefetch(url).catch(() => {});
        }
      }
    });
  }, [currentIndex, phase]);

  // ── Flatten blocks on mount ───────────────────────────────────────────
  useEffect(() => {
    if (!workout?.blocks) {
      flatMovements.current = [];
      return;
    }

    const flat: FlatMovement[] = [];
    const blocks = workout.blocks || [];

    blocks.forEach((block: any, bi: number) => {
      const movements = block.movements || [];
      const blockRest = block.restBetweenSec ?? block.rest ?? 15;
      const sets = block.sets ?? 1;

      for (let setNum = 0; setNum < sets; setNum++) {
        movements.forEach((mv: any, mi: number) => {
          const isLastInBlock =
            setNum === sets - 1 && mi === movements.length - 1;
          flat.push({
            name: mv.name || 'Movement',
            duration: mv.duration || mv.workSec || 30,
            restAfter: isLastInBlock ? 0 : mv.restSec ?? blockRest,
            blockName: block.name || `Block ${bi + 1}`,
            blockIndex: bi,
            movementIndex: mi,
            swapSides: mv.swapSides ?? false,
            description: mv.description || mv.coachingCues || '',
            sets: mv.sets,
            reps: mv.reps,
            videoUrl: mv.videoUrl || mv.mediaUrl || '',
            thumbnailUrl: mv.thumbnailUrl || '',
          });
        });
      }
    });

    flatMovements.current = flat;
    setCurrentIndex(0);
    setPhase('ready');
    setIsPaused(false);
    setSwapSide('L');
  }, [workout]);

  const current = flatMovements.current[currentIndex];
  const total = flatMovements.current.length;
  const next =
    currentIndex + 1 < total ? flatMovements.current[currentIndex + 1] : null;

  // ── Timer ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isPaused) return;
    if (phase !== 'countdown' && phase !== 'work' && phase !== 'rest' && phase !== 'swap')
      return;
    if (timeLeft <= 0) return;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        const next = prev - 1;
        // Beep at 3, 2, 1
        if (next <= 3 && next > 0) {
          playBeep(440, 0.05);
          hapticLight();
        }
        // Beep at 0
        if (next === 0) {
          playBeep(880, 0.1);
          hapticMedium();
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [phase, timeLeft, isPaused]);

  // ── Timer hit zero → transition ───────────────────────────────────────
  useEffect(() => {
    if (isPaused || timeLeft > 0) return;

    if (phase === 'countdown') {
      // Start work phase
      setPhase('work');
      setTimeLeft(current?.duration ?? 30);
      hapticHeavy();
    } else if (phase === 'work') {
      // Check swap sides
      if (current?.swapSides && swapSide === 'L') {
        setSwapSide('R');
        setPhase('swap');
        setTimeLeft(3); // brief transition
      } else if (current?.restAfter > 0) {
        setPhase('rest');
        setTimeLeft(current.restAfter);
      } else {
        advanceToNext();
      }
    } else if (phase === 'swap') {
      // Do the other side
      setPhase('work');
      setTimeLeft(current?.duration ?? 30);
    } else if (phase === 'rest') {
      advanceToNext();
    }
  }, [timeLeft, phase, isPaused]);

  const advanceToNext = useCallback(() => {
    const nextIdx = currentIndex + 1;
    if (nextIdx >= total) {
      setPhase('complete');
      hapticSuccess();
    } else {
      setCurrentIndex(nextIdx);
      setSwapSide('L');
      setPhase('countdown');
      setTimeLeft(COUNTDOWN_SECONDS);
    }
  }, [currentIndex, total]);

  // ── Controls ──────────────────────────────────────────────────────────
  const handleStart = () => {
    if (total === 0) return;
    setPhase('countdown');
    setTimeLeft(COUNTDOWN_SECONDS);
    hapticHeavy();
  };

  const handlePauseResume = () => {
    setIsPaused((p) => !p);
  };

  const handleSkip = () => {
    if (phase === 'rest' || phase === 'work' || phase === 'swap' || phase === 'countdown') {
      advanceToNext();
    }
  };

  const handleFinish = () => {
    onComplete();
  };

  // ── Format time ───────────────────────────────────────────────────────
  const formatTime = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}`;
  };

  // ── Progress ──────────────────────────────────────────────────────────
  const progressPct = total > 0 ? ((currentIndex) / total) * 100 : 0;

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
          <Text style={st.progressText}>
            {currentIndex + 1}/{total}
          </Text>
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

        {/* ── WORK state ──────────────────────────────────────── */}
        {phase === 'work' && current && (
          <View style={st.centerContent}>
            <Text style={st.blockLabel}>{current.blockName}</Text>

            {/* Movement media — muted looping video or thumbnail */}
            {current.videoUrl ? (
              <View style={st.mediaWrap}>
                <Video
                  source={{ uri: current.videoUrl }}
                  style={st.mediaVideo}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={!isPaused}
                  isLooping
                  isMuted
                  posterSource={current.thumbnailUrl ? { uri: current.thumbnailUrl } : undefined}
                  usePoster={!!current.thumbnailUrl}
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
            ) : null}

            <Text style={st.movementName}>{current.name}</Text>
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
            {current.reps ? (
              <Text style={st.repsText}>{current.reps} reps</Text>
            ) : null}

            {/* Timer ring */}
            <View style={st.timerRing}>
              <Text style={st.timerNum}>{formatTime(timeLeft)}</Text>
              <Text style={st.timerSub}>seconds</Text>
            </View>

            {/* Controls */}
            <View style={st.controls}>
              <TouchableOpacity style={st.controlBtn} onPress={handlePauseResume}>
                <Icon name={isPaused ? 'play' : 'pause'} size={32} color="#0E1117" />
              </TouchableOpacity>
              <TouchableOpacity style={st.skipBtn} onPress={handleSkip}>
                <Icon name="skip-forward" size={24} color="#F5A623" />
                <Text style={st.skipText}>Skip</Text>
              </TouchableOpacity>
            </View>

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
                      {next.blockName}{next.duration ? ` \u00b7 ${next.duration}s` : ''}
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
});
