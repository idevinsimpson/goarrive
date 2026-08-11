import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  Platform,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { auth } from '../../lib/firebase';
import { Icon } from '../../components/Icon';
import WorkoutPlayer from '../../components/WorkoutPlayer';
import PostWorkoutJournal, { JournalEntry } from '../../components/PostWorkoutJournal';
import { isWebBluetoothAvailable } from '../../hooks/useHeartRate';
import { BG, CARD, BORDER, FG, GOLD, MUTED, FH, FB } from '../../lib/theme';

const RESOLVE_URL = 'https://us-central1-goarrive.cloudfunctions.net/resolveShareToken';
const GUEST_REFLECTION_URL = 'https://us-central1-goarrive.cloudfunctions.net/submitGuestReflection';

type ShareVisibility = 'restricted' | 'anyone_with_link' | 'anyone_with_link_signin_required';

interface Teaser {
  workoutId: string;
  name: string;
  description: string;
  category: string | null;
  difficulty: string | null;
  estimatedDurationMin: number | null;
  blockCount: number;
  coachName: string;
  coachPhotoUrl: string | null;
  tags: string[];
  visibility?: ShareVisibility;
  requireAuth?: boolean;
}

interface SharedWorkout {
  id: string;
  name: string;
  description: string;
  category: string | null;
  difficulty: string | null;
  estimatedDurationMin: number | null;
  tags: string[];
  blocks: any[];
  workoutMusicEnabled?: boolean;
  workoutMusicStyle?: string | null;
  workoutMusicVolume?: number | null;
  coachId?: string | null;
}

export default function SharePage() {
  const insets = useSafeAreaInsets();
  const { shareId } = useLocalSearchParams<{ shareId: string }>();
  const { user, claims, loading: authLoading } = useAuth();

  const [teaser, setTeaser] = useState<Teaser | null>(null);
  const [workout, setWorkout] = useState<SharedWorkout | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showPlayer, setShowPlayer] = useState(false);
  const [postFlow, setPostFlow] = useState<'none' | 'journal' | 'nudge'>('none');
  const [playStartedAt, setPlayStartedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!shareId) return;
    if (authLoading) return;
    resolveToken();
  }, [shareId, authLoading, user]);

  async function resolveToken() {
    setLoading(true);
    setError('');
    try {
      const headers: Record<string, string> = {};
      if (user) {
        const token = await user.getIdToken();
        headers['Authorization'] = `Bearer ${token}`;
      }

      const resp = await fetch(`${RESOLVE_URL}?shareId=${encodeURIComponent(shareId!)}`, { headers });
      const json = await resp.json();

      if (!resp.ok) {
        setError(json.error || 'Something went wrong.');
        return;
      }

      setTeaser(json.teaser);
      if (json.workout) {
        setWorkout(json.workout);
      }
    } catch (err) {
      console.error('[SharePage] resolve error:', err);
      setError('Something went wrong loading this workout.');
    } finally {
      setLoading(false);
    }
  }

  function handleSignIn() {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('pendingShareId', shareId!);
    }
    router.push('/(auth)/login');
  }

  function handleSignUp() {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('pendingShareId', shareId!);
    }
    router.push('/(auth)/login');
  }

  function guestDurationSec(): number {
    return playStartedAt ? Math.round((Date.now() - playStartedAt) / 1000) : 0;
  }

  function handlePlayerComplete() {
    setShowPlayer(false);
    if (!user) {
      setPostFlow('journal');
    }
  }

  function handleGuestJournalSubmit(journal: JournalEntry) {
    // Fire-and-forget — the nudge screen shouldn't wait on the network.
    fetch(GUEST_REFLECTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shareId,
        glow: journal.glow,
        grow: journal.grow,
        energyRating: journal.energyRating,
        moodRating: journal.moodRating,
        durationSec: guestDurationSec(),
      }),
    }).catch((err) => {
      console.warn('[SharePage] guest reflection save failed:', err);
    });
    setPostFlow('nudge');
  }

  function handleGuestJournalSkip() {
    setPostFlow('nudge');
  }

  if (loading || authLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={GOLD} />
        <Text style={styles.loadingText}>Loading workout...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Icon name="alert-circle" size={48} color={MUTED} />
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.backBtn} onPress={() => router.replace('/')}>
          <Text style={styles.backBtnText}>Go Home</Text>
        </Pressable>
      </View>
    );
  }

  if (!teaser) return null;

  if (workout && postFlow === 'nudge') {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <ScrollView contentContainerStyle={[styles.container, { paddingTop: Math.max(20, insets.top) }]}>
          <View style={styles.heroCard}>
            <View style={styles.nudgeHeader}>
              <Icon name="check-circle" size={48} color={GOLD} />
              <Text style={styles.nudgeTitle}>That workout is in the books</Text>
              <Text style={styles.nudgeSubtitle}>
                Nice work finishing {workout.name} from {teaser.coachName}.
              </Text>
            </View>

            <View style={styles.nudgeValueList}>
              <View style={styles.nudgeValueRow}>
                <Icon name="trending-up" size={18} color={GOLD} />
                <Text style={styles.nudgeValueText}>
                  Keep your progress — workouts, reflections, and streaks saved in one place.
                </Text>
              </View>
              <View style={styles.nudgeValueRow}>
                <Icon name="person" size={18} color={GOLD} />
                <Text style={styles.nudgeValueText}>
                  Get coached — {teaser.coachName} can see your reflection and respond.
                </Text>
              </View>
            </View>

            <Pressable style={styles.playBtn} onPress={handleSignUp}>
              <Text style={styles.playBtnText}>Create Free Account</Text>
            </Pressable>

            <Pressable style={styles.signUpBtnSubtle} onPress={() => setPostFlow('none')}>
              <Text style={styles.nudgeDismissText}>Not now</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    );
  }

  if (workout) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        <PostWorkoutJournal
          visible={postFlow === 'journal'}
          workoutName={workout.name}
          durationSeconds={guestDurationSec()}
          onSubmit={handleGuestJournalSubmit}
          onSkip={handleGuestJournalSkip}
        />
        {!showPlayer ? (
          <ScrollView contentContainerStyle={[styles.container, { paddingTop: Math.max(20, insets.top) }]}>
            <View style={styles.heroCard}>
              <View style={styles.coachRow}>
                <View style={styles.coachAvatar}>
                  <Icon name="person" size={20} color={GOLD} />
                </View>
                <Text style={styles.coachName}>{teaser.coachName}</Text>
              </View>

              <Text style={styles.workoutTitle}>{workout.name}</Text>

              {workout.description ? (
                <Text style={styles.workoutDesc}>{workout.description}</Text>
              ) : null}

              <View style={styles.metaRow}>
                {workout.category ? (
                  <View style={styles.metaBadge}>
                    <Text style={styles.metaBadgeText}>{workout.category}</Text>
                  </View>
                ) : null}
                {workout.difficulty ? (
                  <View style={styles.metaBadge}>
                    <Text style={styles.metaBadgeText}>{workout.difficulty}</Text>
                  </View>
                ) : null}
                {workout.estimatedDurationMin ? (
                  <View style={styles.metaBadge}>
                    <Text style={styles.metaBadgeText}>{workout.estimatedDurationMin} min</Text>
                  </View>
                ) : null}
                <View style={styles.metaBadge}>
                  <Text style={styles.metaBadgeText}>{workout.blocks.length} blocks</Text>
                </View>
              </View>

              {!user ? (
                <View style={styles.guestBanner}>
                  <Icon name="info" size={14} color={MUTED} />
                  <Text style={styles.guestBannerText}>
                    Playing as guest — your progress won't be saved.
                  </Text>
                </View>
              ) : null}

              <Pressable
                style={styles.playBtn}
                onPress={() => {
                  setPlayStartedAt(Date.now());
                  setShowPlayer(true);
                }}
              >
                <Icon name="play" size={20} color={BG} />
                <Text style={styles.playBtnText}>Start Workout</Text>
              </Pressable>

              {Platform.OS === 'web' && !isWebBluetoothAvailable() ? (
                <View style={styles.hrNoteRow}>
                  <Icon name="heart" size={12} color={MUTED} />
                  <Text style={styles.hrNoteText}>
                    Heart rate tracking is available on Chrome (desktop or Android)
                  </Text>
                </View>
              ) : null}

              {!user ? (
                <Pressable style={styles.signUpBtnSubtle} onPress={handleSignUp}>
                  <Text style={styles.signUpBtnSubtleText}>
                    Create a free account to save your progress
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </ScrollView>
        ) : (
          <WorkoutPlayer
            visible={showPlayer}
            workout={workout}
            onClose={() => setShowPlayer(false)}
            onComplete={handlePlayerComplete}
          />
        )}
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.heroCard}>
          <View style={styles.coachRow}>
            <View style={styles.coachAvatar}>
              <Icon name="person" size={20} color={GOLD} />
            </View>
            <Text style={styles.coachName}>{teaser.coachName}</Text>
          </View>

          <Text style={styles.workoutTitle}>{teaser.name}</Text>

          {teaser.description ? (
            <Text style={styles.workoutDesc}>{teaser.description}</Text>
          ) : null}

          <View style={styles.metaRow}>
            {teaser.category ? (
              <View style={styles.metaBadge}>
                <Text style={styles.metaBadgeText}>{teaser.category}</Text>
              </View>
            ) : null}
            {teaser.difficulty ? (
              <View style={styles.metaBadge}>
                <Text style={styles.metaBadgeText}>{teaser.difficulty}</Text>
              </View>
            ) : null}
            {teaser.estimatedDurationMin ? (
              <View style={styles.metaBadge}>
                <Text style={styles.metaBadgeText}>{teaser.estimatedDurationMin} min</Text>
              </View>
            ) : null}
            <View style={styles.metaBadge}>
              <Text style={styles.metaBadgeText}>{teaser.blockCount} blocks</Text>
            </View>
          </View>

          <View style={styles.authGate}>
            <Icon name="lock" size={24} color={GOLD} />
            <Text style={styles.authGateTitle}>
              {teaser.requireAuth ? 'Sign in to start this workout' : 'This link is no longer available'}
            </Text>
            <Text style={styles.authGateDesc}>
              {teaser.requireAuth
                ? `Create a free account or sign in to play this workout from ${teaser.coachName}.`
                : 'Ask your coach for a new link.'}
            </Text>

            {teaser.requireAuth ? (
              <>
                <Pressable style={styles.signInBtn} onPress={handleSignIn}>
                  <Text style={styles.signInBtnText}>Sign In</Text>
                </Pressable>
                <Pressable style={styles.signUpBtn} onPress={handleSignUp}>
                  <Text style={styles.signUpBtnText}>Create Account</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  loadingText: {
    color: MUTED,
    fontSize: 14,
    fontFamily: FB,
    marginTop: 8,
  },
  errorText: {
    color: FG,
    fontSize: 16,
    fontFamily: FB,
    textAlign: 'center',
    marginTop: 8,
  },
  backBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  backBtnText: {
    color: GOLD,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FB,
  },
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    minHeight: '100%' as any,
  },
  heroCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: CARD,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 28,
    gap: 20,
  },
  coachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  coachAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(245,166,35,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachName: {
    color: FG,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FB,
  },
  workoutTitle: {
    color: FG,
    fontSize: 24,
    fontWeight: '700',
    fontFamily: FH,
  },
  workoutDesc: {
    color: MUTED,
    fontSize: 14,
    fontFamily: FB,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metaBadge: {
    backgroundColor: 'rgba(125,211,252,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.2)',
  },
  metaBadgeText: {
    color: '#7DD3FC',
    fontSize: 12,
    fontFamily: FB,
    fontWeight: '500',
  },
  authGate: {
    alignItems: 'center',
    gap: 12,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  authGateTitle: {
    color: FG,
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FH,
    textAlign: 'center',
  },
  authGateDesc: {
    color: MUTED,
    fontSize: 14,
    fontFamily: FB,
    textAlign: 'center',
    lineHeight: 20,
  },
  signInBtn: {
    width: '100%',
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  signInBtnText: {
    color: BG,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FH,
  },
  signUpBtn: {
    width: '100%',
    backgroundColor: 'transparent',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },
  signUpBtnText: {
    color: FG,
    fontSize: 16,
    fontWeight: '600',
    fontFamily: FB,
  },
  playBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GOLD,
    borderRadius: 12,
    paddingVertical: 16,
    gap: 10,
  },
  playBtnText: {
    color: BG,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FH,
  },
  guestBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(125,211,252,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(125,211,252,0.2)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  guestBannerText: {
    color: MUTED,
    fontSize: 12,
    fontFamily: FB,
    flexShrink: 1,
  },
  hrNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  hrNoteText: {
    color: MUTED,
    fontSize: 12,
    fontFamily: FB,
    flexShrink: 1,
  },
  signUpBtnSubtle: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  nudgeHeader: {
    alignItems: 'center',
    gap: 8,
  },
  nudgeTitle: {
    color: FG,
    fontSize: 22,
    fontWeight: '700',
    fontFamily: FH,
    textAlign: 'center',
    marginTop: 8,
  },
  nudgeSubtitle: {
    color: MUTED,
    fontSize: 14,
    fontFamily: FB,
    textAlign: 'center',
    lineHeight: 20,
  },
  nudgeValueList: {
    gap: 12,
  },
  nudgeValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  nudgeValueText: {
    color: FG,
    fontSize: 14,
    fontFamily: FB,
    lineHeight: 20,
    flexShrink: 1,
  },
  nudgeDismissText: {
    color: MUTED,
    fontSize: 14,
    fontFamily: FB,
    fontWeight: '600',
  },
  signUpBtnSubtleText: {
    color: GOLD,
    fontSize: 13,
    fontFamily: FB,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
