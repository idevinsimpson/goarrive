import { router } from 'expo-router';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import type { TextInput } from 'react-native';

import { useWsfAuth } from '../src/auth';
import { AuthFlagOffPanel } from '../src/AuthFlagOffPanel';
import {
  ErrorText,
  FieldHint,
  FieldLabel,
  FormShell,
  PasswordField,
  SecondaryLink,
  StatusText,
  SubmitButton,
  TextField,
} from '../src/AuthFormPrimitives';
import { authErrorCode, authErrorMessage, isEmailAlreadyInUse } from '../src/authErrors';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseAuth, getFirebaseFirestore } from '../src/firebase';
import { nextRouteAfterAuth } from '../src/pendingJoinCode';
import { requestVerificationEmail } from '../src/verificationEmail';
import { beginVerificationSend, recordVerificationSend } from '../src/verificationSendState';

export default function SignUp() {
  const { ready, user } = useWsfAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offerSignIn, setOfferSignIn] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  // Already-signed-in short-circuit — mirror of signin.tsx. A member with a
  // live session landing on /signup would otherwise be handed a form asking
  // them to create the account they already have. Route to whichever gate
  // still applies to them (verify-email, profile-setup, or home).
  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    (async () => {
      if (!user.emailVerified) {
        if (!cancelled) router.replace('/verify-email');
        return;
      }
      const db = getFirebaseFirestore();
      const profileSnap = await getDoc(doc(db, 'wsfMemberProfiles', user.uid));
      if (cancelled) return;
      if (!profileSnap.exists()) {
        router.replace('/profile-setup');
        return;
      }
      router.replace(nextRouteAfterAuth('/') as never);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user]);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Create your account" testID="wsf-signup-disabled" />;
  }

  // Same-shape guard as signin — avoid flashing a "Create account" form to
  // someone the useEffect above is already about to redirect.
  if (!ready || user) {
    return (
      <FormShell heading="Start moving together." testID="wsf-signup-loading">
        <StatusText>Loading…</StatusText>
      </FormShell>
    );
  }

  const canSubmit = !!displayName.trim() && !!email.trim() && password.length >= 8;

  async function onSubmit() {
    setError(null);
    setOfferSignIn(false);
    setSubmitting(true);
    try {
      const auth = getFirebaseAuth();
      // Trim AND lowercase — Firebase Auth stores the address lowercase, so
      // creating an account with a mixed-case address here means signin has
      // to lowercase to match. Normalizing on both sides removes the fork.
      const cred = await createUserWithEmailAndPassword(
        auth,
        email.trim().toLowerCase(),
        password
      );
      await updateProfile(cred.user, { displayName: displayName.trim() });

      // Best-effort for NAVIGATION — a send failure must not strand the member
      // on the signup screen — but never silent. /verify-email has already
      // been reached by the auth effect above, and it describes whatever
      // happens here. Swallowing the failure into a console warning is what
      // made that screen claim "We sent a verification link" to members for
      // whom nothing was sent and nothing could be.
      const attempt = beginVerificationSend(cred.user.uid);
      try {
        const sendResult = await requestVerificationEmail();
        recordVerificationSend(
          cred.user.uid,
          sendResult.sent ? 'sent' : 'already-verified',
          attempt
        );
      } catch (sendError) {
        recordVerificationSend(
          cred.user.uid,
          authErrorCode(sendError) === 'functions/failed-precondition' ? 'unconfigured' : 'failed',
          attempt
        );
      }
      // No navigation here. The signed-in effect above already moved the
      // member to /verify-email the moment the account existed (before this
      // send round trip). A second replace at this point would pull a member
      // who has since tapped "I have verified" back off profile-setup.
    } catch (e) {
      setError(authErrorMessage(e, 'Sign-up failed.'));
      setOfferSignIn(isEmailAlreadyInUse(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormShell
      heading="Start moving together."
      intro="We will send a verification email before you can join a community."
      testID="wsf-signup"
      step="Step 1 of 3"
      foot={
        <SecondaryLink
          href="/signin"
          label="Already have an account? Sign in"
          testID="wsf-signup-signin"
        />
      }
    >
      <FieldLabel>Display name</FieldLabel>
      <TextField
        value={displayName}
        onChangeText={setDisplayName}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        returnKeyType="next"
        onSubmitEditing={() => emailRef.current?.focus()}
        testID="wsf-signup-displayName"
      />
      <FieldLabel>Email</FieldLabel>
      <TextField
        ref={emailRef}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="email"
        textContentType="emailAddress"
        inputMode="email"
        keyboardType="email-address"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        testID="wsf-signup-email"
      />
      <FieldLabel>Password</FieldLabel>
      <PasswordField
        ref={passwordRef}
        value={password}
        onChangeText={setPassword}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        testID="wsf-signup-password"
      />
      {/* Stated as a standing rule, not an after-submit error — the caller
          should know the constraint before they type, and the field is
          already disabled from submitting until it is satisfied (canSubmit
          checks password.length >= 8). */}
      <FieldHint testID="wsf-signup-password-hint">At least 8 characters</FieldHint>

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
    </FormShell>
  );
}
