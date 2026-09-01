import { httpsCallable } from 'firebase/functions';

import { getFirebaseFunctions } from './firebase';

/**
 * Requests a verification email through WSF's own delivery path.
 *
 * Deliberately not `sendEmailVerification` from the client SDK. That routes
 * through Firebase Auth's built-in mail, which for this project does not
 * arrive, and mints a link pointing at an action URL that does not resolve.
 * See wsfSendVerificationEmail in functions-westayfit for the full account.
 *
 * Takes no arguments on purpose: the address is read server-side from the ID
 * token, so a caller cannot ask us to mail somebody else.
 */
export type SendVerificationResult = { sent: boolean; reason?: string };

export async function requestVerificationEmail(): Promise<SendVerificationResult> {
  const fn = httpsCallable<void, SendVerificationResult>(
    getFirebaseFunctions(),
    'wsfSendVerificationEmail'
  );
  const result = await fn();
  return result.data;
}
