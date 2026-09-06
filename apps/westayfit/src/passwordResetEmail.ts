import { httpsCallable } from 'firebase/functions';

import { getFirebaseFunctions } from './firebase';

/**
 * Requests a password-reset email through WSF's own delivery path.
 *
 * Deliberately not `sendPasswordResetEmail` from the client SDK. That routes
 * through Firebase Auth's built-in mail (which for this project does not
 * arrive) and mints a link pointing at an action URL that does not resolve.
 * See wsfSendPasswordResetEmail in functions-westayfit for the full account.
 *
 * The callable enforces enumeration protection: whether or not an account
 * exists for the address, the resolved shape is `{ accepted: true }`. The
 * reset screen is not allowed to reveal which one happened.
 */
export type SendPasswordResetResult = { accepted: true };

export async function requestPasswordResetEmail(
  email: string
): Promise<SendPasswordResetResult> {
  const fn = httpsCallable<{ email: string }, SendPasswordResetResult>(
    getFirebaseFunctions(),
    'wsfSendPasswordResetEmail'
  );
  const result = await fn({ email });
  return result.data;
}
