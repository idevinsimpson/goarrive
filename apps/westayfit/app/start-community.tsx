import { router } from 'expo-router';
import { httpsCallable } from 'firebase/functions';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useWsfAuth } from '../src/auth';
import { AuthFlagOffPanel } from '../src/AuthFlagOffPanel';
import {
  ErrorText,
  FieldLabel,
  FormShell,
  SecondaryLink,
  SubmitButton,
  TextField,
} from '../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseFunctions } from '../src/firebase';
import { wsfTheme } from '../src/theme';

type GroupType = 'familyFriends' | 'custom';
type JoinPolicy = 'private' | 'inviteOnly';

type CreateCommunityResponse = { groupId: string };

export default function StartCommunity() {
  const { ready, user } = useWsfAuth();
  const [name, setName] = useState('');
  const [groupType, setGroupType] = useState<GroupType>('familyFriends');
  const [joinPolicy, setJoinPolicy] = useState<JoinPolicy>('private');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Start your community" testID="wsf-start-disabled" />;
  }

  if (!ready) {
    return (
      <FormShell heading="Start your community" testID="wsf-start-loading">
        <Text>Loading…</Text>
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
      setError(e instanceof Error ? e.message : 'Create failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormShell
      eyebrow="We Stay Fit"
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
        onSelect={(v) => setGroupType(v as GroupType)}
        testIDPrefix="wsf-start-groupType"
      />

      <FieldLabel>Who can join?</FieldLabel>
      <ChoiceRow
        options={[
          { value: 'private', label: 'Private (I invite each member)' },
          { value: 'inviteOnly', label: 'Invite-only link' },
        ]}
        selected={joinPolicy}
        onSelect={(v) => setJoinPolicy(v as JoinPolicy)}
        testIDPrefix="wsf-start-joinPolicy"
      />

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
    <View style={choiceStyles.row}>
      {options.map((o) => {
        const isSelected = o.value === selected;
        return (
          <Pressable
            key={o.value}
            onPress={() => onSelect(o.value)}
            style={[choiceStyles.pill, isSelected ? choiceStyles.pillSelected : null]}
            testID={`${testIDPrefix}-${o.value}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={[choiceStyles.pillText, isSelected ? choiceStyles.pillTextSelected : null]}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const choiceStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: wsfTheme.spacing.sm,
    marginBottom: wsfTheme.spacing.sm,
  },
  pill: {
    borderWidth: 1,
    borderColor: wsfTheme.colors.border,
    borderRadius: wsfTheme.radius.pill,
    paddingHorizontal: wsfTheme.spacing.md,
    paddingVertical: wsfTheme.spacing.sm,
    backgroundColor: wsfTheme.colors.surface,
  },
  pillSelected: {
    borderColor: wsfTheme.colors.primary,
    backgroundColor: wsfTheme.colors.primary,
  },
  pillText: {
    color: wsfTheme.colors.text,
    fontSize: wsfTheme.typography.body.fontSize,
    fontWeight: '600',
  },
  pillTextSelected: {
    color: wsfTheme.colors.surface,
  },
});
