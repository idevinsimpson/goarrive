import { useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

// react-native-web accepts a `dataSet` prop on Pressable / View that maps
// to `data-*` attributes on the DOM element, but react-native's TypeScript
// types omit it. We augment PressableProps locally so the e3 spec can key
// on the button's data-state="fresh|pending|counted" attribute without
// resorting to `as any` at the call site.
declare module 'react-native' {
  interface PressableProps {
    dataSet?: Record<string, string>;
  }
}

import { useWsfAuth } from '../../../src/auth';
import { AuthFlagOffPanel } from '../../../src/AuthFlagOffPanel';
import { describeCallableError } from '../../../src/callableErrors';
import { FormShell, SecondaryLink, TextField } from '../../../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../../../src/featureFlags';
import { getFirebaseFunctions } from '../../../src/firebase';
import { CARD_BORDER, CREAM, SURFACE, TEXT_MUTED, kit } from '../../../src/ui/kit';
import { ButtonLink } from '../../../src/ui/ButtonLink';
import { WsfWordmark } from '../../../src/ui/WsfWordmark';

// Response shapes mirror wsfListChallenge / wsfCheckIn in functions-westayfit.
// Kept narrow on purpose: the whitelist here is what a member is allowed to
// see. Anything the server may add later that is NOT in this shape stays
// invisible until it is intentionally surfaced.
type ChallengeSummary = {
  id: string;
  title: string;
  status: 'draft' | 'active' | 'completed';
  goalTarget: number | null;
};

type ListedMove = {
  id: string;
  title: string;
  instructions: string;
  sequence: number;
  dayNumber: number | null;
  locationLabel: string | null;
  requiresCode: boolean;
};

type PulseTotals = {
  participantCount: number;
  completedCount: number;
  goalTarget: number | null;
};

type ListChallengeResponse = {
  challenge: ChallengeSummary | null;
  moves: ListedMove[];
  myCheckedInMoveIds: string[];
  totals: PulseTotals;
};

type CheckInResponse = {
  alreadyCheckedIn: boolean;
  totals: PulseTotals;
};

type LoadState =
  | { kind: 'loading' }
  | { kind: 'notSignedIn' }
  | { kind: 'notMember' }
  | { kind: 'noActiveChallenge' }
  | {
      kind: 'ready';
      challenge: ChallengeSummary;
      moves: ListedMove[];
      checkedInMoveIds: Set<string>;
      totals: PulseTotals;
    }
  | { kind: 'error'; message: string };

export default function ChallengePage() {
  const params = useLocalSearchParams<{ groupId: string }>();
  const groupId = params.groupId;
  const { ready, user } = useWsfAuth();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [moveErrors, setMoveErrors] = useState<Record<string, string>>({});
  // Moves currently mid-flight against wsfCheckIn. Kept out of `state` so
  // the "did the list return me as counted?" question stays separable from
  // "is the tap still in flight?". A reload during pending aborts the
  // fetch, so the spec must wait for `data-state="counted"` before reload.
  const [pendingMoveIds, setPendingMoveIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!ready) return;
    if (!user) {
      setState({ kind: 'notSignedIn' });
      return;
    }
    if (!groupId) {
      setState({ kind: 'error', message: 'This community could not be found.' });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const fn = httpsCallable<{ groupId: string }, ListChallengeResponse>(
          getFirebaseFunctions(),
          'wsfListChallenge'
        );
        const result = await fn({ groupId });
        if (cancelled) return;
        const { challenge, moves, myCheckedInMoveIds, totals } = result.data;
        if (!challenge) {
          setState({ kind: 'noActiveChallenge' });
          return;
        }
        setState({
          kind: 'ready',
          challenge,
          moves,
          checkedInMoveIds: new Set(myCheckedInMoveIds),
          totals,
        });
      } catch (e) {
        if (cancelled) return;
        // permission-denied is what wsfListChallenge throws for a caller whose
        // membership is missing or not active. Anything else surfaces as a
        // generic error, matching the community page's shape.
        if (e instanceof FirebaseError && e.code === 'functions/permission-denied') {
          setState({ kind: 'notMember' });
          return;
        }
        setState({
          kind: 'error',
          message: describeCallableError(e, 'We couldn’t load this challenge. Try again.'),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, user, groupId]);

  const onCheckIn = useCallback(
    async (moveId: string, code?: string) => {
      if (state.kind !== 'ready') return;
      if (state.checkedInMoveIds.has(moveId)) return;
      if (pendingMoveIds.has(moveId)) return;

      // Three states per move: fresh -> pending -> counted. The shared
      // number still bumps optimistically so the tap feels instant, but
      // `checkedInMoveIds` (which drives the "Already counted" label + the
      // data-state="counted" attribute) is NOT set until the server
      // confirms. If a reload lands during pending, the fetch aborts and
      // the reloaded list is the source of truth — no stale "counted"
      // label against a server that never wrote.
      setState((prev) =>
        prev.kind === 'ready'
          ? {
              ...prev,
              totals: {
                ...prev.totals,
                completedCount: prev.totals.completedCount + 1,
              },
            }
          : prev
      );
      setPendingMoveIds((prev) => {
        const next = new Set(prev);
        next.add(moveId);
        return next;
      });
      setMoveErrors((errs) => {
        if (!errs[moveId]) return errs;
        const next = { ...errs };
        delete next[moveId];
        return next;
      });

      try {
        const fn = httpsCallable<{ moveId: string; code?: string }, CheckInResponse>(
          getFirebaseFunctions(),
          'wsfCheckIn'
        );
        const result = await fn({ moveId, code });
        // Server confirmed. Flip to counted and reconcile the shared count
        // with the server-computed value. `alreadyCheckedIn: true` takes
        // the same success path — the button stays counted, and totals
        // reflect what the server saw at commit time.
        setState((prev) => {
          if (prev.kind !== 'ready') return prev;
          const nextCheckedIn = new Set(prev.checkedInMoveIds);
          nextCheckedIn.add(moveId);
          return {
            ...prev,
            checkedInMoveIds: nextCheckedIn,
            totals: result.data.totals,
          };
        });
      } catch (e) {
        // Revert the optimistic bump and surface one plain sentence. The
        // button drops back to "I did this" (fresh) via the pending
        // release in the finally block.
        setState((prev) =>
          prev.kind === 'ready'
            ? {
                ...prev,
                totals: {
                  ...prev.totals,
                  completedCount: Math.max(
                    0,
                    prev.totals.completedCount - 1
                  ),
                },
              }
            : prev
        );
        const message =
          e instanceof FirebaseError && e.code === 'functions/failed-precondition'
            ? 'Cannot check in right now.'
            : describeCallableError(e, 'We couldn’t count that check-in. Try again.');
        setMoveErrors((errs) => ({ ...errs, [moveId]: message }));
      } finally {
        setPendingMoveIds((prev) => {
          if (!prev.has(moveId)) return prev;
          const next = new Set(prev);
          next.delete(moveId);
          return next;
        });
      }
    },
    [state, pendingMoveIds]
  );

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Challenge" testID="wsf-challenge-disabled" />;
  }

  if (state.kind === 'loading' || !ready) {
    return (
      <FormShell heading="Challenge" testID="wsf-challenge-loading">
        <Text style={kit.statusText}>Loading…</Text>
      </FormShell>
    );
  }

  if (state.kind === 'notSignedIn') {
    return (
      <FormShell
        heading="Challenge"
        intro="Sign in to see this challenge."
        testID="wsf-challenge-signed-out"
      >
        <SecondaryLink href="/signin" label="Sign in" />
      </FormShell>
    );
  }

  if (state.kind === 'notMember') {
    return (
      <FormShell
        heading="Not a member"
        intro="You are not a member of this community."
        testID="wsf-challenge-not-member"
      >
        <SecondaryLink href="/" label="Back to home" />
      </FormShell>
    );
  }

  if (state.kind === 'noActiveChallenge') {
    return (
      <FormShell
        heading="No active challenge"
        intro="There is no challenge running here right now."
        testID="wsf-challenge-none"
      >
        <SecondaryLink href={`/community/${groupId}` as never} label="Back to community" />
      </FormShell>
    );
  }

  if (state.kind === 'error') {
    return (
      <FormShell heading="Something went wrong" testID="wsf-challenge-error">
        <Text style={kit.errorText}>{state.message}</Text>
        <SecondaryLink href={`/community/${groupId}` as never} label="Back to community" />
      </FormShell>
    );
  }

  const { challenge, moves, checkedInMoveIds, totals } = state;
  const goalSuffix = totals.goalTarget !== null ? ` of ${totals.goalTarget}` : '';
  const participantLabel = `${totals.participantCount} members moving`;

  return (
    <ScrollView style={kit.scroll} contentContainerStyle={kit.page} keyboardShouldPersistTaps="handled">
      <View style={kit.column} testID="wsf-challenge">
        {/* Product chrome: the wordmark, compact, same as Community Home. */}
        <View style={kit.chrome}>
          <WsfWordmark variant="navy" height={22} testID="wsf-challenge-wordmark" />
          <ButtonLink
            href={`/community/${groupId}`}
            style={kit.chromeLink}
            textStyle={kit.chromeLinkText}
            testID="wsf-challenge-back"
            label="Back to community"
          />
        </View>

        {/* The hero: what the challenge is and where the shared number stands. */}
        <View style={kit.hero}>
          <Text style={kit.eyebrowOnNavy}>Challenge</Text>
          <Text style={kit.heroTitle}>{challenge.title}</Text>
          <Text style={styles.count} testID="wsf-challenge-count">
            {totals.completedCount}
            {goalSuffix}
          </Text>
          <Text style={kit.heroMeta} testID="wsf-challenge-participants">
            {participantLabel}
          </Text>
        </View>

        <View style={styles.moves}>
          {moves.map((move) => (
            <MoveRow
              key={move.id}
              move={move}
              checkedIn={checkedInMoveIds.has(move.id)}
              pending={pendingMoveIds.has(move.id)}
              error={moveErrors[move.id]}
              onCheckIn={onCheckIn}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

function MoveRow({
  move,
  checkedIn,
  pending,
  error,
  onCheckIn,
}: {
  move: ListedMove;
  checkedIn: boolean;
  pending: boolean;
  error?: string;
  onCheckIn: (moveId: string, code?: string) => void;
}) {
  const [code, setCode] = useState('');
  const codeMissing = move.requiresCode && code.trim().length === 0;
  const dataState: 'fresh' | 'pending' | 'counted' = checkedIn
    ? 'counted'
    : pending
      ? 'pending'
      : 'fresh';
  const label = checkedIn
    ? 'Already counted'
    : pending
      ? 'Counting…'
      : 'I did this';
  const disabled = codeMissing || pending;

  const onPress = () => {
    if (checkedIn || pending) return;
    onCheckIn(move.id, move.requiresCode ? code.trim() : undefined);
  };

  return (
    <View style={kit.card} testID={`wsf-challenge-move-${move.id}`}>
      <Text style={kit.cardTitle}>{move.title}</Text>
      {move.instructions ? (
        <Text style={kit.body}>{move.instructions}</Text>
      ) : null}
      {move.locationLabel ? (
        <Text style={kit.cardMeta}>{move.locationLabel}</Text>
      ) : null}
      {move.requiresCode && !checkedIn ? (
        <TextField
          value={code}
          onChangeText={setCode}
          placeholder="Check-in code"
          autoCapitalize="none"
          testID={`wsf-challenge-move-${move.id}-code`}
        />
      ) : null}
      <Pressable
        onPress={onPress}
        disabled={disabled}
        dataSet={{ state: dataState }}
        style={[
          kit.primaryButton,
          styles.moveButton,
          checkedIn ? styles.moveButtonDone : null,
          disabled ? kit.primaryButtonDisabled : null,
        ]}
        testID={`wsf-challenge-move-${move.id}-submit`}
        accessibilityRole="button"
      >
        <Text
          style={[
            kit.primaryButtonText,
            checkedIn ? styles.moveButtonTextDone : null,
          ]}
        >
          {label}
        </Text>
      </Pressable>
      {error ? (
        <Text style={kit.errorText} testID={`wsf-challenge-move-${move.id}-error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

// Layout that only this screen needs; every colour, shape and type style
// above comes from the kit.
const styles = StyleSheet.create({
  // The shared number: the biggest thing on the hero, cream on navy.
  count: {
    color: CREAM,
    fontSize: 44,
    fontWeight: '800',
    lineHeight: 50,
    letterSpacing: -0.5,
  },
  moves: {
    flexDirection: 'column',
    gap: 12,
  },
  // A move's action is a primary button at the card's compact height.
  moveButton: {
    minHeight: 48,
    marginTop: 4,
  },
  // Done: the button settles into the card, no longer asking for a tap.
  moveButtonDone: {
    backgroundColor: SURFACE,
    borderWidth: 1.5,
    borderColor: CARD_BORDER,
  },
  moveButtonTextDone: {
    color: TEXT_MUTED,
  },
});
