import { router } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
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
import { authErrorMessage } from '../src/authErrors';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseAuth, getFirebaseFirestore } from '../src/firebase';
import { nextRouteAfterAuth } from '../src/pendingJoinCode';

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
      const credential = await signInWithEmailAndPassword(
        getFirebaseAuth(),
        email.trim(),
        password
      );
      // Route on actual state. Sending an already-verified returning member to
      // "Verify your email" tells them to check an inbox for nothing and makes
      // them tap through a step they finished long ago.
      //
      // A returning member who scanned a QR before signing in has a pending
      // join code stashed by the /join/<code> route; nextRouteAfterAuth hands
      // that visitor straight back to the join page. Callers without a pending
      // code fall through to the ordinary fallback.
      if (!credential.user.emailVerified) {
        router.replace(nextRouteAfterAuth('/verify-email'));
        return;
      }
      // Verified: check for an existing profile. A returning member with a
      // profile lands on the signed-in home; a member who never finished
      // profile-setup lands on it.
      const db = getFirebaseFirestore();
      const profileSnap = await getDoc(doc(db, 'wsfMemberProfiles', credential.user.uid));
      const fallback = profileSnap.exists() ? '/' : '/profile-setup';
      router.replace(nextRouteAfterAuth(fallback));
    } catch (e) {
      setError(authErrorMessage(e, 'Sign-in failed.'));
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
