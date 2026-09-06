import { router } from 'expo-router';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { useState } from 'react';

import { AuthFlagOffPanel } from '../src/AuthFlagOffPanel';
import {
  ErrorText,
  FieldLabel,
  FormShell,
  PasswordField,
  SecondaryLink,
  SubmitButton,
  TextField,
} from '../src/AuthFormPrimitives';
import { authErrorMessage, isEmailAlreadyInUse } from '../src/authErrors';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseAuth } from '../src/firebase';
import { requestVerificationEmail } from '../src/verificationEmail';

export default function SignUp() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerSignIn, setOfferSignIn] = useState(false);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Create your account" testID="wsf-signup-disabled" />;
  }

  const canSubmit = !!displayName.trim() && !!email.trim() && password.length >= 8;

  async function onSubmit() {
    setError(null);
    setOfferSignIn(false);
    setSubmitting(true);
    try {
      const auth = getFirebaseAuth();
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: displayName.trim() });

      // Best-effort. The account already exists by this point, so a send
      // failure must not strand the member on the signup screen with no way
      // forward — /verify-email has a Resend button that surfaces the real
      // error when they actively ask for one.
      try {
        await requestVerificationEmail();
      } catch (sendError) {
        console.warn('[signup] verification email not sent', sendError);
      }
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
      intro="We will send a verification email before you can join a community."
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
      <PasswordField
        value={password}
        onChangeText={setPassword}
        testID="wsf-signup-password"
      />

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
