import { router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../src/auth';
import { getFirebaseFunctions } from '../src/firebase';
import { kit, TEXT_MUTED } from '../src/ui/kit';
import { formatCount } from '../src/ui/progressFormat';
import { WsfWordmark } from '../src/ui/WsfWordmark';

/**
 * ACTIVITY — the member's OWN recorded movement, and nobody else's.
 *
 * PRIVATE BY CONSTRUCTION. Every number here comes from wsfMyContribution,
 * which answers only for the caller. There is no ranking, no comparison, no
 * other member's figure, and no way to reach one from this screen: the data
 * this screen can see does not contain anyone else.
 *
 * TRUTH. "Recorded" is the word throughout, because that is what the system
 * knows. It confirms a contribution was recorded; it has never confirmed that
 * a person exercised, and this screen must not be the first surface to imply
 * otherwise.
 */
type Row = { goalId: string; goalTitle: string; community: string; ownCredit: number; unit: string };
type State =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; rows: Row[] };

export default function ActivityScreen() {
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const fns = getFirebaseFunctions();
        const mine = await httpsCallable<Record<string, never>, { items: { groupId: string; displayName: string }[] }>(
          fns, 'wsfMyCommunities'
        )({});
        const communities = Array.isArray(mine.data?.items) ? mine.data.items : [];
        const rows: Row[] = [];
        for (const community of communities) {
          const goals = await httpsCallable<{ groupId: string; includeHistory: boolean }, { goals: { goalId: string; title: string; status: string; unit: string }[] }>(
            fns, 'wsfListGoals'
          )({ groupId: community.groupId, includeHistory: true });
          for (const goal of (goals.data?.goals ?? []).filter((g) => g.status === 'active')) {
            // One refusal must not empty the whole screen: a goal this member
            // cannot read is simply not one of their rows.
            const own = await httpsCallable<{ goalId: string }, { ownCredit: number; unit: string }>(
              fns, 'wsfMyContribution'
            )({ goalId: goal.goalId }).catch(() => null);
            if (!own) continue;
            if (typeof own.data?.ownCredit !== 'number' || own.data.ownCredit <= 0) continue;
            rows.push({
              goalId: goal.goalId,
              goalTitle: goal.title,
              community: community.displayName,
              ownCredit: own.data.ownCredit,
              unit: own.data.unit || goal.unit,
            });
          }
        }
        if (!cancelled) setState({ kind: 'ready', rows });
      } catch {
        if (!cancelled) setState({ kind: 'error', message: 'Your activity could not be loaded just now.' });
      }
    })();
    return () => { cancelled = true; };
  }, [ready, user]);

  return (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page} testID="wsf-activity">
      <View style={kit.columnNarrow}>
        <Pressable
          onPress={() => router.replace('/')}
          accessibilityRole="link"
          accessibilityLabel="We Stay Fit, go Home"
          style={{ minHeight: 44, justifyContent: 'center' }}
          testID="wsf-activity-wordmark-home"
        >
          <WsfWordmark variant="navy" height={22} testID="wsf-activity-wordmark" />
        </Pressable>
        <Text style={kit.heading} testID="wsf-activity-title">Your activity</Text>
        {/* Said once, plainly, at the top: this is private. */}
        <Text style={styles.note} testID="wsf-activity-privacy">
          Only you can see this. It is what you have recorded, not a score, and it is never compared with anyone else.
        </Text>

        {!ready || !user ? (
          <Text style={kit.statusText} testID="wsf-activity-signed-out">Sign in to see what you have recorded.</Text>
        ) : state.kind === 'loading' ? (
          <Text style={kit.statusText} testID="wsf-activity-loading">Loading your activity…</Text>
        ) : state.kind === 'error' ? (
          <Text style={kit.errorText} testID="wsf-activity-error">{state.message}</Text>
        ) : state.rows.length === 0 ? (
          <View style={kit.cardQuiet} testID="wsf-activity-empty">
            {/* An empty state that says what would fill it, without inventing
                a number to avoid looking empty. */}
            <Text style={kit.body}>Nothing recorded yet. What you add to a goal shows up here.</Text>
          </View>
        ) : (
          <View style={styles.rows} testID="wsf-activity-rows">
            {state.rows.map((row) => (
              <View key={row.goalId} style={kit.cardQuiet} testID={`wsf-activity-row-${row.goalId}`}>
                <Text style={styles.amount}>{`${formatCount(row.ownCredit)} ${row.unit}`}</Text>
                <Text style={kit.body}>{row.goalTitle}</Text>
                <Text style={styles.note}>{row.community}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 12 },
  amount: { color: '#0F2138', fontSize: 22, lineHeight: 28, fontWeight: '800' },
  note: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },
});
