import { router, useNavigation } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { describeCallableError } from '../../src/callableErrors';
import { resolveCurrentCommunity } from '../../src/currentCommunity';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ButtonLink } from '../../src/ui/ButtonLink';
import { armTabsFocusReturn, useSheetFocusReturn } from '../../src/ui/focusReturn';
import {
  SCRIM_PROPS,
  markSheetHandoff,
  sheetData,
  useSheetExit,
  useSheetFocusContainment,
} from '../../src/ui/sheetMotion';
import { useReducedMotion } from '../../src/ui/useReducedMotion';
import {
  ACTION_GREEN,
  CARD_BORDER,
  CREAM,
  HAIRLINE,
  INK_QUIET,
  NAVY,
  ON_ACTION,
  ON_NAVY,
  ON_NAVY_MUTED,
  PROGRESS_GREEN,
  SURFACE,
  display,
  elevation,
  kit,
} from '../../src/ui/kit';
import { fillRatio, formatCount, totalOfTargetLabel } from '../../src/ui/progressFormat';
import { SAME_LOAD_MS, peekGoals, peekMyCommunities, readGoals, readMyCommunities } from '../../src/memberReads';

/**
 * MOVE. The shell's one action, resolved.
 *
 * WHY A ROUTE AND NOT A LINK. The tab bar is on every member surface and
 * cannot know which goal a member would be moving toward: that takes the
 * member's communities and then that community's goals, two authorized reads.
 * A control in permanent chrome that guesses is a control that lies, and this
 * product already refuses to render one — the community switcher appears only
 * when there is somewhere to switch to.
 *
 * THE SAME TRUTH HOME USES, not a second opinion about it. The current
 * community comes from resolveCurrentCommunity, the goals from wsfListGoals,
 * and "actionable" means exactly what Home means by it: status active.
 *
 * WHAT IT DOES, in the three cases that exist:
 *   one actionable goal      -> its contribution flow
 *   none                     -> that community's Home, which says so honestly
 *   several, none featured   -> asks. It does not invent a priority.
 *
 * It replaces rather than pushes, so MOVE never leaves a trail of itself in
 * the back stack.
 *
 * AND IT IS A SHEET, NOT A PAGE. The outer stack presents this route as a
 * transparent modal, so the tab the member pressed MOVE from is still mounted
 * and still on screen behind it. This screen therefore paints a scrim and a
 * panel rather than an opaque surface: the context stays legible, the tab bar
 * underneath is covered and cannot be touched, and there is one explicit
 * Close. Painting cream across the whole viewport -- which is what it used to
 * do -- made the transparent presentation invisible and the whole thing read
 * as another page.
 */

type ListedGoal = {
  goalId: string;
  title: string;
  target: number;
  unit: string;
  status: string;
  endsAt: string;
  sharedTotal?: number;
};
type ListGoalsResponse = { goals: ListedGoal[] };
type MyCommunityItem = { groupId: string; displayName: string };

type Resolution =
  | { kind: 'working' }
  /** One open goal, known: the flow for it replaces this sheet at once. */
  | { kind: 'handoff'; href: string }
  | { kind: 'choose'; groupId: string; community: string | null; goals: ListedGoal[] }
  /**
   * NOTHING OPEN. This used to redirect to the community, which is a truthful
   * destination but makes MOVE look like a button that did nothing. The member
   * pressed the one action in the chrome; they are owed a sentence about why
   * it did not take them anywhere, and a way on.
   */
  | { kind: 'noGoal'; groupId: string; community: string | null }
  | { kind: 'error'; message: string };

/**
 * Actionable, and ordered the way Home orders them: soonest to end first, with
 * the goal id breaking a tie so the answer is stable rather than arbitrary.
 */
function actionableGoals(goals: ListedGoal[]): ListedGoal[] {
  return goals
    .filter((g) => g.status === 'active')
    .slice()
    .sort((a, b) =>
      a.endsAt === b.endsAt ? a.goalId.localeCompare(b.goalId) : a.endsAt.localeCompare(b.endsAt),
    );
}

/**
 * PERF-MOBILE-1. WHAT THIS ACCOUNT ALREADY KNOWS DECIDES MOVE AT ONCE.
 *
 * Measured on `0b460ce3` (W7 Check 41B): every MOVE open painted "Finding
 * what you are moving toward…" over the member's tab, re-read the member's
 * communities and the current community's goals -- which the tab beneath had
 * just read -- and only then decided; the flow it handed to read the same
 * goals a second time. When this account's own authorized record (src/
 * memberReads.ts) already holds both answers, the decision is made from them
 * on the first frame. Anything short of that -- a cold link, no record, no
 * current community -- goes the way it always did: read, then decide, and a
 * refusal fails closed.
 *
 * What it does not do: decide for a different account (the record is this
 * uid's alone), or decide past what is recorded. A goal that closed since it
 * was read is answered by the flow it opens, whose own fresh read says so.
 */
function resolveFromRecord(uid: string): Resolution | null {
  const mine = peekMyCommunities(uid);
  if (!mine) return null;
  const groupId = resolveCurrentCommunity(
    uid,
    mine.items.map((i) => i.groupId),
  );
  if (!groupId) return null;
  const listed = peekGoals<ListedGoal>(uid, groupId);
  if (!listed) return null;
  const community = mine.items.find((i) => i.groupId === groupId)?.displayName ?? null;
  const open = actionableGoals(listed.goals ?? []);
  if (open.length === 0) return { kind: 'noGoal', groupId, community };
  if (open.length === 1) {
    return {
      kind: 'handoff',
      href: `/contribute/${open[0]!.goalId}?groupId=${encodeURIComponent(groupId)}&mode=move`,
    };
  }
  return { kind: 'choose', groupId, community, goals: open };
}

export default function MoveResolver() {
  const { ready, user } = useWsfAuth();
  const safeArea = useSafeAreaInsets();
  const [state, setState] = useState<Resolution>(() =>
    wsfAuthEnabled && ready && user ? resolveFromRecord(user.uid) ?? { kind: 'working' } : { kind: 'working' },
  );
  /*
    APP-FEEL-PARITY-1. THE SHEET TRAVELS OUT BEFORE IT GOES: the reference's
    180 ms exit, then the same Close as before (`useSheetExit`: one exit, and
    none once something else is in front). Reduced motion goes straight there.
  */
  const reducedMotion = useReducedMotion();
  const { phase, exit, leaving } = useSheetExit(reducedMotion);

  useEffect(() => {
    if (!wsfAuthEnabled || !ready) return;
    if (!user) {
      router.replace('/');
      return;
    }
    if (state.kind === 'handoff') {
      // The sheet stays up across the hand-off (see below).
      markSheetHandoff();
      router.replace(state.href as never);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Shared with any identical read in flight, or made for this account
        // within this load (src/memberReads.ts). Decided from the record, this
        // only confirms it; the member is not shown "working" meanwhile.
        const mine = {
          data: (await readMyCommunities(user.uid, SAME_LOAD_MS)) as unknown as { items: MyCommunityItem[] },
        };
        if (cancelled || leaving()) return;
        const ids = mine.data.items.map((i) => i.groupId);
        const groupId = resolveCurrentCommunity(user.uid, ids);
        const community = mine.data.items.find((i) => i.groupId === groupId)?.displayName ?? null;
        // No community, or several with none chosen: Home already owns both of
        // those questions and answers them better than this route could.
        if (!groupId) {
          router.replace('/');
          return;
        }
        /*
          THE TOTALS ARE ONLY IN THE RESPONSE WHEN includeHistory IS ON.
          wsfListGoals returns sharedTotal only under includeHistory, so asking
          without it and falling back to zero printed "0 of 5,000 squats" for a
          goal that actually stood at 1,847 -- a false statement about every
          row. `readGoals` always asks with it (src/memberReads.ts). Closed
          goals arrive with it; actionableGoals drops them, as it always has.
        */
        const listed = { data: await readGoals<ListedGoal>(user.uid, groupId, SAME_LOAD_MS) };
        // `leaving()`: the member pressed Close while this was being read.
        // They are leaving, and the answer must not send them anywhere else.
        if (cancelled || leaving()) return;
        const open = actionableGoals(listed.data.goals ?? []);
        if (open.length === 0) {
          setState({ kind: 'noGoal', groupId, community });
          return;
        }
        if (open.length === 1) {
          const g = open[0];
          // The sheet stays up across the hand-off: the flow it hands to is
          // the same sheet (app/_layout.tsx), and must not fade the dim in
          // again from nothing.
          markSheetHandoff();
          router.replace(
            `/contribute/${g.goalId}?groupId=${encodeURIComponent(groupId)}&mode=move`,
          );
          return;
        }
        setState({ kind: 'choose', groupId, community, goals: open });
      } catch (e) {
        if (cancelled || leaving()) return;
        setState({
          kind: 'error',
          message: describeCallableError(e, 'Could not work out what to move toward.'),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  /*
    THE COMPOSITION. The approved target draws MOVE entry as a sheet rising
    over the dimmed tab the member was on, and that is now what it is: the
    router change the earlier note here said was owing has landed, so this
    renders a scrim and a panel over a screen that is genuinely still mounted.
    The content inside is unchanged -- a navy field carrying the question and
    the community, then the open goals on cream.
  */

  /*
    CLOSE GOES BACK, AND FALLS BACK RATHER THAN DYING.

    A sheet opened from a tab has somewhere to return to, and `back()` returns
    to that exact screen with its scroll and its loaded state. A cold or
    deep-linked `/move` has no such entry -- nothing was covered, because
    nothing was there -- so Close resolves to the canonical member destination
    instead of being a control that does nothing.
  */
  const close = () => exit(leave);
  /*
    APP-FEEL-PARITY-1 CHECKPOINT 2. A NAMED WAY OUT LANDS ON THE MEMBER'S
    MOUNTED TABS; IT DOES NOT BUILD A SECOND SET.

    "Go to your community" and "Go Home" were links. Followed from this sheet
    -- a screen of the ROOT stack, above the tabs -- a link pushed a whole
    second tab navigator on top, with its own copy of the community going
    through the loading screen, while the first copy stayed painted under it
    and this sheet stayed in the history. Measured on `91392f9d`: two
    community instances and the loading screen.

    They now leave the way the contribution flow's labelled exits do
    (contribute/[goalId].tsx, `leaveFor`): the sheet travels out, then the
    community opens in the member's Home tab (`dismissTo`, which keeps the
    mounted screen when it is already that community), or the Home tab is
    selected as it stands.
  */
  const navigation = useNavigation();
  const leaveTo = (href: string) =>
    exit(() => {
      if (href === '/') {
        navigation.dispatch({
          type: 'POP_TO',
          payload: { name: '(tabs)', params: { screen: '(home)' } },
        } as never);
        return;
      }
      router.dismissTo(href as never);
    });
  const leave = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    // Nothing beneath to give focus back to: the member tabs that mount in
    // this sheet's place focus their heading instead of leaving it on `body`.
    armTabsFocusReturn();
    router.replace('/');
  };

  /*
    ESCAPE IS CLOSE. A sheet a keyboard member cannot dismiss from the keyboard
    is a trap with a mouse-shaped exit. Escape takes the same path as the Close
    button and the scrim, and only while this sheet is the screen in front: a
    contribution opened from one of its goals sits over it, and Escape there is
    not a request to close something the member cannot see.
  */
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !navigation.isFocused()) return;
      e.preventDefault();
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // `close` reads nothing from render: it is the router, every time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  /*
    A goal chosen here opens the contribution flow over the sheet, and its Back
    returns to the sheet: focus goes back to that goal's "Move" rather than to
    `body` (src/ui/focusReturn.ts). Closing the sheet then returns focus to
    whatever opened MOVE, which the tab shell handles.
  */
  const sheetRef = useRef<View>(null);
  useSheetFocusReturn(sheetRef);
  // Focus enters the PANEL on Close, and Tab stays in the panel while it is
  // in front (F2: the outer root also holds the scrim).
  const panelRef = useRef<View>(null);
  useSheetFocusContainment(panelRef);

  /*
    THE SHEET. The scrim covers the whole viewport, which is what keeps the tab
    bar underneath from being touched while this is open as well as what dims
    the context, and it is pressable because dismissing a sheet by its scrim is
    what a sheet is. The panel is bounded -- it does not fill the screen -- so
    the tab behind stays identifiable, and its bottom padding is the device's
    own safe area. It used to reserve MEMBER_TAB_BAR_BODY plus the raised
    control's overhang: chrome belonging to a screen this one is no longer part
    of, and the empty lower field that reservation left behind.
  */
  const sheet = (children: ReactNode) => (
    <View ref={sheetRef} style={s.sheetRoot} testID="wsf-move-screen">
      <Pressable
        style={s.scrim}
        onPress={close}
        testID="wsf-move-scrim"
        // Close is the keyboard's and the screen reader's way out; the scrim
        // is the pointer's only (F2: it was a Tab stop named "Close").
        {...SCRIM_PROPS}
        {...(sheetData('scrim', phase) as object)}
      />
      <View
        ref={panelRef}
        style={[s.sheet, { paddingBottom: safeArea.bottom + 16 }]}
        testID="wsf-move-sheet"
        {...(sheetData('panel', phase) as object)}
      >
        <View style={s.sheetHead}>
          <View pointerEvents="none" style={s.grabber} />
          <Pressable
            onPress={close}
            style={s.close}
            accessibilityRole="button"
            accessibilityLabel="Close"
            testID="wsf-move-close"
          >
            <Text style={s.closeText}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.body}>{children}</ScrollView>
      </View>
    </View>
  );

  const field = (eyebrow: string | null, title: string, intro: string) => (
    <View style={s.field}>
      <View pointerEvents="none" style={s.fieldGlow} />
      {eyebrow ? <Text style={s.fieldEyebrow}>{eyebrow}</Text> : null}
      <Text style={[display.md, s.fieldTitle]}>{title}</Text>
      <Text style={s.fieldIntro}>{intro}</Text>
    </View>
  );

  if (state.kind === 'choose') {
    return sheet(
      <View testID="wsf-move-choose" style={s.stack}>
        {field(
          state.community,
          'What are you moving toward?',
          `${state.goals.length} goals are open here. Pick the one this counts toward.`,
        )}
        {state.goals.map((g) => (
          <View key={g.goalId} style={s.card}>
            <View style={s.cardRow}>
              <View style={s.cardText}>
                <Text style={s.cardTitle}>{g.title}</Text>
                {/*
                  NEVER A FABRICATED ZERO. If this caller was not given the
                  shared total, the row says what the goal is FOR rather
                  than inventing a number for where it stands.
                */}
                <Text style={s.cardMeta} testID={`wsf-move-total-${g.goalId}`}>
                  {typeof g.sharedTotal === 'number'
                    ? totalOfTargetLabel(g.sharedTotal, g.target, g.unit)
                    : `Target ${formatCount(g.target)} ${g.unit}`}
                </Text>
              </View>
              <ButtonLink
                href={`/contribute/${g.goalId}?groupId=${encodeURIComponent(
                  state.groupId,
                )}&mode=move`}
                style={s.cardAction}
                textStyle={s.cardActionText}
                testID={`wsf-move-choose-${g.goalId}`}
                label="Move"
                accessibilityLabel={`Move toward ${g.title}`}
              />
            </View>
            {/*
              WHERE THE COMMUNITY ALREADY IS, on the row you would join. The
              track is filled by fillRatio -- the same ratio the Living WE
              fills by -- so the two can never disagree. A goal whose shared
              total this caller is not told renders no track at all rather
              than a track at nothing, which would read as zero progress.
            */}
            {typeof g.sharedTotal === 'number' ? (
              <View style={s.track}>
                <View
                  style={[
                    s.trackFill,
                    { width: `${fillRatio(g.sharedTotal, g.target) * 100}%` },
                  ]}
                />
              </View>
            ) : null}
          </View>
        ))}
        <Text style={s.note}>
          Nothing is recorded until you choose a goal and confirm an amount.
        </Text>
      </View>,
    );
  }

  if (state.kind === 'noGoal') {
    return sheet(
      <View testID="wsf-move-no-goal" style={s.stack}>
        {field(
          state.community,
          'Nothing is running right now',
          'When a Champion opens a goal, this is where you will record what you did.',
        )}
        <View style={s.quiet}>
          <Text style={s.quietTitle}>What is still here</Text>
          <Text style={s.quietBody}>
            Anything you already recorded toward past goals stays in Progress. New
            contributions need an open goal.
          </Text>
        </View>
        <ExitLink
          onGo={() => leaveTo(`/community/${state.groupId}`)}
          style={s.ghost}
          textStyle={s.ghostText}
          testID="wsf-move-no-goal-community"
          label="Go to your community"
        />
      </View>,
    );
  }

  return sheet(
    <View style={s.stack}>
      {state.kind === 'error' ? (
        <>
          {field(null, 'Something went wrong', state.message)}
          <Text style={s.hiddenProbe} testID="wsf-move-error">
            {state.message}
          </Text>
          <ExitLink
            onGo={() => leaveTo('/')}
            style={s.cardAction}
            textStyle={s.cardActionText}
            testID="wsf-move-error-home"
            label="Go Home"
          />
        </>
      ) : state.kind === 'handoff' ? null : (
        <Text style={kit.statusText} testID="wsf-move-working">
          Finding what you are moving toward…
        </Text>
      )}
    </View>,
  );
}

/** Looks like `ButtonLink`; leaves through the member's mounted tabs. */
function ExitLink({
  onGo,
  style,
  textStyle,
  testID,
  label,
}: {
  onGo: () => void;
  style: object;
  textStyle: object;
  testID: string;
  label: string;
}) {
  return (
    <Pressable
      onPress={onGo}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={style}
      testID={testID}
      // No href to follow, so it answers Enter itself (react-native-web
      // leaves Enter on role=link to the browser).
      {...({
        onKeyDown: (e: { key?: string; repeat?: boolean; nativeEvent?: { key?: string; repeat?: boolean } }) => {
          const key = e.key ?? e.nativeEvent?.key;
          if (key === 'Enter' && !(e.repeat ?? e.nativeEvent?.repeat)) onGo();
        },
      } as Record<string, unknown>)}
    >
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  /* The route's own ground is transparent -- set on the Stack screen -- so the
     sheet sits at the bottom of the viewport with the covered tab above it. */
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  /* Full-bleed on purpose: this is what makes the tab bar underneath
     unreachable while the sheet is open, as well as what dims the context. */
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(11,31,53,0.42)' },
  sheet: {
    /* Bounded, so the screen it opened over stays identifiable behind it. */
    maxHeight: '88%',
    backgroundColor: CREAM,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderTopWidth: 1,
    borderColor: CARD_BORDER,
    paddingHorizontal: 20,
    paddingTop: 8,
    ...elevation.hero,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    minHeight: 44,
  },
  grabber: {
    position: 'absolute',
    top: 6,
    left: '50%',
    marginLeft: -22,
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: HAIRLINE,
  },
  /* 44x44 with the label centred in it: the target is the control, not the
     word. Top right, so it is in the same place in every state. */
  close: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: NAVY, fontSize: 15, fontWeight: '800' },
  body: { paddingTop: 6, paddingBottom: 4 },
  stack: { gap: 14 },

  field: {
    backgroundColor: NAVY,
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 6,
    overflow: 'hidden',
    ...elevation.hero,
  },
  /* Bound to the field's width: a fixed circle reports its full box even
     when the parent clips it, and the overflow checks read the box. */
  fieldGlow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: -110,
    height: 200,
    borderBottomLeftRadius: 180,
    borderBottomRightRadius: 180,
    backgroundColor: 'rgba(34,197,94,0.10)',
  },
  fieldEyebrow: {
    color: PROGRESS_GREEN,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  fieldTitle: { color: ON_NAVY },
  fieldIntro: { color: ON_NAVY_MUTED, fontSize: 13.5, lineHeight: 19 },

  card: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 11,
    ...elevation.card,
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardText: { flex: 1, gap: 3 },
  cardTitle: { color: NAVY, fontSize: 16, lineHeight: 21, fontWeight: '800' },
  cardMeta: { color: INK_QUIET, fontSize: 12.5, lineHeight: 17 },
  cardAction: {
    backgroundColor: ACTION_GREEN,
    borderColor: ACTION_GREEN,
    borderRadius: 999,
    paddingHorizontal: 20,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardActionText: { color: ON_ACTION, fontSize: 15, fontWeight: '900', textAlign: 'center' },
  track: { height: 7, borderRadius: 999, backgroundColor: '#E8E4DC', overflow: 'hidden' },
  trackFill: { height: '100%', borderRadius: 999, backgroundColor: ACTION_GREEN },

  quiet: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    padding: 16,
    gap: 5,
    ...elevation.card,
  },
  quietTitle: { color: NAVY, fontSize: 15, fontWeight: '800' },
  quietBody: { color: INK_QUIET, fontSize: 13, lineHeight: 19 },

  ghost: {
    backgroundColor: SURFACE,
    borderColor: HAIRLINE,
    borderWidth: 1.5,
    borderRadius: 16,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostText: { color: NAVY, fontSize: 15, fontWeight: '800', textAlign: 'center' },

  note: { color: INK_QUIET, fontSize: 12, lineHeight: 17, textAlign: 'center' },
  /* The message is already the field's intro; this keeps the long-standing
     testID addressable without printing the sentence twice. */
  hiddenProbe: { height: 0, opacity: 0 },
});
