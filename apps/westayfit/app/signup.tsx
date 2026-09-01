import { router } from 'expo-router';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  updateProfile,
} from 'firebase/auth';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

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
import { authErrorMessage, isEmailAlreadyInUse } from '../src/authErrors';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseAuth } from '../src/firebase';

export default function SignUp() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmAdult, setConfirmAdult] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerSignIn, setOfferSignIn] = useState(false);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Create your account" testID="wsf-signup-disabled" />;
  }

  const canSubmit = confirmAdult && !!displayName.trim() && !!email.trim() && password.length >= 8;

  async function onSubmit() {
    setError(null);
    setOfferSignIn(false);
    setSubmitting(true);
    try {
      const auth = getFirebaseAuth();
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: displayName.trim() });
      await sendEmailVerification(cred.user);
      router.replace('/verify-email');
    } catch (e) {
      setError(authErrorMessage(e, 'Sign-up failed.'));
      setOfferSignIn(isEmailAlreadyInUse(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormShell
      eyebrow="We Stay Fit"
      heading="Create your account"
      intro="Adults only. We will send a verification email before you can join a community."
      testID="wsf-signup"
    >
      <FieldLabel>Display name</FieldLabel>
      <TextField
        value={displayName}
        onChangeText={setDisplayName}
        autoCapitalize="words"
        testID="wsf-signup-displayName"
      />
      <FieldLabel>Email</FieldLabel>
      <TextField
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        testID="wsf-signup-email"
      />
      <FieldLabel>Password (min 8 characters)</FieldLabel>
      <TextField
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        testID="wsf-signup-password"
      />

      <Pressable
        onPress={() => setConfirmAdult((v) => !v)}
        style={authFormStyles.checkboxRow}
        testID="wsf-signup-adultCheckbox"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: confirmAdult }}
      >
        <View style={[authFormStyles.checkbox, confirmAdult ? authFormStyles.checkboxChecked : null]}>
          {confirmAdult ? <Text style={authFormStyles.checkboxCheck}>{'\u2713'}</Text> : null}
        </View>
        <Text style={authFormStyles.checkboxLabel}>
          I confirm I am 18 or older, and I accept the Terms of Service and Privacy Policy.
        </Text>
      </Pressable>

      {error ? <ErrorText testID="wsf-signup-error">{error}</ErrorText> : null}

      {/* The address is taken, so "Create account" cannot succeed no matter how
          many times it is pressed. Lead with the action that works. */}
      {offerSignIn ? (
        <SecondaryLink href="/signin" label="Sign in to your existing account" />
      ) : null}

      <SubmitButton
        label="Create account"
        onPress={onSubmit}
        submitting={submitting}
        disabled={!canSubmit}
        testID="wsf-signup-submit"
      />
      <SecondaryLink href="/signin" label="Already have an account? Sign in" />
    </FormShell>
  );
}
