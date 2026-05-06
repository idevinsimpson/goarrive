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
import { useLocalSearchParams, router } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { auth } from '../../lib/firebase';
import { Icon } from '../../components/Icon';
import WorkoutPlayer from '../../components/WorkoutPlayer';
import { BG, CARD, BORDER, FG, GOLD, MUTED, FH, FB } from '../../lib/theme';

const RESOLVE_URL = 'https://us-central1-goarrive.cloudfunctions.net/resolveShareToken';

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
}

export default function SharePage() {
  const { shareId } = useLocalSearchParams<{ shareId: string }>();
  const { user, claims, loading: authLoading } = useAuth();

  const [teaser, setTeaser] = useState<Teaser | null>(null);
  const [workout, setWorkout] = useState<SharedWorkout | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [showPlayer, setShowPlayer] = useState(false);

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
      if (json.authenticated && json.workout) {
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

  if (workout && user) {
    return (
      <View style={{ flex: 1, backgroundColor: BG }}>
        {!showPlayer ? (
          <ScrollView contentContainerStyle={styles.container}>
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

              <Pressable style={styles.playBtn} onPress={() => setShowPlayer(true)}>
                <Icon name="play" size={20} color={BG} />
                <Text style={styles.playBtnText}>Start Workout</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <WorkoutPlayer
            visible={showPlayer}
            workout={workout}
            onClose={() => setShowPlayer(false)}
            onComplete={() => setShowPlayer(false)}
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
            <Text style={styles.authGateTitle}>Sign in to start this workout</Text>
            <Text style={styles.authGateDesc}>
              Create a free account or sign in to play this workout from {teaser.coachName}.
            </Text>

            <Pressable style={styles.signInBtn} onPress={handleSignIn}>
              <Text style={styles.signInBtnText}>Sign In</Text>
            </Pressable>
            <Pressable style={styles.signUpBtn} onPress={handleSignUp}>
              <Text style={styles.signUpBtnText}>Create Account</Text>
            </Pressable>
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
});
