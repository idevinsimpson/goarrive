/**
 * MusicSettingsSheet — in-player workout music panel
 *
 * Opened from the header music button in WorkoutPlayer. Rendered as an
 * absolutely-positioned overlay INSIDE the player canvas (not a nested RN
 * Modal — nested modals are flaky on iOS and the player is already fullscreen).
 * Lives above the auto-hiding controls overlay and is independent of its 3s
 * hide timer.
 *
 * Everything here is presentation — all behavior lives in useWorkoutMusic.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Icon } from './Icon';
import { MUSIC_STYLE_OPTIONS, musicStyleLabel } from '../constants/musicStyles';

export interface MusicSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  /** WorkoutPlayer's canvas scaler. */
  fs: (n: number) => number;
  currentStyle: string;
  onChangeStyle: (v: string) => void;
  currentTrackIndex: number | null;
  trackStatus: 'idle' | 'loading' | 'playing' | 'stalled';
  musicMuted: boolean;
  onToggleMute: () => void;
  onSkipNext: () => void;
  onSkipBack: () => void;
  liked: boolean;
  disliked: boolean;
  onToggleLike: () => void;
  onToggleDislike: () => void;
  /** False for guests (no uid) — hides like/dislike. */
  canRate: boolean;
  volume: number;
  onVolumeChange: (v: number) => void;
  musicOff: boolean;
  onTurnOffForSession: () => void;
  onTurnMusicBackOn: () => void;
  /** Whether the workout has started (phase past 'ready'). */
  started: boolean;
}

// ── Animated 3-bar equalizer shown while music is audibly playing ───────────
function EqualizerBars({ active, fs }: { active: boolean; fs: (n: number) => number }) {
  const bars = useRef([new Animated.Value(0.4), new Animated.Value(0.7), new Animated.Value(0.5)]).current;

  useEffect(() => {
    if (!active) {
      bars.forEach((b) => b.stopAnimation());
      return;
    }
    const loops = bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 1,
            duration: 300 + i * 90,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(bar, {
            toValue: 0.3,
            duration: 340 + i * 70,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
        ])
      )
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [active, bars]);

  const maxH = fs(16);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: fs(2), height: maxH }}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={{
            width: fs(3),
            borderRadius: fs(1.5),
            backgroundColor: '#F5A623',
            height: bar.interpolate({ inputRange: [0, 1], outputRange: [fs(4), maxH] }),
          }}
        />
      ))}
    </View>
  );
}

export default function MusicSettingsSheet(props: MusicSettingsSheetProps) {
  const {
    visible, onClose, fs,
    currentStyle, onChangeStyle, currentTrackIndex, trackStatus,
    musicMuted, onToggleMute, onSkipNext, onSkipBack,
    liked, disliked, onToggleLike, onToggleDislike, canRate,
    volume, onVolumeChange,
    musicOff, onTurnOffForSession, onTurnMusicBackOn,
    started,
  } = props;

  const st = useMemo(() => makeStyles(fs), [fs]);

  if (!visible) return null;

  const transportEnabled = started && !musicOff;
  const rateEnabled = transportEnabled && currentTrackIndex != null;
  const volSegments = Math.round(volume * 10);

  let statusLine: string;
  if (musicOff) statusLine = 'Music is off for this workout';
  else if (!started) statusLine = 'Starts when you press play';
  else if (trackStatus === 'stalled') statusLine = 'Next track loading…';
  else if (trackStatus === 'loading') statusLine = 'Loading…';
  else if (trackStatus === 'idle') statusLine = 'Nothing playing';
  else if (musicMuted) statusLine = 'Muted';
  else statusLine = 'Now playing';

  return (
    <View style={st.root} pointerEvents="box-none">
      <Pressable style={st.backdrop} onPress={onClose} />
      <View style={st.card}>
        {/* Header */}
        <View style={st.headerRow}>
          <Text style={st.title}>Music</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Icon name="x" size={fs(20)} color="#8A95A3" />
          </TouchableOpacity>
        </View>

        {/* Now playing */}
        <View style={st.nowPlayingRow}>
          <Icon name="music" size={fs(18)} color="#F5A623" />
          <View style={{ flex: 1 }}>
            <Text style={st.nowPlayingTitle} numberOfLines={1}>
              {musicStyleLabel(currentStyle)}
              {currentTrackIndex != null && !musicOff ? `  ·  Track ${currentTrackIndex + 1}` : ''}
            </Text>
            <Text style={st.nowPlayingStatus}>{statusLine}</Text>
          </View>
          <EqualizerBars active={trackStatus === 'playing' && !musicMuted && !musicOff && started} fs={fs} />
        </View>

        {/* Transport */}
        <View style={st.transportRow}>
          <TouchableOpacity
            style={[st.transportBtn, !transportEnabled && st.disabled]}
            onPress={onSkipBack}
            disabled={!transportEnabled}
          >
            <Icon name="skip-back" size={fs(20)} color="#F0F4F8" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[st.transportBtn, st.transportBtnMain, !started && st.disabled]}
            onPress={onToggleMute}
            disabled={!started}
          >
            <Icon
              name={musicMuted ? 'volume-x' : 'volume-2'}
              size={fs(22)}
              color={musicMuted ? '#F59E0B' : '#F0F4F8'}
            />
          </TouchableOpacity>
          <TouchableOpacity
            style={[st.transportBtn, !transportEnabled && st.disabled]}
            onPress={onSkipNext}
            disabled={!transportEnabled}
          >
            <Icon name="skip-forward" size={fs(20)} color="#F0F4F8" />
          </TouchableOpacity>
        </View>

        {/* Like / dislike */}
        {canRate && (
          <View style={st.rateRow}>
            <TouchableOpacity
              style={[st.rateBtn, !rateEnabled && st.disabled]}
              onPress={onToggleLike}
              disabled={!rateEnabled}
            >
              <Icon name={liked ? 'heart-filled' : 'heart'} size={fs(18)} color={liked ? '#F5A623' : '#8A95A3'} />
              <Text style={[st.rateLabel, liked && { color: '#F5A623' }]}>Like</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[st.rateBtn, !rateEnabled && st.disabled]}
              onPress={onToggleDislike}
              disabled={!rateEnabled}
            >
              <Icon name="thumbs-down" size={fs(18)} color={disliked ? '#EF4444' : '#8A95A3'} />
              <Text style={[st.rateLabel, disliked && { color: '#EF4444' }]}>Never play again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Volume */}
        <Text style={st.sectionLabel}>VOLUME</Text>
        <View style={st.volumeRow}>
          <TouchableOpacity
            style={st.volBtn}
            onPress={() => onVolumeChange(volume - 0.1)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="minus" size={fs(16)} color="#F0F4F8" />
          </TouchableOpacity>
          <View style={st.volBar}>
            {Array.from({ length: 10 }, (_, i) => (
              <View key={i} style={[st.volSegment, i < volSegments && st.volSegmentOn]} />
            ))}
          </View>
          <TouchableOpacity
            style={st.volBtn}
            onPress={() => onVolumeChange(volume + 0.1)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Icon name="plus" size={fs(16)} color="#F0F4F8" />
          </TouchableOpacity>
          <Text style={st.volPct}>{Math.round(volume * 100)}%</Text>
        </View>

        {/* Style */}
        <Text style={st.sectionLabel}>MUSIC STYLE</Text>
        <ScrollView style={{ maxHeight: fs(180) }} showsVerticalScrollIndicator={false}>
          <View style={st.chipRow}>
            {MUSIC_STYLE_OPTIONS.map((opt) => {
              const active = currentStyle === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[st.chip, active && st.chipActive]}
                  onPress={() => onChangeStyle(opt.value)}
                >
                  <Text style={[st.chipText, active && st.chipTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>

        {/* Footer */}
        {musicOff ? (
          <TouchableOpacity style={st.footerBtn} onPress={onTurnMusicBackOn}>
            <Text style={[st.footerBtnText, { color: '#6EBB7A' }]}>Turn music back on</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={st.footerBtn}
            onPress={() => {
              onTurnOffForSession();
              onClose();
            }}
          >
            <Text style={st.footerBtnText}>Turn off music for this workout</Text>
          </TouchableOpacity>
        )}
        <Text style={st.hint}>Music changes apply to this session only.</Text>
      </View>
    </View>
  );
}

const makeStyles = (fs: (n: number) => number) =>
  StyleSheet.create({
    root: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 200,
      justifyContent: 'flex-end',
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.5)',
    },
    card: {
      backgroundColor: '#0E1117',
      borderTopLeftRadius: fs(16),
      borderTopRightRadius: fs(16),
      borderWidth: 1,
      borderColor: '#2A3347',
      paddingHorizontal: fs(18),
      paddingTop: fs(14),
      paddingBottom: fs(18),
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: fs(10),
    },
    title: {
      color: '#F0F4F8',
      fontSize: fs(16),
      fontWeight: '700',
    },
    nowPlayingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: fs(10),
      backgroundColor: '#161B26',
      borderRadius: fs(10),
      paddingHorizontal: fs(12),
      paddingVertical: fs(10),
      marginBottom: fs(12),
    },
    nowPlayingTitle: {
      color: '#F0F4F8',
      fontSize: fs(13),
      fontWeight: '600',
    },
    nowPlayingStatus: {
      color: '#8A95A3',
      fontSize: fs(11),
      marginTop: fs(1),
    },
    transportRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: fs(18),
      marginBottom: fs(10),
    },
    transportBtn: {
      width: fs(44),
      height: fs(44),
      borderRadius: fs(22),
      backgroundColor: '#161B26',
      borderWidth: 1,
      borderColor: '#2A3347',
      alignItems: 'center',
      justifyContent: 'center',
    },
    transportBtnMain: {
      width: fs(52),
      height: fs(52),
      borderRadius: fs(26),
    },
    rateRow: {
      flexDirection: 'row',
      justifyContent: 'center',
      gap: fs(12),
      marginBottom: fs(12),
    },
    rateBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: fs(6),
      backgroundColor: '#161B26',
      borderWidth: 1,
      borderColor: '#2A3347',
      borderRadius: fs(18),
      paddingHorizontal: fs(14),
      paddingVertical: fs(8),
    },
    rateLabel: {
      color: '#8A95A3',
      fontSize: fs(12),
      fontWeight: '600',
    },
    sectionLabel: {
      color: '#8A95A3',
      fontSize: fs(10),
      fontWeight: '700',
      letterSpacing: 1,
      marginBottom: fs(6),
    },
    volumeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: fs(10),
      marginBottom: fs(12),
    },
    volBtn: {
      width: fs(30),
      height: fs(30),
      borderRadius: fs(15),
      backgroundColor: '#161B26',
      borderWidth: 1,
      borderColor: '#2A3347',
      alignItems: 'center',
      justifyContent: 'center',
    },
    volBar: {
      flex: 1,
      flexDirection: 'row',
      gap: fs(3),
      alignItems: 'center',
    },
    volSegment: {
      flex: 1,
      height: fs(6),
      borderRadius: fs(3),
      backgroundColor: '#2A3347',
    },
    volSegmentOn: {
      backgroundColor: '#F5A623',
    },
    volPct: {
      color: '#8A95A3',
      fontSize: fs(11),
      width: fs(34),
      textAlign: 'right',
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: fs(8),
      paddingBottom: fs(4),
    },
    chip: {
      backgroundColor: '#161B26',
      borderWidth: 1,
      borderColor: '#2A3347',
      borderRadius: fs(16),
      paddingHorizontal: fs(12),
      paddingVertical: fs(6),
    },
    chipActive: {
      backgroundColor: '#F5A62322',
      borderColor: '#F5A623',
    },
    chipText: {
      color: '#8A95A3',
      fontSize: fs(12),
      fontWeight: '600',
    },
    chipTextActive: {
      color: '#F5A623',
    },
    disabled: {
      opacity: 0.35,
    },
    footerBtn: {
      alignItems: 'center',
      paddingVertical: fs(8),
      marginTop: fs(2),
    },
    footerBtnText: {
      color: '#8A95A3',
      fontSize: fs(12),
      fontWeight: '600',
    },
    hint: {
      color: '#5A6474',
      fontSize: fs(10),
      textAlign: 'center',
    },
  });
