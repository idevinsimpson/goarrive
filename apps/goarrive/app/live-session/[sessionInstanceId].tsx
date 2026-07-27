/**
 * Member live session — workout player + Zoom picture-in-picture.
 *
 * Entry point: "Start Workout" on a scheduled session in my-sessions. The
 * WorkoutPlayer stays the primary full-screen surface; the session's Zoom
 * meeting rides along as a minimized Component View tile (SessionZoomTile,
 * camera auto-on) so the coach/room can see the member while they train.
 *
 * As the player advances, progress transitions are mirrored to
 * session_instances/{id}/live/player so the coach's live-view split screen
 * can render the member's player state in real time.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Platform } from 'react-native';
import { useLocalSearchParams, useRouter, Redirect } from 'expo-router';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import { SessionInstance } from '../../lib/schedulingTypes';
import WorkoutPlayer, { WorkoutLiveProgress } from '../../components/WorkoutPlayer';
import SessionZoomTile from '../../components/SessionZoomTile';

const BG = '#0E1117';
const GOLD = '#F5A623';
const RED = '#E05252';
const TEXT_SECONDARY = '#A0AEC0';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

export default function MemberLiveSessionScreen() {
  const { sessionInstanceId } = useLocalSearchParams<{ sessionInstanceId: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  const [inst, setInst] = useState<SessionInstance | null>(null);
  const [workout, setWorkout] = useState<any | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

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
        const data = { id: snap.id, ...snap.data() } as SessionInstance;
        setInst(data);

        const workoutId = (data as any).pinnedWorkoutId;
        if (!workoutId) {
          setError('This session has no workout attached yet. Ask your coach to pin one.');
          return;
        }
        const wSnap = await getDoc(doc(db, 'workouts', workoutId));
        if (cancelled) return;
        if (!wSnap.exists()) {
          setError("The session's workout could not be loaded.");
          return;
        }
        setWorkout({ id: wSnap.id, ...wSnap.data() });
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load the session.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, sessionInstanceId]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(member)/my-sessions');
  }, [router]);

  // Mirror player transitions to Firestore for the coach live view. Writes
  // fire on transitions only (see WorkoutPlayer.onLiveProgress) — throttle to
  // at most one write per second as a safety net.
  const lastWriteRef = useRef(0);
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishProgress = useCallback(
    (state: WorkoutLiveProgress) => {
      if (!sessionInstanceId) return;
      const write = () => {
        lastWriteRef.current = Date.now();
        setDoc(
          doc(db, 'session_instances', sessionInstanceId, 'live', 'player'),
          {
            ...state,
            workoutId: workout?.id ?? null,
            workoutName: workout?.name ?? null,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        ).catch((err) => console.warn('[LiveSession] progress write failed:', err));
      };
      const since = Date.now() - lastWriteRef.current;
      if (pendingRef.current) clearTimeout(pendingRef.current);
      if (since >= 1000) write();
      else pendingRef.current = setTimeout(write, 1000 - since);
    },
    [sessionInstanceId, workout?.id, workout?.name],
  );
  useEffect(() => () => {
    if (pendingRef.current) clearTimeout(pendingRef.current);
  }, []);

  if (!authLoading && !user) return <Redirect href="/" />;

  if (loading || authLoading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color={GOLD} />
        <Text style={s.dim}>Loading your session…</Text>
      </View>
    );
  }

  if (error || !workout) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>{error || 'Something went wrong.'}</Text>
        <Pressable style={s.backBtn} onPress={goBack}>
          <Text style={s.backBtnText}>Back to My Sessions</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <WorkoutPlayer
        visible
        workout={workout}
        onClose={goBack}
        onComplete={goBack}
        onLiveProgress={publishProgress}
        zoomOverlay={
          inst?.zoomMeetingId ? (
            <View pointerEvents="box-none" style={s.pipAnchor}>
              <SessionZoomTile
                sessionInstanceId={String(sessionInstanceId)}
                variant="pip"
                autoStartCamera
              />
            </View>
          ) : null
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
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
    fontSize: 14,
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
  pipAnchor: {
    position: 'absolute',
    top: 14,
    right: 14,
  },
});
