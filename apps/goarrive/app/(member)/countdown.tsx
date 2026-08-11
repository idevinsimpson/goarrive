/**
 * Member Countdown — Post-enrollment landing page shown after Stripe checkout.
 *
 * Route: /countdown  (Expo Router group (member) is transparent in the URL)
 * Query params:
 *   submissionId — onboarding_submissions doc ID (funnel path)
 *   session_id   — Stripe Checkout session ID (for future server-side confirmation)
 *
 * Flow:
 *   1. If submissionId provided: poll onboarding_submissions until status='enrolled'
 *   2. Load coach name, program path name, schedule, and first workout assignment
 *   3. Compute next scheduled day from scheduleDaysOfWeek + scheduleTimeOfDay
 *   4. Show countdown (days / hours / minutes) until that first session
 *   5. Show "Start First Workout" CTA once startDate has passed AND a
 *      workout_assignment exists for that member
 *
 * Assumption: This page sits in the (member) layout group, which requires auth.
 * Unauthenticated users coming from the Stripe redirect will be sent to login
 * by the layout, then redirected back once authenticated.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
} from 'firebase/firestore';
import { useAuth } from '../../lib/AuthContext';
import { db } from '../../lib/firebase';
import { AppHeader } from '../../components/AppHeader';

// ── Design tokens (matching GoArrive design system) ──────────────────────────
const BG = '#0E1117';
const CARD_BG = '#1A1D27';
const BORDER = '#1E2A3A';
const GOLD = '#F5A623';
const SAGE = '#7BA05B';
const BLUE = '#7BA7D4';
const TEXT = '#E8EAF0';
const MUTED = '#7A7F94';
const FH = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'System';
const FB = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'System';

// ── Types ─────────────────────────────────────────────────────────────────────
interface EnrollmentData {
  coachId: string;
  folderId: string;
  subscriptionPathId: string;
  scheduleDaysOfWeek: number[];
  scheduleTimeOfDay: string;
  duplicatedPlaybookId?: string;
  firstName?: string;
}

interface CountdownTick {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  total: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns the next Date on or after today that falls on one of the given weekdays (0=Sun…6=Sat). */
function nextScheduledDate(daysOfWeek: number[], timeOfDay: string): Date | null {
  if (!daysOfWeek.length) return null;
  const sortedDays = [...daysOfWeek].sort((a, b) => a - b);
  const [hStr, mStr] = timeOfDay.split(':');
  const h = parseInt(hStr ?? '8', 10);
  const m = parseInt(mStr ?? '0', 10);
  const now = new Date();
  // Try each of the next 7 days (inclusive of today) to find the soonest slot
  for (let offset = 0; offset < 7; offset++) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(h, m, 0, 0);
    if (sortedDays.includes(candidate.getDay()) && candidate > now) {
      return candidate;
    }
  }
  return null;
}

function computeCountdown(target: Date): CountdownTick {
  const diff = target.getTime() - Date.now();
  if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, total: 0 };
  const total = diff;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return { days, hours, minutes, seconds, total };
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CountdownScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { submissionId, session_id } = useLocalSearchParams<{
    submissionId?: string;
    session_id?: string;
  }>();

  type PagePhase = 'enrolling' | 'loading' | 'ready' | 'error';
  const [phase, setPhase] = useState<PagePhase>(submissionId ? 'enrolling' : 'loading');
  const [enrollmentData, setEnrollmentData] = useState<EnrollmentData | null>(null);
  const [coachName, setCoachName] = useState('');
  const [programName, setProgramName] = useState('');
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [firstWorkoutId, setFirstWorkoutId] = useState<string | null>(null);
  const [firstWorkoutName, setFirstWorkoutName] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<CountdownTick | null>(null);
  const [enrollTimeout, setEnrollTimeout] = useState(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Poll submission until enrolled ────────────────────────────────────────
  useEffect(() => {
    if (!submissionId) {
      // No submissionId — try loading from playbook_folder_members for this user
      loadFromMemberRecord();
      return;
    }

    const ref = doc(db, 'onboarding_submissions', submissionId);
    let timeoutId: ReturnType<typeof setTimeout>;

    const unsub = onSnapshot(ref, (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      if (data?.status === 'enrolled') {
        unsub();
        clearTimeout(timeoutId);
        const enrollment: EnrollmentData = {
          coachId: data.coachId,
          folderId: data.folderId,
          subscriptionPathId: data.subscriptionPathId,
          scheduleDaysOfWeek: data.scheduleDaysOfWeek ?? [],
          scheduleTimeOfDay: data.scheduleTimeOfDay ?? '08:00',
          duplicatedPlaybookId: data.duplicatedPlaybookId,
          firstName: data.firstName,
        };
        setEnrollmentData(enrollment);
        setPhase('loading');
        loadSupportingData(enrollment);
      }
    });

    // Stripe webhooks usually fire within a few seconds; 45s is generous
    timeoutId = setTimeout(() => {
      setEnrollTimeout(true);
    }, 45000);

    return () => {
      unsub();
      clearTimeout(timeoutId);
    };
  }, [submissionId]);

  // ── Load from playbook_folder_members (no submissionId path) ──────────────
  const loadFromMemberRecord = useCallback(async () => {
    if (!user) return;
    try {
      const q = query(
        collection(db, 'playbook_folder_members'),
        where('memberId', '==', user.uid),
        orderBy('createdAt', 'desc'),
        limit(1),
      );
      const snap = await getDocs(q);
      if (snap.empty) {
        setPhase('error');
        return;
      }
      const data = snap.docs[0].data();
      const enrollment: EnrollmentData = {
        coachId: data.coachId,
        folderId: data.playbookFolderId,
        subscriptionPathId: data.subscriptionPathId,
        scheduleDaysOfWeek: data.scheduleDaysOfWeek ?? [],
        scheduleTimeOfDay: data.scheduleTimeOfDay ?? '08:00',
        duplicatedPlaybookId: data.duplicatedPlaybookId,
      };
      setEnrollmentData(enrollment);
      setPhase('loading');
      await loadSupportingData(enrollment);
    } catch (err) {
      console.error('[Countdown] loadFromMemberRecord failed:', err);
      setPhase('error');
    }
  }, [user]);

  // ── Load coach name, program path name, and first workout ─────────────────
  const loadSupportingData = useCallback(async (enrollment: EnrollmentData) => {
    try {
      const [coachSnap, folderSnap] = await Promise.all([
        getDoc(doc(db, 'coaches', enrollment.coachId)),
        getDoc(doc(db, 'playbook_folders', enrollment.folderId)),
      ]);

      if (coachSnap.exists()) {
        setCoachName(coachSnap.data().displayName ?? '');
      }

      if (folderSnap.exists()) {
        const folderData = folderSnap.data();
        const paths: Array<{ id: string; label: string }> = folderData.subscriptionPaths ?? [];
        const matched = paths.find((p) => p.id === enrollment.subscriptionPathId);
        setProgramName(matched?.label ?? folderData.name ?? 'Your Program');
      }

      // Compute next scheduled session date
      const next = nextScheduledDate(enrollment.scheduleDaysOfWeek, enrollment.scheduleTimeOfDay);
      setStartDate(next);

      // Try to find the first scheduled workout assignment for this member
      if (user) {
        try {
          const aq = query(
            collection(db, 'workout_assignments'),
            where('memberId', '==', user.uid),
            where('status', '==', 'scheduled'),
            orderBy('scheduledFor', 'asc'),
            limit(1),
          );
          const aSnap = await getDocs(aq);
          if (!aSnap.empty) {
            const aData = aSnap.docs[0].data();
            setFirstWorkoutId(aData.workoutId ?? null);
            setFirstWorkoutName(aData.workoutName ?? null);
          }
        } catch {
          // Workout assignments might not exist yet — coach creates them later
        }
      }

      setPhase('ready');
    } catch (err) {
      console.error('[Countdown] loadSupportingData failed:', err);
      setPhase('error');
    }
  }, [user]);

  // ── Countdown ticker ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!startDate) return;
    const tick = () => setCountdown(computeCountdown(startDate));
    tick();
    tickRef.current = setInterval(tick, 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [startDate]);

  // ── Derived state ──────────────────────────────────────────────────────────
  const isReady = countdown !== null && countdown.total <= 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <AppHeader />
      <ScrollView
        contentContainerStyle={[
          s.scroll,
          { paddingBottom: Math.max(24, insets.bottom) + 80 },
        ]}
      >
        {/* ── Enrolling phase ── */}
        {phase === 'enrolling' && (
          <View style={s.centerBlock}>
            {enrollTimeout ? (
              <>
                <Text style={s.heading}>Almost there!</Text>
                <Text style={s.sub}>
                  Your payment was received. Your program is being activated — this usually
                  takes just a moment. Please check back shortly.
                </Text>
                <Pressable style={s.ctaBtn} onPress={() => router.replace('/(member)/home')}>
                  <Text style={s.ctaBtnText}>Go to Home</Text>
                </Pressable>
              </>
            ) : (
              <>
                <ActivityIndicator size="large" color={GOLD} style={{ marginBottom: 20 }} />
                <Text style={s.heading}>Activating your program…</Text>
                <Text style={s.sub}>Hang tight — this takes just a moment.</Text>
              </>
            )}
          </View>
        )}

        {/* ── Loading phase ── */}
        {phase === 'loading' && (
          <View style={s.centerBlock}>
            <ActivityIndicator size="large" color={GOLD} style={{ marginBottom: 20 }} />
            <Text style={s.sub}>Loading your program details…</Text>
          </View>
        )}

        {/* ── Error phase ── */}
        {phase === 'error' && (
          <View style={s.centerBlock}>
            <Text style={s.heading}>Something went wrong</Text>
            <Text style={s.sub}>
              We couldn't load your program. Head to Home and your plan will be ready there.
            </Text>
            <Pressable style={s.ctaBtn} onPress={() => router.replace('/(member)/home')}>
              <Text style={s.ctaBtnText}>Go to Home</Text>
            </Pressable>
          </View>
        )}

        {/* ── Ready phase ── */}
        {phase === 'ready' && (
          <>
            {/* Welcome banner */}
            <View style={s.bannerCard}>
              <Text style={s.bannerEmoji}>🎉</Text>
              <Text style={s.bannerTitle}>You're enrolled!</Text>
              {coachName ? (
                <Text style={s.bannerSub}>
                  Welcome to{' '}
                  <Text style={{ color: GOLD }}>{programName}</Text>
                  {' '}with{' '}
                  <Text style={{ color: BLUE }}>{coachName}</Text>
                </Text>
              ) : (
                <Text style={s.bannerSub}>{programName}</Text>
              )}
            </View>

            {/* Countdown card */}
            <View style={s.card}>
              <Text style={s.cardLabel}>
                {isReady ? 'Your first workout is ready' : 'First workout in'}
              </Text>

              {isReady ? (
                <Text style={s.readyText}>Ready to go!</Text>
              ) : countdown ? (
                <View style={s.timerRow}>
                  <View style={s.timerUnit}>
                    <Text style={s.timerDigits}>{pad(countdown.days)}</Text>
                    <Text style={s.timerLabel}>days</Text>
                  </View>
                  <Text style={s.timerSep}>:</Text>
                  <View style={s.timerUnit}>
                    <Text style={s.timerDigits}>{pad(countdown.hours)}</Text>
                    <Text style={s.timerLabel}>hrs</Text>
                  </View>
                  <Text style={s.timerSep}>:</Text>
                  <View style={s.timerUnit}>
                    <Text style={s.timerDigits}>{pad(countdown.minutes)}</Text>
                    <Text style={s.timerLabel}>min</Text>
                  </View>
                  <Text style={s.timerSep}>:</Text>
                  <View style={s.timerUnit}>
                    <Text style={s.timerDigits}>{pad(countdown.seconds)}</Text>
                    <Text style={s.timerLabel}>sec</Text>
                  </View>
                </View>
              ) : (
                <Text style={s.sub}>Your schedule will be set up shortly.</Text>
              )}

              {startDate && !isReady && (
                <Text style={s.dateHint}>
                  {startDate.toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}{' '}
                  at{' '}
                  {startDate.toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Text>
              )}
            </View>

            {/* First workout CTA */}
            {isReady && firstWorkoutId ? (
              <Pressable
                style={s.ctaBtn}
                onPress={() => router.push('/(member)/workouts')}
              >
                <Text style={s.ctaBtnText}>
                  {firstWorkoutName ? `Start: ${firstWorkoutName}` : 'Start First Workout'}
                </Text>
              </Pressable>
            ) : isReady ? (
              <View style={s.card}>
                <Text style={s.cardLabel}>Ready when you are</Text>
                <Text style={s.sub}>
                  Head to the Workouts tab to see what your coach has lined up for you.
                </Text>
                <Pressable
                  style={[s.ctaBtn, { marginTop: 16 }]}
                  onPress={() => router.push('/(member)/workouts')}
                >
                  <Text style={s.ctaBtnText}>Go to Workouts</Text>
                </Pressable>
              </View>
            ) : (
              <View style={s.card}>
                <Text style={s.cardLabel}>While you wait</Text>
                <Text style={s.sub}>
                  Your coach is setting up your personalized workout plan. You'll get a
                  notification when your first workout is ready.
                </Text>
                <Pressable
                  style={[s.outlineBtn, { marginTop: 16 }]}
                  onPress={() => router.push('/(member)/home')}
                >
                  <Text style={s.outlineBtnText}>View My Dashboard</Text>
                </Pressable>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  centerBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
    paddingHorizontal: 24,
  },
  heading: {
    fontSize: 22,
    fontWeight: '700',
    color: TEXT,
    fontFamily: FH,
    textAlign: 'center',
    marginBottom: 12,
  },
  sub: {
    fontSize: 14,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 8,
  },
  bannerCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  bannerEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  bannerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: TEXT,
    fontFamily: FH,
    marginBottom: 8,
  },
  bannerSub: {
    fontSize: 14,
    color: MUTED,
    fontFamily: FB,
    textAlign: 'center',
    lineHeight: 22,
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 20,
    marginBottom: 16,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 16,
    fontFamily: FB,
  },
  timerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  timerUnit: {
    alignItems: 'center',
    minWidth: 56,
  },
  timerDigits: {
    fontSize: 40,
    fontWeight: '700',
    color: GOLD,
    fontFamily: FH,
    lineHeight: 44,
  },
  timerLabel: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timerSep: {
    fontSize: 32,
    color: MUTED,
    fontWeight: '300',
    marginHorizontal: 4,
    lineHeight: 44,
    marginBottom: 12,
  },
  dateHint: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    textAlign: 'center',
  },
  readyText: {
    fontSize: 28,
    fontWeight: '700',
    color: SAGE,
    fontFamily: FH,
    textAlign: 'center',
    marginBottom: 8,
  },
  ctaBtn: {
    backgroundColor: SAGE,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    alignItems: 'center',
    marginBottom: 16,
  },
  ctaBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FH,
  },
  outlineBtn: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    alignItems: 'center',
  },
  outlineBtnText: {
    color: TEXT,
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FH,
  },
});
