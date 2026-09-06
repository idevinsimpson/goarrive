import { router } from 'expo-router';
import { reload, signOut } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
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
import { authErrorCode, authErrorMessage } from '../src/authErrors';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseAuth, getFirebaseFirestore } from '../src/firebase';
import { nextRouteAfterAuth } from '../src/pendingJoinCode';
import { requestVerificationEmail } from '../src/verificationEmail';

export default function VerifyEmail() {
  const { ready, user } = useWsfAuth();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);

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
        // Same profile-vs-signed-in-home fork as signin.tsx — an already-set-up
        // member who is just clearing verify limbo lands on the home, not on a
        // profile screen they already finished. A brand-new signup with a
        // pending join code MUST still hit profile-setup first so the profile
        // exists before wsfJoinCommunity is called; nextRouteAfterAuth is only
        // safe on the terminal (profile-exists) branch.
        const db = getFirebaseFirestore();
        const profileSnap = await getDoc(doc(db, 'wsfMemberProfiles', user.uid));
        if (!profileSnap.exists()) {
          router.replace('/profile-setup' as never);
          return;
        }
        router.replace(nextRouteAfterAuth('/') as never);
      } else {
        setStatus('Still unverified. Check your inbox and try again.');
      }
    } catch (e) {
      setError(authErrorMessage(e, 'Refresh failed.'));
    } finally {
      setChecking(false);
    }
  }, [user]);

  const onResend = useCallback(async () => {
    if (!user) return;
    setResending(true);
    setError(null);
    setStatus(null);
    setUnconfigured(false);
    try {
      // WSF's own delivery path — the client SDK's sendEmailVerification routes
      // through mail that does not arrive and mints a link that does not
      // resolve. See wsfSendVerificationEmail.
      const result = await requestVerificationEmail();
      setStatus(
        result.sent
          ? 'Verification email sent.'
          : 'This address is already verified — tap "I have verified".'
      );
    } catch (e) {
      // wsfSendVerificationEmail throws failed-precondition when the
      // WSF_EMAIL_* env vars are missing (F13). The old fallback rendered
      // "Send failed. (functions/failed-precondition)" — a string that names
      // an internal code and tells the caller nothing they can act on. Show
      // the honest state instead, so the person on the screen knows the
      // build itself is not wired to send and who to ping.
      if (authErrorCode(e) === 'functions/failed-precondition') {
        setUnconfigured(true);
      } else {
        setError(authErrorMessage(e, 'Send failed.'));
      }
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
      {unconfigured ? (
        <ErrorText testID="wsf-verify-unconfigured">
          Email sending is not set up yet on this build. Ask Devin.
        </ErrorText>
      ) : null}
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
