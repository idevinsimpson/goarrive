/**
 * MovementVideoControls — Enhanced video playback controls
 *
 * Wraps expo-av Video with:
 *   - Playback speed selector (0.5x, 1x, 1.5x)
 *   - Loop toggle (on by default for movement demos)
 *   - Scrub bar (seek to position)
 *   - Fullscreen toggle
 *   - Play/pause overlay
 *
 * The 4:5 frame is enforced via onLayout measurement + explicit pixel height.
 * This is the most reliable cross-platform approach — RN's aspectRatio style
 * can be overridden by Video's intrinsic content size on iOS native.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Platform,
  LayoutChangeEvent,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Icon } from './Icon';
import { useSeamlessLoop } from '../hooks/useSeamlessLoop';

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const SPEED_OPTIONS = [0.5, 1, 1.5] as const;

/** 4:5 means for every 4 units wide, 5 units tall → height = width × (5/4) */
const ASPECT_MULTIPLIER = 5 / 4; // 1.25

interface MovementVideoControlsProps {
  uri: string;
  /** Poster/thumbnail image to show before playback */
  posterUri?: string;
  /** Fallback height when aspectRatio is not set */
  height?: number;
  /** Whether to auto-play on mount */
  autoPlay?: boolean;
  /** Whether to show controls overlay */
  showControls?: boolean;
  /** Lock the video frame to a specific aspect ratio (e.g. 4/5). */
  aspectRatio?: number;
  /** Non-destructive crop: scale factor (1 = no zoom) */
  cropScale?: number;
  /** Non-destructive crop: horizontal offset in px */
  cropTranslateX?: number;
  /** Non-destructive crop: vertical offset in px */
  cropTranslateY?: number;
}

export default function MovementVideoControls({
  uri,
  posterUri,
  height = 240,
  autoPlay = false,
  showControls = true,
  aspectRatio,
  cropScale = 1,
  cropTranslateX = 0,
  cropTranslateY = 0,
}: MovementVideoControlsProps) {
  const videoRef = useRef<Video>(null);
  const containerRef = useRef<View>(null);

  // ── Seamless looping (web only) ─────────────────────────────────────
  // Eliminates the pause/gap at loop transitions by using a dual-video
  // swap technique. On native platforms, expo-av's built-in loop is fine.
  useSeamlessLoop(containerRef, uri, cropScale, cropTranslateX, cropTranslateY);

  // ── Bulletproof 4:5 sizing via onLayout ──────────────────────────────
  // We measure the container's actual rendered width, then compute
  // height = width × multiplier. This works on every platform because
  // it uses explicit pixel values, not aspectRatio style.
  const [measuredHeight, setMeasuredHeight] = useState<number | null>(null);

  const onContainerLayout = useCallback(
    (e: LayoutChangeEvent) => {
      if (!aspectRatio) return; // only compute when ratio is requested
      const w = e.nativeEvent.layout.width;
      if (w > 0) {
        const multiplier = 1 / aspectRatio; // aspectRatio = w/h → h = w / aspectRatio = w × (1/aspectRatio)
        const h = Math.round(w * multiplier);
        setMeasuredHeight(h);
      }
    },
    [aspectRatio],
  );

  // Determine the video area height
  const videoAreaHeight = aspectRatio
    ? measuredHeight ?? 0 // 0 until measured (invisible until first layout)
    : height;

  // ── Playback state ──────────────────────────────────────────────────
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isLooping, setIsLooping] = useState(true);
  const [speed, setSpeed] = useState<number>(1);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showOverlay, setShowOverlay] = useState(!autoPlay);

  const onPlaybackStatusUpdate = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    setIsPlaying(status.isPlaying);
    setPosition(status.positionMillis || 0);
    setDuration(status.durationMillis || 0);
  }, []);

  // ── Controls ─────────────────────────────────────────────────────────
  const togglePlay = useCallback(async () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      await videoRef.current.pauseAsync();
    } else {
      await videoRef.current.playAsync();
    }
    setShowOverlay(false);
  }, [isPlaying]);

  const toggleLoop = useCallback(async () => {
    const newLoop = !isLooping;
    setIsLooping(newLoop);
    if (videoRef.current) {
      await videoRef.current.setIsLoopingAsync(newLoop);
    }
  }, [isLooping]);

  const cycleSpeed = useCallback(async () => {
    const currentIdx = SPEED_OPTIONS.indexOf(
      speed as (typeof SPEED_OPTIONS)[number],
    );
    const nextIdx = (currentIdx + 1) % SPEED_OPTIONS.length;
    const newSpeed = SPEED_OPTIONS[nextIdx];
    setSpeed(newSpeed);
    if (videoRef.current) {
      await videoRef.current.setRateAsync(newSpeed, true);
    }
  }, [speed]);

  const seekTo = useCallback(
    async (pct: number) => {
      if (!videoRef.current || duration === 0) return;
      const posMs = Math.round(pct * duration);
      await videoRef.current.setPositionAsync(posMs);
    },
    [duration],
  );

  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (Platform.OS === 'web') {
        const containerEl = containerRef.current as any;
        const domNode =
          containerEl?._nativeTag || containerEl?.getNode?.() || containerEl;
        if (domNode && typeof domNode.requestFullscreen === 'function') {
          if (!document.fullscreenElement) {
            await domNode.requestFullscreen();
            setIsFullscreen(true);
          } else {
            await document.exitFullscreen?.();
            setIsFullscreen(false);
          }
        } else {
          const videoEl =
            (videoRef.current as any)?._nativeRef?.current ||
            (videoRef.current as any);
          if (videoEl && typeof videoEl.requestFullscreen === 'function') {
            await videoEl.requestFullscreen();
            setIsFullscreen(true);
          }
        }
      } else {
        if (!videoRef.current) return;
        if (isFullscreen) {
          await videoRef.current.dismissFullscreenPlayer();
        } else {
          await videoRef.current.presentFullscreenPlayer();
        }
        setIsFullscreen(!isFullscreen);
      }
    } catch {
      // Fullscreen not supported — silent fail
    }
  }, [isFullscreen]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = () => {
      if (!document.fullscreenElement) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // ── Format time ──────────────────────────────────────────────────────
  const formatMs = (ms: number): string => {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const progressPct = duration > 0 ? position / duration : 0;

  // Build crop transform if any crop values are set
  const hasCrop =
    cropScale !== 1 || cropTranslateX !== 0 || cropTranslateY !== 0;
  const cropTransform = hasCrop
    ? {
        transform: [
          { scale: cropScale },
          { translateX: cropTranslateX },
          { translateY: cropTranslateY },
        ],
      }
    : undefined;

  return (
    <View
      ref={containerRef}
      onLayout={onContainerLayout}
      style={[
        st.container,
        aspectRatio
          ? { width: '100%' as const }
          : { height },
      ]}
    >
      {/* Video area — explicit pixel height enforces 4:5 */}
      <View style={[st.videoArea, { height: videoAreaHeight }]}>
        <Pressable
          onPress={() => setShowOverlay((o) => !o)}
          style={StyleSheet.absoluteFill}
        >
          <Video
            ref={videoRef}
            source={{ uri }}
            posterSource={posterUri ? { uri: posterUri } : undefined}
            usePoster={!!posterUri}
            resizeMode={ResizeMode.COVER}
            isLooping={isLooping}
            shouldPlay={autoPlay}
            isMuted
            style={[st.video, cropTransform]}
            videoStyle={
              Platform.OS === 'web'
                ? ({ width: '100%', height: '100%' } as any)
                : undefined
            }
            onPlaybackStatusUpdate={onPlaybackStatusUpdate}
          />

          {/* Play/pause overlay */}
          {showOverlay && (
            <Pressable style={st.playOverlay} onPress={togglePlay}>
              <View style={st.playCircle}>
                <Icon
                  name={isPlaying ? 'pause' : 'play'}
                  size={28}
                  color="#F0F4F8"
                />
              </View>
            </Pressable>
          )}
        </Pressable>
      </View>

      {/* Controls bar */}
      {showControls && (
        <View style={st.controlsBar}>
          {/* Play/pause */}
          <TouchableOpacity onPress={togglePlay} style={st.controlBtn}>
            <Icon
              name={isPlaying ? 'pause' : 'play'}
              size={16}
              color="#F0F4F8"
            />
          </TouchableOpacity>

          {/* Progress bar */}
          <TouchableOpacity
            style={st.progressBar}
            activeOpacity={0.9}
            onPress={(e) => {
              const x = (e.nativeEvent as any).locationX || 0;
              const width = 180;
              seekTo(Math.max(0, Math.min(1, x / width)));
            }}
          >
            <View style={st.progressTrack}>
              <View
                style={[
                  st.progressFill,
                  { width: `${progressPct * 100}%` },
                ]}
              />
            </View>
          </TouchableOpacity>

          {/* Time */}
          <Text style={st.timeText}>
            {formatMs(position)} / {formatMs(duration)}
          </Text>

          {/* Speed */}
          <TouchableOpacity onPress={cycleSpeed} style={st.controlBtn}>
            <Text style={st.speedText}>{speed}x</Text>
          </TouchableOpacity>

          {/* Loop */}
          <TouchableOpacity onPress={toggleLoop} style={st.controlBtn}>
            <Icon
              name="repeat"
              size={14}
              color={isLooping ? '#F5A623' : '#4A5568'}
            />
          </TouchableOpacity>

          {/* Fullscreen */}
          <TouchableOpacity onPress={toggleFullscreen} style={st.controlBtn}>
            <Icon
              name={isFullscreen ? 'minimize' : 'maximize'}
              size={14}
              color="#F0F4F8"
            />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  container: {
    backgroundColor: '#000',
    borderRadius: 10,
    overflow: 'hidden',
  },
  videoArea: {
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  video: {
    ...StyleSheet.absoluteFillObject,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  playCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(14,17,23,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(245,166,35,0.5)',
  },
  controlsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111827',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 6,
  },
  controlBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressBar: {
    flex: 1,
    height: 28,
    justifyContent: 'center',
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#1E2A3A',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#F5A623',
    borderRadius: 2,
  },
  timeText: {
    fontSize: 10,
    color: '#8A95A3',
    fontFamily: FB,
    minWidth: 60,
    textAlign: 'center',
  },
  speedText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
  },
});
