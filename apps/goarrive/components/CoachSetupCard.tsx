/**
 * CoachSetupCard — Dashboard entry point for the Coach Setup guide.
 *
 * Shown after Coach Launch is complete and coach_setup/{coachId} has no
 * completedAt timestamp. Dismissible per-session (not persisted).
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { router } from 'expo-router';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { Icon } from './Icon';
import { BORDER, BLUE, FB, FG, FH, GREEN, MUTED } from '../lib/theme';

const TOTAL_MODULES = 6;

export default function CoachSetupCard() {
  const { user, claims, effectiveUid } = useAuth();
  const coachId = effectiveUid || claims?.coachId || user?.uid || '';

  const [completedCount, setCompletedCount] = useState(0);
  const [setupComplete, setSetupComplete] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!coachId) return;
    const unsub = onSnapshot(
      doc(db, 'coach_setup', coachId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as any;
          const arr: string[] = Array.isArray(data.completedModules) ? data.completedModules : [];
          const contentIds = ['identity', 'connectStripe', 'zoomSetup', 'goaEmail', 'certification', 'firstMember'];
          setCompletedCount(arr.filter((id: string) => contentIds.includes(id)).length);
          setSetupComplete(!!data.completedAt);
        } else {
          setCompletedCount(0);
          setSetupComplete(false);
        }
        setLoaded(true);
      },
      (err) => {
        console.error('[CoachSetupCard] load error:', err);
        setLoaded(true);
      }
    );
    return unsub;
  }, [coachId]);

  if (!loaded || dismissed || setupComplete) return null;

  const pct = Math.round((completedCount / TOTAL_MODULES) * 100);
  const started = completedCount > 0;

  return (
    <Pressable
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
      onPress={() => router.push('/(app)/coach-setup' as any)}
    >
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <Text style={s.eyebrow}>PRACTICAL SETUP</Text>
          <Text style={s.title}>Coach Setup</Text>
        </View>
        <Pressable onPress={() => setDismissed(true)} hitSlop={10} style={s.dismissBtn}>
          <Icon name="x" size={16} color="#4A5568" />
        </Pressable>
      </View>

      <Text style={s.body}>
        Complete the operational setup steps — profile, Stripe, Zoom, email, certification, and first-member readiness.
      </Text>

      {started && (
        <>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${pct}%` as any }]} />
          </View>
          <Text style={s.progressText}>{completedCount}/{TOTAL_MODULES} modules · {pct}%</Text>
        </>
      )}

      <View style={s.ctaBtn}>
        <Text style={s.ctaBtnText}>{started ? 'Continue Setup' : 'Start Setup'}</Text>
        <Icon name="chevron-right" size={16} color="#0E1117" />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#131A27',
    borderWidth: 1,
    borderColor: 'rgba(91,155,213,0.30)',
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    gap: 12,
  },
  cardPressed: { backgroundColor: '#151E2E' },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerLeft: { gap: 4 },
  eyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    color: BLUE,
    fontFamily: FB,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
  },
  dismissBtn: { padding: 4 },
  body: {
    fontSize: 13,
    color: MUTED,
    fontFamily: FB,
    lineHeight: 18,
  },
  progressTrack: {
    height: 4,
    backgroundColor: BORDER,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: BLUE,
    borderRadius: 2,
  },
  progressText: {
    fontSize: 11,
    color: MUTED,
    fontFamily: FB,
    marginTop: -6,
  },
  ctaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: BLUE,
    borderRadius: 10,
    paddingVertical: 11,
  },
  ctaBtnText: {
    color: '#0E1117',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FH,
  },
});
