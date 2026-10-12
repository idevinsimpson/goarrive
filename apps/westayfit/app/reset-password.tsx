import { useState } from 'react';

import { AuthFlagOffPanel } from '../src/AuthFlagOffPanel';
import {
  ErrorText,
  FieldLabel,
  FormShell,
  HelpPanel,
  NoticeText,
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
      // missing. Surface that as its own plain sentence (wsf-reset-unconfigured)
      // instead of the generic authErrorMessage fallback, so a stray build
      // lands users in a clear place rather than chasing a Firebase code.
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
      heading="Set a new password."
      intro="Enter your email and we will send a link to set a new one."
      testID="wsf-reset-screen"
      tone={unconfigured ? 'error' : 'ordinary'}
      foot={<SecondaryLink href="/signin" label="Back to sign in" testID="wsf-reset-back" />}
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

      {/* ENUMERATION SAFETY IS A DESIGN CONSTRAINT, NOT A DETAIL. The product
          cannot say whether that address has an account, so no state here may
          imply it. This is a notice rather than a status line because it is a
          statement about what may have happened, not a confirmation. */}
      {sent ? (
        <NoticeText testID="wsf-reset-sent">
          If an account exists for that email, a reset link is on its way. Check your inbox and
          spam.
        </NoticeText>
      ) : null}
      {unconfigured ? (
        <ErrorText testID="wsf-reset-unconfigured">
          Email isn't switched on for this test build yet, so no reset link was sent.
        </ErrorText>
      ) : null}
      {error ? <ErrorText testID="wsf-reset-error">{error}</ErrorText> : null}

      {!sent ? (
        <SubmitButton
          label="Send reset link"
          onPress={onSubmit}
          submitting={submitting}
          /* On `unconfigured` this build cannot send at all, so the control is
             disabled rather than inviting somebody to keep pressing it. */
          disabled={!email.trim() || unconfigured}
          testID="wsf-reset"
        />
      ) : null}

      {/* What happens next, said before it is waited for — and never in a way
          that reveals whether the address has an account. */}
      {!sent && !unconfigured ? (
        <HelpPanel
          title="What happens next"
          body="If an account exists for that email, a reset link is on its way. Check your inbox and spam."
        />
      ) : null}
    </FormShell>
  );
}
