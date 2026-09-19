import { router } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useState } from 'react';

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
import { getFirebaseAuth } from '../src/firebase';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Sign in" testID="wsf-signin-disabled" />;
  }

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
      router.replace('/verify-email');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormShell
      eyebrow="We Stay Fit"
      heading="Sign in"
      intro="Welcome back. Sign in to your community."
      testID="wsf-signin"
    >
      <FieldLabel>Email</FieldLabel>
      <TextField
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        testID="wsf-signin-email"
      />
      <FieldLabel>Password</FieldLabel>
      <TextField
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        testID="wsf-signin-password"
      />
      {error ? <ErrorText testID="wsf-signin-error">{error}</ErrorText> : null}
      <SubmitButton
        label="Sign in"
        onPress={onSubmit}
        submitting={submitting}
        disabled={!email || !password}
        testID="wsf-signin-submit"
      />
      <SecondaryLink href="/signup" label="New here? Create an account" />
    </FormShell>
  );
}
