import { router, useLocalSearchParams } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWsfAuth } from '../../../src/auth';
import { memberCountLabel } from '../../../src/labels';
import { getFirebaseFunctions } from '../../../src/firebase';
import {
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
  display,
  elevation,
} from '../../../src/ui/kit';
import { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG } from '../../../src/ui/MemberTabBar';
import { VisibilityNote, VisibilityToggle } from '../../../src/ui/VisibilityToggle';
import { WsfWordmark } from '../../../src/ui/WsfWordmark';

/**
 * MEMBERS — a community feature, with the member's own setting kept quiet.
 *
 * THIS PAGE WAS REDESIGNED AGAINST THE NORTH STAR, and what it drifted into is
 * worth writing down because the pull is a real one. Each version was trying to
 * prove the privacy guarantee IN THE INTERFACE — so privacy climbed the
 * hierarchy until it was the page title, the first card, the list's eyebrow and
 * the footer, and a members list had become a settings screen wearing a list.
 *
 * The guarantee does not need proving here. It is enforced in the callables and
 * pinned by tests that fail when it is removed. The North Star's own way of
 * saying a thing is private is `45 squats · private to you` on the Home
 * board — three words, inline, a modifier on a line that is mostly about
 * something else. Never a card, never a heading, never the page.
 *
 * SO: THE COMMUNITY LEADS AND CARRIES THE WEIGHT. The header is the board's own
 * rhythm — green eyebrow, community name, member count — and the list sits in a
 * navy panel, because the board uses navy selectively for the important object
 * on a screen and here the members ARE that object. The member's own control is
 * one unweighted row on the cream ground: reachable without scrolling a long
 * list, and visually subordinate to the panel below it by an order of
 * magnitude.
 *
 * THE WORD "MEMBERS", NOT "WHO IS HERE". That reads as live presence, and this
 * product tracks nobody's presence.
 *
 * WHAT IS DELIBERATELY ABSENT, each because adding it would leak:
 *
 *   · NO COUNT OF THE VISIBLE LIST beside the community's member count. The
 *     header prints `memberCount` over ALL active members; a second number
 *     would make "how many are hiding" a subtraction the product performs for
 *     the reader. The server refuses to return a visible count for the same
 *     reason.
 *   · NO AVATARS, INITIALS OR MONOGRAMS. No photo is collected in this slice,
 *     and a generated initial is a second identifier beside a name.
 *   · NO JOINED DATE, no "active recently", no ordering but the name. When
 *     somebody became visible turns a list into a timeline.
 *   · NO TAP TARGET ON A ROW. A name here leads nowhere — there is no member
 *     profile and no contribution attributed to it — so a pressable row would
 *     promise one.
 *   · NO SEARCH. A field answering "is Sam in this community" is a lookup
 *     oracle over a list somebody joined for the opposite reason.
 */

/**
 * The callable's error code, without its `functions/` prefix, or null.
 *
 * DISTINGUISHING `permission-denied` FROM A FAILED READ IS NOT AN ORACLE, and
 * it is worth being precise about why. The server answers `permission-denied`
 * IDENTICALLY for a community that does not exist and one the caller is not
 * in — that is the ambiguity it is protecting, and this screen preserves it by
 * rendering ONE refusal for the one code. What it must not do is show that
 * refusal as "could not be loaded just now", which tells a stranger nothing is
 * wrong and offers them a retry that can never succeed.
 */
function callableCode(e: unknown): string | null {
  if (!e || typeof e !== 'object' || !('code' in e)) return null;
  const raw = (e as { code?: unknown }).code;
  if (typeof raw !== 'string' || raw === '') return null;
  return raw.startsWith('functions/') ? raw.slice('functions/'.length) : raw;
}

/** One listed member. Mirrors the callable's response exactly — two fields. */
type MemberEntry = { displayName: string; role: 'foundingChampion' | 'member' };

/** The caller's own membership, read from the list Home already reads. */
type OwnMembership = {
  groupId: string;
  displayName: string;
  memberCount: number;
  visibility: 'private' | 'visible';
};

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'refused' }
  | {
      kind: 'ready';
      own: OwnMembership;
      members: MemberEntry[];
      /*
        The continuation from the server, or null when the list is complete.
        An OFFSET, not a document reference — the callable's comment says why
        a Firestore cursor here would be a uid in plaintext.
      */
      nextCursor: string | null;
      /** A page request in flight, so the control cannot be double-tapped. */
      loadingMore: boolean;
      /** The last page request failed; the list so far is still good. */
      moreFailed: boolean;
    };

/** A visibility change in flight, so the control cannot be double-tapped. */
type Saving = { kind: 'idle' } | { kind: 'saving' } | { kind: 'failed' };

export default function CommunityMembersScreen() {
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [saving, setSaving] = useState<Saving>({ kind: 'idle' });
  const [attempt, setAttempt] = useState(0);
  const safeArea = useSafeAreaInsets();
  const barInset = MEMBER_TAB_BAR_BODY + MEMBER_TAB_MOVE_OVERHANG + safeArea.bottom;

  // The request allowed to publish. A retry or an unmount while a slow read is
  // in flight must not let a stale answer land — and a stale answer HERE would
  // redraw somebody's visibility as the value it used to be.
  const liveRef = useRef(0);

  useEffect(() => {
    if (!ready || !user || !groupId) return;
    const token = ++liveRef.current;
    setState({ kind: 'loading' });
    setSaving({ kind: 'idle' });

    (async () => {
      const fns = getFirebaseFunctions();
      /*
        BOTH READS, IN PARALLEL, AND THE OWN-MEMBERSHIP ONE IS NOT OPTIONAL.
        The directory alone cannot tell this screen whether the CALLER is in
        it: a name in the list is not identifiable as the caller's, by design —
        there is no uid to compare, and matching on displayName would be wrong
        the moment two members share a name. So the caller's own answer comes
        from `wsfMyCommunities`, which returns it per community, and the toggle
        renders from that rather than from anything inferred about the list.

        `allSettled`, not `all`, because the two failures mean different
        things and a combined rejection loses which one happened.
      */
      const [mineResult, listedResult] = await Promise.allSettled([
        httpsCallable<Record<string, never>, { items: OwnMembership[] }>(
          fns,
          'wsfMyCommunities',
        )({}),
        httpsCallable<
          { groupId: string },
          { members: MemberEntry[]; nextCursor: string | null }
        >(
          fns,
          'wsfCommunityMembers',
        )({ groupId }),
      ]);
      if (liveRef.current !== token) return;

      /*
        THE DIRECTORY CALL IS THE AUTHORITY ON PERMISSION — it is the one with
        the gate in front of it. Its `permission-denied` is a refusal; anything
        else about it is a failed read.
      */
      if (listedResult.status === 'rejected') {
        setState(
          callableCode(listedResult.reason) === 'permission-denied'
            ? { kind: 'refused' }
            : { kind: 'error' },
        );
        return;
      }
      if (mineResult.status === 'rejected') {
        setState({ kind: 'error' });
        return;
      }

      const own = (mineResult.value.data?.items ?? []).find((i) => i.groupId === groupId);
      if (!own) {
        // The gate passed but Home does not list this community — the two
        // reads disagree, which is a broken read rather than a refusal.
        setState({ kind: 'error' });
        return;
      }
      setState({
        kind: 'ready',
        own: {
          groupId,
          displayName: own.displayName,
          // The roll over EVERY active member, straight from the aggregate the
          // product already publishes. Never compared with the list below it:
          // the difference is "how many are hiding".
          memberCount: typeof own.memberCount === 'number' ? own.memberCount : 0,
          visibility: own.visibility === 'visible' ? 'visible' : 'private',
        },
        members: Array.isArray(listedResult.value.data?.members)
          ? listedResult.value.data.members
          : [],
        nextCursor: listedResult.value.data?.nextCursor ?? null,
        loadingMore: false,
        moreFailed: false,
      });
    })();

    return () => {
      liveRef.current += 1;
    };
  }, [ready, user, groupId, attempt]);

  const setVisibility = useCallback(
    async (next: 'private' | 'visible') => {
      if (state.kind !== 'ready' || saving.kind === 'saving' || !groupId) return;
      setSaving({ kind: 'saving' });
      try {
        const fns = getFirebaseFunctions();
        const result = await httpsCallable<
          { groupId: string; visibility: 'private' | 'visible' },
          { groupId: string; visibility: 'private' | 'visible' }
        >(
          fns,
          'wsfSetCommunityVisibility',
        )({ groupId, visibility: next });
        /*
          THE SETTLED VALUE, NOT THE REQUESTED ONE. The callable returns what
          is stored; rendering `next` optimistically would show a member as
          named on a write that had not landed — the one direction this screen
          must never be wrong in. There is no optimistic update here for that
          reason, and the control is disabled while the write is in flight.
        */
        const settled = result.data?.visibility === 'visible' ? 'visible' : 'private';
        setSaving({ kind: 'idle' });
        // Re-read the list rather than splicing a name into it locally: the
        // list is the server's answer about other people, and this screen does
        // not compose one.
        setState((s) =>
          s.kind === 'ready' ? { ...s, own: { ...s.own, visibility: settled } } : s,
        );
        setAttempt((n) => n + 1);
      } catch {
        setSaving({ kind: 'failed' });
      }
    },
    [state.kind, saving.kind, groupId],
  );

  /*
    ONE MORE PAGE, APPENDED. The server returns a bounded page and a
    continuation, so a big community's directory arrives in pieces rather than
    being silently cut short — which is what the previous single `.limit(500)`
    did, and it could not be told apart from a complete list.

    Appended rather than replaced, and the cursor is taken from the response
    rather than computed here: the client does no arithmetic about how far
    down the list it is.
  */
  const loadMore = useCallback(async () => {
    if (state.kind !== 'ready' || state.loadingMore || !state.nextCursor || !groupId) return;
    const cursor = state.nextCursor;
    setState((s) => (s.kind === 'ready' ? { ...s, loadingMore: true, moreFailed: false } : s));
    try {
      const r = await httpsCallable<
        { groupId: string; cursor: string },
        { members: MemberEntry[]; nextCursor: string | null }
      >(
        getFirebaseFunctions(),
        'wsfCommunityMembers',
      )({ groupId, cursor });
      setState((s) =>
        s.kind === 'ready'
          ? {
              ...s,
              members: [...s.members, ...(Array.isArray(r.data?.members) ? r.data.members : [])],
              nextCursor: r.data?.nextCursor ?? null,
              loadingMore: false,
            }
          : s,
      );
    } catch {
      // The names already on screen stay. A failed page is not a failed list.
      setState((s) =>
        s.kind === 'ready' ? { ...s, loadingMore: false, moreFailed: true } : s,
      );
    }
  }, [state, groupId]);

  const body = (
    <View style={styles.column}>
      <Pressable
        onPress={() => router.replace('/community')}
        accessibilityRole="link"
        accessibilityLabel="We Stay Fit, back to your communities"
        style={styles.wordmarkTap}
        testID="wsf-members-wordmark-back"
      >
        <WsfWordmark variant="navy" height={22} testID="wsf-members-wordmark" />
      </Pressable>

      {/*
        THE BOARD'S HEADER RHYTHM: green eyebrow, community name, count. The
        eyebrow names the page, so there is no second headline competing with
        the community — and the community, not the feature, is what reads
        first. An earlier version inverted this: "People here" large, with the
        community reduced to a grey subtitle beneath it.
      */}
      <Text style={styles.pageEyebrow} testID="wsf-members-title">
        MEMBERS
      </Text>

      {!ready || !user ? (
        <Text style={styles.note} testID="wsf-members-signed-out">
          Sign in to see your community.
        </Text>
      ) : !groupId ? (
        <RefusedBody />
      ) : state.kind === 'loading' ? (
        <LoadingBody />
      ) : state.kind === 'refused' ? (
        <RefusedBody />
      ) : state.kind === 'error' ? (
        <FailureBody onRetry={() => setAttempt((n) => n + 1)} />
      ) : (
        <ReadyBody
          state={state}
          saving={saving}
          onSetVisibility={setVisibility}
          onLoadMore={loadMore}
        />
      )}
    </View>
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.page, { paddingBottom: barInset + 16 }]}
      testID="wsf-members"
    >
      {body}
    </ScrollView>
  );
}

/* ── loading ─────────────────────────────────────────────────────────────── */

/**
 * The skeleton is the real structure — the choice panel, then rows — so the
 * page keeps its identity while it waits. A member arriving here is often
 * arriving to change one setting, and a blank page hides where that control
 * will be.
 */
function LoadingBody() {
  return (
    <View style={styles.stateWrap} testID="wsf-members-loading">
      <View style={styles.skeletonPanel}>
        <View style={[styles.bone, { width: '58%', height: 17 }]} />
        <View style={[styles.bone, { width: '90%', height: 13 }]} />
        <View style={[styles.bone, { width: 148, height: 38 }]} />
      </View>
      {[0, 1, 2].map((i) => (
        <View key={i} style={styles.skeletonRow}>
          <View style={[styles.bone, { width: '46%', height: 16 }]} />
        </View>
      ))}
      <Text style={styles.note}>Loading…</Text>
    </View>
  );
}

/* ── refused ─────────────────────────────────────────────────────────────── */

/**
 * ONE SENTENCE FOR EVERY REFUSAL. It does not say whether the community
 * exists, and it does not say whether the member used to be in it. Both of
 * those are answers the server deliberately refused to give.
 */
function RefusedBody() {
  return (
    <View style={styles.stateWrap} testID="wsf-members-refused">
      <View style={styles.panelWhite}>
        <Text style={styles.panelTitle}>This isn&apos;t yours to see.</Text>
        <Text style={styles.panelBody}>
          Who is in a community is only ever shown to the people in it.
        </Text>
        <Pressable
          onPress={() => router.replace('/community')}
          accessibilityRole="link"
          accessibilityLabel="Go to your communities"
          style={styles.primary}
          testID="wsf-members-refused-back"
        >
          <Text style={styles.primaryText}>Your communities</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ── failure ─────────────────────────────────────────────────────────────── */

function FailureBody({ onRetry }: { onRetry: () => void }) {
  return (
    <View style={styles.stateWrap} testID="wsf-members-error">
      <View style={styles.panelWhite}>
        <Text style={styles.panelTitle}>This could not be loaded just now.</Text>
        <Text style={styles.panelBody}>
          Nothing has changed — this is the reading, not the record.
        </Text>
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Try loading again"
          style={styles.primary}
          testID="wsf-members-retry"
        >
          <Text style={styles.primaryText}>Try again</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ── ready ───────────────────────────────────────────────────────────────── */

function ReadyBody({
  state,
  saving,
  onSetVisibility,
  onLoadMore,
}: {
  state: Extract<State, { kind: 'ready' }>;
  saving: Saving;
  onSetVisibility: (next: 'private' | 'visible') => void;
  onLoadMore: () => void;
}) {
  return (
    <View style={styles.stateWrap} testID="wsf-members-ready">
      <Text style={[display.md, styles.community]} numberOfLines={2} testID="wsf-members-community">
        {state.own.displayName}
      </Text>
      <Text style={styles.count} testID="wsf-members-count">
        {memberCountLabel(state.own.memberCount)}
      </Text>

      {/*
        THE MEMBER'S OWN SETTING: one unweighted row, no card, no heading of
        its own. It sits above the list so it is reachable without scrolling
        past however many names there are, and it is subordinate to the navy
        panel below by an order of magnitude — which is the whole point of the
        correction. MEMBERS is about the community; this is about me.
      */}
      <View style={styles.ownRow} testID="wsf-members-own">
        <VisibilityToggle
          communityName={state.own.displayName}
          value={state.own.visibility}
          busy={saving.kind === 'saving'}
          onChange={onSetVisibility}
          testID="wsf-members-toggle"
        />
        <VisibilityNote communityName={state.own.displayName} />
        {saving.kind === 'failed' ? (
          <Text style={styles.saveFailed} testID="wsf-members-save-failed">
            That did not save. Nothing has changed — try again.
          </Text>
        ) : null}
      </View>

      {/*
        THE IMPORTANT OBJECT ON THE SCREEN, and the board uses navy to say so.
        A members page drawn entirely in cream cards has no centre of gravity
        and reads as settings, which is exactly what this one did.
      */}
      <View style={styles.panel} testID="wsf-members-list">
        {state.members.length === 0 ? (
          /*
            NOT "nobody is here". The count above says how many members there
            are. The list is empty because none of them has chosen to be
            shown — a different fact, and the only one this page may state.
          */
          <Text style={styles.empty} testID="wsf-members-empty">
            No one is shown here yet.
          </Text>
        ) : (
          state.members.map((m, i) => (
            /*
              KEYED BY INDEX, DELIBERATELY. There is no id in the payload and
              there must not be: a stable per-member key would be a handle on a
              person. The list is re-read whole on every change, so an index
              key cannot desynchronise anything.
            */
            <View
              key={i}
              style={[styles.row, i === 0 ? styles.rowFirst : null]}
              testID={`wsf-members-row-${i}`}
            >
              <Text style={styles.rowName} numberOfLines={1}>
                {m.displayName}
              </Text>
              {/*
                Only the Champion's role is printed, matching `roleCardLabel`
                everywhere else: "Member" is what everybody else already knows
                about themselves, and a badge on it would invent a hierarchy.
              */}
              {m.role === 'foundingChampion' ? (
                <Text style={styles.rowRole}>Champion</Text>
              ) : null}
            </View>
          ))
        )}

        {state.nextCursor ? (
          /*
            NO COUNT ON THIS CONTROL. "Show 43 more" would state how many
            visible members remain, and the number of people still to come is
            not a fact this page publishes — the same reason nothing here
            prints the size of the list beside the community's member count.
          */
          <Pressable
            onPress={onLoadMore}
            disabled={state.loadingMore}
            accessibilityRole="button"
            accessibilityState={{ disabled: state.loadingMore }}
            accessibilityLabel="Show more members"
            style={styles.more}
            testID="wsf-members-more"
          >
            <Text style={styles.moreText}>
              {state.loadingMore ? 'Loading…' : 'Show more'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {state.moreFailed ? (
        <Text style={styles.moreFailed} testID="wsf-members-more-failed">
          More members could not be loaded just now.
        </Text>
      ) : null}

      {/*
        ONE LINE, and the only explaining the page does about the LIST rather
        than about any member. It says why the list is the length it is, which
        is the single thing a reader cannot work out and would otherwise get
        wrong — most of all when it is empty.
      */}
      <Text style={styles.foot} testID="wsf-members-foot">
        Only members who choose to be visible are shown.
      </Text>
    </View>
  );
}

/* ── styles ──────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: CREAM },
  page: { paddingHorizontal: 20, paddingTop: 18 },
  column: { gap: 12 },
  wordmarkTap: { alignSelf: 'flex-start', paddingVertical: 4, paddingRight: 8 },
  /* The board's eyebrow: green, small, heavy, letterspaced. */
  pageEyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  note: { fontSize: 15, lineHeight: 21, color: TEXT_MUTED },

  stateWrap: { gap: 12 },
  community: { color: NAVY },
  count: { fontSize: 15, lineHeight: 21, color: TEXT_MUTED, marginTop: -4 },

  /* One row on the ground, not a card: no border, no fill, no shadow. */
  ownRow: { gap: 6, paddingVertical: 4 },
  saveFailed: { fontSize: 14, lineHeight: 20, color: NAVY },

  /* THE navy object. */
  panel: {
    backgroundColor: NAVY,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 6,
    marginTop: 4,
    ...elevation.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: ON_NAVY_RULE,
  },
  rowFirst: { borderTopWidth: 0 },
  rowName: { flexShrink: 1, fontSize: 16, lineHeight: 22, color: ON_NAVY },
  rowRole: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    color: ON_NAVY_MUTED,
    fontWeight: '700',
  },
  empty: { fontSize: 15, lineHeight: 21, color: ON_NAVY_MUTED, paddingVertical: 16 },

  more: { paddingVertical: 14, borderTopWidth: 1, borderTopColor: ON_NAVY_RULE },
  moreText: { color: ON_NAVY, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  moreFailed: { fontSize: 14, lineHeight: 20, color: NAVY },
  foot: { fontSize: 13, lineHeight: 19, color: INK_QUIET },

  /* The refusal and failure panels keep the ordinary white card. */
  panelWhite: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 18,
    gap: 10,
    ...elevation.card,
  },
  panelTitle: { fontSize: 18, lineHeight: 24, color: NAVY, fontWeight: '600' },
  panelBody: { fontSize: 15, lineHeight: 21, color: TEXT_MUTED },
  primary: {
    alignSelf: 'flex-start',
    backgroundColor: NAVY,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 2,
  },
  primaryText: { color: CREAM, fontSize: 15, lineHeight: 20, fontWeight: '600' },

  skeletonPanel: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 18,
    gap: 10,
  },
  skeletonRow: {
    backgroundColor: SURFACE,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: HAIRLINE,
    paddingHorizontal: 18,
    paddingVertical: 15,
  },
  bone: { backgroundColor: '#ECE8E0', borderRadius: 6 },
});
