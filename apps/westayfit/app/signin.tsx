import { router } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useEffect, useRef, useState } from 'react';
import type { TextInput } from 'react-native';

import { useWsfAuth } from '../src/auth';
import { AuthFlagOffPanel } from '../src/AuthFlagOffPanel';
import {
  ErrorText,
  FieldLabel,
  FormShell,
  PasswordField,
  SecondaryLink,
  StatusText,
  SubmitButton,
  TextField,
} from '../src/AuthFormPrimitives';
import { authErrorMessage, isCredentialMismatch } from '../src/authErrors';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseAuth, getFirebaseFirestore } from '../src/firebase';
import { nextRouteAfterAuth } from '../src/pendingJoinCode';

export default function SignIn() {
  const { ready, user } = useWsfAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  // Already-signed-in short-circuit. E3.5 §3C C5: a member who taps the app
  // icon after their session survived (verified, profile written) must not
  // see a signin form asking them for the credentials they already used —
  // that path leads straight back to "wrong password" when they mistype and
  // then to reset-password, all to end up on the home they should have been
  // shown on mount. Route to the gate that actually applies.
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
    return <AuthFlagOffPanel title="Sign in" testID="wsf-signin-disabled" />;
  }

  // Suppress the form while auth resolves or while the redirect is in
  // flight — otherwise a signed-in member sees a flash of "Sign in" with
  // their own creds prompted, which is exactly the confusion C5 fixes.
  if (!ready || user) {
    return (
      <FormShell heading="Sign in" testID="wsf-signin-loading">
        <StatusText>Loading…</StatusText>
      </FormShell>
    );
  }

  async function onSubmit() {
    setError(null);
    setMismatch(false);
    setSubmitting(true);
    try {
      // Trim AND lowercase — Firebase Auth stores addresses lowercase, so a
      // caller who typed 'Foo@Example.com' would otherwise fail sign-in
      // against the account they created with 'foo@example.com'. The phone
      // keyboard's leading auto-capital was one of the shapes E3.5 §3C found.
      const credential = await signInWithEmailAndPassword(
        getFirebaseAuth(),
        email.trim().toLowerCase(),
        password
      );
      // Route on actual state. Sending an already-verified returning member to
      // "Verify your email" tells them to check an inbox for nothing and makes
      // them tap through a step they finished long ago.
      //
      // Pending-join-code precedence is terminal-only: signin -> verify ->
      // profile-setup -> /join/<code> -> /community/<id>. An unverified or
      // profileless member must complete their gate BEFORE the join round-trip
      // resumes, otherwise the wsfJoinCommunity guards fail and the visitor
      // dead-ends. Only a member who is verified AND has a profile is allowed
      // to consult nextRouteAfterAuth — the pending code survives sessionStorage
      // across the gate hops and is consumed on the final terminal hop.
      if (!credential.user.emailVerified) {
        router.replace('/verify-email');
        return;
      }
      const db = getFirebaseFirestore();
      const profileSnap = await getDoc(doc(db, 'wsfMemberProfiles', credential.user.uid));
      if (!profileSnap.exists()) {
        router.replace('/profile-setup');
        return;
      }
      router.replace(nextRouteAfterAuth('/'));
    } catch (e) {
      setError(authErrorMessage(e, 'Sign-in failed.'));
      setMismatch(isCredentialMismatch(e));
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
        autoCorrect={false}
        spellCheck={false}
        autoComplete="email"
        textContentType="emailAddress"
        inputMode="email"
        keyboardType="email-address"
        returnKeyType="next"
        onSubmitEditing={() => passwordRef.current?.focus()}
        testID="wsf-signin-email"
      />
      <FieldLabel>Password</FieldLabel>
      <PasswordField
        ref={passwordRef}
        value={password}
        onChangeText={setPassword}
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        testID="wsf-signin-password"
      />
      {error ? <ErrorText testID="wsf-signin-error">{error}</ErrorText> : null}
      {/* Firebase Auth's enumeration protection collapses "no such user" and
          "wrong password" into one code — so the only honest next steps are
          the two forks that cover both cases. Reset the password you have, or
          create the account you don't. Buried in the paragraph, either is
          invisible; as tappable links they resolve the dead end E3.5 §3C
          caught. */}
      {mismatch ? (
        <>
          <SecondaryLink
            href="/reset-password"
            label="Forgot your password?"
            testID="wsf-signin-error-forgot"
          />
          <SecondaryLink
            href="/signup"
            label="New here? Create an account"
            testID="wsf-signin-error-create"
          />
        </>
      ) : null}
      <SubmitButton
        label="Sign in"
        onPress={onSubmit}
        submitting={submitting}
        disabled={!email || !password}
        testID="wsf-signin-submit"
      />
      <SecondaryLink
        href="/reset-password"
        label="Forgot your password?"
        testID="wsf-signin-forgot"
      />
      <SecondaryLink href="/signup" label="New here? Create an account" />
    </FormShell>
  );
}
