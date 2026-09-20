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
  HAIRLINE,
  INK_QUIET,
  NAVY,
  ON_ACTION,
  SURFACE,
  elevation,
  kit,
} from '../../src/ui/kit';
import { totalOfTargetLabel } from '../../src/ui/progressFormat';

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
  | { kind: 'choose'; groupId: string; goals: ListedGoal[] }
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
        )({ groupId, includeHistory: false });
        if (cancelled) return;
        const open = actionableGoals(listed.data.goals ?? []);
        if (open.length === 0) {
          router.replace(`/community/${groupId}`);
          return;
        }
        if (open.length === 1) {
          const g = open[0];
          router.replace(
            `/contribute/${g.goalId}?groupId=${encodeURIComponent(groupId)}&mode=move`,
          );
          return;
        }
        setState({ kind: 'choose', groupId, goals: open });
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

  if (state.kind === 'choose') {
    return (
      <ScrollView style={kit.scroll} contentContainerStyle={kit.page}>
        <View style={kit.column} testID="wsf-move-choose">
          <Text style={kit.heading}>What are you moving toward?</Text>
          <Text style={s.intro}>
            This community has more than one goal open. Pick the one this counts toward.
          </Text>
          {state.goals.map((g) => (
            <View key={g.goalId} style={s.row}>
              <Text style={s.rowTitle}>{g.title}</Text>
              <Text style={s.rowMeta}>
                {totalOfTargetLabel(g.sharedTotal ?? 0, g.target, g.unit)}
              </Text>
              <ButtonLink
                href={`/contribute/${g.goalId}?groupId=${encodeURIComponent(
                  state.groupId,
                )}&mode=move`}
                style={s.rowAction}
                textStyle={s.rowActionText}
                testID={`wsf-move-choose-${g.goalId}`}
                label={`Move toward ${g.title}`}
              />
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page}>
      <View style={kit.column}>
        {state.kind === 'error' ? (
          <>
            <Text style={kit.heading}>Something went wrong</Text>
            <Text style={s.intro} testID="wsf-move-error">
              {state.message}
            </Text>
            <ButtonLink
              href="/"
              style={s.rowAction}
              textStyle={s.rowActionText}
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
  intro: { color: INK_QUIET, fontSize: 15, lineHeight: 21 },
  row: {
    backgroundColor: SURFACE,
    borderRadius: 20,
    padding: 16,
    gap: 6,
    ...elevation.card,
  },
  rowTitle: { color: NAVY, fontSize: 17, fontWeight: '800', lineHeight: 23 },
  rowMeta: { color: INK_QUIET, fontSize: 13, lineHeight: 18 },
  rowAction: {
    backgroundColor: ACTION_GREEN,
    borderColor: HAIRLINE,
    borderRadius: 16,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  rowActionText: { color: ON_ACTION, fontSize: 16, fontWeight: '900', textAlign: 'center' },
});
