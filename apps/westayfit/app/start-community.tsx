import { router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
import { kit } from '../src/ui/kit';

type GroupType = 'familyFriends' | 'custom';
type JoinPolicy = 'public' | 'inviteOnly' | 'private';

type CreateCommunityResponse = { groupId: string };

const JOIN_POLICY_OPTIONS: { value: JoinPolicy; label: string; description: string }[] = [
  {
    value: 'public',
    label: 'Public',
    description: 'Anyone can find and join.',
  },
  {
    value: 'inviteOnly',
    label: 'Anyone with the link',
    description: 'People with the join link can come in; not listed anywhere.',
  },
  {
    value: 'private',
    label: 'Private',
    description: 'I add each member.',
  },
];

// Per DECISIONS.md — Family and friends stays private by default; Something
// else opens to Anyone-with-the-link by default. Public is opt-in either way.
function defaultJoinPolicyFor(groupType: GroupType): JoinPolicy {
  return groupType === 'familyFriends' ? 'private' : 'inviteOnly';
}

export default function StartCommunity() {
  const { ready, user } = useWsfAuth();
  const [name, setName] = useState('');
  const [groupType, setGroupType] = useState<GroupType>('familyFriends');
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>(defaultJoinPolicyFor('familyFriends'));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectGroupType = (v: string) => {
    const next = v as GroupType;
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
        <SecondaryLink href="/signin" label="Sign in" />
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
        <SecondaryLink href="/verify-email" label="Verify email" />
      </FormShell>
    );
  }

  const canSubmit = name.trim().length >= 2;

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const fn = httpsCallable<
        { displayName: string; groupType: GroupType; joinPolicy: JoinPolicy },
        CreateCommunityResponse
      >(getFirebaseFunctions(), 'wsfCreateCommunity');
      const result = await fn({ displayName: name.trim(), groupType, joinPolicy });
      const groupId = result.data.groupId;
      router.replace(`/community/${groupId}`);
    } catch (e) {
      setError(describeCallableError(e, 'We couldn’t create your community. Try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  // The shell shows the wordmark in its chrome row, so the old "We Stay Fit"
  // text eyebrow is gone: the brand is the image now, not a line of caps.
  return (
    <FormShell
      heading="Start your community"
      intro="Turn your community into a place that moves."
      testID="wsf-start"
    >
      <FieldLabel>Community name</FieldLabel>
      <TextField
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        testID="wsf-start-name"
      />

      <FieldLabel>What kind of community?</FieldLabel>
      <ChoiceRow
        options={[
          { value: 'familyFriends', label: 'Family and friends' },
          { value: 'custom', label: 'Something else' },
        ]}
        selected={groupType}
        onSelect={selectGroupType}
        testIDPrefix="wsf-start-groupType"
      />

      <FieldLabel>Who can join?</FieldLabel>
      <ChoiceRow
        options={JOIN_POLICY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        selected={joinPolicy}
        onSelect={(v) => setJoinPolicy(v as JoinPolicy)}
        testIDPrefix="wsf-start-joinPolicy"
      />
      <Text style={kit.caption} testID="wsf-start-joinPolicy-description">
        {JOIN_POLICY_OPTIONS.find((o) => o.value === joinPolicy)?.description ?? ''}
      </Text>

      {error ? <ErrorText testID="wsf-start-error">{error}</ErrorText> : null}

      <SubmitButton
        label="Create community"
        onPress={onSubmit}
        submitting={submitting}
        disabled={!canSubmit}
        testID="wsf-start-submit"
      />
    </FormShell>
  );
}

/**
 * A row of choice pills. Each pill is the kit's 44 px chip; the row wraps so
 * three labels fit at any width without running off the edge.
 */
function ChoiceRow({
  options,
  selected,
  onSelect,
  testIDPrefix,
}: {
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (v: string) => void;
  testIDPrefix: string;
}) {
  return (
    <View style={styles.choiceRow}>
      {options.map((o) => {
        const isSelected = o.value === selected;
        return (
          <Pressable
            key={o.value}
            onPress={() => onSelect(o.value)}
            style={[kit.pill, styles.choice, isSelected ? kit.pillSelected : null]}
            testID={`${testIDPrefix}-${o.value}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={[kit.pillText, isSelected ? kit.pillTextSelected : null]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Layout only this screen needs: the pills sit in a wrapping row.
const styles = StyleSheet.create({
  choiceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // A pill wider than the line gives way and wraps its label instead of
  // running past a 195 px viewport.
  choice: { flexShrink: 1, minWidth: 0 },
});
