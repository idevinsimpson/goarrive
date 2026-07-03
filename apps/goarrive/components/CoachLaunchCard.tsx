/**
 * CoachLaunchCard — Dashboard entry point for the Coach Launch journey.
 *
 * Shows the coach's Coach Launch progress and a CTA that routes to
 * /(app)/coach-launch. Renders for coach and platformAdmin roles.
 */
import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { router } from 'expo-router';
import { db } from '../lib/firebase';
import { useAuth } from '../lib/AuthContext';
import { Icon } from './Icon';
import { BORDER, FB, FG, FH, GOLD, MUTED } from '../lib/theme';

const TOTAL_MODULES = 11;

export default function CoachLaunchCard() {
  const { user, claims, effectiveUid } = useAuth();
  const coachId = effectiveUid || claims?.coachId || user?.uid || '';

  const [completedCount, setCompletedCount] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!coachId) return;
    const unsub = onSnapshot(
      doc(db, 'coach_launch', coachId),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as any;
          const arr: string[] = Array.isArray(data.completedModuleIds) ? data.completedModuleIds : [];
          setCompletedCount(arr.length);
        }
        setLoaded(true);
      },
      (err) => {
        console.error('[CoachLaunchCard] load error:', err);
        setLoaded(true);
      }
    );
    return unsub;
  }, [coachId]);

  if (!loaded || dismissed) return null;

  const pct = Math.round((completedCount / TOTAL_MODULES) * 100);
  const started = completedCount > 0;
  const done = completedCount === TOTAL_MODULES;

  // Once the journey is complete, hide the card by default — the coach can
  // still access it from any other entry point we add later.
  if (done) return null;

  return (
    <Pressable
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
      onPress={() => router.push('/(app)/coach-launch' as any)}
    >
      <View style={s.headerRow}>
        <View style={s.headerLeft}>
          <Text style={s.eyebrow}>GUIDED JOURNEY</Text>
          <Text style={s.title}>Coach Launch</Text>
        </View>
        <Pressable onPress={() => setDismissed(true)} hitSlop={10} style={s.dismissBtn}>
          <Icon name="x" size={16} color="#4A5568" />
        </Pressable>
      </View>

      <Text style={s.body}>
        Start your guided path into the GoArrive coaching culture, systems, standards, and launch process.
      </Text>

      {started && (
        <>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${pct}%` as any }]} />
          </View>
          <Text style={s.progressText}>
            {completedCount}/{TOTAL_MODULES} modules · {pct}%
          </Text>
        </>
      )}

      <View style={s.ctaBtn}>
        <Text style={s.ctaBtnText}>
          {started ? 'Continue Launch' : 'Start Launch'}
        </Text>
        <Icon name="chevron-right" size={16} color="#0E1117" />
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#131A27',
    borderWidth: 1,
    borderColor: 'rgba(245,166,35,0.25)',
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    gap: 12,
  },
  cardPressed: {
    backgroundColor: '#151E2E',
  },
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
    color: GOLD,
    fontFamily: FB,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: FG,
    fontFamily: FH,
  },
  dismissBtn: {
    padding: 4,
  },
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
    backgroundColor: GOLD,
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
    backgroundColor: GOLD,
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
