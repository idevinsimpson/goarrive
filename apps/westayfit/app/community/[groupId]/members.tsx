import { router, useLocalSearchParams } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWsfAuth } from '../../../src/auth';
import { getFirebaseFunctions } from '../../../src/firebase';
import {
  CREAM,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  SURFACE,
  TEXT_MUTED,
  display,
  elevation,
} from '../../../src/ui/kit';
import { MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG } from '../../../src/ui/MemberTabBar';
import { WsfWordmark } from '../../../src/ui/WsfWordmark';

/**
 * WHO IS HERE — and only the people who said they wanted to be.
 *
 * THIS PAGE HAS NO ACCEPTED DESIGN TARGET. Every other implemented route in
 * this app was built to a reviewed frame; this one was authorised as a
 * capability before any frame for it was drawn. It is therefore built in the
 * established language — the same tokens, the same card, the same wordmark
 * header, the same skeleton-then-content shape as `/community` — and it is
 * recorded as UNCOVERED in the route index rather than quietly claimed as
 * covered. It needs creative review before it ships.
 *
 * THE PAGE STATES A CHOICE, NOT A ROSTER. The reason the list is short is
 * never "nobody is here"; it is "this is who chose to be named". Those are
 * different sentences and the difference is the whole feature, so the copy
 * says the second one in every state including the empty one. A member
 * reading an empty list must not conclude they are alone.
 *
 * WHAT IS NOT DRAWN, and why each would be a leak rather than a nicety:
 *
 *   · NO COUNT OF THIS LIST BESIDE THE COMMUNITY'S MEMBER COUNT. `/community`
 *     already shows `memberCount` over ALL active members. Printing "3 of 12
 *     are named" here makes "nine people are hiding" a subtraction the product
 *     performs for the reader. The server refuses to return a visible count
 *     for the same reason; drawing `members.length` next to a number carried
 *     from another screen would reintroduce it in the client.
 *   · NO AVATARS, NO INITIALS, NO MONOGRAMS. No photo is collected anywhere in
 *     this slice, and a generated initial is a second identifier beside a name
 *     that a member did not choose to publish.
 *   · NO "JOINED" DATE, no "active recently", no ordering by anything but the
 *     name. When somebody became visible turns a list into a timeline.
 *   · NO TAP TARGET ON A ROW. A name here leads nowhere: there is no member
 *     profile, no message, no contribution attributed to it. A row that looked
 *     pressable would promise one.
 *   · NO SEARCH. A field that answers "is Sam in this community" is a lookup
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
  visibility: 'private' | 'visible';
};

type State =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'refused' }
  | { kind: 'ready'; own: OwnMembership; members: MemberEntry[] };

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
        httpsCallable<{ groupId: string }, { members: MemberEntry[] }>(
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
          visibility: own.visibility === 'visible' ? 'visible' : 'private',
        },
        members: Array.isArray(listedResult.value.data?.members)
          ? listedResult.value.data.members
          : [],
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

      <Text style={[display.md, styles.pageTitle]} testID="wsf-members-title">
        Who is here
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
      <View style={styles.panel}>
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
      <View style={styles.panel}>
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
}: {
  state: Extract<State, { kind: 'ready' }>;
  saving: Saving;
  onSetVisibility: (next: 'private' | 'visible') => void;
}) {
  const visible = state.own.visibility === 'visible';

  return (
    <View style={styles.stateWrap} testID="wsf-members-ready">
      <Text style={styles.community} numberOfLines={2} testID="wsf-members-community">
        {state.own.displayName}
      </Text>

      {/* ── the member's own choice, first ──────────────────────────────── */}
      {/*
        THE CONTROL COMES BEFORE THE LIST, not after it. A member who has not
        chosen is private, and a private member scrolling a list of named
        people should find their own choice at the top rather than discover it
        under other people's names.
      */}
      <View style={styles.panel} testID="wsf-members-own">
        <Text style={styles.panelTitle}>
          {visible ? 'You are named here.' : 'You are not named here.'}
        </Text>
        <Text style={styles.panelBody}>
          {visible
            ? 'The other people in this community can see your name in the list below. Nothing else about you is shown — no photo, and nothing you have recorded.'
            : 'What you add still counts toward what this community is doing. Your name simply is not shown beside it.'}
        </Text>

        <Pressable
          onPress={() => onSetVisibility(visible ? 'private' : 'visible')}
          disabled={saving.kind === 'saving'}
          accessibilityRole="button"
          accessibilityState={{ disabled: saving.kind === 'saving' }}
          accessibilityLabel={
            visible
              ? `Stop showing your name in ${state.own.displayName}`
              : `Show your name in ${state.own.displayName}`
          }
          style={[styles.primary, saving.kind === 'saving' ? styles.primaryBusy : null]}
          testID="wsf-members-toggle"
        >
          <Text style={styles.primaryText}>
            {saving.kind === 'saving'
              ? 'Saving…'
              : visible
                ? 'Stop showing my name'
                : 'Show my name'}
          </Text>
        </Pressable>

        {saving.kind === 'failed' ? (
          <Text style={styles.saveFailed} testID="wsf-members-save-failed">
            That did not save. Nothing has changed — try again.
          </Text>
        ) : null}

        <Text style={styles.panelFoot}>
          This is per community. Changing it here changes nothing anywhere else.
        </Text>
      </View>

      {/* ── the people who chose to be named ───────────────────────────── */}
      <Text style={styles.eyebrow}>WHO CHOSE TO BE NAMED</Text>

      {state.members.length === 0 ? (
        /*
          NOT "NOBODY IS HERE". The community has members — `/community` says
          how many. This list is empty because none of them has chosen to be
          named, which is a different fact and the only one this screen is
          entitled to state.
        */
        <View style={styles.emptyPanel} testID="wsf-members-empty">
          <Text style={styles.emptyBody}>
            Nobody in this community has chosen to show their name yet.
          </Text>
          <Text style={styles.emptyFoot}>
            That is not the same as nobody being here.
          </Text>
        </View>
      ) : (
        <View style={styles.list} testID="wsf-members-list">
          {state.members.map((m, i) => (
            /*
              KEYED BY INDEX, DELIBERATELY. There is no id in the payload and
              there must not be: a stable per-member key would be a handle on a
              person. The list is re-read whole on every change, so an index
              key cannot desynchronise anything.
            */
            <View
              key={i}
              // The card already draws the top edge; a border on the first row
              // doubles it into a visible two-pixel line.
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
          ))}
        </View>
      )}

      <Text style={styles.foot} testID="wsf-members-foot">
        Everyone chooses this for themselves. Nobody can show your name for you,
        and nobody can see who has chosen not to be shown.
      </Text>
    </View>
  );
}

/* ── styles ──────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: CREAM },
  page: { paddingHorizontal: 20, paddingTop: 18 },
  column: { gap: 14 },
  wordmarkTap: { alignSelf: 'flex-start', paddingVertical: 4, paddingRight: 8 },
  pageTitle: { color: NAVY },
  note: { fontSize: 15, lineHeight: 21, color: TEXT_MUTED },

  stateWrap: { gap: 14 },
  community: { fontSize: 15, lineHeight: 20, color: INK_QUIET },

  panel: {
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
  panelFoot: { fontSize: 13, lineHeight: 18, color: INK_QUIET },
  saveFailed: { fontSize: 14, lineHeight: 20, color: NAVY },

  primary: {
    alignSelf: 'flex-start',
    backgroundColor: NAVY,
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 2,
  },
  primaryBusy: { opacity: 0.6 },
  primaryText: { color: CREAM, fontSize: 15, lineHeight: 20, fontWeight: '600' },

  eyebrow: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.1,
    color: INK_QUIET,
    fontWeight: '700',
    marginTop: 4,
  },

  list: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: HAIRLINE,
  },
  rowFirst: { borderTopWidth: 0 },
  rowName: { flexShrink: 1, fontSize: 16, lineHeight: 22, color: NAVY },
  rowRole: { fontSize: 12, lineHeight: 16, letterSpacing: 0.6, color: INK_QUIET, fontWeight: '700' },

  emptyPanel: {
    backgroundColor: SURFACE,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: HAIRLINE,
    padding: 18,
    gap: 6,
  },
  emptyBody: { fontSize: 15, lineHeight: 21, color: NAVY },
  emptyFoot: { fontSize: 13, lineHeight: 18, color: INK_QUIET },

  foot: { fontSize: 13, lineHeight: 19, color: INK_QUIET, marginTop: 2 },

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
