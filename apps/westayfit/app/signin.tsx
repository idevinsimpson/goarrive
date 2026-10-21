import { router, useNavigation } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, type TextInput } from 'react-native';

import { useWsfAuth } from '../src/auth';
import { AuthFlagOffPanel } from '../src/AuthFlagOffPanel';
import {
  ErrorText,
  FieldLabel,
  ForkLink,
  ForkRow,
  FormShell,
  PasswordField,
  SecondaryLink,
  StatusText,
  SubmitButton,
  TextField,
} from '../src/AuthFormPrimitives';
import {
  authDestinationCard,
  authReturnHeading,
  readAuthDestinationKind,
  type AuthDestinationKind,
} from '../src/authDestination';
import { authErrorMessage, isCredentialMismatch } from '../src/authErrors';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseAuth, getFirebaseFirestore } from '../src/firebase';
import { routeAfterAuth } from '../src/pendingJoinCode';
import { isPostAuthDestinationsReady, usePostAuthDestinationsReady } from '../src/postAuthDestination';
import { landAfterAuth } from '../src/ui/authLanding';
import { memberLandingDeps } from '../src/ui/memberLanding';
import {
  leaveRedirectFailed,
  openKioskGoal,
  REDIRECT_FAILED_SENTENCE,
  REDIRECT_WAY_OUT_HOME,
  REDIRECT_WAY_OUT_KIOSK,
} from '../src/ui/authRedirect';
import { nativeErrorBoundary } from '../src/ui/RouteErrorFallback';

/*
  NATIVE-MEMBER-1 W16-13 (INT-01 CS-4). On a phone a render error here shows
  the contained screen fallback (Try again remounts the route, Go to Home is
  the way out; src/ui/RouteErrorFallback.native.tsx) instead of ending the
  process. The web module returns undefined, so the web gets no boundary and
  nothing changes there.
*/
export const ErrorBoundary = nativeErrorBoundary('screen');

export default function SignIn() {
  const { ready, user } = useWsfAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);
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
  /*
    WHAT THIS SCREEN IS CARRYING, read once on mount.

    Session storage is not reactive, and re-reading it every render would let
    the heading change under somebody mid-type. Read is all this does — the
    destination is resolved and consumed by `nextRouteAfterAuth`, on the
    terminal hop, exactly as before.

    "Once" means once the store CAN answer. On web that is mount, as it always
    was. On a phone the destinations are read from storage at launch, so a
    cold start straight onto this screen reads them the moment that read
    lands (milliseconds, and while the form is still behind "Loading…" for
    auth). The form is only ever shown to someone signed out, so a
    destination stashed under an account is not announced here.
  */
  const destinationsReady = usePostAuthDestinationsReady();
  const readDestinationOnce = useRef(isPostAuthDestinationsReady());
  const [destinationKind, setDestinationKind] = useState<AuthDestinationKind | null>(() =>
    isPostAuthDestinationsReady() ? readAuthDestinationKind(null) : null
  );
  useEffect(() => {
    if (!destinationsReady || readDestinationOnce.current) return;
    readDestinationOnce.current = true;
    setDestinationKind(readAuthDestinationKind(null));
  }, [destinationsReady]);
  const returning = destinationKind !== null;
  const words = destinationKind
    ? authReturnHeading(destinationKind)
    : { heading: 'Welcome back.', intro: 'Sign in to your community.' };

  /*
    NATIVE-MEMBER-1 W16-7 (INT-20). THE TERMINAL HOP LANDS, IT DOES NOT
    REPLACE. On a phone `router.replace` swaps only the top of the root stack,
    so the (tabs) under this screen and the one the hop opened piled up
    (src/ui/authLanding.ts). The terminal hop goes through landAfterAuth: on a
    phone Home only with the destination pushed over it; on the web replace,
    exactly as before. The /verify-email and /profile-setup gate hops keep
    replace.
  */
  const navigation = useNavigation();
  // W16-19 (RV16-641-B1): the landing also reads the root stack and can
  // dismiss into it, so a kiosk beneath is never reset away
  // (src/ui/memberLanding.ts).
  const land = useCallback((next: string) => landAfterAuth(next, memberLandingDeps(navigation)), [navigation]);
  // A successful submit also flips `user`, so the redirect effect below and
  // onSubmit can both reach the terminal hop with the same destination (it is
  // read, not consumed). It lands once per account: on a phone a second
  // landing would reset and push the destination again.
  const landedFor = useRef<string | null>(null);
  const landOnce = useCallback(
    (uid: string, next: string) => {
      if (landedFor.current === uid) return;
      landedFor.current = uid;
      land(next);
    },
    [land],
  );
  /*
    W16-7 (MF-16). AN OFFLINE REDIRECT HAS A WAY OUT. The profile read below
    could reject (no connection) and left "Loading…" with nothing to press. It
    is caught now; on a phone the screen says so, with Try again (the same
    reads) and Back to home (Back to the kiosk while a kiosk session is open,
    RV14-642-F1). The web keeps today's Loading branch.
  */
  const [redirectFailed, setRedirectFailed] = useState(false);
  const [redirectAttempt, setRedirectAttempt] = useState(0);

  // Already-signed-in short-circuit. E3.5 §3C C5: a member who taps the app
  // icon after their session survived (verified, profile written) must not
  // see a signin form asking them for the credentials they already used —
  // that path leads straight back to "wrong password" when they mistype and
  // then to reset-password, all to end up on the home they should have been
  // shown on mount. Route to the gate that actually applies.
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
        next = await routeAfterAuth('/', user.uid);
      } catch {
        if (!cancelled) setRedirectFailed(true);
        return;
      }
      if (cancelled) return;
      landOnce(user.uid, next);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user, redirectAttempt, landOnce]);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Sign in" testID="wsf-signin-disabled" />;
  }

  // Suppress the form while auth resolves or while the redirect is in
  // flight — otherwise a signed-in member sees a flash of "Sign in" with
  // their own creds prompted, which is exactly the confusion C5 fixes.
  if (!ready || user) {
    if (user && redirectFailed && Platform.OS !== 'web') {
      // RV14-642-F1: under an open kiosk session the way out goes back to the
      // kiosk (which signs the visitor out), never to member Home
      // (src/ui/authRedirect.ts).
      const kioskGoal = openKioskGoal(user.uid);
      return (
        <FormShell heading="Sign in" testID="wsf-signin-redirect-failed">
          <ErrorText testID="wsf-signin-redirect-error">{REDIRECT_FAILED_SENTENCE}</ErrorText>
          <SubmitButton
            label="Try again"
            onPress={() => setRedirectAttempt((n) => n + 1)}
            submitting={false}
            testID="wsf-signin-redirect-retry"
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
            testID={kioskGoal ? 'wsf-signin-redirect-kiosk' : 'wsf-signin-redirect-home'}
          />
        </FormShell>
      );
    }
    return (
      <FormShell heading="Sign in" testID="wsf-signin-loading">
        <StatusText>Loading…</StatusText>
      </FormShell>
    );
  }

  // The button's own rule, now the one rule for every way of submitting.
  const canSubmit = !!email && !!password;

  async function onSubmit() {
    if (!canSubmit || inFlight.current) return;
    inFlight.current = true;
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
      // to consult nextRouteAfterAuth — the pending code survives the gate hops
      // (session storage on web, the bounded native store on a phone) and is
      // consumed on the final terminal hop. `routeAfterAuth` waits for that
      // store to have been read, and only honours a code that is this
      // account's or was stashed signed out.
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
      landOnce(credential.user.uid, await routeAfterAuth('/', credential.user.uid));
    } catch (e) {
      // MF-13 review N-1: the latch reopens only for an outcome the member can
      // retry. A terminal one keeps it shut, so a Go/Enter that lands before
      // the re-render (while the old closure still reads the old state) cannot
      // submit again. A sign-in that resolves navigates away: success is terminal.
      inFlight.current = false;
      setError(authErrorMessage(e, 'Sign-in failed.'));
      setMismatch(isCredentialMismatch(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormShell
      heading={words.heading}
      intro={words.intro}
      testID="wsf-signin"
      /* An error does NOT re-brand the product: the field is unchanged and
         the banded message in the sheet carries the state. A screen that is
         carrying a destination keeps saying so even while showing an error —
         losing the destination card is how somebody concludes the round trip
         was dropped. */
      tone={mismatch ? 'error' : returning ? 'returning' : 'ordinary'}
      destination={destinationKind ? authDestinationCard(destinationKind) : undefined}
      /* THE WAYS OUT SIT AT THE FOOT, not trailing the primary action: on a
         tall phone that is where a thumb is, and it stops the sheet ending in
         a column of links above empty cream.

         WHEN THE CREDENTIAL FORKS ARE SHOWING, THE FOOT DROPS THEM. They are
         the same two destinations; offering each twice on one screen is the
         duplication this atlas has had to correct before. */
      foot={
        mismatch ? null : (
          <>
            <SecondaryLink
              href="/reset-password"
              label="Forgot your password?"
              testID="wsf-signin-forgot"
            />
            <SecondaryLink
              href="/signup"
              label="New here? Create an account"
              testID="wsf-signin-create"
            />
          </>
        )
      }
    >
      <FieldLabel>Email</FieldLabel>
      <TextField
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
        <ForkRow>
          <ForkLink
            href="/reset-password"
            label="Reset password"
            testID="wsf-signin-error-forgot"
          />
          <ForkLink href="/signup" label="Create account" testID="wsf-signin-error-create" />
        </ForkRow>
      ) : null}
      <SubmitButton
        label={returning ? 'Sign in and continue' : 'Sign in'}
        onPress={onSubmit}
        submitting={submitting}
        disabled={!canSubmit}
        testID="wsf-signin-submit"
      />
    </FormShell>
  );
}
