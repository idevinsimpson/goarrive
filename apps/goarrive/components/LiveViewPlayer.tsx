/**
 * LiveViewPlayer — Coach live-view mirror of a member's active workout session.
 *
 * Subscribes to workoutSessions/{sessionId} via onSnapshot. Renders the
 * current phase, movement name, and video synced to the member's position.
 * Read-only: no controls, no interaction.
 *
 * Session-ended states:
 *   - Doc deleted → "Member finished this workout"
 *   - updatedAt > 60s → "Member is no longer active"
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
// ── Types ───────────────────────────────────────────────────────────────────

interface LiveSessionData {
  sessionId: string;
  memberId: string;
  memberName: string;
  coachId: string;
  workoutId: string;
  workoutName: string;
  phase: string;
  movementIndex: number;
  videoPositionMs: number;
  isPlaying: boolean;
  movementName?: string | null;
  currentVideoUrl?: string | null;
  updatedAt?: any;
}

interface LiveViewPlayerProps {
  sessionId: string;
  onClose: () => void;
}

const STALE_THRESHOLD_MS = 60_000;

function isStale(updatedAt: any): boolean {
  if (!updatedAt) return true;
  const ts = updatedAt?.toDate?.() ?? new Date(updatedAt);
  return Date.now() - ts.getTime() > STALE_THRESHOLD_MS;
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'ready': return 'Warming Up';
    case 'work': return 'Working';
    case 'rest': return 'Rest';
    case 'swap': return 'Switch Sides';
    case 'complete': return 'Complete';
    case 'intro': return 'Intro';
    case 'outro': return 'Outro';
    case 'demo': return 'Demo';
    case 'transition': return 'Transition';
    case 'waterBreak': return 'Water Break';
    case 'grabEquipment': return 'Grab Equipment';
    case 'followAlongVideo': return 'Follow-Along';
    default: return phase;
  }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function LiveViewPlayer({ sessionId, onClose }: LiveViewPlayerProps) {
  const [session, setSession] = useState<LiveSessionData | null | undefined>(undefined);
  const [docDeleted, setDocDeleted] = useState(false);
  const [stale, setStale] = useState(false);
  const videoRef = useRef<any>(null);
  const { width: winW } = useWindowDimensions();
  const videoW = Math.min(winW - 32, 400);
  const videoH = Math.round(videoW * (5 / 4));

  // Subscribe to session doc
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'workoutSessions', sessionId),
      (snap) => {
        if (!snap.exists()) {
          setDocDeleted(true);
          setSession(null);
        } else {
          setDocDeleted(false);
          setSession({ sessionId: snap.id, ...(snap.data() as Omit<LiveSessionData, 'sessionId'>) });
        }
      },
      (err) => {
        console.warn('[LiveViewPlayer] snapshot error:', err);
      },
    );
    return unsub;
  }, [sessionId]);

  // Staleness check every 5s
  useEffect(() => {
    const check = () => setStale(isStale(session?.updatedAt));
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, [session?.updatedAt]);

  // Seek + play/pause sync on every session update
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !session) return;
    const posMs = session.videoPositionMs ?? 0;
    v.setPositionAsync(posMs).catch(() => {});
    if (session.isPlaying) {
      v.playAsync().catch(() => {});
    } else {
      v.pauseAsync().catch(() => {});
    }
  }, [session?.videoPositionMs, session?.isPlaying, session?.currentVideoUrl]);

  const ended = docDeleted || stale;
  const endMessage = docDeleted
    ? 'Member finished this workout.'
    : 'Member is no longer active.';

  const hasVideo = !!(session?.currentVideoUrl) && !ended;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={st.container}>
        {/* Header */}
        <View style={st.header}>
          <View style={st.liveBadge}>
            <View style={st.liveDot} />
            <Text style={st.liveText}>LIVE</Text>
          </View>
          <Text style={st.memberName} numberOfLines={1}>
            {session?.memberName || 'Member'}
          </Text>
          <Pressable onPress={onClose} style={st.closeBtn} hitSlop={12}>
            <Text style={st.closeX}>✕</Text>
          </Pressable>
        </View>

        {/* Body */}
        <View style={st.body}>
          {session === undefined ? (
            <ActivityIndicator size="large" color="#F5A623" />
          ) : ended ? (
            <View style={st.endedCard}>
              <Text style={st.endedIcon}>✓</Text>
              <Text style={st.endedText}>{endMessage}</Text>
            </View>
          ) : (
            <>
              {/* Phase + workout label */}
              <View style={st.phaseRow}>
                <Text style={st.phaseLabel}>{phaseLabel(session.phase)}</Text>
                <Text style={st.workoutName} numberOfLines={1}>{session.workoutName}</Text>
              </View>

              {/* Movement name */}
              {session.movementName ? (
                <Text style={st.movementName} numberOfLines={2}>{session.movementName}</Text>
              ) : null}

              {/* Video */}
              {hasVideo ? (
                <View style={[st.videoWrapper, { width: videoW, height: videoH }]}>
                  <Video
                    ref={videoRef}
                    source={{ uri: session.currentVideoUrl! }}
                    style={{ width: videoW, height: videoH }}
                    resizeMode={ResizeMode.COVER}
                    isMuted
                    isLooping
                    shouldPlay={session.isPlaying}
                  />
                </View>
              ) : (
                <View style={[st.videoPlaceholder, { width: videoW, height: videoH }]}>
                  <Text style={st.placeholderText}>
                    {session.phase === 'rest' ? 'Rest' :
                     session.phase === 'ready' ? 'Starting soon…' :
                     session.movementName || '—'}
                  </Text>
                </View>
              )}

              {/* Playing indicator */}
              <View style={st.playingRow}>
                <View style={[st.playingDot, { backgroundColor: session.isPlaying ? '#34D399' : '#8A95A3' }]} />
                <Text style={st.playingLabel}>{session.isPlaying ? 'Playing' : 'Paused'}</Text>
              </View>
            </>
          )}
        </View>

        {/* Synced banner */}
        {!ended && session && (
          <View style={st.syncBanner}>
            <Text style={st.syncText}>Synced to {session.memberName || 'member'}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const FONT_BODY = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';
const FONT_HEADING = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';

const st = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D1117',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E2329',
    gap: 10,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E0533A22',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 5,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#E0533A',
  },
  liveText: {
    color: '#E0533A',
    fontSize: 11,
    fontFamily: FONT_HEADING,
    letterSpacing: 1,
  },
  memberName: {
    flex: 1,
    color: '#F0F4F8',
    fontSize: 16,
    fontFamily: FONT_HEADING,
  },
  closeBtn: {
    padding: 6,
  },
  closeX: {
    color: '#8A95A3',
    fontSize: 18,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 16,
  },
  phaseRow: {
    alignItems: 'center',
    gap: 4,
  },
  phaseLabel: {
    color: '#F5A623',
    fontSize: 13,
    fontFamily: FONT_HEADING,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  workoutName: {
    color: '#8A95A3',
    fontSize: 13,
    fontFamily: FONT_BODY,
  },
  movementName: {
    color: '#F0F4F8',
    fontSize: 22,
    fontFamily: FONT_HEADING,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  videoWrapper: {
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1E2329',
  },
  videoPlaceholder: {
    borderRadius: 12,
    backgroundColor: '#1E2329',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: '#4A5568',
    fontSize: 16,
    fontFamily: FONT_BODY,
  },
  playingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  playingLabel: {
    color: '#8A95A3',
    fontSize: 13,
    fontFamily: FONT_BODY,
  },
  endedCard: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  endedIcon: {
    fontSize: 36,
    color: '#34D399',
  },
  endedText: {
    color: '#8A95A3',
    fontSize: 16,
    fontFamily: FONT_BODY,
    textAlign: 'center',
  },
  syncBanner: {
    backgroundColor: '#1E2329',
    paddingVertical: 10,
    alignItems: 'center',
  },
  syncText: {
    color: '#4A5568',
    fontSize: 12,
    fontFamily: FONT_BODY,
  },
});
