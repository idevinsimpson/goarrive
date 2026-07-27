/**
 * Coach live view — split screen for a scheduled/live playbook session.
 *
 * Left pane: the member's workout player state, streamed from
 * session_instances/{id}/live/player (written by the member's live-session
 * screen as they train). Right pane: the member's live Zoom video via the
 * embedded Meeting SDK Component View (SessionZoomTile, coach joins as a
 * role-0 participant — no host-start).
 *
 * Entry point: the View button on upcoming sessions in PlaybookSchedulePanel.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter, Redirect } from 'expo-router';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import { SessionInstance } from '../../lib/schedulingTypes';
import SessionZoomTile from '../../components/SessionZoomTile';

const BG = '#0E1117';
const CARD_BG = '#151B26';
const BORDER = '#2A3347';
const GOLD = '#F5A623';
const RED = '#E05252';
const GREEN = '#6EBB7A';
const TEXT_PRIMARY = '#F0F4F8';
const TEXT_SECONDARY = '#A0AEC0';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

type LivePlayerState = {
  phase?: string;
  currentIndex?: number;
  total?: number;
  movementName?: string | null;
  nextMovementName?: string | null;
  isPaused?: boolean;
  roundNumber?: number | null;
  workoutName?: string | null;
  updatedAt?: any;
};

function phaseLabel(phase?: string): string {
  switch (phase) {
    case 'ready': return 'Reviewing workout';
    case 'work': return 'Working';
    case 'rest': return 'Resting';
    case 'transition': return 'Transition';
    case 'waterBreak': return 'Water break';
    case 'grabEquipment': return 'Grabbing equipment';
    case 'demo': return 'Watching demo';
    case 'intro': return 'Intro';
    case 'outro':
    case 'complete': return 'Workout complete';
    default: return phase ? phase : 'Waiting for member…';
  }
}

export default function CoachLiveViewScreen() {
  const { sessionInstanceId } = useLocalSearchParams<{ sessionInstanceId: string }>();
  const { user, claims, effectiveUid, loading: authLoading } = useAuth();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 860;

  const [inst, setInst] = useState<SessionInstance | null>(null);
  const [live, setLive] = useState<LivePlayerState | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Session instance (one-shot) + live player state (subscription).
  useEffect(() => {
    if (authLoading || !user || !sessionInstanceId) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'session_instances', sessionInstanceId));
        if (cancelled) return;
        if (!snap.exists()) {
          setError("We couldn't find that session.");
          return;
        }
        setInst({ id: snap.id, ...snap.data() } as SessionInstance);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load the session.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const unsub = onSnapshot(
      doc(db, 'session_instances', sessionInstanceId, 'live', 'player'),
      (snap) => setLive(snap.exists() ? (snap.data() as LivePlayerState) : null),
      (err) => console.warn('[LiveView] live state listener error:', err),
    );
    return () => {
      cancelled = true;
      unsub();
    };
  }, [authLoading, user, sessionInstanceId]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(app)/build');
  }, [router]);

  if (!authLoading && !user) return <Redirect href="/" />;

  if (loading || authLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={GOLD} />
        <Text style={s.dim}>Loading live view…</Text>
      </View>
    );
  }

  const isAdmin = claims?.role === 'platformAdmin';
  if (error || !inst || (!isAdmin && inst.coachId !== effectiveUid)) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>{error || 'You do not have access to this session.'}</Text>
        <Pressable style={s.backBtn} onPress={goBack}>
          <Text style={s.backBtnText}>Go Back</Text>
        </Pressable>
      </View>
    );
  }

  const progressText =
    live && typeof live.currentIndex === 'number' && typeof live.total === 'number' && live.total > 0
      ? `${Math.min(live.currentIndex + 1, live.total)} of ${live.total}`
      : null;

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        <Pressable style={s.headerBack} onPress={goBack}>
          <Text style={s.headerBackText}>‹ Back</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>
            {(inst as any).playbookTitle || 'Live Session'}
          </Text>
          <Text style={s.headerSub} numberOfLines={1}>
            {inst.memberName || 'Member'} · {inst.scheduledDate} {inst.scheduledStartTime}
          </Text>
        </View>
        <View style={[s.statusPill, inst.status === 'in_progress' && { borderColor: GREEN }]}>
          <Text style={[s.statusPillText, inst.status === 'in_progress' && { color: GREEN }]}>
            {inst.status === 'in_progress' ? 'LIVE' : String(inst.status || '').toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Split panes */}
      <View style={[s.split, { flexDirection: isWide ? 'row' : 'column' }]}>
        {/* Member player state */}
        <View style={[s.pane, isWide ? { marginRight: 12 } : { marginBottom: 12 }]}>
          <Text style={s.paneLabel}>Member Workout</Text>
          <View style={s.stateCard}>
            {live ? (
              <>
                <Text style={s.stateWorkout} numberOfLines={1}>
                  {live.workoutName || 'Workout'}
                </Text>
                <Text style={s.statePhase}>
                  {phaseLabel(live.phase)}
                  {live.isPaused ? '  ·  Paused' : ''}
                </Text>
                {live.movementName ? (
                  <Text style={s.stateMovement} numberOfLines={2}>{live.movementName}</Text>
                ) : null}
                <View style={s.stateMetaRow}>
                  {progressText ? <Text style={s.stateMeta}>Movement {progressText}</Text> : null}
                  {live.roundNumber ? <Text style={s.stateMeta}>Round {live.roundNumber}</Text> : null}
                </View>
                {live.nextMovementName ? (
                  <Text style={s.stateNext} numberOfLines={1}>Next up: {live.nextMovementName}</Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={s.statePhase}>Waiting for member…</Text>
                <Text style={s.dim}>
                  Their player state appears here the moment they start the session workout.
                </Text>
              </>
            )}
          </View>
        </View>

        {/* Member Zoom video */}
        <View style={s.pane}>
          <Text style={s.paneLabel}>Live Video</Text>
          {inst.zoomMeetingId ? (
            <SessionZoomTile
              sessionInstanceId={String(sessionInstanceId)}
              variant="pane"
              autoStartCamera={false}
              joinLabel="Join Session Video"
            />
          ) : (
            <View style={s.stateCard}>
              <Text style={s.dim}>
                This session has no Zoom room allocated yet. Video becomes available shortly
                before the session starts.
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  center: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 24,
  },
  dim: {
    color: TEXT_SECONDARY,
    fontFamily: FB,
    fontSize: 13,
  },
  errorText: {
    color: RED,
    fontFamily: FB,
    fontSize: 14,
    textAlign: 'center',
  },
  backBtn: {
    backgroundColor: GOLD,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  backBtnText: {
    color: '#0E1117',
    fontFamily: FH,
    fontSize: 14,
    fontWeight: '700',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  headerBack: {
    paddingVertical: 6,
    paddingRight: 8,
  },
  headerBackText: {
    color: GOLD,
    fontFamily: FH,
    fontSize: 16,
  },
  headerTitle: {
    color: TEXT_PRIMARY,
    fontFamily: FH,
    fontSize: 18,
    fontWeight: '700',
  },
  headerSub: {
    color: TEXT_SECONDARY,
    fontFamily: FB,
    fontSize: 12,
    marginTop: 2,
  },
  statusPill: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  statusPillText: {
    color: TEXT_SECONDARY,
    fontFamily: FH,
    fontSize: 11,
    letterSpacing: 1,
  },
  split: {
    flex: 1,
    padding: 16,
  },
  pane: {
    flex: 1,
  },
  paneLabel: {
    color: TEXT_SECONDARY,
    fontFamily: FH,
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  stateCard: {
    backgroundColor: CARD_BG,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    padding: 18,
    gap: 8,
  },
  stateWorkout: {
    color: TEXT_SECONDARY,
    fontFamily: FB,
    fontSize: 13,
  },
  statePhase: {
    color: GOLD,
    fontFamily: FH,
    fontSize: 20,
    fontWeight: '700',
  },
  stateMovement: {
    color: TEXT_PRIMARY,
    fontFamily: FH,
    fontSize: 26,
    fontWeight: '700',
  },
  stateMetaRow: {
    flexDirection: 'row',
    gap: 16,
  },
  stateMeta: {
    color: TEXT_SECONDARY,
    fontFamily: FB,
    fontSize: 13,
  },
  stateNext: {
    color: TEXT_SECONDARY,
    fontFamily: FB,
    fontSize: 13,
    marginTop: 4,
  },
});
