import { router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { describeCallableError } from '../../src/callableErrors';
import { getFirebaseFunctions } from '../../src/firebase';
import {
  ACTION_GREEN,
  CARD_BORDER,
  CREAM,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  PROGRESS_GREEN,
  SURFACE,
  TEXT_MUTED,
} from '../../src/ui/kit';
import { MEMBER_TAB_BAR_BODY } from '../../src/ui/MemberTabBar';

/**
 * PRIVACY — how you appear in each of your communities.
 *
 * PER COMMUNITY, NOT PER ACCOUNT. Somebody glad to be named among the people
 * they train with on Tuesday has said nothing about a group they joined once.
 * A member may be visible at church and private at work, and the storage is per
 * membership row for exactly that reason.
 *
 * THE COMMUNITY IS THE HEADING AND THE CONTROLS SIT UNDER IT. Inverting that —
 * two global toggles each containing a list of communities — is what turns a
 * settings screen into a policy console. The controls are visually subordinate
 * to the community they belong to.
 *
 * COMMUNITY-VISIBLE BY DEFAULT, AND THE COPY SAYS SO PLAINLY. Both toggles
 * start on, because a missing stored preference resolves to visible inside the
 * community. What "visible" means is bounded and stated at the foot of the
 * page: other signed-in members of that community, and nowhere else — never the
 * open web, never a public display, never a kiosk.
 *
 * WHAT IS RENDERED IS WHAT IS STORED. `wsfSetCommunityVisibility` returns the
 * SETTLED value rather than an echo of the request, and this page adopts that
 * response. An optimistic switch that disagreed with the server would be a
 * member believing they are private when they are not — the one failure mode
 * this screen must never have. On failure it puts the switch back.
 */

type Vis = 'visible' | 'private';

type CommunityRow = {
  groupId: string;
  displayName: string;
  nameVisibility: Vis;
  activityVisibility: Vis;
};

type MyCommunitiesResponse = { items: CommunityRow[] };
type SetResponse = { groupId: string; name: Vis; activity: Vis };

export default function PrivacySettingsScreen() {
  const { user, ready } = useWsfAuth();
  const [rows, setRows] = useState<CommunityRow[]>([]);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const fn = httpsCallable<Record<string, never>, MyCommunitiesResponse>(
        getFirebaseFunctions(),
        'wsfMyCommunities'
      );
      const res = await fn({});
      setRows(res.data.items ?? []);
      setPhase('ready');
    } catch (e) {
      setError(describeCallableError(e, 'Your communities could not be loaded just now.'));
      setPhase('failed');
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (!user) {
      router.replace('/');
      return;
    }
    void load();
  }, [ready, user, load]);

  const setVisibility = useCallback(
    async (groupId: string, patch: { name?: Vis; activity?: Vis }) => {
      setBusy(groupId);
      setError(null);
      try {
        const fn = httpsCallable<
          { groupId: string; name?: Vis; activity?: Vis },
          SetResponse
        >(getFirebaseFunctions(), 'wsfSetCommunityVisibility');
        const res = await fn({ groupId, ...patch });
        // ADOPT THE SETTLED VALUE, never the requested one.
        setRows((prev) =>
          prev.map((r) =>
            r.groupId === groupId
              ? { ...r, nameVisibility: res.data.name, activityVisibility: res.data.activity }
              : r
          )
        );
      } catch (e) {
        setError(describeCallableError(e, 'That change could not be saved just now.'));
        // Re-read rather than guess: the switch must show what is stored.
        void load();
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  return (
    <ScrollView style={st.screen} contentContainerStyle={st.body} testID="wsf-privacy-screen">
      <View style={st.chrome}>
        <Pressable
          onPress={() => router.replace('/settings')}
          accessibilityRole="link"
          accessibilityLabel="Back to Settings"
          testID="wsf-privacy-back"
        >
          <Text style={st.back}>‹</Text>
        </Pressable>
        <Text style={st.chromeTitle}>Settings</Text>
      </View>

      <View style={st.identity}>
        <Text style={st.eyebrow}>Privacy</Text>
        <Text style={st.title}>Community visibility</Text>
        <Text style={st.sub}>You choose this for each community separately.</Text>
      </View>

      {phase === 'loading' ? (
        <Text style={st.quiet} testID="wsf-privacy-loading">
          Loading your communities…
        </Text>
      ) : null}

      {error !== null ? (
        <Text style={st.error} testID="wsf-privacy-error">
          {error}
        </Text>
      ) : null}

      {phase === 'failed' ? (
        <Pressable onPress={() => void load()} accessibilityRole="button">
          <Text style={st.retry}>Try again</Text>
        </Pressable>
      ) : null}

      {phase === 'ready' && rows.length === 0 ? (
        <Text style={st.quiet} testID="wsf-privacy-none">
          You are not in a community yet. When you join one, your visibility in it appears here.
        </Text>
      ) : null}

      {rows.map((r) => {
        const nameOn = r.nameVisibility === 'visible';
        const activityOn = r.activityVisibility === 'visible';
        return (
          <View key={r.groupId} style={st.block} testID={`wsf-privacy-block-${r.groupId}`}>
            <Text style={st.blockName} numberOfLines={2}>
              {r.displayName}
            </Text>

            <View style={st.ctrlRow}>
              <Text style={st.ctrlLabel}>Show my name in this community</Text>
              <Switch
                value={nameOn}
                disabled={busy === r.groupId}
                onValueChange={(v) =>
                  void setVisibility(r.groupId, { name: v ? 'visible' : 'private' })
                }
                trackColor={{ true: ACTION_GREEN, false: '#D3CEC4' }}
                testID={`wsf-privacy-name-${r.groupId}`}
                accessibilityLabel={`Show my name in ${r.displayName}`}
              />
            </View>

            <View style={[st.ctrlRow, st.ctrlRule]}>
              <Text style={st.ctrlLabel}>Show my contributions in activity</Text>
              <Switch
                value={activityOn}
                disabled={busy === r.groupId}
                onValueChange={(v) =>
                  void setVisibility(r.groupId, { activity: v ? 'visible' : 'private' })
                }
                trackColor={{ true: ACTION_GREEN, false: '#D3CEC4' }}
                testID={`wsf-privacy-activity-${r.groupId}`}
                accessibilityLabel={`Show my contributions in ${r.displayName}`}
              />
            </View>

            {/*
              THE CONSEQUENCE, IN THE FEED'S OWN WORDS. "A member" is exactly
              what the activity row will read, so the setting is not something a
              member has to try in order to understand. The second sentence is
              the part people most need to hear: privacy never costs the
              community your effort.
            */}
            {!nameOn && activityOn ? (
              <Text style={st.note} testID={`wsf-privacy-note-${r.groupId}`}>
                Your activity appears as “A member.” Your effort still counts toward the total.
              </Text>
            ) : null}
            {!activityOn ? (
              <Text style={st.note} testID={`wsf-privacy-note-off-${r.groupId}`}>
                {nameOn
                  ? 'Your activity is not shown here. Your effort still counts toward the total.'
                  : 'You are not listed and your activity is not shown here. Your effort still counts toward the total.'}
              </Text>
            ) : null}
          </View>
        );
      })}

      {phase === 'ready' ? (
        <Text style={st.footnote} testID="wsf-privacy-boundary">
          This only affects what other signed-in members of that community see. Public screens and
          displays never show names.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  body: { paddingHorizontal: 20, paddingTop: 14, gap: 12, paddingBottom: MEMBER_TAB_BAR_BODY },
  chrome: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: NAVY, fontSize: 26, fontWeight: '800', lineHeight: 28 },
  chromeTitle: { color: TEXT_MUTED, fontSize: 12.5, fontWeight: '700' },
  identity: { gap: 6 },
  eyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: { color: NAVY, fontSize: 30, lineHeight: 35, fontWeight: '800', letterSpacing: -0.7 },
  sub: { color: TEXT_MUTED, fontSize: 12.5, lineHeight: 17 },
  quiet: { color: INK_QUIET, fontSize: 14, lineHeight: 20 },
  error: { color: NAVY, fontSize: 14, lineHeight: 20 },
  retry: { color: NAVY, fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' },
  block: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  blockName: { color: NAVY, fontSize: 16, lineHeight: 21, fontWeight: '800', marginBottom: 4 },
  ctrlRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9 },
  ctrlRule: { borderTopWidth: 1, borderTopColor: HAIRLINE },
  ctrlLabel: { color: NAVY, fontSize: 14, lineHeight: 20, flex: 1 },
  note: { color: TEXT_MUTED, fontSize: 12.5, lineHeight: 17, paddingTop: 6 },
  footnote: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17 },
});
