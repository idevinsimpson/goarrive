/**
 * Turns a failed callable (or Firestore read) into a sentence a member can
 * act on.
 *
 * The screens used to fall back to `e.message`. For a callable that is the
 * server's own text, which is fine when the server wrote a member sentence
 * ("Verify your email before joining a community.", "You are this
 * community's only Champion. Designate another Champion before you leave.")
 * and a leak when it did not: the SDK's network failure surfaces as the bare
 * word "internal", a Firestore rule refusal as "Missing or insufficient
 * permissions.", a validation miss as "displayName must be 2-80 characters."
 * None of those tell a member what to do next, and the last two name our own
 * field and function identifiers.
 *
 * Rule: a server sentence written for members passes through unchanged (the
 * sole-Champion refusal is asserted verbatim by the browser suite). Anything
 * that is a raw code, an identifier-bearing developer string, or a
 * connectivity failure becomes the plain sentence for its code. Nothing here
 * ever renders a `functions/…` code or a vendor string.
 */

const NETWORK_SENTENCE = 'We couldn’t reach the server. Check your connection and try again.';

const NETWORK_CODES = new Set([
  'internal',
  'unavailable',
  'deadline-exceeded',
  'unknown',
  'cancelled',
  'aborted',
  'data-loss',
]);

const CODE_SENTENCES: Record<string, string> = {
  unauthenticated: 'Please sign in again, then try once more.',
  'permission-denied': 'This account can’t do that here.',
  'not-found': 'We couldn’t find that. It may have been removed.',
  'invalid-argument': 'Something about this didn’t look right. Check the details and try again.',
  'failed-precondition': 'That can’t be done right now.',
  'resource-exhausted': 'Too many requests in a short time. Wait a moment and try again.',
  'already-exists': 'That already exists.',
};

/**
 * True when the server's text reads like a note to a developer rather than to
 * a member: it names a function or field identifier, a wire format, or is
 * one of the "<field> must be …" / "<field> is required." validation shapes.
 */
function looksLikeDeveloperText(message: string): boolean {
  return (
    /\bwsf[A-Z]\w*/.test(message) ||
    /\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/.test(message) ||
    /\b(?:must be|is required\b|ISO 8601|IANA|ASCII|uid\b)/i.test(message)
  );
}

function errorCode(e: unknown): string | null {
  if (e && typeof e === 'object' && 'code' in e) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string' && code !== '') return code;
  }
  return null;
}

function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e) {
    const message = (e as { message?: unknown }).message;
    if (typeof message === 'string') return message.trim();
  }
  return '';
}

export function describeCallableError(e: unknown, fallback: string): string {
  const rawCode = errorCode(e);
  if (!rawCode) return fallback;

  const isCallable = rawCode.startsWith('functions/');
  const code = isCallable ? rawCode.slice('functions/'.length) : rawCode;

  if (NETWORK_CODES.has(code)) {
    // A callable's own 'internal' can carry a member sentence ("Could not
    // send the reset email. Try again shortly."); the SDK's network failure
    // carries only the bare code. Keep the former, replace the latter.
    const message = errorMessage(e);
    if (
      isCallable &&
      code === 'internal' &&
      message !== '' &&
      message.toLowerCase() !== code &&
      !looksLikeDeveloperText(message)
    ) {
      return message;
    }
    return NETWORK_SENTENCE;
  }

  // A Firestore read's own strings ("Missing or insufficient permissions.")
  // are written for developers; the screen's fallback says what a member can do.
  if (!isCallable) return fallback;

  const message = errorMessage(e);
  if (message !== '' && message.toLowerCase() !== code && !looksLikeDeveloperText(message)) {
    return message;
  }
  return CODE_SENTENCES[code] ?? fallback;
}
