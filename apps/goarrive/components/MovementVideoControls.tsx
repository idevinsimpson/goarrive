/**
 * MovementVideoControls — Enhanced video playback controls (Suggestion 9)
 *
 * Wraps expo-av Video with:
 *   - Playback speed selector (0.5x, 1x, 1.5x)
 *   - Loop toggle (on by default for movement demos)
 *   - Scrub bar (seek to position)
 *   - Fullscreen toggle
 *   - Play/pause overlay
 *
 * Designed for use in MovementForm preview and the WorkoutPlayer
 * movement detail view. Follows G➲A design system.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  Dimensions,
} from 'react-native';
import { Video, ResizeMode, AVPlaybackStatus } from 'expo-av';
import { Icon } from './Icon';

const FH =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const SPEED_OPTIONS = [0.5, 1, 1.5] as const;

interface MovementVideoControlsProps {
  uri: string;
  /** Poster/thumbnail image to show before playback */
  posterUri?: string;
  /** Height of the video container */
  height?: number;
  /** Whether to auto-play on mount */
  autoPlay?: boolean;
  /** Whether to show controls overlay */
  showControls?: boolean;
}

export default function MovementVideoControls({
  uri,
  posterUri,
  height = 240,
  autoPlay = false,
  showControls = true,
}: MovementVideoControlsProps) {
  const videoRef = useRef<Video>(null);
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [isLooping, setIsLooping] = useState(true);
  const [speed, setSpeed] = useState<number>(1);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showOverlay, setShowOverlay] = useState(!autoPlay);

  // ── Playback status updates ──────────────────────────────────────────
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
    const currentIdx = SPEED_OPTIONS.indexOf(speed as typeof SPEED_OPTIONS[number]);
    const nextIdx = (currentIdx + 1) % SPEED_OPTIONS.length;
    const newSpeed = SPEED_OPTIONS[nextIdx];
    setSpeed(newSpeed);
    if (videoRef.current) {
      await videoRef.current.setRateAsync(newSpeed, true);
    }
  }, [speed]);

  const seekTo = useCallback(async (pct: number) => {
    if (!videoRef.current || duration === 0) return;
    const posMs = Math.round(pct * duration);
    await videoRef.current.setPositionAsync(posMs);
  }, [duration]);

  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      if (Platform.OS === 'web') {
        // Web: use native Fullscreen API on the video element's parent
        const el = (videoRef.current as any)?._nativeRef?.current;
        if (el) {
          if (!document.fullscreenElement) {
            await el.requestFullscreen?.();
            setIsFullscreen(true);
          } else {
            await document.exitFullscreen?.();
            setIsFullscreen(false);
          }
        }
      } else {
        // Native: use expo-av's built-in fullscreen
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

  // ── Format time ──────────────────────────────────────────────────────
  const formatMs = (ms: number): string => {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const progressPct = duration > 0 ? position / duration : 0;

  return (
    <View style={[st.container, { height }]}>
      <TouchableOpacity
        activeOpacity={1}
        onPress={() => setShowOverlay((o) => !o)}
        style={st.videoWrap}
      >
        <Video
          ref={videoRef}
          source={{ uri }}
          posterSource={posterUri ? { uri: posterUri } : undefined}
          usePoster={!!posterUri}
          resizeMode={ResizeMode.CONTAIN}
          isLooping={isLooping}
          shouldPlay={autoPlay}
          isMuted
          style={st.video}
          onPlaybackStatusUpdate={onPlaybackStatusUpdate}
        />

        {/* Play/pause overlay */}
        {showOverlay && (
          <TouchableOpacity style={st.playOverlay} onPress={togglePlay}>
            <View style={st.playCircle}>
              <Icon name={isPlaying ? 'pause' : 'play'} size={28} color="#F0F4F8" />
            </View>
          </TouchableOpacity>
        )}
      </TouchableOpacity>

      {/* Controls bar */}
      {showControls && (
        <View style={st.controlsBar}>
          {/* Play/pause */}
          <TouchableOpacity onPress={togglePlay} style={st.controlBtn}>
            <Icon name={isPlaying ? 'pause' : 'play'} size={16} color="#F0F4F8" />
          </TouchableOpacity>

          {/* Progress bar */}
          <TouchableOpacity
            style={st.progressBar}
            activeOpacity={0.9}
            onPress={(e) => {
              const x = (e.nativeEvent as any).locationX || 0;
              const width = 180; // approximate
              seekTo(Math.max(0, Math.min(1, x / width)));
            }}
          >
            <View style={st.progressTrack}>
              <View style={[st.progressFill, { width: `${progressPct * 100}%` }]} />
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
  videoWrap: {
    flex: 1,
    position: 'relative',
  },
  video: {
    flex: 1,
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
