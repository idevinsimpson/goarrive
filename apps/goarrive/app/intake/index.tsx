/**
 * Intake index — Coach selection before intake form
 *
 * Public page. Asks if the member has a specific coach.
 * If yes → shows coach list → navigates to /intake/{coachId}
 * If no  → navigates to /intake/unassigned (goes to admin)
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  Image,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '../../lib/firebase';

const FONT_H = Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_B = Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

const C = {
  bg:       '#0F1117',
  surface:  '#161A24',
  card:     '#1C2030',
  border:   '#252B3D',
  borderSub:'#1E2538',
  green:    '#7BA05B',
  greenDim: 'rgba(123,160,91,0.12)',
  gold:     '#F5A623',
  goldGlow: 'rgba(245,166,35,0.20)',
  blue:     '#7BA7D4',
  text:     '#E8EAF0',
  textSoft: '#9BA3B8',
  muted:    '#6B7280',
  white:    '#FFFFFF',
  dark:     '#0E1117',
};

interface CoachOption {
  uid: string;
  displayName: string;
}

export default function IntakeIndex() {
  const [hasCoach, setHasCoach] = useState<boolean | null>(null);
  const [coaches, setCoaches] = useState<CoachOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCoach, setSelectedCoach] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch coaches when user says "yes"
  useEffect(() => {
    if (hasCoach !== true) return;
    setLoading(true);
    const q = query(collection(db, 'coaches'), orderBy('createdAt', 'desc'));
    getDocs(q)
      .then((snap) => {
        const list: CoachOption[] = snap.docs
          .map((d) => ({
            uid: d.id,
            displayName: d.data().displayName || d.data().name || '',
          }))
          .filter((c) => c.displayName.trim().length > 0);
        setCoaches(list);
      })
      .catch((err) => {
        console.warn('[intake] Failed to load coaches:', err);
      })
      .finally(() => setLoading(false));
  }, [hasCoach]);

  const filteredCoaches = useMemo(() => {
    if (searchQuery.trim().length < 2) return [];
    const q = searchQuery.toLowerCase().trim();
    return coaches.filter((c) => c.displayName.toLowerCase().includes(q));
  }, [searchQuery, coaches]);

  function handleContinue() {
    if (hasCoach && selectedCoach) {
      router.push(`/intake/${selectedCoach}`);
    } else {
      router.push('/intake/unassigned');
    }
  }

  return (
    <View style={s.container}>
      {/* Nav */}
      <View style={[s.nav, Platform.OS === 'web' && ({ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 999 } as any)]}>
        <Pressable onPress={() => router.replace('/')}>
          <Image
            source={require('../../assets/logo.png')}
            style={s.logo}
            resizeMode="contain"
            accessibilityLabel="GoArrive"
          />
        </Pressable>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Progress indicator */}
        <View style={s.progress}>
          <View style={s.progressFill} />
        </View>
        <Text style={s.stepLabel}>Step 1 of 2</Text>

        {/* Header */}
        <Text style={s.heading}>Let's get you started</Text>
        <Text style={s.sub}>
          First, tell us if you already have a coach in mind. If not, we will match you with the right one.
        </Text>

        {/* Coach question */}
        <Text style={s.question}>Do you have a specific coach you'd like to train with?</Text>

        <View style={s.optionRow}>
          <Pressable
            style={[s.optionBtn, hasCoach === true && s.optionBtnActive]}
            onPress={() => { setHasCoach(true); setSelectedCoach(null); setSearchQuery(''); }}
          >
            <Text style={[s.optionText, hasCoach === true && s.optionTextActive]}>Yes, I do</Text>
          </Pressable>
          <Pressable
            style={[s.optionBtn, hasCoach === false && s.optionBtnActive]}
            onPress={() => { setHasCoach(false); setSelectedCoach(null); setSearchQuery(''); }}
          >
            <Text style={[s.optionText, hasCoach === false && s.optionTextActive]}>No, match me with a coach</Text>
          </Pressable>
        </View>

        {/* Coach selection */}
        {hasCoach === true && (
          <View style={s.coachSection}>
            <Text style={s.coachLabel}>Search for your coach</Text>
            {loading ? (
              <ActivityIndicator color={C.gold} style={{ marginTop: 20 }} />
            ) : (
              <>
                <TextInput
                  style={s.searchInput}
                  placeholder="Start typing your coach's name..."
                  placeholderTextColor={C.muted}
                  value={searchQuery}
                  onChangeText={(text) => {
                    setSearchQuery(text);
                    if (text.trim().length < 2) setSelectedCoach(null);
                  }}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
                {searchQuery.trim().length >= 2 && filteredCoaches.length === 0 && (
                  <Text style={s.emptyText}>No coaches found matching "{searchQuery}". Check spelling or continue without a coach.</Text>
                )}
                {filteredCoaches.length > 0 && (
                  <View style={s.coachList}>
                    {filteredCoaches.map((coach) => (
                      <Pressable
                        key={coach.uid}
                        style={[s.coachCard, selectedCoach === coach.uid && s.coachCardActive]}
                        onPress={() => setSelectedCoach(coach.uid)}
                      >
                        <View style={[s.radio, selectedCoach === coach.uid && s.radioActive]}>
                          {selectedCoach === coach.uid && <View style={s.radioDot} />}
                        </View>
                        <Text style={[s.coachName, selectedCoach === coach.uid && { color: C.white }]}>
                          {coach.displayName}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>
        )}

        {/* No coach explanation */}
        {hasCoach === false && (
          <View style={s.matchSection}>
            <Text style={s.matchText}>
              No problem. We will review your intake and match you with a GoArrive coach who is the best fit for your goals and schedule.
            </Text>
          </View>
        )}

        {/* Continue button */}
        {hasCoach !== null && (hasCoach === false || selectedCoach || coaches.length === 0) && (
          <Pressable
            style={({ pressed }) => [s.ctaBtn, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}
            onPress={handleContinue}
          >
            <Text style={s.ctaBtnText}>Continue</Text>
          </Pressable>
        )}

        <View style={{ height: 60 }} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  nav: {
    backgroundColor: 'rgba(15,17,23,0.94)',
    borderBottomWidth: 1,
    borderBottomColor: C.borderSub,
    paddingHorizontal: 24,
    paddingVertical: 14,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)' } as any : {}),
  },
  logo: { width: 130, height: 30 },
  scroll: { flex: 1 },
  scrollContent: {
    paddingTop: Platform.OS === 'web' ? 90 : 20,
    paddingHorizontal: 24,
    maxWidth: 540,
    alignSelf: 'center',
    width: '100%' as any,
  },
  progress: {
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    marginBottom: 8,
    overflow: 'hidden',
  },
  progressFill: {
    width: '50%' as any,
    height: '100%' as any,
    backgroundColor: C.gold,
    borderRadius: 2,
  },
  stepLabel: {
    fontSize: 13,
    color: C.muted,
    fontFamily: FONT_B,
    marginBottom: 32,
  },
  heading: {
    fontSize: 32,
    fontWeight: '700',
    color: C.text,
    fontFamily: FONT_H,
    marginBottom: 12,
  },
  sub: {
    fontSize: 16,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 24,
    marginBottom: 40,
  },
  question: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    fontFamily: FONT_H,
    marginBottom: 20,
  },
  optionRow: {
    gap: 12,
    marginBottom: 32,
  },
  optionBtn: {
    padding: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    alignItems: 'center',
  },
  optionBtnActive: {
    borderColor: C.gold,
    backgroundColor: 'rgba(245,166,35,0.06)',
  },
  optionText: {
    fontSize: 16,
    fontWeight: '600',
    color: C.textSoft,
    fontFamily: FONT_H,
  },
  optionTextActive: {
    color: C.gold,
  },
  coachSection: {
    marginBottom: 32,
  },
  coachLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: C.textSoft,
    fontFamily: FONT_H,
    marginBottom: 14,
  },
  searchInput: {
    backgroundColor: C.card,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: C.text,
    fontFamily: FONT_B,
    marginBottom: 14,
  },
  coachList: {
    gap: 10,
  },
  coachCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    gap: 14,
  },
  coachCardActive: {
    borderColor: C.green,
    backgroundColor: C.greenDim,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: {
    borderColor: C.green,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: C.green,
  },
  coachName: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    fontFamily: FONT_H,
  },
  emptyText: {
    fontSize: 14,
    color: C.muted,
    fontFamily: FONT_B,
    lineHeight: 22,
    marginTop: 8,
  },
  matchSection: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 32,
  },
  matchText: {
    fontSize: 15,
    color: C.textSoft,
    fontFamily: FONT_B,
    lineHeight: 24,
  },
  ctaBtn: {
    backgroundColor: C.gold,
    paddingHorizontal: 36,
    paddingVertical: 18,
    borderRadius: 12,
    alignItems: 'center',
    alignSelf: 'center',
    width: '100%' as any,
    ...(Platform.OS === 'web' ? {
      boxShadow: `0 0 24px ${C.goldGlow}, 0 4px 12px rgba(0,0,0,0.3)`,
    } as any : {}),
  },
  ctaBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: C.dark,
    fontFamily: FONT_H,
    letterSpacing: 0.3,
  },
});
