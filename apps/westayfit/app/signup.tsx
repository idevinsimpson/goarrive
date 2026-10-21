import { router, useNavigation } from 'expo-router';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, type TextInput } from 'react-native';

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
import { routeAfterAuth } from '../src/pendingJoinCode';
import { landAfterAuth } from '../src/ui/authLanding';
import {
  leaveRedirectFailed,
  openKioskGoal,
  REDIRECT_FAILED_SENTENCE,
  REDIRECT_WAY_OUT_HOME,
  REDIRECT_WAY_OUT_KIOSK,
} from '../src/ui/authRedirect';
import { requestVerificationEmail } from '../src/verificationEmail';
import { beginVerificationSend, recordVerificationSend } from '../src/verificationSendState';
import { nativeErrorBoundary } from '../src/ui/RouteErrorFallback';

/*
  NATIVE-MEMBER-1 W16-13 (INT-01 CS-4). On a phone a render error here shows
  the contained screen fallback (Try again remounts the route, Go to Home is
  the way out; src/ui/RouteErrorFallback.native.tsx) instead of ending the
  process. The web module returns undefined, so the web gets no boundary and
  nothing changes there.
*/
export const ErrorBoundary = nativeErrorBoundary('screen');

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
  /*
    NATIVE-MEMBER-1 W16-1 (MF-13). THE KEYBOARD'S GO/ENTER IS A SUBMIT TOO.
    The password field's Go (native) and Enter (web: react-native-web turns
    Enter into onSubmitEditing) call onSubmit directly, past the button's
    disabled state. So onSubmit carries the guards itself: the same rule the
    button shows, and a synchronous in-flight latch (a ref, not state: two
    key presses in one tick both see the old state).
  */
  const inFlight = useRef(false);

  // W16-7 (INT-20, MF-16): as signin.tsx. The terminal hop lands through
  // landAfterAuth (on a phone, Home only with the destination pushed over it;
  // on the web, replace as before), and an offline profile read has a way out
  // on a phone. The web keeps its Loading branch.
  const navigation = useNavigation();
  const land = useCallback(
    (next: string) =>
      landAfterAuth(next, {
        dispatch: (action) => navigation.dispatch(action as never),
        push: (href) => router.push(href as never),
        replace: (href) => router.replace(href as never),
        platform: Platform.OS,
      }),
    [navigation],
  );
  const [redirectFailed, setRedirectFailed] = useState(false);
  const [redirectAttempt, setRedirectAttempt] = useState(0);

  // Already-signed-in short-circuit — mirror of signin.tsx. A member with a
  // live session landing on /signup would otherwise be handed a form asking
  // them to create the account they already have. Route to whichever gate
  // still applies to them (verify-email, profile-setup, or home).
  useEffect(() => {
    if (!ready || !user) return;
    let cancelled = false;
    setRedirectFailed(false);
    (async () => {
      if (!user.emailVerified) {
        if (!cancelled) router.replace('/verify-email');
        return;
      }
      let next: string;
      try {
        const db = getFirebaseFirestore();
        const profileSnap = await getDoc(doc(db, 'wsfMemberProfiles', user.uid));
        if (cancelled) return;
        if (!profileSnap.exists()) {
          router.replace('/profile-setup');
          return;
        }
        // Waits for the pending join code to have been read (a phone reads it
        // from storage at launch) and honours it only for this account.
        next = await routeAfterAuth('/', user.uid);
      } catch {
        if (!cancelled) setRedirectFailed(true);
        return;
      }
      if (cancelled) return;
      land(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user, redirectAttempt, land]);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Create your account" testID="wsf-signup-disabled" />;
  }

  // Same-shape guard as signin — avoid flashing a "Create account" form to
  // someone the useEffect above is already about to redirect.
  if (!ready || user) {
    if (user && redirectFailed && Platform.OS !== 'web') {
      // RV14-642-F1: as signin.tsx. Under an open kiosk session the way out
      // goes back to the kiosk, never to member Home (src/ui/authRedirect.ts).
      const kioskGoal = openKioskGoal(user.uid);
      return (
        <FormShell heading="Start moving together." testID="wsf-signup-redirect-failed">
          <ErrorText testID="wsf-signup-redirect-error">{REDIRECT_FAILED_SENTENCE}</ErrorText>
          <SubmitButton
            label="Try again"
            onPress={() => setRedirectAttempt((n) => n + 1)}
            submitting={false}
            testID="wsf-signup-redirect-retry"
          />
          <SubmitButton
            label={kioskGoal ? REDIRECT_WAY_OUT_KIOSK : REDIRECT_WAY_OUT_HOME}
            variant="tertiary"
            onPress={() =>
              leaveRedirectFailed(user.uid, kioskGoal, {
                land,
                dismissTo: (href) => router.dismissTo(href as never),
              })
            }
            submitting={false}
            testID={kioskGoal ? 'wsf-signup-redirect-kiosk' : 'wsf-signup-redirect-home'}
          />
        </FormShell>
      );
    }
    return (
      <FormShell heading="Start moving together." testID="wsf-signup-loading">
        <StatusText>Loading…</StatusText>
      </FormShell>
    );
  }

  const canSubmit = !!displayName.trim() && !!email.trim() && password.length >= 8;

  async function onSubmit() {
    if (!canSubmit || inFlight.current) return;
    inFlight.current = true;
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
      // MF-13 review N-1: the latch reopens only for an outcome the member can
      // retry. A terminal one keeps it shut, so a Go/Enter that lands before
      // the re-render (while the old closure still reads the old state) cannot
      // submit again. The account exists once create resolves: success is terminal.
      inFlight.current = false;
      setError(authErrorMessage(e, 'Sign-up failed.'));
      setOfferSignIn(isEmailAlreadyInUse(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormShell
      heading="Start moving together."
      /* CAPABILITY-NEUTRAL, BECAUSE THE SEND IS NOT GUARANTEED. The old line
         promised "We will send a verification email", which is false on any
         build where WSF_EMAIL_* is unset — including the one being smoke
         tested. This states the requirement, which is true either way; the
         outcome screen then says what actually happened. */
      intro="You'll need to verify your email before you can join a community."
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
        // W16-7 (INT-24): iOS offers the saved sign-in for a 'username' field;
        // autoComplete stays 'email' (the web's autocomplete attribute).
        textContentType={Platform.OS === 'ios' ? 'username' : 'emailAddress'}
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
