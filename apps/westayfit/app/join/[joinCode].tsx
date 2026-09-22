import { router, useLocalSearchParams } from 'expo-router';
import { FirebaseError } from 'firebase/app';
import { httpsCallable } from 'firebase/functions';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../../src/auth';
import { AuthFlagOffPanel } from '../../src/AuthFlagOffPanel';
import { describeCallableError } from '../../src/callableErrors';
import {
  FormShell,
  QuietShell,
  SecondaryLink,
  SubmitButton,
} from '../../src/AuthFormPrimitives';
import {
  clearDeviceMode,
  decideDeviceEntry,
  DEVICE_CHOICE_HEADING,
  DEVICE_CHOICE_INTRO_SIGNUP,
  DEVICE_SHARED_BODY,
  DEVICE_SHARED_RESET,
  DEVICE_SHARED_TITLE,
  readDeviceMode,
  saveDeviceMode,
  type DeviceMode,
} from '../../src/deviceMode';
import { wsfAuthEnabled } from '../../src/featureFlags';
import { getFirebaseFunctions } from '../../src/firebase';
import { groupTypeCardLabel } from '../../src/labels';
import {
  clearPendingJoinCode,
  setPendingJoinCode,
} from '../../src/pendingJoinCode';
import { readActivityLabel } from '../../src/eventActivity';
import {
  clearPendingEventActivity,
  clearPendingEventGoal,
  readPendingEventActivity,
  readPendingEventGoal,
  routeAfterJoin,
  setPendingEventActivity,
  setPendingEventGoal,
} from '../../src/stationSession';
import { readEventParam } from '../../src/ui/eventLinks';
import { ButtonLink } from '../../src/ui/ButtonLink';
import { DeviceChoice, SharedScreenNotice } from '../../src/ui/DeviceChoice';
import {
  ACTION_GREEN,
  CREAM,
  ERROR_RED,
  INK_QUIET,
  NAVY,
  SURFACE,
  elevation,
} from '../../src/ui/kit';
import { WsfWordmark } from '../../src/ui/WsfWordmark';

type Preview = {
  displayName: string;
  groupType: 'familyFriends' | 'custom';
  joinPolicy: string;
};

type PreviewState =
  | { kind: 'loading' }
  | { kind: 'invalid' }
  | { kind: 'rateLimited' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; preview: Preview };

type JoinState =
  | { kind: 'idle' }
  | { kind: 'joining' }
  | { kind: 'error'; message: string };

export default function JoinPage() {
  const params = useLocalSearchParams<{ joinCode: string; event?: string; activity?: string }>();
  const joinCode = typeof params.joinCode === 'string' ? params.joinCode.trim() : '';
  /**
   * `?event=<goalId>` — set only by the QR on the screen at an event. It names
   * a goal and nothing else: no token, no authority, and nothing that changes
   * who may be admitted. A join that arrives with it finishes at that event's
   * page instead of the community page, which is the difference between
   * someone standing in a hall being shown where to add their part and being
   * dropped somewhere they have to navigate out of.
   */
  const eventGoalId = readEventParam(params.event);
  /**
   * `?activity=<label>` — the second half of the same context, set by the same
   * QR. It names what that screen was running, in the event's own published
   * word for it. It is not a token, not an id, not routed to and not a fact
   * about anybody; it is the selection this journey is carrying, and it is let
   * go the moment the journey ends.
   */
  const eventActivity = readActivityLabel(params.activity);
  const { ready, user } = useWsfAuth();

  const [previewState, setPreviewState] = useState<PreviewState>({ kind: 'loading' });
  const [joinState, setJoinState] = useState<JoinState>({ kind: 'idle' });

  // Stash the code the moment this page mounts. Signup / verify / profile-setup
  // read it and route back here on success. Cleared once we successfully route
  // into /community/<id>, and when the tab closes.
  useEffect(() => {
    if (joinCode) setPendingJoinCode(joinCode);
  }, [joinCode]);

  // The event rides sessionStorage for the same reason the join code does:
  // signup -> verify -> profile-setup replace this screen, and the round trip
  // returns to `/join/<code>` without the query string it left with.
  useEffect(() => {
    if (eventGoalId) setPendingEventGoal(eventGoalId);
  }, [eventGoalId]);

  // THE ACTIVITY RIDES WITH IT, by the same mechanism and for the same reason.
  // It is stored only alongside a usable event: an activity with no event to
  // finish at names nothing and would be a value kept for its own sake.
  useEffect(() => {
    if (eventGoalId && eventActivity) setPendingEventActivity(eventActivity);
  }, [eventGoalId, eventActivity]);

  /**
   * WHOSE SCREEN IS THIS — asked on THIS page only when the visitor arrived
   * from an event QR (`?event=<goalId>`) and is signed out, which is the one
   * situation where the next tap would create an account.
   *
   * A join that did not come from an event is byte-for-byte the flow it always
   * was: `eventGoalId` is null, `deviceEntry` is null, and nothing below
   * changes. So is every join by someone already signed in — they already have
   * an account, and the device question is put to them on the event screen
   * they land on afterwards (src/stationSession.ts `routeAfterJoin`).
   *
   * `undefined` until storage has been read, for the same hydration reason as
   * the event screen.
   */
  const [deviceMode, setDeviceMode] = useState<DeviceMode | null | undefined>(undefined);
  useEffect(() => {
    setDeviceMode(readDeviceMode());
  }, []);
  const deviceEntry =
    !eventGoalId || deviceMode === undefined
      ? null
      : decideDeviceEntry({ mode: deviceMode, goalId: eventGoalId });

  const onChoosePersonal = useCallback(() => {
    saveDeviceMode('personal');
    setDeviceMode('personal');
  }, []);

  const onChooseShared = useCallback(() => {
    // NO ACCOUNT IS CREATED ON A SHARED SCREEN. The device is handed to the
    // existing kiosk start screen for this event's goal instead, which is
    // where a shared device belongs and the only shared session this app has.
    const decided = decideDeviceEntry({ mode: 'shared', goalId: eventGoalId });
    if (decided.kind !== 'shared') return;
    saveDeviceMode('shared');
    router.replace(decided.route as never);
  }, [eventGoalId]);

  const onUseOwnPhoneInstead = useCallback(() => {
    clearDeviceMode();
    setDeviceMode(null);
  }, []);

  /*
    "TRY AGAIN" HAS TO ACTUALLY TRY AGAIN.

    The preview runs in an effect keyed on the code, so a control that only
    set state would re-render the same failure. Bumping this token re-runs the
    effect, which is the same path the first attempt took — one loader, not a
    second copy of it that can drift.
  */
  const [retryToken, setRetryToken] = useState(0);
  const onRetryPreview = useCallback(() => {
    setPreviewState({ kind: 'loading' });
    setRetryToken((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!wsfAuthEnabled) return;
    if (!joinCode) {
      setPreviewState({ kind: 'invalid' });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const fn = httpsCallable<{ joinCode: string }, Preview>(
          getFirebaseFunctions(),
          'wsfPreviewCommunity'
        );
        const result = await fn({ joinCode });
        if (cancelled) return;
        setPreviewState({ kind: 'ready', preview: result.data });
      } catch (e) {
        if (cancelled) return;
        // The server returns the SAME 'not-found' shape for "unknown code" and
        // "private/non-public group" (see E2 §3.3 oracle test). Both surface
        // here as the same "this link is not valid" state — do not add UI copy
        // that would let a visitor distinguish them.
        if (e instanceof FirebaseError && e.code === 'functions/not-found') {
          setPreviewState({ kind: 'invalid' });
          return;
        }
        if (e instanceof FirebaseError && e.code === 'functions/resource-exhausted') {
          setPreviewState({ kind: 'rateLimited' });
          return;
        }
        setPreviewState({
          kind: 'error',
          message: describeCallableError(e, 'We couldn’t load this community. Try again.'),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [joinCode, retryToken]);

  const onJoin = useCallback(async () => {
    if (!user) return;
    setJoinState({ kind: 'joining' });
    try {
      const fn = httpsCallable<{ joinCode: string }, { groupId: string; alreadyMember: boolean }>(
        getFirebaseFunctions(),
        'wsfJoinCommunity'
      );
      const result = await fn({ joinCode });
      clearPendingJoinCode();
      // Where a finished join lands: the event this visitor scanned into, or —
      // for every join that did not come from an event — exactly where it
      // landed before.
      //
      // And the END of the carrying: the event and
      // the activity are read out of session storage, handed to the address,
      // and both entries are dropped in the same breath. Read BEFORE either is
      // cleared, so the two cannot get out of step.
      const destination = routeAfterJoin(
        result.data.groupId,
        readPendingEventGoal(),
        readPendingEventActivity()
      );
      clearPendingEventGoal();
      clearPendingEventActivity();
      router.replace(destination as never);
    } catch (e) {
      setJoinState({
        kind: 'error',
        // The heading of the failure card already says WHAT failed, so the
        // fallback body says what to do rather than repeating it.
        message: describeCallableError(e, 'Check your connection and try again.'),
      });
    }
  }, [joinCode, user]);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Join a community" testID="wsf-join-disabled" />;
  }

  if (!joinCode || previewState.kind === 'invalid') {
    return (
      /*
        ONE STATE FOR TWO CAUSES, AND THE WORDING IS WHY.

        `wsfPreviewCommunity` returns the SAME not-found shape for a code that
        never existed and for a community this visitor may not see —
        deliberately, so a stranger cannot use the join screen as an oracle to
        discover which communities exist. This copy must therefore cover both
        without choosing between them: "not valid or is no longer active"
        does; "no such community" would leak, and so would "you do not have
        access".

        AND THERE IS NO WAY ON. Retrying resolves nothing here — the answer
        will not change — so this is the one refusal with no action under the
        card.
      */
      <QuietShell
        heading="This link is not valid."
        body="The link you followed is not valid or is no longer active. Ask the person who shared it to send you a new one."
        bodyTestID="wsf-join-invalid-why"
        testID="wsf-join-invalid"
        foot={<SecondaryLink href="/" label="Back to home" testID="wsf-join-invalid-home" />}
      />
    );
  }

  if (previewState.kind === 'rateLimited') {
    return (
      /* THE LIMIT IS ON THE LINK, NOT ON THEM. "You have tried too many
         times" would be both wrong and accusing. */
      <QuietShell
        heading="Too many requests."
        body="This link is being opened a lot right now. Wait a moment and try again."
        bodyTestID="wsf-join-rate-why"
        testID="wsf-join-rate-limited"
        foot={<SecondaryLink href="/" label="Back to home" testID="wsf-join-rate-home" />}
      >
        <SubmitButton
          label="Try again"
          onPress={onRetryPreview}
          submitting={false}
          testID="wsf-join-rate-retry"
        />
      </QuietShell>
    );
  }

  if (previewState.kind === 'error') {
    return (
      /* The link may well be fine, so the way on is to try it again rather
         than to go and ask for another one. */
      <QuietShell
        heading="Something went wrong."
        body={previewState.message}
        bodyTestID="wsf-join-error-why"
        testID="wsf-join-error"
        foot={<SecondaryLink href="/" label="Back to home" testID="wsf-join-error-home" />}
      >
        <SubmitButton
          label="Try again"
          onPress={onRetryPreview}
          submitting={false}
          testID="wsf-join-error-retry"
        />
      </QuietShell>
    );
  }

  if (previewState.kind === 'loading' || !ready) {
    return <JoinSkeleton />;
  }

  const { preview } = previewState;

  // The hero meta line is built only from what the preview returns: the type
  // as a card fact (nothing for a plain community, never a placeholder) and
  // the joining condition the callable and rules enforce for that stored
  // policy today. Both sentences are the admission-semantics report's
  // supported wording, read from the joiner's side: a link admits to
  // 'public' and 'inviteOnly' alike, nothing lists or searches communities,
  // and a reset retires the old link for everyone who has not joined yet.
  // An unrecognised policy states no condition rather than guessing one.
  const joiningConditions =
    preview.joinPolicy === 'public'
      ? 'Anyone with the invite link can join. The community is not listed or searchable anywhere, so people need the link.'
      : preview.joinPolicy === 'inviteOnly'
        ? 'Anyone with the invite link can join, including anyone it is forwarded to, until a new invite link is created.'
        : '';
  // The meta slot under the name carries ONE fact: what kind of community
  // this is. The joining conditions are a sentence, not a fact line, and they
  // have their own slot below — running both through `meta` printed the same
  // sentence twice, in two weights, directly under the name.
  //
  // A `custom` community has no type worth printing, so `groupTypeCardLabel`
  // returns null and the slot is left out rather than filled with the generic
  // 'Community' — that is the helper's whole point, and the old fallback to
  // `groupTypeLabel` defeated it.
  const metaLine = groupTypeCardLabel(preview.groupType) ?? undefined;

  /*
    THE INVITATION, AS A FIELD RATHER THAN A CARD STACK.

    The same navy-field-over-sheet composition the identity funnel uses, so a
    visitor who arrives here from a QR and then signs up never changes worlds.
    What it carries is unchanged and still true: the community's own name, its
    type, and the joining conditions the server actually reported.

    `joiningConditions` is the sentence that has to stay exact — it is what an
    invite-only link really means, forwarding included, and softening it would
    misdescribe who can end up in the community.
  */
  const sheetBody = (
    <View style={styles.means} testID="wsf-join-meaning">
      <Text style={styles.meansTitle}>What joining means</Text>
      {JOINING_MEANS.map((fact) => (
        <View key={fact} style={styles.meansRow}>
          <View style={styles.meansDot} />
          <Text style={styles.meansFact}>{fact}</Text>
        </View>
      ))}
    </View>
  );

  /*
    THE FAILURE REPLACES THE CARD, IT DOES NOT SIT UNDER IT.

    A failed join is the only thing on this screen worth reading at that
    moment; leaving "What joining means" above it makes the visitor scan past
    three facts they have already read to reach the one new sentence. The navy
    field is deliberately UNCHANGED — the invitation is still open and the
    community is still the community; only the attempt failed.
  */
  const joinFailure =
    joinState.kind === 'error' ? (
      <View style={styles.failure} testID="wsf-join-submit-error">
        <Text style={styles.failureTitle}>We couldn’t join this community.</Text>
        <Text style={styles.failureBody}>{joinState.message}</Text>
      </View>
    ) : null;

  // ── the device question, before the account ──────────────────────────────
  //
  // Only on the event path, only while signed out, and only after the preview
  // succeeded — a link that is not valid says so first; a device question
  // about a dead link would be asking about nothing.
  if (!user && eventGoalId) {
    if (deviceEntry === null) {
      // Storage not read yet. The SAME skeleton the preview wait shows: from
      // the visitor's side these are one wait, and two different loading
      // screens for one wait is a flicker, not information.
      return <JoinSkeleton />;
    }
    if (deviceEntry.kind === 'ask') {
      return (
        /*
          THE DEVICE QUESTION IS A SURFACE OF THIS FUNNEL, so it renders
          through the same field as the invitation it interrupts. The step
          chip says where the visitor is — this is asked BEFORE an account
          exists, and that is the whole reason it is asked at all.
        */
        <FormShell
          eyebrow="One question first"
          /* The words live in `deviceMode.ts`, where the spec reads them, so
             the screen and the test cannot drift apart. */
          heading={DEVICE_CHOICE_HEADING}
          intro={DEVICE_CHOICE_INTRO_SIGNUP}
          step="Before you sign up"
          testID="wsf-join-device-choice"
        >
          <DeviceChoice
            onChoosePersonal={onChoosePersonal}
            onChooseShared={onChooseShared}
            signupAhead
            /* Batch B's form. `/event/[goalId]` keeps the legacy default — that
               route is Batch D and not authorized by this slice. */
            variant="sheet"
            testID="wsf-device-choice"
          />
        </FormShell>
      );
    }
    if (deviceEntry.kind === 'shared') {
      return (
        <FormShell
          eyebrow="Remembered on this screen"
          heading={`${DEVICE_SHARED_TITLE}.`}
          intro={DEVICE_SHARED_BODY}
          step="Shared screen"
          testID="wsf-join-device-shared"
          /*
            THE WAY BACK OUT LIVES AT THE FOOT, with every other Batch B way
            out — and it MUST stay reachable: without it a personal phone that
            answered "shared" once would be sent to the kiosk by every future
            scan of this link, with no control anywhere to undo it.
          */
          foot={
            /* NOT a `SecondaryLink`: this control goes nowhere. It forgets
               the stored answer and puts the question back on this same
               screen, so it must not be a navigation. */
            <Pressable
              onPress={onUseOwnPhoneInstead}
              style={joinAction.footControl}
              testID="wsf-device-shared-reset"
              accessibilityRole="button"
            >
              <Text style={joinAction.footControlText}>{DEVICE_SHARED_RESET}</Text>
            </Pressable>
          }
        >
          <SharedScreenNotice
            onContinue={() => router.replace(deviceEntry.route as never)}
            onUseOwnPhone={onUseOwnPhoneInstead}
            variant="sheet"
            testID="wsf-device-shared"
          />
        </FormShell>
      );
    }
  }

  // Signed out — preview is safe (D4: only shown for link-joinable active
  // groups, i.e. public or inviteOnly; private never previews) so we
  // show it and route to signup/signin. The pending join code sits in
  // sessionStorage; the auth chain reads it and routes back here on success.
  if (!user) {
    return (
      <FormShell
        eyebrow="You have been invited to"
        heading={preview.displayName}
        meta={metaLine}
        metaTestID="wsf-join-meta"
        intro={joiningConditions || undefined}
        introTestID="wsf-join-conditions"
        testID="wsf-join-signed-out"
        step="Invitation"
        foot={
          <SecondaryLink
            href="/"
            label="Not now — back to home"
            testID="wsf-join-decline"
          />
        }
      >
        {sheetBody}
        {/* No account surprise after the tap: say it before the button. */}
        <Text style={styles.preface}>You’ll need a free account first.</Text>
        {/*
          `replace`, not push. If these pushed, the join screen would stay at
          the bottom of the stack while signup -> verify-email -> profile-setup
          ran on top, and profile-setup's return trip would mount a SECOND join
          instance — a strict-mode locator caught exactly that. `replace` swaps
          it out instead; the pending code rides in session storage and the
          return lands on one join screen. Back-button behaviour stays sane too.
        */}
        <ButtonLink
          href="/signup"
          replace
          style={joinAction.primary}
          textStyle={joinAction.primaryText}
          testID="wsf-join-signup"
          label="Sign up to join"
        />
        {/* A TEXT CONTROL, NOT A SECOND BUTTON. One screen, one filled
            action: an outlined box under the green one reads as a second
            offer of equal weight, and signing in is not an alternative way to
            accept this invitation — it is the same way, for somebody who
            already has an account. Still full width and past 44 pt. */}
        <ButtonLink
          href="/signin"
          replace
          style={joinAction.secondary}
          textStyle={joinAction.secondaryText}
          testID="wsf-join-signin"
          label="Already have an account? Sign in"
        />
      </FormShell>
    );
  }

  return (
    <FormShell
      eyebrow="You have been invited to"
      heading={preview.displayName}
      meta={metaLine}
      metaTestID="wsf-join-meta"
      intro={joiningConditions || undefined}
      introTestID="wsf-join-conditions"
      testID="wsf-join-signed-in"
      step="Invitation"
      foot={
        <SecondaryLink href="/" label="Not now — back to home" testID="wsf-join-decline" />
      }
    >
      {joinFailure ?? sheetBody}
      {/*
        The action carries the community's name, as the route does. It is the
        one place a name is printed on a control, and it is the same name the
        preview already showed this visitor.
      */}
      <SubmitButton
        label={`Join ${preview.displayName}`}
        onPress={onJoin}
        submitting={joinState.kind === 'joining'}
        busyLabel="Joining…"
        testID="wsf-join-submit"
      />
    </FormShell>
  );
}

/**
 * What a member gets, stated as three things the product does. No count of
 * people, no shared total, no prediction — every line here is a capability
 * that exists the moment the join succeeds.
 */
const JOINING_MEANS: readonly string[] = [
  'See the community’s goals and its shared progress.',
  'Add your own contributions to the shared total.',
  'Leave whenever you like.',
];

/**
 * THE WAIT, SHAPED LIKE WHAT IS COMING.
 *
 * The accepted target draws the invitation's own outline — the eyebrow, the
 * name, the type, then the card — in blank bars, instead of a worded screen
 * that has to be read and then replaced. The visitor's eye lands where the
 * community's name is about to be, so the arrival is a fill rather than a
 * page change.
 *
 * NOTHING HERE IS A CLAIM. The bars carry no text, so this screen cannot
 * state a name, a type or a condition before the server has reported one —
 * which is the only safe thing to show while the preview is still open.
 */
function JoinSkeleton() {
  return (
    <View style={skeleton.screen} testID="wsf-join-loading">
      <View style={skeleton.chrome}>
        <WsfWordmark variant="navy" height={21} testID="wsf-join-wordmark" />
      </View>
      <View style={skeleton.bar} />
      <View style={skeleton.title} />
      <View style={skeleton.meta} />
      <View style={skeleton.card}>
        <View style={skeleton.cardTitle} />
        <View style={skeleton.cardLine} />
        <View style={skeleton.cardLineShort} />
      </View>
      <Text style={skeleton.status} testID="wsf-join-loading-status">
        Loading…
      </Text>
    </View>
  );
}

const SKELETON_FILL = '#E8E4DC';

const skeleton = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM, paddingHorizontal: 20, paddingTop: 22, gap: 10 },
  chrome: { alignItems: 'flex-start', marginBottom: 12 },
  bar: { height: 13, width: '68%', borderRadius: 7, backgroundColor: SKELETON_FILL },
  title: { height: 42, width: '90%', borderRadius: 12, backgroundColor: SKELETON_FILL },
  meta: { height: 13, width: '78%', borderRadius: 7, backgroundColor: SKELETON_FILL },
  card: {
    marginTop: 12,
    backgroundColor: SURFACE,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 20,
    gap: 12,
    ...elevation.card,
  },
  cardTitle: { height: 14, width: '52%', borderRadius: 7, backgroundColor: SKELETON_FILL },
  cardLine: { height: 12, width: '94%', borderRadius: 6, backgroundColor: SKELETON_FILL },
  cardLineShort: { height: 12, width: '80%', borderRadius: 6, backgroundColor: SKELETON_FILL },
  status: { marginTop: 18, textAlign: 'center', color: INK_QUIET, fontSize: 15 },
});

// Layout only this screen needs: the actions sit a little closer to each
// other than the page's sections do.
const styles = StyleSheet.create({
  means: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 9,
    ...elevation.card,
  },
  meansTitle: { color: NAVY, fontSize: 15, fontWeight: '900' },
  meansRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  meansDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: ACTION_GREEN,
    marginTop: 6,
  },
  meansFact: { color: NAVY, fontSize: 14, lineHeight: 20, flexShrink: 1, minWidth: 0 },
  preface: { color: INK_QUIET, fontSize: 13, lineHeight: 18, textAlign: 'center' },

  /* The failed attempt: the sheet's one red object, banded on its leading
     edge so it is distinguishable from the white card it replaced without
     reading a word of it. */
  failure: {
    backgroundColor: '#FDF1F1',
    borderRadius: 18,
    borderLeftWidth: 5,
    borderLeftColor: ERROR_RED,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 5,
  },
  failureTitle: { color: ERROR_RED, fontSize: 15, fontWeight: '900' },
  failureBody: { color: INK_QUIET, fontSize: 14, lineHeight: 20 },
});

/** The two entry actions, in the identity funnel's own shapes. */
const joinAction = StyleSheet.create({
  primary: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
    ...elevation.action,
  },
  primaryText: { color: '#04260F', fontSize: 17, fontWeight: '900' },
  secondary: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: NAVY, fontSize: 15, fontWeight: '800' },
  /* The shell's foot shape, for a control that acts instead of navigating. */
  footControl: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  footControlText: { color: NAVY, fontSize: 15, fontWeight: '800' },
});
