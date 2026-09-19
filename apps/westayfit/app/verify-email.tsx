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
import {
  forgetVerificationSend,
  readVerificationSend,
  recordVerificationSend,
  type VerificationSendOutcome,
} from '../src/verificationSendState';

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
      recordVerificationSend(user.uid, result.sent ? 'sent' : 'already-verified');
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
      // a plain sentence a member can act on instead (the testID keeps the
      // state distinguishable for the specs).
      if (authErrorCode(e) === 'functions/failed-precondition') {
        recordVerificationSend(user.uid, 'unconfigured');
        setUnconfigured(true);
      } else {
        recordVerificationSend(user.uid, 'failed');
        setError(authErrorMessage(e, 'Send failed.'));
      }
    } finally {
      setResending(false);
    }
  }, [user]);

  const onSignOut = useCallback(async () => {
    // The record describes one attempt for one account; it must not survive
    // into whoever signs in next.
    forgetVerificationSend();
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

  // What this screen may claim depends entirely on what the send actually did.
  // 'sending' and null are deliberately non-committal: nothing has been
  // confirmed, so nothing is asserted.
  const where = user.email ?? 'your email';
  const outcome: VerificationSendOutcome | null = unconfigured
    ? 'unconfigured'
    : readVerificationSend(user.uid);
  const INTRO: Record<VerificationSendOutcome, string> = {
    sending: `Sending a verification link to ${where}. Confirm it, then tap I have verified.`,
    sent: `We sent a verification link to ${where}. Confirm it, then tap I have verified.`,
    'already-verified': `${where} is already verified. Tap I have verified to continue.`,
    unconfigured: `Email isn't switched on for this test build, so no verification link can be sent to ${where} yet.`,
    failed: `We could not send a verification link to ${where}. Tap Resend to try again.`,
  };
  const intro = outcome
    ? INTRO[outcome]
    : `Confirm your email address at ${where}, then tap I have verified.`;

  return (
    <FormShell heading="Verify your email" intro={intro} testID="wsf-verify">
      {status ? <StatusText testID="wsf-verify-status">{status}</StatusText> : null}
      {outcome === 'unconfigured' ? (
        <ErrorText testID="wsf-verify-unconfigured">
          Email isn't switched on for this test build yet, so no message was sent. Nobody can
          finish verifying a new account here until it is switched on. Sign out to use an account
          that is already verified.
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
        variant="secondary"
      />
      <SubmitButton
        label="Sign out"
        onPress={onSignOut}
        submitting={false}
        testID="wsf-verify-signout"
        variant="tertiary"
      />
    </FormShell>
  );
}
