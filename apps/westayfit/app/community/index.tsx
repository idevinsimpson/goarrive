import { Link, router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { rememberCurrentCommunity } from '../../src/currentCommunity';
import { getFirebaseFunctions } from '../../src/firebase';
import { memberCountLabel } from '../../src/labels';
import { kit, TEXT_MUTED } from '../../src/ui/kit';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

/**
 * COMMUNITY — who "we" is, and which community Home opens.
 *
 * PRESENCE WITHOUT IDENTITIES. The only honest presence this product can show
 * today is a count of members, from data the member is already authorized to
 * read. There are no photos, no names of who moved, no reactions and no feed,
 * because none of those exist — inventing a face or a "3 friends are moving"
 * line here would be false social proof on a screen whose whole job is to be
 * true about other people.
 *
 * THE SEAM, recorded rather than built: per-goal recent movement IS published
 * (wsfGoalRecentAdditions — amount, unit and minute, never a person) but only
 * for a goal whose Champion has authorized public display. When that is on,
 * this screen can show "movement in the last hour" per community without
 * naming anyone. It is left out until it can be shown for every community
 * rather than only the authorized ones, because a presence line that appears
 * for some communities and silently not for others reads as "nobody here".
 */
type Item = { groupId: string; displayName: string; memberCount: number; role: string };
type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; items: Item[] };

export default function CommunityIndexScreen() {
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await httpsCallable<Record<string, never>, { items: Item[] }>(
          getFirebaseFunctions(), 'wsfMyCommunities'
        )({});
        if (!cancelled) setState({ kind: 'ready', items: Array.isArray(result.data?.items) ? result.data.items : [] });
      } catch {
        if (!cancelled) setState({ kind: 'error', message: 'Your communities could not be loaded just now.' });
      }
    })();
    return () => { cancelled = true; };
  }, [ready, user]);

  return (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page} testID="wsf-community-index">
      <View style={kit.columnNarrow}>
        <Pressable
          onPress={() => router.replace('/')}
          accessibilityRole="link"
          accessibilityLabel="We Stay Fit, go Home"
          style={{ minHeight: 44, justifyContent: 'center' }}
          testID="wsf-community-index-wordmark-home"
        >
          <WsfWordmark variant="navy" height={22} testID="wsf-community-index-wordmark" />
        </Pressable>
        <Text style={kit.heading} testID="wsf-community-index-title">Community</Text>

        {!ready || !user ? (
          <Text style={kit.statusText} testID="wsf-community-index-signed-out">Sign in to see your communities.</Text>
        ) : state.kind === 'loading' ? (
          <Text style={kit.statusText} testID="wsf-community-index-loading">Loading…</Text>
        ) : state.kind === 'error' ? (
          <Text style={kit.errorText} testID="wsf-community-index-error">{state.message}</Text>
        ) : state.items.length === 0 ? (
          <View style={kit.cardQuiet} testID="wsf-community-index-empty">
            <Text style={kit.body}>You are not in a community yet.</Text>
          </View>
        ) : (
          <View style={styles.rows} testID="wsf-community-index-rows">
            {state.items.map((item) => (
              <Pressable
                key={item.groupId}
                style={kit.cardQuiet}
                testID={`wsf-community-index-row-${item.groupId}`}
                accessibilityRole="link"
                accessibilityLabel={`Open ${item.displayName}`}
                onPress={() => {
                  // Opening one here is what makes it the community Home
                  // opens next time.
                  rememberCurrentCommunity(user.uid, item.groupId);
                  router.replace(`/community/${item.groupId}`);
                }}
              >
                <Text style={kit.cardTitle}>{item.displayName}</Text>
                <Text style={styles.note}>{memberCountLabel(item.memberCount)}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Joining and starting stay available, and stay secondary. */}
        <Link href="/start-community" style={styles.quietLink} testID="wsf-community-index-start">
          Start a community
        </Link>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  rows: { gap: 12 },
  note: { color: TEXT_MUTED, fontSize: 13, lineHeight: 18 },
  quietLink: { color: '#0F2138', fontSize: 15, lineHeight: 22, fontWeight: '700', textDecorationLine: 'underline' },
});
