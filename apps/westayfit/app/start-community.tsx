import { router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useRef, useState } from 'react';
import { Text, type TextInput } from 'react-native';

import { useWsfAuth } from '../src/auth';
import { AuthFlagOffPanel } from '../src/AuthFlagOffPanel';
import { describeCallableError } from '../src/callableErrors';
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
import { ButtonLink } from '../src/ui/ButtonLink';
import { kit } from '../src/ui/kit';
import { OptionGroup, OptionRow } from '../src/ui/OptionRow';

type GroupType = 'familyFriends' | 'custom';
type JoinPolicy = 'public' | 'inviteOnly' | 'private';

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

const NAME_MIN_LENGTH = 2;
const NAME_MESSAGE = 'Give your community a name.';

export default function StartCommunity() {
  const { ready, user } = useWsfAuth();
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [groupType, setGroupType] = useState<GroupType>('familyFriends');
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>(defaultJoinPolicyFor('familyFriends'));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<TextInput>(null);

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
          style={kit.primaryButton}
          textStyle={kit.primaryButtonText}
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
          style={kit.primaryButton}
          textStyle={kit.primaryButtonText}
          testID="wsf-start-unverified-verify"
          label="Verify email"
        />
      </FormShell>
    );
  }

  const trimmedName = name.trim();
  const nameValid = trimmedName.length >= NAME_MIN_LENGTH;
  // No red before the member has tried: the message appears after a submit
  // attempt or after leaving the field short, never while they are typing
  // their first character.
  const showNameMessage = nameTouched && !nameValid;

  const typeLabel = GROUP_TYPE_OPTIONS.find((o) => o.value === groupType)?.label ?? '';
  const policyLabel = JOIN_POLICY_OPTIONS.find((o) => o.value === joinPolicy)?.label ?? '';
  const summary = `${trimmedName || 'Your community'} · ${typeLabel} · ${policyLabel}`;

  async function onSubmit() {
    setError(null);
    if (!nameValid) {
      // The button is always tappable; an invalid name sends the member to
      // the field with the message under it, and nothing is sent to the server.
      setNameTouched(true);
      nameRef.current?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const fn = httpsCallable<
        { displayName: string; groupType: GroupType; joinPolicy: JoinPolicy },
        CreateCommunityResponse
      >(getFirebaseFunctions(), 'wsfCreateCommunity');
      const result = await fn({ displayName: trimmedName, groupType, joinPolicy });
      const groupId = result.data.groupId;
      router.replace(`/community/${groupId}`);
    } catch (e) {
      setError(describeCallableError(e, 'We couldn’t create your community. Try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormShell
      heading="Start your community"
      intro="Give it a name, choose who it is for and who can join."
      testID="wsf-start"
    >
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
      {showNameMessage ? <ErrorText testID="wsf-start-name-error">{NAME_MESSAGE}</ErrorText> : null}

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

      {error ? <ErrorText testID="wsf-start-error">{error}</ErrorText> : null}

      <SubmitButton
        label="Create community"
        onPress={onSubmit}
        submitting={submitting}
        testID="wsf-start-submit"
      />
      <SecondaryLink href="/" label="Back to home" testID="wsf-start-back" />
    </FormShell>
  );
}
