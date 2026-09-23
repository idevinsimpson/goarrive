import { router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, type TextInput } from 'react-native';

import { useWsfAuth } from '../src/auth';
import { AuthFlagOffPanel } from '../src/AuthFlagOffPanel';
import {
  ErrorText,
  FieldLabel,
  FormShell,
  SecondaryLink,
  StatusText,
  SubmitButton,
  TextField,
} from '../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseFunctions } from '../src/firebase';
import {
  classifyCreateFailure,
  nameLongMessage,
  nameProblem,
  NAME_SHORT_MESSAGE,
  usableGroupId,
  type CreateOutcome,
  type GroupType,
  type JoinPolicy,
} from '../src/startCommunityOutcome';
import { ButtonLink } from '../src/ui/ButtonLink';
import { ACTION_GREEN, ERROR_RED, INK_QUIET, elevation, kit } from '../src/ui/kit';
import { OptionGroup, OptionRow } from '../src/ui/OptionRow';

type CreateCommunityResponse = { groupId: string };

// The stored values are unchanged; only the words a member reads are here.
const GROUP_TYPE_OPTIONS: { value: GroupType; label: string; description: string }[] = [
  {
    value: 'familyFriends',
    label: 'Family & friends',
    description: 'For people you already know.',
  },
  {
    value: 'custom',
    label: 'Other community',
    description: 'For a church, workplace, neighborhood, group, or another existing community.',
  },
];

// Each description states what the join callable and the rules enforce for
// that stored value today (admission-semantics report, candidate D clause 9):
// a link admits to 'public' and 'inviteOnly' alike and nothing lists or
// searches communities; 'private' is outside the link-joinable set and no
// callable adds a member by name, so it holds only its creator.
const JOIN_POLICY_OPTIONS: { value: JoinPolicy; label: string; description: string }[] = [
  {
    value: 'public',
    label: 'Public',
    description:
      'Anyone with the invite link can join. The community is not listed or searchable anywhere, so people need the link.',
  },
  {
    value: 'inviteOnly',
    label: 'Anyone with the link',
    description:
      'Anyone with the invite link can join, including anyone it is forwarded to, until you create a new link.',
  },
  {
    value: 'private',
    label: 'Private',
    description:
      'No one can join by link and there is no way to add members, so the community is just you.',
  },
];

// Per DECISIONS.md — Family & friends stays private by default; Other
// community opens to Anyone-with-the-link by default. Public is opt-in either way.
function defaultJoinPolicyFor(groupType: GroupType): JoinPolicy {
  return groupType === 'familyFriends' ? 'private' : 'inviteOnly';
}

const REFUSED_TITLE = 'We couldn’t create your community.';

const UNCONFIRMED_TITLE = 'We couldn’t confirm your community was created.';
const UNCONFIRMED_BODY =
  'It may have been created anyway. Check your communities before you start another one.';

const CREATED_TITLE = 'Your community is ready.';
const CREATED_BODY = 'We couldn’t open it automatically.';

const RETRY_LABEL = 'Start another community';
const RETRY_NOTE =
  'This starts a new, separate community. If the first one was created, you will have two.';

/**
 * THE LIST, NOT HOME.
 *
 * Bare `/` opens the community the member last opened, or their only one — so
 * after an unconfirmed create it shows a member who already had a community
 * exactly what it would have shown had the create never happened. `?view=communities`
 * asks Home for the list instead, for this one navigation and nothing else.
 */
const COMMUNITY_LIST_HREF = '/?view=communities';

/**
 * HOW LONG A SUCCESSFUL NAVIGATION IS ALLOWED TO TAKE before this screen
 * concludes it did not happen.
 *
 * A try/catch around `router.replace` is not enough on web, and the probe that
 * found this is worth recording: with `history.replaceState` patched to throw,
 * the throw arrives as an UNCAUGHT page error, not out of `router.replace()`.
 * Expo Router writes history in an effect after its own state update, so the
 * call frame the catch guards has already returned successfully. The catch is
 * still here — a native platform may throw synchronously — but it cannot be
 * the only mechanism, or the recovery state would be unreachable in the
 * browser, which is where it matters.
 *
 * So the real test is observable rather than exceptional: a successful
 * navigation unmounts this screen. Still being mounted after the grace period
 * IS the failure, whatever caused it.
 */
const NAVIGATION_GRACE_MS = 1500;

export default function StartCommunity() {
  const { ready, user } = useWsfAuth();
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [groupType, setGroupType] = useState<GroupType>('familyFriends');
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>(defaultJoinPolicyFor('familyFriends'));
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<CreateOutcome>({ kind: 'idle' });
  const nameRef = useRef<TextInput>(null);

  /*
    THREE REFS, BECAUSE A CREATE OUTLIVES THE RENDER THAT STARTED IT.

    `inFlight` is the duplicate guard, and it is a ref rather than the
    `submitting` state because state lands a tick late: two taps inside one
    frame both read `submitting === false` and both send a create, which is two
    communities. The ref flips synchronously.

    `alive` and `activeUid` decide whether a settled call may still speak. A
    member who navigates away, or signs into another account while the request
    is out, must not have the previous account's result written onto their
    screen.
  */
  const inFlight = useRef(false);
  const alive = useRef(true);
  const activeUid = useRef<string | null>(null);
  const navTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uid = user?.uid ?? null;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (navTimer.current) clearTimeout(navTimer.current);
    };
  }, []);

  useEffect(() => {
    const previous = activeUid.current;
    activeUid.current = uid;
    // A result belongs to the account that asked for it. On a switch, drop it
    // rather than leave the new account looking at the old one's community.
    if (previous !== null && previous !== uid) setOutcome({ kind: 'idle' });
  }, [uid]);

  const selectGroupType = (next: GroupType) => {
    setGroupType(next);
    setJoinPolicy(defaultJoinPolicyFor(next));
  };

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Start your community" testID="wsf-start-disabled" />;
  }

  if (!ready) {
    return (
      <FormShell heading="Start your community" testID="wsf-start-loading">
        <StatusText>Loading…</StatusText>
      </FormShell>
    );
  }

  if (!user) {
    return (
      <FormShell
        heading="Start your community"
        intro="Sign in to start a community."
        testID="wsf-start-signed-out"
      >
        <ButtonLink
          href="/signin"
          style={action.primary}
          textStyle={action.primaryText}
          testID="wsf-start-signed-out-signin"
          label="Sign in"
        />
      </FormShell>
    );
  }

  if (!user.emailVerified) {
    return (
      <FormShell
        heading="Start your community"
        intro="Verify your email before starting a community."
        testID="wsf-start-unverified"
      >
        {/* One state, one job, one obvious primary (clause 12). */}
        <ButtonLink
          href="/verify-email"
          style={action.primary}
          textStyle={action.primaryText}
          testID="wsf-start-unverified-verify"
          label="Verify email"
        />
      </FormShell>
    );
  }

  const trimmedName = name.trim();
  const problem = nameProblem(name);
  // No red before the member has tried: "give it a name" waits for a submit
  // attempt or for them to leave the field. The ceiling is different — they
  // have demonstrably typed something, and the count is only useful while they
  // can still see what they are cutting.
  const nameMessage =
    problem === 'long'
      ? nameLongMessage(trimmedName.length)
      : problem === 'short' && nameTouched
        ? NAME_SHORT_MESSAGE
        : null;

  const typeLabel = GROUP_TYPE_OPTIONS.find((o) => o.value === groupType)?.label ?? '';
  const policyLabel = JOIN_POLICY_OPTIONS.find((o) => o.value === joinPolicy)?.label ?? '';
  const summary = `${trimmedName || 'Your community'} · ${typeLabel} · ${policyLabel}`;

  async function onSubmit() {
    // A second create is a second community, so the guard is first and
    // synchronous. Nothing below it runs twice.
    if (inFlight.current) return;

    if (problem) {
      // The button stays tappable; an invalid name sends the member to the
      // field with the message under it, and nothing is sent to the server.
      setNameTouched(true);
      nameRef.current?.focus();
      return;
    }

    const requestedBy = activeUid.current;
    const requestedName = trimmedName;
    inFlight.current = true;
    setSubmitting(true);
    setOutcome({ kind: 'idle' });

    let created: { groupId: string; displayName: string } | null = null;
    try {
      const fn = httpsCallable<
        { displayName: string; groupType: GroupType; joinPolicy: JoinPolicy },
        CreateCommunityResponse
      >(getFirebaseFunctions(), 'wsfCreateCommunity');
      /*
        ONLY THE AWAITED CALL IS INSIDE THE CLASSIFYING TRY.

        Everything after it has already succeeded on the server. A throw from
        the navigation below used to land in this catch and be rendered as a
        failure to create — for a community whose id we were holding.
      */
      const result = await fn({
        displayName: requestedName,
        groupType,
        joinPolicy,
      });
      const groupId = usableGroupId(result.data?.groupId);
      created = groupId ? { groupId, displayName: requestedName } : null;
      if (!created) {
        // The server said yes but gave us nothing to open. The community very
        // likely exists; we simply cannot point at it, which is the
        // unconfirmed shape rather than a broken button.
        if (alive.current && activeUid.current === requestedBy) {
          setOutcome({ kind: 'unconfirmed' });
        }
      }
    } catch (e) {
      if (alive.current && activeUid.current === requestedBy) {
        setOutcome(classifyCreateFailure(e));
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setSubmitting(false);
    }

    if (!created) return;
    if (!alive.current || activeUid.current !== requestedBy) return;

    // The community exists from here on. Failing to reach it is a navigation
    // problem with a known destination, never a reason to create again.
    const reached = created;
    const offerTheCommunity = () => {
      if (!alive.current || activeUid.current !== requestedBy) return;
      setOutcome({ kind: 'created', ...reached });
    };
    try {
      router.replace(`/community/${reached.groupId}`);
    } catch {
      // A platform that fails loudly and synchronously.
      offerTheCommunity();
      return;
    }
    // …and the web, which does not. If we are still mounted after the grace
    // period, the navigation did not happen; the guards inside make this a
    // no-op when it did.
    if (navTimer.current) clearTimeout(navTimer.current);
    navTimer.current = setTimeout(offerTheCommunity, NAVIGATION_GRACE_MS);
  }

  function openCreated(groupId: string) {
    // Re-navigation only. This must never call the callable: the community is
    // already there, and a second create would be a second community.
    router.replace(`/community/${groupId}`);
  }

  if (outcome.kind === 'created') {
    return (
      <FormShell heading={outcome.displayName} testID="wsf-start">
        <View style={card.note} testID="wsf-start-created">
          <Text style={card.noteTitle} testID="wsf-start-created-title">
            {CREATED_TITLE}
          </Text>
          <Text style={card.body}>{CREATED_BODY}</Text>
        </View>
        <SubmitButton
          label={`Open ${outcome.displayName}`}
          onPress={() => openCreated(outcome.groupId)}
          submitting={false}
          testID="wsf-start-open"
        />
        <SecondaryLink href="/" label="Back to home" testID="wsf-start-back" />
      </FormShell>
    );
  }

  const failure =
    outcome.kind === 'refused'
      ? { title: REFUSED_TITLE, body: outcome.message }
      : outcome.kind === 'unconfirmed'
        ? { title: UNCONFIRMED_TITLE, body: UNCONFIRMED_BODY }
        : null;

  // A refusal the member cannot clear from this form takes the create action
  // away with it: the server will decline the same request until the profile
  // exists, so offering the button again only buys a second copy of the
  // sentence.
  const profileBlocked = outcome.kind === 'refused' && outcome.recover === 'profile';

  return (
    <FormShell
      heading="Start your community"
      intro="Give it a name, choose who it is for and who can join."
      testID="wsf-start"
    >
      {failure ? (
        <View style={card.failure} testID="wsf-start-outcome">
          <Text style={card.failureTitle} testID="wsf-start-outcome-title">
            {failure.title}
          </Text>
          {/* `wsf-start-error` is the long-standing hook for "this attempt
              failed", and stays exactly that: absent on every success. */}
          <Text style={card.body} testID="wsf-start-error">
            {failure.body}
          </Text>
        </View>
      ) : null}

      {profileBlocked ? (
        <ButtonLink
          href="/profile-setup"
          style={action.primary}
          textStyle={action.primaryText}
          testID="wsf-start-profile"
          label="Complete your profile"
        />
      ) : null}

      {outcome.kind === 'unconfirmed' ? (
        <ButtonLink
          href={COMMUNITY_LIST_HREF}
          style={action.primary}
          textStyle={action.primaryText}
          testID="wsf-start-check-communities"
          label="Check your communities"
        />
      ) : null}

      <FieldLabel>Community name</FieldLabel>
      <TextField
        ref={nameRef}
        value={name}
        onChangeText={setName}
        onBlur={() => setNameTouched(true)}
        autoCapitalize="words"
        returnKeyType="done"
        testID="wsf-start-name"
      />
      {nameMessage ? <ErrorText testID="wsf-start-name-error">{nameMessage}</ErrorText> : null}

      <FieldLabel>Community type</FieldLabel>
      <OptionGroup accessibilityLabel="Community type" testID="wsf-start-groupType">
        {GROUP_TYPE_OPTIONS.map((o) => (
          <OptionRow
            key={o.value}
            label={o.label}
            description={o.description}
            selected={groupType === o.value}
            onPress={() => selectGroupType(o.value)}
            testID={`wsf-start-groupType-${o.value}`}
          />
        ))}
      </OptionGroup>

      <FieldLabel>Who can join?</FieldLabel>
      <OptionGroup accessibilityLabel="Who can join" testID="wsf-start-joinPolicy">
        {JOIN_POLICY_OPTIONS.map((o) => (
          <OptionRow
            key={o.value}
            label={o.label}
            description={o.description}
            selected={joinPolicy === o.value}
            onPress={() => setJoinPolicy(o.value)}
            testID={`wsf-start-joinPolicy-${o.value}`}
          />
        ))}
      </OptionGroup>

      <Text style={kit.statusText} testID="wsf-start-summary">
        {summary}
      </Text>

      {profileBlocked ? null : (
        <SubmitButton
          label={outcome.kind === 'unconfirmed' ? RETRY_LABEL : 'Create community'}
          onPress={onSubmit}
          submitting={submitting}
          testID="wsf-start-submit"
          variant={outcome.kind === 'unconfirmed' ? 'tertiary' : 'primary'}
        />
      )}
      {outcome.kind === 'unconfirmed' ? (
        // The risk travels WITH the control. On a short phone the card above
        // has scrolled off by the time this button is reachable, and a warning
        // the member cannot see while pressing is not a warning.
        <Text style={card.retryNote} testID="wsf-start-retry-note">
          {RETRY_NOTE}
        </Text>
      ) : null}
      <SecondaryLink href="/" label="Back to home" testID="wsf-start-back" />
    </FormShell>
  );
}

/**
 * A PRIMARY ACTION IS ACTION GREEN, INCLUDING WHEN IT IS A LINK.
 *
 * Board 00 gives #22C55E to primary actions and #91CB7D to confirmed progress,
 * and `kit.primaryButton` carries the progress green — so every `ButtonLink`
 * on this route rendered a primary action in the colour reserved for a
 * reported number. `SubmitButton`'s own primary was already correct
 * (`AuthFormPrimitives`, ACTION_GREEN on #04260F), which is why Create
 * community and Open <community> needed nothing: this restates that same
 * treatment for the link-shaped primaries rather than inventing a second one.
 *
 * LOCAL ON PURPOSE. `kit.primaryButton` is shared by screens this route does
 * not own, and correcting it here would repaint all of them on someone else's
 * behalf. The shared token stays exactly as it is.
 */
const action = StyleSheet.create({
  primary: {
    backgroundColor: ACTION_GREEN,
    borderRadius: 16,
    minHeight: 52,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    ...elevation.action,
  },
  primaryText: { color: '#04260F', fontSize: 17, fontWeight: '900', textAlign: 'center' },
});

/** The outcome card, in the shape `/join/[joinCode]` already uses for one. */
const card = StyleSheet.create({
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
  /** Created is not a failure, so it is not red and does not shout. */
  note: {
    backgroundColor: '#EEF1F7',
    borderRadius: 18,
    borderLeftWidth: 5,
    borderLeftColor: '#0B1F3A',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 5,
  },
  noteTitle: { color: '#0B1F3A', fontSize: 15, fontWeight: '900' },
  body: { color: INK_QUIET, fontSize: 14, lineHeight: 20 },
  retryNote: { color: INK_QUIET, fontSize: 13, lineHeight: 18, marginTop: 8 },
});
