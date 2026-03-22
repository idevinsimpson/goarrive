/**
 * Admin screen — Platform admin tools
 *
 * Only visible to users with role === 'platformAdmin' or admin === true.
 * Provides system-level tools including the ability to add new coaches
 * and view all registered coaches.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Icon } from '../../components/Icon';
import { useAuth } from '../../lib/AuthContext';
import { getFunctions, httpsCallable } from 'firebase/functions';
import {
  getFirestore,
  collection,
  getDocs,
  orderBy,
  query,
} from 'firebase/firestore';

const FONT_HEADING =
  Platform.OS === 'web' ? "'Space Grotesk', sans-serif" : 'SpaceGrotesk-Bold';
const FONT_BODY =
  Platform.OS === 'web' ? "'DM Sans', sans-serif" : 'DMSans-Regular';

interface CoachRow {
  uid: string;
  name: string;
  email: string;
  createdAt?: number;
}

export default function AdminScreen() {
  const { user, claims } = useAuth();

  // Add Coach form state
  const [coachName, setCoachName] = useState('');
  const [coachEmail, setCoachEmail] = useState('');
  const [adding, setAdding] = useState(false);
  const [result, setResult] = useState<{
    type: 'success' | 'error';
    message: string;
    resetLink?: string;
  } | null>(null);

  // Coach list state
  const [coaches, setCoaches] = useState<CoachRow[]>([]);
  const [loadingCoaches, setLoadingCoaches] = useState(true);

  const isAdmin = claims?.admin === true;

  const fetchCoaches = useCallback(async () => {
    setLoadingCoaches(true);
    try {
      const db = getFirestore();
      const q = query(collection(db, 'coaches'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      const rows: CoachRow[] = [];
      snap.forEach((doc) => {
        const d = doc.data();
        rows.push({
          uid: doc.id,
          name: d.name ?? d.displayName ?? '—',
          email: d.email ?? '—',
          createdAt: d.createdAt,
        });
      });
      setCoaches(rows);
    } catch (err) {
      console.warn('[admin] Failed to load coaches', err);
    } finally {
      setLoadingCoaches(false);
    }
  }, []);

  useEffect(() => {
    if (isAdmin) fetchCoaches();
  }, [isAdmin, fetchCoaches]);

  async function handleAddCoach() {
    if (!coachName.trim() || !coachEmail.trim()) {
      setResult({ type: 'error', message: 'Please enter both name and email.' });
      return;
    }
    setAdding(true);
    setResult(null);
    try {
      const functions = getFunctions();
      const addCoach = httpsCallable<
        { email: string; displayName: string },
        { success: boolean; coachId: string; email: string; resetLink: string }
      >(functions, 'addCoach');
      const res = await addCoach({
        email: coachEmail.trim(),
        displayName: coachName.trim(),
      });
      setResult({
        type: 'success',
        message: `Coach "${res.data.email}" created. A password reset link has been generated.`,
        resetLink: res.data.resetLink,
      });
      setCoachName('');
      setCoachEmail('');
      // Refresh the coach list
      fetchCoaches();
    } catch (err: any) {
      const msg =
        err?.message?.includes('already-exists')
          ? 'A user with this email already exists.'
          : err?.message ?? 'Failed to create coach.';
      setResult({ type: 'error', message: msg });
    } finally {
      setAdding(false);
    }
  }

  function formatDate(ts?: number): string {
    if (!ts) return '—';
    return new Date(ts).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>
      <Text style={s.title}>Admin Panel</Text>
      <Text style={s.subtitle}>Platform administration tools</Text>

      <View style={s.card}>
        <Icon name="person" size={20} color="#F5A623" />
        <View style={s.cardContent}>
          <Text style={s.cardTitle}>Current User</Text>
          <Text style={s.cardValue}>{user?.email ?? '—'}</Text>
          <Text style={s.cardMeta}>
            Role: {claims?.role ?? 'unknown'} · Coach ID: {claims?.coachId ?? '—'}
          </Text>
        </View>
      </View>

      <View style={s.card}>
        <Icon name="check-circle" size={20} color="#6EBB7A" />
        <View style={s.cardContent}>
          <Text style={s.cardTitle}>Security Rules</Text>
          <Text style={s.cardValue}>Deployed</Text>
          <Text style={s.cardMeta}>
            Firestore rules active for all collections
          </Text>
        </View>
      </View>

      <View style={s.card}>
        <Icon name="activity" size={20} color="#5B9BD5" />
        <View style={s.cardContent}>
          <Text style={s.cardTitle}>App Version</Text>
          <Text style={s.cardValue}>Slice 1 · Week 5</Text>
          <Text style={s.cardMeta}>
            PWA deployed to goarrive.fit
          </Text>
        </View>
      </View>

      {/* Coach List — admin only */}
      {isAdmin && (
        <>
          <View style={s.sectionDivider} />
          <Text style={s.sectionTitle}>Coaches</Text>
          <Text style={s.sectionSubtitle}>
            All registered coaches on the platform.
          </Text>

          {loadingCoaches ? (
            <ActivityIndicator color="#F5A623" size="small" style={{ marginVertical: 12 }} />
          ) : coaches.length === 0 ? (
            <Text style={s.emptyText}>No coaches registered yet.</Text>
          ) : (
            <View style={s.coachList}>
              {coaches.map((c) => (
                <View key={c.uid} style={s.coachRow}>
                  <View style={s.coachAvatar}>
                    <Text style={s.coachInitial}>
                      {c.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={s.coachInfo}>
                    <Text style={s.coachName}>{c.name}</Text>
                    <Text style={s.coachEmail}>{c.email}</Text>
                  </View>
                  <Text style={s.coachDate}>{formatDate(c.createdAt)}</Text>
                </View>
              ))}
            </View>
          )}
        </>
      )}

      {/* Add Coach — admin only */}
      {isAdmin && (
        <>
          <View style={s.sectionDivider} />
          <Text style={s.sectionTitle}>Add Coach</Text>
          <Text style={s.sectionSubtitle}>
            Create a new coach account. They will receive a password reset email to set their password.
          </Text>

          <View style={s.formCard}>
            <View style={s.fieldWrap}>
              <Text style={s.fieldLabel}>Full Name</Text>
              <TextInput
                style={s.input}
                placeholder="e.g. Jordan Smith"
                placeholderTextColor="#4A5568"
                value={coachName}
                onChangeText={setCoachName}
                autoCapitalize="words"
                autoCorrect={false}
                editable={!adding}
              />
            </View>
            <View style={s.fieldWrap}>
              <Text style={s.fieldLabel}>Email</Text>
              <TextInput
                style={s.input}
                placeholder="coach@example.com"
                placeholderTextColor="#4A5568"
                value={coachEmail}
                onChangeText={setCoachEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                editable={!adding}
              />
            </View>

            {result && (
              <View
                style={[
                  s.resultBanner,
                  result.type === 'success' ? s.resultSuccess : s.resultError,
                ]}
              >
                <Icon
                  name={result.type === 'success' ? 'check-circle' : 'x-circle'}
                  size={16}
                  color={result.type === 'success' ? '#6EBB7A' : '#E05252'}
                />
                <View style={s.resultTextWrap}>
                  <Text
                    style={[
                      s.resultText,
                      result.type === 'success' ? s.resultTextSuccess : s.resultTextError,
                    ]}
                  >
                    {result.message}
                  </Text>
                  {result.resetLink && (
                    <Text style={s.resetLinkText} selectable>
                      Reset link: {result.resetLink}
                    </Text>
                  )}
                </View>
              </View>
            )}

            <Pressable
              style={[s.addBtn, adding && s.addBtnDisabled]}
              onPress={handleAddCoach}
              disabled={adding}
            >
              {adding ? (
                <ActivityIndicator color="#0E1117" size="small" />
              ) : (
                <Text style={s.addBtnText}>Create Coach Account</Text>
              )}
            </Pressable>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0E1117',
  },
  content: {
    padding: 16,
    paddingTop: Platform.select({ web: 60, default: 16 }),
    gap: 12,
    paddingBottom: 100,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  subtitle: {
    fontSize: 14,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    marginBottom: 8,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#1A2035',
    borderRadius: 14,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#2A3347',
    alignItems: 'flex-start',
  },
  cardContent: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  cardValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
  },
  cardMeta: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: '#2A3347',
    marginVertical: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
    lineHeight: 18,
    marginBottom: 4,
  },
  emptyText: {
    fontSize: 13,
    color: '#4A5568',
    fontFamily: FONT_BODY,
    fontStyle: 'italic',
    marginVertical: 8,
  },
  coachList: {
    backgroundColor: '#1A2035',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#2A3347',
    overflow: 'hidden',
  },
  coachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2A3347',
  },
  coachAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#2A3347',
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachInitial: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FONT_HEADING,
  },
  coachInfo: {
    flex: 1,
    gap: 2,
  },
  coachName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F0F4F8',
    fontFamily: FONT_HEADING,
  },
  coachEmail: {
    fontSize: 12,
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
  coachDate: {
    fontSize: 11,
    color: '#4A5568',
    fontFamily: FONT_BODY,
  },
  formCard: {
    backgroundColor: '#1A2035',
    borderRadius: 14,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  fieldWrap: {
    gap: 6,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8A95A3',
    fontFamily: FONT_BODY,
  },
  input: {
    backgroundColor: '#0E1117',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#F0F4F8',
    fontFamily: FONT_BODY,
    borderWidth: 1,
    borderColor: '#2A3347',
  },
  resultBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 12,
    borderRadius: 10,
  },
  resultSuccess: {
    backgroundColor: 'rgba(110,187,122,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(110,187,122,0.2)',
  },
  resultError: {
    backgroundColor: 'rgba(224,82,82,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(224,82,82,0.2)',
  },
  resultTextWrap: {
    flex: 1,
    gap: 4,
  },
  resultText: {
    fontSize: 13,
    fontFamily: FONT_BODY,
    lineHeight: 18,
  },
  resultTextSuccess: {
    color: '#6EBB7A',
  },
  resultTextError: {
    color: '#E05252',
  },
  resetLinkText: {
    fontSize: 11,
    color: '#7DD3FC',
    fontFamily: FONT_BODY,
    lineHeight: 16,
  },
  addBtn: {
    backgroundColor: '#F5A623',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 2,
  },
  addBtnDisabled: {
    opacity: 0.6,
  },
  addBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0E1117',
    fontFamily: FONT_HEADING,
  },
});
