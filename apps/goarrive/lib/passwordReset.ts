type QueryValue = string | string[] | undefined;

/** Reject missing/ambiguous links; never use URL-supplied apiKey or continueUrl. */
export function readPasswordResetLink(mode: QueryValue, oobCode: QueryValue) {
  if (typeof oobCode !== 'string' || !oobCode.trim()) {
    return { code: null, error: 'This reset link is missing or incomplete. Open the full link from your latest password reset email.' };
  }
  if (mode !== 'resetPassword' || oobCode !== oobCode.trim()) {
    return { code: null, error: 'This is not a valid password reset link. Request a new link from the sign-in page.' };
  }
  return { code: oobCode, error: '' };
}

export function validateResetPassword(password: string, confirmation: string): string {
  if (!password.trim()) return 'Enter a new password.';
  if (password.length < 6) return 'Use at least 6 characters for your new password.';
  if (!confirmation) return 'Confirm your new password.';
  if (password !== confirmation) return 'Your passwords do not match.';
  return '';
}

/** Only allowlisted messages leave the SDK boundary, never raw errors/codes. */
export function passwordResetError(error: unknown): { message: string; terminal: boolean } {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : '';
  switch (code) {
    case 'auth/expired-action-code':
      return { message: 'This reset link has expired. Request a new link from the sign-in page.', terminal: true };
    case 'auth/invalid-action-code':
    case 'auth/user-disabled':
    case 'auth/user-not-found':
      return { message: 'This reset link is invalid or has already been used. Request a new link from the sign-in page.', terminal: true };
    case 'auth/weak-password':
    case 'auth/password-does-not-meet-requirements':
      return { message: 'Choose a stronger password that meets your account’s password requirements.', terminal: false };
    case 'auth/network-request-failed':
      return { message: 'We could not reach the server. Check your connection and try again. If you already submitted a password, try signing in first.', terminal: false };
    case 'auth/too-many-requests':
      return { message: 'Too many attempts. Please wait a while before trying again.', terminal: false };
    default:
      return { message: 'We could not complete this request. Please try again. If you already submitted a password, try signing in first.', terminal: false };
  }
}
