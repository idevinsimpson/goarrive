import { FormShell, SecondaryLink } from './AuthFormPrimitives';

/**
 * What an auth-gated screen shows while the feature flag is off. The same
 * shell as every form (wordmark chrome, heading, intro, card), with the one
 * way out as a 44 px tertiary link.
 */
export function AuthFlagOffPanel({ title, testID }: { title: string; testID: string }) {
  return (
    <FormShell
      heading={title}
      intro="Accounts are opening soon. Check back once we invite the first champions."
      testID={testID}
    >
      <SecondaryLink href="/" label="Back to home" />
    </FormShell>
  );
}
