import { router, useLocalSearchParams } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../../src/auth';
import { describeCallableError } from '../../../src/callableErrors';
import { getFirebaseFunctions } from '../../../src/firebase';
import { memberCountLabel } from '../../../src/labels';
import { InitialsAvatar, isChampionRole } from '../../../src/ui/CommunityPresence';
import {
  CARD_BORDER,
  CREAM,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  ON_NAVY,
  ON_NAVY_MUTED,
  ON_NAVY_RULE,
  PROGRESS_GREEN,
  SURFACE,
  TEXT_MUTED,
} from '../../../src/ui/kit';
import { MEMBER_TAB_BAR_BODY } from '../../../src/ui/MemberTabBar';

/**
 * MEMBERS — the people in one community.
 *
 * THE FIRST SCREEN IN THIS PRODUCT THAT SHOWS ONE MEMBER'S NAME TO ANOTHER.
 * Until the social lane, no callable read `wsfMemberProfiles` for anybody but
 * the caller, and that absence is what made every "no names" guarantee true by
 * construction. From here it is true by care, so the care is written down.
 *
 * WHAT IS ON SCREEN IS EXACTLY WHAT THE CALLABLE RETURNED. `wsfCommunityMembers`
 * returns `{ displayName, role }` and no uid, no visibility flag and no
 * timestamp; this page therefore cannot render one. The list is keyed on the
 * array index deliberately — there is no id to key on, and adding one "for
 * React" would put a per-person handle back in the payload.
 *
 * MEMBERS IS A COMMUNITY FEATURE; PRIVACY IS A QUIET PERSONAL CONTROL. The
 * people are the navy panel — the board's weight for the important object on a
 * screen — and the member's own setting is one unweighted row beneath it with
 * no border, no fill and no heading. Three drafts of PR #390 drifted the other
 * way, each trying to PROVE the privacy guarantee in the interface until
 * privacy was the page title, the first card and the footer. The guarantee does
 * not need proving on screen; it is enforced in the callable.
 *
 * THE COUNT LINE STATES *THAT* SOME MEMBERS ARE UNLISTED, NEVER *HOW MANY*.
 * `memberCount` covers every active member including the private ones, so the
 * difference between it and the rows is derivable — that residual is
 * unavoidable in any directory. What the product declines to do is perform that
 * subtraction for the reader and label its result.
 *
 * NOT DRAWN, each because it would leak or mislead: no count beside Show more;
 * no joined date; no tap target on a row (there is nothing behind a person);
 * no search; no photo of any kind.
 */

type MemberEntry = { displayName: string; role: string };
type MembersResponse = { members: MemberEntry[]; nextCursor: string | null };
type MyCommunityItem = { groupId: string; displayName: string; memberCount: number };
type MyCommunitiesResponse = { items: MyCommunityItem[] };

type Phase = 'loading' | 'ready' | 'failed';

export default function MembersScreen() {
  const { groupId: rawGroupId } = useLocalSearchParams<{ groupId: string }>();
  const groupId = typeof rawGroupId === 'string' ? rawGroupId : '';
  const { user, ready: authReady } = useWsfAuth();

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [communityName, setCommunityName] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!groupId) {
      setPhase('failed');
      setError('This community could not be found.');
      return;
    }
    setPhase('loading');
    setError(null);
    const functions = getFirebaseFunctions();
    /*
      TWO INDEPENDENT AWAITS, NOT ONE `Promise.all`. PR #390 shipped the
      combined form and a legitimate `permission-denied` on the directory
      rendered as a generic "could not be loaded" with a Try again that could
      never succeed. The directory is the page; the community header is
      decoration, so a failure to read the header must not take the page down
      and a refusal on the directory must be reported as itself.
    */
    try {
      const listFn = httpsCallable<{ groupId: string; cursor?: string }, MembersResponse>(
        functions,
        'wsfCommunityMembers'
      );
      const res = await listFn({ groupId });
      setMembers(res.data.members ?? []);
      setCursor(res.data.nextCursor ?? null);
      setPhase('ready');
    } catch (e) {
      setError(describeCallableError(e, 'The people here could not be loaded just now.'));
      setPhase('failed');
      return;
    }

    try {
      const myFn = httpsCallable<Record<string, never>, MyCommunitiesResponse>(
        functions,
        'wsfMyCommunities'
      );
      const mine = await myFn({});
      const item = (mine.data.items ?? []).find((i) => i.groupId === groupId);
      if (item) {
        setCommunityName(item.displayName);
        setMemberCount(item.memberCount);
      }
    } catch {
      // The header is decoration. Its absence is not an error state.
    }
  }, [groupId]);

  useEffect(() => {
    if (!authReady) return;
    if (!user) {
      router.replace('/');
      return;
    }
    void load();
  }, [authReady, user, load]);

  const loadMore = useCallback(async () => {
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const listFn = httpsCallable<{ groupId: string; cursor?: string }, MembersResponse>(
        getFirebaseFunctions(),
        'wsfCommunityMembers'
      );
      const res = await listFn({ groupId, cursor });
      setMembers((prev) => [...prev, ...(res.data.members ?? [])]);
      setCursor(res.data.nextCursor ?? null);
    } catch (e) {
      setError(describeCallableError(e, 'More people could not be loaded just now.'));
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, groupId, loadingMore]);

  /*
    Shown only when somebody is actually unlisted. Saying it unconditionally
    would be narration; saying it when the list is complete would be false.
  */
  const someUnlisted =
    memberCount !== null && cursor === null && members.length < memberCount;

  return (
    <ScrollView style={st.screen} contentContainerStyle={st.body} testID="wsf-members-screen">
      <View style={st.chrome}>
        <Pressable
          onPress={() => router.replace(`/community/${groupId}`)}
          accessibilityRole="link"
          accessibilityLabel="Back to the community"
          testID="wsf-members-back"
        >
          <Text style={st.back}>‹</Text>
        </Pressable>
        {communityName ? (
          <Text style={st.chromeTitle} numberOfLines={1}>
            {communityName}
          </Text>
        ) : null}
      </View>

      <View style={st.identity}>
        <Text style={st.eyebrow}>Members</Text>
        <Text style={st.title}>Who moves here</Text>
        {memberCount !== null ? (
          <Text style={st.sub} testID="wsf-members-count">
            {memberCountLabel(memberCount)}
            {someUnlisted ? ' · some choose not to be listed' : ''}
          </Text>
        ) : null}
      </View>

      {phase === 'loading' ? (
        <Text style={st.quiet} testID="wsf-members-loading">
          Loading the people here…
        </Text>
      ) : null}

      {phase === 'failed' ? (
        <View style={st.failed} testID="wsf-members-failed">
          <Text style={st.failedText}>{error}</Text>
          <Pressable onPress={() => void load()} accessibilityRole="button">
            <Text style={st.retry}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      {phase === 'ready' ? (
        <View style={st.panel} testID="wsf-members-panel">
          {members.length === 0 ? (
            <Text style={st.panelEmpty} testID="wsf-members-none-listed">
              No one in this community is listed by name right now. Everyone here still counts
              toward what you are building together.
            </Text>
          ) : (
            members.map((m, i) => (
              // Keyed on the index because the payload carries no id — and it
              // must not start carrying one.
              <View key={i} style={[st.row, i > 0 ? st.rowRule : null]} testID="wsf-member-row">
                <InitialsAvatar displayName={m.displayName} role={m.role} onNavy />
                <Text style={st.name} numberOfLines={1}>
                  {m.displayName}
                </Text>
                {/*
                  ROLE ONLY WHERE IT IS USEFUL. Champion is who to ask. "Member"
                  repeated down every other row is a column of the same word,
                  which is what an admin table looks like, and this is not one.
                */}
                {isChampionRole(m.role) ? (
                  <View style={st.rolePill}>
                    <Text style={st.rolePillText}>Champion</Text>
                  </View>
                ) : null}
              </View>
            ))
          )}
        </View>
      ) : null}

      {/* NO COUNT ON THIS CONTROL — see the header comment. */}
      {phase === 'ready' && cursor !== null ? (
        <Pressable
          onPress={() => void loadMore()}
          accessibilityRole="button"
          style={st.quietLink}
          testID="wsf-members-more"
        >
          <Text style={st.quietLinkText}>
            {loadingMore ? 'Loading…' : 'Show more people'}
          </Text>
          <Text style={st.chevron}>›</Text>
        </Pressable>
      ) : null}

      {phase === 'ready' ? (
        <Pressable
          onPress={() => router.push('/settings/privacy')}
          accessibilityRole="link"
          style={st.quietLink}
          testID="wsf-members-own-visibility"
        >
          <Text style={st.quietLinkText}>Your visibility here · Settings</Text>
          <Text style={st.chevron}>›</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  body: { paddingHorizontal: 20, paddingTop: 14, gap: 12, paddingBottom: MEMBER_TAB_BAR_BODY },
  chrome: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { color: NAVY, fontSize: 26, fontWeight: '800', lineHeight: 28 },
  chromeTitle: { color: TEXT_MUTED, fontSize: 12.5, fontWeight: '700', flexShrink: 1 },
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
  failed: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 14,
    gap: 8,
  },
  failedText: { color: NAVY, fontSize: 14, lineHeight: 20 },
  retry: { color: NAVY, fontSize: 14, fontWeight: '800', textDecorationLine: 'underline' },
  panel: { backgroundColor: NAVY, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 4 },
  panelEmpty: { color: ON_NAVY_MUTED, fontSize: 14, lineHeight: 20, paddingVertical: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 10 },
  rowRule: { borderTopWidth: 1, borderTopColor: ON_NAVY_RULE },
  name: { color: ON_NAVY, fontSize: 16, lineHeight: 21, fontWeight: '800', flex: 1 },
  rolePill: {
    backgroundColor: 'rgba(145,203,125,0.18)',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  rolePillText: { color: PROGRESS_GREEN, fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  quietLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  quietLinkText: { color: NAVY, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  chevron: { color: INK_QUIET, fontSize: 20, fontWeight: '700' },
});
