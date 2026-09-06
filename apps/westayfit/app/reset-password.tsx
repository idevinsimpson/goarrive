import { useState } from 'react';

import { AuthFlagOffPanel } from '../src/AuthFlagOffPanel';
import {
  ErrorText,
  FieldLabel,
  FormShell,
  SecondaryLink,
  StatusText,
  SubmitButton,
  TextField,
} from '../src/AuthFormPrimitives';
import { authErrorCode, authErrorMessage } from '../src/authErrors';
import { wsfAuthEnabled } from '../src/featureFlags';
import { requestPasswordResetEmail } from '../src/passwordResetEmail';

export default function ResetPassword() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unconfigured, setUnconfigured] = useState(false);

  if (!wsfAuthEnabled) {
    return <AuthFlagOffPanel title="Reset your password" testID="wsf-reset-disabled" />;
  }

  async function onSubmit() {
    setError(null);
    setUnconfigured(false);
    setSubmitting(true);
    try {
      await requestPasswordResetEmail(email.trim().toLowerCase());
      // Success shape is deliberately identical to the enumeration-protected
      // path — see wsfSendPasswordResetEmail. The copy below must not tell the
      // caller whether an account actually exists.
      setSent(true);
    } catch (e) {
      // The callable throws failed-precondition when WSF_EMAIL_* env vars are
      // missing. Surface that as the honest "not set up yet" message instead
      // of the generic authErrorMessage fallback so a stray build lands users
      // in a clear place rather than chasing a Firebase code.
      const code = authErrorCode(e);
      if (code === 'functions/failed-precondition') {
        setUnconfigured(true);
      } else {
        setError(authErrorMessage(e, 'Reset request failed.'));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <FormShell
      eyebrow="We Stay Fit"
      heading="Reset your password"
      intro="Enter your email and we will send a link to set a new one."
      testID="wsf-reset-screen"
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
        returnKeyType="go"
        onSubmitEditing={onSubmit}
        editable={!sent}
        testID="wsf-reset-email"
      />

      {sent ? (
        <StatusText testID="wsf-reset-sent">
          If an account exists for that email, a reset link is on its way. Check your inbox and
          spam.
        </StatusText>
      ) : null}
      {unconfigured ? (
        <ErrorText testID="wsf-reset-unconfigured">
          Password reset email is not set up yet on this build.
        </ErrorText>
      ) : null}
      {error ? <ErrorText testID="wsf-reset-error">{error}</ErrorText> : null}

      {!sent ? (
        <SubmitButton
          label="Send reset link"
          onPress={onSubmit}
          submitting={submitting}
          disabled={!email.trim()}
          testID="wsf-reset"
        />
      ) : null}

      <SecondaryLink href="/signin" label="Back to sign in" />
    </FormShell>
  );
}
