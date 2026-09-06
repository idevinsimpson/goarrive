/**
 * Turns Firebase Auth error codes into something a member can act on.
 *
 * The default was `e.message`, which renders as
 * "Firebase: Error (auth/email-already-in-use)." — a string that names our
 * vendor, leaks an internal code, and tells the reader nothing about what to
 * do next. Devin hit exactly that on the first real signup attempt.
 *
 * `auth/email-already-in-use` is not an edge case here and the copy has to
 * reflect that. WSF and GoArrive share one Firebase Auth pool, so every
 * existing GoArrive member and coach already has an account for this address
 * — and they are precisely the people most likely to be handed a WSF invite.
 * For them, "create an account" is the wrong instruction; signing in is the
 * whole answer, and their existing password works.
 */

const MESSAGES: Record<string, string> = {
  'auth/email-already-in-use':
    'You already have an account with this email — including one from GoArrive. Sign in below and we will pick up where you left off.',
  'auth/too-many-requests':
    'Too many attempts in a row. Wait about a minute, then try again.',
  'auth/invalid-email': 'That email address does not look right.',
  'auth/missing-password': 'Enter your password.',
  'auth/weak-password': 'Passwords need to be at least 8 characters.',
  'auth/user-not-found': 'No account with that email yet. Create one instead.',
  'auth/wrong-password': 'That email and password do not match.',
  'auth/invalid-credential': 'That email and password do not match.',
  'auth/user-disabled': 'This account has been disabled. Contact support.',
  'auth/network-request-failed':
    'We could not reach the server. Check your connection and try again.',
  // Should be unreachable now that the real registration is in place, but if
  // it ever comes back the generic fallback would send someone chasing their
  // own password instead of a broken build.
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
    'This build is misconfigured and cannot sign anyone in. Please report it.',
};

/** True when the address is already registered — the caller may want to steer to sign-in. */
export function isEmailAlreadyInUse(err: unknown): boolean {
  return authErrorCode(err) === 'auth/email-already-in-use';
}

/**
 * True when the caller failed the email/password check in a way Firebase's own
 * enumeration protection collapses into "the two values don't match" — the
 * signin screen keys on this to render the two next-step links after the
 * error (E3.5 §3C C4). Includes `auth/user-not-found` because Firebase Auth
 * now returns `auth/invalid-credential` for unknown-user OR wrong-password by
 * default anyway; the older codes are kept for older SDK builds.
 */
export function isCredentialMismatch(err: unknown): boolean {
  const code = authErrorCode(err);
  return (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found'
  );
}

export function authErrorCode(err: unknown): string | null {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

export function authErrorMessage(err: unknown, fallback: string): string {
  const code = authErrorCode(err);
  if (code && MESSAGES[code]) return MESSAGES[code];

  // Never surface a raw Firebase string. An unmapped code is our gap, not
  // something to make the member read.
  if (code) return `${fallback} (${code})`;
  return fallback;
}
