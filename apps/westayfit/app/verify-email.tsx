import { router } from 'expo-router';
import { reload, signOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { useWsfAuth } from '../src/auth';
import { AuthFlagOffPanel } from '../src/AuthFlagOffPanel';
import {
  ErrorText,
  FootNote,
  FormShell,
  HelpPanel,
  SecondaryLink,
  StatusText,
  SubmitButton,
} from '../src/AuthFormPrimitives';
import {
  authDestinationCard,
  readAuthDestinationKind,
} from '../src/authDestination';
import { authErrorCode, authErrorMessage } from '../src/authErrors';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseAuth, getFirebaseFirestore } from '../src/firebase';
import { nextRouteAfterAuth } from '../src/pendingJoinCode';
import { requestVerificationEmail } from '../src/verificationEmail';
import {
  beginVerificationSend,
  forgetVerificationSend,
  readVerificationSend,
  recordVerificationSend,
  subscribeVerificationSend,
  verificationSendSnapshot,
  type VerificationSendOutcome,
} from '../src/verificationSendState';

export default function VerifyEmail() {
  const { ready, user } = useWsfAuth();
  const [checking, setChecking] = useState(false);
  const [resending, setResending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);
  // The sign-up send finishes AFTER this screen is mounted, so the outcome has
  // to arrive as a notification. Reading a module variable during render would
  // leave "Sending" on screen until some unrelated render happened to pick the
  // answer up.
  useSyncExternalStore(subscribeVerificationSend, verificationSendSnapshot, verificationSendSnapshot);

  // Whose screen this is. When the account changes underneath — a sign-out, or
  // a different account signing in — every local claim on screen belonged to
  // the previous one and must go with it.
  const uid = user?.uid ?? null;
  const lastUidRef = useRef<string | null>(uid);
  useEffect(() => {
    if (lastUidRef.current === uid) return;
    lastUidRef.current = uid;
    setStatus(null);
    setError(null);
    setUnconfigured(false);
    forgetVerificationSend();
  }, [uid]);

  /*
    THE ONE WAY THROUGH THIS GATE.

    Both the tapped check and the passive refresh below call this, and neither
    carries its own copy. Two implementations of "are they verified yet, and
    where do they go" would drift, and the half that drifts is the half that
    routes somebody to the wrong place.

    Returns true when it has routed. Throws on a failed refresh so the CALLER
    decides whether that is worth showing — the tap says so, the passive poll
    stays silent.
  */
  const passThroughIfVerified = useCallback(async (who: User): Promise<boolean> => {
    // THE UID THIS ATTEMPT BELONGS TO, captured before any await. A refresh
    // started for one account must never route another: a sign-out and a new
    // sign-in can land between these lines.
    const startedFor = who.uid;
    await reload(who);
    if (!who.emailVerified) return false;
    // reload() refreshes the local User object but NOT the cached ID token,
    // which still carries email_verified: false. Both firestore.rules and
    // wsfCreateCommunity gate on the TOKEN claim, so without a forced refresh
    // the very next write fails with PERMISSION_DENIED and the new member is
    // dead-ended one step after verifying. Mint a fresh token.
    await who.getIdToken(true);
    const db = getFirebaseFirestore();
    const profileSnap = await getDoc(doc(db, 'wsfMemberProfiles', startedFor));
    // Checked again after every await: if the signed-in account changed while
    // this was in flight, this result belongs to somebody who is gone.
    if (getFirebaseAuth().currentUser?.uid !== startedFor) return false;
    if (!profileSnap.exists()) {
      router.replace('/profile-setup' as never);
      return true;
    }
    // Same profile-vs-signed-in-home fork as signin.tsx — an already-set-up
    // member clearing verify limbo lands on home, not on a profile screen they
    // already finished. A brand-new signup with a pending join code MUST still
    // hit profile-setup first so the profile exists before wsfJoinCommunity is
    // called; nextRouteAfterAuth is only safe on the terminal branch.
    router.replace(nextRouteAfterAuth('/') as never);
    return true;
  }, []);

  const onCheck = useCallback(async () => {
    if (!user) return;
    setChecking(true);
    setError(null);
    setStatus(null);
    try {
      const verified = await passThroughIfVerified(user);
      if (!verified) setStatus('Still unverified. Check your inbox and try again.');
    } catch (e) {
      setError(authErrorMessage(e, 'Refresh failed.'));
    } finally {
      setChecking(false);
    }
  }, [user, passThroughIfVerified]);

  /*
    THE SEND OUTCOME, DERIVED ONCE AND USED BY BOTH THE EFFECT AND THE RENDER.

    It has two sources and they do not always agree. `setUnconfigured(true)`
    is set by a TAP on Resend; the sign-up path instead records its answer
    into the external store that `readVerificationSend` reads. So a member who
    arrives from sign-up on a build with email off has the local flag FALSE
    and the store saying `unconfigured` — the screen renders the unconfigured
    state, correctly, from the store.

    The passive refresh below first gated on the local flag alone, which meant
    it never ran for the people it exists for: everyone arriving from sign-up.
    Deriving it here, once, is what stops the two signals disagreeing again.
  */
  const sendOutcome: VerificationSendOutcome | null = user
    ? unconfigured
      ? 'unconfigured'
      : readVerificationSend(user.uid)
    : null;

  /*
    ON `unconfigured`, THE SCREEN CHECKS FOR ITSELF.

    That outcome no longer offers "I have verified" — there is no link to have
    followed on a build that cannot send — so without this the screen has no
    way forward at all, and somebody whose address was verified elsewhere (an
    administrator, another build) would sit on it with only an action that
    abandons the account they are part-way through creating.

    WHAT KEEPS THIS HONEST:

    · It goes through `passThroughIfVerified`, the same path the tap uses, and
      that function abandons its result if the signed-in uid changed. A poll
      started for account A can never route account B.
    · It is SILENT. A poll that comes back unverified says nothing, and a poll
      that fails says nothing — the screen keeps stating what is true about
      this build. Only a tap is allowed to report back, because only a tap
      asked a question.
    · It runs only while this screen is mounted, in this outcome, for this
      user, and while the page is visible. Every one of those going away stops
      it, and `stopped` makes a poll already in flight harmless.
    · It backs off: 2s, then 4s, 8s, 16s, capped at 30s. A screen somebody
      leaves open does not hammer the network forever.
  */
  useEffect(() => {
    if (sendOutcome !== 'unconfigured' || !user) return;
    const startedFor = user.uid;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let delay = 2_000;

    const hidden = () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden';

    const tick = async () => {
      if (stopped || hidden()) return schedule();
      try {
        // The uid is re-checked here as well as inside the shared path: this
        // is the cheap guard, that one is the one that cannot be skipped.
        if (getFirebaseAuth().currentUser?.uid !== startedFor) return;
        const routed = await passThroughIfVerified(user);
        if (routed) stopped = true;
      } catch {
        // Silent by design. A failed refresh is not news to anybody on this
        // screen, and the screen already says what is true.
      }
      if (!stopped) schedule();
    };

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(tick, delay);
      delay = Math.min(delay * 2, 30_000);
    };

    // An immediate check first: the common case is an address that is already
    // verified, and that member should not wait two seconds to find out.
    void tick();

    const onVisible = () => {
      if (!stopped && !hidden()) void tick();
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible);
    }

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible);
      }
    };
  }, [sendOutcome, user, passThroughIfVerified]);

  const onResend = useCallback(async () => {
    if (!user) return;
    setResending(true);
    setError(null);
    setStatus(null);
    setUnconfigured(false);
    // This tap owns the reported outcome from here on: a slower send still in
    // the air from sign-up must not overwrite the answer to this one.
    const attempt = beginVerificationSend(user.uid);
    try {
      // WSF's own delivery path — the client SDK's sendEmailVerification routes
      // through mail that does not arrive and mints a link that does not
      // resolve. See wsfSendVerificationEmail.
      const result = await requestVerificationEmail();
      recordVerificationSend(user.uid, result.sent ? 'sent' : 'already-verified', attempt);
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
        recordVerificationSend(user.uid, 'unconfigured', attempt);
        setUnconfigured(true);
      } else {
        recordVerificationSend(user.uid, 'failed', attempt);
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
  // Derived above, in the hook section, so the effect and the render cannot
  // disagree about which outcome this is.
  const outcome: VerificationSendOutcome | null = sendOutcome;
  const INTRO: Record<VerificationSendOutcome, string> = {
    sending: `Sending a verification link to ${where}. Confirm it, then tap I have verified.`,
    sent: `We sent a verification link to ${where}. Confirm it, then tap I have verified.`,
    'already-verified': `${where} is already verified. Tap I have verified to continue.`,
    unconfigured: `Email isn't switched on for this test build, so no verification link can be sent to ${where} yet.`,
    failed: `We could not send a verification link to ${where}. Tap Resend to try again.`,
  };
  /*
    THE REASON IS SAID ONCE.

    `INTRO.unconfigured` names the address and explains the build cannot send.
    The sheet then carried a panel making the same point again, so the screen
    stated its one fact twice — the repetition the accepted target recomposed
    away from. On this outcome the field carries the whole statement and the
    sheet carries none of it.
  */
  const intro =
    outcome === 'unconfigured'
      ? 'No message was sent, and nobody can finish verifying a new account on this build until email is switched on.'
      : outcome
        ? INTRO[outcome]
        : `Confirm your email address at ${where}, then tap I have verified.`;

  /*
    WHAT THIS BUILD CAN ACTUALLY DO — AND WHICH CONTROL IS REALLY DEAD.

    The brief said to drop BOTH "I have verified" and "Resend" on
    `unconfigured`. Only one of them is dead, and the difference is in what
    each actually calls:

      RESEND is dead. It calls wsfSendVerificationEmail, which is what just
      threw failed-precondition because WSF_EMAIL_* is unset. Pressing it
      again fails identically. There is nothing to resend.

      "I HAVE VERIFIED" IS NOT DEAD. `onCheck` calls reload(user) and reads
      user.emailVerified — the CURRENT auth state, not anything this build
      sent. An address verified by any other means (an earlier build, an
      administrator, an already-verified account someone signed in with)
      makes it succeed and route onward. Removing it would delete a working
      way out of the gate, not a dead control.

    So the dead one goes and the working one stays, demoted under the action
    that resolves this for most people. The rest of the recomposition stands:
    the reason is said once, and the way out is the primary.
  */
  const canResend = outcome !== 'unconfigured';
  const canVerifyHere = outcome !== 'unconfigured';
  const destinationKind = readAuthDestinationKind();

  return (
    <FormShell
      heading={canVerifyHere ? 'Check your email.' : 'Verification is switched off here.'}
      intro={intro}
      testID="wsf-verify"
      tone={canVerifyHere ? 'action' : 'error'}
      step="Step 2 of 3"
      eyebrow={
        canVerifyHere
          ? outcome === 'already-verified'
            ? 'Nothing to wait for'
            : outcome === 'failed'
              ? 'Didn\u2019t send'
              : 'One thing to do'
          : 'Not possible on this build'
      }
      /* THE DESTINATION SURVIVES THIS GATE. `nextRouteAfterAuth` is read at
         sign-in, here, and again at profile setup, so a pending destination
         outlives all three — and this is the screen where somebody is most
         likely to wonder whether it was lost. Still the KIND only. */
      destination={
        destinationKind
          ? {
              ...authDestinationCard(destinationKind),
              label: 'Still waiting for you',
              note: 'It survives this step and the next one. You will land on it, not on home.',
            }
          : undefined
      }
      /* ON `unconfigured` THE FOOT DROPS SIGN OUT, because the sheet has just
         made it the primary. The same control twice on one screen is the
         duplication this work has had to correct before. */
      foot={
        <>
          <FootNote testID="wsf-verify-account">{`Signed in as ${where}`}</FootNote>
          {canVerifyHere ? (
            <SubmitButton
              label="Sign out"
              onPress={onSignOut}
              submitting={false}
              testID="wsf-verify-signout"
              variant="tertiary"
            />
          ) : null}
        </>
      }
    >
      {status ? <StatusText testID="wsf-verify-status">{status}</StatusText> : null}
      {error ? <ErrorText testID="wsf-verify-error">{error}</ErrorText> : null}

      {canVerifyHere ? (
        <>
          <SubmitButton
            label="I have verified"
            onPress={onCheck}
            submitting={checking}
            testID="wsf-verify-check"
          />
          {canResend ? (
            <SubmitButton
              label="Resend verification email"
              onPress={onResend}
              submitting={resending}
              testID="wsf-verify-resend"
              variant="secondary"
            />
          ) : null}
          <HelpPanel
            title="No email yet?"
            body="Check spam, and confirm the address above is the one you meant. Resending sends a new link to the same address."
          />
        </>
      ) : (
        <>
          {/* No panel restating the reason, and none restating the account:
              the field carries the first and the foot carries the second.
              What is left in the sheet is only what to DO. */}
          {/* The action that resolves this for most people, as the primary. */}
          <SubmitButton
            label="Sign out and use a verified account"
            onPress={onSignOut}
            submitting={false}
            testID="wsf-verify-signout-primary"
          />
          {/* NO MANUAL CHECK HERE. The screen refreshes auth state itself in
              this outcome (see the effect above), so there is nothing for a
              person to press and nothing crowding the one action that helps.
              The control stays on every outcome where a send was attempted. */}
          {/* TRUE ABOUT BEHAVIOUR, and careful not to become a promise about
              email. It says what this build did not do, and what this screen
              will do by itself — both of which are facts, unlike "we will
              send you a link". */}
          <HelpPanel
            title="What to do"
            body="Nothing was sent and nothing can be resent on this build. If this address gets verified somewhere else, this screen will carry on by itself — you do not need to do anything here. Otherwise sign in with an account that is already verified, or ask for email to be switched on."
            testID="wsf-verify-unconfigured"
          />
        </>
      )}
    </FormShell>
  );
}
