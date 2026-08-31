import { router } from 'expo-router';
import { reload, sendEmailVerification, signOut } from 'firebase/auth';
import { useCallback, useState } from 'react';

import { useWsfAuth } from '../src/auth';
import { AuthFlagOffPanel } from '../src/AuthFlagOffPanel';
import {
  ErrorText,
  FormShell,
  SecondaryLink,
  StatusText,
  SubmitButton,
} from '../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseAuth } from '../src/firebase';

export default function VerifyEmail() {
  const { ready, user } = useWsfAuth();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onCheck = useCallback(async () => {
    if (!user) return;
    setChecking(true);
    setError(null);
    setStatus(null);
    try {
      await reload(user);
      if (user.emailVerified) {
        // reload() refreshes the local User object but NOT the cached ID token,
        // which still carries email_verified: false. Both firestore.rules and
        // wsfCreateCommunity gate on the TOKEN claim, so without a forced
        // refresh the very next write fails with PERMISSION_DENIED and the new
        // member is dead-ended one step after verifying. Mint a fresh token.
        await user.getIdToken(true);
        router.replace('/profile-setup');
      } else {
        setStatus('Still unverified. Check your inbox and try again.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed.');
    } finally {
      setChecking(false);
    }
  }, [user]);

  const onResend = useCallback(async () => {
    if (!user) return;
    setResending(true);
    setError(null);
    setStatus(null);
    try {
      await sendEmailVerification(user);
      setStatus('Verification email sent.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Send failed.');
    } finally {
      setResending(false);
    }
  }, [user]);

  const onSignOut = useCallback(async () => {
    await signOut(getFirebaseAuth());
    router.replace('/');
  }, []);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Verify your email" testID="wsf-verify-disabled" />;
  }

  if (!ready) {
    return (
      <FormShell heading="Verify your email" testID="wsf-verify-loading">
        <StatusText>Loading…</StatusText>
      </FormShell>
    );
  }

  if (!user) {
    return (
      <FormShell
        heading="Verify your email"
        intro="You need to sign in first."
        testID="wsf-verify-signed-out"
      >
        <SecondaryLink href="/signin" label="Sign in" />
      </FormShell>
    );
  }

  return (
    <FormShell
      eyebrow="We Stay Fit"
      heading="Verify your email"
      intro={`We sent a verification link to ${user.email ?? 'your email'}. Confirm it, then tap I have verified.`}
      testID="wsf-verify"
    >
      {status ? <StatusText testID="wsf-verify-status">{status}</StatusText> : null}
      {error ? <ErrorText testID="wsf-verify-error">{error}</ErrorText> : null}
      <SubmitButton
        label="I have verified"
        onPress={onCheck}
        submitting={checking}
        testID="wsf-verify-check"
      />
      <SubmitButton
        label="Resend verification email"
        onPress={onResend}
        submitting={resending}
        testID="wsf-verify-resend"
      />
      <SubmitButton
        label="Sign out"
        onPress={onSignOut}
        submitting={false}
        testID="wsf-verify-signout"
      />
    </FormShell>
  );
}
