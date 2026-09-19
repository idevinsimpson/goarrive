import { router } from 'expo-router';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useWsfAuth } from '../src/auth';
import { AuthFlagOffPanel } from '../src/AuthFlagOffPanel';
import {
  authFormStyles,
  ErrorText,
  FieldLabel,
  FormShell,
  SecondaryLink,
  SubmitButton,
  TextField,
} from '../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseFirestore } from '../src/firebase';
import {
  WSF_ACCEPTED_PRIVACY_VERSION,
  WSF_ACCEPTED_TERMS_VERSION,
} from '../src/profileConstants';

export default function ProfileSetup() {
  const { ready, user } = useWsfAuth();
  const [displayName, setDisplayName] = useState('');
  const [adultConfirmation, setAdultConfirmation] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Complete your profile" testID="wsf-profile-disabled" />;
  }

  if (!ready) {
    return (
      <FormShell heading="Complete your profile" testID="wsf-profile-loading">
        <Text>Loading…</Text>
      </FormShell>
    );
  }

  if (!user) {
    return (
      <FormShell
        heading="Complete your profile"
        intro="You need to sign in first."
        testID="wsf-profile-signed-out"
      >
        <SecondaryLink href="/signin" label="Sign in" />
      </FormShell>
    );
  }

  if (!user.emailVerified) {
    return (
      <FormShell
        heading="Complete your profile"
        intro="Verify your email before completing your profile."
        testID="wsf-profile-unverified"
      >
        <SecondaryLink href="/verify-email" label="Verify email" />
      </FormShell>
    );
  }

  const initialName = displayName || user.displayName || '';
  const canSubmit = adultConfirmation && acceptedTerms && !!initialName.trim();

  async function onSubmit() {
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
      const db = getFirebaseFirestore();
      await setDoc(doc(db, 'wsfMemberProfiles', user.uid), {
        displayName: initialName.trim(),
        adultConfirmation: true,
        acceptedTermsVersion: WSF_ACCEPTED_TERMS_VERSION,
        acceptedPrivacyVersion: WSF_ACCEPTED_PRIVACY_VERSION,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      router.replace('/start-community');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormShell
      eyebrow="We Stay Fit"
      heading="Complete your profile"
      intro="One step before you can start or join a community."
      testID="wsf-profile"
    >
      <FieldLabel>Display name</FieldLabel>
      <TextField
        value={initialName}
        onChangeText={setDisplayName}
        autoCapitalize="words"
        testID="wsf-profile-displayName"
      />

      <Pressable
        onPress={() => setAdultConfirmation((v) => !v)}
        style={authFormStyles.checkboxRow}
        testID="wsf-profile-adultCheckbox"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: adultConfirmation }}
      >
        <View style={[authFormStyles.checkbox, adultConfirmation ? authFormStyles.checkboxChecked : null]}>
          {adultConfirmation ? <Text style={authFormStyles.checkboxCheck}>{'\u2713'}</Text> : null}
        </View>
        <Text style={authFormStyles.checkboxLabel}>I confirm I am 18 or older.</Text>
      </Pressable>

      <Pressable
        onPress={() => setAcceptedTerms((v) => !v)}
        style={authFormStyles.checkboxRow}
        testID="wsf-profile-termsCheckbox"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: acceptedTerms }}
      >
        <View style={[authFormStyles.checkbox, acceptedTerms ? authFormStyles.checkboxChecked : null]}>
          {acceptedTerms ? <Text style={authFormStyles.checkboxCheck}>{'\u2713'}</Text> : null}
        </View>
        <Text style={authFormStyles.checkboxLabel}>
          I accept the We Stay Fit Terms of Service and Privacy Policy.
        </Text>
      </Pressable>

      {error ? <ErrorText testID="wsf-profile-error">{error}</ErrorText> : null}

      <SubmitButton
        label="Save profile"
        onPress={onSubmit}
        submitting={submitting}
        disabled={!canSubmit}
        testID="wsf-profile-submit"
      />
    </FormShell>
  );
}
