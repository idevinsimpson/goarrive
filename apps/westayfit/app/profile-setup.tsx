import { router, useLocalSearchParams } from 'expo-router';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { signOut } from 'firebase/auth';

import { useWsfAuth } from '../src/auth';
import { AuthFlagOffPanel } from '../src/AuthFlagOffPanel';
import { describeCallableError } from '../src/callableErrors';
import {
  authFormStyles,
  ErrorText,
  FieldLabel,
  FootNote,
  FormShell,
  HelpPanel,
  SecondaryLink,
  StatusText,
  SubmitButton,
  TextField,
} from '../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseAuth, getFirebaseFirestore, getFirebaseFunctions } from '../src/firebase';
import { LegalAccordion } from '../src/LegalAccordion';
import { WSF_PRIVACY_MARKDOWN, WSF_TERMS_MARKDOWN } from '../src/legalContent';
import {
  authDestinationCard,
  readAuthDestinationKind,
} from '../src/authDestination';
import { nextRouteAfterAuth } from '../src/pendingJoinCode';

type ExistingProfile = {
  displayName?: string;
  acceptedTermsVersion?: string;
  acceptedPrivacyVersion?: string;
};

export default function ProfileSetup() {
  const { ready, user } = useWsfAuth();
  const params = useLocalSearchParams<{ edit?: string }>();
  const editMode = params.edit === '1';
  const [displayName, setDisplayName] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [existing, setExisting] = useState<ExistingProfile | null>(null);
  // If the mount-time existence read fails we cannot know whether a profile
  // already exists. Submitting anyway would fall through to the create branch
  // of wsfSaveProfile and clobber createdAt on a returning member. Block the
  // submit until the read succeeds — the member can retry the page.
  const [existenceReadFailed, setExistenceReadFailed] = useState(false);

  useEffect(() => {
    // Bail out until auth is settled and we have a verified user; the other
    // branches below render early-return states in that case.
    if (!wsfAuthEnabled || !ready || !user || !user.emailVerified) return;
    let cancelled = false;
    (async () => {
      try {
        const db = getFirebaseFirestore();
        const snap = await getDoc(doc(db, 'wsfMemberProfiles', user.uid));
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data() as ExistingProfile;
          setExisting(data);
          if (!editMode) {
            // Existing profile + no ?edit=1 → home (or pending join code).
            router.replace(nextRouteAfterAuth('/') as never);
            return;
          }
          if (data.displayName) setDisplayName(data.displayName);
        }
        setProfileLoaded(true);
      } catch (e) {
        if (cancelled) return;
        setError(describeCallableError(e, 'We couldn’t load your profile. Try again.'));
        setExistenceReadFailed(true);
        setProfileLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, user, editMode]);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Complete your profile" testID="wsf-profile-disabled" />;
  }

  if (!ready) {
    return (
      <FormShell heading="Complete your profile" testID="wsf-profile-loading">
        <StatusText testID="wsf-profile-loading-status">Loading…</StatusText>
      </FormShell>
    );
  }

  if (!user) {
    return (
      <FormShell
        heading="Complete your profile"
        intro="You need to sign in first."
        testID="wsf-profile-signed-out"
      >
        <SecondaryLink href="/signin" label="Sign in" />
      </FormShell>
    );
  }

  if (!user.emailVerified) {
    return (
      <FormShell
        heading="Complete your profile"
        intro="Verify your email before completing your profile."
        testID="wsf-profile-unverified"
      >
        <SecondaryLink href="/verify-email" label="Verify email" />
      </FormShell>
    );
  }

  if (!profileLoaded) {
    return (
      <FormShell heading="Complete your profile" testID="wsf-profile-checking">
        <StatusText testID="wsf-profile-checking-status">Checking your profile…</StatusText>
      </FormShell>
    );
  }

  const initialName = displayName || user.displayName || '';
  const canSubmit = acceptedTerms && !!initialName.trim() && !existenceReadFailed;

  async function onSubmit() {
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
      // wsfSaveProfile owns the create-vs-update fork and the accepted-version
      // stamping; the client only supplies displayName. firestore.rules still
      // require adultConfirmation on this collection (DECISIONS.md 2026-09-06
      // removed the age gate on the client but the rules edit is a separate
      // deploy) so a client setDoc would fail with PERMISSION_DENIED. The
      // Admin-SDK write inside the callable bypasses rules.
      const fn = httpsCallable<{ displayName: string }, { created: boolean }>(
        getFirebaseFunctions(),
        'wsfSaveProfile'
      );
      await fn({ displayName: initialName.trim() });
      // Round-trip: a visitor who arrived via /join/<code> is stashed a pending
      // code on that page. Profile-setup is the LAST step whose completion makes
      // wsfJoinCommunity's guards pass — verified + profile exists — so this is
      // the correct hop to hand the flow back to /join/<code>. Anyone without a
      // pending code falls through to the signed-in home.
      router.replace(nextRouteAfterAuth('/') as never);
    } catch (e) {
      setError(describeCallableError(e, 'We couldn’t save your profile. Try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  const destinationKind = readAuthDestinationKind();

  async function onSignOut() {
    await signOut(getFirebaseAuth());
    router.replace('/signin' as never);
  }

  return (
    <FormShell
      heading={existing ? 'Update your profile' : 'What should we call you?'}
      intro={
        existing
          ? 'Change your display name or re-accept the current terms.'
          : 'One step before you can start or join a community.'
      }
      testID="wsf-profile"
      tone="action"
      /* No step chip for a member who already has a profile and is just
         editing it — they are not partway through signing up. */
      step={existing ? undefined : 'Step 3 of 3'}
      eyebrow={existing ? undefined : 'Last step'}
      /* THE LAST OF THE THREE GATES `nextRouteAfterAuth` IS READ AT. Still the
         KIND only — a pending join code is opaque, and a private community's
         name is not something a half-authorized account may read. */
      destination={
        destinationKind ? authDestinationCard(destinationKind, 'still') : undefined
      }
      foot={
        <>
          {user.email ? (
            <FootNote testID="wsf-profile-account">{`Signed in as ${user.email}`}</FootNote>
          ) : null}
          {/* A WAY OUT OF THE LAST GATE. Without this a member who reached
              profile setup on the wrong account had no control on the screen
              to leave it with. `signOut` is the same one every other gate
              uses; nothing about the auth model changes. */}
          <SubmitButton
            label="Sign out"
            onPress={onSignOut}
            submitting={false}
            testID="wsf-profile-signout"
            variant="tertiary"
          />
        </>
      }
    >
      <FieldLabel>Display name</FieldLabel>
      <TextField
        value={initialName}
        onChangeText={setDisplayName}
        autoCapitalize="words"
        testID="wsf-profile-displayName"
      />

      {/*
        THE VOID IS FILLED WITH THE ONE THING THIS SCREEN OWES AN ANSWER TO.
        A display name is one field, so this state was a name, a checkbox, a
        button and then a third of a phone of empty cream. What belongs in it
        is what a person is actually deciding here — who sees this name.

        NARROWED TO WHAT THE SOURCE PROVES. Not "your community sees this" and
        not "it is never shown outside your community": both are broader than
        anything the product guarantees, in opposite directions.
        `wsfMemberProfiles/{uid}` is owner-readable only (`allow read: if
        request.auth.uid == uid`), every read and write of it is keyed to the
        caller's own uid, and no callable returns another member's
        displayName. So today this name is shown to nobody but its owner — and
        the name that DOES go on a screen in a room is a different one, chosen
        per turn, which is worth saying so the two are not confused.
      */}
      <HelpPanel
        title="Where this name is used"
        body="It is the name on your account, and you can change it later. If you ever go up on a screen at an event, you choose what that screen calls you then — separately, and each time."
        testID="wsf-profile-name-use"
      />

      <View style={styles.legal}>
        <LegalAccordion
          triggerLabel="Terms of Service"
          markdown={WSF_TERMS_MARKDOWN}
          testID="wsf-profile-terms"
        />
        <LegalAccordion
          triggerLabel="Privacy Policy"
          markdown={WSF_PRIVACY_MARKDOWN}
          testID="wsf-profile-privacy"
        />
      </View>

      {/*
        `aria-checked` IS SET DIRECTLY, BECAUSE accessibilityState DID NOT
        REACH THE DOM.

        This renders a role="checkbox" whose checked state was announced to
        nobody: react-native-web did not map `accessibilityState={{ checked }}`
        to an attribute here, so a screen reader met a checkbox with no state
        — on the one control in the product that records a legal consent.
        Caught by asserting the attribute rather than assuming the prop
        arrived.

        `accessibilityState` stays for native, where it is the supported API.
      */}
      <Pressable
        onPress={() => setAcceptedTerms((v) => !v)}
        style={authFormStyles.checkboxRow}
        testID="wsf-profile-termsCheckbox"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: acceptedTerms }}
        aria-checked={acceptedTerms}
      >
        <View style={[authFormStyles.checkbox, acceptedTerms ? authFormStyles.checkboxChecked : null]}>
          {acceptedTerms ? <Text style={authFormStyles.checkboxCheck}>{'\u2713'}</Text> : null}
        </View>
        <Text style={authFormStyles.checkboxLabel}>
          By saving I confirm I am 13 or older and accept the Terms of Service and Privacy Policy.
        </Text>
      </Pressable>

      {error ? <ErrorText testID="wsf-profile-error">{error}</ErrorText> : null}

      <SubmitButton
        label={existing ? 'Save changes' : 'Save profile'}
        onPress={onSubmit}
        submitting={submitting}
        disabled={!canSubmit}
        testID="wsf-profile-submit"
      />
    </FormShell>
  );
}

const styles = StyleSheet.create({
  // Layout only this screen needs: the two legal panels sit a little apart
  // from the name field above them. Everything else on the page is the kit.
  legal: { marginTop: 8, gap: 4 },
});
