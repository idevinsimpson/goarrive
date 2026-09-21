import { router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { describeCallableError } from '../../src/callableErrors';
import { resolveCurrentCommunity } from '../../src/currentCommunity';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { getFirebaseFunctions } from '../../src/firebase';
import { ButtonLink } from '../../src/ui/ButtonLink';
import {
  ACTION_GREEN,
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

export default function MoveResolver() {
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<Resolution>({ kind: 'working' });

  useEffect(() => {
    if (!wsfAuthEnabled || !ready) return;
    if (!user) {
      router.replace('/');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const fns = getFirebaseFunctions();
        const mine = await httpsCallable<Record<string, never>, { items: MyCommunityItem[] }>(
          fns,
          'wsfMyCommunities',
        )({});
        if (cancelled) return;
        const ids = mine.data.items.map((i) => i.groupId);
        const groupId = resolveCurrentCommunity(user.uid, ids);
        const community = mine.data.items.find((i) => i.groupId === groupId)?.displayName ?? null;
        // No community, or several with none chosen: Home already owns both of
        // those questions and answers them better than this route could.
        if (!groupId) {
          router.replace('/');
          return;
        }
        const listed = await httpsCallable<
          { groupId: string; includeHistory: boolean },
          ListGoalsResponse
        >(
          fns,
          'wsfListGoals',
          /*
            THE TOTALS ARE ONLY IN THE RESPONSE WHEN THIS FLAG IS ON.
            wsfListGoals returns sharedTotal only under includeHistory, so
            asking without it and falling back to zero printed "0 of 5,000
            squats" for a goal that actually stood at 1,847 -- a false
            statement about every row. This asks for what it is going to
            show. No new backend behaviour: the flag and the callable are
            both already there, and the caller is active-member-gated either
            way. Closed goals arrive with it; actionableGoals drops them, as
            it always has.
          */
        )({ groupId, includeHistory: true });
        if (cancelled) return;
        const open = actionableGoals(listed.data.goals ?? []);
        if (open.length === 0) {
          setState({ kind: 'noGoal', groupId, community });
          return;
        }
        if (open.length === 1) {
          const g = open[0];
          router.replace(
            `/contribute/${g.goalId}?groupId=${encodeURIComponent(groupId)}&mode=move`,
          );
          return;
        }
        setState({ kind: 'choose', groupId, community, goals: open });
      } catch (e) {
        if (cancelled) return;
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
    THE COMPOSITION, AND WHERE IT DIFFERS FROM THE TARGET.

    The approved target draws MOVE entry as a SHEET rising over the dimmed
    Home. Doing that truthfully needs a transparent-modal presentation so the
    real Home stays mounted underneath -- a router and shell change outside
    this slice, and a sheet floating above a tab bar that is still visible
    would be incoherent. So the implementation composes the same content as a
    screen, in the same language: a navy field carrying the question and the
    community, then the open goals on cream. The sheet stays an approved idea
    with a router change owing, and this AFTER says so rather than faking it.
  */
  const field = (eyebrow: string | null, title: string, intro: string) => (
    <View style={s.field}>
      <View pointerEvents="none" style={s.fieldGlow} />
      {eyebrow ? <Text style={s.fieldEyebrow}>{eyebrow}</Text> : null}
      <Text style={[display.md, s.fieldTitle]}>{title}</Text>
      <Text style={s.fieldIntro}>{intro}</Text>
    </View>
  );

  if (state.kind === 'choose') {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.body}>
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
        </View>
      </ScrollView>
    );
  }

  if (state.kind === 'noGoal') {
    return (
      <ScrollView style={s.screen} contentContainerStyle={s.body}>
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
          <ButtonLink
            href={`/community/${state.groupId}`}
            style={s.ghost}
            textStyle={s.ghostText}
            testID="wsf-move-no-goal-community"
            label="Go to your community"
          />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.body}>
      <View style={s.stack}>
        {state.kind === 'error' ? (
          <>
            {field(null, 'Something went wrong', state.message)}
            <Text style={s.hiddenProbe} testID="wsf-move-error">
              {state.message}
            </Text>
            <ButtonLink
              href="/"
              style={s.cardAction}
              textStyle={s.cardActionText}
              testID="wsf-move-error-home"
              label="Go Home"
            />
          </>
        ) : (
          <Text style={kit.statusText} testID="wsf-move-working">
            Finding what you are moving toward…
          </Text>
        )}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  body: { flexGrow: 1, padding: 20 },
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
