import { router, useLocalSearchParams } from 'expo-router';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useWsfAuth } from '../src/auth';
import { AuthFlagOffPanel } from '../src/AuthFlagOffPanel';
import {
  authFormStyles,
  ErrorText,
  FieldLabel,
  FormShell,
  SecondaryLink,
  StatusText,
  SubmitButton,
  TextField,
} from '../src/AuthFormPrimitives';
import { wsfAuthEnabled } from '../src/featureFlags';
import { getFirebaseFirestore } from '../src/firebase';
import { LegalAccordion } from '../src/LegalAccordion';
import { WSF_PRIVACY_MARKDOWN, WSF_TERMS_MARKDOWN } from '../src/legalContent';
import { nextRouteAfterAuth } from '../src/pendingJoinCode';
import {
  WSF_ACCEPTED_PRIVACY_VERSION,
  WSF_ACCEPTED_TERMS_VERSION,
} from '../src/profileConstants';

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
        setError(e instanceof Error ? e.message : 'Could not load profile.');
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
  const canSubmit = acceptedTerms && !!initialName.trim();

  async function onSubmit() {
    if (!user) return;
    setError(null);
    setSubmitting(true);
    try {
      const db = getFirebaseFirestore();
      // Create-or-update: never touch `createdAt` on update; version fields
      // are always re-stamped to the current constant so a bump ripples through
      // to the stored consent record when a member next opens the app.
      const payload: Record<string, unknown> = {
        displayName: initialName.trim(),
        acceptedTermsVersion: WSF_ACCEPTED_TERMS_VERSION,
        acceptedPrivacyVersion: WSF_ACCEPTED_PRIVACY_VERSION,
        updatedAt: serverTimestamp(),
      };
      if (!existing) {
        payload.createdAt = serverTimestamp();
      }
      await setDoc(doc(db, 'wsfMemberProfiles', user.uid), payload, { merge: true });
      // Round-trip: a visitor who arrived via /join/<code> is stashed a pending
      // code on that page. Profile-setup is the LAST step whose completion makes
      // wsfJoinCommunity's guards pass — verified + profile exists — so this is
      // the correct hop to hand the flow back to /join/<code>. Anyone without a
      // pending code falls through to the signed-in home.
      router.replace(nextRouteAfterAuth('/') as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormShell
      eyebrow="We Stay Fit"
      heading={existing ? 'Update your profile' : 'Complete your profile'}
      intro={
        existing
          ? 'Change your display name or re-accept the current terms.'
          : 'One step before you can start or join a community.'
      }
      testID="wsf-profile"
    >
      <FieldLabel>Display name</FieldLabel>
      <TextField
        value={initialName}
        onChangeText={setDisplayName}
        autoCapitalize="words"
        testID="wsf-profile-displayName"
      />

      <View style={{ marginTop: 8 }}>
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

      <Pressable
        onPress={() => setAcceptedTerms((v) => !v)}
        style={authFormStyles.checkboxRow}
        testID="wsf-profile-termsCheckbox"
        accessibilityRole="checkbox"
        accessibilityState={{ checked: acceptedTerms }}
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
