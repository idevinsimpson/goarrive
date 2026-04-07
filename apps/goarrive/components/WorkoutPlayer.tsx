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
 * useMovementHydrate, useWorkoutTTS, useMovementSwap, usePlaybackSpeed
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
import { usePlaybackSpeed } from '../hooks/usePlaybackSpeed';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { FB, FH } from '../lib/theme';

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
    phase === 'work' || phase === 'countdown',
    phase === 'rest',
    phase === 'countdown',
    phase === 'ready',
  );

  // ── Audio mute toggle ───────────────────────────────────────────
  const [audioMuted, setAudioMutedState] = useState(isAudioMuted());
  const toggleMute = () => {
    const n = !audioMuted;
    setAudioMutedState(n);
    setAudioMuted(n);
  };

  // ── TTS for voice coaching ──────────────────────
  const { isTTSAvailable } = useWorkoutTTS({
    phase,
    current,
    next,
    isMuted: audioMuted,
    currentIndex,
    total,
    timeLeft,
    currentDuration: current?.duration ?? 0,
  });

  const showTTSWarning = !isTTSAvailable && !audioMuted;

  // ── Offline resilience ─────────────────────────────
  const { isOffline, queueSize } = useNetworkStatus();

  // ── Movement swap ─────────────────────────────
  const {
    showSwap, alternatives, loadingAlts,
    openSwap, closeSwap, swapMovement, getSwapLog,
  } = useMovementSwap(flatMovements, currentIndex, setFlatOverride);
  const [swapReason, setSwapReason] = useState('');

  // ── Landscape / wide-screen detection ─────────────────────────────────
  const { width: winW, height: winH } = useWindowDimensions();
  const dimsValid = winW > 0 && winH > 0;
  const isLandscape = dimsValid ? winW > winH : false;
  const isTablet = dimsValid ? Math.min(winW, winH) >= 600 : false;
  // Portrait column: on wide screens, constrain to 9:16 within 430px max
  const isWideScreen = dimsValid && winW > 500;
  const portraitW = isWideScreen ? Math.min(PORTRAIT_MAX_W, winH * (9 / 16)) : winW;
  const portraitH = isWideScreen ? winH : winH;

  // ── Video ref ────────────────────────────────
  const videoRef = useRef<any>(null);

  useEffect(() => {
    if (!videoRef.current) return;
    if (isPaused) {
      videoRef.current.pauseAsync?.().catch(() => {});
    } else if (phase === 'work' || phase === 'rest') {
      videoRef.current.playAsync?.().catch(() => {});
    }
  }, [isPaused, phase]);

  // ── Tap-to-show controls ──────────────────────────────
  const [showControls, setShowControls] = useState(false);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [videoReady, setVideoReady] = useState(false);

  // ── Playback speed ────────────────────────────
  const { speed, speedLabel, cycleSpeed } = usePlaybackSpeed(current?.id);

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

  useEffect(() => { setVideoReady(false); }, [currentIndex]);
  useEffect(() => { setShowControls(false); }, [currentIndex]);
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

  // ── Count exercise steps for progress display ─────────────────────
  const exerciseSteps = flatMovements.filter(f => f.stepType === 'exercise');
  const exerciseIndex = exerciseSteps.indexOf(current as any);
  const exerciseTotal = exerciseSteps.length;

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
          {showTTSWarning && (
            <View style={st.ttsWarning}>
              <Icon name="alert-triangle" size={12} color="#E06B4F" />
              <Text style={st.ttsWarningText}>No TTS</Text>
            </View>
          )}
          <TouchableOpacity onPress={toggleMute} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name={audioMuted ? 'volume-x' : 'volume-2'} size={22} color="#8A95A3" />
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
  const renderNextUp = () => {
    if (!next) return null;
    const nextLabel = next.stepType === 'exercise' ? next.name
      : next.originalBlockType || next.name;
    return (
      <View style={st.nextUpBar}>
        <Text style={st.nextUpLabel}>NEXT UP</Text>
        <View style={st.nextUpContent}>
          {next.thumbnailUrl ? (
            <Image source={{ uri: next.thumbnailUrl }} style={st.nextUpThumb} resizeMode="cover" />
          ) : (
            <View style={[st.nextUpThumb, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A2035' }]}>
              <Icon name={
                next.stepType === 'waterBreak' ? 'droplet' :
                next.stepType === 'transition' ? 'arrow-right' :
                next.stepType === 'grabEquipment' ? 'briefcase' :
                next.stepType === 'demo' ? 'eye' :
                'play-circle'
              } size={20} color="#3A4050" />
            </View>
          )}
          <View style={st.nextUpInfo}>
            <Text style={st.nextUpName} numberOfLines={1}>{nextLabel}</Text>
            <Text style={st.nextUpMeta}>
              {next.blockName}{next.duration ? ` · ${next.duration}s` : ''}
            </Text>
          </View>
        </View>
      </View>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <View style={st.portraitLockOuter}>
      <View style={[st.container, isWideScreen && { width: portraitW, maxWidth: portraitW }]}>

        {/* ── READY state ─────────────────────────────────────── */}
        {phase === 'ready' && (
          <>
            {renderHeader(false)}
            <View style={st.centerContent}>
              {isPreview && (
                <View style={st.previewBadge}>
                  <Icon name="eye" size={14} color="#F5A623" />
                  <Text style={st.previewBadgeText}>COACH PREVIEW</Text>
                </View>
              )}
              <Image
                source={require('../assets/logo.png')}
                style={st.readyLogo}
                resizeMode="contain"
              />
              <Text style={st.readyTitle}>{workout?.name ?? 'Workout'}</Text>
              <Text style={st.readyMeta}>
                {exerciseTotal} movement{exerciseTotal !== 1 ? 's' : ''} ·{' '}
                {workout?.blocks?.length ?? 0} block{(workout?.blocks?.length ?? 0) !== 1 ? 's' : ''}
              </Text>
              <TouchableOpacity style={st.bigStartBtn} onPress={handleStart}>
                <Icon name="play" size={36} color="#0E1117" />
                <Text style={st.bigStartText}>{isPreview ? 'Start Preview' : 'Start'}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

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
                    source={{ uri: introVideoUrl }}
                    resizeMode={ResizeMode.COVER}
                    isLooping
                    shouldPlay
                    isMuted
                    style={StyleSheet.absoluteFillObject}
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
                <View style={st.goldTimerBox}>
                  <Text style={st.goldTimerText}>{timeLeft}</Text>
                </View>
                <TouchableOpacity style={[st.skipPill, { marginTop: 16 }]} onPress={handleSkip}>
                  <Icon name="skip-forward" size={16} color="#F5A623" />
                  <Text style={st.skipPillText}>Skip</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })()}

        {/* ── OUTRO — Cinematic completion ────────────────────── */}
        {phase === 'outro' && current && (
          <View style={st.introOutroContainer}>
            {current.videoUrl ? (
              <Video
                source={{ uri: current.videoUrl }}
                resizeMode={ResizeMode.COVER}
                isLooping
                shouldPlay
                isMuted
                style={StyleSheet.absoluteFillObject}
              />
            ) : null}
            <View style={[st.introOutroGradient, current.videoUrl && { backgroundColor: 'rgba(14,17,23,0.6)' }]}>
              <Image
                source={require('../assets/logo.png')}
                style={{ width: 280, height: 90, marginBottom: 16 }}
                resizeMode="contain"
              />
              <Text style={st.outroTitle}>WORKOUT</Text>
              <View style={st.goldTimerBox}>
                <Text style={st.goldTimerText}>{timeLeft}</Text>
              </View>
              <TouchableOpacity style={st.skipPill} onPress={handleSkip}>
                <Icon name="skip-forward" size={16} color="#F5A623" />
                <Text style={st.skipPillText}>Skip</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── DEMO — Preview upcoming movements ───────────────── */}
        {phase === 'demo' && current && (() => {
          const demos = current.demoMovements || [];
          const cols = demos.length <= 4 ? 2 : 3;
          return (
            <>
              {renderHeader()}
              <View style={st.specialContent}>
                {/* GoArrive Logo */}
                <Image
                  source={require('../assets/logo.png')}
                  style={{ width: 200, height: 56, marginBottom: 12 }}
                  resizeMode="contain"
                />
                {/* Block title + timer row */}
                <View style={st.demoTitleRow}>
                  <Text style={st.demoBlockTitle}>{current.name}</Text>
                  <View style={st.goldTimerBox}>
                    <Text style={st.goldTimerText}>{timeLeft}</Text>
                  </View>
                </View>
                {/* Thumbnail grid */}
                <View style={st.demoGrid}>
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
                <TouchableOpacity style={[st.skipPill, { marginTop: 'auto' as any, marginBottom: 24 }]} onPress={handleSkip}>
                  <Icon name="skip-forward" size={16} color="#F5A623" />
                  <Text style={st.skipPillText}>Skip</Text>
                </TouchableOpacity>
              </View>
            </>
          );
        })()}

        {/* ── TRANSITION — Instruction card with countdown ─────── */}
        {phase === 'transition' && current && (
          <>
            {renderHeader()}
            <View style={st.specialContent}>
              <View style={[st.specialIconCircle, { backgroundColor: 'rgba(148,163,184,0.15)' }]}>
                <Icon name="arrow-right" size={32} color="#94A3B8" />
              </View>
              <Text style={[st.specialPhaseLabel, { color: '#94A3B8' }]}>TRANSITION</Text>
              <Text style={st.specialTitle}>{current.name}</Text>
              {current.instructionText || current.description ? (
                <Text style={st.transitionInstruction}>
                  {current.instructionText || current.description}
                </Text>
              ) : null}

              <View style={st.specialTimerRow}>
                <View style={st.goldTimerBox}>
                  <Text style={st.goldTimerText}>{formatTime(timeLeft)}</Text>
                </View>
                <TouchableOpacity style={[st.skipPill, { marginTop: 8 }]} onPress={handleSkip}>
                  <Icon name="skip-forward" size={16} color="#F5A623" />
                  <Text style={st.skipPillText}>Skip</Text>
                </TouchableOpacity>
              </View>

              {renderNextUp()}
            </View>
          </>
        )}

        {/* ── GRAB EQUIPMENT — Equipment preparation ─────────── */}
        {phase === 'grabEquipment' && current && (
          <>
            {renderHeader()}
            <View style={st.specialContent}>
              <View style={[st.specialIconCircle, { backgroundColor: 'rgba(251,146,60,0.15)' }]}>
                <Icon name="briefcase" size={32} color="#FB923C" />
              </View>
              <Text style={[st.specialPhaseLabel, { color: '#FB923C' }]}>GRAB EQUIPMENT</Text>
              <Text style={st.specialTitle}>{current.name}</Text>
              {current.instructionText || current.description ? (
                <Text style={st.transitionInstruction}>
                  {current.instructionText || current.description}
                </Text>
              ) : null}

              <View style={st.specialTimerRow}>
                <View style={st.goldTimerBox}>
                  <Text style={st.goldTimerText}>{formatTime(timeLeft)}</Text>
                </View>
                <TouchableOpacity style={[st.skipPill, { marginTop: 8 }]} onPress={handleSkip}>
                  <Icon name="skip-forward" size={16} color="#F5A623" />
                  <Text style={st.skipPillText}>Skip</Text>
                </TouchableOpacity>
              </View>

              {renderNextUp()}
            </View>
          </>
        )}

        {/* ── WATER BREAK — Hydration pause ───────────────────── */}
        {phase === 'waterBreak' && current && (
          <View style={st.workContainer}>
            {renderHeader()}
            {/* Header row: WATER BREAK label + timer */}
            <View style={st.nameTimerRow}>
              <View style={st.nameColumn}>
                <Text style={st.waterBreakLabel}>WATER BREAK</Text>
              </View>
              <View style={st.goldTimerBox}>
                <Text style={st.goldTimerText}>{formatTime(timeLeft)}</Text>
              </View>
            </View>

            {/* 4:5 video area with blue tint */}
            <View style={st.videoArea}>
              <View style={st.videoInner}>
                {current.videoUrl ? (
                  <Video
                    key={`wb-${currentIndex}`}
                    source={{ uri: current.videoUrl }}
                    resizeMode={ResizeMode.COVER}
                    isLooping
                    shouldPlay
                    isMuted
                    style={st.videoPlayer}
                    videoStyle={
                      Platform.OS === 'web'
                        ? ({ width: '100%', height: '100%', objectFit: 'cover' } as any)
                        : undefined
                    }
                  />
                ) : (
                  <View style={[st.videoPlayer, { backgroundColor: 'rgba(56,189,248,0.15)' }]}>
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

            <TouchableOpacity style={[st.skipPill, { alignSelf: 'center', marginTop: 12 }]} onPress={handleSkip}>
              <Icon name="skip-forward" size={16} color="#F5A623" />
              <Text style={st.skipPillText}>Skip</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── COUNTDOWN state ─────────────────────────────────── */}
        {phase === 'countdown' && current && (
          <>
            {renderHeader()}
            <View style={st.centerContent}>
              <Text style={st.phaseLabel}>GET READY</Text>
              <Text style={st.countdownNum}>{timeLeft}</Text>
              <Text style={st.upNextName}>{current.name}</Text>
              {current.description ? (
                <Text style={st.cues} numberOfLines={2}>{current.description}</Text>
              ) : null}
            </View>
          </>
        )}

        {/* ── WORK state — Stacked layout ──────────────────── */}
        {phase === 'work' && current && (
          <View style={st.workContainer}>
            {/* Floating header overlay */}
            {showControls && (
              <View style={st.floatingHeader}>
                <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                  <Icon name="close" size={24} color="#8A95A3" />
                </TouchableOpacity>
                <Text style={st.floatingWorkoutName} numberOfLines={1}>
                  {workout?.name ?? 'Workout'}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <TouchableOpacity onPress={toggleMute} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                    <Icon name={audioMuted ? 'volume-x' : 'volume-2'} size={18} color="#8A95A3" />
                  </TouchableOpacity>
                  <Text style={st.floatingProgress}>
                    {currentIndex + 1}/{total}
                  </Text>
                </View>
              </View>
            )}

            {/* GoArrive logo */}
            <Image
              source={require('../assets/logo.png')}
              style={st.workLogo}
              resizeMode="contain"
            />

            {/* Movement name + Timer */}
            <View style={st.nameTimerRow}>
              <View style={st.nameColumn}>
                {current.supersetLabel && (
                  <Text style={st.supersetLabel}>{current.supersetLabel}</Text>
                )}
                <Text style={st.workMovementName} numberOfLines={2}>
                  {current.name}
                </Text>
                {current.reps ? (
                  <Text style={st.workReps}>{current.reps} reps</Text>
                ) : null}
                {current.coachingCues ? (
                  <Text style={st.workCues} numberOfLines={1}>{current.coachingCues}</Text>
                ) : null}
              </View>
              {!isRepBased ? (
                <View style={st.goldTimerBox}>
                  <Text style={st.goldTimerText}>{formatTime(timeLeft)}</Text>
                </View>
              ) : null}
            </View>

            {/* SPLIT label */}
            {current.swapSides && (
              <View style={st.splitLabelRow}>
                <Text style={st.splitText}>SPLIT</Text>
                <Text style={st.splitSep}> | </Text>
                <Text style={st.splitDuration}>5 sec</Text>
                <Text style={st.splitArrows}> ⇄</Text>
              </View>
            )}

            {/* Video area */}
            {(() => {
              // At 3.5s before end, switch to next movement's video
              const nextExercise = next?.stepType === 'exercise' ? next : null;
              const showNextVideo = !isRepBased && timeLeft <= 4 && nextExercise?.videoUrl;
              const activeVideoUrl = showNextVideo ? nextExercise!.videoUrl : current.videoUrl;
              const activeThumbUrl = showNextVideo ? nextExercise!.thumbnailUrl : current.thumbnailUrl;
              const videoKey = showNextVideo ? `next-${currentIndex}` : `current-${currentIndex}`;
              return (
            <View style={st.videoArea}>
              <TouchableWithoutFeedback onPress={handleVideoTap}>
                <View style={st.videoInner}>
                  {activeVideoUrl ? (
                    <>
                      <Video
                        key={videoKey}
                        ref={showNextVideo ? undefined : videoRef}
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
                        onReadyForDisplay={() => setVideoReady(true)}
                      />
                      {!videoReady && activeThumbUrl && (
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

                  <TouchableOpacity
                    style={st.tapInterceptor}
                    onPress={handleVideoTap}
                    activeOpacity={1}
                  />

                  {showControls && (
                    <View style={st.controlsOverlay}>
                      {isRepBased ? (
                        <TouchableOpacity style={st.overlayCenterBtn} onPress={handleRepDone}>
                          <Icon name="check" size={32} color="#0E1117" />
                          <Text style={st.overlayDoneBtnText}>Done</Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity style={st.overlayCenterBtn} onPress={handlePauseResume}>
                          <Icon name={isPaused ? 'play' : 'pause'} size={32} color="#0E1117" />
                        </TouchableOpacity>
                      )}
                      <View style={st.overlaySecondaryRow}>
                        <TouchableOpacity style={st.overlaySkipBtn} onPress={handleSkip}>
                          <Icon name="skip-forward" size={18} color="#F5A623" />
                          <Text style={st.overlaySkipText}>Skip</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={st.overlaySwapBtn} onPress={openSwap}>
                          <Icon name="refresh-cw" size={14} color="#F5A623" />
                          <Text style={st.overlaySwapText}>Swap Movement</Text>
                        </TouchableOpacity>
                      </View>
                      <View style={st.speedRow}>
                        <TouchableOpacity
                          style={st.speedBtn}
                          onPress={cycleSpeed}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={st.speedBtnText}>{speedLabel}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              </TouchableWithoutFeedback>
            </View>
              );
            })()}

            {/* NEXT UP bar — show in final 4 seconds */}
            {(isRepBased || timeLeft <= 4) && renderNextUp()}
          </View>
        )}

        {/* ── REST state — show next movement video ──────────── */}
        {phase === 'rest' && (() => {
          // Find the next exercise step for video preview (skip special blocks)
          const nextExForRest = (() => {
            for (let i = currentIndex + 1; i < flatMovements.length; i++) {
              if (flatMovements[i].stepType === 'exercise') return flatMovements[i];
            }
            return next; // fallback to whatever is next
          })();
          const restVideoUrl = nextExForRest?.videoUrl || current?.videoUrl;
          const restThumbUrl = nextExForRest?.thumbnailUrl || current?.thumbnailUrl;
          return (
          <View style={st.workContainer}>
            {renderHeader()}
            {/* REST label + white timer */}
            <View style={st.nameTimerRow}>
              <View style={st.nameColumn}>
                <Text style={st.restPhaseLabel}>REST</Text>
                {nextExForRest && <Text style={st.restNextName}>Next: {nextExForRest.name}</Text>}
              </View>
              <View style={st.restTimerBox}>
                <Text style={st.restTimerText}>{formatTime(timeLeft)}</Text>
              </View>
            </View>

            {/* Next movement video preview */}
            <View style={st.videoArea}>
              <View style={st.videoInner}>
                {restVideoUrl ? (
                  <Video
                    key={`rest-${currentIndex}`}
                    source={{ uri: restVideoUrl }}
                    resizeMode={ResizeMode.COVER}
                    isLooping
                    shouldPlay
                    isMuted
                    style={st.videoPlayer}
                    videoStyle={
                      Platform.OS === 'web'
                        ? ({ width: '100%', height: '100%', objectFit: 'cover' } as any)
                        : undefined
                    }
                  />
                ) : restThumbUrl ? (
                  <Image source={{ uri: restThumbUrl }} style={st.videoPlayer} resizeMode="cover" />
                ) : (
                  <View style={[st.videoPlayer, st.videoPlaceholder]}>
                    <Icon name="play-circle" size={48} color="#3A4050" />
                  </View>
                )}
              </View>
            </View>

            <TouchableOpacity style={[st.skipPill, { alignSelf: 'center', marginTop: 12 }]} onPress={handleSkip}>
              <Icon name="skip-forward" size={16} color="#F5A623" />
              <Text style={st.skipPillText}>Skip Rest</Text>
            </TouchableOpacity>
          </View>
          );
        })()}

        {/* ── SWAP state ──────────────────────────────────────── */}
        {phase === 'swap' && current && (
          <>
            {renderHeader()}
            <View style={st.centerContent}>
              <Text style={st.phaseLabel}>SWITCH SIDES</Text>
              <View style={st.sideBadge}>
                <Text style={st.sideBadgeText}>RIGHT SIDE</Text>
              </View>
              <Text style={st.countdownNum}>{timeLeft}</Text>
              <Text style={st.movementName}>{current.name}</Text>
            </View>
          </>
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

const PORTRAIT_MAX_W = 430;

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

  // ── Skip pill (shared by special blocks) ───────────────────────────
  skipPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 16,
    borderRadius: 20, borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.3)',
    marginTop: 8,
  },
  skipPillText: {
    fontSize: 14, fontWeight: '600', color: '#F5A623', fontFamily: FH,
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
    fontSize: 22, fontWeight: '700', color: '#F0F4F8', fontFamily: FH, flex: 1, marginRight: 12,
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
    fontSize: 20, fontWeight: '700', color: '#38BDF8', fontFamily: FH, letterSpacing: 2,
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

  // Phase labels
  phaseLabel: {
    fontSize: 16, fontWeight: '700', color: '#F5A623', fontFamily: FH,
    letterSpacing: 2, marginBottom: 16,
  },
  blockLabel: {
    fontSize: 14, fontWeight: '600', color: '#8A95A3', fontFamily: FB,
    marginBottom: 8,
  },

  // Floating header
  floatingHeader: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.select({ ios: 8, android: 4, web: 8, default: 8 }),
    paddingBottom: 6,
    backgroundColor: 'rgba(14,17,23,0.85)',
    zIndex: 50,
  } as any,
  floatingWorkoutName: {
    flex: 1, textAlign: 'center', color: '#8A95A3',
    fontSize: 13, fontWeight: '600', fontFamily: FB, marginHorizontal: 8,
  },
  floatingProgress: {
    color: '#F5A623', fontSize: 13, fontWeight: '700', fontFamily: FH,
  },

  // WORK phase
  workContainer: {
    flex: 1, paddingHorizontal: 4, paddingTop: 8,
    paddingBottom: Platform.select({ ios: 34, android: 16, web: 16, default: 16 }),
  },
  workLogo: { width: 260, height: 72, alignSelf: 'center', marginBottom: 6 },
  nameTimerRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 8,
  },
  nameColumn: { flex: 1, marginRight: 12 },
  supersetLabel: {
    fontSize: 13, fontWeight: '700', color: '#F5A623', fontFamily: FH,
    letterSpacing: 1, marginBottom: 2,
  },
  workMovementName: {
    fontSize: 26, fontWeight: '700', color: '#FFFFFF', fontFamily: FH,
  },
  workReps: {
    fontSize: 17, fontWeight: '600', color: '#F5A623', fontFamily: FH, marginTop: 2,
  },
  workCues: {
    fontSize: 13, color: '#8A95A3', fontFamily: FB, marginTop: 2,
  },
  workTimer: {
    fontSize: 80, fontWeight: '700', color: '#FFFFFF', fontFamily: FH, lineHeight: 80,
  },
  // Gold timer box (used across all screens)
  goldTimerBox: {
    backgroundColor: '#F5A623',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  goldTimerText: {
    fontSize: 48,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FH,
    lineHeight: 52,
  },
  // REST phase styles
  restPhaseLabel: {
    fontSize: 16, fontWeight: '700', color: '#8A95A3', fontFamily: FH,
    letterSpacing: 2,
  },
  restNextName: {
    fontSize: 20, fontWeight: '700', color: '#F0F4F8', fontFamily: FH, marginTop: 2,
  },
  restTimerBox: {
    backgroundColor: '#1A2035',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  restTimerText: {
    fontSize: 48,
    fontWeight: '700',
    color: '#FFFFFF',
    fontFamily: FH,
    lineHeight: 52,
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
  videoPlaceholder: {
    justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A1E26',
  },
  posterFallback: {
    ...StyleSheet.absoluteFillObject, backgroundColor: '#000000',
  } as any,

  tapInterceptor: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent', zIndex: 5,
  } as any,

  controlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', zIndex: 15,
  } as any,
  overlayCenterBtn: {
    position: 'absolute' as any, top: '50%' as any, left: '50%' as any,
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: '#F5A623', justifyContent: 'center', alignItems: 'center',
    marginTop: -36, marginLeft: -36, zIndex: 2,
  },
  overlaySecondaryRow: {
    position: 'absolute' as any, top: '50%' as any, left: 0, right: 0,
    marginTop: 48, flexDirection: 'row', justifyContent: 'center',
    alignItems: 'center', gap: 16,
  },
  overlayDoneBtnText: {
    fontSize: 14, fontWeight: '700', color: '#0E1117', fontFamily: FH, marginTop: 2,
  },
  overlaySkipBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 10, paddingHorizontal: 14,
  },
  overlaySkipText: {
    fontSize: 15, fontWeight: '600', color: '#F5A623', fontFamily: FH,
  },
  overlaySwapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 8, paddingHorizontal: 14,
    borderRadius: 16, borderWidth: 1, borderColor: 'rgba(245,166,35,0.4)',
  },
  overlaySwapText: {
    fontSize: 13, color: '#F5A623', fontFamily: FB, fontWeight: '600',
  },

  // Playback speed
  speedRow: { position: 'absolute' as any, bottom: 16, right: 16 },
  speedBtn: {
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingVertical: 5, paddingHorizontal: 12, borderRadius: 10,
  },
  speedBtnText: {
    color: '#FFFFFF', fontSize: 13, fontWeight: '700' as any, fontFamily: 'Archivo',
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

  // Next up
  nextUpBar: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16,
    marginTop: 10, alignItems: 'center', width: '100%',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    alignSelf: 'center',
  },
  nextUpLabel: {
    fontSize: 11, fontWeight: '700', color: '#8A95A3', fontFamily: FH,
    letterSpacing: 1, marginBottom: 4,
  },
  nextUpContent: {
    flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%',
  },
  nextUpThumb: { width: 60, height: 75, borderRadius: 8, backgroundColor: '#1A2035' },
  nextUpInfo: { flex: 1 },
  nextUpName: {
    fontSize: 16, fontWeight: '600', color: '#F0F4F8', fontFamily: FH,
  },
  nextUpMeta: {
    fontSize: 12, color: '#8A95A3', fontFamily: FB, marginTop: 2,
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
    padding: 20, maxHeight: '60%',
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
